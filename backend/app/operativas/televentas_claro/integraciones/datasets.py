"""Datasets planos de solo lectura para herramientas externas (KNIME, Power BI, Python).

Cada dataset devuelve filas de una tabla: solo valores simples (texto, números, fechas, booleanos), sin estructuras
anidadas, para que entren directo en un nodo JSON to Table o en un CSV. Salen de lo que la plataforma ya calculó y
publicó (los borradores solo si se piden). Facturación no tiene dataset: es confidencial y queda fuera por diseño.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Awaitable, Callable
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..informe_diario.models import FIRMADO, InformeDiario
from ..logistica.models import ESTADO_PUBLICADO as LOG_PUBLICADO
from ..logistica.models import LogisticaInforme
from ..productividad.models import ESTADO_PUBLICADO as PROD_PUBLICADO
from ..productividad.models import ProdInforme
from ..sph.models import ESTADO_PUBLICADO as SPH_PUBLICADO
from ..sph.models import SphInforme
from ..ventas_netas.models import ESTADO_PUBLICADO as VN_PUBLICADO
from ..ventas_netas.models import VentasNetasReport

ZONA = ZoneInfo("America/Asuncion")
MAX_DIAS = 400
DIAS_DEFECTO = 30
MAX_FILAS = 50_000

Filas = list[dict[str, Any]]


def plano(d: dict[str, Any], prefijo: str = "") -> dict[str, Any]:
    """Aplana un dict: los dicts anidados se prefijan (`kpis_llamadas`), las listas se descartan."""
    out: dict[str, Any] = {}
    for k, v in (d or {}).items():
        if isinstance(v, dict):
            out.update(plano(v, f"{prefijo}{k}_"))
        elif isinstance(v, (list, tuple, set)):
            continue
        else:
            out[f"{prefijo}{k}"] = v
    return out


def _iso(d: Any) -> Any:
    if isinstance(d, datetime):
        return d.astimezone(ZONA).isoformat(timespec="seconds")
    if isinstance(d, date):
        return d.isoformat()
    return d


# ------------------------------------------------------------------ productividad de llamadas
async def productividad_dias(db: AsyncSession, desde: date, hasta: date, borradores: bool) -> Filas:
    q = select(ProdInforme).where(ProdInforme.fecha >= desde, ProdInforme.fecha <= hasta, ProdInforme.replaced_at.is_(None))
    if not borradores:
        q = q.where(ProdInforme.status == PROD_PUBLICADO)
    rows = (await db.execute(q.order_by(ProdInforme.fecha))).scalars().all()
    out: Filas = []
    for r in rows:
        out.append({
            "informe_id": r.id, "fecha": _iso(r.fecha), "estado": r.status, "cortes": r.cortes, "corte_final": r.corte_final,
            "agentes": r.agentes, "llamadas": r.llamadas, "atendidas": r.atendidas, "pct_contacto": r.pct_contacto,
            "pct_conversacion": r.pct_conversacion, "banda": r.banda, "jornada_media_seg": r.jornada_media,
            "alertas": r.alertas, "publicado_at": _iso(r.published_at),
            **plano((r.data or {}).get("kpis") or {}, "kpi_"),
        })
    return out


async def productividad_agentes(db: AsyncSession, desde: date, hasta: date, borradores: bool) -> Filas:
    q = select(ProdInforme).where(ProdInforme.fecha >= desde, ProdInforme.fecha <= hasta, ProdInforme.replaced_at.is_(None))
    if not borradores:
        q = q.where(ProdInforme.status == PROD_PUBLICADO)
    rows = (await db.execute(q.order_by(ProdInforme.fecha))).scalars().all()
    out: Filas = []
    for r in rows:
        for a in (r.data or {}).get("agentes") or []:
            out.append({"informe_id": r.id, "fecha": _iso(r.fecha), "estado": r.status, **plano(a),
                        "alertas": ",".join(a.get("alertas") or [])})
    return out


# ------------------------------------------------------------------ ventas netas
def _meses(desde: date, hasta: date) -> tuple[date, date]:
    return desde.replace(day=1), hasta.replace(day=1)


async def ventas_netas_informes(db: AsyncSession, desde: date, hasta: date, borradores: bool) -> Filas:
    m0, m1 = _meses(desde, hasta)
    q = select(VentasNetasReport).where(VentasNetasReport.period_month >= m0, VentasNetasReport.period_month <= m1,
                                        VentasNetasReport.replaced_at.is_(None))
    if not borradores:
        q = q.where(VentasNetasReport.status == VN_PUBLICADO)
    rows = (await db.execute(q.order_by(VentasNetasReport.period_month, VentasNetasReport.generated_at))).scalars().all()
    out: Filas = []
    for r in rows:
        out.append({
            "informe_id": r.id, "periodo": r.periodo, "fecha_dato": _iso(r.fecha_dato), "estado": r.status, "titulo": r.title,
            "netas": r.netas, "pospago": r.pospago, "gpon": r.gpon, "iptv": r.iptv, "pospago_sin_uso": r.pospago_sin_uso,
            "pct_sin_uso": r.pct_sin_uso, "pendientes": r.pendientes, "publicado_at": _iso(r.published_at),
            **plano((r.data or {}).get("kpis") or {}, "kpi_"),
        })
    return out


async def ventas_netas_vendedores(db: AsyncSession, desde: date, hasta: date, borradores: bool) -> Filas:
    m0, m1 = _meses(desde, hasta)
    q = select(VentasNetasReport).where(VentasNetasReport.period_month >= m0, VentasNetasReport.period_month <= m1,
                                        VentasNetasReport.replaced_at.is_(None))
    if not borradores:
        q = q.where(VentasNetasReport.status == VN_PUBLICADO)
    rows = (await db.execute(q.order_by(VentasNetasReport.period_month))).scalars().all()
    out: Filas = []
    for r in rows:
        for v in (r.data or {}).get("vendedores") or []:
            out.append({"informe_id": r.id, "periodo": r.periodo, "fecha_dato": _iso(r.fecha_dato), "estado": r.status, **plano(v)})
    return out


# ------------------------------------------------------------------ SPH
async def sph_informes(db: AsyncSession, desde: date, hasta: date, borradores: bool) -> Filas:
    q = select(SphInforme).where(SphInforme.fecha >= desde, SphInforme.fecha <= hasta, SphInforme.replaced_at.is_(None))
    if not borradores:
        q = q.where(SphInforme.status == SPH_PUBLICADO)
    rows = (await db.execute(q.order_by(SphInforme.fecha))).scalars().all()
    return [{
        "informe_id": r.id, "desde": _iso(r.fecha), "hasta": _iso(r.hasta or r.fecha), "tipo": r.tipo or "dia", "dias": r.dias,
        "estado": r.status, "sph": r.sph, "ventas": r.ventas, "horas": r.horas, "agentes": r.agentes, "vinculados": r.vinculados,
        "pct_cobertura": r.pct_cobertura, "version": r.version, "publicado_at": _iso(r.published_at),
    } for r in rows]


async def sph_agentes(db: AsyncSession, desde: date, hasta: date, borradores: bool) -> Filas:
    q = select(SphInforme).where(SphInforme.fecha >= desde, SphInforme.fecha <= hasta, SphInforme.replaced_at.is_(None))
    if not borradores:
        q = q.where(SphInforme.status == SPH_PUBLICADO)
    rows = (await db.execute(q.order_by(SphInforme.fecha))).scalars().all()
    out: Filas = []
    for r in rows:
        for a in (r.data or {}).get("agentes") or []:
            fila = {k: v for k, v in a.items() if k not in ("productos", "estados", "candidatos")}
            out.append({"informe_id": r.id, "desde": _iso(r.fecha), "hasta": _iso(r.hasta or r.fecha), "estado": r.status, **plano(fila)})
    return out


# ------------------------------------------------------------------ informe diario (sin comentarios ni figuras)
def _resultado(res: dict[str, Any], clave: str) -> dict[str, Any]:
    x = (res or {}).get(clave) or {}
    return {f"{clave}_valor": x.get("valor"), f"{clave}_meta": x.get("meta"), f"{clave}_comentario": x.get("comentario") or ""}


async def _informes_diarios(db: AsyncSession, desde: date, hasta: date, borradores: bool) -> list[InformeDiario]:
    q = select(InformeDiario).where(InformeDiario.fecha >= desde, InformeDiario.fecha <= hasta)
    if not borradores:
        q = q.where(InformeDiario.estado == FIRMADO)
    return list((await db.execute(q.order_by(InformeDiario.fecha, InformeDiario.autor_nombre))).scalars().all())


async def informes_diarios(db: AsyncSession, desde: date, hasta: date, borradores: bool) -> Filas:
    out: Filas = []
    for i in await _informes_diarios(db, desde, hasta, borradores):
        metricas = i.metricas or []
        out.append({
            "informe_id": i.id, "fecha": _iso(i.fecha), "estado": i.estado, "autor": i.autor_nombre, "cargo": i.autor_cargo,
            **_resultado(i.resultados, "pospago"), **_resultado(i.resultados, "gpon"),
            "otros_resultados": len((i.resultados or {}).get("otros") or []), "resumen": i.resumen or "",
            "metricas": len(metricas), "metricas_criticas": sum(1 for m in metricas if m.get("estado") == "critico"),
            "compromisos": sum(1 for m in metricas if (m.get("compromiso") or "").strip()),
            "datos_importados": ",".join(x.get("tipo") or "" for x in (i.importados or [])),
            "firmado_at": _iso(i.firmado_at), "revisado_at": _iso(i.revisado_at),
        })
    return out


async def informes_diarios_metricas(db: AsyncSession, desde: date, hasta: date, borradores: bool) -> Filas:
    out: Filas = []
    for i in await _informes_diarios(db, desde, hasta, borradores):
        for m in i.metricas or []:
            out.append({
                "informe_id": i.id, "fecha": _iso(i.fecha), "estado_informe": i.estado, "autor": i.autor_nombre,
                "metrica_id": m.get("id"), "nombre": m.get("nombre"), "indicador": m.get("indicador"), "anterior": m.get("anterior"),
                "estado": m.get("estado"), "comentario": m.get("comentario") or "", "compromiso": m.get("compromiso") or "",
                "responsable": m.get("responsable") or "", "fecha_compromiso": m.get("fecha_compromiso"),
            })
    return out


# ------------------------------------------------------------------ logística de entregas
async def logistica_pedidos(db: AsyncSession, desde: date, hasta: date, borradores: bool) -> Filas:
    m0, m1 = _meses(desde, hasta)
    q = select(LogisticaInforme).where(LogisticaInforme.period_month >= m0, LogisticaInforme.period_month <= m1,
                                       LogisticaInforme.replaced_at.is_(None))
    if not borradores:
        q = q.where(LogisticaInforme.status == LOG_PUBLICADO)
    rows = (await db.execute(q.order_by(LogisticaInforme.period_month, LogisticaInforme.fecha_corte))).scalars().all()
    out: Filas = []
    for r in rows:
        for p in (r.data or {}).get("pedidos") or []:
            if desde.isoformat() <= (p.get("fecha") or "") <= hasta.isoformat():
                out.append({"informe_id": r.id, "periodo": r.periodo, "fecha_corte": _iso(r.fecha_corte), "estado_informe": r.status,
                            **plano({k: v for k, v in p.items() if k not in ("fila", "motivo_informado")})})
    return out


# ------------------------------------------------------------------ catálogo
Dataset = Callable[[AsyncSession, date, date, bool], Awaitable[Filas]]

CATALOGO: dict[str, dict[str, Any]] = {
    "productividad_dias": {
        "modulo": "Productividad de llamadas", "titulo": "Productividad · un día por fila",
        "descripcion": "Los informes diarios de productividad: llamadas, atendidas, % contacto, % conversación, banda, jornada media y los KPI del día.",
        "fecha": "fecha del informe", "fn": productividad_dias,
    },
    "productividad_agentes": {
        "modulo": "Productividad de llamadas", "titulo": "Productividad · un agente por día",
        "descripcion": "Cada agente en cada informe: tiempos, llamadas, atendidas, porcentajes, modo (automático o manual), turno, banda y alertas.",
        "fecha": "fecha del informe", "fn": productividad_agentes,
    },
    "ventas_netas_informes": {
        "modulo": "Ventas Netas", "titulo": "Ventas Netas · un informe por fila",
        "descripcion": "Los informes mensuales de ventas netas: netas, pospago, GPON, IPTV, pospago sin uso, pendientes y los KPI del período.",
        "fecha": "mes del período", "fn": ventas_netas_informes,
    },
    "ventas_netas_vendedores": {
        "modulo": "Ventas Netas", "titulo": "Ventas Netas · un vendedor por informe",
        "descripcion": "Cada vendedor en cada informe mensual: subcanal, pospago (con uso, sin uso, en espera), GPON, IPTV, portadas, suspendidas y alerta.",
        "fecha": "mes del período", "fn": ventas_netas_vendedores,
    },
    "sph_informes": {
        "modulo": "SPH estimado", "titulo": "SPH · un informe por fila",
        "descripcion": "Los informes de SPH (día, semana, mes o rango): SPH, ventas, horas, agentes, vinculados y cobertura.",
        "fecha": "inicio del período", "fn": sph_informes,
    },
    "sph_agentes": {
        "modulo": "SPH estimado", "titulo": "SPH · un agente por informe",
        "descripcion": "Cada agente en cada informe de SPH: vendedor vinculado, nivel del vínculo, horas, llamadas, ventas, SPH y si entra al ranking.",
        "fecha": "inicio del período", "fn": sph_agentes,
    },
    "informes_diarios": {
        "modulo": "Informe diario", "titulo": "Informe diario · un informe por fila",
        "descripcion": "Los informes diarios firmados: autor, resultados de Pospago y GPON contra meta, resumen, cantidad de métricas críticas y compromisos. Sin comentarios ni figuras.",
        "fecha": "fecha del informe", "fn": informes_diarios,
    },
    "logistica_pedidos": {
        "modulo": "Logística de entregas", "titulo": "Logística · un pedido por fila",
        "descripcion": "Cada pedido de los cortes publicados: formulario, cliente, ciudad, departamento, región, fecha de venta, vendedor, promoción, estado, motivo y días de demora al corte.",
        "fecha": "fecha de venta", "fn": logistica_pedidos,
    },
    "informes_diarios_metricas": {
        "modulo": "Informe diario", "titulo": "Informe diario · una métrica crítica por fila",
        "descripcion": "Cada métrica crítica de cada informe firmado: indicador, estado, comentario, compromiso, responsable y fecha.",
        "fecha": "fecha del informe", "fn": informes_diarios_metricas,
    },
}


def catalogo_dict() -> list[dict[str, Any]]:
    return [{"nombre": k, **{a: b for a, b in v.items() if a != "fn"}} for k, v in CATALOGO.items()]


def hoy() -> date:
    return datetime.now(ZONA).date()


def rango(desde: date | None, hasta: date | None) -> tuple[date, date]:
    """El rango pedido, acotado: por defecto los últimos 30 días; nunca más de 400 días."""
    h = hasta or hoy()
    d = desde or (h - timedelta(days=DIAS_DEFECTO))
    if d > h:
        raise ValueError("«desde» no puede ser posterior a «hasta»")
    if (h - d).days > MAX_DIAS:
        raise ValueError(f"El rango no puede superar los {MAX_DIAS} días")
    return d, h


def columnas(filas: Filas) -> list[str]:
    """La unión de columnas en el orden en que aparecen."""
    vistas: dict[str, None] = {}
    for f in filas:
        for k in f:
            vistas.setdefault(k, None)
    return list(vistas)
