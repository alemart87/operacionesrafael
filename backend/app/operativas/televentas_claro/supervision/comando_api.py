"""API del centro de comandos — Televentas Claro (modelo Líder Coach Comercial, fase 5).

* `televentas_claro.supervision`          → el centro de comandos (cabecera de la operación, semáforo de supervisores
                                            y alertas del día), la línea de tiempo de cada supervisor y la ficha de cada
                                            asesor. Auditoría y análisis lo ven en lectura.
* `televentas_claro.supervision_gestion`  → actuar sobre una alerta (coordinación, sub gerencia, controller): tomarla y
                                            anotar qué se hizo o descartarla con el motivo.
* … y además `televentas_claro.tickets`   → pedir una revisión desde la alerta: un ticket al supervisor, con un clic.

Las cuentas y las reglas están en `comando.py`.
"""
from __future__ import annotations

import asyncio
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip
from ....core.database import get_db
from ....models.user import User
from ....services.audit_service import record_action
from . import alertas as alertas_srv
from . import api as sup
from . import coaching as coaching_srv
from . import comando as srv
from . import operadores as maestro
from . import sla
from . import tickets as tickets_srv
from .calculo import mes_anterior, proyeccion
from .datos import horario as horario_de
from .datos import parametros
from .models import (
    AGENTE_PENDIENTE, OPERATIVA, VENDEDOR_PENDIENTE, AlertaAsesor, AlertaComando, BitacoraNota, Coaching, Operador, Ticket,
)
from .tickets_api import PERM_TICKETS

router = APIRouter(prefix="/televentas-claro/supervision", tags=["televentas-claro · centro de comandos"])

Prioridad = Literal["alta", "media", "baja"]
TipoTicket = Literal["venta_observada", "linea_sin_uso", "calidad", "reclamo", "conducta", "otro"]
DIAS_CASO = 120          # un ticket puede ser de un caso de hasta 4 meses atrás (como al enviarlo desde Tickets)
_acciones = asyncio.Lock()  # tomar, derivar y descartar: una a la vez (para no pedir dos revisiones de la misma alerta)


# ------------------------------------------------------------------ utilidades
async def _nombres(db: AsyncSession) -> dict[str, str]:
    """Nombre de cada usuario (son pocos): supervisores, jefes y quien tomó cada alerta."""
    out = await sup._nombres(db, set())
    out.update({i: n for i, n in (await db.execute(select(User.id, User.full_name))).all()})
    return out


async def _numeros(db: AsyncSession, ids: set[str | None]) -> dict[str, int]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {i: n for i, n in (await db.execute(select(Ticket.id, Ticket.numero).where(Ticket.id.in_(ids)))).all()}


def _del_mes(o: Operador, ctx: sup.Contexto) -> bool:
    return bool(o.ultima_vez and o.ultima_vez >= ctx.primero and (not o.primera_vez or o.primera_vez <= ctx.ultimo))


def _dias_sin_gestion(ctx: sup.Contexto, sid: str, ultima: datetime | None, dia: date) -> float | None:
    """Días hábiles desde lo último que registró. Sin registros, desde que se mide la gestión o desde que tiene
    equipo (si lo recibió en el mes): nadie arranca en rojo el día que le dan el equipo."""
    candidatos = [d for d in (alertas_srv.dia_local(ultima), ctx.inicio_gestion) if d]
    if ultima is None:
        desdes = [d for op in ctx.equipo(sid) for d, s in ctx.tramos.get(op, []) if s == sid]
        if desdes and min(desdes) > ctx.primero:
            candidatos.append(min(desdes))
    if not candidatos:
        return None
    base = max(candidatos)
    return srv.dias_habiles_entre(base, dia, ctx.p) if base < dia else 0.0


