"""Voi, fase 2, probado con su simulador (nunca llama a Anthropic): el lienzo, la base de conocimiento con citas y
alcance por permisos, Facturación solo para quien tiene ese permiso (superadmin y Sub gerente) y las acciones nuevas
(seguimiento de tickets, comentar el informe diario, preparar auditorías y agregar hallazgos)."""
from __future__ import annotations

import asyncio
import io
import json
import zipfile

import pytest
from httpx import ASGITransport, AsyncClient
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate
from sqlalchemy import func, select

from app.asistente import config as voi_config
from app.asistente import conocimiento, definicion, sesiones
from app.asistente.herramientas import Ctx, ejecutar, obtener, para_usuario
from app.asistente.herramientas.base import ErrorHerramienta
from app.asistente.herramientas.lienzo import normalizar
from app.asistente.models import AsistenteAccion, AsistenteArtefacto, AsistenteFragmento
from app.asistente.permisos import modo
from app.api.deps import CurrentUser
from app.core.database import AsyncSessionLocal, Base, engine
from app.core.perfiles import DEFAULT_PERMISSIONS
from app.main import app
from app.models.audit import AuditLog
from app.operativas.televentas_claro.auditoria.models import Auditoria, AuditoriaHallazgo
from app.operativas.televentas_claro.supervision.models import Ticket, TicketEvento
from app.services import extraccion_texto
from tests.test_asistente import BASE, TC, _esperar, _login, _nuevo, _publicado, _usuario, simulador  # noqa: F401
from tests.test_ventas_netas import _subir_y_procesar, build_xlsx

DOCS = f"{BASE}/admin/documentos"
FACTURACION = {"facturacion_liquidaciones", "facturacion_liquidacion", "facturacion_comparar",
               "facturacion_calidad_por_fecha", "facturacion_criterios", "facturacion_simular"}


def setup_module(module):
    from app.main import _seed_profiles

    async def _prep():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await _seed_profiles()
    asyncio.run(_prep())


# ============================ lienzo (sin red) ============================
def test_lienzo_valida_y_normaliza():
    spec, avisos = normalizar({"tipo": "barras", "titulo": "Ana lidera Pospago", "x": "vendedor", "orden": "desc",
                               "series": [{"campo": "pospago", "nombre": "Pospago"}], "destacar": "Ana", "meta": "40",
                               "datos": [{"vendedor": "Luis", "pospago": "1.234,5"}, {"vendedor": "Ana", "pospago": 2000}]})
    assert avisos == [] and spec["datos"][0] == {"vendedor": "Ana", "pospago": 2000.0}
    assert spec["datos"][1]["pospago"] == 1234.5 and spec["destacar"] == "Ana" and spec["meta"] == 40.0
    # Dona: el resto en «Otros»; más de 6 series se recortan con aviso.
    filas = [{"plan": f"P{i}", "lineas": 10 - i} for i in range(9)]
    spec, avisos = normalizar({"tipo": "dona", "titulo": "Mix de planes", "x": "plan", "datos": filas})
    assert len(spec["datos"]) == 6 and spec["datos"][-1]["plan"] == "Otros" and spec["datos"][-1]["lineas"] == 5 + 4 + 3 + 2
    assert any("Otros" in a for a in avisos)
    muchas = [{"dia": "01/10", **{f"s{i}": i for i in range(8)}}]
    spec, avisos = normalizar({"tipo": "lineas", "titulo": "Muchas series", "x": "dia", "datos": muchas})
    assert len(spec["series"]) == 6 and avisos
    # Tablero con piezas; un tablero dentro de otro no.
    spec, _ = normalizar({"tipo": "tablero", "titulo": "Panorama del día", "widgets": [
        {"tipo": "kpis", "titulo": "Indicadores", "kpis": [{"titulo": "Pospago", "valor": "58", "variacion": 5.55}]},
        {"tipo": "tabla", "titulo": "Detalle", "datos": [{"a": "x", "b": 1}]}]})
    assert spec["widgets"][0]["kpis"][0] == {"titulo": "Pospago", "valor": 58.0, "formato": "numero", "detalle": None,
                                             "variacion": 5.5, "bueno_si": "sube"}
    assert spec["widgets"][1]["columnas"][0]["formato"] == "texto"
    for malo, error in (({"tipo": "torta", "titulo": "X"}, "tipo"), ({"tipo": "barras", "titulo": "Sin datos"}, "datos"),
                        ({"tipo": "barras", "titulo": "Serie rota", "x": "a", "series": [{"campo": "b"}],
                          "datos": [{"a": "x", "b": "hola"}]}, "números"),
                        ({"tipo": "tablero", "titulo": "Anidado", "widgets": [{"tipo": "tablero", "titulo": "Otro"}]}, "tipo"),
                        ({"tipo": "dona", "titulo": "Negativos", "x": "a", "datos": [{"a": "x", "v": -1}]}, "negativos")):
        with pytest.raises(ErrorHerramienta) as exc:
            normalizar(malo)
        assert error in str(exc.value)


