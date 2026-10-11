"""Evidencia visual de los informes de auditoría y el modo auditor de Voi (con su simulador: nunca llama a Anthropic).

Cubre: imágenes procesadas en un subproceso (sin metadatos, en el disco persistente, servidas solo con el permiso de
Auditoría), figuras editables, ordenables y fijas al cerrar el informe, borrado de archivos; el modo auditor por
conversación (quién lo activa, informe destino, contexto para Voi), la tarjeta en la que el usuario elige qué piezas del
lienzo suma (todas, algunas o ninguna), el camino directo desde el lienzo y el bloqueo de piezas con datos de
Facturación.
"""
from __future__ import annotations

import asyncio
import io
import json
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import select

from app.asistente.models import AsistenteAccion, AsistenteArtefacto, AsistenteConversacion, AsistenteEvento
from app.core.config import settings
from app.core.database import AsyncSessionLocal, Base, engine
from app.main import app
from app.models.audit import AuditLog
from app.operativas.televentas_claro.auditoria.models import AuditoriaEvidencia, AuditoriaSeguimiento
from app.services import imagenes
from tests.test_asistente import BASE, _esperar, _login, _nuevo, _publicado, simulador  # noqa: F401
from tests.test_ventas_netas import _subir_y_procesar, build_xlsx

AUD = "/api/v1/televentas-claro/auditoria"


def setup_module(module):
    from app.main import _seed_profiles

    async def _prep():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await _seed_profiles()
    asyncio.run(_prep())


def _png(color=(0, 178, 191), tam=(640, 400), formato="PNG", **kw) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", tam, color).save(buf, formato, **kw)
    return buf.getvalue()


def test_imagenes_sin_metadatos_y_rechazos():
    exif = Image.Exif()
    exif[0x0112] = 6                                    # orientación: girada
    exif[0x8825] = {1: "S", 2: (25.0, 17.0, 0.0)}       # GPS
    r = imagenes.procesar(_png((230, 51, 42), (3000, 2000), "JPEG", exif=exif.tobytes()))
    completa = Image.open(io.BytesIO(r["completa"]))
    assert completa.format == "WEBP" and dict(completa.getexif()) == {}            # sin EXIF ni GPS
    assert (r["ancho"], r["alto"]) == (1600, 2400) and r["formato_origen"] == "JPG"   # enderezada y reducida
    assert max(Image.open(io.BytesIO(r["miniatura"])).size) <= imagenes.LADO_MINIATURA
    for malo in (b"no soy una imagen", b"%PDF-1.4", _png(tam=(4, 4))):
        with pytest.raises(imagenes.ImagenInvalida):
            imagenes.procesar(malo)


