"""Control de supervisores — lo que hacen los supervisores, contado y en vivo (`televentas_claro.control_supervisores`:
gerente, sub gerente, coordinador, controller y superadmin).

* `GET /control`: por supervisor, en un rango (hoy por defecto): coachings abiertos, firmados, sin firmar (y vencidos),
  monitoreos, feedback, compromisos, audios y minutos grabados, seguimientos, notas, tickets atendidos y altas de
  asesores; su última actividad y la cobertura del mes. Totales de la operación y actividad por día.
* `GET /control/actividad`: la actividad de todos (o de uno), lo más nuevo primero.
* `GET /control/audios/{id}/archivo`: escuchar un audio (queda en la auditoría).
* Altas de asesores por validar (validar o unir con quien aparece en los informes, con `operadores`) y pedidos de pase
  (aprobar con `supervision_gestion`).
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip, require_perm
from ....core.database import get_db
from ....models.user import User
from ....services.audit_service import record_action
from . import api as sup
from . import coaching as srv
from . import comando as comando_srv
from . import operadores as maestro
from .alertas import ZONA, dia_local
from .calculo import limites
from .devolucion_api import archivo_audio
from .models import (
    ALTA_PENDIENTE, OPERATIVA, BitacoraNota, Coaching, CoachingAudio, CoachingEvento, EquipoAsignacion, Operador, PedidoPase,
    Ticket, TicketEvento,
)

PERM_CONTROL = f"{OPERATIVA}.control_supervisores"
require_control = require_perm(PERM_CONTROL)

router = APIRouter(prefix="/televentas-claro/supervision", tags=["televentas-claro · control de supervisores"])

DIAS_MAX = 93
LIMITE_ACTIVIDAD = 400
TICKET_ACCIONES = ("respuesta", "comentario", "pedido_datos", "resuelto")
NOMBRE_TICKET = {"respuesta": "Respondió", "comentario": "Comentó", "pedido_datos": "Pidió datos en", "resuelto": "Resolvió"}


def _rango(desde: date | None, hasta: date | None) -> tuple[date, date, datetime, datetime]:
    dia = sup.hoy()
    hasta = hasta or dia
    desde = desde or hasta
    if desde > hasta:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La fecha inicial es posterior a la final")
    if (hasta - desde).days > DIAS_MAX:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"El rango puede tener hasta {DIAS_MAX} días")
    ini = datetime.combine(desde, time.min, tzinfo=ZONA).astimezone(timezone.utc)
    fin = datetime.combine(hasta + timedelta(days=1), time.min, tzinfo=ZONA).astimezone(timezone.utc)
    return desde, hasta, ini, fin


def _aware(d: datetime | None) -> datetime | None:
    if d is None:
        return None
    return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d


async def ultima_actividad(db: AsyncSession) -> dict[str, datetime]:
    """Lo último que hizo cada supervisor (de siempre): lo que mide el centro de comandos más el detalle de cada
    coaching (monitoreos, compromisos, audios, firmas) y las altas de asesores."""
    out = dict(await comando_srv.ultima_gestion(db))

    def sumar(sid: str | None, m: datetime | None) -> None:
        m = _aware(m)
        if sid and m and (sid not in out or m > out[sid]):
            out[sid] = m

    for sid, m in (await db.execute(select(Coaching.supervisor_id, func.max(CoachingEvento.at))
                                    .join(Coaching, Coaching.id == CoachingEvento.coaching_id)
                                    .where(Coaching.operativa == OPERATIVA, CoachingEvento.por == Coaching.supervisor_id)
                                    .group_by(Coaching.supervisor_id))).all():
        sumar(sid, m)
    for sid, m in (await db.execute(select(Operador.alta_por, func.max(Operador.alta_at)).where(Operador.alta_por.is_not(None))
                                    .group_by(Operador.alta_por))).all():
        sumar(sid, m)
    return out


def _vacia() -> dict[str, Any]:
    return {"coachings": 0, "firmados": 0, "monitoreos": 0, "feedback": 0, "compromisos": 0, "audios": 0, "segundos": 0.0,
            "voz_asesor": 0, "seguimientos": 0, "anulados": 0, "aclaraciones": 0, "notas": 0, "tickets": 0, "altas": 0,
            "pases": 0, "costo_usd": 0.0}


async def _conteos(db: AsyncSession, ini: datetime, fin: datetime) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, int]]]:
    """Lo que hizo cada supervisor en el rango y la actividad de la operación por día."""
    por: dict[str, dict[str, Any]] = defaultdict(_vacia)
    dias: dict[str, Counter] = defaultdict(Counter)
    q = (select(CoachingEvento.tipo, CoachingEvento.at, CoachingEvento.datos, Coaching.supervisor_id)
         .join(Coaching, Coaching.id == CoachingEvento.coaching_id)
         .where(Coaching.operativa == OPERATIVA, CoachingEvento.at >= ini, CoachingEvento.at < fin))
    for tipo, at, datos, sid in (await db.execute(q)).all():
        f, d = por[sid], dia_local(at).isoformat()
        if tipo == "creado":
            f["coachings"] += 1
            # Los registrados como antes (con diagnóstico y compromiso) traen su feedback y su compromiso.
            if (datos or {}).get("diagnostico"):
                f["feedback"] += 1
                dias[d]["items"] += 1
            if (datos or {}).get("compromiso"):
                f["compromisos"] += 1
            dias[d]["coachings"] += 1
        elif tipo == "item":
            f["monitoreos" if (datos or {}).get("tipo") == "monitoreo" else "feedback"] += 1
            dias[d]["items"] += 1
        elif tipo == "item_quitado":   # lo cargado por error y quitado no cuenta
            k = "monitoreos" if (datos or {}).get("tipo") == "monitoreo" else "feedback"
            f[k] = max(f[k] - 1, 0)
            dias[d]["items"] = max(dias[d]["items"] - 1, 0)
        elif tipo == "compromiso":
            f["compromisos"] += 1
        elif tipo == "compromiso_quitado":
            f["compromisos"] = max(f["compromisos"] - 1, 0)
        elif tipo == "firmado":
            f["firmados"] += 1
            dias[d]["firmados"] += 1
        elif tipo == "seguimiento":
            f["seguimientos"] += 1
            dias[d]["seguimientos"] += 1
        elif tipo == "anulado":
            f["anulados"] += 1
        elif tipo == "aclaracion":
            f["aclaraciones"] += 1
    for sid, hablante, seg, costo, at in (await db.execute(select(
            CoachingAudio.supervisor_id, CoachingAudio.hablante, CoachingAudio.duracion_s, CoachingAudio.costo_usd, CoachingAudio.created_at)
            .where(CoachingAudio.created_at >= ini, CoachingAudio.created_at < fin))).all():
        f = por[sid]
        f["audios"] += 1
        f["segundos"] += seg or 0
        f["costo_usd"] += costo or 0
        f["voz_asesor"] += hablante == "asesor"
        dias[dia_local(at).isoformat()]["audios"] += 1
    for sid, at in (await db.execute(select(BitacoraNota.supervisor_id, BitacoraNota.created_at).where(
            BitacoraNota.operativa == OPERATIVA, BitacoraNota.created_at >= ini, BitacoraNota.created_at < fin))).all():
        por[sid]["notas"] += 1
        dias[dia_local(at).isoformat()]["notas"] += 1
    for por_id, at in (await db.execute(select(TicketEvento.por, TicketEvento.at).where(
            TicketEvento.tipo.in_(TICKET_ACCIONES), TicketEvento.at >= ini, TicketEvento.at < fin))).all():
        por[por_id]["tickets"] += 1
        dias[dia_local(at).isoformat()]["tickets"] += 1
    for sid, at in (await db.execute(select(Operador.alta_por, Operador.alta_at).where(
            Operador.alta_por.is_not(None), Operador.alta_at >= ini, Operador.alta_at < fin))).all():
        por[sid]["altas"] += 1
    for sid, in (await db.execute(select(PedidoPase.pedido_por).where(PedidoPase.created_at >= ini, PedidoPase.created_at < fin))).all():
        por[sid]["pases"] += 1
    return por, {d: dict(c) for d, c in dias.items()}


@router.get("/control")
async def control(desde: Optional[date] = Query(None), hasta: Optional[date] = Query(None),
                  user: CurrentUser = Depends(require_control), db: AsyncSession = Depends(get_db)) -> dict:
    """Qué hizo cada supervisor en el rango (hoy, si no se indica) y cómo está su gestión ahora."""
    d0, d1, ini, fin = _rango(desde, hasta)
    dia = sup.hoy()
    per = dia.strftime("%Y-%m")
    ctx = await sup.Contexto(per).cargar(db)
    primero, ultimo = limites(per)
    por, por_dia = await _conteos(db, ini, fin)
    ultima = await ultima_actividad(db)
    sin_firma = await srv.sin_firmar(db)
    abiertos = list((await db.execute(select(Coaching).where(Coaching.operativa == OPERATIVA, Coaching.estado == "abierto"))).scalars().all())
    # Coachings terminados del mes (firmados en el mes o anteriores a la firma con fecha en el mes): la cobertura.
    ini_mes = datetime.combine(primero, time.min, tzinfo=ZONA).astimezone(timezone.utc)
    fin_mes = datetime.combine(ultimo + timedelta(days=1), time.min, tzinfo=ZONA).astimezone(timezone.utc)
    terminados = (await db.execute(select(Coaching.supervisor_id, Coaching.operador_id).where(
        Coaching.operativa == OPERATIVA, Coaching.estado.notin_(("anulado", srv.PENDIENTE)),
        or_(and_(Coaching.firmado_at >= ini_mes, Coaching.firmado_at < fin_mes),
            and_(Coaching.firmado_at.is_(None), Coaching.fecha >= primero, Coaching.fecha <= ultimo))))).all()
    con_coaching: dict[str, set[str]] = defaultdict(set)
    for sid, op in terminados:
        con_coaching[sid].add(op)
    nombres = await sup._nombres(db, set(por) | set(ctx.supervisores))
    ids = {s for s in (ctx.actual(op) for op in ctx.tramos) if s} | {i for i, s in ctx.supervisores.items() if s["activo"]} \
        | {s for s in por if s in ctx.supervisores}
    filas = []
    for sid in ids:
        info = ctx.supervisores.get(sid) or {"id": sid, "nombre": nombres.get(sid, sid), "activo": False}
        equipo = set(ctx.equipo(sid))
        f = por.get(sid) or _vacia()
        sf = [c for c in sin_firma if c.supervisor_id == sid]
        u = ultima.get(sid)
        u_dia = dia_local(u)
        dias_sin = comando_srv.dias_habiles_entre(u_dia, dia, ctx.p) if u_dia and u_dia < dia else (0.0 if u_dia else None)
        hizo = sum(f[k] for k in ("coachings", "firmados", "monitoreos", "feedback", "compromisos", "audios", "seguimientos",
                                  "notas", "tickets", "altas"))
        estado = "activo" if hizo else ("sin_actividad" if dias_sin is None or dias_sin >= comando_srv.DIAS_SIN_GESTION else "quieto")
        filas.append({
            **info, "asesores": len(equipo), **{k: (round(v, 4) if isinstance(v, float) else v) for k, v in f.items()},
            "minutos": round(f["segundos"] / 60, 1),
            "sin_firmar": len(sf), "sin_firmar_vencidos": sum(1 for c in sf if srv.devolucion_vencida(c, dia, ctx.p)),
            "seguimientos_vencidos": sum(1 for c in abiertos if c.supervisor_id == sid and srv.estado_seguimiento(c, dia) == "vencido"),
            "cobertura": {"con_coaching": len(equipo & con_coaching.get(sid, set())), "asesores": len(equipo),
                          "pct": round(len(equipo & con_coaching.get(sid, set())) / len(equipo) * 100) if equipo else None},
            "ultima_actividad": u.isoformat() if u else None, "dias_sin_actividad": dias_sin, "estado": estado,
        })
    orden = {"sin_actividad": 0, "quieto": 1, "activo": 2}
    filas.sort(key=lambda x: (orden[x["estado"]], -(x["sin_firmar_vencidos"] + x["seguimientos_vencidos"]), x["nombre"].lower()))
    total = _vacia()
    for f in filas:
        for k in total:
            total[k] += f[k]
    altas = (await db.execute(select(func.count()).select_from(Operador).where(Operador.cruce.in_(ALTA_PENDIENTE)))).scalar() or 0
    pases = (await db.execute(select(func.count()).select_from(PedidoPase).where(PedidoPase.estado == "pendiente"))).scalar() or 0
    serie = []
    d = d0
    while d <= d1:
        serie.append({"dia": d.isoformat(), **{k: por_dia.get(d.isoformat(), {}).get(k, 0)
                                               for k in ("coachings", "items", "firmados", "audios", "seguimientos", "notas", "tickets")}})
        d += timedelta(days=1)
    return {
        "desde": d0.isoformat(), "hasta": d1.isoformat(), "hoy": dia.isoformat(), "actualizado": srv.ahora().isoformat(),
        "nombre_mes": ctx.comun()["nombre_mes"],
        "kpis": {**{k: (round(v, 4) if isinstance(v, float) else v) for k, v in total.items()},
                 "minutos": round(total["segundos"] / 60, 1),
                 "supervisores": len(filas), "activos": sum(1 for f in filas if f["estado"] == "activo"),
                 "sin_actividad": sum(1 for f in filas if f["estado"] == "sin_actividad"),
                 "sin_firmar": len(sin_firma), "sin_firmar_vencidos": sum(f["sin_firmar_vencidos"] for f in filas),
                 "seguimientos_vencidos": sum(f["seguimientos_vencidos"] for f in filas),
                 "altas_por_validar": altas, "pases_pendientes": pases},
        "supervisores": filas, "por_dia": serie,
        "reglas": {"dias_devolucion": srv.DIAS_DEVOLUCION, "dias_sin_gestion": comando_srv.DIAS_SIN_GESTION},
    }


def _corto(t: str | None, n: int = 160) -> str | None:
    if not t:
        return None
    t = " ".join(t.split())
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


@router.get("/control/actividad")
async def actividad(desde: Optional[date] = Query(None), hasta: Optional[date] = Query(None),
                    supervisor_id: Optional[str] = Query(None, max_length=36), limite: int = Query(200, ge=1, le=LIMITE_ACTIVIDAD),
                    user: CurrentUser = Depends(require_control), db: AsyncSession = Depends(get_db)) -> dict:
    """La actividad de los supervisores en el rango, lo más nuevo primero."""
    d0, d1, ini, fin = _rango(desde, hasta)
    evs: list[dict[str, Any]] = []
    q = (select(CoachingEvento, Coaching.supervisor_id, Coaching.operador_id)
         .join(Coaching, Coaching.id == CoachingEvento.coaching_id)
         .where(Coaching.operativa == OPERATIVA, CoachingEvento.at >= ini, CoachingEvento.at < fin,
                CoachingEvento.tipo.notin_(("transcripcion", "revision"))))
    if supervisor_id:
        q = q.where(Coaching.supervisor_id == supervisor_id)
    filas = (await db.execute(q.order_by(CoachingEvento.at.desc()).limit(limite))).all()
    ops_ids = {o for _, _, o in filas}
    audios = {}
    ids_audio = {(e.datos or {}).get("audio_id") for e, _, _ in filas} - {None}
    if ids_audio:
        audios = {a.id: a for a in (await db.execute(select(CoachingAudio).where(CoachingAudio.id.in_(ids_audio)))).scalars().all()}
    for e, sid, op in filas:
        x = e.datos or {}
        titulo, detalle, extra = {
            "creado": ("Abrió un coaching", _corto(x.get("diagnostico")), {}),
            "editado": ("Corrigió un coaching", None, {}),
            "item": ("Monitoreo de llamada" if x.get("tipo") == "monitoreo" else "Feedback", _corto(x.get("texto")), {}),
            "item_editado": ("Corrigió un monitoreo o feedback", None, {}),
            "item_quitado": ("Quitó un monitoreo o feedback", _corto(x.get("texto")), {}),
            "compromiso": ("Compromiso del asesor", _corto(x.get("texto")), {}),
            "compromiso_editado": ("Corrigió un compromiso", None, {}),
            "compromiso_quitado": ("Quitó un compromiso", _corto(x.get("texto")), {}),
            "audio": ("Grabó un audio" + (" del asesor" if x.get("hablante") == "asesor" else ""),
                      f"{round(x.get('segundos') or 0)} s", {}),
            "firmado": ("El asesor firmó la devolución", f"{x.get('compromisos', 0)} compromiso(s) · huella {str(x.get('huella', ''))[:12]}", {}),
            "seguimiento": ("Registró el seguimiento", _corto(x.get("comentario")), {"resultado": x.get("resultado")}),
            "anulado": ("Anuló un coaching", _corto(x.get("motivo")), {}),
            "aclaracion": ("Agregó una aclaración", _corto(x.get("texto")), {}),
        }.get(e.tipo, (e.tipo, None, {}))
        a = audios.get(x.get("audio_id"))
        evs.append({"at": srv.iso(e.at), "tipo": e.tipo, "grupo": "coaching", "supervisor_id": sid, "operador_id": op,
                    "coaching_id": e.coaching_id, "titulo": titulo, "detalle": detalle,
                    "audio": ({"id": a.id, "segundos": a.duracion_s, "hablante": a.hablante, "estado": a.estado,
                               "texto": _corto(a.texto, 220), "archivo": a.ruta is not None and a.borrado_at is None} if a else None),
                    **extra})
    qn = select(BitacoraNota).where(BitacoraNota.operativa == OPERATIVA, BitacoraNota.created_at >= ini, BitacoraNota.created_at < fin)
    if supervisor_id:
        qn = qn.where(BitacoraNota.supervisor_id == supervisor_id)
    for n in (await db.execute(qn.order_by(BitacoraNota.created_at.desc()).limit(limite))).scalars().all():
        ops_ids.add(n.operador_id)
        evs.append({"at": srv.iso(n.created_at), "tipo": "nota", "grupo": "bitacora", "supervisor_id": n.supervisor_id,
                    "operador_id": n.operador_id, "titulo": f"Nota de bitácora · {n.tipo}", "detalle": _corto(n.texto)})
    qt = (select(TicketEvento, Ticket.numero, Ticket.supervisor_id, Ticket.operador_id).join(Ticket, Ticket.id == TicketEvento.ticket_id)
          .where(TicketEvento.tipo.in_(TICKET_ACCIONES), TicketEvento.at >= ini, TicketEvento.at < fin,
                 TicketEvento.por == Ticket.supervisor_id))
    if supervisor_id:
        qt = qt.where(Ticket.supervisor_id == supervisor_id)
    for e, numero, sid, op in (await db.execute(qt.order_by(TicketEvento.at.desc()).limit(limite))).all():
        ops_ids.add(op)
        evs.append({"at": srv.iso(e.at), "tipo": f"ticket_{e.tipo}", "grupo": "tickets", "supervisor_id": sid, "operador_id": op,
                    "ticket_id": e.ticket_id, "titulo": f"{NOMBRE_TICKET.get(e.tipo, e.tipo)} el ticket #{numero:04d}", "detalle": _corto(e.texto)})
    qa = select(Operador).where(Operador.alta_por.is_not(None), Operador.alta_at >= ini, Operador.alta_at < fin)
    if supervisor_id:
        qa = qa.where(Operador.alta_por == supervisor_id)
    for o in (await db.execute(qa)).scalars().all():
        evs.append({"at": srv.iso(o.alta_at), "tipo": "alta", "grupo": "equipo", "supervisor_id": o.alta_por, "operador_id": o.id,
                    "titulo": "Cargó un asesor nuevo", "detalle": o.nombre})
    qp = select(PedidoPase).where(PedidoPase.created_at >= ini, PedidoPase.created_at < fin)
    if supervisor_id:
        qp = qp.where(PedidoPase.pedido_por == supervisor_id)
    for x in (await db.execute(qp)).scalars().all():
        ops_ids.add(x.operador_id)
        evs.append({"at": srv.iso(x.created_at), "tipo": "pase", "grupo": "equipo", "supervisor_id": x.pedido_por,
                    "operador_id": x.operador_id, "titulo": "Pidió el pase de un asesor a su equipo", "detalle": _corto(x.nota)})
    evs.sort(key=lambda x: x["at"] or "", reverse=True)
    evs = evs[:limite]
    ops = {o.id: o.nombre for o in (await db.execute(select(Operador).where(Operador.id.in_({i for i in ops_ids if i})))).scalars().all()} \
        if ops_ids - {None} else {}
    nombres = await sup._nombres(db, {e["supervisor_id"] for e in evs})
    for e in evs:
        e["supervisor"] = nombres.get(e["supervisor_id"], e["supervisor_id"])
        e["asesor"] = ops.get(e.get("operador_id") or "")
    return {"desde": d0.isoformat(), "hasta": d1.isoformat(), "items": evs, "truncado": len(evs) >= limite}


@router.get("/control/audios/{audio_id}/archivo")
async def escuchar(audio_id: str, request: Request, user: CurrentUser = Depends(require_control),
                   db: AsyncSession = Depends(get_db)) -> FileResponse:
    """Escuchar un audio de un coaching (queda en la auditoría)."""
    a = await db.get(CoachingAudio, audio_id)
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Audio no encontrado")
    r = archivo_audio(a)
    await record_action(db, user_id=user.id, action="audio_escuchado", resource_type="coaching", resource_id=a.coaching_id,
                        ip=client_ip(request), extra={"audio": a.id, "hablante": a.hablante})
    return r


# ------------------------------------------------------------------ altas por validar y pedidos de pase
@router.get("/control/pendientes")
async def pendientes(user: CurrentUser = Depends(require_control), db: AsyncSession = Depends(get_db)) -> dict:
    """Las altas de asesores que cargaron los supervisores (por validar) y los pedidos de pase."""
    from .devolucion_api import _parecido
    from ..sph.analyzer import tokens

    dia = sup.hoy()
    ops = await maestro.todos(db)
    altas = [o for o in ops if o.cruce in ALTA_PENDIENTE]
    ids = {o.alta_por for o in altas}
    pases = list((await db.execute(select(PedidoPase).where(PedidoPase.estado == "pendiente").order_by(PedidoPase.created_at))).scalars().all())
    ids |= {x.pedido_por for x in pases} | {x.supervisor_actual for x in pases}
    nombres = await sup._nombres(db, ids)
    por_id = {o.id: o for o in ops}
    out_altas = []
    for o in sorted(altas, key=lambda o: o.alta_at or datetime.min.replace(tzinfo=timezone.utc)):
        q = tokens(o.nombre)
        sugeridos = sorted(((_parecido(q, sorted(set(tokens(x.nombre)) | set(tokens(x.agente_nombre)) | set(tokens(x.vendedor)))), x)
                            for x in ops if x.id != o.id and (x.agente_clave or x.vendedor)), key=lambda t: (-t[0], t[1].nombre))
        out_altas.append({"id": o.id, "nombre": o.nombre, "documento": o.documento, "subcanal": o.subcanal,
                          "alta_por": nombres.get(o.alta_por or "", o.alta_por), "alta_por_id": o.alta_por, "alta_at": srv.iso(o.alta_at),
                          "supervisor_hoy": nombres.get(await maestro.supervisor_del_dia(db, o.id, dia) or "", None),
                          "sugeridos": [{"id": x.id, "nombre": x.nombre, "agente": x.agente_nombre, "vendedor": x.vendedor}
                                        for n, x in sugeridos[:4] if n >= min(2, len(q))]})
    out_pases = [{"id": x.id, "operador_id": x.operador_id, "operador": por_id[x.operador_id].nombre if x.operador_id in por_id else "—",
                  "pedido_por": nombres.get(x.pedido_por, x.pedido_por), "pedido_por_id": x.pedido_por,
                  "supervisor_actual": nombres.get(x.supervisor_actual or "", None) if x.supervisor_actual else None,
                  "nota": x.nota, "created_at": srv.iso(x.created_at)} for x in pases]
    return {"altas": out_altas, "pases": out_pases,
            "puede_validar": user.has_perm(sup.PERM_OPERADORES), "puede_asignar": user.has_perm(sup.PERM_GESTION)}


def _exigir(user: CurrentUser, perm: str, que: str) -> None:
    if not user.has_perm(perm):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"No tenés permiso para {que}")


async def _alta(db: AsyncSession, operador_id: str) -> Operador:
    o = await db.get(Operador, operador_id)
    if not o or o.operativa != OPERATIVA or o.cruce not in ALTA_PENDIENTE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alta por validar no encontrada")
    return o


@router.post("/control/altas/{operador_id}/validar")
async def validar_alta(operador_id: str, request: Request, user: CurrentUser = Depends(require_control),
                       db: AsyncSession = Depends(get_db)) -> dict:
    """Es una persona nueva: queda validada y se une cuando aparezca en los informes de llamadas o de ventas."""
    _exigir(user, sup.PERM_OPERADORES, "validar asesores")
    o = await _alta(db, operador_id)
    o.cruce, o.updated_at, o.updated_by = "alta_validada", srv.ahora(), user.id
    await db.commit()
    await record_action(db, user_id=user.id, action="asesor_alta_validada", resource_type="operador", resource_id=o.id,
                        ip=client_ip(request), extra={"nombre": o.nombre})
    return {"operador": sup._op_corto(o)}


class UnirPayload(BaseModel):
    con: str = Field(..., min_length=1, max_length=36)


@router.post("/control/altas/{operador_id}/unir")
async def unir_alta(operador_id: str, payload: UnirPayload, request: Request, user: CurrentUser = Depends(require_control),
                    db: AsyncSession = Depends(get_db)) -> dict:
    """El alta es alguien que ya estaba en el maestro: se une (sus coachings, equipos y notas pasan a esa persona)."""
    _exigir(user, sup.PERM_OPERADORES, "unir asesores")
    o = await _alta(db, operador_id)
    queda = await db.get(Operador, payload.con)
    if not queda or queda.operativa != OPERATIVA or queda.id == o.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Elegí otra persona")
    try:
        descartados = await maestro.fusionar(db, queda, o)
    except maestro.VinculoInvalido as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    queda.updated_at, queda.updated_by = srv.ahora(), user.id
    await db.commit()
    await record_action(db, user_id=user.id, action="asesor_alta_unida", resource_type="operador", resource_id=queda.id,
                        ip=client_ip(request), extra={"alta": operador_id, "equipos_descartados": descartados})
    return {"operador": sup._op_corto(queda), "equipos_descartados": descartados}


class ResolverPasePayload(BaseModel):
    aprobar: bool
    nota: Optional[str] = Field(None, max_length=500)


@router.post("/control/pases/{pase_id}/resolver")
async def resolver_pase(pase_id: str, payload: ResolverPasePayload, request: Request, user: CurrentUser = Depends(require_control),
                        db: AsyncSession = Depends(get_db)) -> dict:
    """Aprueba (el asesor pasa al equipo de quien lo pidió desde hoy) o rechaza un pedido de pase."""
    x = await db.get(PedidoPase, pase_id)
    if not x or x.estado != "pendiente":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido de pase no encontrado")
    if payload.aprobar:
        _exigir(user, sup.PERM_GESTION, "armar los equipos")
        dia = sup.hoy()
        periodo = dia.strftime("%Y-%m")
        a = (await db.execute(select(EquipoAsignacion).where(
            EquipoAsignacion.operativa == OPERATIVA, EquipoAsignacion.periodo == periodo, EquipoAsignacion.operador_id == x.operador_id,
            EquipoAsignacion.desde == dia))).scalars().first()
        if a:
            a.supervisor_id = x.pedido_por
        else:
            db.add(EquipoAsignacion(operativa=OPERATIVA, periodo=periodo, operador_id=x.operador_id, supervisor_id=x.pedido_por,
                                    desde=dia, created_at=srv.ahora(), created_by=user.id))
    x.estado = "resuelto" if payload.aprobar else "rechazado"
    x.resuelto_por, x.resuelto_at = user.id, srv.ahora()
    if payload.nota:
        x.nota = ((x.nota + "\n") if x.nota else "") + f"Respuesta: {payload.nota.strip()}"
    await db.commit()
    await record_action(db, user_id=user.id, action="asesor_pase_resuelto", resource_type="operador", resource_id=x.operador_id,
                        ip=client_ip(request), extra={"aprobado": payload.aprobar, "para": x.pedido_por})
    return {"id": x.id, "estado": x.estado}
