"""Coaching con varias métricas (Pospago + GPON…), el registro por rango de fechas para los jefes y el historial del
supervisor, y los seguimientos próximos en lo que el supervisor tiene que atender."""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import AsyncSessionLocal, Base, engine
from app.main import app
from app.operativas.televentas_claro.supervision import api as sup_api
from app.operativas.televentas_claro.supervision import coaching as coaching_srv
from app.operativas.televentas_claro.supervision.coaching import ReglaInvalida, metricas_de, normalizar_metricas
from app.operativas.televentas_claro.supervision.impacto import combinar
from app.operativas.televentas_claro.supervision.migraciones import coaching_metricas
from app.operativas.televentas_claro.supervision.models import Coaching, Operador
from app.operativas.televentas_claro.supervision.scoring import SCORING_DEFECTO, gestion_supervisor

BASE = "/api/v1/televentas-claro/supervision"
TC = "televentas_claro"
D = lambda m, d: date(2026, m, d)  # noqa: E731


# ============================ reglas ============================
def test_combinar_los_resultados_de_varias_metricas():
    assert combinar(["mejoro", "igual"]) == "mejoro"
    assert combinar(["mejoro", "empeoro"]) == "mixto"            # unas mejoran y otras empeoran
    assert combinar(["igual", "empeoro", "sin_datos"]) == "empeoro"
    assert combinar(["igual", "sin_datos"]) == "igual"           # las sin datos no cuentan
    assert combinar(["sin_datos", "sin_datos"]) == "sin_datos" and combinar([]) == "sin_datos"


def test_metricas_en_orden_y_compatibles_con_los_coachings_anteriores():
    assert normalizar_metricas(["gpon", "pospago", "gpon"]) == ["pospago", "gpon"]   # sin repetir y la principal primero
    for vacia in ([], None):
        with pytest.raises(ReglaInvalida):
            normalizar_metricas(vacia)
    assert metricas_de(SimpleNamespace(metrica="uso", metricas=None)) == ["uso"]      # los de antes: solo `metrica`
    assert metricas_de(SimpleNamespace(metrica="pospago", metricas=["pospago", "gpon"])) == ["pospago", "gpon"]


def test_el_foco_se_cubre_si_uso_es_una_de_las_metricas():
    alertas = [{"operador_id": "a", "supervisor_id": "S1", "vence": D(10, 9), "hasta": None}]
    c = {"operador_id": "a", "supervisor_id": "S1", "metrica": "pospago", "metricas": ["pospago", "uso"], "fecha": D(10, 6),
         "seguimiento_fecha": D(10, 20), "seguimiento_dia": None}

    def foco(coachings):
        return gestion_supervisor("S1", ws=SCORING_DEFECTO["supervisor"], equipo=["a"], coachings=coachings, alertas=alertas,
                                  hoy=D(10, 20), primero=D(10, 1), ultimo=D(10, 31))[1]["rel"]
    assert foco([c]) == 1.0
    assert foco([{**c, "metricas": ["pospago", "gpon"]}]) == 0.0
    # Los de antes, con su única métrica (sin la lista o con la lista vacía).
    assert foco([{**c, "metrica": "uso", "metricas": None}]) == 1.0
    assert foco([{k: v for k, v in {**c, "metrica": "uso"}.items() if k != "metricas"}]) == 1.0


async def _medir_falso(self, c, op, m):
    """Uso mejora, conversación empeora y el resto sin datos (sin depender de los informes)."""
    r = {"uso": "mejoro", "conversacion": "empeoro"}.get(m, "sin_datos")
    return {"metrica": m, "resultado": r, "delta": {"mejoro": -12.5, "empeoro": -3.0}.get(r), "completo": m != "uso",
            "detalle": f"{m}: {r}"}


@pytest.mark.asyncio
async def test_el_impacto_se_mide_por_metrica_y_se_combina(monkeypatch):
    monkeypatch.setattr(coaching_srv.Medidor, "medir_metrica", _medir_falso)
    medidor = coaching_srv.Medidor(None, D(10, 20))
    imp = await medidor.medir(SimpleNamespace(metrica="uso", metricas=["uso", "conversacion"]), None)
    assert imp["resultado"] == "mixto" and imp["metrica"] == "uso" and imp["delta"] is None and imp["completo"] is False
    assert [(p["metrica"], p["resultado"]) for p in imp["metricas"]] == [("uso", "mejoro"), ("conversacion", "empeoro")]
    assert imp["detalle"] == "Uso de líneas: mejoró · Conversación: empeoró"
    # Con una sola métrica queda como antes (sus campos arriba) y además en `metricas`.
    uno = await medidor.medir(SimpleNamespace(metrica="uso", metricas=None), None)
    assert uno["resultado"] == "mejoro" and uno["delta"] == -12.5 and [p["metrica"] for p in uno["metricas"]] == ["uso"]


