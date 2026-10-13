"""Migraciones de datos de Integraciones (de una sola vez, al arrancar)."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....core.operativas import filter_permissions
from ....core.perfiles import DEFAULT_PERMISSIONS
from ....models.profile import Profile


async def permisos_integraciones(db: AsyncSession) -> dict[str, Any]:
    """El perfil Sub gerente que ya existía recibe la utilidad Integraciones (el superadmin la tiene siempre)."""
    perm = "televentas_claro.integraciones"
    cambios: list[str] = []
    for row in (await db.execute(select(Profile))).scalars().all():
        antes = set(row.permissions or [])
        if perm in DEFAULT_PERMISSIONS.get(row.slug, []) and perm not in antes and perm in filter_permissions([perm], row.slug):
            row.permissions = filter_permissions(sorted(antes | {perm}), row.slug)
            cambios.append(row.slug)
    await db.commit()
    return {"perfiles": sorted(cambios)}


MIGRACIONES = [("integraciones_permisos_v1", permisos_integraciones)]
