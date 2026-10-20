"""Mi día del supervisor: objetivo de feedback con hitos, calidad del feedback con consejos, cierre del día con su
compromiso (y el punto extra), el ánimo detectado y lo que ven los jefes."""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import AsyncSessionLocal, Base, engine
from app.main import app
from app.operativas.televentas_claro.supervision import api as sup_api
from app.operativas.televentas_claro.supervision import calidad as cal
from app.operativas.televentas_claro.supervision import coaching as coaching_srv
from app.operativas.televentas_claro.supervision.models import Operador
from tests.firma_helper import firmar

BASE = "/api/v1/televentas-claro/supervision"
TC = "televentas_claro"
CORTO = "Bien, seguí así."
BUENO = ("Escuché la llamada de las 10:15: saludó muy bien y presentó la oferta, pero no preguntó por el uso de la línea. "
         "La próxima vez tiene que preguntar quién usa la línea antes de ofrecer Pospago.")
LARGO = " ".join(["Hablamos un buen rato de la llamada, de cómo estuvo el cliente, de lo que pasó en la semana y de varias cosas más"] * 8)


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


def test_calidad_del_feedback():
    assert cal.evaluar_feedback(CORTO)["problema"] == "corto"
    bueno = cal.evaluar_feedback(BUENO)
    assert bueno["problema"] is None and bueno["puntaje"] >= 80 and not bueno["consejos"]
    largo = cal.evaluar_feedback(LARGO)
    assert largo["problema"] == "largo" and "conciso" in largo["consejos"][0]
    r = cal.resumen_calidad([CORTO, BUENO, LARGO])
    assert r["feedbacks"] == 3 and r["cortos"] == 1 and r["largos"] == 1 and r["recomendaciones"]


def test_animo():
    assert cal.detectar_animo("Hoy logramos el objetivo, el equipo está motivado.", "bien")["etiqueta"] == "positivo"
    neg = cal.detectar_animo("Estoy re cansada, no llegamos y hubo muchos problemas.", "dificil")
    assert neg["etiqueta"] == "negativo" and {"cansancio", "estres"} <= set(neg["emociones"])
    assert cal.detectar_animo("No estoy cansado, todo tranquilo.")["etiqueta"] != "negativo"   # la negación cuenta
    assert cal.detectar_animo("Un desastre, estoy harta.", "bien")["etiqueta"] == "mixto"
    assert cal.alerta_animo([{"etiqueta": "negativo"}, {"etiqueta": "negativo"}]).startswith("Dos cierres")


