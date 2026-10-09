"""Coaching y bitácora (modelo Líder Coach Comercial, fase 3): reglas del registro, gestión del supervisor
en el scoring (cobertura, foco a 5 días hábiles, seguimientos), impacto medido y el flujo del portal."""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import AsyncSessionLocal, Base, engine
from app.main import app
from app.operativas.televentas_claro.productividad.analyzer import PARAMETROS_DEFECTO as PROD_PARAMETROS
from app.operativas.televentas_claro.productividad.analyzer import analizar_dia
from app.operativas.televentas_claro.productividad.models import ProdInforme
from app.operativas.televentas_claro.supervision import api as sup_api
from app.operativas.televentas_claro.supervision import coaching as coaching_srv
from app.operativas.televentas_claro.supervision.calculo import (
    PARAMETROS_DEFECTO, atribuir, calendario, lineas_netas, sumar_habiles,
)
from app.operativas.televentas_claro.supervision.coaching import ReglaInvalida, validar_fecha, validar_seguimiento
from app.operativas.televentas_claro.supervision.impacto import (
    histograma, impacto_conversacion, impacto_uso, impacto_ventas,
)
from app.operativas.televentas_claro.supervision.scoring import SCORING_DEFECTO, calcular, gestion_supervisor
from app.operativas.televentas_claro.ventas_netas.models import VentasNetasReport
from tests.test_productividad import corte, fila, reporte

BASE = "/api/v1/televentas-claro/supervision"
TC = "televentas_claro"
H = 3600
PESOS = PARAMETROS_DEFECTO["pesos_dia"]
D = lambda m, d: date(2026, m, d)  # noqa: E731


# ============================ reglas ============================
def test_cinco_dias_habiles_con_sabado_medio_dia_y_feriados():
    assert sumar_habiles(D(10, 5), 5, PESOS, []) == D(10, 12)      # lunes → lunes (el sábado suma medio)
    assert sumar_habiles(D(10, 8), 5, PESOS, []) == D(10, 15)      # jueves → jueves
    assert sumar_habiles(D(10, 9), 5, PESOS, ["2026-10-12"]) == D(10, 17)  # con un feriado en el medio


def test_reglas_de_fecha_y_seguimiento():
    hoy = D(10, 12)
    assert validar_fecha(D(10, 12), hoy) is False
    assert validar_fecha(D(10, 10), hoy) is False       # 48 h: en término
    assert validar_fecha(D(10, 9), hoy) is True         # más de 48 h: vale, pero fuera de término
    assert validar_fecha(D(10, 1), hoy) is True
    assert validar_fecha(D(9, 30), D(10, 2)) is False   # del mes anterior, solo dentro de las 48 h
    for mala in (D(10, 13), D(9, 30)):                  # futura · del mes anterior con más de 2 días
        with pytest.raises(ReglaInvalida):
            validar_fecha(mala, hoy)
    validar_seguimiento(D(10, 12), D(10, 15), hoy)
    for fecha, seg in ((D(10, 12), D(10, 12)), (D(10, 5), D(10, 9)), (D(10, 12), D(11, 30))):
        with pytest.raises(ReglaInvalida):              # el mismo día · pasado · a más de 45 días
            validar_seguimiento(fecha, seg, hoy)


# ============================ gestión del supervisor ============================
def _c(op, sup, metrica, fecha, seguimiento, dia=None):
    return {"operador_id": op, "supervisor_id": sup, "metrica": metrica, "fecha": fecha,
            "seguimiento_fecha": seguimiento, "seguimiento_dia": dia}


