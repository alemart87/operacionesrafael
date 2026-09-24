"""Simulador de facturación (Televentas Claro): invariantes del motor."""
from app.services.analyzers.facturacion_simulador import PARAMETROS_DEFAULT, simular_facturacion


def test_mes0_y_retencion_a_6_y_12_meses():
    r = simular_facturacion({"ventas": 1950, "objetivo_co": 1750})
    d = r["derivados"]
    assert d["activaciones"] == 1950  # las ventas cargadas ya son efectivas: no se descuentan
    # 1.940 en estado A ÷ 1.750 = 110,9% → escalón ≥110% (120.000, escala vigente); efectividad 89% → 50.000
    assert d["monto_bono_productividad"] == 120000 and d["monto_bono_efectividad"] == 50000
    assert r["bruto_mes0"] == sum(r["mes0"].values())
    # A los 6 meses queda menos que lo facturado (chargebacks) y a 12 se recupera parte con residual
    assert r["neto_6"] < r["bruto_mes0"]
    assert r["neto_12"] > r["neto_6"]
    assert 0 < r["pct_retenido_6"] < 100
    # proyección: 13 meses, acumulado consistente
    assert len(r["meses"]) == 13
    assert r["meses"][6]["acumulado"] == r["neto_6"]
    assert r["meses"][3]["cuota2"] > 0 and r["meses"][6]["recalculo_productividad"] < 0
    assert r["meses"][1]["clawbacks"] < 0 and r["meses"][7]["clawbacks"] == 0  # fuera del chargeback
    # peso de los bonos se genera con cada simulación
    b = r["bonos"]
    assert b["mes0"] == r["mes0"]["bono_productividad"] + r["mes0"]["bono_efectividad"]
    assert 0 < b["peso_mes0_pct"] < 100 and b["sin_bonos_mes0"] == r["bruto_mes0"] - b["mes0"]
    # el bono efectividad se paga en el 87,5% de las activaciones (calibración real)
    assert r["mes0"]["bono_efectividad"] == round(1950 * 0.875 * 50000)


def test_escalas_de_bonos_y_acantilado():
    # escala vigente: ≥110% 120.000 · ≥105% 115.000 · ≥100% 105.000 · ≥95% 40.000 · <95% 0
    alto = simular_facturacion({"ventas": 1720, "objetivo_co": 1700})  # 100,7%
    assert alto["derivados"]["monto_bono_productividad"] == 105000
    assert simular_facturacion({"ventas": 1800, "objetivo_co": 1700, "pct_estado_a": 100})["derivados"]["monto_bono_productividad"] == 115000  # 105,9%
    medio = simular_facturacion({"ventas": 1830, "objetivo_co": 1900, "pct_estado_a": 100})  # 96,3%
    assert medio["derivados"]["monto_bono_productividad"] == 40000
    bajo = simular_facturacion({"ventas": 1780, "objetivo_co": 1900, "pct_estado_a": 100})  # 93,7% < 95%
    assert bajo["derivados"]["monto_bono_productividad"] == 0
    assert "ALERTA" in bajo["conclusion"]
    # efectividad (de entregas): elige el escalón pero NO cambia las activaciones
    r84 = simular_facturacion({"efectividad_pct": 84})
    assert r84["derivados"]["monto_bono_efectividad"] == 45000 and r84["derivados"]["activaciones"] == 1950
    assert simular_facturacion({"efectividad_pct": 79})["derivados"]["monto_bono_efectividad"] == 0
    # distancia al siguiente escalón informada en activaciones
    dist = alto["bonos"]["distancia_productividad"]
    assert dist["escalon_actual"]["desde_pct"] == 100 and dist["siguiente_escalon"]["desde_pct"] == 105
    assert dist["faltan_unidades"] > 0


def test_variables_editables_cambian_el_resultado():
    base = simular_facturacion({})
    # zafra plana al 100%: sin caídas → sin clawbacks y más residual
    sin_caidas = simular_facturacion({"zafra_pct": [100.0] * 13, "migracion_negocio_pct": 0})
    assert all(m["clawbacks"] == 0 for m in sin_caidas["meses"])
    assert sin_caidas["neto_12"] > base["neto_12"]
    # escala editada: bono productividad 120.000 en el escalón alcanzado
    esc = [{"desde_pct": 90, "monto": 120000}]
    r = simular_facturacion({"escala_productividad": esc})
    assert r["derivados"]["monto_bono_productividad"] == 120000
    # el mix de planes cambia la cuota 1 ponderada
    solo30 = simular_facturacion({"planes": [{**PARAMETROS_DEFAULT["planes"][1], "mix_pct": 100}]})
    assert solo30["derivados"]["cuota1_ponderada"] == 245455


