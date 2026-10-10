"""Centro de comandos: qué supervisor necesita atención hoy y qué hizo cada uno (guía, «Centro de comandos»).

- Cabecera de la operación: score, avance y proyección, % sin uso contra el umbral, supervisores en crítico,
  líneas a recuperar, tickets abiertos y vencidos y cobertura de coaching.
- Semáforo de supervisores: «atención» (algo vencido o fuera de objetivo, o sin registrar gestión hace
  3 días hábiles o más), «revisar» (en crítico o en riesgo, con plazos todavía en curso) o «al día», con
  los motivos a la vista.
- Alertas del día (`AlertaComando`): se abren cuando aparece la condición y se cierran solas cuando deja de
  cumplirse; guardan quién las tomó, qué hizo y el ticket que se pidió desde ahí.
- Línea de tiempo de cada supervisor: coachings, seguimientos, tickets, notas, cambios de equipo y objetivos.
"""
from __future__ import annotations

import asyncio
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from . import sla
from .alertas import ZONA, dia_local
from .calculo import limites, peso_dia, proyeccion
from .coaching import NOMBRE_RESULTADO, ORDEN_EVENTO, estado_seguimiento, metricas_de
from .impacto import METRICAS
from .models import (
    OPERATIVA, AlertaComando, BitacoraNota, Coaching, CoachingEvento, EquipoAsignacion, ObjetivoSupervisor, Ticket,
    TicketEvento,
)

DIAS_SIN_GESTION = 3  # días hábiles sin registrar gestión: el supervisor pasa a «atención»
LOTE_EQUIPO = 3       # más asignaciones que esto hechas juntas = un solo evento en la línea de tiempo
_lock = asyncio.Lock()

# tipo → (severidad, nombre, tipo de ticket al pedir revisión o None si no corresponde)
TIPOS: dict[str, tuple[int, str, str | None]] = {
    "ticket_vencido": (0, "Ticket vencido", None),
    "supervisor_critico": (0, "Supervisor en crítico", "linea_sin_uso"),
    "proyeccion_bajo": (0, "Proyección bajo el 90%", "otro"),
    "seguimiento_vencido": (1, "Seguimiento vencido", "otro"),
    "asesor_alerta": (1, "Asesor en alerta", "linea_sin_uso"),
    "sin_actividad": (1, "Sin registrar gestión", "otro"),
    "sin_supervisor": (1, "Asesores sin supervisor", None),
    "sin_vincular": (2, "Nombres sin vincular", None),
}
NOMBRE_METRICA = {"pospago": "Pospago", "gpon": "GPON", "uso": "uso de líneas", "conversacion": "conversación", "otra": "otra métrica"}
assert set(NOMBRE_METRICA) == set(METRICAS)


def _sobre(c: Coaching) -> str:
    """«Pospago + GPON»: las métricas que se trabajaron."""
    return " + ".join(NOMBRE_METRICA.get(m, m) for m in metricas_de(c))


def _pl(k: int, uno: str, varios: str) -> str:
    return f"{k} {uno if k == 1 else varios}"


def _dm(d: date) -> str:
    return d.strftime("%d/%m")


def _num(x: float) -> str:
    """Número con coma decimal y sin ceros de más (12,5 · 3 · 1,5)."""
    return f"{x:g}".replace(".", ",")


def _aware(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=timezone.utc) if d is not None and d.tzinfo is None else d


def _medianoche(d: date) -> datetime:
    return datetime.combine(d, time(0, 0), tzinfo=ZONA).astimezone(timezone.utc)


def _es_medianoche(d: datetime) -> bool:
    """La alerta empieza con el día (una alerta de uso, un seguimiento vencido), no a una hora."""
    d = _aware(d)
    return d == _medianoche(dia_local(d))


def dias_habiles_entre(desde: date, hasta: date, p: dict[str, Any]) -> float:
    """Días hábiles después de `desde` y hasta `hasta` inclusive (con los pesos y feriados del calendario)."""
    feriados = set(p["feriados"])
    total, d = 0.0, desde + timedelta(days=1)
    while d <= hasta:
        total += peso_dia(d, p["pesos_dia"], feriados)
        d += timedelta(days=1)
    return total


