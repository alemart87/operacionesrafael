"""Analizador semántico de coaching — Televentas Claro.

Trabaja con los coachings **terminados**: los que firmó el asesor (y con él el supervisor) en el rango. Los que esperan
la devolución se cuentan como «en curso»; los registrados antes de la firma no entran.

- Estadísticas (cuentas puras, sin IA): monitoreos y feedback por coaching, compromisos, voz, cumplimiento de los
  compromisos, seguimientos a tiempo, firma dentro de los 2 días hábiles, **tiempo estimado** de cada coaching y la
  **evaluación de cada supervisor** (0–100, por componentes con peso; los que no tienen datos no cuentan).
- Tiempo estimado: los pasos que registró el supervisor (abrir, cada monitoreo, feedback, compromiso, audio y la
  firma) se agrupan en sesiones: entre dos pasos seguidos cuenta el tiempo si pasaron hasta 20 minutos; una pausa más
  larga (guardó sin firmar y siguió después) no cuenta. Más un minuto de arranque. Es una estimación.
- Palabras: las más frecuentes del feedback y de los compromisos (sin palabras vacías ni los nombres de las personas)
  y los pares de palabras, para el mapa de palabras.
- Informe con Claude (`ANALISIS_MODELO`, por defecto claude-haiku-5-5): lee los textos (escritos y transcriptos) y
  devuelve un JSON con esquema (resumen, hallazgos, temas, tono, calidad de los compromisos, evaluación por supervisor,
  alertas y recomendaciones). A Claude no le llegan nombres: supervisores (S1…), asesores (A1…) y coachings (C1…) van
  con códigos, y los números de teléfono y correos se tapan; al guardar, los códigos de personas vuelven a sus nombres.
  Corre en segundo plano (worker supervisado) con hasta 2 intentos y guarda tokens y costo.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import statistics
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ....core.config import settings
from ....core.database import AsyncSessionLocal
from ..sph.analyzer import tokens as tokens_nombre
from . import api as sup
from . import coaching as srv
from .alertas import ZONA, dia_local
from .models import (
    OPERATIVA, AnalisisInforme, Coaching, CoachingAudio, CoachingCompromiso, CoachingEvento, CoachingFirma, CoachingItem,
    Operador,
)

logger = logging.getLogger(__name__)

DIAS_MAX = 186
PAUSA_SESION = timedelta(minutes=20)
MINUTO_ARRANQUE = 1.0
TOPE_MINUTOS = 120.0
PASOS = ("creado", "editado", "item", "item_editado", "item_quitado", "compromiso", "compromiso_editado",
         "compromiso_quitado", "audio", "firmado")
MAX_INTENTOS = 2
MAX_TEXTO_CORPUS = 700         # caracteres por texto que se le pasan a Claude
MAX_CORPUS = 320_000           # caracteres del pedido (≈ 90 mil tokens: queda en la tarifa baja de Haiku)
# US$ por millón de tokens: (entrada, salida) hasta 100 mil tokens de entrada y por encima.
PRECIOS = {"claude-haiku-5-5": ((0.10, 0.50), (0.50, 2.50))}

_despertar = asyncio.Event()

PALABRAS_VACIAS = set("""
a al algo algún alguna algunas alguno algunos ante antes aquel aquella aquellas aquello aquellos aqui aquí así asi aun aún
bajo bastante bien cada casi como cómo con contra cual cuál cuales cuáles cualquier cuando cuándo cuanto cuánto de del
desde donde dónde dos durante e el él ella ellas ellos en entre era eran eres es esa esas ese eso esos esta está estaba
estaban estado estamos están estar estas este esto estos estoy fue fueron fui ha había habían han hasta hay haya he hemos
hice hizo hoy la las le les lo los más mas me mi mí mientras mis mismo mucho muchos muy nada ni no nos nosotros nuestra
nuestro o os otra otras otro otros para pero poco por porque pues que qué quien quién quienes se sea según ser si sí
sido siempre sin sino sobre solo sólo son su sus tal también tambien tan tanto te tenemos tener tengo tenía ti tiene
tienen todo todos toda todas tu tú tus un una uno unos unas usted ustedes va vamos van vez y ya yo cuenta hace hacer
dice dijo decir ver vos sus luego después despues bueno buena entonces cosa cosas parte forma manera momento caso tipo
asesor asesora supervisor supervisora coaching ok ahora voy vas queda quedó quedo quedan quedar puede pueden podés poder
hacen hago dar da dan ahí allí acá aca veces
""".split())

# Las frases (pares de palabras seguidas) no cruzan la puntuación: «3 llamadas: saluda» no es una frase.
_CORTE = re.compile(r"[.,;:!?¿¡()\[\]«»\"“”—–\n]+")


# ------------------------------------------------------------------ rango
def rango(desde: date | None, hasta: date | None) -> tuple[date, date, datetime, datetime]:
    dia = sup.hoy()
    hasta = hasta or dia
    desde = desde or hasta.replace(day=1)
    if desde > hasta:
        raise ValueError("La fecha inicial es posterior a la final")
    if (hasta - desde).days > DIAS_MAX:
        raise ValueError(f"El rango puede tener hasta {DIAS_MAX} días")
    ini = datetime.combine(desde, time.min, tzinfo=ZONA).astimezone(timezone.utc)
    fin = datetime.combine(hasta + timedelta(days=1), time.min, tzinfo=ZONA).astimezone(timezone.utc)
    return desde, hasta, ini, fin


def _aware(d: datetime | None) -> datetime | None:
    if d is None:
        return None
    return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d


# ------------------------------------------------------------------ tiempo estimado
def minutos_estimados(momentos: list[datetime], fin: datetime) -> float:
    """Minutos de trabajo del coaching: la suma de las pausas de hasta 20 min entre pasos seguidos, más el arranque."""
    fin = _aware(fin)
    pts = sorted(m for m in (_aware(x) for x in momentos) if m and m <= fin)
    if not pts or pts[-1] != fin:
        pts.append(fin)
    total = sum(g for a, b in zip(pts, pts[1:]) if 0 < (g := (b - a).total_seconds()) <= PAUSA_SESION.total_seconds())
    return round(min(total / 60 + MINUTO_ARRANQUE, TOPE_MINUTOS), 1)


# ------------------------------------------------------------------ palabras
_PALABRA = re.compile(r"[a-záéíóúüñ]+", re.IGNORECASE)


def palabras_de(texto: str | None) -> list[str]:
    return [w.lower() for w in _PALABRA.findall(texto or "")]


def plano(w: str) -> str:
    """Sin tildes y en minúsculas (para comparar con los nombres de las personas)."""
    return unicodedata.normalize("NFKD", w).encode("ascii", "ignore").decode().lower()


def frecuencias(textos: list[tuple[str, str]], excluir: set[str], tope: int = 80, tope_pares: int = 30) -> dict[str, Any]:
    """`textos`: (origen, texto) con origen «feedback» o «compromiso». Las palabras con su frecuencia por origen y los
    pares de palabras seguidas más repetidos. `excluir`: palabras sin tildes y en minúsculas (los nombres)."""
    por: dict[str, Counter] = defaultdict(Counter)
    total: Counter = Counter()
    pares: Counter = Counter()
    for origen, t in textos:
        ws = palabras_de(t)
        utiles = [w for w in ws if len(w) >= 3 and w not in PALABRAS_VACIAS and plano(w) not in excluir]
        total.update(utiles)
        por[origen].update(utiles)
        for tramo in _CORTE.split(t or ""):
            ps = palabras_de(tramo)
            for a, b in zip(ps, ps[1:]):
                if a in PALABRAS_VACIAS or b in PALABRAS_VACIAS or len(a) < 3 or len(b) < 3 or plano(a) in excluir or plano(b) in excluir:
                    continue
                pares[f"{a} {b}"] += 1
    return {
        "palabras": [{"texto": w, "n": n, "feedback": por["feedback"][w], "compromiso": por["compromiso"][w]}
                     for w, n in total.most_common(tope)],
        "pares": [{"texto": p, "n": n} for p, n in pares.most_common(tope_pares) if n > 1],
        "total": sum(total.values()),
    }


# ------------------------------------------------------------------ datos del rango
@dataclass
class Fila:
    """Un coaching firmado, con lo que hace falta para las cuentas y el informe."""
    c: Coaching
    items: list[CoachingItem] = field(default_factory=list)
    comps: list[CoachingCompromiso] = field(default_factory=list)
    audios: list[CoachingAudio] = field(default_factory=list)
    comentario: Optional[str] = None
    minutos: float = 0.0
    horas_firma: float = 0.0
    firma_a_tiempo: bool = True
    revisiones: list[dict[str, Any]] = field(default_factory=list)

    @property
    def monitoreos(self) -> int:
        return sum(1 for i in self.items if i.tipo == "monitoreo")

    @property
    def feedback(self) -> int:
        return sum(1 for i in self.items if i.tipo == "feedback")

    @property
    def palabras_feedback(self) -> int:
        return sum(len(palabras_de(i.texto)) for i in self.items)

    @property
    def voz_asesor(self) -> bool:
        return any(a.hablante == "asesor" for a in self.audios)

    @property
    def compromiso_dicho(self) -> bool:
        return any(x.origen == "asesor" and x.audio_id for x in self.comps)


@dataclass
class Datos:
    desde: date
    hasta: date
    filas: list[Fila]
    en_curso: list[Coaching]
    nombres: dict[str, str]
    ops: dict[str, Operador]
    equipos: dict[str, set[str]]
    hoy: date


async def cargar(db: AsyncSession, desde: date | None, hasta: date | None, supervisor_id: str | None = None) -> Datos:
    d0, d1, ini, fin = rango(desde, hasta)
    dia = sup.hoy()
    q = select(Coaching).where(Coaching.operativa == OPERATIVA, Coaching.firmado_at.is_not(None),
                               Coaching.firmado_at >= ini, Coaching.firmado_at < fin, Coaching.estado != "anulado")
    qp = select(Coaching).where(Coaching.operativa == OPERATIVA, Coaching.estado == srv.PENDIENTE,
                                Coaching.created_at >= ini, Coaching.created_at < fin)
    if supervisor_id:
        q, qp = q.where(Coaching.supervisor_id == supervisor_id), qp.where(Coaching.supervisor_id == supervisor_id)
    cs = list((await db.execute(q.order_by(Coaching.firmado_at))).scalars().all())
    pend = list((await db.execute(qp)).scalars().all())
    ids = [c.id for c in cs]
    filas = {c.id: Fila(c=c) for c in cs}
    p = await sup.parametros(db)
    for k in range(0, len(ids), 500):
        lote = ids[k:k + 500]
        for i in (await db.execute(select(CoachingItem).where(CoachingItem.coaching_id.in_(lote))
                                   .order_by(CoachingItem.at))).scalars().all():
            filas[i.coaching_id].items.append(i)
        for x in (await db.execute(select(CoachingCompromiso).where(CoachingCompromiso.coaching_id.in_(lote))
                                   .order_by(CoachingCompromiso.orden))).scalars().all():
            filas[x.coaching_id].comps.append(x)
        for a in (await db.execute(select(CoachingAudio).where(CoachingAudio.coaching_id.in_(lote)))).scalars().all():
            filas[a.coaching_id].audios.append(a)
        for f in (await db.execute(select(CoachingFirma).where(CoachingFirma.coaching_id.in_(lote),
                                                               CoachingFirma.firmante == "asesor"))).scalars().all():
            filas[f.coaching_id].comentario = f.comentario
        pasos: dict[str, list[datetime]] = defaultdict(list)
        for e in (await db.execute(select(CoachingEvento).where(CoachingEvento.coaching_id.in_(lote)))).scalars().all():
            c = filas[e.coaching_id].c
            if e.tipo in PASOS and e.por == c.supervisor_id:
                pasos[e.coaching_id].append(e.at)
            elif e.tipo == "revision":
                filas[e.coaching_id].revisiones.append({"at": srv.iso(e.at), "por": e.por, **(e.datos or {})})
        for cid in lote:
            fl = filas[cid]
            c = fl.c
            fl.minutos = minutos_estimados(pasos.get(cid, []) + [c.created_at], c.firmado_at)
            fl.horas_firma = round(max((_aware(c.firmado_at) - _aware(c.created_at)).total_seconds(), 0) / 3600, 2)
            fl.firma_a_tiempo = dia_local(c.firmado_at) <= srv.vence_devolucion(c, p)
    sids = {c.supervisor_id for c in cs} | {c.supervisor_id for c in pend}
    ctx = await sup.Contexto(dia.strftime("%Y-%m")).cargar(db)
    equipos = {sid: set(ctx.equipo(sid)) for sid in (sids | ({supervisor_id} if supervisor_id else set()))}
    op_ids = {c.operador_id for c in cs} | {c.operador_id for c in pend}
    ops = {o.id: o for o in (await db.execute(select(Operador).where(Operador.id.in_(op_ids)))).scalars().all()} if op_ids else {}
    revisores = {r["por"] for fl in filas.values() for r in fl.revisiones}
    nombres = await sup._nombres(db, sids | revisores)
    return Datos(desde=d0, hasta=d1, filas=list(filas.values()), en_curso=pend, nombres=nombres, ops=ops, equipos=equipos, hoy=dia)


# ------------------------------------------------------------------ estadísticas y evaluación
def _pct(a: float, b: float) -> float | None:
    return round(a / b * 100, 1) if b else None


def _prom(xs: list[float], dec: int = 1) -> float | None:
    return round(sum(xs) / len(xs), dec) if xs else None


def _mediana(xs: list[float], dec: int = 1) -> float | None:
    return round(statistics.median(xs), dec) if xs else None


# Componentes de la evaluación de un supervisor (peso sobre 100; el que no tiene datos no cuenta).
COMPONENTES = [
    ("cobertura", "Cobertura del equipo", 20, "Asesores de su equipo de hoy con un coaching firmado en el rango"),
    ("firma_a_tiempo", "Devolución a tiempo", 15, "Firmados dentro de los 2 días hábiles desde que se abrió"),
    ("profundidad", "Profundidad", 15, "Monitoreos y feedback por coaching (2 o más) y feedback desarrollado (40 palabras o más)"),
    ("compromisos", "Compromisos medibles", 15, "Compromisos con fecha (60%) y con la métrica que se va a mover (40%)"),
    ("voz_asesor", "Voz del asesor", 10, "Coachings con un compromiso dicho por el asesor (queda grabado)"),
    ("seguimiento", "Seguimiento a tiempo", 15, "Seguimientos registrados en la fecha acordada o al día siguiente"),
    ("cumplimiento", "Compromisos cumplidos", 10, "Cumplidos (y la mitad de los parciales) de los que ya tienen seguimiento"),
]


def nivel(total: float | None) -> str | None:
    if total is None:
        return None
    return "muy_bien" if total >= 80 else "bien" if total >= 60 else "a_mejorar" if total >= 40 else "critico"


def _resumen(filas: list[Fila], hoy: date) -> dict[str, Any]:
    comps = [x for fl in filas for x in fl.comps]
    con_res = [x for x in comps if x.resultado]
    est = Counter(srv.estado_seguimiento(fl.c, hoy) for fl in filas)
    exigibles = est["a_tiempo"] + est["tarde"] + est["vencido"]
    minutos = [fl.minutos for fl in filas]
    return {
        "coachings": len(filas),
        "asesores": len({fl.c.operador_id for fl in filas}),
        "monitoreos": sum(fl.monitoreos for fl in filas), "feedback": sum(fl.feedback for fl in filas),
        "compromisos": len(comps),
        "prom_items": _prom([fl.monitoreos + fl.feedback for fl in filas]),
        "prom_compromisos": _prom([len(fl.comps) for fl in filas]),
        "prom_palabras_feedback": _prom([fl.palabras_feedback for fl in filas], 0),
        "pct_con_voz": _pct(sum(1 for fl in filas if fl.audios), len(filas)),
        "pct_voz_asesor": _pct(sum(1 for fl in filas if fl.voz_asesor), len(filas)),
        "minutos_audio": round(sum(a.duracion_s or 0 for fl in filas for a in fl.audios) / 60, 1),
        "minutos_prom": _prom(minutos), "minutos_mediana": _mediana(minutos),
        "minutos_total": round(sum(minutos), 1),
        "horas_firma_mediana": _mediana([fl.horas_firma for fl in filas]),
        "pct_firma_a_tiempo": _pct(sum(1 for fl in filas if fl.firma_a_tiempo), len(filas)),
        "pct_compromisos_con_fecha": _pct(sum(1 for x in comps if x.para), len(comps)),
        "pct_compromisos_con_metrica": _pct(sum(1 for x in comps if x.metrica), len(comps)),
        "pct_compromiso_dicho": _pct(sum(1 for fl in filas if fl.compromiso_dicho), len(filas)),
        "seguimientos": {k: est.get(k, 0) for k in ("a_tiempo", "tarde", "vencido", "hoy", "proximo")},
        "pct_seguimiento_a_tiempo": _pct(est["a_tiempo"], exigibles),
        "cumplimiento": {k: sum(1 for x in con_res if x.resultado == k) for k in ("cumplido", "parcial", "no_cumplido")},
        "pct_cumplimiento": _pct(sum(1 for x in con_res if x.resultado == "cumplido") +
                                 0.5 * sum(1 for x in con_res if x.resultado == "parcial"), len(con_res)),
        "revisados": sum(1 for fl in filas if fl.revisiones),
    }


def evaluar(r: dict[str, Any], equipo: int, asesores: int) -> dict[str, Any]:
    """La evaluación 0–100 de un supervisor con sus números del rango."""
    prof = None
    if r["coachings"]:
        prof = round(min((r["prom_items"] or 0) / 2, 1) * 50 + min((r["prom_palabras_feedback"] or 0) / 40, 1) * 50, 1)
    comp = None
    if r["compromisos"]:
        comp = round((r["pct_compromisos_con_fecha"] or 0) * 0.6 + (r["pct_compromisos_con_metrica"] or 0) * 0.4, 1)
    valores = {
        "cobertura": round(min(asesores / equipo, 1) * 100, 1) if equipo else None,
        "firma_a_tiempo": r["pct_firma_a_tiempo"], "profundidad": prof, "compromisos": comp,
        "voz_asesor": r["pct_compromiso_dicho"], "seguimiento": r["pct_seguimiento_a_tiempo"], "cumplimiento": r["pct_cumplimiento"],
    }
    if not r["coachings"]:
        valores = {k: (0.0 if k == "cobertura" and equipo else None) for k in valores}
    partes = [{"clave": k, "nombre": n, "peso": p, "ayuda": a, "valor": valores[k]} for k, n, p, a in COMPONENTES]
    con = [x for x in partes if x["valor"] is not None]
    peso = sum(x["peso"] for x in con)
    total = round(sum(x["valor"] * x["peso"] for x in con) / peso, 1) if peso else None
    return {"total": total, "nivel": nivel(total), "componentes": partes, "parcial": peso < 100}


def estadisticas(d: Datos) -> dict[str, Any]:
    hoy = d.hoy
    general = _resumen(d.filas, hoy)
    por_sup: dict[str, list[Fila]] = defaultdict(list)
    for fl in d.filas:
        por_sup[fl.c.supervisor_id].append(fl)
    en_curso = Counter(c.supervisor_id for c in d.en_curso)
    supervisores = []
    for sid in set(por_sup) | set(en_curso) | set(d.equipos):
        fs = por_sup.get(sid, [])
        r = _resumen(fs, hoy)
        equipo = len(d.equipos.get(sid, set()))
        alcanzados = len({fl.c.operador_id for fl in fs} & d.equipos.get(sid, set())) if equipo else r["asesores"]
        supervisores.append({"id": sid, "nombre": d.nombres.get(sid, sid), "equipo": equipo, "en_curso": en_curso.get(sid, 0),
                             **r, "evaluacion": evaluar(r, equipo, alcanzados)})
    supervisores.sort(key=lambda x: (x["evaluacion"]["total"] is None, -(x["evaluacion"]["total"] or 0), x["nombre"].lower()))
    # series
    dias = []
    cuenta = Counter(dia_local(fl.c.firmado_at) for fl in d.filas)
    x = d.desde
    while x <= d.hasta:
        dias.append({"dia": x.isoformat(), "coachings": cuenta.get(x, 0)})
        x += timedelta(days=1)
    horas = Counter(_aware(fl.c.firmado_at).astimezone(ZONA).hour for fl in d.filas)
    tramos = [(0, 5, "Hasta 5 min"), (5, 10, "5 a 10"), (10, 15, "10 a 15"), (15, 20, "15 a 20"), (20, 30, "20 a 30"),
              (30, 10_000, "Más de 30")]
    duraciones = [{"tramo": t, "coachings": sum(1 for fl in d.filas if a <= fl.minutos < b)} for a, b, t in tramos]
    metricas = Counter(m for fl in d.filas for m in srv.metricas_de(fl.c))
    tipos = Counter(fl.c.tipo for fl in d.filas)
    excluir = set()
    for sid in d.nombres:
        excluir |= set(tokens_nombre(d.nombres[sid]))
    for o in d.ops.values():
        excluir |= set(tokens_nombre(o.nombre))
    excluir = {w.lower() for w in excluir}   # tokens_nombre: sin tildes y en mayúsculas
    textos = [("feedback", i.texto) for fl in d.filas for i in fl.items] + \
             [("compromiso", x.texto) for fl in d.filas for x in fl.comps] + \
             [("feedback", fl.comentario) for fl in d.filas if fl.comentario]
    lista = []
    for fl in sorted(d.filas, key=lambda f: _aware(f.c.firmado_at), reverse=True)[:500]:
        c = fl.c
        o = d.ops.get(c.operador_id)
        texto = " · ".join([i.texto for i in fl.items if i.texto] + [x.texto for x in fl.comps if x.texto])
        res = Counter(x.resultado for x in fl.comps if x.resultado)
        lista.append({
            "id": c.id, "firmado_at": srv.iso(c.firmado_at), "fecha": c.fecha.isoformat(), "tipo": c.tipo,
            "metricas": srv.metricas_de(c), "supervisor_id": c.supervisor_id, "supervisor": d.nombres.get(c.supervisor_id, c.supervisor_id),
            "operador_id": c.operador_id, "operador": o.nombre if o else "—", "monitoreos": fl.monitoreos, "feedback": fl.feedback,
            "compromisos": len(fl.comps), "audios": len(fl.audios), "voz_asesor": fl.voz_asesor, "minutos": fl.minutos,
            "horas_firma": fl.horas_firma, "firma_a_tiempo": fl.firma_a_tiempo, "estado": c.estado, "resultado": c.resultado,
            "cumplimiento": dict(res), "revisado": bool(fl.revisiones),
            "revision": fl.revisiones[-1]["valoracion"] if fl.revisiones else None,
            "texto": texto[:600],
        })
    return {
        "desde": d.desde.isoformat(), "hasta": d.hasta.isoformat(), "hoy": hoy.isoformat(),
        "kpis": {**general, "en_curso": len(d.en_curso), "supervisores": len([s for s in supervisores if s["coachings"]])},
        "supervisores": supervisores, "por_dia": dias,
        # De 6 a 22 h, más las horas de afuera en que se firmó algo (un coaching de la noche no se pierde del gráfico).
        "por_hora": [{"hora": h, "coachings": horas.get(h, 0)} for h in range(min([6, *horas]), max([22, *horas]) + 1)],
        "duraciones": duraciones,
        "por_metrica": [{"metrica": m, "coachings": n} for m, n in metricas.most_common()],
        "por_tipo": [{"tipo": t, "coachings": tipos.get(t, 0)} for t in ("diario", "semanal", "mensual")],
        "palabras": frecuencias(textos, excluir),
        "coachings": lista, "total_coachings": len(d.filas),
        "componentes": [{"clave": k, "nombre": n, "peso": p, "ayuda": a} for k, n, p, a in COMPONENTES],
        "reglas": {"pausa_sesion_min": int(PAUSA_SESION.total_seconds() // 60), "minuto_arranque": MINUTO_ARRANQUE},
    }


# ------------------------------------------------------------------ el pedido a Claude (sin nombres)
_NUMERO = re.compile(r"(?<!\w)\+?\d[\d\s.\-]{5,}\d(?!\w)")
_CORREO = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
_CODIGO = re.compile(r"\b([SA])(\d{1,4})\b")


def _patron_nombres(nombres: dict[str, str]) -> list[tuple[re.Pattern, str]]:
    """Nombre completo y cada palabra del nombre → su código, de lo más largo a lo más corto. Las palabras de 4 letras
    o más se reemplazan como estén escritas; las de 3 («Ana», «Luz»), solo con mayúscula, para no tapar palabras comunes."""
    pares: list[tuple[str, str]] = []
    for nombre, codigo in nombres.items():
        limpio = " ".join(nombre.replace(",", " ").split())
        if limpio:
            pares.append((limpio, codigo))
            partes = limpio.split()
            if len(partes) >= 2:
                pares.append((" ".join(reversed(partes)), codigo))
            pares.extend((p, codigo) for p in partes if len(p) >= 3)
    pares.sort(key=lambda t: -len(t[0]))
    out = []
    for t, c in pares:
        if len(t) >= 4:
            out.append((re.compile(rf"(?<!\w){re.escape(t)}(?!\w)", re.IGNORECASE), c))
        else:
            out.append((re.compile(rf"(?<!\w)(?:{re.escape(t.capitalize())}|{re.escape(t.upper())})(?!\w)"), c))
    return out


def tapar(texto: str | None, patrones: list[tuple[re.Pattern, str]], tope: int = MAX_TEXTO_CORPUS) -> str:
    t = " ".join((texto or "").split())
    t = _CORREO.sub("[correo]", t)
    t = _NUMERO.sub("[número]", t)
    for p, c in patrones:
        t = p.sub(c, t)
    return t if len(t) <= tope else t[: tope - 1].rstrip() + "…"


def armar_pedido(d: Datos, est: dict[str, Any], tope: int) -> tuple[str, dict[str, Any]]:
    """El texto que lee Claude y los códigos para volver a los nombres."""
    sids = sorted({fl.c.supervisor_id for fl in d.filas}, key=lambda s: d.nombres.get(s, s).lower())
    cod_s = {sid: f"S{k + 1}" for k, sid in enumerate(sids)}
    filas = sorted(d.filas, key=lambda f: _aware(f.c.firmado_at), reverse=True)[:tope]
    oids = sorted({fl.c.operador_id for fl in filas}, key=lambda o: (d.ops[o].nombre.lower() if o in d.ops else "", o))
    cod_a = {oid: f"A{k + 1}" for k, oid in enumerate(oids)}
    patrones = _patron_nombres({**{d.nombres.get(s, s): c for s, c in cod_s.items()},
                                **{d.ops[o].nombre: c for o, c in cod_a.items() if o in d.ops}})
    lineas = [f"Período: {d.desde:%d/%m/%Y} a {d.hasta:%d/%m/%Y}. Coachings firmados: {len(d.filas)}"
              f" (se analizan los {len(filas)} más recientes). En curso sin firmar: {len(d.en_curso)}.", "",
              "Indicadores calculados por el sistema (no los recalcules; interpretalos):"]
    for s in est["supervisores"]:
        if s["id"] not in cod_s:
            continue
        ev = s["evaluacion"]
        lineas.append(f"- {cod_s[s['id']]}: {s['coachings']} coachings, equipo de {s['equipo']}, evaluación {ev['total']}"
                      f", {s['prom_items']} monitoreos/feedback por coaching, {s['prom_palabras_feedback']} palabras de feedback,"
                      f" compromisos con fecha {s['pct_compromisos_con_fecha']}%, con métrica {s['pct_compromisos_con_metrica']}%,"
                      f" dichos por el asesor {s['pct_compromiso_dicho']}%, devolución a tiempo {s['pct_firma_a_tiempo']}%,"
                      f" seguimiento a tiempo {s['pct_seguimiento_a_tiempo']}%, cumplimiento {s['pct_cumplimiento']}%,"
                      f" tiempo estimado {s['minutos_prom']} min.")
    lineas += ["", "Coachings (los textos dictados son transcripciones automáticas y pueden tener errores):"]
    cod_c: dict[str, str] = {}
    largo = sum(len(x) for x in lineas)
    for k, fl in enumerate(filas):
        c = fl.c
        cc = f"C{k + 1}"
        bloque = [f"[{cc}] {cod_s.get(c.supervisor_id, 'S?')} → {cod_a.get(c.operador_id, 'A?')} · {c.tipo} · "
                  f"{' + '.join(srv.metricas_de(c))} · firmado {dia_local(c.firmado_at):%d/%m} · {fl.minutos} min estimados"]
        for i in fl.items:
            if i.texto:
                bloque.append(f"  - {'Monitoreo' if i.tipo == 'monitoreo' else 'Feedback'}"
                              f"{' (dictado)' if i.audio_id else ''}: {tapar(i.texto, patrones)}")
        for x in fl.comps:
            extra = ", dicho por el asesor" if x.origen == "asesor" and x.audio_id else ""
            plazo = f", para el {x.para:%d/%m}" if x.para else ", sin fecha"
            res = f" → seguimiento: {x.resultado}" if x.resultado else ""
            bloque.append(f"  - Compromiso {x.orden}{extra}{plazo}: {tapar(x.texto, patrones)}{res}")
        if fl.comentario:
            bloque.append(f"  - Comentario del asesor al firmar: {tapar(fl.comentario, patrones)}")
        if c.seguimiento_comentario:
            bloque.append(f"  - Seguimiento del supervisor ({c.resultado or 'sin dato'}): {tapar(c.seguimiento_comentario, patrones)}")
        texto = "\n".join(bloque)
        if largo + len(texto) > MAX_CORPUS:
            lineas.append(f"(Se cortó en {k} coachings por tamaño.)")
            break
        lineas.append(texto)
        largo += len(texto)
        cod_c[cc] = c.id
    codigos = {"supervisores": {c: {"id": s, "nombre": d.nombres.get(s, s)} for s, c in cod_s.items()},
               "asesores": {c: {"id": o, "nombre": d.ops[o].nombre if o in d.ops else c} for o, c in cod_a.items()},
               "coachings": cod_c}
    return "\n".join(lineas), codigos


SISTEMA = """Sos analista de calidad del coaching comercial de una operación de televentas de Claro Paraguay (Voicenter).
Los supervisores hacen coaching a sus asesores: monitorean llamadas, dan feedback y el asesor se compromete a acciones
concretas que firma; después el supervisor hace el seguimiento. El modelo es «Líder Coach Comercial»: cada coaching
parte de un dato, termina en un compromiso medible con fecha y se cierra cuando el dato mejora.