# ============================ extracción y búsqueda (sin red) ============================
def _pdf(paginas: list[list[tuple[str, str]]]) -> bytes:
    """PDF con títulos y párrafos por página, más un encabezado y un pie repetidos (que se descartan)."""
    est = getSampleStyleSheet()
    buf = io.BytesIO()

    def marco(c, d):
        c.saveState()
        c.setFont("Helvetica", 8)
        c.drawString(40, 815, "Voicenter · Documento interno")
        c.drawRightString(555, 20, f"Página {d.page}")
        c.restoreState()

    historia = []
    for i, bloques in enumerate(paginas):
        if i:
            historia.append(PageBreak())
        for estilo, texto in bloques:
            historia.append(Paragraph(texto, est[estilo]))
    SimpleDocTemplate(buf, pagesize=A4).build(historia, onFirstPage=marco, onLaterPages=marco)
    return buf.getvalue()


def _manual_pdf() -> bytes:
    return _pdf([
        [("Heading1", "1. INTRODUCCIÓN"), ("BodyText", "Este manual explica la liquidación de comisiones de Pospago. " * 4)],
        [("Heading2", "2.1 Cuota diferida"), ("BodyText", "La cuota 2 se cobra a los 60 días si la línea sigue activa. " * 3)],
        [("Heading2", "2.2 Chargeback"), ("BodyText", "El chargeback dura 180 días desde la activación de la línea. " * 3)],
    ])


def _docx(parrafos: list[tuple[str | None, str]]) -> bytes:
    w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    cuerpo = "".join((f'<w:p><w:pPr><w:pStyle w:val="{estilo}"/></w:pPr>' if estilo else "<w:p>") +
                     f'<w:r><w:t xml:space="preserve">{texto}</w:t></w:r></w:p>' for estilo, texto in parrafos)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", f'<?xml version="1.0"?><w:document {w}><w:body>{cuerpo}</w:body></w:document>')
    return buf.getvalue()


def test_extraccion_de_texto_por_formato():
    r = extraccion_texto.procesar("manual.pdf", _manual_pdf())
    assert r["paginas"] == 3 and not r["truncado"]
    frags = r["fragmentos"]
    assert [(f["pagina"], f["seccion"]) for f in frags] == [(1, "1. INTRODUCCIÓN"), (2, "2.1 Cuota diferida"),
                                                           (3, "2.2 Chargeback")]
    assert not any("Documento interno" in f["texto"] or "Página" in f["texto"] for f in frags)   # encabezado y pie
    r = extraccion_texto.procesar("politica.docx", _docx([("Ttulo1", "Calidad de ventas"),
                                                          (None, "Toda venta necesita grabación completa."),
                                                          ("Heading2", "Penalidades"),
                                                          (None, "Sin grabación se descuenta el bono.")]))
    assert [(f["seccion"], f["texto"]) for f in r["fragmentos"]] == [
        ("Calidad de ventas", "Toda venta necesita grabación completa."), ("Penalidades", "Sin grabación se descuenta el bono.")]
    r = extraccion_texto.procesar("faq.md", "# Preguntas\n\n## ¿Qué es PFI?\n\nLa observación de Claro.\n".encode())
    assert r["fragmentos"] == [{"pagina": None, "seccion": "¿Qué es PFI?", "texto": "La observación de Claro."}]
    assert extraccion_texto.procesar("notas.txt", "Recupero del 12%.".encode("cp1252"))["fragmentos"][0]["texto"] == "Recupero del 12%."
    # Párrafos largos se parten por oraciones sin pasar el máximo.
    largo = extraccion_texto.procesar("largo.txt", ("Una oración bastante larga para probar el corte. " * 120).encode())
    assert len(largo["fragmentos"]) > 3 and max(len(f["texto"]) for f in largo["fragmentos"]) <= extraccion_texto.MAXIMO
    for nombre, contenido, motivo in (("x.pdf", b"%PDF-1.4 roto", "PDF"), ("x.docx", b"PK\x03\x04nada", "Word"),
                                      ("x.exe", b"MZ", "Formato"), ("x.txt", b"\x00\x01binario", "texto")):
        with pytest.raises(extraccion_texto.DocumentoInvalido) as exc:
            extraccion_texto.procesar(nombre, contenido)
        assert motivo in str(exc.value)
    bomba = io.BytesIO()
    with zipfile.ZipFile(bomba, "w") as z:
        z.writestr("word/document.xml", '<!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>')
    with pytest.raises(extraccion_texto.DocumentoInvalido):
        extraccion_texto.procesar("x.docx", bomba.getvalue())     # entidades XML: rechazado


