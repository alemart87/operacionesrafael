"""Modo informe diario de Voi (con su simulador: nunca llama a Anthropic): quien prepara el informe diario lo arma con
Voi y suma al informe las figuras del lienzo (gráficos, indicadores, tablas) con los datos que Voi consulta.

Cubre: quién tiene el modo; activarlo desde el panel (crea el borrador del día) y con la herramienta de Voi; el
contexto que recibe Voi y las opciones que ofrece; la tarjeta para elegir qué piezas van; el camino directo desde el
lienzo; las figuras editables, con la captura para el PDF en el disco persistente; la firma, que las deja fijas y
dentro del código de verificación; y los permisos (solo el autor, solo mientras es borrador).
"""
from __future__ import annotations

import asyncio
import io
import json
from datetime import date, timedelta
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import select

from app.asistente.config import ahora_local
from app.asistente.models import AsistenteConversacion, AsistenteEvento
from app.core.config import settings
from app.core.database import AsyncSessionLocal, Base, engine
from app.main import app
from app.models.audit import AuditLog
from app.operativas.televentas_claro.informe_diario import figuras as fig_srv
from app.operativas.televentas_claro.informe_diario import informe as inf_srv
from app.operativas.televentas_claro.informe_diario.models import InformeDiario
from tests.test_asistente import BASE, _esperar, _login, _nuevo, _prod_hoy, _publicado, simulador  # noqa: F401

try:
    import pypdfium2
except ImportError:  # pragma: no cover - el texto del PDF se revisa solo si está la librería
    pypdfium2 = None

INF = "/api/v1/televentas-claro/informe-diario"


def setup_module(module):
    from app.main import _seed_profiles

    async def _prep():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await _seed_profiles()
    asyncio.run(_prep())


