"""Migraciones de datos de Auditoría (de una sola vez, al arrancar)."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....core.operativas import filter_permissions
from ....core.perfiles import DEFAULT_PERMISSIONS
from ....models.profile import Profile


async def auditor_todos_los_modulos(db: AsyncSession) -> dict[str, Any]:
    """El perfil Auditor que ya existía recibe las utilidades que le faltan para ver todos los módulos (salvo
    Facturación e Integraciones, que no se le pueden dar). No se le quita nada que el superadmin le haya asignado."""
    row = await db.get(Profile, "auditor")
    if row is None:
        return {"perfil": None}
    antes = set(row.permissions or [])
    nuevos = sorted(set(filter_permissions(DEFAULT_PERMISSIONS["auditor"], "auditor")) - antes)
    if nuevos:
        row.permissions = filter_permissions(sorted(antes | set(nuevos)), "auditor")
        await db.commit()
    return {"agregados": nuevos}


MIGRACIONES = [("auditoria_auditor_todos_los_modulos_v1", auditor_todos_los_modulos)]
