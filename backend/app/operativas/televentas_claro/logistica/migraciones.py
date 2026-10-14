"""Migraciones de datos de Logística (de una sola vez, al arrancar)."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....core.operativas import filter_permissions
from ....core.perfiles import DEFAULT_PERMISSIONS
from ....models.profile import Profile


async def permisos_logistica(db: AsyncSession) -> dict[str, Any]:
    """Los perfiles que ya existían reciben Logística según lo definido por defecto (ver, gestión o ninguna)."""
    perms = ("televentas_claro.logistica", "televentas_claro.logistica_gestion")
    cambios: list[str] = []
    for row in (await db.execute(select(Profile))).scalars().all():
        antes = set(row.permissions or [])
        nuevos = {p for p in perms if p in DEFAULT_PERMISSIONS.get(row.slug, []) and p not in antes}
        if nuevos:
            row.permissions = filter_permissions(sorted(antes | nuevos), row.slug)
            cambios.append(row.slug)
    await db.commit()
    return {"perfiles": sorted(cambios)}


MIGRACIONES = [("logistica_permisos_v1", permisos_logistica)]
