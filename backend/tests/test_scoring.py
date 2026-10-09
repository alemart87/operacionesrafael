"""Scoring v1 (modelo Líder Coach Comercial): componentes lineales, reparto del peso de lo que no se
evalúa, objetivo de referencia del asesor por días trabajados y resultado del supervisor."""
from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest

from app.operativas.televentas_claro.supervision.calculo import (
    PARAMETROS_DEFECTO, atribuir, calendario, lineas_netas,
)
from app.operativas.televentas_claro.supervision.scoring import SCORING_DEFECTO, calcular, lineal, puntaje

P = {**PARAMETROS_DEFECTO, "feriados": []}
SC = dict(SCORING_DEFECTO)
PP = {"rojo": 25.0, "meta_min": 37.0, "meta_max": 47.0}
H = 3600


def test_puntos_lineales_como_la_guia():
    # Uso: 100 con 10% o menos, 0 con 35% o más. Con 20% sin uso: 15 de 25 puntos.
    assert round(lineal(20, 35, 10) * 25, 1) == 15.0
    assert lineal(8, 35, 10) == 1.0 and lineal(40, 35, 10) == 0.0
    # Conversación: 100 desde 37%, 0 con 25% o menos. Con 31%: 12,5 de 25.
    assert round(lineal(31, 25, 37) * 25, 1) == 12.5
    assert lineal(50, 25, 37) == 1.0  # arriba de la meta no resta


def test_lo_que_no_se_evalua_reparte_su_peso():
    comps = [{"clave": "pospago", "nombre": "Pospago", "peso": 35, "rel": 1.0},
             {"clave": "uso", "nombre": "Uso", "peso": 25, "rel": None},
             {"clave": "conversacion", "nombre": "Conversación", "peso": 25, "rel": 0.5},
             {"clave": "gpon", "nombre": "GPON", "peso": 15, "rel": None}]
    r = puntaje(comps)
    assert r["total"] == round((35 + 12.5) / 60 * 100, 1)
    assert [c["peso_efectivo"] for c in r["componentes"]] == [58.3, 0.0, 41.7, 0.0]
    assert puntaje([{"clave": "uso", "nombre": "Uso", "peso": 25, "rel": None}])["total"] is None


def neta(vendedor, dia, consumo="SI"):
    return {"sds_number": uuid.uuid4().hex[:8], "vendedor": vendedor, "producto": "Pospago", "fecha_venta": dia,
            "fecha_activacion": dia, "consumo": consumo, "en_espera": False}


def test_asesores_supervisor_y_operacion():
    corte = date(2026, 10, 8)
    cal = calendario("2026-10", corte, P["pesos_dia"], [])
    assert cal["transcurridos"] == 6.5 and cal["total"] == 24.5
    # Ana trabajó del 1 al 8 (6 días de semana y el sábado: 6,5) con 37,5% de conversación;
    # Beto, del 5 al 8 (4 días) con 25%.
    dias_ana = [date(2026, 10, d) for d in (1, 2, 3, 5, 6, 7, 8)]
    dias_beto = [date(2026, 10, d) for d in (5, 6, 7, 8)]
    prod = {"A, ANA": [(d, 8 * H, 3 * H) for d in dias_ana], "B, BETO": [(d, 8 * H, 2 * H) for d in dias_beto]}
    data = {"detalle_netas": [*(neta("ANA A", "2026-10-02") for _ in range(8)),
                              *(neta("BETO B", "2026-10-06") for _ in range(4)), neta("BETO B", "2026-10-07", "NO")]}
    lineas = lineas_netas(data, "2026-10", corte)
    tramos = {"a": [(date(2026, 10, 1), "S1")], "b": [(date(2026, 10, 1), "S1")]}
    atrib = atribuir(lineas, {"ANA A": "a", "BETO B": "b"}, tramos, P)
    r = calcular(primero=date(2026, 10, 1), ultimo=date(2026, 10, 31), corte=corte, cal=cal, p=P, sc=SC, pp=PP,
                 agentes={"a": "A, ANA", "b": "B, BETO"}, vendedores={"a": "ANA A", "b": "BETO B"}, tramos=tramos,
                 ref=date(2026, 10, 8), atrib=atrib, objetivos={"S1": (49, None)}, prod=prod, supervisores=["S1"])

    # Objetivo al corte del equipo: 49 × 6,5 / 24,5 = 13; Ana se queda con 6,5 / 10,5 y Beto con 4 / 10,5.
    ana, beto = r["asesores"]["a"], r["asesores"]["b"]
    pp_ana = next(c for c in ana["componentes"] if c["clave"] == "pospago")
    assert pp_ana["esperado"] == 8.0 and pp_ana["netas"] == 8 and ana["dias"] == 6.5
    # Ana: Pospago 99,4%, sin uso 0% y 37,5% de conversación → casi 100 (GPON sin objetivo: no se evalúa).
    assert ana["total"] == 99.8
    # Beto: Pospago al 101% (35), uso 20% (0,6 × 25) y conversación 25% (0) → 50 de 85.
    assert beto["total"] == 58.8
    gp = next(c for c in beto["componentes"] if c["clave"] == "gpon")
    assert gp["rel"] is None and gp["peso_efectivo"] == 0.0

    # Supervisor: 13 de 13 (100), 1 sin uso de 13 (100), conversación 29 h de 88 (33%: 0,66) → 90,1.
    s1 = r["supervisores"]["S1"]
    assert s1["resultado"] == 90.1
    # Sin registros de gestión todavía, el total es el resultado.
    assert s1["total"] == 90.1 and all(p.get("pendiente") for p in s1["partes"][1:])
    assert set(s1["asesores"]) == {"a", "b"}
    assert r["operacion"]["total"] == 90.1

    # Sin informe de ventas, las ventas no se evalúan y quedan los demás componentes.
    sin = calcular(primero=date(2026, 10, 1), ultimo=date(2026, 10, 31), corte=None,
                   cal=calendario("2026-10", None, P["pesos_dia"], []), p=P, sc=SC, pp=PP,
                   agentes={"a": "A, ANA"}, vendedores={"a": "ANA A"}, tramos=tramos, ref=date(2026, 10, 8),
                   atrib=atribuir([], {}, tramos, P), objetivos={"S1": (49, 10)}, prod=prod, supervisores=["S1"])
    comps = {c["clave"]: c for c in sin["asesores"]["a"]["componentes"]}
    assert comps["pospago"]["rel"] is None and comps["conversacion"]["rel"] == 1.0
    assert sin["asesores"]["a"]["total"] == 100.0