# ------------------------------------------------------------------ última gestión de cada supervisor
async def ultima_gestion(db: AsyncSession) -> dict[str, datetime]:
    """Lo último que registró cada supervisor: coaching, seguimiento, nota o una acción en un ticket."""
    out: dict[str, datetime] = {}

    def sumar(sid: str | None, *momentos: datetime | None) -> None:
        for m in momentos:
            m = _aware(m)
            if sid and m and (sid not in out or m > out[sid]):
                out[sid] = m

    for sid, c, s in (await db.execute(select(Coaching.supervisor_id, func.max(Coaching.created_at), func.max(Coaching.seguimiento_at))
                                       .where(Coaching.operativa == OPERATIVA).group_by(Coaching.supervisor_id))).all():
        sumar(sid, c, s)
    for sid, c in (await db.execute(select(BitacoraNota.supervisor_id, func.max(BitacoraNota.created_at))
                                    .where(BitacoraNota.operativa == OPERATIVA).group_by(BitacoraNota.supervisor_id))).all():
        sumar(sid, c)
    for por, at in (await db.execute(select(TicketEvento.por, func.max(TicketEvento.at))
                                     .where(TicketEvento.tipo.in_(("respuesta", "comentario", "pedido_datos", "resuelto")))
                                     .group_by(TicketEvento.por))).all():
        sumar(por, at)
    return out


# ------------------------------------------------------------------ cabecera y semáforo
def cabecera(ctx: Any, prev: Any, *, tickets: list[tuple[Ticket, dict[str, Any]]], dia: date) -> dict[str, Any]:
    total = ctx.atrib["total"]
    obj_pp = sum(o.pospago or 0 for o in ctx.objetivos.values())
    obj_gp = sum(o.gpon or 0 for o in ctx.objetivos.values())
    usos = ctx.atrib["operadores"].values()
    ev, su = sum(u["evaluables"] for u in usos), sum(u["sin_uso"] for u in usos)
    con_equipo = [op for op in ctx.tramos if ctx.actual(op)]
    con_coaching = {c.operador_id for c in ctx.coachings if ctx.primero <= c.fecha <= min(ctx.ultimo, dia)}
    sups = {ctx.actual(op) for op in con_equipo}
    criticos = sum(1 for sid in sups if ctx.alerta_de(ctx.equipo(sid))[0])
    alertas_op = [u for u in usos if u["alerta"]]
    situacion = Counter(e["situacion"] for _, e in tickets)
    return {
        "score": ctx.sc["operacion"]["total"], "score_parcial": ctx.sc["operacion"]["parcial"],
        "score_anterior": prev.sc["operacion"]["total"] if prev else None,
        "pospago": proyeccion(total["pospago"] if ctx.reporte else None, obj_pp or None, ctx.cal, ctx.p),
        "gpon": proyeccion(total["gpon"] if ctx.reporte else None, obj_gp or None, ctx.cal, ctx.p),
        "uso": {"pct_sin_uso": round(su / ev * 100, 1) if ev else None, "evaluables": ev, "sin_uso": su,
                "umbral": ctx.p["umbral_sin_uso"]},
        "supervisores_criticos": criticos, "supervisores": len(sups),
        "asesores_en_alerta": len(alertas_op), "a_recuperar": sum(u["a_recuperar"] for u in alertas_op),
        "tickets": {"abiertos": len(tickets), "vencidos": situacion.get("vencido", 0), "por_vencer": situacion.get("por_vencer", 0)},
        "cobertura": {"con": len(set(con_equipo) & con_coaching), "de": len(con_equipo)},
    }