def test_gestion_cobertura_foco_y_seguimientos():
    coachings = [
        _c("a", "S1", "uso", D(10, 5), D(10, 8), D(10, 8)),                # seguimiento a tiempo
        _c("b", "S1", "conversacion", D(10, 6), D(10, 9), D(10, 12)),      # seguimiento tarde (más de un día)
        _c("c", "S2", "otra", D(10, 7), D(10, 30)),                        # de otro supervisor: igual cubre al asesor
        _c("a", "S1", "pospago", D(10, 14), D(10, 16)),                    # seguimiento vencido sin registrar
        _c("b", "S1", "uso", D(10, 15), D(10, 21)),                        # seguimiento por venir
    ]
    alertas = [
        {"operador_id": "a", "supervisor_id": "S1", "vence": D(10, 9), "hasta": None},     # cubierta (uso el 5/10)
        {"operador_id": "b", "supervisor_id": "S1", "vence": D(10, 13), "hasta": None},    # vencida: el uso fue el 15/10
        {"operador_id": "d", "supervisor_id": "S1", "vence": D(10, 12), "hasta": D(10, 11)},  # se fue sola antes del plazo
        {"operador_id": "d", "supervisor_id": "S1", "vence": D(10, 23), "hasta": None},    # todavía en plazo
        {"operador_id": "c", "supervisor_id": "S2", "vence": D(10, 10), "hasta": None},    # de otro supervisor
    ]
    cob, foco, seg, tickets = gestion_supervisor(
        "S1", ws=SCORING_DEFECTO["supervisor"], equipo=["a", "b", "c", "d"], coachings=coachings, alertas=alertas,
        hoy=D(10, 20), primero=D(10, 1), ultimo=D(10, 31))
    assert cob["rel"] == 0.75 and cob["detalle"] == "3 de 4 asesores con coaching en el mes"
    assert foco["rel"] == 0.5 and foco["detalle"] == "1 de 2 alertas de uso con coaching en 5 días hábiles · 1 en plazo"
    assert round(seg["rel"], 3) == 0.333 and seg["detalle"] == "1 de 3 seguimientos a tiempo · 1 por venir"
    assert tickets["pendiente"] and tickets["rel"] is None
    # Sin casos, foco y seguimientos no se evalúan (su peso se reparte).
    _, foco, seg, _ = gestion_supervisor("S9", ws=SCORING_DEFECTO["supervisor"], equipo=[], coachings=[], alertas=[],
                                         hoy=D(10, 20), primero=D(10, 1), ultimo=D(10, 31))
    assert foco["rel"] is None and foco["detalle"] == "Sin alertas de uso vencidas" and seg["rel"] is None


def _calcular(coaching):
    p = {**PARAMETROS_DEFECTO, "feriados": []}
    corte_vn = D(10, 8)
    cal = calendario("2026-10", corte_vn, PESOS, [])
    lineas = lineas_netas({"detalle_netas": [{"sds_number": str(i), "vendedor": "ANA A", "producto": "Pospago",
                                              "fecha_venta": "2026-10-02", "fecha_activacion": "2026-10-03", "consumo": "SI"}
                                             for i in range(8)]}, "2026-10", corte_vn)
    tramos = {"a": [(D(10, 1), "S1")], "b": [(D(10, 1), "S1")]}
    atrib = atribuir(lineas, {"ANA A": "a"}, tramos, p)
    prod = {"A, ANA": [(D(10, d), 8 * H, 3 * H) for d in (1, 2, 5, 6, 7, 8)]}
    return calcular(primero=D(10, 1), ultimo=D(10, 31), corte=corte_vn, cal=cal, p=p, sc=dict(SCORING_DEFECTO),
                    pp={"rojo": 25.0, "meta_min": 37.0, "meta_max": 47.0}, agentes={"a": "A, ANA"},
                    vendedores={"a": "ANA A"}, tramos=tramos, ref=D(10, 20), atrib=atrib, objetivos={"S1": (30, None)},
                    prod=prod, supervisores=["S1"], coaching=coaching)["supervisores"]["S1"]


def test_la_gestion_suma_al_puntaje_del_supervisor_desde_que_se_registra():
    # Antes del día en que empezó el registro de coaching, la gestión queda pendiente y vale el resultado.
    antes = _calcular({"inicio": D(11, 1), "hoy": D(10, 20), "coachings": [], "alertas": []})
    assert antes["total"] == antes["resultado"]
    assert {p["clave"]: p.get("detalle") for p in antes["partes"][1:]} == {
        "cobertura": "Se mide desde el 01/11/2026", "foco": "Se mide desde el 01/11/2026",
        "seguimiento": "Se mide desde el 01/11/2026", "tickets": "Se mide desde el 01/11/2026"}
    # Con el registro: 1 de 2 asesores con coaching (7,5 de 15); foco y seguimientos sin casos no se evalúan.
    con = _calcular({"inicio": D(10, 1), "hoy": D(10, 20), "alertas": [],
                     "coachings": [_c("a", "S1", "conversacion", D(10, 6), D(10, 25))]})
    assert con["resultado"] == antes["resultado"]
    assert con["total"] == round((con["resultado"] / 100 * 60 + 0.5 * 15) / 75 * 100, 1)


