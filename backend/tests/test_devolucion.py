"""Coaching con devolución firmada desde el celular: monitoreos y feedback, compromisos del asesor, audios con su
transcripción (simulada: los tests nunca llaman a OpenAI), firma con huella, comprobante, alta de asesores, pedidos
de pase y el Control de supervisores de los jefes."""
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
from app.operativas.televentas_claro.supervision import api as sup_api
from app.operativas.televentas_claro.supervision import audios as audios_srv
from app.operativas.televentas_claro.supervision import coaching as coaching_srv
from app.operativas.televentas_claro.supervision.models import CoachingAudio, Operador
from tests.firma_helper import firmar, png

BASE = "/api/v1/televentas-claro/supervision"
TC = "televentas_claro"
D = lambda m, d: date(2026, m, d)  # noqa: E731
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 4000           # cabecera EBML de un WebM (Android)
MP4 = b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 4000    # cabecera ftyp de un MP4/M4A (iPhone)


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


def test_tipo_real_del_audio_y_precio():
    assert audios_srv.tipo_real(WEBM[:16]) == ("audio/webm", "webm")
    assert audios_srv.tipo_real(MP4[:16]) == ("audio/mp4", "m4a")
    assert audios_srv.tipo_real(b"OggS" + b"\x00" * 12) == ("audio/ogg", "ogg")
    assert audios_srv.tipo_real(b"RIFF\x00\x00\x00\x00WAVEfmt ") == ("audio/wav", "wav")
    assert audios_srv.tipo_real(b"<html><script>") is None and audios_srv.tipo_real(b"\x89PNG\r\n\x1a\n" + b"\x00" * 8) is None
    assert audios_srv.precio_minuto("gpt-transcribe") == 0.0045 and audios_srv.precio_minuto("gpt-4o-mini-transcribe") == 0.003
    assert audios_srv.precio_minuto("gpt-4o-transcribe-2025-12-15") == 0.006


def test_huella_estable_y_sensible_al_contenido():
    base = {"coaching": "c1", "items": [{"texto": "a"}], "compromisos": [{"texto": "b"}], "firmado_at": "2026-10-12T15:00:00+00:00"}
    h = coaching_srv.huella(base)
    assert len(h) == 64 and h == coaching_srv.huella(dict(reversed(list(base.items()))))
    assert h != coaching_srv.huella({**base, "compromisos": [{"texto": "b."}]})


