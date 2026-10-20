"""Clima del equipo — Televentas Claro: la moral de cada supervisor (el líder) y de su equipo, día por día.

Se arma con lo que ya se registra (nada nuevo para cargar, salvo el termómetro de un toque):

- **Líder:** lo que eligió (el termómetro «¿Cómo vas?» de mitad del día y cómo terminó en el cierre, que pesa doble) y
  lo que se lee en el texto de su cierre. **Ánimo** (−100 a 100) = 0,6 · lo elegido + 0,4 · el texto. **Compromiso**
  (0 a 100): devoluciones contra el objetivo del día (30), calidad del feedback y revisión del jefe (20), cumplió el
  compromiso de ayer (20), devoluciones firmadas a tiempo (15) y cargó el cierre (15).
- **Equipo** (los asesores, siempre agregados por equipo: nunca uno por uno): lo que dijo cada asesor al firmar y los
  compromisos que dictó, y el tono de las devoluciones que recibió (reconocimiento, constructivo, crítico). **Ánimo** =
  0,6 · la voz de los asesores + 0,4 · el tono recibido. **Compromiso**: compromisos cumplidos en los seguimientos (35),
  coachings con un compromiso dicho por el asesor (25), aceptó y firmó (25) y comentarios propositivos (15).
- Los componentes sin datos ese día no cuentan (se reparte el peso entre los que hay).
- **Estado:** animado (ánimo ≥ 20 y compromiso ≥ 60), comprometido (compromiso ≥ 60), cansado (compromiso ≥ 60 con
  ánimo ≤ −20: «comprometido pero cansado»), desanimado (ánimo ≤ −20, o compromiso < 40 con ánimo ≤ 0) y neutro.
- **Medición:** al instante con reglas (`calidad.py`) y de noche con Claude (Haiku): relee los textos del día sin nombres
  (S1, A1… y sin teléfonos ni correos) y devuelve sentimiento, emoción, intensidad, tono, riesgo y por qué de cada uno.
  Cuando está, reemplaza la lectura por reglas de ese texto.
- **Foto del día** (`ClimaDia`): el día en curso se recalcula; los anteriores quedan guardados y se recalculan si llega
  el análisis de esa noche. Al arrancar se completa la historia.
- **Alertas** (en el centro de comandos, solo para quienes ven el clima): alta, media y «para mirar», con la evidencia.
  Mientras se calibra se abren solo las altas (`clima_alertas` en los parámetros); los jefes marcan si fue útil.
"""
from __future__ import annotations

import asyncio
import json
import logging
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ....core.config import settings
from ....core.database import AsyncSessionLocal
from . import analisis as an
from . import api as sup
from . import calidad as cal
from . import coaching as srv
from . import comando as cmd
from .alertas import ZONA, dia_local
from .mi_dia_api import _habil, devoluciones, objetivo
from .models import (
    OPERATIVA, AlertaComando, CierreDia, ClimaDia, ClimaIA, Coaching, CoachingAudio, CoachingCompromiso, CoachingEvento,
    CoachingFirma, Operador, PulsoDia,
)

logger = logging.getLogger(__name__)

ESTADOS = ("animado", "comprometido", "neutro", "cansado", "desanimado")
HORA_DESDE, HORA_HASTA = 8, 20           # la curva del día
HORA_TARDE = 17                          # devoluciones cargadas desde esta hora: «todo a último momento»
DIAS_HISTORIA = 90                       # lo que se completa al arrancar
MAX_DIAS = 92                            # rango máximo de la vista
INTERVALO = 600                          # el worker: cada 10 minutos
POR_PEDIDO = 120                         # textos por pedido a Claude
MAX_TEXTO_IA = 500
MAX_INTENTOS = 2
RESULTADO = {"cumplido": 1.0, "parcial": 0.5, "no_cumplido": 0.0}
RESULTADO_COACHING = {"mejoro": 1.0, "igual": 0.5, "empeoro": 0.0}
NIVELES = {"alta": 0, "media": 1, "todas": 2}
_lock = asyncio.Lock()
_completos: set[date] = set()            # días anteriores ya calculados después de terminar (en esta ejecución)


