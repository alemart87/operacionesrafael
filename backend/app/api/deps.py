"""Dependencias FastAPI de autenticación y autorización.

Modelo de acceso:
- El superadmin vive en `.env` (nunca en DB) y tiene TODOS los permisos.
- Cada usuario tiene un PERFIL (coordinador, supervisor, analista, cliente) y
  una lista de OPERATIVAS asignadas.
- Los permisos del perfil los define el superadmin (tabla `profiles`).
- Permiso efectivo = el perfil lo tiene Y la operativa está asignada al usuario
  Y el perfil tiene el acceso `<operativa>.ver`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.database import get_db
from ..core.operativas import ALL_PERMISSIONS, ASSIGNABLE_PERMISSIONS, OPERATIVA_SLUGS, OPERATIVAS, UTILIDAD_VER
from ..core.security import decode_token
from ..models.profile import Profile
from ..models.user import User
from ..services import seguridad as seg
from ..services import sesiones
from ..services.audit_service import record_action


bearer = HTTPBearer(auto_error=False)


def effective_permissions(role_perms: list[str] | None, operativas: list[str] | None) -> set[str]:
    """Permisos del perfil acotados a las operativas asignadas y con acceso `ver`.
    Los permisos exclusivos del superadmin se descartan aunque figuren en la DB."""
    assigned = set(operativas or [])
    perms = {p for p in (role_perms or []) if p in ASSIGNABLE_PERMISSIONS and p.split(".", 1)[0] in assigned}
    with_access = {p.split(".", 1)[0] for p in perms if p.endswith(f".{UTILIDAD_VER}")}
    return {p for p in perms if p.split(".", 1)[0] in with_access}


@dataclass
class CurrentUser:
    id: str
    email: str
    role: str
    full_name: str
    photo_url: Optional[str] = None
    operativas: list[str] = field(default_factory=list)
    permissions: set[str] = field(default_factory=set)
    session_id: Optional[str] = None
    # Fin del horario habilitado (UTC) si el perfil tiene franjas; el front avisa antes del cierre.
    acceso_hasta: Optional[object] = None

    @property
    def is_superadmin(self) -> bool:
        return self.role == "superadmin"

    def has_perm(self, perm: str) -> bool:
        return self.is_superadmin or perm in self.permissions

    def can_access(self, operativa: str) -> bool:
        return self.has_perm(f"{operativa}.{UTILIDAD_VER}")

    @property
    def visible_operativas(self) -> list[str]:
        return [o["slug"] for o in OPERATIVAS if self.can_access(o["slug"])]


async def load_role_permissions(db: AsyncSession, role: str) -> list[str]:
    row = await db.get(Profile, role)
    return list(row.permissions or []) if row else []


# Rutas que se pueden usar con la contraseña vencida o pendiente de cambio.
RUTAS_CAMBIO_CONTRASENA = {"/api/v1/auth/me", "/api/v1/auth/change-password", "/api/v1/auth/logout", "/api/v1/auth/politica"}


async def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """Valida token, sesión, usuario, horario y contraseña en CADA pedido.

    Así el superadmin puede cerrar sesiones a distancia, la inactividad y el
    vencimiento cortan solos y el horario corta también a quien ya estaba adentro.
    """
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Falta token de autenticación")

    try:
        payload = decode_token(creds.credentials)
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido o expirado") from exc

    if payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token no es de tipo access")

    cfg = await seg.config(db)
    try:
        sesion = await sesiones.validar(db, cfg, payload.get("sid"))
    except sesiones.SesionInvalida as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, exc.detail()) from exc

    subject = payload.get("sub")
    role = payload.get("role")
    if sesion.email != subject:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, sesiones.SesionInvalida("invalida").detail())

    # Superadmin sintético (no está en DB): todas las operativas y permisos, sin horario.
    if subject == settings.superadmin_email and role == "superadmin":
        await sesiones.marcar_actividad(db, sesion)
        return CurrentUser(
            id="superadmin",
            email=settings.superadmin_email,
            role="superadmin",
            full_name=settings.superadmin_name,
            operativas=sorted(OPERATIVA_SLUGS),
            permissions=set(ALL_PERMISSIONS),
            session_id=sesion.id,
        )

    result = await db.execute(select(User).where(User.email == subject))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        sesiones.cerrar(sesion, "usuario_inactivo")
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, sesiones.SesionInvalida("usuario_inactivo").detail())

    # Horario de acceso del perfil (con excepción vigente del superadmin).
    from datetime import datetime, timezone
    ahora = datetime.now(timezone.utc)
    exc_hasta = user.access_exception_until
    if exc_hasta and exc_hasta.tzinfo is None:
        exc_hasta = exc_hasta.replace(tzinfo=timezone.utc)
    h = seg.evaluar_horario(cfg, user.role, ahora, exc_hasta)
    if not h["permitido"]:
        if cfg["horarios"]["modo"] == "bloquear":
            sesiones.cerrar(sesion, "horario")
            await db.commit()
            await record_action(db, user_id=user.id, action="acceso_fuera_de_horario", resource_type="auth",
                                ip=client_ip(request), extra={"bloqueado": True, "motivo": h["motivo"], "ruta": request.url.path})
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, sesiones.SesionInvalida(
                "horario", f"Horario de tu perfil: {seg.texto_horario(cfg, user.role)}.").detail())
        if not sesion.fuera_horario_registrado:  # modo "registrar": se deja pasar y queda anotado una vez por sesión
            sesion.fuera_horario_registrado = True
            await db.commit()
            await record_action(db, user_id=user.id, action="acceso_fuera_de_horario", resource_type="auth",
                                ip=client_ip(request), extra={"bloqueado": False, "motivo": h["motivo"], "ruta": request.url.path})

    # Contraseña pendiente de cambio o vencida: solo puede cambiarla.
    if (user.must_change_password or seg.contrasena_vencida(cfg, user.password_changed_at, ahora)) \
            and request.url.path not in RUTAS_CAMBIO_CONTRASENA:
        raise HTTPException(status.HTTP_403_FORBIDDEN, {
            "code": "cambio_contrasena",
            "message": "Tenés que cambiar tu contraseña antes de seguir." if user.must_change_password
            else "Tu contraseña venció: elegí una nueva para seguir.",
        })

    await sesiones.marcar_actividad(db, sesion)

    # El perfil se lee de la DB en cada request: si el superadmin cambia el
    # perfil o los permisos, se aplica sin que el usuario vuelva a loguearse.
    role_perms = await load_role_permissions(db, user.role)
    return CurrentUser(
        id=user.id,
        email=user.email,
        role=user.role,
        full_name=user.full_name,
        photo_url=user.photo_url,
        operativas=list(user.operativas or []),
        permissions=effective_permissions(role_perms, user.operativas),
        session_id=sesion.id,
        acceso_hasta=h["hasta"],
    )


async def require_superadmin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Se requiere rol superadmin")
    return user


def require_perm(perm: str):
    """Factory: exige un permiso. Uso: Depends(require_perm("televentas_claro.ventas_netas"))."""
    if perm not in ALL_PERMISSIONS:
        raise ValueError(f"Permiso desconocido: {perm}")  # falla al importar, no en runtime

    async def _dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not user.has_perm(perm):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenés permiso para esta acción")
        return user

    return _dep


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
