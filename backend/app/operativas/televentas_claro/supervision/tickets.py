"""Tickets de revisión: reglas, transiciones con el reloj del SLA, cierre automático y métricas.

Reglas (guía del modelo Líder Coach Comercial):
- Los envían quienes tienen la utilidad `tickets` (coordinador, sub gerente, controller, auditor y el
  superadmin) y llegan a un supervisor: si el caso nombra a un asesor, al que lo tenía el día del caso.
- El supervisor responde (el ticket pasa a «en gestión»: es la primera respuesta), pide datos (el reloj
  se detiene hasta que quien lo pidió contesta; sin respuesta en 2 días hábiles se cierra solo) o lo
  resuelve. Responder, pedir datos o resolver: lo primero que haga cuenta como primera respuesta.
- Un ticket resuelto se puede reabrir durante 5 días hábiles: el reloj sigue desde donde estaba y la
  reapertura queda contada (las reaperturas muestran respuestas que no resolvieron el caso). Mientras
  está abierto se puede reasignar a otro supervisor o cancelar.
- Nada se borra: cada paso queda en `sup_ticket_eventos` y en la auditoría.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from . import sla
from .alertas import dia_local
from .calculo import limites
from .coaching import ReglaInvalida, texto
from .models import OPERATIVA, Operador, Ticket, TicketEvento

TIPOS: dict[str, str] = {
    "venta_observada": "Venta observada", "linea_sin_uso": "Línea sin uso", "calidad": "Calidad de atención",
    "reclamo": "Reclamo", "conducta": "Conducta", "otro": "Otro",
}
PRIORIDADES = ("alta", "media", "baja")
ABIERTOS = ("nuevo", "en_gestion", "esperando")
CORRE = ("nuevo", "en_gestion")          # estados en que corre el reloj de resolución
MIN_TEXTO, MAX_TEXTO = 10, 4000
SISTEMA = "sistema"
_lock = asyncio.Lock()


def ahora() -> datetime:
    return datetime.now(timezone.utc)


def _aware(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=timezone.utc) if d is not None and d.tzinfo is None else d


# ------------------------------------------------------------------ reloj
def _transicion(t: Ticket, a: str, momento: datetime, horario: sla.Horario) -> None:
    """Cambia el estado y mueve el reloj: se detiene al salir de nuevo / en gestión y vuelve a correr al entrar."""
    if t.estado in CORRE and a not in CORRE and t.corriendo_desde is not None:
        t.consumido_min = (t.consumido_min or 0.0) + horario.habiles(_aware(t.corriendo_desde), momento)
        t.corriendo_desde = None
    elif t.estado not in CORRE and a in CORRE:
        t.corriendo_desde = momento
    t.estado, t.estado_desde, t.updated_at = a, momento, momento


def _primera_respuesta(t: Ticket, momento: datetime, horario: sla.Horario) -> bool:
    if t.respuesta_at is not None:
        return False
    t.respuesta_at = momento
    t.respuesta_min = round(horario.habiles(_aware(t.created_at), momento), 1)
    return True


def evento(db: AsyncSession, t: Ticket, tipo: str, por: str, /, texto: str | None = None, momento: datetime | None = None,
           **datos: Any) -> None:
    db.add(TicketEvento(ticket_id=t.id, tipo=tipo, at=momento or ahora(), por=por, texto=texto, datos=datos))


# ------------------------------------------------------------------ crear
def validar(tipo: str, prioridad: str, descripcion: str, referencia: str | None) -> tuple[str, str | None]:
    if tipo not in TIPOS:
        raise ReglaInvalida("Tipo de ticket desconocido")
    if prioridad not in PRIORIDADES:
        raise ReglaInvalida("Prioridad desconocida")
    ref = " ".join((referencia or "").split()) or None
    if ref and len(ref) > 120:
        raise ReglaInvalida("La referencia: hasta 120 caracteres")
    return texto(descripcion, "la descripción", maximo=MAX_TEXTO), ref


async def crear(db: AsyncSession, *, horario: sla.Horario, por: str, tipo: str, prioridad: str, supervisor_id: str,
                operador_id: str | None, fecha_caso: date | None, referencia: str | None, descripcion: str) -> Ticket:
    """Crea el ticket con su número (uno por operativa) y sus plazos según la prioridad."""
    momento = ahora()
    r, s = sla.plazos(prioridad, horario)
    async with _lock:
        for _ in range(3):  # el número es correlativo: si otro proceso tomó el mismo, se reintenta
            numero = ((await db.execute(select(func.max(Ticket.numero)).where(Ticket.operativa == OPERATIVA))).scalar() or 0) + 1
            t = Ticket(operativa=OPERATIVA, numero=numero, tipo=tipo, prioridad=prioridad, supervisor_id=supervisor_id,
                       operador_id=operador_id, fecha_caso=fecha_caso, referencia=referencia, descripcion=descripcion,
                       estado="nuevo", estado_desde=momento, sla_respuesta_min=r, sla_resolucion_min=s, consumido_min=0.0,
                       corriendo_desde=momento, creado_por=por, created_at=momento)
            db.add(t)
            try:
                await db.flush()
            except IntegrityError:
                await db.rollback()
                continue
            evento(db, t, "creado", por, descripcion, momento, prioridad=prioridad, tipo=tipo, supervisor_id=supervisor_id)
            await db.commit()
            return t
    raise ReglaInvalida("No se pudo numerar el ticket: probá de nuevo")


# ------------------------------------------------------------------ lo que hace el supervisor
def responder(db: AsyncSession, t: Ticket, por: str, txt: str, horario: sla.Horario) -> None:
    """Respuesta o comentario del supervisor. Desde «nuevo» es la primera respuesta y pasa a «en gestión»."""
    if t.estado not in ABIERTOS:
        raise ReglaInvalida("El ticket ya no está abierto")
    momento = ahora()
    primera = _primera_respuesta(t, momento, horario)
    if t.estado == "nuevo":
        _transicion(t, "en_gestion", momento, horario)
    t.updated_at = momento
    evento(db, t, "respuesta" if primera else "comentario", por, txt, momento)


def pedir_datos(db: AsyncSession, t: Ticket, por: str, txt: str, horario: sla.Horario) -> None:
    """El supervisor necesita datos de quien lo pidió: el reloj se detiene hasta que contesten."""
    if t.estado not in CORRE:
        raise ReglaInvalida("Solo se piden datos de un ticket nuevo o en gestión")
    momento = ahora()
    _primera_respuesta(t, momento, horario)
    _transicion(t, "esperando", momento, horario)
    evento(db, t, "pedido_datos", por, txt, momento)


def resolver(db: AsyncSession, t: Ticket, por: str, txt: str, horario: sla.Horario) -> None:
    if t.estado not in ABIERTOS:
        raise ReglaInvalida("El ticket ya no está abierto")
    momento = ahora()
    _primera_respuesta(t, momento, horario)
    _transicion(t, "resuelto", momento, horario)
    t.resuelto_at, t.resolucion_min = momento, round(t.consumido_min or 0.0, 1)
    evento(db, t, "resuelto", por, txt, momento)


# ------------------------------------------------------------------ lo que hacen quienes lo enviaron
def comentar(db: AsyncSession, t: Ticket, por: str, txt: str, horario: sla.Horario) -> None:
    """Comentario de los jefes. Si el ticket esperaba datos, es la respuesta: vuelve a «en gestión»."""
    if t.estado == "cerrado":
        raise ReglaInvalida("El ticket está cerrado")
    momento = ahora()
    if t.estado == "esperando":
        _transicion(t, "en_gestion", momento, horario)
        evento(db, t, "datos", por, txt, momento)
    else:
        t.updated_at = momento
        evento(db, t, "comentario", por, txt, momento)


def reabrir(db: AsyncSession, t: Ticket, por: str, txt: str, horario: sla.Horario) -> None:
    if t.estado != "resuelto":
        raise ReglaInvalida("Solo se reabre un ticket resuelto")
    momento = ahora()
    if horario.habiles(_aware(t.resuelto_at), momento) > sla.DIAS_REABRIR * horario.dia_completo():
        raise ReglaInvalida(f"Pasaron más de {sla.DIAS_REABRIR} días hábiles desde que se resolvió: enviá un ticket nuevo")
    _transicion(t, "en_gestion", momento, horario)
    t.reaperturas = (t.reaperturas or 0) + 1
    t.resuelto_at = t.resolucion_min = None
    evento(db, t, "reabierto", por, txt, momento, reapertura=t.reaperturas)


def cancelar(db: AsyncSession, t: Ticket, por: str, motivo: str, horario: sla.Horario) -> None:
    if t.estado not in ABIERTOS:
        raise ReglaInvalida("Solo se cancela un ticket abierto")
    momento = ahora()
    _transicion(t, "cerrado", momento, horario)
    t.cerrado_at, t.motivo_cierre = momento, "cancelado"
    evento(db, t, "cancelado", por, motivo, momento)


def reasignar(db: AsyncSession, t: Ticket, por: str, supervisor_id: str, motivo: str) -> None:
    if t.estado not in ABIERTOS:
        raise ReglaInvalida("Solo se reasigna un ticket abierto")
    if supervisor_id == t.supervisor_id:
        raise ReglaInvalida("El ticket ya es de ese supervisor")
    momento = ahora()
    evento(db, t, "reasignado", por, motivo, momento, de=t.supervisor_id, a=supervisor_id)
    t.supervisor_id, t.updated_at = supervisor_id, momento


async def cerrar_sin_respuesta(db: AsyncSession, horario: sla.Horario) -> int:
    """Cierra los tickets que esperan datos hace más de 2 días hábiles (al cumplirse el plazo)."""
    limite = sla.DIAS_ESPERA * horario.dia_completo()
    momento = ahora()
    async with _lock:
        rows = (await db.execute(select(Ticket).where(Ticket.operativa == OPERATIVA, Ticket.estado == "esperando"))).scalars().all()
        n = 0
        for t in rows:
            desde = _aware(t.estado_desde)
            if horario.habiles(desde, momento) < limite:
                continue
            cierre = min(horario.sumar(desde, limite), momento)
            _transicion(t, "cerrado", cierre, horario)
            t.cerrado_at, t.motivo_cierre = cierre, "sin_respuesta"
            evento(db, t, "cerrado_auto", SISTEMA, None, cierre)
            n += 1
        if n:
            await db.commit()
        return n


# ------------------------------------------------------------------ lecturas
async def del_mes(db: AsyncSession, periodo: str, supervisor_id: str | None = None) -> list[Ticket]:
    """Los tickets creados en el mes (hora de Asunción)."""
    primero, ultimo = limites(periodo)
    desde = datetime(primero.year, primero.month, primero.day, tzinfo=timezone.utc) - timedelta(days=1)
    hasta = datetime(ultimo.year, ultimo.month, ultimo.day, tzinfo=timezone.utc) + timedelta(days=2)
    q = select(Ticket).where(Ticket.operativa == OPERATIVA, Ticket.created_at >= desde, Ticket.created_at < hasta)
    if supervisor_id:
        q = q.where(Ticket.supervisor_id == supervisor_id)
    rows = (await db.execute(q)).scalars().all()
    return [t for t in rows if primero <= dia_local(_aware(t.created_at)) <= ultimo]


async def abiertos(db: AsyncSession, supervisor_id: str | None = None) -> list[Ticket]:
    q = select(Ticket).where(Ticket.operativa == OPERATIVA, Ticket.estado.in_(ABIERTOS))
    if supervisor_id:
        q = q.where(Ticket.supervisor_id == supervisor_id)
    return list((await db.execute(q)).scalars().all())


async def eventos(db: AsyncSession, ticket_id: str) -> list[TicketEvento]:
    q = select(TicketEvento).where(TicketEvento.ticket_id == ticket_id).order_by(TicketEvento.at, TicketEvento.orden)
    return list((await db.execute(q)).scalars().all())


async def operadores(db: AsyncSession, ids: set[str | None]) -> dict[str, Operador]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {o.id: o for o in (await db.execute(select(Operador).where(Operador.id.in_(ids)))).scalars().all()}


# ------------------------------------------------------------------ salida y métricas
_URGENCIA = {"vencido": 0, "por_vencer": 1, "en_plazo": 2, "pausado": 3, "fuera_de_plazo": 4, "cumplido": 5, "cerrado": 6}
_PRIORIDAD = {"alta": 0, "media": 1, "baja": 2}


def a_dict(t: Ticket, *, nombres: dict[str, str], ops: dict[str, Operador], horario: sla.Horario,
           momento: datetime) -> dict[str, Any]:
    o = ops.get(t.operador_id or "")
    s = sla.estado(t, horario, momento)
    return {
        "id": t.id, "numero": t.numero, "tipo": t.tipo, "tipo_nombre": TIPOS.get(t.tipo, t.tipo), "prioridad": t.prioridad,
        "estado": t.estado, "supervisor_id": t.supervisor_id, "supervisor": nombres.get(t.supervisor_id, "—"),
        "operador_id": t.operador_id, "operador": o.nombre if o else None,
        "fecha_caso": t.fecha_caso.isoformat() if t.fecha_caso else None, "referencia": t.referencia,
        "descripcion": t.descripcion, "creado_por": t.creado_por, "creado_por_nombre": nombres.get(t.creado_por, "—"),
        "created_at": _iso(t.created_at), "respuesta_at": _iso(t.respuesta_at), "resuelto_at": _iso(t.resuelto_at),
        "cerrado_at": _iso(t.cerrado_at), "motivo_cierre": t.motivo_cierre, "reaperturas": t.reaperturas or 0,
        "sla": s, "edad_min": round(horario.habiles(_aware(t.created_at), momento), 1) if t.estado in ABIERTOS else None,
    }


def orden(x: dict[str, Any]) -> tuple:
    """Primero lo urgente: vencido, por vencer; después por prioridad y antigüedad."""
    return (_URGENCIA.get(x["sla"]["situacion"], 9), _PRIORIDAD.get(x["prioridad"], 9), x["created_at"] or "")


def evento_dict(e: TicketEvento, nombres: dict[str, str]) -> dict[str, Any]:
    return {"id": e.id, "tipo": e.tipo, "at": _iso(e.at), "por": "Sistema" if e.por == SISTEMA else nombres.get(e.por, "—"),
            "texto": e.texto, "datos": e.datos or {}}


def metricas(tickets: list[Ticket], horario: sla.Horario, momento: datetime) -> dict[str, Any]:
    """Velocidad (mediana y percentil 90, en minutos hábiles), cumplimiento, bandeja y calidad."""
    estados = [sla.estado(t, horario, momento) for t in tickets]
    resp = [t.respuesta_min for t in tickets if t.respuesta_min is not None]
    res = [t.resolucion_min for t in tickets if t.estado == "resuelto" and t.resolucion_min is not None]
    decididos = [e["cumple"] for e in estados if e["cumple"] is not None]
    abiertos_ = [(t, e) for t, e in zip(tickets, estados) if t.estado in ABIERTOS]
    edades = [horario.habiles(_aware(t.created_at), momento) for t, _ in abiertos_]
    return {
        "total": len(tickets), "abiertos": len(abiertos_), "nuevos": sum(1 for t in tickets if t.estado == "nuevo"),
        "esperando": sum(1 for t in tickets if t.estado == "esperando"),
        "por_vencer": sum(1 for _, e in abiertos_ if e["situacion"] == "por_vencer"),
        "vencidos": sum(1 for _, e in abiertos_ if e["situacion"] == "vencido"),
        "resueltos": sum(1 for t in tickets if t.estado == "resuelto"),
        "cerrados": sum(1 for t in tickets if t.estado == "cerrado"),
        "en_plazo": sum(1 for c in decididos if c), "evaluados": len(decididos),
        "cumplimiento": round(sum(1 for c in decididos if c) / len(decididos) * 100, 1) if decididos else None,
        "respuesta": {"mediana": sla.percentil(resp, 50), "p90": sla.percentil(resp, 90), "n": len(resp)},
        "resolucion": {"mediana": sla.percentil(res, 50), "p90": sla.percentil(res, 90), "n": len(res)},
        "reaperturas": sum(t.reaperturas or 0 for t in tickets), "reabiertos": sum(1 for t in tickets if t.reaperturas),
        "mas_antiguo_min": round(max(edades), 1) if edades else None,
    }


def para_scoring(tickets: list[Ticket], horario: sla.Horario, momento: datetime) -> list[dict[str, Any]]:
    """Por ticket del mes: de qué supervisor es, si cumplió el plazo (None: todavía no se sabe o no cuenta) y si está abierto."""
    return [{"supervisor_id": t.supervisor_id, "cumple": sla.estado(t, horario, momento)["cumple"],
             "abierto": t.estado in ABIERTOS} for t in tickets]


def _iso(d: datetime | None) -> str | None:
    d = _aware(d)
    return d.isoformat() if d else None
