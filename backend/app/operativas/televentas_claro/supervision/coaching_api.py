"""API de coaching y bitácora — Televentas Claro (modelo Líder Coach Comercial, fase 3).

* Portal del supervisor (`televentas_claro.portal_supervisor`): registra coachings a los asesores que
  tenía en su equipo ese día, su seguimiento, aclaraciones y notas de bitácora. Ve solo lo suyo.
* Jefes (`televentas_claro.supervision`): ven lo de cada supervisor, sin poder cambiarlo.

Las reglas del registro están en `coaching.py`; la gestión que suma al scoring, en `scoring.py`.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from ....api.deps import CurrentUser, client_ip
from ....core.database import get_db
from ....services.audit_service import record_action
from . import alertas as alertas_srv
from . import api as sup
from . import coaching as srv
from . import operadores as maestro
from .calculo import mes_de, supervisor_en
from .impacto import METRICAS as METRICAS_ORDEN
from .models import OPERATIVA, BitacoraNota, Coaching, Operador

router = APIRouter(prefix="/televentas-claro/supervision", tags=["televentas-claro · coaching"])

Tipo = Literal["diario", "semanal", "mensual"]
Metrica = Literal["pospago", "gpon", "uso", "conversacion", "otra"]
TipoNota = Literal["novedad", "ausencia", "incidencia", "reconocimiento", "otro"]

REGLAS = {
    "horas_edicion": srv.HORAS_EDICION, "dias_termino": srv.DIAS_TERMINO, "dias_seguimiento_max": srv.DIAS_SEGUIMIENTO_MAX,
    "seguimiento_sugerido": srv.SEGUIMIENTO_SUGERIDO, "min_texto": srv.MIN_TEXTO, "max_texto": srv.MAX_TEXTO,
}


def _regla(exc: srv.ReglaInvalida) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


# ------------------------------------------------------------------ alertas de uso con su plazo
def _alertas_de(ctx: sup.Contexto, sid: str, dia: date) -> list[dict[str, Any]]:
    return alertas_srv.del_supervisor(ctx.alertas, sid, p=ctx.p, tramos=ctx.tramos, ref=ctx.ref, primero=ctx.primero,
                                      coachings=ctx.coachings, hoy=dia, nombres={i: o.nombre for i, o in ctx.ops.items()})


# ------------------------------------------------------------------ vista del mes de un supervisor
async def _vista(db: AsyncSession, periodo: str, sid: str, *, portal: bool) -> dict[str, Any]:
    ctx = await sup.contexto(db, periodo)
    dia, momento = sup.hoy(), srv.ahora()
    cs = await srv.del_supervisor(db, sid, periodo)
    pendientes = await srv.abiertos(db, sid)
    notas = await srv.notas(db, sid, periodo)
    faltan = {c.operador_id for c in [*cs, *pendientes] if c.operador_id not in ctx.ops}
    if faltan:
        ctx.ops.update({o.id: o for o in (await db.execute(select(Operador).where(Operador.id.in_(faltan)))).scalars().all()})
    nombres = await sup._nombres(db, {sid})

    medidor = srv.Medidor(db, dia)
    impactos: dict[str, dict[str, Any]] = {}

    async def item(c: Coaching) -> dict[str, Any]:
        if c.estado == "abierto" and c.id not in impactos:
            impactos[c.id] = await medidor.medir(c, ctx.ops.get(c.operador_id))
        return srv.a_dict(c, nombres=nombres, ops=ctx.ops, hoy=dia, impacto=impactos.get(c.id), momento=momento, mio=portal)

    # ---- equipo del mes: cada asesor que estuvo con este supervisor, con sus coachings
    validos = [c for c in cs if c.estado != "anulado"]
    cuenta = Counter(c.operador_id for c in validos)
    ultimo = {}
    for c in sorted(validos, key=lambda c: c.fecha):
        ultimo[c.operador_id] = c.fecha.isoformat()
    actuales = set(ctx.equipo(sid))
    equipo = []
    for op_id, tramos in ctx.tramos.items():
        mios = [t for t in sup._intervalos(tramos, ctx.ultimo) if t["supervisor_id"] == sid]
        o = ctx.ops.get(op_id)
        if not mios or not o:
            continue
        sc = ctx.sc["asesores"].get(op_id) if op_id in actuales else None
        conv = next((x for x in (sc or {}).get("componentes", []) if x["clave"] == "conversacion"), None)
        equipo.append({
            **sup._op_corto(o), "actual": op_id in actuales,
            "tramos": [{"desde": t["desde"].isoformat(), "hasta": t["hasta"].isoformat()} for t in mios],
            "coachings": cuenta.get(op_id, 0), "ultimo_coaching": ultimo.get(op_id),
            "uso": ctx.uso(op_id) if ctx.reporte else None,
            "conversacion": {"valor": conv["valor"], "roja": conv["rel"] == 0, "sobre_meta": bool(conv.get("sobre_meta"))}
            if conv and conv["rel"] is not None else None,
            "score": sc["total"] if sc else None, "parcial": bool(sc and sc["parcial"]),
        })
    equipo.sort(key=lambda x: (not x["actual"], not (x["uso"] or {}).get("alerta"), x["coachings"] > 0, x["nombre"].lower()))

    sup_info = ctx.supervisores.get(sid) or {"id": sid, "nombre": nombres.get(sid, sid), "activo": False}
    return {
        **ctx.comun(), "hoy": dia.isoformat(), "supervisor": sup_info,
        "proximos_hasta": sup.proximos_hasta(ctx.p, dia).isoformat(),
        "gestion_desde": ctx.inicio_gestion.isoformat() if ctx.inicio_gestion else None,
        "scoring": ctx.scoring_supervisor(sid),
        "equipo": equipo, "alertas": _alertas_de(ctx, sid, dia),
        "items": [await item(c) for c in cs],
        "pendientes": [await item(c) for c in pendientes],
        "notas": [srv.nota_dict(x, ctx.ops) for x in notas],
        "reglas": {**REGLAS, "dias_foco": sup.scoring.DIAS_FOCO},
        "puede_registrar": portal,
    }


@router.get("/portal/coaching")
async def portal_coaching(periodo: Optional[str] = Query(None), user: CurrentUser = Depends(sup.require_portal),
                          db: AsyncSession = Depends(get_db)) -> dict:
    """Coaching y bitácora del supervisor que entra: su equipo, sus alertas, sus compromisos y sus notas."""
    return await _vista(db, sup._periodo(periodo), user.id, portal=True)


@router.get("/coaching")
async def ver_coaching(supervisor_id: str, periodo: Optional[str] = Query(None), user: CurrentUser = Depends(sup.require_ver),
                       db: AsyncSession = Depends(get_db)) -> dict:
    """Lo mismo que ve el supervisor en su portal, para los jefes (solo lectura)."""
    if supervisor_id not in await sup._supervisores(db, {supervisor_id}):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supervisor no encontrado")
    return await _vista(db, sup._periodo(periodo), supervisor_id, portal=False)


@router.get("/gestion")
async def gestion(periodo: Optional[str] = Query(None), user: CurrentUser = Depends(sup.require_ver),
                  db: AsyncSession = Depends(get_db)) -> dict:
    """La gestión de coaching de cada supervisor en el mes: qué registró, qué tiene vencido y su puntaje de gestión."""
    per = sup._periodo(periodo)
    ctx = await sup.contexto(db, per)
    dia = sup.hoy()
    primero, ultimo = ctx.primero, ctx.ultimo
    del_mes = list((await db.execute(select(Coaching).where(
        Coaching.operativa == OPERATIVA, Coaching.fecha >= primero, Coaching.fecha <= ultimo))).scalars().all())
    abiertos = list((await db.execute(select(Coaching).where(
        Coaching.operativa == OPERATIVA, Coaching.estado == "abierto"))).scalars().all())
    notas = list((await db.execute(select(BitacoraNota).where(
        BitacoraNota.operativa == OPERATIVA, BitacoraNota.fecha >= primero, BitacoraNota.fecha <= ultimo))).scalars().all())
    filas = []
    for sid, x in ctx.sc["supervisores"].items():
        info = ctx.supervisores.get(sid) or {"id": sid, "nombre": sid, "activo": False}
        equipo = ctx.equipo(sid)
        mios = [c for c in del_mes if c.supervisor_id == sid and c.estado != "anulado"]
        if not equipo and not mios and not info["activo"]:
            continue
        abiertos_sid = [c for c in abiertos if c.supervisor_id == sid]
        notas_sid = [n for n in notas if n.supervisor_id == sid]
        alertas = Counter(a["estado"] for a in _alertas_de(ctx, sid, dia))
        momentos = [m for m in [*(c.created_at for c in mios), *(c.seguimiento_at for c in mios), *(n.created_at for n in notas_sid)] if m]
        ultima = srv.dia_local(max(momentos)) if momentos else None
        filas.append({
            **info, "asesores": len(equipo), "total": x["total"], "partes": x["partes"][1:],
            "coachings": len(mios), "por_metrica": dict(Counter(m for c in mios for m in srv.metricas_de(c))),
            "fuera_de_termino": sum(1 for c in mios if c.fuera_de_termino),
            "sin_mejora": sum(1 for c in mios if c.estado == "cerrado" and c.resultado in ("igual", "empeoro")),
            "seguimientos_abiertos": len(abiertos_sid),
            "seguimientos_vencidos": sum(1 for c in abiertos_sid if srv.estado_seguimiento(c, dia) == "vencido"),
            "alertas": {k: alertas.get(k, 0) for k in alertas_srv.ORDEN_ESTADO}, "notas": len(notas_sid),
            "ultima_actividad": ultima.isoformat() if ultima else None,
            "dias_sin_actividad": (dia - ultima).days if ultima else None,
        })
    filas.sort(key=lambda f: (-(f["alertas"]["vencida"] + f["seguimientos_vencidos"]), not f["asesores"], f["nombre"].lower()))
    con_equipo = {op for op in ctx.tramos if ctx.actual(op)}
    con_coaching = {c.operador_id for c in del_mes if c.estado != "anulado" and c.fecha <= min(ultimo, dia)}
    return {
        **ctx.comun(), "hoy": dia.isoformat(),
        "gestion_desde": ctx.inicio_gestion.isoformat() if ctx.inicio_gestion else None,
        "operacion": {
            "asesores": len(con_equipo), "con_coaching": len(con_equipo & con_coaching),
            "coachings": sum(f["coachings"] for f in filas),
            "seguimientos_vencidos": sum(f["seguimientos_vencidos"] for f in filas),
            "alertas_vencidas": sum(f["alertas"]["vencida"] for f in filas),
            "alertas_en_plazo": sum(f["alertas"]["en_plazo"] for f in filas),
        },
        "supervisores": filas,
        "reglas": {**REGLAS, "dias_foco": sup.scoring.DIAS_FOCO},
    }


# ------------------------------------------------------------------ registro por rango de fechas (jefes y supervisor)
DIAS_REGISTRO_MAX = 400       # un año y un poco más
LIMITE_ITEMS = 1500           # la lista; los indicadores cuentan todos
LOTE = 500                    # ids por consulta (los textos de la lista)
# Lo que necesitan los indicadores: sin los textos ni la foto al registrar (se leen solo para lo que se lista).
_LIVIANAS = (Coaching.id, Coaching.supervisor_id, Coaching.operador_id, Coaching.fecha, Coaching.tipo, Coaching.metrica,
             Coaching.metricas, Coaching.seguimiento_fecha, Coaching.seguimiento_at, Coaching.estado, Coaching.resultado,
             Coaching.impacto, Coaching.fuera_de_termino, Coaching.anterior_id, Coaching.created_at, Coaching.updated_at)
DIAS_PROXIMOS_REGISTRO = 7    # en el registro, «próximos»: los seguimientos de la próxima semana
SeguimientoFiltro = Literal["pendientes", "proximos", "vencidos", "a_tiempo", "tarde"]
ResultadoFiltro = Literal["mejoro", "igual", "empeoro", "mixto", "sin_datos", "sin_mejora"]
_EST_FILTRO = {"vencidos": "vencido", "a_tiempo": "a_tiempo", "tarde": "tarde"}


def _pct(a: float, b: float) -> float | None:
    return round(a / b * 100, 1) if b else None


def _resultados_por_metrica(c: Coaching) -> list[dict[str, Any]]:
    """Métrica, resultado y diferencia de cada métrica de un coaching cerrado (lo que se guardó con su seguimiento)."""
    imp = c.impacto or {}
    partes = imp.get("metricas") or ([imp] if imp.get("metrica") else [])
    if not partes:
        return [{"metrica": m, "resultado": c.resultado or "sin_datos", "delta": None} for m in srv.metricas_de(c)]
    return [{"metrica": x.get("metrica") or c.metrica, "resultado": x.get("resultado") or "sin_datos", "delta": x.get("delta")}
            for x in partes]


def _item(c: Coaching, textos: tuple[str, str, str | None], *, nombres: dict[str, str], ops: dict[str, Operador],
          dia: date) -> dict[str, Any]:
    """Un coaching en la lista del registro: lo que se trabajó, el compromiso, la devolución y el resultado por métrica
    (la foto al registrar y la medición completa se ven al abrir el detalle). Los campos de `coaching.a_dict`."""
    o = ops.get(c.operador_id)
    diagnostico, compromiso, comentario = textos
    return {
        "id": c.id, "supervisor_id": c.supervisor_id, "supervisor": nombres.get(c.supervisor_id, c.supervisor_id),
        "operador_id": c.operador_id, "operador": o.nombre if o else "—", "agente": o.agente_nombre if o else None,
        "vendedor": o.vendedor if o else None, "fecha": c.fecha.isoformat(), "tipo": c.tipo, "metrica": c.metrica,
        "metricas": srv.metricas_de(c), "diagnostico": diagnostico, "compromiso": compromiso,
        "seguimiento_fecha": c.seguimiento_fecha.isoformat(), "estado": c.estado, "seguimiento": srv.estado_seguimiento(c, dia),
        "seguimiento_at": srv.iso(c.seguimiento_at), "seguimiento_comentario": comentario, "resultado": c.resultado,
        "resultados": _resultados_por_metrica(c) if c.estado == "cerrado" else [], "impacto_guardado": c.estado == "cerrado",
        "fuera_de_termino": c.fuera_de_termino, "anterior_id": c.anterior_id, "created_at": srv.iso(c.created_at),
        "updated_at": srv.iso(c.updated_at), "editable": False,
    }


async def _textos(db: AsyncSession, ids: list[str]) -> dict[str, tuple[str, str, str | None]]:
    """Diagnóstico, compromiso y comentario del seguimiento de los coachings que se listan (de a lotes)."""
    out: dict[str, tuple[str, str, str | None]] = {}
    for k in range(0, len(ids), LOTE):
        filas = await db.execute(select(Coaching.id, Coaching.diagnostico, Coaching.compromiso, Coaching.seguimiento_comentario)
                                 .where(Coaching.id.in_(ids[k:k + LOTE])))
        out.update({i: (d, c, s) for i, d, c, s in filas.all()})
    return out


def _rango(desde: date | None, hasta: date | None) -> tuple[date, date]:
    dia = sup.hoy()
    hasta = hasta or dia
    desde = desde or hasta.replace(day=1)
    if desde > hasta:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La fecha inicial es posterior a la final")
    if (hasta - desde).days > DIAS_REGISTRO_MAX:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"El rango puede tener hasta {DIAS_REGISTRO_MAX} días")
    return desde, hasta


async def _registro(db: AsyncSession, *, desde: date, hasta: date, supervisor_id: str | None, operador_id: str | None,
                    metrica: str | None, tipo: str | None, seguimiento: str | None, resultado: str | None, anulados: bool,
                    solo_supervisor: str | None = None) -> dict[str, Any]:
    """Todos los coachings con fecha en el rango que cumplen los filtros: qué se trabajó (diagnóstico y compromiso), el
    seguimiento (la devolución) y su resultado, con los indicadores del rango por métrica, por supervisor y por asesor.
    `solo_supervisor`: el portal, que ve solo lo suyo."""
    dia = sup.hoy()
    tope = dia + timedelta(days=DIAS_PROXIMOS_REGISTRO)
    base = select(Coaching).where(Coaching.operativa == OPERATIVA, Coaching.fecha >= desde, Coaching.fecha <= hasta)
    if solo_supervisor:
        base = base.where(Coaching.supervisor_id == solo_supervisor)
    q = base
    if supervisor_id:
        q = q.where(Coaching.supervisor_id == supervisor_id)
    if operador_id:
        q = q.where(Coaching.operador_id == operador_id)
    if tipo:
        q = q.where(Coaching.tipo == tipo)
    cs = list((await db.execute(q.options(load_only(*_LIVIANAS)).order_by(Coaching.fecha.desc(), Coaching.created_at.desc())))
              .scalars().all())

    def proximo(c: Coaching) -> bool:
        return c.estado == "abierto" and srv.estado_seguimiento(c, dia) in ("hoy", "proximo") and c.seguimiento_fecha <= tope

    def pasa(c: Coaching) -> bool:
        if metrica and metrica not in srv.metricas_de(c):
            return False
        if seguimiento == "pendientes" and c.estado != "abierto":
            return False
        if seguimiento == "proximos" and not proximo(c):
            return False
        if seguimiento in _EST_FILTRO and srv.estado_seguimiento(c, dia) != _EST_FILTRO[seguimiento]:
            return False
        if resultado:
            if c.estado != "cerrado":
                return False
            return c.resultado in ("igual", "empeoro") if resultado == "sin_mejora" else c.resultado == resultado
        return True

    cs = [c for c in cs if pasa(c)]
    validos = [c for c in cs if c.estado != "anulado"]
    n_anulados = len(cs) - len(validos)   # los anulados se cuentan siempre; se listan solo si se piden
    if not anulados:
        cs = validos

    # Nombres y opciones de los filtros (los supervisores y asesores con coachings en el rango, sin los demás filtros).
    pares = (await db.execute(select(Coaching.supervisor_id, Coaching.operador_id).where(base.whereclause).distinct())).all()
    sup_ids = {s for s, _ in pares} | {c.supervisor_id for c in cs}
    op_ids = {o for _, o in pares} | {c.operador_id for c in cs}
    nombres = await sup._nombres(db, sup_ids)
    ops = {o.id: o for o in (await db.execute(select(Operador).where(Operador.id.in_(op_ids)))).scalars().all()} if op_ids else {}

    # ---- indicadores del rango
    est = Counter(srv.estado_seguimiento(c, dia) for c in validos)
    cerrados = [c for c in validos if c.estado == "cerrado"]
    res = Counter(c.resultado or "sin_datos" for c in cerrados)
    con_datos = sum(res[r] for r in ("mejoro", "mixto", "igual", "empeoro"))
    exigibles = est["a_tiempo"] + est["tarde"] + est["vencido"]
    kpis = {
        "coachings": len(validos), "anulados": n_anulados,
        "asesores": len({c.operador_id for c in validos}), "supervisores": len({c.supervisor_id for c in validos}),
        "fuera_de_termino": sum(1 for c in validos if c.fuera_de_termino),
        "por_tipo": {t: n for t, n in Counter(c.tipo for c in validos).items()},
        "seguimientos": {k: est.get(k, 0) for k in ("a_tiempo", "tarde", "vencido", "hoy", "proximo")},
        "pct_a_tiempo": _pct(est["a_tiempo"], exigibles),
        "proximos": sum(1 for c in validos if proximo(c)),
        "cerrados": len(cerrados),
        "resultados": {k: res.get(k, 0) for k in ("mejoro", "mixto", "igual", "empeoro", "sin_datos")},
        "pct_mejora": _pct(res["mejoro"], con_datos),
    }

    # ---- por métrica: cuántos la trabajaron y, de los cerrados, cómo le fue a esa métrica
    pm: dict[str, dict[str, Any]] = {m: {"metrica": m, "coachings": 0, "cerrados": 0, "mejoro": 0, "igual": 0, "empeoro": 0,
                                        "sin_datos": 0} for m in METRICAS_ORDEN}
    for c in validos:
        for m in srv.metricas_de(c):
            pm[m]["coachings"] += 1
        if c.estado == "cerrado":
            for x in _resultados_por_metrica(c):
                if x["metrica"] in pm:
                    pm[x["metrica"]]["cerrados"] += 1
                    pm[x["metrica"]][x["resultado"] if x["resultado"] in ("mejoro", "igual", "empeoro") else "sin_datos"] += 1
    por_metrica = [{**x, "pct_mejora": _pct(x["mejoro"], x["mejoro"] + x["igual"] + x["empeoro"])}
                   for x in pm.values() if x["coachings"]]

    # ---- por supervisor y por asesor
    fs: dict[str, dict[str, Any]] = {}
    fa: dict[str, dict[str, Any]] = {}
    for c in validos:
        e = srv.estado_seguimiento(c, dia)
        f = fs.setdefault(c.supervisor_id, {"id": c.supervisor_id, "nombre": nombres.get(c.supervisor_id, c.supervisor_id),
                                            "coachings": 0, "asesores": set(), "a_tiempo": 0, "tarde": 0, "vencido": 0,
                                            "pendientes": 0, "proximos": 0, "cerrados": 0, "mejoro": 0, "con_datos": 0, "ultimo": None})
        o = ops.get(c.operador_id)
        a = fa.setdefault(c.operador_id, {"id": c.operador_id, "nombre": o.nombre if o else "—", "supervisores": set(),
                                          "coachings": 0, "metricas": Counter(), "pendientes": 0, "vencido": 0, "cerrados": 0,
                                          "mejoro": 0, "sin_mejora": 0, "ultimo": None})
        for x in (f, a):
            x["coachings"] += 1
            x["ultimo"] = max(x["ultimo"], c.fecha) if x["ultimo"] else c.fecha
            if c.estado == "abierto":
                x["pendientes"] += 1
            if e == "vencido":
                x["vencido"] += 1
            if c.estado == "cerrado":
                x["cerrados"] += 1
                x["mejoro"] += c.resultado == "mejoro"
        f["asesores"].add(c.operador_id)
        if e in ("a_tiempo", "tarde"):
            f[e] += 1
        f["proximos"] += proximo(c)
        f["con_datos"] += c.estado == "cerrado" and c.resultado in ("mejoro", "mixto", "igual", "empeoro")
        a["supervisores"].add(nombres.get(c.supervisor_id, c.supervisor_id))
        a["metricas"].update(srv.metricas_de(c))
        a["sin_mejora"] += c.estado == "cerrado" and c.resultado in ("igual", "empeoro")
    por_supervisor = sorted(({**f, "asesores": len(f["asesores"]), "ultimo": f["ultimo"].isoformat(),
                              "pct_a_tiempo": _pct(f["a_tiempo"], f["a_tiempo"] + f["tarde"] + f["vencido"]),
                              "pct_mejora": _pct(f["mejoro"], f["con_datos"])} for f in fs.values()),
                            key=lambda x: (-x["coachings"], x["nombre"].lower()))
    por_asesor = sorted(({**a, "supervisores": sorted(a["supervisores"]), "metricas": dict(a["metricas"]),
                          "ultimo": a["ultimo"].isoformat()} for a in fa.values()),
                        key=lambda x: (-x["coachings"], x["nombre"].lower()))

    lista = cs[:LIMITE_ITEMS]
    textos = await _textos(db, [c.id for c in lista])
    return {
        "desde": desde.isoformat(), "hasta": hasta.isoformat(), "hoy": dia.isoformat(), "proximos_hasta": tope.isoformat(),
        "kpis": kpis, "por_metrica": por_metrica, "por_supervisor": por_supervisor, "por_asesor": por_asesor,
        "items": [_item(c, textos.get(c.id, ("", "", None)), nombres=nombres, ops=ops, dia=dia) for c in lista],
        "total_items": len(cs), "truncado": len(cs) > LIMITE_ITEMS,
        "opciones": {
            "supervisores": sorted(({"id": i, "nombre": nombres.get(i, i)} for i in {s for s, _ in pares}),
                                   key=lambda x: x["nombre"].lower()),
            "asesores": sorted(({"id": i, "nombre": ops[i].nombre} for i in {o for _, o in pares} if i in ops),
                               key=lambda x: x["nombre"].lower()),
        },
    }


@router.get("/registro")
async def registro(desde: Optional[date] = Query(None), hasta: Optional[date] = Query(None),
                   supervisor_id: Optional[str] = Query(None, max_length=36), operador_id: Optional[str] = Query(None, max_length=36),
                   metrica: Optional[Metrica] = Query(None), tipo: Optional[Tipo] = Query(None),
                   seguimiento: Optional[SeguimientoFiltro] = Query(None), resultado: Optional[ResultadoFiltro] = Query(None),
                   anulados: bool = Query(False), user: CurrentUser = Depends(sup.require_ver),
                   db: AsyncSession = Depends(get_db)) -> dict:
    """Registro de coaching de toda la operación por rango de fechas (jefes, solo lectura)."""
    d, h = _rango(desde, hasta)
    return await _registro(db, desde=d, hasta=h, supervisor_id=supervisor_id, operador_id=operador_id, metrica=metrica,
                           tipo=tipo, seguimiento=seguimiento, resultado=resultado, anulados=anulados)


@router.get("/portal/registro")
async def portal_registro(desde: Optional[date] = Query(None), hasta: Optional[date] = Query(None),
                          operador_id: Optional[str] = Query(None, max_length=36), metrica: Optional[Metrica] = Query(None),
                          tipo: Optional[Tipo] = Query(None), seguimiento: Optional[SeguimientoFiltro] = Query(None),
                          resultado: Optional[ResultadoFiltro] = Query(None), anulados: bool = Query(False),
                          user: CurrentUser = Depends(sup.require_portal), db: AsyncSession = Depends(get_db)) -> dict:
    """El historial de coaching del supervisor que entra, por rango de fechas: solo lo suyo."""
    d, h = _rango(desde, hasta)
    return await _registro(db, desde=d, hasta=h, supervisor_id=None, operador_id=operador_id, metrica=metrica, tipo=tipo,
                           seguimiento=seguimiento, resultado=resultado, anulados=anulados, solo_supervisor=user.id)


async def _detalle(db: AsyncSession, c: Coaching, *, portal: bool) -> dict[str, Any]:
    dia = sup.hoy()
    o = await db.get(Operador, c.operador_id)
    ops = {o.id: o} if o else {}
    evs = await srv.eventos(db, c.id)
    nombres = await sup._nombres(db, {c.supervisor_id} | {e.por for e in evs})
    impacto = await srv.Medidor(db, dia).medir(c, o) if c.estado == "abierto" else None
    siguientes = (await db.execute(select(Coaching.id, Coaching.fecha).where(Coaching.anterior_id == c.id)
                                   .order_by(Coaching.fecha))).all()
    return {**srv.a_dict(c, nombres=nombres, ops=ops, hoy=dia, impacto=impacto, momento=srv.ahora(), mio=portal),
            "eventos": [srv.evento_dict(e, nombres) for e in evs],
            "siguientes": [{"id": i, "fecha": f.isoformat()} for i, f in siguientes]}


async def _propio(db: AsyncSession, coaching_id: str, user: CurrentUser) -> Coaching:
    c = await db.get(Coaching, coaching_id)
    if not c or c.operativa != OPERATIVA or c.supervisor_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Coaching no encontrado")
    return c


@router.get("/portal/coaching/{coaching_id}")
async def portal_detalle(coaching_id: str, user: CurrentUser = Depends(sup.require_portal), db: AsyncSession = Depends(get_db)) -> dict:
    return await _detalle(db, await _propio(db, coaching_id, user), portal=True)


@router.get("/coaching/{coaching_id}")
async def ver_detalle(coaching_id: str, user: CurrentUser = Depends(sup.require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    c = await db.get(Coaching, coaching_id)
    if not c or c.operativa != OPERATIVA:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Coaching no encontrado")
    return await _detalle(db, c, portal=False)


# ------------------------------------------------------------------ registrar y editar
class CoachingPayload(BaseModel):
    operador_id: str = Field(..., min_length=1, max_length=36)
    fecha: date
    tipo: Tipo
    metricas: Optional[list[Metrica]] = Field(None, max_length=5)  # las que se trabajaron (una o varias)
    metrica: Optional[Metrica] = None  # una sola (como antes de poder elegir varias)
    diagnostico: str = Field(..., max_length=srv.MAX_TEXTO)
    compromiso: str = Field(..., max_length=srv.MAX_TEXTO)
    seguimiento_fecha: date
    anterior_id: Optional[str] = Field(None, max_length=36)


@router.post("/portal/coaching", status_code=status.HTTP_201_CREATED)
async def registrar(payload: CoachingPayload, request: Request, user: CurrentUser = Depends(sup.require_portal),
                    db: AsyncSession = Depends(get_db)) -> dict:
    """Registra un coaching. La hora la pone el servidor; con más de 48 h de atraso queda fuera de término."""
    dia = sup.hoy()
    try:
        fuera = srv.validar_fecha(payload.fecha, dia)
        srv.validar_seguimiento(payload.fecha, payload.seguimiento_fecha, dia)
        metricas = srv.normalizar_metricas(payload.metricas or ([payload.metrica] if payload.metrica else []))
        diagnostico = srv.texto(payload.diagnostico, "el diagnóstico")
        compromiso = srv.texto(payload.compromiso, "el compromiso")
    except srv.ReglaInvalida as exc:
        raise _regla(exc) from exc
    ctx = await sup.contexto(db, mes_de(payload.fecha))
    op = ctx.ops.get(payload.operador_id)
    if not op or supervisor_en(ctx.tramos.get(op.id, []), payload.fecha) != user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ese asesor no estaba en tu equipo el {payload.fecha:%d/%m}")
    if payload.anterior_id:
        prev = await db.get(Coaching, payload.anterior_id)
        if not prev or prev.supervisor_id != user.id or prev.operador_id != op.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "El coaching anterior no es de ese asesor")
    c = Coaching(operativa=OPERATIVA, supervisor_id=user.id, operador_id=op.id, fecha=payload.fecha, tipo=payload.tipo,
                 metrica=metricas[0], metricas=metricas, diagnostico=diagnostico, compromiso=compromiso,
                 seguimiento_fecha=payload.seguimiento_fecha, estado="abierto", anterior_id=payload.anterior_id,
                 base=await srv.foto(db, op, payload.fecha, ctx.sc["asesores"].get(op.id)), impacto={},
                 fuera_de_termino=fuera, created_at=srv.ahora(), created_by=user.id)
    db.add(c)
    await db.flush()
    srv.evento(db, c, "creado", user.id, tipo=c.tipo, metrica=c.metrica, metricas=metricas, fecha=c.fecha, seguimiento_fecha=c.seguimiento_fecha,
               diagnostico=diagnostico, compromiso=compromiso, fuera_de_termino=fuera)
    await db.commit()
    await record_action(db, user_id=user.id, action="coaching_registrado", resource_type="coaching", resource_id=c.id,
                        ip=client_ip(request), extra={"asesor": op.nombre, "fecha": c.fecha.isoformat(), "tipo": c.tipo,
                                                     "metricas": metricas, "fuera_de_termino": fuera})
    return await _detalle(db, c, portal=True)


class CoachingPatch(BaseModel):
    tipo: Optional[Tipo] = None
    metricas: Optional[list[Metrica]] = Field(None, max_length=5)
    metrica: Optional[Metrica] = None  # una sola (como antes de poder elegir varias)
    diagnostico: Optional[str] = Field(None, max_length=srv.MAX_TEXTO)
    compromiso: Optional[str] = Field(None, max_length=srv.MAX_TEXTO)
    seguimiento_fecha: Optional[date] = None


@router.patch("/portal/coaching/{coaching_id}")
async def editar(coaching_id: str, payload: CoachingPatch, request: Request, user: CurrentUser = Depends(sup.require_portal),
                 db: AsyncSession = Depends(get_db)) -> dict:
    """Corrige un coaching dentro de las 24 h del registro (cada versión queda en el historial)."""
    c = await _propio(db, coaching_id, user)
    if not srv.editable(c, srv.ahora()):
        raise HTTPException(status.HTTP_409_CONFLICT, "Pasaron más de 24 h desde el registro: agregá una aclaración")
    antes, despues = {}, {}
    try:
        nuevos: dict[str, Any] = {}
        if payload.tipo is not None:
            nuevos["tipo"] = payload.tipo
        if payload.metricas is not None or payload.metrica is not None:
            ms = srv.normalizar_metricas(payload.metricas if payload.metricas is not None else [payload.metrica])
            if ms != srv.metricas_de(c):
                antes["metricas"], despues["metricas"] = srv.metricas_de(c), ms
                c.metricas, c.metrica = ms, ms[0]
        if payload.diagnostico is not None:
            nuevos["diagnostico"] = srv.texto(payload.diagnostico, "el diagnóstico")
        if payload.compromiso is not None:
            nuevos["compromiso"] = srv.texto(payload.compromiso, "el compromiso")
        if payload.seguimiento_fecha is not None and payload.seguimiento_fecha != c.seguimiento_fecha:
            srv.validar_seguimiento(c.fecha, payload.seguimiento_fecha, sup.hoy())
            nuevos["seguimiento_fecha"] = payload.seguimiento_fecha
    except srv.ReglaInvalida as exc:
        raise _regla(exc) from exc
    for k, v in nuevos.items():
        if getattr(c, k) != v:
            antes[k], despues[k] = getattr(c, k), v
            setattr(c, k, v)
    if despues:
        c.updated_at = srv.ahora()
        srv.evento(db, c, "editado", user.id, antes=antes, despues=despues)
        await db.commit()
        await record_action(db, user_id=user.id, action="coaching_editado", resource_type="coaching", resource_id=c.id,
                            ip=client_ip(request), extra={"campos": sorted(despues)})
    return await _detalle(db, c, portal=True)


class AnularPayload(BaseModel):
    motivo: str = Field(..., max_length=500)


@router.post("/portal/coaching/{coaching_id}/anular")
async def anular(coaching_id: str, payload: AnularPayload, request: Request, user: CurrentUser = Depends(sup.require_portal),
                 db: AsyncSession = Depends(get_db)) -> dict:
    """Anula un coaching cargado por error (dentro de las 24 h). No se borra: queda tachado y en el historial."""
    c = await _propio(db, coaching_id, user)
    if not srv.editable(c, srv.ahora()):
        raise HTTPException(status.HTTP_409_CONFLICT, "Solo se anula dentro de las 24 h del registro")
    try:
        motivo = srv.texto(payload.motivo, "el motivo", minimo=5, maximo=500)
    except srv.ReglaInvalida as exc:
        raise _regla(exc) from exc
    c.estado, c.updated_at = "anulado", srv.ahora()
    srv.evento(db, c, "anulado", user.id, motivo=motivo)
    await db.commit()
    await record_action(db, user_id=user.id, action="coaching_anulado", resource_type="coaching", resource_id=c.id,
                        ip=client_ip(request), extra={"motivo": motivo})
    return await _detalle(db, c, portal=True)


class SeguimientoPayload(BaseModel):
    comentario: str = Field(..., max_length=srv.MAX_TEXTO)


@router.post("/portal/coaching/{coaching_id}/seguimiento")
async def seguimiento(coaching_id: str, payload: SeguimientoPayload, request: Request,
                      user: CurrentUser = Depends(sup.require_portal), db: AsyncSession = Depends(get_db)) -> dict:
    """Registra el seguimiento del compromiso: el sistema mide el impacto con los datos y lo guarda."""
    c = await _propio(db, coaching_id, user)
    if c.estado != "abierto":
        raise HTTPException(status.HTTP_409_CONFLICT, "Este coaching está anulado" if c.estado == "anulado"
                            else "Este coaching ya tiene su seguimiento")
    dia = sup.hoy()
    if dia <= c.fecha:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El seguimiento se registra desde el día siguiente al coaching")
    try:
        comentario = srv.texto(payload.comentario, "el comentario del seguimiento")
    except srv.ReglaInvalida as exc:
        raise _regla(exc) from exc
    impacto = await srv.Medidor(db, dia).medir(c, await db.get(Operador, c.operador_id))
    c.impacto, c.resultado = impacto, impacto["resultado"]
    c.seguimiento_at, c.seguimiento_comentario, c.estado = srv.ahora(), comentario, "cerrado"
    c.updated_at = c.seguimiento_at
    a_tiempo = srv.estado_seguimiento(c, dia) == "a_tiempo"
    srv.evento(db, c, "seguimiento", user.id, comentario=comentario, resultado=c.resultado, a_tiempo=a_tiempo)
    await db.commit()
    await record_action(db, user_id=user.id, action="coaching_seguimiento", resource_type="coaching", resource_id=c.id,
                        ip=client_ip(request), extra={"resultado": c.resultado, "a_tiempo": a_tiempo})
    return await _detalle(db, c, portal=True)


class AclaracionPayload(BaseModel):
    texto: str = Field(..., max_length=1000)


@router.post("/portal/coaching/{coaching_id}/aclaracion")
async def aclaracion(coaching_id: str, payload: AclaracionPayload, request: Request,
                     user: CurrentUser = Depends(sup.require_portal), db: AsyncSession = Depends(get_db)) -> dict:
    """Agrega una aclaración (en cualquier momento): no cambia lo registrado, queda en el historial."""
    c = await _propio(db, coaching_id, user)
    if c.estado == "anulado":
        raise HTTPException(status.HTTP_409_CONFLICT, "Este coaching está anulado")
    try:
        t = srv.texto(payload.texto, "la aclaración", minimo=5, maximo=1000)
    except srv.ReglaInvalida as exc:
        raise _regla(exc) from exc
    srv.evento(db, c, "aclaracion", user.id, texto=t)
    await db.commit()
    await record_action(db, user_id=user.id, action="coaching_aclaracion", resource_type="coaching", resource_id=c.id,
                        ip=client_ip(request), extra={})
    return await _detalle(db, c, portal=True)


# ------------------------------------------------------------------ bitácora
class NotaPayload(BaseModel):
    fecha: date
    tipo: TipoNota
    texto: str = Field(..., max_length=srv.MAX_TEXTO)
    operador_id: Optional[str] = Field(None, max_length=36)


@router.post("/portal/bitacora", status_code=status.HTTP_201_CREATED)
async def nota(payload: NotaPayload, request: Request, user: CurrentUser = Depends(sup.require_portal),
               db: AsyncSession = Depends(get_db)) -> dict:
    """Nota de bitácora: novedades, ausencias, incidencias, reconocimientos. No se edita ni se borra."""
    dia = sup.hoy()
    try:
        fuera = srv.validar_fecha(payload.fecha, dia)
        t = srv.texto(payload.texto, "la nota", minimo=5)
    except srv.ReglaInvalida as exc:
        raise _regla(exc) from exc
    ops: dict[str, Operador] = {}
    if payload.operador_id:
        o = await db.get(Operador, payload.operador_id)
        if not o or await maestro.supervisor_del_dia(db, o.id, payload.fecha) != user.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ese asesor no estaba en tu equipo el {payload.fecha:%d/%m}")
        ops[o.id] = o
    x = BitacoraNota(operativa=OPERATIVA, supervisor_id=user.id, fecha=payload.fecha, tipo=payload.tipo, texto=t,
                     operador_id=payload.operador_id, fuera_de_termino=fuera, created_at=srv.ahora())
    db.add(x)
    await db.commit()
    await record_action(db, user_id=user.id, action="bitacora_nota", resource_type="bitacora", resource_id=x.id,
                        ip=client_ip(request), extra={"fecha": x.fecha.isoformat(), "tipo": x.tipo,
                                                     "asesor": ops[x.operador_id].nombre if x.operador_id else None})
    return srv.nota_dict(x, ops)
