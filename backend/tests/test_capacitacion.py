"""Capacitación y Mentoría: perfiles de un solo módulo, grupos y postulantes con sus estados según el papel, el link
seguro con el IPV que se corrige solo, la ficha, el seguimiento dictado y las estadísticas por sexo y edad."""
from __future__ import annotations

import asyncio
import io
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from pypdf import PdfReader

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
        # Sin volver atrás: una respuesta guardada no cambia (reenviarla igual, por falta de señal, no es error)
        # y no se puede saltear situaciones para volver después.
        otra = next(x for x in ipv.OPCIONES[1] if x != resp["1"])
        assert (await ac.put(f"{P}/{token}/ipv", json={"respuestas": {"1": resp["1"], "40": resp["40"]}})).json()["respondidas"] == 40
        r = await ac.put(f"{P}/{token}/ipv", json={"respuestas": {"1": otra}})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "respuesta_fija"
        r = await ac.put(f"{P}/{token}/ipv", json={"respuestas": {"45": ipv.OPCIONES[45][0]}})
        assert r.status_code == 400 and r.json()["detail"]["code"] == "fuera_de_orden"
        assert (await ac.post(f"{P}/{token}/ipv/terminar", json={"respuestas": {**resp, "1": otra}})).status_code == 409
        assert (await ac.get(f"{P}/{token}/ipv")).json()["respuestas"]["1"] == resp["1"]       # quedó la original
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

        # Ficha del postulante: IPV corregido, comentarios con el texto transcripto y conteos.
        f = (await ac.get(f"{B}/postulantes/{diego}", headers=men)).json()
        assert f["ipv"]["estado"] == "terminado" and len(f["ipv"]["resultado"]["escalas"]) == 12 and f["ipv"]["dgv"]
        assert f["conteo"] == {"feedback": 1, "oportunidad": 1, "postulante": 2, "total": 4}
        assert all(c["texto"] for c in f["comentarios"])                           # el dictado se completó solo
        assert {h["tipo"] for h in f["historial"]} >= {"alta", "link", "ipv_inicio", "ipv_terminado"}
        assert not f["puede"]["link"] and f["rol"] == "mentor"
        # El link lo ve también el mentor (manda entrenamientos por ahí); generarlo o anularlo, no.
        assert f["puede"]["ver_link"] and (await ac.get(f"{B}/postulantes/{diego}/enlace", headers=men)).status_code == 200
        assert (await ac.delete(f"{B}/postulantes/{diego}/enlace", headers=men)).status_code == 403

        # La ficha en PDF: con el resultado del IPV como título y los mismos permisos que la ficha.
        r = await ac.get(f"{B}/postulantes/{diego}/pdf", headers=men)
        assert r.status_code == 200 and r.content.startswith(b"%PDF") and r.headers["content-type"] == "application/pdf"
        assert "Ficha_Diego-Espinola_" in r.headers["content-disposition"] and r.headers["cache-control"] == "no-store"
        texto = " ".join(pg.extract_text() for pg in PdfReader(io.BytesIO(r.content)).pages)
        dgv = f["ipv"]["resultado"]["escalas"][0]
        assert f"DGV {dgv['decatipo']}" in texto and ipv.NIVELES_IPV[dgv["nivel"]].upper() in texto
        assert "FICHA DEL POSTULANTE" in texto and "Escuchar más antes de ofrecer" in texto and "7123456" in texto
        assert (await ac.get(f"{B}/postulantes/{diego}/pdf", headers=men2)).status_code == 404
        _, sup = await _nuevo(ac, admin, "supervisor")
        assert (await ac.get(f"{B}/postulantes/{diego}/pdf", headers=sup)).status_code == 403

        # Borrar: solo una carga por error (sin IPV ni comentarios).
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


# ------------------------------------------------------------------ entrenamientos con IA
from types import SimpleNamespace  # noqa: E402

from app.operativas.capacitacion import entrenamiento_ia as eia  # noqa: E402
from app.operativas.capacitacion import entrenamientos as ent  # noqa: E402

