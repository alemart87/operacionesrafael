"""Coaching del día de los jefes (con su revisión) y el analizador semántico de coaching: estadísticas, tiempo
estimado, evaluación por supervisor, palabras e informes de Claude (simulados: los tests nunca llaman a Anthropic)."""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal, Base, engine
from app.main import app
from app.operativas.televentas_claro.supervision import analisis as an
from app.operativas.televentas_claro.supervision import api as sup_api
from app.operativas.televentas_claro.supervision import coaching as coaching_srv
from app.operativas.televentas_claro.supervision.models import CoachingEvento, Operador
from tests.firma_helper import firmar

BASE = "/api/v1/televentas-claro/supervision"
TC = "televentas_claro"
T = lambda h, m=0: datetime(2026, 10, 12, h, m, tzinfo=timezone.utc)  # noqa: E731


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


def test_tiempo_estimado_por_sesiones():
    # Pasos seguidos: cuentan; una pausa de más de 20 min (guardó sin firmar y siguió después) no; más el minuto de arranque.
    assert an.minutos_estimados([T(14), T(14, 3), T(14, 6), T(14, 9)], T(14, 12)) == 13.0
    assert an.minutos_estimados([T(15), T(15, 2), T(16, 2)], T(16, 7)) == 8.0
    assert an.minutos_estimados([], T(9)) == 1.0
    assert an.minutos_estimados([T(8) + timedelta(minutes=k * 15) for k in range(40)], T(18)) == an.TOPE_MINUTOS


def test_palabras_sin_vacias_ni_nombres():
    f = an.frecuencias([("feedback", "Confirmar el uso de la línea con Ana; confirmar uso antes de ofrecer."),
                        ("compromiso", "Confirmar el uso de cada línea.")], excluir={"ana"})
    palabras = {p["texto"]: p for p in f["palabras"]}
    assert palabras["confirmar"]["n"] == 3 and palabras["confirmar"]["compromiso"] == 1
    assert "ana" not in palabras and "el" not in palabras and "de" not in palabras
    assert {"texto": "confirmar uso", "n": 1} not in f["pares"]  # los pares que aparecen una sola vez no se listan
    # Las frases no cruzan la puntuación.
    g = an.frecuencias([("feedback", "Escuché llamadas: saluda bien."), ("feedback", "Escuché llamadas: saluda mal.")], excluir=set())
    pares = {p["texto"] for p in g["pares"]}
    assert "escuché llamadas" in pares and "llamadas saluda" not in pares


def test_seudonimos_y_numeros_tapados():
    pats = an._patron_nombres({"Perez, Ana": "A1", "Silvia Uno": "S1"})
    t = an.tapar("Ana Perez llamó al 0981 555 123 y Silvia le escribió a ana@mail.com", pats)
    assert "Ana" not in t and "Perez" not in t and "Silvia" not in t and "0981" not in t and "@" not in t
    assert "A1" in t and "S1" in t and "[número]" in t and "[correo]" in t


def test_eventos_caben_en_la_columna():
    largo = CoachingEvento.__table__.c.tipo.type.length
    tipos = set(coaching_srv.ORDEN_EVENTO)
    assert all(len(t) <= largo for t in tipos), [t for t in tipos if len(t) > largo]