async def _informe(ac, quien, tmp_path, monkeypatch, admin) -> dict:
    rid = await _subir_y_procesar(ac, admin, build_xlsx(tmp_path / "sep.xlsx"), monkeypatch)
    # Publicado (lo ve también quien no tiene Gestión); reemplaza el del período que dejó otra prueba del módulo.
    r = await ac.post(f"/api/v1/televentas-claro/ventas-netas/reports/{rid}/publish", headers=admin,
                      json={"confirm_replace": True})
    assert r.status_code == 200, r.text
    fuentes = (await ac.get(f"{AUD}/fuentes", headers=quien)).json()
    r = await ac.post(f"{AUD}/informes", headers=quien, json={"titulo": "Auditoría de septiembre", "report_ids": [fuentes[0]["id"]]})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_imagenes_del_informe_en_el_disco_persistente(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path / "disco"))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        _, analista = await _nuevo(ac, admin, "analista", "Ana Analista")          # tiene Auditoría
        _, coord = await _nuevo(ac, admin, "coordinador")                           # no
        inf = await _informe(ac, analista, tmp_path, monkeypatch, admin)
        aid, h1 = inf["id"], inf["hallazgos"][0]["id"]

        subir = lambda datos, nombre="captura.png", **campos: ac.post(  # noqa: E731
            f"{AUD}/informes/{aid}/evidencias/imagen", headers=analista,
            files={"archivo": (nombre, datos, "application/octet-stream")}, data=campos)
        assert (await ac.post(f"{AUD}/informes/{aid}/evidencias/imagen", headers=coord,
                              files={"archivo": ("x.png", _png(), "image/png")})).status_code == 403
        r = await subir(_png(), "Captura del CRM.png", titulo="Venta sin grabación en el CRM", nota="Caso del 05/09",
                        hallazgo_id=h1)
        assert r.status_code == 201, r.text
        f1 = r.json()
        assert f1["tipo"] == "imagen" and f1["origen"] == "subida" and f1["hallazgo_id"] == h1 and f1["disponible"]
        assert (f1["ancho"], f1["alto"]) == (640, 400) and f1["archivo_nombre"] == "Captura del CRM.png"
        carpeta = Path(settings.upload_dir) / "auditoria" / aid
        assert sorted(p.name for p in carpeta.iterdir()) == sorted([f"{f1['id']}.webp", f"{f1['id']}-m.webp"])
        f2 = (await subir(_png((118, 53, 148)), "foto.jpg")).json()
        assert f2["titulo"] == "foto" and f2["orden"] == f1["orden"] + 1

        # La imagen se sirve con el permiso de Auditoría (WebP, sin nombre del archivo original).
        img = await ac.get(f"{AUD}/informes/{aid}/evidencias/{f1['id']}/imagen", headers=analista)
        assert img.status_code == 200 and img.headers["content-type"] == "image/webp" and img.content[8:12] == b"WEBP"
        assert img.headers["x-content-type-options"] == "nosniff"
        mini = await ac.get(f"{AUD}/informes/{aid}/evidencias/{f1['id']}/imagen", headers=analista, params={"v": "miniatura"})
        assert mini.status_code == 200 and mini.content[8:12] == b"WEBP"
        assert max(Image.open(io.BytesIO(mini.content)).size) <= imagenes.LADO_MINIATURA
        assert (await ac.get(f"{AUD}/informes/{aid}/evidencias/{f1['id']}/imagen", headers=coord)).status_code == 403

        # Validaciones: no es imagen, vacía, hallazgo de otro informe.
        assert (await subir(b"texto con extension de imagen", "trampa.png")).status_code == 400
        assert (await subir(b"", "vacia.png")).status_code == 400
        assert (await subir(_png(), "x.png", hallazgo_id="otro")).status_code == 400

        # Editar, ordenar y ver en el detalle (con la bitácora).
        r = await ac.patch(f"{AUD}/informes/{aid}/evidencias/{f2['id']}", headers=analista,
                           json={"titulo": "Legajo sin firma", "nota": "Foto del legajo físico", "hallazgo_id": h1})
        assert r.status_code == 200 and r.json()["titulo"] == "Legajo sin firma" and r.json()["hallazgo_id"] == h1
        r = await ac.patch(f"{AUD}/informes/{aid}/evidencias/{f2['id']}", headers=analista, json={"hallazgo_id": ""})
        assert r.json()["hallazgo_id"] is None
        assert (await ac.post(f"{AUD}/informes/{aid}/evidencias/orden", headers=analista, json={"ids": [f2["id"]]})).status_code == 400
        r = await ac.post(f"{AUD}/informes/{aid}/evidencias/orden", headers=analista, json={"ids": [f2["id"], f1["id"]]})
        assert [x["id"] for x in r.json()] == [f2["id"], f1["id"]]
        det = (await ac.get(f"{AUD}/informes/{aid}", headers=analista)).json()
        assert [x["id"] for x in det["evidencias"]] == [f2["id"], f1["id"]]
        assert any(s["tipo"] == "evidencia" for s in det["seguimientos"])

        # Cerrado: la evidencia queda fija (se sigue viendo).
        for estado_ in ("en_revision", "cerrado"):
            assert (await ac.post(f"{AUD}/informes/{aid}/estado", headers=analista, json={"status": estado_})).status_code == 200
        assert (await subir(_png(), "tarde.png")).status_code == 409
        assert (await ac.delete(f"{AUD}/informes/{aid}/evidencias/{f1['id']}", headers=analista)).status_code == 409
        assert (await ac.get(f"{AUD}/informes/{aid}/evidencias/{f1['id']}/imagen", headers=analista)).status_code == 200
        for estado_ in ("en_revision", "borrador"):
            assert (await ac.post(f"{AUD}/informes/{aid}/estado", headers=analista, json={"status": estado_})).status_code == 200

        # Quitar una figura borra sus archivos; eliminar el borrador borra la carpeta.
        assert (await ac.delete(f"{AUD}/informes/{aid}/evidencias/{f1['id']}", headers=analista)).status_code == 200
        assert not (carpeta / f"{f1['id']}.webp").exists() and (carpeta / f"{f2['id']}.webp").exists()
        assert (await ac.delete(f"{AUD}/informes/{aid}", headers=analista)).status_code == 200
        assert not carpeta.exists()
        async with AsyncSessionLocal() as db:
            assert (await db.execute(select(AuditoriaEvidencia).where(AuditoriaEvidencia.auditoria_id == aid))).first() is None
            acciones = {a for (a,) in (await db.execute(select(AuditLog.action).where(AuditLog.action.like("%auditoria_evidencia")))).all()}
            assert {"create_auditoria_evidencia", "update_auditoria_evidencia", "delete_auditoria_evidencia"} <= acciones


