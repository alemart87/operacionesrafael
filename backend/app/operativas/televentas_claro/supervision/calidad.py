"""Calidad del feedback y ánimo del supervisor — Televentas Claro.

Reglas simples y a la vista (sin IA: responde al instante, sin costo y siempre igual):

- **Calidad de un feedback (0–100):** el largo (entre 25 y 120 palabras es lo ideal; menos le falta profundidad, más
  le falta concisión, igual que las frases de más de 30 palabras) y cuatro señales: **evidencia** (la llamada, la hora,
  un número o lo que dijo el cliente), **acción** (qué tiene que hacer distinto), **métrica** (Pospago, GPON, uso,
  conversación…) y **reconocimiento** (algo que hizo bien). Cada falta trae su consejo de qué hacer.
- **Ánimo del supervisor:** en el cierre del día elige cómo terminó (bien, normal, difícil) y el texto se lee con un
  léxico de emociones del trabajo (motivación, satisfacción, cansancio, frustración, preocupación y estrés), con las
  negaciones («no estoy cansado») y los intensificadores («re cansado», «muy contento»). Lo que eligió pesa más que
  lo que se lee; si no coinciden, queda «mixto» para que el jefe lo mire.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Any, Iterable

from .analisis import plano

# ------------------------------------------------------------------ calidad del feedback
MIN_PALABRAS = 25          # menos: le falta profundidad
IDEAL_MAX = 120            # hasta acá, ideal
MAX_PALABRAS = 160         # más: le falta concisión
MAX_ORACION = 30           # palabras por frase, en promedio

_PALABRA = re.compile(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+")
_ORACION = re.compile(r"[.!?;\n]+")

# Raíces sin tildes (se compara con el texto en minúsculas y sin tildes).
_EVIDENCIA = ("escuche", "llamada", "llamo", "cliente dijo", "le dijo", "el cliente", "la clienta", "minuto", "grabacion",
              "monitoree", "observe", "vi que", "note que", "en la venta", "linea", "numero")
_ACCION = ("practic", "prob", "usar", "usa ", "hace", "hacer", "pregunt", "ofrec", "confirm", "valid", "cerra", "cierre",
           "evit", "repet", "segui", "acordamos", "vamos a", "tiene que", "tenes que", "debe", "proxima", "a partir de",
           "empezar", "mejorar", "aplicar", "aplica", "presentar", "pausar", "escuchar")
_METRICA = ("pospago", "gpon", "fibra", "uso", "linea", "conversacion", "venta", "neta", "cierre", "objecion", "oferta",
            "efectividad", "portabilidad", "porta", "sph", "productividad")
_RECONOCIMIENTO = ("bien", "buen", "buena", "mejor", "mejoro", "logr", "felicit", "excelente", "destac", "correct",
                   "fortaleza", "reconoc", "genial", "muy bien")

CRITERIOS = {
    "largo": "Largo justo",
    "evidencia": "Evidencia",
    "accion": "Acción concreta",
    "metrica": "Métrica",
    "reconocimiento": "Reconocimiento",
}

CONSEJOS = {
    "corto": "Le falta profundidad: contá qué viste (la llamada o lo que dijo el cliente), por qué importa y qué tiene "
             "que hacer distinto. Apuntá a 3 o 4 frases.",
    "largo": "Podés ser más conciso: quedate con una conducta que viste, una cosa a mejorar y una acción para la próxima "
             "llamada. Frases cortas, sin repetir.",
    "evidencia": "Sumá la evidencia: la hora o el número de la llamada, o la frase del cliente. Así el asesor sabe de qué "
                 "le hablás.",
    "accion": "Cerrá con una acción concreta: qué tiene que hacer en la próxima llamada (por ejemplo, «preguntar por el uso "
              "antes de ofrecer»).",
    "metrica": "Nombrá la métrica que se va a mover: Pospago, GPON, uso de las líneas o conversación.",
    "reconocimiento": "Empezá por algo que hizo bien: el feedback se recibe mejor y el asesor sabe qué mantener.",
}


def _tiene(t: str, claves: Iterable[str]) -> bool:
    return any(k in t for k in claves)


def evaluar_feedback(texto: str | None) -> dict[str, Any]:
    """La calidad de un feedback: puntaje, el problema principal (corto o largo), cada señal y los consejos."""
    texto = (texto or "").strip()
    palabras = _PALABRA.findall(texto)
    n = len(palabras)
    oraciones = [o for o in _ORACION.split(texto) if _PALABRA.search(o)]
    prom = round(n / len(oraciones), 1) if oraciones else float(n)
    t = f" {plano(texto)} "
    evidencia = bool(re.search(r"\d", texto)) or bool(re.search(r"[«\"“].{3,}[»\"”]", texto)) or _tiene(t, _EVIDENCIA)
    accion = _tiene(t, _ACCION)
    metrica = _tiene(t, _METRICA)
    reconocimiento = _tiene(t, _RECONOCIMIENTO)
    problema = "corto" if n < MIN_PALABRAS else "largo" if n > MAX_PALABRAS or (prom > MAX_ORACION and n > 40) else None
    # Largo: 40 puntos si está en el rango; menos cuanto más se aleja. Cada señal, 15.
    if problema == "corto":
        p_largo = 40 * n / MIN_PALABRAS
    elif n > IDEAL_MAX:
        p_largo = max(10.0, 40 - (n - IDEAL_MAX) * 0.4)
    else:
        p_largo = 40.0
    if prom > MAX_ORACION and n > 40:
        p_largo = min(p_largo, 25.0)
    puntaje = round(min(100.0, p_largo + 15 * sum((evidencia, accion, metrica, reconocimiento))))
    senales = {"largo": problema is None, "evidencia": evidencia, "accion": accion, "metrica": metrica, "reconocimiento": reconocimiento}
    faltan = ([problema] if problema else []) + [k for k in ("evidencia", "accion", "metrica", "reconocimiento") if not senales[k]]
    return {
        "puntaje": puntaje, "nivel": nivel(puntaje), "palabras": n, "palabras_por_frase": prom, "problema": problema,
        "senales": senales, "consejos": [CONSEJOS[k] for k in faltan[:3]], "faltan": faltan,
    }


def nivel(p: float | None) -> str | None:
    if p is None:
        return None
    return "muy_bien" if p >= 80 else "bien" if p >= 60 else "a_mejorar"


def resumen_calidad(textos: list[str]) -> dict[str, Any]:
    """La calidad de varios feedback: promedio, cuántos cortos y largos, qué señal falta más y qué hacer."""
    evs = [evaluar_feedback(t) for t in textos if (t or "").strip()]
    if not evs:
        return {"feedbacks": 0, "puntaje": None, "nivel": None, "cortos": 0, "largos": 0, "senales": {}, "recomendaciones": []}
    faltas = Counter(k for e in evs for k in e["faltan"])
    prom = round(sum(e["puntaje"] for e in evs) / len(evs))
    recs = [{"clave": k, "veces": v, "texto": CONSEJOS[k]} for k, v in faltas.most_common(3) if v / len(evs) >= 0.25]
    return {
        "feedbacks": len(evs), "puntaje": prom, "nivel": nivel(prom),
        "cortos": sum(1 for e in evs if e["problema"] == "corto"), "largos": sum(1 for e in evs if e["problema"] == "largo"),
        "palabras_prom": round(sum(e["palabras"] for e in evs) / len(evs)),
        "senales": {k: round(sum(1 for e in evs if e["senales"][k]) / len(evs) * 100) for k in CRITERIOS},
        "recomendaciones": recs,
    }


# ------------------------------------------------------------------ ánimo (sentimiento) del supervisor
EMOCIONES: dict[str, tuple[int, tuple[str, ...]]] = {
    # emoción: (signo, raíces sin tildes)
    "motivacion": (1, ("motivad", "con ganas", "ganas de", "energia", "entusias", "animad", "confiad", "orgullos", "vamos por")),
    "satisfaccion": (1, ("content", "feliz", "logramos", "logre", "superamos", "supere", "excelente", "genial", "cumpli",
                         "alcanzamos", "alcance", "buen dia", "muy bien", "salio bien", "salio todo")),
    "cansancio": (-1, ("cansad", "agotad", "exhaust", "no doy mas", "sin energia", "rendid", "dormi poco", "fundid", "muert")),
    "frustracion": (-1, ("frustr", "bronca", "enoj", "molest", "impotencia", "harto", "harta", "no sirve", "desastre",
                         "decepcion", "nadie me", "otra vez lo mismo")),
    "preocupacion": (-1, ("preocup", "miedo", "ansied", "nervios", "incertid", "inquiet", "me cuesta", "no se si")),
    "estres": (-1, ("estres", "presion", "desbord", "saturad", "colapsad", "a mil", "no llego", "no llegue", "no llegamos",
                    "sobrecarg", "tapad")),
}
_POSITIVAS = ("bien", "bueno", "buena", "mejor", "mejoro", "avanz", "cumpl", "facil", "tranquil", "positiv", "exito", "gracias")
_NEGATIVAS = ("mal", "dificil", "complicad", "problema", "falto", "faltaron", "peor", "bajo", "baja", "cayo", "perdi",
              "ausent", "renunci", "conflict", "queja", "negativ", "pesad")
_NEGACION = {"no", "nunca", "ni", "sin", "tampoco", "nada"}
_INTENSIDAD = {"muy", "re", "super", "demasiado", "bastante", "tan", "recontra", "sumamente", "totalmente"}
ANIMO_PESO = {"bien": 0.7, "normal": 0.0, "dificil": -0.7}


def _negado(tokens: list[str], i: int) -> bool:
    return any(t in _NEGACION for t in tokens[max(0, i - 3):i])


def _intenso(tokens: list[str], i: int) -> bool:
    return any(t in _INTENSIDAD for t in tokens[max(0, i - 2):i])


def detectar_animo(texto: str | None, elegido: str | None = None) -> dict[str, Any]:
    """El ánimo de un texto (y de lo que eligió la persona): polaridad −1 a 1, etiqueta, emociones y las palabras."""
    t = plano(texto or "")
    tokens = re.findall(r"[a-zñ]+", t)
    junto = " ".join(tokens)
    puntos = 0.0
    emociones: Counter = Counter()
    indicios: list[str] = []
    # Emociones (frases y raíces), con negación e intensidad mirando las palabras de antes.
    for emo, (signo, raices) in EMOCIONES.items():
        for r in raices:
            for m in re.finditer(r"\b" + re.escape(r.strip()), junto):
                i = len(junto[:m.start()].split())
                if _negado(tokens, i):
                    puntos -= 0.5 * signo
                    continue
                peso = 1.5 if _intenso(tokens, i) else 1.0
                puntos += 1.4 * signo * peso
                emociones[emo] += 1
                indicios.append(junto[m.start():m.start() + 24].split(" ")[0] if " " not in r.strip() else r.strip())
    usados = {w for w in indicios}
    for i, w in enumerate(tokens):
        if any(w.startswith(p) for p in _POSITIVAS) and w not in usados:
            puntos += (-0.6 if _negado(tokens, i) else 0.6 * (1.5 if _intenso(tokens, i) else 1.0))
        elif any(w.startswith(p) for p in _NEGATIVAS) and w not in usados:
            puntos += (0.3 if _negado(tokens, i) else -0.8 * (1.5 if _intenso(tokens, i) else 1.0))
    texto_pol = max(-1.0, min(1.0, puntos / max(3.0, len(tokens) ** 0.5 * 1.2))) if tokens else 0.0
    if elegido in ANIMO_PESO:
        pol = 0.6 * ANIMO_PESO[elegido] + 0.4 * texto_pol
        mixto = (ANIMO_PESO[elegido] > 0 and texto_pol < -0.3) or (ANIMO_PESO[elegido] < 0 and texto_pol > 0.3)
    else:
        pol, mixto = texto_pol, False
    pol = round(pol, 2)
    etiqueta = "mixto" if mixto else "positivo" if pol >= 0.2 else "negativo" if pol <= -0.2 else "neutral"
    return {
        "polaridad": pol, "etiqueta": etiqueta, "texto": round(texto_pol, 2), "elegido": elegido,
        "emociones": [e for e, _ in emociones.most_common()], "indicios": list(dict.fromkeys(indicios))[:6],
    }


def alerta_animo(dias: list[dict[str, Any]]) -> str | None:
    """Señal para el jefe con los últimos cierres (del más nuevo al más viejo)."""
    etiquetas = [d["etiqueta"] for d in dias if d]
    if len(etiquetas) >= 2 and etiquetas[0] == "negativo" and etiquetas[1] == "negativo":
        return "Dos cierres seguidos con ánimo negativo: conviene una charla."
    desgaste = sum(1 for d in dias[:5] if d and {"cansancio", "estres"} & set(d.get("emociones") or []))
    if desgaste >= 3:
        return "Cansancio o estrés en 3 de los últimos 5 cierres."
    if etiquetas and etiquetas[0] == "negativo":
        return "Cerró el día con ánimo negativo."
    if etiquetas and etiquetas[0] == "mixto":
        return "Dijo que está bien, pero el texto dice otra cosa."
    return None


# ------------------------------------------------------------------ clima del equipo: tono del feedback y voz del asesor
# Tono de una devolución (cómo la recibe el asesor): reconocimiento (destaca lo que hizo bien y no marca faltas),
# constructivo (lo que tiene que mejorar con una acción) o crítico (marca faltas sin reconocer nada ni proponer cómo).
_CRITICA = ("mal", "no hizo", "no hace", "no pregunt", "no ofrec", "no presento", "no confirm", "no valid", "no cerro",
            "error", "otra vez", "de nuevo", "siempre", "nunca", "falta", "falto", "inaceptable", "grave", "pesim",
            "no puede ser", "no sirve", "llamado de atencion", "advert", "descuid")
_MEJORA = (" pero ", "aunque", "proxima", "tenes que", "tiene que", "mejorar", "deberia", "hay que", "te falta", "le falta")
TONOS = ("reconocimiento", "constructivo", "critico")
TONO_VALOR = {"reconocimiento": 1.0, "constructivo": 0.25, "critico": -0.8}   # cómo pesa en el ánimo del equipo


def tono_feedback(texto: str | None) -> str | None:
    t = f" {plano(texto or '')} "
    if len(t.strip()) < 3:
        return None
    rec = _tiene(t, _RECONOCIMIENTO)
    acc = _tiene(t, _ACCION)
    crit = sum(1 for k in _CRITICA if k in t)
    if crit >= 2 and not rec or crit >= 1 and not rec and not acc:
        return "critico"
    if rec and crit == 0 and not _tiene(t, _MEJORA):
        return "reconocimiento"
    return "constructivo"


# Voz del asesor (lo que dice al firmar y los compromisos que dicta): entusiasmo, desmotivación, desacuerdo y las
# palabras de riesgo (renuncia, maltrato…), que siempre se miran aunque el resto del texto sea neutro.
VOZ: dict[str, tuple[int, tuple[str, ...]]] = {
    "entusiasmo": (1, ("me gusta", "me encanta", "con ganas", "vamos", "dale", "genial", "buenisimo", "gracias", "me sirve",
                       "me sirvio", "entendi", "clarisimo", "perfecto", "voy a mejorar", "lo voy a", "me comprometo")),
    "desmotivacion": (-1, ("no tengo ganas", "desmotiv", "para que", "da igual", "no vale la pena", "no se puede", "imposible",
                           "cansad", "agotad", "harto", "harta", "no doy mas", "aburrid", "sin sentido")),
    "desacuerdo": (-1, ("no estoy de acuerdo", "no es asi", "no fue asi", "no es justo", "no corresponde", "no me parece",
                        "siempre a mi", "no es mi culpa", "no fue mi culpa", "me tienen", "me persigu")),
}
RIESGO = ("renuncia", "renunciar", "renuncio", "me voy", "me quiero ir", "dejar el trabajo", "maltrato", "maltrata", "acoso",
          "acosa", "injusto", "injusticia", "discrimin", "me gritaron", "me grito", "humill", "amenaz", "denuncia")
_PROPOSITIVO = ("voy a", "me comprometo", "lo voy a", "a partir de", "desde manana", "manana", "practicar", "probar",
                "mejorar", "intentar", "aplicar", "gracias", "entendi", "dale", "de acuerdo")


def riesgos(texto: str | None) -> list[str]:
    """Las palabras de riesgo del texto (sin negación delante: «no me voy» no cuenta)."""
    t = " ".join(re.findall(r"[a-zñ]+", plano(texto or "")))
    out = []
    for r in RIESGO:
        for m in re.finditer(r"\b" + re.escape(r), t):
            antes = t[:m.start()].split()[-2:]
            if not _NEGACION & set(antes):
                out.append(r)
                break
    return out


def voz_asesor(texto: str | None) -> dict[str, Any]:
    """El ánimo de lo que dijo el asesor: polaridad −1 a 1, emociones de la voz, palabras de riesgo y si es propositivo."""
    base = detectar_animo(texto)
    t = " ".join(re.findall(r"[a-zñ]+", plano(texto or "")))
    tokens = t.split()
    puntos, emociones = 0.0, Counter()
    for emo, (signo, raices) in VOZ.items():
        for r in raices:
            for m in re.finditer(r"\b" + re.escape(r), t):
                i = len(t[:m.start()].split())
                if signo > 0 and _negado(tokens, i):
                    continue
                puntos += signo * (1.5 if _intenso(tokens, i) else 1.0)
                emociones[emo] += 1
    pol = base["texto"] + (puntos / max(2.0, len(tokens) ** 0.5) if tokens else 0.0)
    rs = riesgos(texto)
    if rs:
        pol = min(pol, -0.6)
    pol = round(max(-1.0, min(1.0, pol)), 2)
    return {"polaridad": pol, "emociones": [e for e, _ in emociones.most_common()] + [e for e in base["emociones"] if e not in emociones],
            "riesgo": rs, "propositivo": _tiene(f" {t} ", _PROPOSITIVO), "palabras": len(tokens)}
