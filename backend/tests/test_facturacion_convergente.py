"""Simulador convergente: la misma estructura vende pospago y GPON."""
from app.operativas.televentas_claro.facturacion.analyzers.convergente import (
    HEADCOUNT_COMPARTIDO, costos_gpon_compartidos, simular_convergente,
)
from app.operativas.televentas_claro.facturacion.analyzers.gpon import PARAMETROS_GPON_DEFAULT, simular_gpon_anual
from app.operativas.televentas_claro.facturacion.analyzers.simulador import PARAMETROS_DEFAULT, simular_anual

VENTAS = [1900] * 12


def test_gpon_no_duplica_estructura():
    c = simular_convergente({"objetivo_co": 1750}, VENTAS, 12, gpon={"activo": True, "por_asesor_por_mes": [3]})
    m = simular_anual({"objetivo_co": 1750}, VENTAS, 12)
    assert c["negocio"] == "CONVERGENTE"
    # Misma dotación que pospago solo.
    for k in ("vendedores", "supervisores", "backoffice", "coordinadores", "controllers", "total"):
        assert c["headcount"][k] == m["headcount"][k]
    # Activaciones GPON = vendedores × 3, todos los meses.
    assert c["headcount"]["ventas_gpon_mes1"] == c["headcount"]["vendedores"] * 3
    assert all(f["ventas_gpon"] == c["headcount"]["vendedores"] * 3 for f in c["meses"])
    # Costos convergentes = costos pospago + SOLO variables GPON (comisión con cargas, plus, operativos, logística).
    for f, fm in zip(c["meses"], m["meses"]):
        assert f["costo_total_movil"] == fm["costo_total"]
        g = f["gpon_costos"]
        assert g["headcount"]["vendedores"] == 0 and g["rrhh"]["operadores_salario"] == 0 and g["rrhh"]["supervisores"] == 0
        assert g["logistica_premios"] == 0 and g["rrhh"]["subgerencia"] == 0
        assert f["costo_total"] == fm["costo_total"] + g["total"]
        assert g["total"] == g["rrhh_total"] + g["plus_vendedores"] + g["logistica_entregas"] + g["operativos"] + g["documentacion"]
        assert g["documentacion"] == f["ventas_gpon"] * 55000      # recupero de documentación por venta GPON


def test_convergente_suma_los_dos_negocios_con_gpon_completo():
    c = simular_convergente({"objetivo_co": 1750}, VENTAS, 12, gpon={"activo": True, "por_asesor_por_mes": [3]})
    m = simular_anual({"objetivo_co": 1750}, VENTAS, 12)
    vend = c["headcount"]["vendedores"]
    # Sin objetivo explícito, el convergente fija el objetivo GPON en vendedores × 3 (el ideal rinde 100%).
    assert c["parametros_gpon"]["objetivo"] == vend * 3
    pg = {**PARAMETROS_GPON_DEFAULT, "objetivo": vend * 3,
          "costos": costos_gpon_compartidos(PARAMETROS_GPON_DEFAULT["costos"], PARAMETROS_DEFAULT["costos"])}
    g = simular_gpon_anual(pg, [vend * 3] * 12, 12, headcount_costos=HEADCOUNT_COMPARTIDO, vendedores_compartidos=vend)
    for f, fm, fg in zip(c["meses"], m["meses"], g["meses"]):
        # GPON entra con su facturación completa: cuota 1 + bono fijo, y sus ajustes (cuota 2, legajos, mora, recálculo, otros).
        assert f["facturacion_bruta"] == fm["facturacion_bruta"] + fg["facturacion_bruta"]
        assert f["gpon_activaciones_cuota1"] == fg["activaciones_cuota1"] and f["gpon_bono_fijo"] == fg["bono_fijo"]
        assert f["gpon_mora"] == fg["mora"] and f["gpon_cuota2"] == fg["cuota2"] and f["gpon_recalculo"] == fg["recalculo"]
        assert f["ajustes"] == fm["ajustes"] + fg["ajustes"]
        assert f["ingreso_neto"] == fm["ingreso_neto"] + fg["ingreso_neto"]
        assert f["resultado"] == fm["resultado"] + fg["resultado"]
        assert f["resultado"] == f["ingreso_neto"] - f["costo_total"]
        assert f["resultado_movil"] == fm["resultado"] and f["resultado_gpon"] == fg["resultado"]
    a = c["anual"]
    assert a["resultado"] == m["anual"]["resultado"] + g["anual"]["resultado"]
    assert a["ingreso_neto"] == a["ingreso_neto_movil"] + a["ingreso_neto_gpon"]
    assert a["cola_post_12"]["total"] == m["anual"]["cola_post_12"]["total"] + g["anual"]["cola_post_12"]["total"]
    assert a["resultado_con_cola"] == a["resultado"] + a["cola_post_12"]["total"]
    assert a["veredicto"]["gana"] == (a["resultado_con_cola"] >= 0)
    # La mora GPON (su zafra) y el recálculo están en el balance.
    assert a["gpon_mora"] < 0 and a["gpon_recalculo"] < 0 and a["gpon_cuota2"] > 0
    assert sum(f["gpon_mora"] for f in c["meses"]) == a["gpon_mora"]
    # El acumulado es aditivo.
    acum = 0
    for f in c["meses"]:
        acum += f["resultado"]
        assert f["acumulado"] == acum


def test_gpon_apagado_es_pospago_puro():
    c = simular_convergente({"objetivo_co": 1750}, VENTAS, 12, gpon={"activo": False})
    m = simular_anual({"objetivo_co": 1750}, VENTAS, 12)
    assert c["gpon"] is None and c["convergente"]["activo"] is False
    assert c["anual"]["resultado"] == m["anual"]["resultado"]
    assert [f["resultado"] for f in c["meses"]] == [f["resultado"] for f in m["meses"]]


def test_gpon_mejora_el_equilibrio_y_por_asesor_variable():
    sin = simular_convergente({"objetivo_co": 1750}, VENTAS, 12, gpon={"activo": False})
    con = simular_convergente({"objetivo_co": 1750}, VENTAS, 12, gpon={"activo": True, "por_asesor_por_mes": [3]})
    # Con el aporte GPON hacen falta menos ventas de pospago para cubrir la estructura.
    assert con["anual"]["ventas_equilibrio_max"] <= sin["anual"]["ventas_equilibrio_max"]
    assert all(f["aporte_externo"] == f["aporte_gpon"] for f in con["meses"])
    # GPON por asesor variable: 3 los primeros meses, 1 después → menos activaciones y menos facturación GPON.
    var = simular_convergente({"objetivo_co": 1750}, VENTAS, 12, gpon={"activo": True, "por_asesor_por_mes": [3] * 6 + [1] * 6})
    assert var["meses"][0]["ventas_gpon"] == con["meses"][0]["ventas_gpon"]
    assert var["meses"][6]["ventas_gpon"] == con["headcount"]["vendedores"] * 1
    assert var["anual"]["ventas_gpon"] < con["anual"]["ventas_gpon"]
    assert var["anual"]["facturacion_bruta_gpon"] < con["anual"]["facturacion_bruta_gpon"]
    # Horizonte 18 y aditividad de la cola.
    c18 = simular_convergente({"objetivo_co": 1750}, [1900] * 18, 18, gpon={"activo": True, "por_asesor_por_mes": [3]})
    assert len(c18["meses"]) == 18 and c18["anual"]["horizonte"] == 18