@pytest.mark.asyncio
async def test_modo_auditor_y_evidencia_del_lienzo(simulador, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path / "disco"))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        _, auditor = await _nuevo(ac, admin, "auditor", "Ana Auditora")
        _, coord = await _nuevo(ac, admin, "coordinador")
        inf = await _informe(ac, auditor, tmp_path, monkeypatch, admin)
        aid, codigo = inf["id"], inf["codigo"]

        assert (await ac.get(f"{BASE}/estado", headers=auditor)).json()["modo_auditor"] is True
        assert (await ac.get(f"{BASE}/estado", headers=coord)).json()["modo_auditor"] is False

        # El auditor activa el modo en una conversación nueva, con el informe destino.
        cid = (await ac.post(f"{BASE}/conversaciones", headers=auditor, json={})).json()["id"]
        cid_coord = (await ac.post(f"{BASE}/conversaciones", headers=coord, json={})).json()["id"]
        assert (await ac.post(f"{BASE}/conversaciones/{cid_coord}/investigacion", headers=coord,
                              json={"activo": True})).status_code == 403
        r = await ac.post(f"{BASE}/conversaciones/{cid}/investigacion", headers=auditor, json={"activo": True, "auditoria_id": codigo})
        assert r.status_code == 200, r.text
        inv = r.json()["investigacion"]
        assert inv["codigo"] == codigo and inv["auditoria_id"] == aid and inv["por"] == "usuario"

        # Voi muestra en el lienzo y, en modo auditor, pregunta qué sumar: la tarjeta lista las piezas.
        r = await ac.post(f"{BASE}/conversaciones/{cid}/mensajes", headers=auditor,
                          json={"texto": "Mostrame en un gráfico las ventas netas de 2026-09"})
        assert r.status_code == 200, r.text
        conv = await _esperar(cid)
        assert conv.estado == "requires_action"
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=auditor)).json()
        assert t["conversacion"]["investigacion"]["codigo"] == codigo
        card = t["pendientes"][0]
        assert card["herramienta"] == "proponer_evidencia" and codigo in card["resumen"]
        clave = card["detalle"]["piezas"][0]["clave"]
        assert clave == t["artefactos"][0]["id"]
        async with AsyncSessionLocal() as db:
            ctx = (await db.execute(select(AsistenteEvento).where(AsistenteEvento.conversacion_id == cid,
                                                                  AsistenteEvento.tipo == "system.message"))).scalars().all()
            assert any("MODO AUDITOR ACTIVO" in json.dumps(e.datos, ensure_ascii=False) and codigo in json.dumps(e.datos)
                       for e in ctx)

        # Una elección inválida no confirma nada; ninguna elegida = no se suma nada.
        r = await ac.post(f"{BASE}/acciones/{card['id']}/confirmar", headers=auditor, json={"ajustes": {"seleccion": ["otra"]}})
        assert r.status_code == 400
        r = await ac.post(f"{BASE}/acciones/{card['id']}/confirmar", headers=auditor, json={"ajustes": {"seleccion": []}})
        assert r.status_code == 200 and r.json()["estado"] == "cancelada"
        await _esperar(cid, hasta=("idle",))
        async with AsyncSessionLocal() as db:
            assert (await db.execute(select(AuditoriaEvidencia).where(AuditoriaEvidencia.auditoria_id == aid))).first() is None

        # Otra vez: ahora elige la pieza y le cambia el título.
        await asyncio.sleep(0.05)
        await ac.post(f"{BASE}/conversaciones/{cid}/mensajes", headers=auditor,
                      json={"texto": "Mostrame en un gráfico las ventas netas de 2026-09"})
        await _esperar(cid)
        card = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=auditor)).json()["pendientes"][0]
        clave = card["detalle"]["piezas"][0]["clave"]
        r = await ac.post(f"{BASE}/acciones/{card['id']}/confirmar", headers=auditor, json={"ajustes": {
            "seleccion": [clave], "ediciones": {clave: {"titulo": "Ventas netas por día", "nota": "Corte del 10/09"}}}})
        assert r.status_code == 200
        await _esperar(cid, hasta=("idle",))
        det = (await ac.get(f"{AUD}/informes/{aid}", headers=auditor)).json()
        assert len(det["evidencias"]) == 1
        fig = det["evidencias"][0]
        assert fig["tipo"] == "grafico" and fig["origen"] == "voi" and fig["titulo"] == "Ventas netas por día"
        assert fig["nota"] == "Corte del 10/09" and fig["spec"]["tipo"] in ("lineas", "barras", "kpis")
        hecha = next(x for x in (await ac.get(f"{BASE}/conversaciones/{cid}", headers=auditor)).json()["items"]
                     if x["tipo"] == "accion" and x["accion"]["id"] == card["id"])["accion"]
        assert hecha["estado"] == "ejecutada" and "Fig. 1" in hecha["mensaje"] and codigo in hecha["mensaje"]
        assert [p["clave"] for p in hecha["detalle"]["piezas"]] == [clave]          # la tarjeta muestra lo elegido

        # Desde el lienzo, directo: la misma pieza no se duplica; la de otra persona, no.
        r = await ac.post(f"{BASE}/evidencias", headers=auditor, json={"auditoria_id": aid, "piezas": [{"artefacto_id": clave}]})
        assert r.status_code == 200 and r.json()["agregadas"] == [] and r.json()["repetidas"][0]["figura"] == 1
        async with AsyncSessionLocal() as db:
            arts = (await db.execute(select(AsistenteArtefacto).where(AsistenteArtefacto.conversacion_id == cid)
                                     .order_by(AsistenteArtefacto.created_at))).scalars().all()
        r = await ac.post(f"{BASE}/evidencias", headers=auditor, json={"auditoria_id": aid, "piezas": [{"artefacto_id": arts[0].id}]})
        assert r.status_code == 200 and r.json()["agregadas"][0]["figura"] == 2
        r = await ac.post(f"{BASE}/evidencias", headers=admin, json={"auditoria_id": aid, "piezas": [{"artefacto_id": arts[0].id}]})
        assert r.status_code == 409 and "no es tuya" in r.json()["detail"]
        # Una tabla armada en el navegador se valida como cualquier pieza.
        tabla = {"tipo": "tabla", "titulo": "Vendedores en alerta", "datos": [{"vendedor": "ANA PEREZ", "sin_uso": 2}]}
        r = await ac.post(f"{BASE}/evidencias", headers=auditor,
                          json={"auditoria_id": aid, "conversacion_id": cid, "piezas": [{"spec": tabla}]})
        assert r.status_code == 200 and r.json()["agregadas"][0]["figura"] == 3
        r = await ac.post(f"{BASE}/evidencias", headers=auditor,
                          json={"auditoria_id": aid, "conversacion_id": cid, "piezas": [{"spec": {"tipo": "torta", "titulo": "Mal"}}]})
        assert r.status_code == 409 and "no es válida" in r.json()["detail"]

        # El índice liviano del informe: hallazgos y figuras (con la pieza de la que salió cada una), sin la evidencia.
        idx = (await ac.get(f"{AUD}/informes/{aid}/evidencias/indice", headers=auditor)).json()
        assert idx["informe"]["codigo"] == codigo and idx["informe"]["editable"] is True
        assert [f["figura"] for f in idx["figuras"]] == [1, 2, 3] and idx["figuras"][0]["artefacto_id"] == clave
        assert idx["hallazgos"] and "evidencia" not in idx["hallazgos"][0]
        assert (await ac.get(f"{AUD}/informes/{aid}/evidencias/indice", headers=coord)).status_code == 403

        # Voi entra y sale del modo con su herramienta.
        cid2 = (await ac.post(f"{BASE}/conversaciones", headers=auditor,
                              json={"texto": f"Entrá en modo auditor con el informe {codigo}"})).json()["id"]
        await _esperar(cid2)
        async with AsyncSessionLocal() as db:
            c2 = await db.get(AsistenteConversacion, cid2)
            assert c2.investigacion["codigo"] == codigo and c2.investigacion["por"] == "voi"
        await asyncio.sleep(0.05)
        await ac.post(f"{BASE}/conversaciones/{cid2}/mensajes", headers=auditor, json={"texto": "Salí del modo auditor"})
        await _esperar(cid2)
        async with AsyncSessionLocal() as db:
            assert (await db.get(AsistenteConversacion, cid2)).investigacion is None

        # Con el informe cerrado no se puede elegir como destino.
        for estado_ in ("en_revision", "cerrado"):
            await ac.post(f"{AUD}/informes/{aid}/estado", headers=auditor, json={"status": estado_})
        r = await ac.post(f"{BASE}/conversaciones/{cid}/investigacion", headers=auditor, json={"activo": True, "auditoria_id": aid})
        assert r.status_code == 409 and "borrador o en revisión" in r.json()["detail"]
        r = await ac.post(f"{BASE}/conversaciones/{cid}/investigacion", headers=auditor, json={"activo": False})
        assert r.status_code == 200 and r.json()["investigacion"] is None
        async with AsyncSessionLocal() as db:
            assert (await db.execute(select(AuditLog).where(AuditLog.action == "asistente_modo_auditor"))).first()
            assert (await db.execute(select(AuditoriaSeguimiento).where(AuditoriaSeguimiento.auditoria_id == aid,
                                                                        AuditoriaSeguimiento.tipo == "evidencia"))).first()


