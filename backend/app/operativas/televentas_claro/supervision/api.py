"""API de Supervisión — Televentas Claro (modelo Líder Coach Comercial).

Permisos:
* `televentas_claro.supervision`          → ver equipos, objetivos, avance y proyección, alertas y el detalle
                                            de cada supervisor.
* `televentas_claro.supervision_gestion`  → armar los equipos del mes, cargar objetivos y el calendario.
* `televentas_claro.operadores`           → mantener el maestro de operadores (vínculos a mano).
* `televentas_claro.portal_supervisor`    → el portal del supervisor: solo su equipo (lo filtra el servidor).

Fuentes: las mismas que el SPH (`..fuentes`): por mes, el informe de Ventas Netas de corte más nuevo
(cada planilla trae todo el mes y reemplaza a la anterior); si no está publicado, se marca como
provisorio. Las cuentas están en `calculo.py`.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip, get_current_user, require_perm
from ....core.config import settings
from ....core.database import get_db
from ....models.user import User
from ....services.audit_service import record_action
from ..sph.analyzer import nombre_mes
from ..ventas_netas.models import ESTADO_PUBLICADO as VN_PUBLICADO
from ..ventas_netas.models import VentasNetasReport
from . import alertas as alertas_srv
from . import coaching as coaching_srv
from . import operadores as maestro
from . import scoring
from . import tickets as tickets_srv
from .datos import horario as horario_de
from .datos import parametros, parametros_scoring, productividad_del_mes, ventas_del_mes
from .sla import estado as estado_sla
from .sla import validar_horario
from .calculo import (
    atribuir, calendario, limites, mes_anterior, proyeccion, sumar_habiles, supervisor_en,
    validar_periodo,
)
from .models import (
    AGENTE_PENDIENTE, OPERATIVA, VENDEDOR_PENDIENTE, VINCULADO, EquipoAsignacion, ObjetivoSupervisor, Operador,
    SupParametros,
)

PERM_VER = f"{OPERATIVA}.supervision"
PERM_GESTION = f"{OPERATIVA}.supervision_gestion"
PERM_OPERADORES = f"{OPERATIVA}.operadores"
PERM_PORTAL = f"{OPERATIVA}.portal_supervisor"
PERM_PARAMETROS = f"{OPERATIVA}.supervision_parametros"
require_ver = require_perm(PERM_VER)
require_gestion = require_perm(PERM_GESTION)
require_operadores = require_perm(PERM_OPERADORES)
require_portal = require_perm(PERM_PORTAL)
require_parametros = require_perm(PERM_PARAMETROS)

router = APIRouter(prefix="/televentas-claro/supervision", tags=["televentas-claro · supervisión"])

ZONA = ZoneInfo("America/Asuncion")
ROL_SUPERVISOR = "supervisor"
DIAS_ACTIVIDAD = 45  # un operador visto en estos días antes del mes cuenta como candidato a equipo


async def require_ver_operadores(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not (user.has_perm(PERM_VER) or user.has_perm(PERM_OPERADORES)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenés permiso para esta acción")
    return user


# ------------------------------------------------------------------ utilidades
def hoy() -> date:
    return datetime.now(ZONA).date()


def _periodo(periodo: Optional[str]) -> str:
    try:
        return validar_periodo(periodo) if periodo else hoy().strftime("%Y-%m")
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


def _iso(d: Any) -> str | None:
    if d is None:
        return None
    if isinstance(d, datetime) and d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.isoformat()


def referencia(periodo: str) -> date:
    """Día con el que se arma el equipo «actual» del mes: hoy en el mes en curso, el último día en uno pasado."""
    primero, ultimo = limites(periodo)
    return min(max(hoy(), primero), ultimo)


async def _nombres(db: AsyncSession, ids: set[str | None]) -> dict[str, str]:
    ids = {i for i in ids if i}
    out = {"superadmin": settings.superadmin_name}
    if ids:
        rows = await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))
        out.update({i: n for i, n in rows.all()})
    return out


async def _supervisores(db: AsyncSession, extra_ids: set[str] | None = None) -> dict[str, dict[str, Any]]:
    """Usuarios con perfil Supervisor en la operativa (y los que figuran en equipos aunque ya no lo sean)."""
    rows = (await db.execute(select(User).where(User.role == ROL_SUPERVISOR))).scalars().all()
    out = {u.id: {"id": u.id, "nombre": u.full_name, "activo": bool(u.is_active and OPERATIVA in (u.operativas or []))}
           for u in rows}
    faltan = {i for i in (extra_ids or set()) if i and i not in out}
    if faltan:
        for u in (await db.execute(select(User).where(User.id.in_(faltan)))).scalars().all():
            out[u.id] = {"id": u.id, "nombre": u.full_name, "activo": False}
    return out


def _desc_ventas(r: VentasNetasReport | None) -> dict[str, Any] | None:
    if not r:
        return None
    return {"id": r.id, "status": r.status, "provisorio": r.status != VN_PUBLICADO,
            "fecha_dato": r.fecha_dato.isoformat() if r.fecha_dato else None, "netas": r.netas}


async def _asignaciones(db: AsyncSession, periodo: str) -> list[EquipoAsignacion]:
    return list((await db.execute(select(EquipoAsignacion).where(
        EquipoAsignacion.operativa == OPERATIVA, EquipoAsignacion.periodo == periodo,
    ).order_by(EquipoAsignacion.desde))).scalars().all())


def _tramos(asigs: list[EquipoAsignacion]) -> dict[str, list[tuple[date, str | None]]]:
    out: dict[str, list[tuple[date, str | None]]] = {}
    for a in sorted(asigs, key=lambda a: a.desde):
        out.setdefault(a.operador_id, []).append((a.desde, a.supervisor_id))
    return out


def _intervalos(tramos: list[tuple[date, str | None]], ultimo: date) -> list[dict[str, Any]]:
    """Tramos del mes como intervalos: desde, hasta (inclusive) y supervisor."""
    out = []
    for i, (desde, sup) in enumerate(tramos):
        hasta = tramos[i + 1][0] - timedelta(days=1) if i + 1 < len(tramos) else ultimo
        out.append({"desde": desde, "hasta": hasta, "supervisor_id": sup})
    return out


def _op_corto(o: Operador) -> dict[str, Any]:
    return {"id": o.id, "nombre": o.nombre, "agente": o.agente_nombre, "vendedor": o.vendedor, "subcanal": o.subcanal,
            "cruce": o.cruce, "activo": o.activo}


async def _objetivos(db: AsyncSession, periodo: str) -> dict[str, ObjetivoSupervisor]:
    rows = (await db.execute(select(ObjetivoSupervisor).where(
        ObjetivoSupervisor.operativa == OPERATIVA, ObjetivoSupervisor.periodo == periodo))).scalars().all()
    return {o.supervisor_id: o for o in rows}


class Contexto:
    """Todo lo que hace falta para mostrar un mes: ventas, equipos, objetivos, calendario y cuentas."""

    def __init__(self, periodo: str):
        self.periodo = periodo
        self.primero, self.ultimo = limites(periodo)
        self.ref = referencia(periodo)

    async def cargar(self, db: AsyncSession) -> "Contexto":
        await maestro.detectar(db, self.periodo)
        self.p = await parametros(db)
        self.reporte, lineas = await ventas_del_mes(db, self.periodo)
        self.ops = {o.id: o for o in await maestro.todos(db)}
        operador_de = {o.vendedor: o.id for o in self.ops.values() if o.vendedor}
        self.asigs = await _asignaciones(db, self.periodo)
        self.tramos = _tramos(self.asigs)
        self.atrib = atribuir(lineas, operador_de, self.tramos, self.p)
        self.cal = calendario(self.periodo, self.reporte.fecha_dato if self.reporte else None,
                              self.p["pesos_dia"], self.p["feriados"])
        self.objetivos = await _objetivos(db, self.periodo)
        ids = {a.supervisor_id for a in self.asigs if a.supervisor_id} | set(self.objetivos)
        self.supervisores = await _supervisores(db, ids)
        return self

    async def cargar_scoring(self, db: AsyncSession) -> "Contexto":
        """Suma Productividad (conversación) y la gestión registrada (coachings y alertas con fecha) y calcula
        el scoring del mes. En el mes en curso, primero pone al día las alertas de uso con el informe vigente."""
        self.sc_params = await parametros_scoring(db)
        self.prod, self.fuente_prod = await productividad_del_mes(db, self.periodo)
        dia = hoy()
        self.inicio_gestion = await coaching_srv.inicio_gestion(db)
        await alertas_srv.sincronizar(db, periodo=self.periodo, reporte=self.reporte, atrib=self.atrib, hoy=dia,
                                      inicio=self.inicio_gestion)
        self.alertas = await alertas_srv.del_mes(db, self.periodo)
        self.coachings = await coaching_srv.para_scoring_del_mes(db, self.periodo)
        self.horario = horario_de(self.p)
        await tickets_srv.cerrar_sin_respuesta(db, self.horario)
        self.tickets = await tickets_srv.del_mes(db, self.periodo)
        gestion = {"inicio": self.inicio_gestion, "hoy": dia, "coachings": coaching_srv.para_scoring(self.coachings),
                   "alertas": [alertas_srv.a_scoring(a, self.p) for a in self.alertas],
                   "tickets": tickets_srv.para_scoring(self.tickets, self.horario, tickets_srv.ahora())}
        self.sc = scoring.calcular(
            primero=self.primero, ultimo=self.ultimo, corte=self.reporte.fecha_dato if self.reporte else None,
            cal=self.cal, p=self.p, sc=self.sc_params, pp=self.sc_params["conversacion"],
            agentes={o.id: o.agente_clave for o in self.ops.values() if o.agente_clave},
            vendedores={o.id: o.vendedor for o in self.ops.values() if o.vendedor},
            tramos=self.tramos, ref=self.ref, atrib=self.atrib,
            objetivos={sid: (o.pospago, o.gpon) for sid, o in self.objetivos.items()},
            prod=self.prod, supervisores=set(self.supervisores), coaching=gestion,
        )
        return self

    def info_scoring(self) -> dict[str, Any]:
        sc = self.sc_params
        return {"version": sc["version"], "asesor": sc["asesor"], "supervisor": sc["supervisor"], "uso_cero": sc["uso_cero"],
                "min_horas_conversacion": sc["min_horas_conversacion"], "conversacion": sc["conversacion"],
                "min_cobertura": scoring.MIN_COBERTURA, "productividad": self.fuente_prod,
                "gestion_desde": self.inicio_gestion.isoformat() if self.inicio_gestion else None,
                "dias_foco": scoring.DIAS_FOCO}

    def actual(self, op_id: str) -> str | None:
        return supervisor_en(self.tramos.get(op_id, []), self.ref)

    def equipo(self, sup_id: str) -> list[str]:
        return [op for op in self.tramos if self.actual(op) == sup_id]

    def vendido(self, sup_id: str | None, producto: str) -> int | None:
        if not self.reporte:
            return None
        return (self.atrib["supervisores"].get(sup_id) or {}).get(producto, 0)

    def uso(self, op_id: str) -> dict[str, Any] | None:
        u = self.atrib["operadores"].get(op_id)
        return {k: u[k] for k in ("evaluables", "sin_uso", "en_espera", "pct_sin_uso", "alerta", "a_recuperar")} if u else None

    def alerta_de(self, ops: list[str]) -> tuple[int, int]:
        usos = [self.atrib["operadores"].get(o) or {} for o in ops]
        return sum(1 for u in usos if u.get("alerta")), sum(u.get("a_recuperar", 0) for u in usos)

    def comun(self) -> dict[str, Any]:
        return {
            "periodo": self.periodo, "nombre_mes": nombre_mes(self.periodo), "referencia": self.ref.isoformat(),
            "ventas": _desc_ventas(self.reporte), "calendario": self.cal,
            "parametros": {k: self.p[k] for k in ("umbral_sin_uso", "min_evaluables", "semaforo_en_camino",
                                                  "semaforo_en_riesgo", "min_dias_proyeccion", "pesos_dia")},
        }

    def objetivo(self, sup_id: str, nombres: dict[str, str]) -> dict[str, Any]:
        o = self.objetivos.get(sup_id)
        return {"pospago": o.pospago if o else None, "gpon": o.gpon if o else None,
                "updated_at": _iso(o.updated_at) if o else None,
                "updated_by": nombres.get(o.updated_by or "", o.updated_by) if o else None}

    def detalle(self, sup_id: str, nombres: dict[str, str]) -> dict[str, Any]:
        """Lo que ve un supervisor de su mes (y los jefes, en el detalle de cada supervisor)."""
        obj = self.objetivo(sup_id, nombres)
        actuales = set(self.equipo(sup_id))
        asesores = []
        atribuidas = (self.atrib["supervisores"].get(sup_id) or {}).get("asesores", {})
        for op_id, tramos in self.tramos.items():
            mios = [t for t in _intervalos(tramos, self.ultimo) if t["supervisor_id"] == sup_id]
            if not mios and op_id not in atribuidas:
                continue
            o = self.ops.get(op_id)
            if not o:
                continue
            a = atribuidas.get(op_id, {})
            sc_op = self.sc["asesores"].get(op_id) if hasattr(self, "sc") and op_id in actuales else None
            asesores.append({
                **_op_corto(o),
                "score": sc_op["total"] if sc_op else None,
                "parcial": bool(sc_op and sc_op["parcial"]),
                "componentes": sc_op["componentes"] if sc_op else [],
                "actual": op_id in actuales,
                "desde": mios[0]["desde"].isoformat() if mios and mios[0]["desde"] > self.primero else None,
                "hasta": mios[-1]["hasta"].isoformat() if mios and mios[-1]["hasta"] < self.ultimo and op_id not in actuales else None,
                "pospago": a.get("pospago", 0) if self.reporte else None,
                "gpon": a.get("gpon", 0) if self.reporte else None,
                "uso": self.uso(op_id) if self.reporte else None,
            })
        asesores.sort(key=lambda x: (not x["actual"], not ((x["uso"] or {}).get("alerta")),
                                     -((x["uso"] or {}).get("a_recuperar") or 0), -(x["pospago"] or 0), x["nombre"]))
        en_alerta, a_recuperar = self.alerta_de(list(actuales))
        sup = self.supervisores.get(sup_id) or {"id": sup_id, "nombre": nombres.get(sup_id, sup_id), "activo": False}
        return {
            **self.comun(),
            "supervisor": sup,
            "objetivo": obj,
            "pospago": proyeccion(self.vendido(sup_id, "pospago"), obj["pospago"], self.cal, self.p),
            "gpon": proyeccion(self.vendido(sup_id, "gpon"), obj["gpon"], self.cal, self.p),
            "asesores_actuales": len(actuales),
            "critico": en_alerta > 0, "asesores_en_alerta": en_alerta, "a_recuperar": a_recuperar,
            "asesores": asesores,
            "scoring": self.scoring_supervisor(sup_id) if hasattr(self, "sc") else None,
        }

    def scoring_supervisor(self, sup_id: str) -> dict[str, Any] | None:
        x = self.sc["supervisores"].get(sup_id)
        if not x:
            return None
        return {"total": x["total"], "resultado": x["resultado"], "partes": x["partes"], "componentes": x["componentes"],
                "parcial": x["parcial"], "parametros": self.info_scoring()}


async def contexto(db: AsyncSession, periodo: str, *, con_scoring: bool = True) -> Contexto:
    ctx = await Contexto(periodo).cargar(db)
    if con_scoring:
        await ctx.cargar_scoring(db)
    return ctx


def _anterior(prev: Contexto, tipo: str, clave: str | None = None) -> float | None:
    if tipo == "operacion":
        return prev.sc["operacion"]["total"]
    return ((prev.sc[tipo].get(clave) or {}).get("total")) if clave else None


# ------------------------------------------------------------------ resumen de todos los supervisores
@router.get("/resumen")
async def resumen(periodo: Optional[str] = Query(None), user: CurrentUser = Depends(require_ver),
                  db: AsyncSession = Depends(get_db)) -> dict:
    """Objetivos, avance y proyección al cierre de cada supervisor, y alertas por líneas sin uso."""
    ctx = await Contexto(_periodo(periodo)).cargar(db)
    nombres = await _nombres(db, {o.updated_by for o in ctx.objetivos.values()})
    ids = {s for s in (ctx.actual(op) for op in ctx.tramos) if s} | set(ctx.objetivos) \
        | {s for s in ctx.atrib["supervisores"] if s} | {i for i, s in ctx.supervisores.items() if s["activo"]}
    filas = []
    for sid in ids:
        equipo = ctx.equipo(sid)
        en_alerta, a_recuperar = ctx.alerta_de(equipo)
        obj = ctx.objetivo(sid, nombres)
        filas.append({
            **(ctx.supervisores.get(sid) or {"id": sid, "nombre": sid, "activo": False}),
            "asesores": len(equipo), "objetivo": obj,
            "pospago": proyeccion(ctx.vendido(sid, "pospago"), obj["pospago"], ctx.cal, ctx.p),
            "gpon": proyeccion(ctx.vendido(sid, "gpon"), obj["gpon"], ctx.cal, ctx.p),
            "critico": en_alerta > 0, "asesores_en_alerta": en_alerta, "a_recuperar": a_recuperar,
        })
    filas.sort(key=lambda f: (not f["activo"] and not f["asesores"], f["nombre"].lower()))

    total = ctx.atrib["total"]
    objetivos_pp = sum(f["objetivo"]["pospago"] or 0 for f in filas)
    objetivos_gp = sum(f["objetivo"]["gpon"] or 0 for f in filas)
    sin_sup = ctx.atrib["supervisores"].get(None) or {"pospago": 0, "gpon": 0, "asesores": {}}
    sin_op = ctx.atrib["sin_operador"]
    con_equipo = {op for op in ctx.tramos if ctx.actual(op)}
    alertas_op = [op for op, u in ctx.atrib["operadores"].items() if u["alerta"]]
    return {
        **ctx.comun(),
        "operacion": {
            "netas": total["netas"] if ctx.reporte else None,
            "pospago": proyeccion(total["pospago"] if ctx.reporte else None, objetivos_pp or None, ctx.cal, ctx.p),
            "gpon": proyeccion(total["gpon"] if ctx.reporte else None, objetivos_gp or None, ctx.cal, ctx.p),
            "asesores_en_alerta": len(alertas_op),
            "asesores_en_alerta_sin_supervisor": sum(1 for op in alertas_op if op not in con_equipo),
            "a_recuperar": sum(ctx.atrib["operadores"][op]["a_recuperar"] for op in alertas_op),
            "supervisores_criticos": sum(1 for f in filas if f["critico"]),
            "supervisores": sum(1 for f in filas if f["asesores"]),
        },
        "supervisores": filas,
        "sin_supervisor": {
            "pospago": sin_sup["pospago"] + sum(x.get("pospago", 0) for x in sin_op.values()),
            "gpon": sin_sup["gpon"] + sum(x.get("gpon", 0) for x in sin_op.values()),
            "asesores": len(sin_sup.get("asesores", {})),
            "vendedores_sin_operador": sorted(v for v in sin_op if v != "SIN VENDEDOR"),
            "netas_sin_vendedor": sum(sin_op.get("SIN VENDEDOR", {}).values()) if "SIN VENDEDOR" in sin_op else 0,
        },
        "equipos_cargados": bool(ctx.asigs),
        "puede_gestionar": user.has_perm(PERM_GESTION),
    }


@router.get("/supervisores")
async def listar_supervisores(user: CurrentUser = Depends(require_ver_operadores), db: AsyncSession = Depends(get_db)) -> dict:
    """Supervisores de la operativa (usuarios con perfil Supervisor), para elegir a quién asignar."""
    sups = await _supervisores(db)
    return {"items": sorted((s for s in sups.values() if s["activo"]), key=lambda s: s["nombre"].lower())}


@router.get("/supervisores/{supervisor_id}")
async def ver_supervisor(supervisor_id: str, periodo: Optional[str] = Query(None), user: CurrentUser = Depends(require_ver),
                         db: AsyncSession = Depends(get_db)) -> dict:
    per = _periodo(periodo)
    ctx = await contexto(db, per)
    if supervisor_id not in ctx.supervisores:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supervisor no encontrado")
    nombres = await _nombres(db, {o.updated_by for o in ctx.objetivos.values()})
    d = ctx.detalle(supervisor_id, nombres)
    if d["scoring"]:
        d["scoring"]["anterior"] = _anterior(await contexto(db, mes_anterior(per)), "supervisores", supervisor_id)
    return d


def _lineas_de(ctx: Contexto, lineas: list[dict[str, Any]], op_id: str) -> list[dict[str, Any]]:
    o = ctx.ops[op_id]
    out = [{"sds": ln["sds"], "linea": ln["linea"], "plan": ln["plan"], "fecha_activacion": ln["fecha_activacion"],
            "dias": ln["dias"], "estado": "sin_uso" if ln["sin_uso"] else "en_espera"}
           for ln in lineas if ln["vendedor"] == o.vendedor and (ln["sin_uso"] or ln["en_espera"])]
    out.sort(key=lambda x: (x["estado"] != "sin_uso", -(x["dias"] or 0)))
    return out


@router.get("/lineas")
async def lineas_sin_uso(operador_id: str, request: Request, periodo: Optional[str] = Query(None),
                         user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """Pospago sin uso (y en espera) de un asesor en el mes."""
    ctx = await Contexto(_periodo(periodo)).cargar(db)
    if operador_id not in ctx.ops:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Operador no encontrado")
    _, lineas = await ventas_del_mes(db, ctx.periodo)
    await record_action(db, user_id=user.id, action="ver_lineas_sin_uso", resource_type="operador", resource_id=operador_id,
                        ip=client_ip(request), extra={"periodo": ctx.periodo})
    return {**_op_corto(ctx.ops[operador_id]), "uso": ctx.uso(operador_id), "lineas": _lineas_de(ctx, lineas, operador_id)}


# ------------------------------------------------------------------ portal del supervisor
@router.get("/portal")
async def portal(periodo: Optional[str] = Query(None), user: CurrentUser = Depends(require_portal),
                 db: AsyncSession = Depends(get_db)) -> dict:
    """El mes del supervisor que entra: su equipo, sus objetivos, su avance y proyección y sus alertas."""
    per = _periodo(periodo)
    ctx = await contexto(db, per)
    nombres = await _nombres(db, {o.updated_by for o in ctx.objetivos.values()} | {user.id})
    if user.id not in ctx.supervisores:
        ctx.supervisores[user.id] = {"id": user.id, "nombre": user.full_name, "activo": user.role == ROL_SUPERVISOR}
    d = ctx.detalle(user.id, nombres)
    if d["scoring"]:
        d["scoring"]["anterior"] = _anterior(await contexto(db, mes_anterior(per)), "supervisores", user.id)
    d["coaching"] = await _para_hoy(db, ctx, user.id)
    return d


DIAS_PROXIMOS = 2  # seguimientos «próximos»: los de los próximos 2 días hábiles


def proximos_hasta(p: dict[str, Any], dia: date) -> date:
    """Hasta qué día un seguimiento es «próximo»: los próximos días hábiles (el sábado suma medio, con los feriados)."""
    return sumar_habiles(dia, DIAS_PROXIMOS, p["pesos_dia"], p["feriados"])


async def _para_hoy(db: AsyncSession, ctx: Contexto, sid: str) -> dict[str, Any]:
    """Lo que el supervisor tiene que atender de su gestión: seguimientos y alertas de uso, y quién no tuvo coaching."""
    dia = hoy()
    pendientes = await coaching_srv.abiertos(db, sid)
    seguimientos = Counter(coaching_srv.estado_seguimiento(c, dia) for c in pendientes)
    # Los que vienen en los próximos días hábiles (para prepararlos antes de que lleguen).
    tope = proximos_hasta(ctx.p, dia)
    proximos = sum(1 for c in pendientes if coaching_srv.estado_seguimiento(c, dia) == "proximo" and c.seguimiento_fecha <= tope)
    alertas = Counter(a["estado"] for a in alertas_srv.del_supervisor(
        ctx.alertas, sid, p=ctx.p, tramos=ctx.tramos, ref=ctx.ref, primero=ctx.primero, coachings=ctx.coachings, hoy=dia,
        nombres={}))
    con = {c.operador_id for c in ctx.coachings if ctx.primero <= c.fecha <= min(ctx.ultimo, dia)}
    momento = tickets_srv.ahora()
    abiertos = await tickets_srv.abiertos(db, sid)
    situacion = Counter(estado_sla(t, ctx.horario, momento)["situacion"] for t in abiertos)
    return {"seguimientos_vencidos": seguimientos.get("vencido", 0), "seguimientos_hoy": seguimientos.get("hoy", 0),
            "seguimientos_proximos": proximos, "proximos_hasta": tope.isoformat(),
            "alertas_vencidas": alertas.get("vencida", 0), "alertas_en_plazo": alertas.get("en_plazo", 0),
            "sin_coaching": sum(1 for op in ctx.equipo(sid) if op not in con),
            "tickets_nuevos": sum(1 for t in abiertos if t.estado == "nuevo"),
            "tickets_por_vencer": situacion.get("por_vencer", 0), "tickets_vencidos": situacion.get("vencido", 0)}


@router.get("/portal/lineas")
async def portal_lineas(operador_id: str, request: Request, periodo: Optional[str] = Query(None),
                        user: CurrentUser = Depends(require_portal), db: AsyncSession = Depends(get_db)) -> dict:
    """Líneas sin uso de un asesor del equipo del supervisor (solo de su equipo en ese mes)."""
    ctx = await Contexto(_periodo(periodo)).cargar(db)
    tramos = ctx.tramos.get(operador_id, [])
    if operador_id not in ctx.ops or not any(s == user.id for _, s in tramos):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese asesor no está en tu equipo este mes")
    _, lineas = await ventas_del_mes(db, ctx.periodo)
    await record_action(db, user_id=user.id, action="ver_lineas_sin_uso", resource_type="operador", resource_id=operador_id,
                        ip=client_ip(request), extra={"periodo": ctx.periodo, "portal": True})
    return {**_op_corto(ctx.ops[operador_id]), "uso": ctx.uso(operador_id), "lineas": _lineas_de(ctx, lineas, operador_id)}


# ------------------------------------------------------------------ equipos del mes
@router.get("/equipos")
async def ver_equipos(periodo: Optional[str] = Query(None), user: CurrentUser = Depends(require_ver),
                      db: AsyncSession = Depends(get_db)) -> dict:
    """Equipos del mes: cada supervisor con sus asesores (con fecha efectiva) y los asesores sin supervisor."""
    per = _periodo(periodo)
    deteccion = await maestro.detectar(db, per)
    primero, ultimo = limites(per)
    ref = referencia(per)
    asigs = await _asignaciones(db, per)
    tramos = _tramos(asigs)
    ops = {o.id: o for o in await maestro.todos(db)}
    sups = await _supervisores(db, {a.supervisor_id for a in asigs if a.supervisor_id})
    anterior = mes_anterior(per)
    hay_anterior = (await db.execute(select(EquipoAsignacion.id).where(
        EquipoAsignacion.operativa == OPERATIVA, EquipoAsignacion.periodo == anterior).limit(1))).first() is not None

    def miembro(op_id: str) -> dict[str, Any]:
        o = ops[op_id]
        return {**_op_corto(o), "ultima_vez": _iso(o.ultima_vez),
                "tramos": [{"desde": t["desde"].isoformat(), "hasta": t["hasta"].isoformat(), "supervisor_id": t["supervisor_id"],
                            "supervisor": (sups.get(t["supervisor_id"]) or {}).get("nombre") if t["supervisor_id"] else None}
                           for t in _intervalos(tramos.get(op_id, []), ultimo)]}

    por_sup: dict[str, list[dict[str, Any]]] = {sid: [] for sid, s in sups.items() if s["activo"]}
    sin: list[dict[str, Any]] = []
    for op_id in tramos:
        if op_id not in ops:
            continue
        sid = supervisor_en(tramos[op_id], ref)
        if sid:
            por_sup.setdefault(sid, []).append(miembro(op_id))
        elif ops[op_id].activo:
            sin.append(miembro(op_id))
    desde_actividad = primero - timedelta(days=DIAS_ACTIVIDAD)
    for o in ops.values():  # activos en el mes (o justo antes) que todavía no tienen equipo este mes
        if o.id not in tramos and o.activo and o.ultima_vez and o.ultima_vez >= desde_actividad \
                and (not o.primera_vez or o.primera_vez <= ultimo):
            sin.append(miembro(o.id))
    for lista in [*por_sup.values(), sin]:
        lista.sort(key=lambda m: m["nombre"].lower())
    return {
        "periodo": per, "nombre_mes": nombre_mes(per), "referencia": ref.isoformat(),
        "primero": primero.isoformat(), "ultimo": ultimo.isoformat(),
        "anterior": anterior, "nombre_anterior": nombre_mes(anterior), "anterior_tiene_equipos": hay_anterior,
        "tiene_equipos": bool(asigs),
        "supervisores": sorted(({**sups[sid], "asesores": lista} for sid, lista in por_sup.items() if sid in sups),
                               key=lambda s: (not s["activo"], s["nombre"].lower())),
        "sin_supervisor": sin,
        "deteccion": deteccion,
        "puede_gestionar": user.has_perm(PERM_GESTION),
    }


class AsignarPayload(BaseModel):
    periodo: str = Field(..., min_length=7, max_length=7)
    operador_ids: list[str] = Field(..., min_length=1, max_length=500)
    supervisor_id: Optional[str] = Field(None, max_length=36)
    desde: Optional[date] = None


async def _validar_supervisor(db: AsyncSession, supervisor_id: str | None) -> dict[str, Any] | None:
    if supervisor_id is None:
        return None
    sups = await _supervisores(db)
    s = sups.get(supervisor_id)
    if not s or not s["activo"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Elegí un supervisor activo de la operativa")
    return s


@router.post("/equipos/asignar")
async def asignar(payload: AsignarPayload, request: Request, user: CurrentUser = Depends(require_gestion),
                  db: AsyncSession = Depends(get_db)) -> dict:
    """Desde `desde` (por defecto el día 1) los asesores pasan a ese supervisor (o quedan sin supervisor)."""
    per = _periodo(payload.periodo)
    primero, ultimo = limites(per)
    desde = payload.desde or primero
    if not primero <= desde <= ultimo:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"La fecha efectiva tiene que ser de {nombre_mes(per)}")
    sup = await _validar_supervisor(db, payload.supervisor_id)
    ids = list(dict.fromkeys(payload.operador_ids))
    ops = {o.id: o for o in (await db.execute(select(Operador).where(Operador.id.in_(ids)))).scalars().all()}
    if len(ops) != len(ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Algún asesor no existe")
    rows = (await db.execute(select(EquipoAsignacion).where(
        EquipoAsignacion.operativa == OPERATIVA, EquipoAsignacion.periodo == per,
        EquipoAsignacion.operador_id.in_(ids)))).scalars().all()
    cambios = 0
    for op_id in ids:
        propias = sorted((r for r in rows if r.operador_id == op_id), key=lambda r: r.desde)
        antes = [r for r in propias if r.desde < desde]
        for r in propias:
            if r.desde >= desde:
                await db.delete(r)
        previo = antes[-1].supervisor_id if antes else None
        if payload.supervisor_id != previo:
            db.add(EquipoAsignacion(operativa=OPERATIVA, periodo=per, operador_id=op_id,
                                    supervisor_id=payload.supervisor_id, desde=desde, created_by=user.id))
        cambios += 1
    await db.commit()
    await record_action(db, user_id=user.id, action="equipo_asignado", resource_type="equipo", resource_id=per,
                        ip=client_ip(request), extra={
                            "periodo": per, "desde": desde.isoformat(), "supervisor_id": payload.supervisor_id,
                            "supervisor": sup["nombre"] if sup else None,
                            "asesores": [ops[i].nombre for i in ids][:100], "cantidad": len(ids)})
    return {"periodo": per, "asignados": cambios, "desde": desde.isoformat()}


class CopiarPayload(BaseModel):
    periodo: str = Field(..., min_length=7, max_length=7)


@router.post("/equipos/copiar")
async def copiar(payload: CopiarPayload, request: Request, user: CurrentUser = Depends(require_gestion),
                 db: AsyncSession = Depends(get_db)) -> dict:
    """Arma el mes con los equipos con que cerró el anterior (solo los asesores que todavía no tienen equipo este mes)."""
    per = _periodo(payload.periodo)
    anterior = mes_anterior(per)
    _, fin_anterior = limites(anterior)
    primero, _ = limites(per)
    tramos_ant = _tramos(await _asignaciones(db, anterior))
    if not tramos_ant:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{nombre_mes(anterior).capitalize()} no tiene equipos para copiar")
    ya = {a.operador_id for a in await _asignaciones(db, per)}
    activos = {o.id for o in await maestro.todos(db) if o.activo}
    sups = await _supervisores(db)
    copiados = omitidos = 0
    for op_id, tramos in tramos_ant.items():
        sid = supervisor_en(tramos, fin_anterior)
        if not sid or op_id in ya or op_id not in activos or not (sups.get(sid) or {}).get("activo"):
            omitidos += 1 if sid else 0
            continue
        db.add(EquipoAsignacion(operativa=OPERATIVA, periodo=per, operador_id=op_id, supervisor_id=sid, desde=primero,
                                created_by=user.id))
        copiados += 1
    await db.commit()
    await record_action(db, user_id=user.id, action="equipos_copiados", resource_type="equipo", resource_id=per,
                        ip=client_ip(request), extra={"periodo": per, "desde_mes": anterior, "copiados": copiados, "omitidos": omitidos})
    return {"periodo": per, "desde_mes": anterior, "copiados": copiados, "omitidos": omitidos}


# ------------------------------------------------------------------ objetivos
class ObjetivoPayload(BaseModel):
    periodo: str = Field(..., min_length=7, max_length=7)
    supervisor_id: str = Field(..., min_length=1, max_length=36)
    pospago: Optional[int] = Field(None, ge=0, le=100000)
    gpon: Optional[int] = Field(None, ge=0, le=100000)


@router.put("/objetivos")
async def guardar_objetivo(payload: ObjetivoPayload, request: Request, user: CurrentUser = Depends(require_gestion),
                           db: AsyncSession = Depends(get_db)) -> dict:
    """Objetivos del mes de un supervisor (netas Pospago y GPON de su equipo)."""
    per = _periodo(payload.periodo)
    sups = await _supervisores(db)
    if payload.supervisor_id not in sups:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supervisor no encontrado")
    o = (await db.execute(select(ObjetivoSupervisor).where(
        ObjetivoSupervisor.operativa == OPERATIVA, ObjetivoSupervisor.periodo == per,
        ObjetivoSupervisor.supervisor_id == payload.supervisor_id))).scalars().first()
    antes = {"pospago": o.pospago, "gpon": o.gpon} if o else None
    if not o:
        o = ObjetivoSupervisor(operativa=OPERATIVA, periodo=per, supervisor_id=payload.supervisor_id)
        db.add(o)
    o.pospago, o.gpon = payload.pospago, payload.gpon
    o.updated_at, o.updated_by = datetime.now(timezone.utc), user.id
    await db.commit()
    await record_action(db, user_id=user.id, action="objetivo_supervisor", resource_type="objetivo",
                        resource_id=f"{per}:{payload.supervisor_id}", ip=client_ip(request), extra={
                            "periodo": per, "supervisor": sups[payload.supervisor_id]["nombre"], "antes": antes,
                            "despues": {"pospago": payload.pospago, "gpon": payload.gpon}})
    return {"periodo": per, "supervisor_id": payload.supervisor_id, "pospago": o.pospago, "gpon": o.gpon,
            "updated_at": _iso(o.updated_at)}


# ------------------------------------------------------------------ parámetros (calendario)
@router.get("/parametros")
async def ver_parametros(user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    p = await parametros(db)
    p["updated_by"] = (await _nombres(db, {p["updated_by"]})).get(p["updated_by"] or "", p["updated_by"])
    return p


class NoLaborable(BaseModel):
    fecha: date
    motivo: str = Field("", max_length=120)


class ParametrosPayload(BaseModel):
    pesos_dia: list[float] = Field(..., min_length=7, max_length=7)
    no_laborables: list[NoLaborable] = Field(default_factory=list, max_length=200)
    horario: Optional[dict[str, Optional[list[str]]]] = None  # horario de atención (plazos de los tickets)


@router.put("/parametros")
async def guardar_parametros(payload: ParametrosPayload, request: Request, user: CurrentUser = Depends(require_gestion),
                             db: AsyncSession = Depends(get_db)) -> dict:
    """Calendario de la operación: cuánto vale cada día de la semana (0, medio o 1), los días no laborables y el
    horario de atención (las horas hábiles con que se miden los plazos de los tickets)."""
    if any(x not in (0, 0.5, 1) for x in payload.pesos_dia):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cada día vale 0, 0,5 o 1")
    if not any(payload.pesos_dia):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Al menos un día de la semana tiene que ser hábil")
    row = await db.get(SupParametros, OPERATIVA)
    antes = dict(row.data) if row else None
    data = {**((row.data if row else None) or {}),
            "pesos_dia": [float(x) for x in payload.pesos_dia],
            "no_laborables": sorted(({"fecha": x.fecha.isoformat(), "motivo": x.motivo.strip()} for x in payload.no_laborables),
                                    key=lambda x: x["fecha"])}
    if payload.horario is not None:
        try:
            data["horario"] = validar_horario(payload.horario)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    if not row:
        row = SupParametros(operativa=OPERATIVA, data=data)
        db.add(row)
    row.data, row.updated_at, row.updated_by = data, datetime.now(timezone.utc), user.id
    await db.commit()
    await record_action(db, user_id=user.id, action="supervision_parametros", resource_type="parametros",
                        resource_id=OPERATIVA, ip=client_ip(request), extra={"antes": antes, "despues": data})
    return await ver_parametros(user, db)


# ------------------------------------------------------------------ maestro de operadores
def _op_completo(o: Operador, nombres: dict[str, str], pendientes: list[Operador]) -> dict[str, Any]:
    pendiente = o.cruce in AGENTE_PENDIENTE + VENDEDOR_PENDIENTE
    return {
        **_op_corto(o), "agente_clave": o.agente_clave, "legajo": o.legajo, "candidatos": list(o.candidatos or []),
        "sugeridos": maestro.sugerencias(o, pendientes) if pendiente else [],
        "primera_vez": _iso(o.primera_vez), "ultima_vez": _iso(o.ultima_vez), "nombre_manual": o.nombre_manual,
        "updated_at": _iso(o.updated_at), "updated_by": nombres.get(o.updated_by or "", o.updated_by),
    }


@router.get("/operadores")
async def listar_operadores(periodo: Optional[str] = Query(None), user: CurrentUser = Depends(require_ver_operadores),
                            db: AsyncSession = Depends(get_db)) -> dict:
    """El maestro: cada operador con su nombre en llamadas y en ventas, cómo se cruzaron y sugerencias para los pendientes."""
    per = _periodo(periodo)
    deteccion = await maestro.detectar(db, per)
    primero, ultimo = limites(per)
    ops = await maestro.todos(db)
    nombres = await _nombres(db, {o.updated_by for o in ops})
    pendientes = [o for o in ops if o.cruce in AGENTE_PENDIENTE + VENDEDOR_PENDIENTE]
    items = []
    for o in sorted(ops, key=lambda o: o.nombre.lower()):
        x = _op_completo(o, nombres, pendientes)
        x["del_mes"] = bool(o.ultima_vez and o.ultima_vez >= primero and (not o.primera_vez or o.primera_vez <= ultimo))
        items.append(x)
    return {
        "periodo": per, "nombre_mes": nombre_mes(per), "deteccion": deteccion,
        "resumen": {
            "total": len(ops),
            "vinculados": sum(1 for o in ops if o.cruce in VINCULADO),
            "por_revisar": len(pendientes),
            "solo_llamadas": sum(1 for o in ops if o.agente_clave and not o.vendedor),
            "solo_ventas": sum(1 for o in ops if o.vendedor and not o.agente_clave),
            "inactivos": sum(1 for o in ops if not o.activo),
        },
        "items": items,
        "puede_gestionar": user.has_perm(PERM_OPERADORES),
    }


class DetectarPayload(BaseModel):
    periodo: str = Field(..., min_length=7, max_length=7)


@router.post("/operadores/detectar")
async def detectar(payload: DetectarPayload, request: Request, user: CurrentUser = Depends(require_operadores),
                   db: AsyncSession = Depends(get_db)) -> dict:
    per = _periodo(payload.periodo)
    r = await maestro.detectar(db, per, forzar=True)
    await record_action(db, user_id=user.id, action="operadores_detectados", resource_type="operador", resource_id=per,
                        ip=client_ip(request), extra={k: r.get(k) for k in ("agentes", "vendedores", "nuevos", "unidos")})
    return r


async def _operador(db: AsyncSession, operador_id: str) -> Operador:
    o = await db.get(Operador, operador_id)
    if not o or o.operativa != OPERATIVA:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Operador no encontrado")
    return o


class VincularPayload(BaseModel):
    con: str = Field(..., min_length=1, max_length=36)


@router.post("/operadores/{operador_id}/vincular")
async def vincular_operadores(operador_id: str, payload: VincularPayload, request: Request,
                              user: CurrentUser = Depends(require_operadores), db: AsyncSession = Depends(get_db)) -> dict:
    """Une el nombre de llamadas de uno con el nombre de vendedor del otro (decisión de una persona)."""
    a, b = await _operador(db, operador_id), await _operador(db, payload.con)
    if a.id == b.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Elegí otro operador")
    if a.agente_clave and b.vendedor and not b.agente_clave:
        a_op, v_op = a, b
    elif b.agente_clave and a.vendedor and not a.agente_clave:
        a_op, v_op = b, a
    elif a.agente_clave and b.vendedor:
        a_op, v_op = a, b
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Uno tiene que tener nombre en llamadas y el otro, nombre de vendedor")
    try:
        queda, descartados = await maestro.vincular(db, a_op, v_op, user.id)
    except maestro.VinculoInvalido as exc:
        await db.rollback()
        codigo = status.HTTP_409_CONFLICT if "ya está vinculado" in str(exc) else status.HTTP_400_BAD_REQUEST
        raise HTTPException(codigo, str(exc)) from exc
    await db.commit()
    await record_action(db, user_id=user.id, action="operador_vinculado", resource_type="operador", resource_id=queda.id,
                        ip=client_ip(request), extra={"agente": queda.agente_clave, "vendedor": queda.vendedor,
                                                      "equipos_descartados": descartados})
    return {"operador": _op_corto(queda), "equipos_descartados": descartados}


@router.post("/operadores/{operador_id}/separar")
async def separar_operador(operador_id: str, request: Request, user: CurrentUser = Depends(require_operadores),
                           db: AsyncSession = Depends(get_db)) -> dict:
    """El vendedor sale a un operador propio; el nombre de llamadas sigue con sus equipos."""
    o = await _operador(db, operador_id)
    try:
        nuevo = await maestro.separar(db, o, user.id)
    except maestro.VinculoInvalido as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    o.cruce = "descartado"  # una persona dijo que no es ese vendedor: el cruce automático no lo vuelve a unir
    await db.commit()
    await record_action(db, user_id=user.id, action="operador_separado", resource_type="operador", resource_id=o.id,
                        ip=client_ip(request), extra={"agente": o.agente_clave, "vendedor": nuevo.vendedor})
    return {"operador": _op_corto(o), "nuevo": _op_corto(nuevo)}


@router.post("/operadores/{operador_id}/confirmar")
async def confirmar_operador(operador_id: str, request: Request, user: CurrentUser = Depends(require_operadores),
                             db: AsyncSession = Depends(get_db)) -> dict:
    """Confirma el estado: un vínculo probable pasa a manual; un pendiente queda «no vende» o «solo ventas»."""
    o = await _operador(db, operador_id)
    antes = o.cruce
    if o.agente_clave and o.vendedor:
        o.cruce = "manual"
    elif o.agente_clave:
        o.cruce = "descartado"
    else:
        o.cruce = "solo_ventas"
    o.candidatos, o.updated_at, o.updated_by = [], datetime.now(timezone.utc), user.id
    await db.commit()
    await record_action(db, user_id=user.id, action="operador_confirmado", resource_type="operador", resource_id=o.id,
                        ip=client_ip(request), extra={"antes": antes, "despues": o.cruce})
    return {"operador": _op_corto(o)}


@router.post("/operadores/{operador_id}/automatico")
async def automatico_operador(operador_id: str, request: Request, user: CurrentUser = Depends(require_operadores),
                              db: AsyncSession = Depends(get_db)) -> dict:
    """Deshace lo decidido a mano: vuelve al cruce automático por nombre."""
    o = await _operador(db, operador_id)
    antes = o.cruce
    if o.agente_clave and o.vendedor and o.cruce == "manual":
        await maestro.separar(db, o, user.id)
    elif not (o.agente_clave and o.vendedor):
        o.cruce = "sin_cruce" if o.agente_clave else "sin_agente"
    o.updated_at, o.updated_by = datetime.now(timezone.utc), user.id
    await db.flush()
    await maestro.cruzar_pendientes(db)
    await db.commit()
    await record_action(db, user_id=user.id, action="operador_automatico", resource_type="operador", resource_id=operador_id,
                        ip=client_ip(request), extra={"antes": antes})
    o = await db.get(Operador, operador_id)
    return {"operador": _op_corto(o) if o else None}


class OperadorPatch(BaseModel):
    nombre: Optional[str] = Field(None, min_length=2, max_length=200)
    activo: Optional[bool] = None


@router.patch("/operadores/{operador_id}")
async def editar_operador(operador_id: str, payload: OperadorPatch, request: Request,
                          user: CurrentUser = Depends(require_operadores), db: AsyncSession = Depends(get_db)) -> dict:
    """Renombrar (cómo se muestra) o dar de baja / reactivar. Dar de baja no borra su historia."""
    o = await _operador(db, operador_id)
    antes = {"nombre": o.nombre, "activo": o.activo}
    if payload.nombre is not None:
        o.nombre, o.nombre_manual = " ".join(payload.nombre.split()), True
    if payload.activo is not None:
        o.activo = payload.activo
    o.updated_at, o.updated_by = datetime.now(timezone.utc), user.id
    await db.commit()
    await record_action(db, user_id=user.id, action="operador_editado", resource_type="operador", resource_id=o.id,
                        ip=client_ip(request), extra={"antes": antes, "despues": {"nombre": o.nombre, "activo": o.activo}})
    return {"operador": _op_corto(o)}


# ------------------------------------------------------------------ tablero y scoring
def _con_actividad(x: dict[str, Any]) -> bool:
    return any(c["valor"] is not None or (c.get("netas") or 0) > 0 for c in x["componentes"])


@router.get("/tablero")
async def tablero(periodo: Optional[str] = Query(None), user: CurrentUser = Depends(require_ver),
                  db: AsyncSession = Depends(get_db)) -> dict:
    """Scoring del mes: la operación, el ranking de supervisores y cada asesor, con la tendencia contra el mes anterior."""
    per = _periodo(periodo)
    ctx = await contexto(db, per)
    prev = await contexto(db, mes_anterior(per))
    sups = []
    for sid, x in ctx.sc["supervisores"].items():
        info = ctx.supervisores.get(sid) or {"id": sid, "nombre": sid, "activo": False}
        equipo = ctx.equipo(sid)
        if not equipo and not info["activo"] and x["total"] is None:
            continue
        en_alerta, a_recuperar = ctx.alerta_de(equipo)
        sups.append({**info, "asesores": len(equipo), "total": x["total"], "resultado": x["resultado"],
                     "partes": x["partes"], "componentes": x["componentes"], "parcial": x["parcial"],
                     "anterior": _anterior(prev, "supervisores", sid),
                     "critico": en_alerta > 0, "asesores_en_alerta": en_alerta, "a_recuperar": a_recuperar})
    sups.sort(key=lambda r: (r["total"] is None, -(r["total"] or 0), r["nombre"].lower()))
    asesores = []
    for op, x in ctx.sc["asesores"].items():
        o = ctx.ops.get(op)
        if not o or not _con_actividad(x):
            continue
        sid = x["supervisor_id"]
        asesores.append({**_op_corto(o), "supervisor_id": sid,
                         "supervisor": (ctx.supervisores.get(sid) or {}).get("nombre") if sid else None,
                         "total": x["total"], "componentes": x["componentes"], "dias": x["dias"],
                         "parcial": x["parcial"], "cobertura": x["cobertura"],
                         "anterior": _anterior(prev, "asesores", op),
                         "alerta": bool((ctx.atrib["operadores"].get(op) or {}).get("alerta"))})
    asesores.sort(key=lambda r: (r["total"] is None, r["parcial"], -(r["total"] or 0), r["nombre"].lower()))
    return {
        **ctx.comun(),
        "scoring": ctx.info_scoring(),
        "operacion": {**ctx.sc["operacion"], "anterior": _anterior(prev, "operacion")},
        "supervisores": sups,
        "asesores": asesores,
        "anterior": {"periodo": prev.periodo, "nombre_mes": nombre_mes(prev.periodo)},
    }


@router.get("/parametros/scoring")
async def ver_parametros_scoring(user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    sc = await parametros_scoring(db)
    row = await db.get(SupParametros, OPERATIVA)
    historial = list(((row.data if row else None) or {}).get("scoring_historial") or [])[-10:]
    nombres = await _nombres(db, {h.get("por") for h in historial})
    p = await parametros(db)
    return {**sc, "umbral_sin_uso": p["umbral_sin_uso"], "min_evaluables": p["min_evaluables"],
            "historial": [{**h, "por": nombres.get(h.get("por") or "", h.get("por"))} for h in reversed(historial)],
            "puede_editar": user.has_perm(PERM_PARAMETROS)}


class PesosAsesor(BaseModel):
    pospago: int = Field(..., ge=0, le=100)
    uso: int = Field(..., ge=0, le=100)
    conversacion: int = Field(..., ge=0, le=100)
    gpon: int = Field(..., ge=0, le=100)


class PesosSupervisor(BaseModel):
    resultado: int = Field(..., ge=0, le=100)
    cobertura: int = Field(..., ge=0, le=100)
    foco: int = Field(..., ge=0, le=100)
    tickets: int = Field(..., ge=0, le=100)
    seguimiento: int = Field(..., ge=0, le=100)


class ScoringPayload(BaseModel):
    asesor: PesosAsesor
    supervisor: PesosSupervisor
    uso_cero: float = Field(..., gt=0, le=100)
    min_horas_conversacion: float = Field(..., ge=0.5, le=40)


@router.put("/parametros/scoring")
async def guardar_parametros_scoring(payload: ScoringPayload, request: Request, user: CurrentUser = Depends(require_parametros),
                                     db: AsyncSession = Depends(get_db)) -> dict:
    """Pesos y umbrales del scoring. Cada cambio es una versión nueva y queda en el historial y la auditoría."""
    if sum(payload.asesor.model_dump().values()) != 100:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Los pesos del asesor tienen que sumar 100")
    if sum(payload.supervisor.model_dump().values()) != 100:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Los pesos del supervisor tienen que sumar 100")
    p = await parametros(db)
    if payload.uso_cero <= p["umbral_sin_uso"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"El % sin uso con cero puntos tiene que ser mayor que el umbral ({p['umbral_sin_uso']}%)")
    actual = await parametros_scoring(db)
    row = await db.get(SupParametros, OPERATIVA)
    if not row:
        row = SupParametros(operativa=OPERATIVA, data={})
        db.add(row)
    data = dict(row.data or {})
    antes = {k: actual[k] for k in ("version", "asesor", "supervisor", "uso_cero", "min_horas_conversacion")}
    nuevo = {"version": int(actual["version"]) + 1, "asesor": payload.asesor.model_dump(), "supervisor": payload.supervisor.model_dump(),
             "uso_cero": payload.uso_cero, "min_horas_conversacion": payload.min_horas_conversacion}
    data["scoring"] = nuevo
    data["scoring_historial"] = [*(data.get("scoring_historial") or []),
                                 {"version": nuevo["version"], "fecha": datetime.now(timezone.utc).isoformat(), "por": user.id, "antes": antes}][-50:]
    row.data, row.updated_at, row.updated_by = data, datetime.now(timezone.utc), user.id
    await db.commit()
    await record_action(db, user_id=user.id, action="scoring_parametros", resource_type="parametros", resource_id=OPERATIVA,
                        ip=client_ip(request), extra={"antes": antes, "despues": nuevo})
    return await ver_parametros_scoring(user, db)
