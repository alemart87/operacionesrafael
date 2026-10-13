"""Negocio GPON: motor de cohorte y proyección anual, calibrados con las liquidaciones 385–389."""
from app.operativas.televentas_claro.facturacion.analyzers.gpon import PARAMETROS_GPON_DEFAULT, simular_gpon, simular_gpon_anual


def test_gpon_cohorte_reproduce_enero_2026():
    """Cohorte real de enero 2026, SOLO fibra (218 líneas IF; IPTV no cuenta), bono de la escala anterior
    100.000: a 5 meses Claro liquidó 517.000 por línea (cuota 1 393.000 + cuota 2 221.000 + bono 100.000
    − legajos 52.000 − mora neta 140.000 − otros 5.000), todavía sin el recálculo del mes 6. El modelo a
    5 meses debe quedar dentro del 7% (enero tuvo el doble de legajos que el promedio)."""
    # Legajos no presentados: por defecto 0 % (se cargan por mes); acá los promedios reales (3 % + 8 %).
    r = simular_gpon({"ventas": 218, "objetivo": 200, "escala_bono": [{"desde_pct": 100, "monto": 100000}], "legajo_no_presentado_pct": 3})
    assert PARAMETROS_GPON_DEFAULT["legajo_no_presentado_pct"] == 0
    assert r["derivados"]["monto_bono"] == 100000 and r["derivados"]["cumplimiento_pct"] == 109.0
    assert abs(r["derivados"]["cuota1_ponderada"] - 380_500) / 380_500 < 0.01     # mezcla 74 / 26 sin IPTV
    acum5 = r["meses"][5]["acumulado"]
    assert abs(acum5 / 218 - 517_000) / 517_000 < 0.08                            # con legajos promedio (3 % + 8 %)
    # Con los legajos que tuvo enero (2,8 % no presentados, 21,1 % incompletos) el modelo reproduce la cohorte al 4 %.
    r_ene = simular_gpon({"ventas": 218, "objetivo": 200, "escala_bono": [{"desde_pct": 100, "monto": 100000}],
                          "legajo_no_presentado_pct": 2.8, "legajo_pct": 21.1})
    assert abs(r_ene["meses"][5]["acumulado"] / 218 - 517_000) / 517_000 < 0.04
    assert abs(r_ene["por_linea"]["legajos"] - (-52_000)) / 52_000 < 0.05
    assert abs(r["por_linea"]["mora"] - (-140_000)) / 140_000 < 0.10            # 28 % de líneas × ~500.000
    assert abs(r["por_linea"]["cuota2_esperada"] - 238_000) / 238_000 < 0.05     # 96 % cobra (con legajo), 92 % completa
    # Legajo NO PRESENTADO: 100 % de la cuota 1, sin cuota 2 y sin mora. Legajo incompleto: 50 % y cuota 2 a la mitad.
    np_ = simular_gpon({"ventas": 100, "objetivo": 100, "bonos_activos": False, "legajo_no_presentado_pct": 50, "legajo_pct": 0, "mora_pct_lineas": 0, "otros_pct": 0})
    assert np_["meses"][1]["legajos"] == -round(50 * np_["derivados"]["cuota1_ponderada"])
    ok = simular_gpon({"ventas": 100, "objetivo": 100, "bonos_activos": False, "legajo_no_presentado_pct": 0, "legajo_pct": 0, "mora_pct_lineas": 0, "otros_pct": 0})
    assert abs(np_["meses"][2]["cuota2"] - ok["meses"][2]["cuota2"] / 2) <= 1
    mora_np = simular_gpon({"ventas": 100, "objetivo": 100, "legajo_no_presentado_pct": 50})
    mora_ok = simular_gpon({"ventas": 100, "objetivo": 100, "legajo_no_presentado_pct": 0})
    assert abs(sum(m["mora"] for m in mora_np["meses"]) - sum(m["mora"] for m in mora_ok["meses"]) / 2) <= 2
    # el bono se paga en TODAS las líneas IF en estado A
    assert r["mes0"]["bono_fijo"] == 218 * 100000
    # recupero de documentación: 55.000 por venta GPON, dentro de los costos
    assert r["costos"]["documentacion"] == 218 * 55000
    assert r["costos"]["total"] == (r["costos"]["rrhh_total"] + r["costos"]["plus_vendedores"] + r["costos"]["logistica_entregas"]
                                    + r["costos"]["logistica_premios"] + r["costos"]["operativos"] + r["costos"]["documentacion"])
    # aditividad: bruto = suma de componentes; acumulado = bruto + flujos
    assert r["bruto_mes0"] == sum(r["mes0"].values())
    assert r["meses"][12]["acumulado"] == r["bruto_mes0"] + sum(m["neto_mes"] for m in r["meses"][1:])
    # sin residual: después del mes 6 no hay flujos
    assert all(m["neto_mes"] == 0 for m in r["meses"][7:])
    assert r["meses"][2]["cuota2"] > 0 and r["meses"][6]["recalculo"] < 0 and r["meses"][1]["legajos"] < 0