@pytest.mark.asyncio
async def test_dia_revision_y_analizador(monkeypatch):
    reloj = {"hoy": date(2026, 10, 12), "ahora": T(14)}
    monkeypatch.setattr(sup_api, "hoy", lambda: reloj["hoy"])
    monkeypatch.setattr(coaching_srv, "ahora", lambda: reloj["ahora"])
    monkeypatch.setattr(settings, "analisis_simulador", False)
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    async with AsyncSessionLocal() as db:
        ops = [Operador(nombre=n, agente_clave=n.upper(), agente_nombre=n, cruce="sin_cruce")
               for n in ("Perez, Ana", "Benitez, Beto", "Gomez, Carla")]
        db.add_all(ops)
        await db.commit()
        ana, beto, carla = (o.id for o in ops)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        _, coord = await _new_user(ac, admin, "coordinador", "Cora Coordinadora")
        _, gerente = await _new_user(ac, admin, "gerente", "Gerardo Gerente")
        _, subg = await _new_user(ac, admin, "sub_gerente")
        _, controller = await _new_user(ac, admin, "controller")
        _, auditor = await _new_user(ac, admin, "auditor")
        s1, sup1 = await _new_user(ac, admin, "supervisor", "Silvia Uno")
        s2, sup2 = await _new_user(ac, admin, "supervisor", "Sergio Dos")
        for ids, sid in (([ana, beto], s1), ([carla], s2)):
            r = await ac.post(f"{BASE}/equipos/asignar", headers=coord, json={"periodo": "2026-10", "operador_ids": ids, "supervisor_id": sid})
            assert r.status_code == 200, r.text

        async def paso(minutos: int):
            reloj["ahora"] += timedelta(minutes=minutos)

        # ---- Coaching 1: de corrido en 12 minutos (13 estimados con el arranque).
        c1 = (await ac.post(f"{BASE}/portal/coaching", headers=sup1, json={"operador_id": ana, "tipo": "semanal"})).json()["id"]
        await paso(3)
        await ac.post(f"{BASE}/portal/coaching/{c1}/items", headers=sup1, json={
            "tipo": "monitoreo", "metricas": ["pospago"], "texto": "Ana ofrece el plan sin preguntar el uso; el cliente era el 0981 555 123."})
        await paso(3)
        await ac.post(f"{BASE}/portal/coaching/{c1}/items", headers=sup1, json={
            "tipo": "feedback", "metricas": ["pospago"], "texto": "Repasamos cómo preguntar el uso antes de ofrecer el plan."})
        await paso(3)
        r = await ac.post(f"{BASE}/portal/coaching/{c1}/compromisos", headers=sup1, json={
            "texto": "Preguntar el uso antes de ofrecer el plan", "para": "2026-10-14", "metrica": "pospago", "origen": "asesor"})
        assert r.status_code == 201, r.text
        await paso(3)
        await firmar(ac, sup1, c1)

        # ---- Coaching 2: con una pausa larga en el medio (no cuenta): 2 + 5 + 1 = 8 minutos.
        reloj["ahora"] = T(15)
        c2 = (await ac.post(f"{BASE}/portal/coaching", headers=sup1, json={"operador_id": beto, "tipo": "diario"})).json()["id"]
        await paso(2)
        await ac.post(f"{BASE}/portal/coaching/{c2}/items", headers=sup1, json={
            "tipo": "feedback", "metricas": ["gpon"], "texto": "Ofrecer GPON cuando el cliente tiene fibra disponible."})
        await paso(60)
        await ac.post(f"{BASE}/portal/coaching/{c2}/compromisos", headers=sup1, json={"texto": "Ofrecer GPON en cada llamada con fibra"})
        await paso(5)
        await firmar(ac, sup1, c2)

        # ---- Coaching 3: en curso (sin firmar).
        reloj["ahora"] = T(16)
        c3 = (await ac.post(f"{BASE}/portal/coaching", headers=sup2, json={"operador_id": carla})).json()["id"]
        await ac.post(f"{BASE}/portal/coaching/{c3}/items", headers=sup2, json={
            "tipo": "feedback", "metricas": ["uso"], "texto": "Revisar las líneas sin uso con la asesora."})
        reloj["ahora"] = T(17)

        # ---- Coaching del día: gerente, sub gerente, coordinador y controller; ni el auditor ni el supervisor.
        for quien in (auditor, sup1):
            assert (await ac.get(f"{BASE}/control/dia", headers=quien)).status_code == 403
        d = (await ac.get(f"{BASE}/control/dia", headers=gerente)).json()
        k = d["kpis"]
        assert (k["firmados"], k["en_curso"], k["sin_firmar"], k["por_revisar"], k["minutos_prom"]) == (2, 1, 1, 2, 10.5)
        f1 = next(x for x in d["coachings"] if x["id"] == c1)
        assert (f1["estado_dia"], f1["minutos"], f1["monitoreos"], f1["feedback"], f1["compromisos"]) == ("firmado", 13.0, 1, 1, 1)
        assert f1["resumen"].startswith("Ana ofrece") and f1["compromiso"].startswith("Preguntar el uso")
        assert next(x for x in d["coachings"] if x["id"] == c3)["estado_dia"] == "en_curso"
        silvia = next(s for s in d["supervisores"] if s["id"] == s1)
        assert (silvia["firmados"], silvia["por_revisar"]) == (2, 2)
        assert (await ac.get(f"{BASE}/control/dia", headers=gerente, params={"fecha": "2026-10-13"})).status_code == 400
        assert (await ac.get(f"{BASE}/control/dia", headers=controller)).status_code == 200
        ayer = (await ac.get(f"{BASE}/control/dia", headers=coord, params={"fecha": "2026-10-11"})).json()
        assert ayer["kpis"]["firmados"] == 0 and ayer["coachings"] == []

        # ---- Revisión del jefe: «a mejorar» pide el comentario; la ve el supervisor; no la hace un supervisor ni el auditor.
        r = await ac.post(f"{BASE}/control/coaching/{c2}/revision", headers=gerente, json={"valoracion": "mejorar"})
        assert r.status_code == 400
        r = await ac.post(f"{BASE}/control/coaching/{c2}/revision", headers=gerente, json={
            "valoracion": "mejorar", "comentario": "El compromiso no tiene fecha ni métrica."})
        assert r.status_code == 201 and r.json()["por"] == "Gerardo Gerente"
        assert (await ac.post(f"{BASE}/control/coaching/{c1}/revision", headers=coord, json={"valoracion": "bien"})).status_code == 201
        for quien in (auditor, sup1):
            assert (await ac.post(f"{BASE}/control/coaching/{c1}/revision", headers=quien, json={"valoracion": "bien"})).status_code == 403
        d = (await ac.get(f"{BASE}/control/dia", headers=gerente)).json()
        assert d["kpis"]["por_revisar"] == 0 and d["kpis"]["revisados"] == 2
        assert next(x for x in d["coachings"] if x["id"] == c2)["revision"]["valoracion"] == "mejorar"
        vista = (await ac.get(f"{BASE}/portal/coaching", headers=sup1)).json()
        assert {(x["coaching_id"], x["valoracion"]) for x in vista["revisiones"]} == {(c1, "bien"), (c2, "mejorar")}
        det = (await ac.get(f"{BASE}/portal/coaching/{c2}", headers=sup1)).json()
        assert any(e["tipo"] == "revision" and e["datos"]["comentario"].startswith("El compromiso") for e in det["eventos"])
        # El control de supervisores no cuenta la revisión como actividad del supervisor.
        act = (await ac.get(f"{BASE}/control/actividad", headers=coord, params={"supervisor_id": s1})).json()
        assert not any(e["tipo"] == "revision" for e in act["items"])

        # ---- Analizador: gerente, sub gerente y coordinador; ni el controller, ni el auditor, ni el supervisor.
        for quien in (controller, auditor, sup1):
            assert (await ac.get(f"{BASE}/analisis", headers=quien)).status_code == 403
        a = (await ac.get(f"{BASE}/analisis", headers=coord, params={"desde": "2026-10-01", "hasta": "2026-10-12"})).json()
        k = a["kpis"]
        assert (k["coachings"], k["en_curso"], k["asesores"], k["monitoreos"], k["feedback"], k["compromisos"]) == (2, 1, 2, 1, 2, 2)
        assert (k["minutos_prom"], k["pct_compromisos_con_fecha"], k["pct_compromisos_con_metrica"], k["revisados"]) == (10.5, 50.0, 50.0, 2)
        ev = next(s for s in a["supervisores"] if s["id"] == s1)
        assert ev["coachings"] == 2 and ev["equipo"] == 2 and ev["evaluacion"]["total"] is not None
        cob = next(x for x in ev["evaluacion"]["componentes"] if x["clave"] == "cobertura")
        assert cob["valor"] == 100.0
        sergio = next(s for s in a["supervisores"] if s["id"] == s2)
        assert sergio["coachings"] == 0 and sergio["en_curso"] == 1
        palabras = {p["texto"] for p in a["palabras"]["palabras"]}
        assert {"plan", "uso", "ofrecer"} <= palabras and not palabras & {"ana", "perez", "beto", "silvia"}
        assert {c["id"] for c in a["coachings"]} == {c1, c2} and a["servicio"]["disponible"] is False
        assert sum(x["coachings"] for x in a["por_dia"]) == 2 and sum(x["coachings"] for x in a["duraciones"]) == 2
        solo = (await ac.get(f"{BASE}/analisis", headers=gerente, params={"supervisor_id": s2, "desde": "2026-10-01"})).json()
        assert solo["kpis"]["coachings"] == 0 and solo["kpis"]["en_curso"] == 1
        assert (await ac.get(f"{BASE}/analisis", headers=subg)).status_code == 200
        assert (await ac.get(f"{BASE}/analisis", headers=gerente, params={"desde": "2026-01-01", "hasta": "2026-10-12"})).status_code == 400

        # ---- Informe de Claude: sin la clave, no se puede pedir.
        cuerpo = {"desde": "2026-10-01", "hasta": "2026-10-12"}
        assert (await ac.post(f"{BASE}/analisis/informes", headers=coord, json=cuerpo)).status_code == 409

        # Lo que lee Claude no tiene nombres, teléfonos ni correos.
        async with AsyncSessionLocal() as db:
            datos = await an.cargar(db, date(2026, 10, 1), date(2026, 10, 12))
        pedido, codigos = an.armar_pedido(datos, an.estadisticas(datos), 300)
        assert not [x for x in ("Ana", "Perez", "Beto", "Silvia", "Sergio", "0981") if x in pedido], pedido
        assert "S1" in pedido and "A1" in pedido and "[C1]" in pedido and "[número]" in pedido
        assert set(codigos["coachings"].values()) == {c1, c2}

        # Con una respuesta de Claude (falsa): los códigos de personas vuelven a sus nombres y se aplican los topes.
        monkeypatch.setattr(settings, "anthropic_api_key", "sk-ant-prueba")

        async def falso(texto):
            return {
                "resumen": "S1 hace coachings con compromisos claros (C1).", "hallazgos": [], "temas": [],
                "tono": {"constructivo": 50, "positivo": 30, "critico": 30, "explicacion": "x"},
                "calidad_compromisos": {"especificos": 140, "medibles": 50, "con_plazo": -3, "comentario": "x"},
                "supervisores": [{"codigo": "S1", "calificacion": 9, "fortalezas": ["Escucha a A1"], "a_mejorar": [],
                                  "recomendacion": "Seguir así", "ejemplo": "C1"}],
                "alertas": [], "recomendaciones": [],
            }, "claude-haiku-5-5", 40_000, 2_000
        monkeypatch.setattr(an, "consultar_claude", falso)
        r = await ac.post(f"{BASE}/analisis/informes", headers=coord, json=cuerpo)
        assert r.status_code == 201 and r.json()["estado"] == "pendiente"
        assert await an.procesar_pendientes() == 1
        inf = (await ac.get(f"{BASE}/analisis/informes/{r.json()['id']}", headers=gerente)).json()
        assert inf["estado"] == "listo" and inf["coachings"] == 2 and inf["costo_usd"] == round(0.04 * 0.10 + 0.002 * 0.50, 5)
        res = inf["resultado"]
        assert res["resumen"] == "Silvia Uno hace coachings con compromisos claros (C1)."
        assert res["supervisores"][0]["supervisor_id"] == s1 and res["supervisores"][0]["calificacion"] == 5
        assert res["supervisores"][0]["fortalezas"] == ["Escucha a Benitez, Beto"]   # A1: el primero por nombre
        assert sum(res["tono"][x] for x in ("constructivo", "positivo", "critico")) == 100
        assert (res["calidad_compromisos"]["especificos"], res["calidad_compromisos"]["con_plazo"]) == (100, 0)
        assert res["coachings"]["C1"] in (c1, c2)
        lista = (await ac.get(f"{BASE}/analisis/informes", headers=subg)).json()["items"]
        assert lista[0]["id"] == inf["id"] and lista[0]["resultado"] is None and lista[0]["resumen"].startswith("Silvia Uno")
        for quien in (controller, sup1):
            assert (await ac.get(f"{BASE}/analisis/informes/{inf['id']}", headers=quien)).status_code == 403

        # Con el simulador (desarrollo): el informe sale de las estadísticas, sin costo. Hay un tope de informes por día.
        monkeypatch.setattr(settings, "analisis_simulador", True)
        monkeypatch.setattr(settings, "anthropic_api_key", "")
        r = await ac.post(f"{BASE}/analisis/informes", headers=coord, json={**cuerpo, "supervisor_id": s1})
        assert r.status_code == 201
        await an.procesar_pendientes()
        sim = (await ac.get(f"{BASE}/analisis/informes/{r.json()['id']}", headers=coord)).json()
        assert sim["estado"] == "listo" and sim["modelo"].startswith("simulador") and sim["costo_usd"] == 0
        assert sim["supervisor"] == "Silvia Uno" and sim["resultado"]["supervisores"][0]["supervisor"] == "Silvia Uno"
        # Sin coachings firmados en el rango: el informe termina con el motivo.
        r = await ac.post(f"{BASE}/analisis/informes", headers=coord, json={"desde": "2026-10-01", "hasta": "2026-10-12", "supervisor_id": s2})
        await an.procesar_pendientes()
        vacio = (await ac.get(f"{BASE}/analisis/informes/{r.json()['id']}", headers=coord)).json()
        assert vacio["estado"] == "error" and "No hay coachings firmados" in vacio["error"]
        monkeypatch.setattr(settings, "analisis_informes_dia", 3)
        assert (await ac.post(f"{BASE}/analisis/informes", headers=coord, json=cuerpo)).status_code == 429
        assert (await ac.post(f"{BASE}/analisis/informes", headers=gerente, json=cuerpo)).status_code == 201
        await an.procesar_pendientes()

    # Nunca entra nada de Facturación: el analizador solo lee las tablas del coaching.
    import app.operativas.televentas_claro.supervision.analisis as modulo
    assert "facturacion" not in open(modulo.__file__, encoding="utf-8").read().lower()
    async with AsyncSessionLocal() as db:
        tipos = {t for (t,) in (await db.execute(select(CoachingEvento.tipo).distinct())).all()}
    assert "revision" in tipos and all(len(t) <= 30 for t in tipos)