def test_terminos_sin_tildes_plurales_ni_palabras_vacias():
    assert conocimiento.terminos("¿Qué dice el manual sobre las comisiones?") == ["manual", "comision"]
    assert conocimiento.terminos("Comisión") == conocimiento.terminos("comisiones")
    assert conocimiento.terminos("cuotas diferidas") == conocimiento.terminos("cuota diferida")
    assert conocimiento.terminos("meses") == conocimiento.terminos("mes") and conocimiento.terminos("veces") == ["vez"]
    assert conocimiento.terminos("180 días") == ["180", "dia"]
    with pytest.raises(ValueError):
        conocimiento.alcance_valido({"tipo": "permisos", "permisos": ["inventado.permiso"]})
    with pytest.raises(ValueError):
        conocimiento.alcance_valido({"tipo": "permisos", "permisos": []})
    assert conocimiento.alcance_valido({"tipo": "permisos", "permisos": [f"{TC}.facturacion"]}) == \
        {"tipo": "permisos", "permisos": [f"{TC}.facturacion"]}
    assert conocimiento.etiqueta_cita("Manual [v2]", 4, None) == "Manual v2, p. 4"


# ============================ base de conocimiento (API + simulador) ============================
async def _subir(ac, admin, nombre, contenido, *, titulo, alcance=None, descripcion=""):
    return await ac.post(DOCS, headers=admin, files={"archivo": (nombre, contenido, "application/octet-stream")},
                         data={"titulo": titulo, "descripcion": descripcion,
                               "alcance": json.dumps(alcance or {"tipo": "todos"})})


