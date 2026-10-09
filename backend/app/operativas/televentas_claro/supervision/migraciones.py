"""Migraciones de datos de Supervisión (una sola vez, ver models/migracion.py)."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....core.operativas import filter_permissions
from ....core.perfiles import DEFAULT_PERMISSIONS
from ....models.profile import Profile
from . import operadores as maestro
from .models import OPERATIVA

UTILIDADES_NUEVAS = {f"{OPERATIVA}.{u}" for u in ("supervision", "supervision_gestion", "operadores", "portal_supervisor")}


async def permisos_supervision(db: AsyncSession) -> dict[str, Any]:
    """Los perfiles que ya existían reciben las utilidades de Supervisión según lo definido para cada uno
    (jefes: ver y gestionar; analista: ver y vincular; supervisor: su portal y nada más)."""
    cambios: dict[str, list[str]] = {}
    for row in (await db.execute(select(Profile))).scalars().all():
        antes = set(row.permissions or [])
        nuevas = set(DEFAULT_PERMISSIONS.get(row.slug, [])) & UTILIDADES_NUEVAS
        despues = filter_permissions(sorted(antes | nuevas), row.slug)
        if set(despues) != antes:
            row.permissions = despues
            cambios[row.slug] = sorted(set(despues) ^ antes)
    await db.commit()
    return {"perfiles": cambios}


async def permisos_parametros(db: AsyncSession) -> dict[str, Any]:
    """El sub gerente recibe los parámetros del modelo (pesos del scoring), restringidos a su perfil."""
    perm = f"{OPERATIVA}.supervision_parametros"
    row = await db.get(Profile, "sub_gerente")
    if not row or perm in (row.permissions or []):
        return {"sub_gerente": False}
    row.permissions = filter_permissions([*(row.permissions or []), perm], "sub_gerente")
    await db.commit()
    return {"sub_gerente": True}


async def vinculos_sph_al_maestro(db: AsyncSession) -> dict[str, Any]:
    return await maestro.importar_vinculos_sph(db)


MIGRACIONES = [
    ("2026-10-supervision-permisos", permisos_supervision),
    ("2026-10-operadores-desde-sph", vinculos_sph_al_maestro),
    ("2026-10-supervision-parametros", permisos_parametros),
]
