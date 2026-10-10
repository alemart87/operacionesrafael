"""Datos de la plataforma que se importan al informe diario. Los calcula el servidor y quedan congelados en el
informe: lo que se ve (y sale en el PDF) es lo que había al importarlos. Cada fuente exige el permiso de su módulo.

- llamadas: Productividad de llamadas del día (el informe que llega más lejos en el día, como lo lee el SPH).
- cargas: ventas cargadas en el día según la planilla de netas más nueva del mes (Pospago, GPON e IPTV), con las
  netas del mes. Con estas se puede completar la zona manual de resultados.
- proyeccion: objetivos, avance y proyección al cierre del mes (Supervisión), por supervisor.
- coaching: coachings registrados en el día, seguimientos hechos y vencidos (Supervisión).
"""
from __future__ import annotations

import uuid
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser
from ..fuentes import informes_productividad, informes_ventas
from ..productividad.models import ESTADO_PUBLICADO as PROD_PUBLICADO
from ..supervision import api as sup_api
from ..supervision import coaching as coaching_srv
from ..supervision.models import OPERATIVA as SUP_OPERATIVA
from ..supervision.models import Coaching
from ..ventas_netas.models import ESTADO_PUBLICADO as VN_PUBLICADO

ZONA = ZoneInfo("America/Asuncion")
DIAS_ATRAS = 7          # opciones de días anteriores que se ofrecen para importar
TC = "televentas_claro"
PERMISO = {"llamadas": f"{TC}.productividad", "cargas": f"{TC}.ventas_netas", "proyeccion": f"{TC}.supervision",
           "coaching": f"{TC}.supervision"}
TITULO = {
    "llamadas": "Productividad de llamadas",
    "cargas": "Ventas del día (planilla de netas)",
    "proyeccion": "Objetivos y proyección del mes",
    "coaching": "Coaching del día",
}
DESCRIPCION = {
    "llamadas": "Agentes, horas conectadas, % de conversación, llamadas, contacto, AHT y alertas del día.",
    "cargas": "Pospago, GPON e IPTV cargados en el día y las netas del mes. Sirve para completar los resultados.",
    "proyeccion": "Avance contra el objetivo y cierre proyectado de Pospago y GPON, de la operación y por supervisor.",
    "coaching": "Coachings registrados en el día, seguimientos hechos con su resultado y seguimientos vencidos.",
}
DIAS = ("lun", "mar", "mié", "jue", "vie", "sáb", "dom")
MESES = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
         "noviembre", "diciembre")


class FuenteNoDisponible(ValueError):
    """No hay datos para importar (el mensaje es para el usuario)."""


# ------------------------------------------------------------------ formato (es-PY)
def num(x: float | int | None, nd: int = 0) -> str:
    if x is None:
        return "—"
    s = f"{x:,.{nd}f}"
    return s.replace(",", "§").replace(".", ",").replace("§", ".")


def pct(x: float | None, nd: int = 1) -> str:
    return "—" if x is None else f"{num(x, nd)}%"


def dia_corto(d: date) -> str:
    return f"{DIAS[d.weekday()]} {d:%d/%m}"


def mes_nombre(periodo: str) -> str:
    y, m = periodo.split("-")
    return f"{MESES[int(m) - 1]} {y}"


def _dur(seg: float | None) -> str:
    if seg is None:
        return "—"
    seg = int(round(seg))
    return f"{seg // 60}:{seg % 60:02d}"


def _kpi(label: str, valor: str, detalle: str | None = None, tono: str = "neutro") -> dict[str, Any]:
    return {"label": label, "valor": valor, "detalle": detalle, "tono": tono}