@pytest.mark.asyncio
async def test_base_de_conocimiento_con_citas_y_alcance(simulador):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        coord_id, coord = await _nuevo(ac, admin, "coordinador", "Carla Coordinadora")
        _, subg = await _nuevo(ac, admin, "sub_gerente", "Sergio Subgerente")

        # Solo el superadmin administra la base.
        assert (await ac.get(DOCS, headers=coord)).status_code == 403
        assert (await _subir(ac, coord, "a.md", b"# Hola\n\nTexto.", titulo="X")).status_code == 403

        r = await _subir(ac, admin, "Manual comisiones.pdf", _manual_pdf(), titulo="Manual de comisiones",
                         alcance={"tipo": "permisos", "permisos": [f"{TC}.facturacion"]},
                         descripcion="Cuotas, chargeback y PFI")
        assert r.status_code == 201, r.text
        manual = r.json()
        assert manual["paginas"] == 3 and manual["fragmentos"] == 3 and manual["alcance"]["tipo"] == "permisos"
        r = await _subir(ac, admin, "calidad.docx", _docx([("Ttulo1", "Grabaciones"),
                                                            (None, "Toda venta necesita la grabación completa del llamado "
                                                                   "y la validación de identidad del titular.")]),
                         titulo="Política de calidad")
        assert r.status_code == 201, r.text
        politica = r.json()
        r = await _subir(ac, admin, "privado.md", "# Plan\n\nEstrategia de grabación reservada.".encode(),
                         titulo="Plan reservado", alcance={"tipo": "superadmin"})
        privado = r.json()

        # Validaciones: formato, contenido que no coincide con la extensión, vacío, alcance inválido, PDF sin texto.
        assert (await _subir(ac, admin, "x.exe", b"MZ", titulo="X")).status_code == 400
        assert (await _subir(ac, admin, "x.pdf", b"no soy un pdf", titulo="X")).status_code == 400
        assert (await _subir(ac, admin, "x.md", b"", titulo="X")).status_code == 400
        r = await _subir(ac, admin, "x.md", b"# A\n\nB", titulo="X", alcance={"tipo": "permisos", "permisos": ["nada.x"]})
        assert r.status_code == 400 and "desconocidos" in r.json()["detail"]
        r = await _subir(ac, admin, "vacio.pdf", _pdf([[]]), titulo="Escaneado")
        assert r.status_code == 422 and "escaneado" in r.json()["detail"]

        lista = (await ac.get(DOCS, headers=admin)).json()
        assert {d["titulo"] for d in lista["items"]} == {"Manual de comisiones", "Política de calidad", "Plan reservado"}
        assert any(p["clave"] == f"{TC}.facturacion" for p in lista["permisos"]) and lista["max_mb"] > 0
        frags = (await ac.get(f"{DOCS}/{manual['id']}/fragmentos", headers=admin)).json()
        assert frags["total"] == 3 and frags["items"][2]["seccion"] == "2.2 Chargeback"

        # Búsqueda de prueba del superadmin: encuentra la página exacta y arma la cita.
        r = (await ac.post(f"{DOCS}/buscar", headers=admin, json={"consulta": "¿cuántos días dura el chargeback?"})).json()
        top = r["items"][0]
        assert top["documento"] == "Manual de comisiones" and top["pagina"] == 3
        assert top["cita"] == f"[Manual de comisiones, p. 3](cita:{top['fragmento_id']})"
        frag_manual = top["fragmento_id"]

        # Lo que ve cada uno: el coordinador no tiene Facturación (ni el documento reservado).
        async with AsyncSessionLocal() as db:
            cu = _usuario("coordinador")
            sg = _usuario("sub_gerente")
            vis_coord = {d.titulo for d in await conocimiento.documentos_para(db, cu)}
            vis_subg = {d.titulo for d in await conocimiento.documentos_para(db, sg)}
            assert vis_coord == {"Política de calidad"} and vis_subg == {"Manual de comisiones", "Política de calidad"}
            assert await conocimiento.buscar(db, cu, "chargeback días") == []
            assert (await conocimiento.buscar(db, sg, "chargeback días"))[0]["documento"] == "Manual de comisiones"
            # La herramienta se describe por persona, con sus documentos; sin documentos, no se da.
            _, defs = await sesiones._definiciones(db, cu, para_usuario(cu, "gestion"))
            desc = next(d["description"] for d in defs if d["name"] == "buscar_en_documentos")
            assert "Política de calidad" in desc and "Manual de comisiones" not in desc and "Plan reservado" not in desc

        # Citas: el pasaje exacto solo si el documento está a su alcance (si no, como si no existiera).
        assert (await ac.get(f"{BASE}/citas/{frag_manual}", headers=coord)).status_code == 404
        p = (await ac.get(f"{BASE}/citas/{frag_manual}", headers=subg)).json()
        assert p["pagina"] == 3 and "180 días" in p["texto"] and p["descargable"]
        d = await ac.get(f"{BASE}/documentos/{manual['id']}/archivo", headers=subg)
        assert d.status_code == 200 and d.content.startswith(b"%PDF-") and "attachment" in d.headers["content-disposition"]
        assert (await ac.get(f"{BASE}/documentos/{manual['id']}/archivo", headers=coord)).status_code == 404
        assert (await ac.get(f"{BASE}/documentos/{privado['id']}/archivo", headers=subg)).status_code == 404

        # Conversación: Voi busca en los documentos y responde con la cita.
        cid = (await ac.post(f"{BASE}/conversaciones", headers=coord,
                             json={"texto": "¿Qué dice la política sobre la grabación de las ventas?"})).json()["id"]
        await _esperar(cid)
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=coord)).json()
        paso = next(i for i in t["items"] if i["tipo"] == "paso")
        assert paso["herramienta"] == "buscar_en_documentos" and paso["estado"] == "ok"
        respuesta = t["items"][-1]["texto"]
        assert "[Política de calidad · Grabaciones](cita:frag_" in respuesta
        frag_politica = respuesta.split("(cita:")[1].split(")")[0]
        assert (await ac.get(f"{BASE}/citas/{frag_politica}", headers=coord)).json()["documento"] == "Política de calidad"

        # Desactivar: deja de estar para Voi y sus citas no abren (el superadmin igual lo ve).
        r = await ac.patch(f"{DOCS}/{politica['id']}", headers=admin, json={"activo": False, "titulo": "Política de calidad 2026"})
        assert r.status_code == 200 and r.json()["activo"] is False
        assert (await ac.get(f"{BASE}/citas/{frag_politica}", headers=coord)).status_code == 404
        assert (await ac.get(f"{BASE}/citas/{frag_politica}", headers=admin)).status_code == 200
        async with AsyncSessionLocal() as db:
            cu = _usuario("coordinador")
            assert await conocimiento.documentos_para(db, cu) == []
            # Sin documentos a su alcance, la sesión no recibe la herramienta (ni su descripción).
            usadas, defs = await sesiones._definiciones(db, cu, para_usuario(cu, "gestion"))
            assert "buscar_en_documentos" not in {d["name"] for d in defs} | {h.nombre for h in usadas}
            # El título nuevo cuenta para buscar (los términos se recalcularon).
            f = await db.get(AsistenteFragmento, frag_politica)
            assert "2026" in f.terminos
        r = await ac.patch(f"{DOCS}/{politica['id']}", headers=admin, json={"alcance": {"tipo": "permisos", "permisos": []}})
        assert r.status_code == 400

        # Reemplazar el archivo: fragmentos nuevos (las citas viejas dejan de abrir); borrar: no queda nada.
        r = await ac.post(f"{DOCS}/{manual['id']}/archivo", headers=admin,
                          files={"archivo": ("manual-v2.md", "# Chargeback\n\nAhora dura 180 días corridos.".encode(),
                                             "text/markdown")})
        assert r.status_code == 200 and r.json()["fragmentos"] == 1 and r.json()["titulo"] == "Manual de comisiones"
        assert (await ac.get(f"{BASE}/citas/{frag_manual}", headers=subg)).status_code == 404
        assert (await ac.delete(f"{DOCS}/{privado['id']}", headers=admin)).json() == {"ok": True}
        async with AsyncSessionLocal() as db:
            assert (await db.execute(select(func.count()).select_from(AsistenteFragmento).where(
                AsistenteFragmento.documento_id == privado["id"]))).scalar() == 0
            acciones = {a for (a,) in (await db.execute(select(AuditLog.action).where(
                AuditLog.action.like("asistente_documento_%")))).all()}
            assert acciones >= {"asistente_documento_subir", "asistente_documento_editar", "asistente_documento_reemplazar",
                                "asistente_documento_borrar", "asistente_documento_descargar"}