def _utc(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _hora(d: datetime) -> float:
    local = _utc(d).astimezone(ZONA)
    return round(local.hour + local.minute / 60, 2)


def _limites(desde: date, hasta: date) -> tuple[datetime, datetime]:
    ini = datetime.combine(desde, time.min, tzinfo=ZONA).astimezone(timezone.utc)
    fin = datetime.combine(hasta + timedelta(days=1), time.min, tzinfo=ZONA).astimezone(timezone.utc)
    return ini, fin


def _media(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def _pond(partes: list[tuple[float | None, float]]) -> float | None:
    """Promedio ponderado entre los componentes que tienen dato."""
    ps = [(v, w) for v, w in partes if v is not None]
    tot = sum(w for _, w in ps)
    return sum(v * w for v, w in ps) / tot if tot else None


def _r(x: float | None, k: float = 100) -> float | None:
    return None if x is None else round(x * k, 1)


def estado(animo: float | None, compromiso: float | None) -> str:
    if animo is None and compromiso is None:
        return "sin_datos"
    a = 0.0 if animo is None else animo
    c = 50.0 if compromiso is None else compromiso
    if c >= 60 and a <= -20:
        return "cansado"
    if a <= -20 or (c < 40 and a <= 0):
        return "desanimado"
    if a >= 20 and c >= 60:
        return "animado"
    if c >= 60:
        return "comprometido"
    return "neutro"


# ------------------------------------------------------------------ las señales de un día
@dataclass
class Dia:
    sid: str
    fecha: date
    devoluciones: list[dict[str, Any]] = field(default_factory=list)   # {cid, at, inicio, texto}
    cierre: Optional[CierreDia] = None
    pulsos: list[tuple[datetime, str]] = field(default_factory=list)
    voces: list[dict[str, Any]] = field(default_factory=list)          # {clave, at, texto, operador_id, fuente}
    compromisos: list[dict[str, Any]] = field(default_factory=list)    # creados ese día: {cid, origen}
    resultados: list[float] = field(default_factory=list)              # compromisos evaluados en los seguimientos
    firmados: list[bool] = field(default_factory=list)                 # devoluciones firmadas: ¿a tiempo?
    aceptados: list[bool] = field(default_factory=list)                # firmas del asesor: ¿aceptó los compromisos?
    revisiones: list[str] = field(default_factory=list)                # revisiones del jefe: bien | mejorar

    def vacio(self) -> bool:
        return not (self.devoluciones or self.cierre or self.pulsos or self.voces or self.compromisos or self.resultados
                    or self.firmados)


async def cargar(db: AsyncSession, desde: date, hasta: date, p: dict[str, Any]) -> dict[tuple[str, date], Dia]:
    """Todas las señales del rango, por supervisor y día (pocas consultas para todo el rango)."""
    ini, fin = _limites(desde, hasta)
    dias: dict[tuple[str, date], Dia] = {}

    def dia(sid: str, f: date) -> Dia:
        return dias.setdefault((sid, f), Dia(sid, f))

    for d in await devoluciones(db, desde, hasta):
        dia(d["sid"], d["dia"]).devoluciones.append(d)
    for c in (await db.execute(select(CierreDia).where(CierreDia.operativa == OPERATIVA, CierreDia.fecha >= desde,
                                                       CierreDia.fecha <= hasta))).scalars().all():
        dia(c.supervisor_id, c.fecha).cierre = c
    for x in (await db.execute(select(PulsoDia).where(PulsoDia.operativa == OPERATIVA, PulsoDia.fecha >= desde,
                                                      PulsoDia.fecha <= hasta).order_by(PulsoDia.at))).scalars().all():
        dia(x.supervisor_id, x.fecha).pulsos.append((x.at, x.valor))
    vivo = (Coaching.operativa == OPERATIVA, Coaching.estado != "anulado")
    # Lo que dijo el asesor al firmar (escrito o dictado) y si aceptó los compromisos.
    firmas = (await db.execute(select(CoachingFirma, Coaching.supervisor_id, Coaching.operador_id)
                               .join(Coaching, Coaching.id == CoachingFirma.coaching_id)
                               .where(*vivo, CoachingFirma.firmante == "asesor", CoachingFirma.firmado_at >= ini,
                                      CoachingFirma.firmado_at < fin))).all()
    sin_texto = {f.comentario_audio_id for f, _, _ in firmas if not (f.comentario or "").strip() and f.comentario_audio_id}
    textos_audio = {a.id: a.texto for a in (await db.execute(select(CoachingAudio).where(CoachingAudio.id.in_(sin_texto)))).scalars().all()} \
        if sin_texto else {}
    for f, sid, op in firmas:
        d = dia(sid, dia_local(f.firmado_at))
        d.aceptados.append(bool(f.acepto))
        texto = (f.comentario or "").strip() or (textos_audio.get(f.comentario_audio_id or "") or "").strip()
        if texto:
            d.voces.append({"clave": f"v:{f.id}", "at": f.firmado_at, "texto": texto, "operador_id": op, "fuente": "firma"})
    # Los compromisos creados (los que dictó el asesor son su voz).
    for k, sid, op in (await db.execute(select(CoachingCompromiso, Coaching.supervisor_id, Coaching.operador_id)
                                        .join(Coaching, Coaching.id == CoachingCompromiso.coaching_id)
                                        .where(*vivo, CoachingCompromiso.created_at >= ini, CoachingCompromiso.created_at < fin))).all():
        d = dia(sid, dia_local(k.created_at))
        d.compromisos.append({"cid": k.coaching_id, "origen": k.origen})
        if k.origen == "asesor" and (k.texto or "").strip():
            d.voces.append({"clave": f"k:{k.id}", "at": k.created_at, "texto": k.texto.strip(), "operador_id": op,
                            "fuente": "compromiso"})
    # Seguimientos: cómo quedaron los compromisos (o el resultado del coaching, si no se evaluó cada uno).
    segs = list((await db.execute(select(Coaching).where(*vivo, Coaching.seguimiento_at >= ini, Coaching.seguimiento_at < fin))).scalars().all())
    if segs:
        evaluados: dict[str, list[float]] = defaultdict(list)
        for k in (await db.execute(select(CoachingCompromiso).where(CoachingCompromiso.coaching_id.in_([c.id for c in segs]),
                                                                    CoachingCompromiso.resultado.is_not(None)))).scalars().all():
            if k.resultado in RESULTADO:
                evaluados[k.coaching_id].append(RESULTADO[k.resultado])
        for c in segs:
            vals = evaluados.get(c.id) or ([RESULTADO_COACHING[c.resultado]] if c.resultado in RESULTADO_COACHING else [])
            dia(c.supervisor_id, dia_local(c.seguimiento_at)).resultados.extend(vals)
    # Devoluciones firmadas: ¿dentro del plazo?
    for c in (await db.execute(select(Coaching).where(*vivo, Coaching.firmado_at >= ini, Coaching.firmado_at < fin))).scalars().all():
        f = dia_local(c.firmado_at)
        dia(c.supervisor_id, f).firmados.append(f <= srv.vence_devolucion(c, p))
    # Revisiones del jefe sobre los coachings del supervisor.
    for e, sid in (await db.execute(select(CoachingEvento, Coaching.supervisor_id).join(Coaching, Coaching.id == CoachingEvento.coaching_id)
                                    .where(Coaching.operativa == OPERATIVA, CoachingEvento.tipo == "revision",
                                           CoachingEvento.at >= ini, CoachingEvento.at < fin))).all():
        v = (e.datos or {}).get("valoracion")
        if v in ("bien", "mejorar"):
            dia(sid, dia_local(e.at)).revisiones.append(v)
    return {k: d for k, d in dias.items() if not d.vacio()}


# ------------------------------------------------------------------ el cálculo
def avance_del_dia(fecha: date, momento: datetime) -> float:
    """Cuánto del día laboral pasó (8 a 18 h): para no pedir el objetivo entero a las 10 de la mañana."""
    hoy = _utc(momento).astimezone(ZONA)
    if fecha < hoy.date():
        return 1.0
    return max(0.1, min(1.0, (hoy.hour + hoy.minute / 60 - 8) / 10))


def calcular(d: Dia, *, obj: int, ia: dict[str, Any], avance: float, habil: bool = True) -> dict[str, Any]:
    """El clima de un supervisor en un día: líder y equipo (ánimo, compromiso, estado), los puntos de la curva y las
    señales para las alertas. No guarda textos de los asesores (solo números, la hora y las palabras de riesgo). En un
    día no hábil no se le piden devoluciones ni cierre."""
    cerrado = avance >= 1.0
    # --- líder: lo que eligió y lo que dice su cierre
    elegidos = [cal.ANIMO_PESO[v] for _, v in d.pulsos if v in cal.ANIMO_PESO]
    c = d.cierre
    texto_l, riesgo_l, extracto, etiqueta = None, [], None, None
    if c is not None:
        if c.como_termino in cal.ANIMO_PESO:
            elegidos += [cal.ANIMO_PESO[c.como_termino]] * 2
        texto = f"{c.resultados}. {c.compromiso}".strip(". ")
        x = ia.get(f"c:{c.id}")
        if x:
            texto_l = x["sentimiento"] / 100
        elif texto:
            texto_l = (c.animo or {}).get("texto", cal.detectar_animo(texto)["texto"])
        riesgo_l = cal.riesgos(texto) + (["señal de riesgo (IA)"] if x and x.get("riesgo") else [])
        extracto = (c.resultados or "")[:160] or None
        etiqueta = (c.animo or {}).get("etiqueta")
    elegido = _media(elegidos)
    animo_l = _pond([(elegido, 0.6), (texto_l, 0.4)])
    n_fb = len(d.devoluciones)
    textos_fb = [x["texto"] for x in d.devoluciones if (x["texto"] or "").strip()]
    calidad_fb = cal.resumen_calidad(textos_fb) if textos_fb else None
    rev = _media([1.0 if v == "bien" else 0.4 for v in d.revisiones])
    calidad = _media([v for v in ((calidad_fb["puntaje"] / 100) if calidad_fb else None, rev) if v is not None])
    meta = max(1.0, obj * avance)
    comp_l_partes = {
        "feedback": (min(1.0, n_fb / meta) if habil or n_fb else None, 30),
        "calidad": (calidad, 20),
        "compromiso_anterior": (RESULTADO.get(c.cumplio_anterior) if c is not None and c.cumplio_anterior else None, 20),
        "a_tiempo": (_media([1.0 if x else 0.0 for x in d.firmados]), 15),
        "cierre": (1.0 if c is not None else (0.0 if cerrado and habil else None), 15),
    }
    compromiso_l = _pond(list(comp_l_partes.values()))
    # --- equipo: la voz de los asesores y el tono de lo que recibieron
    voces = []
    for v in d.voces:
        x = ia.get(v["clave"])
        lex = cal.voz_asesor(v["texto"])
        voces.append({"h": _hora(v["at"]), "pol": x["sentimiento"] / 100 if x else lex["polaridad"],
                      "riesgo": lex["riesgo"] + (["señal de riesgo (IA)"] if x and x.get("riesgo") and not lex["riesgo"] else []),
                      "propositivo": lex["propositivo"], "operador_id": v["operador_id"], "fuente": v["fuente"]})
    puntos_fb = []
    for x in d.devoluciones:
        r = ia.get(f"f:{x['cid']}:{d.fecha.isoformat()}")
        tono = r["tono"] if r and r.get("tono") in cal.TONOS else cal.tono_feedback(x["texto"])
        puntos_fb.append({"h": _hora(x["at"]), "tono": tono, "corto": len(cal._PALABRA.findall(x["texto"] or "")) < cal.MIN_PALABRAS})
    tonos = Counter(p["tono"] for p in puntos_fb if p["tono"])
    voz = _media([v["pol"] for v in voces])
    tono_v = _media([cal.TONO_VALOR[t] for t in tonos.elements()])
    animo_e = _pond([(voz, 0.6), (tono_v, 0.4)])
    por_coaching: dict[str, bool] = defaultdict(bool)
    for k in d.compromisos:
        por_coaching[k["cid"]] |= k["origen"] == "asesor"
    firmas_txt = [v for v in voces if v["fuente"] == "firma"]
    comp_e_partes = {
        "cumplidos": (_media(d.resultados), 35),
        "dicho_por_asesor": (_media([1.0 if x else 0.0 for x in por_coaching.values()]), 25),
        "aceptado": (_media([1.0 if x else 0.0 for x in d.aceptados]), 25),
        "propositivo": (_media([1.0 if v["propositivo"] else 0.0 for v in firmas_txt]), 15),
    }
    compromiso_e = _pond(list(comp_e_partes.values()))
    # El equipo sin voz ni devoluciones ese día no tiene ánimo medido (ni estado).
    lider = {"animo": _r(animo_l), "compromiso": _r(compromiso_l), "elegido": _r(elegido), "detectado": _r(texto_l),
             "componentes": {k: _r(v) for k, (v, _) in comp_l_partes.items()}}
    lider["estado"] = estado(lider["animo"], lider["compromiso"])
    equipo = {"animo": _r(animo_e), "compromiso": _r(compromiso_e), "voces": len(voces), "tonos": dict(tonos),
              "componentes": {k: _r(v) for k, (v, _) in comp_e_partes.items()}}
    equipo["estado"] = estado(equipo["animo"], equipo["compromiso"]) if (voces or tonos or d.resultados or d.aceptados) else "sin_datos"
    negativos = {v["operador_id"] for v in voces if v["pol"] <= -0.3}
    riesgos = [{"fuente": "lider", "palabra": w} for w in dict.fromkeys(riesgo_l)]
    riesgos += [{"fuente": v["fuente"], "palabra": w, "h": v["h"]} for v in voces for w in v["riesgo"]]
    horas_fb = [p["h"] for p in puntos_fb]
    return {
        "lider": lider, "equipo": equipo, "feedbacks": n_fb, "objetivo": obj, "cierre": c is not None,
        "puntos": {
            "feedback": [{"h": p["h"], "tono": p["tono"]} for p in puntos_fb],
            "voz": [{"h": v["h"], "pol": round(v["pol"], 2)} for v in voces],
            "pulsos": [{"h": _hora(at), "valor": v} for at, v in d.pulsos],
            "cierre": ({"h": _hora(c.updated_at or c.created_at), "valor": c.como_termino, "texto": _r(texto_l)}
                       if c is not None and (c.updated_at or c.created_at) else None),
        },
        "senales": {
            "riesgos": riesgos, "asesores_negativos": len(negativos), "cierre_etiqueta": etiqueta, "cierre_extracto": extracto,
            "mixto": etiqueta == "mixto" or bool(elegido is not None and elegido > 0 and texto_l is not None and texto_l < -0.3),
            "cumplio_anterior": c.cumplio_anterior if c is not None else None,
            "critico_pct": round(tonos["critico"] / sum(tonos.values()), 2) if sum(tonos.values()) >= 3 else None,
            "cortos_pct": round(sum(1 for p in puntos_fb if p["corto"]) / n_fb, 2) if n_fb else None,
            "tarde_pct": round(sum(1 for h in horas_fb if h >= HORA_TARDE) / n_fb, 2) if n_fb else None,
            "compromisos": len(d.compromisos), "compromisos_asesor": sum(1 for k in d.compromisos if k["origen"] == "asesor"),
        },
    }


# ------------------------------------------------------------------ fotos del día (ClimaDia)
def _fin_dia(f: date) -> datetime:
    return datetime.combine(f + timedelta(days=1), time.min, tzinfo=ZONA).astimezone(timezone.utc)


async def _ias(db: AsyncSession, desde: date, hasta: date) -> dict[date, ClimaIA]:
    return {x.fecha: x for x in (await db.execute(select(ClimaIA).where(ClimaIA.operativa == OPERATIVA, ClimaIA.fecha >= desde,
                                                                        ClimaIA.fecha <= hasta, ClimaIA.estado == "listo"))).scalars().all()}


async def actualizar(db: AsyncSession, desde: date, hasta: date, *, p: dict[str, Any], hoy: date, momento: datetime,
                     forzar: bool = False) -> dict[tuple[str, date], ClimaDia]:
    """Las fotos del rango, al día: recalcula hoy, los días sin foto, los que se calcularon antes de terminar y los que
    tienen un análisis con IA más nuevo. Devuelve {(supervisor, día): foto}."""
    hasta = min(hasta, hoy)
    async with _lock:
        filas = list((await db.execute(select(ClimaDia).where(ClimaDia.operativa == OPERATIVA, ClimaDia.fecha >= desde,
                                                              ClimaDia.fecha <= hasta))).scalars().all())
        por_dia: dict[date, list[ClimaDia]] = defaultdict(list)
        for x in filas:
            por_dia[x.fecha].append(x)
        ias = await _ias(db, desde, hasta)
        recalcular = []
        f = desde
        while f <= hasta:
            xs = por_dia.get(f, [])
            calc = min((_utc(x.calculado_at) for x in xs), default=None)
            ia = ias.get(f)
            if (forzar or f >= hoy or f not in _completos and (calc is None or calc < _fin_dia(f))
                    or (ia and ia.terminado_at and (calc is None or _utc(ia.terminado_at) > calc))):
                recalcular.append(f)
            f += timedelta(days=1)
        if recalcular:
            obj = objetivo(p)
            senales = await cargar(db, min(recalcular), max(recalcular), p)
            existentes = {(x.supervisor_id, x.fecha): x for x in filas}
            quedan = set()
            for (sid, f), d in senales.items():
                if f not in recalcular:
                    continue
                ia = ias.get(f)
                r = calcular(d, obj=obj, ia=(ia.resultados or {}) if ia else {}, avance=avance_del_dia(f, momento), habil=_habil(f, p))
                x = existentes.get((sid, f))
                if x is None:
                    x = ClimaDia(operativa=OPERATIVA, supervisor_id=sid, fecha=f)
                    db.add(x)
                    existentes[(sid, f)] = x
                x.lider_animo, x.lider_compromiso, x.lider_estado = r["lider"]["animo"], r["lider"]["compromiso"], r["lider"]["estado"]
                x.equipo_animo, x.equipo_compromiso, x.equipo_estado = r["equipo"]["animo"], r["equipo"]["compromiso"], r["equipo"]["estado"]
                x.datos, x.con_ia, x.calculado_at = r, ia is not None, momento
                quedan.add((sid, f))
            for k, x in list(existentes.items()):
                if k[1] in recalcular and k not in quedan:    # ya no tiene señales (p. ej. se anuló el coaching)
                    await db.delete(x)
                    existentes.pop(k)
            try:
                await db.commit()
            except IntegrityError:          # otro proceso guardó la misma foto a la vez: se lee la suya
                await db.rollback()
                return {(x.supervisor_id, x.fecha): x for x in (await db.execute(select(ClimaDia).where(
                    ClimaDia.operativa == OPERATIVA, ClimaDia.fecha >= desde, ClimaDia.fecha <= hasta))).scalars().all()}
            _completos.update(f for f in recalcular if momento >= _fin_dia(f))
            return existentes
        return {(x.supervisor_id, x.fecha): x for x in filas}


# ------------------------------------------------------------------ alertas
def _pl(k: int, uno: str, varios: str) -> str:
    return f"{k} {uno if k == 1 else varios}"


def _dm(d: date) -> str:
    return d.strftime("%d/%m")


def _hm(h: float | None) -> str:
    return "" if h is None else f" ({int(h):02d}:{int(round((h % 1) * 60)) % 60:02d})"


FUENTE = {"firma": "al firmar", "compromiso": "en un compromiso dictado", "lider": "en su cierre del día"}


def condiciones(fotos: dict[tuple[str, date], ClimaDia], *, hoy: date, p: dict[str, Any], nombres: dict[str, str]) -> dict[tuple[str, str], dict[str, Any]]:
    """Las alertas del clima que hoy piden atención. Las de un día (palabras de riesgo, caída, feedback crítico, equipo
    desanimado, «para mirar») se miran en los últimos 3 días; las de estado (dos cierres negativos, cansancio, días sin
    cierre, compromiso sin cumplir, asesores sin voz), con lo último que hay."""
    nivel = NIVELES.get(p.get("clima_alertas") or "alta", 0)
    out: dict[tuple[str, str], dict[str, Any]] = {}
    por_sid: dict[str, dict[date, ClimaDia]] = defaultdict(dict)
    for (sid, f), x in fotos.items():
        por_sid[sid][f] = x

    def add(tipo: str, clave: str, sid: str, titulo: str, detalle: str, f: date | None = None, **datos: Any) -> None:
        if cmd.TIPOS[tipo][0] > nivel:
            return
        out[(tipo, clave)] = cmd._cond(tipo, clave, titulo, detalle, supervisor_id=sid,
                                       desde=cmd._medianoche(f) if f else None, **datos)

    recientes = [hoy - timedelta(days=k) for k in range(3)]
    for sid, dias in por_sid.items():
        quien = nombres.get(sid, "—")
        orden = sorted(dias)
        for f in recientes:
            x = dias.get(f)
            if not x:
                continue
            s = (x.datos or {}).get("senales") or {}
            cuando = "hoy" if f == hoy else f"el {_dm(f)}"
            # Palabras de riesgo (alta): del líder o de algún asesor del equipo (sin decir quién).
            rs = s.get("riesgos") or []
            if rs:
                del_lider = [r for r in rs if r["fuente"] == "lider"]
                partes = []
                if del_lider:
                    partes.append(f"En su cierre del día: «{', '.join(r['palabra'] for r in del_lider)}»"
                                  + (f". Escribió: «{s.get('cierre_extracto')}»" if s.get("cierre_extracto") else ""))
                for r in [r for r in rs if r["fuente"] != "lider"][:4]:
                    partes.append(f"Un asesor del equipo {FUENTE.get(r['fuente'], '')}: «{r['palabra']}»{_hm(r.get('h'))}")
                add("clima_riesgo", f"{sid}:{f.isoformat()}", sid, f"Palabras de riesgo · {quien}",
                    f"{cuando.capitalize()}. " + ". ".join(partes) + ". Conviene una charla en privado.", f,
                    palabras=[r["palabra"] for r in rs][:8])
            # Caída repentina contra el promedio de los 7 días anteriores (media).
            for lado, campo in (("del líder", "lider_animo"), ("del equipo", "equipo_animo")):
                v = getattr(x, campo)
                prev = [getattr(dias[g], campo) for g in orden if f - timedelta(days=7) <= g < f and getattr(dias[g], campo) is not None]
                if v is not None and len(prev) >= 3 and statistics.mean(prev) - v >= 35:
                    add("clima_caida", f"{sid}:{campo}:{f.isoformat()}", sid, f"Bajó el ánimo {lado} · {quien}",
                        f"{cuando.capitalize()}: {v:+.0f}, contra {statistics.mean(prev):+.0f} de promedio en los 7 días anteriores.", f,
                        valor=v, promedio=round(statistics.mean(prev), 1))
            if s.get("critico_pct") is not None and s["critico_pct"] > 0.6:
                t = (x.datos or {}).get("equipo", {}).get("tonos", {})
                add("clima_critico", f"{sid}:{f.isoformat()}", sid, f"Feedback muy crítico · {quien}",
                    f"{cuando.capitalize()}: {t.get('critico', 0)} de {sum(t.values())} devoluciones con tono crítico (sin reconocer nada "
                    "ni proponer cómo). El equipo lo siente.", f, critico_pct=s["critico_pct"])
            if (s.get("asesores_negativos") or 0) >= 2:
                add("clima_equipo", f"{sid}:{f.isoformat()}", sid, f"Equipo desanimado · {quien}",
                    f"{cuando.capitalize()}: {s['asesores_negativos']} asesores del equipo con comentarios o compromisos negativos el mismo día.",
                    f, asesores=s["asesores_negativos"])
            if s.get("mixto"):
                add("clima_mixto", f"{sid}:{f.isoformat()}", sid, f"Dice que está bien, el texto no · {quien}",
                    f"{cuando.capitalize()} eligió que el día terminó bien, pero lo que escribió suena negativo"
                    + (f": «{s.get('cierre_extracto')}»." if s.get("cierre_extracto") else "."), f)
            n_fb = (x.datos or {}).get("feedbacks", 0)
            if n_fb >= 4 and f < hoy and ((s.get("cortos_pct") or 0) >= 0.5 or (s.get("tarde_pct") or 0) >= 1.0):
                motivo = (f"{round(s['cortos_pct'] * 100)}% de sus devoluciones son muy cortas" if (s.get("cortos_pct") or 0) >= 0.5
                          else f"cargó todas sus devoluciones después de las {HORA_TARDE} h")
                add("clima_cumplir", f"{sid}:{f.isoformat()}", sid, f"¿Cumplir por cumplir? · {quien}",
                    f"El {_dm(f)} {motivo} ({_pl(n_fb, 'devolución', 'devoluciones')}).", f)
        # --- estado: con lo último que hay
        con_cierre = [dias[g] for g in orden if (dias[g].datos or {}).get("cierre")]
        etiquetas = [(c.datos.get("senales") or {}).get("cierre_etiqueta") for c in con_cierre]
        if len(etiquetas) >= 2 and etiquetas[-1] == etiquetas[-2] == "negativo" and con_cierre[-1].fecha >= hoy - timedelta(days=3):
            add("clima_negativos", sid, sid, f"Dos cierres seguidos negativos · {quien}",
                f"Los cierres del {_dm(con_cierre[-2].fecha)} y del {_dm(con_cierre[-1].fecha)} con ánimo negativo"
                + (f". El último: «{(con_cierre[-1].datos.get('senales') or {}).get('cierre_extracto')}»."
                   if (con_cierre[-1].datos.get("senales") or {}).get("cierre_extracto") else "."))
        ultimos = [dias[g] for g in orden if g > hoy - timedelta(days=8) and dias[g].lider_estado != "sin_datos"][-5:]
        cansados = [x for x in ultimos if x.lider_estado == "cansado"]
        if len(cansados) >= 3:
            add("clima_cansado", sid, sid, f"Comprometido pero cansado · {quien}",
                f"Cumple (compromiso alto) pero con ánimo bajo en {len(cansados)} de sus últimos {len(ultimos)} días "
                f"({', '.join(_dm(x.fecha) for x in cansados)}). Riesgo de desgaste.")
        anteriores = [c for c in con_cierre if c.fecha >= hoy - timedelta(days=10)]
        if len(anteriores) >= 2 and all((c.datos.get("senales") or {}).get("cumplio_anterior") == "no_cumplido" for c in anteriores[-2:]):
            add("clima_compromiso", sid, sid, f"Compromiso propio sin cumplir dos veces · {quien}",
                f"En los cierres del {_dm(anteriores[-2].fecha)} y del {_dm(anteriores[-1].fecha)} dijo que no cumplió su compromiso anterior.")
        # Dos días hábiles con devoluciones y sin cierre (antes de hoy).
        habiles: list[date] = []
        g = hoy - timedelta(days=1)
        while len(habiles) < 2 and g > hoy - timedelta(days=10):
            if _habil(g, p):
                habiles.append(g)
            g -= timedelta(days=1)
        if len(habiles) == 2 and all(h in dias and (dias[h].datos or {}).get("feedbacks") and not (dias[h].datos or {}).get("cierre")
                                     for h in habiles):
            add("clima_sin_cierre", f"{sid}:{habiles[0].isoformat()}", sid, f"Sin cierre del día · {quien}",
                f"Trabajó el {_dm(habiles[1])} y el {_dm(habiles[0])} (cargó devoluciones) y no cerró ninguno de los dos días.")
        semana = [dias[g] for g in orden if g > hoy - timedelta(days=7)]
        total = sum((x.datos.get("senales") or {}).get("compromisos", 0) for x in semana)
        del_asesor = sum((x.datos.get("senales") or {}).get("compromisos_asesor", 0) for x in semana)
        if total >= 3 and del_asesor == 0:
            lunes = hoy - timedelta(days=hoy.weekday())
            add("clima_sin_voz", f"{sid}:{lunes.isoformat()}", sid, f"Asesores sin compromisos propios · {quien}",
                f"{_pl(total, 'compromiso', 'compromisos')} en la semana y ninguno lo dijo el asesor: los escribe todos el supervisor.")
    return out


async def sincronizar_alertas(db: AsyncSession, fotos: dict[tuple[str, date], ClimaDia], *, hoy: date, p: dict[str, Any],
                              momento: datetime) -> int:
    nombres = await sup._nombres(db, {sid for sid, _ in fotos})
    return await cmd.sincronizar(db, condiciones(fotos, hoy=hoy, p=p, nombres=nombres), momento, clima=True)


async def al_dia(db: AsyncSession, *, hoy: date | None = None, momento: datetime | None = None) -> dict[tuple[str, date], ClimaDia]:
    """Las fotos de los últimos días al día y las alertas sincronizadas (lo que hace el worker cada 10 minutos)."""
    hoy, momento = hoy or sup.hoy(), momento or srv.ahora()
    p = await sup.parametros(db)
    fotos = await actualizar(db, hoy - timedelta(days=13), hoy, p=p, hoy=hoy, momento=momento)
    await sincronizar_alertas(db, fotos, hoy=hoy, p=p, momento=momento)
    return fotos


# ------------------------------------------------------------------ la vista
def _prom(xs: list[float | None]) -> float | None:
    v = [x for x in xs if x is not None]
    return round(sum(v) / len(v), 1) if v else None


def curva(fotos: list[ClimaDia]) -> list[dict[str, Any]]:
    """Cómo fluctuó el día, hora por hora: el ánimo del equipo (la voz de los asesores y el tono de lo que recibieron,
    acumulado hasta esa hora) y el de los líderes (termómetro y cierre)."""
    voz, tono, elegido, texto = [], [], [], []
    for x in fotos:
        pts = (x.datos or {}).get("puntos") or {}
        voz += [(v["h"], v["pol"]) for v in pts.get("voz", [])]
        tono += [(v["h"], cal.TONO_VALOR[v["tono"]]) for v in pts.get("feedback", []) if v.get("tono") in cal.TONO_VALOR]
        elegido += [(v["h"], cal.ANIMO_PESO[v["valor"]]) for v in pts.get("pulsos", []) if v.get("valor") in cal.ANIMO_PESO]
        ci = pts.get("cierre")
        if ci:
            if ci.get("valor") in cal.ANIMO_PESO:
                elegido += [(ci["h"], cal.ANIMO_PESO[ci["valor"]])] * 2
            if ci.get("texto") is not None:
                texto.append((ci["h"], ci["texto"] / 100))
    out = []
    for h in range(HORA_DESDE, HORA_HASTA + 1):
        hasta = h + 1
        eq = _pond([(_media([v for t, v in voz if t < hasta]), 0.6), (_media([v for t, v in tono if t < hasta]), 0.4)])
        li = _pond([(_media([v for t, v in elegido if t < hasta]), 0.6), (_media([v for t, v in texto if t < hasta]), 0.4)])
        out.append({"hora": h, "equipo": _r(eq), "lideres": _r(li),
                    "feedback": sum(1 for x in fotos for v in ((x.datos or {}).get("puntos") or {}).get("feedback", []) if h <= v["h"] < hasta)})
    return out


def _agregado(xs: list[ClimaDia], lado: str) -> dict[str, Any]:
    a = _prom([getattr(x, f"{lado}_animo") for x in xs])
    c = _prom([getattr(x, f"{lado}_compromiso") for x in xs])
    return {"animo": a, "compromiso": c, "estado": estado(a, c), "dias": sum(1 for x in xs if getattr(x, f"{lado}_estado") != "sin_datos")}


def vista(fotos: dict[tuple[str, date], ClimaDia], *, desde: date, hasta: date, hoy: date, supervisores: dict[str, dict[str, Any]],
          nombres: dict[str, str]) -> dict[str, Any]:
    en_rango = {k: x for k, x in fotos.items() if desde <= k[1] <= hasta}
    por_sid: dict[str, list[ClimaDia]] = defaultdict(list)
    for (sid, _), x in sorted(en_rango.items(), key=lambda kv: kv[0][1]):
        por_sid[sid].append(x)
    ids = {i for i, s in supervisores.items() if s.get("activo")} | set(por_sid)
    nombre = lambda sid: (supervisores.get(sid) or {}).get("nombre") or nombres.get(sid, sid)  # noqa: E731
    un_dia = desde == hasta
    lideres, equipos = [], []
    for sid in ids:
        xs = por_sid.get(sid, [])
        li, eq = _agregado(xs, "lider"), _agregado(xs, "equipo")
        fila = {"id": sid, "nombre": nombre(sid)}
        if un_dia and xs:
            d = xs[0].datos or {}
            pts = d.get("puntos") or {}
            lideres.append({**fila, **li, "elegido": d["lider"].get("elegido"), "detectado": d["lider"].get("detectado"),
                            "pulsos": pts.get("pulsos", []), "cierre": d.get("cierre", False), "feedbacks": d.get("feedbacks", 0),
                            "objetivo": d.get("objetivo"), "componentes": d["lider"].get("componentes", {})})
            equipos.append({**fila, **eq, "voces": d["equipo"].get("voces", 0), "tonos": d["equipo"].get("tonos", {}),
                            "componentes": d["equipo"].get("componentes", {})})
        else:
            elegidos = [x.datos["lider"].get("elegido") for x in xs if x.datos]
            detectados = [x.datos["lider"].get("detectado") for x in xs if x.datos]
            tonos: Counter = Counter()
            for x in xs:
                tonos.update((x.datos or {}).get("equipo", {}).get("tonos", {}))
            lideres.append({**fila, **li, "elegido": _prom(elegidos), "detectado": _prom(detectados), "pulsos": [],
                            "cierre": any((x.datos or {}).get("cierre") for x in xs), "feedbacks": sum((x.datos or {}).get("feedbacks", 0) for x in xs),
                            "objetivo": None, "componentes": {}})
            equipos.append({**fila, **eq, "voces": sum((x.datos or {}).get("equipo", {}).get("voces", 0) for x in xs),
                            "tonos": dict(tonos), "componentes": {}})
    orden = lambda f: (f["estado"] == "sin_datos", ESTADOS.index(f["estado"]) if f["estado"] in ESTADOS else 9, f["nombre"].lower())  # noqa: E731
    lideres.sort(key=orden)
    equipos.sort(key=orden)
    # Serie por día (en un día: la semana que termina ese día, para ver de dónde viene).
    serie_desde = hasta - timedelta(days=6) if un_dia else desde
    dias = []
    f = serie_desde
    while f <= hasta:
        xs = [x for (sid, g), x in fotos.items() if g == f]
        dias.append({"fecha": f.isoformat(), "equipo": _prom([x.equipo_animo for x in xs]), "lideres": _prom([x.lider_animo for x in xs]),
                     "compromiso_equipo": _prom([x.equipo_compromiso for x in xs]), "compromiso_lideres": _prom([x.lider_compromiso for x in xs]),
                     "estados": dict(Counter(x.lider_estado for x in xs if x.lider_estado != "sin_datos"))})
        f += timedelta(days=1)
    # Quién mejoró y quién bajó (rango: la primera mitad contra la segunda).
    cambios = []
    if not un_dia:
        medio = desde + (hasta - desde) / 2
        for sid, xs in por_sid.items():
            a = _prom([x.lider_animo for x in xs if x.fecha <= medio])
            b = _prom([x.lider_animo for x in xs if x.fecha > medio])
            if a is not None and b is not None and abs(b - a) >= 10:
                cambios.append({"id": sid, "nombre": nombre(sid), "antes": a, "despues": b, "delta": round(b - a, 1)})
        cambios.sort(key=lambda c: c["delta"])
    todas = list(en_rango.values())
    con_eq = [x for x in todas if x.equipo_estado != "sin_datos"]
    return {
        "modo": "dia" if un_dia else "rango",
        "resumen": {
            "equipo": _agregado(con_eq, "equipo"), "lideres": _agregado(todas, "lider"),
            "estados_lideres": dict(Counter(f["estado"] for f in lideres if f["estado"] != "sin_datos")),
            "estados_equipos": dict(Counter(f["estado"] for f in equipos if f["estado"] != "sin_datos")),
            "supervisores": len(ids), "con_datos": len(por_sid), "con_ia": any(x.con_ia for x in todas),
        },
        "curva": curva(todas) if un_dia else [],
        "puntos": [{"h": v["h"], "tono": v["tono"], "supervisor": nombre(x.supervisor_id)}
                   for x in todas for v in ((x.datos or {}).get("puntos") or {}).get("feedback", [])] if un_dia else [],
        "lideres": lideres, "equipos": equipos, "dias": dias,
        "cambios": [c for c in cambios if c["delta"] < 0][:3] + [c for c in reversed(cambios) if c["delta"] > 0][:3],
    }


# ------------------------------------------------------------------ de noche: Claude (Haiku) relee los textos del día
SISTEMA = """Sos analista de clima laboral de una operación de televentas de Claro Paraguay (Voicenter). Recibís los textos de un día:
el cierre del día de cada supervisor (líder), las devoluciones (feedback) que el supervisor le dio a un asesor, y lo que dijo el asesor
al firmar su coaching o al dictar su compromiso. Las personas van con códigos (S1 es un supervisor, A1 un asesor) y los datos
personales están tapados.

Para cada texto devolvé, del punto de vista de quien lo escribió o lo dijo:
- sentimiento: de -100 (muy negativo) a 100 (muy positivo); 0 si es neutro u operativo. No exageres: un texto técnico es neutro.
- emocion: la principal.
- intensidad: baja, media o alta.
- tono: solo para las devoluciones del supervisor (reconocimiento: destaca lo que hizo bien; constructivo: marca qué mejorar con una
  acción; critico: marca faltas sin reconocer nada ni proponer cómo). Para los demás textos, no_aplica.
- riesgo: true solo si hay una señal que un jefe debería atender ya (habla de renunciar o irse, maltrato, acoso, injusticia,
  discriminación, agotamiento extremo). En la duda, false.
- por_que: una frase corta, en español rioplatense, sin nombres.
Devolvé exactamente un resultado por texto, con su id."""
EMOCIONES = ["motivacion", "satisfaccion", "calma", "cansancio", "frustracion", "preocupacion", "estres", "enojo", "tristeza", "neutral"]
ESQUEMA = an._obj({"textos": {"type": "array", "items": an._obj({
    "id": an._TXT, "sentimiento": {"type": "integer"}, "emocion": {"type": "string", "enum": EMOCIONES},
    "intensidad": {"type": "string", "enum": ["baja", "media", "alta"]},
    "tono": {"type": "string", "enum": [*cal.TONOS, "no_aplica"]}, "riesgo": {"type": "boolean"}, "por_que": an._TXT})}})
TIPO_TEXTO = {"c": "cierre del día del supervisor", "f": "devolución del supervisor al asesor", "v": "lo que dijo el asesor al firmar",
              "k": "compromiso dictado por el asesor"}


def ia_estado() -> str:
    if not settings.clima_ia:
        return "apagada"
    if an.simulador():
        return "simulador"
    return "activa" if settings.anthropic_api_key else "sin_clave"


async def textos_del_dia(db: AsyncSession, fecha: date, p: dict[str, Any]) -> list[dict[str, Any]]:
    """Los textos del día que mira la IA: {clave, tipo, texto, sid, operador_id}."""
    senales = await cargar(db, fecha, fecha, p)
    out = []
    for (sid, _), d in senales.items():
        if d.cierre is not None:
            t = f"{d.cierre.resultados}. Compromiso: {d.cierre.compromiso}".strip()
            if len(t) > 15:
                out.append({"clave": f"c:{d.cierre.id}", "tipo": "c", "texto": t, "sid": sid, "operador_id": None})
        for x in d.devoluciones:
            if len((x["texto"] or "").strip()) >= 5:
                out.append({"clave": f"f:{x['cid']}:{fecha.isoformat()}", "tipo": "f", "texto": x["texto"], "sid": sid, "operador_id": None})
        for v in d.voces:
            out.append({"clave": v["clave"], "tipo": v["clave"][0], "texto": v["texto"], "sid": sid, "operador_id": v["operador_id"]})
    return out


def simular(lineas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Resultados armados con las reglas (pruebas y demostración, sin llamar a Anthropic)."""
    res = []
    for x in lineas:
        if x["tipo"] in ("v", "k"):
            v = cal.voz_asesor(x["texto"])
            pol, riesgo = v["polaridad"], bool(v["riesgo"])
        else:
            pol, riesgo = cal.detectar_animo(x["texto"])["texto"], bool(cal.riesgos(x["texto"]))
        res.append({"id": x["id"], "sentimiento": round(pol * 100), "emocion": "neutral", "intensidad": "media",
                    "tono": (cal.tono_feedback(x["texto"]) or "constructivo") if x["tipo"] == "f" else "no_aplica",
                    "riesgo": riesgo, "por_que": "Estimación del simulador."})
    return res


async def _consultar(pedido: str) -> tuple[list[dict[str, Any]], str, int, int]:
    from anthropic import AsyncAnthropic

    cliente = AsyncAnthropic(api_key=settings.anthropic_api_key, max_retries=2, timeout=180.0)
    r = await cliente.messages.create(
        model=settings.analisis_modelo, max_tokens=16_000, system=SISTEMA,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": ESQUEMA}},
        messages=[{"role": "user", "content": pedido}],
    )
    if r.stop_reason == "refusal":
        raise RuntimeError("Claude no pudo analizar estos textos")
    if r.stop_reason == "max_tokens":
        raise RuntimeError("La respuesta quedó cortada")
    texto = next((b.text for b in r.content if getattr(b, "type", None) == "text"), "")
    return json.loads(texto).get("textos") or [], r.model or settings.analisis_modelo, r.usage.input_tokens, r.usage.output_tokens


def _normalizar(x: dict[str, Any]) -> dict[str, Any]:
    try:
        s = int(x.get("sentimiento") or 0)
    except (TypeError, ValueError):
        s = 0
    return {"sentimiento": max(-100, min(100, s)), "emocion": x.get("emocion") if x.get("emocion") in EMOCIONES else "neutral",
            "intensidad": x.get("intensidad") if x.get("intensidad") in ("baja", "media", "alta") else "media",
            "tono": x.get("tono") if x.get("tono") in cal.TONOS else None, "riesgo": bool(x.get("riesgo")),
            "por_que": str(x.get("por_que") or "")[:200]}


async def analizar_dia(db: AsyncSession, fecha: date, *, momento: datetime | None = None) -> ClimaIA | None:
    """Relee con Claude (Haiku) los textos del día, sin nombres, y guarda el resultado de cada uno. Sin servicio, no hace nada."""
    if ia_estado() not in ("activa", "simulador"):
        return None
    momento = momento or srv.ahora()
    x = (await db.execute(select(ClimaIA).where(ClimaIA.operativa == OPERATIVA, ClimaIA.fecha == fecha))).scalar_one_or_none()
    if x is None:
        x = ClimaIA(operativa=OPERATIVA, fecha=fecha, created_at=momento)
        db.add(x)
    x.estado, x.intentos = "pendiente", (x.intentos or 0) + 1
    await db.commit()
    p = await sup.parametros(db)
    try:
        textos = await textos_del_dia(db, fecha, p)
        sids = {t["sid"] for t in textos}
        ops = {t["operador_id"] for t in textos if t["operador_id"]}
        nombres = await sup._nombres(db, sids)
        if ops:
            nombres_ops = {o.id: o.nombre for o in (await db.execute(select(Operador).where(Operador.id.in_(ops)))).scalars().all()}
        else:
            nombres_ops = {}
        codigos = {nombres.get(s, s): f"S{i}" for i, s in enumerate(sorted(sids), 1) if nombres.get(s)}
        codigos |= {n: f"A{i}" for i, n in enumerate(sorted(set(nombres_ops.values())), 1) if n}
        patrones = an._patron_nombres(codigos)
        lineas = [{**t, "id": f"T{i}"} for i, t in enumerate(textos, 1)]
        resultados: dict[str, Any] = {}
        ent = sal = 0
        modelo = f"simulador:{settings.analisis_modelo}" if an.simulador() else settings.analisis_modelo
        for k in range(0, len(lineas), POR_PEDIDO):
            lote = lineas[k:k + POR_PEDIDO]
            pedido = "\n".join(f"{t['id']} [{TIPO_TEXTO[t['tipo']]} · S{sorted(sids).index(t['sid']) + 1}]: "
                               f"{an.tapar(t['texto'], patrones, MAX_TEXTO_IA)}" for t in lote)
            if an.simulador():
                res, e, s_ = simular(lote), len(pedido) // 4, 40 * len(lote)
            else:
                res, modelo, e, s_ = await _consultar(pedido)
            ids = {t["id"]: t["clave"] for t in lote}
            for r in res:
                if r.get("id") in ids:
                    resultados[ids[r["id"]]] = _normalizar(r)
            ent, sal = ent + e, sal + s_
    except Exception as exc:  # noqa: BLE001 — se anota y se reintenta una vez
        motivo = str(exc) if isinstance(exc, (ValueError, RuntimeError)) else type(exc).__name__
        logger.warning("Clima con IA del %s falló (intento %s): %s", fecha, x.intentos, motivo)
        x.estado, x.error = ("error" if x.intentos >= MAX_INTENTOS else "pendiente"), motivo[:300]
        await db.commit()
        return x
    x.resultados, x.textos, x.modelo = resultados, len(lineas), modelo
    x.entrada_tokens, x.salida_tokens = ent, sal
    x.costo_usd = 0.0 if modelo.startswith("simulador") else an.costo(modelo, ent, sal)
    x.estado, x.error, x.terminado_at = "listo", None, srv.ahora()
    await db.commit()
    return x


async def pendientes_ia(db: AsyncSession, hoy: date, momento: datetime) -> list[date]:
    """Los días que falta analizar: hoy (desde la hora configurada) y los anteriores de la historia corta, del más nuevo."""
    hechos = {f: x for f, x in ((x.fecha, x) for x in (await db.execute(select(ClimaIA).where(
        ClimaIA.operativa == OPERATIVA, ClimaIA.fecha >= hoy - timedelta(days=settings.clima_ia_dias)))).scalars().all())}
    out = []
    if _utc(momento).astimezone(ZONA).hour >= settings.clima_ia_hora:
        out.append(hoy)
    out += [hoy - timedelta(days=k) for k in range(1, settings.clima_ia_dias + 1)]
    return [f for f in out if f not in hechos or (hechos[f].estado == "pendiente" and hechos[f].intentos < MAX_INTENTOS)
            or (f == hoy and hechos[f].estado == "listo" and hechos[f].terminado_at and _utc(hechos[f].terminado_at) < _fin_dia(f)
                and _utc(hechos[f].terminado_at).astimezone(ZONA).hour < settings.clima_ia_hora)]


async def historia() -> dict[str, Any]:
    """Al arrancar: completa las fotos de los últimos 90 días (con reglas; la IA completa las 2 últimas semanas de a poco)."""
    async with AsyncSessionLocal() as db:
        hoy, momento = sup.hoy(), srv.ahora()
        fotos = await actualizar(db, hoy - timedelta(days=DIAS_HISTORIA), hoy, p=await sup.parametros(db), hoy=hoy, momento=momento)
        return {"fotos": len(fotos)}


async def worker() -> None:
    """Cada 10 minutos: las fotos de hoy y las alertas al día; de noche, el análisis con IA (y la historia corta que falte)."""
    while True:
        try:
            async with AsyncSessionLocal() as db:
                hoy, momento = sup.hoy(), srv.ahora()
                await al_dia(db, hoy=hoy, momento=momento)
                if ia_estado() in ("activa", "simulador"):
                    dias = (await pendientes_ia(db, hoy, momento))[:2]
                    for f in dias:
                        await analizar_dia(db, f)
                    if dias:
                        await al_dia(db, hoy=hoy, momento=srv.ahora())
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Clima del equipo: el ciclo falló")
        await asyncio.sleep(INTERVALO)


def alerta_dict(a: AlertaComando, nombres: dict[str, str], dia: date) -> dict[str, Any]:
    return cmd.alerta_dict(a, nombres, dia, {})
