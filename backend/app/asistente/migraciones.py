"""Migraciones de datos de Voi (de una sola vez, al arrancar)."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.operativas import OPERATIVAS, filter_permissions
from ..core.perfiles import DEFAULT_PERMISSIONS
from ..models.profile import Profile
from .config import UTILIDAD


async def permisos_asistente(db: AsyncSession) -> dict[str, Any]:
    """Los perfiles que ya existían reciben el asistente según lo definido (sub gerente, coordinador y auditor)."""
    perms = {f"{o['slug']}.{UTILIDAD}" for o in OPERATIVAS}
    cambios: list[str] = []
    for row in (await db.execute(select(Profile))).scalars().all():
        antes = set(row.permissions or [])
        nuevos = {p for p in perms if p in DEFAULT_PERMISSIONS.get(row.slug, []) and p not in antes}
        if nuevos:
            row.permissions = filter_permissions(sorted(antes | nuevos), row.slug)
            cambios.append(row.slug)
    await db.commit()
    return {"perfiles": sorted(cambios)}


MIGRACIONES = [
    ("2026-10-asistente-permisos", permisos_asistente),
]