# ============================ Facturación: solo con su permiso ============================
def test_facturacion_solo_para_superadmin_y_sub_gerente():
    sa = CurrentUser(id="superadmin", email="a", role="superadmin", full_name="Admin")
    assert FACTURACION <= {h.nombre for h in para_usuario(sa, modo(sa))}
    assert FACTURACION <= {h.nombre for h in para_usuario(_usuario("sub_gerente"), "gestion")}
    for rol in ("coordinador", "controller", "analista", "auditor", "cliente"):
        u = _usuario(rol, sorted(set(DEFAULT_PERMISSIONS.get(rol, [])) | {f"{TC}.asistente"}))
        assert not FACTURACION & {h.nombre for h in para_usuario(u, modo(u))}, rol
    # Aunque un perfil restringido tuviera el permiso en la base, el modo auditoría no la da.
    aud = _usuario("auditor", [*DEFAULT_PERMISSIONS["auditor"], f"{TC}.facturacion"])
    assert not FACTURACION & {h.nombre for h in para_usuario(aud, "auditor")}
    # La habilidad de Facturación sigue el mismo permiso.
    assert sesiones._habilidad_permitida("voi-facturacion", _usuario("sub_gerente"), "gestion")
    assert not sesiones._habilidad_permitida("voi-facturacion", _usuario("coordinador"), "gestion")
    assert not sesiones._habilidad_permitida("voi-facturacion", aud, "auditor")
    assert "voi-facturacion" in {h.nombre for h in definicion.habilidades()}