# ============================ impacto medido ============================
def _prod(dias, pct, horas=6):
    return [(d, horas * H, int(horas * H * pct / 100)) for d in dias]


def test_impacto_de_conversacion_5_dias_antes_y_despues():
    antes = [D(10, d) for d in (5, 6, 7, 8, 9)]
    despues = [D(10, d) for d in (13, 14, 15)]
    r = impacto_conversacion(_prod(antes, 25) + _prod(despues, 33), D(10, 12), D(10, 19))
    assert r["antes"]["valor"] == 25.0 and r["despues"]["valor"] == 33.0 and r["despues"]["dias"] == 3
    assert r["delta"] == 8.0 and r["resultado"] == "mejoro" and r["completo"] is False
    r = impacto_conversacion(_prod(antes, 25) + _prod(despues, 26), D(10, 12), D(10, 19))
    assert r["resultado"] == "igual"                                    # ± 2 puntos: igual
    r = impacto_conversacion(_prod(antes, 25) + _prod([D(10, 13)], 30, horas=2), D(10, 12), D(10, 19))
    assert r["resultado"] == "sin_datos"                                # menos de 4 h después


def test_impacto_de_ventas_solo_con_netas_maduras():
    dias_a = [D(10, d) for d in (5, 6, 7, 8, 9)]
    dias_d = [D(10, d) for d in (13, 14, 15, 16, 19)]
    prod = _prod(dias_a + dias_d, 30, horas=8)
    netas = {**{d: 1 for d in dias_a}, **{d: 2 for d in dias_d}}
    r = impacto_ventas("pospago", prod, netas, D(10, 12), D(10, 30), D(10, 26))
    assert r["antes"]["netas"] == 5 and r["despues"]["netas"] == 10 and r["delta"] == 100.0
    assert r["resultado"] == "mejoro" and r["completo"] is True
    # Con las activaciones maduras solo hasta el 14/10, el después tiene 2 días.
    r = impacto_ventas("pospago", prod, netas, D(10, 12), D(10, 30), D(10, 14))
    assert r["despues"]["dias"] == 2 and r["completo"] is False
    # Sin informes de ventas, no hay medición.
    assert impacto_ventas("gpon", prod, {}, D(10, 12), D(10, 30), None)["resultado"] == "sin_datos"


def test_impacto_de_uso_con_la_misma_antiguedad():
    # Foto al registrar: 4 líneas de 3 a 6 días (3 sin uso) y 2 viejas de 10 y 12 días (con uso).
    antes = histograma([(6, True), (5, True), (4, False), (3, True), (10, False), (12, False)])
    assert antes == {"3": [1, 1], "4": [1, 0], "5": [1, 1], "6": [1, 1], "10": [1, 0], "12": [1, 0]}
    despues = histograma([(5, False), (4, False), (3, False), (1, True)])   # la de 1 día está en espera: no cuenta
    # Las vendidas después llegan a 6 días: se comparan solo las de 3 a 6 días de las dos fotos.
    r = impacto_uso(antes, despues, 6, "2026-10-11", "2026-10-19")
    assert r["edades"] == [3, 6] and r["antes"]["valor"] == 75.0 and r["despues"]["valor"] == 0.0
    assert r["delta"] == -75.0 and r["resultado"] == "mejoro" and r["completo"] is False
    assert impacto_uso(antes, {}, 2, None, None)["resultado"] == "sin_datos"
    assert impacto_uso(None, despues, 6, None, None)["resultado"] == "sin_datos"


# ============================ API: el portal registra, los jefes miran ============================
def setup_module(module):
    from app.main import _seed_profiles

    async def _prep():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await _seed_profiles()
    asyncio.run(_prep())


async def _login(ac, email, pwd="Clave1234!"):
    r = await ac.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _new_user(ac, admin, role, nombre=None):
    email = f"{role}-{uuid.uuid4().hex[:6]}@voicenter.com.py"
    r = await ac.post("/api/v1/users", headers=admin, json={
        "email": email, "password": "Clave1234!", "full_name": nombre or f"Usuario {role}", "role": role, "operativas": [TC]})
    assert r.status_code == 201, r.text
    return r.json()["id"], await _login(ac, email)


async def _guardar(*objs):
    async with AsyncSessionLocal() as db:
        db.add_all(objs)
        await db.commit()