@pytest.mark.asyncio
async def test_mi_dia_cierre_y_jefes(monkeypatch):
    reloj = {"hoy": date(2026, 10, 12), "ahora": datetime(2026, 10, 12, 14, tzinfo=timezone.utc)}
    monkeypatch.setattr(sup_api, "hoy", lambda: reloj["hoy"])
    monkeypatch.setattr(coaching_srv, "ahora", lambda: reloj["ahora"])
    async with AsyncSessionLocal() as db:
        ops = [Operador(nombre=n, agente_clave=n.upper(), agente_nombre=n, cruce="sin_cruce")
               for n in ("Perez, Ana", "Gomez, Carla", "Benitez, Beto", "Sosa, Dani")]
        db.add_all(ops)
        await db.commit()
        ana, carla, beto, dani = (o.id for o in ops)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        _, coord = await _new_user(ac, admin, "coordinador")
        _, gerente = await _new_user(ac, admin, "gerente")
        _, auditor = await _new_user(ac, admin, "auditor")
        s1, sup1 = await _new_user(ac, admin, "supervisor", "Silvia Uno")
        s2, sup2 = await _new_user(ac, admin, "supervisor", "Sergio Dos")
        for ids, sid in (([ana, beto, dani], s1), ([carla], s2)):
            r = await ac.post(f"{BASE}/equipos/asignar", headers=coord, json={"periodo": "2026-10", "operador_ids": ids, "supervisor_id": sid})
            assert r.status_code == 200, r.text

        # Sin nada todavía: objetivo 8, cero puntos, el cierre suma uno más.
        d = (await ac.get(f"{BASE}/portal/mi-dia", headers=sup1)).json()
        assert d["objetivo"] == 8 and d["feedbacks"] == 0 and d["puntos"] == 0 and d["puntos_max"] == 9
        assert [h["clave"] for h in d["hitos"]] == ["f1", "f4", "f8", "cierre"] and not any(h["logrado"] for h in d["hitos"])

        # Cada coaching con algo cargado hoy es un feedback dado, marcado como monitoreo o como feedback.
        cargas = {ana: [("feedback", CORTO)], beto: [("feedback", BUENO), ("monitoreo", "Escuché dos llamadas de la mañana.")],
                  dani: [("monitoreo", LARGO)]}
        for op, items in cargas.items():
            c = (await ac.post(f"{BASE}/portal/coaching", headers=sup1, json={"operador_id": op, "tipo": "diario"})).json()["id"]
            for tipo, texto in items:
                reloj["ahora"] += timedelta(minutes=2)
                r = await ac.post(f"{BASE}/portal/coaching/{c}/items", headers=sup1, json={"tipo": tipo, "metricas": ["pospago"], "texto": texto})
                assert r.status_code == 201, r.text
        d = (await ac.get(f"{BASE}/portal/mi-dia", headers=sup1)).json()
        assert d["feedbacks"] == 3 and d["puntos"] == 3                        # 3 asesores: el de dos ítems cuenta una vez
        assert {h["clave"]: h["logrado"] for h in d["hitos"]} == {"f1": True, "f4": False, "f8": False, "cierre": False}
        q = d["calidad"]
        assert q["feedbacks"] == 3 and q["cortos"] == 1 and q["largos"] == 1 and q["recomendaciones"] and len(q["ultimos"]) == 3

        # El seguimiento registrado también es una devolución (un coaching de ayer, con su seguimiento hoy).
        reloj["hoy"], reloj["ahora"] = date(2026, 10, 9), datetime(2026, 10, 9, 14, tzinfo=timezone.utc)
        r = await ac.post(f"{BASE}/portal/coaching", headers=sup2, json={"operador_id": carla, "tipo": "diario"})
        assert r.status_code == 201, r.text
        cs = r.json()["id"]
        await ac.post(f"{BASE}/portal/coaching/{cs}/items", headers=sup2, json={"tipo": "monitoreo", "metricas": ["gpon"], "texto": "No ofreció GPON."})
        await ac.post(f"{BASE}/portal/coaching/{cs}/compromisos", headers=sup2, json={"texto": "Ofrecer GPON en cada llamada", "metrica": "gpon"})
        comp = (await firmar(ac, sup2, cs))["compromisos"][0]["id"]
        reloj["hoy"], reloj["ahora"] = date(2026, 10, 12), datetime(2026, 10, 12, 15, tzinfo=timezone.utc)
        r = await ac.post(f"{BASE}/portal/coaching/{cs}/seguimiento", headers=sup2, json={"comentario": "Ya ofrece GPON en todas las llamadas que escuché.",
                                                                                       "compromisos": [{"id": comp, "resultado": "cumplido"}]})
        assert r.status_code == 200, r.text
        d2 = (await ac.get(f"{BASE}/portal/mi-dia", headers=sup2)).json()
        assert d2["feedbacks"] == 1 and d2["semana"][-4]["feedbacks"] == 1    # el viernes (el coaching) y hoy (el seguimiento)

        # La calidad mientras se escribe.
        r = await ac.post(f"{BASE}/portal/calidad", headers=sup1, json={"texto": CORTO})
        assert r.status_code == 200 and r.json()["problema"] == "corto"
        assert (await ac.post(f"{BASE}/portal/calidad", headers=gerente, json={"texto": CORTO})).status_code == 403

        # Cierre del día: valida los textos, detecta el ánimo y suma el punto extra.
        assert (await ac.put(f"{BASE}/portal/cierre", headers=sup1, json={"resultados": "Bien", "compromiso": "Mañana más"})).status_code == 400
        cierre = {"resultados": "Día complicado: estoy re cansada, no llegamos al objetivo y hubo problemas con el sistema.",
                  "compromiso": "Mañana hago 8 feedback antes de las 15 h.", "como_termino": "dificil"}
        r = await ac.put(f"{BASE}/portal/cierre", headers=sup1, json=cierre)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["puntos"] == 4 and d["cierre"]["animo"]["etiqueta"] == "negativo" and d["cierre"]["feedbacks"] == 3
        assert next(h for h in d["hitos"] if h["clave"] == "cierre")["logrado"]
        # Se corrige el mismo día (sigue habiendo uno solo).
        r = await ac.put(f"{BASE}/portal/cierre", headers=sup1, json={**cierre, "compromiso": "Mañana hago 8 feedback antes de las 14 h."})
        assert r.status_code == 200 and r.json()["cierre"]["compromiso"].endswith("14 h.")

        # Al día siguiente: tiene que decir si cumplió el compromiso anterior.
        reloj["hoy"], reloj["ahora"] = date(2026, 10, 13), datetime(2026, 10, 13, 14, tzinfo=timezone.utc)
        d = (await ac.get(f"{BASE}/portal/mi-dia", headers=sup1)).json()
        assert d["cierre"] is None and d["anterior"]["compromiso"].endswith("14 h.") and d["feedbacks"] == 0
        manana = {"resultados": "Muy buen día, logramos 12 ventas y el equipo está motivado.",
                  "compromiso": "Seguir con los monitoreos de la mañana.", "como_termino": "bien"}
        assert (await ac.put(f"{BASE}/portal/cierre", headers=sup1, json=manana)).status_code == 400
        r = await ac.put(f"{BASE}/portal/cierre", headers=sup1, json={**manana, "cumplio_anterior": "parcial"})
        assert r.status_code == 200 and r.json()["cierre"]["cumplio_anterior"] == "parcial"
        assert r.json()["cierre"]["animo"]["etiqueta"] == "positivo"

        # Los jefes ven los cierres, el compromiso anterior y el ánimo de la semana.
        assert (await ac.get(f"{BASE}/control/cierres", headers=sup1)).status_code == 403
        assert (await ac.get(f"{BASE}/control/cierres", headers=auditor)).status_code == 403
        j = (await ac.get(f"{BASE}/control/cierres", headers=gerente)).json()
        assert j["kpis"]["con_cierre"] == 1 and j["kpis"]["animo"]["positivo"] == 1
        filas = {f["id"]: f for f in j["supervisores"]}
        assert filas[s2]["cierre"] is None
        f1 = filas[s1]
        assert f1["cierre"]["resultados"].startswith("Muy buen día") and f1["anterior"]["compromiso"].endswith("14 h.")
        assert [x["etiqueta"] for x in f1["animo"]][-2:] == ["negativo", "positivo"]
        j = (await ac.get(f"{BASE}/control/cierres?fecha=2026-10-12", headers=gerente)).json()
        f1 = next(f for f in j["supervisores"] if f["id"] == s1)
        assert f1["feedbacks"] == 3 and f1["alerta"] == "Cerró el día con ánimo negativo." and f1["calidad"] is not None

        # El objetivo se cambia en los parámetros.
        r = await ac.put(f"{BASE}/parametros", headers=coord, json={"pesos_dia": [1, 1, 1, 1, 1, 0.5, 0], "objetivo_feedback_dia": 5})
        assert r.status_code == 200, r.text
        d = (await ac.get(f"{BASE}/portal/mi-dia", headers=sup1)).json()
        assert d["objetivo"] == 5 and d["puntos_max"] == 6 and [h["meta"] for h in d["hitos"][:3]] == [1, 3, 5]