@pytest.mark.asyncio
async def test_facturacion_se_revisa_al_ejecutar_y_simula(simulador):
    async with AsyncSessionLocal() as db:
        coord = _usuario("coordinador")
        texto, error = await ejecutar(obtener("facturacion_simular"), {"negocio": "pospago"},
                                      Ctx(db=db, user=coord, conversacion_id="x"), "gestion")
        assert error and "permiso" in texto and "Gs" not in texto
        sg = _usuario("sub_gerente")
        texto, error = await ejecutar(obtener("facturacion_simular"), {"negocio": "gpon", "cambios": {"ventas": 250}},
                                      Ctx(db=db, user=sg, conversacion_id="x"), "gestion")
        d = json.loads(texto)
        assert not error and d["negocio"].startswith("GPON") and d["derivados"]["activaciones"] == 250
        assert "confidenciales" in d["importante"]
        texto, error = await ejecutar(obtener("facturacion_simular"), {"negocio": "pospago", "cambios": {"planes": []}},
                                      Ctx(db=db, user=sg, conversacion_id="x"), "gestion")
        assert error and "no editable" in texto
        texto, error = await ejecutar(obtener("facturacion_criterios"), {"negocio": "pospago", "concepto": "diferido"},
                                      Ctx(db=db, user=sg, conversacion_id="x"), "gestion")
        d = json.loads(texto)
        assert not error and "chargeback" in d["criterios_por_negocio"]["pospago_movil"]
        conceptos = d["conceptos_de_la_liquidacion"]
        assert "DIFERIDO (concepto 1 cuota 2)" in conceptos and len(conceptos) < 6     # filtrado por el concepto

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        _, subg = await _nuevo(ac, admin, "sub_gerente", "Sofía Subgerente")
        _, coord = await _nuevo(ac, admin, "coordinador")
        est = (await ac.get(f"{BASE}/estado", headers=coord)).json()
        assert not FACTURACION & {h["nombre"] for h in est["herramientas"]}
        est = (await ac.get(f"{BASE}/estado", headers=subg)).json()
        assert FACTURACION <= {h["nombre"] for h in est["herramientas"]}
        cid = (await ac.post(f"{BASE}/conversaciones", headers=subg,
                             json={"texto": "Simulá la facturación de Pospago con 1800 ventas"})).json()["id"]
        await _esperar(cid)
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=subg)).json()
        paso = next(i for i in t["items"] if i["tipo"] == "paso")
        assert paso["herramienta"] == "facturacion_simular" and paso["estado"] == "ok"
        async with AsyncSessionLocal() as db:
            a = (await db.execute(select(AsistenteAccion).where(AsistenteAccion.conversacion_id == cid))).scalar_one()
            assert a.entrada == {"negocio": "pospago", "cambios": {"ventas": 1800}}
        # El coordinador pregunta lo mismo: su sesión no tiene Facturación (Voi no tiene con qué responder montos).
        cid = (await ac.post(f"{BASE}/conversaciones", headers=coord,
                             json={"texto": "Simulá la facturación de Pospago con 1800 ventas"})).json()["id"]
        await _esperar(cid)
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=coord)).json()
        assert not [i for i in t["items"] if i["tipo"] == "paso" and str(i.get("herramienta", "")).startswith("facturacion")]
        async with AsyncSessionLocal() as db:
            from app.asistente.models import AsistenteConversacion
            c = await db.get(AsistenteConversacion, cid)
            assert not FACTURACION & set(c.contexto["herramientas"])


# ============================ lienzo en una conversación ============================
@pytest.mark.asyncio
async def test_lienzo_en_la_conversacion(simulador):
    from tests.test_asistente import _prod_hoy
    await _prod_hoy()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        _, coord = await _nuevo(ac, admin, "coordinador")
        cid = (await ac.post(f"{BASE}/conversaciones", headers=coord,
                             json={"texto": "Haceme un gráfico de la productividad de hoy"})).json()["id"]
        await _esperar(cid)
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=coord)).json()
        tipos = [i["tipo"] for i in t["items"]]
        assert "lienzo" in tipos and "lienzo" in t["items"][-1]["texto"]
        pieza = next(i for i in t["items"] if i["tipo"] == "lienzo")["artefacto"]
        assert pieza["spec"]["tipo"] in ("barras", "kpis") and t["artefactos"][0]["id"] == pieza["id"]
        async with AsyncSessionLocal() as db:
            arts = (await db.execute(select(AsistenteArtefacto).where(AsistenteArtefacto.conversacion_id == cid))).scalars().all()
            assert len(arts) == 1 and arts[0].evento_id                 # ligado al pedido del agente
        # La transcripción del superadmin también lo muestra.
        full = (await ac.get(f"{BASE}/admin/conversaciones/{cid}", headers=admin)).json()
        assert any(i["tipo"] == "lienzo" for i in full["items"])


