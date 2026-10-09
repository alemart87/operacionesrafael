"""Datos que Supervisión lee de otros módulos, preparados una sola vez (caché en el proceso).

- Productividad: por agente y por día, el login y la conversación válidos (sin sesiones abiertas),
  de los informes del mes (el publicado de cada día; si no hay, el borrador más reciente).
- Parámetros del scoring (versionados) y las metas de conversación de Productividad.
"""
from __future__ import annotations

from collections import OrderedDict
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..fuentes import informes_productividad
from ..productividad.api import parametros as parametros_productividad
from ..productividad.models import ProdInforme
from .calculo import limites
from .models import OPERATIVA, SupParametros
from .scoring import SCORING_DEFECTO

# (id del informe, generado) → [(clave, login válido s, conversación válida s)]
_CACHE_PROD: "OrderedDict[tuple[str, str], list[tuple[str, int, int]]]" = OrderedDict()
_MAX_CACHE = 120  # ~4 meses de informes diarios


def _iso(d: datetime | None) -> str:
    if d is None:
        return ""
    return (d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d).isoformat()


async def productividad_del_mes(db: AsyncSession, periodo: str) -> tuple[dict[str, list[tuple[date, int, int]]], dict[str, Any]]:
    """Agente → [(día, login válido, conversación válida)] del mes, y qué informes se usaron."""
    primero, ultimo = limites(periodo)
    informes = await informes_productividad(db, primero, ultimo, con_datos=False)
    out: dict[str, list[tuple[date, int, int]]] = {}
    for d in sorted(informes):
        r = informes[d]
        clave = (r.id, _iso(r.generated_at))
        filas = _CACHE_PROD.get(clave)
        if filas is None:
            data = (await db.execute(select(ProdInforme.data).where(ProdInforme.id == r.id))).scalar_one() or {}
            filas = [(a["clave"], int(a.get("login_val") or 0), int(a.get("conv_val") or 0))
                     for a in data.get("agentes") or [] if a.get("clave")]
            _CACHE_PROD[clave] = filas
            while len(_CACHE_PROD) > _MAX_CACHE:
                _CACHE_PROD.popitem(last=False)
        else:
            _CACHE_PROD.move_to_end(clave)
        for k, login, conv in filas:
            out.setdefault(k, []).append((d, login, conv))
    fuente = {
        "dias": len(informes),
        "ultimo_dia": max(informes).isoformat() if informes else None,
        "borradores": sum(1 for r in informes.values() if r.status != "published"),
    }
    return out, fuente


async def parametros_scoring(db: AsyncSession) -> dict[str, Any]:
    """Pesos y umbrales vigentes del scoring (con su versión) y las metas de conversación de Productividad."""
    row = await db.get(SupParametros, OPERATIVA)
    guardado = ((row.data if row else None) or {}).get("scoring") or {}
    sc = {**SCORING_DEFECTO, **guardado,
          "asesor": {**SCORING_DEFECTO["asesor"], **(guardado.get("asesor") or {})},
          "supervisor": {**SCORING_DEFECTO["supervisor"], **(guardado.get("supervisor") or {})}}
    pp = await parametros_productividad(db)
    return {**sc, "conversacion": {"rojo": pp["rojo"], "meta_min": pp["meta_min"], "meta_max": pp["meta_max"]}}