def test_costos_estructura_y_margen():
    """Costos: ventas por vendedor genera la dotación; supervisores, backoffice, IPS,
    aguinaldo, logística y operativos; margen contra mes 0 y contra lo que queda a 6 meses."""
    r = simular_facturacion({"ventas": 1900, "objetivo_co": 1750})
    c, m = r["costos"], r["margen"]
    assert c["headcount"] == {"vendedores": 95, "supervisores": 7, "backoffice": 11,
                              "coordinadores": 1, "controllers": 2, "subgerencia": 0, "total": 116}
    assert c["salario_operador_mes"] == round(14635 * 7 * 23)
    assert c["rrhh"]["operadores_salario"] == round(95 * 14635 * 7 * 23)
    assert c["rrhh"]["operadores_comisiones"] == 1900 * 102000      # comisión por venta: paga IPS y aguinaldo
    assert c["plus_vendedores"] == 1900 * 32000                       # plus por venta: sin cargas
    assert c["rrhh"]["supervisores"] == 7 * (4180000 + 1500000)
    assert c["rrhh"]["controllers"] == 2 * (3600000 + 750000)
    assert c["ips"] == round(c["rrhh_base"] * 0.165)
    assert c["aguinaldo"] == round(c["rrhh_base"] / 12)          # aguinaldo sobre RRHH, sin IPS
    assert c["logistica_entregas"] == round(1900 * (0.6 * 80000 + 0.4 * 55000))
    assert c["operativos"] == 1900 * 12500
    assert c["total"] == c["rrhh_base"] + c["ips"] + c["aguinaldo"] + c["plus_vendedores"] + c["logistica_entregas"] + c["logistica_premios"] + c["operativos"]
    assert c["rrhh_base"] == sum(c["rrhh"].values())                  # el plus NO está en la base de IPS/aguinaldo
    assert m["mes0"] == r["bruto_mes0"] - c["total"]
    assert m["meses6"] == r["neto_6"] - c["total"]
    # con la estructura por defecto el negocio no cierra a 6 meses → alerta y sin punto de equilibrio
    assert m["meses6"] < 0 and m.get("breakeven_ventas_6") is None
    assert r["recomendaciones"][0]["severidad"] == "alert"
    # variables editables: más ventas por vendedor y menor comisión por venta mejoran el margen
    mejor = simular_facturacion({"ventas": 1900, "objetivo_co": 1750,
                                 "costos": {"ventas_por_vendedor": 30, "comision_por_venta": 90000}})
    assert mejor["costos"]["headcount"]["vendedores"] == 64
    assert mejor["margen"]["meses6"] > m["meses6"]


def test_simulacion_sin_bonos():
    con = simular_facturacion({"ventas": 1950, "objetivo_co": 1750})
    sin = simular_facturacion({"ventas": 1950, "objetivo_co": 1750, "bonos_activos": False})
    assert sin["mes0"]["bono_productividad"] == 0 and sin["mes0"]["bono_efectividad"] == 0
    assert sin["bruto_mes0"] == con["bruto_mes0"] - con["bonos"]["mes0"]
    assert sin["meses"][6]["recalculo_productividad"] == 0  # sin bono no hay recálculo
    assert "SIN BONOS" in sin["conclusion"] and "ALERTA" not in sin["conclusion"]
    assert sin["margen"]["meses6"] < con["margen"]["meses6"]


def test_sin_bonos_con_escalon_siguiente_no_rompe():
    # Escenario real del usuario: 1.700 ventas, objetivo 1.700, 100% en estado A, bonos desactivados
    # → cumplimiento 100% tiene un escalón siguiente (105%) pero no hay escalón activo: no debe fallar.
    r = simular_facturacion({"ventas": 1700, "objetivo_co": 1700, "pct_estado_a": 100, "bonos_activos": False})
    assert r["derivados"]["monto_bono_productividad"] == 0
    assert "SIN BONOS" in r["conclusion"]
    assert not any("escalón" in x["titulo"] for x in r["recomendaciones"])
    # y con bonos activos el mismo escenario sí informa el escalón
    con = simular_facturacion({"ventas": 1700, "objetivo_co": 1700, "pct_estado_a": 100})
    assert con["derivados"]["monto_bono_productividad"] == 105000