# ============================ acciones nuevas ============================
@pytest.mark.asyncio
async def test_seguimiento_de_ticket_y_comentario_del_informe(simulador):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        coord_id, coord = await _nuevo(ac, admin, "coordinador", "Carla Coordinadora")
        sup_id, _ = await _nuevo(ac, admin, "supervisor", "Silvia Supervisora")
        r = await ac.post("/api/v1/televentas-claro/supervision/tickets", headers=coord, json={
            "tipo": "otro", "prioridad": "baja", "descripcion": "Revisar el cierre de ventas de la tarde.",
            "supervisor_id": sup_id})
        assert r.status_code == 201, r.text
        numero = r.json()["numero"]

        cid = (await ac.post(f"{BASE}/conversaciones", headers=coord,
                             json={"texto": f"Comentá el ticket {numero}: ya hablé con el equipo"})).json()["id"]
        conv = await _esperar(cid)
        assert conv.estado == "requires_action"                       # afecta a otros: pide confirmación
        acc = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=coord)).json()["pendientes"][0]
        assert acc["herramienta"] == "seguimiento_ticket" and acc["resumen"].startswith(f"Comentar el ticket #{numero}")
        assert (await ac.post(f"{BASE}/acciones/{acc['id']}/confirmar", headers=coord)).json()["estado"] in (
            "ejecutando", "ejecutada")
        await _esperar(cid, hasta=("idle",))
        async with AsyncSessionLocal() as db:
            t = (await db.execute(select(Ticket).where(Ticket.numero == numero))).scalar_one()
            eventos = (await db.execute(select(TicketEvento).where(TicketEvento.ticket_id == t.id))).scalars().all()
            assert any(e.tipo == "comentario" and "Desde Voi" in (e.texto or "") for e in eventos)
            a = await db.get(AsistenteAccion, acc["id"])
            assert a.estado == "ejecutada" and a.resultado

        # Cancelar el ticket (con confirmación) y un número que no existe.
        cid = (await ac.post(f"{BASE}/conversaciones", headers=coord,
                             json={"texto": f"Cancelá el ticket {numero}, se envió por error"})).json()["id"]
        await _esperar(cid)
        acc = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=coord)).json()["pendientes"][0]
        assert acc["resumen"].startswith(f"Cancelar el ticket #{numero}")
        await ac.post(f"{BASE}/acciones/{acc['id']}/confirmar", headers=coord)
        await _esperar(cid, hasta=("idle",))
        async with AsyncSessionLocal() as db:
            assert (await db.execute(select(Ticket).where(Ticket.numero == numero))).scalar_one().estado == "cerrado"
            texto, error = await ejecutar(obtener("seguimiento_ticket"), {"ticket": "99999", "accion": "comentar",
                                                                          "texto": "Un comentario de prueba"},
                                          Ctx(db=db, user=_usuario("coordinador"), conversacion_id="x"), "gestion")
            assert error and "No encontré ese ticket" in texto

        # Informe diario firmado por la coordinadora; el superadmin lo comenta con Voi.
        inf = "/api/v1/televentas-claro/informe-diario"
        iid = (await ac.post(inf, headers=coord, json={})).json()["id"]
        r = await ac.put(f"{inf}/{iid}", headers=coord, json={
            "resultados": {"pospago": {"valor": 40}, "gpon": {"valor": 12}},
            "resumen": "Buen día de ventas: se cumplió la meta de GPON y se reforzó el cierre de la tarde."})
        assert r.status_code == 200, r.text
        assert (await ac.post(f"{inf}/{iid}/firmar", headers=coord, json={"cargo": "Coordinadora"})).status_code == 200
        cid = (await ac.post(f"{BASE}/conversaciones", headers=admin,
                             json={"texto": "Comentá el informe de hoy: muy buen cierre"})).json()["id"]
        await _esperar(cid)
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=admin)).json()
        assert next(i for i in t["items"] if i["tipo"] == "paso")["herramienta"] == "seguimiento_informes_diarios"
        acc = t["pendientes"][0]
        assert acc["herramienta"] == "comentar_informe_diario" and "Carla Coordinadora" in acc["resumen"]
        await ac.post(f"{BASE}/acciones/{acc['id']}/confirmar", headers=admin)
        await _esperar(cid, hasta=("idle",))
        det = (await ac.get(f"{inf}/{iid}", headers=coord)).json()
        assert any("Desde Voi" in c["texto"] and c["rol"] == "superadmin" for c in det["comentarios"])
        assert det["revisado_at"]
        # Un coordinador no ve el seguimiento del equipo ni comenta informes ajenos.
        async with AsyncSessionLocal() as db:
            otro = _usuario("coordinador")
            assert "seguimiento_informes_diarios" not in {h.nombre for h in para_usuario(otro, "gestion")}
            texto, error = await ejecutar(obtener("comentar_informe_diario"), {"informe_id": iid, "texto": "Hola"},
                                          Ctx(db=db, user=otro, conversacion_id="x"), "gestion")
            assert error and "No encontré ese informe" in texto