CASO = {"titulo": "Portabilidad desconfiada", "cliente_nombre": "Rosa Benítez", "cliente_edad": 52,
        "situacion": "Tiene Tigo hace 10 años y le llegó una promo de Claro.", "objetivo": "Saber si le conviene pasarse.",
        "actitud": {"rasgos": ["desconfiado", "detallista"], "paciencia": 2, "cordialidad": 3, "desconfianza": 5, "interes": 3,
                    "habla": 2, "tecnologia": 2},
        "objeciones": ["¿Y si después me suben el precio?", "No quiero perder mi número"],
        "info_correcta": ["El plan cuesta 99.000 Gs por mes", "Conserva su número con la portabilidad"], "max_turnos": 6}


def _respuesta(*textos):
    """Una respuesta falsa de la Responses API con varios bloques de texto (como cuando el modelo agrega uno de más)."""
    return SimpleNamespace(output=[SimpleNamespace(type="message", content=[SimpleNamespace(type="output_text", text=t)]) for t in textos],
                           output_text="".join(textos), usage=SimpleNamespace(input_tokens=120, output_tokens=30))


def test_extraer_json_robusto():
    ok = '{"mensajes": ["Hola", "¿Cuánto sale?"], "fin": false, "motivo": "sigue"}'
    assert eia.extraer_json(_respuesta("Pensando...", ok), ["mensajes", "fin", "motivo"])["mensajes"] == ["Hola", "¿Cuánto sale?"]
    assert eia.extraer_json(_respuesta('{"otro": 1}'), ["mensajes"]) is None
    assert "desconfía" in eia.describir_cliente(CASO) and "Paciencia: poca" in eia.describir_cliente(CASO)
    ins = eia.instrucciones_cliente({**CASO, "entrenamiento": {}}, empresa="Claro", canal="whatsapp", restantes=1)
    assert "Rosa Benítez" in ins and "último mensaje" in ins and "99.000" not in ins     # el cliente no conoce los precios
    assert "99.000" in eia.instrucciones_eval(CASO, empresa="Claro", producto="Plan 99.000 Gs")


@pytest.mark.asyncio
async def test_cliente_y_evaluador_con_openai_falso(monkeypatch):
    """La llamada a OpenAI (sin red): modelo, salida estructurada estricta y lectura robusta del JSON."""
    llamadas = []

    class Falso:
        def __init__(self, **kw):
            self.responses = self

        async def create(self, **kw):
            llamadas.append(kw)
            if kw["text"]["format"]["name"] == "respuesta_cliente":
                return _respuesta('{"mensajes": ["Mmm", "¿y eso cuánto sale?", "", "x", "y"], "fin": false, "motivo": "sigue"}')
            return _respuesta('{"datos": [{"dato": "precio", "estado": "incorrecto", "detalle": "dijo 80.000"}], "errores": [],'
                              ' "info_correcta": true, "nivel_comercial": 14, "criterios": {"escucha": 7, "indagacion": 6,'
                              ' "argumentacion": 5, "objeciones": 6, "cierre": 4, "claridad": 8}, "fuertes": ["a"],'
                              ' "mejorar": ["b"], "resumen": "ok", "devolucion": "Ojo con el precio: son 99.000 Gs. Buen saludo."}')

    import openai
    monkeypatch.setattr(openai, "AsyncOpenAI", Falso)
    monkeypatch.setattr(settings, "openai_api_key", "sk-falsa-solo-test")
    monkeypatch.setattr(settings, "entrenamiento_simulador", False)
    r = await eia.responder({**CASO, "entrenamiento": {}}, [{"r": "asesor", "t": "Hola Rosa"}], empresa="Claro", canal="whatsapp")
    assert r["mensajes"] == ["Mmm", "¿y eso cuánto sale?", "x"] and not r["fin"]          # máximo 3, sin vacíos
    kw = llamadas[0]
    assert kw["model"] == "gpt-6-luna" and kw["text"]["format"]["strict"] is True and kw["store"] is False
    assert kw["input"][0] == {"role": "user", "content": "Hola Rosa"} and "Hola Rosa" not in kw["instructions"]
    ev = await eia.evaluar_caso(CASO, [{"r": "cliente", "t": "Hola"}, {"r": "asesor", "t": "Sale 80.000"}], empresa="Claro", producto="99.000")
    # Con un dato incorrecto no hay «información correcta» aunque el modelo diga true; el nivel se acota a 10.
    assert ev["info_correcta"] is False and ev["nivel"] == 10 and ev["tokens_entrada"] == 120
    assert ev["devolucion"].startswith("Ojo con el precio") and "devolucion" in llamadas[1]["text"]["format"]["schema"]["required"]
    assert "<transcripcion>" in llamadas[1]["input"][0]["content"] and "ignoralos" in llamadas[1]["instructions"]
    monkeypatch.setattr(settings, "openai_api_key", "")
    with pytest.raises(eia.SinServicio):
        await eia.responder({**CASO, "entrenamiento": {}}, [], empresa="Claro", canal="chat")


