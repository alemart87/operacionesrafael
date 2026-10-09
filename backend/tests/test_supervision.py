"""Supervisión (Televentas CLARO): maestro de operadores, equipos del mes con fecha efectiva, objetivos por
supervisor, avance y proyección al cierre, asesores en alerta por líneas sin uso y portal del supervisor."""
from __future__ import annotations

import asyncio
import uuid
from datetime import date

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import AsyncSessionLocal, Base, engine
from app.main import app
from app.operativas.televentas_claro.productividad.analyzer import PARAMETROS_DEFECTO as PROD_PARAMETROS
from app.operativas.televentas_claro.productividad.analyzer import analizar_dia
from app.operativas.televentas_claro.productividad.models import ProdInforme
from app.operativas.televentas_claro.supervision import api as sup_api
from app.operativas.televentas_claro.supervision.calculo import (
    PARAMETROS_DEFECTO, atribuir, calendario, lineas_netas, proyeccion, supervisor_en, uso,
)
from app.operativas.televentas_claro.ventas_netas.models import VentasNetasReport
from tests.test_productividad import corte, fila, reporte

BASE = "/api/v1/televentas-claro/supervision"
TC = "televentas_claro"
H = 3600
P = dict(PARAMETROS_DEFECTO)
PESOS = P["pesos_dia"]


# ============================ días hábiles y proyección ============================
def test_calendario_de_octubre_con_sabado_medio_dia():
    cal = calendario("2026-10", date(2026, 10, 8), PESOS, [])
    # 22 días de lunes a viernes + 5 sábados a 0,5; al 8/10: 6 de semana + el sábado 3.
    assert cal == {"total": 24.5, "transcurridos": 6.5, "restantes": 18.0, "corte": "2026-10-08", "cerrado": False}
    # Un feriado no cuenta, y un corte posterior al mes lo cierra.
    assert calendario("2026-10", date(2026, 10, 8), PESOS, ["2026-10-05"])["transcurridos"] == 5.5
    assert calendario("2026-09", date(2026, 10, 2), PESOS, [])["cerrado"] is True


def test_proyeccion_ritmo_y_semaforo():
    cal = calendario("2026-10", date(2026, 10, 8), PESOS, [])
    r = proyeccion(30, 120, cal, P)
    # El ejemplo de la guía: 30 de 120 al 8/10 → cierra en 113 (94%), en riesgo; faltan 90 en 18 días hábiles.
    assert r["proyeccion"] == 113.1 and r["pct_proyeccion"] == 94.2 and r["estado"] == "en_riesgo"
    assert r["faltan"] == 90 and r["ritmo_necesario"] == 5.0 and r["pct_logro"] == 25.0 and r["esperado_al_corte"] == 31.8
    assert r["provisoria"] is False
    assert proyeccion(40, 120, cal, P)["estado"] == "en_camino"
    assert proyeccion(20, 120, cal, P)["estado"] == "bajo_objetivo"
    assert proyeccion(20, None, cal, P)["estado"] == "sin_objetivo"
    assert proyeccion(None, 120, calendario("2026-10", None, PESOS, []), P)["estado"] == "sin_datos"
    # Con pocos días transcurridos la proyección es provisoria; con el mes cerrado, es lo vendido.
    assert proyeccion(5, 120, calendario("2026-10", date(2026, 10, 2), PESOS, []), P)["provisoria"] is True
    cerrado = proyeccion(118, 120, calendario("2026-09", date(2026, 10, 1), PESOS, []), P)
    assert cerrado["proyeccion"] == 118.0 and cerrado["ritmo_necesario"] is None and cerrado["estado"] == "en_riesgo"
    assert proyeccion(130, 120, cal, P)["ritmo_necesario"] == 0.0


def test_uso_alerta_y_lineas_a_recuperar():
    assert uso(15, 3, 0, P) == {"evaluables": 15, "sin_uso": 3, "en_espera": 0, "pct_sin_uso": 20.0,
                                "alerta": True, "a_recuperar": 2}
    assert uso(10, 1, 2, P)["alerta"] is False          # 10% justo: no supera el umbral
    assert uso(4, 2, 0, P)["alerta"] is False           # menos de 5 evaluables: no se evalúa
    assert uso(0, 0, 3, P)["pct_sin_uso"] is None