def semaforo_fila(*, info: dict[str, Any], sc: dict[str, Any], anterior: float | None, pospago: dict[str, Any],
                  gpon: dict[str, Any], asesores: int, en_alerta: int, a_recuperar: int, alertas: Counter,
                  tickets: Counter, seguimientos_vencidos: int, ultima: datetime | None, dias_sin_gestion: float | None,
                  umbral: float) -> dict[str, Any]:
    """Una fila del semáforo: estado (atención / revisar / al día) y los motivos, del más urgente al menos."""
    rojo: list[str] = []
    amarillo: list[str] = []
    if tickets.get("vencido"):
        rojo.append(_pl(tickets["vencido"], "ticket vencido", "tickets vencidos"))
    if alertas.get("vencida"):
        rojo.append(_pl(alertas["vencida"], "alerta de uso sin coaching a tiempo", "alertas de uso sin coaching a tiempo"))
    if seguimientos_vencidos:
        rojo.append(_pl(seguimientos_vencidos, "seguimiento vencido", "seguimientos vencidos"))
    for nombre, pr in (("Pospago", pospago), ("GPON", gpon)):
        if pr["estado"] == "bajo_objetivo" and not pr["provisoria"]:
            rojo.append(f"{nombre} proyecta {pr['pct_proyeccion']:.0f}% del objetivo")
        elif pr["estado"] == "en_riesgo" and not pr["provisoria"]:
            amarillo.append(f"{nombre} en riesgo ({pr['pct_proyeccion']:.0f}%)")
    if asesores and dias_sin_gestion is not None and dias_sin_gestion >= DIAS_SIN_GESTION:
        rojo.append(f"Sin registrar gestión hace {_num(dias_sin_gestion)} días hábiles")
    if en_alerta:
        amarillo.append(f"En crítico: {_pl(en_alerta, 'asesor', 'asesores')} sobre el {_num(umbral)}% sin uso")
    if alertas.get("en_plazo"):
        amarillo.append(_pl(alertas["en_plazo"], "alerta esperando coaching", "alertas esperando coaching"))
    if tickets.get("por_vencer"):
        amarillo.append(_pl(tickets["por_vencer"], "ticket por vencer", "tickets por vencer"))
    estado = "atencion" if rojo else "revisar" if amarillo else "al_dia"
    partes = {p["clave"]: p for p in sc.get("partes", [])}
    return {
        **info, "estado": estado, "motivos": rojo + amarillo, "motivos_rojo": len(rojo),
        "score": sc.get("total"), "parcial": sc.get("parcial", False), "anterior": anterior,
        "pospago": pospago, "gpon": gpon, "asesores": asesores, "asesores_en_alerta": en_alerta, "a_recuperar": a_recuperar,
        "cobertura": partes.get("cobertura"), "tickets": {"abiertos": sum(tickets.values()), "vencidos": tickets.get("vencido", 0),
                                                        "por_vencer": tickets.get("por_vencer", 0)},
        "seguimientos_vencidos": seguimientos_vencidos,
        "ultima_gestion": ultima.isoformat() if ultima else None, "dias_sin_gestion": dias_sin_gestion,
    }


_ORDEN_ESTADO = {"atencion": 0, "revisar": 1, "al_dia": 2}


def orden_semaforo(f: dict[str, Any]) -> tuple:
    return (_ORDEN_ESTADO[f["estado"]], -f["motivos_rojo"], -(len(f["motivos"])), f["score"] if f["score"] is not None else 999,
            f["nombre"].lower())


# ------------------------------------------------------------------ alertas del día
def _cond(tipo: str, clave: str, titulo: str, detalle: str, *, periodo: str | None = None, supervisor_id: str | None = None,
          operador_id: str | None = None, desde: datetime | None = None, **datos: Any) -> dict[str, Any]:
    return {"tipo": tipo, "clave": clave, "titulo": titulo[:240], "detalle": detalle, "periodo": periodo,
            "supervisor_id": supervisor_id, "operador_id": operador_id, "desde": desde, "datos": datos}