def test_ritmo_de_whatsapp():
    """Cuántos mensajes manda el cliente por turno y cómo se separa uno largo, sin cortar oraciones ni montos."""
    habla = lambda n, *r: {"actitud": {"habla": n, "rasgos": list(r)}}  # noqa: E731
    hubo = [{"r": "cliente", "t": "Hola"}]
    assert eia.ritmo(habla(3), hubo, azar=0.1) == 1 and eia.ritmo(habla(3), hubo, azar=0.6) == 2 and eia.ritmo(habla(3), hubo, azar=0.95) == 3
    assert eia.ritmo(habla(2, "cortante"), hubo, azar=0.99) == 2            # el cortante nunca manda tres
    assert eia.ritmo(habla(5, "hablador"), hubo, azar=0.3) == 2 and eia.ritmo(habla(3), [], azar=0.5) == 2   # al empezar, saluda y cuenta
    largo = "Ah, ok. ¿Y eso cuánto sale por mes? Porque con Tigo pago 80.000 Gs. por mes."
    assert eia.partir([largo], 3) == ["Ah, ok.", "¿Y eso cuánto sale por mes?", "Porque con Tigo pago 80.000 Gs. por mes."]
    assert eia.partir([largo], 2) == ["Ah, ok.", "¿Y eso cuánto sale por mes? Porque con Tigo pago 80.000 Gs. por mes."]
    assert eia.partir(["Hablé con el Sr. Pérez. Me dijo que sí."], 2) == ["Hablé con el Sr. Pérez.", "Me dijo que sí."]
    assert eia.partir(["El plan de 99.000 está bien"], 3) == ["El plan de 99.000 está bien"]   # una sola oración: no se corta
    assert eia.partir(["Hola", "¿Qué tal?"], 1) == ["Hola", "¿Qué tal?"]


@pytest.mark.asyncio
async def test_el_cliente_manda_varios_mensajes(monkeypatch):
    """Cuando le toca mandar varios, se le pide al modelo; si igual manda uno largo, se separa en burbujas."""
    llamadas = []

    class Falso:
        def __init__(self, **kw):
            self.responses = self

        async def create(self, **kw):
            llamadas.append(kw)
            return _respuesta('{"mensajes": ["Mmm, no sé. ¿Y si después me suben el precio? Ya me pasó con Tigo."], "fin": false, "motivo": "sigue"}')

    import openai
    monkeypatch.setattr(openai, "AsyncOpenAI", Falso)
    monkeypatch.setattr(settings, "openai_api_key", "sk-falsa-solo-test")
    monkeypatch.setattr(settings, "entrenamiento_simulador", False)
    monkeypatch.setattr(eia, "_azar", lambda: 0.99)
    hist = [{"r": "cliente", "t": "Hola"}, {"r": "asesor", "t": "Hola Rosa, el plan sale 99.000 Gs."}]
    r = await eia.responder({**CASO, "entrenamiento": {}}, hist, empresa="Claro", canal="whatsapp")
    assert r["mensajes"] == ["Mmm, no sé.", "¿Y si después me suben el precio?", "Ya me pasó con Tigo."]
    assert "3 mensajes seguidos" in llamadas[0]["instructions"]
    monkeypatch.setattr(eia, "_azar", lambda: 0.0)
    r = await eia.responder({**CASO, "entrenamiento": {}}, hist, empresa="Claro", canal="whatsapp")
    assert len(r["mensajes"]) == 1 and "un solo mensaje" in llamadas[1]["instructions"]


