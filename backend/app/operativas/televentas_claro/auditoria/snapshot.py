"""Análisis automático para la auditoría de ventas.

Consolida uno o más informes de Ventas Netas (cada uno con su `data` ya
calculada) en un único conjunto de datos congelado: indicadores, ranking de
vendedores con nivel de riesgo y señales, datos llamativos, series para
gráficos, líneas sin uso y Sali Hablando como evidencia, y los hallazgos
automáticos con los que arranca el informe.

Todo es lógica pura sobre los JSON de los informes: no toca la base.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import date, datetime
from typing import Any

from ..ventas_netas.jobs import ANALYSIS_VERSION

# ------------------------------------------------------------------ reglas
# Única fuente de verdad: el motor las aplica, cada snapshot las guarda y la
# Guía del auditor las muestra (GET /parametros). Cambiarlas acá cambia todo.
UMBRAL_USO_PCT = 50.0          # alerta de vendedor: menos de esto en uso…
MIN_LINEAS_ALERTA = 5          # …con al menos estas líneas Pospago
DIAS_SIN_USO_ANTIGUA = 3       # una línea sin uso con estos días o más ya no es "reciente"
UMBRAL_SIN_USO_ATENCION = 15.0
UMBRAL_SIN_USO_CRITICO = 30.0
MAX_HALLAZGOS_VENDEDOR = 30
MAX_EVIDENCIA = 60

# Nivel del vendedor: alcanza con una condición. Además es crítico con la alerta de uso o con más de
# UMBRAL_SIN_USO_CRITICO % sin uso, y de atención con más de UMBRAL_SIN_USO_ATENCION % (con MIN_LINEAS_ALERTA líneas).
NIVEL_CRITICO = {"sin_uso_antiguas": 5, "sali_sin_uso": 5, "suspendidas": 3}
NIVEL_ATENCION = {"sin_uso_antiguas": 3, "sali_sin_uso": 3, "suspendidas": 1, "sin_uso_riesgo_A": 2}
# Puntaje de riesgo (ordena a los vendedores riesgosos): puntos por línea y por la alerta de uso.
PESOS = {"sin_uso_antigua": 3, "sin_uso_reciente": 1, "sali_sin_uso": 3, "suspendida": 2, "sin_uso_riesgo_A": 2, "alerta_uso": 8}
# Señales del patrón: desde cuántas líneas la señal pasa de gravedad media a alta.
SENAL_ALTA_DESDE = {"sin_uso_antiguas": 3, "sali_sin_uso": 3, "suspendidas": 2}
# Patrones de concentración: la señal aparece con al menos `min` líneas y `pct` % o más en el mismo valor.
PATRONES = {
    "sin_uso_mismo_dia": {"min": 3, "pct": 50},      # sus sin uso, activadas el mismo día
    "pospago_mismo_dia": {"min": 6, "pct": 40},      # sus Pospago, activadas el mismo día (entrega en ráfaga)
    "sin_uso_mismo_plan": {"min": 3, "pct": 70},
    "sin_uso_mismo_origen": {"min": 3, "pct": 70},   # misma operadora de origen (o todas nativas)
    "nativas_sin_uso": {"min": 3, "pct": 60},        # sobre sus nativas
    "sin_uso_misma_ciudad": {"min": 4, "pct": 75},
}
# Datos llamativos y hallazgos generales.
LLAMATIVOS = {
    "sali_pct_sin_uso_alta": 50,     # Sali Hablando sin uso: gravedad alta desde este %
    "pendientes_dias": 7,            # una carga pendiente es "vieja" con más de estos días (Ventas Netas usa el mismo corte)
    "pendientes_viejas_media": 20,   # pendientes viejas: gravedad media desde esta cantidad (si no, baja)
    "concentracion_top": 5,          # vendedores que se miran en la concentración de líneas sin uso…
    "concentracion_pct_media": 40,   # …gravedad media si concentran este % o más
    "dia_sin_uso_min": 10,           # "día con más líneas sin uso": se informa desde esta cantidad
}

NIVEL_LABEL = {"critico": "Crítico", "atencion": "Atención", "normal": "Normal"}


def _pct(parte: float, total: float) -> float:
    return round(parte / total * 100, 1) if total else 0.0


def _g(x: float) -> str:
    """Número para texto en español: 96,5 (sin ceros de más)."""
    return f"{x:g}".replace(".", ",")


def _to_date(s: str | None) -> date | None:
    try:
        return date.fromisoformat(s[:10]) if s else None
    except ValueError:
        return None


def _dias(desde: str | None, hasta: str | None) -> int | None:
    a, b = _to_date(desde), _to_date(hasta)
    return (b - a).days if a and b else None


def _fmt_fecha(iso: str | None) -> str:
    if not iso:
        return "—"
    y, m, d = iso[:10].split("-")
    return f"{d}/{m}/{y}"


def _nombre_periodo(periodo: str) -> str:
    meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
    try:
        y, m = periodo.split("-")
        return f"{meses[int(m) - 1]} {y}"
    except (ValueError, IndexError):
        return periodo


def parametros() -> dict[str, Any]:
    """Reglas vigentes del análisis (las guarda cada snapshot y las muestra la Guía del auditor)."""
    return {
        "umbral_uso_pct": UMBRAL_USO_PCT, "min_lineas_alerta": MIN_LINEAS_ALERTA, "dias_sin_uso_antigua": DIAS_SIN_USO_ANTIGUA,
        "umbral_sin_uso_atencion": UMBRAL_SIN_USO_ATENCION, "umbral_sin_uso_critico": UMBRAL_SIN_USO_CRITICO,
        "analysis_version": ANALYSIS_VERSION,
        "nivel_critico": dict(NIVEL_CRITICO), "nivel_atencion": dict(NIVEL_ATENCION), "pesos": dict(PESOS),
        "senal_alta_desde": dict(SENAL_ALTA_DESDE), "patrones": {k: dict(v) for k, v in PATRONES.items()},
        "llamativos": dict(LLAMATIVOS), "max_hallazgos_vendedor": MAX_HALLAZGOS_VENDEDOR, "max_evidencia": MAX_EVIDENCIA,
    }


def _concentrado(top: tuple[str, int] | None, total: int, regla: dict[str, int]) -> bool:
    """¿El valor más repetido alcanza la regla? (mínimo de líneas y % en aritmética entera, sin redondeos)."""
    return bool(top) and total >= regla["min"] and top[1] * 100 >= regla["pct"] * total


def _top(rows: list[dict], key) -> tuple[str, int] | None:
    c: Counter = Counter()
    for r in rows:
        k = key(r)
        if k:
            c[k] += 1
    return c.most_common(1)[0] if c else None


# ------------------------------------------------------------------ vendedor: nivel y señales
def _senales_vendedor(v: dict[str, Any], lineas: list[dict], sin_uso: list[dict], sali: list[dict]) -> list[dict]:
    """Patrón de comportamiento del vendedor: etiquetas cortas con gravedad (alta/media/info)."""
    s: list[dict] = []
    pospago = [r for r in lineas if r.get("producto") == "Pospago"]
    antiguas = v["sin_uso_antiguas"]
    recientes = len(sin_uso) - antiguas

    if v["alerta"]:
        s.append({"gravedad": "alta", "texto": f"{v['pct_uso']}% en uso: bajo el umbral de {_g(UMBRAL_USO_PCT)}%"})
    if antiguas:
        s.append({"gravedad": "alta" if antiguas >= SENAL_ALTA_DESDE["sin_uso_antiguas"] else "media", "texto": f"{antiguas} sin uso con {DIAS_SIN_USO_ANTIGUA}+ días desde la activación"})
    if recientes and recientes == len(sin_uso) and sin_uso:
        s.append({"gravedad": "info", "texto": f"Todas las sin uso ({recientes}) son de los últimos {DIAS_SIN_USO_ANTIGUA - 1} días"})
    if v["sali_sin_uso"]:
        s.append({"gravedad": "alta" if v["sali_sin_uso"] >= SENAL_ALTA_DESDE["sali_sin_uso"] else "media", "texto": f"{v['sali_sin_uso']} Sali Hablando sin uso"})

    dia = _top(sin_uso, lambda r: r.get("fecha_activacion"))
    if _concentrado(dia, len(sin_uso), PATRONES["sin_uso_mismo_dia"]):
        s.append({"gravedad": "media", "texto": f"{dia[1]} de {len(sin_uso)} sin uso activadas el {_fmt_fecha(dia[0])}"})
    dia_total = _top(pospago, lambda r: r.get("fecha_activacion"))
    if _concentrado(dia_total, len(pospago), PATRONES["pospago_mismo_dia"]):
        s.append({"gravedad": "media", "texto": f"{_g(_pct(dia_total[1], len(pospago)))}% de sus Pospago en un solo día ({_fmt_fecha(dia_total[0])})"})
    plan = _top(sin_uso, lambda r: r.get("plan"))
    if _concentrado(plan, len(sin_uso), PATRONES["sin_uso_mismo_plan"]):
        s.append({"gravedad": "media", "texto": f"Sin uso concentradas en {plan[0]} ({plan[1]} de {len(sin_uso)})"})
    origen = _top(sin_uso, lambda r: (f"portación {r.get('origen_portacion') or ''}".strip() if r.get("portacion") == "SI" else "nativa"))
    if _concentrado(origen, len(sin_uso), PATRONES["sin_uso_mismo_origen"]):
        s.append({"gravedad": "info", "texto": f"Sin uso casi todas de {origen[0]} ({origen[1]} de {len(sin_uso)})"})
    nativas = [r for r in pospago if r.get("portacion") != "SI"]
    nativas_su = [r for r in nativas if r.get("consumo") == "NO"]
    if _concentrado(("nativas", len(nativas_su)), len(nativas), PATRONES["nativas_sin_uso"]):
        s.append({"gravedad": "media", "texto": f"Nativas sin uso: {len(nativas_su)} de {len(nativas)}"})
    ciudad = _top(sin_uso, lambda r: r.get("ciudad"))
    if _concentrado(ciudad, len(sin_uso), PATRONES["sin_uso_misma_ciudad"]):
        s.append({"gravedad": "info", "texto": f"Sin uso concentradas en {ciudad[0]} ({ciudad[1]} de {len(sin_uso)})"})
    if v["suspendidas"]:
        n = v["suspendidas"]
        s.append({"gravedad": "alta" if n >= SENAL_ALTA_DESDE["suspendidas"] else "media", "texto": f"{n} línea{'s' if n > 1 else ''} suspendida{'s' if n > 1 else ''} al cierre"})
    if v["sin_uso_riesgo_A"]:
        s.append({"gravedad": "media", "texto": f"{v['sin_uso_riesgo_A']} sin uso con riesgo alto en la carga"})
    if v["fuera_ddi"] and v["fuera_ddi"] > v["sali"]:
        n = v["fuera_ddi"] - v["sali"]
        s.append({"gravedad": "info", "texto": f"{n} portación{'es' if n > 1 else ''} que no llegaron a DDI"})
    return s


def _nivel_y_puntaje(v: dict[str, Any]) -> tuple[str, int]:
    base = v["con_uso"] + v["sin_uso"]
    critico = (
        v["alerta"] or any(v[k] >= n for k, n in NIVEL_CRITICO.items())
        or (base >= MIN_LINEAS_ALERTA and v["pct_sin_uso"] > UMBRAL_SIN_USO_CRITICO)
    )
    atencion = (
        any(v[k] >= n for k, n in NIVEL_ATENCION.items())
        or (base >= MIN_LINEAS_ALERTA and v["pct_sin_uso"] > UMBRAL_SIN_USO_ATENCION)
    )
    p = PESOS
    puntaje = (
        v["sin_uso_antiguas"] * p["sin_uso_antigua"] + (v["sin_uso"] - v["sin_uso_antiguas"]) * p["sin_uso_reciente"]
        + v["sali_sin_uso"] * p["sali_sin_uso"] + v["suspendidas"] * p["suspendida"] + v["sin_uso_riesgo_A"] * p["sin_uso_riesgo_A"]
        + (p["alerta_uso"] if v["alerta"] else 0)
    )
    return ("critico" if critico else "atencion" if atencion else "normal"), puntaje


# ------------------------------------------------------------------ snapshot
def construir_snapshot(reports: list[Any]) -> dict[str, Any]:
    """Consolida los informes (objetos con .id .periodo .fecha_dato .status .data …) en un snapshot."""
    reports = sorted(reports, key=lambda r: r.periodo)
    fuentes = []
    advertencias: list[str] = []
    for r in reports:
        d = r.data or {}
        if int(d.get("version") or 0) < ANALYSIS_VERSION:
            corte = r.fecha_dato.strftime("%d/%m/%Y") if r.fecha_dato else "s/f"
            advertencias.append(
                f"El corte al {corte} de {_nombre_periodo(r.periodo)} fue analizado con una versión anterior (v{int(d.get('version') or 0)}) "
                f"y no se pudo recalcular: pueden faltar Sali Hablando, riesgo de cargas y productividad."
            )
        fuentes.append({
            "report_id": r.id,
            "periodo": r.periodo,
            "fecha_dato": r.fecha_dato.isoformat() if r.fecha_dato else None,
            "status": r.status,
            "netas": r.netas,
            "pospago": r.pospago,
            "pct_sin_uso": r.pct_sin_uso,
            "pendientes": r.pendientes,
            "generated_at": r.generated_at.isoformat() if r.generated_at else None,
            "version": int(d.get("version") or 0),
        })
    periodos = sorted({r.periodo for r in reports})

    def nuevo_vendedor(nombre: str, subcanal: str | None) -> dict[str, Any]:
        return {
            "vendedor": nombre, "subcanal": subcanal,
            "netas": 0, "pospago": 0, "con_uso": 0, "sin_uso": 0, "gpon": 0, "iptv": 0, "portadas": 0, "suspendidas": 0,
            "sali": 0, "sali_sin_uso": 0, "fuera_ddi": 0,
            "cargas": 0, "finalizadas": 0, "a_confirmar": 0, "rechazadas": 0, "riesgo_A": 0, "sin_uso_riesgo_A": 0,
            "sin_uso_antiguas": 0, "periodos": {},
        }

    vend: dict[str, dict] = {}
    lineas_por_vendedor: dict[str, list] = defaultdict(list)
    sin_uso_por_vendedor: dict[str, list] = defaultdict(list)
    sali_por_vendedor: dict[str, list] = defaultdict(list)
    lineas_sin_uso: list[dict] = []
    sali_lineas: list[dict] = []
    finalizadas_sin_activar: list[dict] = []
    pendientes_viejas: list[dict] = []
    cargas_riesgo_alto_sin_uso: list[dict] = []

    # Series consolidadas
    netas_por_dia: dict[str, dict] = {}
    sali_por_dia: dict[str, dict] = {}
    riesgo_uso: dict[str, dict] = {}
    estados: Counter = Counter()
    zonas: dict[str, dict] = {}
    productos: dict[str, dict] = {}
    pend_antig: dict[str, dict] = {}
    por_legajo: dict[str, dict] = {}

    k_tot = Counter()

    for r in reports:
        d = r.data or {}
        k = d.get("kpis", {})
        prod = d.get("productividad", {}) or {}
        pk = prod.get("kpis", {}) or {}
        sali = d.get("sali_hablando", {}) or {}
        sk = sali.get("kpis", {}) or {}
        fecha_dato = k.get("fecha_dato")
        periodo = r.periodo

        for key in ("netas", "pospago", "gpon", "iptv", "portadas", "nativas", "pospago_sin_uso", "pospago_con_uso",
                    "suspendidas", "fuera_de_netas", "finalizadas_sin_activar", "pendientes", "pendientes_portacion",
                    "pendientes_mas_de_7_dias"):
            k_tot[key] += k.get(key, 0) or 0
        for key in ("cargas", "finalizadas", "a_confirmar", "rechazadas", "procesadas", "riesgo_alto", "sin_uso_riesgo_alto",
                    "con_uso", "sin_uso", "sin_dato_uso", "capital_central", "interior"):
            k_tot[f"cargas_{key}"] += pk.get(key, 0) or 0
        k_tot["sali_total"] += sk.get("total", 0) or 0
        k_tot["sali_sin_uso"] += sk.get("sin_uso", 0) or 0

        # Netas por vendedor
        for v in d.get("vendedores", []):
            f = vend.setdefault(v["vendedor"], nuevo_vendedor(v["vendedor"], v.get("subcanal")))
            for a, b in (("netas", "total"), ("pospago", "pospago"), ("con_uso", "con_uso"), ("sin_uso", "sin_uso"), ("gpon", "gpon"),
                         ("iptv", "iptv"), ("portadas", "portadas"), ("suspendidas", "suspendidas")):
                f[a] += v.get(b, 0) or 0
            p = f["periodos"].setdefault(periodo, {"netas": 0, "sin_uso": 0, "sali_sin_uso": 0})
            p["netas"] += v.get("total", 0) or 0
            p["sin_uso"] += v.get("sin_uso", 0) or 0

        # Líneas netas (evidencia y patrones)
        for x in d.get("detalle_netas", []):
            fila = {**x, "periodo": periodo, "fecha_dato": fecha_dato, "dias": _dias(x.get("fecha_activacion"), fecha_dato)}
            lineas_por_vendedor[x["vendedor"]].append(fila)
            if x.get("consumo") == "NO":
                sin_uso_por_vendedor[x["vendedor"]].append(fila)
                lineas_sin_uso.append(fila)
                if (fila["dias"] or 0) >= DIAS_SIN_USO_ANTIGUA:
                    vend.setdefault(x["vendedor"], nuevo_vendedor(x["vendedor"], x.get("subcanal")))["sin_uso_antiguas"] += 1

        # Fuera de netas y Sali Hablando
        for x in (d.get("fuera_de_netas", {}) or {}).get("detalle", []):
            vend.setdefault(x["vendedor"], nuevo_vendedor(x["vendedor"], x.get("subcanal")))["fuera_ddi"] += 1
        for x in sali.get("detalle", []):
            f = vend.setdefault(x["vendedor"], nuevo_vendedor(x["vendedor"], x.get("subcanal")))
            f["sali"] += 1
            if x.get("sin_uso"):
                f["sali_sin_uso"] += 1
                f["periodos"].setdefault(periodo, {"netas": 0, "sin_uso": 0, "sali_sin_uso": 0})["sali_sin_uso"] += 1
            fila = {**x, "periodo": periodo}
            sali_lineas.append(fila)
            sali_por_vendedor[x["vendedor"]].append(fila)
        for x in sali.get("por_dia", []):
            f = sali_por_dia.setdefault(x["dia"], {"dia": x["dia"], "total": 0, "sin_uso": 0, "con_uso": 0})
            for key in ("total", "sin_uso", "con_uso"):
                f[key] += x.get(key, 0) or 0

        # Cargas por vendedor (productividad). Las "CARGADO POR <legajo>" no son vendedores: fuera del ranking.
        for v in prod.get("por_vendedor", []):
            if v["vendedor"].startswith("CARGADO POR"):
                continue
            f = vend.setdefault(v["vendedor"], nuevo_vendedor(v["vendedor"], v.get("subcanal")))
            f["cargas"] += v.get("total", 0) or 0
            f["finalizadas"] += v.get("finalizadas", 0) or 0
            f["a_confirmar"] += v.get("Vta_A_Confirmar", 0) or 0
            f["rechazadas"] += v.get("Vta_Rechazada", 0) or 0
            f["riesgo_A"] += v.get("riesgo_A", 0) or 0
            f["sin_uso_riesgo_A"] += v.get("sin_uso_riesgo_A", 0) or 0
        for x in prod.get("detalle_cargas", []) or []:
            if x.get("riesgosa") and x.get("riesgo") == "A":
                cargas_riesgo_alto_sin_uso.append({**x, "periodo": periodo})
        for x in prod.get("riesgo_uso", []) or []:
            f = riesgo_uso.setdefault(x["riesgo"], {"riesgo": x["riesgo"], "cargas": 0, "con_uso": 0, "sin_uso": 0})
            for key in ("cargas", "con_uso", "sin_uso"):
                f[key] += x.get(key, 0) or 0
        for x in prod.get("por_estado", []) or []:
            estados[x["estado"]] += x.get("total", 0) or 0
        for x in prod.get("por_zona", []) or []:
            f = zonas.setdefault(x["zona"], {"zona": x["zona"], "total": 0, "finalizadas": 0, "pospago": 0, "internet": 0, "iptv": 0, "con_uso": 0, "sin_uso": 0})
            for key in ("total", "finalizadas", "pospago", "internet", "iptv", "con_uso", "sin_uso"):
                f[key] += x.get(key, 0) or 0
        for x in d.get("por_producto", []):
            f = productos.setdefault(x["producto"], {"producto": x["producto"], "total": 0, "sin_uso": 0, "con_uso": 0})
            for key in ("total", "sin_uso", "con_uso"):
                f[key] += x.get(key, 0) or 0
        for x in d.get("por_dia", []):
            f = netas_por_dia.setdefault(x["dia"], {"dia": x["dia"], "total": 0, "con_uso": 0, "sin_uso": 0, "otros": 0})
            f["total"] += x.get("total", 0) or 0
            f["con_uso"] += x.get("con_uso", 0) or 0
            f["sin_uso"] += x.get("sin_uso", 0) or 0
            f["otros"] += (x.get("total", 0) or 0) - (x.get("pospago", 0) or 0)
        pend = d.get("pendientes", {}) or {}
        for x in pend.get("por_antiguedad", []):
            f = pend_antig.setdefault(x["rango"], {"rango": x["rango"], "total": 0})
            f["total"] += x.get("total", 0) or 0
        for x in pend.get("por_legajo", []):
            f = por_legajo.setdefault(x["legajo"], {"legajo": x["legajo"], "cargado_por": x.get("cargado_por"), "total": 0, "mas_de_7_dias": 0})
            f["total"] += x.get("total", 0) or 0
            f["mas_de_7_dias"] += x.get("mas_de_7_dias", 0) or 0
        for x in pend.get("detalle", []):
            if (x.get("dias") or 0) > LLAMATIVOS["pendientes_dias"]:
                pendientes_viejas.append({**x, "periodo": periodo})
        for x in d.get("finalizadas_sin_activar", []):
            finalizadas_sin_activar.append({**x, "periodo": periodo})

    # Ranking
    ranking: list[dict] = []
    for nombre, v in vend.items():
        v["pct_uso"] = _pct(v["con_uso"], v["pospago"])
        v["pct_sin_uso"] = _pct(v["sin_uso"], v["con_uso"] + v["sin_uso"])
        v["alerta"] = v["pospago"] >= MIN_LINEAS_ALERTA and v["pct_uso"] < UMBRAL_USO_PCT
        v["pct_finalizacion"] = _pct(v["finalizadas"], v["cargas"])
        v["nivel"], v["puntaje"] = _nivel_y_puntaje(v)
        v["senales"] = _senales_vendedor(v, lineas_por_vendedor.get(nombre, []), sin_uso_por_vendedor.get(nombre, []), sali_por_vendedor.get(nombre, []))
        ranking.append(v)
    ranking.sort(key=lambda v: (-v["netas"], v["vendedor"]))
    for i, v in enumerate(ranking, start=1):
        v["posicion"] = i
    riesgosos = sorted((v for v in ranking if v["nivel"] != "normal"), key=lambda v: (-v["puntaje"], -v["sin_uso"], v["vendedor"]))

    pospago_total = k_tot["pospago"]
    kpis = {
        "periodos": periodos,
        "fuentes": len(fuentes),
        "netas": k_tot["netas"], "pospago": pospago_total, "gpon": k_tot["gpon"], "iptv": k_tot["iptv"],
        "portadas": k_tot["portadas"], "nativas": k_tot["nativas"],
        "pospago_sin_uso": k_tot["pospago_sin_uso"], "pospago_con_uso": k_tot["pospago_con_uso"],
        "pct_sin_uso": _pct(k_tot["pospago_sin_uso"], pospago_total),
        "sin_uso_antiguas": sum(1 for x in lineas_sin_uso if (x["dias"] or 0) >= DIAS_SIN_USO_ANTIGUA),
        "sali_total": k_tot["sali_total"], "sali_sin_uso": k_tot["sali_sin_uso"], "sali_pct_sin_uso": _pct(k_tot["sali_sin_uso"], k_tot["sali_total"]),
        "suspendidas": k_tot["suspendidas"], "fuera_de_netas": k_tot["fuera_de_netas"],
        "finalizadas_sin_activar": k_tot["finalizadas_sin_activar"],
        "pendientes": k_tot["pendientes"], "pendientes_portacion": k_tot["pendientes_portacion"], "pendientes_mas_7": k_tot["pendientes_mas_de_7_dias"],
        "cargas": k_tot["cargas_cargas"], "cargas_finalizadas": k_tot["cargas_finalizadas"],
        "pct_finalizacion": _pct(k_tot["cargas_finalizadas"], k_tot["cargas_cargas"]),
        "cargas_a_confirmar": k_tot["cargas_a_confirmar"], "cargas_rechazadas": k_tot["cargas_rechazadas"],
        "riesgo_alto": k_tot["cargas_riesgo_alto"], "sin_uso_riesgo_alto": k_tot["cargas_sin_uso_riesgo_alto"],
        "capital_central": k_tot["cargas_capital_central"], "interior": k_tot["cargas_interior"],
        "vendedores": len(ranking),
        "vendedores_criticos": sum(1 for v in ranking if v["nivel"] == "critico"),
        "vendedores_atencion": sum(1 for v in ranking if v["nivel"] == "atencion"),
        "total_sin_uso": k_tot["pospago_sin_uso"] + k_tot["sali_sin_uso"],
    }

    for f in riesgo_uso.values():
        f["pct_sin_uso"] = _pct(f["sin_uso"], f["con_uso"] + f["sin_uso"])
    for f in zonas.values():
        f["pct_finalizacion"] = _pct(f["finalizadas"], f["total"])
        f["pct_sin_uso"] = _pct(f["sin_uso"], f["con_uso"] + f["sin_uso"])
    series = {
        "netas_por_dia": sorted(netas_por_dia.values(), key=lambda x: x["dia"]),
        "sali_por_dia": sorted(sali_por_dia.values(), key=lambda x: x["dia"]),
        "riesgo_uso": [riesgo_uso[x] for x in ("A", "M", "B") if x in riesgo_uso],
        "estados": [{"estado": e, "total": n} for e, n in estados.most_common()],
        "zonas": sorted(zonas.values(), key=lambda x: -x["total"]),
        "productos": sorted(productos.values(), key=lambda x: -x["total"]),
        "pendientes_antiguedad": list(pend_antig.values()),
        "sin_uso_por_vendedor": [
            {"vendedor": v["vendedor"], "sin_uso": v["sin_uso"], "con_uso": v["con_uso"], "pct_sin_uso": v["pct_sin_uso"], "nivel": v["nivel"]}
            for v in sorted(ranking, key=lambda v: (-v["sin_uso"], -v["pct_sin_uso"]))[:20] if v["sin_uso"]
        ],
        "netas_por_vendedor": [
            {"vendedor": v["vendedor"], "pospago": v["pospago"], "gpon": v["gpon"], "iptv": v["iptv"], "netas": v["netas"]}
            for v in ranking[:20]
        ],
        "uso_por_vendedor": [
            {"vendedor": v["vendedor"], "pct_uso": v["pct_uso"], "pospago": v["pospago"], "nivel": v["nivel"]}
            for v in sorted((v for v in ranking if v["pospago"] >= MIN_LINEAS_ALERTA), key=lambda v: v["pct_uso"])[:20]
        ],
        "sali_por_vendedor": [
            {"vendedor": v["vendedor"], "sali": v["sali"], "sali_sin_uso": v["sali_sin_uso"]}
            for v in sorted((v for v in ranking if v["sali"]), key=lambda v: (-v["sali_sin_uso"], -v["sali"]))[:20]
        ],
    }

    llamativos = _datos_llamativos(kpis, ranking, series, lineas_sin_uso)

    lineas_sin_uso.sort(key=lambda x: (-(x["dias"] or 0), x["vendedor"]))
    sali_lineas.sort(key=lambda x: (not x.get("sin_uso"), x.get("fecha_portacion") or ""))
    return {
        "generado_en": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "parametros": parametros(),
        "advertencias": advertencias,
        "fuentes": fuentes,
        "periodos": periodos,
        "kpis": kpis,
        "llamativos": llamativos,
        "ranking": ranking,
        "riesgosos": riesgosos,
        "series": series,
        "lineas_sin_uso": lineas_sin_uso,
        "sali_lineas": sali_lineas,
        "finalizadas_sin_activar": finalizadas_sin_activar,
        "pendientes_viejas": pendientes_viejas,
        "pendientes_por_legajo": sorted(por_legajo.values(), key=lambda x: -x["total"]),
        "cargas_riesgo_alto_sin_uso": cargas_riesgo_alto_sin_uso,
    }


# ------------------------------------------------------------------ datos llamativos
def _datos_llamativos(k: dict, ranking: list[dict], series: dict, lineas_sin_uso: list[dict]) -> list[dict]:
    out: list[dict] = []

    def add(gravedad: str, categoria: str, titulo: str, detalle: str, cifra: str) -> None:
        out.append({"gravedad": gravedad, "categoria": categoria, "titulo": titulo, "detalle": detalle, "cifra": cifra})

    if k["sali_total"]:
        add("alta" if k["sali_pct_sin_uso"] >= LLAMATIVOS["sali_pct_sin_uso_alta"] else "media", "sali_hablando",
            "Sali Hablando sin uso",
            f"{k['sali_sin_uso']} de {k['sali_total']} portaciones Sali Hablando no tienen consumo. Salieron hablando de la otra operadora y no usan la línea: riesgo alto de primera factura impaga.",
            f"{_g(k['sali_pct_sin_uso'])}%")
    if k["pospago"]:
        g = "alta" if k["pct_sin_uso"] > UMBRAL_SIN_USO_CRITICO else "media" if k["pct_sin_uso"] > UMBRAL_SIN_USO_ATENCION else "info"
        add(g, "sin_uso", "Líneas Pospago netas sin uso",
            f"{k['pospago_sin_uso']} de {k['pospago']} líneas Pospago netas no registran consumo; {k['sin_uso_antiguas']} de ellas llevan {DIAS_SIN_USO_ANTIGUA}+ días activadas.",
            f"{_g(k['pct_sin_uso'])}%")
    ru = {x["riesgo"]: x for x in series.get("riesgo_uso", [])}
    if "A" in ru and "M" in ru and (ru["A"]["con_uso"] + ru["A"]["sin_uso"]):
        add("media" if ru["A"]["pct_sin_uso"] > ru["M"]["pct_sin_uso"] else "info", "riesgo",
            "Riesgo de la carga y uso de la línea",
            f"Las cargas de riesgo alto tienen {_g(ru['A']['pct_sin_uso'])}% sin uso frente a {_g(ru['M']['pct_sin_uso'])}% de las de riesgo medio.",
            f"A {_g(ru['A']['pct_sin_uso'])}% · M {_g(ru['M']['pct_sin_uso'])}%")
    if k["finalizadas_sin_activar"]:
        add("media", "activacion", "Ventas finalizadas sin activar",
            f"{k['finalizadas_sin_activar']} cargas en estado finalizada no figuran en DDI ni en PORTABILIDAD del período. Conviene conciliar con Claro.",
            str(k["finalizadas_sin_activar"]))
    if k["pendientes_mas_7"]:
        add("media" if k["pendientes_mas_7"] >= LLAMATIVOS["pendientes_viejas_media"] else "baja", "pendientes",
            f"Cargas pendientes con más de {LLAMATIVOS['pendientes_dias']} días",
            f"{k['pendientes_mas_7']} de {k['pendientes']} cargas pendientes llevan más de {LLAMATIVOS['pendientes_dias']} días sin finalizar.",
            str(k["pendientes_mas_7"]))
    if k["suspendidas"]:
        add("baja", "suspendidas", "Líneas suspendidas al cierre",
            f"{k['suspendidas']} líneas netas estaban suspendidas al corte.", str(k["suspendidas"]))
    if lineas_sin_uso:
        top5 = sorted(ranking, key=lambda v: -v["sin_uso"])[:LLAMATIVOS["concentracion_top"]]
        parte = sum(v["sin_uso"] for v in top5)
        add("media" if _pct(parte, len(lineas_sin_uso)) >= LLAMATIVOS["concentracion_pct_media"] else "info", "vendedor", "Concentración de líneas sin uso",
            f"{_g(_pct(parte, len(lineas_sin_uso)))}% de las líneas sin uso ({parte} de {len(lineas_sin_uso)}) se concentra en {LLAMATIVOS['concentracion_top']} vendedores: "
            + ", ".join(f"{v['vendedor']} ({v['sin_uso']})" for v in top5) + ".",
            f"{_g(_pct(parte, len(lineas_sin_uso)))}%")
    dia = max(series.get("netas_por_dia", []), key=lambda x: x["sin_uso"], default=None)
    if dia and dia["sin_uso"] >= LLAMATIVOS["dia_sin_uso_min"]:
        add("info", "sin_uso", "Día con más líneas sin uso",
            f"El {_fmt_fecha(dia['dia'])} se activaron {dia['sin_uso']} líneas que no registran uso ({_g(_pct(dia['sin_uso'], dia['total']))}% de las activaciones del día).",
            _fmt_fecha(dia["dia"]))
    z = {x["zona"]: x for x in series.get("zonas", [])}
    if "Interior" in z and "Capital y Central" in z:
        add("info", "zona", "Uso por zona",
            f"Interior: {_g(z['Interior']['pct_sin_uso'])}% sin uso sobre {z['Interior']['total']} cargas · Capital y Central: {_g(z['Capital y Central']['pct_sin_uso'])}% sobre {z['Capital y Central']['total']}.",
            f"{_g(z['Interior']['pct_sin_uso'])}% · {_g(z['Capital y Central']['pct_sin_uso'])}%")
    if k["vendedores_criticos"] or k["vendedores_atencion"]:
        add("alta" if k["vendedores_criticos"] else "media", "vendedor", "Vendedores con riesgo",
            f"{k['vendedores_criticos']} vendedores en nivel crítico y {k['vendedores_atencion']} en atención, de {k['vendedores']} con actividad.",
            f"{k['vendedores_criticos']} · {k['vendedores_atencion']}")
    orden = {"alta": 0, "media": 1, "baja": 2, "info": 3}
    out.sort(key=lambda x: orden.get(x["gravedad"], 9))
    return out


# ------------------------------------------------------------------ hallazgos automáticos
def _linea_evidencia(x: dict) -> dict:
    return {k: x.get(k) for k in ("periodo", "sds_number", "linea", "fecha_activacion", "fecha_portacion", "plan", "origen_portacion",
                                  "portacion", "consumo", "estado_linea", "razon_cierre", "vendedor", "ciudad", "dias", "riesgo")}


def _carga_evidencia(x: dict) -> dict:
    return {"periodo": x.get("periodo"), "sds_number": x.get("sds_number"), "fecha_activacion": x.get("fecha_alta"), "plan": x.get("plan"),
            "origen_portacion": x.get("origen_portacion"), "portacion": x.get("portacion"), "consumo": x.get("uso"), "riesgo": x.get("riesgo"),
            "vendedor": x.get("vendedor"), "ciudad": x.get("ciudad"), "estado_linea": None, "razon_cierre": None, "linea": None, "fecha_portacion": None, "dias": None}


def hallazgos_automaticos(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    """Hallazgos iniciales del informe. El auditor los edita, descarta o completa."""
    k = snapshot["kpis"]
    out: list[dict] = []

    if k["sali_sin_uso"]:
        lineas = [x for x in snapshot["sali_lineas"] if x.get("sin_uso")]
        por_v = Counter(x["vendedor"] for x in lineas)
        out.append({
            "titulo": f"Portaciones Sali Hablando sin uso ({k['sali_sin_uso']} de {k['sali_total']})",
            "severidad": "alta", "categoria": "sali_hablando", "vendedor": None,
            "descripcion": (
                f"{k['sali_sin_uso']} líneas portadas con tipo Sali Hablando ({_g(k['sali_pct_sin_uso'])}% del total de ese tipo) no registran consumo. "
                f"Se activaron antes del mes de portación y no figuran en DDI ni en las cargas del período. "
                f"Vendedores con más casos: " + ", ".join(f"{v} ({n})" for v, n in por_v.most_common(5)) + "."
            ),
            "recomendacion": "Contactar a los clientes para confirmar la tenencia y el uso de la línea; verificar con Claro el estado de la portación; revisar el proceso de venta de los vendedores con más casos antes de liquidar comisiones.",
            "evidencia": {"lineas": [_linea_evidencia(x) for x in lineas[:MAX_EVIDENCIA]], "total": len(lineas),
                          "por_vendedor": [{"vendedor": v, "total": n} for v, n in por_v.most_common()]},
        })

    if k["sin_uso_riesgo_alto"]:
        lineas = snapshot.get("cargas_riesgo_alto_sin_uso", [])
        out.append({
            "titulo": f"Líneas sin uso vendidas con riesgo alto en la carga ({k['sin_uso_riesgo_alto']})",
            "severidad": "media", "categoria": "riesgo", "vendedor": None,
            "descripcion": f"{k['sin_uso_riesgo_alto']} de las {k['riesgo_alto']} cargas clasificadas con riesgo alto (A) por Claro finalizaron y no registran uso. El riesgo asignado al cargar anticipa el no uso.",
            "recomendacion": "Reforzar la validación de las ventas con riesgo alto antes de finalizarlas (verificación de identidad y domicilio, confirmación telefónica).",
            "evidencia": {"lineas": [_carga_evidencia(x) for x in lineas[:MAX_EVIDENCIA]], "total": len(lineas)},
        })

    if k["finalizadas_sin_activar"]:
        lineas = snapshot["finalizadas_sin_activar"]
        out.append({
            "titulo": f"Ventas finalizadas que no figuran activadas ({k['finalizadas_sin_activar']})",
            "severidad": "media", "categoria": "activacion", "vendedor": None,
            "descripcion": f"{k['finalizadas_sin_activar']} cargas en estado finalizada no aparecen en DDI ni en PORTABILIDAD del período. Puede tratarse de activaciones diferidas o de ventas que no completaron el alta.",
            "recomendacion": "Conciliar la lista con Claro y con el corte siguiente; no liquidar comisión hasta confirmar la activación.",
            "evidencia": {"lineas": lineas[:MAX_EVIDENCIA], "total": len(lineas)},
        })

    if k["pendientes_mas_7"]:
        out.append({
            "titulo": f"Cargas pendientes con más de {LLAMATIVOS['pendientes_dias']} días ({k['pendientes_mas_7']})",
            "severidad": "media" if k["pendientes_mas_7"] >= LLAMATIVOS["pendientes_viejas_media"] else "baja", "categoria": "pendientes", "vendedor": None,
            "descripcion": f"{k['pendientes_mas_7']} cargas llevan más de {LLAMATIVOS['pendientes_dias']} días sin finalizar. Legajos con más pendientes viejas: "
                           + ", ".join(f"{x['legajo']} ({x['mas_de_7_dias']})" for x in snapshot["pendientes_por_legajo"] if x["mas_de_7_dias"])[:300] + ".",
            "recomendacion": "Depurar las cargas a confirmar: rechazar las que no van a completarse y reclamar a Claro las que dependen de la operadora.",
            "evidencia": {"lineas": snapshot["pendientes_viejas"][:MAX_EVIDENCIA], "total": len(snapshot["pendientes_viejas"])},
        })

    if k["suspendidas"]:
        lineas = [x for x in snapshot["lineas_sin_uso"] if x.get("estado_linea") == "S"]
        out.append({
            "titulo": f"Líneas suspendidas al cierre ({k['suspendidas']})",
            "severidad": "baja", "categoria": "suspendidas", "vendedor": None,
            "descripcion": f"{k['suspendidas']} líneas netas estaban suspendidas al corte del informe.",
            "recomendacion": "Verificar el motivo de la suspensión y si corresponde descontar la venta.",
            "evidencia": {"lineas": [_linea_evidencia(x) for x in lineas[:MAX_EVIDENCIA]], "total": len(lineas)},
        })

    # Un hallazgo por vendedor riesgoso, de más a menos crítico.
    sin_uso_por_v: dict[str, list] = defaultdict(list)
    for x in snapshot["lineas_sin_uso"]:
        sin_uso_por_v[x["vendedor"]].append(x)
    sali_por_v: dict[str, list] = defaultdict(list)
    for x in snapshot["sali_lineas"]:
        if x.get("sin_uso"):
            sali_por_v[x["vendedor"]].append(x)
    for v in snapshot["riesgosos"][:MAX_HALLAZGOS_VENDEDOR]:
        partes = []
        if v["pospago"]:
            partes.append(f"{v['sin_uso']} de {v['pospago']} líneas Pospago netas sin uso ({_g(v['pct_sin_uso'])}%), {v['sin_uso_antiguas']} con {DIAS_SIN_USO_ANTIGUA}+ días")
        if v["sali_sin_uso"]:
            partes.append(f"{v['sali_sin_uso']} Sali Hablando sin uso")
        if v["suspendidas"]:
            partes.append(f"{v['suspendidas']} suspendidas")
        if v["sin_uso_riesgo_A"]:
            partes.append(f"{v['sin_uso_riesgo_A']} sin uso con riesgo alto en la carga")
        senales = "; ".join(s["texto"] for s in v["senales"])
        out.append({
            "titulo": f"{v['vendedor']}: ventas con riesgo ({NIVEL_LABEL[v['nivel']]})",
            "severidad": "alta" if v["nivel"] == "critico" else "media", "categoria": "vendedor", "vendedor": v["vendedor"],
            "descripcion": f"{v['netas']} ventas netas (puesto {v['posicion']} de {k['vendedores']}). " + "; ".join(partes) + (f". Patrón: {senales}." if senales else "."),
            "recomendacion": "Revisar las líneas sin uso con el cliente (tenencia, activación, consumo) y el proceso de venta del vendedor; retener la comisión de las líneas sin uso hasta confirmar consumo.",
            "evidencia": {
                "lineas": [_linea_evidencia(x) for x in sin_uso_por_v.get(v["vendedor"], [])[:MAX_EVIDENCIA]],
                "sali": [_linea_evidencia(x) for x in sali_por_v.get(v["vendedor"], [])[:MAX_EVIDENCIA]],
                "senales": v["senales"], "resumen": {key: v[key] for key in ("netas", "pospago", "con_uso", "sin_uso", "pct_uso", "sin_uso_antiguas", "sali", "sali_sin_uso", "suspendidas", "riesgo_A", "sin_uso_riesgo_A", "nivel", "puntaje", "posicion")},
            },
        })
    return out


def resumen_automatico(snapshot: dict[str, Any]) -> str:
    """Borrador del resumen ejecutivo para que el auditor arranque con algo escrito."""
    k = snapshot["kpis"]
    per = ", ".join(_nombre_periodo(p) for p in snapshot["periodos"])
    partes = [
        f"Se auditaron las ventas de {per} ({k['fuentes']} informe{'s' if k['fuentes'] > 1 else ''} de Ventas Netas): "
        f"{k['netas']} ventas netas ({k['pospago']} Pospago, {k['gpon']} GPON, {k['iptv']} IPTV) y {k['cargas']} cargas con {_g(k['pct_finalizacion'])}% de finalización.",
    ]
    if k["pospago"]:
        partes.append(f"El {_g(k['pct_sin_uso'])}% de las líneas Pospago netas ({k['pospago_sin_uso']}) no registra consumo; {k['sin_uso_antiguas']} llevan {DIAS_SIN_USO_ANTIGUA} días o más activadas.")
    if k["sali_total"]:
        partes.append(f"Se identificaron {k['sali_total']} portaciones Sali Hablando, {k['sali_sin_uso']} sin uso ({_g(k['sali_pct_sin_uso'])}%).")
    partes.append(f"{k['vendedores_criticos']} vendedores quedan en nivel crítico y {k['vendedores_atencion']} en atención, sobre {k['vendedores']} con actividad.")
    return " ".join(partes)