def condiciones(ctx: Any, *, dia: date, nombres: dict[str, str], tickets: list[tuple[Ticket, dict[str, Any]]],
                coachings_abiertos: list[Coaching], filas: list[dict[str, Any]], alertas_uso: list[Any],
                pendientes_vincular: int, horario: sla.Horario) -> dict[tuple[str, str], dict[str, Any]]:
    """Las condiciones que hoy piden atención (cada una, con la clave que la identifica dentro de su tipo)."""
    out: dict[tuple[str, str], dict[str, Any]] = {}
    per, umbral = ctx.periodo, ctx.p["umbral_sin_uso"]
    sup = lambda sid: nombres.get(sid, "—") if sid else "sin supervisor"  # noqa: E731
    asesor = lambda op: ctx.ops[op].nombre if op in ctx.ops else "—"  # noqa: E731

    def add(c: dict[str, Any]) -> None:
        out[(c["tipo"], c["clave"])] = c

    # Tickets vencidos (de cualquier mes).
    for t, e in tickets:
        if e["situacion"] != "vencido":
            continue
        sin_respuesta = t.respuesta_at is None
        tarde = e["respuesta"]["cumplio"] is not True  # la primera respuesta no llegó (o llegó tarde)
        desde = horario.sumar(_aware(t.created_at), t.sla_respuesta_min) if tarde else None
        add(_cond("ticket_vencido", t.id, f"Ticket #{t.numero:04d} vencido · {sup(t.supervisor_id)}",
                  f"Se pasó del plazo de {'primera respuesta' if sin_respuesta else 'resolución'}"
                  f"{' · ' + asesor(t.operador_id) if t.operador_id else ''}.",
                  supervisor_id=t.supervisor_id, operador_id=t.operador_id, desde=desde, ticket_id=t.id, numero=t.numero))
    # Seguimientos vencidos (vencen al terminar el día siguiente al acordado).
    for c in coachings_abiertos:
        if estado_seguimiento(c, dia) != "vencido":
            continue
        add(_cond("seguimiento_vencido", c.id, f"Seguimiento vencido · {sup(c.supervisor_id)}",
                  f"Coaching a {asesor(c.operador_id)} del {_dm(c.fecha)} sobre {_sobre(c)}: "
                  f"el seguimiento era el {_dm(c.seguimiento_fecha)}.",
                  supervisor_id=c.supervisor_id, operador_id=c.operador_id, desde=_medianoche(c.seguimiento_fecha + timedelta(days=2)),
                  coaching_id=c.id))
    if ctx.periodo != dia.strftime("%Y-%m"):
        return out  # lo que sigue es del mes en curso
    # Asesores que cruzaron el umbral y supervisores en crítico (con la fecha en que apareció cada alerta).
    desde_alerta = {a.operador_id: _medianoche(a.desde) for a in alertas_uso if a.hasta is None}
    for op, u in ctx.atrib["operadores"].items():
        if not u["alerta"]:
            continue
        sid = ctx.actual(op)
        add(_cond("asesor_alerta", f"{per}:{op}", f"{asesor(op)} cruzó el {_num(umbral)}% de líneas sin uso",
                  f"{_num(u['pct_sin_uso'])}% sin uso ({u['sin_uso']} de {u['evaluables']}) · {sup(sid)} · "
                  f"{_pl(u['a_recuperar'], 'línea', 'líneas')} a recuperar.",
                  periodo=per, supervisor_id=sid, operador_id=op, desde=desde_alerta.get(op),
                  pct_sin_uso=u["pct_sin_uso"], evaluables=u["evaluables"], sin_uso=u["sin_uso"], a_recuperar=u["a_recuperar"]))
    for f in filas:
        sid = f["id"]
        if f["asesores_en_alerta"]:
            desdes = [desde_alerta[op] for op in ctx.equipo(sid) if op in desde_alerta]
            add(_cond("supervisor_critico", f"{per}:{sid}", f"{f['nombre']} en crítico",
                      f"{_pl(f['asesores_en_alerta'], 'asesor', 'asesores')} con más del {_num(umbral)}% de sus líneas sin uso · "
                      f"{_pl(f['a_recuperar'], 'línea', 'líneas')} a recuperar.",
                      periodo=per, supervisor_id=sid, desde=min(desdes) if desdes else None,
                      asesores_en_alerta=f["asesores_en_alerta"], a_recuperar=f["a_recuperar"]))
        for clave, nombre in (("pospago", "Pospago"), ("gpon", "GPON")):
            pr = f[clave]
            if pr["estado"] == "bajo_objetivo" and not pr["provisoria"]:
                add(_cond("proyeccion_bajo", f"{per}:{sid}:{clave}",
                          f"{f['nombre']}: {nombre} proyecta {pr['pct_proyeccion']:.0f}% del objetivo",
                          f"Lleva {pr['vendido']} de {pr['objetivo']}; al ritmo actual cierra en {pr['proyeccion']:.0f}. "
                          f"Necesita {_num(pr['ritmo_necesario'])} por día hábil." if pr["ritmo_necesario"] is not None
                          else f"Lleva {pr['vendido']} de {pr['objetivo']}; al ritmo actual cierra en {pr['proyeccion']:.0f}.",
                          periodo=per, supervisor_id=sid, producto=clave, pct_proyeccion=pr["pct_proyeccion"]))
        if f["asesores"] and f["dias_sin_gestion"] is not None and f["dias_sin_gestion"] >= DIAS_SIN_GESTION:
            ultima = f["ultima_gestion"]
            add(_cond("sin_actividad", sid, f"{f['nombre']} sin registrar gestión hace {_num(f['dias_sin_gestion'])} días hábiles",
                      ("Ni coachings, ni seguimientos, ni notas, ni respuestas a tickets desde el "
                       f"{_dm(dia_local(datetime.fromisoformat(ultima)))}.") if ultima else "Todavía no registró gestión.",
                      supervisor_id=sid, dias=f["dias_sin_gestion"]))
    # Asesores con actividad en el mes y sin supervisor hoy; nombres sin vincular.
    activos = set(ctx.atrib["operadores"]) | {op for op, o in ctx.ops.items() if o.agente_clave and o.agente_clave in ctx.prod}
    sin_sup = sorted((op for op in activos if op in ctx.ops and ctx.ops[op].activo and not ctx.actual(op)), key=asesor)
    if sin_sup:
        nombres_sin = ", ".join(asesor(op) for op in sin_sup[:6]) + (f" y {len(sin_sup) - 6} más" if len(sin_sup) > 6 else "")
        add(_cond("sin_supervisor", per, _pl(len(sin_sup), "asesor sin supervisor", "asesores sin supervisor"),
                  f"Vendieron o se conectaron este mes y hoy no tienen equipo: {nombres_sin}. Sus netas no suman a ningún supervisor.",
                  periodo=per, cantidad=len(sin_sup), operadores=sin_sup[:50]))
    if pendientes_vincular:
        add(_cond("sin_vincular", per, _pl(pendientes_vincular, "nombre sin vincular", "nombres sin vincular"),
                  "Nombres de llamadas o de ventas del mes que todavía no tienen su pareja en el maestro de operadores: hasta "
                  "vincularlos, las horas y las ventas de esa persona se miden por separado.", periodo=per, cantidad=pendientes_vincular))
    return out


