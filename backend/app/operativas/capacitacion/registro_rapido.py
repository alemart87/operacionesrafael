"""Creación rápida de postulantes: el capacitador o el mentor habilita, con un toque, un link (y su QR) de 20 minutos
para su grupo; cada postulante lo escanea o lo abre en su celular, carga sus datos y queda en el grupo con su link
personal ya armado (el mismo del IPV y los entrenamientos), al que se lo lleva después de darle la bienvenida.

Seguridad:
- El token es aleatorio (256 bits); se busca por su SHA-256 y en claro solo se guarda cifrado mientras está vigente
  (para volver a mostrar el QR). Vence a los `CAPACITACION_REGISTRO_MINUTOS` (20), tiene cupo
  (`CAPACITACION_REGISTRO_MAX`, 60) que se descuenta de forma atómica y se puede cerrar antes. Solo grupos en curso.
- Los links inválidos se limitan por IP. Con una cédula que ya está en el grupo no se crea nada ni se entrega ningún
  link (así nadie obtiene el link de otro escribiendo su cédula): se le pide que hable con su capacitador.
- Todo queda en el historial del postulante y en la auditoría (link habilitado, cerrado y cada registro con su IP).
"""
from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import CurrentUser, client_ip
from ...core import rate_limit
from ...core.config import settings
from ...core.database import get_db
from ...services import seguridad as seg
from ...services.audit_service import record_action
from . import servicio as srv
from .api import DIAS_LINK, PostulanteDatos, _ci_libre, _grupo, _hash, _origen, require_ver
from .models import CapEnlace, CapGrupo, CapPostulante, CapRegistroRapido

router = APIRouter(prefix="/capacitacion", tags=["capacitación · creación rápida"])
publico = APIRouter(prefix="/capacitacion/unirme", tags=["capacitación · creación rápida (público)"])

_CLAVE_RL = "capacitacion_unirme"


def estado(r: CapRegistroRapido) -> str:
    if r.cerrado_at:
        return "cerrado"
    if r.usos >= r.max_usos:
        return "agotado"
    if srv.utc(r.vence_at) <= srv.ahora():
        return "vencido"
    return "vigente"


def _url(r: CapRegistroRapido, token: str) -> str:
    return f"{r.origen}/unirme/{token}"


async def _dict(db: AsyncSession, r: CapRegistroRapido, token: Optional[str] = None) -> dict[str, Any]:
    est = estado(r)
    if est != "vigente" and r.token_enc:
        r.token_enc = None                       # ya no vale: el token no se vuelve a mostrar
        await db.commit()
    ps = (await db.execute(select(CapPostulante).where(CapPostulante.registro_id == r.id)
                           .order_by(CapPostulante.created_at))).scalars().all()
    quien = await srv.nombres(db, [r.creado_por])
    out: dict[str, Any] = {
        "id": r.id, "estado": est, "vence_at": srv.iso(r.vence_at), "created_at": srv.iso(r.created_at),
        "segundos": max(0, int((srv.utc(r.vence_at) - srv.ahora()).total_seconds())) if est == "vigente" else 0,
        "usos": r.usos, "max_usos": r.max_usos, "creado_por": quien.get(r.creado_por, "—"),
        "registrados": [{"id": p.id, "nombre": p.nombre, "apellido": p.apellido, "at": srv.iso(p.created_at)} for p in ps],
        "url": None, "qr_svg": None,
    }
    if est == "vigente" and (token := token or seg.descifrar(r.token_enc)):
        out["url"] = _url(r, token)
        out["qr_svg"] = seg.qr_svg(out["url"])
    return out


async def _ultimo(db: AsyncSession, grupo_id: str) -> Optional[CapRegistroRapido]:
    return (await db.execute(select(CapRegistroRapido).where(CapRegistroRapido.grupo_id == grupo_id)
                             .order_by(CapRegistroRapido.created_at.desc()))).scalars().first()


def _exigir_equipo(g: CapGrupo, roles: set[str]) -> None:
    if not roles & {"capacitador", "mentor", "gestion"}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "La creación rápida es del capacitador o el mentor del grupo")


