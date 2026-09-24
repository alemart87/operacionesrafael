"""Negocio GPON (fibra + TV) de Claro — modelo de liquidación y proyección.

Calibrado fila por fila con las liquidaciones GPON 385–389 (entidad 300383, ene–may 2026,
1.100 activaciones, 7.927 filas). Estructura distinta a móvil (pospago):

  Cuota 1        al activar, por plan (Fibra 60: 400.000 · Fibra 30: 325.000 · TV: 120.000).
  Cuota 2        entre el día 59 y 91 (mediana 73 → liquidación del mes 2): Fibra 60 280.000,
                 Fibra 30 200.000, TV 120.000. Con legajo incompleto la mitad; en ~6–10% se paga 0.
                 Cobra el 86–97% de las líneas (real: 85% del monto completo de la cohorte).
  Bono fijo      (INCENTIVO PRODUCTIVIDAD 1771) por línea según cumplimiento del objetivo:
                 escala vigente ≥110 130.000 · ≥105 125.000 · ≥100 120.000 · ≥95 40.000.
                 Historial ene–may 2026: 100.000 (ene, mar), 50.000 (abr), 0 (feb, may). Se paga
                 en el 91% de las activaciones.
  Recálculo      (1871) al día 150–180 (mes 6): 100% del bono de las líneas caídas, 23–26% de
                 las líneas de la cohorte.
  Legajos        (documentación faltante, mes 1): 50% de la cuota 1 en el 11% de las líneas.
  Mora           PENALIZACION POR DEUDA / REVERSO: penalidad tabulada por plan cuando el cliente
                 entra en mora, revertida si paga (75% se revierte en la misma liquidación). Lo que
                 queda sin revertir es la pérdida real: 26% de las líneas de una cohorte a los 5–6
                 meses, ~406.000 por línea en mora (Fibra 60: 630.000 / 350.000 / 315.000;
                 Fibra 30: 475.000; TV: 190.000). Primera penalización: p25 día 65, mediana 93,
                 p75 132, máximo 180. Neto por cohorte: 15,6% de lo cobrado.
  Chargeback     180 días exactos. Después del mes 6 no hay más débitos.
  Sin residual, sin plus de portabilidad, sin bono efectividad.

Unidad económica real (cohorte ene-26 a 5 meses): 515.000 por línea = 1,46 × cuota 1.
Reutiliza la estructura de costos del motor móvil (misma función de costos y margen).
"""
from __future__ import annotations

import copy
import math
from typing import Any

from .facturacion_simulador import _costos_y_margen, _escala

PLANES_GPON_DEFAULT = [
    {"nombre": "Fibra 60 (IF60 / BAF7)", "cuota1": 400000, "cuota2": 280000, "penalidad_mora": 520000, "mix_pct": 70.0},
    {"nombre": "Fibra 30 (IF30 / BAF3)", "cuota1": 325000, "cuota2": 200000, "penalidad_mora": 430000, "mix_pct": 18.0},
    {"nombre": "TV (TVP / TVA)", "cuota1": 120000, "cuota2": 120000, "penalidad_mora": 160000, "mix_pct": 12.0},
]

# Curva acumulada de la mora NETA (líneas que quedan penalizadas sin reverso) por mes de
# antigüedad, como % del total final: sale de la distribución de la primera penalización
# (p25 día 65, mediana 93, p75 132, máx 180) → a los 6 meses está el 100%.
MORA_CURVA_DEFAULT = [0.0, 3.0, 22.0, 52.0, 78.0, 95.0, 100.0]