def _neta(vendedor, venta, activacion, corte_vn, consumo="SI"):
    dias = (corte_vn - activacion).days
    return {"sds_number": uuid.uuid4().hex[:10], "linea": "0981" + uuid.uuid4().hex[:6], "vendedor": vendedor,
            "subcanal": "TKM", "producto": "Pospago", "plan": "Plan X", "fecha_venta": venta.isoformat(),
            "fecha_carga": venta.isoformat(), "fecha_activacion": activacion.isoformat(), "consumo": consumo,
            "en_espera": consumo != "SI" and dias < 3, "dias": dias}


ANA, ROB = "ANA MARIA PEREZ GOMEZ", "ROBERTO CARLOS RIVEROS MORA"


def _ventas(corte_vn, rob_viejas, rob_nuevas):
    """Ana: 5 Pospago con uso. Riveros: las de antes del coaching (con su consumo) y las de después."""
    lineas = [_neta(ANA, D(10, d), D(10, d + 1), corte_vn) for d in (1, 2, 5, 6, 7)]
    lineas += [_neta(ROB, venta, venta + timedelta(days=1), corte_vn, consumo) for venta, consumo in rob_viejas]
    lineas += [_neta(ROB, venta, venta + timedelta(days=1), corte_vn, consumo) for venta, consumo in rob_nuevas]
    return {"detalle_netas": lineas, "productividad": {"detalle_cargas": []}}


def _informe_prod(d, pct_ana, pct_rob=30):
    filas = [fila("PEREZ, ANA", 6 * H, int(6 * H * pct_ana / 100), 200, 120, acw=900),
             fila("Riveros, Roberto Carlos", 6 * H, int(6 * H * pct_rob / 100), 200, 120, acw=900)]
    return ProdInforme(fecha=d, status="published", data=analizar_dia(d, [corte(d, 18, reporte(filas))], dict(PROD_PARAMETROS)))


