"""Análisis de productividad de llamadas: informe del día y acumulado de períodos.

Definiciones (las mismas en el día, la semana y el mes):

- Conectados: agentes con tiempo de login en el día.
- Sesión abierta: login de `sesion_abierta_horas` o más (12 h por defecto). El
  agente quedó logueado: es alerta y su tiempo no entra en los porcentajes ni en
  la jornada media (sus llamadas sí se cuentan en el volumen del día).
- % de conversación = tiempo de conversación ÷ tiempo conectado. Meta: entre
  `meta_min` y `meta_max` (37–47%); debajo de `rojo` (25%), rojo.
- Contacto: llamada con `contacto_desde_seg` (30 s) o más de conversación; debajo puede
  ser el contestador, un mensaje de la operadora o un corte durante la presentación.
  El archivo trae cuántas llamadas duraron menos de N s (columnas "Short Talk < Ns",
  puede traer varias): contactos = llamadas − cortas del umbral de la regla. Si el
  archivo no trae ese umbral, el contacto no es válido y la pantalla no lo muestra.
  % de contacto = contactos ÷ llamadas.
- Modo: con tiempo de tipificación (ACW) → discador automático; sin ACW → discado manual.
- Turno: con un corte cerca del `cambio_turno` (13:00) y otro posterior, es de la
  mañana quien antes de ese corte ya había hecho la mayor parte de su jornada.
- Tramos (intradía): diferencia entre cortes consecutivos del mismo día.

Los totales se calculan sumando tiempos y llamadas, nunca promediando porcentajes.
Todo es lógica pura (sin DB): el día se analiza a partir de las filas de sus cortes
y el acumulado a partir de los datos de los informes publicados.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime
from typing import Any, Iterable

from .parser import clave_agente, es_prueba, nombre_visible

VERSION_ANALISIS = 1

PARAMETROS_DEFECTO: dict[str, Any] = {
    "meta_min": 37.0,             # % de conversación: piso de la meta
    "meta_max": 47.0,             # % de conversación: techo de la meta
    "rojo": 25.0,                 # % de conversación: debajo, rojo
    "sesion_abierta_horas": 12,   # login igual o mayor: sesión que quedó abierta
    "cambio_turno": "13:00",      # hora de cambio entre el turno mañana y el tarde
    "min_llamadas_ranking": 20,   # llamadas mínimas para entrar al ranking de efectividad
    "contacto_desde_seg": 30,     # conversación mínima para contar la llamada como contacto con el cliente
}

BANDAS = ("rojo", "bajo", "meta", "sobre")
TURNOS = ("manana", "tarde")
MODOS = ("auto", "manual")

TIEMPOS = ("login", "ready", "not_ready", "handle", "conversacion", "hold", "acw")
CONTADORES = ("llamadas", "cortas")
CAMPOS = TIEMPOS + CONTADORES

# Sumas que guarda cada registro (agente, modo, turno, día). La parte "_val" es la de
# las jornadas válidas (sin sesión abierta): sobre ella se calculan los porcentajes.
SUMAS = (
    *CAMPOS, "atendidas", "gestionadas",
    "login_val", "conv_val", "ready_val", "nr_val", "handle_val", "hold_val", "acw_val", "llamadas_val",
    "dias", "dias_validos", "dias_sesion_abierta", "dias_sin_llamadas",
)

MIN_SIN_LLAMADAS = 30 * 60      # conectado 30 min o más sin ninguna llamada: alerta
VENTANA_TURNO_MIN = 150         # el corte de mitad de día puede estar a ±2 h 30 min del cambio de turno
MIN_LLAMADAS_TRAMO = 30         # para elegir el tramo de mayor / menor efectividad


# ------------------------------------------------------------------ utilidades
def _pct(a: float, b: float) -> float | None:
    return round(a / b * 100, 1) if b else None


def _div(a: float, b: float, nd: int = 1) -> float | None:
    return round(a / b, nd) if b else None


def _minutos(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _hhmm(dt: datetime) -> str:
    return dt.strftime("%H:%M")


def banda(pct: float | None, p: dict[str, Any]) -> str | None:
    """rojo < 25% ≤ bajo < 37% ≤ meta ≤ 47% < sobre."""
    if pct is None:
        return None
    if pct < p["rojo"]:
        return "rojo"
    if pct < p["meta_min"]:
        return "bajo"
    if pct <= p["meta_max"]:
        return "meta"
    return "sobre"


def validar_parametros(datos: dict[str, Any]) -> dict[str, Any]:
    """Parámetros completos y coherentes. Lanza ValueError con un mensaje claro."""
    p = {**PARAMETROS_DEFECTO, **{k: v for k, v in (datos or {}).items() if k in PARAMETROS_DEFECTO}}
    try:
        p["meta_min"], p["meta_max"], p["rojo"] = float(p["meta_min"]), float(p["meta_max"]), float(p["rojo"])
        p["sesion_abierta_horas"] = int(p["sesion_abierta_horas"])
        p["min_llamadas_ranking"] = int(p["min_llamadas_ranking"])
        p["contacto_desde_seg"] = int(p["contacto_desde_seg"])
    except (TypeError, ValueError) as exc:
        raise ValueError("Los parámetros deben ser números.") from exc
    if not 0 < p["rojo"] < p["meta_min"] < p["meta_max"] <= 100:
        raise ValueError("Tiene que cumplirse: 0 < rojo < meta mínima < meta máxima ≤ 100.")
    if not 6 <= p["sesion_abierta_horas"] <= 24:
        raise ValueError("La sesión abierta se mide entre 6 y 24 horas.")
    if not 1 <= p["min_llamadas_ranking"] <= 1000:
        raise ValueError("Las llamadas mínimas del ranking van de 1 a 1000.")
    if not 5 <= p["contacto_desde_seg"] <= 120:
        raise ValueError("El contacto se mide desde 5 hasta 120 segundos de conversación.")
    try:
        minutos = _minutos(str(p["cambio_turno"]))
    except (ValueError, AttributeError) as exc:
        raise ValueError("El cambio de turno va en formato HH:MM.") from exc
    if not 8 * 60 <= minutos <= 18 * 60:
        raise ValueError("El cambio de turno tiene que estar entre las 08:00 y las 18:00.")
    p["cambio_turno"] = f"{minutos // 60:02d}:{minutos % 60:02d}"
    return p


# ------------------------------------------------------------------ registros: sumar y derivar
def _vacio() -> dict[str, int]:
    return dict.fromkeys(SUMAS, 0)


def sumar(registros: Iterable[dict[str, Any]]) -> dict[str, int]:
    out = _vacio()
    for r in registros:
        for k in SUMAS:
            out[k] += r.get(k) or 0
    return out


def derivar(r: dict[str, Any], p: dict[str, Any]) -> dict[str, Any]:
    """Indicadores a partir de las sumas: sirve igual para un agente, un modo, un turno, un día o un mes."""
    lv = r["login_val"]
    pct_conv = _pct(r["conv_val"], lv)
    return {
        **r,
        "pct_conversacion": pct_conv,
        "banda": banda(pct_conv, p),
        "pct_contacto": _pct(r["atendidas"], r["llamadas"]),
        "prom_conversacion": _div(r["conversacion"], r["llamadas"]),
        "aht": _div(r["handle"], r["gestionadas"]),
        "jornada_media": _div(lv, r["dias_validos"], 0),
        "llamadas_hora": _div(r["llamadas_val"], lv / 3600 if lv else 0),
        "pct_disponible": _pct(r["ready_val"], lv),
        "pct_pausa": _pct(r["nr_val"], lv),
        "pct_gestion": _pct(r["handle_val"], lv),
        "pct_tipificacion": _pct(r["acw_val"], lv),
        "pct_espera": _pct(r["hold_val"], lv),
        "pct_otros": _pct(max(lv - r["ready_val"] - r["nr_val"] - r["handle_val"], 0), lv),
    }


def _registro_agente_dia(v: dict[str, int], aht_plataforma: int | None, p: dict[str, Any]) -> dict[str, Any]:
    """Sumas de un agente en un día a partir de sus totales acumulados."""
    abierta = v["login"] >= p["sesion_abierta_horas"] * 3600
    sin_llamadas = v["llamadas"] == 0 and v["login"] >= MIN_SIN_LLAMADAS
    # La plataforma calcula el AHT sobre todas las interacciones (también las que no vienen en el
    # archivo, p. ej. entrantes): de su AHT sale cuántas gestionó, para que el AHT del equipo coincida.
    gestionadas = max(v["llamadas"], round(v["handle"] / aht_plataforma)) if aht_plataforma else v["llamadas"]
    r = {**{k: v[k] for k in CAMPOS}, "atendidas": max(v["llamadas"] - v["cortas"], 0), "gestionadas": gestionadas,
         "dias": 1, "dias_validos": 0 if abierta else 1, "dias_sesion_abierta": 1 if abierta else 0,
         "dias_sin_llamadas": 1 if sin_llamadas else 0}
    val = not abierta
    r.update({
        "login_val": v["login"] if val else 0, "conv_val": v["conversacion"] if val else 0,
        "ready_val": v["ready"] if val else 0, "nr_val": v["not_ready"] if val else 0,
        "handle_val": v["handle"] if val else 0, "hold_val": v["hold"] if val else 0,
        "acw_val": v["acw"] if val else 0, "llamadas_val": v["llamadas"] if val else 0,
    })
    return r


def _modo(v: dict[str, int]) -> str:
    if v["llamadas"] == 0:
        return "sin_llamadas"
    return "auto" if v["acw"] > 0 else "manual"


def _alertas(r: dict[str, Any]) -> list[str]:
    out = []
    if r["dias_sesion_abierta"]:
        out.append("sesion_abierta")
    if r["dias_sin_llamadas"]:
        out.append("sin_llamadas")
    return out


def _bandas(registros: Iterable[dict[str, Any]]) -> dict[str, int]:
    c = Counter(r["banda"] for r in registros if r.get("banda"))
    return {b: c.get(b, 0) for b in BANDAS}


def _resumen(agentes: list[dict[str, Any]], p: dict[str, Any]) -> dict[str, Any]:
    r = derivar(sumar(agentes), p)
    r["bandas"] = _bandas(agentes)
    r["agentes"] = r["dias"]
    r["agentes_validos"] = r["dias_validos"]
    return r


# ------------------------------------------------------------------ informe del día
def analizar_dia(fecha: date, cortes: list[dict[str, Any]], p: dict[str, Any]) -> dict[str, Any]:
    """Informe de un día.

    `cortes`: [{"id", "hora": datetime local, "archivo", "filas": [filas de parse_tiempos]}].
    El último corte define los totales del día; los anteriores, los tramos intradía.
    """
    if not cortes:
        raise ValueError("El día no tiene cortes.")
    cortes = sorted(cortes, key=lambda c: c["hora"])
    n = len(cortes)
    avisos: list[str] = []
    prueba: set[str] = set()
    nombres: dict[str, str] = {}
    aht_plataforma: dict[str, int | None] = {}
    serie: dict[str, list[dict[str, int] | None]] = {}

    for i, corte in enumerate(cortes):
        # Columna de cortas a usar: la del umbral de la regla si viene; si no, la más cercana por debajo.
        corte["umbral_cortas"] = elegir_umbral(corte.get("umbrales") or [], p["contacto_desde_seg"])
        vistos: Counter = Counter()
        for f in corte["filas"]:
            f["cortas"] = (f.get("cortas_por_umbral") or {}).get(corte["umbral_cortas"], f.get("cortas", 0))
            if es_prueba(f["nombre"]):
                prueba.add(f["nombre"])
                continue
            k = clave_agente(f["nombre"])
            if not k:
                continue
            vistos[k] += 1
            if vistos[k] > 1:  # mismo nombre dos veces en el reporte: son personas distintas
                k = f"{k} #{vistos[k]}"
            nombres[k] = nombre_visible(f["nombre"]) + (f" ({vistos[k]})" if "#" in k else "")
            serie.setdefault(k, [None] * n)[i] = {c: int(f.get(c) or 0) for c in CAMPOS}
            aht_plataforma[k] = f.get("aht")

    # Un agente que falta en un corte conserva lo acumulado hasta el anterior.
    cero = dict.fromkeys(CAMPOS, 0)
    for s in serie.values():
        previo = cero
        for i in range(n):
            s[i] = s[i] or dict(previo)
            previo = s[i]

    # Diferencias entre cortes = lo que pasó en cada tramo. Un acumulado no puede bajar.
    tramos_agente: dict[str, list[dict[str, int]]] = {}
    bajan = Counter()
    for k, s in serie.items():
        previo, filas = cero, []
        for i in range(n):
            d = {c: s[i][c] - previo[c] for c in CAMPOS}
            if any(x < 0 for x in d.values()):
                bajan[i] += 1
                d = {c: max(x, 0) for c, x in d.items()}
            filas.append(d)
            previo = s[i]
        tramos_agente[k] = filas
    for i, cant in sorted(bajan.items()):
        avisos.append(
            f"El corte de las {_hhmm(cortes[i]['hora'])} tiene valores menores que el anterior en {cant} agente(s): "
            "¿es el reporte acumulado del día? Esos tramos se tomaron en cero."
        )

    turnos_agente, info_turnos = _turnos(cortes, serie, p)

    agentes: list[dict[str, Any]] = []
    sin_conexion: list[str] = []
    for k, s in serie.items():
        v = s[-1]
        if v["login"] <= 0:
            sin_conexion.append(nombres[k])
            continue
        r = _registro_agente_dia(v, aht_plataforma.get(k), p)
        a = derivar(r, p)
        if r["dias_sesion_abierta"]:
            a["banda"] = None  # una sesión abierta no se evalúa contra la meta
        a.update({
            "clave": k, "nombre": nombres[k], "modo": _modo(v),
            "turno": None if r["dias_sesion_abierta"] else turnos_agente.get(k),
            "alertas": _alertas(r),
            "aht": aht_plataforma.get(k) if aht_plataforma.get(k) is not None else a["aht"],
            "tramos": [[d["llamadas"], max(d["llamadas"] - d["cortas"], 0), d["conversacion"], d["login"]]
                       for d in tramos_agente[k]] if n > 1 else [],
        })
        agentes.append(a)
    agentes.sort(key=lambda a: a["nombre"])

    contacto = info_contacto((c.get("umbral_cortas") for c in cortes), p)
    if contacto["mensaje"]:
        avisos.insert(0, contacto["mensaje"])

    kpis = _resumen(agentes, p)
    kpis["interacciones_no_detalladas"] = sum(a["gestionadas"] - a["llamadas"] for a in agentes)
    if kpis["interacciones_no_detalladas"]:
        avisos.append(
            f"La plataforma registra {kpis['interacciones_no_detalladas']} interacciones que no vienen detalladas en el "
            "archivo (probablemente entrantes o internas): entran en el AHT pero no en las llamadas salientes."
        )
    if prueba:
        avisos.append(f"Se excluyeron {len(prueba)} cuenta(s) de prueba: {', '.join(sorted(prueba))}.")

    modos = {m: _resumen([a for a in agentes if a["modo"] == m], p) for m in MODOS}
    turnos: dict[str, Any] = {**info_turnos}
    for t in TURNOS:
        turnos[t] = _resumen([a for a in agentes if a["turno"] == t], p) if info_turnos["determinado"] else None

    tramos = _tramos(fecha, cortes, tramos_agente, {a["clave"] for a in agentes if not a["dias_sesion_abierta"]}, p) if n > 1 else []

    alertas = [
        {"tipo": t, "clave": a["clave"], "nombre": a["nombre"], "login": a["login"], "llamadas": a["llamadas"],
         "pct_pausa": _pct(a["not_ready"], a["login"])}
        for a in agentes for t in a["alertas"]
    ]

    return {
        "version": VERSION_ANALISIS,
        "fecha": fecha.isoformat(),
        "parametros": p,
        "cortes": [{"id": c.get("id"), "hora": _hhmm(c["hora"]), "archivo": c.get("archivo"),
                    "umbral_cortas": c.get("umbral_cortas")} for c in cortes],
        "corte_final": _hhmm(cortes[-1]["hora"]),
        "contacto": contacto,
        "kpis": kpis,
        "modos": modos,
        "turnos": turnos,
        "tramos": tramos,
        **_extremos_tramos(tramos),
        "agentes": agentes,
        "alertas": alertas,
        "sin_conexion": sorted(sin_conexion),
        "avisos": avisos,
    }


def _turnos(cortes: list[dict[str, Any]], serie: dict[str, list[dict[str, int]]], p: dict[str, Any]):
    """Turno de cada agente según cuánto de su jornada hizo antes del corte de mitad de día."""
    cambio = _minutos(p["cambio_turno"])
    horas = [c["hora"].hour * 60 + c["hora"].minute for c in cortes]
    candidatos = [i for i in range(len(cortes) - 1) if abs(horas[i] - cambio) <= VENTANA_TURNO_MIN]
    if not candidatos:
        return {}, {
            "determinado": False, "corte": None,
            "motivo": f"Para separar los turnos hace falta un corte cerca de las {p['cambio_turno']} y otro posterior "
                      "(por ejemplo, al cierre).",
        }
    i = min(candidatos, key=lambda j: abs(horas[j] - cambio))
    out = {}
    for k, s in serie.items():
        manana, total = s[i]["login"], s[-1]["login"]
        if total > 0:
            out[k] = "manana" if manana >= total - manana else "tarde"
    return out, {"determinado": True, "corte": _hhmm(cortes[i]["hora"]), "motivo": None}


def _tramos(fecha: date, cortes, tramos_agente, validos: set[str], p) -> list[dict[str, Any]]:
    out = []
    for i, corte in enumerate(cortes):
        desde = "00:00" if i == 0 else _hhmm(cortes[i - 1]["hora"])
        r = {"llamadas": 0, "atendidas": 0, "conversacion": 0, "login_val": 0, "conv_val": 0, "llamadas_val": 0,
             "agentes_activos": 0}
        for k, filas in tramos_agente.items():
            d = filas[i]
            r["llamadas"] += d["llamadas"]
            r["atendidas"] += max(d["llamadas"] - d["cortas"], 0)
            r["conversacion"] += d["conversacion"]
            if k in validos:
                r["login_val"] += d["login"]
                r["conv_val"] += d["conversacion"]
                r["llamadas_val"] += d["llamadas"]
                r["agentes_activos"] += 1 if d["login"] > 0 else 0
        minutos = (corte["hora"].hour * 60 + corte["hora"].minute) - _minutos(desde)
        out.append({"desde": desde, "hasta": _hhmm(corte["hora"]), "inicio_dia": i == 0, "minutos": minutos, "dias": 1,
                    **r, **_derivar_tramo(r, p)})
    return out


def _derivar_tramo(r: dict[str, Any], p: dict[str, Any]) -> dict[str, Any]:
    pct_conv = _pct(r["conv_val"], r["login_val"])
    return {
        "pct_contacto": _pct(r["atendidas"], r["llamadas"]),
        "pct_conversacion": pct_conv,
        "banda": banda(pct_conv, p),
        "prom_conversacion": _div(r["conversacion"], r["llamadas"]),
        "llamadas_hora": _div(r["llamadas_val"], r["login_val"] / 3600 if r["login_val"] else 0),
    }


def _extremos_tramos(tramos: list[dict[str, Any]]) -> dict[str, Any]:
    """Tramo de mayor y de menor efectividad de contacto (con volumen suficiente)."""
    candidatos = [t for t in tramos if t["llamadas"] >= MIN_LLAMADAS_TRAMO and t["pct_contacto"] is not None]
    if len(candidatos) < 2:
        return {"tramo_mejor": None, "tramo_peor": None}
    mejor = max(candidatos, key=lambda t: (t["pct_contacto"], t["llamadas"]))
    peor = min(candidatos, key=lambda t: (t["pct_contacto"], -t["llamadas"]))
    return {"tramo_mejor": {k: mejor[k] for k in ("desde", "hasta", "pct_contacto", "llamadas")},
            "tramo_peor": {k: peor[k] for k in ("desde", "hasta", "pct_contacto", "llamadas")}}


def elegir_umbral(disponibles: Iterable[int | None], regla: int) -> int | None:
    """Umbral de cortas a usar: el de la regla; si no está, el mayor por debajo (el techo más ajustado)."""
    nums = sorted(u for u in disponibles if u is not None)
    if regla in nums:
        return regla
    debajo = [u for u in nums if u < regla]
    if debajo:
        return debajo[-1]
    return nums[0] if nums else None


def info_contacto(umbrales: Iterable[int | None], p: dict[str, Any]) -> dict[str, Any]:
    """Con qué umbral se midió el contacto y si coincide con la regla del negocio."""
    medidos = sorted({u for u in umbrales if u is not None})
    regla = p["contacto_desde_seg"]
    umbral = medidos[-1] if len(medidos) == 1 else (medidos[0] if medidos else None)
    exacto = medidos == [regla]
    if exacto:
        mensaje = None
    elif not medidos:
        mensaje = (f"El archivo no indica desde cuántos segundos cuenta las llamadas cortas: el contacto no se puede "
                   f"asegurar con la regla de {regla} s.")
    elif len(medidos) > 1:
        mensaje = (f"Los archivos miden las llamadas cortas con umbrales distintos ({' y '.join(f'{u} s' for u in medidos)}): "
                   f"el contacto mezcla criterios. La regla es desde {regla} s.")
    elif umbral < regla:
        mensaje = (f"La regla de contacto es {regla} s o más de conversación, pero este archivo solo informa las llamadas de "
                   f"menos de {umbral} s: no separa las de {umbral} a {regla} s (contestador, mensaje de la operadora o corte "
                   f"durante la presentación). Con este archivo el contacto no se puede medir: hace falta el reporte con "
                   f"«Short Talk < {regla}s» o el detalle de llamadas.")
    else:
        mensaje = (f"El archivo cuenta como cortas las llamadas de menos de {umbral} s, distinto de la regla de {regla} s: "
                   f"el contacto no se puede medir. Hace falta el reporte con «Short Talk < {regla}s».")
    return {"umbral": umbral, "umbrales": medidos, "regla": regla, "exacto": exacto, "mensaje": mensaje}


def resumen_lista(data: dict[str, Any]) -> dict[str, Any]:
    """Columnas desnormalizadas del informe para la lista."""
    k = data["kpis"]
    valido = bool((data.get("contacto") or {}).get("exacto"))
    return {
        "cortes": len(data["cortes"]), "corte_final": data["corte_final"], "agentes": k["agentes"],
        "llamadas": k["llamadas"], "atendidas": k["atendidas"] if valido else 0,
        "pct_contacto": k["pct_contacto"] if valido else None,
        "pct_conversacion": k["pct_conversacion"], "banda": k["banda"],
        "jornada_media": int(k["jornada_media"]) if k["jornada_media"] is not None else None,
        "alertas": len(data["alertas"]),
    }


# ------------------------------------------------------------------ acumulado (semana, mes, rango)
def acumular(dias: list[dict[str, Any]], p: dict[str, Any]) -> dict[str, Any]:
    """Acumulado de varios días a partir de los datos de sus informes publicados.

    Mismas definiciones que el día: se suman tiempos y llamadas y se vuelven a
    calcular los indicadores (las bandas se evalúan con los parámetros vigentes).
    """
    dias = sorted(dias, key=lambda d: d["fecha"])
    serie, agentes, tramos = [], {}, {}
    modos = {m: [] for m in MODOS}
    turnos = {t: [] for t in TURNOS}
    dias_turno = 0

    for d in dias:
        k = derivar({s: d["kpis"].get(s, 0) for s in SUMAS}, p)
        serie.append({
            "fecha": d["fecha"], "informe_id": d.get("informe_id"), "cortes": len(d["cortes"]),
            "corte_final": d["corte_final"], "agentes": k["dias"], "agentes_validos": k["dias_validos"],
            "sesiones_abiertas": k["dias_sesion_abierta"], **{c: k[c] for c in (
                "llamadas", "atendidas", "cortas", "conversacion", "pct_contacto", "pct_conversacion", "banda",
                "prom_conversacion", "aht", "jornada_media", "llamadas_hora")},
        })
        for m in MODOS:
            if d["modos"].get(m):
                modos[m].append(d["modos"][m])
        if d["turnos"].get("determinado"):
            dias_turno += 1
            for t in TURNOS:
                if d["turnos"].get(t):
                    turnos[t].append(d["turnos"][t])
        for a in d["agentes"]:
            g = agentes.setdefault(a["clave"], {"clave": a["clave"], "nombre": a["nombre"], "sumas": [],
                                                "modos": Counter(), "turnos": Counter(), "bandas": Counter()})
            g["nombre"] = a["nombre"]
            g["sumas"].append(a)
            g["modos"][a["modo"]] += 1
            if a.get("turno"):
                g["turnos"][a["turno"]] += 1
            if a.get("banda"):
                g["bandas"][a["banda"]] += 1
        for t in d.get("tramos", []):
            clave = (t["desde"], t["hasta"])
            acc = tramos.setdefault(clave, {"desde": t["desde"], "hasta": t["hasta"], "inicio_dia": t["inicio_dia"],
                                            "minutos": t["minutos"], "dias": 0, "llamadas": 0, "atendidas": 0,
                                            "conversacion": 0, "login_val": 0, "conv_val": 0, "llamadas_val": 0,
                                            "agentes_activos": 0})
            for c in ("dias", "llamadas", "atendidas", "conversacion", "login_val", "conv_val", "llamadas_val",
                      "agentes_activos"):
                acc[c] += t.get(c, 0)

    lista_agentes = []
    for g in agentes.values():
        r = derivar(sumar(g["sumas"]), p)
        r.update({
            "clave": g["clave"], "nombre": g["nombre"],
            "modo": g["modos"].most_common(1)[0][0] if g["modos"] else None,
            "turno": g["turnos"].most_common(1)[0][0] if g["turnos"] else None,
            "dias_banda": {b: g["bandas"].get(b, 0) for b in BANDAS},
            "alertas": _alertas(r), "tramos": [],
        })
        lista_agentes.append(r)
    lista_agentes.sort(key=lambda a: a["nombre"])

    kpis = _resumen([{s: d["kpis"].get(s, 0) for s in SUMAS} for d in dias], p)
    kpis["bandas"] = _bandas(lista_agentes)
    kpis["agentes"] = len(lista_agentes)                       # agentes distintos del período
    kpis["agentes_validos"] = sum(1 for a in lista_agentes if a["dias_validos"])
    kpis["agentes_por_dia"] = _div(sum(s["agentes"] for s in serie), len(serie))
    kpis["llamadas_por_dia"] = _div(kpis["llamadas"], len(serie), 0)
    kpis["dias_publicados"] = len(serie)

    lista_tramos = sorted(tramos.values(), key=lambda t: (t["desde"], t["hasta"]))
    for t in lista_tramos:
        t.update(_derivar_tramo(t, p))
        t["agentes_activos"] = _div(t["agentes_activos"], t["dias"])

    return {
        "parametros": p,
        "contacto": info_contacto((u for d in dias for u in (d.get("contacto") or {}).get("umbrales", [])), p),
        "dias": serie,
        "kpis": kpis,
        "modos": {m: _resumen_lista_modo(modos[m], p) for m in MODOS},
        "turnos": {
            "determinado": dias_turno > 0, "dias": dias_turno,
            "motivo": None if dias_turno else "Ningún día del período tiene un corte de mitad de día: no se pueden separar turnos.",
            **{t: (_resumen_lista_modo(turnos[t], p) if dias_turno else None) for t in TURNOS},
        },
        "tramos": lista_tramos,
        **_extremos_tramos(lista_tramos),
        "agentes": lista_agentes,
    }


def _resumen_lista_modo(registros: list[dict[str, Any]], p: dict[str, Any]) -> dict[str, Any]:
    """Suma de los resúmenes diarios de un modo o turno (agentes = agente-días)."""
    r = derivar(sumar({s: x.get(s, 0) for s in SUMAS} for x in registros), p)
    r["bandas"] = {b: sum((x.get("bandas") or {}).get(b, 0) for x in registros) for b in BANDAS}
    r["agentes"] = r["dias"]
    r["agentes_validos"] = r["dias_validos"]
    r["agentes_por_dia"] = _div(r["dias"], len(registros))
    return r
