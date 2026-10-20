"""Mi día del supervisor — Televentas Claro.

Va dentro de «Hoy» del portal (no es una pantalla aparte):

* `GET /portal/mi-dia`: el objetivo de feedback del día (`objetivo_feedback_dia`, por defecto 8; cada coaching con algo
  cargado ese día es un feedback dado) con los hitos (primer feedback, la mitad, el objetivo y el punto extra del cierre), la racha de días con el objetivo cumplido, la calidad
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

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip
from ....core.config import settings
from ....core.database import get_db
from ....services.audit_service import record_action
from . import api as sup
from . import audios as audios_srv
from . import calidad as cal
from . import coaching as srv
from .alertas import ZONA
from .control_api import require_control
from .models import OPERATIVA, CierreDia, Coaching, CoachingAudio, CoachingItem

router = APIRouter(prefix="/televentas-claro/supervision", tags=["televentas-claro · mi día del supervisor"])

OBJETIVO_DEFECTO = 8
DIAS_CALIDAD = 7          # los feedback que se miran para «Calidad de mis feedback»
DIAS_ANIMO = 7            # el ánimo que ven los jefes
MESES_RACHA = 12         # la historia que se mira para las rachas (y sus récords)
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
    """Las devoluciones del rango: cada coaching (no anulado) en el que el supervisor cargó algo ese día (monitoreos o
    feedback, como sea que los haya marcado, o el seguimiento) cuenta como **un** feedback dado al asesor. Devuelve (supervisor, hora del
    último registro del día, el texto de la devolución: todo lo que cargó ese día en ese coaching, en orden)."""
    ini, fin = _limites(desde, hasta)
    q = (select(Coaching.supervisor_id, CoachingItem.coaching_id, CoachingItem.at, CoachingItem.texto)
         .join(Coaching, Coaching.id == CoachingItem.coaching_id)
         .where(Coaching.operativa == OPERATIVA, Coaching.estado != "anulado", CoachingItem.at >= ini, CoachingItem.at < fin)
         .order_by(CoachingItem.at))
    if supervisor_id:
        q = q.where(Coaching.supervisor_id == supervisor_id)
    filas = [(s, cid, a, t) for s, cid, a, t in (await db.execute(q)).all()]
    # El seguimiento registrado también es una devolución al asesor (con su comentario).
    qs = (select(Coaching.supervisor_id, Coaching.id, Coaching.seguimiento_at, Coaching.seguimiento_comentario)
          .where(Coaching.operativa == OPERATIVA, Coaching.estado != "anulado", Coaching.seguimiento_at >= ini, Coaching.seguimiento_at < fin))
    if supervisor_id:
        qs = qs.where(Coaching.supervisor_id == supervisor_id)
    filas += [(s, cid, a, t) for s, cid, a, t in (await db.execute(qs)).all()]
    grupos: dict[tuple[str, date], list[Any]] = {}
    for s, cid, a, t in sorted(filas, key=lambda x: _utc(x[2])):
        g = grupos.setdefault((cid, _dia(a)), [s, a, []])
        g[1] = a
        if (t or "").strip():
            g[2].append(t.strip())
    return [(s, a, "\n".join(ts)) for s, a, ts in grupos.values()]


async def conteos(db: AsyncSession, desde: date, hasta: date, supervisor_id: str | None = None) -> dict[str, Counter]:
    """Los feedback dados por día de cada supervisor (como `feedbacks`, sin los textos): {supervisor: {día: cantidad}}."""
    ini, fin = _limites(desde, hasta)
    vistos: set[tuple[str, date]] = set()
    out: dict[str, Counter] = defaultdict(Counter)
    qi = (select(Coaching.supervisor_id, CoachingItem.coaching_id, CoachingItem.at).join(Coaching, Coaching.id == CoachingItem.coaching_id)
          .where(Coaching.operativa == OPERATIVA, Coaching.estado != "anulado", CoachingItem.at >= ini, CoachingItem.at < fin))
    qs = (select(Coaching.supervisor_id, Coaching.id, Coaching.seguimiento_at)
          .where(Coaching.operativa == OPERATIVA, Coaching.estado != "anulado", Coaching.seguimiento_at >= ini, Coaching.seguimiento_at < fin))
    if supervisor_id:
        qi, qs = qi.where(Coaching.supervisor_id == supervisor_id), qs.where(Coaching.supervisor_id == supervisor_id)
    for q in (qi, qs):
        for sid, cid, a in (await db.execute(q)).all():
            k = (cid, _dia(a))
            if k not in vistos:
                vistos.add(k)
                out[sid][k[1]] += 1
    return out


def _pesos(p: dict[str, Any]) -> list[float]:
    return p.get("pesos_dia") or [1, 1, 1, 1, 1, 0.5, 0]


def _corridas(cumple: list[bool | None]) -> tuple[int, int]:
    """(racha actual, récord) de una serie del más viejo al más nuevo; None = no cuenta (sin meta o en curso)."""
    actual = record = 0
    for x in cumple:
        if x is None:
            continue
        actual = actual + 1 if x else 0
        record = max(record, actual)
    return actual, record


def rachas(por_dia: Counter, p: dict[str, Any], obj: int, hoy: date) -> dict[str, Any]:
    """Rachas del objetivo de feedback: **diaria** (días hábiles seguidos con el objetivo), **semanal** (semanas de lunes
    a domingo con la meta de la semana: el objetivo por los días hábiles, el sábado vale lo que vale en el calendario) y
    **mensual** (meses con la meta del mes). El período en curso suma si ya se cumplió; si todavía no, no corta la
    racha. Cada una con su récord de los últimos 12 meses y el avance del período en curso."""
    feriados = set(p.get("feriados") or [])
    pesos = _pesos(p)
    m0 = hoy.replace(day=1)
    for _ in range(MESES_RACHA):
        m0 = (m0 - timedelta(days=1)).replace(day=1)
    dias = [m0 + timedelta(days=k) for k in range((hoy - m0).days + 1)]

    def peso(d: date) -> float:
        return 0.0 if d.isoformat() in feriados else float(pesos[d.weekday()])

    def serie(grupos: dict[Any, list[date]], en_curso: Any) -> tuple[list[bool | None], dict[str, Any]]:
        out, actual = [], {}
        for k in sorted(grupos):
            ds = grupos[k]
            meta = round(obj * sum(peso(d) for d in ds))
            hechos = sum(por_dia.get(d, 0) for d in ds)
            if k == en_curso:
                actual = {"hechos": hechos, "meta": meta, "cumplido": bool(meta) and hechos >= meta}
                out.append(True if actual["cumplido"] else None)
            else:
                out.append(None if not meta else hechos >= meta)
        return out, actual

    # diaria
    diaria = [None if not peso(d) or (d == hoy and por_dia.get(d, 0) < obj) else por_dia.get(d, 0) >= obj for d in dias]
    d_act, d_rec = _corridas(diaria)
    # semanal (desde el primer lunes completo de la historia)
    lunes0 = m0 + timedelta(days=(7 - m0.weekday()) % 7)
    semanas: dict[date, list[date]] = defaultdict(list)
    for d in dias:
        if d >= lunes0:
            semanas[d - timedelta(days=d.weekday())].append(d)
    # la semana en curso se mide entera (con los días que faltan)
    lunes = hoy - timedelta(days=hoy.weekday())
    semanas[lunes] = [lunes + timedelta(days=k) for k in range(7)]
    s_serie, s_actual = serie(semanas, lunes)
    s_act, s_rec = _corridas(s_serie)
    # mensual
    meses: dict[str, list[date]] = defaultdict(list)
    for d in dias:
        meses[d.strftime("%Y-%m")].append(d)
    # el mes en curso se mide entero (con los días que faltan)
    fin_mes = (hoy.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    meses[hoy.strftime("%Y-%m")] = [hoy.replace(day=1) + timedelta(days=k) for k in range(fin_mes.day)]
    m_serie, m_actual = serie(meses, hoy.strftime("%Y-%m"))
    m_act, m_rec = _corridas(m_serie)
    return {
        "diaria": {"actual": d_act, "record": d_rec, "hoy": {"hechos": por_dia.get(hoy, 0), "meta": obj, "cumplido": por_dia.get(hoy, 0) >= obj}},
        "semanal": {"actual": s_act, "record": s_rec, "en_curso": s_actual},
        "mensual": {"actual": m_act, "record": m_rec, "en_curso": m_actual},
    }


def _utc(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _dia(d: datetime) -> date:
    return _utc(d).astimezone(ZONA).date()


def hitos(hechos: int, obj: int, con_cierre: bool) -> list[dict[str, Any]]:
    marcas = sorted({1, math.ceil(obj / 2), obj})
    nombres = {1: "Primer feedback", math.ceil(obj / 2): "Mitad del objetivo", obj: "Objetivo del día"}
    out = [{"clave": f"f{m}", "nombre": nombres[m], "meta": m, "logrado": hechos >= m} for m in marcas]
    out.append({"clave": "cierre", "nombre": "Cierre del día", "meta": None, "logrado": con_cierre, "extra": True})
    return out


def cierre_dict(c: CierreDia | None, audios: dict[str, CoachingAudio] | None = None) -> dict[str, Any] | None:
    if not c:
        return None
    au = audios or {}
    return {"id": c.id, "fecha": c.fecha.isoformat(), "resultados": c.resultados, "compromiso": c.compromiso,
            "como_termino": c.como_termino, "cumplio_anterior": c.cumplio_anterior, "feedbacks": c.feedbacks,
            "animo": c.animo or {}, "at": srv.iso(c.updated_at or c.created_at),
            "audios": {k: audios_srv.a_dict(au[i]) for k, i in (("resultados", c.audio_resultados_id), ("compromiso", c.audio_compromiso_id))
                       if i and i in au}}


async def _audios(db: AsyncSession, cierres: list[CierreDia | None]) -> dict[str, CoachingAudio]:
    ids = {i for c in cierres if c for i in (c.audio_resultados_id, c.audio_compromiso_id) if i}
    if not ids:
        return {}
    return {a.id: a for a in (await db.execute(select(CoachingAudio).where(CoachingAudio.id.in_(ids)))).scalars().all()}


async def _anterior(db: AsyncSession, sid: str, dia: date) -> CierreDia | None:
    """El último cierre antes de hoy (su compromiso es el que se evalúa hoy)."""
    return (await db.execute(select(CierreDia).where(CierreDia.supervisor_id == sid, CierreDia.fecha < dia)
                             .order_by(CierreDia.fecha.desc()).limit(1))).scalar_one_or_none()


async def mi_dia(db: AsyncSession, sid: str) -> dict[str, Any]:
    dia = sup.hoy()
    p = await sup.parametros(db)
    obj = objetivo(p)
    fbs = await feedbacks(db, dia - timedelta(days=DIAS_CALIDAD), dia, sid)
    por_dia = (await conteos(db, dia - timedelta(days=31 * (MESES_RACHA + 1)), dia, sid)).get(sid, Counter())
    hechos = por_dia.get(dia, 0)
    r = rachas(por_dia, p, obj, dia)
    hoy_c = (await db.execute(select(CierreDia).where(CierreDia.supervisor_id == sid, CierreDia.fecha == dia))).scalar_one_or_none()
    ant = await _anterior(db, sid, dia)
    textos = [t for _, a, t in sorted(fbs, key=lambda x: x[1], reverse=True) if _dia(a) > dia - timedelta(days=DIAS_CALIDAD)]
    ultimos = [{"texto": t[:220], "at": srv.iso(a), **{k: v for k, v in cal.evaluar_feedback(t).items() if k in ("puntaje", "nivel", "problema", "palabras")}}
               for _, a, t in sorted(fbs, key=lambda x: x[1], reverse=True)[:5]]
    return {
        "fecha": dia.isoformat(), "habil": _habil(dia, p), "objetivo": obj, "feedbacks": hechos,
        "puntos": min(hechos, obj) + (1 if hoy_c else 0), "puntos_max": obj + 1,
        "hitos": hitos(hechos, obj, bool(hoy_c)), "racha": r["diaria"]["actual"], "rachas": r,
        "semana": [{"dia": (dia - timedelta(days=k)).isoformat(), "feedbacks": por_dia.get(dia - timedelta(days=k), 0),
                    "habil": _habil(dia - timedelta(days=k), p)} for k in range(6, -1, -1)],
        "calidad": {**cal.resumen_calidad(textos), "dias": DIAS_CALIDAD, "ultimos": ultimos,
                    "criterios": cal.CRITERIOS, "reglas": {"min_palabras": cal.MIN_PALABRAS, "max_palabras": cal.MAX_PALABRAS}},
        "cierre": cierre_dict(hoy_c, await _audios(db, [hoy_c])),
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


@router.post("/portal/cierre/audios", status_code=status.HTTP_201_CREATED)
async def audio_cierre(request: Request, archivo: UploadFile = File(...), duracion: float = Form(...),
                       user: CurrentUser = Depends(sup.require_portal), db: AsyncSession = Depends(get_db)) -> dict:
    """Un audio dictado para el cierre del día: se guarda como registro (con su huella) y se transcribe en segundo plano,
    igual que los del coaching."""
    datos = await archivo.read(settings.transcripcion_max_mb * 1024 * 1024 + 1)
    try:
        a = await audios_srv.guardar(db, c=None, user_id=user.id, datos=datos, duracion_s=duracion, hablante="supervisor",
                                     destino="cierre", momento=srv.ahora())
    except audios_srv.AudioInvalido as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await db.commit()
    audios_srv.despertar()
    await record_action(db, user_id=user.id, action="cierre_audio", resource_type="cierre_dia", resource_id=a.id, ip=client_ip(request),
                        extra={"segundos": a.duracion_s, "bytes": a.bytes, "sha256": a.sha256})
    return audios_srv.a_dict(a)


async def _audio_cierre(db: AsyncSession, audio_id: str | None, user: CurrentUser, dia: date) -> CoachingAudio | None:
    """El audio tiene que ser del propio supervisor, del cierre (no de un coaching) y de hoy."""
    if not audio_id:
        return None
    a = await db.get(CoachingAudio, audio_id)
    if not a or a.supervisor_id != user.id or a.coaching_id is not None or a.destino != "cierre" or _dia(a.created_at) != dia:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ese audio no es de tu cierre de hoy")
    return a


class CierrePayload(BaseModel):
    resultados: str = Field("", max_length=2000)
    compromiso: str = Field("", max_length=1000)
    como_termino: Optional[Literal["bien", "normal", "dificil"]] = None
    cumplio_anterior: Optional[Literal["cumplido", "parcial", "no_cumplido"]] = None
    # Si lo dictó: el audio de cada campo. Con el audio, el texto puede llegar después (con la transcripción).
    audio_resultados_id: Optional[str] = Field(None, max_length=36)
    audio_compromiso_id: Optional[str] = Field(None, max_length=36)


@router.put("/portal/cierre")
async def guardar_cierre(payload: CierrePayload, request: Request, user: CurrentUser = Depends(sup.require_portal),
                         db: AsyncSession = Depends(get_db)) -> dict:
    """Carga (o corrige, el mismo día) el cierre: resultados, compromiso para mañana y cómo terminó el día."""
    resultados, compromiso = " ".join(payload.resultados.split()), " ".join(payload.compromiso.split())
    dia = sup.hoy()
    a_res = await _audio_cierre(db, payload.audio_resultados_id, user, dia)
    a_comp = await _audio_cierre(db, payload.audio_compromiso_id, user, dia)
    # Lo dictado y ya transcripto completa el campo si quedó vacío.
    if not resultados and a_res is not None and a_res.texto:
        resultados = " ".join(a_res.texto.split())
    if not compromiso and a_comp is not None and a_comp.texto:
        compromiso = " ".join(a_comp.texto.split())
    if len(resultados) < MIN_TEXTO and not (a_res is not None and not resultados):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Contá en una frase cómo te fue hoy (o dictalo)")
    if len(compromiso) < MIN_TEXTO and not (a_comp is not None and not compromiso):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Escribí o dictá tu compromiso para mañana")
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
    # Un audio nuevo reemplaza al anterior; sin audio nuevo, queda el que tenía.
    if a_res is not None:
        c.audio_resultados_id = a_res.id
    if a_comp is not None:
        c.audio_compromiso_id = a_comp.id
    c.updated_at = None if nuevo else srv.ahora()
    try:
        await db.commit()
    except IntegrityError as exc:       # el mismo cierre guardado dos veces a la vez
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya guardaste el cierre de hoy: actualizá la pantalla") from exc
    await record_action(db, user_id=user.id, action="cierre_dia" if nuevo else "cierre_dia_corregido", resource_type="cierre_dia",
                        resource_id=c.id, ip=client_ip(request),
                        extra={"fecha": dia.isoformat(), "feedbacks": hechos, "animo": animo["etiqueta"], "cumplio_anterior": c.cumplio_anterior,
                               "dictado": [k for k, a in (("resultados", a_res), ("compromiso", a_comp)) if a is not None]})
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
    historia = await conteos(db, fecha - timedelta(days=31 * (MESES_RACHA + 1)), fecha)
    del_dia = [x for d in por_sup.values() for x in d.values()]
    audios = await _audios(db, del_dia)
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
            "cierre": cierre_dict(c, audios), "anterior": cierre_dict(anterior),
            "animo": serie, "alerta": cal.alerta_animo(recientes),
            "rachas": rachas(historia.get(sid, Counter()), p, obj, fecha),
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