def test_remuneracion_promedio_del_vendedor():
    r = simular_facturacion({"ventas": 1900, "objetivo_co": 1750})
    c = r["costos"]; v = c["vendedor"]
    assert v["salario_fijo"] == c["salario_operador_mes"]
    assert v["comision_por_venta"] == 102000 and v["plus_por_venta"] == 32000 and v["variable_por_venta"] == 134000
    assert v["comision_promedio"] == round(1900 * 102000 / 95) and v["plus_promedio"] == round(1900 * 32000 / 95)
    assert v["ingreso_promedio"] == round(c["salario_operador_mes"] + 1900 * 134000 / 95)
    assert v["comision_con_cargas_por_venta"] == round(102000 * (1 + 0.165 + 1 / 12) + 32000)
    # referencia: peso de comisión + plus sobre lo facturado (indicador, no parámetro)
    assert v["peso_sobre_facturacion_pct"] == round(1900 * 134000 / r["bruto_mes0"] * 100, 1)
    assert v["ventas_promedio"] == 20.0


def test_simulacion_anual_estructura_fija():
    from app.services.analyzers.facturacion_simulador import simular_anual
    ventas = [1900, 1700, 1800, 2000, 1900, 1600, 1900, 2100, 1900, 1900, 1750, 1900]
    r = simular_anual({"objetivo_co": 1750}, ventas)
    assert len(r["meses"]) == 12 and r["headcount"]["vendedores"] == 95  # fijado por el mes 1 (1.900 ÷ 20)
    m1, m2 = r["meses"][0], r["meses"][1]
    # mes 1: sin cohortes previas → sin ajustes; mes 2: ya recibe ajustes de la cohorte 1
    assert m1["ajustes"] == 0 and m2["ajustes"] != 0
    assert m2["clawbacks"] < 0 and m2["residual"] > 0
    # la estructura fija no cambia con las ventas: mismos salarios en todos los meses
    assert all(f["costos"]["rrhh"]["operadores_salario"] == m1["costos"]["rrhh"]["operadores_salario"] for f in r["meses"])
    assert all(f["costos"]["headcount"]["vendedores"] == 95 for f in r["meses"])
    # lo variable sí cambia: comisiones y logística del mes 2 (1.700 ventas) < mes 1 (1.900)
    assert m2["costos"]["rrhh"]["operadores_comisiones"] < m1["costos"]["rrhh"]["operadores_comisiones"]
    assert m2["costos"]["logistica_entregas"] < m1["costos"]["logistica_entregas"]
    # mes 6 (1.600 ventas = 91% del objetivo) baja de escalón; mes 8 (2.100 = 119%) llega al máximo
    # mes 6: 1.600 ÷ 1.750 = 91% → bajo el 95% no cobra (escala 2026); mes 8: 2.100 ÷ 1.750 = 120% → escalón 110
    assert r["meses"][5]["escalon_productividad"] is None and r["meses"][5]["monto_bono_productividad"] == 0
    assert r["meses"][7]["escalon_productividad"] == 110
    # consistencia anual
    a = r["anual"]
    assert a["ventas"] == sum(ventas)
    assert a["resultado"] == sum(f["resultado"] for f in r["meses"])
    assert r["meses"][-1]["acumulado"] == a["resultado"]
    assert a["cola_post_12"]["total"] != 0


def test_simulacion_a_18_meses():
    from app.services.analyzers.facturacion_simulador import simular_anual
    r12 = simular_anual({"objetivo_co": 1750}, [1900] * 12, 12)
    r18 = simular_anual({"objetivo_co": 1750}, [1900] * 18, 18)
    assert len(r18["meses"]) == 18 and r18["horizonte"] == 18 and r12["horizonte"] == 12
    # los primeros 12 meses son idénticos en ambos horizontes
    assert [m["resultado"] for m in r18["meses"][:12]] == [m["resultado"] for m in r12["meses"]]
    # el mes 13 sigue recibiendo residual de cohortes recientes y ajustes
    m13 = r18["meses"][12]
    assert m13["residual"] > 0 and m13["ajustes"] != 0
    # a 18 meses queda menos cola pendiente que a 12 (más flujos entran en el período)
    assert abs(r18["anual"]["cola_post_12"]["total"]) <= abs(r12["anual"]["cola_post_12"]["total"]) + 1
    assert "18 meses simulados" in r18["conclusion"]


