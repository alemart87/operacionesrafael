"""API de tickets de revisión — Televentas Claro (modelo Líder Coach Comercial, fase 4).

* `televentas_claro.supervision` → ver los tickets de todos los supervisores y sus métricas.
* `televentas_claro.tickets`     → enviar tickets y seguirlos: comentar (o mandar los datos pedidos), reabrir,
                                   reasignar y cancelar.
* `televentas_claro.portal_supervisor` → la bandeja del supervisor: solo los suyos (lo filtra el servidor);
                                   responde, pide datos y resuelve.

Las reglas y el reloj están en `tickets.py`; los plazos en horas hábiles, en `sla.py`.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip, require_perm
from ....core.database import get_db
from ....services.audit_service import record_action
from . import api as sup
from . import operadores as maestro
from . import sla
from . import tickets as srv
from .calculo import limites, supervisor_en
from .datos import horario as horario_de
from .datos import parametros
from .models import OPERATIVA, Operador, Ticket

PERM_TICKETS = f"{OPERATIVA}.tickets"
require_tickets = require_perm(PERM_TICKETS)

router = APIRouter(prefix="/televentas-claro/supervision", tags=["televentas-claro · tickets"])

Tipo = Literal["venta_observada", "linea_sin_uso", "calidad", "reclamo", "conducta", "otro"]
Prioridad = Literal["alta", "media", "baja"]
DIAS_CASO = 120  # un caso puede ser de hasta 4 meses atrás


async def _horario(db: AsyncSession) -> sla.Horario:
    """El horario de atención vigente; de paso cierra los tickets que esperaban datos hace más de 2 días hábiles."""
    h = horario_de(await parametros(db))
    await srv.cerrar_sin_respuesta(db, h)
    return h


def _regla(exc: srv.ReglaInvalida) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


def _info(h: sla.Horario, p: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "dia_completo": h.dia_completo(),
        "plazos": {pr: dict(zip(("respuesta", "resolucion"), sla.plazos(pr, h))) for pr in srv.PRIORIDADES},
        "plazos_texto": {pr: {"respuesta": r, "resolucion": s} for pr, (r, s) in sla.PLAZOS.items()},
        "por_vencer": int(sla.POR_VENCER * 100), "dias_espera": sla.DIAS_ESPERA, "dias_reabrir": sla.DIAS_REABRIR,
        "tipos": srv.TIPOS, "horario": p["horario"] if p else None,
    }


async def _items(db: AsyncSession, tickets: list[Ticket], h: sla.Horario, momento) -> tuple[list[dict[str, Any]], dict[str, str]]:
    nombres = await sup._nombres(db, {t.supervisor_id for t in tickets} | {t.creado_por for t in tickets})
    ops = await srv.operadores(db, {t.operador_id for t in tickets})
    items = sorted((srv.a_dict(t, nombres=nombres, ops=ops, horario=h, momento=momento) for t in tickets), key=srv.orden)
    return items, nombres


def _acciones(t: Ticket, h: sla.Horario, momento, *, portal: bool, puede: bool) -> list[str]:
    if portal:
        if t.estado in ("nuevo", "en_gestion"):
            return ["responder", "pedir_datos", "resolver"]
        return ["responder", "resolver"] if t.estado == "esperando" else []
    if not puede:
        return []
    out = []
    if t.estado != "cerrado":
        out.append("comentar")
    if t.estado in srv.ABIERTOS:
        out += ["reasignar", "cancelar"]
    if t.estado == "resuelto" and t.resuelto_at and \
            h.habiles(srv._aware(t.resuelto_at), momento) <= sla.DIAS_REABRIR * h.dia_completo():
        out.append("reabrir")
    return out


async def _detalle(db: AsyncSession, t: Ticket, user: CurrentUser, *, portal: bool) -> dict[str, Any]:
    h = horario_de(await parametros(db))
    momento = srv.ahora()
    evs = await srv.eventos(db, t.id)
    ids = {t.supervisor_id, t.creado_por} | {e.por for e in evs} | {e.datos.get(k) for e in evs for k in ("de", "a")}
    nombres = await sup._nombres(db, {i for i in ids if i})
    ops = await srv.operadores(db, {t.operador_id})
    return {**srv.a_dict(t, nombres=nombres, ops=ops, horario=h, momento=momento),
            "eventos": [srv.evento_dict(e, nombres) for e in evs],
            "acciones": _acciones(t, h, momento, portal=portal, puede=user.has_perm(PERM_TICKETS)),
            "info": _info(h)}


# ------------------------------------------------------------------ jefes: bandeja, métricas y envío
@router.get("/tickets")
async def listar(periodo: Optional[str] = Query(None), vista: Literal["abiertos", "mes"] = Query("abiertos"),
                 supervisor_id: Optional[str] = Query(None, max_length=36), mios: bool = Query(False),
                 user: CurrentUser = Depends(sup.require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """Bandeja de tickets (abiertos de cualquier mes, o los del mes) y las métricas del mes por supervisor."""
    per = sup._periodo(periodo)
    p = await parametros(db)
    h = horario_de(p)
    await srv.cerrar_sin_respuesta(db, h)
    momento = srv.ahora()
    del_mes = await srv.del_mes(db, per)
    abiertos = await srv.abiertos(db)
    lista = abiertos if vista == "abiertos" else del_mes
    if supervisor_id:
        lista = [t for t in lista if t.supervisor_id == supervisor_id]
    if mios:
        lista = [t for t in lista if t.creado_por == user.id]
    items, nombres = await _items(db, lista, h, momento)
    por_sup: dict[str, list[Ticket]] = defaultdict(list)
    for t in del_mes:
        por_sup[t.supervisor_id].append(t)
    abiertos_sup: dict[str, list[Ticket]] = defaultdict(list)
    for t in abiertos:
        abiertos_sup[t.supervisor_id].append(t)
    sups = await sup._supervisores(db, set(por_sup) | set(abiertos_sup))
    filas = []
    for sid, info in sups.items():
        if not info["activo"] and sid not in por_sup and sid not in abiertos_sup:
            continue
        bandeja = srv.metricas(abiertos_sup.get(sid, []), h, momento)
        filas.append({**info, "mes": srv.metricas(por_sup.get(sid, []), h, momento),
                      "bandeja": {k: bandeja[k] for k in ("abiertos", "nuevos", "esperando", "por_vencer", "vencidos", "mas_antiguo_min")}})
    filas.sort(key=lambda f: (-f["bandeja"]["vencidos"], -f["bandeja"]["por_vencer"], f["nombre"].lower()))
    return {
        "periodo": per, "nombre_mes": sup.nombre_mes(per), "hoy": sup.hoy().isoformat(), "vista": vista,
        "items": items, "mes": srv.metricas(del_mes, h, momento), "bandeja": srv.metricas(abiertos, h, momento),
        "supervisores": filas, "info": _info(h, p), "puede_enviar": user.has_perm(PERM_TICKETS),
    }


@router.get("/tickets/opciones")
async def opciones(user: CurrentUser = Depends(require_tickets), db: AsyncSession = Depends(get_db)) -> dict:
    """Para enviar un ticket: los asesores activos (con su supervisor de hoy) y los supervisores activos."""
    dia = sup.hoy()
    per = dia.strftime("%Y-%m")
    tramos = sup._tramos(await sup._asignaciones(db, per))
    sups = await sup._supervisores(db)
    desde = dia - timedelta(days=60)
    asesores = []
    for o in await maestro.todos(db):
        if not o.activo or not (o.ultima_vez and o.ultima_vez >= desde) and o.id not in tramos:
            continue
        sid = supervisor_en(tramos.get(o.id, []), dia)
        asesores.append({"id": o.id, "nombre": o.nombre, "agente": o.agente_nombre, "vendedor": o.vendedor,
                         "supervisor_id": sid, "supervisor": (sups.get(sid) or {}).get("nombre") if sid else None})
    asesores.sort(key=lambda a: a["nombre"].lower())
    return {"asesores": asesores, "supervisores": sorted((s for s in sups.values() if s["activo"]), key=lambda s: s["nombre"].lower()),
            "hoy": dia.isoformat()}


@router.get("/tickets/destino")
async def destino(operador_id: str = Query(..., max_length=36), fecha: date = Query(...),
                  user: CurrentUser = Depends(require_tickets), db: AsyncSession = Depends(get_db)) -> dict:
    """A quién llega un caso de ese asesor: al supervisor que lo tenía ese día."""
    sid = await maestro.supervisor_del_dia(db, operador_id, fecha)
    nombres = await sup._nombres(db, {sid})
    return {"supervisor_id": sid, "supervisor": nombres.get(sid) if sid else None}


class TicketPayload(BaseModel):
    tipo: Tipo
    prioridad: Prioridad
    operador_id: Optional[str] = Field(None, max_length=36)
    fecha_caso: Optional[date] = None
    supervisor_id: Optional[str] = Field(None, max_length=36)
    referencia: Optional[str] = Field(None, max_length=200)
    descripcion: str = Field(..., max_length=srv.MAX_TEXTO)


@router.post("/tickets", status_code=status.HTTP_201_CREATED)
async def enviar(payload: TicketPayload, request: Request, user: CurrentUser = Depends(require_tickets),
                 db: AsyncSession = Depends(get_db)) -> dict:
    """Envía un caso a revisión. Si nombra a un asesor, llega al supervisor que lo tenía el día del caso."""
    dia = sup.hoy()
    try:
        descripcion, referencia = srv.validar(payload.tipo, payload.prioridad, payload.descripcion, payload.referencia)
    except srv.ReglaInvalida as exc:
        raise _regla(exc) from exc
    fecha = payload.fecha_caso or (dia if payload.operador_id else None)
    if fecha and not dia - timedelta(days=DIAS_CASO) <= fecha <= dia:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"La fecha del caso tiene que ser de los últimos {DIAS_CASO} días")
    sups = await sup._supervisores(db)
    operador = None
    sid = None
    if payload.operador_id:
        operador = await db.get(Operador, payload.operador_id)
        if not operador or operador.operativa != OPERATIVA:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Asesor no encontrado")
        sid = await maestro.supervisor_del_dia(db, operador.id, fecha)
    if not sid:
        if not payload.supervisor_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ese asesor no tenía supervisor el {fecha:%d/%m}: elegí a quién enviarlo"
                                if operador else "Elegí el supervisor o el asesor del caso")
        sid = payload.supervisor_id
    if not (sups.get(sid) or {}).get("activo"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El ticket tiene que ir a un supervisor activo de la operativa")
    h = await _horario(db)
    try:
        t = await srv.crear(db, horario=h, por=user.id, tipo=payload.tipo, prioridad=payload.prioridad, supervisor_id=sid,
                            operador_id=operador.id if operador else None, fecha_caso=fecha, referencia=referencia,
                            descripcion=descripcion)
    except srv.ReglaInvalida as exc:
        raise _regla(exc) from exc
    await record_action(db, user_id=user.id, action="ticket_enviado", resource_type="ticket", resource_id=t.id,
                        ip=client_ip(request), extra={"numero": t.numero, "tipo": t.tipo, "prioridad": t.prioridad,
                                                     "supervisor": sups[sid]["nombre"], "asesor": operador.nombre if operador else None})
    return await _detalle(db, t, user, portal=False)


async def _ticket(db: AsyncSession, ticket_id: str) -> Ticket:
    t = await db.get(Ticket, ticket_id)
    if not t or t.operativa != OPERATIVA:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket no encontrado")
    return t


@router.get("/tickets/{ticket_id}")
async def ver(ticket_id: str, user: CurrentUser = Depends(sup.require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    await _horario(db)
    return await _detalle(db, await _ticket(db, ticket_id), user, portal=False)


class TextoPayload(BaseModel):
    texto: str = Field(..., max_length=srv.MAX_TEXTO)


class ReasignarPayload(TextoPayload):
    supervisor_id: str = Field(..., min_length=1, max_length=36)


async def _accion(db: AsyncSession, request: Request, user: CurrentUser, t: Ticket, accion: str, fn, texto: str,
                  minimo: int = srv.MIN_TEXTO) -> Ticket:
    """Valida el texto, aplica la acción con el reloj del SLA, guarda y audita."""
    h = await _horario(db)
    await db.refresh(t)  # por si el cierre automático lo acaba de cerrar
    try:
        txt = srv.texto(texto, "el motivo" if accion == "cancelado" else "el comentario", minimo=minimo, maximo=srv.MAX_TEXTO)
        fn(db, t, user.id, txt, h)
    except srv.ReglaInvalida as exc:
        await db.rollback()
        raise _regla(exc) from exc
    await db.commit()
    await record_action(db, user_id=user.id, action=f"ticket_{accion}", resource_type="ticket", resource_id=t.id,
                        ip=client_ip(request), extra={"numero": t.numero, "estado": t.estado})
    return t


@router.post("/tickets/{ticket_id}/comentario")
async def comentar(ticket_id: str, payload: TextoPayload, request: Request, user: CurrentUser = Depends(require_tickets),
                   db: AsyncSession = Depends(get_db)) -> dict:
    """Comentario de los jefes; si el ticket esperaba datos, es la respuesta y el reloj vuelve a correr."""
    t = await _accion(db, request, user, await _ticket(db, ticket_id), "comentario", srv.comentar, payload.texto, minimo=5)
    return await _detalle(db, t, user, portal=False)


@router.post("/tickets/{ticket_id}/reabrir")
async def reabrir(ticket_id: str, payload: TextoPayload, request: Request, user: CurrentUser = Depends(require_tickets),
                  db: AsyncSession = Depends(get_db)) -> dict:
    t = await _accion(db, request, user, await _ticket(db, ticket_id), "reabierto", srv.reabrir, payload.texto)
    return await _detalle(db, t, user, portal=False)


@router.post("/tickets/{ticket_id}/cancelar")
async def cancelar(ticket_id: str, payload: TextoPayload, request: Request, user: CurrentUser = Depends(require_tickets),
                   db: AsyncSession = Depends(get_db)) -> dict:
    t = await _accion(db, request, user, await _ticket(db, ticket_id), "cancelado", srv.cancelar, payload.texto, minimo=5)
    return await _detalle(db, t, user, portal=False)


@router.post("/tickets/{ticket_id}/reasignar")
async def reasignar(ticket_id: str, payload: ReasignarPayload, request: Request, user: CurrentUser = Depends(require_tickets),
                    db: AsyncSession = Depends(get_db)) -> dict:
    """Pasa el ticket a otro supervisor (activo). El reloj sigue: el plazo es del caso, no de quien lo atiende."""
    sups = await sup._supervisores(db)
    if not (sups.get(payload.supervisor_id) or {}).get("activo"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Elegí un supervisor activo de la operativa")
    t = await _ticket(db, ticket_id)
    await _horario(db)
    await db.refresh(t)
    try:
        motivo = srv.texto(payload.texto, "el motivo", minimo=5, maximo=srv.MAX_TEXTO)
        antes = t.supervisor_id
        srv.reasignar(db, t, user.id, payload.supervisor_id, motivo)
    except srv.ReglaInvalida as exc:
        raise _regla(exc) from exc
    await db.commit()
    await record_action(db, user_id=user.id, action="ticket_reasignado", resource_type="ticket", resource_id=t.id,
                        ip=client_ip(request), extra={"numero": t.numero, "de": (sups.get(antes) or {}).get("nombre"),
                                                     "a": sups[payload.supervisor_id]["nombre"]})
    return await _detalle(db, t, user, portal=False)


# ------------------------------------------------------------------ portal: la bandeja del supervisor
@router.get("/portal/tickets")
async def portal_tickets(periodo: Optional[str] = Query(None), user: CurrentUser = Depends(sup.require_portal),
                         db: AsyncSession = Depends(get_db)) -> dict:
    """Los tickets del supervisor: los abiertos (de cualquier mes) y los del mes, con sus plazos y su cumplimiento."""
    per = sup._periodo(periodo)
    p = await parametros(db)
    h = horario_de(p)
    await srv.cerrar_sin_respuesta(db, h)
    momento = srv.ahora()
    abiertos = await srv.abiertos(db, user.id)
    del_mes = await srv.del_mes(db, per, user.id)
    vistos = {t.id for t in abiertos}
    items, _ = await _items(db, [*abiertos, *(t for t in del_mes if t.id not in vistos)], h, momento)
    primero, ultimo = limites(per)
    return {"periodo": per, "nombre_mes": sup.nombre_mes(per), "hoy": sup.hoy().isoformat(), "items": items,
            "mes": srv.metricas(del_mes, h, momento), "bandeja": srv.metricas(abiertos, h, momento), "info": _info(h, p),
            "primero": primero.isoformat(), "ultimo": ultimo.isoformat()}


async def _propio(db: AsyncSession, ticket_id: str, user: CurrentUser) -> Ticket:
    t = await _ticket(db, ticket_id)
    if t.supervisor_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket no encontrado")
    return t


@router.get("/portal/tickets/{ticket_id}")
async def portal_ver(ticket_id: str, user: CurrentUser = Depends(sup.require_portal), db: AsyncSession = Depends(get_db)) -> dict:
    await _horario(db)
    return await _detalle(db, await _propio(db, ticket_id, user), user, portal=True)


@router.post("/portal/tickets/{ticket_id}/responder")
async def portal_responder(ticket_id: str, payload: TextoPayload, request: Request, user: CurrentUser = Depends(sup.require_portal),
                           db: AsyncSession = Depends(get_db)) -> dict:
    """Respuesta o comentario del supervisor: la primera saca al ticket de «nuevo»."""
    t = await _accion(db, request, user, await _propio(db, ticket_id, user), "respuesta", srv.responder, payload.texto)
    return await _detalle(db, t, user, portal=True)


@router.post("/portal/tickets/{ticket_id}/pedir-datos")
async def portal_pedir_datos(ticket_id: str, payload: TextoPayload, request: Request, user: CurrentUser = Depends(sup.require_portal),
                             db: AsyncSession = Depends(get_db)) -> dict:
    """Pide datos a quien lo envió: el reloj se detiene hasta que contesten (si no contestan en 2 días hábiles, se cierra)."""
    t = await _accion(db, request, user, await _propio(db, ticket_id, user), "pedido_datos", srv.pedir_datos, payload.texto)
    return await _detalle(db, t, user, portal=True)


@router.post("/portal/tickets/{ticket_id}/resolver")
async def portal_resolver(ticket_id: str, payload: TextoPayload, request: Request, user: CurrentUser = Depends(sup.require_portal),
                          db: AsyncSession = Depends(get_db)) -> dict:
    t = await _accion(db, request, user, await _propio(db, ticket_id, user), "resuelto", srv.resolver, payload.texto)
    return await _detalle(db, t, user, portal=True)