# ================================================================== el equipo
@router.get("/grupos/{grupo_id}/registro-rapido")
async def ver(grupo_id: str, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """El último link de creación rápida del grupo (con su QR si sigue vigente) y quiénes se registraron con él."""
    g, roles = await _grupo(db, grupo_id, user)
    _exigir_equipo(g, roles)
    r = await _ultimo(db, g.id)
    return {"link": await _dict(db, r) if r else None, "minutos": settings.capacitacion_registro_minutos,
            "puede": g.estado == "en_curso"}


class Habilitar(BaseModel):
    origen: str = Field(..., max_length=200)
    # Con uno vigente, por defecto se devuelve ese (todos ven el mismo QR); «nuevo» lo cierra y abre otro de 20 minutos.
    nuevo: bool = False


@router.post("/grupos/{grupo_id}/registro-rapido")
async def habilitar(grupo_id: str, payload: Habilitar, request: Request, user: CurrentUser = Depends(require_ver),
                    db: AsyncSession = Depends(get_db)) -> dict:
    g, roles = await _grupo(db, grupo_id, user)
    _exigir_equipo(g, roles)
    if g.estado != "en_curso":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El grupo no está en curso")
    origen = _origen(payload.origen)
    ahora = srv.ahora()
    vigentes = [r for r in (await db.execute(select(CapRegistroRapido).where(
        CapRegistroRapido.grupo_id == g.id, CapRegistroRapido.cerrado_at.is_(None)))).scalars().all() if estado(r) == "vigente"]
    # Solo se reutiliza uno cuyo QR se pueda volver a mostrar.
    mostrables = [r for r in vigentes if seg.descifrar(r.token_enc)]
    if mostrables and not payload.nuevo:
        actual = max(mostrables, key=lambda r: srv.utc(r.created_at) or ahora)
        return {"link": await _dict(db, actual), "minutos": settings.capacitacion_registro_minutos, "puede": True}
    for r in vigentes:
        r.cerrado_at, r.cerrado_por, r.token_enc = ahora, user.id, None
    token = secrets.token_urlsafe(32)
    r = CapRegistroRapido(grupo_id=g.id, token_hash=_hash(token), token_enc=seg.cifrar(token), origen=origen,
                          vence_at=ahora + timedelta(minutes=settings.capacitacion_registro_minutos),
                          max_usos=settings.capacitacion_registro_max, creado_por=user.id, created_at=ahora)
    db.add(r)
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_registro_rapido", resource_type="cap_grupo", resource_id=g.id,
                        ip=client_ip(request), extra={"link": r.id, "minutos": settings.capacitacion_registro_minutos,
                                                      "cerro_anteriores": len(vigentes)})
    return {"link": await _dict(db, r, token), "minutos": settings.capacitacion_registro_minutos, "puede": True}


@router.post("/grupos/{grupo_id}/registro-rapido/cerrar")
async def cerrar(grupo_id: str, request: Request, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """Cierra el link antes de que venza (por ejemplo, cuando ya se registraron todos los de la sala)."""
    g, roles = await _grupo(db, grupo_id, user)
    _exigir_equipo(g, roles)
    abiertos = (await db.execute(select(CapRegistroRapido).where(
        CapRegistroRapido.grupo_id == g.id, CapRegistroRapido.cerrado_at.is_(None)))).scalars().all()
    for r in abiertos:
        r.cerrado_at, r.cerrado_por, r.token_enc = srv.ahora(), user.id, None
    await db.commit()
    if abiertos:
        await record_action(db, user_id=user.id, action="capacitacion_registro_rapido_cerrado", resource_type="cap_grupo",
                            resource_id=g.id, ip=client_ip(request), extra={"links": [r.id for r in abiertos]})
    r = await _ultimo(db, g.id)
    return {"link": await _dict(db, r) if r else None, "minutos": settings.capacitacion_registro_minutos, "puede": g.estado == "en_curso"}


# ================================================================== el postulante (sin usuario)
_MOTIVOS = {
    "vencido": "Este link venció (dura {minutos} minutos). Pedile a tu capacitador que habilite uno nuevo.",
    "cerrado": "Este link ya se cerró. Pedile a tu capacitador que habilite uno nuevo.",
    "agotado": "Este link ya no admite más registros. Pedile a tu capacitador que habilite uno nuevo.",
    "grupo": "Este grupo ya no recibe postulantes.",
}


def _rechazo(motivo: str) -> HTTPException:
    return HTTPException(status.HTTP_410_GONE, {"code": f"link_{motivo}",
                                                "message": _MOTIVOS[motivo].format(minutos=settings.capacitacion_registro_minutos)})


async def _vigente(db: AsyncSession, token: str, request: Request, *, bloquear: bool = False) -> tuple[CapRegistroRapido, CapGrupo]:
    ip = client_ip(request) or "-"
    if rate_limit.is_blocked(ip, _CLAVE_RL):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Demasiados intentos. Probá de nuevo en unos minutos.")
    r = None
    if 20 <= len(token) <= 100:
        q = select(CapRegistroRapido).where(CapRegistroRapido.token_hash == _hash(token))
        r = (await db.execute(q.with_for_update() if bloquear else q)).scalar_one_or_none()
    if r is None:
        rate_limit.register_failure(ip, _CLAVE_RL)
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"code": "link_invalido",
                                                        "message": "Este link no es válido. Pedile uno nuevo a tu capacitador."})
    est = estado(r)
    if est != "vigente":
        raise _rechazo(est)
    g = await db.get(CapGrupo, r.grupo_id)
    if not g or g.estado != "en_curso":
        raise _rechazo("grupo")
    return r, g


