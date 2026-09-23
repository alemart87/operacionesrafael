"""Gestión de usuarios: solo el superadmin crea, edita y desactiva.

A cada usuario se le asigna un perfil y las operativas en las que trabaja.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from ...core.database import get_db
from ...core.operativas import filter_operativas
from ...core.security import hash_password
from ...models.user import User
from ...schemas.user import PasswordReset, UserCreate, UserRead, UserUpdate
from ...services.audit_service import record_action
from ..deps import CurrentUser, client_ip, require_superadmin
from .auth import save_user_photo


router = APIRouter(prefix="/users", tags=["users"])


async def _get_or_404(db: AsyncSession, user_id: str) -> User:
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")
    return target


@router.get("", response_model=list[UserRead])
async def list_users(
    user: CurrentUser = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> list[User]:
    rows = await db.execute(select(User).order_by(User.created_at.desc()))
    return list(rows.scalars().all())


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    request: Request,
    user: CurrentUser = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> User:
    email = payload.email.lower().strip()
    if email == settings.superadmin_email.lower().strip():
        raise HTTPException(status.HTTP_409_CONFLICT, "Ese email está reservado para el superadmin")

    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Email ya registrado")

    operativas = filter_operativas(payload.operativas)

    new_user = User(
        email=email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name.strip(),
        role=payload.role,
        operativas=operativas,
        created_by=None if user.is_superadmin else user.id,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    await record_action(db, user_id=user.id, action="create_user", resource_type="user",
                        resource_id=new_user.id, ip=client_ip(request),
                        extra={"new_user_email": email, "role": payload.role, "operativas": operativas})
    return new_user


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: str,
    payload: UserUpdate,
    request: Request,
    user: CurrentUser = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> User:
    target = await _get_or_404(db, user_id)

    changes: dict = {}
    if payload.full_name is not None:
        target.full_name = payload.full_name.strip()
        changes["full_name"] = target.full_name
    if payload.is_active is not None:
        target.is_active = payload.is_active
        changes["is_active"] = payload.is_active
    if payload.role is not None and payload.role != target.role:
        target.role = payload.role
        changes["role"] = payload.role
    if payload.operativas is not None:
        target.operativas = filter_operativas(payload.operativas)
        changes["operativas"] = target.operativas

    await db.commit()
    await db.refresh(target)
    await record_action(db, user_id=user.id, action="update_user", resource_type="user",
                        resource_id=user_id, ip=client_ip(request), extra=changes)
    return target


@router.post("/{user_id}/reset-password", response_model=UserRead)
async def reset_password(
    user_id: str,
    payload: PasswordReset,
    request: Request,
    user: CurrentUser = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> User:
    target = await _get_or_404(db, user_id)
    target.hashed_password = hash_password(payload.new_password)
    await db.commit()
    await db.refresh(target)
    await record_action(db, user_id=user.id, action="reset_password", resource_type="user",
                        resource_id=user_id, ip=client_ip(request), extra={"target_email": target.email})
    return target


@router.post("/{user_id}/photo", response_model=UserRead)
async def upload_user_photo(
    user_id: str,
    request: Request,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> User:
    target = await _get_or_404(db, user_id)
    await save_user_photo(target, file)
    await db.commit()
    await db.refresh(target)
    await record_action(db, user_id=user.id, action="upload_user_photo", resource_type="user",
                        resource_id=user_id, ip=client_ip(request))
    return target


@router.get("/{user_id}/photo/{fname}")
async def get_user_photo(user_id: str, fname: str) -> FileResponse:
    """Sirve la foto desde el disco persistente (público: se usa en <img>)."""
    # Evita path traversal: solo nombres planos que pertenezcan al usuario.
    if Path(fname).name != fname or not fname.startswith(f"{user_id}_"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Foto no encontrada")
    full = settings.upload_path / "photos" / fname
    if not full.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Foto no encontrada")
    return FileResponse(str(full))


@router.delete("/{user_id}")
async def deactivate_user(
    user_id: str,
    request: Request,
    user: CurrentUser = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Baja lógica: el usuario queda inactivo (se preserva su auditoría)."""
    target = await _get_or_404(db, user_id)
    target.is_active = False
    await db.commit()
    await record_action(db, user_id=user.id, action="deactivate_user", resource_type="user",
                        resource_id=user_id, ip=client_ip(request))
    return {"status": "deactivated", "user_id": user_id}
