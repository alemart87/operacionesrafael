"""Creación rápida de usuarios: el superadmin elige el perfil y las operativas, genera un link con QR que vence a los
30 minutos y quien lo abre se registra (nombre, correo y su contraseña) y entra directo con ese perfil.

Seguridad:
- El token es aleatorio (256 bits). Se busca por su SHA-256; el token en claro solo se guarda cifrado (Fernet) para
  volver a mostrar el QR mientras está vigente, y se borra al vencer o revocarse.
- Cada link tiene un cupo (cuántas personas se pueden registrar) que se descuenta de forma atómica, y el superadmin lo
  puede revocar en cualquier momento. Opcionalmente, solo correos de un dominio.
- La contraseña cumple la política de Seguridad. Los intentos con links inválidos se limitan por IP.
- Todo queda en la auditoría: link creado, visto, revocado y cada usuario registrado (con el link que usó).
"""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import rate_limit
from ...core.config import settings
from ...core.database import get_db
from ...core.operativas import asignables, get_operativa, operativas_de_perfil
from ...core.perfiles import PERFIL_PATTERN, PERFIL_SLUGS, PERFILES
from ...core.security import hash_password
from ...models.invitacion import Invitacion
from ...models.user import User
from ...services import seguridad as seg
from ...services.audit_service import record_action
from ..deps import CurrentUser, client_ip, require_superadmin
from . import auth

admin = APIRouter(prefix="/invitaciones", tags=["invitaciones"])
publico = APIRouter(prefix="/registro", tags=["registro"])

_ORIGEN = re.compile(r"^https?://[A-Za-z0-9.-]+(:\d{1,5})?$")
_DOMINIO = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$")
# Perfiles que ven Facturación o Integraciones: el link se avisa como sensible (cupo sugerido: 1).
_SENSIBLES_PERMS = ("televentas_claro.facturacion", "televentas_claro.integraciones")
PERFILES_SENSIBLES = {p for p in PERFIL_SLUGS if any(x in asignables(p) for x in _SENSIBLES_PERMS)}


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def _utc(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=timezone.utc) if d is not None and d.tzinfo is None else d


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def estado(inv: Invitacion, ahora: datetime | None = None) -> str:
    ahora = ahora or _ahora()
    if inv.revocada_at:
        return "revocada"
    if inv.usos >= inv.max_usos:
        return "agotada"
    if _utc(inv.expires_at) <= ahora:
        return "vencida"
    return "vigente"


def _url(inv: Invitacion, token: str) -> str:
    return f"{inv.origen}/registro/{token}"


def _perfil(slug: str) -> dict[str, str]:
    p = next((x for x in PERFILES if x["slug"] == slug), None)
    return {"slug": slug, "name": p["name"] if p else slug, "description": p["description"] if p else ""}


def _operativas(slugs: list[str]) -> list[dict[str, str]]:
    return [{"slug": s, "name": (get_operativa(s) or {}).get("name", s)} for s in slugs]


async def _dict(db: AsyncSession, inv: Invitacion, *, con_qr: bool = False, token: str | None = None) -> dict[str, Any]:
    ahora = _ahora()
    est = estado(inv, ahora)
    if est != "vigente" and inv.token_enc:
        inv.token_enc = None          # vencido, agotado o revocado: el token no se puede volver a mostrar
        await db.commit()
    registrados = (await db.execute(select(User).where(User.invitacion_id == inv.id).order_by(User.created_at))).scalars().all()
    out: dict[str, Any] = {
        "id": inv.id, "perfil": _perfil(inv.perfil), "operativas": _operativas(list(inv.operativas or [])),
        "nota": inv.nota, "dominio": inv.dominio, "max_usos": inv.max_usos, "usos": inv.usos, "estado": est,
        "sensible": inv.perfil in PERFILES_SENSIBLES,
        "created_at": _utc(inv.created_at).isoformat() if inv.created_at else None,
        "expires_at": _utc(inv.expires_at).isoformat(), "segundos": max(0, int((_utc(inv.expires_at) - ahora).total_seconds())),
        "revocada_at": _utc(inv.revocada_at).isoformat() if inv.revocada_at else None,
        "registrados": [{"id": u.id, "full_name": u.full_name, "email": u.email, "is_active": u.is_active,
                         "created_at": _utc(u.created_at).isoformat() if u.created_at else None} for u in registrados],
        "url": None, "qr_svg": None,
    }
    if con_qr and est == "vigente":
        token = token or seg.descifrar(inv.token_enc)
        if token:
            out["url"] = _url(inv, token)
            out["qr_svg"] = seg.qr_svg(out["url"])
    return out


