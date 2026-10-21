"""Capacitación y Mentoría: perfiles de un solo módulo, grupos y postulantes con sus estados según el papel, el link
seguro con el IPV que se corrige solo, la ficha, el seguimiento dictado y las estadísticas por sexo y edad."""
from __future__ import annotations

import asyncio
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.core.database import Base, engine
from app.main import app
from app.operativas.capacitacion import audios as cap_audios
from app.operativas.capacitacion import ipv
from app.operativas.capacitacion.ipv_datos import BAREMOS, CLAVE

B = "/api/v1/capacitacion"
P = f"{B}/publico"
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 4000
ORIGEN = "https://app.voicenter.com.py"


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


async def _nuevo(ac, admin, role, operativas=("televentas_claro",), nombre=None):
    email = f"{role}-{uuid.uuid4().hex[:6]}@voicenter.com.py"
    r = await ac.post("/api/v1/users", headers=admin, json={
        "email": email, "password": "Clave1234!", "full_name": nombre or f"Usuario {role}", "role": role, "operativas": list(operativas)})
    assert r.status_code == 201, r.text
    return r.json(), await _login(ac, email)


# ------------------------------------------------------------------ IPV
def test_correccion_ipv():
    # Todas las respuestas que suman en cada escala: máximo en todas (tolerancia se puntúa al revés: 8 − coincidencias).
    clave = {n: letra for esc, items in CLAVE.items() if esc != "tolerancia" for n, letra in items}
    resp = {n: clave.get(n, ops[0]) for n, ops in ipv.OPCIONES.items()}
    r = ipv.corregir(resp, segundos=1200)
    esc = {x["clave"]: x for x in r["escalas"]}
    assert len(r["escalas"]) == 12 and esc["comprension"]["directo"] == len(CLAVE["comprension"])
    assert esc["receptividad"]["directo"] == sum(esc[k]["directo"] for k in ipv.RECEPTIVIDAD)
    assert esc["agresividad"]["directo"] == sum(esc[k]["directo"] for k in ipv.AGRESIVIDAD)
    assert all(1 <= x["decatipo"] <= 10 and x["nivel"] in ipv.NIVELES_IPV for x in r["escalas"])
    assert esc["dominancia"]["decatipo"] == BAREMOS["dominancia"][esc["dominancia"]["directo"]]
    assert r["resumen"].startswith("Disposición general para la venta") and not any("rápido" in s for s in r["senales"])
    # Señales de calidad: muy rápido y siempre la misma letra.
    todo_a = {n: "A" for n in ipv.OPCIONES}
    s = ipv.corregir(todo_a, segundos=120)["senales"]
    assert any("rápido" in x for x in s) and any("«A»" in x for x in s)
    with pytest.raises(ipv.RespuestasInvalidas):
        ipv.corregir({1: "A"})
    with pytest.raises(ipv.RespuestasInvalidas):
        ipv.validar({14: "C"}, completas=False)        # el ítem 14 solo tiene A y B
    assert len(ipv.cuestionario()) == 87 and "clave" not in str(ipv.cuestionario()[0])


def test_pruebas_en_papel():
    r = ipv.corregir_pruebas({"domino_aciertos": 39, "distribuida_aciertos": 33,
                              "concentrada_aciertos": 200, "concentrada_omisiones": 30, "concentrada_errores": 10})
    assert r["domino"]["percentil"] == 75 and r["domino"]["nivel"] == "superior_tm"
    assert r["distribuida"]["puntaje"] == 64.7 and r["distribuida"]["nivel"] == "termino_medio"
    assert r["concentrada"]["puntaje"] == round((200 - 40) / 230 * 100, 1)
    with pytest.raises(ipv.RespuestasInvalidas):
        ipv.corregir_pruebas({"concentrada_aciertos": 220, "concentrada_omisiones": 20})
    assert ipv.corregir_pruebas({}) == {}