def _png(color=(0, 178, 191), tam=(640, 400)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", tam, color).save(buf, "PNG")
    return buf.getvalue()


def _texto_pdf(contenido: bytes) -> str:
    if pypdfium2 is None:
        return ""
    doc = pypdfium2.PdfDocument(contenido)
    return "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))


def test_reglas_de_las_figuras():
    inf = InformeDiario(autor_id="u1", estado="borrador", fecha=date(2026, 10, 11), autor_nombre="Ana", autor_cargo="Coordinadora")
    spec = {"tipo": "tabla", "titulo": "Turnos", "datos": [{"turno": "Mañana", "llamadas": 3000}]}
    f, nueva = fig_srv.sumar(inf, spec, user_id="u1", artefacto_id="art-1")
    assert nueva and f["titulo"] == "Turnos" and fig_srv.numero(inf, f["id"]) == 1
    assert fig_srv.sumar(inf, spec, user_id="u1", artefacto_id="art-1") == (f, False)        # la misma pieza no se duplica
    with pytest.raises(fig_srv.FiguraError) as e:
        fig_srv.sumar(inf, spec, user_id="u2")
    assert e.value.codigo == 403
    for i in range(fig_srv.MAX_FIGURAS - 1):
        fig_srv.sumar(inf, {**spec, "titulo": f"Tabla {i}"}, user_id="u1")
    with pytest.raises(fig_srv.FiguraError, match=f"hasta {fig_srv.MAX_FIGURAS}"):
        fig_srv.sumar(inf, spec, user_id="u1")
    assert fig_srv.editar(inf, f["id"], "u1", titulo="  ", nota="Lectura")["titulo"] == "Turnos"   # el título vacío no pisa
    assert fig_srv.buscar(inf, f["id"])["nota"] == "Lectura"
    assert [x["figura"] for x in fig_srv.para_dict(inf)] == list(range(1, fig_srv.MAX_FIGURAS + 1))
    assert set(fig_srv.para_hash(inf)[0]) == {"id", "titulo", "nota", "spec", "artefacto_id"}
    inf.estado = "firmado"
    with pytest.raises(fig_srv.FiguraError, match="firmado"):
        fig_srv.quitar(inf, f["id"], "u1")
    with pytest.raises(fig_srv.FiguraError) as e:
        fig_srv.buscar(inf, "no-existe")
    assert e.value.codigo == 404


@pytest.mark.asyncio
async def test_modo_informe_diario_y_figuras_del_lienzo(simulador, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path / "disco"))
    await _prod_hoy()
    hoy = ahora_local().date()
    dia = f"{hoy:%d/%m}"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        _, coord = await _nuevo(ac, admin, "coordinador", "Paola Coordinadora")
        _, otra = await _nuevo(ac, admin, "coordinador", "Otra Coordinadora")
        _, auditor = await _nuevo(ac, admin, "auditor", "Ana Auditora")

        # Quién tiene el modo: quien prepara el informe diario.
        assert (await ac.get(f"{BASE}/estado", headers=coord)).json()["modo_informe_diario"] is True
        assert (await ac.get(f"{BASE}/estado", headers=auditor)).json()["modo_informe_diario"] is False

        # Desde el panel: activar el modo abre el borrador de hoy (se crea si no existe) y lo deja como destino.
        cid = (await ac.post(f"{BASE}/conversaciones", headers=coord, json={})).json()["id"]
        cid_aud = (await ac.post(f"{BASE}/conversaciones", headers=auditor, json={})).json()["id"]
        r = await ac.post(f"{BASE}/conversaciones/{cid_aud}/investigacion", headers=auditor,
                          json={"activo": True, "tipo": "informe_diario"})
        assert r.status_code == 403 and "informe diario" in r.json()["detail"]
        r = await ac.post(f"{BASE}/conversaciones/{cid}/investigacion", headers=coord, json={"activo": True, "tipo": "informe_diario"})
        assert r.status_code == 200, r.text
        inv = r.json()["investigacion"]
        assert inv["tipo"] == "informe_diario" and inv["fecha"] == hoy.isoformat() and inv["por"] == "usuario"
        assert inv["estado"] == "borrador" and inv["activo"] is True
        iid = inv["informe_id"]
        d = (await ac.get(f"{INF}/{iid}", headers=coord)).json()
        assert d["estado"] == "borrador" and d["figuras"] == [] and d["puede_editar"]
        assert (await ac.get(INF, headers=coord)).json()["de_hoy"]["id"] == iid
        for fecha, motivo in (((hoy + timedelta(days=1)).isoformat(), "futura"), ("ayer", "AAAA-MM-DD")):
            r = await ac.post(f"{BASE}/conversaciones/{cid}/investigacion", headers=coord,
                              json={"activo": True, "tipo": "informe_diario", "fecha": fecha})
            assert r.status_code == 409 and motivo in r.json()["detail"], r.text
        r = await ac.post(f"{BASE}/conversaciones/{cid}/investigacion", headers=otra, json={"activo": True, "tipo": "informe_diario", "informe_id": iid})
        assert r.status_code == 404                                                 # la conversación no es suya
        cid_otra = (await ac.post(f"{BASE}/conversaciones", headers=otra, json={})).json()["id"]
        r = await ac.post(f"{BASE}/conversaciones/{cid_otra}/investigacion", headers=otra,
                          json={"activo": True, "tipo": "informe_diario", "informe_id": iid})
        assert r.status_code == 409 and "tiene que ser tuyo" in r.json()["detail"]  # el informe no es suyo

        # En el modo, después de los datos Voi ofrece sumarlos al informe (botones); el contexto le marca el destino.
        r = await ac.post(f"{BASE}/conversaciones/{cid}/mensajes", headers=coord, json={"texto": "¿Cómo vino la productividad de llamadas hoy?"})
        assert r.status_code == 200, r.text
        await _esperar(cid)
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=coord)).json()
        assert t["conversacion"]["investigacion"]["tipo"] == "informe_diario"
        assert t["items"][-1]["tipo"] == "opciones", json.dumps(t["items"][-1], ensure_ascii=False)
        assert "Sumar al informe diario" in [o["texto"] for o in t["items"][-1]["opciones"]]
        async with AsyncSessionLocal() as db:
            ctx = (await db.execute(select(AsistenteEvento).where(AsistenteEvento.conversacion_id == cid,
                                                                  AsistenteEvento.tipo == "system.message"))).scalars().all()
            assert any("MODO INFORME DIARIO ACTIVO" in json.dumps(e.datos, ensure_ascii=False) and iid in json.dumps(e.datos)
                       for e in ctx)

        # Un gráfico en el lienzo: Voi pregunta qué sumar al informe diario (la tarjeta con las piezas).
        await asyncio.sleep(0.05)
        r = await ac.post(f"{BASE}/conversaciones/{cid}/mensajes", headers=coord,
                          json={"texto": "Mostrame en un gráfico la productividad de llamadas de hoy"})
        assert r.status_code == 200, r.text
        conv = await _esperar(cid)
        assert conv.estado == "requires_action"
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=coord)).json()
        card = t["pendientes"][0]
        assert card["herramienta"] == "proponer_evidencia" and f"informe diario del {dia}" in card["resumen"], card["resumen"]
        clave = card["detalle"]["piezas"][0]["clave"]
        assert clave == t["artefactos"][0]["id"]
        r = await ac.post(f"{BASE}/acciones/{card['id']}/confirmar", headers=coord, json={"ajustes": {
            "seleccion": [clave], "ediciones": {clave: {"titulo": "Conversación bajo la meta a la tarde", "nota": "Mirar el turno tarde."}}}})
        assert r.status_code == 200, r.text
        await _esperar(cid, hasta=("idle",))
        d = (await ac.get(f"{INF}/{iid}", headers=coord)).json()
        assert len(d["figuras"]) == 1
        fig = d["figuras"][0]
        assert fig["figura"] == 1 and fig["origen"] == "voi" and fig["titulo"] == "Conversación bajo la meta a la tarde"
        assert fig["nota"] == "Mirar el turno tarde." and fig["spec"].get("tipo") and fig["imagen"] is False
        assert fig["artefacto_id"] == clave
        f1 = fig["id"]
        hecha = next(x for x in (await ac.get(f"{BASE}/conversaciones/{cid}", headers=coord)).json()["items"]
                     if x["tipo"] == "accion" and x["accion"]["id"] == card["id"])["accion"]
        assert hecha["estado"] == "ejecutada" and "Fig. 1" in hecha["mensaje"] and f"informe diario del {dia}" in hecha["mensaje"]
        assert hecha["pantalla"] == f"/televentas-claro/informe-diario/{iid}#figuras"

        # Desde el lienzo, directo: la misma pieza no se duplica; una tabla armada en el navegador se valida igual.
        r = await ac.post(f"{BASE}/evidencias", headers=coord, json={"informe_diario_id": iid, "piezas": [{"artefacto_id": clave}]})
        assert r.status_code == 200, r.text
        assert r.json()["agregadas"] == [] and r.json()["repetidas"][0]["figura"] == 1
        assert r.json()["informe"] == {"id": iid, "codigo": f"Informe diario · {dia}", "titulo": f"Informe diario del {hoy:%d/%m/%Y}",
                                       "tipo": "informe_diario", "pantalla": f"/televentas-claro/informe-diario/{iid}#figuras"}
        tabla = {"tipo": "tabla", "titulo": "Turnos del día",
                 "datos": [{"turno": "Mañana", "llamadas": 3000}, {"turno": "Tarde", "llamadas": 2200}]}
        r = await ac.post(f"{BASE}/evidencias", headers=coord,
                          json={"informe_diario_id": iid, "conversacion_id": cid, "piezas": [{"spec": tabla, "nota": "La tarde cae."}]})
        assert r.status_code == 200 and r.json()["agregadas"][0]["figura"] == 2, r.text
        f2 = r.json()["agregadas"][0]["id"]
        assert (await ac.post(f"{BASE}/evidencias", headers=coord, json={"informe_diario_id": iid, "auditoria_id": "x",
                                                                         "piezas": [{"artefacto_id": clave}]})).status_code == 422
        assert (await ac.post(f"{BASE}/evidencias", headers=coord, json={"piezas": [{"artefacto_id": clave}]})).status_code == 422
        r = await ac.post(f"{BASE}/evidencias", headers=coord,
                          json={"informe_diario_id": iid, "conversacion_id": cid, "piezas": [{"spec": {"tipo": "torta", "titulo": "Mal"}}]})
        assert r.status_code == 409 and "no es válida" in r.json()["detail"]
        # El informe de otra persona no se ve; el superadmin lo ve pero no es el autor.
        assert (await ac.post(f"{BASE}/evidencias", headers=otra, json={"informe_diario_id": iid, "piezas": [{"artefacto_id": clave}]})).status_code == 404
        cid_admin = (await ac.post(f"{BASE}/conversaciones", headers=admin, json={})).json()["id"]
        r = await ac.post(f"{BASE}/evidencias", headers=admin,
                          json={"informe_diario_id": iid, "conversacion_id": cid_admin, "piezas": [{"spec": tabla}]})
        assert r.status_code == 403 and "autor" in r.json()["detail"]

        # Editar la figura (solo el autor); la captura del navegador queda en el disco persistente y se sirve como WebP.
        r = await ac.patch(f"{INF}/{iid}/figuras/{f2}", headers=coord, json={"titulo": "Llamadas por turno", "nota": ""})
        assert r.status_code == 200 and r.json()["titulo"] == "Llamadas por turno" and r.json()["nota"] is None and r.json()["figura"] == 2
        assert (await ac.patch(f"{INF}/{iid}/figuras/{f2}", headers=otra, json={"titulo": "x"})).status_code == 404
        assert (await ac.patch(f"{INF}/{iid}/figuras/{f2}", headers=admin, json={"titulo": "x"})).status_code == 403
        assert (await ac.patch(f"{INF}/{iid}/figuras/{f2}", headers=auditor, json={"titulo": "x"})).status_code == 403
        assert (await ac.patch(f"{INF}/{iid}/figuras/no-existe", headers=coord, json={"titulo": "x"})).status_code == 404
        subir = lambda fid, datos, quien=coord: ac.post(  # noqa: E731
            f"{INF}/{iid}/figuras/{fid}/imagen", headers=quien, files={"archivo": ("captura.png", datos, "image/png")})
        assert (await ac.get(f"{INF}/{iid}/figuras/{f1}/imagen", headers=coord)).status_code == 404
        assert (await subir(f1, b"no es una imagen")).status_code == 400
        assert (await subir(f1, b"")).status_code == 400
        assert (await subir(f1, _png(), otra)).status_code == 404
        assert (await subir(f1, _png(), admin)).status_code == 403
        r = await subir(f1, _png())
        assert r.status_code == 200, r.text
        assert r.json()["imagen"] is True and r.json()["figura"] == 1
        carpeta = Path(settings.upload_dir) / "informe_diario" / iid
        assert sorted(p.name for p in carpeta.iterdir()) == [f"{f1}.webp"]
        img = await ac.get(f"{INF}/{iid}/figuras/{f1}/imagen", headers=coord)
        assert img.status_code == 200 and img.headers["content-type"] == "image/webp" and img.content[8:12] == b"WEBP"
        assert img.headers["x-content-type-options"] == "nosniff" and dict(Image.open(io.BytesIO(img.content)).getexif()) == {}
        assert (await ac.get(f"{INF}/{iid}/figuras/{f1}/imagen", headers=otra)).status_code == 404
        assert (await ac.get(f"{INF}/{iid}/figuras/{f1}/imagen", headers=admin)).status_code == 200   # el superadmin ve el informe
        assert (await ac.get(f"{INF}/{iid}/figuras/{f1}/imagen", headers=auditor)).status_code == 403

        # El PDF del borrador lleva las figuras: la captura si existe, los datos si no.
        r = await ac.get(f"{INF}/{iid}/pdf", headers=coord)
        assert r.status_code == 200 and r.content.startswith(b"%PDF")
        texto = _texto_pdf(r.content)
        if texto:
            assert "FIGURAS" in texto and "Conversación bajo la meta a la tarde" in texto and "Llamadas por turno" in texto
            assert "Mañana" in texto and "3.000" in texto                           # la tabla, con los datos

        # Quitar una figura borra su captura; la otra queda.
        assert (await subir(f2, _png((118, 53, 148)))).status_code == 200
        assert (carpeta / f"{f2}.webp").exists()
        assert (await ac.delete(f"{INF}/{iid}/figuras/{f2}", headers=otra)).status_code == 404
        r = await ac.delete(f"{INF}/{iid}/figuras/{f2}", headers=coord)
        assert r.status_code == 200 and [f["figura"] for f in r.json()["figuras"]] == [1]
        assert not (carpeta / f"{f2}.webp").exists() and (carpeta / f"{f1}.webp").exists()
        assert (await ac.delete(f"{INF}/{iid}/figuras/{f2}", headers=coord)).status_code == 404

        # Firmar con figuras: quedan fijas y dentro del código de verificación.
        cuerpo = {"resultados": {"pospago": {"valor": 44, "meta": 50}, "gpon": {"valor": 15, "meta": 15}},
                  "resumen": "Día con buena conversación a la mañana y caída en el turno tarde.", "cargo": "Coordinadora de Televentas"}
        assert (await ac.put(f"{INF}/{iid}", headers=coord, json=cuerpo)).status_code == 200
        r = await ac.post(f"{INF}/{iid}/firmar", headers=coord, json={"cargo": "Coordinadora de Televentas"})
        assert r.status_code == 200, r.text
        assert r.json()["estado"] == "firmado" and r.json()["verificacion"] is True and len(r.json()["figuras"]) == 1
        for peticion in (ac.patch(f"{INF}/{iid}/figuras/{f1}", headers=coord, json={"titulo": "tarde"}),
                         ac.delete(f"{INF}/{iid}/figuras/{f1}", headers=coord), subir(f1, _png()),
                         ac.post(f"{BASE}/evidencias", headers=coord,
                                 json={"informe_diario_id": iid, "conversacion_id": cid, "piezas": [{"spec": tabla}]}),
                         ac.post(f"{BASE}/conversaciones/{cid}/investigacion", headers=coord,
                                 json={"activo": True, "tipo": "informe_diario", "informe_id": iid})):
            r = await peticion
            assert r.status_code == 409 and "firmado" in r.json()["detail"], r.text
        assert (await ac.get(f"{INF}/{iid}/figuras/{f1}/imagen", headers=coord)).status_code == 200
        r = await ac.get(f"{INF}/{iid}/pdf", headers=coord)
        assert r.status_code == 200 and "_BORRADOR" not in r.headers["content-disposition"]
        async with AsyncSessionLocal() as db:
            inf = await db.get(InformeDiario, iid)
            assert inf_srv.verificar(inf) is True
            inf.figuras = [{**inf.figuras[0], "titulo": "Otra cosa"}]              # si alguien la tocara, el código no verifica
            assert inf_srv.verificar(inf) is False
        # Apagar el modo desde el panel.
        r = await ac.post(f"{BASE}/conversaciones/{cid}/investigacion", headers=coord, json={"activo": False})
        assert r.status_code == 200 and r.json()["investigacion"] is None

        # Voi entra y sale del modo con su herramienta (el borrador de ayer se crea si no existe).
        ayer = (hoy - timedelta(days=1)).isoformat()
        cid2 = (await ac.post(f"{BASE}/conversaciones", headers=coord, json={"texto": "Armemos el informe diario de ayer"})).json()["id"]
        await _esperar(cid2)
        async with AsyncSessionLocal() as db:
            c2 = await db.get(AsistenteConversacion, cid2)
            assert c2.investigacion["tipo"] == "informe_diario" and c2.investigacion["fecha"] == ayer and c2.investigacion["por"] == "voi"
            inf2 = await db.get(InformeDiario, c2.investigacion["informe_id"])
            assert inf2.estado == "borrador" and inf2.fecha.isoformat() == ayer and inf2.autor_nombre == "Paola Coordinadora"
        t = (await ac.get(f"{BASE}/conversaciones/{cid2}", headers=coord)).json()
        assert "modo informe diario" in [i for i in t["items"] if i["tipo"] == "voi"][-1]["texto"]
        await asyncio.sleep(0.05)
        await ac.post(f"{BASE}/conversaciones/{cid2}/mensajes", headers=coord, json={"texto": "Salí del modo informe diario"})
        await _esperar(cid2)
        async with AsyncSessionLocal() as db:
            assert (await db.get(AsistenteConversacion, cid2)).investigacion is None
        # Quien no prepara el informe diario no tiene la herramienta: el mismo pedido no activa nada.
        cid3 = (await ac.post(f"{BASE}/conversaciones", headers=auditor, json={"texto": "Armemos el informe diario de hoy"})).json()["id"]
        await _esperar(cid3)
        async with AsyncSessionLocal() as db:
            assert (await db.get(AsistenteConversacion, cid3)).investigacion is None
            acciones = {a for (a,) in (await db.execute(select(AuditLog.action))).all()}
            assert {"asistente_modo_informe_diario", "asistente_figura_informe_diario", "informe_diario_figura_quitada"} <= acciones
