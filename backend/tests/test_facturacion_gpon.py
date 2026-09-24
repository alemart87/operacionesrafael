"""Negocio GPON: motor de cohorte y proyección anual, calibrados con las liquidaciones 385–389."""
from app.operativas.televentas_claro.facturacion.analyzers.gpon import PARAMETROS_GPON_DEFAULT, simular_gpon, simular_gpon_anual


def test_gpon_cohorte_reproduce_enero_2026():
    """Cohorte real de enero (239 líneas, bono de la escala anterior 100.000): a 5 meses dejó
    123,1 M (515.000 por línea). El modelo debe quedar dentro del 3%."""
    r = simular_gpon({"ventas": 239, "objetivo": 230, "escala_bono": [{"desde_pct": 100, "monto": 100000}]})
    assert r["derivados"]["monto_bono"] == 100000 and r["derivados"]["cumplimiento_pct"] == 103.91
    acum5 = r["meses"][5]["acumulado"]
    assert abs(acum5 - 123_100_000) / 123_100_000 < 0.03
    assert abs(acum5 / 239 - 515_000) / 515_000 < 0.03
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
