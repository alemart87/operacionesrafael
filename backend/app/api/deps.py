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
from ..core.operativas import ALL_PERMISSIONS, OPERATIVA_SLUGS, OPERATIVAS, UTILIDAD_VER
from ..core.security import decode_token
from ..models.profile import Profile
from ..models.user import User


bearer = HTTPBearer(auto_error=False)


def effective_permissions(role_perms: list[str] | None, operativas: list[str] | None) -> set[str]:
    """Permisos del perfil acotados a las operativas asignadas y con acceso `ver`."""
    assigned = set(operativas or [])
    perms = {p for p in (role_perms or []) if p in ALL_PERMISSIONS and p.split(".", 1)[0] in assigned}
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


async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Falta token de autenticación")

    try:
        payload = decode_token(creds.credentials)
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido o expirado") from exc

    if payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token no es de tipo access")

    subject = payload.get("sub")
    role = payload.get("role")

    # Superadmin sintético (no está en DB): todas las operativas y permisos.
    if subject == settings.superadmin_email and role == "superadmin":
        return CurrentUser(
            id="superadmin",
            email=settings.superadmin_email,
            role="superadmin",
            full_name=settings.superadmin_name,
            operativas=sorted(OPERATIVA_SLUGS),
            permissions=set(ALL_PERMISSIONS),
        )

    result = await db.execute(select(User).where(User.email == subject))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario inválido o inactivo")

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
    )


async def require_superadmin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Se requiere rol superadmin")
    return user


def require_perm(perm: str):
    """Factory: exige un permiso. Uso: Depends(require_perm("televentas_claro.cargar"))."""
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