def _snapshot(tipo: str, subtitulo: str, kpis: list[dict[str, Any]], *, fecha: str, estado: str | None = None,
              aviso: str | None = None, filas: dict[str, Any] | None = None, url: str | None = None,
              valores: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"id": uuid.uuid4().hex[:12], "tipo": tipo, "titulo": TITULO[tipo], "subtitulo": subtitulo, "fecha": fecha,
            "estado": estado, "aviso": aviso, "kpis": kpis, "filas": filas, "url": url, "valores": valores or {},
            "importado_at": datetime.now(timezone.utc).isoformat()}


# ------------------------------------------------------------------ llamadas (Productividad)
_TONO_BANDA = {"rojo": "malo", "bajo": "atencion", "meta": "bueno", "sobre": "atencion"}
_BANDA = {"rojo": "en rojo", "bajo": "bajo la meta", "meta": "en la meta", "sobre": "sobre la meta"}


async def _opciones_llamadas(db: AsyncSession, fecha: date) -> list[dict[str, Any]]:
    infs = await informes_productividad(db, fecha - timedelta(days=DIAS_ATRAS), fecha, con_datos=False)
    return [{"ref": d.isoformat(), "label": f"{dia_corto(d)} · corte {r.corte_final or '—'}",
             "estado": "publicado" if r.status == PROD_PUBLICADO else "borrador",
             "detalle": f"{num(r.agentes)} agentes · {num(r.llamadas)} llamadas · {pct(r.pct_conversacion)} de conversación"}
            for d, r in sorted(infs.items(), reverse=True)]


async def _llamadas(db: AsyncSession, dia: date) -> dict[str, Any]:
    r = (await informes_productividad(db, dia, dia)).get(dia)
    if not r or not r.data:
        raise FuenteNoDisponible(f"No hay informe de llamadas del {dia_corto(dia)}")
    data = r.data
    k = data.get("kpis") or {}
    bandas = k.get("bandas") or {}
    turnos = data.get("turnos") or {}
    kpis = [
        _kpi("Agentes", num(k.get("agentes")), f"{num(k.get('agentes_validos'))} con jornada válida"),
        _kpi("Horas conectadas", f"{num((k.get('login') or 0) / 3600)} h"),
        _kpi("% conversación", pct(k.get("pct_conversacion")), _BANDA.get(k.get("banda") or "", None),
             _TONO_BANDA.get(k.get("banda") or "", "neutro")),
        _kpi("Llamadas", num(k.get("llamadas")), f"{num(k.get('atendidas'))} con contacto"),
        _kpi("% contacto", pct(k.get("pct_contacto"))),
        _kpi("AHT", _dur(k.get("aht")), "minutos por gestión"),
        _kpi("Llamadas por hora", num(k.get("llamadas_hora"), 1)),
        _kpi("% pausa", pct(k.get("pct_pausa"))),
        _kpi("Agentes en rojo", num(bandas.get("rojo")), "menos del 25% de conversación",
             "malo" if bandas.get("rojo") else "neutro"),
        _kpi("Alertas", num(len(data.get("alertas") or [])), f"{num(len(data.get('sin_conexion') or []))} sin conexión",
             "atencion" if data.get("alertas") else "neutro"),
    ]
    filas = None
    if turnos.get("determinado") and turnos.get("manana") and turnos.get("tarde"):
        filas = {"columnas": ["Turno", "Agentes", "Llamadas", "% conversación"], "filas": [
            [nombre, num(t.get("agentes")), num(t.get("llamadas")), pct(t.get("pct_conversacion"))]
            for nombre, t in (("Mañana", turnos["manana"]), ("Tarde", turnos["tarde"]))]}
    borrador = r.status != PROD_PUBLICADO
    return _snapshot("llamadas", f"Informe del {dia_corto(dia)} · corte {r.corte_final or '—'}", kpis, fecha=dia.isoformat(),
                     estado="borrador" if borrador else "publicado",
                     aviso="El informe de ese día todavía es un borrador: puede cambiar." if borrador else None,
                     filas=filas, url=f"/televentas-claro/productividad/{r.id}")