def _semaforo(ctx: sup.Contexto, prev: sup.Contexto, *, dia: date, tickets: list[tuple[Ticket, dict[str, Any]]],
              coachings_abiertos: list[Coaching], ultima: dict[str, datetime]) -> list[dict[str, Any]]:
    por_sup: dict[str | None, Counter] = defaultdict(Counter)
    for t, e in tickets:
        por_sup[t.supervisor_id][e["situacion"]] += 1
    seguimientos = Counter(c.supervisor_id for c in coachings_abiertos if coaching_srv.estado_seguimiento(c, dia) == "vencido")
    ids = {s for s in (ctx.actual(op) for op in ctx.tramos) if s} | {i for i, s in ctx.supervisores.items() if s["activo"]}
    filas = []
    for sid in ids:
        info = ctx.supervisores.get(sid) or {"id": sid, "nombre": sid, "activo": False}
        equipo = ctx.equipo(sid)
        en_alerta, a_recuperar = ctx.alerta_de(equipo)
        obj = ctx.objetivo(sid, {})
        alertas = Counter(a["estado"] for a in alertas_srv.del_supervisor(
            ctx.alertas, sid, p=ctx.p, tramos=ctx.tramos, ref=ctx.ref, primero=ctx.primero, coachings=ctx.coachings,
            hoy=dia, nombres={}))
        filas.append(srv.semaforo_fila(
            info=info, sc=ctx.sc["supervisores"].get(sid) or {}, anterior=sup._anterior(prev, "supervisores", sid),
            pospago=proyeccion(ctx.vendido(sid, "pospago"), obj["pospago"], ctx.cal, ctx.p),
            gpon=proyeccion(ctx.vendido(sid, "gpon"), obj["gpon"], ctx.cal, ctx.p),
            asesores=len(equipo), en_alerta=en_alerta, a_recuperar=a_recuperar, alertas=alertas, tickets=por_sup[sid],
            seguimientos_vencidos=seguimientos[sid], ultima=ultima.get(sid),
            dias_sin_gestion=_dias_sin_gestion(ctx, sid, ultima.get(sid), dia), umbral=ctx.p["umbral_sin_uso"]))
    filas.sort(key=srv.orden_semaforo)
    return filas


# ------------------------------------------------------------------ el centro de comandos
@router.get("/comando")
async def centro(user: CurrentUser = Depends(sup.require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """El día de la operación: cabecera, semáforo de supervisores y alertas del día. Al abrirlo, las alertas se ponen al
    día: se abren las condiciones nuevas y se cierran las que ya no se cumplen."""
    dia = sup.hoy()
    per = dia.strftime("%Y-%m")
    ctx = await sup.contexto(db, per)
    prev = await sup.contexto(db, mes_anterior(per))
    momento = tickets_srv.ahora()
    abiertos = [(t, sla.estado(t, ctx.horario, momento)) for t in await tickets_srv.abiertos(db)]
    coachings_abiertos = list((await db.execute(select(Coaching).where(
        Coaching.operativa == OPERATIVA, Coaching.estado == "abierto"))).scalars().all())
    nombres = await _nombres(db)
    filas = _semaforo(ctx, prev, dia=dia, tickets=abiertos, coachings_abiertos=coachings_abiertos,
                      ultima=await srv.ultima_gestion(db))
    pendientes = sum(1 for o in ctx.ops.values() if o.activo and o.cruce in AGENTE_PENDIENTE + VENDEDOR_PENDIENTE and _del_mes(o, ctx))
    conds = srv.condiciones(ctx, dia=dia, nombres=nombres, tickets=abiertos, coachings_abiertos=coachings_abiertos, filas=filas,
                            alertas_uso=ctx.alertas, pendientes_vincular=pendientes, horario=ctx.horario)
    await srv.sincronizar(db, conds, momento)
    recientes = await srv.alertas_recientes(db, dia)
    numeros = await _numeros(db, {a.ticket_id for a in recientes})
    asesores = {i: o.nombre for i, o in ctx.ops.items()}
    alertas = sorted((srv.alerta_dict(a, nombres, dia, numeros, asesores) for a in recientes), key=srv.orden_alertas)
    estados = Counter(a["estado"] for a in alertas)
    return {
        **ctx.comun(), "hoy": dia.isoformat(), "actualizado": momento.isoformat(),
        "cabecera": srv.cabecera(ctx, prev, tickets=abiertos, dia=dia),
        "supervisores": filas,
        "alertas": alertas,
        "resumen_alertas": {"abiertas": estados.get("abierta", 0), "tomadas": estados.get("tomada", 0),
                            "derivadas": estados.get("derivada", 0), "descartadas": estados.get("descartada", 0),
                            "cerradas": estados.get("cerrada", 0),
                            "nuevas": sum(1 for a in alertas if a["nueva"] and a["estado"] != "cerrada")},
        "reglas": {"dias_sin_gestion": srv.DIAS_SIN_GESTION, "dias_foco": sup.scoring.DIAS_FOCO,
                   "umbral_sin_uso": ctx.p["umbral_sin_uso"], "semaforo_en_riesgo": ctx.p["semaforo_en_riesgo"],
                   "semaforo_en_camino": ctx.p["semaforo_en_camino"]},
        "gestion_desde": ctx.inicio_gestion.isoformat() if ctx.inicio_gestion else None,
        "pendientes_vincular": pendientes,
        "puede_actuar": user.has_perm(sup.PERM_GESTION),
        "puede_derivar": user.has_perm(sup.PERM_GESTION) and user.has_perm(PERM_TICKETS),
        "tipos_ticket": tickets_srv.TIPOS,
        "tipo_revision": {t: x[2] for t, x in srv.TIPOS.items()},
        "plazos": {pr: {"respuesta": r, "resolucion": s} for pr, (r, s) in sla.PLAZOS.items()},
    }


# ------------------------------------------------------------------ actuar sobre una alerta
async def _alerta(db: AsyncSession, alerta_id: str) -> AlertaComando:
    a = await db.get(AlertaComando, alerta_id)
    if not a or a.operativa != OPERATIVA:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alerta no encontrada")
    await db.refresh(a)  # la pudo cerrar o tomar otro recién
    return a


async def _salida(db: AsyncSession, a: AlertaComando) -> dict[str, Any]:
    o = await db.get(Operador, a.operador_id) if a.operador_id else None
    return srv.alerta_dict(a, await _nombres(db), sup.hoy(), await _numeros(db, {a.ticket_id}), {o.id: o.nombre} if o else {})


def _regla(exc: coaching_srv.ReglaInvalida) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


class TomarPayload(BaseModel):
    nota: Optional[str] = Field(None, max_length=1000)


@router.post("/comando/alertas/{alerta_id}/tomar")
async def tomar(alerta_id: str, payload: TomarPayload, request: Request, user: CurrentUser = Depends(sup.require_gestion),
                db: AsyncSession = Depends(get_db)) -> dict:
    """La toma quien la va a atender. La nota dice qué se hizo; se puede escribir o actualizar después (también cuando
    la alerta ya se cerró sola, para dejar registrado cómo se resolvió)."""
    try:
        nota = coaching_srv.texto(payload.nota, "la nota", minimo=5, maximo=1000) if (payload.nota or "").strip() else None
    except coaching_srv.ReglaInvalida as exc:
        raise _regla(exc) from exc
    async with _acciones:
        a = await _alerta(db, alerta_id)
        if a.descartada_at is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "La alerta está descartada")
        if a.tomada_por and nota is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "La alerta ya está tomada: escribí qué se hizo")
        if a.hasta is not None and nota is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "La alerta ya se cerró: escribí qué se hizo")
        momento = tickets_srv.ahora()
        if not a.tomada_por:
            a.tomada_por, a.tomada_at = user.id, momento
        if nota:
            a.nota, a.nota_por, a.nota_at = nota, user.id, momento
        await db.commit()
    await record_action(db, user_id=user.id, action="alerta_tomada", resource_type="alerta_comando", resource_id=a.id,
                        ip=client_ip(request), extra={"tipo": a.tipo, "titulo": a.titulo, "nota": bool(nota)})
    return await _salida(db, a)


