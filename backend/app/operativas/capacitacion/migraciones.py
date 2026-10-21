"""Migraciones de datos de Capacitación y Mentoría (una sola vez, ver models/migracion.py)."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.operativas import filter_permissions
from ...core.perfiles import DEFAULT_PERMISSIONS
from ...models.profile import Profile
from ...models.user import User

OPERATIVA = "capacitacion"
JEFES = ("gerente", "sub_gerente")


async def permisos_capacitacion(db: AsyncSession) -> dict[str, Any]:
    """El gerente y el sub gerente que ya existían reciben Capacitación y Mentoría con acceso completo (los perfiles
    nuevos —capacitador, mentor y Gerencia de RRHH— nacen con lo suyo al sembrarse)."""
    cambios: dict[str, list[str]] = {}
    for row in (await db.execute(select(Profile).where(Profile.slug.in_(JEFES)))).scalars().all():
        antes = set(row.permissions or [])
        nuevas = {p for p in DEFAULT_PERMISSIONS.get(row.slug, []) if p.startswith(f"{OPERATIVA}.")}
        despues = filter_permissions(sorted(antes | nuevas), row.slug)
        if set(despues) != antes:
            row.permissions = despues
            cambios[row.slug] = sorted(set(despues) - antes)
    await db.commit()
    return {"perfiles": cambios}


async def operativa_a_jefes(db: AsyncSession) -> dict[str, Any]:
    """Los gerentes y sub gerentes activos quedan asignados también a la operativa (sin ella no verían el módulo)."""
    n = 0
    for u in (await db.execute(select(User).where(User.role.in_(JEFES), User.is_active.is_(True)))).scalars().all():
        ops = list(u.operativas or [])
        if OPERATIVA not in ops:
            u.operativas = [*ops, OPERATIVA]
            n += 1
    await db.commit()
    return {"usuarios": n}


MIGRACIONES = [
    ("2026-10-capacitacion-permisos", permisos_capacitacion),
    ("2026-10-capacitacion-jefes", operativa_a_jefes),
]
