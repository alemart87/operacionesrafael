"""Sesiones controladas por el servidor: abrir, validar en cada pedido y cerrar (a distancia o solas)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.seguridad import UserSession

MENSAJES = {
    "cerrada": "Tu sesión fue cerrada por el administrador.",
    "inactividad": "Tu sesión se cerró por inactividad.",
    "vencida": "Tu sesión llegó a su duración máxima. Ingresá de nuevo.",
    "horario": "Estás fuera del horario de acceso de tu perfil.",
    "logout": "Cerraste la sesión.",
    "invalida": "Tu sesión ya no es válida. Ingresá de nuevo.",
    "usuario_inactivo": "Tu usuario fue desactivado.",
}


class SesionInvalida(Exception):
    def __init__(self, motivo: str, extra: str | None = None):
        self.motivo = motivo
        self.mensaje = MENSAJES.get(motivo, MENSAJES["invalida"]) + (f" {extra}" if extra else "")
        super().__init__(self.mensaje)

    def detail(self) -> dict[str, str]:
        return {"code": f"sesion_{self.motivo}", "message": self.mensaje}


def _utc(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


async def abrir(db: AsyncSession, cfg: dict[str, Any], *, user_id: str, email: str, role: str,
                ip: str | None, user_agent: str | None, mfa: bool) -> UserSession:
    ahora = datetime.now(timezone.utc)
    s = UserSession(user_id=user_id, email=email, role=role, ip=ip, user_agent=(user_agent or "")[:400], mfa=mfa,
                    created_at=ahora, last_seen_at=ahora,
                    expires_at=ahora + timedelta(hours=cfg["sesion"]["duracion_max_horas"]))
    db.add(s)
    await db.flush()
    return s


def cerrar(s: UserSession, motivo: str, por: str | None = None) -> None:
    if s.ended_at is None:
        s.ended_at, s.end_reason, s.ended_by = datetime.now(timezone.utc), motivo, por


async def cerrar_de_usuario(db: AsyncSession, user_id: str | None, motivo: str, por: str | None, excepto: str | None = None) -> int:
    """Cierra las sesiones abiertas de un usuario (o de todos si user_id es None). Devuelve cuántas."""
    q = update(UserSession).where(UserSession.ended_at.is_(None))
    if user_id is not None:
        q = q.where(UserSession.user_id == user_id)
    if excepto:
        q = q.where(UserSession.id != excepto)
    r = await db.execute(q.values(ended_at=datetime.now(timezone.utc), end_reason=motivo, ended_by=por))
    return r.rowcount or 0


async def validar(db: AsyncSession, cfg: dict[str, Any], sid: str | None) -> UserSession:
    """Sesión vigente o SesionInvalida. Cierra sola la vencida o la inactiva."""
    if not sid:
        raise SesionInvalida("invalida")
    s = await db.get(UserSession, sid)
    if s is None:
        raise SesionInvalida("invalida")
    if s.ended_at is not None:
        raise SesionInvalida(s.end_reason if s.end_reason in MENSAJES else "invalida")
    ahora = datetime.now(timezone.utc)
    if ahora >= _utc(s.expires_at):
        cerrar(s, "vencida")
        await db.commit()
        raise SesionInvalida("vencida")
    if ahora - _utc(s.last_seen_at) > timedelta(minutes=cfg["sesion"]["inactividad_minutos"]):
        cerrar(s, "inactividad")
        await db.commit()
        raise SesionInvalida("inactividad", f"({cfg['sesion']['inactividad_minutos']} minutos sin uso)")
    return s


async def marcar_actividad(db: AsyncSession, s: UserSession) -> None:
    """Actualiza la última actividad (como mucho una vez cada 30 s, para no escribir en cada pedido)."""
    ahora = datetime.now(timezone.utc)
    if ahora - _utc(s.last_seen_at) > timedelta(seconds=30):
        s.last_seen_at = ahora
        await db.commit()


async def activas(db: AsyncSession, user_id: str | None = None) -> list[UserSession]:
    q = select(UserSession).where(UserSession.ended_at.is_(None), UserSession.expires_at > datetime.now(timezone.utc))
    if user_id:
        q = q.where(UserSession.user_id == user_id)
    return list((await db.execute(q.order_by(UserSession.last_seen_at.desc()))).scalars().all())
