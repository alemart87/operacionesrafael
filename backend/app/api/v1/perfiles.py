"""Perfiles y permisos: el superadmin define qué utilidades tiene cada perfil."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...core.operativas import ALL_PERMISSIONS, OPERATIVAS, SUPERADMIN_ONLY_PERMISSIONS, filter_permissions
from ...core.perfiles import PERFIL_SLUGS, PERFILES
from ...models.profile import Profile
from ...models.user import User
from ...schemas.user import ProfilePermissionsUpdate
from ...services.audit_service import record_action
from ..deps import CurrentUser, client_ip, require_superadmin


router = APIRouter(prefix="/perfiles", tags=["perfiles"])


async def _perfiles_payload(db: AsyncSession) -> list[dict]:
    rows = {p.slug: p for p in (await db.execute(select(Profile))).scalars().all()}
    counts = dict(
        (await db.execute(
            select(User.role, func.count()).where(User.is_active.is_(True)).group_by(User.role)
        )).all()
    )
    out = []
    for p in PERFILES:
        row = rows.get(p["slug"])
        out.append({
            **p,
            "permissions": filter_permissions(row.permissions if row else []),
            "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
            "usuarios_activos": counts.get(p["slug"], 0),
        })
    return out


@router.get("")
async def list_perfiles(
    user: CurrentUser = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Perfiles con sus permisos + catálogo de operativas y utilidades (para la matriz)."""
    return {"perfiles": await _perfiles_payload(db), "operativas": OPERATIVAS}


@router.get("/catalogo")
async def catalogo(user: CurrentUser = Depends(require_superadmin)) -> dict:
    """Solo el catálogo: perfiles disponibles y operativas (para el alta de usuarios)."""
    return {"perfiles": PERFILES, "operativas": OPERATIVAS}


@router.put("/{slug}")
async def update_perfil(
    slug: str,
    payload: ProfilePermissionsUpdate,
    request: Request,
    user: CurrentUser = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if slug not in PERFIL_SLUGS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Perfil inexistente")
    reservados = sorted(set(payload.permissions) & SUPERADMIN_ONLY_PERMISSIONS)
    if reservados:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Estos permisos son exclusivos del superadmin: {', '.join(reservados)}")
    unknown = sorted(set(payload.permissions) - ALL_PERMISSIONS)
    if unknown:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Permisos desconocidos: {', '.join(unknown)}")
    perms = filter_permissions(payload.permissions)

    row = await db.get(Profile, slug)
    before = filter_permissions(row.permissions) if row else []
    if row is None:
        row = Profile(slug=slug, permissions=perms, updated_by=user.id)
        db.add(row)
    else:
        row.permissions = perms
        row.updated_by = user.id
    await db.commit()

    await record_action(
        db, user_id=user.id, action="update_profile_permissions", resource_type="profile",
        resource_id=slug, ip=client_ip(request),
        extra={
            "agregados": sorted(set(perms) - set(before)),
            "quitados": sorted(set(before) - set(perms)),
        },
    )
    return next(p for p in await _perfiles_payload(db) if p["slug"] == slug)