# ================================================================== superadmin
class InvitacionCrear(BaseModel):
    perfil: str = Field(pattern=PERFIL_PATTERN)
    operativas: List[str] = Field(min_length=1, max_length=20)
    max_usos: int = Field(1, ge=1)
    nota: Optional[str] = Field(None, max_length=120)
    dominio: Optional[str] = Field(None, max_length=120)
    # La dirección de la plataforma en el navegador del superadmin (con ella se arma el link del QR).
    origen: str = Field(..., max_length=200)


@admin.post("", status_code=status.HTTP_201_CREATED)
async def crear(payload: InvitacionCrear, request: Request, user: CurrentUser = Depends(require_superadmin),
                db: AsyncSession = Depends(get_db)) -> dict:
    """Genera el link y el QR (vencen a los `INVITACION_MINUTOS`, por defecto 30)."""
    origen = payload.origen.strip().rstrip("/")
    if not _ORIGEN.match(origen):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La dirección de la plataforma no es válida")
    operativas = operativas_de_perfil(payload.perfil, payload.operativas)
    if not operativas:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Elegí al menos una operativa")
    if payload.max_usos > settings.invitacion_max_usos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"El cupo máximo es de {settings.invitacion_max_usos} personas por link")
    dominio = (payload.dominio or "").strip().lower().lstrip("@") or None
    if dominio and not _DOMINIO.match(dominio):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El dominio no es válido (por ejemplo: voicenter.com.py)")
    token = secrets.token_urlsafe(32)
    ahora = _ahora()
    inv = Invitacion(token_hash=_hash(token), token_enc=seg.cifrar(token), perfil=payload.perfil, operativas=operativas,
                     origen=origen, nota=(payload.nota or "").strip() or None, dominio=dominio, max_usos=payload.max_usos,
                     creada_por=user.id, expires_at=ahora + timedelta(minutes=settings.invitacion_minutos))
    db.add(inv)
    await db.commit()
    await record_action(db, user_id=user.id, action="invitacion_creada", resource_type="invitacion", resource_id=inv.id,
                        ip=client_ip(request), extra={"perfil": inv.perfil, "operativas": operativas, "max_usos": inv.max_usos,
                                                      "dominio": dominio, "minutos": settings.invitacion_minutos})
    return await _dict(db, inv, con_qr=True, token=token)


@admin.get("")
async def listar(limite: int = Query(20, ge=1, le=100), user: CurrentUser = Depends(require_superadmin),
                 db: AsyncSession = Depends(get_db)) -> dict:
    filas = (await db.execute(select(Invitacion).order_by(Invitacion.created_at.desc()).limit(limite))).scalars().all()
    return {"items": [await _dict(db, x) for x in filas], "minutos": settings.invitacion_minutos,
            "max_usos": settings.invitacion_max_usos, "perfiles_sensibles": sorted(PERFILES_SENSIBLES)}


async def _de(db: AsyncSession, inv_id: str) -> Invitacion:
    inv = await db.get(Invitacion, inv_id)
    if not inv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link no encontrado")
    return inv


