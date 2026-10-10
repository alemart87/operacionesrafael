"""Palabras clave de los informes diarios: qué temas aparecen, cuántas veces y con qué urgencia.

Algoritmo (explicable y sin servicios externos):
1. Normaliza el texto (minúsculas, sin tildes) sin mover las posiciones: cada letra pasa a su letra base, así lo
   encontrado se resalta en el texto original.
2. Lo separa en palabras y busca las claves de cada tema: primero las frases («sin uso», «caída del sistema»),
   después las palabras sueltas con su plural («venta» → «ventas») o las raíces con «*» («ausen*» → ausencia,
   ausente, ausentismo).
3. Negación: una clave precedida (hasta 2 palabras antes, en la misma frase: sin coma ni punto entre medio) por
   «no», «sin», «ningún», «nunca», «tampoco», «ni» o «nada» no cuenta: queda como negada («no hubo caídas»; en
   «riesgo de no llegar, urgente revisar», «urgente» sí cuenta).
4. Cuenta por clave y por tema. Las menciones de los temas críticos (riesgo, urgencia) definen el nivel de alerta
   del informe: alto con 3 o más, medio con 1 o 2, bajo sin ninguna.

El diccionario lo edita el superadmin (temas, palabras y cuáles son críticos); sin cambios, vale `TEMAS_DEFECTO`.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any, Iterable

NEGADORES = frozenset({"no", "sin", "ningun", "ninguna", "ninguno", "nunca", "tampoco", "nada", "ni"})
VENTANA_NEGACION = 2
ALTO, MEDIO = 3, 1             # menciones críticas para el nivel alto / medio
MAX_TEMAS, MAX_PALABRAS, MIN_RAIZ = 15, 80, 3

TEMAS_DEFECTO: list[dict[str, Any]] = [
    {"clave": "riesgo", "nombre": "Riesgo y urgencia", "critico": True, "palabras": [
        "urgente", "urgencia", "critic*", "riesgo*", "grave*", "alerta*", "incumpl*", "fraude*", "denuncia*",
        "sancion*", "vencid*", "fuera de plazo", "fuera de termino", "reclamo formal", "perdida*", "escalar",
        "escalamiento"]},
    {"clave": "ventas", "nombre": "Ventas y objetivos", "critico": False, "palabras": [
        "venta", "netas", "neta", "objetivo*", "meta", "metas", "proyeccion*", "cierre", "pospago", "gpon", "fibra",
        "carga", "activacion*", "conversion*", "efectividad", "sph", "portabilidad", "portacion*"]},
    {"clave": "uso", "nombre": "Uso de líneas", "critico": False, "palabras": [
        "sin uso", "lineas sin uso", "linea sin uso", "uso de lineas", "uso de la linea", "consumo", "recupero*",
        "recuperar", "pfi", "en espera"]},
    {"clave": "calidad", "nombre": "Calidad y atención", "critico": False, "palabras": [
        "conversacion*", "calidad", "escucha*", "guion", "reclamo*", "queja*", "atencion", "aht", "contacto*",
        "llamadas cortas", "tipificacion*", "pausa*"]},
    {"clave": "personal", "nombre": "Personal y asistencia", "critico": False, "palabras": [
        "ausen*", "inasistencia*", "tardanza*", "llego tarde", "llegaron tarde", "licencia*", "reposo*",
        "rotacion", "renuncia*", "desvincul*", "dotacion", "asistencia", "presentismo", "vacaciones", "falto",
        "faltaron"]},
    {"clave": "sistemas", "nombre": "Sistemas y conectividad", "critico": False, "palabras": [
        "caida del sistema", "caida de sistema", "caidas del sistema", "sistema*", "caida*", "se cayo", "caido", "plataforma", "discador", "crm", "lentitud", "lento", "falla*",
        "conexion", "conectividad", "sin conexion", "sin sistema", "sin internet", "servidor*"]},
    {"clave": "gestion", "nombre": "Coaching y gestión", "critico": False, "palabras": [
        "coaching*", "capacitaci*", "feedback", "devolucion*", "retroaliment*", "entrenamiento*",
        "plan de accion", "seguimiento*", "compromiso*"]},
    {"clave": "logros", "nombre": "Logros y mejoras", "critico": False, "palabras": [
        "record", "supero", "superamos", "superaron", "por encima", "mejor*", "crecimiento", "crecio", "felicit*",
        "reconocimiento*", "excelente", "destacad*"]},
]


# ------------------------------------------------------------------ normalización (conserva las posiciones)
def _base(ch: str) -> str:
    if ch.isascii():
        return ch.lower()
    d = unicodedata.normalize("NFKD", ch)
    b = (d[0] if d else ch).lower()
    return b[0] if b else " "


def normalizar(texto: str) -> str:
    """Minúsculas y sin tildes, con el mismo largo que el original (para resaltar en él)."""
    return "".join(_base(c) for c in texto or "")


_PALABRA = re.compile(r"[a-z0-9]+")
_CORTE = re.compile(r"[,.;:!?()\[\]\n]")     # fin de frase o de cláusula: la negación no pasa


def tokens(texto: str) -> list[tuple[str, int, int]]:
    return [(m.group(), m.start(), m.end()) for m in _PALABRA.finditer(normalizar(texto))]


def _variantes(p: str) -> set[str]:
    """Una palabra y su plural (venta → ventas, conexion → conexiones, vez → veces)."""
    v = {p}
    if p.endswith("z"):
        v.add(p[:-1] + "ces")
    elif p.endswith(("a", "e", "i", "o", "u")):
        v.add(p + "s")
    else:
        v.add(p + "es")
    return v


# ------------------------------------------------------------------ diccionario compilado
@dataclass(frozen=True)
class Clave:
    texto: str                       # como se escribió (se muestra)
    partes: tuple[frozenset[str] | str, ...]   # cada parte: variantes exactas, o la raíz (str) si termina en *
    tema: str
    critico: bool


class Diccionario:
    """Las claves de todos los temas, indexadas para buscar rápido (por palabra exacta y por las 3 primeras letras
    de las raíces)."""

    def __init__(self, temas: list[dict[str, Any]]):
        self.temas = {t["clave"]: {"nombre": t["nombre"], "critico": bool(t.get("critico"))} for t in temas}
        self._exactas: dict[str, list[Clave]] = defaultdict(list)
        self._raices: dict[str, list[Clave]] = defaultdict(list)
        for t in temas:
            for txt in t.get("palabras") or []:
                partes = [p for p in normalizar(txt.replace("*", " * ")).split() if p]
                if not partes or partes[0] == "*":
                    continue
                comp: list[frozenset[str] | str] = []
                for k, p in enumerate(partes):
                    if p == "*":
                        continue
                    raiz = k + 1 < len(partes) and partes[k + 1] == "*"
                    comp.append(p if raiz else frozenset(_variantes(p)))
                c = Clave(txt.strip(), tuple(comp), t["clave"], bool(t.get("critico")))
                primera = comp[0]
                if isinstance(primera, str):
                    self._raices[primera[:MIN_RAIZ]].append(c)
                else:
                    for v in primera:
                        self._exactas[v].append(c)
        for lista in (*self._exactas.values(), *self._raices.values()):
            lista.sort(key=lambda c: -len(c.partes))   # primero las frases más largas

    def candidatas(self, palabra: str) -> list[Clave]:
        return [*self._exactas.get(palabra, ()), *self._raices.get(palabra[:MIN_RAIZ], ())]


def _coincide(parte: frozenset[str] | str, palabra: str) -> bool:
    return palabra.startswith(parte) if isinstance(parte, str) else palabra in parte


def buscar(texto: str, dic: Diccionario) -> list[dict[str, Any]]:
    """Las claves que aparecen en el texto, con su posición en el original y si están negadas."""
    ts = tokens(texto)
    out: list[dict[str, Any]] = []
    usadas: set[int] = set()   # palabras que ya son parte de una clave: no niegan a la que sigue («sin uso Pospago»)
    i = 0
    while i < len(ts):
        hallada = None
        for c in dic.candidatas(ts[i][0]):
            n = len(c.partes)
            if i + n <= len(ts) and all(_coincide(p, ts[i + k][0]) for k, p in enumerate(c.partes)):
                hallada = c
                break
        if not hallada:
            i += 1
            continue
        n = len(hallada.partes)
        negada = any(ts[j][0] in NEGADORES and j not in usadas and not _CORTE.search(texto, ts[j][2], ts[i][1])
                     for j in range(max(0, i - VENTANA_NEGACION), i))
        usadas.update(range(i, i + n))
        out.append({"clave": hallada.texto, "tema": hallada.tema, "critico": hallada.critico, "negada": negada,
                    "ini": ts[i][1], "fin": ts[i + n - 1][2]})
        i += n
    return out


# ------------------------------------------------------------------ un informe y varios
def nivel(criticas: int) -> str:
    return "alto" if criticas >= ALTO else "medio" if criticas >= MEDIO else "bajo"


def analizar(campos: Iterable[tuple[str, str]], dic: Diccionario) -> dict[str, Any]:
    """`campos`: (nombre del campo, texto). Cuenta por clave y por tema y marca dónde está cada una."""
    claves: Counter = Counter()
    temas: Counter = Counter()
    formas: dict[str, Counter] = {}     # cómo aparece cada clave en el texto («caída del sistema», «riesgos»)
    marcas: dict[str, list[list[Any]]] = {}
    criticas = negadas = 0
    tema_de: dict[str, str] = {}
    for campo, texto in campos:
        if not texto:
            continue
        hs = buscar(texto, dic)
        if hs:
            marcas[campo] = [[h["ini"], h["fin"], h["tema"], h["critico"], h["negada"]] for h in hs]
        for h in hs:
            if h["negada"]:
                negadas += 1
                continue
            claves[h["clave"]] += 1
            formas.setdefault(h["clave"], Counter())[texto[h["ini"]:h["fin"]].lower()] += 1
            tema_de[h["clave"]] = h["tema"]
            temas[h["tema"]] += 1
            criticas += h["critico"]
    return {
        "total": sum(claves.values()), "criticas": criticas, "negadas": negadas, "nivel": nivel(criticas),
        "temas": dict(temas),
        "claves": [{"clave": k, "forma": formas[k].most_common(1)[0][0], "tema": tema_de[k], "n": n}
                   for k, n in sorted(claves.items(), key=lambda x: (-x[1], x[0]))],
        "marcas": marcas,
    }


def agregar(analisis: list[tuple[dict[str, Any], dict[str, Any]]], dic: Diccionario) -> dict[str, Any]:
    """`analisis`: (informe resumido con fecha, autor…, su análisis). Temas y claves del período, por día y las
    alertas (los informes con nivel alto o medio)."""
    temas: Counter = Counter()
    informes_tema: Counter = Counter()
    claves: Counter = Counter()
    informes_clave: Counter = Counter()
    tema_de: dict[str, str] = {}
    formas: dict[str, Counter] = {}
    por_dia: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "criticas": 0, "informes": 0})
    alertas = []
    for inf, a in analisis:
        temas.update(a["temas"])
        informes_tema.update(a["temas"].keys())
        for c in a["claves"]:
            claves[c["clave"]] += c["n"]
            informes_clave[c["clave"]] += 1
            tema_de[c["clave"]] = c["tema"]
            formas.setdefault(c["clave"], Counter())[c.get("forma") or c["clave"]] += c["n"]
        d = por_dia[inf["fecha"]]
        d["total"] += a["total"]
        d["criticas"] += a["criticas"]
        d["informes"] += 1
        if a["nivel"] != "bajo":
            alertas.append({**inf, "nivel": a["nivel"], "criticas": a["criticas"],
                            "claves": [c.get("forma") or c["clave"] for c in a["claves"] if dic.temas.get(c["tema"], {}).get("critico")][:6]})
    alertas.sort(key=lambda x: x["fecha"], reverse=True)                  # lo más nuevo primero…
    alertas.sort(key=lambda x: (x["nivel"] != "alto", -x["criticas"]))     # …dentro de cada nivel
    return {
        "temas": [{"clave": t, "nombre": info["nombre"], "critico": info["critico"], "n": temas.get(t, 0),
                   "informes": informes_tema.get(t, 0)} for t, info in dic.temas.items()],
        "claves": [{"clave": k, "forma": formas[k].most_common(1)[0][0], "tema": tema_de[k], "n": n, "informes": informes_clave[k]}
                   for k, n in sorted(claves.items(), key=lambda x: (-x[1], x[0]))[:30]],
        "por_dia": [{"fecha": f, **v} for f, v in sorted(por_dia.items())],
        "alertas": alertas[:50],
    }


# ------------------------------------------------------------------ validar lo que edita el superadmin
_CLAVE_TEMA = re.compile(r"^[a-z][a-z0-9_]{1,29}$")


class DiccionarioInvalido(ValueError):
    pass


def validar(temas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not temas:
        raise DiccionarioInvalido("Tiene que haber al menos un tema")
    if len(temas) > MAX_TEMAS:
        raise DiccionarioInvalido(f"Hasta {MAX_TEMAS} temas")
    out, vistas = [], set()
    for t in temas:
        clave = str(t.get("clave") or "").strip()
        nombre = str(t.get("nombre") or "").strip()
        if not _CLAVE_TEMA.match(clave) or clave in vistas:
            raise DiccionarioInvalido(f"Clave de tema inválida o repetida: «{clave}»")
        if not 2 <= len(nombre) <= 60:
            raise DiccionarioInvalido(f"El tema «{clave}» necesita un nombre (2 a 60 caracteres)")
        palabras: list[str] = []
        for p in t.get("palabras") or []:
            p = " ".join(str(p).split()).lower()
            if not p:
                continue
            if not 2 <= len(p) <= 40:
                raise DiccionarioInvalido(f"«{p[:40]}»: cada palabra o frase va de 2 a 40 caracteres")
            if "*" in p[:-1]:
                raise DiccionarioInvalido(f"«{p}»: el * va solo al final")
            if p.endswith("*") and len((normalizar(p[:-1]).split() or [""])[-1]) < MIN_RAIZ:
                raise DiccionarioInvalido(f"«{p}»: antes del * van al menos {MIN_RAIZ} letras")
            if not tokens(p):
                raise DiccionarioInvalido(f"«{p}» no tiene letras")
            if p not in palabras:
                palabras.append(p)
        if not palabras:
            raise DiccionarioInvalido(f"El tema «{nombre}» necesita al menos una palabra")
        if len(palabras) > MAX_PALABRAS:
            raise DiccionarioInvalido(f"Hasta {MAX_PALABRAS} palabras por tema")
        vistas.add(clave)
        out.append({"clave": clave, "nombre": nombre, "critico": bool(t.get("critico")), "palabras": palabras})
    return out
