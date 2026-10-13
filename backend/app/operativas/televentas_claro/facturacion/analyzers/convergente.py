"""Simulador CONVERGENTE de Televentas Claro: la MISMA estructura vende pospago (móvil) y GPON.

Reglas:
- La dotación (vendedores, supervisores, backoffice, coordinación, controllers) se dimensiona con las
  ventas de pospago del mes 1, igual que en el simulador anual, y queda fija todo el período.
- Cada vendedor vende además GPON: activaciones GPON del mes = vendedores × GPON por asesor (ideal 3).
- GPON entra con su modelo de facturación COMPLETO (motor `facturacion_gpon`): cuota 1 y bono fijo en
  el mes de la venta; cuota 2, legajos, mora (su "zafra": 26% de líneas con deuda neta a 6 meses con la
  curva calibrada), recálculo del bono al día 180 y otros reversos de las cohortes anteriores; cola
  posterior al horizonte. Lo ÚNICO que GPON no agrega es estructura: sus costos son comisión y plus por
  venta GPON (con IPS y aguinaldo de pospago), operativos y logística GPON.
- Pospago corre igual que hoy. El resultado mensual de GPON se le pasa como "aporte externo" para que
  las ventas mínimas del mes y los meses en riesgo se calculen sobre el negocio convergente.
- El balance mensual y anual es la SUMA de los dos negocios, con desglose pospago / GPON en cada fila.
"""
from __future__ import annotations

from typing import Any

from .gpon import PARAMETROS_GPON_DEFAULT, parametros_gpon, simular_gpon_anual
from .simulador import (
    HORIZONTES, PARAMETROS_DEFAULT, parametros_con_defaults, simular_anual, simular_facturacion,
)

GPON_POR_ASESOR_IDEAL = 3.0

# GPON vendido por la estructura de pospago: ninguna persona propia → solo costos variables por venta.
HEADCOUNT_COMPARTIDO = {"vendedores": 0, "supervisores": 0, "backoffice": 0, "coordinadores": 0, "controllers": 0}

CONVERGENTE_DEFAULT: dict[str, Any] = {"activo": True, "por_asesor_ideal": GPON_POR_ASESOR_IDEAL}

# Claves de GPON que se exponen con prefijo en cada fila (EERR convergente).
_GPON_FLUJOS = ("cuota2", "legajos", "mora", "recalculo", "otros")
_SUMA_MES = ("facturacion_bruta", "ajustes", "ingreso_neto", "costo_total", "ola_devoluciones", "ola_cobros")
_SUMA_ANUAL = ("facturacion_bruta", "ajustes", "ingreso_neto", "costos", "resultado", "bonos", "bonos_adicionales",
               "devolucion_bonos", "devoluciones_periodo", "cobros_periodo")


def costos_gpon_compartidos(costos_gpon: dict, costos_movil: dict) -> dict:
    """Costos GPON cuando la estructura es la de pospago: se conservan comisión, plus, operativos y
    logística por venta GPON; IPS y aguinaldo son los de pospago; sin cobertura adicional interior ni subgerencia."""
    c = dict(costos_gpon)
    c["ips_pct"] = costos_movil.get("ips_pct", c.get("ips_pct", 16.5))
    c["aguinaldo"] = costos_movil.get("aguinaldo", True)
    c["subgerencia_salario"] = 0
    c["logistica_premios"] = 0
    return c


def _pct(num: float, den: float) -> float:
    return round(num / den * 100, 1) if den else 0.0


