"""Seguridad de acceso: pantalla del superadmin (políticas, horarios, sesiones, bloqueos, excepciones, 2FA)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from ...core.database import get_db
from ...models.seguridad import SecuritySettings, UserSession
from ...models.user import User
from ...services import seguridad as seg
from ...services import sesiones
from ...services.audit_service import record_action
from ..deps import CurrentUser, client_ip, require_superadmin

router = APIRouter(prefix="/seguridad", tags=["seguridad"])


def _utc(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=timezone.utc) if d is not None and d.tzinfo is None else d


def _iso(d: datetime | None) -> str | None:
    d = _utc(d)
    return d.isoformat() if d else None


async def _usuario(db: AsyncSession, uid: str) -> User:
    u = await db.get(User, uid)
    if not u:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")
    return u


# ------------------------------------------------------------------ políticas y horarios
class ConfigPayload(BaseModel):
    config: dict[str, Any]


@router.get("/config")
async def ver_config(user: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    cfg = await seg.config(db)
    fila = await db.get(SecuritySettings, 1)
    ahora = datetime.now(timezone.utc)
    return {
        "config": cfg,
        "perfiles": seg.PERFILES_CON_HORARIO,
        "dias": seg.DIAS,
        "modos": seg.MODOS_HORARIO,
        "ahora": {p: seg.evaluar_horario({**cfg, "horarios": {**cfg["horarios"], "modo": "bloquear"}}, p, ahora) for p in seg.PERFILES_CON_HORARIO},
        "superadmin_2fa": bool(fila and fila.superadmin_totp_enabled),
        "actualizado": {"en": _iso(fila.updated_at) if fila else None, "por": fila.updated_by if fila else None},
    }


@router.put("/config")
async def guardar_config(payload: ConfigPayload, request: Request, user: CurrentUser = Depends(require_superadmin),
                         db: AsyncSession = Depends(get_db)) -> dict:
    try:
        cfg = seg.validar_config(payload.config)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    fila = await seg.cargar_fila(db)
    anterior = fila.data or {}
    fila.data, fila.updated_at, fila.updated_by = cfg, datetime.now(timezone.utc), user.id
    await db.commit()
    cambios = sorted(k for k in cfg if cfg.get(k) != seg._merge(seg._defaults(), anterior).get(k))
    await record_action(db, user_id=user.id, action="seguridad_config", resource_type="seguridad", ip=client_ip(request),
                        extra={"secciones": cambios, "modo_horario": cfg["horarios"]["modo"]})
    return await ver_config(user, db)


# ------------------------------------------------------------------ sesiones
def _sesion_dict(s: UserSession, nombres: dict[str, str], actual: str | None) -> dict:
    ahora = datetime.now(timezone.utc)
    return {
        "id": s.id, "user_id": s.user_id, "email": s.email, "nombre": nombres.get(s.user_id, s.email), "role": s.role,
        "ip": s.ip, "user_agent": s.user_agent, "segundo_factor": s.mfa,
        "inicio": _iso(s.created_at), "ultima_actividad": _iso(s.last_seen_at), "vence": _iso(s.expires_at),
        "inactiva_minutos": int((ahora - _utc(s.last_seen_at)).total_seconds() // 60),
        "fin": _iso(s.ended_at), "motivo_fin": s.end_reason, "es_la_mia": s.id == actual,
    }


async def _nombres(db: AsyncSession) -> dict[str, str]:
    rows = (await db.execute(select(User.id, User.full_name))).all()
    return {"superadmin": settings.superadmin_name, **{r[0]: r[1] for r in rows}}


@router.get("/sesiones")
async def sesiones_activas(user: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    cfg = await seg.config(db)
    nombres = await _nombres(db)
    activas = await sesiones.activas(db)
    idle = cfg["sesion"]["inactividad_minutos"]
    ahora = datetime.now(timezone.utc)
    vigentes = [s for s in activas if (ahora - _utc(s.last_seen_at)).total_seconds() <= idle * 60]  # las inactivas se cierran al próximo uso
    recientes = (await db.execute(select(UserSession).where(UserSession.ended_at.is_not(None))
                                  .order_by(UserSession.ended_at.desc()).limit(50))).scalars().all()
    return {
        "activas": [_sesion_dict(s, nombres, user.session_id) for s in vigentes],
        "recientes": [_sesion_dict(s, nombres, user.session_id) for s in recientes],
        "inactividad_minutos": idle,
    }


@router.post("/sesiones/{sid}/cerrar")
async def cerrar_sesion(sid: str, request: Request, user: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    s = await db.get(UserSession, sid)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sesión no encontrada")
    if s.id == user.session_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esa es tu sesión actual: usá Salir.")
    sesiones.cerrar(s, "cerrada", user.id)
    await db.commit()
    await record_action(db, user_id=user.id, action="sesion_cerrada", resource_type="sesion", resource_id=sid,
                        ip=client_ip(request), extra={"usuario": s.email})
    return {"cerradas": 1}


@router.post("/usuarios/{uid}/cerrar-sesiones")
async def cerrar_sesiones_usuario(uid: str, request: Request, user: CurrentUser = Depends(require_superadmin),
                                  db: AsyncSession = Depends(get_db)) -> dict:
    n = await sesiones.cerrar_de_usuario(db, uid, "cerrada", user.id, excepto=user.session_id)
    await db.commit()
    await record_action(db, user_id=user.id, action="sesiones_usuario_cerradas", resource_type="user", resource_id=uid,
                        ip=client_ip(request), extra={"cerradas": n})
    return {"cerradas": n}


@router.post("/sesiones/cerrar-todas")
async def cerrar_todas(request: Request, user: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    """Cierra todas las sesiones abiertas menos la tuya (p. ej. ante un incidente)."""
    n = await sesiones.cerrar_de_usuario(db, None, "cerrada", user.id, excepto=user.session_id)
    await db.commit()
    await record_action(db, user_id=user.id, action="sesiones_todas_cerradas", resource_type="seguridad",
                        ip=client_ip(request), extra={"cerradas": n})
    return {"cerradas": n}


# ------------------------------------------------------------------ estado por usuario
@router.get("/usuarios")
async def estado_usuarios(user: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> list[dict]:
    cfg = await seg.config(db)
    ahora = datetime.now(timezone.utc)
    conteo = dict((await db.execute(select(UserSession.user_id, func.count()).where(
        UserSession.ended_at.is_(None), UserSession.expires_at > ahora).group_by(UserSession.user_id))).all())
    dias = cfg["contrasenas"]["vencimiento_dias"]
    out = []
    for u in (await db.execute(select(User).order_by(User.full_name))).scalars().all():
        cambiada = _utc(u.password_changed_at)
        bloqueado = _utc(u.locked_until) if u.locked_until and _utc(u.locked_until) > ahora else None
        exc = _utc(u.access_exception_until) if u.access_exception_until and _utc(u.access_exception_until) > ahora else None
        out.append({
            "id": u.id, "email": u.email, "nombre": u.full_name, "role": u.role, "activo": u.is_active,
            "ultimo_ingreso": _iso(u.last_login_at), "sesiones_activas": conteo.get(u.id, 0),
            "bloqueado_hasta": _iso(bloqueado), "bloqueo_manual": bool(bloqueado and bloqueado.year >= 2100),
            "intentos_fallidos": u.failed_attempts or 0,
            "dos_factores": bool(u.totp_enabled),
            "contrasena_cambiada": _iso(cambiada),
            "contrasena_vence": _iso(cambiada + timedelta(days=dias)) if (cambiada and dias) else None,
            "contrasena_vencida": seg.contrasena_vencida(cfg, cambiada, ahora),
            "cambio_pendiente": bool(u.must_change_password),
            "excepcion_hasta": _iso(exc), "excepcion_nota": u.access_exception_note if exc else None,
            "horario_ahora": seg.evaluar_horario({**cfg, "horarios": {**cfg["horarios"], "modo": "bloquear"}}, u.role, ahora, exc)["permitido"],
        })
    return out


@router.post("/usuarios/{uid}/desbloquear")
async def desbloquear(uid: str, request: Request, user: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    u = await _usuario(db, uid)
    u.locked_until, u.failed_attempts = None, 0
    await db.commit()
    await record_action(db, user_id=user.id, action="usuario_desbloqueado", resource_type="user", resource_id=uid, ip=client_ip(request))
    return {"status": "ok"}


@router.post("/usuarios/{uid}/reset-2fa")
async def reset_2fa(uid: str, request: Request, user: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    """Para quien perdió el teléfono: le quita el segundo factor (puede volver a activarlo)."""
    u = await _usuario(db, uid)
    u.totp_enabled, u.totp_secret_enc, u.totp_recovery = False, None, None
    await sesiones.cerrar_de_usuario(db, uid, "cerrada", user.id)
    await db.commit()
    await record_action(db, user_id=user.id, action="2fa_reiniciado", resource_type="user", resource_id=uid, ip=client_ip(request))
    return {"status": "ok"}


@router.post("/usuarios/{uid}/forzar-cambio")
async def forzar_cambio(uid: str, request: Request, user: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    u = await _usuario(db, uid)
    u.must_change_password = True
    await db.commit()
    await record_action(db, user_id=user.id, action="forzar_cambio_contrasena", resource_type="user", resource_id=uid, ip=client_ip(request))
    return {"status": "ok"}


class ExcepcionPayload(BaseModel):
    hasta: datetime
    nota: Optional[str] = Field(default=None, max_length=300)


@router.put("/usuarios/{uid}/excepcion")
async def dar_excepcion(uid: str, payload: ExcepcionPayload, request: Request, user: CurrentUser = Depends(require_superadmin),
                        db: AsyncSession = Depends(get_db)) -> dict:
    """Acceso fuera de horario hasta una fecha y hora (p. ej. cierre de mes). Vence sola."""
    hasta = _utc(payload.hasta)
    ahora = datetime.now(timezone.utc)
    if hasta <= ahora:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La excepción tiene que vencer en el futuro.")
    if (hasta - ahora).days > 31:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Una excepción dura como máximo 31 días: si es permanente, cambiá el horario del perfil.")
    u = await _usuario(db, uid)
    u.access_exception_until, u.access_exception_note = hasta, (payload.nota or "").strip() or None
    await db.commit()
    await record_action(db, user_id=user.id, action="excepcion_horario", resource_type="user", resource_id=uid,
                        ip=client_ip(request), extra={"hasta": hasta.isoformat(), "nota": u.access_exception_note})
    return {"status": "ok"}


@router.delete("/usuarios/{uid}/excepcion")
async def quitar_excepcion(uid: str, request: Request, user: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    u = await _usuario(db, uid)
    u.access_exception_until, u.access_exception_note = None, None
    await db.commit()
    await record_action(db, user_id=user.id, action="excepcion_horario_quitada", resource_type="user", resource_id=uid, ip=client_ip(request))
    return {"status": "ok"}