@pytest.mark.asyncio
async def test_flujo_coaching_seguimiento_bitacora_y_gestion(monkeypatch):
    reloj = {"hoy": D(10, 12), "ahora": datetime(2026, 10, 12, 15, 0, tzinfo=timezone.utc)}
    monkeypatch.setattr(sup_api, "hoy", lambda: reloj["hoy"])
    monkeypatch.setattr(coaching_srv, "ahora", lambda: reloj["ahora"])

    # Productividad: Ana con 25% de conversación del 5 al 9/10 y 35% después del coaching.
    await _guardar(*(_informe_prod(D(10, d), 25) for d in (5, 6, 7, 8, 9)))
    # Ventas al 11/10: Riveros con 3 sin uso de 6 (en alerta); las de 3 a 6 días: 3 sin uso de 4.
    viejas = [(D(9, 30), "SI"), (D(10, 1), "SI"), (D(10, 4), "NO"), (D(10, 5), "NO"), (D(10, 6), "SI"), (D(10, 7), "NO")]
    v1 = VentasNetasReport(upload_id="u1", periodo="2026-10", period_month=D(10, 1), fecha_dato=D(10, 11), status="published",
                           generated_at=datetime(2026, 10, 11, 14, tzinfo=timezone.utc), data=_ventas(D(10, 11), viejas, []))
    await _guardar(v1)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        _, coord = await _new_user(ac, admin, "coordinador")
        _, auditor = await _new_user(ac, admin, "auditor")
        s1, sup1 = await _new_user(ac, admin, "supervisor", "Silvia Uno")
        s2, sup2 = await _new_user(ac, admin, "supervisor", "Sergio Dos")
        ops = {o["nombre"]: o["id"] for o in (await ac.get(f"{BASE}/operadores", headers=coord, params={"periodo": "2026-10"})).json()["items"]}
        ana, rob = ops["Perez, Ana"], ops["Riveros, Roberto Carlos"]
        r = await ac.post(f"{BASE}/equipos/asignar", headers=coord, json={"periodo": "2026-10", "operador_ids": [ana, rob], "supervisor_id": s1})
        assert r.status_code == 200, r.text

        # Portal: equipo sin coaching y la alerta de uso de Riveros, con 5 días hábiles desde que apareció (11/10).
        v = (await ac.get(f"{BASE}/portal/coaching", headers=sup1)).json()
        assert [(e["nombre"], e["coachings"]) for e in v["equipo"]] == [("Riveros, Roberto Carlos", 0), ("Perez, Ana", 0)]
        assert [(a["operador"], a["desde"], a["vence"], a["estado"]) for a in v["alertas"]] == [
            ("Riveros, Roberto Carlos", "2026-10-11", "2026-10-16", "en_plazo")]
        assert v["puede_registrar"] and v["items"] == [] and v["reglas"]["horas_edicion"] == 24
        # El portal resume lo que hay que atender hoy.
        assert (await ac.get(f"{BASE}/portal", headers=sup1)).json()["coaching"] == {
            "seguimientos_vencidos": 0, "seguimientos_hoy": 0, "alertas_vencidas": 0, "alertas_en_plazo": 1, "sin_coaching": 2,
            "tickets_nuevos": 0, "tickets_por_vencer": 0, "tickets_vencidos": 0}

        nuevo = {"operador_id": rob, "fecha": "2026-10-12", "tipo": "semanal", "metrica": "uso",
                 "diagnostico": "Vende líneas a clientes que no las usan: no confirma el uso.",
                 "compromiso": "Confirmar en cada venta que el cliente va a usar la línea.", "seguimiento_fecha": "2026-10-26"}
        # Solo el supervisor del asesor ese día, con fechas y textos válidos; los jefes no registran.
        assert (await ac.post(f"{BASE}/portal/coaching", headers=coord, json=nuevo)).status_code == 403
        assert (await ac.post(f"{BASE}/portal/coaching", headers=sup2, json=nuevo)).status_code == 400
        for malo in ({"fecha": "2026-10-13"}, {"seguimiento_fecha": "2026-10-11"}, {"diagnostico": "corto"},
                     {"metrica": "ventas"}):
            assert (await ac.post(f"{BASE}/portal/coaching", headers=sup1, json={**nuevo, **malo})).status_code in (400, 422)
        r = await ac.post(f"{BASE}/portal/coaching", headers=sup1, json=nuevo)
        assert r.status_code == 201, r.text
        c_uso = r.json()
        assert c_uso["estado"] == "abierto" and not c_uso["fuera_de_termino"] and c_uso["editable"]
        assert c_uso["base"]["score"] is not None and [e["tipo"] for e in c_uso["eventos"]] == ["creado"]
        # Conversación de Ana, del viernes 9: con más de 48 h, cuenta pero queda fuera de término.
        r = await ac.post(f"{BASE}/portal/coaching", headers=sup1, json={
            **nuevo, "operador_id": ana, "fecha": "2026-10-09", "tipo": "diario", "metrica": "conversacion",
            "diagnostico": "Corta las llamadas antes de presentar la oferta.", "compromiso": "Presentar la oferta completa.",
            "seguimiento_fecha": "2026-10-19"})
        assert r.status_code == 201 and r.json()["fuera_de_termino"]
        c_conv = r.json()
        # Uno cargado por error se anula (dentro de las 24 h): queda tachado y no suma.
        r = await ac.post(f"{BASE}/portal/coaching", headers=sup1, json={**nuevo, "metrica": "otra"})
        c_error = r.json()
        assert (await ac.post(f"{BASE}/portal/coaching/{c_error['id']}/anular", headers=sup1, json={"motivo": "Cargado dos veces"})).json()["estado"] == "anulado"

        # Edición: libre durante 24 h (queda en el historial); después, solo aclaraciones.
        r = await ac.patch(f"{BASE}/portal/coaching/{c_uso['id']}", headers=sup1, json={"compromiso": "Confirmar el uso en cada venta y avisar dudas."})
        assert r.status_code == 200 and [e["tipo"] for e in r.json()["eventos"]] == ["creado", "editado"]
        assert r.json()["eventos"][1]["datos"]["antes"]["compromiso"].startswith("Confirmar en cada venta")
        reloj["ahora"] += timedelta(hours=25)
        assert (await ac.patch(f"{BASE}/portal/coaching/{c_uso['id']}", headers=sup1, json={"tipo": "diario"})).status_code == 409
        assert (await ac.post(f"{BASE}/portal/coaching/{c_uso['id']}/anular", headers=sup1, json={"motivo": "Tarde"})).status_code == 409
        r = await ac.post(f"{BASE}/portal/coaching/{c_uso['id']}/aclaracion", headers=sup1, json={"texto": "Se revisaron las 3 líneas."})
        assert r.status_code == 200 and r.json()["eventos"][-1]["tipo"] == "aclaracion" and not r.json()["editable"]
        # Otro supervisor no ve ni toca los coachings de Silvia.
        assert (await ac.get(f"{BASE}/portal/coaching/{c_uso['id']}", headers=sup2)).status_code == 404
        assert (await ac.post(f"{BASE}/portal/coaching/{c_uso['id']}/aclaracion", headers=sup2, json={"texto": "Hola hola"})).status_code == 404

        # Bitácora: notas del supervisor (con un asesor de su equipo, opcional).
        assert (await ac.post(f"{BASE}/portal/bitacora", headers=sup1, json={
            "fecha": "2026-10-12", "tipo": "ausencia", "texto": "Ana llegó tarde por paro de transporte.", "operador_id": ana})).status_code == 201
        assert (await ac.post(f"{BASE}/portal/bitacora", headers=sup2, json={
            "fecha": "2026-10-12", "tipo": "novedad", "texto": "Prueba de nota ajena", "operador_id": ana})).status_code == 400

        # Pasan los días: Productividad de después del coaching y un informe de ventas nuevo (al 19/10).
        await _guardar(*(_informe_prod(D(10, d), 35) for d in (14, 15, 16, 19)))
        nuevas = [(D(10, 13), "SI"), (D(10, 14), "SI"), (D(10, 15), "SI")]
        viejas_19 = [(venta, "SI") for venta, _ in viejas]   # además, las de antes empezaron a usarse
        v2 = VentasNetasReport(upload_id="u2", periodo="2026-10", period_month=D(10, 1), fecha_dato=D(10, 19), status="published",
                               generated_at=datetime(2026, 10, 19, 14, tzinfo=timezone.utc), data=_ventas(D(10, 19), viejas_19, nuevas))
        async with AsyncSessionLocal() as db:
            (await db.get(VentasNetasReport, v1.id)).status = "replaced"
            db.add(v2)
            await db.commit()
        reloj["hoy"], reloj["ahora"] = D(10, 20), datetime(2026, 10, 20, 15, 0, tzinfo=timezone.utc)

        v = (await ac.get(f"{BASE}/portal/coaching", headers=sup1)).json()
        items = {c["id"]: c for c in v["items"]}
        # Impacto en vivo: uso de las vendidas después (0% sin uso) contra las de antes con la misma antigüedad (75%).
        imp = items[c_uso["id"]]["impacto"]
        assert imp["metrica"] == "uso" and imp["edades"] == [3, 6] and imp["antes"]["valor"] == 75.0
        assert imp["despues"]["valor"] == 0.0 and imp["resultado"] == "mejoro"
        assert items[c_conv["id"]]["seguimiento"] == "hoy" and items[c_error["id"]]["estado"] == "anulado"
        # La alerta se fue con el informe nuevo; tuvo su coaching a tiempo.
        assert [(a["estado"], a["hasta"]) for a in v["alertas"]] == [("cubierta", "2026-10-19")]

        # Seguimiento de la conversación de Ana (acordado para el 19, registrado el 20: a tiempo).
        assert (await ac.post(f"{BASE}/portal/coaching/{c_conv['id']}/seguimiento", headers=sup1, json={"comentario": "ok"})).status_code == 400
        r = await ac.post(f"{BASE}/portal/coaching/{c_conv['id']}/seguimiento", headers=sup1,
                          json={"comentario": "Ya presenta la oferta completa; mejoró la conversación."})
        assert r.status_code == 200, r.text
        cerrado = r.json()
        assert cerrado["estado"] == "cerrado" and cerrado["seguimiento"] == "a_tiempo" and cerrado["resultado"] == "mejoro"
        assert cerrado["impacto"]["antes"]["valor"] == 25.0 and cerrado["impacto"]["despues"]["valor"] == 35.0
        assert (await ac.post(f"{BASE}/portal/coaching/{c_conv['id']}/seguimiento", headers=sup1,
                              json={"comentario": "Otra vez el seguimiento"})).status_code == 409

        # Gestión en el scoring: 2 de 2 con coaching, la alerta cubierta y el seguimiento a tiempo.
        v = (await ac.get(f"{BASE}/portal/coaching", headers=sup1)).json()
        partes = {p["clave"]: p for p in v["scoring"]["partes"]}
        assert partes["cobertura"]["rel"] == 1.0 and partes["foco"]["rel"] == 1.0 and partes["seguimiento"]["rel"] == 1.0
        assert partes["tickets"]["rel"] is None and partes["tickets"]["detalle"] == "Sin tickets en el mes"
        assert [n["tipo"] for n in v["notas"]] == ["ausencia"] and [p["id"] for p in v["pendientes"]] == [c_uso["id"]]

        # Los jefes ven lo mismo, sin poder cambiarlo; el supervisor no entra a la vista de los jefes.
        j = await ac.get(f"{BASE}/coaching", headers=auditor, params={"supervisor_id": s1})
        assert j.status_code == 200 and not j.json()["puede_registrar"] and not any(c["editable"] for c in j.json()["items"])
        assert (await ac.get(f"{BASE}/coaching", headers=sup1, params={"supervisor_id": s1})).status_code == 403
        d = (await ac.get(f"{BASE}/coaching/{c_uso['id']}", headers=coord)).json()
        assert [e["tipo"] for e in d["eventos"]] == ["creado", "editado", "aclaracion"] and d["eventos"][0]["por"] == "Silvia Uno"
        t = (await ac.get(f"{BASE}/tablero", headers=coord, params={"periodo": "2026-10"})).json()
        silvia = next(s for s in t["supervisores"] if s["id"] == s1)
        assert {p["clave"]: p["rel"] for p in silvia["partes"]}["cobertura"] == 1.0
        # Resumen de la gestión de todos los supervisores (para los jefes).
        g = await ac.get(f"{BASE}/gestion", headers=coord, params={"periodo": "2026-10"})
        assert g.status_code == 200, g.text
        g = g.json()
        silvia = next(f for f in g["supervisores"] if f["id"] == s1)
        assert silvia["coachings"] == 2 and silvia["fuera_de_termino"] == 1 and silvia["alertas"]["cubierta"] == 1
        assert silvia["seguimientos_abiertos"] == 1 and silvia["seguimientos_vencidos"] == 0 and silvia["notas"] == 1
        assert silvia["ultima_actividad"] == "2026-10-20" and silvia["dias_sin_actividad"] == 0
        assert g["operacion"]["asesores"] == 2 and g["operacion"]["con_coaching"] == 2
        assert (await ac.get(f"{BASE}/gestion", headers=sup1)).status_code == 403


