"""Qué informe vale para cada día (Productividad) y para cada mes (Ventas Netas).

Lo comparten el SPH y Supervisión, para que los dos lean exactamente lo mismo:
el informe publicado; si todavía no hay, el borrador más reciente (y quien lo
muestra avisa que es provisorio).
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from .productividad.models import ESTADO_BORRADOR as PROD_BORRADOR
from .productividad.models import ESTADO_PUBLICADO as PROD_PUBLICADO
from .productividad.models import ProdInforme
from .ventas_netas.models import ESTADO_BORRADOR as VN_BORRADOR
from .ventas_netas.models import ESTADO_PUBLICADO as VN_PUBLICADO
from .ventas_netas.models import VentasNetasReport

_MIN = datetime.min.replace(tzinfo=timezone.utc)


def _utc(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=timezone.utc) if d is not None and d.tzinfo is None else d


async def informes_productividad(db: AsyncSession, desde: date, hasta: date, *,
                                 con_datos: bool = True) -> dict[date, ProdInforme]:
    """Por día: el publicado; si no hay, el borrador más reciente.
    `con_datos=False` no trae el JSON del informe (para ver qué hay sin leerlo)."""
    q = select(ProdInforme).where(
        ProdInforme.fecha >= desde, ProdInforme.fecha <= hasta,
        ProdInforme.status.in_([PROD_PUBLICADO, PROD_BORRADOR]),
    )
    if not con_datos:
        q = q.options(defer(ProdInforme.data))
    rows = (await db.execute(q)).scalars().all()
    out: dict[date, ProdInforme] = {}
    for r in sorted(rows, key=lambda r: (r.status == PROD_PUBLICADO, _utc(r.generated_at) or _MIN)):
        out[r.fecha] = r  # queda el mejor: publicado > generado más tarde
    return out


async def informes_ventas(db: AsyncSession, periodos: set[str], *,
                          con_datos: bool = True) -> dict[str, VentasNetasReport]:
    """Por mes: el publicado; si no hay, el borrador con el corte más reciente."""
    if not periodos:
        return {}
    q = select(VentasNetasReport).where(
        VentasNetasReport.periodo.in_(periodos), VentasNetasReport.status.in_([VN_PUBLICADO, VN_BORRADOR]),
    )
    if not con_datos:
        q = q.options(defer(VentasNetasReport.data))
    rows = (await db.execute(q)).scalars().all()
    out: dict[str, VentasNetasReport] = {}
    for r in sorted(rows, key=lambda r: (r.status == VN_PUBLICADO, r.fecha_dato or date.min, _utc(r.generated_at) or _MIN)):
        out[r.periodo] = r  # queda el mejor: publicado > corte más nuevo > generado más tarde
    return out
