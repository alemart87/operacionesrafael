"""Clima del equipo: termómetro del supervisor, ánimo y compromiso del líder y del equipo, la vista de los jefes (solo
gerente, sub gerente y coordinador), las alertas en el centro de comandos (solo con el permiso), la calibración y el
análisis nocturno con IA (simulado: nunca se llama a Anthropic) con los textos sin nombres."""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.core.database import AsyncSessionLocal, Base, engine
from app.main import app
from app.operativas.televentas_claro.supervision import api as sup_api
from app.operativas.televentas_claro.supervision import calidad as cal
from app.operativas.televentas_claro.supervision import clima
from app.operativas.televentas_claro.supervision import coaching as coaching_srv
from app.operativas.televentas_claro.supervision.models import ClimaIA, Operador
from tests.firma_helper import firmar

BASE = "/api/v1/televentas-claro/supervision"
TC = "televentas_claro"
CRITICO = "No preguntó por el uso otra vez, está mal, siempre lo mismo."
BUENO = ("Escuché la llamada de las 10:15: muy bien el saludo y la oferta, pero la próxima tenés que preguntar quién usa la "
         "línea antes de ofrecer Pospago.")


def setup_module(module):
    from app.main import _seed_profiles

    async def _prep():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await _seed_profiles()
    asyncio.run(_prep())
    clima._completos.clear()


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


def test_reglas():
    assert clima.estado(40, 80) == "animado" and clima.estado(0, 80) == "comprometido" and clima.estado(-30, 80) == "cansado"
    assert clima.estado(-30, 50) == "desanimado" and clima.estado(-5, 30) == "desanimado" and clima.estado(5, 50) == "neutro"
    assert clima.estado(None, None) == "sin_datos"
    assert cal.tono_feedback("Excelente llamada, muy bien el cierre.") == "reconocimiento"
    assert cal.tono_feedback(CRITICO) == "critico" and cal.tono_feedback(BUENO) == "constructivo"
    v = cal.voz_asesor("Gracias, me sirvió, voy a practicar la pregunta del uso.")
    assert v["polaridad"] > 0.3 and v["propositivo"] and not v["riesgo"]
    assert cal.voz_asesor("No es justo, siempre a mí. Me quiero ir.")["riesgo"] == ["me quiero ir"]
    assert cal.riesgos("No me voy a ir, estoy bien.") == []                       # la negación cuenta