@pytest.mark.asyncio
async def test_piezas_con_facturacion_no_van_al_informe(simulador, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path / "disco"))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        inf = await _informe(ac, admin, tmp_path, monkeypatch, admin)
        cid = (await ac.post(f"{BASE}/conversaciones", headers=admin,
                             json={"texto": "Simulá la facturación de Pospago con 1800 ventas"})).json()["id"]
        await _esperar(cid)
        await asyncio.sleep(0.05)
        await ac.post(f"{BASE}/conversaciones/{cid}/mensajes", headers=admin, json={"texto": "Mostrame en un gráfico las ventas netas de 2026-09"})
        await _esperar(cid)
        async with AsyncSessionLocal() as db:
            art = (await db.execute(select(AsistenteArtefacto).where(AsistenteArtefacto.conversacion_id == cid))).scalars().one()
            assert art.confidencial
            assert (await db.execute(select(AsistenteAccion).where(AsistenteAccion.conversacion_id == cid,
                                                                   AsistenteAccion.herramienta == "facturacion_simular"))).first()
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=admin)).json()
        assert t["artefactos"][0]["confidencial"] is True
        r = await ac.post(f"{BASE}/evidencias", headers=admin, json={"auditoria_id": inf["id"], "piezas": [{"artefacto_id": art.id}]})
        assert r.status_code == 409 and "Facturación" in r.json()["detail"]
        r = await ac.post(f"{BASE}/evidencias", headers=admin, json={
            "auditoria_id": inf["id"], "conversacion_id": cid,
            "piezas": [{"spec": {"tipo": "tabla", "titulo": "Copia", "datos": [{"a": "x", "b": 1}]}}]})
        assert r.status_code == 409 and "Facturación" in r.json()["detail"]
