"""Tickets de revisión con SLA (modelo Líder Coach Comercial, fase 4): horas hábiles, plazos por prioridad,
reloj que se detiene mientras se esperan datos, cierre automático, reaperturas, reasignación y el puntaje."""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import AsyncSessionLocal, Base, engine
from app.main import app
from app.operativas.televentas_claro.supervision import api as sup_api
from app.operativas.televentas_claro.supervision import tickets as tickets_srv
from app.operativas.televentas_claro.supervision.models import EquipoAsignacion, Operador
from app.operativas.televentas_claro.supervision.sla import Horario, estado, percentil, plazos, validar_horario

Z = ZoneInfo("America/Asuncion")
BASE = "/api/v1/televentas-claro/supervision"
TC = "televentas_claro"
L = lambda d, hh, mm=0: datetime(2026, 10, d, hh, mm, tzinfo=Z)  # noqa: E731  (octubre de 2026, hora de Asunción)


# ============================ horas hábiles y plazos ============================
def test_horas_habiles_con_sabado_corto_domingo_y_feriados():
    h = Horario()  # de lunes a viernes de 7 a 19, sábado de 8 a 12
    assert h.dia_completo() == 720
    assert {p: plazos(p, h) for p in ("alta", "media", "baja")} == {"alta": (120, 720), "media": (480, 1440), "baja": (720, 3600)}
    assert h.sumar(L(5, 10), 120) == L(5, 12)                 # lunes 10 h + 2 h hábiles
    assert h.sumar(L(5, 18), 120) == L(6, 8)                  # pasa la noche: 1 h el lunes, 1 h el martes
    assert h.sumar(L(9, 18, 30), 120) == L(10, 9, 30)         # viernes → sábado (de 8 a 12)
    assert h.sumar(L(10, 13), 60) == L(12, 8)                 # sábado a la tarde y domingo no cuentan
    assert h.habiles(L(9, 18), L(12, 9)) == 420               # 60 + 240 + 0 + 120
    feriado = Horario(feriados=["2026-10-12"])
    assert feriado.sumar(L(10, 11), 120) == L(13, 8)          # el lunes feriado no cuenta
    with pytest.raises(ValueError):
        validar_horario({"0": ["10:00", "09:00"]})
    with pytest.raises(ValueError):
        validar_horario({str(d): None for d in range(7)})
    assert validar_horario({"0": ["8:00", "16:30"]})["0"] == ["08:00", "16:30"]
    assert percentil([5, 1, 9, 3, 7], 50) == 5 and percentil([5, 1, 9, 3, 7], 90) == 9 and percentil([], 90) is None


def _t(**kw):
    base = {"estado": "nuevo", "created_at": L(5, 10), "respuesta_at": None, "respuesta_min": None, "consumido_min": 0.0,
            "corriendo_desde": L(5, 10), "sla_respuesta_min": 120, "sla_resolucion_min": 720, "motivo_cierre": None}
    return SimpleNamespace(**{**base, **kw})


def test_estado_del_plazo_por_vencer_vencido_y_pausado():
    h = Horario()
    assert estado(_t(), h, L(5, 11))["situacion"] == "en_plazo"
    s = estado(_t(), h, L(5, 11, 30))                         # 90 de 120 min: 75% → por vencer
    assert s["situacion"] == "por_vencer" and s["respuesta"]["vence"] == L(5, 12).astimezone(timezone.utc).isoformat()
    s = estado(_t(), h, L(5, 12, 30))                         # sin respuesta en 2 h: vencido, ya no cumple
    assert s["situacion"] == "vencido" and s["cumple"] is False
    pausado = _t(estado="esperando", respuesta_at=L(5, 10, 30), respuesta_min=30, consumido_min=30, corriendo_desde=None)
    s = estado(pausado, h, L(8, 18))                          # esperando datos: el reloj no corre
    assert s["situacion"] == "pausado" and s["resolucion"]["min"] == 30 and s["resolucion"]["vence"] is None
    resuelto = _t(estado="resuelto", respuesta_at=L(5, 10, 30), respuesta_min=30, consumido_min=300, corriendo_desde=None)
    assert estado(resuelto, h, L(9, 9))["cumple"] is True
    assert estado(_t(estado="cerrado", corriendo_desde=None), h, L(9, 9))["cumple"] is None  # cancelado: no cuenta


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