@pytest.mark.asyncio
async def test_clima_del_equipo(monkeypatch):
    # Lunes 12/10, 11:00 en Asunción (14:00 UTC): ya se pregunta «¿Cómo vas?».
    reloj = {"hoy": date(2026, 10, 12), "ahora": datetime(2026, 10, 12, 14, tzinfo=timezone.utc)}
    monkeypatch.setattr(sup_api, "hoy", lambda: reloj["hoy"])
    monkeypatch.setattr(coaching_srv, "ahora", lambda: reloj["ahora"])
    monkeypatch.setattr(settings, "anthropic_api_key", "")      # nunca se llama a Anthropic desde las pruebas
    monkeypatch.setattr(settings, "analisis_simulador", False)
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
        _, subg = await _new_user(ac, admin, "sub_gerente")
        _, controller = await _new_user(ac, admin, "controller")
        _, auditor = await _new_user(ac, admin, "auditor")
        s1, sup1 = await _new_user(ac, admin, "supervisor", "Silvia Uno")
        s2, sup2 = await _new_user(ac, admin, "supervisor", "Sergio Dos")
        for ids, sid in (([ana, beto, dani], s1), ([carla], s2)):
            r = await ac.post(f"{BASE}/equipos/asignar", headers=coord, json={"periodo": "2026-10", "operador_ids": ids, "supervisor_id": sid})
            assert r.status_code == 200, r.text

        # Lo ven gerente, sub gerente, coordinador (y el superadmin); el controller, el auditor y el supervisor no.
        for h in (gerente, subg, coord, admin):
            assert (await ac.get(f"{BASE}/control/clima", headers=h)).status_code == 200
        for h in (controller, auditor, sup1):
            assert (await ac.get(f"{BASE}/control/clima", headers=h)).status_code == 403

        # Termómetro: se pregunta a media mañana; un toque y se va. Otro toque enseguida corrige el anterior.
        t = (await ac.get(f"{BASE}/portal/mi-dia", headers=sup1)).json()["termometro"]
        assert t["mostrar"] and t["ultimo"] is None
        r = await ac.post(f"{BASE}/portal/termometro", headers=sup1, json={"valor": "normal"})
        assert r.status_code == 200 and not r.json()["mostrar"]
        r = await ac.post(f"{BASE}/portal/termometro", headers=sup1, json={"valor": "dificil"})
        assert r.json()["pulsos"] == 1 and r.json()["ultimo"]["valor"] == "dificil"
        assert (await ac.post(f"{BASE}/portal/termometro", headers=gerente, json={"valor": "bien"})).status_code == 403

        # Silvia: tres devoluciones críticas; un asesor dice algo de riesgo al firmar; cierra el día difícil.
        coachings = {}
        for op in (ana, beto, dani):
            reloj["ahora"] += timedelta(minutes=5)
            c = (await ac.post(f"{BASE}/portal/coaching", headers=sup1, json={"operador_id": op, "tipo": "diario"})).json()["id"]
            r = await ac.post(f"{BASE}/portal/coaching/{c}/items", headers=sup1, json={"tipo": "feedback", "metricas": ["pospago"], "texto": CRITICO})
            assert r.status_code == 201, r.text
            r = await ac.post(f"{BASE}/portal/coaching/{c}/compromisos", headers=sup1,
                              json={"texto": "Preguntar por el uso en cada llamada", "metrica": "uso", "origen": "supervisor"})
            assert r.status_code == 201, r.text
            coachings[op] = c
        await firmar(ac, sup1, coachings[ana], comentario="No es justo, siempre a mí. Me quiero ir de acá.")
        await firmar(ac, sup1, coachings[beto], comentario="No estoy de acuerdo, no fue así, estoy harto.")
        # Sergio: una devolución constructiva y el asesor dicta su propio compromiso.
        c = (await ac.post(f"{BASE}/portal/coaching", headers=sup2, json={"operador_id": carla, "tipo": "diario"})).json()["id"]
        await ac.post(f"{BASE}/portal/coaching/{c}/items", headers=sup2, json={"tipo": "feedback", "metricas": ["pospago"], "texto": BUENO})
        await ac.post(f"{BASE}/portal/coaching/{c}/compromisos", headers=sup2, json={"texto": "Voy a preguntar por el uso antes de ofrecer", "origen": "asesor"})
        await firmar(ac, sup2, c, comentario="Gracias, me sirvió, voy a practicarlo.")
        reloj["ahora"] = datetime(2026, 10, 12, 21, tzinfo=timezone.utc)     # 18:00 local
        r = await ac.put(f"{BASE}/portal/cierre", headers=sup1, json={
            "resultados": "Día muy difícil, estoy agotada y frustrada, no llegamos y hubo problemas.",
            "compromiso": "Mañana hago 8 feedback antes de las 15 h.", "como_termino": "dificil"})
        assert r.status_code == 200, r.text

        d = (await ac.get(f"{BASE}/control/clima", headers=gerente)).json()
        assert d["modo"] == "dia" and d["ia"]["estado"] == "sin_clave" and len(d["curva"]) == 13 and len(d["dias"]) == 7
        lid = {f["id"]: f for f in d["lideres"]}
        eq = {f["id"]: f for f in d["equipos"]}
        assert lid[s1]["animo"] < -20 and lid[s1]["elegido"] == -70.0 and lid[s1]["cierre"] and lid[s1]["feedbacks"] == 3
        assert lid[s1]["estado"] in ("desanimado", "cansado")
        assert eq[s1]["animo"] < 0 and eq[s1]["tonos"] == {"critico": 3} and eq[s1]["voces"] == 2
        assert eq[s2]["animo"] > 20 and eq[s2]["tonos"] == {"constructivo": 1}
        assert eq[s2]["componentes"]["dicho_por_asesor"] == 100.0 and eq[s2]["componentes"]["aceptado"] == 100.0
        # El porqué, en palabras (del equipo nunca se nombra al asesor).
        assert any(m.startswith("Dijo cómo le iba") and "difícil" in m for m in lid[s1]["motivos"]), lid[s1]["motivos"]
        assert any("negativo" in m for m in lid[s1]["motivos"]) and len(lid[s1]["motivos"]) <= 3
        assert any("me quiero ir" in m for m in eq[s1]["motivos"]) and not any("Perez" in m or "Ana" in m for m in eq[s1]["motivos"])
        assert "Los asesores dijeron sus propios compromisos" in eq[s2]["motivos"]
        assert any(p["tono"] == "critico" for p in d["puntos"]) and d["curva"][-1]["equipo"] is not None
        # Los asesores van siempre agregados: no hay nombres ni textos de asesores en la respuesta.
        assert "Perez" not in str(d) and "Me quiero ir" not in str(d)

        # Alertas: en calibración solo las altas (palabras de riesgo); con «todas», también feedback crítico y equipo desanimado.
        tipos = {a["tipo"] for a in d["alertas"]}
        assert tipos == {"clima_riesgo"} and d["calibracion"]["nivel"] == "alta"
        riesgo = next(a for a in d["alertas"] if a["tipo"] == "clima_riesgo")
        assert riesgo["supervisor_id"] == s1 and "me quiero ir" in riesgo["detalle"] and "Perez" not in riesgo["detalle"]
        r = await ac.put(f"{BASE}/parametros", headers=coord, json={"pesos_dia": [1, 1, 1, 1, 1, 0.5, 0], "clima_alertas": "todas"})
        assert r.status_code == 200, r.text
        d = (await ac.get(f"{BASE}/control/clima?auto=true", headers=gerente)).json()
        tipos = {a["tipo"] for a in d["alertas"]}
        assert {"clima_riesgo", "clima_critico", "clima_equipo"} <= tipos, tipos

        # En el centro de comandos: las ve quien tiene el clima; el auditor (ve el tablero) no, ni puede actuar sobre ellas.
        cg = (await ac.get(f"{BASE}/comando", headers=gerente)).json()
        assert any(a["clima"] for a in cg["alertas"])
        ca = (await ac.get(f"{BASE}/comando", headers=auditor)).json()
        assert not any(a["tipo"].startswith("clima_") for a in ca["alertas"])
        assert any(a["tipo"].startswith("clima_") for a in cg["alertas"])
        r = await ac.post(f"{BASE}/comando/alertas/{riesgo['id']}/tomar", headers=auditor, json={"nota": "Lo vi"})
        assert r.status_code in (403, 404)
        r = await ac.post(f"{BASE}/comando/alertas/{riesgo['id']}/tomar", headers=gerente, json={"nota": "Charlamos con Silvia en privado."})
        assert r.status_code == 200 and r.json()["estado"] == "tomada"
        lin = (await ac.get(f"{BASE}/supervisores/{s1}/linea", headers=auditor)).json()
        assert not any("Clima" in (e["titulo"] or "") for e in lin["eventos"])

        # Calibración: útil o falsa alarma (que además la descarta). El supervisor y el controller no calibran.
        r = await ac.post(f"{BASE}/control/clima/alertas/{riesgo['id']}/calibrar", headers=gerente, json={"util": True})
        assert r.status_code == 200 and r.json()["util"] is True
        critico = next(a for a in d["alertas"] if a["tipo"] == "clima_critico")
        r = await ac.post(f"{BASE}/control/clima/alertas/{critico['id']}/calibrar", headers=coord, json={"util": False})
        assert r.status_code == 200 and r.json()["estado"] == "descartada" and r.json()["util"] is False
        assert (await ac.post(f"{BASE}/control/clima/alertas/{critico['id']}/calibrar", headers=controller, json={"util": True})).status_code == 403
        d = (await ac.get(f"{BASE}/control/clima?auto=true", headers=gerente)).json()
        assert d["calibracion"]["marcadas"] == 2 and d["calibracion"]["pct_util"] == 50

        # De noche, la IA (simulada) relee los textos del día; el pedido va sin nombres.
        pedidos = []

        async def falso(pedido):
            pedidos.append(pedido)
            ids = [ln.split(" ", 1)[0] for ln in pedido.splitlines()]
            return ([{"id": i, "sentimiento": -80, "emocion": "frustracion", "intensidad": "alta", "tono": "critico",
                      "riesgo": False, "por_que": "Prueba"} for i in ids], settings.analisis_modelo, 1000, 200)

        monkeypatch.setattr(settings, "anthropic_api_key", "clave-de-prueba")
        monkeypatch.setattr(clima, "_consultar", falso)
        assert clima.ia_estado() == "activa"
        async with AsyncSessionLocal() as db:
            assert reloj["hoy"] in await clima.pendientes_ia(db, reloj["hoy"], reloj["ahora"].replace(hour=1) + timedelta(days=1))
            x = await clima.analizar_dia(db, reloj["hoy"])
            assert x.estado == "listo" and x.textos >= 7 and x.costo_usd > 0
        todo = "\n".join(pedidos)
        for nombre in ("Silvia", "Sergio", "Perez", "Ana", "Benitez", "Gomez"):
            assert nombre not in todo, nombre
        assert "S1" in todo and "S2" in todo
        reloj["ahora"] += timedelta(minutes=5)
        d = (await ac.get(f"{BASE}/control/clima?auto=true", headers=gerente)).json()
        assert d["resumen"]["con_ia"]
        eq = {f["id"]: f for f in d["equipos"]}
        assert eq[s2]["animo"] < 0 and eq[s2]["tonos"] == {"critico": 1}       # la IA reemplaza a las reglas en esos textos

        # El simulador (desarrollo) también anda sin clave.
        monkeypatch.setattr(settings, "anthropic_api_key", "")
        monkeypatch.setattr(settings, "analisis_simulador", True)
        async with AsyncSessionLocal() as db:
            x = await clima.analizar_dia(db, reloj["hoy"] - timedelta(days=1))
            assert x.estado == "listo" and x.costo_usd == 0 and x.modelo.startswith("simulador")

        # Rango: la serie por día y quién mejoró o bajó.
        reloj["hoy"], reloj["ahora"] = date(2026, 10, 13), datetime(2026, 10, 13, 15, tzinfo=timezone.utc)
        await ac.put(f"{BASE}/portal/cierre", headers=sup1, json={
            "resultados": "Muy buen día, logramos el objetivo y el equipo está motivado.", "compromiso": "Seguir con los monitoreos.",
            "como_termino": "bien", "cumplio_anterior": "cumplido"})
        d = (await ac.get(f"{BASE}/control/clima?desde=2026-10-07&hasta=2026-10-13", headers=gerente)).json()
        assert d["modo"] == "rango" and len(d["dias"]) == 7 and d["dias"][-1]["lideres"] is not None
        d = (await ac.get(f"{BASE}/control/clima?desde=2026-10-12&hasta=2026-10-13", headers=gerente)).json()
        assert next(c for c in d["cambios"] if c["id"] == s1)["delta"] > 0       # del día difícil al día bueno
        assert (await ac.get(f"{BASE}/control/clima?desde=2026-01-01&hasta=2026-10-13", headers=gerente)).status_code == 400

        # La foto de un día anterior queda guardada (no se recalcula en cada consulta).
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select
            from app.operativas.televentas_claro.supervision.models import ClimaDia
            f = (await db.execute(select(ClimaDia).where(ClimaDia.supervisor_id == s1, ClimaDia.fecha == date(2026, 10, 12)))).scalar_one()
            antes = f.calculado_at
        await ac.get(f"{BASE}/control/clima?auto=true", headers=gerente)
        async with AsyncSessionLocal() as db:
            f = (await db.execute(select(ClimaDia).where(ClimaDia.supervisor_id == s1, ClimaDia.fecha == date(2026, 10, 12)))).scalar_one()
            assert f.calculado_at == antes and f.con_ia
            assert (await db.execute(select(ClimaIA))).scalars().first() is not None


