"""API de coaching y bitácora — Televentas Claro (modelo Líder Coach Comercial, fase 3).

* Portal del supervisor (`televentas_claro.portal_supervisor`): registra coachings a los asesores que
  tenía en su equipo ese día, su seguimiento, aclaraciones y notas de bitácora. Ve solo lo suyo.
* Jefes (`televentas_claro.supervision`): ven lo de cada supervisor, sin poder cambiarlo.

Las reglas del registro están en `coaching.py`; la gestión que suma al scoring, en `scoring.py`.
"""
from __future__ import annotations

from collections import Counter
from datetime import date
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip
from ....core.database import get_db
from ....services.audit_service import record_action
from . import alertas as alertas_srv
from . import api as sup
from . import coaching as srv
from . import operadores as maestro
from .calculo import mes_de, supervisor_en
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
            "coachings": len(mios), "por_metrica": dict(Counter(c.metrica for c in mios)),
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
    metrica: Metrica
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
                 metrica=payload.metrica, diagnostico=diagnostico, compromiso=compromiso,
                 seguimiento_fecha=payload.seguimiento_fecha, estado="abierto", anterior_id=payload.anterior_id,
                 base=await srv.foto(db, op, payload.fecha, ctx.sc["asesores"].get(op.id)), impacto={},
                 fuera_de_termino=fuera, created_at=srv.ahora(), created_by=user.id)
    db.add(c)
    await db.flush()
    srv.evento(db, c, "creado", user.id, tipo=c.tipo, metrica=c.metrica, fecha=c.fecha, seguimiento_fecha=c.seguimiento_fecha,
               diagnostico=diagnostico, compromiso=compromiso, fuera_de_termino=fuera)
    await db.commit()
    await record_action(db, user_id=user.id, action="coaching_registrado", resource_type="coaching", resource_id=c.id,
                        ip=client_ip(request), extra={"asesor": op.nombre, "fecha": c.fecha.isoformat(), "tipo": c.tipo,
                                                     "metrica": c.metrica, "fuera_de_termino": fuera})
    return await _detalle(db, c, portal=True)


class CoachingPatch(BaseModel):
    tipo: Optional[Tipo] = None
    metrica: Optional[Metrica] = None
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
        if payload.metrica is not None:
            nuevos["metrica"] = payload.metrica
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