async def sincronizar(db: AsyncSession, conds: dict[tuple[str, str], dict[str, Any]], momento: datetime) -> int:
    """Abre las alertas nuevas, actualiza las que siguen y cierra las que ya no se cumplen. Devuelve los cambios.

    Si una condición se había ido y vuelve con el mismo inicio (el mismo ticket o la misma alerta de uso), se
    reabre la alerta que ya estaba, con lo que se había hecho."""
    async with _lock:
        abiertas = (await db.execute(select(AlertaComando).where(AlertaComando.operativa == OPERATIVA,
                                                                 AlertaComando.hasta.is_(None)))).scalars().all()
        por_clave = {(a.tipo, a.clave): a for a in abiertas}
        nuevas = [c for k, c in conds.items() if k not in por_clave]
        cerradas: dict[tuple[str, str, datetime], AlertaComando] = {}
        if nuevas:
            q = select(AlertaComando).where(AlertaComando.operativa == OPERATIVA, AlertaComando.hasta.is_not(None),
                                            AlertaComando.clave.in_({c["clave"] for c in nuevas}))
            cerradas = {(a.tipo, a.clave, _aware(a.desde)): a for a in (await db.execute(q)).scalars().all()}
        cambios = 0
        for k, c in conds.items():
            a = por_clave.get(k)
            if a is None:
                desde = min(c["desde"] or momento, momento)
                a = cerradas.get((c["tipo"], c["clave"], desde))
                if a is not None:
                    a.hasta = None
                else:
                    a = AlertaComando(operativa=OPERATIVA, tipo=c["tipo"], clave=c["clave"], desde=desde, periodo=c["periodo"])
                    db.add(a)
                por_clave[k] = a
                cambios += 1
            a.titulo, a.detalle, a.datos, a.visto_at = c["titulo"], c["detalle"], c["datos"], momento
            a.supervisor_id, a.operador_id = c["supervisor_id"], c["operador_id"]
        for k, a in por_clave.items():
            if k not in conds:
                a.hasta = momento
                cambios += 1
        try:
            await db.commit()
        except IntegrityError:  # otro proceso registró la misma alerta en el mismo instante
            await db.rollback()
            return 0
        return cambios