@pytest.mark.asyncio
async def test_auditor_prepara_auditoria_y_agrega_hallazgo(simulador, tmp_path, monkeypatch):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        _, aud = await _nuevo(ac, admin, "auditor", "Ana Auditora")
        await _subir_y_procesar(ac, admin, build_xlsx(tmp_path / "sep.xlsx"), monkeypatch)

        cid = (await ac.post(f"{BASE}/conversaciones", headers=aud,
                             json={"texto": "Prepará una auditoría de 2026-09"})).json()["id"]
        conv = await _esperar(cid)
        assert conv.estado == "idle"                                     # lo propio: corre sola
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=aud)).json()
        card = next(i for i in t["items"] if i["tipo"] == "accion")["accion"]
        assert card["herramienta"] == "preparar_auditoria" and card["estado"] == "ejecutada"
        assert card["pantalla"].startswith("/televentas-claro/auditoria/")
        async with AsyncSessionLocal() as db:
            a = (await db.execute(select(Auditoria))).scalar_one()
            assert a.status == "borrador" and a.periodo_desde == "2026-09" and a.codigo.startswith("AUD-")
            automaticos = (await db.execute(select(func.count()).select_from(AuditoriaHallazgo).where(
                AuditoriaHallazgo.auditoria_id == a.id))).scalar()

        cid = (await ac.post(f"{BASE}/conversaciones", headers=aud,
                             json={"texto": "Agregá un hallazgo: ventas sin grabación en la tarde"})).json()["id"]
        await _esperar(cid)
        async with AsyncSessionLocal() as db:
            hs = (await db.execute(select(AuditoriaHallazgo).where(AuditoriaHallazgo.auditoria_id == a.id)
                                   .order_by(AuditoriaHallazgo.orden))).scalars().all()
            assert len(hs) == automaticos + 1 and hs[-1].origen == "manual" and "sin grabación" in hs[-1].descripcion
            # Un mes sin Ventas Netas: Voi lo explica sin crear nada.
            texto, error = await ejecutar(obtener("preparar_auditoria"), {"titulo": "Auditoría de enero", "meses": ["2026-01"]},
                                          Ctx(db=db, user=_usuario("auditor"), conversacion_id="x"), "auditor")
            assert error and "2026-01" in texto
            # Cerrada, ya no se le agregan hallazgos.
            a = await db.get(Auditoria, a.id)
            a.status = "cerrado"
            await db.commit()
            texto, error = await ejecutar(obtener("agregar_hallazgo"), {"auditoria": a.codigo, "titulo": "Otro hallazgo"},
                                          Ctx(db=db, user=_usuario("auditor"), conversacion_id="x"), "auditor")
            assert error and "no se puede modificar" in texto


def test_config_del_esfuerzo_y_habilidades_nuevas():
    assert voi_config.ESFUERZOS == ("low", "medium", "high")
    assert voi_config.DEFECTO["modelo"]["esfuerzo"] == "low"
    nombres = {h.nombre for h in definicion.habilidades()}
    assert {"voi-visualizacion", "voi-facturacion"} <= nombres
    assert "voi-visualizacion" in definicion.HABILIDADES_AUDITOR and "voi-facturacion" not in definicion.HABILIDADES_AUDITOR
    assert definicion.PERMISO_HABILIDAD["voi-facturacion"] == (f"{TC}.facturacion",)
    assert definicion.modelo()["effort"] == "low"
