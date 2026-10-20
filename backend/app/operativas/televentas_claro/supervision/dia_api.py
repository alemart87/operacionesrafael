"""Coaching del día — los jefes (`televentas_claro.control_supervisores`: gerente, sub gerente, coordinador y controller).

* `GET /control/dia`: los coachings con movimiento en el día (firmados, en curso, seguimientos registrados), los que
  esperan la firma y los seguimientos de hoy o vencidos, por supervisor, con lo que se trabajó y el tiempo estimado.
* `POST /control/coaching/{id}/revision`: la revisión del jefe (bien hecho / a mejorar, con un comentario). Queda en el
  historial del coaching y la ve el supervisor; no cambia lo firmado.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip
from ....core.database import get_db
from ....services.audit_service import record_action
from . import analisis as an
from . import api as sup
from . import coaching as srv
from .alertas import ZONA
from .control_api import require_control
from .models import OPERATIVA, Coaching, CoachingAudio, CoachingCompromiso, CoachingEvento, CoachingItem, Operador

router = APIRouter(prefix="/televentas-claro/supervision", tags=["televentas-claro · coaching del día"])

VALORACION = {"bien": "Bien hecho", "mejorar": "A mejorar"}


def revision_dict(e: CoachingEvento, nombres: dict[str, str]) -> dict[str, Any]:
    x = e.datos or {}
    return {"valoracion": x.get("valoracion"), "comentario": x.get("comentario"), "por": nombres.get(e.por, e.por),
            "por_id": e.por, "at": srv.iso(e.at)}


def _corto(t: str | None, n: int = 180) -> str | None:
    if not t:
        return None
    t = " ".join(t.split())
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


@router.get("/control/dia")
async def coaching_del_dia(fecha: Optional[date] = Query(None), supervisor_id: Optional[str] = Query(None, max_length=36),
                           user: CurrentUser = Depends(require_control), db: AsyncSession = Depends(get_db)) -> dict:
    """Cómo están los coachings del día: lo firmado, lo que está en curso, lo que espera la firma y los seguimientos."""
    hoy = sup.hoy()
    fecha = fecha or hoy
    if fecha > hoy:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Elegí hoy o un día anterior")
    ini = datetime.combine(fecha, time.min, tzinfo=ZONA).astimezone(timezone.utc)
    fin = datetime.combine(fecha + timedelta(days=1), time.min, tzinfo=ZONA).astimezone(timezone.utc)
    p = await sup.parametros(db)

    q = (select(CoachingEvento.coaching_id).join(Coaching, Coaching.id == CoachingEvento.coaching_id)
         .where(Coaching.operativa == OPERATIVA, CoachingEvento.at >= ini, CoachingEvento.at < fin,
                CoachingEvento.tipo != "transcripcion").distinct())
    ids = {i for (i,) in (await db.execute(q)).all()}
    # Lo que está abierto ahora (solo para el día de hoy): las devoluciones sin firmar y los seguimientos de hoy o vencidos.
    if fecha == hoy:
        ids |= {c.id for c in await srv.sin_firmar(db)}
        abiertos = (await db.execute(select(Coaching.id, Coaching.seguimiento_fecha).where(
            Coaching.operativa == OPERATIVA, Coaching.estado == "abierto", Coaching.seguimiento_fecha <= hoy))).all()
        ids |= {i for i, _ in abiertos}
    qc = select(Coaching).where(Coaching.id.in_(ids)) if ids else None
    cs = list((await db.execute(qc)).scalars().all()) if qc is not None else []
    cs = [c for c in cs if c.estado != "anulado" and (not supervisor_id or c.supervisor_id == supervisor_id)]
    cids = [c.id for c in cs]

    items: dict[str, list[CoachingItem]] = defaultdict(list)
    comps: dict[str, list[CoachingCompromiso]] = defaultdict(list)
    auds: dict[str, list[CoachingAudio]] = defaultdict(list)
    evs: dict[str, list[CoachingEvento]] = defaultdict(list)
    for k in range(0, len(cids), 500):
        lote = cids[k:k + 500]
        for i in (await db.execute(select(CoachingItem).where(CoachingItem.coaching_id.in_(lote)).order_by(CoachingItem.at))).scalars():
            items[i.coaching_id].append(i)
        for x in (await db.execute(select(CoachingCompromiso).where(CoachingCompromiso.coaching_id.in_(lote))
                                   .order_by(CoachingCompromiso.orden))).scalars():
            comps[x.coaching_id].append(x)
        for a in (await db.execute(select(CoachingAudio).where(CoachingAudio.coaching_id.in_(lote)))).scalars():
            auds[a.coaching_id].append(a)
        for e in (await db.execute(select(CoachingEvento).where(CoachingEvento.coaching_id.in_(lote))
                                   .order_by(CoachingEvento.at))).scalars():
            evs[e.coaching_id].append(e)
    ops = {o.id: o for o in (await db.execute(select(Operador).where(Operador.id.in_({c.operador_id for c in cs})))).scalars()} if cs else {}
    revisores = {e.por for es in evs.values() for e in es if e.tipo == "revision"}
    nombres = await sup._nombres(db, {c.supervisor_id for c in cs} | revisores)

    def en_dia(d: datetime | None) -> bool:
        d = an._aware(d)
        return bool(d and ini <= d < fin)

    filas = []
    for c in cs:
        es = evs.get(c.id, [])
        del_dia = [e for e in es if en_dia(e.at) and e.tipo != "transcripcion"]
        revs = [e for e in es if e.tipo == "revision"]
        if c.firmado_at and en_dia(c.firmado_at):
            estado_dia = "firmado"
        elif c.estado == srv.PENDIENTE:
            estado_dia = "en_curso" if any(e.por == c.supervisor_id for e in del_dia) else "sin_firmar"
        elif c.estado == "cerrado" and en_dia(c.seguimiento_at):
            estado_dia = "seguimiento"
        elif c.estado == "abierto" and srv.estado_seguimiento(c, hoy) in ("hoy", "vencido") and fecha == hoy:
            estado_dia = "seguimiento_pendiente"
        else:
            estado_dia = "movimiento"
        pasos = [e.at for e in es if e.tipo in an.PASOS and e.por == c.supervisor_id] + [c.created_at]
        o = ops.get(c.operador_id)
        it, cm = items.get(c.id, []), comps.get(c.id, [])
        filas.append({
            "id": c.id, "supervisor_id": c.supervisor_id, "supervisor": nombres.get(c.supervisor_id, c.supervisor_id),
            "operador_id": c.operador_id, "operador": o.nombre if o else "—", "tipo": c.tipo, "metricas": srv.metricas_de(c),
            "fecha": c.fecha.isoformat(), "created_at": srv.iso(c.created_at), "firmado_at": srv.iso(c.firmado_at),
            "estado": c.estado, "devolucion": srv.devolucion(c), "estado_dia": estado_dia,
            "monitoreos": sum(1 for i in it if i.tipo == "monitoreo"), "feedback": sum(1 for i in it if i.tipo == "feedback"),
            "compromisos": len(cm), "audios": len(auds.get(c.id, [])),
            "voz_asesor": any(a.hablante == "asesor" for a in auds.get(c.id, [])),
            "minutos": an.minutos_estimados(pasos, c.firmado_at) if c.firmado_at else None,
            "vence_devolucion": srv.vence_devolucion(c, p).isoformat() if c.estado == srv.PENDIENTE else None,
            "devolucion_vencida": srv.devolucion_vencida(c, hoy, p),
            "seguimiento": srv.estado_seguimiento(c, hoy), "seguimiento_fecha": c.seguimiento_fecha.isoformat(),
            "resultado": c.resultado,
            "resumen": _corto(next((i.texto for i in it if i.texto), None) or c.diagnostico),
            "compromiso": _corto(next((x.texto for x in cm if x.texto), None) or c.compromiso),
            "cumplimiento": dict(Counter(x.resultado for x in cm if x.resultado)),
            "revision": revision_dict(revs[-1], nombres) if revs else None, "revisiones": len(revs),
            "ultima_actividad": srv.iso(max((e.at for e in del_dia), default=None) or c.updated_at or c.created_at),
        })
    orden = {"firmado": 0, "en_curso": 1, "seguimiento": 2, "seguimiento_pendiente": 3, "sin_firmar": 4, "movimiento": 5}
    filas.sort(key=lambda f: (orden[f["estado_dia"]], -(datetime.fromisoformat(f["ultima_actividad"]).timestamp()
                                                        if f["ultima_actividad"] else 0)))

    por_sup: dict[str, Counter] = defaultdict(Counter)
    for f in filas:
        x = por_sup[f["supervisor_id"]]
        x[f["estado_dia"]] += 1
        x["vencidas"] += f["devolucion_vencida"]
        x["seg_vencidos"] += f["seguimiento"] == "vencido"
        x["por_revisar"] += f["estado_dia"] == "firmado" and not f["revision"]
    ctx = await sup.Contexto(hoy.strftime("%Y-%m")).cargar(db)
    sids = set(por_sup) | ({s for s, i in ctx.supervisores.items() if i["activo"]} if not supervisor_id else {supervisor_id})
    nombres |= await sup._nombres(db, sids - set(nombres))
    supervisores = sorted(({
        "id": sid, "nombre": nombres.get(sid, sid), "asesores": len(ctx.equipo(sid)),
        "firmados": por_sup[sid]["firmado"], "en_curso": por_sup[sid]["en_curso"], "sin_firmar": por_sup[sid]["sin_firmar"] + por_sup[sid]["en_curso"],
        "vencidas": por_sup[sid]["vencidas"], "seguimientos": por_sup[sid]["seguimiento"],
        "seguimientos_pendientes": por_sup[sid]["seguimiento_pendiente"], "seguimientos_vencidos": por_sup[sid]["seg_vencidos"],
        "por_revisar": por_sup[sid]["por_revisar"],
    } for sid in sids), key=lambda s: (-(s["firmados"] + s["en_curso"]), s["nombre"].lower()))
    firmados = [f for f in filas if f["estado_dia"] == "firmado"]
    pend = [f for f in filas if f["estado"] == srv.PENDIENTE]
    return {
        "fecha": fecha.isoformat(), "hoy": hoy.isoformat(), "actualizado": srv.ahora().isoformat(),
        "kpis": {
            "firmados": len(firmados), "en_curso": sum(1 for f in filas if f["estado_dia"] == "en_curso"),
            "sin_firmar": len(pend), "sin_firmar_vencidos": sum(1 for f in pend if f["devolucion_vencida"]),
            "seguimientos": sum(1 for f in filas if f["estado_dia"] == "seguimiento"),
            "seguimientos_pendientes": sum(1 for f in filas if f["estado_dia"] == "seguimiento_pendiente"),
            "seguimientos_vencidos": sum(1 for f in filas if f["seguimiento"] == "vencido"),
            "por_revisar": sum(1 for f in firmados if not f["revision"]), "revisados": sum(1 for f in firmados if f["revision"]),
            "minutos_prom": round(sum(f["minutos"] for f in firmados) / len(firmados), 1) if firmados else None,
            "supervisores_activos": sum(1 for s in supervisores if s["firmados"] or s["en_curso"] or s["seguimientos"]),
            "supervisores": len(supervisores),
        },
        "supervisores": supervisores, "coachings": filas,
    }


class RevisionPayload(BaseModel):
    valoracion: Literal["bien", "mejorar"]
    comentario: Optional[str] = Field(None, max_length=1000)


@router.post("/control/coaching/{coaching_id}/revision", status_code=status.HTTP_201_CREATED)
async def revisar(coaching_id: str, payload: RevisionPayload, request: Request, user: CurrentUser = Depends(require_control),
                  db: AsyncSession = Depends(get_db)) -> dict:
    """La revisión del jefe sobre un coaching: queda en su historial y la ve el supervisor (no cambia lo firmado)."""
    c = await db.get(Coaching, coaching_id)
    if not c or c.operativa != OPERATIVA:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Coaching no encontrado")
    if c.estado == "anulado":
        raise HTTPException(status.HTTP_409_CONFLICT, "Este coaching está anulado")
    comentario = " ".join((payload.comentario or "").split()) or None
    if payload.valoracion == "mejorar" and (not comentario or len(comentario) < 5):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Escribí qué tiene que mejorar (al menos 5 caracteres)")
    srv.evento(db, c, "revision", user.id, valoracion=payload.valoracion, comentario=comentario)
    await db.commit()
    await record_action(db, user_id=user.id, action="coaching_revisado", resource_type="coaching", resource_id=c.id,
                        ip=client_ip(request), extra={"valoracion": payload.valoracion, "supervisor": c.supervisor_id})
    e = (await db.execute(select(CoachingEvento).where(CoachingEvento.coaching_id == c.id, CoachingEvento.tipo == "revision")
                          .order_by(CoachingEvento.at.desc()).limit(1))).scalars().first()
    return revision_dict(e, await sup._nombres(db, {user.id}))
