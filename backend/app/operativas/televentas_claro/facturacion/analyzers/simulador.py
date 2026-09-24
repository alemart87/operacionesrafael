"""Simulador de FACTURACIÓN — Televentas Claro (liquidación de comisiones).

El usuario carga la cantidad de VENTAS EFECTIVAS del mes (= activaciones,
cuota 1) y el simulador genera la facturación del mes (mes 0) y cuánto de esa facturación queda realmente a los
6 meses (fin del chargeback) y a los 12 (fin del residual), proyectando las
caídas de líneas con la ZAFRA (curva de líneas activas por mes de antigüedad).

TODAS las variables de negocio y componentes de facturación son editables
(`PARAMETROS_DEFAULT` son los valores sembrados con las liquidaciones reales):

  Ventas efectivas = activaciones (cuota 1). La EFECTIVIDAD es de ENTREGAS:
  solo define el escalón del bono efectividad, NO descuenta ventas.
  Mes 0  = cuota 1 por plan + plus de portabilidad + bono productividad + bono efectividad
  Mes 1  = − legajos faltantes/incompletos
  Mes k  = + residual (14,5% del abono acreditado × líneas activas según zafra)
           − clawbacks por caídas dentro del chargeback (cuota 1 + residual +
             portabilidad + bono efectividad), neto de recuperos por reconexión
  Mes 3  = + cuota 2 (líneas activas al día 90; legajo incompleto = mitad)
  Mes 6  = − recálculo del bono productividad (líneas no activas al día 180)

Criterios Claro (editables):
  Bono productividad (1771): por línea en estado A; % cumplimiento = activaciones
    netas ÷ objetivo; escala vigente comunicada por Claro: ≥110% 120.000 · ≥105% 115.000 ·
    ≥100% 105.000 · ≥95% 40.000 · <95% 0. Recálculo al 6º mes (1871).
  Bono efectividad distribución (1891): por venta entregada según efectividad
    (activaciones ÷ ventas): ≥85% 50.000 · ≥82% 45.000 · ≥80% 35.000 · <80% 0.
  Cuota 2: mes +3, línea activa al día 90 y legajo completo (incompleto = 50%).
"""
from __future__ import annotations

import copy
import math
from typing import Any

# Zafra tipo del negocio (% líneas nuevas activas por mes de antigüedad),
# promedio de las cohortes 2025-07 … 2026-01 informadas por Claro. Manda las caídas
# (chargeback, cuota 2, descuento de bonos).
ZAFRA_DEFAULT = [99.9, 82.6, 58.5, 53.8, 53.1, 49.2, 51.1, 46.2, 41.9, 40.7, 40.1, 40.4, 41.8]
# Curva de líneas que PAGAN residual por mes de antigüedad (índice 0 = mes 1). El residual
# no lo cobra toda línea activa sino la que tiene monto acreditado; medido sobre 7 liquidaciones
# reales (383-389, nov-2025 a may-2026, 146.000 filas de RESIDUAL).
RESIDUAL_CURVA_DEFAULT = [91.3, 63.7, 53.8, 51.7, 50.9, 49.5, 46.6, 43.7, 42.4, 39.6, 35.7, 32.4]

PARAMETROS_DEFAULT: dict[str, Any] = {
    # ---- entrada principal ----
    "ventas": 1950,                 # ventas EFECTIVAS del mes (= activaciones cuota 1)
    "efectividad_pct": 89.0,        # efectividad de ENTREGAS: solo elige el escalón del bono (real: 88,5–89,1%)
    "pct_bono_efectividad_cobrado": 87.5,   # % de las activaciones que cobran el bono efectividad (real 7 liq: 82–91%, pond. 87,5%)
    "objetivo_co": 1750,            # objetivo mensual de líneas CO (lo comunica Claro)
    "pct_estado_a": 99.5,           # activaciones en estado A (no S/P/C) al liquidar
    "bonos_activos": True,          # False = simular SIN bonos (productividad y efectividad en 0)
    "bono_adicional": 0.0,          # BONO ADICIONAL a mano (Gs totales del mes): campañas, premios o acuerdos puntuales
    "ajuste_comisiones_pct": 0.0,   # ajuste negociado sobre cuota 1, cuota 2 y plus de portabilidad (+5 = mejora 5%)
    # ---- tarifas por plan (Gs sin IVA) y mix ----
    "planes": [   # mix real de activaciones cuota 1 en 7 liquidaciones: 58% / 39% / 2,5% / 0,5%
        {"plan": "CG15G", "mix_pct": 58.0, "cuota1": 204545, "cuota2": 34091, "porta_plus": 218182, "abono": 170455},
        {"plan": "CG30G", "mix_pct": 39.0, "cuota1": 245455, "cuota2": 81818, "porta_plus": 245455, "abono": 204545},
        {"plan": "CG50B", "mix_pct": 2.5, "cuota1": 272727, "cuota2": 109091, "porta_plus": 327273, "abono": 272727},
        {"plan": "C100X", "mix_pct": 0.5, "cuota1": 272727, "cuota2": 136364, "porta_plus": 409091, "abono": 340909},
    ],
    "porta_pct": 90.0,              # % de activaciones con plus de portabilidad (real 7 liq: 82–94%, pond. 89,8%)
    # ---- cuota 2 y legajos ----
    "cuota2_mes": 3,
    "legajo_incompleto_pct": 5.0,   # cobra cuota 2 al 50% y descuento de media cuota 1
    "legajo_no_presentado_pct": 3.0,  # descuento de la cuota 1 completa
    # ---- residual ----
    "residual_pct": 14.5,           # sobre el abono ACREDITADO (exacto en todas las filas RESIDUAL)
    "pct_abono_acreditado": 48.0,   # acreditado promedio de las líneas que pagan ÷ abono del plan (real: ~89.000 / 184.000)
    "residual_meses": 12,
    "residual_curva_pct": list(RESIDUAL_CURVA_DEFAULT),   # % de líneas que pagan residual por mes de antigüedad
    # ---- bonos (escalas editables) ----
    # Escala VIGENTE comunicada por Claro (tabla ">= / Cuota"): ≥110% 120.000 · ≥105% 115.000 ·
    # ≥100% 105.000 · ≥95% 40.000; bajo el 95% no se cobra. Historial liquidado: 2025 pagó 95.000 al
    # ≥100% (nov, dic); ene–may 2026 pagó 110.000 al ≥100% y 50.000 entre 95 y 100% (feb, may).
    "escala_productividad": [
        {"desde_pct": 110, "monto": 120000}, {"desde_pct": 105, "monto": 115000},
        {"desde_pct": 100, "monto": 105000}, {"desde_pct": 95, "monto": 40000},
    ],
    "recalculo_productividad_mes": 6,
    # Regla de Claro (verificada fila por fila en las 7 liquidaciones, concepto 1871): una sola vez, entre el
    # día 152 y 184 (mediana 163), una fila por línea de la cohorte; las caídas devuelven el 100% de su bono
    # y las activas 0. Líneas castigadas por cohorte: jul-25 41%, ago 45%, sep 52%, oct 51%, nov 52%
    # (promedio 48,5%) = la zafra al mes 6 (100 − 51,1 = 48,9%). Después del día 184 no hay ningún
    # descuento de bonos (cohortes observadas hasta 12 meses). None = "según zafra".
    "pct_recalculo_productividad": None,
    "escala_efectividad": [
        {"desde_pct": 85, "monto": 50000}, {"desde_pct": 82, "monto": 45000},
        {"desde_pct": 80, "monto": 35000},
    ],
    # ---- zafra y chargeback ----
    "zafra_pct": list(ZAFRA_DEFAULT),
    "chargeback_meses": 6,
    "pct_caidas_penalizables": 85.0,    # caídas que pierden la CUOTA 1 (suspensión penalizable, deuda, reverso); el plus porta y el
                                        # bono efectividad se devuelven en el 100% de las caídas (real 7 liq: 46% de las activaciones
                                        # pierden cuota 1 contra 51% de caídas de la zafra, con montos parciales por deuda)
    "migracion_negocio_pct": 3.2,       # % de activaciones penalizadas por migración a otro negocio (PENALIZACIÓN POR MIGRACIÓN DE NEGOCIO)
    "migracion_mes": 3,                 # se registra a los ~90 días
    # Parte de los descuentos del chargeback que Claro devuelve después (reconexiones, reverso del
    # descuento de portabilidad, recupero de incentivos, reverso de penalización por deuda).
    # Calibrado con 7 liquidaciones reales (383-389): 21,0 · 14,4 · 3,0 · 9,2 · 6,5 · 9,9 · 21,2% → ponderado 12,1%.
    "recupero_pct": 12.0,
    "clawback_incluye_residual": True,  # suspensión penalizable = cuota 1 + 1 residual (214.431)
    # ---- COSTOS de la estructura (el indicador principal: ventas por vendedor) ----
    "costos": {
        "ventas_por_vendedor": 20,          # 1.900 ventas → 95 vendedores
        "supervisor_cada_vendedores": 14,   # 1 supervisor cada 14 vendedores
        "backoffice_cada_ventas": 180,      # 1 backoffice cada 180 ventas
        "coordinadores": 1,
        "controllers": 2,
        "salario_hora": 14635, "horas_dia": 7, "dias_mes": 23,   # operador: 14.635 × 7 h × 23 días
        # Remuneración variable del VENDEDOR, como MONTO por venta (no como % de la facturación):
        "comision_por_venta": 102000,       # comisión por venta (promedio real): paga IPS y aguinaldo
        "plus_por_venta": 32000,            # plus por venta: NO paga IPS ni aguinaldo
        "supervisor_salario": 4180000, "supervisor_premio": 1500000,
        "coordinador_salario": 6000000, "coordinador_premio": 2500000,
        "backoffice_salario": 3044000,
        "controller_salario": 3600000, "controller_premio": 750000,
        "subgerencia_salario": 0,           # SubGerencia Comercial (en análisis): salario mensual, 0 = no incorporada
        "ips_pct": 16.5,                    # sobre todos los costos de RRHH
        "aguinaldo": True,                  # previsión mensual: RRHH ÷ 12 (sin IPS)
        "logistica_central": 55000, "logistica_interior": 80000, "logistica_interior_pct": 60.0,
        "logistica_premios": 20000000,      # premios a logística (fijo mensual)
        "operativo_por_venta": 12500,       # costos operativos adicionales por venta
    },
}