def simular_convergente(params: dict | None, ventas_por_mes: list[float], horizonte: int = 12,
                        meses_afectados: dict | None = None, bonos_adicionales_por_mes: list[float] | None = None,
                        nombres_meses: list[str] | None = None, gpon: dict | None = None) -> dict[str, Any]:
    """Balance convergente de 12 o 18 meses. `gpon` = {activo, parametros (GPON), por_asesor_por_mes,
    bonos_adicionales_por_mes, meses_afectados}. Con `activo` en False devuelve la simulación de
    pospago tal cual (más las marcas de convergente), así el simulador funciona igual que antes."""
    gpon = gpon or {}
    activo = bool(gpon.get("activo", True))
    base = parametros_con_defaults(params)
    h = int(horizonte) if int(horizonte or 12) in HORIZONTES else 12
    ventas = [max(float(v or 0), 0) for v in (ventas_por_mes or [])][:h]
    while len(ventas) < h:
        ventas.append(ventas[-1] if ventas else float(base["ventas"]))

    # Estructura del mes 1 (la misma regla que simular_anual): dimensionada con el pospago.
    m1 = simular_facturacion({**base, "ventas": ventas[0], "_sin_breakeven": True})
    headcount = dict(m1["costos"]["headcount"])
    vendedores = int(headcount.get("vendedores") or 0)

    if not activo:
        movil = simular_anual(base, ventas, h, meses_afectados, bonos_adicionales_por_mes, nombres_meses)
        movil["negocio"] = "CONVERGENTE"
        movil["gpon"] = None
        movil["convergente"] = {"activo": False, "vendedores": vendedores, "por_asesor_ideal": GPON_POR_ASESOR_IDEAL}
        movil["headcount"] = {**movil["headcount"], "gpon_por_asesor_mes1": 0, "ventas_gpon_mes1": 0}
        return movil

    por_asesor = [max(float(x or 0), 0) for x in (gpon.get("por_asesor_por_mes") or [])][:h]
    while len(por_asesor) < h:
        por_asesor.append(por_asesor[-1] if por_asesor else GPON_POR_ASESOR_IDEAL)
    ventas_gpon = [float(round(vendedores * k)) for k in por_asesor]

    pg = parametros_gpon(gpon.get("parametros"))
    pg["negocio"] = "GPON"
    pg["costos"] = costos_gpon_compartidos(pg["costos"], base["costos"])
    pg["ventas"] = ventas_gpon[0]
    # Objetivo del bono fijo GPON: si no viene uno explícito, el ideal de la estructura (vendedores × 3 → 100%).
    if gpon.get("objetivo_auto", (gpon.get("parametros") or {}).get("objetivo") is None):
        pg["objetivo"] = max(round(vendedores * GPON_POR_ASESOR_IDEAL), 1)
    gp = simular_gpon_anual(pg, ventas_gpon, h, gpon.get("bonos_adicionales_por_mes"), nombres_meses,
                            gpon.get("meses_afectados"), headcount_costos=HEADCOUNT_COMPARTIDO,
                            vendedores_compartidos=vendedores)
    # Lo que GPON deja cada mes (ingreso neto GPON − costos variables GPON): cubre estructura junto con pospago.
    aporte = [f["ingreso_neto"] - f["costo_total"] for f in gp["meses"]]
    movil = simular_anual(base, ventas, h, meses_afectados, bonos_adicionales_por_mes, nombres_meses,
                          aporte_externo_por_mes=aporte)

    meses: list[dict[str, Any]] = []
    acum = 0
    for t in range(h):
        fm, fg = movil["meses"][t], gp["meses"][t]
        fila: dict[str, Any] = dict(fm)                      # todas las claves de pospago (gross, zafra, bonos, costos…)
        fila["costo_total_movil"] = fm["costo_total"]
        fila["ingreso_neto_movil"] = fm["ingreso_neto"]
        fila["resultado_movil"] = fm["resultado"]
        fila["facturacion_bruta_movil"] = fm["facturacion_bruta"]
        fila["ventas_gpon"] = fg["ventas"]
        fila["gpon_por_asesor"] = round(por_asesor[t], 2)
        fila["gpon_activaciones_cuota1"] = fg["activaciones_cuota1"]
        fila["gpon_bono_fijo"] = fg["bono_fijo"]
        fila["gpon_bono_adicional"] = fg["bono_adicional"]
        fila["facturacion_bruta_gpon"] = fg["facturacion_bruta"]
        for k in _GPON_FLUJOS:
            fila[f"gpon_{k}"] = fg[k]
        fila["ajustes_gpon"] = fg["ajustes"]
        fila["ingreso_neto_gpon"] = fg["ingreso_neto"]
        fila["costo_total_gpon"] = fg["costo_total"]
        fila["gpon_costos"] = fg["costos"]
        fila["resultado_gpon"] = fg["resultado"]
        fila["margen_pct_gpon"] = fg["margen_pct"]
        fila["gpon_cumplimiento_pct"] = fg["cumplimiento_pct"]
        fila["gpon_escalon"] = fg["escalon_productividad"]
        fila["gpon_monto_bono"] = fg["monto_bono"]
        fila["gpon_lineas_en_mora"] = fg["lineas_en_mora"]
        fila["gpon_lineas_activas"] = fg["lineas_activas"]
        fila["gpon_ola_devoluciones"] = fg["ola_devoluciones"]
        fila["gpon_ola_cobros"] = fg["ola_cobros"]
        fila["gpon_afectado"] = fg["afectado"]
        # ---- convergente: suma de los dos negocios ----
        for k in _SUMA_MES:
            fila[k] = fm[k] + fg[k]
        fila["resultado"] = fila["ingreso_neto"] - fila["costo_total"]
        fila["margen_pct"] = _pct(fila["resultado"], fila["ingreso_neto"])
        fila["acumulado_anterior"] = acum
        acum += fila["resultado"]
        fila["acumulado"] = acum
        fila["aporte_gpon"] = aporte[t]
        meses.append(fila)

    am, ag = movil["anual"], gp["anual"]
    anual: dict[str, Any] = dict(am)
    for k in _SUMA_ANUAL:
        anual[k] = am[k] + ag[k]
    anual["margen_pct"] = _pct(anual["resultado"], anual["ingreso_neto"])
    cola_m, cola_g = am["cola_post_12"], ag["cola_post_12"]
    cola = {**cola_m,
            "cobros": cola_m["cobros"] + cola_g["cobros"], "devoluciones": cola_m["devoluciones"] + cola_g["devoluciones"],
            "total": cola_m["total"] + cola_g["total"],
            "ultimo_mes_caidas": max(cola_m["ultimo_mes_caidas"], cola_g["ultimo_mes_caidas"]),
            "ultimo_mes_residual": max(cola_m["ultimo_mes_residual"], cola_g["ultimo_mes_residual"]),
            "movil": cola_m, "gpon": cola_g}
    anual["cola_post_12"] = cola
    final = anual["resultado"] + cola["total"]
    anual["resultado_con_cola"] = round(final)
    ingreso_final = anual["ingreso_neto"] + cola["total"]
    anual["veredicto"] = {
        "gana": final >= 0, "resultado_final": round(final),
        "pct_sobre_ingreso": _pct(final, ingreso_final),
        "periodo_gana": anual["resultado"] >= 0,
        "la_cola_lo_da_vuelta": (anual["resultado"] >= 0) != (final >= 0),
    }
    anual["meses_negativos"] = sum(1 for f in meses if f["resultado"] < 0)
    anual["mejor_mes"] = max(meses, key=lambda f: f["resultado"])["mes"]
    anual["peor_mes"] = min(meses, key=lambda f: f["resultado"])["mes"]
    anual["ola_maxima"] = round(min(f["ola_devoluciones"] for f in meses))
    anual["ola_maxima_mes"] = min(meses, key=lambda f: f["ola_devoluciones"])["mes"]
    anual["regimen"] = {"resultado_mes": meses[-1]["resultado"], "margen_pct": meses[-1]["margen_pct"],
                        "ingreso_neto_mes": meses[-1]["ingreso_neto"], "ola_devoluciones_mes": meses[-1]["ola_devoluciones"]}
    # ---- desglose por negocio ----
    anual["ventas_gpon"] = round(sum(ventas_gpon))
    anual["gpon_por_asesor"] = round(sum(por_asesor) / len(por_asesor), 2) if por_asesor else 0.0
    anual["facturacion_bruta_movil"], anual["facturacion_bruta_gpon"] = am["facturacion_bruta"], ag["facturacion_bruta"]
    anual["ingreso_neto_movil"], anual["ingreso_neto_gpon"] = am["ingreso_neto"], ag["ingreso_neto"]
    anual["costos_movil"], anual["costos_gpon"] = am["costos"], ag["costos"]
    anual["resultado_movil"], anual["resultado_gpon"] = am["resultado"], ag["resultado"]
    anual["margen_pct_movil"], anual["margen_pct_gpon"] = am["margen_pct"], ag["margen_pct"]
    anual["resultado_con_cola_movil"], anual["resultado_con_cola_gpon"] = am["resultado_con_cola"], ag["resultado_con_cola"]
    anual["bonos_movil"], anual["bonos_gpon"] = am["bonos"], ag["bonos"]
    anual["devolucion_bonos_movil"], anual["devolucion_bonos_gpon"] = am["devolucion_bonos"], ag["devolucion_bonos"]
    anual["gpon_mora"], anual["gpon_cuota2"], anual["gpon_legajos"], anual["gpon_recalculo"], anual["gpon_otros"] = (
        ag["mora"], ag["cuota2"], ag["legajos"], ag["recalculo"], ag["otros"])
    anual["gpon_lineas_en_mora_final"] = meses[-1]["gpon_lineas_en_mora"]
    anual["aporte_gpon_ingreso_pct"] = _pct(ag["ingreso_neto"], anual["ingreso_neto"])
    anual["aporte_gpon_resultado"] = ag["resultado"]
    anual["meses_en_riesgo_sin_gpon"] = [f["mes"] for f in meses if (f["resultado"] - f["resultado_gpon"]) < 0]

    headcount_out = {**headcount, "gpon_por_asesor_mes1": round(por_asesor[0], 2), "ventas_gpon_mes1": round(ventas_gpon[0])}

    def gs(v: float) -> str:
        return f"Gs {v:,.0f}".replace(",", ".")

    def n(v: float) -> str:
        return f"{v:,.0f}".replace(",", ".")

    nombres = movil["nombres_meses"]
    partes = [
        f"Convergente a {h} meses: la misma estructura ({n(vendedores)} vendedores, {headcount['supervisores']} supervisores, "
        f"{headcount['backoffice']} backoffice; costo fijo {gs(am['costos_fijos_mes'])}/mes, dimensionada con el pospago del mes 1) "
        f"vende {n(ventas[0])} pospago y {por_asesor[0]:g} GPON por asesor ({n(ventas_gpon[0])} activaciones GPON) en el mes 1.",
        f"Pospago: ingreso neto {gs(am['ingreso_neto'])}, costos {gs(am['costos'])}, resultado {gs(am['resultado'])} ({am['margen_pct']}%). "
        f"GPON: {n(anual['ventas_gpon'])} activaciones, ingreso neto {gs(ag['ingreso_neto'])} (cuota 1 y bono fijo menos cuota 2, legajos, "
        f"mora {gs(abs(ag['mora']))} y recálculo {gs(abs(ag['recalculo']))}), costos variables {gs(ag['costos'])}, resultado {gs(ag['resultado'])}.",
        f"Convergente: ingreso neto {gs(anual['ingreso_neto'])} ({anual['aporte_gpon_ingreso_pct']}% GPON), costos {gs(anual['costos'])}, "
        f"resultado del período {gs(anual['resultado'])} ({anual['margen_pct']}%).",
    ]
    if anual["meses_negativos"]:
        partes.append(f"{anual['meses_negativos']} mes(es) con resultado convergente negativo; el peor es {nombres[anual['peor_mes'] - 1]} y el mejor {nombres[anual['mejor_mes'] - 1]}.")
    sin_gpon = anual["meses_en_riesgo_sin_gpon"]
    if sin_gpon and anual["meses_negativos"] < len(sin_gpon):
        partes.append(f"Sin GPON, {len(sin_gpon)} mes(es) cerrarían en pérdida; con GPON quedan {anual['meses_negativos']}: el GPON cubre parte de la estructura fija.")
    if anual["meses_en_riesgo"]:
        partes.append(f"Riesgo por bajar productividad: en {len(anual['meses_en_riesgo'])} mes(es) las ventas de pospago, aun con el aporte de GPON, no cubren la ola de devoluciones heredadas más la estructura fija "
                      f"(hacen falta hasta {n(anual['ventas_equilibrio_max'])} ventas pospago/mes para no perder).")
    partes.append(
        f"Cierre con todas las caídas de los dos negocios: después del mes {h} quedan {gs(cola['cobros'])} por cobrar (residual, cuota 2 pospago y cuota 2 GPON) "
        f"y {gs(abs(cola['devoluciones']))} por devolver (chargebacks pospago, mora y recálculo GPON hasta el mes {cola['ultimo_mes_caidas']}). "
        f"Con esa cola el negocio convergente {'GANA' if final >= 0 else 'PIERDE'} {gs(abs(final))}"
        + (" — el período cerraba en pérdida y la cola lo da vuelta." if anual["veredicto"]["la_cola_lo_da_vuelta"] and final >= 0
           else " — el período cerraba en ganancia pero las devoluciones pendientes la consumen." if anual["veredicto"]["la_cola_lo_da_vuelta"]
           else ".")
    )

    return {
        "negocio": "CONVERGENTE",
        "parametros": base, "parametros_gpon": pg, "horizonte": h,
        "ventas_por_mes": [round(v) for v in ventas], "ventas_gpon_por_mes": [round(v) for v in ventas_gpon],
        "gpon_por_asesor_por_mes": [round(k, 2) for k in por_asesor],
        "meses_afectados": movil["meses_afectados"], "bonos_adicionales_por_mes": movil["bonos_adicionales_por_mes"],
        "nombres_meses": nombres,
        "headcount": headcount_out, "meses": meses, "anual": anual,
        "convergente": {"activo": True, "vendedores": vendedores, "por_asesor_ideal": GPON_POR_ASESOR_IDEAL},
        "movil": {"anual": am, "conclusion": movil["conclusion"]},
        "gpon": {"anual": ag, "conclusion": gp["conclusion"], "parametros": pg, "cohorte_mes1": gp.get("cohorte_mes1")},
        "conclusion": " ".join(partes),
    }