@publico.get("/{token}")
async def ver_link(token: str, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Lo que ve quien abre el link: a qué grupo se suma y cuánto le queda al link. Nada más del grupo."""
    r, g = await _vigente(db, token, request)
    return {"grupo": g.nombre, "vence_at": srv.iso(r.vence_at),
            "segundos": max(0, int((srv.utc(r.vence_at) - srv.ahora()).total_seconds()))}


class Alta(PostulanteDatos):
    # Campo trampa: invisible para las personas; si viene con algo, lo completó un programa.
    sitio: Optional[str] = Field(None, max_length=200)


@publico.post("/{token}", status_code=status.HTTP_201_CREATED)
async def registrarse(token: str, payload: Alta, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Crea al postulante en el grupo con su link personal y devuelve ese link para llevarlo a su perfil."""
    ip, ua = client_ip(request), request.headers.get("user-agent")
    r, g = await _vigente(db, token, request, bloquear=True)
    if payload.sitio:
        rate_limit.register_failure(ip or "-", _CLAVE_RL)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No se pudo completar el registro.")
    try:
        await _ci_libre(db, g.id, payload.ci)
    except HTTPException as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "ci_registrada", "message": (
            "Ya hay alguien con esa cédula en el grupo. Si ya te registraste, pedile tu link a tu capacitador.")}) from exc
    # El cupo se descuenta de forma atómica: aunque se registren muchos a la vez, no se pasa del tope.
    res = await db.execute(update(CapRegistroRapido).where(CapRegistroRapido.id == r.id, CapRegistroRapido.usos < CapRegistroRapido.max_usos,
                                                           CapRegistroRapido.cerrado_at.is_(None)).values(usos=CapRegistroRapido.usos + 1))
    if res.rowcount != 1:
        await db.rollback()
        raise _rechazo("agotado")
    ahora = srv.ahora()
    p = CapPostulante(grupo_id=g.id, nombre=payload.nombre, apellido=payload.apellido, ci=payload.ci, edad=payload.edad,
                      sexo=payload.sexo, estado="en_capacitacion", etapa_max=0, estado_at=ahora, estado_por=None,
                      pruebas={}, created_by=r.creado_por, registro_id=r.id)
    db.add(p)
    await db.flush()
    personal = secrets.token_urlsafe(32)
    db.add(CapEnlace(postulante_id=p.id, token_hash=_hash(personal), token_enc=seg.cifrar(personal), origen=r.origen, activo=True,
                     vence_at=ahora + timedelta(days=DIAS_LINK), respuestas={}, ipv_estado="pendiente", created_by=r.creado_por))
    quien = (await srv.nombres(db, [r.creado_por])).get(r.creado_por)
    srv.evento(db, grupo_id=g.id, postulante_id=p.id, tipo="alta", por=None, a="en_capacitacion", registro=r.id,
               motivo=f"Se registró con el link rápido{f' de {quien}' if quien else ''}")
    await db.commit()
    await record_action(db, user_id=None, action="capacitacion_postulante_autoregistro", resource_type="cap_postulante",
                        resource_id=p.id, ip=ip, user_agent=ua, extra={"grupo": g.id, "registro": r.id})
    return {"nombre": p.nombre, "sexo": p.sexo, "grupo": g.nombre, "token": personal, "ruta": f"/postulante/{personal}"}