def _escala(escala: list[dict], valor_pct: float) -> tuple[float, dict | None]:
    """Monto de la escala para un % (el escalón más alto cuyo 'desde' se alcanza)."""
    for e in sorted(escala, key=lambda x: -float(x["desde_pct"])):
        if valor_pct >= float(e["desde_pct"]):
            return float(e["monto"]), e
    return 0.0, None


def parametros_con_defaults(overrides: dict | None) -> dict:
    p = copy.deepcopy(PARAMETROS_DEFAULT)
    for k, v in (overrides or {}).items():
        if k == "_sin_breakeven":
            p[k] = v
            continue
        if v is None or k not in p:
            continue
        if k == "costos" and isinstance(v, dict):
            p["costos"] = {**p["costos"], **{ck: cv for ck, cv in v.items() if cv is not None}}
        else:
            p[k] = v
    return p


def pct_recalculo_efectivo(p: dict) -> float:
    """% de líneas cuyo bono productividad se devuelve completo en el recálculo (día 180).

    Si el parámetro viene vacío (None) se aplica la regla de Claro: 100% de las líneas caídas según la
    zafra al mes del recálculo (100 − zafra[mes]). Un número explícito lo reemplaza (0–100)."""
    v = p.get("pct_recalculo_productividad")
    if v is None or v == "":
        z = [min(max(float(x or 0), 0), 100) for x in (p.get("zafra_pct") or ZAFRA_DEFAULT)]
        k = int(p.get("recalculo_productividad_mes") or 6)
        k = min(max(k, 0), len(z) - 1)
        return round(100.0 - z[k], 1)
    return min(max(float(v), 0), 100)


