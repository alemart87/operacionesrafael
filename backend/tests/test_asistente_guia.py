"""Voi como guía de la plataforma: el catálogo de pantallas por permiso, abrir pantallas, la guía paso a paso y las
opciones con botones (probado con el simulador, nunca contra Anthropic)."""
from __future__ import annotations

import asyncio
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.deps import CurrentUser
from app.asistente import cliente as voi_cliente
from app.asistente import consumidor, consumo, pantallas
from app.asistente.herramientas import ErrorHerramienta
from app.asistente.herramientas.guia import normalizar_opciones, resolver_destino
from app.asistente.models import AsistenteAccion, AsistenteEvento
from app.core.config import settings
from app.core.database import AsyncSessionLocal, Base, engine
from app.core.perfiles import DEFAULT_PERMISSIONS
from app.main import app
from tests.test_asistente import _esperar, _login, _nuevo, _publicado

TC = "televentas_claro"
BASE = "/api/v1/asistente"


def _usuario(rol: str, extra: tuple[str, ...] = ()) -> CurrentUser:
    return CurrentUser(id=f"u-{rol}", email=f"{rol}@x.py", role=rol, full_name=rol.title(), operativas=[TC],
                       permissions=set(DEFAULT_PERMISSIONS.get(rol, [])) | set(extra))


# ============================ el catálogo (sin red) ============================
def test_catalogo_de_pantallas_segun_permisos():
    coord, analista, auditor = _usuario("coordinador"), _usuario("analista", (f"{TC}.asistente",)), _usuario("auditor")
    sa = CurrentUser(id="superadmin", email="a", role="superadmin", full_name="Admin")
    rutas = lambda u: {p.ruta for p in pantallas.visibles(u)}
    # El coordinador ve Ventas Netas pero no «Subir corte» (le falta la gestión); el analista sí; el auditor, lo suyo.
    assert "/televentas-claro/ventas-netas" in rutas(coord) and "/televentas-claro/ventas-netas/upload" not in rutas(coord)
    assert "/televentas-claro/ventas-netas/upload" in rutas(analista) and "/televentas-claro/productividad/subir" in rutas(analista)
    # El auditor ve todos los módulos (sin gestionarlos) y nunca Facturación; lo suyo, Riesgos, también.
    assert "/televentas-claro/productividad" in rutas(auditor) and "/televentas-claro/productividad/subir" not in rutas(auditor)
    assert "/televentas-claro/auditoria/riesgos" in rutas(auditor) and not any(r.startswith("/televentas-claro/facturacion") for r in rutas(auditor))
    # Facturación y la administración: solo quien corresponde.
    assert not any(r.startswith("/televentas-claro/facturacion") for r in rutas(coord))
    assert not any(r.startswith("/admin") for r in rutas(coord)) and "/admin/asistente" in rutas(sa)
    assert all(p.ruta in rutas(sa) for p in pantallas.PANTALLAS)
    # Rutas únicas, con título y descripción; cada guía apunta a una pantalla del catálogo.
    assert len({p.ruta for p in pantallas.PANTALLAS}) == len(pantallas.PANTALLAS)
    assert all(p.titulo and p.que_hace for p in pantallas.PANTALLAS)
    assert {g.ruta for g in pantallas.GUIAS} <= {p.ruta for p in pantallas.PANTALLAS}
    assert len({g.clave for g in pantallas.GUIAS}) == len(pantallas.GUIAS) and all(len(g.pasos) >= 3 for g in pantallas.GUIAS)
    # Las anclas de los pasos existen en su pantalla.
    por_ruta = {p.ruta: p for p in pantallas.PANTALLAS}
    for g in pantallas.GUIAS:
        for paso in g.pasos:
            assert paso.ancla is None or paso.ancla in por_ruta[g.ruta].anclas, (g.clave, paso.ancla)

    # Búsqueda con las palabras de la gente (sin tildes): visible → la pantalla; sin permiso → qué le falta.
    assert pantallas.buscar_pantalla(analista, "llevame a subir el corte de ventas")[0].ruta == "/televentas-claro/ventas-netas/upload"
    vis, oculta = pantallas.buscar_pantalla(coord, "llevame a subir el corte de ventas")
    assert vis is None and oculta.ruta == "/televentas-claro/ventas-netas/upload"
    assert "Ventas Netas · Gestión" in pantallas.falta(oculta)
    assert pantallas.buscar_pantalla(coord, "abrí el centro de comandos")[0].ruta == "/televentas-claro/supervision/comando"
    assert pantallas.buscar_pantalla(coord, "mi perfil")[0].ruta == "/perfil"
    assert pantallas.buscar_pantalla(coord, "abrime facturación") == (None, pantallas.buscar_pantalla(sa, "facturación")[0])
    assert pantallas.buscar_pantalla(coord, "xyzzy") == (None, None)
    # Guías.
    assert pantallas.buscar_guia(analista, "¿Cómo subo el corte de ventas de Claro?")[0].clave == "subir_corte_ventas"
    assert pantallas.buscar_guia(analista, "como cargo los cortes de llamadas")[0].clave == "subir_cortes_llamadas"
    assert pantallas.buscar_guia(coord, "¿cómo firmo el informe diario?")[0].clave == "preparar_informe_diario"
    assert pantallas.buscar_guia(coord, "ayudame a enviar un ticket")[0].clave == "enviar_ticket"
    assert pantallas.buscar_guia(coord, "¿cómo subo el corte?") == (None, next(g for g in pantallas.GUIAS if g.clave == "subir_corte_ventas"))
    assert pantallas.buscar_guia(sa, "subir un documento a la base de conocimiento")[0].clave == "subir_documento_voi"
    # Rutas dinámicas (con id y pestaña) y rutas inválidas.
    assert pantallas.pantalla_de_ruta("/televentas-claro/auditoria/informes/abc#evidencia").titulo.startswith("Auditoría")
    assert pantallas.pantalla_de_ruta("/televentas-claro/ventas-netas/reports/x/sin-uso").ruta == "/televentas-claro/ventas-netas"
    assert pantallas.pantalla_de_ruta("/otra-cosa") is None
    assert pantallas.ruta_limpia("//evil.com") is None and pantallas.ruta_limpia("http://x") is None
    assert pantallas.ruta_limpia("/perfil?x=1") == "/perfil?x=1"
    # El catálogo para el navegador: pistas, sugerencias y guías de cada pantalla.
    cat = {c["ruta"]: c for c in pantallas.catalogo(analista)}
    assert cat["/televentas-claro/ventas-netas/upload"]["pista"]["boton"] == "Sí, guiame"
    assert [g["clave"] for g in cat["/televentas-claro/ventas-netas/upload"]["guias"]] == ["subir_corte_ventas"]
    assert cat["/televentas-claro/ventas-netas"]["sugerencias"]