# ------------------------------------------------------------------ perfiles
@pytest.mark.asyncio
async def test_perfiles_de_un_solo_modulo():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        u, cap = await _nuevo(ac, admin, "capacitador", operativas=("televentas_claro",))
        assert u["operativas"] == ["capacitacion"]                    # se fuerza el módulo, aunque se elija otro
        me = (await ac.get("/api/v1/auth/me", headers=cap)).json()
        assert set(me["permissions"]) == {"capacitacion.ver", "capacitacion.capacitar"}
        assert (await ac.get("/api/v1/televentas-claro/productividad/pbi/publicado", headers=cap)).status_code == 403

        # Cambio de perfil: de supervisor a mentor queda solo en el módulo.
        s, _ = await _nuevo(ac, admin, "supervisor")
        r = await ac.patch(f"/api/v1/users/{s['id']}", headers=admin, json={"role": "mentor"})
        assert r.status_code == 200 and r.json()["operativas"] == ["capacitacion"]
        # Y de mentor a supervisor vuelve a elegir operativas.
        r = await ac.patch(f"/api/v1/users/{s['id']}", headers=admin, json={"role": "supervisor", "operativas": ["televentas_claro"]})
        assert r.json()["operativas"] == ["televentas_claro"]

        _, rrhh = await _nuevo(ac, admin, "rrhh")
        me = (await ac.get("/api/v1/auth/me", headers=rrhh)).json()
        assert set(me["permissions"]) == {"capacitacion.ver", "capacitacion.capacitar", "capacitacion.mentoria", "capacitacion.total"}
        _, ger = await _nuevo(ac, admin, "gerente", operativas=("televentas_claro", "capacitacion"))
        assert "capacitacion.total" in (await ac.get("/api/v1/auth/me", headers=ger)).json()["permissions"]
        _, sup = await _nuevo(ac, admin, "supervisor", operativas=("televentas_claro", "capacitacion"))
        assert (await ac.get(f"{B}/resumen", headers=sup)).status_code == 403

        # Creación rápida con perfil Mentor: el link queda en el módulo.
        r = await ac.post("/api/v1/invitaciones", headers=admin, json={"perfil": "mentor", "operativas": ["televentas_claro"], "origen": ORIGEN})
        assert r.status_code == 201 and [o["slug"] for o in r.json()["operativas"]] == ["capacitacion"]