class RevisionPayload(BaseModel):
    prioridad: Prioridad
    texto: str = Field(..., max_length=tickets_srv.MAX_TEXTO)
    tipo: Optional[TipoTicket] = None


@router.post("/comando/alertas/{alerta_id}/revision", status_code=status.HTTP_201_CREATED)
async def pedir_revision(alerta_id: str, payload: RevisionPayload, request: Request, user: CurrentUser = Depends(sup.require_gestion),
                         db: AsyncSession = Depends(get_db)) -> dict:
    """Pide una revisión con un clic: un ticket al supervisor de la alerta (con el asesor, si la alerta es de uno), con
    sus plazos según la prioridad. La alerta queda derivada a ese ticket. Además de gestionar, hay que poder enviar tickets."""
    if not user.has_perm(PERM_TICKETS):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenés permiso para enviar tickets de revisión")
    dia = sup.hoy()
    async with _acciones:
        a = await _alerta(db, alerta_id)
        tipo_defecto = srv.TIPOS.get(a.tipo, (0, a.tipo, None))[2]
        if not tipo_defecto or not a.supervisor_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esta alerta no se deriva con un ticket")
        if a.hasta is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "La alerta ya se cerró: la condición dejó de cumplirse")
        if a.descartada_at is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "La alerta está descartada")
        if a.ticket_id:
            raise HTTPException(status.HTTP_409_CONFLICT, "Ya se pidió una revisión de esta alerta")
        sups = await sup._supervisores(db)
        if not (sups.get(a.supervisor_id) or {}).get("activo"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "El supervisor de la alerta ya no está activo en la operativa")
        tipo = payload.tipo or tipo_defecto
        try:
            descripcion, referencia = tickets_srv.validar(tipo, payload.prioridad, payload.texto,
                                                          f"Centro de comandos · {srv.TIPOS[a.tipo][1]}")
        except tickets_srv.ReglaInvalida as exc:
            raise _regla(exc) from exc
        fecha = min(max(alertas_srv.dia_local(a.desde), dia - timedelta(days=DIAS_CASO)), dia) if a.operador_id else None
        h = horario_de(await parametros(db))
        try:
            t = await tickets_srv.crear(db, horario=h, por=user.id, tipo=tipo, prioridad=payload.prioridad,
                                        supervisor_id=a.supervisor_id, operador_id=a.operador_id, fecha_caso=fecha,
                                        referencia=referencia, descripcion=descripcion)
        except tickets_srv.ReglaInvalida as exc:
            raise _regla(exc) from exc
        a = await _alerta(db, alerta_id)
        momento = tickets_srv.ahora()
        a.ticket_id = t.id
        if not a.tomada_por:
            a.tomada_por, a.tomada_at = user.id, momento
        await db.commit()
    await record_action(db, user_id=user.id, action="alerta_derivada", resource_type="alerta_comando", resource_id=a.id,
                        ip=client_ip(request), extra={"tipo": a.tipo, "titulo": a.titulo, "ticket": t.numero,
                                                     "prioridad": payload.prioridad, "supervisor": sups[a.supervisor_id]["nombre"]})
    return {**(await _salida(db, a)), "ticket": {"id": t.id, "numero": t.numero}}