def test_alertas_de_estado():
    from app.operativas.televentas_claro.supervision.models import ClimaDia
    hoy = date(2026, 10, 15)                       # jueves
    p = {"pesos_dia": [1, 1, 1, 1, 1, 0.5, 0], "feriados": [], "clima_alertas": "todas"}

    def foto(f, *, cierre=True, etiqueta="neutral", estado="neutro", cumplio=None, fb=5, comp=0, comp_asesor=0, animo=0.0):
        return ClimaDia(supervisor_id="s", fecha=f, lider_animo=animo, lider_compromiso=70, lider_estado=estado,
                        equipo_animo=None, equipo_compromiso=None, equipo_estado="sin_datos", datos={
                            "feedbacks": fb, "cierre": cierre, "senales": {"cierre_etiqueta": etiqueta if cierre else None, "riesgos": [],
                                                                         "cumplio_anterior": cumplio, "compromisos": comp,
                                                                         "compromisos_asesor": comp_asesor}})
    fotos = {("s", hoy - timedelta(days=k)): foto(hoy - timedelta(days=k), etiqueta="negativo", estado="cansado", cumplio="no_cumplido",
                                                   comp=2) for k in (2, 3, 4)}
    fotos[("s", hoy - timedelta(days=1))] = foto(hoy - timedelta(days=1), etiqueta="negativo", estado="cansado", cumplio="no_cumplido", comp=2)
    tipos = {t for t, _ in clima.condiciones(fotos, hoy=hoy, p=p, nombres={"s": "Silvia"})}
    assert {"clima_negativos", "clima_cansado", "clima_compromiso", "clima_sin_voz"} <= tipos, tipos
    assert "clima_sin_cierre" not in tipos
    # Dos días hábiles trabajados (con devoluciones) sin cierre.
    fotos = {("s", hoy - timedelta(days=k)): foto(hoy - timedelta(days=k), cierre=False) for k in (1, 2)}
    tipos = {t for t, _ in clima.condiciones(fotos, hoy=hoy, p=p, nombres={})}
    assert "clima_sin_cierre" in tipos
    # En calibración (solo altas) se abren solo las de severidad alta.
    fotos = {("s", hoy - timedelta(days=k)): foto(hoy - timedelta(days=k), etiqueta="negativo", estado="cansado") for k in (1, 2, 3)}
    tipos = {t for t, _ in clima.condiciones(fotos, hoy=hoy, p={**p, "clima_alertas": "alta"}, nombres={})}
    assert tipos == {"clima_negativos", "clima_cansado"}
    # Caída repentina contra el promedio de los 7 días anteriores.
    fotos = {("s", hoy - timedelta(days=k)): foto(hoy - timedelta(days=k), animo=40.0) for k in range(1, 6)}
    fotos[("s", hoy)] = foto(hoy, animo=-10.0)
    assert ("clima_caida", f"s:lider_animo:{hoy.isoformat()}") in clima.condiciones(fotos, hoy=hoy, p=p, nombres={})