def test_ajuste_de_comisiones():
    base = simular_facturacion({"ventas": 1900, "objetivo_co": 1750})
    mas5 = simular_facturacion({"ventas": 1900, "objetivo_co": 1750, "ajuste_comisiones_pct": 5})
    d0, d5 = base["derivados"], mas5["derivados"]
    # cuota 1, cuota 2 y porta suben 5%; el residual y los bonos no
    assert abs(d5["cuota1_ponderada"] - d0["cuota1_ponderada"] * 1.05) <= 1
    assert abs(d5["cuota2_ponderada"] - d0["cuota2_ponderada"] * 1.05) <= 1
    assert abs(d5["porta_plus_ponderado"] - d0["porta_plus_ponderado"] * 1.05) <= 1
    assert d5["residual_por_linea"] == d0["residual_por_linea"]
    assert mas5["mes0"]["bono_productividad"] == base["mes0"]["bono_productividad"]
    assert mas5["mes0"]["activaciones_cuota1"] == round(base["mes0"]["activaciones_cuota1"] * 1.05)
    assert mas5["neto_6"] > base["neto_6"] and "ajuste de comisiones del +5.0%" in mas5["conclusion"]
    # la comisión de los VENDEDORES no cambia con el ajuste: se calcula sobre la tarifa sin ajuste
    assert mas5["costos"]["rrhh"]["operadores_comisiones"] == base["costos"]["rrhh"]["operadores_comisiones"]
    assert mas5["costos"]["vendedor"]["comision_promedio"] == base["costos"]["vendedor"]["comision_promedio"]
    # y toda la mejora va al margen: margen mes 0 sube exactamente lo que subió la facturación
    assert mas5["margen"]["mes0"] - base["margen"]["mes0"] == mas5["bruto_mes0"] - base["bruto_mes0"]
    # también aplica en la simulación anual (cohortes)
    from app.services.analyzers.facturacion_simulador import simular_anual
    a0 = simular_anual({"objetivo_co": 1750}, [1900] * 12)
    a5 = simular_anual({"objetivo_co": 1750, "ajuste_comisiones_pct": 5}, [1900] * 12)
    assert a5["anual"]["facturacion_bruta"] > a0["anual"]["facturacion_bruta"]
    assert all(m5["costos"]["rrhh"]["operadores_comisiones"] == m0["costos"]["rrhh"]["operadores_comisiones"]
               for m5, m0 in zip(a5["meses"], a0["meses"]))


def test_cierre_con_todas_las_caidas():
    """El puente de lo facturado al resultado final cierra en ambos simuladores."""
    from app.services.analyzers.facturacion_simulador import simular_anual
    r = simular_facturacion({"ventas": 1900, "objetivo_co": 1750})
    ci = r["cierre"]
    # facturado − devoluciones + cobros == lo que queda a 12 meses
    assert abs(r["bruto_mes0"] + ci["devoluciones_12"] + ci["cobros_12"] - r["neto_12"]) <= 2
    assert ci["resultado_final"] == r["margen"]["meses12"]
    assert ci["gana"] == (r["margen"]["meses12"] >= 0)
    assert ci["ultimo_mes_caidas"] == 6 and ci["ultimo_mes_residual"] == 12
    assert ci["devoluciones_12"] < 0 < ci["cobros_12"]
    assert ci["devoluciones_12"] == ci["devoluciones_6"]  # después del mes 6 no cae nada más

    a = simular_anual({"objetivo_co": 1750}, [1900] * 12)["anual"]
    cola, v = a["cola_post_12"], a["veredicto"]
    assert abs(a["facturacion_bruta"] + a["devoluciones_periodo"] + a["cobros_periodo"] - a["ingreso_neto"]) <= 2
    assert abs(cola["cobros"] + cola["devoluciones"] - cola["total"]) <= 2
    assert v["resultado_final"] == a["resultado_con_cola"] == a["resultado"] + cola["total"]
    assert v["gana"] == (a["resultado_con_cola"] >= 0)
    assert cola["ultimo_mes_caidas"] == 18 and cola["ultimo_mes_residual"] == 24