# ============================ atribución por supervisor ============================
def neta(vendedor, fecha_venta, producto="Pospago", consumo="SI", en_espera=False, legajo=None):
    return {"sds_number": uuid.uuid4().hex[:10], "linea": "0981" + uuid.uuid4().hex[:6], "vendedor": vendedor, "legajo": legajo,
            "subcanal": "TKM", "producto": producto, "plan": "Plan X", "fecha_venta": fecha_venta, "fecha_carga": fecha_venta,
            "fecha_activacion": "2026-10-06", "consumo": consumo if producto == "Pospago" else None, "en_espera": en_espera,
            "dias": 3}


def test_cada_neta_cuenta_para_el_supervisor_del_dia_de_la_venta():
    data = {"detalle_netas": [
        neta("ANA PEREZ", "2026-09-29"),                      # vendida en septiembre: cuenta desde el día 1
        neta("ANA PEREZ", "2026-10-05"),
        neta("ANA PEREZ", "2026-10-12", "GPON"),              # ya en el equipo de S2
        neta("ANA PEREZ", "2026-10-13", consumo="NO"),
        neta("ANA PEREZ", "2026-10-14", consumo="NO", en_espera=True),
        neta("SIN VENDEDOR", "2026-10-05"),
    ]}
    lineas = lineas_netas(data, "2026-10", date(2026, 10, 15))
    assert lineas[0]["fecha"] == date(2026, 10, 1)
    tramos = {"op1": [(date(2026, 10, 1), "S1"), (date(2026, 10, 10), "S2")]}
    assert supervisor_en(tramos["op1"], date(2026, 10, 9)) == "S1" and supervisor_en(tramos["op1"], date(2026, 10, 10)) == "S2"
    r = atribuir(lineas, {"ANA PEREZ": "op1"}, tramos, P)
    assert r["supervisores"]["S1"] == {"pospago": 2, "gpon": 0, "asesores": {"op1": {"pospago": 2, "gpon": 0}}}
    assert r["supervisores"]["S2"]["pospago"] == 2 and r["supervisores"]["S2"]["gpon"] == 1
    assert r["operadores"]["op1"]["evaluables"] == 3 and r["operadores"]["op1"]["sin_uso"] == 1 and r["operadores"]["op1"]["en_espera"] == 1
    assert r["sin_operador"] == {"SIN VENDEDOR": {"pospago": 1, "gpon": 0}}
    assert r["total"] == {"netas": 6, "pospago": 5, "gpon": 1}


# ============================ API ============================
OCT = date(2026, 10, 6)
AGENTES = [
    fila("PEREZ, ANA", 6 * H, 8000, 200, 120, acw=900),
    fila("Riveros, Roberto Carlos", 8 * H, 9000, 260, 150, acw=1000),
    fila("Benitez, Rosa", 6 * H, 7000, 210, 120, acw=900),       # no figura como vendedora: se vincula a mano
    fila("Vera, Carla", 5 * H, 6000, 150, 90, acw=800),
]
VENTAS = {
    "detalle_netas": [
        *[neta("ANA MARIA PEREZ GOMEZ", "2026-10-02", legajo="L1") for _ in range(4)],   # carga ella misma
        neta("ANA MARIA PEREZ GOMEZ", "2026-10-05", "GPON"),
        *[neta("ROBERTO CARLOS RIVEROS MORA", "2026-10-05", consumo="NO") for _ in range(2)],
        *[neta("ROBERTO CARLOS RIVEROS MORA", "2026-10-05") for _ in range(3)],
        neta("ROBERTO CARLOS RIVEROS MORA", "2026-10-07"),
        *[neta("DOLLY GONZALEZ", "2026-10-06", legajo="BO9") for _ in range(2)],         # legajo de backoffice:
        neta("CARLA VERA", "2026-10-07", "GPON", legajo="BO9"),                          # carga para varias
        neta("CARLA VERA", "2026-10-08"),
        neta("SIN VENDEDOR", "2026-10-03"),
    ],
    "productividad": {"detalle_cargas": []},
}


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


async def _guardar(obj):
    async with AsyncSessionLocal() as db:
        db.add(obj)
        await db.commit()
        return obj.id