@pytest.mark.asyncio
async def test_devolucion_firmada_audios_alta_y_control(monkeypatch, tmp_path):
    reloj = {"hoy": D(10, 12), "ahora": datetime(2026, 10, 12, 14, 0, tzinfo=timezone.utc)}
    monkeypatch.setattr(sup_api, "hoy", lambda: reloj["hoy"])
    monkeypatch.setattr(coaching_srv, "ahora", lambda: reloj["ahora"])
    monkeypatch.setattr(settings, "transcripcion_simulador", True)
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    ana, beto = await _operadores("Perez, Ana", "Benitez, Beto")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        _, coord = await _new_user(ac, admin, "coordinador")
        _, gerente = await _new_user(ac, admin, "gerente", "Gerardo Gerente")
        _, auditor = await _new_user(ac, admin, "auditor")
        s1, sup1 = await _new_user(ac, admin, "supervisor", "Silvia Uno")
        s2, sup2 = await _new_user(ac, admin, "supervisor", "Sergio Dos")
        for ids, sid in (([ana], s1), ([beto], s2)):
            r = await ac.post(f"{BASE}/equipos/asignar", headers=coord, json={"periodo": "2026-10", "operador_ids": ids, "supervisor_id": sid})
            assert r.status_code == 200, r.text

        # ---- Desde el celular alcanza con el asesor: nace sin firmar, con un seguimiento sugerido.
        r = await ac.post(f"{BASE}/portal/coaching", headers=sup1, json={"operador_id": ana, "tipo": "semanal"})
        assert r.status_code == 201, r.text
        c = r.json()
        cid = c["id"]
        assert (c["estado"], c["fecha"], c["seguimiento_fecha"], c["metricas"]) == ("pendiente", "2026-10-12", "2026-10-19", ["otra"])
        assert c["items"] == [] and c["compromisos"] == [] and c["vence_devolucion"] == "2026-10-14" and not c["devolucion_vencida"]
        assert (await ac.post(f"{BASE}/portal/coaching", headers=sup1, json={"operador_id": beto})).status_code == 400  # no es de su equipo

        # Monitoreos y feedback (la hora la pone el servidor); las métricas del coaching salen de ellos.
        r = await ac.post(f"{BASE}/portal/coaching/{cid}/items", headers=sup1, json={
            "tipo": "monitoreo", "metricas": ["pospago"], "texto": "Presenta el plan sin preguntar el uso actual.", "referencia": "10:42"})
        assert r.status_code == 201, r.text
        assert r.json()["metricas"] == ["pospago"] and r.json()["items"][0]["referencia"] == "10:42"
        reloj["ahora"] += timedelta(minutes=30)
        r = await ac.post(f"{BASE}/portal/coaching/{cid}/items", headers=sup1, json={
            "tipo": "feedback", "metricas": ["uso", "pospago"], "texto": "Repasamos cómo confirmar el uso antes de cerrar."})
        c = r.json()
        assert [i["tipo"] for i in c["items"]] == ["monitoreo", "feedback"] and c["metricas"] == ["pospago", "uso"]
        assert c["diagnostico"].startswith("Monitoreo 12/10 11:00: Presenta el plan") and "Feedback 12/10 11:30" in c["diagnostico"]
        assert (await ac.post(f"{BASE}/portal/coaching/{cid}/items", headers=sup1, json={
            "tipo": "monitoreo", "metricas": ["pospago"], "texto": "no"})).status_code == 400
        assert (await ac.post(f"{BASE}/portal/coaching/{cid}/items", headers=sup2, json={
            "tipo": "monitoreo", "metricas": ["pospago"], "texto": "Ajeno al equipo"})).status_code == 404
        # Se corrige y se quita mientras está sin firmar (queda en el historial).
        reloj["ahora"] += timedelta(minutes=5)
        extra = next(i for i in (await ac.post(f"{BASE}/portal/coaching/{cid}/items", headers=sup1, json={
            "tipo": "monitoreo", "metricas": ["gpon"], "texto": "Cargado por error en este coaching."})).json()["items"] if i["metricas"] == ["gpon"])
        r = await ac.patch(f"{BASE}/portal/coaching/{cid}/items/{extra['id']}", headers=sup1, json={"texto": "Cargado por error, se corrige."})
        assert next(i for i in r.json()["items"] if i["id"] == extra["id"])["texto"] == "Cargado por error, se corrige."
        c = (await ac.delete(f"{BASE}/portal/coaching/{cid}/items/{extra['id']}", headers=sup1)).json()
        assert len(c["items"]) == 2 and c["metricas"] == ["pospago", "uso"]

        # ---- Audio del supervisor: se valida el tipo real, se guarda con su huella y se transcribe en segundo plano.
        assert (await ac.post(f"{BASE}/portal/coaching/{cid}/audios", headers=sup1, data={"duracion": "12"},
                              files={"archivo": ("x.webm", b"<html>" + b"0" * 2000, "audio/webm")})).status_code == 400
        assert (await ac.post(f"{BASE}/portal/coaching/{cid}/audios", headers=sup1, data={"duracion": "900"},
                              files={"archivo": ("x.webm", WEBM, "audio/webm")})).status_code == 400
        reloj["ahora"] += timedelta(minutes=5)
        r = await ac.post(f"{BASE}/portal/coaching/{cid}/audios", headers=sup1, data={"duracion": "32.4", "destino": "item"},
                          files={"archivo": ("grabacion.webm", WEBM, "audio/webm")})
        assert r.status_code == 201, r.text
        a1 = r.json()
        assert a1["estado"] == "pendiente" and a1["mime"] == "audio/webm" and len(a1["sha256"]) == 64 and a1["archivo"]
        # Se guarda el ítem sin esperar la transcripción: el texto llega solo.
        r = await ac.post(f"{BASE}/portal/coaching/{cid}/items", headers=sup1, json={"tipo": "monitoreo", "metricas": ["uso"], "audio_id": a1["id"]})
        assert r.status_code == 201, r.text
        con_audio = next(i for i in r.json()["items"] if i["audio_id"] == a1["id"])
        assert con_audio["texto"] == "" and con_audio["tipo"] == "monitoreo"
        # Mientras no hay texto, no se firma.
        assert (await ac.post(f"{BASE}/portal/coaching/{cid}/firmar", headers=sup1,
                              json={"imagen": png(), "acepto": True, "imagen_supervisor": png()})).status_code in (400, 409)
        assert await audios_srv.procesar_pendientes() == 1
        a = (await ac.get(f"{BASE}/portal/audios/{a1['id']}", headers=sup1)).json()
        assert a["estado"] == "listo" and a["texto"] == audios_srv.SIMULADO and a["modelo"].startswith("simulador")
        c = (await ac.get(f"{BASE}/portal/coaching/{cid}", headers=sup1)).json()
        assert next(i for i in c["items"] if i["audio_id"] == a1["id"])["texto"] == audios_srv.SIMULADO
        assert (await ac.get(f"{BASE}/portal/audios/{a1['id']}", headers=sup2)).status_code == 404
        escuchado = await ac.get(f"{BASE}/portal/audios/{a1['id']}/archivo", headers=sup1)
        assert escuchado.status_code == 200 and escuchado.content == WEBM and escuchado.headers["content-type"] == "audio/webm"

        # ---- Compromisos del asesor: el primero lo dicta él (su voz, de iPhone).
        r = await ac.post(f"{BASE}/portal/coaching/{cid}/audios", headers=sup1, data={"duracion": "9", "hablante": "asesor", "destino": "compromiso"},
                          files={"archivo": ("voz.m4a", MP4, "audio/mp4")})
        a2 = r.json()
        await audios_srv.procesar_pendientes()
        r = await ac.post(f"{BASE}/portal/coaching/{cid}/compromisos", headers=sup1, json={"audio_id": a2["id"], "para": "2026-10-16"})
        assert r.status_code == 201, r.text
        comp = r.json()["compromisos"][0]
        assert (comp["origen"], comp["texto"], comp["para"]) == ("asesor", audios_srv.SIMULADO, "2026-10-16")
        r = await ac.post(f"{BASE}/portal/coaching/{cid}/compromisos", headers=sup1, json={
            "texto": "Hacer dos preguntas de uso antes de ofrecer.", "origen": "supervisor", "metrica": "gpon"})
        assert r.json()["metricas"] == ["pospago", "gpon", "uso"] and r.json()["compromiso"].startswith("1. ")
        assert (await ac.post(f"{BASE}/portal/coaching/{cid}/compromisos", headers=sup1,
                              json={"texto": "Fuera de plazo", "para": "2027-01-01"})).status_code == 400

        # ---- La firma: el asesor acepta y firma; si grabó su voz, tiene que aceptar que quede grabada.
        cuerpo = {"imagen": png(), "acepto": True, "imagen_supervisor": png(180, 60)}
        assert (await ac.post(f"{BASE}/portal/coaching/{cid}/firmar", headers=sup1, json={**cuerpo, "acepto": False})).status_code == 400
        assert (await ac.post(f"{BASE}/portal/coaching/{cid}/firmar", headers=sup1, json=cuerpo)).status_code == 400  # sin consentimiento
        assert (await ac.post(f"{BASE}/portal/coaching/{cid}/firmar", headers=sup1,
                              json={**cuerpo, "consentimiento_audio": True, "imagen": "data:image/png;base64,AAAA"})).status_code == 400
        sin_firma_sup = {k: v for k, v in cuerpo.items() if k != "imagen_supervisor"}
        assert (await ac.post(f"{BASE}/portal/coaching/{cid}/firmar", headers=sup1,
                              json={**sin_firma_sup, "consentimiento_audio": True})).status_code == 400   # no tiene firma guardada
        assert (await ac.put(f"{BASE}/portal/firma", headers=sup1, json={"imagen": png(160, 50)})).status_code == 200
        reloj["ahora"] = datetime(2026, 10, 12, 18, 5, tzinfo=timezone.utc)
        f = await firmar(ac, sup1, cid, consentimiento_audio=True, comentario="Me comprometo a cumplirlo.",
                         imagen_supervisor=None)
        assert f["estado"] == "abierto" and f["devolucion"] == "firmada" and f["firmado_at"].startswith("2026-10-12T18:05")
        asesor = next(x for x in f["firmas"] if x["firmante"] == "asesor")
        assert asesor["nombre"] == "Perez, Ana" and asesor["comentario"] == "Me comprometo a cumplirlo." and asesor["consentimiento_audio"]
        assert asesor["huella"] == f["huella"] and "firmado" in [e["tipo"] for e in f["eventos"]]
        # La huella es la de lo firmado: se recalcula igual con lo que quedó guardado.
        async with AsyncSessionLocal() as db:
            from app.operativas.televentas_claro.supervision.models import Coaching
            cc = await db.get(Coaching, cid)
            auds = {x.id: x.sha256 for x in (await db.execute(select(CoachingAudio).where(CoachingAudio.coaching_id == cid))).scalars().all()}
            cont = coaching_srv.contenido_firmado(cc, await coaching_srv.items_de(db, cid), await coaching_srv.compromisos_de(db, cid), auds,
                                                  asesor="Perez, Ana", firmado_at=cc.firmado_at, comentario="Me comprometo a cumplirlo.",
                                                  comentario_audio=None)
            assert coaching_srv.huella(cont) == f["huella"]
        # Firmado: bloqueado.
        assert (await ac.post(f"{BASE}/portal/coaching/{cid}/items", headers=sup1, json={
            "tipo": "feedback", "metricas": ["uso"], "texto": "Después de firmar no se agrega"})).status_code == 409
        assert (await ac.post(f"{BASE}/portal/coaching/{cid}/audios", headers=sup1, data={"duracion": "5"},
                              files={"archivo": ("x.webm", WEBM, "audio/webm")})).status_code == 409
        assert (await ac.post(f"{BASE}/portal/coaching/{cid}/anular", headers=sup1, json={"motivo": "Ya no"})).status_code == 409
        pdf = await ac.get(f"{BASE}/portal/coaching/{cid}/comprobante", headers=sup1)
        assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF") and pdf.headers["content-type"] == "application/pdf"
        assert (await ac.get(f"{BASE}/coaching/{cid}/comprobante", headers=coord)).status_code == 200

        # ---- Un coaching sin firmar avisa a los 2 días hábiles.
        r = await ac.post(f"{BASE}/portal/coaching", headers=sup2, json={"operador_id": beto, "tipo": "diario"})
        c_beto = r.json()
        reloj["hoy"], reloj["ahora"] = D(10, 15), datetime(2026, 10, 15, 13, 0, tzinfo=timezone.utc)
        hoy2 = (await ac.get(f"{BASE}/portal", headers=sup2)).json()["coaching"]
        assert hoy2["sin_firmar"] == 1 and hoy2["sin_firmar_vencidos"] == 1
        cmd = (await ac.get(f"{BASE}/comando", headers=coord)).json()
        assert any(x["tipo"] == "devolucion_vencida" and x["datos"].get("coaching_id") == c_beto["id"] and x["puede_revision"] for x in cmd["alertas"])
        sergio = next(x for x in cmd["supervisores"] if x["id"] == s2)
        assert sergio["sin_firmar_vencidos"] == 1 and any("sin firmar" in m for m in sergio["motivos"])

        # ---- Alta de asesores: parecidos en todo el maestro; si es otra persona, se fuerza.
        p = (await ac.get(f"{BASE}/portal/asesores/parecidos", headers=sup1, params={"nombre": "Beto Benitez"})).json()["items"]
        assert [(x["nombre"], x["equipo"], x["supervisor"]) for x in p] == [("Benitez, Beto", "otro", "Sergio Dos")]
        r = await ac.post(f"{BASE}/portal/asesores", headers=sup1, json={"nombre": "Beto Benitez"})
        assert r.status_code == 409 and r.json()["detail"]["parecidos"][0]["nombre"] == "Benitez, Beto"
        assert (await ac.post(f"{BASE}/portal/asesores", headers=sup1, json={"nombre": "Unica"})).status_code in (400, 422)
        r = await ac.post(f"{BASE}/portal/asesores", headers=sup1, json={"nombre": "Camila  Gaona Rojas", "documento": "4567890", "subcanal": "tkm"})
        assert r.status_code == 201, r.text
        nueva = r.json()["operador"]
        assert (nueva["nombre"], nueva["cruce"], nueva["subcanal"]) == ("Camila Gaona Rojas", "alta_supervisor", "TKM")
        assert (await ac.post(f"{BASE}/portal/asesores", headers=sup2, json={"nombre": "Otra Persona", "documento": "4567890"})).status_code == 409
        # Ya está en su equipo: le puede hacer coaching.
        assert (await ac.post(f"{BASE}/portal/coaching", headers=sup1, json={"operador_id": nueva["id"]})).status_code == 201
        # Pide el pase de Beto, que está con Sergio (una sola vez).
        r = await ac.post(f"{BASE}/portal/asesores/{beto}/pase", headers=sup1, json={"nota": "Lo tengo en mi isla desde el lunes"})
        assert r.status_code == 201 and not r.json()["ya_estaba"]
        assert (await ac.post(f"{BASE}/portal/asesores/{beto}/pase", headers=sup1, json={})).json()["ya_estaba"]
        assert (await ac.post(f"{BASE}/portal/asesores/{ana}/pase", headers=sup1, json={})).status_code == 409

        # ---- Control de supervisores: gerente, sub gerente, coordinador, controller y superadmin. Ni auditor ni supervisor.
        for quien in (sup1, auditor):
            assert (await ac.get(f"{BASE}/control", headers=quien)).status_code == 403
        # El gerente ve el control, pero nunca Facturación ni Integraciones.
        assert (await ac.get("/api/v1/televentas-claro/facturacion/reports", headers=gerente)).status_code == 403
        assert (await ac.get("/api/v1/televentas-claro/integraciones/claves", headers=gerente)).status_code == 403
        k = (await ac.get(f"{BASE}/control", headers=gerente, params={"desde": "2026-10-12", "hasta": "2026-10-15"})).json()
        silvia = next(x for x in k["supervisores"] if x["id"] == s1)
        assert (silvia["coachings"], silvia["firmados"], silvia["monitoreos"], silvia["feedback"], silvia["compromisos"]) == (2, 1, 2, 1, 2)
        assert (silvia["audios"], silvia["minutos"], silvia["voz_asesor"], silvia["altas"], silvia["pases"]) == (2, 0.7, 1, 1, 1)
        assert silvia["sin_firmar"] == 1 and silvia["cobertura"] == {"con_coaching": 1, "asesores": 2, "pct": 50}
        sergio = next(x for x in k["supervisores"] if x["id"] == s2)
        assert sergio["sin_firmar_vencidos"] == 1 and sergio["coachings"] == 1 and sergio["firmados"] == 0
        assert k["kpis"]["firmados"] == 1 and k["kpis"]["sin_firmar"] == 2 and k["kpis"]["altas_por_validar"] == 1
        assert k["kpis"]["pases_pendientes"] == 1 and [d["dia"] for d in k["por_dia"]] == ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]
        assert k["por_dia"][0]["firmados"] == 1
        # El rango por defecto es hoy (15/10): Silvia cargó una asesora, le abrió un coaching y pidió un pase.
        hoy = (await ac.get(f"{BASE}/control", headers=coord)).json()
        assert (hoy["desde"], hoy["hasta"]) == ("2026-10-15", "2026-10-15")
        silvia_hoy = next(x for x in hoy["supervisores"] if x["id"] == s1)
        assert silvia_hoy["estado"] == "activo" and (silvia_hoy["altas"], silvia_hoy["coachings"], silvia_hoy["firmados"]) == (1, 1, 0)
        act = (await ac.get(f"{BASE}/control/actividad", headers=coord, params={"desde": "2026-10-12", "hasta": "2026-10-15", "supervisor_id": s1})).json()
        tipos = [e["tipo"] for e in act["items"]]
        assert {"firmado", "item", "compromiso", "audio", "alta", "pase", "creado"} <= set(tipos) and "transcripcion" not in tipos
        assert all(e["supervisor"] == "Silvia Uno" for e in act["items"])
        con_audio = next(e for e in act["items"] if e["tipo"] == "audio" and e["audio"])
        oido = await ac.get(f"{BASE}/control/audios/{con_audio['audio']['id']}/archivo", headers=gerente)
        assert oido.status_code == 200 and oido.content in (WEBM, MP4)
        assert (await ac.get(f"{BASE}/control/audios/{con_audio['audio']['id']}/archivo", headers=auditor)).status_code == 403
        # Los jefes ven el detalle con los ítems, los compromisos, las firmas y los audios.
        det = (await ac.get(f"{BASE}/coaching/{cid}", headers=auditor)).json()
        assert len(det["items"]) == 3 and len(det["compromisos"]) == 2 and len(det["firmas"]) == 2 and len(det["audios"]) == 2

        # ---- Altas por validar y pedidos de pase.
        pend = (await ac.get(f"{BASE}/control/pendientes", headers=gerente)).json()
        assert [(x["nombre"], x["alta_por"]) for x in pend["altas"]] == [("Camila Gaona Rojas", "Silvia Uno")]
        assert [(x["operador"], x["pedido_por"], x["supervisor_actual"]) for x in pend["pases"]] == [("Benitez, Beto", "Silvia Uno", "Sergio Dos")]
        assert pend["puede_validar"] and pend["puede_asignar"]
        r = await ac.post(f"{BASE}/control/pases/{pend['pases'][0]['id']}/resolver", headers=gerente, json={"aprobar": True, "nota": "Ok"})
        assert r.status_code == 200 and r.json()["estado"] == "resuelto"
        p = (await ac.get(f"{BASE}/portal/asesores/parecidos", headers=sup1, params={"nombre": "Beto Benitez"})).json()["items"]
        assert p[0]["equipo"] == "tuyo"
        # La nueva aparece después en Productividad con otro nombre: se une (sus coachings pasan a esa persona).
        (agente,) = await _operadores("Gaona Rojas, Camila")
        r = await ac.post(f"{BASE}/control/altas/{nueva['id']}/unir", headers=coord, json={"con": agente})
        assert r.status_code == 200, r.text
        async with AsyncSessionLocal() as db:
            from app.operativas.televentas_claro.supervision.models import Coaching
            assert await db.get(Operador, nueva["id"]) is None
            assert (await db.get(Operador, agente)).documento == "4567890"
            assert [x.operador_id for x in (await db.execute(select(Coaching).where(Coaching.operador_id == agente))).scalars().all()] == [agente]
        assert (await ac.get(f"{BASE}/control/pendientes", headers=gerente)).json()["altas"] == []