@admin.get("/{inv_id}")
async def ver(inv_id: str, request: Request, user: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    """El link con su QR (si sigue vigente) y quiénes se registraron."""
    inv = await _de(db, inv_id)
    return await _dict(db, inv, con_qr=True)


@admin.post("/{inv_id}/revocar")
async def revocar(inv_id: str, request: Request, user: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    inv = await _de(db, inv_id)
    if not inv.revocada_at:
        inv.revocada_at, inv.revocada_por, inv.token_enc = _ahora(), user.id, None
        await db.commit()
        await record_action(db, user_id=user.id, action="invitacion_revocada", resource_type="invitacion", resource_id=inv.id,
                            ip=client_ip(request), extra={"usos": inv.usos})
    return await _dict(db, inv)


# ================================================================== público: registrarse con el link
_MOTIVOS = {
    "invalida": "Este link no es válido. Pedile uno nuevo al administrador.",
    "vencida": "Este link venció (dura {minutos} minutos). Pedile uno nuevo al administrador.",
    "revocada": "Este link fue anulado por el administrador.",
    "agotada": "Este link ya se usó todas las veces permitidas.",
}


def _rechazo(motivo: str) -> HTTPException:
    codigo = status.HTTP_404_NOT_FOUND if motivo == "invalida" else status.HTTP_410_GONE
    return HTTPException(codigo, {"code": f"link_{motivo}", "message": _MOTIVOS[motivo].format(minutos=settings.invitacion_minutos)})


async def _vigente(db: AsyncSession, token: str, ip: str, *, bloquear: bool = False) -> Invitacion:
    if rate_limit.is_blocked(ip, "registro"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Demasiados intentos. Probá de nuevo en unos minutos.")
    inv = None
    if 20 <= len(token) <= 100:
        q = select(Invitacion).where(Invitacion.token_hash == _hash(token))
        inv = (await db.execute(q.with_for_update() if bloquear else q)).scalar_one_or_none()
    if inv is None:
        rate_limit.register_failure(ip, "registro")
        raise _rechazo("invalida")
    est = estado(inv)
    if est != "vigente":
        raise _rechazo(est)
    return inv


@publico.get("/{token}")
async def ver_link(token: str, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Lo que ve quien abre el link: con qué perfil entra, hasta cuándo vale y la política de contraseñas."""
    inv = await _vigente(db, token, client_ip(request))
    cfg = await seg.config(db)
    c = cfg["contrasenas"]
    return {
        "perfil": _perfil(inv.perfil), "operativas": _operativas(list(inv.operativas or [])), "dominio": inv.dominio,
        "expires_at": _utc(inv.expires_at).isoformat(), "segundos": max(0, int((_utc(inv.expires_at) - _ahora()).total_seconds())),
        "politica": {"min_largo": c["min_largo"], "mayus_minus": c["mayus_minus"], "numero": c["numero"], "simbolo": c["simbolo"]},
    }


class Registro(BaseModel):
    full_name: str = Field(min_length=3, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


@publico.post("/{token}", status_code=status.HTTP_201_CREATED)
async def registrarse(token: str, payload: Registro, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Crea el usuario con el perfil y las operativas del link y, si está en su horario, inicia la sesión."""
    ip, ua = client_ip(request), request.headers.get("user-agent")
    inv = await _vigente(db, token, ip, bloquear=True)
    if inv.perfil not in PERFIL_SLUGS:
        raise _rechazo("invalida")
    nombre = " ".join(payload.full_name.split())
    if len(nombre.split()) < 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Escribí tu nombre y tu apellido")
    email = payload.email.lower().strip()
    if inv.dominio and not email.endswith("@" + inv.dominio):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Usá tu correo de @{inv.dominio}")
    if email == settings.superadmin_email.lower().strip():
        raise HTTPException(status.HTTP_409_CONFLICT, "Ese correo no se puede usar")
    if (await db.execute(select(User.id).where(User.email == email))).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Ese correo ya tiene un usuario: ingresá con tu contraseña desde el inicio de sesión.")
    cfg = await seg.config(db)
    try:
        seg.validar_contrasena(cfg, payload.password)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    # El cupo se descuenta de forma atómica: dos personas a la vez no pasan el tope.
    r = await db.execute(update(Invitacion).where(Invitacion.id == inv.id, Invitacion.usos < Invitacion.max_usos,
                                                  Invitacion.revocada_at.is_(None)).values(usos=Invitacion.usos + 1))
    if r.rowcount != 1:
        await db.rollback()
        raise _rechazo("agotada")
    ahora = _ahora()
    nuevo = User(email=email, hashed_password=hash_password(payload.password), full_name=nombre, role=inv.perfil,
                 operativas=operativas_de_perfil(inv.perfil, list(inv.operativas or [])), created_by=None if inv.creada_por == "superadmin" else inv.creada_por,
                 must_change_password=False, password_changed_at=ahora, invitacion_id=inv.id)
    db.add(nuevo)
    try:
        await db.commit()
    except IntegrityError as exc:       # el mismo correo, registrado en el mismo instante desde otro celular
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Ese correo ya tiene un usuario.") from exc
    await db.refresh(nuevo)
    await record_action(db, user_id=nuevo.id, action="usuario_registrado_con_link", resource_type="user", resource_id=nuevo.id,
                        ip=ip, user_agent=ua, extra={"invitacion": inv.id, "perfil": nuevo.role, "operativas": nuevo.operativas,
                                                     "email": email, "creada_por": inv.creada_por})

    # Entra directo, salvo que su perfil esté fuera del horario de acceso (en modo bloquear).
    h = seg.evaluar_horario(cfg, nuevo.role, ahora, None)
    if not h["permitido"] and cfg["horarios"]["modo"] == "bloquear":
        return {"creado": True, "ingreso": False,
                "mensaje": f"Tu usuario quedó creado. Vas a poder entrar en tu horario: {seg.texto_horario(cfg, nuevo.role)}."}
    nuevo.last_login_at = ahora
    await db.commit()
    tokens = await auth._emitir(db, cfg, request, user_id=nuevo.id, email=nuevo.email, role=nuevo.role, name=nuevo.full_name,
                                photo=None, operativas=list(nuevo.operativas or []), mfa=False, cambio=False)
    return {"creado": True, "ingreso": True, **tokens}