def test_subgerencia_comercial_en_analisis():
    """SubGerencia Comercial: 0 por defecto (no cambia nada); al cargarla suma al costo con IPS y aguinaldo."""
    from app.services.analyzers.facturacion_simulador import simular_anual
    base = simular_facturacion({"ventas": 1900})
    assert PARAMETROS_DEFAULT["costos"]["subgerencia_salario"] == 0
    assert base["costos"]["rrhh"]["subgerencia"] == 0 and base["costos"]["headcount"]["subgerencia"] == 0
    con = simular_facturacion({"ventas": 1900, "costos": {"subgerencia_salario": 8_000_000}})
    c = con["costos"]
    assert c["rrhh"]["subgerencia"] == 8_000_000 and c["headcount"]["subgerencia"] == 1
    assert c["headcount"]["total"] == base["costos"]["headcount"]["total"] + 1
    ips = 16.5 / 100
    esperado = 8_000_000 * (1 + ips + 1 / 12)             # salario + IPS + aguinaldo (salario ÷ 12)
    assert abs((c["total"] - base["costos"]["total"]) - esperado) <= 3
    assert con["margen"]["meses6"] == base["margen"]["meses6"] - (c["total"] - base["costos"]["total"])
    # en la anual entra en el costo fijo mensual
    a0 = simular_anual({}, [1900] * 12)["anual"]
    a1 = simular_anual({"costos": {"subgerencia_salario": 8_000_000}}, [1900] * 12)["anual"]
    assert abs((a1["costos_fijos_mes"] - a0["costos_fijos_mes"]) - esperado) <= 3
    assert abs((a1["costos"] - a0["costos"]) - esperado * 12) <= 40


def test_meses_afectados_en_la_anual():
    """Un mes afectado usa sus propias variaciones (porta, efectividad, mix, costos variables);
    el resto del año y la estructura no cambian."""
    from app.services.analyzers.facturacion_simulador import simular_anual
    base = simular_anual({"objetivo_co": 1750}, [1900] * 12)
    con = simular_anual({"objetivo_co": 1750}, [1900] * 12, 12, {
        "7": {"porta_pct": 20, "efectividad_pct": 79, "costos": {"operativo_por_venta": 20000, "ventas_por_vendedor": 5}},
        "1": {"porta_pct": 0},      # el mes 1 no es afectable: es la base
        "99": {"porta_pct": 0},     # fuera del horizonte: se ignora
    })
    assert list(con["meses_afectados"].keys()) == ["7"]
    assert "ventas_por_vendedor" not in con["meses_afectados"]["7"]["costos"]   # la estructura no se pisa
    m7b, m7c = base["meses"][6], con["meses"][6]
    assert m7c["afectado"] and not base["meses"][6]["afectado"]
    assert m7c["portabilidad"] < m7b["portabilidad"]                 # menos porta → menos plus
    assert m7c["bono_efectividad"] == 0 < m7b["bono_efectividad"]    # 79% pierde el bono efectividad
    assert m7c["costos"]["operativos"] == 1900 * 20000
    assert m7c["costos"]["headcount"] == m7b["costos"]["headcount"]  # estructura fija
    # los demás meses del mes 0 no cambian (los ajustes posteriores de la cohorte 7 sí, más adelante)
    for t in range(6):
        assert con["meses"][t]["facturacion_bruta"] == base["meses"][t]["facturacion_bruta"]
        assert con["meses"][t]["resultado"] == base["meses"][t]["resultado"]
    assert con["anual"]["resultado"] < base["anual"]["resultado"]
    assert "Mes 7" in con["conclusion"]
    # mix de planes por nombre
    mix = simular_anual({"objetivo_co": 1750}, [1900] * 12, 12,
                        {"3": {"planes": [{"plan": "CG15G", "mix_pct": 90}, {"plan": "C200X", "mix_pct": 10},
                                          {"plan": "CG30G", "mix_pct": 0}, {"plan": "CG50B", "mix_pct": 0}, {"plan": "C100X", "mix_pct": 0}]}})
    assert mix["meses"][2]["activaciones_cuota1"] != base["meses"][2]["activaciones_cuota1"]


