"""Auth: login, refresh, perfil propio y cambio de contraseña."""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import rate_limit
from ...core.config import settings
from ...core.operativas import OPERATIVA_SLUGS
from ...core.database import get_db
from ...core.perfiles import perfil_name
from ...core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from ...models.user import User
from ...schemas.auth import LoginRequest, TokenPair, TokenRefresh
from ...services.audit_service import record_action
from ..deps import CurrentUser, client_ip, get_current_user


router = APIRouter(prefix="/auth", tags=["auth"])

SUPERADMIN_SELF_MSG = (
    "El superadmin gestiona sus credenciales y perfil desde la configuración del "
    "servidor (.env). No se editan desde la aplicación."
)

ALLOWED_PHOTO_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class ProfileUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)


def _user_payload(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "full_name": u.full_name,
        "role": u.role,
        "photo_url": u.photo_url,
        "operativas": list(u.operativas or []),
    }


async def _current_db_user(user: CurrentUser, db: AsyncSession) -> User:
    """Devuelve el User (DB) del usuario autenticado, o 400 si es superadmin."""
    if user.is_superadmin:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, SUPERADMIN_SELF_MSG)
    target = await db.get(User, user.id)
    if not target or not target.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario inválido o inactivo")
    return target


def _superadmin_password_ok(password: str) -> bool:
    if settings.superadmin_password:
        return secrets.compare_digest(password.encode(), settings.superadmin_password.encode())
    if settings.superadmin_password_hash:
        return verify_password(password, settings.superadmin_password_hash)
    return False


@router.post("/login", response_model=TokenPair)
async def login(
    payload: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> TokenPair:
    email = payload.email.lower().strip()
    ip = client_ip(request)
    ua = request.headers.get("user-agent")

    if rate_limit.is_blocked(ip, email):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Demasiados intentos fallidos. Probá de nuevo en {settings.login_window_minutes} minutos.",
        )

    # Caso 1: superadmin desde .env
    if email == settings.superadmin_email.lower().strip():
        if not _superadmin_password_ok(payload.password):
            rate_limit.register_failure(ip, email)
            await record_action(db, user_id=None, action="login_failed", resource_type="auth",
                                ip=ip, user_agent=ua, extra={"email": email})
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciales inválidas")
        rate_limit.reset(ip, email)
        await record_action(db, user_id="superadmin", action="login", resource_type="auth",
                            ip=ip, user_agent=ua)
        return TokenPair(
            access_token=create_access_token(email, "superadmin"),
            refresh_token=create_refresh_token(email),
            user_email=email,
            user_role="superadmin",
            user_name=settings.superadmin_name,
            user_operativas=sorted(OPERATIVA_SLUGS),
        )

    # Caso 2: usuario en DB (coordinador, supervisor, analista o cliente)
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not user.is_active or not verify_password(payload.password, user.hashed_password):
        rate_limit.register_failure(ip, email)
        await record_action(db, user_id=None, action="login_failed", resource_type="auth",
                            ip=ip, user_agent=ua, extra={"email": email})
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciales inválidas")

    rate_limit.reset(ip, email)
    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    await record_action(db, user_id=user.id, action="login", resource_type="auth",
                        ip=ip, user_agent=ua, extra={"role": user.role})
    return TokenPair(
        access_token=create_access_token(user.email, user.role),
        refresh_token=create_refresh_token(user.email),
        user_email=user.email,
        user_role=user.role,
        user_name=user.full_name,
        user_photo_url=user.photo_url,
        user_operativas=list(user.operativas or []),
    )


@router.post("/refresh", response_model=TokenPair)
async def refresh_token(
    payload: TokenRefresh,
    db: AsyncSession = Depends(get_db),
) -> TokenPair:
    try:
        data = decode_token(payload.refresh_token)
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token inválido o expirado") from exc

    if data.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token no es refresh")

    email = data.get("sub")

    if email == settings.superadmin_email:
        return TokenPair(
            access_token=create_access_token(email, "superadmin"),
            refresh_token=create_refresh_token(email),
            user_email=email,
            user_role="superadmin",
            user_name=settings.superadmin_name,
            user_operativas=sorted(OPERATIVA_SLUGS),
        )

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario inválido")

    return TokenPair(
        access_token=create_access_token(user.email, user.role),
        refresh_token=create_refresh_token(user.email),
        user_email=user.email,
        user_role=user.role,
        user_name=user.full_name,
        user_photo_url=user.photo_url,
        user_operativas=list(user.operativas or []),
    )


@router.get("/me")
async def me(user: CurrentUser = Depends(get_current_user)) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "photo_url": user.photo_url,
        "role_name": perfil_name(user.role),
        # Operativas asignadas (superadmin: todas) y las que efectivamente puede abrir.
        "operativas": user.operativas,
        "visible_operativas": user.visible_operativas,
        # Permisos efectivos "<operativa>.<utilidad>". El front los usa para
        # mostrar u ocultar utilidades; el backend los valida igual en cada endpoint.
        "permissions": sorted(user.permissions),
        # El superadmin no puede autoeditar perfil/contraseña (vive en .env).
        "can_edit_profile": not user.is_superadmin,
    }


@router.patch("/me")
async def update_my_profile(
    payload: ProfileUpdate,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    target = await _current_db_user(user, db)
    target.full_name = payload.full_name.strip()
    await db.commit()
    await db.refresh(target)
    await record_action(db, user_id=user.id, action="update_own_profile", resource_type="user",
                        resource_id=target.id, ip=client_ip(request))
    return _user_payload(target)


@router.post("/change-password")
async def change_my_password(
    payload: ChangePasswordRequest,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    target = await _current_db_user(user, db)
    if not verify_password(payload.current_password, target.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La contraseña actual es incorrecta")
    if verify_password(payload.new_password, target.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La nueva contraseña debe ser distinta de la actual")
    target.hashed_password = hash_password(payload.new_password)
    await db.commit()
    await record_action(db, user_id=user.id, action="change_own_password", resource_type="user",
                        resource_id=target.id, ip=client_ip(request))
    return {"status": "ok"}


async def save_user_photo(target: User, file: UploadFile) -> None:
    """Valida y guarda la foto en el disco persistente; setea `photo_url`."""
    ext = ALLOWED_PHOTO_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Solo PNG, JPEG o WEBP")
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Máximo 5 MB")
    photos_dir = settings.upload_path / "photos"
    photos_dir.mkdir(parents=True, exist_ok=True)
    sha = hashlib.sha256(content).hexdigest()[:16]
    fname = f"{target.id}_{sha}.{ext}"
    (photos_dir / fname).write_bytes(content)
    target.photo_url = f"/api/v1/users/{target.id}/photo/{fname}"


@router.post("/me/photo")
async def upload_my_photo(
    request: Request,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    target = await _current_db_user(user, db)
    await save_user_photo(target, file)
    await db.commit()
    await db.refresh(target)
    await record_action(db, user_id=user.id, action="upload_own_photo", resource_type="user",
                        resource_id=target.id, ip=client_ip(request))
    return _user_payload(target)