# ------------------------------------------------------------------ flujo completo
@pytest.mark.asyncio
async def test_grupo_postulantes_ipv_y_seguimiento(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "transcripcion_simulador", True)
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    monkeypatch.setattr(settings, "openai_api_key", "")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        u_cap, cap = await _nuevo(ac, admin, "capacitador", nombre="Carla Capacitadora")
        _, cap2 = await _nuevo(ac, admin, "capacitador")
        u_men, men = await _nuevo(ac, admin, "mentor", nombre="Mario Mentor")
        _, men2 = await _nuevo(ac, admin, "mentor")
        _, rrhh = await _nuevo(ac, admin, "rrhh")

        gente = (await ac.get(f"{B}/personas", headers=cap)).json()
        assert u_cap["id"] in {x["id"] for x in gente["capacitadores"]} and u_men["id"] in {x["id"] for x in gente["mentores"]}
        assert (await ac.get(f"{B}/personas", headers=men)).status_code == 403

        # El capacitador crea su grupo con un mentor; el mentor no puede crear.
        r = await ac.post(f"{B}/grupos", headers=cap, json={"nombre": "Grupo Octubre", "operacion": "Claro Pospago",
                                                           "fecha_inicio": "2026-10-19", "mentores": [u_men["id"]]})
        assert r.status_code == 201, r.text
        g = r.json()
        assert g["capacitador"]["nombre"] == "Carla Capacitadora" and g["estado"] == "en_curso" and g["duracion_dias"] >= 1
        gid = g["id"]
        assert (await ac.post(f"{B}/grupos", headers=men, json={"nombre": "Grupo X", "fecha_inicio": "2026-10-19"})).status_code == 403
        bad = await ac.post(f"{B}/grupos", headers=cap, json={"nombre": "Grupo Y", "fecha_inicio": "2026-10-19", "mentores": [u_cap["id"]]})
        assert bad.status_code == 400

        # Visibilidad: el otro capacitador y el otro mentor no lo ven; RRHH sí.
        assert (await ac.get(f"{B}/grupos/{gid}", headers=cap2)).status_code == 404
        assert (await ac.get(f"{B}/grupos/{gid}", headers=men2)).status_code == 404
        assert [x["id"] for x in (await ac.get(f"{B}/resumen", headers=men)).json()["grupos"]] == [gid]
        assert gid in [x["id"] for x in (await ac.get(f"{B}/resumen", headers=rrhh)).json()["grupos"]]

        # Postulantes: los carga el capacitador; la cédula no se repite en el grupo.
        datos = [("Ana", "Benítez", "4.123.456", 22, "F"), ("Bruno", "Cáceres", "5123456", 31, "M"),
                 ("Carla", "Duarte", "6123456", 27, "F"), ("Diego", "Espínola", "7123456", 45, "M")]
        pids = []
        for n, a, ci, e, s in datos:
            r = await ac.post(f"{B}/grupos/{gid}/postulantes", headers=cap, json={"nombre": n, "apellido": a, "ci": ci, "edad": e, "sexo": s})
            assert r.status_code == 201, r.text
            assert r.json()["estado"] == "en_capacitacion" and "aprobo_escrita" in r.json()["puede"]
            pids.append(r.json()["id"])
        assert (await ac.post(f"{B}/grupos/{gid}/postulantes", headers=cap,
                              json={"nombre": "Otra", "apellido": "Ana", "ci": "4123456", "edad": 20, "sexo": "F"})).status_code == 409
        assert (await ac.post(f"{B}/grupos/{gid}/postulantes", headers=men,
                              json={"nombre": "Otra", "apellido": "Ana", "ci": "9999999", "edad": 20, "sexo": "F"})).status_code == 403
        ana, bruno, carla, diego = pids

        # Estados: el mentor no puede antes de la escrita; el capacitador no carga los del piso.
        est = lambda h, pid, e, m=None: ac.post(f"{B}/postulantes/{pid}/estado", headers=h, json={"estado": e, "motivo": m})  # noqa: E731
        assert (await est(men, ana, "aprobo_mentoria")).status_code == 403
        assert (await est(cap, ana, "aprobo_escrita")).status_code == 200
        assert (await est(cap, ana, "aprobo_mentoria")).status_code == 403
        assert (await est(men, ana, "alta_operativa")).status_code == 403        # primero mentoría y OJT
        assert (await est(men, ana, "aprobo_mentoria")).status_code == 200
        r = await est(men, ana, "alta_operativa")
        assert r.status_code == 200 and r.json()["estado_nombre"] == "Alta operativa" and r.json()["etapa_max"] == 3
        assert (await est(cap, ana, "baja", "x")).status_code == 403             # ya no es de la sala
        assert (await est(cap, bruno, "abandono")).status_code == 400            # el motivo es obligatorio
        assert (await est(cap, bruno, "abandono", "Consiguió otro trabajo")).status_code == 200
        assert (await est(cap, carla, "aprobo_escrita")).status_code == 200
        r = await est(men, carla, "baja", "No cumple el horario")
        assert r.status_code == 200 and r.json()["etapa_max"] == 1 and r.json()["motivo"] == "No cumple el horario"
        assert "aprobo_escrita" in r.json()["puede"]                            # el mentor puede deshacer la salida

        # Link seguro: lo genera el capacitador; el mentor no. Al postulante que abandonó no se le genera.
        assert (await ac.post(f"{B}/postulantes/{diego}/enlace", headers=men, json={"origen": ORIGEN})).status_code == 403
        assert (await ac.post(f"{B}/postulantes/{bruno}/enlace", headers=cap, json={"origen": ORIGEN})).status_code == 400
        assert (await ac.post(f"{B}/postulantes/{diego}/enlace", headers=cap, json={"origen": "javascript:x"})).status_code == 400
        r = await ac.post(f"{B}/postulantes/{diego}/enlace", headers=cap, json={"origen": ORIGEN})
        assert r.status_code == 200 and r.json()["url"].startswith(f"{ORIGEN}/postulante/") and "<svg" in r.json()["qr_svg"]
        token = r.json()["url"].rsplit("/", 1)[1]
        assert (await ac.get(f"{B}/postulantes/{diego}/enlace", headers=cap)).json()["url"].endswith(token)

        # El postulante: ve su nombre de pila, contesta de a poco y retoma.
        pub = (await ac.get(f"{P}/{token}")).json()
        assert pub["nombre"] == "Diego" and pub["ipv"]["estado"] == "pendiente" and "ci" not in pub and "apellido" not in pub
        q = (await ac.get(f"{P}/{token}/ipv")).json()
        assert len(q["preguntas"]) == 87 and q["respuestas"] == {}
        resp = {str(n): ops[-1] for n, ops in ipv.OPCIONES.items()}
        primeras = dict(list(resp.items())[:40])
        assert (await ac.put(f"{P}/{token}/ipv", json={"respuestas": primeras})).json()["respondidas"] == 40
        assert (await ac.put(f"{P}/{token}/ipv", json={"respuestas": {"14": "C"}})).status_code == 400
        assert len((await ac.get(f"{P}/{token}/ipv")).json()["respuestas"]) == 40
        assert (await ac.post(f"{P}/{token}/ipv/terminar", json={"respuestas": {}})).status_code == 400   # faltan
        # Regenerar el link: el anterior deja de valer y lo respondido se conserva.
        r = await ac.post(f"{B}/postulantes/{diego}/enlace", headers=cap, json={"origen": ORIGEN})
        nuevo = r.json()["url"].rsplit("/", 1)[1]
        assert (await ac.get(f"{P}/{token}")).status_code == 404 and r.json()["respondidas"] == 40
        resto = dict(list(resp.items())[40:])
        assert (await ac.post(f"{P}/{nuevo}/ipv/terminar", json={"respuestas": resto})).json() == {"terminado": True}
        assert (await ac.put(f"{P}/{nuevo}/ipv", json={"respuestas": {"1": "A"}})).status_code == 409
        assert (await ac.get(f"{P}/{nuevo}/ipv")).json()["preguntas"] == []          # terminado: ya no se muestra
        assert "resultado" not in (await ac.get(f"{P}/{nuevo}")).text                  # el postulante no ve resultados

        # El postulante deja su feedback (escrito y dictado).
        assert (await ac.post(f"{P}/{nuevo}/comentarios", json={"texto": "Me gustó la práctica en piso"})).status_code == 201
        a = (await ac.post(f"{P}/{nuevo}/audios", data={"duracion": "4"}, files={"archivo": ("g.webm", WEBM, "audio/webm")})).json()
        assert a["estado"] == "pendiente"
        assert (await ac.post(f"{P}/{nuevo}/comentarios", json={"texto": "", "audio_id": a["id"]})).status_code == 201
        assert (await ac.post(f"{P}/{nuevo}/audios", data={"duracion": "4"},
                              files={"archivo": ("g.webm", b"<html>" * 300, "audio/webm")})).status_code == 400

        # Seguimiento del equipo: el mentor dicta, el capacitador escribe una oportunidad de mejora.
        a2 = (await ac.post(f"{B}/postulantes/{diego}/audios", headers=men, data={"duracion": "6"},
                            files={"archivo": ("g.webm", WEBM, "audio/webm")})).json()
        r = await ac.post(f"{B}/postulantes/{diego}/comentarios", headers=men, json={"tipo": "feedback", "texto": "", "audio_id": a2["id"]})
        assert r.status_code == 201 and r.json()["autor_rol"] == "mentor" and r.json()["texto"] == ""
        assert (await ac.post(f"{B}/postulantes/{diego}/comentarios", headers=cap, json={"tipo": "oportunidad", "audio_id": a["id"]})).status_code == 404
        assert (await ac.post(f"{B}/postulantes/{diego}/comentarios", headers=cap,
                              json={"tipo": "oportunidad", "texto": "Escuchar más antes de ofrecer"})).status_code == 201
        assert (await ac.post(f"{B}/postulantes/{diego}/comentarios", headers=cap2, json={"texto": "x"})).status_code == 404
        assert await cap_audios.procesar_pendientes() == 2
        assert (await ac.get(f"{B}/audios/{a2['id']}", headers=men)).json()["estado"] == "listo"
        assert (await ac.get(f"{B}/audios/{a2['id']}/archivo", headers=cap)).content == WEBM

        # Pruebas en papel.
        r = await ac.put(f"{B}/postulantes/{diego}/pruebas", headers=cap, json={"domino_aciertos": 39, "distribuida_aciertos": 33})
        assert r.status_code == 200 and r.json()["pruebas"]["resultado"]["domino"]["percentil"] == 75
        assert (await ac.put(f"{B}/postulantes/{diego}/pruebas", headers=men, json={"domino_aciertos": 1})).status_code == 403

        # Ficha del postulante: IPV corregido, comentarios con el texto transcripto y conteos.
        f = (await ac.get(f"{B}/postulantes/{diego}", headers=men)).json()
        assert f["ipv"]["estado"] == "terminado" and len(f["ipv"]["resultado"]["escalas"]) == 12 and f["ipv"]["dgv"]
        assert f["conteo"] == {"feedback": 1, "oportunidad": 1, "postulante": 2, "total": 4}
        assert all(c["texto"] for c in f["comentarios"])                           # el dictado se completó solo
        assert {h["tipo"] for h in f["historial"]} >= {"alta", "link", "ipv_inicio", "ipv_terminado", "pruebas"}
        assert not f["puede"]["link"] and f["rol"] == "mentor"

        # Borrar: solo una carga por error (sin IPV, pruebas ni comentarios).
        assert (await ac.delete(f"{B}/postulantes/{diego}", headers=cap)).status_code == 409
        extra = (await ac.post(f"{B}/grupos/{gid}/postulantes", headers=cap,
                               json={"nombre": "Error", "apellido": "Carga", "ci": "1111111", "edad": 18, "sexo": "X"})).json()
        assert (await ac.delete(f"{B}/postulantes/{extra['id']}", headers=cap)).json() == {"ok": True}

        # El grupo: embudo, efectividad, IPV, feedback y estadísticas por sexo y edad.
        d = (await ac.get(f"{B}/grupos/{gid}", headers=rrhh)).json()
        e = d["embudo"]
        assert e["total"] == 4 and e["altas"] == 1 and e["efectividad"] == 25.0 and e["salidas"] == 2 and e["aprobaron_escrita"] == 2
        assert d["ipv"]["realizados"] == 1 and d["ipv"]["porcentaje"] == 25.0
        sexo = {x["clave"]: x for x in d["estadisticas"]["sexo"]}
        assert sexo["F"]["total"] == 2 and sexo["F"]["altas"] == 1 and sexo["F"]["efectividad"] == 50.0 and sexo["M"]["ipv"] == 1
        edad = {x["clave"]: x for x in d["estadisticas"]["edad"]}
        assert edad["18_24"]["total"] == 1 and edad["45_mas"]["total"] == 1 and "menos_18" not in edad
        assert d["feedback_detalle"]["total"] == 4 and d["feedback_detalle"]["sin_feedback"] == 3

        # Estado del grupo: solo capacitador o gestión; cancelar pide motivo; cancelado = solo lectura y links cerrados.
        assert (await ac.post(f"{B}/grupos/{gid}/estado", headers=men, json={"estado": "finalizada"})).status_code == 400
        assert (await ac.post(f"{B}/grupos/{gid}/estado", headers=cap, json={"estado": "cancelada"})).status_code == 400
        r = await ac.post(f"{B}/grupos/{gid}/estado", headers=cap, json={"estado": "cancelada", "motivo": "Se suspendió la campaña"})
        assert r.status_code == 200 and r.json()["estado"] == "cancelada" and r.json()["fecha_fin"]
        assert (await ac.get(f"{P}/{nuevo}")).status_code == 410
        assert all(p["puede"] == [] for p in (await ac.get(f"{B}/grupos/{gid}", headers=cap)).json()["postulantes"])
        r = await ac.post(f"{B}/grupos/{gid}/estado", headers=cap, json={"estado": "en_curso"})
        assert r.json()["estado"] == "en_curso" and r.json()["fecha_fin"] is None
        assert (await ac.post(f"{B}/grupos/{gid}/estado", headers=cap, json={"estado": "finalizada"})).json()["estado_nombre"] == "Finalizada"

        # Tablero general de RRHH.
        t = (await ac.get(f"{B}/resumen", headers=rrhh)).json()
        assert t["totales"]["finalizados"] >= 1 and t["totales"]["embudo"]["altas"] >= 1 and t["puede"]["gestion"]
        assert (await ac.get(f"{B}/resumen?estado=cancelada", headers=rrhh)).json()["grupos"] == []

        # Links inválidos: 404 y, repetidos, límite por IP.
        assert (await ac.get(f"{P}/{'x' * 43}")).status_code == 404