def test_bono_adicional_y_nombres_de_meses():
    """Bono adicional a mano: entra a la facturación del mes (y al peso de bonos), no se devuelve;
    por defecto es 0. Nombres de meses editables en la anual."""
    from app.services.analyzers.facturacion_simulador import simular_anual
    base = simular_facturacion({"ventas": 1900})
    assert base["mes0"]["bono_adicional"] == 0
    con = simular_facturacion({"ventas": 1900, "bono_adicional": 25_000_000})
    assert con["mes0"]["bono_adicional"] == 25_000_000
    assert con["bruto_mes0"] == base["bruto_mes0"] + 25_000_000
    assert con["bonos"]["mes0"] == base["bonos"]["mes0"] + 25_000_000
    assert con["neto_12"] - base["neto_12"] == 25_000_000            # no se devuelve ni se recalcula
    # comisión del vendedor: la base incluye el bono adicional (como los demás bonos)
    assert con["costos"]["rrhh"]["operadores_comisiones"] == base["costos"]["rrhh"]["operadores_comisiones"]   # el vendedor cobra por venta, no por bono
    # anual: por mes, y nombres
    a = simular_anual({}, [1900] * 12, 12, None, [0, 10_000_000, 0], ["Oct 2026", "Nov 2026"])
    assert a["meses"][1]["bono_adicional"] == 10_000_000 and a["meses"][0]["bono_adicional"] == 0
    assert a["anual"]["bonos_adicionales"] == 10_000_000
    assert a["nombres_meses"][:3] == ["Oct 2026", "Nov 2026", "Mes 3"]
    assert a["meses"][1]["nombre"] == "Nov 2026"
    assert "bono adicional" in a["conclusion"]


def test_anual_es_aditiva_al_guarani():
    """Todos los puentes cierran exacto: bruta + ajustes = neto; neto − costos = resultado;
    acumulado suma exacto; cola = cobros + devoluciones; final = resultado + cola."""
    from app.services.analyzers.facturacion_simulador import _FLUJOS, simular_anual
    r = simular_anual({"objetivo_co": 1750}, [1900, 1500, 1900, 2100, 1900, 1700] * 3, 18, {"6": {"porta_pct": 20}}, [0, 0, 15_000_000])
    acum = 0
    for m in r["meses"]:
        assert sum(m[k] for k in _FLUJOS) == m["ajustes"]
        assert m["facturacion_bruta"] + m["ajustes"] == m["ingreso_neto"]
        assert m["ingreso_neto"] - m["costo_total"] == m["resultado"]
        assert m["acumulado_anterior"] == acum
        acum += m["resultado"]
        assert m["acumulado"] == acum
        assert all(float(m[k]).is_integer() for k in ("facturacion_bruta", "ajustes", "ingreso_neto", "resultado", "acumulado", *_FLUJOS))
    a = r["anual"]
    assert a["resultado"] == acum
    assert a["facturacion_bruta"] + a["ajustes"] == a["ingreso_neto"]
    assert a["ingreso_neto"] - a["costos"] == a["resultado"]
    assert a["cobros_periodo"] + a["devoluciones_periodo"] == a["ajustes"]
    c = a["cola_post_12"]
    assert c["cobros"] + c["devoluciones"] == c["total"] == sum(c[k] for k in _FLUJOS)
    assert a["resultado"] + c["total"] == a["resultado_con_cola"] == a["veredicto"]["resultado_final"]