@pytest.mark.asyncio
async def test_el_cliente_no_repite_su_saludo(monkeypatch):
    """El modelo a veces manda el mismo saludo dos veces (o repite el del principio): se saca; si todo era repetido,
    se le pide una vez más."""
    respuestas = iter([
        '{"mensajes": ["Hola, buenas tardes.", "hola buenas tardes", "Quería consultar por un plan"], "fin": false, "motivo": "sigue"}',
        '{"mensajes": ["Hola, quería consultar por un plan."], "fin": false, "motivo": "sigue"}',
        '{"mensajes": ["¿Y cuánto me sale por mes?"], "fin": false, "motivo": "sigue"}',
    ])
    llamadas = []

    class Falso:
        def __init__(self, **kw):
            self.responses = self

        async def create(self, **kw):
            llamadas.append(kw)
            return _respuesta(next(respuestas))

    import openai
    monkeypatch.setattr(openai, "AsyncOpenAI", Falso)
    monkeypatch.setattr(settings, "openai_api_key", "sk-falsa-solo-test")
    monkeypatch.setattr(settings, "entrenamiento_simulador", False)
    caso = {**CASO, "entrenamiento": {}}
    r = await eia.responder(caso, [], empresa="Claro", canal="whatsapp")
    assert r["mensajes"] == ["Hola, buenas tardes.", "Quería consultar por un plan"]          # el saludo, una sola vez
    hist = [{"r": "cliente", "t": "Hola, quería consultar por un plan"}, {"r": "asesor", "t": "Hola, ¿en qué te ayudo?"}]
    r = await eia.responder(caso, hist, empresa="Claro", canal="whatsapp")
    assert r["mensajes"] == ["¿Y cuánto me sale por mes?"] and len(llamadas) == 3              # repetía: se pidió de nuevo
    assert "Ojo" in llamadas[2]["instructions"] and "Nunca repetís" in llamadas[0]["instructions"]
    assert eia.sin_repetir(["Ok"], [{"r": "cliente", "t": "Ok"}]) == ["Ok"]                  # lo corto se puede repetir