# ------------------------------------------------------------------ cargas del día (planilla de netas)
async def _reporte_ventas(db: AsyncSession, periodo: str):
    return (await informes_ventas(db, {periodo})).get(periodo)


def _por_dia(r) -> dict[str, dict[str, Any]]:
    return {f.get("dia"): f for f in ((r.data or {}).get("productividad") or {}).get("por_dia") or [] if f.get("dia")}


async def _opciones_cargas(db: AsyncSession, fecha: date) -> list[dict[str, Any]]:
    out = []
    for periodo in sorted({fecha.strftime("%Y-%m"), (fecha - timedelta(days=DIAS_ATRAS)).strftime("%Y-%m")}, reverse=True):
        r = await _reporte_ventas(db, periodo)
        if not r:
            continue
        dias = _por_dia(r)
        for k in range(DIAS_ATRAS + 1):
            d = fecha - timedelta(days=k)
            f = dias.get(d.isoformat())
            if f and d.strftime("%Y-%m") == periodo:
                planilla = f" · planilla al {r.fecha_dato:%d/%m}" if r.fecha_dato else ""
                out.append({"ref": d.isoformat(), "label": dia_corto(d),
                            "estado": "publicado" if r.status == VN_PUBLICADO else "borrador",
                            "detalle": f"{num(f.get('pospago'))} Pospago · {num(f.get('internet'))} GPON{planilla}",
                            "pospago": f.get("pospago") or 0, "gpon": f.get("internet") or 0})
    return sorted(out, key=lambda x: x["ref"], reverse=True)


async def _cargas(db: AsyncSession, dia: date) -> dict[str, Any]:
    r = await _reporte_ventas(db, dia.strftime("%Y-%m"))
    if not r:
        raise FuenteNoDisponible(f"No hay planilla de netas de {mes_nombre(dia.strftime('%Y-%m'))}")
    f = _por_dia(r).get(dia.isoformat())
    if not f:
        hasta = f" (llega al {r.fecha_dato:%d/%m})" if r.fecha_dato else ""
        raise FuenteNoDisponible(f"La planilla de netas más nueva no tiene cargas del {dia_corto(dia)}{hasta}")
    k = ((r.data or {}).get("productividad") or {}).get("kpis") or {}
    kpis = [
        _kpi("Pospago", num(f.get("pospago")), "cargadas en el día"),
        _kpi("GPON", num(f.get("internet")), "cargadas en el día"),
        _kpi("IPTV", num(f.get("iptv"))),
        _kpi("Total del día", num(f.get("total")), f"{num(f.get('finalizadas'))} finalizadas ({pct(f.get('pct_finalizacion'))})"),
        _kpi("Netas Pospago del mes", num(r.pospago), f"al {r.fecha_dato:%d/%m}" if r.fecha_dato else None),
        _kpi("Netas GPON del mes", num(r.gpon)),
        _kpi("% sin uso (Pospago)", pct(r.pct_sin_uso), f"{num(r.pospago_sin_uso)} líneas sin uso",
             "malo" if (r.pct_sin_uso or 0) >= 10 else "neutro"),
        _kpi("Promedio diario de cargas", num(k.get("promedio_diario"), 1), f"{num(k.get('dias_con_cargas'))} días con cargas"),
    ]
    borrador = r.status != VN_PUBLICADO
    return _snapshot("cargas", f"Cargas del {dia_corto(dia)} · planilla al {r.fecha_dato:%d/%m}" if r.fecha_dato else f"Cargas del {dia_corto(dia)}",
                     kpis, fecha=dia.isoformat(), estado="borrador" if borrador else "publicado",
                     aviso="La planilla de ese mes todavía es un borrador: puede cambiar." if borrador else None,
                     url=f"/televentas-claro/ventas-netas/{r.id}",
                     valores={"pospago": f.get("pospago") or 0, "gpon": f.get("internet") or 0, "iptv": f.get("iptv") or 0})