Analizá los textos y devolvé el JSON pedido. Reglas:
- Basate solo en la evidencia de los textos y en los indicadores dados. No inventes hechos.
- Las personas van con códigos: S = supervisor, A = asesor, C = coaching. Usá esos códigos; nunca inventes nombres.
- En `evidencia` y `ejemplos` citá el código del coaching (por ejemplo «C12») y una frase corta textual.
- `tono`: porcentajes (enteros) que suman 100 entre constructivo, positivo (reconocimiento) y crítico (señalar errores
  sin propuesta).
- `calificacion` de cada supervisor: entero de 1 a 5 (1 muy débil, 3 correcto, 5 excelente) según la calidad del
  coaching: diagnóstico basado en lo observado, feedback específico, compromisos medibles con fecha y seguimiento.
- `alertas`: solo situaciones que un gerente debería mirar (trato inadecuado, compromisos imposibles, coachings vacíos o
  copiados, temas de cumplimiento o de ventas mal hechas).
- Escribí en español claro y profesional, directo, sin rodeos ni preámbulos."""

_TXT = {"type": "string"}
_LISTA = {"type": "array", "items": {"type": "string"}}


def _obj(props: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


ESQUEMA = _obj({
    "resumen": _TXT,
    "hallazgos": {"type": "array", "items": _obj({
        "titulo": _TXT, "detalle": _TXT, "tipo": {"type": "string", "enum": ["fortaleza", "riesgo", "oportunidad"]},
        "evidencia": _LISTA})},
    "temas": {"type": "array", "items": _obj({
        "tema": _TXT, "descripcion": _TXT, "frecuencia": {"type": "string", "enum": ["alta", "media", "baja"]},
        "sentimiento": {"type": "string", "enum": ["positivo", "neutro", "negativo"]}, "ejemplos": _LISTA})},
    "tono": _obj({"constructivo": {"type": "integer"}, "positivo": {"type": "integer"}, "critico": {"type": "integer"},
                  "explicacion": _TXT}),
    "calidad_compromisos": _obj({"especificos": {"type": "integer"}, "medibles": {"type": "integer"},
                                 "con_plazo": {"type": "integer"}, "comentario": _TXT}),
    "supervisores": {"type": "array", "items": _obj({
        "codigo": _TXT, "calificacion": {"type": "integer"}, "fortalezas": _LISTA, "a_mejorar": _LISTA,
        "recomendacion": _TXT, "ejemplo": _TXT})},
    "alertas": {"type": "array", "items": _obj({"coaching": _TXT, "motivo": _TXT})},
    "recomendaciones": _LISTA,
})


def simulador() -> bool:
    """El simulador del analizador es solo para desarrollo y pruebas: en producción se ignora."""
    return settings.analisis_simulador and settings.env != "production"


def servicio_disponible() -> bool:
    return bool(simulador() or settings.anthropic_api_key)


def costo(modelo: str, entrada: int, salida: int) -> float:
    precio = PRECIOS.get(modelo)
    if not precio:
        return 0.0
    (pe, ps) = precio[0] if entrada <= 100_000 else precio[1]
    return round(entrada / 1e6 * pe + salida / 1e6 * ps, 5)


async def consultar_claude(pedido: str) -> tuple[dict[str, Any], str, int, int]:
    """(resultado, modelo, tokens de entrada, de salida). Salida JSON con el esquema."""
    from anthropic import AsyncAnthropic

    cliente = AsyncAnthropic(api_key=settings.anthropic_api_key, max_retries=2, timeout=180.0)
    r = await cliente.messages.create(
        model=settings.analisis_modelo, max_tokens=12_000, system=SISTEMA,
        output_config={"effort": settings.analisis_esfuerzo, "format": {"type": "json_schema", "schema": ESQUEMA}},
        messages=[{"role": "user", "content": pedido}],
    )
    if r.stop_reason == "refusal":
        raise RuntimeError("Claude no pudo analizar estos textos")
    if r.stop_reason == "max_tokens":
        raise RuntimeError("La respuesta quedó cortada: probá con un rango más chico")
    texto = next((b.text for b in r.content if getattr(b, "type", None) == "text"), "")
    return json.loads(texto), r.model or settings.analisis_modelo, r.usage.input_tokens, r.usage.output_tokens


def simular(est: dict[str, Any], codigos: dict[str, Any]) -> dict[str, Any]:
    """Un informe armado con las estadísticas (pruebas y demostración, sin llamar a Anthropic)."""
    k = est["kpis"]
    cod = {v["id"]: c for c, v in codigos["supervisores"].items()}
    pal = [p["texto"] for p in est["palabras"]["palabras"][:6]]
    primero = next(iter(codigos["coachings"]), "C1")
    return {
        "resumen": f"Se analizaron {k['coachings']} coachings firmados de {k['supervisores']} supervisores. "
                   f"En promedio cada coaching tuvo {k['prom_items']} monitoreos o feedback y {k['prom_compromisos']} compromisos.",
        "hallazgos": [{"titulo": "Compromisos con fecha", "tipo": "fortaleza" if (k["pct_compromisos_con_fecha"] or 0) >= 60 else "oportunidad",
                       "detalle": f"El {k['pct_compromisos_con_fecha']}% de los compromisos tiene fecha.", "evidencia": [primero]}],
        "temas": [{"tema": p.capitalize(), "descripcion": f"Aparece en el feedback y los compromisos («{p}»).",
                   "frecuencia": "alta" if i < 2 else "media", "sentimiento": "neutro", "ejemplos": [primero]} for i, p in enumerate(pal[:4])],
        "tono": {"constructivo": 60, "positivo": 25, "critico": 15, "explicacion": "Estimación del simulador."},
        "calidad_compromisos": {"especificos": 60, "medibles": int(k["pct_compromisos_con_metrica"] or 0),
                                "con_plazo": int(k["pct_compromisos_con_fecha"] or 0), "comentario": "Estimación del simulador."},
        "supervisores": [{"codigo": cod[s["id"]], "calificacion": max(1, min(5, round((s["evaluacion"]["total"] or 0) / 20))),
                          "fortalezas": ["Registra la devolución con firma."], "a_mejorar": ["Sumar más monitoreos por coaching."],
                          "recomendacion": "Pedir que el asesor diga sus compromisos con fecha y métrica.", "ejemplo": primero}
                         for s in est["supervisores"] if s["id"] in cod],
        "alertas": [],
        "recomendaciones": ["Mantener al menos dos monitoreos por coaching.", "Cerrar cada compromiso con su seguimiento."],
    }


def _volver_a_nombres(x: Any, mapa: dict[str, str]) -> Any:
    if isinstance(x, str):
        return _CODIGO.sub(lambda m: mapa.get(m.group(0), m.group(0)), x)
    if isinstance(x, list):
        return [_volver_a_nombres(v, mapa) for v in x]
    if isinstance(x, dict):
        return {k: _volver_a_nombres(v, mapa) for k, v in x.items()}
    return x


def normalizar(res: dict[str, Any], codigos: dict[str, Any]) -> dict[str, Any]:
    """Topes y nombres: calificación de 1 a 5, tono que suma 100, porcentajes de 0 a 100 y los códigos de personas
    reemplazados por sus nombres (los de los coachings quedan, para abrirlos)."""
    tono = res.get("tono") or {}
    vals = [max(int(tono.get(k) or 0), 0) for k in ("constructivo", "positivo", "critico")]
    s = sum(vals) or 1
    vals = [round(v * 100 / s) for v in vals]
    vals[0] += 100 - sum(vals)
    res["tono"] = {"constructivo": vals[0], "positivo": vals[1], "critico": vals[2], "explicacion": tono.get("explicacion", "")}
    cc = res.get("calidad_compromisos") or {}
    for k in ("especificos", "medibles", "con_plazo"):
        cc[k] = max(0, min(100, int(cc.get(k) or 0)))
    res["calidad_compromisos"] = cc
    sups = codigos["supervisores"]
    for x in res.get("supervisores") or []:
        x["calificacion"] = max(1, min(5, int(x.get("calificacion") or 3)))
        ref = sups.get(x.get("codigo", ""))
        x["supervisor_id"], x["supervisor"] = (ref["id"], ref["nombre"]) if ref else (None, x.get("codigo"))
    mapa = {c: v["nombre"] for c, v in sups.items()} | {c: v["nombre"] for c, v in codigos["asesores"].items()}
    res = _volver_a_nombres(res, mapa)
    res["coachings"] = codigos["coachings"]
    return res


# ------------------------------------------------------------------ informes en segundo plano
def despertar() -> None:
    _despertar.set()


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def informe_dict(x: AnalisisInforme, nombres: dict[str, str]) -> dict[str, Any]:
    return {"id": x.id, "desde": x.desde.isoformat(), "hasta": x.hasta.isoformat(), "supervisor_id": x.supervisor_id,
            "supervisor": nombres.get(x.supervisor_id) if x.supervisor_id else None, "estado": x.estado,
            "coachings": x.coachings, "modelo": x.modelo, "resultado": x.resultado, "error": x.error,
            "entrada_tokens": x.entrada_tokens, "salida_tokens": x.salida_tokens, "costo_usd": x.costo_usd,
            "pedido_por": nombres.get(x.pedido_por, x.pedido_por), "created_at": srv.iso(x.created_at),
            "terminado_at": srv.iso(x.terminado_at)}


async def procesar_uno(db: AsyncSession, x: AnalisisInforme) -> None:
    x.estado, x.intentos = "procesando", (x.intentos or 0) + 1
    await db.commit()
    try:
        d = await cargar(db, x.desde, x.hasta, x.supervisor_id)
        if not d.filas:
            raise ValueError("No hay coachings firmados en el rango")
        est = estadisticas(d)
        pedido, codigos = armar_pedido(d, est, settings.analisis_max_coachings)
        if simulador():
            res, modelo, ent, sal = simular(est, codigos), f"simulador:{settings.analisis_modelo}", len(pedido) // 4, 900
        elif not settings.anthropic_api_key:
            raise RuntimeError("sin_servicio")
        else:
            res, modelo, ent, sal = await consultar_claude(pedido)
        x.resultado = normalizar(res, codigos)
    except Exception as exc:  # noqa: BLE001 — cualquier error se anota (y se reintenta una vez si no es de datos)
        motivo = ("Falta ANTHROPIC_API_KEY en el servidor" if str(exc) == "sin_servicio"
                  else str(exc) if isinstance(exc, (ValueError, RuntimeError)) else type(exc).__name__)
        logger.warning("Informe de análisis %s falló (intento %s): %s", x.id, x.intentos, motivo)
        final = isinstance(exc, ValueError) or str(exc) == "sin_servicio" or x.intentos >= MAX_INTENTOS
        x.estado, x.error = ("error" if final else "pendiente"), motivo[:300]
        if final:
            x.terminado_at = _ahora()
        await db.commit()
        return
    x.coachings = len(codigos["coachings"])
    x.modelo, x.entrada_tokens, x.salida_tokens = modelo, ent, sal
    x.costo_usd = 0.0 if modelo.startswith("simulador") else costo(modelo, ent, sal)
    x.estado, x.error, x.terminado_at = "listo", None, _ahora()
    await db.commit()


async def procesar_pendientes(limite: int = 2) -> int:
    async with AsyncSessionLocal() as db:
        atascados = _ahora() - timedelta(minutes=15)
        q = select(AnalisisInforme).where(
            (AnalisisInforme.estado == "pendiente") |
            and_(AnalisisInforme.estado == "procesando", AnalisisInforme.created_at < atascados),
            AnalisisInforme.intentos < MAX_INTENTOS + 1).order_by(AnalisisInforme.created_at).limit(limite)
        filas = list((await db.execute(q)).scalars().all())
        for x in filas:
            await procesar_uno(db, x)
        return len(filas)


async def worker() -> None:
    """Cola de informes: despierta con cada pedido (o cada 20 s)."""
    while True:
        try:
            await asyncio.wait_for(_despertar.wait(), timeout=20)
        except asyncio.TimeoutError:
            pass
        _despertar.clear()
        while await procesar_pendientes():
            pass