@pytest.mark.asyncio
async def test_entrenamientos_flujo(monkeypatch):
    monkeypatch.setattr(settings, "entrenamiento_simulador", True)
    monkeypatch.setattr(settings, "openai_api_key", "")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        _, cap = await _nuevo(ac, admin, "capacitador")
        u_men, men = await _nuevo(ac, admin, "mentor")
        _, men2 = await _nuevo(ac, admin, "mentor")
        _, sup = await _nuevo(ac, admin, "supervisor", operativas=("televentas_claro", "capacitacion"))
        g = (await ac.post(f"{B}/grupos", headers=cap, json={"nombre": "Grupo IA", "fecha_inicio": "2026-10-19",
                                                            "mentores": [u_men["id"]]})).json()
        pids = [(await ac.post(f"{B}/grupos/{g['id']}/postulantes", headers=cap,
                               json={"nombre": n, "apellido": "Prueba", "ci": ci, "edad": 25, "sexo": "F"})).json()["id"]
                for n, ci in (("Lía", "8100001"), ("Mora", "8100002"))]

        # El mentor crea el entrenamiento con dos casos; el supervisor no tiene acceso.
        assert (await ac.get(f"{B}/entrenamientos", headers=sup)).status_code == 403
        r = await ac.post(f"{B}/entrenamientos", headers=men, json={"nombre": "Portabilidad", "producto": "Plan 99.000 Gs por mes.",
                                                                   "instrucciones": "Atendé como asesor de Claro."})
        assert r.status_code == 201, r.text
        eid = r.json()["id"]
        assert (await ac.post(f"{B}/entrenamientos/{eid}/casos", headers=men, json={**CASO, "actitud": {"rasgos": ["volador"]}})).status_code == 422
        c1 = (await ac.post(f"{B}/entrenamientos/{eid}/casos", headers=men, json=CASO)).json()
        c2 = (await ac.post(f"{B}/entrenamientos/{eid}/casos", headers=men,
                            json={**CASO, "titulo": "Cliente apurado", "cliente_nombre": "Hugo", "primer_mensaje": "Hola\n\nRápido porfa"})).json()
        assert (await ac.patch(f"{B}/casos/{c1['id']}", headers=men2, json=CASO)).status_code == 403   # solo quien lo creó
        lista = (await ac.get(f"{B}/entrenamientos", headers=cap)).json()
        assert lista["ia"]["simulador"] and next(x for x in lista["entrenamientos"] if x["id"] == eid)["casos"] == 2

        # Probar un caso: el mentor hace de asesor y ve la evaluación al momento.
        s = (await ac.post(f"{B}/casos/{c2['id']}/probar", headers=men)).json()
        assert [m["t"] for m in s["mensajes"]] == ["Hola", "Rápido porfa"]                       # dos mensajes seguidos
        c3 = (await ac.post(f"{B}/entrenamientos/{eid}/casos", headers=men, json={**CASO, "primer_mensaje": "Hola!\n\nhola"})).json()
        s3 = (await ac.post(f"{B}/casos/{c3['id']}/probar", headers=men)).json()
        assert [m["t"] for m in s3["mensajes"]] == ["Hola!"]                                     # sin el saludo repetido
        assert (await ac.delete(f"{B}/casos/{c3['id']}", headers=men)).status_code == 200
        r = (await ac.post(f"{B}/sesiones/{s['id']}/mensajes", headers=men, json={"texto": "Hola Hugo, ¿en qué te ayudo?"})).json()
        assert r["nuevos"] and not r["fin"]
        assert (await ac.post(f"{B}/sesiones/{s['id']}/mensajes", headers=cap, json={"texto": "x"})).status_code == 404
        ev = (await ac.post(f"{B}/sesiones/{s['id']}/terminar", headers=men)).json()
        assert ev["estado"] == "terminada" and 1 <= ev["evaluacion"]["nivel"] <= 10

        # Enviar a los postulantes: se les arma el link y aparece en su página.
        r = await ac.post(f"{B}/entrenamientos/{eid}/enviar", headers=men, json={"postulante_ids": pids, "origen": ORIGEN})
        assert r.status_code == 200, r.text
        env = r.json()["enviados"]
        assert all(x["url"].startswith(f"{ORIGEN}/postulante/") for x in env)
        assert (await ac.post(f"{B}/entrenamientos/{eid}/enviar", headers=men2, json={"postulante_ids": pids, "origen": ORIGEN})).status_code == 404
        token = env[0]["url"].rsplit("/", 1)[1]
        pub = (await ac.get(f"{P}/{token}")).json()
        assert pub["entrenamientos"][0]["nombre"] == "Portabilidad" and pub["entrenamientos"][0]["pct"] == 0
        aid = pub["entrenamientos"][0]["id"]
        det = (await ac.get(f"{P}/{token}/entrenamientos/{aid}")).json()
        assert det["total"] == 2 and "producto" not in det and "info_correcta" not in str(det)

        # Caso 1: chat del postulante. No puede escribir dos veces sin respuesta ni ver la evaluación.
        s1 = (await ac.post(f"{P}/{token}/entrenamientos/{aid}/casos/{c1['id']}")).json()
        assert s1["mensajes"][0]["r"] == "cliente" and "evaluacion" not in s1
        again = (await ac.post(f"{P}/{token}/entrenamientos/{aid}/casos/{c1['id']}")).json()
        assert again["id"] == s1["id"]                                                          # retoma la misma
        textos = ["Hola Rosa, soy Ana de Claro. ¿Qué plan tenés hoy?", "El plan cuesta 99.000 Gs por mes y conservás tu número con la portabilidad.",
                  "¿Te parece si lo dejamos listo hoy?"]
        for t in textos:
            r = (await ac.post(f"{P}/{token}/sesiones/{s1['id']}/mensajes", json={"texto": t})).json()
            if r["fin"]:
                break
        assert (await ac.post(f"{P}/{token}/sesiones/{s1['id']}/mensajes", json={"texto": "x" * 1001})).status_code == 422
        fin = (await ac.post(f"{P}/{token}/sesiones/{s1['id']}/terminar")).json()
        assert fin["estado"] == "terminada" and "evaluacion" not in fin
        assert (await ac.get(f"{P}/{token}/sesiones/{s1['id']}/devolucion")).json() == {"estado": "evaluando"}
        assert (await ac.post(f"{P}/{token}/sesiones/{s1['id']}/mensajes", json={"texto": "hola"})).status_code == 409
        # El otro postulante no puede ver esta conversación con su link.
        token2 = env[1]["url"].rsplit("/", 1)[1]
        assert (await ac.get(f"{P}/{token2}/sesiones/{s1['id']}")).status_code == 404

        # Avance: 1 de 2 casos (el IPV no cuenta).
        grupo = (await ac.get(f"{B}/grupos/{g['id']}", headers=cap)).json()
        lia = next(p for p in grupo["postulantes"] if p["id"] == pids[0])
        assert lia["avance"]["pct"] == 50 and lia["avance"]["casos"] == 2 and grupo["avance"] == 25

        # Caso 2 y evaluación en segundo plano.
        s2 = (await ac.post(f"{P}/{token}/entrenamientos/{aid}/casos/{c2['id']}")).json()
        await ac.post(f"{P}/{token}/sesiones/{s2['id']}/mensajes", json={"texto": "Hola Hugo, ¿qué necesitás?"})
        await ac.post(f"{P}/{token}/sesiones/{s2['id']}/terminar")
        assert await ent.procesar_pendientes() >= 2
        await ent.procesar_pendientes()
        # La devolución corta del caso para el postulante: sin puntajes ni recomendación.
        dev = (await ac.get(f"{P}/{token}/sesiones/{s1['id']}/devolucion")).json()
        assert dev["estado"] == "lista" and dev["devolucion"] and set(dev) == {"estado", "info_ok", "devolucion", "corregir"}
        assert (await ac.get(f"{P}/{token2}/sesiones/{s1['id']}/devolucion")).status_code == 404       # la de otro, no
        det = (await ac.get(f"{P}/{token}/entrenamientos/{aid}")).json()
        assert det["terminado"] and set(det["devolucion_final"]) == {"fuertes", "mejorar"} and "aprobado" not in str(det)
        assert det["casos"][0]["info_ok"] is True and "info_correcta" not in str(det)
        ficha = (await ac.get(f"{B}/postulantes/{pids[0]}/entrenamientos", headers=men)).json()["entrenamientos"][0]
        res = ficha["resultado"]
        assert ficha["estado"] == "terminado" and ficha["pct"] == 100 and res["casos"] == 2
        assert set(res) >= {"perfil_comercial", "informacion_correcta", "aprobado", "recomendacion", "resumen", "mejorar", "nivel_promedio"}
        assert res["aprobado"] == (res["perfil_comercial"] and res["informacion_correcta"])
        assert res["info_ok"] == 1 and res["info_pct"] == 50.0 and res["aprobado"] is False   # el caso 2 no dio la información
        conv = (await ac.get(f"{B}/sesiones/{ficha['casos_detalle'][0]['sesion']['id']}", headers=cap)).json()
        assert conv["evaluacion"]["info_correcta"] is True and any(m["r"] == "asesor" for m in conv["mensajes"])
        assert (await ac.get(f"{B}/sesiones/{conv['id']}", headers=men2)).status_code == 404
        # La guía del equipo (15 entrenamientos por postulante) y el historial de la ficha.
        grupo = (await ac.get(f"{B}/grupos/{g['id']}", headers=cap)).json()
        lia = next(p for p in grupo["postulantes"] if p["id"] == pids[0])
        assert lia["avance"]["terminados"] == 1 and lia["avance"]["meta"] == 15 and lia["avance"]["meta_cumplida"] is False
        assert grupo["meta"]["entrenamientos"] == 15 and grupo["meta"]["cumplen"] == 0
        # La media de sus conversaciones evaluadas (aunque sea un solo entrenamiento), en la tabla del grupo.
        media = lia["avance"]["resultado"]
        assert media["casos"] == 2 and media["info_pct"] == 50 and media["nivel"] == res["nivel_promedio"]
        assert media["tramo"] in ("alto", "medio", "bajo") and media["tramo_nombre"]
        assert grupo["resultado"]["casos"] == 2
        assert next(p for p in grupo["postulantes"] if p["id"] == pids[1])["avance"]["resultado"] is None
        hist = (await ac.get(f"{B}/postulantes/{pids[0]}", headers=cap)).json()["historial"]
        assert any(h["tipo"] == "entrenamiento" and h["a"] == "no_aprobado" and h["detalle"] == "Portabilidad" for h in hist)
        assert any(h["tipo"] == "entrenamiento_enviado" and h["detalle"] == "Portabilidad" for h in hist)
        texto = " ".join(pg.extract_text() for pg in PdfReader(io.BytesIO(
            (await ac.get(f"{B}/postulantes/{pids[0]}/pdf", headers=men)).content)).pages)
        assert "Portabilidad" in texto and "No recomendado" in texto and "Para mejorar" in texto
        assert media["tramo_nombre"].upper() in texto and "Media de 2 conversaciones evaluadas" in texto
        assert (await ac.get(f"{B}/postulantes/{pids[0]}/entrenamientos", headers=men)).json()["resultado"] == media

        # Reiniciar y quitar.
        assert (await ac.delete(f"{B}/asignaciones/{aid}", headers=cap)).status_code == 409
        assert (await ac.post(f"{B}/asignaciones/{aid}/reiniciar", headers=cap)).json() == {"ok": True}
        assert (await ac.get(f"{P}/{token}")).json()["entrenamientos"][0]["pct"] == 0
        assert (await ac.delete(f"{B}/asignaciones/{aid}", headers=cap)).json() == {"ok": True}
        # Un entrenamiento enviado se archiva en vez de borrarse.
        assert (await ac.delete(f"{B}/entrenamientos/{eid}", headers=men)).json()["archivado"] is True


