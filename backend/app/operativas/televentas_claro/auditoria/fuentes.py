"""Fuentes de datos de una auditoría: qué puede elegir el auditor de cada módulo y cómo se congela.

Una auditoría toma uno o más informes de **Ventas Netas** (el ranking de vendedores y las líneas salen de ahí)
y, además, cualquier dato disponible de los otros módulos: **Productividad** (días), **SPH** (informes),
**Logística** (cortes), **Supervisión** (meses: objetivos, alertas, coaching y tickets) e **Informe diario**
(meses: los informes firmados y sus compromisos). Facturación nunca es fuente (es confidencial).

- `catalogo(db, user)`: lo que el auditor puede elegir, por tipo, solo de los módulos que su perfil ve.
- `cargar_modulos(db, seleccion, user)`: los datos elegidos ya congelados (JSON plano por tipo) para el snapshot.
  Lo de Ventas Netas lo carga `api._cargar_fuentes` (recalcula el análisis si hace falta).
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser
from ....models.user import User
from ..informe_diario import seguimiento as inf_seguimiento
from ..informe_diario.informe import hoy as hoy_inf
from ..informe_diario.models import ABIERTO as COMP_ABIERTO
from ..informe_diario.models import FIRMADO, InformeCompromiso, InformeDiario
from ..logistica.models import ESTADO_PUBLICADO as LOG_PUBLICADO
from ..logistica.models import LogisticaInforme
from ..productividad.analyzer import acumular
from ..productividad.api import parametros as prod_parametros
from ..productividad.models import ESTADO_BORRADOR as PROD_BORRADOR
from ..productividad.models import ESTADO_PUBLICADO as PROD_PUBLICADO
from ..productividad.models import ProdInforme
from ..sph.analyzer import nombre_mes
from ..sph.models import ESTADO_REEMPLAZADO as SPH_REEMPLAZADO
from ..sph.models import SphInforme
from ..supervision import api as sup_api
from ..supervision import coaching as coaching_srv
from ..supervision.datos import horario as horario_de
from ..supervision.datos import parametros as sup_parametros
from ..supervision.models import AlertaAsesor, Coaching, ObjetivoSupervisor, Operador, Ticket
from ..supervision.sla import estado as estado_sla
from ..ventas_netas.models import ESTADO_BORRADOR as VN_BORRADOR
from ..ventas_netas.models import ESTADO_PUBLICADO as VN_PUBLICADO
from ..ventas_netas.models import VentasNetasReport

TC = "televentas_claro"
VENTAS_NETAS = "ventas_netas"
# Un tipo por módulo: nombre, permiso que hace falta para incluirlo y qué es cada ítem.
TIPOS: dict[str, dict[str, str]] = {
    VENTAS_NETAS: {"nombre": "Ventas Netas", "permiso": "ventas_netas", "unidad": "corte",
                   "descripcion": "Netas, cargas, líneas sin uso y Sali Hablando: el ranking de vendedores sale de acá."},
    "productividad": {"nombre": "Productividad de llamadas", "permiso": "productividad", "unidad": "día",
                      "descripcion": "Llamadas, conversación y bandas por día y por agente."},
    "sph": {"nombre": "SPH", "permiso": "sph", "unidad": "informe",
            "descripcion": "Ventas por hora conectada de la operación y de cada asesor."},
    "logistica": {"nombre": "Logística de entregas", "permiso": "logistica", "unidad": "corte",
                  "descripcion": "Pedidos entregados, en gestión y devueltos, demoras y vendedores."},
    "supervision": {"nombre": "Supervisión", "permiso": "supervision", "unidad": "mes",
                    "descripcion": "Objetivos y proyección, asesores en alerta, coaching y tickets de revisión del mes."},
    "informe_diario": {"nombre": "Informe diario", "permiso": "informe_diario", "unidad": "mes",
                       "descripcion": "Los informes diarios firmados del mes, sus métricas críticas y compromisos."},
}
MAX_ITEMS = 400
MAX_MESES = 12
MAX_LISTA = 300
VENCIDO_DIAS = 6     # pedidos en gestión con estos días hábiles o más: vencidos
COMPROMISO_LISTA = 60


class FuenteInvalida(ValueError):
    """Una fuente elegida no existe, no se puede usar o el perfil no ve ese módulo."""


def _iso(d: Any) -> str | None:
    return d.isoformat() if d else None


def _pct(a: float, b: float) -> float | None:
    return round(a * 100 / b, 1) if b else None


def _mes(d: date | str | None) -> str | None:
    s = _iso(d) if isinstance(d, (date, datetime)) else d
    return s[:7] if s else None


def _rango_mes(periodo: str) -> tuple[date, date]:
    y, m = int(periodo[:4]), int(periodo[5:7])
    desde = date(y, m, 1)
    hasta = (date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)) - timedelta(days=1)
    return desde, hasta


def clave_nombre(nombre: str | None) -> str:
    """Para cruzar el mismo vendedor escrito distinto («NUÑEZ, EVELYN» y «EVELYN NUÑEZ»): letras, sin orden."""
    s = unicodedata.normalize("NFKD", str(nombre or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).upper()
    return " ".join(sorted(t for t in re.split(r"[^A-Z0-9]+", s) if t))


def permiso_de(tipo: str) -> str:
    return f"{TC}.{TIPOS[tipo]['permiso']}"


def _puede(user: CurrentUser, tipo: str) -> bool:
    return user.has_perm(permiso_de(tipo))


# ------------------------------------------------------------------ catálogo
async def catalogo(db: AsyncSession, user: CurrentUser, ventas_netas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Por tipo: si el perfil lo ve y los ítems que puede elegir (lo de Ventas Netas viene ya armado)."""
    out = []
    for tipo, t in TIPOS.items():
        habilitado = _puede(user, tipo)
        items: list[dict[str, Any]] = []
        if habilitado:
            if tipo == VENTAS_NETAS:
                items = ventas_netas
            elif tipo == "productividad":
                items = await _items_productividad(db)
            elif tipo == "sph":
                items = await _items_sph(db)
            elif tipo == "logistica":
                items = await _items_logistica(db)
            elif tipo == "supervision":
                items = await _items_supervision(db)
            elif tipo == "informe_diario":
                items = await _items_informe_diario(db)
        out.append({"tipo": tipo, "nombre": t["nombre"], "unidad": t["unidad"], "descripcion": t["descripcion"],
                    "habilitado": habilitado, "items": items})
    return out