@pytest.mark.asyncio
async def test_flujo_equipos_objetivos_proyeccion_y_portal(monkeypatch):
    monkeypatch.setattr(sup_api, "hoy", lambda: date(2026, 10, 20))
    await _guardar(ProdInforme(fecha=OCT, status="published",
                               data=analizar_dia(OCT, [corte(OCT, 18, reporte(AGENTES))], dict(PROD_PARAMETROS))))
    await _guardar(VentasNetasReport(upload_id="u1", periodo="2026-10", period_month=date(2026, 10, 1),
                                     fecha_dato=date(2026, 10, 8), status="published", data=VENTAS))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        _, coord = await _new_user(ac, admin, "coordinador")
        _, analista = await _new_user(ac, admin, "analista")
        _, auditor = await _new_user(ac, admin, "auditor")
        s1, sup1 = await _new_user(ac, admin, "supervisor", "Silvia Uno")
        s2, sup2 = await _new_user(ac, admin, "supervisor", "Sergio Dos")

        # Detección: los agentes y los vendedores del mes entran al maestro y se cruzan por nombre.
        r = await ac.get(f"{BASE}/operadores", headers=analista, params={"periodo": "2026-10"})
        assert r.status_code == 200, r.text
        body = r.json()
        ops = {o["nombre"]: o for o in body["items"]}
        assert body["deteccion"]["agentes"] == 4 and body["deteccion"]["vendedores"] == 4
        assert ops["Perez, Ana"]["vendedor"] == "ANA MARIA PEREZ GOMEZ" and ops["Perez, Ana"]["cruce"] == "exacto"
        assert ops["Vera, Carla"]["cruce"] == "exacto"
        assert ops["Benitez, Rosa"]["cruce"] == "sin_cruce" and ops["Dolly Gonzalez"]["cruce"] == "sin_agente"
        assert body["resumen"]["vinculados"] == 3 and body["resumen"]["por_revisar"] == 2
        # El legajo de quien cargó solo identifica al vendedor si carga únicamente para él.
        assert ops["Perez, Ana"]["legajo"] == "L1" and ops["Dolly Gonzalez"]["legajo"] is None and ops["Vera, Carla"]["legajo"] is None
        assert (await ac.get(f"{BASE}/operadores", headers=sup1)).status_code == 403

        # Vincular a mano: Benítez es Dolly González (y queda en el SPH también).
        assert (await ac.post(f"{BASE}/operadores/{ops['Benitez, Rosa']['id']}/vincular", headers=coord,
                              json={"con": ops["Dolly Gonzalez"]["id"]})).status_code == 200  # el coordinador también vincula
        ops = {o["nombre"]: o for o in (await ac.get(f"{BASE}/operadores", headers=analista, params={"periodo": "2026-10"})).json()["items"]}
        assert ops["Benitez, Rosa"]["vendedor"] == "DOLLY GONZALEZ" and ops["Benitez, Rosa"]["cruce"] == "manual"
        assert "Dolly Gonzalez" not in ops
        v = (await ac.get("/api/v1/televentas-claro/sph/vinculos", headers=analista)).json()["items"]
        assert [(x["clave"], x["vendedor"]) for x in v] == [("BENITEZ, ROSA", "DOLLY GONZALEZ")]

        # Equipos: Pérez y Riveros con Silvia; Benítez con Sergio; Riveros pasa a Sergio el 10/10.
        ana, rob, ben, car = (ops[n]["id"] for n in ("Perez, Ana", "Riveros, Roberto Carlos", "Benitez, Rosa", "Vera, Carla"))
        asignar = lambda h, ids, sid, desde=None: ac.post(f"{BASE}/equipos/asignar", headers=h, json={  # noqa: E731
            "periodo": "2026-10", "operador_ids": ids, "supervisor_id": sid, "desde": desde})
        assert (await asignar(analista, [ana], s1)).status_code == 403   # el analista vincula, pero no arma equipos
        assert (await asignar(coord, [ana, rob], s1)).status_code == 200
        assert (await asignar(coord, [ben], s2)).status_code == 200
        assert (await asignar(coord, [rob], s2, "2026-10-10")).status_code == 200
        assert (await asignar(coord, [rob], s2, "2026-11-01")).status_code == 400
        assert (await asignar(coord, [ana], "no-existe")).status_code == 400
        eq = (await ac.get(f"{BASE}/equipos", headers=coord, params={"periodo": "2026-10"})).json()
        equipos = {s["nombre"]: [a["nombre"] for a in s["asesores"]] for s in eq["supervisores"]}
        assert equipos == {"Sergio Dos": ["Benitez, Rosa", "Riveros, Roberto Carlos"], "Silvia Uno": ["Perez, Ana"]}
        assert [a["nombre"] for a in eq["sin_supervisor"]] == ["Vera, Carla"]
        rob_eq = next(a for a in eq["supervisores"] if a["nombre"] == "Sergio Dos")["asesores"][1]
        assert [(t["desde"], t["supervisor"]) for t in rob_eq["tramos"]] == [("2026-10-01", "Silvia Uno"), ("2026-10-10", "Sergio Dos")]

        # Objetivos: solo los jefes.
        obj = {"periodo": "2026-10", "supervisor_id": s1, "pospago": 12, "gpon": 2}
        assert (await ac.put(f"{BASE}/objetivos", headers=auditor, json=obj)).status_code == 403
        assert (await ac.put(f"{BASE}/objetivos", headers=sup1, json=obj)).status_code == 403
        assert (await ac.put(f"{BASE}/objetivos", headers=coord, json=obj)).status_code == 200
        assert (await ac.put(f"{BASE}/objetivos", headers=coord, json={**obj, "supervisor_id": s2, "pospago": 10, "gpon": None})).status_code == 200
        assert (await ac.put(f"{BASE}/objetivos", headers=coord, json={**obj, "pospago": -1})).status_code == 422

        # Resumen: lo vendido se reparte por el día de la venta; Riveros vendió todo con Silvia (antes del 10/10).
        r = (await ac.get(f"{BASE}/resumen", headers=auditor, params={"periodo": "2026-10"})).json()
        assert r["ventas"]["fecha_dato"] == "2026-10-08" and r["calendario"]["transcurridos"] == 6.5
        sups = {s["nombre"]: s for s in r["supervisores"]}
        silvia, sergio = sups["Silvia Uno"], sups["Sergio Dos"]
        assert silvia["pospago"]["vendido"] == 10 and silvia["gpon"]["vendido"] == 1     # 4 Pérez + 6 Riveros
        assert silvia["pospago"]["proyeccion"] == 37.7 and silvia["pospago"]["estado"] == "en_camino"
        assert sergio["pospago"]["vendido"] == 2 and sergio["gpon"]["estado"] == "sin_objetivo"
        # Riveros: 2 sin uso de 6 evaluables (33%): en alerta, y su supervisor actual (Sergio) queda crítico.
        assert sergio["critico"] and sergio["asesores_en_alerta"] == 1 and sergio["a_recuperar"] == 2
        assert not silvia["critico"] and silvia["asesores"] == 1
        op = r["operacion"]
        assert op["pospago"]["vendido"] == 14 and op["pospago"]["objetivo"] == 22 and op["supervisores_criticos"] == 1
        assert r["sin_supervisor"]["pospago"] == 2   # Vera (sin equipo) + SIN VENDEDOR
        assert (await ac.get(f"{BASE}/resumen", headers=sup1)).status_code == 403

        # Portal: cada supervisor ve solo lo suyo.
        p1 = (await ac.get(f"{BASE}/portal", headers=sup1, params={"periodo": "2026-10"})).json()
        assert p1["supervisor"]["nombre"] == "Silvia Uno" and p1["objetivo"]["pospago"] == 12
        assert [(a["nombre"], a["actual"], a["pospago"]) for a in p1["asesores"]] == [
            ("Perez, Ana", True, 4), ("Riveros, Roberto Carlos", False, 6)]
        assert p1["asesores"][1]["hasta"] == "2026-10-09"
        p2 = (await ac.get(f"{BASE}/portal", headers=sup2, params={"periodo": "2026-10"})).json()
        riveros = next(a for a in p2["asesores"] if a["nombre"] == "Riveros, Roberto Carlos")
        assert riveros["desde"] == "2026-10-10" and riveros["uso"]["alerta"] and p2["critico"]
        lin = await ac.get(f"{BASE}/portal/lineas", headers=sup2, params={"periodo": "2026-10", "operador_id": rob})
        assert lin.status_code == 200 and [x["estado"] for x in lin.json()["lineas"]] == ["sin_uso", "sin_uso"]
        assert (await ac.get(f"{BASE}/portal/lineas", headers=sup2, params={"periodo": "2026-10", "operador_id": ana})).status_code == 404
        assert (await ac.get(f"{BASE}/lineas", headers=sup2, params={"operador_id": rob})).status_code == 403
        assert (await ac.get(f"{BASE}/supervisores/{s2}", headers=coord, params={"periodo": "2026-10"})).json()["critico"]

        # Calendario: un día no laborable cambia los días hábiles y la proyección.
        assert (await ac.put(f"{BASE}/parametros", headers=coord, json={"pesos_dia": [1, 1, 1, 1, 1, 2, 0]})).status_code == 400
        assert (await ac.put(f"{BASE}/parametros", headers=coord, json={
            "pesos_dia": [1, 1, 1, 1, 1, 0.5, 0], "no_laborables": [{"fecha": "2026-10-05", "motivo": "Inventario"}]})).status_code == 200
        r = (await ac.get(f"{BASE}/resumen", headers=coord, params={"periodo": "2026-10"})).json()
        assert r["calendario"]["transcurridos"] == 5.5 and r["calendario"]["total"] == 23.5

        # Tablero y scoring: operación, ranking de supervisores y asesores, con el mes anterior.
        t = await ac.get(f"{BASE}/tablero", headers=auditor, params={"periodo": "2026-10"})
        assert t.status_code == 200, t.text
        t = t.json()
        assert t["scoring"]["version"] == 1 and t["scoring"]["conversacion"]["meta_min"] == 37.0
        assert t["operacion"]["total"] is not None and t["anterior"]["periodo"] == "2026-09"
        assert {s["nombre"] for s in t["supervisores"]} == {"Silvia Uno", "Sergio Dos"}
        silvia_sc = next(s for s in t["supervisores"] if s["nombre"] == "Silvia Uno")
        # La gestión ya se mide: sin coachings, la cobertura es 0 (foco y seguimientos sin casos no se evalúan).
        partes = {x["clave"]: x for x in silvia_sc["partes"]}
        assert partes["cobertura"]["rel"] == 0 and partes["cobertura"]["detalle"] == "0 de 1 asesor con coaching en el mes"
        assert partes["foco"]["rel"] is None and partes["seguimiento"]["rel"] is None and partes["tickets"]["rel"] is None
        assert silvia_sc["total"] == round(silvia_sc["resultado"] * 0.8, 1) and silvia_sc["anterior"] is None
        assert {c["clave"] for c in silvia_sc["componentes"]} == {"pospago", "uso", "conversacion", "gpon"}
        ana_sc = next(a for a in t["asesores"] if a["nombre"] == "Perez, Ana")
        assert ana_sc["supervisor"] == "Silvia Uno" and ana_sc["total"] is not None
        assert (await ac.get(f"{BASE}/tablero", headers=sup1)).status_code == 403
        p1 = (await ac.get(f"{BASE}/portal", headers=sup1, params={"periodo": "2026-10"})).json()
        assert p1["scoring"]["total"] == silvia_sc["total"] and p1["asesores"][0]["score"] is not None

        # Parámetros del scoring: los ve Supervisión; los cambia el sub gerente (o el superadmin), con versión.
        par = (await ac.get(f"{BASE}/parametros/scoring", headers=coord)).json()
        assert par["version"] == 1 and par["puede_editar"] is False and par["asesor"]["pospago"] == 35
        cuerpo = {"asesor": {"pospago": 40, "uso": 25, "conversacion": 20, "gpon": 15},
                  "supervisor": {"resultado": 60, "cobertura": 15, "foco": 10, "tickets": 10, "seguimiento": 5},
                  "uso_cero": 35, "min_horas_conversacion": 2}
        assert (await ac.put(f"{BASE}/parametros/scoring", headers=coord, json=cuerpo)).status_code == 403
        assert (await ac.put(f"{BASE}/parametros/scoring", headers=admin, json={**cuerpo, "asesor": {**cuerpo["asesor"], "gpon": 20}})).status_code == 400
        assert (await ac.put(f"{BASE}/parametros/scoring", headers=admin, json={**cuerpo, "uso_cero": 10})).status_code == 400
        r = await ac.put(f"{BASE}/parametros/scoring", headers=admin, json=cuerpo)
        assert r.status_code == 200 and r.json()["version"] == 2 and r.json()["historial"][0]["antes"]["asesor"]["pospago"] == 35
        assert (await ac.get(f"{BASE}/tablero", headers=coord, params={"periodo": "2026-10"})).json()["scoring"]["asesor"]["pospago"] == 40

        # Copiar a noviembre: con los equipos con que cerró octubre.
        c = (await ac.post(f"{BASE}/equipos/copiar", headers=coord, json={"periodo": "2026-11"})).json()
        assert c["copiados"] == 3
        nov = (await ac.get(f"{BASE}/equipos", headers=coord, params={"periodo": "2026-11"})).json()
        assert {s["nombre"]: len(s["asesores"]) for s in nov["supervisores"]} == {"Sergio Dos": 2, "Silvia Uno": 1}
        assert (await ac.post(f"{BASE}/equipos/copiar", headers=coord, json={"periodo": "2026-11"})).json()["copiados"] == 0

        # Separar un vínculo deja al agente «no vende» y al vendedor solo (los equipos quedan con el agente).
        r = await ac.post(f"{BASE}/operadores/{ben}/separar", headers=analista)
        assert r.status_code == 200 and r.json()["operador"]["cruce"] == "descartado"
        ops = {o["nombre"]: o for o in (await ac.get(f"{BASE}/operadores", headers=analista, params={"periodo": "2026-10"})).json()["items"]}
        assert ops["Dolly Gonzalez"]["cruce"] == "sin_agente" and ops["Benitez, Rosa"]["vendedor"] is None
        assert (await ac.patch(f"{BASE}/operadores/{car}", headers=analista, json={"nombre": "Carla Vera (TKM)"})).json()["operador"]["nombre"] == "Carla Vera (TKM)"
        assert (await ac.patch(f"{BASE}/operadores/{car}", headers=auditor, json={"activo": False})).status_code == 403