PARAMETROS_GPON_DEFAULT: dict[str, Any] = {
    "negocio": "GPON",
    "ventas": 230,                       # activaciones del mes (real ene–may: 188–239)
    "objetivo": 230,                     # objetivo mensual de líneas para el bono fijo
    "pct_estado_a": 100.0,               # activaciones que cuentan para el objetivo
    "planes": copy.deepcopy(PLANES_GPON_DEFAULT),
    # ---- cuota 2 y legajos ----
    "cuota2_mes": 2,                     # liquidación del mes 2 (día 59–91, mediana 73)
    "cuota2_pct_lineas": 90.0,           # líneas que cobran cuota 2 (real 86–97%)
    "cuota2_pct_completa": 82.0,         # de las que cobran, % con importe completo; el resto cobra la mitad
    "legajo_pct": 11.0,                  # líneas con documentación faltante (mes 1)
    "legajo_pct_cuota1": 50.0,           # descuento = % de la cuota 1
    # ---- bono fijo (escala vigente comunicada por Claro) ----
    "escala_bono": [
        {"desde_pct": 110, "monto": 130000}, {"desde_pct": 105, "monto": 125000},
        {"desde_pct": 100, "monto": 120000}, {"desde_pct": 95, "monto": 40000},
    ],
    "pct_bono_cobrado": 91.0,            # activaciones que cobran el bono (real 218/239, 215/238)
    "recalculo_mes": 6,
    "pct_recalculo": 25.0,               # líneas caídas al día 180 que devuelven el 100% del bono (real 23–26%)
    "bonos_activos": True,
    "bono_adicional": 0,
    # ---- mora (penalización por deuda neta de reversos) ----
    "mora_pct_lineas": 26.0,             # líneas de la cohorte que quedan con deuda neta a los 6 meses
    "mora_curva_pct": list(MORA_CURVA_DEFAULT),
    "mora_penalidad_pct": 100.0,         # % de la penalidad tabulada que se pierde (100 = tabla completa)
    "chargeback_meses": 6,
    "otros_pct": 0.5,                    # reversos de activación y cancelaciones (0,5% de las activaciones × cuota 1)
    "ajuste_comisiones_pct": 0.0,        # renegociación de cuota 1 y 2 con Claro
    # ---- costos: estructura GPON (mismas reglas que móvil; logística de SIM no aplica) ----
    "costos": {
        "ventas_por_vendedor": 20, "supervisor_cada_vendedores": 12, "backoffice_cada_ventas": 120,
        "coordinadores": 0, "controllers": 1,
        "salario_hora": 14635, "horas_dia": 7, "dias_mes": 23,
        "comision_por_venta": 102000, "plus_por_venta": 32000,
        "supervisor_salario": 4180000, "supervisor_premio": 1500000,
        "coordinador_salario": 6000000, "coordinador_premio": 2500000,
        "backoffice_salario": 3044000, "controller_salario": 3600000, "controller_premio": 750000,
        "subgerencia_salario": 0, "ips_pct": 16.5, "aguinaldo": True,
        "logistica_central": 0, "logistica_interior": 0, "logistica_interior_pct": 0.0, "logistica_premios": 0,
        "operativo_por_venta": 12500,
    },
}


def parametros_gpon(overrides: dict | None) -> dict:
    p = copy.deepcopy(PARAMETROS_GPON_DEFAULT)
    for k, v in (overrides or {}).items():
        if v is None or k not in p:
            continue
        if k == "costos" and isinstance(v, dict):
            p["costos"] = {**p["costos"], **{ck: cv for ck, cv in v.items() if cv is not None}}
        else:
            p[k] = v
    return p


def _pct(v: Any, default: float = 0.0) -> float:
    try:
        return min(max(float(v), 0.0), 100.0) / 100.0
    except (TypeError, ValueError):
        return default / 100.0