@pytest.mark.asyncio
async def test_retencion_borra_el_archivo_y_deja_la_transcripcion(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    rel = "supervision/audios/2025-01/viejo.webm"
    (tmp_path / "supervision/audios/2025-01").mkdir(parents=True)
    (tmp_path / rel).write_bytes(WEBM)
    async with AsyncSessionLocal() as db:
        a = CoachingAudio(coaching_id="c-viejo", supervisor_id="s", hablante="supervisor", destino="item", ruta=rel, mime="audio/webm",
                          bytes=len(WEBM), duracion_s=10, sha256="x" * 64, estado="listo", texto="Lo que se dijo", created_by="s",
                          created_at=datetime.now(timezone.utc) - timedelta(days=settings.transcripcion_retencion_dias + 3))
        db.add(a)
        await db.commit()
        aid = a.id
    assert await audios_srv.aplicar_retencion() >= 1
    assert not (tmp_path / rel).exists()
    async with AsyncSessionLocal() as db:
        a = await db.get(CoachingAudio, aid)
        assert a.ruta is None and a.borrado_at is not None and a.texto == "Lo que se dijo"


@pytest.mark.asyncio
async def test_sin_clave_queda_sin_servicio_y_se_reactiva(monkeypatch):
    monkeypatch.setattr(settings, "transcripcion_simulador", False)
    monkeypatch.setattr(settings, "openai_api_key", "")
    assert not audios_srv.servicio_disponible()
    assert await audios_srv.reactivar_sin_servicio() == 0
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    assert audios_srv.servicio_disponible()