@pytest.mark.asyncio
async def test_al_unir_dos_operadores_la_gestion_pasa_al_que_queda():
    """Un vendedor sin nombre de llamadas tuvo coaching, nota y alerta; al vincularlo con su agente, todo queda en uno."""
    from sqlalchemy import select

    from app.operativas.televentas_claro.supervision import operadores as maestro
    from app.operativas.televentas_claro.supervision.models import AlertaAsesor, BitacoraNota, Coaching, Operador

    async with AsyncSessionLocal() as db:
        agente = Operador(nombre="Lopez, Juan", agente_clave="LOPEZ, JUAN", agente_nombre="Lopez, Juan", cruce="sin_cruce")
        vendedor = Operador(nombre="Juan Lopez", vendedor="JUAN LOPEZ", cruce="sin_agente")
        db.add_all([agente, vendedor])
        await db.flush()
        db.add_all([
            Coaching(supervisor_id="S1", operador_id=vendedor.id, fecha=D(10, 5), tipo="semanal", metrica="uso", diagnostico="d" * 10,
                     compromiso="c" * 10, seguimiento_fecha=D(10, 12), created_by="S1"),
            BitacoraNota(supervisor_id="S1", fecha=D(10, 5), tipo="novedad", texto="Nota del asesor", operador_id=vendedor.id),
            AlertaAsesor(periodo="2026-10", operador_id=vendedor.id, desde=D(10, 3)),
        ])
        await db.commit()
        await maestro.vincular(db, agente, vendedor, "admin")
        await db.commit()
        quedan = (await db.execute(select(Operador).where(Operador.id.in_([agente.id, vendedor.id])))).scalars().all()
        assert [o.id for o in quedan] == [agente.id] and quedan[0].vendedor == "JUAN LOPEZ"
        for modelo in (Coaching, BitacoraNota, AlertaAsesor):
            filas = (await db.execute(select(modelo).where(modelo.operador_id.in_([agente.id, vendedor.id])))).scalars().all()
            assert len(filas) == 1 and filas[0].operador_id == agente.id