async def _items_productividad(db: AsyncSession) -> list[dict[str, Any]]:
    rows = (await db.execute(select(ProdInforme).where(ProdInforme.status.in_([PROD_PUBLICADO, PROD_BORRADOR]))
                             .order_by(ProdInforme.fecha.desc(), ProdInforme.generated_at.desc()).limit(MAX_ITEMS))).scalars().all()
    vistos: set[date] = set()
    out = []
    for r in rows:   # un informe por día: el publicado o, si no, el borrador más nuevo
        if r.fecha in vistos and r.status != PROD_PUBLICADO:
            continue
        if r.fecha in vistos:
            out = [x for x in out if x["fecha"] != r.fecha.isoformat()]
        vistos.add(r.fecha)
        out.append({"tipo": "productividad", "id": r.id, "periodo": r.fecha.strftime("%Y-%m"), "fecha": r.fecha.isoformat(),
                    "status": r.status, "etiqueta": f"{r.fecha:%d/%m/%Y} · corte {r.corte_final or '—'}",
                    "agentes": r.agentes, "llamadas": r.llamadas, "pct_conversacion": r.pct_conversacion, "banda": r.banda})
    return out


async def _items_sph(db: AsyncSession) -> list[dict[str, Any]]:
    rows = (await db.execute(select(SphInforme).where(SphInforme.status != SPH_REEMPLAZADO)
                             .order_by(SphInforme.fecha.desc(), SphInforme.generated_at.desc()).limit(MAX_ITEMS))).scalars().all()
    out = []
    for r in rows:
        hasta = r.hasta or r.fecha
        rango = f"{r.fecha:%d/%m}" if hasta == r.fecha else f"{r.fecha:%d/%m} al {hasta:%d/%m/%Y}"
        out.append({"tipo": "sph", "id": r.id, "periodo": r.fecha.strftime("%Y-%m"), "fecha": r.fecha.isoformat(),
                    "hasta": hasta.isoformat(), "tipo_periodo": r.tipo or "dia", "status": r.status,
                    "etiqueta": f"{(r.tipo or 'día').capitalize()} {rango}", "sph": r.sph, "ventas": r.ventas if r.ventas is not None else r.netas,
                    "agentes": r.agentes, "pct_cobertura": r.pct_cobertura})
    return out


async def _items_logistica(db: AsyncSession) -> list[dict[str, Any]]:
    rows = (await db.execute(select(LogisticaInforme).where(LogisticaInforme.replaced_at.is_(None))
                             .order_by(LogisticaInforme.period_month.desc(), LogisticaInforme.fecha_corte.desc(),
                                       LogisticaInforme.generated_at.desc()).limit(MAX_ITEMS))).scalars().all()
    return [{"tipo": "logistica", "id": r.id, "periodo": r.periodo, "fecha": r.fecha_corte.isoformat(), "status": r.status,
             "etiqueta": f"Corte del {r.fecha_corte:%d/%m/%Y}", "pedidos": r.pedidos, "pct_entregados": r.pct_entregados,
             "en_gestion": r.en_gestion, "devueltos": r.devueltos, "demora_prom": r.demora_prom, "entrega_prom": r.entrega_prom}
            for r in rows]


async def _meses_con(db: AsyncSession, *columnas: Any) -> set[str]:
    meses: set[str] = set()
    for col in columnas:
        for (v,) in (await db.execute(select(col).distinct())).all():
            m = _mes(v)
            if m:
                meses.add(m)
    return meses


async def _items_supervision(db: AsyncSession) -> list[dict[str, Any]]:
    meses = await _meses_con(db, AlertaAsesor.periodo, Coaching.fecha, Ticket.created_at, ObjetivoSupervisor.periodo)
    meses.add(date.today().strftime("%Y-%m"))
    out = []
    for per in sorted(meses, reverse=True)[:MAX_MESES]:
        desde, hasta = _rango_mes(per)
        alertas = (await db.execute(select(func.count()).select_from(AlertaAsesor).where(AlertaAsesor.periodo == per))).scalar() or 0
        coachings = (await db.execute(select(func.count()).select_from(Coaching).where(
            Coaching.fecha >= desde, Coaching.fecha <= hasta, Coaching.estado != "pendiente"))).scalar() or 0
        tickets = (await db.execute(select(func.count()).select_from(Ticket).where(
            Ticket.created_at >= datetime.combine(desde, datetime.min.time(), tzinfo=timezone.utc),
            Ticket.created_at < datetime.combine(hasta + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)))).scalar() or 0
        out.append({"tipo": "supervision", "id": per, "periodo": per, "fecha": desde.isoformat(), "status": "published",
                    "etiqueta": nombre_mes(per).capitalize(), "alertas": alertas, "coachings": coachings, "tickets": tickets})
    return out