async def alertas_recientes(db: AsyncSession, dia: date) -> list[AlertaComando]:
    """Las abiertas y las que se cerraron hoy (para ver qué se resolvió)."""
    inicio = _medianoche(dia)
    q = select(AlertaComando).where(AlertaComando.operativa == OPERATIVA,
                                    (AlertaComando.hasta.is_(None)) | (AlertaComando.hasta >= inicio))
    return list((await db.execute(q)).scalars().all())


def alerta_dict(a: AlertaComando, nombres: dict[str, str], dia: date, numeros: dict[str, int],
                asesores: dict[str, str] | None = None) -> dict[str, Any]:
    sev, nombre_tipo, ticket_tipo = TIPOS.get(a.tipo, (2, a.tipo, None))
    if a.hasta is not None:
        estado = "cerrada"
    elif a.descartada_at is not None:
        estado = "descartada"
    elif a.ticket_id:
        estado = "derivada"
    elif a.tomada_por:
        estado = "tomada"
    else:
        estado = "abierta"
    desde = _aware(a.desde)
    return {
        "id": a.id, "tipo": a.tipo, "tipo_nombre": nombre_tipo, "severidad": sev, "estado": estado,
        "titulo": a.titulo, "detalle": a.detalle, "datos": a.datos or {},
        "supervisor_id": a.supervisor_id, "supervisor": nombres.get(a.supervisor_id or "") if a.supervisor_id else None,
        "operador_id": a.operador_id, "operador": (asesores or {}).get(a.operador_id or "") if a.operador_id else None,
        "desde": desde.isoformat(), "desde_dia": _es_medianoche(desde), "nueva": dia_local(desde) == dia,
        "hasta": _iso(a.hasta), "tomada_por": nombres.get(a.tomada_por or "") if a.tomada_por else None,
        "tomada_at": _iso(a.tomada_at), "nota": a.nota, "nota_at": _iso(a.nota_at),
        "nota_por": nombres.get(a.nota_por or "") if a.nota_por else None,
        "ticket_id": a.ticket_id, "ticket_numero": numeros.get(a.ticket_id or ""),
        "descartada_por": nombres.get(a.descartada_por or "") if a.descartada_por else None,
        "descartada_motivo": a.descartada_motivo,
        "puede_revision": bool(ticket_tipo and a.supervisor_id and a.hasta is None and not a.ticket_id),
    }


def orden_alertas(x: dict[str, Any]) -> tuple:
    estado = {"abierta": 0, "tomada": 1, "derivada": 2, "descartada": 3, "cerrada": 4}[x["estado"]]
    return (estado, x["severidad"], not x["nueva"], x["desde"], x["titulo"])


# ------------------------------------------------------------------ línea de tiempo de un supervisor
def _ev(at: datetime | None, grupo: str, titulo: str, detalle: str | None = None, por: str | None = None, **link: Any) -> dict[str, Any]:
    return {"at": _iso(at), "grupo": grupo, "titulo": titulo, "detalle": detalle, "por": por, **{k: v for k, v in link.items() if v}}