@pytest.mark.asyncio
async def test_flujo_tickets_con_plazos_en_horas_habiles(monkeypatch):
    reloj = {"t": L(19, 9)}  # lunes 19/10, 9 h
    monkeypatch.setattr(tickets_srv, "ahora", lambda: reloj["t"].astimezone(timezone.utc))
    monkeypatch.setattr(sup_api, "hoy", lambda: reloj["t"].date())

    def a(d, hh, mm=0):
        reloj["t"] = L(d, hh, mm)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        _, coord = await _new_user(ac, admin, "coordinador", "Paola Coordinadora")
        _, auditor = await _new_user(ac, admin, "auditor")
        _, analista = await _new_user(ac, admin, "analista")
        s1, sup1 = await _new_user(ac, admin, "supervisor", "Silvia Uno")
        s2, sup2 = await _new_user(ac, admin, "supervisor", "Sergio Dos")
        async with AsyncSessionLocal() as db:
            ana = Operador(nombre="Perez, Ana", agente_clave="PEREZ, ANA", vendedor="ANA PEREZ", cruce="manual",
                           ultima_vez=date(2026, 10, 18))
            beto = Operador(nombre="Gomez, Beto", agente_clave="GOMEZ, BETO", vendedor="BETO GOMEZ", cruce="manual",
                            ultima_vez=date(2026, 10, 18))
            db.add_all([ana, beto])
            await db.flush()
            db.add_all([  # Ana con Silvia hasta el 14/10 y con Sergio desde el 15; Beto con Silvia
                EquipoAsignacion(periodo="2026-10", operador_id=ana.id, supervisor_id=s1, desde=date(2026, 10, 1)),
                EquipoAsignacion(periodo="2026-10", operador_id=ana.id, supervisor_id=s2, desde=date(2026, 10, 15)),
                EquipoAsignacion(periodo="2026-10", operador_id=beto.id, supervisor_id=s1, desde=date(2026, 10, 1)),
            ])
            await db.commit()
            ana_id, beto_id = ana.id, beto.id

        nuevo = lambda **kw: {"tipo": "venta_observada", "prioridad": "alta", "descripcion": "Venta con datos del titular incompletos.", **kw}  # noqa: E731
        op = {a["nombre"]: a for a in (await ac.get(f"{BASE}/tickets/opciones", headers=coord)).json()["asesores"]}
        assert op["Perez, Ana"]["supervisor"] == "Sergio Dos" and op["Gomez, Beto"]["supervisor"] == "Silvia Uno"
        # Llega al supervisor que tenía a la asesora el día del caso (Silvia, el 10/10), aunque hoy esté con Sergio.
        d = (await ac.get(f"{BASE}/tickets/destino", headers=coord, params={"operador_id": ana_id, "fecha": "2026-10-10"})).json()
        assert d["supervisor"] == "Silvia Uno"
        r = await ac.post(f"{BASE}/tickets", headers=coord, json=nuevo(operador_id=ana_id, fecha_caso="2026-10-10", referencia="SDS 24650384"))
        assert r.status_code == 201, r.text
        t1 = r.json()
        assert t1["numero"] == 1 and t1["supervisor"] == "Silvia Uno" and t1["estado"] == "nuevo"
        assert t1["sla"]["respuesta"]["plazo"] == 120 and t1["sla"]["resolucion"]["plazo"] == 720
        assert t1["eventos"][0]["tipo"] == "creado" and t1["acciones"] == ["comentar", "reasignar", "cancelar"]
        # Sin asesor hay que elegir el supervisor; el analista mira pero no envía; el supervisor tampoco.
        assert (await ac.post(f"{BASE}/tickets", headers=coord, json=nuevo(prioridad="media"))).status_code == 400
        t2 = (await ac.post(f"{BASE}/tickets", headers=auditor, json=nuevo(prioridad="media", tipo="reclamo", supervisor_id=s1))).json()
        t3 = (await ac.post(f"{BASE}/tickets", headers=coord, json=nuevo(prioridad="baja", tipo="linea_sin_uso", operador_id=beto_id))).json()
        t4 = (await ac.post(f"{BASE}/tickets", headers=coord, json=nuevo(prioridad="baja", tipo="otro", supervisor_id=s1))).json()
        assert [t["numero"] for t in (t2, t3, t4)] == [2, 3, 4] and t3["supervisor"] == "Silvia Uno"
        assert (await ac.post(f"{BASE}/tickets", headers=analista, json=nuevo(supervisor_id=s1))).status_code == 403
        assert (await ac.post(f"{BASE}/tickets", headers=sup1, json=nuevo(supervisor_id=s1))).status_code == 403
        assert (await ac.post(f"{BASE}/tickets", headers=coord, json=nuevo(operador_id=ana_id, fecha_caso="2026-10-25"))).status_code == 400
        assert (await ac.get(f"{BASE}/tickets", headers=analista)).status_code == 200

        # Cada supervisor ve solo los suyos.
        assert {t["numero"] for t in (await ac.get(f"{BASE}/portal/tickets", headers=sup1)).json()["items"]} == {1, 2, 3, 4}
        assert (await ac.get(f"{BASE}/portal/tickets", headers=sup2)).json()["items"] == []
        assert (await ac.get(f"{BASE}/portal/tickets/{t1['id']}", headers=sup2)).status_code == 404
        assert (await ac.post(f"{BASE}/portal/tickets/{t1['id']}/responder", headers=sup2, json={"texto": "No es mío este caso"})).status_code == 404

        # 10:00 primera respuesta (1 h de 2); 10:30 pide datos del 3 (el reloj se detiene).
        a(19, 10)
        r = await ac.post(f"{BASE}/portal/tickets/{t1['id']}/responder", headers=sup1, json={"texto": "Escucho la venta y te cuento."})
        assert r.status_code == 200 and r.json()["estado"] == "en_gestion" and r.json()["sla"]["respuesta"]["min"] == 60
        assert r.json()["sla"]["respuesta"]["cumplio"] is True
        a(19, 10, 30)
        r = await ac.post(f"{BASE}/portal/tickets/{t3['id']}/pedir-datos", headers=sup1, json={"texto": "¿Qué línea es? No figura en el SDS."})
        assert r.json()["estado"] == "esperando" and r.json()["sla"]["situacion"] == "pausado"
        # 11:00 pide datos del 1; los datos llegan a las 13:00: esas 2 horas no cuentan.
        a(19, 11)
        await ac.post(f"{BASE}/portal/tickets/{t1['id']}/pedir-datos", headers=sup1, json={"texto": "Necesito el número de la línea."})
        a(19, 13)
        r = await ac.post(f"{BASE}/tickets/{t1['id']}/comentario", headers=coord, json={"texto": "La línea es 0981 123 456."})
        assert r.json()["estado"] == "en_gestion" and r.json()["sla"]["resolucion"]["min"] == 120
        a(19, 14)
        r = await ac.post(f"{BASE}/portal/tickets/{t1['id']}/resolver", headers=sup1, json={"texto": "Se corrigió la venta con el titular."})
        assert r.json()["estado"] == "resuelto" and r.json()["sla"]["resolucion"]["min"] == 180 and r.json()["sla"]["cumple"] is True
        assert "reabrir" in (await ac.get(f"{BASE}/tickets/{t1['id']}", headers=coord)).json()["acciones"]
        assert (await ac.post(f"{BASE}/tickets/{t4['id']}/cancelar", headers=coord, json={"texto": "Enviado por error"})).json()["estado"] == "cerrado"

        # 17:30: el 2 (media, 8 h) sigue sin respuesta: vencido. Primero en la bandeja.
        a(19, 17, 30)
        b = (await ac.get(f"{BASE}/tickets", headers=coord)).json()
        assert [t["numero"] for t in b["items"]][0] == 2 and b["items"][0]["sla"]["situacion"] == "vencido"
        assert b["bandeja"]["vencidos"] == 1 and b["mes"]["total"] == 4
        p = (await ac.get(f"{BASE}/portal", headers=sup1)).json()["coaching"]
        assert (p["tickets_nuevos"], p["tickets_vencidos"]) == (1, 1)

        # Martes: reabre el 1 (no se resolvió); el reloj sigue desde 180 min y la reapertura queda contada.
        a(20, 10)
        r = await ac.post(f"{BASE}/tickets/{t1['id']}/reabrir", headers=coord, json={"texto": "El cliente sigue sin la corrección."})
        assert r.json()["estado"] == "en_gestion" and r.json()["reaperturas"] == 1
        a(20, 11)
        r = await ac.post(f"{BASE}/portal/tickets/{t1['id']}/resolver", headers=sup1, json={"texto": "Corregido en el sistema de Claro."})
        assert r.json()["sla"]["resolucion"]["min"] == 240
        assert [e["tipo"] for e in r.json()["eventos"]] == ["creado", "respuesta", "pedido_datos", "datos", "resuelto", "reabierto", "resuelto"]

        # Miércoles 11:00: el 3 esperaba datos desde el lunes 10:30 (2 días hábiles): se cerró solo a las 10:30.
        a(21, 11)
        t = (await ac.get(f"{BASE}/tickets/{t3['id']}", headers=coord)).json()
        assert t["estado"] == "cerrado" and t["motivo_cierre"] == "sin_respuesta" and t["eventos"][-1]["por"] == "Sistema"
        assert t["cerrado_at"] == L(21, 10, 30).astimezone(timezone.utc).isoformat()

        # Reasignar: un caso de Ana de hoy llega a Sergio; la coordinadora lo pasa a Silvia.
        t5 = (await ac.post(f"{BASE}/tickets", headers=coord, json=nuevo(prioridad="baja", operador_id=ana_id))).json()
        assert t5["supervisor"] == "Sergio Dos"
        r = await ac.post(f"{BASE}/tickets/{t5['id']}/reasignar", headers=coord, json={"supervisor_id": s1, "texto": "Lo sigue Silvia"})
        assert r.json()["supervisor"] == "Silvia Uno" and r.json()["eventos"][-1]["datos"] == {"de": s2, "a": s1}

        # Puntaje de tickets de Silvia: el 1 en plazo, el 2 vencido; el 3 (sin datos) y el 4 (cancelado) no cuentan;
        # el 5 todavía está en curso.
        partes = {x["clave"]: x for x in (await ac.get(f"{BASE}/portal/coaching", headers=sup1)).json()["scoring"]["partes"]}
        assert partes["tickets"]["rel"] == 0.5 and partes["tickets"]["detalle"] == "1 de 2 tickets respondidos y resueltos en plazo · 1 en curso"
        m = next(f for f in (await ac.get(f"{BASE}/tickets", headers=coord, params={"vista": "mes"})).json()["supervisores"] if f["id"] == s1)["mes"]
        assert m["cumplimiento"] == 50.0 and m["respuesta"]["mediana"] == 60 and m["reaperturas"] == 1 and m["cerrados"] == 2

        # El horario de atención sale del calendario: con jornadas de 8 h, el día hábil de plazo pasa a 480 min.
        cal = {"pesos_dia": [1, 1, 1, 1, 1, 0.5, 0], "no_laborables": []}
        assert (await ac.put(f"{BASE}/parametros", headers=coord, json={**cal, "horario": {"0": ["10:00", "09:00"]}})).status_code == 400
        horario = {**{str(i): ["08:00", "16:00"] for i in range(5)}, "5": None, "6": None}
        assert (await ac.put(f"{BASE}/parametros", headers=coord, json={**cal, "horario": horario})).status_code == 200
        assert (await ac.get(f"{BASE}/tickets", headers=coord)).json()["info"]["plazos"]["alta"] == {"respuesta": 120, "resolucion": 480}