def test_puntaje_parcial_si_se_evalua_poco_peso():
    """Con un solo componente (p. ej. solo conversación) el puntaje se marca parcial: no alcanza para comparar."""
    solo_conv = puntaje([{"clave": "pospago", "nombre": "Pospago", "peso": 35, "rel": None},
                         {"clave": "uso", "nombre": "Uso", "peso": 25, "rel": None},
                         {"clave": "conversacion", "nombre": "Conversación", "peso": 25, "rel": 1.0},
                         {"clave": "gpon", "nombre": "GPON", "peso": 15, "rel": None}])
    assert solo_conv["total"] == 100.0 and solo_conv["cobertura"] == 25 and solo_conv["parcial"] is True
    completo = puntaje([{"clave": "pospago", "nombre": "Pospago", "peso": 35, "rel": 0.5},
                        {"clave": "uso", "nombre": "Uso", "peso": 25, "rel": 1.0},
                        {"clave": "conversacion", "nombre": "Conversación", "peso": 25, "rel": None},
                        {"clave": "gpon", "nombre": "GPON", "peso": 15, "rel": None}])
    assert completo["cobertura"] == 60 and completo["parcial"] is False


def test_dias_se_escalan_si_faltan_informes_de_productividad():
    """Con solo 2 días de Productividad de 6,5 hábiles, quien trabajó esos 2 días cuenta como 6,5:
    queda a la par de un vendedor sin llamadas que estuvo todo el período en el equipo."""
    corte = date(2026, 10, 8)
    cal = calendario("2026-10", corte, P["pesos_dia"], [])
    prod = {"A, ANA": [(date(2026, 10, 7), 8 * H, 3 * H), (date(2026, 10, 8), 8 * H, 3 * H)]}
    tramos = {"a": [(date(2026, 10, 1), "S1")], "v": [(date(2026, 10, 1), "S1")]}
    data = {"detalle_netas": [*(neta("ANA A", "2026-10-02") for _ in range(5)), *(neta("VERA V", "2026-10-02") for _ in range(5))]}
    atrib = atribuir(lineas_netas(data, "2026-10", corte), {"ANA A": "a", "VERA V": "v"}, tramos, P)
    r = calcular(primero=date(2026, 10, 1), ultimo=date(2026, 10, 31), corte=corte, cal=cal, p=P, sc=SC, pp=PP,
                 agentes={"a": "A, ANA"}, vendedores={"a": "ANA A", "v": "VERA V"}, tramos=tramos, ref=corte,
                 atrib=atrib, objetivos={"S1": (49, None)}, prod=prod, supervisores=["S1"])
    assert r["asesores"]["a"]["dias"] == 6.5 and r["asesores"]["v"]["dias"] == 6.5
    pp = {k: next(c for c in r["asesores"][k]["componentes"] if c["clave"] == "pospago") for k in ("a", "v")}
    assert pp["a"]["esperado"] == pp["v"]["esperado"] == 6.5