@pytest.mark.asyncio
async def test_entrenamientos_en_lote_en_vivo_y_repetir(monkeypatch):
    from app.operativas.capacitacion import entrenamientos as ent

    monkeypatch.setattr(settings, "entrenamiento_simulador", True)
    monkeypatch.setattr(settings, "openai_api_key", "")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        _, cap = await _nuevo(ac, admin, "capacitador")
        u_men, men = await _nuevo(ac, admin, "mentor")
        _, men2 = await _nuevo(ac, admin, "mentor")
        _, sup = await _nuevo(ac, admin, "supervisor", operativas=("televentas_claro", "capacitacion"))
        g = (await ac.post(f"{B}/grupos", headers=cap, json={"nombre": "Grupo Vivo", "fecha_inicio": "2026-10-19",
                                                            "mentores": [u_men["id"]]})).json()
        pid = (await ac.post(f"{B}/grupos/{g['id']}/postulantes", headers=cap,
                             json={"nombre": "Sol", "apellido": "Vivo", "ci": "8200001", "edad": 22, "sexo": "F"})).json()["id"]
        eid = (await ac.post(f"{B}/entrenamientos", headers=men, json={"nombre": "Upgrade", "producto": "Plan 99.000 Gs."})).json()["id"]
        c1 = (await ac.post(f"{B}/entrenamientos/{eid}/casos", headers=men, json=CASO)).json()
        env = (await ac.post(f"{B}/entrenamientos/{eid}/enviar", headers=men, json={"postulante_ids": [pid], "origen": ORIGEN})).json()
        token = env["enviados"][0]["url"].rsplit("/", 1)[1]
        aid = (await ac.get(f"{P}/{token}")).json()["entrenamientos"][0]["id"]
        s = (await ac.post(f"{P}/{token}/entrenamientos/{aid}/casos/{c1['id']}")).json()

        # En vivo: el mentor y el capacitador del grupo la ven; otro mentor no; el supervisor no tiene acceso.
        vivo = (await ac.get(f"{B}/en-vivo", headers=men)).json()
        fila = next(x for x in vivo["sesiones"] if x["id"] == s["id"])
        assert fila["estado"] == "responde_asesor" and fila["postulante"]["nombre"] == "Sol" and fila["entrenamiento"] == "Upgrade"
        assert vivo["kpis"]["en_chat"] == 1 and vivo["postulantes"][0]["vivo"] == "en_chat"
        assert (await ac.get(f"{B}/en-vivo", headers=cap, params={"grupo": g["id"]})).json()["kpis"]["en_chat"] == 1
        otro = (await ac.get(f"{B}/en-vivo", headers=men2)).json()
        assert otro["sesiones"] == [] and otro["grupos"] == []
        assert (await ac.get(f"{B}/en-vivo", headers=men2, params={"grupo": g["id"]})).status_code == 404
        assert (await ac.get(f"{B}/en-vivo", headers=sup)).status_code == 403
        monitor = (await ac.get(f"{B}/sesiones/{s['id']}", headers=men)).json()
        assert monitor["objetivo"] == CASO["objetivo"] and monitor["info_correcta"] == CASO["info_correcta"]
        assert (await ac.get(f"{B}/sesiones/{s['id']}", headers=men2)).status_code == 404

        # Varios mensajes seguidos en un lote: el cliente contesta una vez y cuenta como un turno.
        lote = "lote-0001-abc"
        textos = ["Hola Rosa!", "Soy Sol de Claro.", "¿Qué plan tenés hoy?"]
        r = (await ac.post(f"{P}/{token}/sesiones/{s['id']}/mensajes", json={"textos": textos, "lote": lote})).json()
        assert r["nuevos"] and r["sesion"]["turnos"] == 1
        asesor = [m for m in r["sesion"]["mensajes"] if m["r"] == "asesor"]
        assert [m["t"] for m in asesor] == textos and all(m["lote"] == lote for m in asesor)
        # El mismo lote reenviado (se cortó la conexión): devuelve lo mismo y no duplica.
        again = (await ac.post(f"{P}/{token}/sesiones/{s['id']}/mensajes", json={"textos": textos, "lote": lote})).json()
        assert again["repetido"] and again["nuevos"] == r["nuevos"] and len(again["sesion"]["mensajes"]) == len(r["sesion"]["mensajes"])
        assert (await ac.post(f"{P}/{token}/sesiones/{s['id']}/mensajes", json={"textos": ["x"] * 7})).status_code == 422
        assert (await ac.post(f"{P}/{token}/sesiones/{s['id']}/mensajes", json={"textos": ["   "]})).status_code == 400
        assert (await ac.post(f"{P}/{token}/sesiones/{s['id']}/mensajes", json={"textos": ["ok"], "lote": "<script>"})).status_code == 422
        from app.core.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            assert await ent.respuestas_hoy(db, pid) == 1
        vivo = (await ac.get(f"{B}/en-vivo", headers=men)).json()
        fila = next(x for x in vivo["sesiones"] if x["id"] == s["id"])
        assert fila["turnos"] == 1 and fila["ultimo"]["r"] == "cliente" and fila["resp_media"] is not None

        # Termina el caso y se evalúa: aparece en lo de hoy.
        await ac.post(f"{P}/{token}/sesiones/{s['id']}/terminar")
        while await ent.procesar_pendientes():
            pass
        vivo = (await ac.get(f"{B}/en-vivo", headers=men)).json()
        assert vivo["kpis"]["en_chat"] == 0 and vivo["kpis"]["casos_hoy"] == 1 and vivo["kpis"]["entrenamientos_hoy"] == 1
        assert vivo["recientes"][0]["id"] == s["id"] and vivo["recientes"][0]["nivel"] is not None
        assert vivo["postulantes"][0]["casos_hoy"] == 1 and vivo["postulantes"][0]["terminados"] == 1

        # Sin tope: lo puede repetir (otro intento) y el anterior queda con su resultado.
        ya = (await ac.post(f"{B}/entrenamientos/{eid}/enviar", headers=men, json={"postulante_ids": [pid], "origen": ORIGEN})).json()
        assert ya["enviados"][0]["ya_enviado"] is True
        rep = (await ac.post(f"{B}/entrenamientos/{eid}/enviar", headers=men,
                             json={"postulante_ids": [pid], "origen": ORIGEN, "repetir": True})).json()
        assert rep["enviados"][0]["ya_enviado"] is False and rep["enviados"][0]["intento"] == 2
        otra = (await ac.post(f"{B}/entrenamientos/{eid}/enviar", headers=men,
                              json={"postulante_ids": [pid], "origen": ORIGEN, "repetir": True})).json()
        assert otra["enviados"][0]["ya_enviado"] is True                                  # el 2.º todavía no lo terminó
        pub = (await ac.get(f"{P}/{token}")).json()["entrenamientos"]
        assert sorted((x["intento"], x["estado"]) for x in pub) == [(1, "terminado"), (2, "pendiente")]
        ficha = (await ac.get(f"{B}/postulantes/{pid}/entrenamientos", headers=cap)).json()["entrenamientos"]
        assert len(ficha) == 2 and ficha[0]["resultado"] is not None
        lista = next(x for x in (await ac.get(f"{B}/entrenamientos", headers=men)).json()["entrenamientos"] if x["id"] == eid)
        assert lista["enviados"] == 1 and lista["terminados"] == 1                          # personas, no intentos
        a2 = next(x["id"] for x in pub if x["intento"] == 2)
        s2 = (await ac.post(f"{P}/{token}/entrenamientos/{a2}/casos/{c1['id']}")).json()
        assert s2["id"] != s["id"]
        await ac.post(f"{P}/{token}/sesiones/{s2['id']}/mensajes", json={"texto": "Hola, ¿cómo estás?"})
        await ac.post(f"{P}/{token}/sesiones/{s2['id']}/terminar")
        while await ent.procesar_pendientes():
            pass
        grupo = (await ac.get(f"{B}/grupos/{g['id']}", headers=cap)).json()
        assert grupo["postulantes"][0]["avance"]["terminados"] == 2                         # cada intento terminado suma