# ------------------------------------------------------------------ objetivos y proyección (Supervisión)
_TONO_ESTADO = {"en_camino": "bueno", "en_riesgo": "atencion", "bajo_objetivo": "malo"}
_ESTADO = {"en_camino": "en camino", "en_riesgo": "en riesgo", "bajo_objetivo": "bajo el objetivo", "sin_objetivo": "sin objetivo",
           "sin_datos": "sin datos"}


def _proy(nombre: str, x: dict[str, Any]) -> list[dict[str, Any]]:
    obj = x.get("objetivo")
    return [
        _kpi(f"{nombre}: vendido", num(x.get("vendido")), f"de {num(obj)} ({pct(x.get('pct_logro'))})" if obj else "sin objetivo"),
        _kpi(f"{nombre}: proyección", num(x.get("proyeccion")),
             f"{pct(x.get('pct_proyeccion'))} del objetivo · {_ESTADO.get(x.get('estado'), '')}" if obj else _ESTADO.get(x.get("estado"), ""),
             _TONO_ESTADO.get(x.get("estado"), "neutro")),
    ]


async def _proyeccion(db: AsyncSession, periodo: str, user: CurrentUser) -> dict[str, Any]:
    d = await sup_api.resumen(periodo=periodo, user=user, db=db)
    op = d["operacion"]
    if op["pospago"].get("vendido") is None and op["gpon"].get("vendido") is None:
        raise FuenteNoDisponible(f"Todavía no hay ventas de {mes_nombre(periodo)} para proyectar")
    kpis = [*_proy("Pospago", op["pospago"]), *_proy("GPON", op["gpon"]),
            _kpi("Supervisores en crítico", num(op.get("supervisores_criticos")), f"de {num(op.get('supervisores'))}",
                 "malo" if op.get("supervisores_criticos") else "neutro"),
            _kpi("Asesores en alerta", num(op.get("asesores_en_alerta")), f"{num(op.get('a_recuperar'))} líneas a recuperar",
                 "atencion" if op.get("asesores_en_alerta") else "neutro")]
    filas = {"columnas": ["Supervisor", "Pospago", "Proy. Pospago", "GPON", "Proy. GPON"], "filas": [
        [f["nombre"], f"{num(f['pospago'].get('vendido'))} / {num(f['pospago'].get('objetivo'))}", pct(f["pospago"].get("pct_proyeccion")),
         f"{num(f['gpon'].get('vendido'))} / {num(f['gpon'].get('objetivo'))}", pct(f["gpon"].get("pct_proyeccion"))]
        for f in d["supervisores"] if f.get("asesores") or f.get("objetivo", {}).get("pospago")][:20]}
    provisoria = op["pospago"].get("provisoria") or op["gpon"].get("provisoria")
    corte = (d.get("calendario") or {}).get("corte")
    if isinstance(corte, str):
        corte = date.fromisoformat(corte[:10])
    subtitulo = mes_nombre(periodo).capitalize() + (f" · ventas al {dia_corto(corte)}" if isinstance(corte, date) else "")
    return _snapshot("proyeccion", subtitulo, kpis, fecha=periodo, filas=filas, url="/televentas-claro/supervision",
                     aviso="Proyección provisoria: todavía hay pocos días hábiles transcurridos." if provisoria else None)


# ------------------------------------------------------------------ coaching del día (Supervisión)
def _bordes(dia: date) -> tuple[datetime, datetime]:
    ini = datetime.combine(dia, time.min, tzinfo=ZONA).astimezone(timezone.utc)
    return ini, ini + timedelta(days=1)


