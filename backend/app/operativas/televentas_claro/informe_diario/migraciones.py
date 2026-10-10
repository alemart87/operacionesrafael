"""Migraciones de datos del informe diario (de una sola vez, al arrancar)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....core.operativas import filter_permissions
from ....core.perfiles import DEFAULT_PERMISSIONS
from ....models.profile import Profile
from .models import OPERATIVA, InformeParametros


async def permisos_informe_diario(db: AsyncSession) -> dict[str, Any]:
    """Los perfiles que ya existían reciben el informe diario según lo definido (coordinador y sub gerente)."""
    perm = f"{OPERATIVA}.informe_diario"
    cambios: list[str] = []
    for row in (await db.execute(select(Profile))).scalars().all():
        antes = set(row.permissions or [])
        if perm in DEFAULT_PERMISSIONS.get(row.slug, []) and perm not in antes:
            row.permissions = filter_permissions(sorted(antes | {perm}), row.slug)
            cambios.append(row.slug)
    await db.commit()
    return {"perfiles": sorted(cambios)}


async def inicio_informe_diario(db: AsyncSession) -> dict[str, Any]:
    """El cumplimiento se mide desde el día en que se instala el informe diario: los días anteriores no faltan."""
    hoy = datetime.now(ZoneInfo("America/Asuncion")).date().isoformat()
    row = await db.get(InformeParametros, OPERATIVA)
    if row and (row.data or {}).get("inicio"):
        return {"inicio": row.data["inicio"], "ya_estaba": True}
    if not row:
        row = InformeParametros(operativa=OPERATIVA, data={})
        db.add(row)
    row.data = {**(row.data or {}), "inicio": hoy}
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"inicio": hoy}


MIGRACIONES = [
    ("2026-10-informe-diario-permisos", permisos_informe_diario),
    ("2026-10-informe-diario-inicio", inicio_informe_diario),
]