def simular_gpon(params: dict | None = None) -> dict[str, Any]:
    """UNA cohorte GPON: facturación del mes 0 y flujos de los meses 1..12."""
    p = parametros_gpon(params)
    act = max(float(p["ventas"] or 0), 0)
    act_a = act * _pct(p["pct_estado_a"], 100)
    objetivo = max(float(p["objetivo"] or 0), 1)
    cumplimiento = act_a / objetivo * 100.0
    planes = [pl for pl in p["planes"] if float(pl.get("mix_pct") or 0) > 0]
    mix_total = sum(float(pl["mix_pct"]) for pl in planes) or 1.0
    w = lambda key: sum(float(pl.get(key) or 0) * float(pl["mix_pct"]) / mix_total for pl in planes)  # noqa: E731
    ajuste = 1 + float(p.get("ajuste_comisiones_pct") or 0) / 100.0
    cuota1_w, cuota2_w, pen_w = w("cuota1") * ajuste, w("cuota2") * ajuste, w("penalidad_mora")

    bonos_activos = bool(p.get("bonos_activos", True))
    monto_bono, esc = _escala(p["escala_bono"], cumplimiento) if bonos_activos else (0.0, None)
    pct_bono = _pct(p["pct_bono_cobrado"], 91)

    mes0 = {
        "activaciones_cuota1": act * cuota1_w,
        "bono_fijo": act_a * pct_bono * monto_bono,
        "bono_adicional": max(float(p.get("bono_adicional") or 0), 0),
    }
    bruto_mes0 = sum(mes0.values())

    curva = [_pct(x) for x in (p.get("mora_curva_pct") or MORA_CURVA_DEFAULT)]
    while len(curva) < 13:
        curva.append(curva[-1] if curva else 1.0)
    chb = int(p["chargeback_meses"])
    mora_lineas = act * _pct(p["mora_pct_lineas"], 26)
    mora_por_linea = pen_w * _pct(p["mora_penalidad_pct"], 100)
    c2_lineas = _pct(p["cuota2_pct_lineas"], 90)
    c2_completa = _pct(p["cuota2_pct_completa"], 82)
    cuota2_factor = c2_lineas * (c2_completa + (1 - c2_completa) * 0.5)

    meses = [{"mes": 0, "cuota2": 0.0, "legajos": 0.0, "mora": 0.0, "recalculo": 0.0, "otros": 0.0,
              "neto_mes": bruto_mes0, "acumulado": bruto_mes0, "lineas_en_mora": 0.0}]
    acum = bruto_mes0
    for k in range(1, 13):
        row = {"mes": k, "cuota2": 0.0, "legajos": 0.0, "mora": 0.0, "recalculo": 0.0, "otros": 0.0}
        if k == 1:
            row["legajos"] = -act * _pct(p["legajo_pct"], 11) * cuota1_w * _pct(p["legajo_pct_cuota1"], 50)
            row["otros"] = -act * _pct(p["otros_pct"], 0.5) * cuota1_w
        if k == int(p["cuota2_mes"]):
            row["cuota2"] = act * cuota2_factor * cuota2_w
        if k <= chb:
            nuevas = mora_lineas * max(0.0, curva[k] - curva[k - 1])
            row["mora"] = -nuevas * mora_por_linea
        if k == int(p["recalculo_mes"]) and bonos_activos:
            row["recalculo"] = -act_a * pct_bono * monto_bono * _pct(p["pct_recalculo"], 25)
        row["lineas_en_mora"] = mora_lineas * curva[min(k, len(curva) - 1)]
        row["neto_mes"] = row["cuota2"] + row["legajos"] + row["mora"] + row["recalculo"] + row["otros"]
        acum += row["neto_mes"]
        row["acumulado"] = acum
        meses.append(row)
    for m in meses:
        for k2 in ("cuota2", "legajos", "mora", "recalculo", "otros", "neto_mes", "acumulado", "lineas_en_mora"):
            m[k2] = round(m[k2])
    neto_6 = sum(m["neto_mes"] for m in meses[:7])
    neto_12 = sum(m["neto_mes"] for m in meses[:13])
    costos, margen = _costos_y_margen(p["costos"], act, mes0, bruto_mes0, neto_6, neto_12)
    dev_12 = sum(m["legajos"] + m["mora"] + m["recalculo"] + m["otros"] for m in meses[1:])
    cob_12 = sum(m["cuota2"] for m in meses[1:])
    por_linea = {
        "cuota1": round(cuota1_w), "cuota2_esperada": round(cuota2_factor * cuota2_w), "bono": round(pct_bono * monto_bono),
        "legajos": round(meses[1]["legajos"] / act) if act else 0, "mora": round(sum(m["mora"] for m in meses) / act) if act else 0,
        "recalculo": round(sum(m["recalculo"] for m in meses) / act) if act else 0,
        "neto_12": round(neto_12 / act) if act else 0, "costo": costos["costo_por_venta"],
        "margen": round((neto_12 - costos["total"]) / act) if act else 0,
        "multiplo_cuota1": round(neto_12 / act / cuota1_w, 2) if act and cuota1_w else 0,
    }
    return {
        "negocio": "GPON",
        "parametros": p,
        "derivados": {"activaciones": round(act), "cumplimiento_pct": round(cumplimiento, 2), "monto_bono": monto_bono,
                      "escalon_bono": esc["desde_pct"] if esc else None, "cuota1_ponderada": round(cuota1_w),
                      "cuota2_ponderada": round(cuota2_w), "penalidad_ponderada": round(pen_w),
                      "lineas_en_mora_final": round(mora_lineas), "mora_por_linea": round(mora_por_linea)},
        "mes0": {k: round(v) for k, v in mes0.items()},
        "bruto_mes0": round(bruto_mes0),
        "meses": meses,
        "neto_6": round(neto_6), "neto_12": round(neto_12),
        "pct_retenido_6": round(neto_6 / bruto_mes0 * 100, 1) if bruto_mes0 else 0.0,
        "pct_retenido_12": round(neto_12 / bruto_mes0 * 100, 1) if bruto_mes0 else 0.0,
        "costos": costos, "margen": margen, "por_linea": por_linea,
        "cierre": {"devoluciones_12": round(dev_12), "cobros_12": round(cob_12), "ultimo_mes_caidas": max(chb, int(p["recalculo_mes"])),
                   "resultado_final": margen["meses12"], "gana": margen["meses12"] >= 0},
    }