def test_gpon_escala_vigente_y_sin_bonos():
    d = PARAMETROS_GPON_DEFAULT
    assert [e["monto"] for e in d["escala_bono"]] == [130000, 125000, 120000, 40000]
    r = simular_gpon({"ventas": 230, "objetivo": 230})
    assert r["derivados"]["monto_bono"] == 120000
    r110 = simular_gpon({"ventas": 253, "objetivo": 230})
    assert r110["derivados"]["monto_bono"] == 130000
    r94 = simular_gpon({"ventas": 216, "objetivo": 230})
    assert r94["derivados"]["monto_bono"] == 0
    sin = simular_gpon({"ventas": 230, "objetivo": 230, "bonos_activos": False})
    assert sin["mes0"]["bono_fijo"] == 0 and sin["meses"][6]["recalculo"] == 0
    assert r["por_linea"]["multiplo_cuota1"] > 1.3 and r["por_linea"]["neto_12"] > 0


def test_gpon_anual_aditivo_y_cola():
    a = simular_gpon_anual({"ventas": 230, "objetivo": 230}, [230] * 12, 12)
    ms = a["meses"]
    assert len(ms) == 12 and a["headcount"]["vendedores"] == 12
    for f in ms:
        assert f["ingreso_neto"] == f["facturacion_bruta"] + f["ajustes"]
        assert f["resultado"] == f["ingreso_neto"] - f["costo_total"]
        assert f["acumulado"] == f["acumulado_anterior"] + f["resultado"]
        assert f["ajustes"] == f["cuota2"] + f["legajos"] + f["mora"] + f["recalculo"] + f["otros"]
    an = a["anual"]
    assert an["resultado"] == ms[-1]["acumulado"] == sum(f["resultado"] for f in ms)
    assert ms[0]["ajustes"] == 0 and ms[2]["cuota2"] > 0            # mes 1 sin herencia; cuota 2 desde el mes 3
    assert ms[6]["mora"] == ms[11]["mora"] and ms[6]["recalculo"] < 0  # régimen desde el mes 7
    assert an["cola_post_12"]["cobros"] > 0 and an["cola_post_12"]["devoluciones"] < 0
    assert an["resultado_con_cola"] == an["resultado"] + an["cola_post_12"]["total"]
    a18 = simular_gpon_anual({"ventas": 230, "objetivo": 230}, [230] * 18, 18)
    assert len(a18["meses"]) == 18 and a18["meses"][17]["resultado"] == ms[11]["resultado"]


def test_gpon_anual_compatible_con_pospago_y_meses_afectados():
    a = simular_gpon_anual({"ventas": 230, "objetivo": 230}, [230] * 12, 12,
                           meses_afectados={"7": {"mora_pct_lineas": 40, "costos": {"comision_por_venta": 90000}}})
    m = a["meses"][6]
    assert m["afectado"] and m["variaciones"]["mora_pct_lineas"] == 40 and not a["meses"][5]["afectado"]
    # claves compatibles con el anual de pospago
    for k in ("residual", "portabilidad", "bono_productividad", "bono_efectividad", "clawbacks", "clawback_bonos",
              "recalculo_productividad", "monto_bono_productividad", "escalon_productividad", "ola_cobros", "ventas_equilibrio", "en_riesgo", "lineas_activas"):
        assert k in m
    assert m["clawbacks"] == m["mora"] + m["otros"] and m["recalculo_productividad"] == m["recalculo"]
    an = a["anual"]
    for k in ("cola_post_12", "veredicto", "meses_en_riesgo", "ola_maxima", "ola_maxima_mes", "ventas_equilibrio_max",
              "devoluciones_periodo", "cobros_periodo", "devolucion_bonos", "meses_sin_bono_productividad", "costos_fijos_mes"):
        assert k in an
    assert an["resultado_con_cola"] == an["veredicto"]["resultado_final"] == an["resultado"] + an["cola_post_12"]["total"]
    assert all(f["ventas_equilibrio"] is None or f["ventas_equilibrio"] >= 0 for f in a["meses"])
    # la mora del mes afectado (cohorte 7) pega en los meses siguientes
    b = simular_gpon_anual({"ventas": 230, "objetivo": 230}, [230] * 12, 12)
    assert a["meses"][9]["mora"] < b["meses"][9]["mora"] and a["meses"][5]["mora"] == b["meses"][5]["mora"]