async def _items_informe_diario(db: AsyncSession) -> list[dict[str, Any]]:
    rows = (await db.execute(select(InformeDiario.fecha, InformeDiario.autor_id).where(InformeDiario.estado == FIRMADO))).all()
    por_mes: dict[str, set[str]] = defaultdict(set)
    firmados: Counter = Counter()
    for f, autor in rows:
        m = _mes(f) or ""
        por_mes[m].add(autor)
        firmados[m] += 1
    out = []
    for per in sorted(por_mes, reverse=True)[:MAX_MESES]:
        out.append({"tipo": "informe_diario", "id": per, "periodo": per, "fecha": _rango_mes(per)[0].isoformat(), "status": "published",
                    "etiqueta": nombre_mes(per).capitalize(), "firmados": firmados[per], "autores": len(por_mes[per])})
    return out


# ------------------------------------------------------------------ carga (datos congelados por tipo)
def _validar_seleccion(seleccion: list[dict[str, Any]], user: CurrentUser) -> dict[str, list[str]]:
    por_tipo: dict[str, list[str]] = defaultdict(list)
    for s in seleccion:
        tipo, sid = str(s.get("tipo") or ""), str(s.get("id") or "").strip()
        if tipo not in TIPOS:
            raise FuenteInvalida(f"Tipo de fuente desconocido: {tipo or '(vacío)'}.")
        if not sid:
            raise FuenteInvalida(f"Falta el id de una fuente de {TIPOS[tipo]['nombre']}.")
        if not _puede(user, tipo):
            raise FuenteInvalida(f"Tu perfil no ve {TIPOS[tipo]['nombre']}: no la podés incluir en la auditoría.")
        if sid not in por_tipo[tipo]:
            por_tipo[tipo].append(sid)
    if sum(len(v) for v in por_tipo.values()) > 60:
        raise FuenteInvalida("Hasta 60 fuentes por auditoría.")
    return por_tipo


async def cargar_modulos(db: AsyncSession, seleccion: list[dict[str, Any]], user: CurrentUser) -> dict[str, dict[str, Any]]:
    """Los datos congelados de las fuentes que no son Ventas Netas: {tipo: {...}}."""
    por_tipo = _validar_seleccion(seleccion, user)
    out: dict[str, dict[str, Any]] = {}
    if por_tipo.get("productividad"):
        out["productividad"] = await _cargar_productividad(db, por_tipo["productividad"])
    if por_tipo.get("sph"):
        out["sph"] = await _cargar_sph(db, por_tipo["sph"])
    if por_tipo.get("logistica"):
        out["logistica"] = await _cargar_logistica(db, por_tipo["logistica"])
    if por_tipo.get("supervision"):
        out["supervision"] = await _cargar_supervision(db, por_tipo["supervision"], user)
    if por_tipo.get("informe_diario"):
        out["informe_diario"] = await _cargar_informe_diario(db, por_tipo["informe_diario"])
    return out


def ids_ventas_netas(seleccion: list[dict[str, Any]], report_ids: list[str] | None = None) -> list[str]:
    ids = list(report_ids or [])
    for s in seleccion:
        if str(s.get("tipo") or "") == VENTAS_NETAS and s.get("id") and str(s["id"]) not in ids:
            ids.append(str(s["id"]))
    return ids