class DescartarPayload(BaseModel):
    motivo: str = Field(..., max_length=500)


@router.post("/comando/alertas/{alerta_id}/descartar")
async def descartar(alerta_id: str, payload: DescartarPayload, request: Request, user: CurrentUser = Depends(sup.require_gestion),
                    db: AsyncSession = Depends(get_db)) -> dict:
    """Descarta una alerta que no requiere acción, con el motivo (queda en el historial y en la auditoría). Si la
    condición se va y vuelve a aparecer, es una alerta nueva."""
    try:
        motivo = coaching_srv.texto(payload.motivo, "el motivo", minimo=5, maximo=500)
    except coaching_srv.ReglaInvalida as exc:
        raise _regla(exc) from exc
    async with _acciones:
        a = await _alerta(db, alerta_id)
        if a.hasta is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "La alerta ya se cerró: la condición dejó de cumplirse")
        if a.descartada_at is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "La alerta ya está descartada")
        if a.ticket_id:
            raise HTTPException(status.HTTP_409_CONFLICT, "Ya se pidió una revisión de esta alerta: seguila en el ticket")
        a.descartada_por, a.descartada_at, a.descartada_motivo = user.id, tickets_srv.ahora(), motivo
        await db.commit()
    await record_action(db, user_id=user.id, action="alerta_descartada", resource_type="alerta_comando", resource_id=a.id,
                        ip=client_ip(request), extra={"tipo": a.tipo, "titulo": a.titulo, "motivo": motivo})
    return await _salida(db, a)


# ------------------------------------------------------------------ trazabilidad
@router.get("/supervisores/{supervisor_id}/linea")
async def linea_de_tiempo(supervisor_id: str, periodo: Optional[str] = Query(None), user: CurrentUser = Depends(sup.require_ver),
                          db: AsyncSession = Depends(get_db)) -> dict:
    """Todo lo que pasó con un supervisor en el mes: coachings y seguimientos, notas, tickets, cambios de equipo,
    objetivos y las alertas del centro de comandos (con quién las tomó)."""
    per = sup._periodo(periodo)
    sups = await sup._supervisores(db, {supervisor_id})
    if supervisor_id not in sups:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supervisor no encontrado")
    ops = {o.id: o for o in await maestro.todos(db)}
    eventos = await srv.linea_de_tiempo(db, supervisor_id, per, nombres=await _nombres(db), ops=ops)
    return {"periodo": per, "nombre_mes": sup.nombre_mes(per), "hoy": sup.hoy().isoformat(), "supervisor": sups[supervisor_id],
            "eventos": eventos, "grupos": dict(Counter(e["grupo"] for e in eventos))}


def _alertas_uso(filas: list[AlertaAsesor], coachings: list[Coaching], p: dict[str, Any], primero: date,
                 dia: date) -> list[dict[str, Any]]:
    """Las alertas de uso del asesor en el mes y en qué quedó cada una (como en la gestión del supervisor)."""
    usos = sorted((c for c in coachings if "uso" in coaching_srv.metricas_de(c) and c.estado != "anulado"), key=lambda c: c.fecha)
    out = []
    for a in filas:
        v = alertas_srv.vence(a, p)
        cubierta = next((c for c in usos if primero <= c.fecha <= v), None)
        estado = ("cubierta" if cubierta else "resuelta" if a.hasta and a.hasta <= v else "vencida" if v < dia else "en_plazo")
        out.append({"id": a.id, "desde": a.desde.isoformat(), "hasta": a.hasta.isoformat() if a.hasta else None,
                    "vence": v.isoformat(), "estado": estado, "datos": a.datos or {},
                    "coaching_id": cubierta.id if cubierta else None})
    out.sort(key=lambda x: x["desde"], reverse=True)
    return out