_FLUJOS = ("cuota2", "legajos", "mora", "recalculo", "otros")


def _normalizar_afectados(meses_afectados: dict | None, h: int) -> dict[int, dict]:
    out: dict[int, dict] = {}
    for k, v in (meses_afectados or {}).items():
        try:
            m = int(k)
        except (TypeError, ValueError):
            continue
        if 2 <= m <= h and isinstance(v, dict) and v:
            out[m - 1] = v
    return out


def _aplicar_afectado(base: dict, ov: dict | None) -> dict:
    """Parámetros del mes con sus variaciones propias: claves de negocio, costos y mix de planes."""
    if not ov:
        return base
    p = copy.deepcopy(base)
    for k, v in ov.items():
        if v is None:
            continue
        if k == "costos" and isinstance(v, dict):
            p["costos"] = {**p["costos"], **{ck: cv for ck, cv in v.items() if cv is not None}}
        elif k == "planes" and isinstance(v, list):
            mix = {str(x.get("plan") or x.get("nombre")): x.get("mix_pct") for x in v if isinstance(x, dict)}
            p["planes"] = [{**pl, "mix_pct": float(mix.get(pl["nombre"], pl["mix_pct"]))} if mix.get(pl["nombre"]) is not None else pl for pl in p["planes"]]
        elif k in p:
            p[k] = v
    return p