# ============================ API ============================
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


async def _operadores(*nombres):
    async with AsyncSessionLocal() as db:
        ops = [Operador(nombre=n, agente_clave=n.upper(), agente_nombre=n, cruce="sin_cruce") for n in nombres]
        db.add_all(ops)
        await db.commit()
        return [o.id for o in ops]


@pytest.mark.asyncio
async def test_varias_metricas_registro_por_rango_e_historial(monkeypatch):
    reloj = {"hoy": D(10, 12), "ahora": datetime(2026, 10, 12, 15, 0, tzinfo=timezone.utc)}
    monkeypatch.setattr(sup_api, "hoy", lambda: reloj["hoy"])
    monkeypatch.setattr(coaching_srv, "ahora", lambda: reloj["ahora"])
    monkeypatch.setattr(coaching_srv.Medidor, "medir_metrica", _medir_falso)
    ana, beto, caro = await _operadores("Perez, Ana", "Benitez, Beto", "Cabrera, Caro")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        _, coord = await _new_user(ac, admin, "coordinador")
        _, subg = await _new_user(ac, admin, "sub_gerente")
        s1, sup1 = await _new_user(ac, admin, "supervisor", "Silvia Uno")
        s2, sup2 = await _new_user(ac, admin, "supervisor", "Sergio Dos")
        for ids, sid in (([ana, beto], s1), ([caro], s2)):
            r = await ac.post(f"{BASE}/equipos/asignar", headers=coord, json={"periodo": "2026-10", "operador_ids": ids, "supervisor_id": sid})
            assert r.status_code == 200, r.text

        nuevo = {"operador_id": ana, "fecha": "2026-10-12", "tipo": "semanal", "diagnostico": "Ofrece Pospago y GPON sin detectar la necesidad.",
                 "compromiso": "Preguntar por el uso de internet en el hogar antes de ofrecer.", "seguimiento_fecha": "2026-10-14"}
        # Varias métricas: se guardan sin repetir, en orden, y la primera es la principal.
        r = await ac.post(f"{BASE}/portal/coaching", headers=sup1, json={**nuevo, "metricas": ["gpon", "pospago", "gpon"]})
        assert r.status_code == 201, r.text
        c1 = r.json()
        assert c1["metricas"] == ["pospago", "gpon"] and c1["metrica"] == "pospago"
        assert c1["eventos"][0]["datos"]["metricas"] == ["pospago", "gpon"]
        # El impacto en vivo trae cada métrica y el resultado de todas juntas.
        assert [p["metrica"] for p in c1["impacto"]["metricas"]] == ["pospago", "gpon"] and c1["impacto"]["resultado"] == "sin_datos"
        # Una sola métrica como antes (`metrica`) sigue andando; sin ninguna o con una que no existe, no.
        r = await ac.post(f"{BASE}/portal/coaching", headers=sup1, json={
            **nuevo, "operador_id": beto, "fecha": "2026-10-09", "tipo": "diario", "metrica": "conversacion", "seguimiento_fecha": "2026-10-20"})
        assert r.status_code == 201, r.text
        c2 = r.json()
        assert c2["metricas"] == ["conversacion"] and c2["fuera_de_termino"]
        assert (await ac.post(f"{BASE}/portal/coaching", headers=sup1, json={**nuevo, "metricas": []})).status_code == 400
        assert (await ac.post(f"{BASE}/portal/coaching", headers=sup1, json=nuevo)).status_code == 400
        assert (await ac.post(f"{BASE}/portal/coaching", headers=sup1, json={**nuevo, "metricas": ["ventas"]})).status_code == 422
        # Uno cargado por error y anulado: no suma, pero se cuenta.
        r = await ac.post(f"{BASE}/portal/coaching", headers=sup1, json={**nuevo, "metricas": ["otra"]})
        c3 = r.json()
        assert (await ac.post(f"{BASE}/portal/coaching/{c3['id']}/anular", headers=sup1, json={"motivo": "Cargado dos veces"})).status_code == 200
        # El otro supervisor: uso + conversación a Caro, con seguimiento al día siguiente.
        r = await ac.post(f"{BASE}/portal/coaching", headers=sup2, json={
            **nuevo, "operador_id": caro, "tipo": "diario", "metricas": ["conversacion", "uso"], "seguimiento_fecha": "2026-10-13"})
        assert r.status_code == 201, r.text
        c4 = r.json()

        # Corregir las métricas dentro de las 24 h: queda en el historial.
        r = await ac.patch(f"{BASE}/portal/coaching/{c2['id']}", headers=sup1, json={"metricas": ["conversacion", "gpon"]})
        assert r.status_code == 200, r.text
        assert r.json()["metricas"] == ["gpon", "conversacion"] and r.json()["metrica"] == "gpon"
        assert r.json()["eventos"][-1]["datos"] == {"antes": {"metricas": ["conversacion"]}, "despues": {"metricas": ["gpon", "conversacion"]}}
        assert (await ac.patch(f"{BASE}/portal/coaching/{c2['id']}", headers=sup1, json={"metricas": []})).status_code == 400

        # Lo que el supervisor tiene que atender hoy: el seguimiento del 14 llega en los próximos 2 días hábiles.
        hoy1 = (await ac.get(f"{BASE}/portal", headers=sup1)).json()["coaching"]
        assert hoy1["seguimientos_proximos"] == 1 and hoy1["proximos_hasta"] == "2026-10-14" and hoy1["seguimientos_hoy"] == 0
        hoy2 = (await ac.get(f"{BASE}/portal", headers=sup2)).json()["coaching"]
        assert hoy2["seguimientos_proximos"] == 1                       # el de Caro, mañana

        # Pasan dos días: Sergio registra el seguimiento (uso mejoró, conversación empeoró → mixto).
        reloj["hoy"], reloj["ahora"] = D(10, 14), datetime(2026, 10, 14, 15, 0, tzinfo=timezone.utc)
        r = await ac.post(f"{BASE}/portal/coaching/{c4['id']}/seguimiento", headers=sup2,
                          json={"comentario": "Mejoró el chequeo de uso; todavía corta antes de presentar la oferta."})
        assert r.status_code == 200, r.text
        cerrado = r.json()
        assert cerrado["resultado"] == "mixto" and cerrado["seguimiento"] == "a_tiempo"
        assert [(p["metrica"], p["resultado"]) for p in cerrado["impacto"]["metricas"]] == [("uso", "mejoro"), ("conversacion", "empeoro")]
        hoy1 = (await ac.get(f"{BASE}/portal", headers=sup1)).json()["coaching"]
        assert hoy1["seguimientos_hoy"] == 1 and hoy1["seguimientos_proximos"] == 0

        # ---- Registro de los jefes: todo el mes hasta hoy, con lo que se trabajó y la devolución.
        assert (await ac.get(f"{BASE}/registro", headers=sup1)).status_code == 403     # el supervisor no entra
        for jefe in (coord, subg, admin):
            assert (await ac.get(f"{BASE}/registro", headers=jefe)).status_code == 200
        g = (await ac.get(f"{BASE}/registro", headers=coord)).json()
        assert (g["desde"], g["hasta"], g["hoy"]) == ("2026-10-01", "2026-10-14", "2026-10-14")
        k = g["kpis"]
        assert k["coachings"] == 3 and k["anulados"] == 1 and k["asesores"] == 3 and k["supervisores"] == 2
        assert k["fuera_de_termino"] == 1 and k["cerrados"] == 1 and k["resultados"]["mixto"] == 1
        assert k["seguimientos"] == {"a_tiempo": 1, "tarde": 0, "vencido": 0, "hoy": 1, "proximo": 1}
        assert k["pct_a_tiempo"] == 100.0 and k["proximos"] == 2 and k["pct_mejora"] == 0.0
        assert {x["metrica"]: (x["coachings"], x["mejoro"], x["empeoro"]) for x in g["por_metrica"]} == {
            "pospago": (1, 0, 0), "gpon": (2, 0, 0), "uso": (1, 1, 0), "conversacion": (2, 0, 1)}
        silvia = next(f for f in g["por_supervisor"] if f["id"] == s1)
        assert silvia["nombre"] == "Silvia Uno" and silvia["coachings"] == 2 and silvia["asesores"] == 2 and silvia["pendientes"] == 2
        assert silvia["proximos"] == 2 and silvia["ultimo"] == "2026-10-12"
        a_caro = next(a for a in g["por_asesor"] if a["id"] == caro)
        assert a_caro["supervisores"] == ["Sergio Dos"] and a_caro["metricas"] == {"uso": 1, "conversacion": 1} and a_caro["cerrados"] == 1
        # Cada coaching con el diagnóstico, el compromiso, la devolución del seguimiento y el resultado por métrica.
        items = {c["id"]: c for c in g["items"]}
        assert set(items) == {c1["id"], c2["id"], c4["id"]} and g["total_items"] == 3 and not g["truncado"]
        x = items[c4["id"]]
        assert x["diagnostico"].startswith("Ofrece") and x["compromiso"].startswith("Preguntar")
        assert x["seguimiento_comentario"].startswith("Mejoró el chequeo") and x["supervisor"] == "Sergio Dos" and x["operador"] == "Cabrera, Caro"
        assert x["resultados"] == [{"metrica": "uso", "resultado": "mejoro", "delta": -12.5},
                                   {"metrica": "conversacion", "resultado": "empeoro", "delta": -3.0}]
        assert "base" not in x and "impacto" not in x and items[c1["id"]]["resultados"] == []
        assert {o["nombre"] for o in g["opciones"]["supervisores"]} == {"Silvia Uno", "Sergio Dos"}
        assert [o["nombre"] for o in g["opciones"]["asesores"]] == ["Benitez, Beto", "Cabrera, Caro", "Perez, Ana"]

        async def ids(headers=coord, url=f"{BASE}/registro", **params):
            r = await ac.get(url, headers=headers, params=params)
            assert r.status_code == 200, r.text
            return {c["id"] for c in r.json()["items"]}
        # Filtros: supervisor, asesor, métrica, tipo, seguimiento, resultado y anulados.
        assert await ids(supervisor_id=s2) == {c4["id"]}
        assert await ids(operador_id=ana) == {c1["id"]}
        assert await ids(operador_id=ana, anulados="true") == {c1["id"], c3["id"]}
        assert await ids(metrica="gpon") == {c1["id"], c2["id"]}
        assert await ids(metrica="uso") == {c4["id"]}
        assert await ids(tipo="diario") == {c2["id"], c4["id"]}
        assert await ids(seguimiento="pendientes") == {c1["id"], c2["id"]}
        assert await ids(seguimiento="proximos") == {c1["id"], c2["id"]}
        assert await ids(seguimiento="a_tiempo") == {c4["id"]}
        assert await ids(seguimiento="vencidos") == set()
        assert await ids(resultado="mixto") == {c4["id"]}
        assert await ids(resultado="sin_mejora") == set()
        # Por rango: solo el del 9 de octubre; fechas al revés o más de 400 días, no.
        assert await ids(desde="2026-10-09", hasta="2026-10-09") == {c2["id"]}
        assert await ids(desde="2026-09-01", hasta="2026-09-30") == set()
        assert (await ac.get(f"{BASE}/registro", headers=coord, params={"desde": "2026-10-10", "hasta": "2026-10-01"})).status_code == 400
        assert (await ac.get(f"{BASE}/registro", headers=coord, params={"desde": "2025-01-01", "hasta": "2026-10-14"})).status_code == 400
        assert (await ac.get(f"{BASE}/registro", headers=coord, params={"metrica": "ventas"})).status_code == 422

        # ---- Historial del supervisor: solo lo suyo (aunque pida otro supervisor), y los jefes no usan el del portal.
        assert await ids(headers=sup1, url=f"{BASE}/portal/registro") == {c1["id"], c2["id"]}
        assert await ids(headers=sup2, url=f"{BASE}/portal/registro", supervisor_id=s1) == {c4["id"]}
        assert await ids(headers=sup2, url=f"{BASE}/portal/registro", operador_id=ana) == set()
        h = (await ac.get(f"{BASE}/portal/registro", headers=sup1)).json()
        assert [o["nombre"] for o in h["opciones"]["supervisores"]] == ["Silvia Uno"] and h["kpis"]["anulados"] == 1
        assert (await ac.get(f"{BASE}/portal/registro", headers=coord)).status_code == 403

        # El detalle (con el historial de aclaraciones) lo ven los jefes desde el registro.
        d = (await ac.get(f"{BASE}/coaching/{c2['id']}", headers=subg)).json()
        assert [e["tipo"] for e in d["eventos"]] == ["creado", "editado"] and d["metricas"] == ["gpon", "conversacion"]

        # La línea de tiempo de los jefes dice sobre qué se trabajó.
        lt = (await ac.get(f"{BASE}/supervisores/{s2}/linea", headers=coord, params={"periodo": "2026-10"})).json()
        titulos = [e["titulo"] for e in lt["eventos"]]
        assert any("sobre uso de líneas + conversación" in t for t in titulos), titulos


@pytest.mark.asyncio
async def test_la_migracion_completa_las_metricas_de_los_coachings_anteriores():
    async with AsyncSessionLocal() as db:
        viejo = Coaching(supervisor_id="S1", operador_id="X", fecha=D(10, 5), tipo="semanal", metrica="gpon", diagnostico="d" * 10,
                         compromiso="c" * 10, seguimiento_fecha=D(10, 12), created_by="S1")
        nuevo = Coaching(supervisor_id="S1", operador_id="X", fecha=D(10, 6), tipo="semanal", metrica="pospago",
                         metricas=["pospago", "uso"], diagnostico="d" * 10, compromiso="c" * 10, seguimiento_fecha=D(10, 12),
                         created_by="S1")
        db.add_all([viejo, nuevo])
        await db.commit()
        ids = viejo.id, nuevo.id
    async with AsyncSessionLocal() as db:
        res = await coaching_metricas(db)
    async with AsyncSessionLocal() as db:
        v, n = await db.get(Coaching, ids[0]), await db.get(Coaching, ids[1])
    assert res["coachings"] >= 1 and v.metricas == ["gpon"] and n.metricas == ["pospago", "uso"]
