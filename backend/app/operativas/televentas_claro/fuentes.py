"""Qué informe vale para cada día (Productividad) y para cada mes (Ventas Netas).

Lo comparten el SPH y Supervisión, para que los dos lean exactamente lo mismo. Vale el informe con
los datos más completos, publicado o no (quien lo muestra avisa si es un borrador):

- Ventas Netas: cada planilla diaria trae las ventas de todo el mes hasta su corte, así que la de
  corte más nuevo reemplaza a las anteriores. A igual corte, el publicado; si no, el generado más tarde.
- Productividad: el informe del día se rehace con cada corte de llamadas, así que vale el que llega
  más lejos en el día (corte final más tardío). A igual corte, el publicado; si no, el generado más tarde.

Así, subir el corte de ventas de hoy alcanza para que el SPH de ayer use las ventas de ayer (y su último
estado), aunque todavía no se haya publicado; y un día publicado a mitad de jornada no deja afuera las
horas de la tarde.
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


def orden_productividad(r: ProdInforme) -> tuple:
    """Del peor al mejor informe de un día: corte final más tardío, publicado, generado más tarde."""
    return (r.corte_final or "", r.status == PROD_PUBLICADO, _utc(r.generated_at) or _MIN)


def orden_ventas(r: VentasNetasReport) -> tuple:
    """Del peor al mejor informe de un mes: corte más nuevo, publicado, generado más tarde."""
    return (r.fecha_dato or date.min, r.status == VN_PUBLICADO, _utc(r.generated_at) or _MIN)


async def informes_productividad(db: AsyncSession, desde: date, hasta: date, *,
                                 con_datos: bool = True) -> dict[date, ProdInforme]:
    """Por día, el informe que llega más lejos en el día (ver arriba).
    `con_datos=False` no trae el JSON del informe (para ver qué hay sin leerlo)."""
    q = select(ProdInforme).where(
        ProdInforme.fecha >= desde, ProdInforme.fecha <= hasta,
        ProdInforme.status.in_([PROD_PUBLICADO, PROD_BORRADOR]),
    )
    if not con_datos:
        q = q.options(defer(ProdInforme.data))
    rows = (await db.execute(q)).scalars().all()
    out: dict[date, ProdInforme] = {}
    for r in sorted(rows, key=orden_productividad):
        out[r.fecha] = r  # queda el mejor
    return out


async def informes_ventas(db: AsyncSession, periodos: set[str], *,
                          con_datos: bool = True) -> dict[str, VentasNetasReport]:
    """Por mes, el informe de corte más nuevo: la última planilla reemplaza a las anteriores (ver arriba)."""
    if not periodos:
        return {}
    q = select(VentasNetasReport).where(
        VentasNetasReport.periodo.in_(periodos), VentasNetasReport.status.in_([VN_PUBLICADO, VN_BORRADOR]),
    )
    if not con_datos:
        q = q.options(defer(VentasNetasReport.data))
    rows = (await db.execute(q)).scalars().all()
    out: dict[str, VentasNetasReport] = {}
    for r in sorted(rows, key=orden_ventas):
        out[r.periodo] = r  # queda el mejor
    return out