def simular_gpon_anual(params: dict | None, ventas_por_mes: list[float], horizonte: int = 12,
                       bonos_adicionales_por_mes: list[float] | None = None, nombres_meses: list[str] | None = None,
                       meses_afectados: dict | None = None) -> dict[str, Any]:
    """Proyección ANUAL GPON, igual que pospago: el mes 1 fija la estructura (headcount) y cada
    mes se superponen los flujos de todas las cohortes anteriores (cuota 2, legajos, mora,
    recálculo). Aditiva al guaraní. Después del horizonte queda la cola (cuota 2 por cobrar,
    mora y recálculo por devolver). La salida usa las MISMAS claves que el anual de pospago
    (clawbacks = mora + otros reversos, recalculo_productividad = recálculo del bono fijo,
    bono_productividad = bono fijo, residual / portabilidad / bono_efectividad = 0) para que
    el simulador anual, la historia y el cierre sean los mismos."""
    base = parametros_gpon(params)
    h = int(horizonte) if int(horizonte) in (12, 18, 24) else 12
    ventas = [max(float(v or 0), 0) for v in (ventas_por_mes or [])][:h]
    while len(ventas) < h:
        ventas.append(ventas[-1] if ventas else float(base["ventas"]))
    bonos_ad = [max(float(x or 0), 0) for x in (bonos_adicionales_por_mes or [])][:h]
    while len(bonos_ad) < h:
        bonos_ad.append(0.0)
    nombres = [str(x or "").strip() for x in (nombres_meses or [])][:h]
    while len(nombres) < h:
        nombres.append("")
    nombres = [n or f"Mes {i + 1}" for i, n in enumerate(nombres)]
    afectados = _normalizar_afectados(meses_afectados, h)

    cohortes = []
    for t in range(h):
        pm = _aplicar_afectado(base, afectados.get(t))
        cohortes.append(simular_gpon({**pm, "ventas": ventas[t], "bono_adicional": bonos_ad[t]}))
    headcount = cohortes[0]["costos"]["headcount"]
    filas: list[dict] = []
    acum = 0
    for t in range(h):
        c = cohortes[t]
        pm_t = c["parametros"]
        fila = {"mes": t + 1, "nombre": nombres[t], "ventas": round(ventas[t]), "afectado": t in afectados,
                "variaciones": afectados.get(t, {}),
                "cumplimiento_pct": c["derivados"]["cumplimiento_pct"],
                "escalon_productividad": c["derivados"]["escalon_bono"], "monto_bono_productividad": c["derivados"]["monto_bono"],
                "monto_bono": c["derivados"]["monto_bono"],
                "activaciones_cuota1": c["mes0"]["activaciones_cuota1"], "portabilidad": 0,
                "bono_productividad": c["mes0"]["bono_fijo"], "bono_fijo": c["mes0"]["bono_fijo"], "bono_efectividad": 0,
                "bono_adicional": c["mes0"]["bono_adicional"], "facturacion_bruta": c["bruto_mes0"],
                "ventas_por_vendedor": round(ventas[t] / headcount["vendedores"], 1) if headcount["vendedores"] else 0}
        for f in _FLUJOS:
            fila[f] = sum(cohortes[s]["meses"][t - s][f] for s in range(t) if t - s < len(cohortes[s]["meses"]))
        fila["residual"] = 0
        fila["clawbacks"] = fila["mora"] + fila["otros"]
        fila["clawback_bonos"] = 0
        fila["recalculo_productividad"] = fila["recalculo"]
        fila["ajustes"] = sum(fila[f] for f in _FLUJOS)
        fila["ingreso_neto"] = fila["facturacion_bruta"] + fila["ajustes"]
        cst, _ = _costos_y_margen(pm_t["costos"], ventas[t], c["mes0"], c["bruto_mes0"], c["neto_6"], c["neto_12"], headcount=headcount)
        fila["costo_total"] = cst["total"]
        fila["costos"] = cst
        fila["resultado"] = fila["ingreso_neto"] - fila["costo_total"]
        fila["margen_pct"] = round(fila["resultado"] / fila["ingreso_neto"] * 100, 1) if fila["ingreso_neto"] else 0.0
        fila["acumulado_anterior"] = acum
        acum += fila["resultado"]
        fila["acumulado"] = acum
        fila["ola_devoluciones"] = fila["legajos"] + fila["mora"] + fila["recalculo"] + fila["otros"]
        fila["ola_cobros"] = fila["cuota2"]
        fila["lineas_en_mora"] = round(sum(cohortes[s]["meses"][t - s]["lineas_en_mora"] for s in range(t + 1) if t - s < len(cohortes[s]["meses"])))
        fila["lineas_activas"] = round(sum(ventas[s] for s in range(t + 1)) - fila["lineas_en_mora"])

        # Ventas mínimas del mes para no perder con la estructura fija (bisección, como en pospago).
        def _resultado_con(v: float) -> float:
            c2 = simular_gpon({**pm_t, "ventas": v, "bono_adicional": bonos_ad[t]})
            cst2, _ = _costos_y_margen(c2["parametros"]["costos"], v, c2["mes0"], c2["bruto_mes0"], c2["neto_6"], c2["neto_12"], headcount=headcount)
            return c2["bruto_mes0"] + fila["ajustes"] - cst2["total"]
        hi = max(ventas[t] * 3, 100.0)
        if _resultado_con(0.0) >= 0:
            fila["ventas_equilibrio"] = 0
        elif _resultado_con(hi) < 0:
            fila["ventas_equilibrio"] = None
        else:
            lo, up = 0.0, hi
            for _ in range(24):
                mid = (lo + up) / 2
                if _resultado_con(mid) >= 0:
                    up = mid
                else:
                    lo = mid
            fila["ventas_equilibrio"] = int(math.ceil(up))
        fila["en_riesgo"] = fila["ventas_equilibrio"] is None or ventas[t] < fila["ventas_equilibrio"]
        filas.append(fila)

    tot = lambda k: sum(f[k] for f in filas)  # noqa: E731
    cola = {f: 0 for f in _FLUJOS}
    for s in range(h):
        for k in range(h - s, 13):
            if k < len(cohortes[s]["meses"]):
                for f in _FLUJOS:
                    cola[f] += cohortes[s]["meses"][k][f]
    cola_cobros = round(cola["cuota2"])
    cola_dev = round(cola["legajos"] + cola["mora"] + cola["recalculo"] + cola["otros"])
    resultado = tot("resultado")
    ingreso_neto = tot("ingreso_neto")
    chb, rec_mes, c2_mes = int(base["chargeback_meses"]), int(base["recalculo_mes"]), int(base["cuota2_mes"])
    fijo = filas[0]["costo_total"] - filas[0]["costos"]["rrhh"]["operadores_comisiones"] - filas[0]["costos"]["plus_vendedores"] - filas[0]["costos"]["operativos"] - filas[0]["costos"]["logistica_entregas"]
    final = resultado + cola_cobros + cola_dev
    anual = {
        "ventas": round(sum(ventas)), "facturacion_bruta": tot("facturacion_bruta"), "ajustes": tot("ajustes"),
        "ingreso_neto": ingreso_neto, "costos": tot("costo_total"), "resultado": resultado,
        "margen_pct": round(resultado / ingreso_neto * 100, 1) if ingreso_neto else 0.0,
        "bonos": tot("bono_fijo"), "bonos_adicionales": tot("bono_adicional"),
        "devolucion_bonos": tot("recalculo"),
        "cuota2": tot("cuota2"), "legajos": tot("legajos"), "mora": tot("mora"), "recalculo": tot("recalculo"), "otros": tot("otros"),
        "costos_fijos_mes": round(fijo), "horizonte": h,
        "devoluciones_periodo": round(tot("legajos") + tot("mora") + tot("recalculo") + tot("otros")),
        "cobros_periodo": round(tot("cuota2")),
        "meses_negativos": sum(1 for f in filas if f["resultado"] < 0),
        "mejor_mes": max(filas, key=lambda f: f["resultado"])["mes"], "peor_mes": min(filas, key=lambda f: f["resultado"])["mes"],
        "meses_sin_bono_productividad": sum(1 for f in filas if f["monto_bono"] == 0),
        "ola_maxima": round(min(f["ola_devoluciones"] for f in filas)),
        "ola_maxima_mes": min(filas, key=lambda f: f["ola_devoluciones"])["mes"],
        "meses_en_riesgo": [f["mes"] for f in filas if f["en_riesgo"]],
        "ventas_equilibrio_max": max((f["ventas_equilibrio"] or 0) for f in filas),
        "cola_post_12": {"cobros": cola_cobros, "devoluciones": cola_dev, "total": cola_cobros + cola_dev,
                         "ultimo_mes_caidas": h + max(chb, rec_mes), "ultimo_mes_residual": h + c2_mes},
        "resultado_con_cola": round(final),
        "veredicto": {"gana": final >= 0, "resultado_final": round(final),
                      "pct_sobre_ingreso": round(final / (ingreso_neto + cola_cobros + cola_dev) * 100, 1) if (ingreso_neto + cola_cobros + cola_dev) else 0.0,
                      "periodo_gana": resultado >= 0, "la_cola_lo_da_vuelta": (resultado >= 0) != (final >= 0)},
        "regimen": {"resultado_mes": filas[-1]["resultado"], "margen_pct": filas[-1]["margen_pct"],
                    "ingreso_neto_mes": filas[-1]["ingreso_neto"], "ola_devoluciones_mes": filas[-1]["ola_devoluciones"]},
    }
    gs = lambda v: "Gs " + f"{round(v):,}".replace(",", ".")  # noqa: E731
    n = lambda v: f"{round(v):,}".replace(",", ".")  # noqa: E731
    partes = [
        f"{h} meses GPON con estructura fija del mes 1 ({headcount['vendedores']} vendedores, {headcount['supervisores']} supervisores, "
        f"{headcount['backoffice']} backoffice; costo fijo {gs(fijo)}/mes) y objetivo de {n(float(base['objetivo']))} líneas.",
        f"Activaciones del período: {n(anual['ventas'])}. Facturación bruta {gs(anual['facturacion_bruta'])}; con cuota 2, legajos, mora y recálculo "
        f"el ingreso neto liquidado es {gs(ingreso_neto)}. Costos {gs(anual['costos'])}. Resultado del período {gs(resultado)} ({anual['margen_pct']}%).",
    ]
    if anual["meses_negativos"]:
        partes.append(f"{anual['meses_negativos']} mes(es) con resultado negativo; el peor es {nombres[anual['peor_mes'] - 1]} y el mejor {nombres[anual['mejor_mes'] - 1]}.")
    if anual["meses_en_riesgo"]:
        partes.append(f"Riesgo por bajar productividad: en {len(anual['meses_en_riesgo'])} mes(es) las activaciones no cubren la ola de mora y recálculo heredada más la estructura fija "
                      f"(ola máxima {gs(abs(anual['ola_maxima']))} en {nombres[anual['ola_maxima_mes'] - 1]}; hacen falta hasta {n(anual['ventas_equilibrio_max'])} activaciones/mes para no perder).")
    if afectados:
        partes.append(f"{len(afectados)} mes(es) con variaciones propias: " + ", ".join(nombres[t] for t in sorted(afectados)) + ".")
    if anual["bonos_adicionales"]:
        partes.append(f"Incluye {gs(anual['bonos_adicionales'])} de bono adicional cargado a mano.")
    if anual["meses_sin_bono_productividad"] and base.get("bonos_activos", True):
        esc_min = min(float(e["desde_pct"]) for e in base["escala_bono"]) if base.get("escala_bono") else 0
        partes.append(f"En {anual['meses_sin_bono_productividad']} mes(es) las activaciones quedaron bajo el {esc_min:.0f}% del objetivo y el bono fijo no se liquidó.")
    partes.append(f"Cierre con todas las caídas: después del mes {h} las cohortes todavía tienen {gs(cola_cobros)} de cuota 2 por cobrar (hasta el mes {h + c2_mes}) "
                  f"y {gs(abs(cola_dev))} por devolver (mora y recálculo hasta el mes {h + max(chb, rec_mes)}). "
                  f"Con esa cola el negocio {'GANA' if final >= 0 else 'PIERDE'} {gs(abs(final))}"
                  + (" — el período cerraba en pérdida y la cola lo da vuelta." if anual["veredicto"]["la_cola_lo_da_vuelta"] and final >= 0
                     else " — el período cerraba en ganancia pero las devoluciones pendientes la consumen." if anual["veredicto"]["la_cola_lo_da_vuelta"] else "."))
    return {"negocio": "GPON", "parametros": base, "horizonte": h, "ventas_por_mes": [round(v) for v in ventas], "nombres_meses": nombres,
            "meses_afectados": {str(t + 1): v for t, v in afectados.items()}, "bonos_adicionales_por_mes": bonos_ad,
            "headcount": headcount, "meses": filas, "anual": anual, "cohorte_mes1": cohortes[0], "conclusion": " ".join(partes)}
