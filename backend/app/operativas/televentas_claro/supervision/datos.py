"""Datos que Supervisión lee de otros módulos, preparados una sola vez (caché en el proceso).

- Ventas Netas: las netas del informe vigente del mes (`calculo.lineas_netas`).
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

from ..fuentes import informes_productividad, informes_ventas
from ..productividad.api import parametros as parametros_productividad
from ..productividad.models import ProdInforme
from ..ventas_netas.models import VentasNetasReport
from .calculo import limites, lineas_netas
from .models import OPERATIVA, SupParametros
from .scoring import SCORING_DEFECTO

# Netas del mes ya preparadas, por informe y corte (se leen del JSON del informe una sola vez).
_CACHE_VN: "OrderedDict[tuple[str, str, str], list[dict[str, Any]]]" = OrderedDict()
_MAX_VN = 8


async def ventas_del_mes(db: AsyncSession, periodo: str) -> tuple[VentasNetasReport | None, list[dict[str, Any]]]:
    """El informe de Ventas Netas vigente del mes y sus netas (vacío si no hay informe)."""
    r = (await informes_ventas(db, {periodo}, con_datos=False)).get(periodo)
    if not r:
        return None, []
    clave = (r.id, _iso(r.generated_at), r.fecha_dato.isoformat() if r.fecha_dato else "")
    if clave in _CACHE_VN:
        _CACHE_VN.move_to_end(clave)
        return r, _CACHE_VN[clave]
    data = (await db.execute(select(VentasNetasReport.data).where(VentasNetasReport.id == r.id))).scalar_one() or {}
    lineas = lineas_netas(data, periodo, r.fecha_dato)
    _CACHE_VN[clave] = lineas
    while len(_CACHE_VN) > _MAX_VN:
        _CACHE_VN.popitem(last=False)
    return r, lineas


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
