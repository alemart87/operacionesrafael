"""Migraciones de datos de Supervisión (una sola vez, ver models/migracion.py)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....core.operativas import filter_permissions
from ....core.perfiles import DEFAULT_PERMISSIONS
from ....models.profile import Profile
from . import operadores as maestro
from .models import OPERATIVA, SupParametros

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


async def permisos_tickets(db: AsyncSession) -> dict[str, Any]:
    """Los perfiles que ya existían reciben los tickets de revisión según lo definido (jefes y auditor)."""
    perm = f"{OPERATIVA}.tickets"
    cambios: list[str] = []
    for row in (await db.execute(select(Profile))).scalars().all():
        antes = set(row.permissions or [])
        if perm in DEFAULT_PERMISSIONS.get(row.slug, []) and perm not in antes:
            row.permissions = filter_permissions(sorted(antes | {perm}), row.slug)
            cambios.append(row.slug)
    await db.commit()
    return {"perfiles": sorted(cambios)}


async def vinculos_sph_al_maestro(db: AsyncSession) -> dict[str, Any]:
    return await maestro.importar_vinculos_sph(db)


async def inicio_gestion(db: AsyncSession) -> dict[str, Any]:
    """La gestión del supervisor (cobertura, foco, seguimientos) se mide desde el día en que se instala el
    registro de coaching: los meses anteriores no tenían cómo registrarla y no se reescriben."""
    hoy = datetime.now(ZoneInfo("America/Asuncion")).date().isoformat()
    row = await db.get(SupParametros, OPERATIVA)
    if row and (row.data or {}).get("gestion_desde"):
        return {"gestion_desde": row.data["gestion_desde"], "ya_estaba": True}
    if not row:
        row = SupParametros(operativa=OPERATIVA, data={})
        db.add(row)
    row.data = {**(row.data or {}), "gestion_desde": hoy}
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"gestion_desde": hoy}


async def coaching_metricas(db: AsyncSession) -> dict[str, Any]:
    """Los coachings anteriores a poder elegir varias métricas: su lista es la métrica que tenían."""
    from .models import Coaching
    n = 0
    for c in (await db.execute(select(Coaching).where(Coaching.metricas.is_(None)))).scalars().all():
        c.metricas = [c.metrica]
        n += 1
    await db.commit()
    return {"coachings": n}


MIGRACIONES = [
    ("2026-10-supervision-permisos", permisos_supervision),
    ("2026-10-operadores-desde-sph", vinculos_sph_al_maestro),
    ("2026-10-supervision-parametros", permisos_parametros),
    ("2026-10-gestion-desde", inicio_gestion),
    ("2026-10-tickets-permisos", permisos_tickets),
    ("2026-10-coaching-metricas", coaching_metricas),
]