async def _coaching(db: AsyncSession, dia: date) -> dict[str, Any]:
    ini, fin = _bordes(dia)
    cs = (await db.execute(select(Coaching).where(
        Coaching.operativa == SUP_OPERATIVA, Coaching.estado != "anulado",
        or_(Coaching.fecha == dia, and_(Coaching.seguimiento_at >= ini, Coaching.seguimiento_at < fin))))).scalars().all()
    del_dia = [c for c in cs if c.fecha == dia]
    seguidos = [c for c in cs if c.seguimiento_at and ini <= (c.seguimiento_at if c.seguimiento_at.tzinfo else c.seguimiento_at.replace(tzinfo=timezone.utc)) < fin]
    abiertos = (await db.execute(select(Coaching).where(Coaching.operativa == SUP_OPERATIVA, Coaching.estado == "abierto",
                                                        Coaching.seguimiento_fecha < dia))).scalars().all()
    vencidos = sum(1 for c in abiertos if coaching_srv.estado_seguimiento(c, dia) == "vencido")
    metricas = Counter(m for c in del_dia for m in coaching_srv.metricas_de(c))
    res = Counter(c.resultado or "sin_datos" for c in seguidos)
    nombres = coaching_srv.NOMBRE_METRICA
    if not del_dia and not seguidos and not vencidos:
        raise FuenteNoDisponible(f"No hay coachings ni seguimientos del {dia_corto(dia)}")
    kpis = [
        _kpi("Coachings del día", num(len(del_dia)), f"{num(len({c.operador_id for c in del_dia}))} asesores · "
                                                     f"{num(len({c.supervisor_id for c in del_dia}))} supervisores"),
        _kpi("Métricas trabajadas", " · ".join(f"{nombres[m]} {n}" for m, n in metricas.most_common()) or "—"),
        _kpi("Seguimientos hechos", num(len(seguidos)),
             " · ".join(f"{coaching_srv.NOMBRE_RESULTADO[r]} {n}" for r, n in res.most_common()) or None),
        _kpi("Seguimientos vencidos", num(vencidos), "de toda la operación", "malo" if vencidos else "neutro"),
    ]
    return _snapshot("coaching", f"Coaching del {dia_corto(dia)}", kpis, fecha=dia.isoformat(),
                     url="/televentas-claro/supervision/coaching/registro")


# ------------------------------------------------------------------ lo que se ofrece y la importación
async def fuentes(db: AsyncSession, user: CurrentUser, fecha: date) -> list[dict[str, Any]]:
    out = []
    for tipo in ("llamadas", "cargas", "proyeccion", "coaching"):
        x = {"tipo": tipo, "titulo": TITULO[tipo], "descripcion": DESCRIPCION[tipo], "permiso": user.has_perm(PERMISO[tipo]),
             "opciones": []}
        if x["permiso"]:
            if tipo == "llamadas":
                x["opciones"] = await _opciones_llamadas(db, fecha)
            elif tipo == "cargas":
                x["opciones"] = await _opciones_cargas(db, fecha)
            elif tipo == "proyeccion":
                periodo = fecha.strftime("%Y-%m")
                x["opciones"] = [{"ref": periodo, "label": mes_nombre(periodo).capitalize(), "estado": None, "detalle": None}]
            else:
                x["opciones"] = [{"ref": fecha.isoformat(), "label": dia_corto(fecha), "estado": None, "detalle": None}]
        out.append(x)
    return out


async def importar(db: AsyncSession, user: CurrentUser, tipo: str, ref: str) -> dict[str, Any]:
    if tipo not in PERMISO:
        raise FuenteNoDisponible("Fuente desconocida")
    if not user.has_perm(PERMISO[tipo]):
        raise PermissionError(TITULO[tipo])
    if tipo == "proyeccion":
        try:
            datetime.strptime(ref, "%Y-%m")
        except ValueError as exc:
            raise FuenteNoDisponible("Mes inválido") from exc
        return await _proyeccion(db, ref, user)
    try:
        dia = date.fromisoformat(ref)
    except ValueError as exc:
        raise FuenteNoDisponible("Fecha inválida") from exc
    if tipo == "llamadas":
        return await _llamadas(db, dia)
    if tipo == "cargas":
        return await _cargas(db, dia)
    return await _coaching(db, dia)