def fuentes_de(reports: list[VentasNetasReport], modulos: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """La lista `fuentes` del informe: cada fuente con su tipo (las de Ventas Netas con sus columnas de siempre)."""
    out = [{"tipo": VENTAS_NETAS, "report_id": r.id, "id": r.id, "periodo": r.periodo, "fecha_dato": _iso(r.fecha_dato), "status": r.status,
            "netas": r.netas, "pospago": r.pospago, "pct_sin_uso": r.pct_sin_uso, "pendientes": r.pendientes,
            "generated_at": _iso(r.generated_at), "version": int((r.data or {}).get("version") or 0),
            "etiqueta": f"{nombre_mes(r.periodo)} · corte {r.fecha_dato:%d/%m/%Y}" if r.fecha_dato else nombre_mes(r.periodo)}
           for r in sorted(reports, key=lambda r: r.periodo)]
    for tipo, d in modulos.items():
        for f in d.get("fuentes") or []:
            out.append({"tipo": tipo, **f})
    return out


def _fuente(tipo: str, **kw: Any) -> dict[str, Any]:
    return {"tipo": tipo, **kw}


async def _cargar_productividad(db: AsyncSession, ids: list[str]) -> dict[str, Any]:
    rows = (await db.execute(select(ProdInforme).where(ProdInforme.id.in_(ids)))).scalars().all()
    if len(rows) != len(ids):
        raise FuenteInvalida("Alguno de los días de Productividad elegidos ya no existe.")
    rows = sorted(rows, key=lambda r: r.fecha)
    p = await prod_parametros(db)
    dias = [{**r.data, "informe_id": r.id} for r in rows if r.data]
    ac = acumular(dias, p) if dias else None
    k = (ac or {}).get("kpis") or {}
    agentes = []
    for a in (ac or {}).get("agentes") or []:
        agentes.append({"nombre": a.get("nombre"), "dias": a.get("dias"), "dias_validos": a.get("dias_validos"),
                        "llamadas": a.get("llamadas"), "atendidas": a.get("atendidas"), "pct_conversacion": a.get("pct_conversacion"),
                        "banda": a.get("banda"), "pct_contacto": a.get("pct_contacto"), "aht": a.get("aht"),
                        "horas": round((a.get("login") or 0) / 3600, 1), "alertas": a.get("alertas") or [],
                        "dias_banda": a.get("dias_banda") or {}})
    agentes.sort(key=lambda a: (a["pct_conversacion"] is None, -(a["pct_conversacion"] or 0), a["nombre"] or ""))
    por_dia = [{"fecha": s.get("fecha"), "informe_id": s.get("informe_id"), "agentes": s.get("agentes"), "llamadas": s.get("llamadas"),
                "atendidas": s.get("atendidas"), "pct_conversacion": s.get("pct_conversacion"), "banda": s.get("banda"),
                "pct_contacto": s.get("pct_contacto"), "aht": s.get("aht"), "sesiones_abiertas": s.get("sesiones_abiertas")}
               for s in (ac or {}).get("dias") or []]
    meta = (p or {}).get("meta_min")
    return {
        "fuentes": [_fuente("productividad", id=r.id, periodo=r.fecha.strftime("%Y-%m"), fecha=r.fecha.isoformat(), status=r.status,
                            etiqueta=f"{r.fecha:%d/%m/%Y}", agentes=r.agentes, llamadas=r.llamadas, pct_conversacion=r.pct_conversacion,
                            banda=r.banda) for r in rows],
        "periodos": sorted({r.fecha.strftime("%Y-%m") for r in rows}),
        "desde": rows[0].fecha.isoformat(), "hasta": rows[-1].fecha.isoformat(), "dias": len(rows),
        "parametros": {x: (p or {}).get(x) for x in ("meta_min", "meta_max", "rojo")},
        "kpis": {"dias": len(rows), "agentes": k.get("agentes"), "agentes_por_dia": k.get("agentes_por_dia"), "llamadas": k.get("llamadas"),
                 "atendidas": k.get("atendidas"), "llamadas_por_dia": k.get("llamadas_por_dia"), "pct_conversacion": k.get("pct_conversacion"),
                 "banda": k.get("banda"), "pct_contacto": k.get("pct_contacto"), "aht": k.get("aht"), "bandas": k.get("bandas"),
                 "horas_conectadas": round((k.get("login") or 0) / 3600, 1), "meta_min": meta,
                 "dias_rojo": sum(1 for s in por_dia if s.get("banda") == "rojo"),
                 "dias_bajo_meta": sum(1 for s in por_dia if s.get("banda") in ("rojo", "bajo")),
                 "agentes_bajo_meta": sum(1 for a in agentes if a.get("banda") in ("rojo", "bajo") and (a.get("llamadas") or 0) >= 20),
                 "agentes_con_alertas": sum(1 for a in agentes if a.get("alertas"))},
        "por_dia": por_dia, "agentes": agentes[:MAX_LISTA],
    }


async def _cargar_sph(db: AsyncSession, ids: list[str]) -> dict[str, Any]:
    rows = (await db.execute(select(SphInforme).where(SphInforme.id.in_(ids)))).scalars().all()
    if len(rows) != len(ids):
        raise FuenteInvalida("Alguno de los informes de SPH elegidos ya no existe.")
    rows = sorted(rows, key=lambda r: (r.fecha, r.hasta or r.fecha))
    informes, avisos = [], []
    acc: dict[str, dict[str, Any]] = {}
    sin_agente: Counter = Counter()
    tot_ventas, tot_horas = 0, 0.0
    for r in rows:
        d = r.data or {}
        k = d.get("kpis") or {}
        hasta = r.hasta or r.fecha
        informes.append({"id": r.id, "desde": r.fecha.isoformat(), "hasta": hasta.isoformat(), "tipo": r.tipo or "dia", "status": r.status,
                         "sph": k.get("sph", r.sph), "ventas": k.get("ventas", r.ventas), "horas": round((k.get("horas") or 0) / 3600, 1),
                         "agentes": k.get("agentes", r.agentes), "vinculados": k.get("vinculados", r.vinculados),
                         "pct_cobertura": k.get("pct_cobertura", r.pct_cobertura), "ventas_sin_agente": k.get("ventas_sin_agente")})
        tot_ventas += k.get("ventas") or 0
        tot_horas += (k.get("horas") or 0) / 3600
        avisos.extend(f"{r.fecha:%d/%m}: {a}" for a in (d.get("avisos") or [])[:3])
        for a in d.get("agentes") or []:
            g = acc.setdefault(a.get("clave") or a.get("nombre"), {"agente": a.get("nombre"), "vendedor": a.get("vendedor"), "subcanal": a.get("subcanal"),
                                                                  "ventas": 0, "login": 0, "dias": 0, "llamadas": 0, "sesion_abierta": False})
            g["vendedor"] = g["vendedor"] or a.get("vendedor")
            g["ventas"] += a.get("ventas") or 0
            g["login"] += a.get("login") or 0
            g["dias"] += a.get("dias") or 0
            g["llamadas"] += a.get("llamadas") or 0
            g["sesion_abierta"] = g["sesion_abierta"] or bool(a.get("sesion_abierta"))
        for x in d.get("ventas_sin_agente") or []:
            sin_agente[x.get("vendedor") or "—"] += x.get("ventas") or 0
    agentes = []
    for g in acc.values():
        horas = round(g["login"] / 3600, 1)
        agentes.append({**{k: v for k, v in g.items() if k != "login"}, "horas": horas,
                        "sph": round(g["ventas"] / horas, 2) if horas and g["vendedor"] else None})
    agentes.sort(key=lambda a: (a["sph"] is None, -(a["sph"] or 0), -(a["ventas"] or 0), a["agente"] or ""))
    sph_op = round(tot_ventas / tot_horas, 2) if tot_horas else None
    con_sph = [a for a in agentes if a["sph"] is not None and a["horas"] >= 4]
    return {
        "fuentes": [_fuente("sph", id=i["id"], periodo=i["desde"][:7], fecha=i["desde"], status=i["status"],
                            etiqueta=f"{i['tipo'].capitalize()} {i['desde'][8:10]}/{i['desde'][5:7]}" + (f" al {i['hasta'][8:10]}/{i['hasta'][5:7]}" if i["hasta"] != i["desde"] else ""),
                            sph=i["sph"], ventas=i["ventas"], agentes=i["agentes"]) for i in informes],
        "periodos": sorted({i["desde"][:7] for i in informes}),
        "kpis": {"informes": len(informes), "sph": sph_op, "ventas": tot_ventas, "horas": round(tot_horas, 1), "agentes": len(agentes),
                 "vinculados": sum(1 for a in agentes if a["vendedor"]), "ventas_sin_agente": sum(sin_agente.values()),
                 "asesores_muy_sobre_media": sum(1 for a in con_sph if sph_op and a["sph"] >= 2 * sph_op),
                 "asesores_bajo_media": sum(1 for a in con_sph if sph_op and a["sph"] < 0.5 * sph_op)},
        "informes": informes, "agentes": agentes[:MAX_LISTA],
        "ventas_sin_agente": [{"vendedor": v, "ventas": n} for v, n in sin_agente.most_common(40)],
        "avisos": avisos[:12],
    }


async def _cargar_logistica(db: AsyncSession, ids: list[str]) -> dict[str, Any]:
    rows = (await db.execute(select(LogisticaInforme).where(LogisticaInforme.id.in_(ids)))).scalars().all()
    if len(rows) != len(ids):
        raise FuenteInvalida("Alguno de los cortes de Logística elegidos ya no existe.")
    rows = sorted(rows, key=lambda r: (r.period_month, r.fecha_corte))
    informes, vencidos, motivos_dev = [], [], Counter()
    vend: dict[str, dict[str, Any]] = {}
    tot = Counter()
    regiones: dict[str, dict[str, Any]] = {}
    for r in rows:
        d = r.data or {}
        k = d.get("kpis") or {}
        e = d.get("entregas") or {}
        informes.append({"id": r.id, "periodo": r.periodo, "fecha_corte": r.fecha_corte.isoformat(), "status": r.status,
                         "pedidos": r.pedidos, "entregados": r.entregados, "en_gestion": r.en_gestion, "devueltos": r.devueltos,
                         "pct_entregados": r.pct_entregados, "demora_prom": r.demora_prom, "demora_max": r.demora_max,
                         "entrega_prom": r.entrega_prom, "entrega_max": r.entrega_max, "entrega_pct_hasta_2": e.get("pct_hasta_2"),
                         "vencidos_6": (d.get("pendientes") or {}).get("vencidos_6"), "proyeccion": r.proyeccion})
        for key in ("pedidos", "entregados", "en_gestion", "devueltos"):
            tot[key] += getattr(r, key) or 0
        for v in d.get("vendedores") or []:
            g = vend.setdefault(clave_nombre(v.get("vendedor")), {"vendedor": v.get("vendedor"), "total": 0, "entregado": 0, "en_gestion": 0, "devuelto": 0})
            est = v.get("estados") or {}
            g["total"] += v.get("total") or 0
            g["entregado"] += est.get("ENTREGADO", 0) or 0
            g["en_gestion"] += est.get("EN GESTION", 0) or 0
            g["devuelto"] += est.get("DEVUELTO", 0) or 0
        for z in d.get("por_region") or []:
            g = regiones.setdefault(z.get("region"), {"region": z.get("region"), "total": 0, "entregado": 0, "en_gestion": 0, "devuelto": 0})
            est = z.get("estados") or {}
            g["total"] += z.get("total") or 0
            g["entregado"] += est.get("ENTREGADO", 0) or 0
            g["en_gestion"] += est.get("EN GESTION", 0) or 0
            g["devuelto"] += est.get("DEVUELTO", 0) or 0
        for p in (d.get("pendientes") or {}).get("lista") or []:
            if (p.get("dias") or 0) >= VENCIDO_DIAS:
                vencidos.append({**{x: p.get(x) for x in ("formulario", "cliente", "ciudad", "departamento", "region", "fecha", "dias", "vendedor", "motivo", "promocion")},
                                 "periodo": r.periodo, "fecha_corte": r.fecha_corte.isoformat()})
        for m in (d.get("motivos") or {}).get("DEVUELTO") or []:
            motivos_dev[m.get("motivo") or "—"] += m.get("total") or 0
    vendedores = sorted(vend.values(), key=lambda v: (-v["devuelto"], -v["en_gestion"], -v["total"], v["vendedor"] or ""))
    for v in vendedores:
        v["pct_entregado"] = _pct(v["entregado"], v["total"])
        v["pct_devuelto"] = _pct(v["devuelto"], v["total"])
    for g in regiones.values():
        g["pct_entregado"] = _pct(g["entregado"], g["total"])
    vencidos.sort(key=lambda p: (-(p["dias"] or 0), p["region"] or "", p["cliente"] or ""))
    return {
        "fuentes": [_fuente("logistica", id=i["id"], periodo=i["periodo"], fecha=i["fecha_corte"], status=i["status"],
                            etiqueta=f"{nombre_mes(i['periodo'])} · corte {i['fecha_corte'][8:10]}/{i['fecha_corte'][5:7]}/{i['fecha_corte'][:4]}",
                            pedidos=i["pedidos"], pct_entregados=i["pct_entregados"], en_gestion=i["en_gestion"]) for i in informes],
        "periodos": sorted({i["periodo"] for i in informes}),
        "kpis": {"cortes": len(informes), "pedidos": tot["pedidos"], "entregados": tot["entregados"], "en_gestion": tot["en_gestion"],
                 "devueltos": tot["devueltos"], "pct_entregados": _pct(tot["entregados"], tot["pedidos"]), "pct_devueltos": _pct(tot["devueltos"], tot["pedidos"]),
                 "vencidos": len(vencidos), "vencidos_11": sum(1 for p in vencidos if (p["dias"] or 0) >= 11),
                 "demora_prom": informes[-1]["demora_prom"] if informes else None, "entrega_prom": informes[-1]["entrega_prom"] if informes else None,
                 "vendedores_con_devoluciones": sum(1 for v in vendedores if v["devuelto"])},
        "informes": informes, "por_region": sorted(regiones.values(), key=lambda g: -g["total"]),
        "vendedores": vendedores[:MAX_LISTA], "pendientes_vencidos": vencidos[:MAX_LISTA],
        "motivos_devueltos": [{"motivo": m, "total": n} for m, n in motivos_dev.most_common(15)],
    }


async def _cargar_supervision(db: AsyncSession, periodos: list[str], user: CurrentUser) -> dict[str, Any]:
    for per in periodos:
        if not re.fullmatch(r"\d{4}-\d{2}", per):
            raise FuenteInvalida(f"Mes de Supervisión inválido: {per}.")
    periodos = sorted(set(periodos))
    nombres = {u.id: u.full_name for u in (await db.execute(select(User))).scalars().all()}
    ops = {o.id: o.nombre for o in (await db.execute(select(Operador))).scalars().all()}
    horario = horario_de(await sup_parametros(db))
    ahora = datetime.now(timezone.utc)
    hoy = coaching_srv.hoy() if hasattr(coaching_srv, "hoy") else date.today()
    meses, alertas_l, coach_l, tickets_l = [], [], [], []
    tot = Counter()
    for per in periodos:
        desde, hasta = _rango_mes(per)
        try:
            res = await sup_api.resumen(periodo=per, user=user, db=db)
        except Exception:  # noqa: BLE001 — sin objetivos cargados u otro mes sin datos: se congela lo que hay
            res = {}
        op = res.get("operacion") or {}
        sups = [{"nombre": s.get("nombre"), "asesores": s.get("asesores"), "objetivo": s.get("objetivo"),
                 "pospago": {k: (s.get("pospago") or {}).get(k) for k in ("vendido", "objetivo", "proyeccion", "pct_objetivo", "estado", "falta")},
                 "gpon": {k: (s.get("gpon") or {}).get(k) for k in ("vendido", "objetivo", "proyeccion", "pct_objetivo", "estado", "falta")},
                 "critico": s.get("critico"), "asesores_en_alerta": s.get("asesores_en_alerta")} for s in res.get("supervisores") or []]
        alertas = (await db.execute(select(AlertaAsesor).where(AlertaAsesor.periodo == per))).scalars().all()
        coachings = (await db.execute(select(Coaching).where(Coaching.fecha >= desde, Coaching.fecha <= hasta))).scalars().all()
        tickets = (await db.execute(select(Ticket).where(
            Ticket.created_at >= datetime.combine(desde, datetime.min.time(), tzinfo=timezone.utc),
            Ticket.created_at < datetime.combine(hasta + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)))).scalars().all()
        c_estado = Counter(c.estado for c in coachings)
        c_seg = Counter(coaching_srv.estado_seguimiento(c, hoy) for c in coachings)
        c_res = Counter(c.resultado for c in coachings if c.resultado)
        t_estado = Counter(t.estado for t in tickets)
        t_sla = []
        for t in tickets:
            try:
                t_sla.append(estado_sla(t, horario, ahora).get("cumple"))
            except Exception:  # noqa: BLE001
                t_sla.append(None)
        meses.append({
            "periodo": per, "nombre": nombre_mes(per),
            "operacion": {k: op.get(k) for k in ("netas", "asesores_en_alerta", "asesores_en_alerta_sin_supervisor", "a_recuperar",
                                                 "supervisores_criticos", "supervisores")},
            "pospago": {k: (op.get("pospago") or {}).get(k) for k in ("vendido", "objetivo", "proyeccion", "pct_objetivo", "estado", "falta")},
            "gpon": {k: (op.get("gpon") or {}).get(k) for k in ("vendido", "objetivo", "proyeccion", "pct_objetivo", "estado", "falta")},
            "supervisores": sups,
            "alertas": {"total": len(alertas), "abiertas": sum(1 for a in alertas if a.hasta is None), "por_tipo": dict(Counter(a.tipo for a in alertas))},
            "coaching": {"total": len(coachings) - c_estado.get("pendiente", 0), "sin_firmar": c_estado.get("pendiente", 0),
                         "firmados": sum(1 for c in coachings if c.firmado_at), "abiertos": c_estado.get("abierto", 0), "cerrados": c_estado.get("cerrado", 0),
                         "anulados": c_estado.get("anulado", 0), "seguimiento_vencido": c_seg.get("vencido", 0), "seguimiento_tarde": c_seg.get("tarde", 0),
                         "fuera_de_termino": sum(1 for c in coachings if c.fuera_de_termino), "resultado": dict(c_res)},
            "tickets": {"total": len(tickets), "por_estado": dict(t_estado), "por_tipo": dict(Counter(t.tipo for t in tickets)),
                        "fuera_de_sla": sum(1 for x in t_sla if x is False), "cumplidos": sum(1 for x in t_sla if x is True)},
        })
        tot["alertas"] += len(alertas)
        tot["alertas_abiertas"] += sum(1 for a in alertas if a.hasta is None)
        tot["coachings"] += len(coachings)
        tot["coaching_vencidos"] += c_seg.get("vencido", 0)
        tot["tickets"] += len(tickets)
        tot["tickets_fuera_sla"] += sum(1 for x in t_sla if x is False)
        tot["asesores_en_alerta"] += op.get("asesores_en_alerta") or 0
        alertas_l.extend({"periodo": per, "operador": ops.get(a.operador_id, a.operador_id), "tipo": a.tipo, "desde": _iso(a.desde),
                          "hasta": _iso(a.hasta), "abierta": a.hasta is None, "datos": {k: v for k, v in (a.datos or {}).items() if k in ("pospago", "sin_uso", "pct_sin_uso", "con_uso")}}
                         for a in alertas)
        coach_l.extend({"periodo": per, "fecha": _iso(c.fecha), "supervisor": nombres.get(c.supervisor_id, c.supervisor_id), "operador": ops.get(c.operador_id, c.operador_id),
                        "tipo": c.tipo, "metrica": c.metrica, "estado": c.estado, "seguimiento": coaching_srv.estado_seguimiento(c, hoy),
                        "seguimiento_fecha": _iso(c.seguimiento_fecha), "resultado": c.resultado, "fuera_de_termino": c.fuera_de_termino}
                       for c in coachings)
        tickets_l.extend({"periodo": per, "numero": t.numero, "tipo": t.tipo, "prioridad": t.prioridad, "estado": t.estado,
                          "supervisor": nombres.get(t.supervisor_id, t.supervisor_id), "operador": ops.get(t.operador_id) if t.operador_id else None,
                          "creado": _iso(t.created_at), "resuelto": _iso(t.resuelto_at), "cumple_sla": s}
                         for t, s in zip(tickets, t_sla))
    alertas_l.sort(key=lambda a: (not a["abierta"], a["desde"] or ""), reverse=False)
    coach_l.sort(key=lambda c: (c["seguimiento"] != "vencido", c["fecha"] or ""))
    tickets_l.sort(key=lambda t: (t["cumple_sla"] is not False, t["creado"] or ""))
    return {
        "fuentes": [_fuente("supervision", id=m["periodo"], periodo=m["periodo"], fecha=_rango_mes(m["periodo"])[0].isoformat(), status="published",
                            etiqueta=m["nombre"].capitalize(), alertas=m["alertas"]["total"], coachings=m["coaching"]["total"], tickets=m["tickets"]["total"])
                    for m in meses],
        "periodos": periodos,
        "kpis": {"meses": len(meses), **{k: tot[k] for k in ("alertas", "alertas_abiertas", "coachings", "coaching_vencidos", "tickets",
                                                            "tickets_fuera_sla", "asesores_en_alerta")}},
        "meses": meses, "alertas": alertas_l[:MAX_LISTA], "coachings": coach_l[:MAX_LISTA], "tickets": tickets_l[:MAX_LISTA],
    }


async def _cargar_informe_diario(db: AsyncSession, periodos: list[str]) -> dict[str, Any]:
    for per in periodos:
        if not re.fullmatch(r"\d{4}-\d{2}", per):
            raise FuenteInvalida(f"Mes de Informe diario inválido: {per}.")
    periodos = sorted(set(periodos))
    hoy = hoy_inf()
    meses, informes_l, compromisos_l = [], [], []
    tot = Counter()
    for per in periodos:
        desde, hasta = _rango_mes(per)
        infs = (await db.execute(select(InformeDiario).where(InformeDiario.fecha >= desde, InformeDiario.fecha <= hasta)
                                 .order_by(InformeDiario.fecha, InformeDiario.autor_nombre))).scalars().all()
        comps = (await db.execute(select(InformeCompromiso).where(InformeCompromiso.fecha >= desde, InformeCompromiso.fecha <= hasta))).scalars().all()
        try:
            panel = await inf_seguimiento.panel(db, desde=desde, hasta=min(hasta, hoy))
        except Exception:  # noqa: BLE001 — el mes todavía no empezó u otro caso raro: sin cumplimiento
            panel = {}
        autores = [{"nombre": a.get("nombre"), "cargo": a.get("cargo"), "firmados": a.get("firmados"), "esperados": a.get("esperados"), "pct": a.get("pct"),
                    "dias_sin_informe": [d.get("fecha") for d in a.get("dias") or [] if d.get("estado") in ("falta", "borrador")]}
                   for a in panel.get("autores") or []]
        firmados = [i for i in infs if i.estado == FIRMADO]
        criticas = sum(1 for i in firmados for m in (i.metricas or []) if (m or {}).get("estado") == "critico")
        vencidos = [c for c in comps if c.estado == COMP_ABIERTO and c.fecha_limite and c.fecha_limite < hoy]
        meses.append({"periodo": per, "nombre": nombre_mes(per), "informes": len(infs), "firmados": len(firmados),
                      "borradores": sum(1 for i in infs if i.estado != FIRMADO), "autores": len({i.autor_id for i in infs}),
                      "metricas_criticas": criticas, "compromisos": len(comps), "compromisos_abiertos": sum(1 for c in comps if c.estado == COMP_ABIERTO),
                      "compromisos_vencidos": len(vencidos), "compromisos_no_cumplidos": sum(1 for c in comps if c.estado == "no_cumplido"),
                      "cumplimiento": autores, "dias_sin_informe": sum(len(a["dias_sin_informe"]) for a in autores)})
        tot["informes"] += len(infs)
        tot["firmados"] += len(firmados)
        tot["metricas_criticas"] += criticas
        tot["compromisos_abiertos"] += sum(1 for c in comps if c.estado == COMP_ABIERTO)
        tot["compromisos_vencidos"] += len(vencidos)
        tot["dias_sin_informe"] += sum(len(a["dias_sin_informe"]) for a in autores)
        informes_l.extend({"periodo": per, "id": i.id, "fecha": _iso(i.fecha), "autor": i.autor_nombre, "cargo": i.autor_cargo, "estado": i.estado,
                           "pospago": ((i.resultados or {}).get("pospago") or {}).get("valor"), "gpon": ((i.resultados or {}).get("gpon") or {}).get("valor"),
                           "resumen": (i.resumen or "")[:240],
                           "criticas": [{"nombre": m.get("nombre"), "indicador": m.get("indicador"), "compromiso": (m.get("compromiso") or "")[:160]}
                                        for m in (i.metricas or []) if (m or {}).get("estado") == "critico"][:6],
                           "firmado_at": _iso(i.firmado_at)} for i in firmados)
        compromisos_l.extend({"periodo": per, "fecha": _iso(c.fecha), "autor": nombres_autor(c, infs), "metrica": c.metrica, "texto": (c.texto or "")[:200],
                              "responsable": c.responsable, "fecha_limite": _iso(c.fecha_limite), "estado": c.estado,
                              "vencido": c.estado == COMP_ABIERTO and bool(c.fecha_limite) and c.fecha_limite < hoy}
                             for c in sorted(comps, key=lambda c: (c.estado != COMP_ABIERTO, c.fecha_limite or date.max)))
    return {
        "fuentes": [_fuente("informe_diario", id=m["periodo"], periodo=m["periodo"], fecha=_rango_mes(m["periodo"])[0].isoformat(), status="published",
                            etiqueta=m["nombre"].capitalize(), firmados=m["firmados"], autores=m["autores"]) for m in meses],
        "periodos": periodos,
        "kpis": {"meses": len(meses), **{k: tot[k] for k in ("informes", "firmados", "metricas_criticas", "compromisos_abiertos", "compromisos_vencidos", "dias_sin_informe")}},
        "meses": meses, "informes": informes_l[:MAX_LISTA], "compromisos": compromisos_l[:COMPROMISO_LISTA],
    }


def nombres_autor(c: InformeCompromiso, infs: list[InformeDiario]) -> str | None:
    return next((i.autor_nombre for i in infs if i.autor_id == c.autor_id), None)


# ------------------------------------------------------------------ cruce por vendedor (lo usa el snapshot)
def cruce_vendedores(ranking: list[dict[str, Any]], modulos: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Para cada vendedor riesgoso de Ventas Netas, lo que dicen de él las otras fuentes (por nombre normalizado)."""
    sph = {clave_nombre(a.get("vendedor")): a for a in (modulos.get("sph") or {}).get("agentes") or [] if a.get("vendedor")}
    log = {clave_nombre(v.get("vendedor")): v for v in (modulos.get("logistica") or {}).get("vendedores") or []}
    sup = modulos.get("supervision") or {}
    alertas = Counter(clave_nombre(a.get("operador")) for a in sup.get("alertas") or [])
    coach = Counter(clave_nombre(c.get("operador")) for c in sup.get("coachings") or [])
    tickets = Counter(clave_nombre(t.get("operador")) for t in sup.get("tickets") or [] if t.get("operador"))
    sph_op = ((modulos.get("sph") or {}).get("kpis") or {}).get("sph")
    out = []
    for v in ranking:
        if v.get("nivel") == "normal":
            continue
        k = clave_nombre(v.get("vendedor"))
        s, lg = sph.get(k), log.get(k)
        fila = {"vendedor": v.get("vendedor"), "nivel": v.get("nivel"), "netas": v.get("netas"), "sin_uso": v.get("sin_uso"),
                "pct_sin_uso": v.get("pct_sin_uso"),
                "sph": {"sph": s.get("sph"), "ventas": s.get("ventas"), "horas": s.get("horas"), "agente": s.get("agente"),
                        "sobre_media": bool(sph_op and s.get("sph") and s["sph"] >= 2 * sph_op)} if s else None,
                "logistica": {k2: lg.get(k2) for k2 in ("total", "entregado", "en_gestion", "devuelto", "pct_entregado", "pct_devuelto")} if lg else None,
                "supervision": {"alertas": alertas.get(k, 0), "coachings": coach.get(k, 0), "tickets": tickets.get(k, 0)} if sup else None}
        fila["senales"] = []
        if fila["sph"] and fila["sph"]["sobre_media"]:
            fila["senales"].append(f"SPH {fila['sph']['sph']} con {fila['sph']['horas']} h conectadas: el doble o más de la operación ({sph_op})")
        if fila["sph"] and s.get("sesion_abierta"):
            fila["senales"].append("sesiones abiertas en Productividad: sus horas no son reales")
        if lg and (lg.get("devuelto") or 0) >= 2 and (lg.get("pct_devuelto") or 0) >= 20:
            fila["senales"].append(f"{lg['devuelto']} de {lg['total']} pedidos devueltos ({lg['pct_devuelto']}%)")
        if sup and not alertas.get(k) and not coach.get(k):
            fila["senales"].append("sin alerta ni coaching en Supervisión en el período")
        if sup and coach.get(k):
            fila["senales"].append(f"{coach[k]} coaching(s) registrados")
        out.append(fila)
    return out
