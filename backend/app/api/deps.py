"""Dependencias FastAPI de autenticación y autorización.

El superadmin vive SIEMPRE en `.env` (nunca en DB).
Analistas y lectores viven en la DB.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.database import get_db
from ..core.security import decode_token
from ..models.user import User


bearer = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    id: str
    email: str
    role: str
    full_name: str
    photo_url: Optional[str] = None
    # Solo aplica a lectores. None = acceso a todos los módulos.
    allowed_modules: Optional[list[str]] = None

    @property
    def is_superadmin(self) -> bool:
        return self.role == "superadmin"

    @property
    def is_analyst(self) -> bool:
        return self.role == "analyst"

    @property
    def is_viewer(self) -> bool:
        return self.role == "viewer"

    @property
    def can_manage(self) -> bool:
        """Cargar datos, publicar, eliminar."""
        return self.role in ("superadmin", "analyst")

    def has_module(self, slug: str) -> bool:
        if self.role in ("superadmin", "analyst"):
            return True
        if self.allowed_modules is None:
            return True
        return slug in self.allowed_modules


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

    # Superadmin sintético (no está en DB)
    if subject == settings.superadmin_email and role == "superadmin":
        return CurrentUser(
            id="superadmin",
            email=settings.superadmin_email,
            role="superadmin",
            full_name=settings.superadmin_name,
        )

    result = await db.execute(select(User).where(User.email == subject))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario inválido o inactivo")

    return CurrentUser(
        id=user.id,
        email=user.email,
        role=user.role,
        full_name=user.full_name,
        photo_url=user.photo_url,
        allowed_modules=user.allowed_modules,
    )


async def require_superadmin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Se requiere rol superadmin")
    return user


async def require_manager(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Para carga / publicación / eliminación: superadmin o analista."""
    if not user.can_manage:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requiere rol analista o superadmin")
    return user


def require_module(slug: str):
    """Factory: exige acceso al módulo `slug`. Uso: Depends(require_module("tablero"))."""

    async def _dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not user.has_module(slug):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenés acceso a este módulo")
        return user

    return _dep


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