def test_destinos_y_opciones_se_validan():
    coord, analista = _usuario("coordinador"), _usuario("analista", (f"{TC}.asistente",))
    p, ruta = resolver_destino(analista, None, "subir corte de ventas")
    assert ruta == "/televentas-claro/ventas-netas/upload" and "archivo" in p.anclas
    p, ruta = resolver_destino(_usuario("auditor"), "/televentas-claro/auditoria/informes/abc#evidencia", None)
    assert ruta == "/televentas-claro/auditoria/informes/abc#evidencia" and p.ruta == "/televentas-claro/auditoria"
    with pytest.raises(ErrorHerramienta, match="Ventas Netas · Gestión"):
        resolver_destino(coord, None, "subir el corte de ventas")
    with pytest.raises(ErrorHerramienta, match="solo para el superadmin"):
        resolver_destino(coord, "/admin/users", None)
    with pytest.raises(ErrorHerramienta, match="interna"):
        resolver_destino(coord, "https://evil.com/x", None)
    with pytest.raises(ErrorHerramienta, match="No encontré"):
        resolver_destino(coord, None, "xyzzy")

    d = normalizar_opciones({"pregunta": "¿Por dónde seguimos?", "opciones": [
        {"texto": "Ver alertas", "mensaje": "¿Qué alertas hay?"}, "Abrir Ventas Netas",
        {"texto": "Facturación", "ruta": "/televentas-claro/facturacion"}, {"texto": "ver alertas"},
        {"texto": "Quinta", "ruta": "/perfil"}]}, coord)
    assert [o["texto"] for o in d["opciones"]] == ["Ver alertas", "Abrir Ventas Netas", "Facturación", "Quinta"]   # 4 como máximo, sin repetidas
    assert d["opciones"][1]["mensaje"] == "Abrir Ventas Netas"
    assert "ruta" not in d["opciones"][2] and d["opciones"][3]["ruta"] == "/perfil"      # la ruta sin permiso se descarta
    with pytest.raises(ErrorHerramienta):
        normalizar_opciones({"pregunta": "¿Y?", "opciones": [{"texto": "Una sola"}]}, coord)
    with pytest.raises(ErrorHerramienta):
        normalizar_opciones({"pregunta": "", "opciones": ["a", "b"]}, coord)


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