@router.get("/asesores/{operador_id}")
async def ficha_asesor(operador_id: str, periodo: Optional[str] = Query(None), user: CurrentUser = Depends(sup.require_ver),
                       db: AsyncSession = Depends(get_db)) -> dict:
    """La ficha de un asesor en el mes: su equipo, su puntaje y cada componente, sus ventas y su uso, los coachings
    que recibió, sus tickets, sus alertas de uso y las notas de bitácora sobre él."""
    per = sup._periodo(periodo)
    ctx = await sup.contexto(db, per)
    o = ctx.ops.get(operador_id)
    if not o:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Asesor no encontrado")
    prev = await sup.contexto(db, mes_anterior(per))
    dia, momento = sup.hoy(), tickets_srv.ahora()
    nombres = await _nombres(db)
    cs = list((await db.execute(select(Coaching).where(
        Coaching.operativa == OPERATIVA, Coaching.operador_id == operador_id,
        or_(and_(Coaching.fecha >= ctx.primero, Coaching.fecha <= ctx.ultimo), Coaching.estado == "abierto"),
    ).order_by(Coaching.fecha.desc(), Coaching.created_at.desc()))).scalars().all())
    tks = list((await db.execute(select(Ticket).where(
        Ticket.operativa == OPERATIVA, Ticket.operador_id == operador_id,
        or_(Ticket.created_at >= momento - timedelta(days=DIAS_CASO), Ticket.estado.in_(tickets_srv.ABIERTOS)),
    ))).scalars().all())
    notas = list((await db.execute(select(BitacoraNota).where(
        BitacoraNota.operativa == OPERATIVA, BitacoraNota.operador_id == operador_id,
        BitacoraNota.fecha >= ctx.primero, BitacoraNota.fecha <= ctx.ultimo,
    ).order_by(BitacoraNota.fecha.desc(), BitacoraNota.created_at.desc()))).scalars().all())
    alertas = [a for a in ctx.alertas if a.operador_id == operador_id]
    sc = ctx.sc["asesores"].get(operador_id)
    u = ctx.atrib["operadores"].get(operador_id) or {}
    sid = ctx.actual(operador_id)
    return {
        **ctx.comun(), "hoy": dia.isoformat(),
        "asesor": {**sup._op_corto(o), "legajo": o.legajo, "ultima_vez": o.ultima_vez.isoformat() if o.ultima_vez else None},
        "supervisor": {"id": sid, "nombre": nombres.get(sid, "—")} if sid else None,
        "tramos": [{"desde": t["desde"].isoformat(), "hasta": t["hasta"].isoformat(), "supervisor_id": t["supervisor_id"],
                    "supervisor": nombres.get(t["supervisor_id"], "—") if t["supervisor_id"] else None}
                   for t in sup._intervalos(ctx.tramos.get(operador_id, []), ctx.ultimo)],
        "scoring": {"total": sc["total"], "parcial": sc["parcial"], "componentes": sc["componentes"], "dias": sc["dias"],
                    "cobertura": sc["cobertura"], "anterior": sup._anterior(prev, "asesores", operador_id),
                    "parametros": ctx.info_scoring()} if sc else None,
        "netas": {"pospago": u.get("pospago", 0), "gpon": u.get("gpon", 0)} if ctx.reporte else None,
        "uso": ctx.uso(operador_id) if ctx.reporte else None,
        "coachings": [coaching_srv.a_dict(c, nombres=nombres, ops=ctx.ops, hoy=dia) for c in cs],
        "tickets": sorted((tickets_srv.a_dict(t, nombres=nombres, ops=ctx.ops, horario=ctx.horario, momento=momento) for t in tks),
                          key=lambda x: x["created_at"] or "", reverse=True),
        "alertas_uso": _alertas_uso(alertas, cs, ctx.p, ctx.primero, dia),
        "notas": [{**coaching_srv.nota_dict(x, ctx.ops), "supervisor": nombres.get(x.supervisor_id, "—")} for x in notas],
        "dia_completo": ctx.horario.dia_completo(),
        "puede_enviar": user.has_perm(PERM_TICKETS),
    }