def test_calibracion_con_liquidaciones_reales():
    """Defaults calibrados con las 7 liquidaciones (383-389) y el manual de conceptos de Claro."""
    from app.services.analyzers.facturacion_simulador import RESIDUAL_CURVA_DEFAULT
    d = PARAMETROS_DEFAULT
    assert d["porta_pct"] == 90 and d["pct_bono_efectividad_cobrado"] == 87.5 and d["pct_recalculo_productividad"] is None
    assert d["pct_caidas_penalizables"] == 85 and d["recupero_pct"] == 12 and d["pct_abono_acreditado"] == 48
    assert d["migracion_negocio_pct"] == 3.2 and len(RESIDUAL_CURVA_DEFAULT) == 12
    r = simular_facturacion({"ventas": 1000, "objetivo_co": 900})
    m = r["meses"]
    cuota1 = r["derivados"]["cuota1_ponderada"]
    # residual: sigue la curva de líneas que pagan, no la zafra (mes 12: 32,4% de las líneas)
    res_linea = r["derivados"]["residual_por_linea"]
    assert abs(m[12]["residual"] - 1000 * 0.324 * res_linea) <= 200
    assert abs(m[1]["residual"] - 1000 * 0.913 * res_linea) <= 500
    # recálculo del bono: regla de Claro, 100% del bono de las líneas caídas al día 180 (100 − zafra[6] = 48,9%)
    assert r["derivados"]["pct_recalculo_efectivo"] == 48.9
    assert m[6]["recalculo_productividad"] == -round(1000 * 0.995 * r["derivados"]["monto_bono_productividad"] * 0.489)
    # un % explícito reemplaza la regla
    r38 = simular_facturacion({"ventas": 1000, "objetivo_co": 900, "pct_recalculo_productividad": 38})
    assert r38["derivados"]["pct_recalculo_efectivo"] == 38
    assert r38["meses"][6]["recalculo_productividad"] == -round(1000 * 0.995 * r["derivados"]["monto_bono_productividad"] * 0.38)
    # cuota 2: legajo no presentado cobra 0, incompleto la mitad
    assert abs(m[3]["cuota2"] - 1000 * 0.538 * r["derivados"]["cuota2_ponderada"] * (1 - 0.05 / 2 - 0.03)) <= 600
    # migración de negocio: 3,2% pierde la cuota 1 completa en el mes 3
    caidas3 = 1000 * (0.585 - 0.538)
    sin_migr = simular_facturacion({"ventas": 1000, "objetivo_co": 900, "migracion_negocio_pct": 0})
    assert abs((m[3]["clawbacks"] - sin_migr["meses"][3]["clawbacks"]) + 1000 * 0.032 * cuota1) <= 50
    # caídas penalizables 85% solo sobre cuota 1 + residual; la porta se devuelve en el 100% de las caídas
    porta_w = r["derivados"]["porta_plus_ponderado"]
    esperado = -caidas3 * (0.85 * (cuota1 + res_linea) + 0.90 * porta_w) * (1 - 0.12)
    assert abs(sin_migr["meses"][3]["clawbacks"] - esperado) <= 100
    # devolución del bono efectividad: sobre la parte cobrada (87,5%)
    assert abs(m[3]["clawback_bonos"] - (-caidas3 * 0.875 * 50000 * 0.88)) <= 2  # montos exactos (sin ponderar)


def test_ola_de_devoluciones_y_ventas_de_equilibrio():
    """Con ventas estables la ola de devoluciones heredadas crece y se estabiliza; si las ventas bajan,
    la ola sigue pegando y el mes queda en riesgo: hacen falta más ventas de las cargadas para no perder."""
    from app.services.analyzers.facturacion_simulador import simular_anual
    ventas = [1900] * 8 + [1400] * 4
    r = simular_anual({"objetivo_co": 1750}, ventas)
    m = r["meses"]
    assert m[0]["ola_devoluciones"] == 0 and m[0]["ola_cobros"] == 0          # el mes 1 no hereda nada
    assert m[1]["ola_devoluciones"] < 0 and m[6]["ola_devoluciones"] < m[1]["ola_devoluciones"]   # la ola crece
    assert m[7]["ola_devoluciones"] <= m[6]["ola_devoluciones"] * 0.9                            # y se estabiliza (mes 7 ≈ mes 8)
    for f in m:
        assert f["ola_devoluciones"] == f["legajos"] + f["clawbacks"] + f["clawback_bonos"] + f["recalculo_productividad"]
        assert f["ola_cobros"] == f["residual"] + f["cuota2"]
        assert f["ventas_equilibrio"] is None or f["ventas_equilibrio"] >= 0
    # al bajar a 1.400 con la ola de 1.900 encima, el mes 9 queda en riesgo: equilibrio > 1.400
    assert m[8]["en_riesgo"] and (m[8]["ventas_equilibrio"] is None or m[8]["ventas_equilibrio"] > 1400)
    assert 9 in r["anual"]["meses_en_riesgo"]
    assert r["anual"]["ola_maxima"] < 0 and "Riesgo por bajar productividad" in r["conclusion"]
    # el equilibrio de un mes es coherente: con esas ventas el resultado del mes no es negativo
    eq = m[8]["ventas_equilibrio"]
    if eq:
        r2 = simular_anual({"objetivo_co": 1750}, ventas[:8] + [eq] + ventas[9:])
        assert r2["meses"][8]["resultado"] >= -1
