"""Mi día del supervisor — Televentas Claro.

Va dentro de «Hoy» del portal (no es una pantalla aparte):

* `GET /portal/mi-dia`: el objetivo de feedback del día (`objetivo_feedback_dia`, por defecto 8) con los hitos (primer
  feedback, la mitad, el objetivo y el punto extra del cierre), la racha de días con el objetivo cumplido, la calidad
  de sus feedback de los últimos 7 días con qué hacer, y su cierre del día (o el compromiso del cierre anterior).
* `POST /portal/calidad`: la calidad de un feedback mientras lo escribe (consejos al instante).
* `PUT /portal/cierre`: carga o corrige el cierre de hoy (resultados, compromiso para mañana, cómo terminó el día y si
  cumplió el compromiso anterior). Detecta el ánimo y suma el punto extra.
* `GET /control/cierres` (jefes, con el permiso del control): los cierres del día de cada supervisor, el ánimo de los
  últimos días con su alerta y cuántos feedback lleva cada uno.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip
from ....core.database import get_db
from ....services.audit_service import record_action
from . import api as sup
from . import calidad as cal
from . import coaching as srv
from .alertas import ZONA
from .control_api import require_control
from .models import OPERATIVA, CierreDia, Coaching, CoachingItem

router = APIRouter(prefix="/televentas-claro/supervision", tags=["televentas-claro · mi día del supervisor"])

OBJETIVO_DEFECTO = 8
DIAS_CALIDAD = 7          # los feedback que se miran para «Calidad de mis feedback»
DIAS_ANIMO = 7            # el ánimo que ven los jefes
DIAS_RACHA = 30
MIN_TEXTO = 10


def _limites(desde: date, hasta: date) -> tuple[datetime, datetime]:
    ini = datetime.combine(desde, time.min, tzinfo=ZONA).astimezone(timezone.utc)
    fin = datetime.combine(hasta + timedelta(days=1), time.min, tzinfo=ZONA).astimezone(timezone.utc)
    return ini, fin


def objetivo(p: dict[str, Any]) -> int:
    try:
        return max(1, min(30, int(p.get("objetivo_feedback_dia") or OBJETIVO_DEFECTO)))
    except (TypeError, ValueError):
        return OBJETIVO_DEFECTO


def _habil(d: date, p: dict[str, Any]) -> bool:
    pesos = p.get("pesos_dia") or [1, 1, 1, 1, 1, 0.5, 0]
    return bool(pesos[d.weekday()]) and d.isoformat() not in set(p.get("feriados") or [])


async def feedbacks(db: AsyncSession, desde: date, hasta: date, supervisor_id: str | None = None) -> list[tuple[str, datetime, str]]:
    """Los feedback cargados en coachings no anulados en el rango: (supervisor, hora, texto)."""
    ini, fin = _limites(desde, hasta)
    q = (select(Coaching.supervisor_id, CoachingItem.at, CoachingItem.texto).join(Coaching, Coaching.id == CoachingItem.coaching_id)
         .where(Coaching.operativa == OPERATIVA, Coaching.estado != "anulado", CoachingItem.tipo == "feedback",
                CoachingItem.at >= ini, CoachingItem.at < fin))
    if supervisor_id:
        q = q.where(Coaching.supervisor_id == supervisor_id)
    return [(s, a, t or "") for s, a, t in (await db.execute(q)).all()]


def _dia(d: datetime) -> date:
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).astimezone(ZONA).date()


def hitos(hechos: int, obj: int, con_cierre: bool) -> list[dict[str, Any]]:
    marcas = sorted({1, math.ceil(obj / 2), obj})
    nombres = {1: "Primer feedback", math.ceil(obj / 2): "Mitad del objetivo", obj: "Objetivo del día"}
    out = [{"clave": f"f{m}", "nombre": nombres[m], "meta": m, "logrado": hechos >= m} for m in marcas]
    out.append({"clave": "cierre", "nombre": "Cierre del día", "meta": None, "logrado": con_cierre, "extra": True})
    return out


def cierre_dict(c: CierreDia | None) -> dict[str, Any] | None:
    if not c:
        return None
    return {"id": c.id, "fecha": c.fecha.isoformat(), "resultados": c.resultados, "compromiso": c.compromiso,
            "como_termino": c.como_termino, "cumplio_anterior": c.cumplio_anterior, "feedbacks": c.feedbacks,
            "animo": c.animo or {}, "at": srv.iso(c.updated_at or c.created_at)}


async def _anterior(db: AsyncSession, sid: str, dia: date) -> CierreDia | None:
    """El último cierre antes de hoy (su compromiso es el que se evalúa hoy)."""
    return (await db.execute(select(CierreDia).where(CierreDia.supervisor_id == sid, CierreDia.fecha < dia)
                             .order_by(CierreDia.fecha.desc()).limit(1))).scalar_one_or_none()


async def mi_dia(db: AsyncSession, sid: str) -> dict[str, Any]:
    dia = sup.hoy()
    p = await sup.parametros(db)
    obj = objetivo(p)
    fbs = await feedbacks(db, dia - timedelta(days=DIAS_RACHA), dia, sid)
    por_dia = Counter(_dia(a) for _, a, _ in fbs)
    hechos = por_dia.get(dia, 0)
    racha, d = 0, dia - timedelta(days=1)
    for _ in range(DIAS_RACHA):
        if _habil(d, p):
            if por_dia.get(d, 0) < obj:
                break
            racha += 1
        d -= timedelta(days=1)
    hoy_c = (await db.execute(select(CierreDia).where(CierreDia.supervisor_id == sid, CierreDia.fecha == dia))).scalar_one_or_none()
    ant = await _anterior(db, sid, dia)
    textos = [t for _, a, t in sorted(fbs, key=lambda x: x[1], reverse=True) if _dia(a) > dia - timedelta(days=DIAS_CALIDAD)]
    ultimos = [{"texto": t[:220], "at": srv.iso(a), **{k: v for k, v in cal.evaluar_feedback(t).items() if k in ("puntaje", "nivel", "problema", "palabras")}}
               for _, a, t in sorted(fbs, key=lambda x: x[1], reverse=True)[:5]]
    return {
        "fecha": dia.isoformat(), "habil": _habil(dia, p), "objetivo": obj, "feedbacks": hechos,
        "puntos": min(hechos, obj) + (1 if hoy_c else 0), "puntos_max": obj + 1,
        "hitos": hitos(hechos, obj, bool(hoy_c)), "racha": racha,
        "semana": [{"dia": (dia - timedelta(days=k)).isoformat(), "feedbacks": por_dia.get(dia - timedelta(days=k), 0),
                    "habil": _habil(dia - timedelta(days=k), p)} for k in range(6, -1, -1)],
        "calidad": {**cal.resumen_calidad(textos), "dias": DIAS_CALIDAD, "ultimos": ultimos,
                    "criterios": cal.CRITERIOS, "reglas": {"min_palabras": cal.MIN_PALABRAS, "max_palabras": cal.MAX_PALABRAS}},
        "cierre": cierre_dict(hoy_c),
        "anterior": {"fecha": ant.fecha.isoformat(), "compromiso": ant.compromiso} if ant else None,
    }


# ================================================================== portal del supervisor
@router.get("/portal/mi-dia")
async def ver_mi_dia(user: CurrentUser = Depends(sup.require_portal), db: AsyncSession = Depends(get_db)) -> dict:
    return await mi_dia(db, user.id)


class CalidadPayload(BaseModel):
    texto: str = Field("", max_length=srv.MAX_TEXTO)


@router.post("/portal/calidad")
async def calidad_feedback(payload: CalidadPayload, user: CurrentUser = Depends(sup.require_portal)) -> dict:
    """La calidad de un feedback mientras se escribe (no guarda nada)."""
    return cal.evaluar_feedback(payload.texto)


class CierrePayload(BaseModel):
    resultados: str = Field(..., max_length=2000)
    compromiso: str = Field(..., max_length=1000)
    como_termino: Optional[Literal["bien", "normal", "dificil"]] = None
    cumplio_anterior: Optional[Literal["cumplido", "parcial", "no_cumplido"]] = None


@router.put("/portal/cierre")
async def guardar_cierre(payload: CierrePayload, request: Request, user: CurrentUser = Depends(sup.require_portal),
                         db: AsyncSession = Depends(get_db)) -> dict:
    """Carga (o corrige, el mismo día) el cierre: resultados, compromiso para mañana y cómo terminó el día."""
    resultados, compromiso = " ".join(payload.resultados.split()), " ".join(payload.compromiso.split())
    if len(resultados) < MIN_TEXTO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Contá en una frase cómo te fue hoy")
    if len(compromiso) < MIN_TEXTO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Escribí tu compromiso para mañana")
    dia = sup.hoy()
    ant = await _anterior(db, user.id, dia)
    if ant and not payload.cumplio_anterior:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Contá si cumpliste tu compromiso anterior")
    hechos = sum(1 for _, a, _ in await feedbacks(db, dia, dia, user.id))
    animo = cal.detectar_animo(f"{resultados}. {compromiso}", payload.como_termino)
    c = (await db.execute(select(CierreDia).where(CierreDia.supervisor_id == user.id, CierreDia.fecha == dia))).scalar_one_or_none()
    nuevo = c is None
    if nuevo:
        c = CierreDia(supervisor_id=user.id, fecha=dia, resultados=resultados, compromiso=compromiso)
        db.add(c)
    c.resultados, c.compromiso, c.como_termino = resultados, compromiso, payload.como_termino
    c.cumplio_anterior = payload.cumplio_anterior if ant else None
    c.anterior_id = ant.id if ant else None
    c.feedbacks, c.animo = hechos, animo
    c.updated_at = None if nuevo else srv.ahora()
    try:
        await db.commit()
    except IntegrityError as exc:       # el mismo cierre guardado dos veces a la vez
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya guardaste el cierre de hoy: actualizá la pantalla") from exc
    await record_action(db, user_id=user.id, action="cierre_dia" if nuevo else "cierre_dia_corregido", resource_type="cierre_dia",
                        resource_id=c.id, ip=client_ip(request),
                        extra={"fecha": dia.isoformat(), "feedbacks": hechos, "animo": animo["etiqueta"], "cumplio_anterior": c.cumplio_anterior})
    return await mi_dia(db, user.id)


# ================================================================== jefes
@router.get("/control/cierres")
async def cierres(fecha: Optional[date] = Query(None), user: CurrentUser = Depends(require_control),
                  db: AsyncSession = Depends(get_db)) -> dict:
    """El cierre del día de cada supervisor (resultados, compromiso, cómo terminó) y su ánimo de los últimos días."""
    hoy = sup.hoy()
    fecha = fecha or hoy
    if fecha > hoy:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Elegí hoy o un día anterior")
    p = await sup.parametros(db)
    obj = objetivo(p)
    ctx = await sup.Contexto(fecha.strftime("%Y-%m")).cargar(db)
    desde = fecha - timedelta(days=DIAS_ANIMO - 1)
    rows = (await db.execute(select(CierreDia).where(CierreDia.operativa == OPERATIVA, CierreDia.fecha >= desde,
                                                     CierreDia.fecha <= fecha))).scalars().all()
    por_sup: dict[str, dict[date, CierreDia]] = defaultdict(dict)
    for c in rows:
        por_sup[c.supervisor_id][c.fecha] = c
    fbs = await feedbacks(db, fecha, fecha)
    fb_hoy = Counter(s for s, _, _ in fbs)
    textos: dict[str, list[str]] = defaultdict(list)
    for s, _, t in fbs:
        textos[s].append(t)
    ids = {i for i, s in ctx.supervisores.items() if s["activo"]} | set(por_sup) | set(fb_hoy)
    nombres = await sup._nombres(db, ids)
    filas = []
    for sid in ids:
        dias = por_sup.get(sid, {})
        serie = [{"dia": (fecha - timedelta(days=k)).isoformat(),
                  "etiqueta": (dias[fecha - timedelta(days=k)].animo or {}).get("etiqueta") if fecha - timedelta(days=k) in dias else None}
                 for k in range(DIAS_ANIMO - 1, -1, -1)]
        recientes = [dias[d].animo for d in sorted(dias, reverse=True)]
        c = dias.get(fecha)
        anterior = await db.get(CierreDia, c.anterior_id) if c and c.anterior_id else None
        cal_hoy = cal.resumen_calidad(textos.get(sid, []))
        filas.append({
            "id": sid, "nombre": (ctx.supervisores.get(sid) or {}).get("nombre") or nombres.get(sid, sid),
            "feedbacks": fb_hoy.get(sid, 0), "objetivo": obj, "puntos": min(fb_hoy.get(sid, 0), obj) + (1 if c else 0),
            "calidad": cal_hoy["puntaje"], "calidad_nivel": cal_hoy["nivel"],
            "cierre": cierre_dict(c), "anterior": cierre_dict(anterior),
            "animo": serie, "alerta": cal.alerta_animo(recientes),
        })
    filas.sort(key=lambda f: (f["alerta"] is None, f["cierre"] is not None, f["nombre"].lower()))
    con = [f for f in filas if f["cierre"]]
    etiquetas = Counter((f["cierre"]["animo"] or {}).get("etiqueta") for f in con)
    return {
        "fecha": fecha.isoformat(), "hoy": hoy.isoformat(), "objetivo": obj,
        "kpis": {"supervisores": len(filas), "con_cierre": len(con), "objetivo_cumplido": sum(1 for f in filas if f["feedbacks"] >= obj),
                 "feedbacks": sum(f["feedbacks"] for f in filas), "alertas": sum(1 for f in filas if f["alerta"]),
                 "animo": {k: etiquetas.get(k, 0) for k in ("positivo", "neutral", "mixto", "negativo")}},
        "supervisores": filas,
    }