@pytest.mark.asyncio
async def test_migraciones_de_una_vez():
    """Los perfiles que ya existían reciben Supervisión (el supervisor queda solo con su portal) y los
    vínculos manuales del SPH pasan al maestro."""
    from sqlalchemy import select

    from app.models.profile import Profile
    from app.operativas.televentas_claro.sph.models import SphVinculo
    from app.operativas.televentas_claro.supervision import migraciones
    from app.operativas.televentas_claro.supervision.models import Operador

    viejos = {
        "coordinador": [f"{TC}.{u}" for u in ("ver", "ventas_netas", "productividad", "sph")],
        "supervisor": [f"{TC}.{u}" for u in ("ver", "ventas_netas", "productividad", "sph")],
        "cliente": [f"{TC}.ver"],
    }
    async with AsyncSessionLocal() as db:
        for slug, perms in viejos.items():
            (await db.get(Profile, slug)).permissions = perms
        db.add(SphVinculo(clave="GAMARRA, LUIS", nombre="Gamarra, Luis", vendedor="LUIS ALBERTO GAMARRA"))
        db.add(SphVinculo(clave="ORTIZ, EVA", nombre="Ortiz, Eva", vendedor=None))
        await db.commit()
        r = await migraciones.permisos_supervision(db)
        assert set(r["perfiles"]) == {"coordinador", "supervisor"}
        perfiles = {p.slug: set(p.permissions) for p in (await db.execute(select(Profile))).scalars().all()}
        assert perfiles["coordinador"] == set(viejos["coordinador"]) | {f"{TC}.supervision", f"{TC}.supervision_gestion", f"{TC}.operadores"}
        assert perfiles["supervisor"] == {f"{TC}.ver", f"{TC}.portal_supervisor"}
        assert perfiles["cliente"] == {f"{TC}.ver"}
        assert (await migraciones.vinculos_sph_al_maestro(db)) == {"importados": 2}
        ops = {o.agente_clave: o for o in (await db.execute(select(Operador))).scalars().all() if o.agente_clave}
        assert ops["GAMARRA, LUIS"].vendedor == "LUIS ALBERTO GAMARRA" and ops["GAMARRA, LUIS"].cruce == "manual"
        assert ops["ORTIZ, EVA"].cruce == "descartado"
        assert (await migraciones.vinculos_sph_al_maestro(db)) == {"importados": 0}  # no duplica
        # La gestión del supervisor se mide desde el día en que se instala el registro de coaching (una sola vez).
        r = await migraciones.inicio_gestion(db)
        assert r["gestion_desde"] and "ya_estaba" not in r
        assert (await migraciones.inicio_gestion(db)) == {"gestion_desde": r["gestion_desde"], "ya_estaba": True}