def simular_facturacion(params: dict | None = None) -> dict[str, Any]:
    p = parametros_con_defaults(params)
    ventas = max(float(p["ventas"] or 0), 0)
    efect = max(float(p["efectividad_pct"] or 0), 0)
    act = ventas  # las ventas cargadas ya son efectivas: NO se descuentan por efectividad
    act_a = act * max(float(p["pct_estado_a"] or 0), 0) / 100.0
    objetivo = max(float(p["objetivo_co"] or 0), 1)
    cumplimiento = act_a / objetivo * 100.0
    porta = min(max(float(p["porta_pct"] or 0), 0), 100) / 100.0

    # ---- valores ponderados por mix ----
    planes = [pl for pl in p["planes"] if float(pl.get("mix_pct") or 0) > 0]
    mix_total = sum(float(pl["mix_pct"]) for pl in planes) or 1.0
    def w(key: str) -> float:
        return sum(float(pl.get(key) or 0) * float(pl["mix_pct"]) / mix_total for pl in planes)
    cuota1_w, cuota2_w, porta_w, abono_w = w("cuota1"), w("cuota2"), w("porta_plus"), w("abono")
    # Ajuste de comisiones negociado con Claro: escala cuota 1, cuota 2 y porta (residual y bonos no cambian).
    # Las comisiones que se pagan a los VENDEDORES se calculan sobre la tarifa SIN ajuste:
    # la mejora negociada es íntegramente margen de Voicenter.
    ajuste = 1 + float(p.get("ajuste_comisiones_pct") or 0) / 100.0
    cuota1_base, porta_base = cuota1_w, porta_w
    cuota1_w, cuota2_w, porta_w = cuota1_w * ajuste, cuota2_w * ajuste, porta_w * ajuste
    residual_linea = abono_w * float(p["pct_abono_acreditado"]) / 100.0 * float(p["residual_pct"]) / 100.0

    bonos_activos = bool(p.get("bonos_activos", True))
    monto_prod, esc_prod = _escala(p["escala_productividad"], cumplimiento) if bonos_activos else (0.0, None)
    monto_efect, esc_efect = _escala(p["escala_efectividad"], efect) if bonos_activos else (0.0, None)
    pct_bef = min(max(float(p.get("pct_bono_efectividad_cobrado", 100) or 0), 0), 100) / 100.0
    pct_recalc = pct_recalculo_efectivo(p) / 100.0
    migr = min(max(float(p.get("migracion_negocio_pct", 0) or 0), 0), 100) / 100.0

    # ---- MES 0: facturación del mes ----
    mes0 = {
        "activaciones_cuota1": act * cuota1_w,
        "portabilidad": act * porta * porta_w,
        "bono_productividad": act_a * monto_prod,
        # Bono efectividad: Claro lo paga en una parte de las activaciones (real ~87,5%), no en todas.
        "bono_efectividad": act * pct_bef * monto_efect,
        # Bono adicional cargado a mano: se factura en el mes, no se devuelve ni se recalcula.
        "bono_adicional": max(float(p.get("bono_adicional") or 0), 0),
    }
    bruto_mes0 = sum(mes0.values())

    # ---- MESES 1..12: residual, cuota 2, clawbacks, recálculos ----
    z = [min(max(float(v), 0), 100) / 100.0 for v in p["zafra_pct"]]
    while len(z) < 13:
        z.append(z[-1] if z else 0.0)
    # Curva de líneas que pagan residual (mes 1..12); si no viene, cae en la zafra.
    rc = [min(max(float(v), 0), 100) / 100.0 for v in (p.get("residual_curva_pct") or [])]
    if not rc:
        rc = z[1:13]
    while len(rc) < 12:
        rc.append(rc[-1])
    chb = int(p["chargeback_meses"])
    pen = min(max(float(p["pct_caidas_penalizables"]), 0), 100) / 100.0
    recupero = min(max(float(p["recupero_pct"]), 0), 100) / 100.0
    leg_inc = float(p["legajo_incompleto_pct"]) / 100.0
    leg_np = float(p["legajo_no_presentado_pct"]) / 100.0
    # Devolución por línea caída: la cuota 1 (+ un residual) se pierde en `pen` de las caídas (suspensión
    # penalizable, deuda, reverso); el plus de portabilidad se devuelve en todas las caídas del chargeback.
    clawback_linea_base = pen * (cuota1_w + (residual_linea if p["clawback_incluye_residual"] else 0)) + porta * porta_w

    meses = [{"mes": 0, "residual": 0.0, "cuota2": 0.0, "legajos": 0.0, "clawbacks": 0.0,
              "clawback_bonos": 0.0, "recalculo_productividad": 0.0, "neto_mes": bruto_mes0,
              "acumulado": bruto_mes0, "lineas_activas": act * z[0], "caidas": 0.0}]
    acumulado = bruto_mes0
    for k in range(1, 13):
        row = {"mes": k, "residual": 0.0, "cuota2": 0.0, "legajos": 0.0, "clawbacks": 0.0,
               "clawback_bonos": 0.0, "recalculo_productividad": 0.0, "caidas": 0.0}
        if k <= int(p["residual_meses"]):
            row["residual"] = act * rc[k - 1] * residual_linea
        if k == 1:
            row["legajos"] = -act * (leg_np * cuota1_w + leg_inc * cuota1_w / 2)
        if k <= chb:
            caidas = act * max(0.0, z[k - 1] - z[k])
            row["caidas"] = caidas
            row["clawbacks"] = -caidas * clawback_linea_base * (1 - recupero)
            row["clawback_bonos"] = -caidas * pct_bef * monto_efect * (1 - recupero)
        if k == int(p.get("migracion_mes") or 3) and migr > 0:
            # Migración de negocio: pierde la cuota 1 completa, sin recupero (la línea deja el pospago).
            row["clawbacks"] += -act * migr * cuota1_w
        if k == int(p["cuota2_mes"]):
            # Cuota 2: línea activa al día 90; legajo incompleto cobra la mitad y legajo no presentado cobra 0.
            row["cuota2"] = act * z[k] * cuota2_w * (1 - leg_inc / 2 - leg_np)
        if k == int(p["recalculo_productividad_mes"]):
            # Recálculo: % de líneas castigadas medido en las liquidaciones (las suspendidas sin cancelar cuentan activas).
            row["recalculo_productividad"] = -act_a * monto_prod * pct_recalc
        row["neto_mes"] = (row["residual"] + row["cuota2"] + row["legajos"] + row["clawbacks"]
                           + row["clawback_bonos"] + row["recalculo_productividad"])
        acumulado += row["neto_mes"]
        row["acumulado"] = acumulado
        row["lineas_activas"] = act * z[k]
        meses.append(row)

    neto_6 = meses[min(6, 12)]["acumulado"]
    neto_12 = meses[12]["acumulado"]

    # ---- peso de los bonos sobre la facturación neta ----
    bonos_mes0 = mes0["bono_productividad"] + mes0["bono_efectividad"] + mes0["bono_adicional"]
    bonos_devueltos_6 = sum(m["clawback_bonos"] + m["recalculo_productividad"] for m in meses[1:7])
    bonos_netos_6 = bonos_mes0 + bonos_devueltos_6
    sin_bonos_mes0 = bruto_mes0 - bonos_mes0
    sin_bonos_6 = neto_6 - bonos_netos_6

    # Distancia al acantilado: siguiente escalón y margen sobre el actual (en activaciones).
    def _distancias(escala: list[dict], valor_pct: float, base: float, unidad: str) -> dict:
        ordenada = sorted(escala, key=lambda x: float(x["desde_pct"]))
        actual = [e for e in ordenada if valor_pct >= float(e["desde_pct"])]
        siguiente = [e for e in ordenada if valor_pct < float(e["desde_pct"])]
        out: dict[str, Any] = {"valor_pct": round(valor_pct, 2), "unidad": unidad}
        if actual:
            e = actual[-1]
            out["escalon_actual"] = e
            out["margen_pct"] = round(valor_pct - float(e["desde_pct"]), 2)
            out["margen_unidades"] = int((valor_pct - float(e["desde_pct"])) / 100.0 * base)
        else:
            out["escalon_actual"] = None
        if siguiente:
            e = siguiente[0]
            out["siguiente_escalon"] = e
            out["faltan_pct"] = round(float(e["desde_pct"]) - valor_pct, 2)
            out["faltan_unidades"] = int(-(-(float(e["desde_pct"]) - valor_pct) / 100.0 * base // 1))
        return out

    dist_prod = _distancias(p["escala_productividad"], cumplimiento, objetivo, "activaciones")
    dist_efect = _distancias(p["escala_efectividad"], efect, 0, "pts")  # se mide en puntos de efectividad

    # ---- COSTOS de la estructura y MARGEN (evaluación del negocio, foco a 6 meses) ----
    # La comisión y el plus del vendedor son montos por venta: no dependen de la tarifa ni del ajuste.
    costos, margen = _costos_y_margen(p["costos"], act, mes0, bruto_mes0, neto_6, neto_12)
    if not p.get("_sin_breakeven"):
        margen["breakeven_ventas_6"] = _breakeven(p)

    # ---- conclusión ejecutiva ----
    def gs(v: float) -> str:
        return f"Gs {v:,.0f}".replace(",", ".")
    partes = [
        f"Con {ventas:,.0f} ventas efectivas (efectividad de entregas {efect:.1f}%), la facturación del mes es "
        f"{gs(bruto_mes0)}.".replace(",", "."),
        f"A los 6 meses (fin del chargeback) de esa facturación quedan {gs(neto_6)} — el {neto_6 / bruto_mes0 * 100 if bruto_mes0 else 0:.0f}% — "
        f"y a los 12 meses, sumando el residual completo, {gs(neto_12)} ({neto_12 / bruto_mes0 * 100 if bruto_mes0 else 0:.0f}%).",
        f"Los bonos pesan {bonos_mes0 / bruto_mes0 * 100 if bruto_mes0 else 0:.0f}% de la facturación del mes y "
        f"{bonos_netos_6 / neto_6 * 100 if neto_6 else 0:.0f}% de lo que queda a 6 meses: sin bonos el mes sería "
        f"{gs(sin_bonos_mes0)}.",
    ]
    partes.append(
        f"Costo de la estructura: {gs(costos['total'])} ({costos['headcount']['vendedores']} vendedores, "
        f"{costos['headcount']['supervisores']} supervisores, {costos['headcount']['backoffice']} backoffice) — "
        f"{gs(costos['costo_por_venta'])} por venta. Margen del mes {gs(margen['mes0'])} ({margen['pct_mes0']}%); "
        f"a 6 meses, con las caídas descontadas, {gs(margen['meses6'])} ({margen['pct_6']}%)"
        + (f"; punto de equilibrio a 6 meses: {margen['breakeven_ventas_6']:,.0f} ventas." if margen.get("breakeven_ventas_6") else ".")
    )
    if float(p.get("ajuste_comisiones_pct") or 0):
        aj = float(p["ajuste_comisiones_pct"])
        partes.append(f"Con un ajuste de comisiones del {aj:+.1f}% sobre cuota 1, cuota 2 y portabilidad "
                      f"(cuota 1 ponderada {gs(cuota1_w)}); la comisión de los vendedores es un monto por venta y no cambia con la tarifa "
                      f"sin ajuste, así que la mejora es íntegramente margen de Voicenter.")
    if not bonos_activos:
        partes.append("SIMULACIÓN SIN BONOS: los bonos de productividad y efectividad están desactivados por el usuario "
                      "— este es el resultado que sostiene el negocio si Claro no los liquida.")
    if bonos_activos and esc_prod is None:
        partes.append(f"ALERTA: el cumplimiento del objetivo CO es {cumplimiento:.1f}% — por debajo de la escala mínima, "
                      "el bono productividad liquida 0.")
    elif bonos_activos and esc_prod is not None and dist_prod.get("siguiente_escalon"):
        partes.append(f"Bono productividad: escalón {esc_prod['desde_pct']}% ({gs(monto_prod)}/línea); "
                      f"faltan {dist_prod['faltan_unidades']} activaciones para el escalón {dist_prod['siguiente_escalon']['desde_pct']}% "
                      f"({gs(float(dist_prod['siguiente_escalon']['monto']))}/línea) y hay {dist_prod['margen_unidades']} de margen antes de caer al escalón inferior.")
    if bonos_activos and esc_efect is None:
        partes.append(f"ALERTA: efectividad {efect:.1f}% por debajo del 80% — el bono efectividad liquida 0.")
    conclusion = " ".join(partes)

    recomendaciones: list[dict] = []
    if bonos_activos and dist_prod.get("siguiente_escalon") and dist_prod["faltan_unidades"] <= max(30, act * 0.03):
        e = dist_prod["siguiente_escalon"]
        ganancia = act_a * (float(e["monto"]) - monto_prod)
        recomendaciones.append({"severidad": "alert", "titulo": f"A {dist_prod['faltan_unidades']} activaciones del escalón {e['desde_pct']}%",
                                "detalle": f"Sumar {dist_prod['faltan_unidades']} activaciones netas vale {gs(ganancia)} adicionales de bono productividad este mes (todas las líneas pasan a {gs(float(e['monto']))})."})
    if bonos_activos and esc_prod is not None and dist_prod.get("margen_unidades", 0) <= max(30, act * 0.03):
        inferior = [x for x in sorted(p["escala_productividad"], key=lambda x: -float(x["desde_pct"])) if float(x["desde_pct"]) < float(esc_prod["desde_pct"])]
        perdida = act_a * (monto_prod - (float(inferior[0]["monto"]) if inferior else 0))
        recomendaciones.append({"severidad": "warning", "titulo": f"Acantilado del bono: solo {dist_prod['margen_unidades']} activaciones de margen",
                                "detalle": f"Si el mes cierra {dist_prod['margen_unidades'] + 1} activaciones abajo, el bono productividad cae a "
                                           f"{gs(float(inferior[0]['monto'])) if inferior else 'Gs 0'}/línea: {gs(perdida)} menos de facturación."})
    # PFI (primera factura impaga, razón P9-735): la suspensión penalizable llega a los ~60 días, así que en
    # la zafra vive en las caídas acumuladas de los dos primeros meses (1 − z[2]). Real por cohorte
    # (nov-25 a mar-26): 26,9 · 27,3 · 26,9 · 28,5 · 34,1% → 28,7% de las ventas; el 16% se reconecta.
    caida_2 = 1 - z[2]
    if caida_2 > 0.12:
        valor_pt = act * 0.01 * clawback_linea_base * (1 - recupero)
        recomendaciones.append({"severidad": "alert", "titulo": f"PFI: los dos primeros meses se llevan el {caida_2 * 100:.0f}% de las líneas",
                                "detalle": f"La zafra pierde {(1 - z[1]) * 100:.0f}% en el mes 1 y otro {(z[1] - z[2]) * 100:.0f}% en el mes 2, donde cae la suspensión por primera factura impaga (P9-735), medida en 28,7% de las ventas por cohorte. "
                                           f"Cada punto de retención en esos dos meses vale {gs(valor_pt)} de devoluciones evitadas. La palanca: calidad de venta y cobranza de la primera factura."})
    exp_porta = act * porta * porta_w * (1 - z[chb]) * (1 - recupero)
    recomendaciones.append({"severidad": "info", "titulo": f"Portabilidad: {gs(mes0['portabilidad'])} en el mes, {gs(exp_porta)} vuelven en chargeback",
                            "detalle": f"Con {porta * 100:.0f}% de portación, el plus de portabilidad es el componente con mayor exposición al chargeback: "
                                       f"se devuelve el de cada línea que cae antes del mes {chb}."})
    if margen["meses6"] < 0:
        recomendaciones.insert(0, {"severidad": "alert", "titulo": f"Margen negativo a 6 meses: {gs(margen['meses6'])}",
                                   "detalle": f"Lo que queda de la facturación a 6 meses ({gs(neto_6)}) no cubre el costo de la estructura ({gs(costos['total'])}). "
                                              + (f"Punto de equilibrio: {margen['breakeven_ventas_6']:,.0f} ventas con esta estructura. " if margen.get("breakeven_ventas_6") else "")
                                              + "Palancas: ventas por vendedor, retención del mes 1 y los escalones de bonos."})
    elif margen["pct_6"] < 15:
        recomendaciones.insert(0, {"severidad": "warning", "titulo": f"Margen ajustado a 6 meses: {margen['pct_6']}%",
                                   "detalle": f"Con {p['costos']['ventas_por_vendedor']} ventas por vendedor el costo por venta es {gs(costos['costo_por_venta'])} contra {gs(neto_6 / act if act else 0)} que quedan por venta a 6 meses. Subir 1 venta por vendedor ahorra {gs(_ahorro_por_venta_vendedor(p, act))} al mes."})
    recomendaciones.append({"severidad": "info", "titulo": f"Residual: {gs(sum(m['residual'] for m in meses))} en 12 meses",
                            "detalle": f"Cada línea que paga deja {gs(residual_linea)}/mes durante {int(p['residual_meses'])} meses; subir un punto la curva de líneas que pagan vale {gs(act * 0.01 * residual_linea * int(p['residual_meses']))} de residual futuro."})

    return {
        "parametros": p,
        "derivados": {
            "activaciones": round(act), "activaciones_estado_a": round(act_a), "bonos_activos": bonos_activos,
            "cumplimiento_pct": round(cumplimiento, 2), "monto_bono_productividad": monto_prod,
            "pct_recalculo_efectivo": round(pct_recalc * 100, 1),
            "escalon_productividad": esc_prod, "monto_bono_efectividad": monto_efect, "escalon_efectividad": esc_efect,
            "ajuste_comisiones_pct": float(p.get("ajuste_comisiones_pct") or 0),
            "cuota1_ponderada": round(cuota1_w), "cuota2_ponderada": round(cuota2_w),
            "porta_plus_ponderado": round(porta_w), "residual_por_linea": round(residual_linea),
            "clawback_por_linea": round(clawback_linea_base),
        },
        "mes0": {k: round(v) for k, v in mes0.items()},
        "bruto_mes0": round(bruto_mes0),
        "neto_6": round(neto_6), "neto_12": round(neto_12),
        "pct_retenido_6": round(neto_6 / bruto_mes0 * 100, 1) if bruto_mes0 else 0.0,
        "pct_retenido_12": round(neto_12 / bruto_mes0 * 100, 1) if bruto_mes0 else 0.0,
        "meses": [{k: (round(v) if isinstance(v, float) else v) for k, v in m.items()} for m in meses],
        "bonos": {
            "mes0": round(bonos_mes0),
            "peso_mes0_pct": round(bonos_mes0 / bruto_mes0 * 100, 1) if bruto_mes0 else 0.0,
            "devueltos_6": round(bonos_devueltos_6),
            "netos_6": round(bonos_netos_6),
            "peso_neto_6_pct": round(bonos_netos_6 / neto_6 * 100, 1) if neto_6 else 0.0,
            "sin_bonos_mes0": round(sin_bonos_mes0),
            "sin_bonos_6": round(sin_bonos_6),
            "distancia_productividad": dist_prod,
            "distancia_efectividad": dist_efect,
        },
        "costos": costos,
        "margen": margen,
        "cierre": _cierre_cohorte(p, meses, bruto_mes0, neto_6, neto_12, costos["total"], margen),
        "conclusion": conclusion,
        "recomendaciones": recomendaciones,
    }


def _cierre_cohorte(p: dict, meses: list[dict], bruto_mes0: float, neto_6: float, neto_12: float,
                    costo_total: float, margen: dict) -> dict[str, Any]:
    """Puente de una cohorte desde lo facturado hasta el resultado final, cuando ya
    cayeron todas las caídas (ventana de chargeback) y se cobró todo el residual."""
    chb = int(p["chargeback_meses"])
    neg = ("legajos", "clawbacks", "clawback_bonos", "recalculo_productividad")
    pos = ("residual", "cuota2")
    dev_12 = sum(m[k] for m in meses[1:] for k in neg)
    cob_12 = sum(m[k] for m in meses[1:] for k in pos)
    dev_6 = sum(m[k] for m in meses[1:7] for k in neg)
    cob_6 = sum(m[k] for m in meses[1:7] for k in pos)
    # Mes en que ya no hay devoluciones pendientes (chargeback, recálculo de bono, legajos).
    ultimo_mes_caidas = max([chb, int(p["recalculo_productividad_mes"]) if p.get("bonos_activos", True) else 0, 1])
    final = float(margen["meses12"])
    return {
        "ultimo_mes_caidas": ultimo_mes_caidas,
        "ultimo_mes_residual": int(p["residual_meses"]),
        "devoluciones_6": round(dev_6), "cobros_6": round(cob_6),
        "devoluciones_12": round(dev_12), "cobros_12": round(cob_12),
        "pct_devuelto_12": round(-dev_12 / bruto_mes0 * 100, 1) if bruto_mes0 else 0.0,
        "resultado_final": round(final),
        "gana": final >= 0,
        "gana_a_6": float(margen["meses6"]) >= 0,
        "el_residual_lo_da_vuelta": float(margen["meses6"]) < 0 <= final,
    }


def _costos_y_margen(c: dict, act: float, mes0: dict, bruto_mes0: float,
                     neto_6: float, neto_12: float, headcount: dict | None = None) -> tuple[dict, dict]:
    """Costos mensuales de la estructura para `act` ventas y margen contra lo facturado
    (mes 0) y contra lo que realmente queda a 6 y 12 meses. Con `headcount` la
    estructura queda FIJA (simulación anual: se setea en el mes 1) y solo varían
    comisiones, logística de entregas y operativos con las ventas del mes."""
    if headcount:
        vendedores, supervisores, backoffice = headcount["vendedores"], headcount["supervisores"], headcount["backoffice"]
        coordinadores, controllers = headcount["coordinadores"], headcount["controllers"]
    else:
        vpv = max(float(c["ventas_por_vendedor"] or 0), 0.01)
        vendedores = math.ceil(act / vpv) if act > 0 else 0
        supervisores = math.ceil(vendedores / max(float(c["supervisor_cada_vendedores"] or 1), 1)) if vendedores else 0
        backoffice = math.ceil(act / max(float(c["backoffice_cada_ventas"] or 1), 1)) if act > 0 else 0
        coordinadores = int(c["coordinadores"] or 0)
        controllers = int(c["controllers"] or 0)

    salario_operador = float(c["salario_hora"]) * float(c["horas_dia"]) * float(c["dias_mes"])
    comision_venta = max(float(c.get("comision_por_venta") or 0), 0)   # con IPS y aguinaldo
    plus_venta = max(float(c.get("plus_por_venta") or 0), 0)           # sin cargas sociales
    rrhh = {
        "operadores_salario": vendedores * salario_operador,
        "operadores_comisiones": act * comision_venta,
        "supervisores": supervisores * (float(c["supervisor_salario"]) + float(c["supervisor_premio"])),
        "coordinadores": coordinadores * (float(c["coordinador_salario"]) + float(c["coordinador_premio"])),
        "backoffice": backoffice * float(c["backoffice_salario"]),
        "controllers": controllers * (float(c["controller_salario"]) + float(c["controller_premio"])),
        # SubGerencia Comercial: 1 persona si se carga un salario; paga IPS y aguinaldo como el resto.
        "subgerencia": float(c.get("subgerencia_salario") or 0),
    }
    subgerencia = 1 if rrhh["subgerencia"] > 0 else 0
    rrhh_base = sum(rrhh.values())
    ips = rrhh_base * float(c["ips_pct"]) / 100.0
    # Cargas sociales: IPS sobre todo el costo de RRHH; aguinaldo = 1/12 del RRHH por mes (sin IPS).
    aguinaldo = rrhh_base / 12.0 if c.get("aguinaldo", True) else 0.0
    # Plus por venta del vendedor: fuera del RRHH porque NO paga IPS ni aguinaldo.
    plus_vendedores = act * plus_venta
    interior = min(max(float(c["logistica_interior_pct"]), 0), 100) / 100.0
    logistica_entregas = act * (interior * float(c["logistica_interior"]) + (1 - interior) * float(c["logistica_central"]))
    logistica_premios = float(c["logistica_premios"])
    operativos = act * float(c["operativo_por_venta"])
    # Total sobre componentes redondeados: la tabla de costos debe ser aditiva al guaraní.
    rrhh_base, ips, aguinaldo, plus_vendedores = round(rrhh_base), round(ips), round(aguinaldo), round(plus_vendedores)
    logistica_entregas, logistica_premios, operativos = round(logistica_entregas), round(logistica_premios), round(operativos)
    total = rrhh_base + ips + aguinaldo + plus_vendedores + logistica_entregas + logistica_premios + operativos
    carga = 1 + float(c["ips_pct"]) / 100.0 + (1 / 12 if c.get("aguinaldo", True) else 0)
    variable_vendedores = rrhh["operadores_comisiones"] + plus_vendedores          # comisión + plus (sin cargas)

    costos = {
        "headcount": {"vendedores": vendedores, "supervisores": supervisores, "backoffice": backoffice,
                      "coordinadores": coordinadores, "controllers": controllers, "subgerencia": subgerencia,
                      "total": vendedores + supervisores + backoffice + coordinadores + controllers + subgerencia},
        "salario_operador_mes": round(salario_operador),
        "rrhh": {k: round(v) for k, v in rrhh.items()},
        "rrhh_base": round(rrhh_base), "ips": round(ips), "aguinaldo": round(aguinaldo),
        "rrhh_total": round(rrhh_base + ips + aguinaldo),
        "plus_vendedores": plus_vendedores,
        "logistica_entregas": round(logistica_entregas), "logistica_premios": round(logistica_premios),
        "operativos": round(operativos),
        "total": round(total),
        "costo_por_venta": round(total / act) if act else 0,
        "facturacion_por_venta": round(bruto_mes0 / act) if act else 0,
        "neto_6_por_venta": round(neto_6 / act) if act else 0,
        # Remuneración del vendedor: comisión por venta (con cargas) + plus por venta (sin cargas).
        "vendedor": {
            "salario_fijo": round(salario_operador),
            "comision_por_venta": round(comision_venta), "plus_por_venta": round(plus_venta),
            "variable_por_venta": round(comision_venta + plus_venta),
            "comision_con_cargas_por_venta": round(comision_venta * carga + plus_venta),   # costo real por venta para Voicenter
            "comision_promedio": round(rrhh["operadores_comisiones"] / vendedores) if vendedores else 0,
            "plus_promedio": round(plus_vendedores / vendedores) if vendedores else 0,
            "ingreso_promedio": round(salario_operador + (variable_vendedores / vendedores if vendedores else 0)),
            "ventas_promedio": round(act / vendedores, 1) if vendedores else 0,
            "pct_variable_sobre_ingreso": round(
                (variable_vendedores / vendedores) / (salario_operador + variable_vendedores / vendedores) * 100, 1
            ) if vendedores and (salario_operador + variable_vendedores / vendedores) else 0.0,
            # Referencia: cuánto pesan comisión + plus sobre lo facturado (no es un parámetro, es un indicador).
            "peso_sobre_facturacion_pct": round(variable_vendedores / bruto_mes0 * 100, 1) if bruto_mes0 else 0.0,
            "peso_sobre_neto_6_pct": round(variable_vendedores / neto_6 * 100, 1) if neto_6 else 0.0,
            "peso_sobre_neto_12_pct": round(variable_vendedores / neto_12 * 100, 1) if neto_12 else 0.0,
        },
    }
    margen = {
        "mes0": round(bruto_mes0 - total), "pct_mes0": round((bruto_mes0 - total) / bruto_mes0 * 100, 1) if bruto_mes0 else 0.0,
        "meses6": round(neto_6 - total), "pct_6": round((neto_6 - total) / neto_6 * 100, 1) if neto_6 else 0.0,
        "meses12": round(neto_12 - total), "pct_12": round((neto_12 - total) / neto_12 * 100, 1) if neto_12 else 0.0,
    }
    return costos, margen


def _margen6_para(p: dict, ventas: float) -> float:
    r = simular_facturacion({**p, "ventas": ventas, "_sin_breakeven": True})
    return float(r["margen"]["meses6"])


def _breakeven(p: dict) -> float | None:
    """Ventas mínimas para margen cero a 6 meses con esta estructura (bisección)."""
    lo, hi = 1.0, max(float(p["ventas"] or 0) * 4, 200.0)
    if _margen6_para(p, hi) < 0:
        return None  # ni cuadruplicando las ventas cierra: la estructura no es viable
    if _margen6_para(p, lo) >= 0:
        return lo
    for _ in range(40):
        mid = (lo + hi) / 2
        if _margen6_para(p, mid) >= 0:
            hi = mid
        else:
            lo = mid
    return round(hi)


def _ahorro_por_venta_vendedor(p: dict, act: float) -> float:
    c = p["costos"]
    vpv = float(c["ventas_por_vendedor"] or 1)
    sal = float(c["salario_hora"]) * float(c["horas_dia"]) * float(c["dias_mes"])
    carga = 1 + float(c["ips_pct"]) / 100.0 + (1 / 12 if c.get("aguinaldo", True) else 0)
    return max(0.0, (math.ceil(act / vpv) - math.ceil(act / (vpv + 1))) * sal * carga)


# =============================== SIMULACIÓN ANUAL ===============================
_FLUJOS = ("residual", "cuota2", "legajos", "clawbacks", "clawback_bonos", "recalculo_productividad")


HORIZONTES = (12, 18)


# Claves que un "mes afectado" NO puede pisar: las ventas van aparte y la estructura queda fija al mes 1.
_NO_AFECTABLES = {"ventas", "_sin_breakeven", "costos"}
_COSTOS_AFECTABLES = {"comision_por_venta", "plus_por_venta", "logistica_central",
                      "logistica_interior", "logistica_interior_pct", "operativo_por_venta"}


def _normalizar_afectados(meses_afectados: dict | None, h: int) -> dict[int, dict]:
    """{"7": {...}} → {6: {...}} (índice 0-based), solo meses 2..h con variaciones no vacías."""
    out: dict[int, dict] = {}
    for k, ov in (meses_afectados or {}).items():
        try:
            mes = int(k)
        except (TypeError, ValueError):
            continue
        if mes < 2 or mes > h or not isinstance(ov, dict):
            continue
        limpio = {kk: vv for kk, vv in ov.items() if kk not in _NO_AFECTABLES and vv is not None}
        if isinstance(ov.get("costos"), dict):
            cc = {kk: vv for kk, vv in ov["costos"].items() if kk in _COSTOS_AFECTABLES and vv is not None}
            if cc:
                limpio["costos"] = cc
        if limpio:
            out[mes - 1] = limpio
    return out


def _aplicar_afectado(base: dict, ov: dict | None) -> dict:
    """Parámetros de una cohorte con sus variaciones propias (porta, efectividad, mix,
    ajuste de comisiones, bonos, legajos, costos variables). Los planes se mezclan por nombre."""
    if not ov:
        return base
    pm = {**base}
    for k, v in ov.items():
        if k == "costos":
            pm["costos"] = {**base["costos"], **v}
        elif k == "planes" and isinstance(v, list):
            por_plan = {str(x.get("plan")): x for x in v if isinstance(x, dict)}
            pm["planes"] = [{**pl, **{kk: vv for kk, vv in por_plan.get(str(pl.get("plan")), {}).items() if kk != "plan"}}
                            for pl in base["planes"]]
        else:
            pm[k] = v
    return pm


def simular_anual(params: dict | None, ventas_por_mes: list[float], horizonte: int = 12,
                  meses_afectados: dict | None = None, bonos_adicionales_por_mes: list[float] | None = None,
                  nombres_meses: list[str] | None = None) -> dict[str, Any]:
    """Balance de 12 o 18 meses con estructura FIJA seteada en el mes 1.

    - El mes 1 define objetivo CO, tarifas, zafra, escalas y la estructura
      (vendedores, supervisores, backoffice, coordinación, controllers).
    - Los meses 2..12 solo cambian las ventas: con ellas varían los bonos (vs el
      mismo objetivo), las comisiones de vendedores, la logística de entregas y
      los operativos. Los costos fijos del mes 1 se mantienen todo el año.
    - Cada mes calendario liquida la facturación de su cohorte (mes 0) más los
      ajustes de las cohortes anteriores según su antigüedad (residual, cuota 2,
      legajos, chargebacks, devolución de bonos): así funciona la liquidación real.
    """
    base = parametros_con_defaults(params)
    h = int(horizonte) if int(horizonte or 12) in HORIZONTES else 12
    ventas = [max(float(v or 0), 0) for v in (ventas_por_mes or [])][:h]
    while len(ventas) < h:
        ventas.append(ventas[-1] if ventas else float(base["ventas"]))
    base["ventas"] = ventas[0]

    # Estructura del mes 1 (queda fija).
    m1 = simular_facturacion({**base, "_sin_breakeven": True})
    headcount = m1["costos"]["headcount"]

    # Meses afectados: cohortes con variaciones propias (la estructura sigue fija).
    afectados = _normalizar_afectados(meses_afectados, h)
    # Bono adicional a mano por mes (Gs) y nombres de los meses (editables; vacío = "Mes N").
    bonos_ad = [max(float(x or 0), 0) for x in (bonos_adicionales_por_mes or [])][:h]
    bonos_ad += [0.0] * (h - len(bonos_ad))
    nombres = [str(x or "").strip()[:40] for x in (nombres_meses or [])][:h]
    nombres += [""] * (h - len(nombres))
    nombres = [nm or f"Mes {t + 1}" for t, nm in enumerate(nombres)]
    cohortes = [simular_facturacion({**_aplicar_afectado(base, afectados.get(t)), "ventas": v,
                                     "bono_adicional": bonos_ad[t], "_sin_breakeven": True})
                for t, v in enumerate(ventas)]

    meses: list[dict] = []
    acumulado = 0
    for t in range(h):
        c = cohortes[t]
        fila: dict[str, Any] = {
            "mes": t + 1, "nombre": nombres[t], "ventas": round(ventas[t]),
            "activaciones_cuota1": c["mes0"]["activaciones_cuota1"], "portabilidad": c["mes0"]["portabilidad"],
            "bono_productividad": c["mes0"]["bono_productividad"], "bono_efectividad": c["mes0"]["bono_efectividad"],
            "bono_adicional": c["mes0"]["bono_adicional"],
            "facturacion_bruta": c["bruto_mes0"],
            "cumplimiento_pct": c["derivados"]["cumplimiento_pct"],
            "escalon_productividad": (c["derivados"]["escalon_productividad"] or {}).get("desde_pct"),
            "monto_bono_productividad": c["derivados"]["monto_bono_productividad"],
            "afectado": t in afectados, "variaciones": afectados.get(t, {}),
        }
        for k in _FLUJOS:
            fila[k] = 0.0
        for m in range(t):  # cohortes anteriores, edad t-m (los flujos terminan a los 12 meses)
            edad = t - m
            if edad > 12:
                continue
            for k in _FLUJOS:
                fila[k] += cohortes[m]["meses"][edad][k]
        # Redondeo aditivo: cada flujo se redondea y todo lo demás se deriva de los redondeados,
        # así facturación + ajustes = ingreso neto, − costos = resultado, y el acumulado suma exacto.
        for k in _FLUJOS:
            fila[k] = round(fila[k])
        fila["facturacion_bruta"] = round(fila["facturacion_bruta"])
        fila["ajustes"] = sum(fila[k] for k in _FLUJOS)
        fila["ingreso_neto"] = fila["facturacion_bruta"] + fila["ajustes"]
        # Costos del mes: estructura fija del mes 1 + variables de las ventas del mes.
        costos_t, _ = _costos_y_margen(c["parametros"]["costos"], ventas[t], c["mes0"], c["bruto_mes0"],
                                       c["neto_6"], c["neto_12"], headcount=headcount)
        fila["costos"] = costos_t
        fila["costo_total"] = costos_t["total"]
        fila["resultado"] = fila["ingreso_neto"] - costos_t["total"]
        fila["margen_pct"] = round(fila["resultado"] / fila["ingreso_neto"] * 100, 1) if fila["ingreso_neto"] else 0.0
        acumulado += fila["resultado"]
        fila["acumulado"] = acumulado
        fila["acumulado_anterior"] = acumulado - fila["resultado"]
        fila["ventas_por_vendedor"] = round(ventas[t] / headcount["vendedores"], 1) if headcount["vendedores"] else 0
        # Líneas activas: después de los 12 meses la cohorte se mantiene en su último nivel de zafra.
        fila["lineas_activas"] = round(sum(cohortes[m]["meses"][min(t - m, 12)]["lineas_activas"] for m in range(t + 1)))
        # ---- La "ola": lo que las cohortes anteriores ya dejaron comprometido para este mes, venda lo que venda ----
        fila["ola_devoluciones"] = fila["legajos"] + fila["clawbacks"] + fila["clawback_bonos"] + fila["recalculo_productividad"]
        fila["ola_cobros"] = fila["residual"] + fila["cuota2"]
        # Ventas mínimas del mes para no perder: bruta(v) + ajustes heredados − costos(v) ≥ 0, con la
        # estructura fija (bisección sobre v; los bonos hacen escalones, se busca el primer v que cierra).
        pm_t = _aplicar_afectado(base, afectados.get(t))

        def _resultado_con(v: float) -> float:
            c2 = simular_facturacion({**pm_t, "ventas": v, "bono_adicional": bonos_ad[t], "_sin_breakeven": True})
            cst, _ = _costos_y_margen(c2["parametros"]["costos"], v, c2["mes0"], c2["bruto_mes0"],
                                      c2["neto_6"], c2["neto_12"], headcount=headcount)
            return c2["bruto_mes0"] + fila["ajustes"] - cst["total"]
        hi = max(ventas[t] * 3, 500.0)
        if _resultado_con(0.0) >= 0:
            fila["ventas_equilibrio"] = 0
        elif _resultado_con(hi) < 0:
            fila["ventas_equilibrio"] = None      # ni triplicando las ventas cierra este mes
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
        meses.append(fila)

    # Cola después del horizonte: flujos de las cohortes que caen fuera de él.
    cola = {k: 0.0 for k in _FLUJOS}
    for m in range(h):
        for edad in range(h - m, 13):
            if edad <= 0:
                continue
            for k in _FLUJOS:
                cola[k] += cohortes[m]["meses"][edad][k]
    cola = {k: round(v) for k, v in cola.items()}
    cola_total = sum(cola.values())
    cola_cobros = sum(v for v in cola.values() if v > 0)
    cola_devoluciones = sum(v for v in cola.values() if v < 0)
    chb = max(int(base["chargeback_meses"]),
              int(base["recalculo_productividad_mes"]) if base.get("bonos_activos", True) else 0)
    res_meses = int(base["residual_meses"])

    def tot(k: str) -> float:
        return sum(float(f[k]) for f in meses)
    anual = {
        "ventas": round(tot("ventas")),
        "facturacion_bruta": round(tot("facturacion_bruta")),
        "ajustes": round(tot("ajustes")),
        "ingreso_neto": round(tot("ingreso_neto")),
        "costos": round(tot("costo_total")),
        "resultado": round(tot("resultado")),
        "margen_pct": round(tot("resultado") / tot("ingreso_neto") * 100, 1) if tot("ingreso_neto") else 0.0,
        "bonos": round(tot("bono_productividad") + tot("bono_efectividad") + tot("bono_adicional")),
        "bonos_adicionales": round(tot("bono_adicional")),
        "devolucion_bonos": round(tot("clawback_bonos") + tot("recalculo_productividad")),
        "costos_fijos_mes": round(sum(m1["costos"]["rrhh"][k] for k in ("operadores_salario", "supervisores", "coordinadores", "backoffice", "controllers", "subgerencia"))
                                  * (1 + float(base["costos"]["ips_pct"]) / 100 + (1 / 12 if base["costos"].get("aguinaldo", True) else 0))
                                  + float(base["costos"]["logistica_premios"])),
        "horizonte": h,
        "cola_post_12": {
            **cola, "total": cola_total,
            "cobros": cola_cobros, "devoluciones": cola_devoluciones,
            # Última cohorte (mes h): sus caídas terminan h + chargeback; su residual, h + residual_meses.
            "ultimo_mes_caidas": h + chb, "ultimo_mes_residual": h + res_meses,
        },
        "resultado_con_cola": round(tot("resultado") + cola_total),
        # Dentro del período: cuánto devolvieron y cuánto sumaron las cohortes ya liquidadas.
        "devoluciones_periodo": round(tot("legajos") + tot("clawbacks") + tot("clawback_bonos") + tot("recalculo_productividad")),
        "cobros_periodo": round(tot("residual") + tot("cuota2")),
        "meses_negativos": sum(1 for f in meses if f["resultado"] < 0),
        "mejor_mes": max(meses, key=lambda f: f["resultado"])["mes"],
        "peor_mes": min(meses, key=lambda f: f["resultado"])["mes"],
        "meses_sin_bono_productividad": sum(1 for f in meses if f["monto_bono_productividad"] == 0),
        # Ola de devoluciones heredadas: máximo y mes; meses donde las ventas no cubren la ola + estructura.
        "ola_maxima": round(min(f["ola_devoluciones"] for f in meses)),
        "ola_maxima_mes": min(meses, key=lambda f: f["ola_devoluciones"])["mes"],
        "meses_en_riesgo": [f["mes"] for f in meses if f["en_riesgo"]],
        "ventas_equilibrio_max": max((f["ventas_equilibrio"] or 0) for f in meses),
    }

    def gs(v: float) -> str:
        return f"Gs {v:,.0f}".replace(",", ".")
    def n(v: float) -> str:
        return f"{v:,.0f}".replace(",", ".")
    partes = [
        f"{h} meses simulados con estructura fija del mes 1 ({headcount['vendedores']} vendedores, {headcount['supervisores']} supervisores, "
        f"{headcount['backoffice']} backoffice; costo fijo {gs(anual['costos_fijos_mes'])}/mes) y objetivo CO {n(float(base['objetivo_co']))}.",
        f"Ventas del período: {n(anual['ventas'])}. Facturación bruta {gs(anual['facturacion_bruta'])}; con los ajustes de chargeback, cuota 2 y residual "
        f"el ingreso neto liquidado es {gs(anual['ingreso_neto'])}. Costos {gs(anual['costos'])}. "
        f"Resultado del período {gs(anual['resultado'])} ({anual['margen_pct']}%).",
    ]
    if anual["meses_negativos"]:
        partes.append(f"{anual['meses_negativos']} mes(es) con resultado negativo; el peor es {nombres[anual['peor_mes'] - 1]} y el mejor {nombres[anual['mejor_mes'] - 1]}.")
    if anual["meses_en_riesgo"]:
        partes.append(f"Riesgo por bajar productividad: en {len(anual['meses_en_riesgo'])} mes(es) las ventas no cubren la ola de devoluciones heredadas más la estructura fija "
                      f"(ola máxima {gs(abs(anual['ola_maxima']))} en {nombres[anual['ola_maxima_mes'] - 1]}; hacen falta hasta {n(anual['ventas_equilibrio_max'])} ventas/mes para no perder).")
    if afectados:
        partes.append(f"{len(afectados)} mes(es) con variaciones propias (porta, efectividad, mix u otros): "
                      + ", ".join(nombres[t] for t in sorted(afectados)) + ".")
    if anual["bonos_adicionales"]:
        partes.append(f"Incluye {gs(anual['bonos_adicionales'])} de bono adicional cargado a mano.")
    if anual["meses_sin_bono_productividad"] and base.get("bonos_activos", True):
        esc_min = min(float(e["desde_pct"]) for e in base["escala_productividad"]) if base.get("escala_productividad") else 0
        partes.append(f"En {anual['meses_sin_bono_productividad']} mes(es) las ventas quedaron bajo el {esc_min:.0f}% del objetivo y el bono productividad no se liquidó.")
    final = anual["resultado_con_cola"]
    ingreso_final = tot("ingreso_neto") + cola_total
    anual["veredicto"] = {
        "gana": final >= 0,
        "resultado_final": final,
        "pct_sobre_ingreso": round(final / ingreso_final * 100, 1) if ingreso_final else 0.0,
        "periodo_gana": anual["resultado"] >= 0,
        "la_cola_lo_da_vuelta": (anual["resultado"] >= 0) != (final >= 0),
    }
    partes.append(
        f"Cierre con todas las caídas: después del mes {h} las cohortes del período todavía tienen {gs(cola_cobros)} por cobrar "
        f"(residual y cuota 2, hasta el mes {h + res_meses}) y {gs(abs(cola_devoluciones))} por devolver (chargebacks hasta el mes {h + chb}). "
        f"Con esa cola el negocio {'GANA' if final >= 0 else 'PIERDE'} {gs(abs(final))}"
        + (" — el período cerraba en pérdida y la cola lo da vuelta." if anual["veredicto"]["la_cola_lo_da_vuelta"] and final >= 0
           else " — el período cerraba en ganancia pero las devoluciones pendientes la consumen." if anual["veredicto"]["la_cola_lo_da_vuelta"]
           else ".")
    )

    return {
        "parametros": base, "horizonte": h, "ventas_por_mes": [round(v) for v in ventas],
        "meses_afectados": {str(t + 1): ov for t, ov in sorted(afectados.items())},
        "bonos_adicionales_por_mes": [round(x) for x in bonos_ad], "nombres_meses": nombres,
        "headcount": headcount, "meses": meses, "anual": anual, "conclusion": " ".join(partes),
    }
