"""Voi, el agente de la plataforma (Claude Managed Agents), probado con su simulador (nunca llama a Anthropic).

Cubre: quién lo usa y con qué alcance (perfiles, modo auditor, herramientas y habilidades por permiso), la publicación
del agente con versiones, el ciclo de una conversación (mensaje → herramienta de la plataforma → respuesta), las
acciones que esperan confirmación (confirmar, cancelar, doble clic, seguir escribiendo), la memoria, los topes, el
stream en vivo, la recuperación después de un corte, el webhook firmado y la consola del superadmin.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import time
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.asistente import api as voi_api
from app.asistente import cliente as voi_cliente
from app.asistente import config as voi_config
from app.asistente import consumidor, consumo, definicion, publicacion
from app.asistente.herramientas import para_usuario
from app.asistente.models import (AsistenteAccion, AsistenteConversacion, AsistenteEvento, AsistenteUsoDiario)
from app.asistente.permisos import modo, puede_usar
from app.api.deps import CurrentUser
from app.core.config import settings
from app.core.database import AsyncSessionLocal, Base, engine
from app.core.operativas import asignables
from app.core.perfiles import DEFAULT_PERMISSIONS
from app.main import app
from app.models.audit import AuditLog
from app.operativas.televentas_claro.productividad.models import ProdInforme

TC = "televentas_claro"
BASE = "/api/v1/asistente"


# ============================ permisos y alcance (sin red) ============================
def _usuario(rol: str, perms: list[str] | None = None) -> CurrentUser:
    return CurrentUser(id=f"u-{rol}", email=f"{rol}@x.py", role=rol, full_name=rol.title(), operativas=[TC],
                       permissions=set(perms if perms is not None else DEFAULT_PERMISSIONS.get(rol, [])))


def test_quien_usa_voi_por_defecto():
    con = {r for r, ps in DEFAULT_PERMISSIONS.items() if f"{TC}.asistente" in ps}
    assert con == {"sub_gerente", "coordinador", "auditor"}
    # Al controller, al analista y al cliente se les puede asignar; al supervisor (solo portal), no.
    for rol in ("controller", "analista", "cliente"):
        assert f"{TC}.asistente" in asignables(rol)
    assert f"{TC}.asistente" not in asignables("supervisor")
    assert puede_usar(_usuario("coordinador")) and not puede_usar(_usuario("controller"))
    sa = CurrentUser(id="superadmin", email="a", role="superadmin", full_name="Admin")
    assert puede_usar(sa) and modo(sa) == "superadmin"
    # El auditor trabaja con Voi como el resto: con todos sus módulos (el «modo auditor» es de la conversación).
    assert modo(_usuario("auditor")) == "gestion" and modo(_usuario("sub_gerente")) == "gestion"


def test_herramientas_segun_perfil_y_modo():
    coord = {h.nombre for h in para_usuario(_usuario("coordinador"), "gestion")}
    assert {"productividad_del_dia", "ventas_del_mes", "centro_de_comandos", "preparar_informe_diario",
            "enviar_ticket_revision", "gestionar_alerta", "buscar_personas"} <= coord
    assert "auditorias_de_ventas" not in coord                       # el coordinador no tiene auditoría
    aud = {h.nombre for h in para_usuario(_usuario("auditor"), "gestion")}
    assert {"auditorias_de_ventas", "ventas_del_mes", "centro_de_comandos", "tickets_de_revision", "productividad_del_dia",
            "productividad_por_rango", "sph", "logistica_del_mes", "supervision_del_mes", "coaching_del_dia",
            "informes_diarios"} <= aud
    # El auditor ve, no gestiona: nada de actuar sobre alertas ni de facturación (que su perfil no puede tener).
    assert not aud & {"gestionar_alerta", "facturacion_pospago", "facturacion_gpon"}
    aud_con_fact = {h.nombre for h in para_usuario(_usuario("auditor", [*DEFAULT_PERMISSIONS["auditor"], f"{TC}.facturacion"]), "gestion")}
    assert aud_con_fact == aud                                         # aunque figure en la base, no vale para su perfil
    # Sin el permiso del módulo no hay herramienta, aunque tenga Voi.
    solo_vn = {h.nombre for h in para_usuario(_usuario("analista", [f"{TC}.ver", f"{TC}.ventas_netas", f"{TC}.asistente"]),
                                              "gestion")}
    assert "ventas_del_mes" in solo_vn and "productividad_del_dia" not in solo_vn and "enviar_ticket_revision" not in solo_vn


def test_definicion_del_agente_en_archivos():
    agente = definicion.agente([])
    assert agente["name"] == "Voi" and agente["model"]["id"] == settings.asistente_modelo
    tipos = [t["type"] for t in agente["tools"]]
    assert tipos[0] == "agent_toolset_20260401" and tipos.count("custom") == len(agente["tools"]) - 1
    toolset = agente["tools"][0]
    apagadas = {c["name"] for c in toolset.get("configs", []) if c.get("enabled") is False}
    assert {"web_search", "web_fetch"} <= apagadas                   # sin internet
    assert definicion.entorno()["config"]["networking"]["type"] == "limited"
    nombres = {h.nombre for h in definicion.habilidades()}
    assert {"voi-ayuda-plataforma", "voi-informe-diario", "voi-auditoria-de-ventas"} <= nombres
    assert definicion.HABILIDADES_AUDITOR <= nombres
    assert all(h.descripcion for h in definicion.habilidades())


def test_el_simulador_nunca_corre_en_produccion(monkeypatch):
    monkeypatch.setattr(settings, "asistente_simulador", True)
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    monkeypatch.setattr(settings, "env", "development")
    assert voi_config.simulador_activo() and voi_config.clave_configurada()
    monkeypatch.setattr(settings, "env", "production")
    assert not voi_config.simulador_activo() and not voi_config.clave_configurada()


# ============================ firma del webhook ============================
def _firmar(cuerpo: bytes, secreto: bytes, msg_id="msg_1", ts=None) -> dict[str, str]:
    ts = str(int(ts if ts is not None else time.time()))
    firma = base64.b64encode(hmac.new(secreto, f"{msg_id}.{ts}.".encode() + cuerpo, hashlib.sha256).digest()).decode()
    return {"webhook-id": msg_id, "webhook-timestamp": ts, "webhook-signature": f"v1,{firma}"}


def test_webhook_verifica_la_firma():
    secreto = b"clave-secreta-de-prueba-1234567"
    clave = "whsec_" + base64.b64encode(secreto).decode()
    cuerpo = json.dumps({"type": "event", "data": {"type": "session.idled", "id": "sesn_1"}}).encode()
    assert voi_api.verificar_webhook(cuerpo, _firmar(cuerpo, secreto), clave)["data"]["id"] == "sesn_1"
    with pytest.raises(ValueError):
        voi_api.verificar_webhook(cuerpo + b" ", _firmar(cuerpo, secreto), clave)          # cuerpo alterado
    with pytest.raises(ValueError):
        voi_api.verificar_webhook(cuerpo, _firmar(cuerpo, b"otra-clave"), clave)           # otra clave
    with pytest.raises(ValueError):
        voi_api.verificar_webhook(cuerpo, _firmar(cuerpo, secreto, ts=time.time() - 3600), clave)   # vieja


# ============================ con el simulador ============================
def setup_module(module):
    from app.main import _seed_profiles

    async def _prep():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await _seed_profiles()
    asyncio.run(_prep())


@pytest_asyncio.fixture
async def simulador(monkeypatch):
    monkeypatch.setattr(settings, "asistente_simulador", True)
    monkeypatch.setenv("ASISTENTE_SIMULADOR_DEMORA", "0")
    voi_cliente.reiniciar()
    consumo._rafagas.clear()
    sim = voi_cliente.cliente()
    yield sim
    await consumidor.detener_todos()
    tareas = [s.tarea for s in sim.sesiones.values() if s.tarea]
    for t in tareas:
        t.cancel()
    await asyncio.gather(*tareas, return_exceptions=True)
    voi_cliente.reiniciar()


async def _login(ac, email, pwd="Clave1234!"):
    r = await ac.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _nuevo(ac, admin, rol, nombre=None):
    email = f"{rol}-{uuid.uuid4().hex[:6]}@voicenter.com.py"
    r = await ac.post("/api/v1/users", headers=admin, json={
        "email": email, "password": "Clave1234!", "full_name": nombre or f"Usuario {rol}", "role": rol, "operativas": [TC]})
    assert r.status_code == 201, r.text
    return r.json()["id"], await _login(ac, email)


async def _esperar(cid: str, *, hasta=("idle", "budget_reached", "requires_action", "terminated"), segundos=8.0):
    """Espera a que la conversación quede quieta (y su consumidor termine)."""
    fin = time.monotonic() + segundos
    while time.monotonic() < fin:
        await asyncio.sleep(0.03)
        async with AsyncSessionLocal() as db:
            c = await db.get(AsistenteConversacion, cid)
            if c and c.estado in hasta and not consumidor.corriendo(cid):
                return c
    raise AssertionError(f"La conversación {cid} no terminó (estado {c.estado if c else None})")


async def _publicado(ac, admin):
    r = await ac.post(f"{BASE}/admin/publicar", headers=admin, json={})
    assert r.status_code == 200, r.text
    return r.json()


async def _prod_hoy():
    hoy = voi_config.ahora_local().date()
    async with AsyncSessionLocal() as db:
        if (await db.execute(select(ProdInforme).where(ProdInforme.fecha == hoy))).first():
            return
        db.add(ProdInforme(fecha=hoy, status="published", corte_final="18:00", agentes=40, llamadas=5200, atendidas=3900,
                           pct_conversacion=31.5, banda="bajo", data={
                               "kpis": {"agentes": 40, "agentes_validos": 38, "login": 40 * 8 * 3600, "pct_conversacion": 31.5,
                                        "banda": "bajo", "llamadas": 5200, "atendidas": 3900, "pct_contacto": 75.0, "aht": 185,
                                        "llamadas_hora": 16.3, "pct_pausa": 9.2,
                                        "bandas": {"rojo": 4, "bajo": 20, "meta": 14, "sobre": 2}},
                               "alertas": [{"tipo": "sin_llamadas"}], "sin_conexion": [],
                               "turnos": {"determinado": True,
                                          "manana": {"agentes": 22, "llamadas": 3000, "pct_conversacion": 33.0},
                                          "tarde": {"agentes": 18, "llamadas": 2200, "pct_conversacion": 29.4}}}))
        await db.commit()


@pytest.mark.asyncio
async def test_publicacion_con_versiones(simulador):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        est = (await ac.get(f"{BASE}/admin/estado", headers=admin)).json()
        assert est["conectado"] and est["simulador"] and not est["clave"]
        r = await _publicado(ac, admin)
        assert "entorno" in r["cambios"] and "habilidades" in r["cambios"] and r["recursos"]["agente"]["version"] == 1
        # Sin cambios en los archivos: no se publica otra versión.
        r = await _publicado(ac, admin)
        assert r["cambios"] == [] and r["recursos"]["agente"]["version"] == 1
        async with AsyncSessionLocal() as db:
            assert not publicacion.desactualizado(await voi_config.recursos(db))
        # Forzar: versión nueva del agente (las conversaciones en curso siguen con la suya).
        r = (await ac.post(f"{BASE}/admin/publicar", headers=admin, json={"forzar": True})).json()
        assert r["recursos"]["agente"]["version"] == 2
        est = (await ac.get(f"{BASE}/admin/estado", headers=admin)).json()
        assert est["publicado"] and not est["desactualizado"] and all(h["al_dia"] for h in est["habilidades"])
        assert (await ac.post(f"{BASE}/admin/probar", headers=admin)).json()["ok"]
        audit = (await ac.get("/api/v1/audit", headers=admin, params={"action": "asistente_publicar"})).json()
        assert len(audit) == 3


@pytest.mark.asyncio
async def test_conversacion_consulta_y_respuesta(simulador):
    await _prod_hoy()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        coord_id, coord = await _nuevo(ac, admin, "coordinador", "Paola Coordinadora")
        _, controller = await _nuevo(ac, admin, "controller")

        assert (await ac.get(f"{BASE}/estado", headers=controller)).status_code == 403   # sin la utilidad
        est = (await ac.get(f"{BASE}/estado", headers=coord)).json()
        assert est["disponible"] and est["modo"] == "gestion" and est["sugerencias"]
        assert "productividad_del_dia" in {h["nombre"] for h in est["herramientas"]}

        r = await ac.post(f"{BASE}/conversaciones", headers=coord, json={
            "texto": "¿Cómo vino la productividad de llamadas hoy?", "pantalla": {"ruta": "/inicio", "titulo": "Inicio"}})
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        conv = await _esperar(cid)
        assert conv.estado == "idle" and conv.titulo.startswith("¿Cómo vino la productividad")

        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=coord)).json()
        tipos = [i["tipo"] for i in t["items"]]
        assert tipos[0] == "usuario" and "paso" in tipos and "voi" in tipos
        paso = next(i for i in t["items"] if i["tipo"] == "paso")
        assert paso["herramienta"] == "productividad_del_dia" and paso["estado"] == "ok"
        voi_txt = [i for i in t["items"] if i["tipo"] == "voi"][-1]["texto"]
        assert "31,5" in voi_txt or "5.200" in voi_txt
        # Después de los datos, la plataforma ofrece armar un tablero (botones), sin gastar una vuelta del modelo.
        assert t["items"][-1]["tipo"] == "opciones", json.dumps(t["items"][-1], ensure_ascii=False)
        assert "Armar un tablero" in [o["texto"] for o in t["items"][-1]["opciones"]]
        assert "contexto" not in tipos                                   # el contexto lo ve solo el superadmin

        async with AsyncSessionLocal() as db:
            accs = (await db.execute(select(AsistenteAccion).where(AsistenteAccion.conversacion_id == cid))).scalars().all()
            assert len(accs) == 1 and all(a.estado == "ejecutada" and a.respondida_at and a.respuesta is None for a in accs)
            # El contexto de la plataforma llegó como system.message (con la pantalla).
            ctx = (await db.execute(select(AsistenteEvento).where(AsistenteEvento.conversacion_id == cid,
                                                                  AsistenteEvento.tipo == "system.message"))).scalar_one()
            assert "Paola Coordinadora" in json.dumps(ctx.datos, ensure_ascii=False) and "/inicio" in json.dumps(ctx.datos)
            uso = (await db.execute(select(AsistenteUsoDiario).where(AsistenteUsoDiario.user_id == coord_id))).scalar_one()
            assert uso.mensajes == 1 and uso.herramientas == 1 and uso.costo_centavos >= 1 and uso.input_tokens > 0
            c = await db.get(AsistenteConversacion, cid)
            assert c.costo_centavos == uso.costo_centavos and set(c.contexto["herramientas"]) >= {"productividad_del_dia"}
            # Ningún evento repetido.
            n = (await db.execute(select(func.count()).select_from(AsistenteEvento).where(
                AsistenteEvento.conversacion_id == cid))).scalar()
            ids = (await db.execute(select(func.count(func.distinct(AsistenteEvento.evento_id))).where(
                AsistenteEvento.conversacion_id == cid))).scalar()
            assert n == ids

        # Segundo mensaje en la misma conversación.
        r = await ac.post(f"{BASE}/conversaciones/{cid}/mensajes", headers=coord, json={"texto": "¿Y qué podés hacer?"})
        assert r.status_code == 200, r.text
        await _esperar(cid)
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=coord)).json()
        assert [i["tipo"] for i in t["items"]].count("usuario") == 2
        assert "Soy **Voi**" in [i for i in t["items"] if i["tipo"] == "voi"][-1]["texto"]
        assert t["items"][-1]["tipo"] == "opciones" and 2 <= len(t["items"][-1]["opciones"]) <= 4   # botones para elegir

        # Lista, renombrar, fijar y quitar (la copia queda para el superadmin).
        lista = (await ac.get(f"{BASE}/conversaciones", headers=coord)).json()["items"]
        assert [x["id"] for x in lista] == [cid]
        assert (await ac.patch(f"{BASE}/conversaciones/{cid}", headers=coord, json={"titulo": "Productividad", "fijada": True})).json()["fijada"]
        _, otro = await _nuevo(ac, admin, "coordinador")
        assert (await ac.get(f"{BASE}/conversaciones/{cid}", headers=otro)).status_code == 404      # de otro: no
        assert (await ac.delete(f"{BASE}/conversaciones/{cid}", headers=coord)).status_code == 200
        assert (await ac.get(f"{BASE}/conversaciones", headers=coord)).json()["items"] == []
        adm = (await ac.get(f"{BASE}/admin/conversaciones", headers=admin, params={"usuario": coord_id})).json()
        # Tres consultas: la productividad, los botones que siguen a los datos y los de «qué podés hacer».
        assert adm["total"] == 1 and adm["items"][0]["oculta"] and adm["items"][0]["consultas"] == 2

        # El superadmin lee la conversación completa (con el contexto) y queda auditado.
        full = (await ac.get(f"{BASE}/admin/conversaciones/{cid}", headers=admin)).json()
        assert "contexto" in [i["tipo"] for i in full["items"]]
        assert any("resultado" in i for i in full["items"] if i["tipo"] == "paso")
        async with AsyncSessionLocal() as db:
            assert (await db.execute(select(AuditLog).where(AuditLog.action == "asistente_ver_conversacion",
                                                            AuditLog.resource_id == cid))).first()
        assert (await ac.get(f"{BASE}/admin/conversaciones", headers=coord)).status_code == 403

        cons = (await ac.get(f"{BASE}/admin/consumo", headers=admin)).json()
        assert cons["totales"]["mensajes"] >= 2 and cons["totales"]["costo_usd"] > 0
        assert any(u["user_id"] == coord_id and u["nombre"] == "Paola Coordinadora" for u in cons["por_usuario"])
        assert any(h["nombre"] == "productividad_del_dia" for h in cons["por_herramienta"])


@pytest.mark.asyncio
async def test_acciones_con_confirmacion(simulador):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        coord_id, coord = await _nuevo(ac, admin, "coordinador", "Carla Coordinadora")
        # El superadmin pide confirmación también para los borradores propios.
        r = await ac.put(f"{BASE}/admin/config", headers=admin, json={"autonomia": {"borradores_sin_confirmar": False}})
        assert r.status_code == 200 and r.json()["autonomia"]["borradores_sin_confirmar"] is False

        cid = (await ac.post(f"{BASE}/conversaciones", headers=coord,
                             json={"texto": "Prepará el borrador del informe diario"})).json()["id"]
        conv = await _esperar(cid)
        assert conv.estado == "requires_action"
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=coord)).json()
        assert len(t["pendientes"]) == 1
        acc = t["pendientes"][0]
        assert acc["herramienta"] == "preparar_informe_diario" and acc["estado"] == "pendiente"
        assert "borrador del informe diario" in acc["resumen"] and "revises y lo firmes" in acc["resumen"]
        # Nadie más la puede confirmar.
        _, otro = await _nuevo(ac, admin, "coordinador")
        assert (await ac.post(f"{BASE}/acciones/{acc['id']}/confirmar", headers=otro)).status_code == 404

        # Doble clic: se ejecuta una sola vez.
        r1, r2 = await asyncio.gather(ac.post(f"{BASE}/acciones/{acc['id']}/confirmar", headers=coord),
                                      ac.post(f"{BASE}/acciones/{acc['id']}/confirmar", headers=coord))
        assert r1.status_code == 200 and r2.status_code == 200
        await _esperar(cid, hasta=("idle",))
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=coord)).json()
        card = next(i for i in t["items"] if i["tipo"] == "accion")["accion"]
        assert card["estado"] == "ejecutada" and card["pantalla"].startswith("/televentas-claro/informe-diario/")
        assert "informe-diario" in t["items"][-1]["texto"]
        async with AsyncSessionLocal() as db:
            from app.operativas.televentas_claro.informe_diario.models import InformeDiario
            informes = (await db.execute(select(InformeDiario).where(InformeDiario.autor_id == coord_id))).scalars().all()
            assert len(informes) == 1 and informes[0].estado == "borrador" and "Voi" in informes[0].resumen
            assert (await db.execute(select(AuditLog).where(AuditLog.action == "asistente_accion",
                                                            AuditLog.user_id == coord_id))).first()

        # Cancelar: no se hace y Voi lo dice.
        cid2 = (await ac.post(f"{BASE}/conversaciones", headers=coord,
                              json={"texto": "Prepará el borrador del informe diario"})).json()["id"]
        await _esperar(cid2)
        acc2 = (await ac.get(f"{BASE}/conversaciones/{cid2}", headers=coord)).json()["pendientes"][0]
        assert (await ac.post(f"{BASE}/acciones/{acc2['id']}/cancelar", headers=coord)).json()["estado"] == "cancelada"
        await _esperar(cid2, hasta=("idle",))
        t = (await ac.get(f"{BASE}/conversaciones/{cid2}", headers=coord)).json()
        assert "no lo hice" in t["items"][-1]["texto"]
        # Ya resuelta: confirmarla después no hace nada.
        assert (await ac.post(f"{BASE}/acciones/{acc2['id']}/confirmar", headers=coord)).json()["estado"] == "cancelada"

        # Seguir escribiendo sin confirmar: la acción pendiente se cancela sola.
        cid3 = (await ac.post(f"{BASE}/conversaciones", headers=coord,
                              json={"texto": "Prepará el borrador del informe diario"})).json()["id"]
        await _esperar(cid3)
        r = await ac.post(f"{BASE}/conversaciones/{cid3}/mensajes", headers=coord, json={"texto": "Mejor no, ¿qué podés hacer?"})
        assert r.status_code == 200, r.text
        await _esperar(cid3, hasta=("idle",))
        async with AsyncSessionLocal() as db:
            # («¿qué podés hacer?» suma los botones de opciones: la acción que importa es la del borrador.)
            a3 = (await db.execute(select(AsistenteAccion).where(AsistenteAccion.conversacion_id == cid3,
                                                                 AsistenteAccion.herramienta == "preparar_informe_diario"))).scalar_one()
            assert a3.estado == "cancelada" and a3.respondida_at is not None
        await ac.put(f"{BASE}/admin/config", headers=admin, json={"autonomia": {"borradores_sin_confirmar": True}})


@pytest.mark.asyncio
async def test_auditor_usa_voi_con_todos_sus_modulos(simulador):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        _, aud = await _nuevo(ac, admin, "auditor", "Ana Auditora")
        est = (await ac.get(f"{BASE}/estado", headers=aud)).json()
        assert est["modo"] == "gestion" and "auditoría" in est["sugerencias"][0].lower() and est["modo_auditor"]
        cid = (await ac.post(f"{BASE}/conversaciones", headers=aud, json={"texto": "¿Qué dice la última auditoría de ventas?"})).json()["id"]
        await _esperar(cid)
        async with AsyncSessionLocal() as db:
            c = await db.get(AsistenteConversacion, cid)
            rec = await voi_config.recursos(db)
        sesion = simulador.sesiones[c.session_id]
        # Todos sus módulos (productividad, SPH, logística…) y nunca facturación.
        assert {"productividad_del_dia", "sph", "logistica_del_mes", "auditorias_de_ventas"} <= set(sesion.herramientas)
        assert not {h for h in sesion.herramientas if h.startswith("facturacion_")}
        ids = {rec["habilidades"][n]["id"] for n in ("voi-productividad-y-sph", "voi-auditoria-de-ventas")}
        assert ids <= set(c.contexto["habilidades"]) and rec["habilidades"]["voi-facturacion"]["id"] not in c.contexto["habilidades"]
        assert c.contexto["modo"] == "gestion"


@pytest.mark.asyncio
async def test_memoria_del_usuario(simulador):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        _, sg = await _nuevo(ac, admin, "sub_gerente", "Sergio Subgerente")
        cid = (await ac.post(f"{BASE}/conversaciones", headers=sg,
                             json={"texto": "Recordá que prefiero los números en tablas"})).json()["id"]
        await _esperar(cid)
        mem = (await ac.get(f"{BASE}/memoria", headers=sg)).json()["items"]
        assert len(mem) == 1 and "prefiero los números en tablas" in mem[0]["contenido"]
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=sg)).json()
        paso = next(i for i in t["items"] if i["tipo"] == "paso")
        assert paso["herramienta"] == "write" and paso["estado"] == "ok"
        # Una conversación nueva monta la misma memoria (un store por usuario).
        cid2 = (await ac.post(f"{BASE}/conversaciones", headers=sg, json={"texto": "Hola"})).json()["id"]
        await _esperar(cid2)
        async with AsyncSessionLocal() as db:
            s1 = simulador.sesiones[(await db.get(AsistenteConversacion, cid)).session_id]
            s2 = simulador.sesiones[(await db.get(AsistenteConversacion, cid2)).session_id]
        assert s1.memoria_id and s1.memoria_id == s2.memoria_id
        assert (await ac.delete(f"{BASE}/memoria/{mem[0]['id']}", headers=sg)).status_code == 200
        assert (await ac.get(f"{BASE}/memoria", headers=sg)).json()["items"] == []


@pytest.mark.asyncio
async def test_topes_de_consumo(simulador):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        _, coord = await _nuevo(ac, admin, "coordinador")
        # Ráfagas: más de N mensajes por minuto.
        await ac.put(f"{BASE}/admin/config", headers=admin, json={"topes": {"mensajes_minuto": 2}})
        cid = (await ac.post(f"{BASE}/conversaciones", headers=coord, json={"texto": "Hola"})).json()["id"]
        await _esperar(cid)
        assert (await ac.post(f"{BASE}/conversaciones/{cid}/mensajes", headers=coord, json={"texto": "Hola 2"})).status_code == 200
        await _esperar(cid)
        r = await ac.post(f"{BASE}/conversaciones/{cid}/mensajes", headers=coord, json={"texto": "Hola 3"})
        assert r.status_code == 429 and "rápido" in r.json()["detail"]
        consumo._rafagas.clear()
        await ac.put(f"{BASE}/admin/config", headers=admin, json={"topes": {"mensajes_minuto": 30}})

        # Tope de la conversación (lo aplica Anthropic): llega y la conversación se cierra.
        async with AsyncSessionLocal() as db:
            sesion = simulador.sesiones[(await db.get(AsistenteConversacion, cid)).session_id]
        sesion.tope = 1
        assert (await ac.post(f"{BASE}/conversaciones/{cid}/mensajes", headers=coord, json={"texto": "Hola 4"})).status_code == 200
        conv = await _esperar(cid)
        assert conv.estado == "budget_reached"
        r = await ac.post(f"{BASE}/conversaciones/{cid}/mensajes", headers=coord, json={"texto": "Hola 5"})
        assert r.status_code == 409 and "tope" in r.json()["detail"]

        # Tope diario por usuario (el superadmin no tiene).
        await ac.put(f"{BASE}/admin/config", headers=admin, json={"topes": {"usuario_dia_usd": 0.01}})
        r = await ac.post(f"{BASE}/conversaciones", headers=coord, json={"texto": "Hola"})
        assert r.status_code == 429 and "tope diario" in r.json()["detail"]
        r = await ac.post(f"{BASE}/conversaciones", headers=admin, json={"texto": "Hola"})
        assert r.status_code == 201
        await _esperar(r.json()["id"])
        # Voi pausado: los demás no pueden, el superadmin sí.
        await ac.put(f"{BASE}/admin/config", headers=admin, json={"habilitado": False, "topes": {"usuario_dia_usd": 5}})
        assert (await ac.get(f"{BASE}/estado", headers=coord)).json()["disponible"] is False
        assert (await ac.post(f"{BASE}/conversaciones", headers=coord, json={"texto": "Hola"})).status_code == 429
        assert (await ac.get(f"{BASE}/estado", headers=admin)).json()["disponible"] is True
        await ac.put(f"{BASE}/admin/config", headers=admin, json={"habilitado": True})
        est = (await ac.get(f"{BASE}/admin/estado", headers=admin)).json()
        assert est["gasto_mes_usd"] > 0 and est["config"]["topes"]["mensual_usd"] == 150.0


@pytest.mark.asyncio
async def test_stream_en_vivo(simulador, monkeypatch):
    monkeypatch.setattr(voi_api, "DURACION_STREAM", 2.0)
    simulador.demora = 0.05            # como en la realidad: el agente tarda un poco y el stream ya está abierto
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        _, sg = await _nuevo(ac, admin, "sub_gerente")
        cid = (await ac.post(f"{BASE}/conversaciones", headers=sg, json={})).json()["id"]

        async def leer():
            r = await ac.get(f"{BASE}/conversaciones/{cid}/eventos", headers=sg)
            assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
            assert "no-transform" in r.headers["cache-control"]
            return [json.loads(x[5:]) for x in r.text.split("\n\n") if x.startswith("data:")]

        tarea = asyncio.create_task(leer())
        await asyncio.sleep(0.2)
        assert (await ac.post(f"{BASE}/conversaciones/{cid}/mensajes", headers=sg, json={"texto": "¿Qué podés hacer?"})).status_code == 200
        eventos = await tarea
        tipos = [e["tipo"] for e in eventos]
        assert tipos[0] == "transcripcion" and eventos[0]["items"] == [] and tipos[-1] == "reconectar"
        assert {"usuario", "estado", "mensaje"} <= set(tipos)
        assert "escribiendo" in tipos and "parcial" in tipos             # vista previa del texto
        assert "uso" not in tipos                                         # el costo solo lo ve el superadmin
        final = next(e for e in eventos if e["tipo"] == "mensaje")
        parcial = "".join(e["texto"] for e in eventos if e["tipo"] == "parcial" and e["id"] == final["id"])
        assert parcial == final["texto"]
        # Otro usuario no se puede suscribir.
        _, otro = await _nuevo(ac, admin, "sub_gerente")
        assert (await ac.get(f"{BASE}/conversaciones/{cid}/eventos", headers=otro)).status_code == 404


@pytest.mark.asyncio
async def test_se_recupera_despues_de_un_corte(simulador, monkeypatch):
    """Si se corta mientras corre una herramienta, al volver a escuchar se completa y se responde una sola vez."""
    await _prod_hoy()
    original = consumidor._ejecutar_y_responder
    cortes = {"n": 0}

    async def cortar(*a, **kw):
        cortes["n"] += 1
        raise ConnectionError("se cortó")

    monkeypatch.setattr(consumidor, "_ejecutar_y_responder", cortar)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        _, sg = await _nuevo(ac, admin, "sub_gerente")
        cid = (await ac.post(f"{BASE}/conversaciones", headers=sg, json={"texto": "productividad de hoy"})).json()["id"]
        for _ in range(100):
            await asyncio.sleep(0.03)
            if cortes["n"] and not consumidor.corriendo(cid):
                break
        async with AsyncSessionLocal() as db:
            a = (await db.execute(select(AsistenteAccion).where(AsistenteAccion.conversacion_id == cid))).scalar_one()
            assert a.estado == "ejecutando" and a.respondida_at is None
        monkeypatch.setattr(consumidor, "_ejecutar_y_responder", original)
        consumidor.asegurar(cid)                                      # p. ej. al reconectar el navegador o al reiniciar
        conv = await _esperar(cid, hasta=("idle",))
        async with AsyncSessionLocal() as db:
            accs = (await db.execute(select(AsistenteAccion).where(AsistenteAccion.conversacion_id == cid))).scalars().all()
            # La consulta cortada se completó una sola vez (los botones de opciones los pone la plataforma).
            assert [a.herramienta for a in accs] == ["productividad_del_dia"]
            assert all(a.estado == "ejecutada" and a.respondida_at for a in accs)
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=sg)).json()
        assert [i["tipo"] for i in t["items"]][-2:] == ["voi", "opciones"] and conv.estado == "idle"


@pytest.mark.asyncio
async def test_la_sesion_no_queda_esperando_una_herramienta(simulador, monkeypatch):
    """Si la plataforma falla mientras ejecuta una herramienta (o se reinicia), la sesión queda esperando ese resultado
    y rechazaría cualquier mensaje. El próximo mensaje la destraba: responde lo que faltaba y sigue."""
    await _prod_hoy()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        _, coord = await _nuevo(ac, admin, "coordinador", "Lara Coordinadora")

        # 1) Falla antes de anotar la acción: el pedido queda guardado como evento, pero sin respuesta.
        original = consumidor._herramienta_interna

        async def rota(db, conv, ev, salida):
            raise RuntimeError("se cayó la base en el peor momento")
        monkeypatch.setattr(consumidor, "_herramienta_interna", rota)
        # …y tampoco se puede responder el error (como con la red cortada): la sesión queda esperando.
        monkeypatch.setattr(consumidor, "_resultado", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("sin red")))
        r = await ac.post(f"{BASE}/conversaciones", headers=coord, json={"texto": "¿Cómo vino la productividad de llamadas hoy?"})
        cid = r.json()["id"]
        await _esperar(cid, hasta=("idle", "requires_action", "running", "terminated"), segundos=6)
        sesion = next(iter(simulador.sesiones.values()))
        assert sesion.turno and sesion.turno["espera"], "la sesión simulada tiene que estar esperando un resultado"
        async with AsyncSessionLocal() as db:
            assert (await db.execute(select(AsistenteAccion).where(AsistenteAccion.conversacion_id == cid))).first() is None

        # El mensaje siguiente no cae con 502: la plataforma responde el pedido reclamado y el mensaje entra.
        monkeypatch.setattr(consumidor, "_herramienta_interna", original)
        monkeypatch.undo()
        monkeypatch.setattr(settings, "asistente_simulador", True)
        r = await ac.post(f"{BASE}/conversaciones/{cid}/mensajes", headers=coord, json={"texto": "¿Qué podés hacer?"})
        assert r.status_code == 200, r.text
        await _esperar(cid)
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=coord)).json()
        tipos = [i["tipo"] for i in t["items"]]
        assert tipos.count("usuario") == 2 and "Soy **Voi**" in [i for i in t["items"] if i["tipo"] == "voi"][-1]["texto"]
        fallido = next(i for i in t["items"] if i["tipo"] == "paso")
        assert fallido["estado"] == "error" and fallido["herramienta"] == "productividad_del_dia"
        async with AsyncSessionLocal() as db:
            a = (await db.execute(select(AsistenteAccion).where(AsistenteAccion.conversacion_id == cid,
                                                                 AsistenteAccion.herramienta == "productividad_del_dia"))).scalar_one()
            assert a.estado == "fallida" and a.respondida_at is not None and a.respuesta is None   # la copia queda en la sesión

        # 2) Una acción que quedó «ejecutando» de un reinicio: se da por cortada y se responde antes del mensaje.
        r = await ac.post(f"{BASE}/conversaciones", headers=coord, json={"texto": "Prepará el borrador del informe diario"})
        cid2 = r.json()["id"]
        await _esperar(cid2)
        sid2 = (await _conv(cid2)).session_id
        s2 = next(s for s in simulador.sesiones.values() if s.id == sid2)
        eid = "sevt_huerfano_000000000000000001"
        s2.turno = {"texto": "", "pasos": [], "i": 0, "resultados": [], "espera": {eid: "enviar_ticket_revision"},
                    "salida": 0, "t0": consumidor._ahora()}
        async with AsyncSessionLocal() as db:
            db.add(AsistenteAccion(conversacion_id=cid2, user_id=(await _conv(cid2)).user_id, herramienta="enviar_ticket_revision",
                                   nivel=3, entrada={}, resumen="Enviar un ticket", evento_id=eid, estado="ejecutando"))
            await db.commit()
        r = await ac.post(f"{BASE}/conversaciones/{cid2}/mensajes", headers=coord, json={"texto": "¿Qué podés hacer?"})
        assert r.status_code == 200, r.text
        await _esperar(cid2)
        async with AsyncSessionLocal() as db:
            a = (await db.execute(select(AsistenteAccion).where(AsistenteAccion.evento_id == eid))).scalar_one()
            assert a.estado == "fallida" and a.respondida_at is not None and "Se cortó" in a.resultado["mensaje"]

        # 3) Una acción ejecutándose ahora mismo: 409 claro, nunca 502.
        consumidor._en_curso.add(a.id)
        try:
            async with AsyncSessionLocal() as db:
                a = await db.get(AsistenteAccion, a.id)
                a.respondida_at = None
                await db.commit()
            r = await ac.post(f"{BASE}/conversaciones/{cid2}/mensajes", headers=coord, json={"texto": "¿Y ahora?"})
            assert r.status_code == 409 and "terminando una acción" in r.json()["detail"]
        finally:
            consumidor._en_curso.discard(a.id)


async def _conv(cid: str) -> AsistenteConversacion:
    async with AsyncSessionLocal() as db:
        return await db.get(AsistenteConversacion, cid)


@pytest.mark.asyncio
async def test_sin_clave_voi_avisa(monkeypatch):
    monkeypatch.setattr(settings, "asistente_simulador", False)
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    voi_cliente.reiniciar()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        est = (await ac.get(f"{BASE}/estado", headers=admin)).json()
        assert est["disponible"] is False and "clave" in est["motivo"]
        r = await ac.post(f"{BASE}/conversaciones", headers=admin, json={"texto": "Hola"})
        assert r.status_code == 503 and "clave" in r.json()["detail"]
        assert (await ac.post(f"{BASE}/admin/publicar", headers=admin, json={})).status_code == 409
        assert (await ac.post(f"{BASE}/admin/probar", headers=admin)).json()["ok"] is False
        assert (await ac.get(f"{BASE}/memoria", headers=admin)).json() == {"items": []}