async def _publicados(ac, headers: dict, cid: str, desde: int = 0) -> list[dict]:
    """Lo que la plataforma repartió al navegador en esa conversación: los eventos de herramienta guardados y las
    acciones (con su resultado) dicen qué se mostró."""
    t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=headers)).json()
    return t["items"][desde:]


@pytest.mark.asyncio
async def test_voi_abre_pantallas_guia_y_ofrece_opciones(simulador):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        # Un analista con Voi: tiene la gestión de Ventas Netas y Productividad (sube cortes).
        perms = (await ac.get("/api/v1/perfiles", headers=admin)).json()
        ana = next(p for p in perms["perfiles"] if p["slug"] == "analista")
        assert (await ac.put("/api/v1/perfiles/analista", headers=admin,
                             json={"permissions": [*ana["permissions"], f"{TC}.asistente"]})).status_code == 200
        _, analista = await _nuevo(ac, admin, "analista", "Ana Analista")
        _, coord = await _nuevo(ac, admin, "coordinador", "Carlos Coordinador")

        # El catálogo del navegador: pistas y guías de lo que puede abrir cada uno.
        cat = (await ac.get(f"{BASE}/pantallas", headers=analista)).json()["items"]
        rutas = {c["ruta"] for c in cat}
        assert "/televentas-claro/ventas-netas/upload" in rutas and not any(r.startswith("/admin") for r in rutas)
        subir = next(c for c in cat if c["ruta"] == "/televentas-claro/ventas-netas/upload")
        assert subir["pista"]["mensaje"] == "Guiame para subir el corte de ventas" and subir["anclas"] == ["archivo", "procesar"]
        assert "/televentas-claro/ventas-netas/upload" not in {c["ruta"] for c in (await ac.get(f"{BASE}/pantallas", headers=coord)).json()["items"]}
        est = (await ac.get(f"{BASE}/estado", headers=analista)).json()
        assert {"abrir_pantalla", "guiar", "ofrecer_opciones"} <= {h["nombre"] for h in est["herramientas"]}

        # 1) «Llevame a…»: Voi abre la pantalla (evento navegar) y la conversación lo recuerda como tarjeta.
        r = await ac.post(f"{BASE}/conversaciones", headers=analista, json={
            "texto": "Llevame a subir el corte de ventas", "pantalla": {"ruta": "/inicio", "titulo": "Inicio"}})
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        await _esperar(cid)
        items = await _publicados(ac, analista, cid)
        pantalla = next(i for i in items if i["tipo"] == "pantalla")
        assert pantalla["ruta"] == "/televentas-claro/ventas-netas/upload" and pantalla["titulo"] == "Ventas Netas · Subir corte"
        assert "Subir corte" in items[-1]["texto"] and "te abrí" in items[-1]["texto"].lower()
        async with AsyncSessionLocal() as db:
            a = (await db.execute(select(AsistenteAccion).where(AsistenteAccion.conversacion_id == cid))).scalar_one()
            assert a.herramienta == "abrir_pantalla" and a.estado == "ejecutada" and a.resultado["ruta"] == pantalla["ruta"]
            # El contexto le contó a Voi qué es la pantalla en la que estaba el usuario.
            ctx = (await db.execute(select(AsistenteEvento).where(AsistenteEvento.conversacion_id == cid,
                                                                  AsistenteEvento.tipo == "system.message"))).scalar_one()
            assert "hub de operativas" in str(ctx.datos)

        # 2) «¿Cómo subo…?»: la guía paso a paso con sus anclas, guardada en la conversación.
        n = len(items)
        r = await ac.post(f"{BASE}/conversaciones/{cid}/mensajes", headers=analista,
                          json={"texto": "¿Cómo subo el corte de ventas de Claro?",
                                "pantalla": {"ruta": "/televentas-claro/ventas-netas/upload", "titulo": "Subir corte"}})
        assert r.status_code == 200, r.text
        await _esperar(cid)
        items = await _publicados(ac, analista, cid, n)
        guia = next(i for i in items if i["tipo"] == "guia")["guia"]
        assert guia["clave"] == "subir_corte_ventas" and guia["ruta"] == "/televentas-claro/ventas-netas/upload"
        assert [p["ancla"] for p in guia["pasos"]] == [None, "archivo", "procesar", None] and guia["pasos"][0]["n"] == 1
        assert "4 pasos" in items[-1]["texto"] and "Subir el corte" in items[-1]["texto"]

        # 3) «¿Qué puedo hacer?»: la presentación y botones para elegir; elegir uno es mandar su mensaje.
        n += len(items)
        await ac.post(f"{BASE}/conversaciones/{cid}/mensajes", headers=analista, json={"texto": "¿Qué puedo hacer?"})
        await _esperar(cid)
        items = await _publicados(ac, analista, cid, n)
        assert items[-1]["tipo"] == "opciones" and items[-1]["pregunta"] == "¿Por dónde empezamos?"
        textos = [o["texto"] for o in items[-1]["opciones"]]
        assert "Guiame para subir un corte" in textos and 2 <= len(textos) <= 4
        abrir = next(o for o in items[-1]["opciones"] if o.get("ruta"))
        assert abrir["ruta"] == "/televentas-claro/ventas-netas" and abrir["titulo"] == "Ventas Netas · Informes"
        assert "Soy **Voi**" in next(i for i in items if i["tipo"] == "voi")["texto"]
        n += len(items)
        elegida = next(o for o in items[-1]["opciones"] if o["texto"] == "Guiame para subir un corte")
        await ac.post(f"{BASE}/conversaciones/{cid}/mensajes", headers=analista, json={"texto": elegida["mensaje"]})
        await _esperar(cid)
        items = await _publicados(ac, analista, cid, n)
        assert items[0]["tipo"] == "usuario" and items[0]["texto"] == elegida["mensaje"]
        assert any(i["tipo"] == "guia" for i in items)

        # 4) Sin permiso: Voi no abre la pantalla y explica qué utilidad falta (nunca por otro camino).
        r = await ac.post(f"{BASE}/conversaciones", headers=coord, json={"texto": "Llevame a subir el corte de ventas"})
        cid2 = r.json()["id"]
        await _esperar(cid2)
        items = await _publicados(ac, coord, cid2)
        paso = next(i for i in items if i["tipo"] == "paso")
        assert paso["herramienta"] == "abrir_pantalla" and paso["estado"] == "error"
        assert "Ventas Netas · Gestión" in items[-1]["texto"] and not any(i["tipo"] == "pantalla" for i in items)
        # El analista no ve las conversaciones del coordinador ni su catálogo trae Facturación.
        assert (await ac.get(f"{BASE}/conversaciones/{cid2}", headers=analista)).status_code == 404
        assert not any(c["ruta"].startswith("/televentas-claro/facturacion") for c in cat)

        # El superadmin ve en la consola qué pidió cada herramienta (entrada) y lo que devolvió.
        full = (await ac.get(f"{BASE}/admin/conversaciones/{cid}", headers=admin)).json()
        g = next(i for i in full["items"] if i["tipo"] == "guia")
        assert g["entrada"]["tarea"].startswith("¿Cómo subo") and g["guia"]["clave"] == "subir_corte_ventas"
        uso = (await ac.get(f"{BASE}/admin/consumo", headers=admin)).json()
        assert {h["nombre"] for h in uso["por_herramienta"]} >= {"abrir_pantalla", "guiar", "ofrecer_opciones"}