async def linea_de_tiempo(db: AsyncSession, sid: str, periodo: str, *, nombres: dict[str, str], ops: dict[str, Any]) -> list[dict[str, Any]]:
    """Todo lo que pasó con un supervisor en el mes, lo más nuevo primero."""
    primero, ultimo = limites(periodo)
    desde, hasta = _medianoche(primero), _medianoche(ultimo + timedelta(days=1))
    asesor = lambda op: (ops[op].nombre if op in ops else "—") if op else None  # noqa: E731
    nom = lambda uid: "Sistema" if uid == "sistema" else nombres.get(uid or "", "—")  # noqa: E731
    out: list[dict[str, Any]] = []

    # Coachings del supervisor: cada paso del historial.
    cs = {c.id: c for c in (await db.execute(select(Coaching).where(Coaching.operativa == OPERATIVA, Coaching.supervisor_id == sid))).scalars().all()}
    if cs:
        evs = (await db.execute(select(CoachingEvento).where(CoachingEvento.coaching_id.in_(list(cs)), CoachingEvento.at >= desde,
                                                             CoachingEvento.at < hasta)
                                .order_by(CoachingEvento.at, case(ORDEN_EVENTO, value=CoachingEvento.tipo, else_=9)))).scalars().all()
        for e in evs:
            c = cs[e.coaching_id]
            quien, metrica = asesor(c.operador_id), _sobre(c)
            titulo = {
                "creado": f"Coaching {c.tipo} a {quien} sobre {metrica}",
                "editado": f"Corrigió el coaching a {quien}",
                "anulado": f"Anuló el coaching a {quien}",
                "seguimiento": f"Seguimiento del coaching a {quien}",
                "aclaracion": f"Aclaración al coaching a {quien}",
            }.get(e.tipo, f"Coaching a {quien}")
            d = e.datos or {}
            detalle = {
                "creado": d.get("compromiso"), "anulado": d.get("motivo"), "aclaracion": d.get("texto"),
                "seguimiento": (f"Resultado: {NOMBRE_RESULTADO.get(d.get('resultado'), 'sin datos')}"
                                f"{'' if d.get('a_tiempo', True) else ' · fuera de la fecha acordada'}. {d.get('comentario') or ''}").strip(),
            }.get(e.tipo)
            out.append(_ev(e.at, "seguimiento" if e.tipo == "seguimiento" else "coaching", titulo, detalle, nom(e.por),
                           coaching_id=c.id, operador_id=c.operador_id))

    # Notas de bitácora.
    for x in (await db.execute(select(BitacoraNota).where(BitacoraNota.operativa == OPERATIVA, BitacoraNota.supervisor_id == sid,
                                                          BitacoraNota.created_at >= desde, BitacoraNota.created_at < hasta))).scalars().all():
        out.append(_ev(x.created_at, "nota", f"Nota de bitácora: {x.tipo}{' · ' + asesor(x.operador_id) if x.operador_id else ''}",
                       x.texto, nom(sid), operador_id=x.operador_id))

    # Tickets: los que tiene y los que le reasignaron a otro.
    tks = {t.id: t for t in (await db.execute(select(Ticket).where(Ticket.operativa == OPERATIVA, Ticket.supervisor_id == sid))).scalars().all()}
    reasig = (await db.execute(select(TicketEvento).where(TicketEvento.tipo == "reasignado", TicketEvento.at >= desde,
                                                          TicketEvento.at < hasta))).scalars().all()
    salieron = [e for e in reasig if (e.datos or {}).get("de") == sid and e.ticket_id not in tks]
    if salieron:
        for t in (await db.execute(select(Ticket).where(Ticket.id.in_([e.ticket_id for e in salieron])))).scalars().all():
            tks[t.id] = t
    if tks:
        evs = (await db.execute(select(TicketEvento).where(TicketEvento.ticket_id.in_(list(tks)), TicketEvento.at >= desde,
                                                           TicketEvento.at < hasta)
                                .order_by(TicketEvento.at, TicketEvento.orden))).scalars().all()
        for e in evs:
            t = tks[e.ticket_id]
            n = f"#{t.numero:04d}"
            d = e.datos or {}
            if e.tipo == "reasignado" and d.get("a") != sid and d.get("de") != sid:
                continue
            titulo = {
                "creado": f"Recibió el ticket {n} de {nom(e.por)}",
                "respuesta": f"Respondió el ticket {n}",
                "comentario": f"{nom(e.por)} comentó el ticket {n}",
                "pedido_datos": f"Pidió datos en el ticket {n}",
                "datos": f"{nom(e.por)} mandó los datos del ticket {n}",
                "resuelto": f"Resolvió el ticket {n}",
                "reabierto": f"{nom(e.por)} reabrió el ticket {n}",
                "reasignado": (f"Le reasignaron el ticket {n}" if d.get("a") == sid else f"El ticket {n} pasó a {nom(d.get('a'))}"),
                "cancelado": f"{nom(e.por)} canceló el ticket {n}",
                "cerrado_auto": f"El ticket {n} se cerró sin los datos pedidos",
            }.get(e.tipo, f"Ticket {n}")
            out.append(_ev(e.at, "ticket", titulo, e.texto, nom(e.por), ticket_id=t.id, operador_id=t.operador_id))

    # Cambios de equipo del mes (cuándo se hizo el cambio y desde qué fecha rige). Los que se hicieron juntos (armar el
    # equipo del mes, copiar el anterior) van en un solo evento.
    asigs = (await db.execute(select(EquipoAsignacion).where(EquipoAsignacion.operativa == OPERATIVA, EquipoAsignacion.periodo == periodo)
                              .order_by(EquipoAsignacion.desde))).scalars().all()
    previo: dict[str, str | None] = {}
    lotes: dict[tuple, list[tuple[EquipoAsignacion, str | None]]] = {}
    for a in asigs:
        antes = previo.get(a.operador_id)
        entra, sale = a.supervisor_id == sid and antes != sid, antes == sid and a.supervisor_id != sid
        if entra or sale:
            minuto = _aware(a.created_at).replace(second=0, microsecond=0) if a.created_at else None
            lotes.setdefault(("entra" if entra else "sale", minuto, a.created_by, a.desde), []).append((a, antes if entra else a.supervisor_id))
        previo[a.operador_id] = a.supervisor_id
    for (sentido, _, por, desde_eq), items in lotes.items():
        if len(items) > LOTE_EQUIPO:
            nombres_ops = sorted(asesor(a.operador_id) or "—" for a, _ in items)
            lista = ", ".join(nombres_ops[:8]) + (f" y {len(nombres_ops) - 8} más" if len(nombres_ops) > 8 else "")
            if sentido == "entra":
                titulo = (f"Equipo del mes: {len(items)} asesores" if desde_eq == primero else f"Ingresaron {len(items)} asesores al equipo")
            else:
                titulo = f"Salieron {len(items)} asesores del equipo"
            out.append(_ev(min(_aware(a.created_at) for a, _ in items), "equipo", titulo, f"Desde el {_dm(desde_eq)}: {lista}.", nom(por)))
            continue
        for a, otro in items:
            if sentido == "entra":
                out.append(_ev(a.created_at, "equipo", f"Ingresó {asesor(a.operador_id)} al equipo",
                               f"Desde el {_dm(a.desde)}" + (f" (venía de {nom(otro)})" if otro else ""), nom(a.created_by),
                               operador_id=a.operador_id))
            else:
                out.append(_ev(a.created_at, "equipo", f"Salió {asesor(a.operador_id)} del equipo",
                               f"Desde el {_dm(a.desde)}" + (f": pasó a {nom(otro)}" if otro else ": quedó sin supervisor"),
                               nom(a.created_by), operador_id=a.operador_id))

    # Objetivos del mes.
    o = (await db.execute(select(ObjetivoSupervisor).where(ObjetivoSupervisor.operativa == OPERATIVA, ObjetivoSupervisor.periodo == periodo,
                                                           ObjetivoSupervisor.supervisor_id == sid))).scalars().first()
    if o:
        out.append(_ev(o.updated_at, "objetivo", "Objetivos del mes", f"Pospago {o.pospago if o.pospago is not None else '—'} · "
                       f"GPON {o.gpon if o.gpon is not None else '—'}", nom(o.updated_by)))

    # Alertas del centro de comandos sobre el supervisor: cuándo aparecieron y quién las tomó.
    for a in (await db.execute(select(AlertaComando).where(AlertaComando.operativa == OPERATIVA, AlertaComando.supervisor_id == sid,
                                                           AlertaComando.desde >= desde, AlertaComando.desde < hasta))).scalars().all():
        nombre_tipo = TIPOS.get(a.tipo, (0, a.tipo))[1]
        out.append(_ev(a.desde, "alerta", f"Alerta: {a.titulo}", a.detalle, None, operador_id=a.operador_id, dia=_es_medianoche(a.desde)))
        if a.tomada_at:
            out.append(_ev(a.tomada_at, "alerta", f"{nom(a.tomada_por)} tomó la alerta «{nombre_tipo}»",
                           a.nota, nom(a.nota_por or a.tomada_por), ticket_id=a.ticket_id))
        if a.descartada_at:
            out.append(_ev(a.descartada_at, "alerta", f"{nom(a.descartada_por)} descartó la alerta «{nombre_tipo}»",
                           a.descartada_motivo, nom(a.descartada_por)))
        if a.hasta:
            out.append(_ev(a.hasta, "alerta", f"Se cerró la alerta «{nombre_tipo}»", "La condición dejó de cumplirse.", None,
                           operador_id=a.operador_id))
    # Lo más nuevo primero; a igual hora, el paso posterior (cada fuente se agregó en orden).
    return [e for _, e in sorted(enumerate(out), key=lambda p: (p[1]["at"] or "", p[0]), reverse=True)]


def _iso(d: datetime | None) -> str | None:
    d = _aware(d)
    return d.isoformat() if d else None
