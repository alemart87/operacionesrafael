"""Informe diario: lo preparan coordinador, sub gerente y superadmin (resultados del día, datos importados, resumen,
métricas críticas con compromisos, firma y PDF); los compromisos siguen al día siguiente; el superadmin sigue el
cumplimiento, comenta y mide las palabras clave."""
from __future__ import annotations

import asyncio
import base64
import io
import uuid
from datetime import date, datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import select

from app.core.database import AsyncSessionLocal, Base, engine
from app.main import app
from app.operativas.televentas_claro.informe_diario import informe as srv
from app.operativas.televentas_claro.informe_diario.models import InformeCompromiso, InformeDiario
from app.operativas.televentas_claro.informe_diario.palabras import (
    TEMAS_DEFECTO, Diccionario, DiccionarioInvalido, analizar, buscar, validar,
)
from app.operativas.televentas_claro.productividad.models import ProdInforme
from app.operativas.televentas_claro.ventas_netas.models import VentasNetasReport

BASE = "/api/v1/televentas-claro/informe-diario"
TC = "televentas_claro"
D = lambda m, d: date(2026, m, d)  # noqa: E731


# ============================ palabras clave ============================
def test_palabras_frases_plurales_raices_y_negacion():
    dic = Diccionario(TEMAS_DEFECTO)
    texto = ("Hubo una caída del sistema y 3 ausencias. No hubo reclamos. Las líneas sin uso bajaron; "
             "riesgo de no llegar, urgente revisar. Superamos la meta.")
    hs = buscar(texto, dic)
    vistos = {texto[h["ini"]:h["fin"]]: (h["tema"], h["negada"]) for h in hs}
    assert vistos["caída del sistema"] == ("sistemas", False)         # la frase cuenta una vez (no «caída» + «sistema»)
    assert vistos["ausencias"] == ("personal", False)                 # raíz «ausen*»
    assert vistos["reclamos"] == ("calidad", True)                    # «No hubo reclamos»: negada
    assert vistos["líneas sin uso"] == ("uso", False)                 # frase con «sin»: no es negación
    assert vistos["meta"] == ("ventas", False) and vistos["Superamos"] == ("logros", False)
    a = analizar([("resumen", texto)], dic)
    assert a["criticas"] == 2 and a["nivel"] == "medio" and a["negadas"] == 1
    assert {c["clave"]: c["forma"] for c in a["claves"]}["caida del sistema"] == "caída del sistema"   # como se escribió
    assert a["temas"]["riesgo"] == 2 and a["marcas"]["resumen"][0][:2] == [texto.index("caída"), texto.index("caída") + len("caída del sistema")]
    assert analizar([("r", "Riesgo crítico, urgente y grave.")], dic)["nivel"] == "alto"
    assert analizar([("r", "Día tranquilo, sin novedades ni riesgos.")], dic)["nivel"] == "bajo"
    # «sin» dentro de la frase «sin uso» no niega a la palabra que sigue.
    assert [(h["clave"], h["negada"]) for h in buscar("% sin uso Pospago", dic)] == [("sin uso", False), ("pospago", False)]


def test_validar_el_diccionario():
    ok = validar([{"clave": "clientes", "nombre": "Clientes", "critico": False, "palabras": ["Cliente", "cliente", "fideliz*"]}])
    assert ok[0]["palabras"] == ["cliente", "fideliz*"]
    for malo in ([], [{"clave": "X", "nombre": "Mal", "palabras": ["a"]}], [{"clave": "ok", "nombre": "Raíz", "palabras": ["ab*"]}],
                 [{"clave": "ok", "nombre": "Medio", "palabras": ["ca*da"]}], [{"clave": "ok", "nombre": "Vacío", "palabras": []}]):
        with pytest.raises(DiccionarioInvalido):
            validar(malo)


# ============================ firma y código ============================
def _png(w=300, h=120) -> str:
    im = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    for x in range(20, 280):
        im.putpixel((x, 60 + (x % 9) - 4), (15, 17, 22, 255))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def test_la_firma_tiene_que_ser_un_png_valido():
    assert srv.validar_imagen(_png()).startswith("data:image/png;base64,")
    for malo in ("data:image/jpeg;base64,AAAA", "data:image/png;base64,no-es-base64!!",
                 "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"x" * 50).decode(), _png(3000, 100)):
        with pytest.raises(srv.ReglaInvalida):
            srv.validar_imagen(malo)


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


async def _datos(dia: date):
    """Un informe de llamadas y una planilla de netas con las cargas del día."""
    async with AsyncSessionLocal() as db:
        db.add(ProdInforme(fecha=dia, status="published", corte_final="18:00", agentes=40, llamadas=5200, atendidas=3900,
                           pct_conversacion=31.5, banda="bajo", data={
                               "kpis": {"agentes": 40, "agentes_validos": 38, "login": 40 * 8 * 3600, "pct_conversacion": 31.5,
                                        "banda": "bajo", "llamadas": 5200, "atendidas": 3900, "pct_contacto": 75.0, "aht": 185,
                                        "llamadas_hora": 16.3, "pct_pausa": 9.2, "bandas": {"rojo": 4, "bajo": 20, "meta": 14, "sobre": 2}},
                               "alertas": [{"tipo": "sin_llamadas"}], "sin_conexion": [],
                               "turnos": {"determinado": True, "manana": {"agentes": 22, "llamadas": 3000, "pct_conversacion": 33.0},
                                          "tarde": {"agentes": 18, "llamadas": 2200, "pct_conversacion": 29.4}}}))
        db.add(VentasNetasReport(upload_id="u1", periodo=dia.strftime("%Y-%m"), period_month=dia.replace(day=1), fecha_dato=dia,
                                 status="published", pospago=310, gpon=95, pct_sin_uso=12.4, pospago_sin_uso=31, data={
                                     "detalle_netas": [], "productividad": {
                                         "por_dia": [{"dia": dia.isoformat(), "total": 62, "pospago": 44, "internet": 15, "iptv": 3,
                                                      "finalizadas": 50, "pct_finalizacion": 80.6}],
                                         "kpis": {"promedio_diario": 58.5, "dias_con_cargas": 12}}}))
        await db.commit()


def _metricas():
    return [
        {"id": "m1", "nombre": "% sin uso Pospago", "indicador": "12,4%", "estado": "critico",
         "comentario": "Subió el sin uso: riesgo de PFI en dos equipos.", "compromiso": "Revisar con cada supervisor las líneas sin uso.",
         "responsable": "Coordinación", "fecha_compromiso": "2026-10-16"},
        {"id": "m2", "nombre": "Conversación", "indicador": "31,5%", "estado": "atencion",
         "comentario": "Bajo la meta en el turno tarde.", "compromiso": "Escuchas en el turno tarde."},
    ]


@pytest.mark.asyncio
async def test_flujo_preparar_importar_firmar_pdf_y_seguimiento(monkeypatch):
    reloj = {"hoy": D(10, 14)}
    monkeypatch.setattr(srv, "hoy", lambda: reloj["hoy"])
    await _datos(D(10, 14))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        coord_id, coord = await _new_user(ac, admin, "coordinador", "Paola Coordinadora")
        _, subg = await _new_user(ac, admin, "sub_gerente", "Sergio Subgerente")
        _, analista = await _new_user(ac, admin, "analista")
        _, controller = await _new_user(ac, admin, "controller")

        # Quién lo prepara: coordinador, sub gerente y superadmin; el analista y el controller, no.
        for h in (analista, controller):
            assert (await ac.post(BASE, headers=h, json={})).status_code == 403
            assert (await ac.get(BASE, headers=h)).status_code == 403

        # «Preparar informe diario»: abre el borrador de hoy; si ya existe, el mismo.
        r = await ac.post(BASE, headers=coord, json={})
        assert r.status_code == 201 and r.json()["nuevo"]
        iid = r.json()["id"]
        r = await ac.post(BASE, headers=coord, json={"fecha": "2026-10-14"})
        assert r.status_code == 200 and r.json() == {"id": iid, "nuevo": False, "estado": "borrador"}
        for mala in ("2026-10-15", "2026-10-06"):       # futura · más de 7 días atrás
            assert (await ac.post(BASE, headers=coord, json={"fecha": mala})).status_code == 400
        d = (await ac.get(f"{BASE}/{iid}", headers=coord)).json()
        assert d["puede_editar"] and d["cargo"] == "Coordinador" and d["compromisos_abiertos"] == [] and d["anterior"] is None
        assert "palabras" not in d                      # el análisis lo ve el superadmin
        # Nadie más lo ve (el superadmin sí).
        assert (await ac.get(f"{BASE}/{iid}", headers=subg)).status_code == 404
        assert (await ac.get(f"{BASE}/{iid}", headers=admin)).status_code == 200

        # Importar datos ya cargados: llamadas y cargas del día (con los valores para la zona manual).
        f = (await ac.get(f"{BASE}/fuentes", headers=coord, params={"fecha": "2026-10-14"})).json()["fuentes"]
        tipos = {x["tipo"]: x for x in f}
        assert tipos["llamadas"]["opciones"][0]["ref"] == "2026-10-14" and tipos["llamadas"]["opciones"][0]["estado"] == "publicado"
        assert (tipos["cargas"]["opciones"][0]["pospago"], tipos["cargas"]["opciones"][0]["gpon"]) == (44, 15)
        r = await ac.post(f"{BASE}/{iid}/importar", headers=coord, json={"tipo": "llamadas", "ref": "2026-10-14"})
        assert r.status_code == 200, r.text
        snap = r.json()["importado"]
        kpis = {k["label"]: k for k in snap["kpis"]}
        assert kpis["% conversación"]["valor"] == "31,5%" and kpis["Llamadas"]["valor"] == "5.200" and kpis["AHT"]["valor"] == "3:05"
        assert kpis["Agentes en rojo"]["tono"] == "malo" and snap["filas"]["filas"][0][0] == "Mañana"
        r = await ac.post(f"{BASE}/{iid}/importar", headers=coord, json={"tipo": "cargas", "ref": "2026-10-14"})
        assert r.status_code == 200 and r.json()["importado"]["valores"] == {"pospago": 44, "gpon": 15, "iptv": 3}
        r = await ac.post(f"{BASE}/{iid}/importar", headers=coord, json={"tipo": "llamadas", "ref": "2026-10-14"})
        assert r.json()["reemplazo"] and len(r.json()["importados"]) == 2      # volver a importar actualiza, no duplica
        r = await ac.post(f"{BASE}/{iid}/importar", headers=coord, json={"tipo": "coaching", "ref": "2026-10-14"})
        assert r.status_code == 404 and "No hay coachings" in r.json()["detail"]
        assert (await ac.post(f"{BASE}/{iid}/importar", headers=coord, json={"tipo": "llamadas", "ref": "2026-10-13"})).status_code == 404
        importados = [x["id"] for x in (await ac.get(f"{BASE}/{iid}", headers=coord)).json()["importados"]]

        # Guardar el borrador: zona manual (Pospago, GPON y otros), resumen y métricas críticas con compromisos.
        cuerpo = {"resultados": {"pospago": {"valor": 44, "meta": 50, "comentario": "Faltó cierre en la tarde."},
                                 "gpon": {"valor": 15, "meta": 15}, "otros": [{"id": "o1", "nombre": "IPTV", "valor": 3}],
                                 "fuente": "Cargas del mié 14/10 (planilla al 14/10)"},
                  "resumen": "Día con buena conversación a la mañana; urgente: caída del sistema 30 min 🚀 → se recuperó.",
                  "metricas": _metricas(), "importados": importados, "cargo": "Coordinadora de Televentas"}
        r = await ac.put(f"{BASE}/{iid}", headers=coord, json={**cuerpo, "resumen": "corto"})
        assert r.status_code == 200
        r = await ac.post(f"{BASE}/{iid}/firmar", headers=coord, json={"cargo": "Coordinadora de Televentas"})
        assert r.status_code == 400 and "resumen" in r.json()["detail"]
        assert (await ac.put(f"{BASE}/{iid}", headers=subg, json=cuerpo)).status_code == 404
        assert (await ac.put(f"{BASE}/{iid}", headers=coord, json={**cuerpo, "metricas": [{"id": "x y", "nombre": "a"}]})).status_code == 422
        assert (await ac.put(f"{BASE}/{iid}", headers=coord, json=cuerpo)).status_code == 200
        d = (await ac.get(f"{BASE}/{iid}", headers=coord)).json()
        assert d["resultados"]["pospago"]["valor"] == 44 and len(d["metricas"]) == 2 and d["cargo"] == "Coordinadora de Televentas"
        assert [x["tipo"] for x in d["importados"]] == ["cargas", "llamadas"]

        # PDF del borrador (con la marca), y firma con la firma manuscrita guardada.
        r = await ac.get(f"{BASE}/{iid}/pdf", headers=coord)
        assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
        assert "Informe-diario_2026-10-14_Paola-Coordinadora_BORRADOR.pdf" in r.headers["content-disposition"]
        assert (await ac.post(f"{BASE}/{iid}/firmar", headers=coord, json={"cargo": "Coordinadora", "con_firma": True})).status_code == 400
        assert (await ac.put(f"{BASE}/firma", headers=coord, json={"imagen": "data:image/png;base64,AAAA"})).status_code == 400
        r = await ac.put(f"{BASE}/firma", headers=coord, json={"imagen": _png()})
        assert r.status_code == 200 and r.json()["imagen"].startswith("data:image/png")
        r = await ac.post(f"{BASE}/{iid}/firmar", headers=coord, json={"cargo": "Coordinadora de Televentas", "con_firma": True})
        assert r.status_code == 200, r.text
        firmado = r.json()
        assert firmado["estado"] == "firmado" and firmado["verificacion"] is True and not firmado["puede_editar"]
        assert len(firmado["firma"]["codigo"]) == 14 and firmado["firma"]["imagen"].startswith("data:image/png")
        assert firmado["firma"]["cargo"] == "Coordinadora de Televentas"
        r = await ac.get(f"{BASE}/{iid}/pdf", headers=coord)
        assert r.status_code == 200 and len(r.content) > 20_000 and "_BORRADOR" not in r.headers["content-disposition"]
        # Firmado: ya no se cambia.
        assert (await ac.put(f"{BASE}/{iid}", headers=coord, json=cuerpo)).status_code == 409
        assert (await ac.post(f"{BASE}/{iid}/importar", headers=coord, json={"tipo": "cargas", "ref": "2026-10-14"})).status_code == 409
        assert (await ac.delete(f"{BASE}/{iid}", headers=coord)).status_code == 409
        async with AsyncSessionLocal() as db:
            cs = (await db.execute(select(InformeCompromiso).where(InformeCompromiso.informe_id == iid))).scalars().all()
        assert sorted(c.metrica for c in cs) == ["% sin uso Pospago", "Conversación"]

        # El superadmin lo ve con las palabras clave, lo comenta (queda revisado) y el autor responde.
        d = (await ac.get(f"{BASE}/{iid}", headers=admin)).json()
        assert d["palabras"]["criticas"] >= 2 and "resumen" in d["palabras"]["marcas"] and not d["es_autor"]
        assert (await ac.post(f"{BASE}/{iid}/comentarios", headers=coord, json={"texto": " "})).status_code == 400
        r = await ac.post(f"{BASE}/{iid}/comentarios", headers=admin, json={"texto": "¿Qué pasó con el sistema? Mandame el detalle."})
        assert r.status_code == 201 and r.json()["revisado_at"]
        lista = (await ac.get(BASE, headers=coord)).json()
        assert lista["nuevos"] == 1 and lista["de_hoy"]["id"] == iid and lista["compromisos"]["abiertos"] == 2
        d = (await ac.get(f"{BASE}/{iid}", headers=coord)).json()
        assert d["nuevos"] == 1 and d["comentarios"][0]["rol"] == "superadmin"
        assert (await ac.get(BASE, headers=coord)).json()["nuevos"] == 0           # al abrirlo, quedan leídos
        r = await ac.post(f"{BASE}/{iid}/comentarios", headers=coord, json={"texto": "Fue el CRM, ya está resuelto."})
        assert [c["rol"] for c in r.json()["comentarios"]] == ["superadmin", "autor"]
        assert (await ac.post(f"{BASE}/{iid}/revisado", headers=coord, json={})).status_code == 403

        # Al día siguiente: los compromisos abiertos para seguir y las métricas del informe anterior.
        reloj["hoy"] = D(10, 15)
        r = await ac.post(BASE, headers=coord, json={})
        iid2 = r.json()["id"]
        d2 = (await ac.get(f"{BASE}/{iid2}", headers=coord)).json()
        comp = {c["metrica"]: c for c in d2["compromisos_abiertos"]}
        assert set(comp) == {"% sin uso Pospago", "Conversación"} and comp["% sin uso Pospago"]["fecha_limite"] == "2026-10-16"
        assert d2["anterior"]["fecha"] == "2026-10-14" and d2["anterior"]["pospago"] == 44 and len(d2["anterior"]["metricas"]) == 2
        assert d2["firma_guardada"]["cargo"] == "Coordinadora de Televentas" and d2["cargo"] == "Coordinadora de Televentas"
        seg = [{"compromiso_id": comp["% sin uso Pospago"]["id"], "estado": "cumplido", "nota": "Revisadas las 31 líneas."},
               {"compromiso_id": comp["Conversación"]["id"], "estado": "en_curso", "nota": "Faltan dos supervisores."},
               {"compromiso_id": "no-existe", "estado": "cumplido", "nota": ""}]
        r = await ac.put(f"{BASE}/{iid2}", headers=coord, json={
            "resultados": {"pospago": {"valor": 51}, "gpon": {"valor": 0}}, "resumen": "Sin novedades graves; se cumplió la revisión del sin uso.",
            "seguimiento": seg})
        assert r.status_code == 200
        r = await ac.post(f"{BASE}/{iid2}/firmar", headers=coord, json={"cargo": "Coordinadora de Televentas"})
        assert r.status_code == 200, r.text
        s2 = r.json()
        assert [(x["metrica"], x["estado"]) for x in s2["seguimiento"]] == [("% sin uso Pospago", "cumplido"), ("Conversación", "en_curso")]
        assert s2["resultados"]["anterior"] == {"fecha": "2026-10-14", "pospago": 44.0, "gpon": 15.0} and s2["firma"]["imagen"] is None
        lista = (await ac.get(BASE, headers=coord)).json()
        assert lista["compromisos"]["abiertos"] == 1 and lista["compromisos"]["items"][0]["ultimo"]["estado"] == "en_curso"
        assert [x["estado"] for x in lista["racha"][-2:]] == ["firmado", "firmado"]
        assert (await ac.get(f"{BASE}/{iid2}/pdf", headers=coord)).status_code == 200

        # Seguimiento del superadmin: cumplimiento por autor y día, compromisos y palabras clave.
        assert (await ac.get(f"{BASE}/seguimiento", headers=coord)).status_code == 403
        p = (await ac.get(f"{BASE}/seguimiento", headers=admin, params={"desde": "2026-10-12", "hasta": "2026-10-15"})).json()
        assert p["kpis"]["firmados"] == 2 and p["kpis"]["compromisos_abiertos"] == 1 and p["kpis"]["cumplidos"] == 1
        autores = {a["nombre"]: a for a in p["autores"]}
        assert {"Paola Coordinadora", "Sergio Subgerente"} <= set(autores)
        paola = autores["Paola Coordinadora"]
        assert [c["estado"] for c in paola["dias"]] == ["falta", "falta", "firmado", "firmado"] and paola["pct"] == 50.0
        assert [c["estado"] for c in autores["Sergio Subgerente"]["dias"]] == ["falta", "falta", "falta", "falta"]
        assert p["kpis"]["sin_revisar"] == 1 and p["palabras"]["temas"] and p["palabras"]["por_dia"][0]["fecha"] == "2026-10-14"
        assert any(x["id"] == iid for x in p["palabras"]["alertas"])
        assert p["compromisos"][0]["metrica"] == "Conversación" and p["compromisos"][0]["autor"] == "Paola Coordinadora"
        # Los días antes de que existiera el informe diario no faltan.
        from app.operativas.televentas_claro.informe_diario.models import InformeParametros
        async with AsyncSessionLocal() as db:
            db.add(InformeParametros(operativa=TC, data={"inicio": "2026-10-14"}))
            await db.commit()
        p2 = (await ac.get(f"{BASE}/seguimiento", headers=admin, params={"desde": "2026-10-12", "hasta": "2026-10-15"})).json()
        paola2 = next(a for a in p2["autores"] if a["nombre"] == "Paola Coordinadora")
        assert [c["estado"] for c in paola2["dias"]] == ["libre", "libre", "firmado", "firmado"] and paola2["pct"] == 100.0
        assert p2["inicio"] == "2026-10-14" and p2["kpis"]["pct_cumplimiento"] == 50.0   # Sergio: 0 de 2
        assert [x["estado"] for x in (await ac.get(BASE, headers=coord)).json()["racha"][-4:]] == ["libre", "libre", "firmado", "firmado"]
        solo = (await ac.get(f"{BASE}/seguimiento", headers=admin, params={"desde": "2026-10-12", "hasta": "2026-10-15",
                                                                             "autor_id": coord_id})).json()
        assert [a["nombre"] for a in solo["autores"]] == ["Paola Coordinadora"] and len(solo["opciones"]["autores"]) >= 2
        assert (await ac.get(f"{BASE}/seguimiento", headers=admin, params={"desde": "2026-01-01", "hasta": "2026-10-15"})).status_code == 400

        # Diccionario de palabras clave: solo el superadmin, validado; se puede restablecer.
        assert (await ac.get(f"{BASE}/palabras", headers=coord)).status_code == 403
        assert (await ac.put(f"{BASE}/palabras", headers=admin, json={"temas": [{"clave": "x", "nombre": "Mal", "palabras": ["ab*"]}]})).status_code == 400
        r = await ac.put(f"{BASE}/palabras", headers=admin, json={"temas": [{"clave": "crm", "nombre": "CRM", "critico": True, "palabras": ["crm"]}]})
        assert r.status_code == 200 and not r.json()["por_defecto"] and r.json()["temas"][0]["clave"] == "crm"
        d = (await ac.get(f"{BASE}/{iid}", headers=admin)).json()
        assert set(d["palabras"]["temas"]) <= {"crm"} and d["palabras"]["criticas"] == 0   # «CRM» está en el comentario, no en el informe
        r = (await ac.put(f"{BASE}/palabras", headers=admin, json={"restablecer": True})).json()
        assert r["por_defecto"] and r["inicio"] == "2026-10-14"            # restablecer no borra desde cuándo se mide

        # Si alguien cambia el informe firmado en la base, el código ya no coincide.
        async with AsyncSessionLocal() as db:
            inf = await db.get(InformeDiario, iid)
            inf.resumen = "Texto cambiado a escondidas"
            await db.commit()
        assert (await ac.get(f"{BASE}/{iid}", headers=admin)).json()["verificacion"] is False

        # El sub gerente prepara el suyo; un borrador se puede descartar.
        r = await ac.post(BASE, headers=subg, json={})
        assert r.status_code == 201
        assert (await ac.delete(f"{BASE}/{r.json()['id']}", headers=subg)).status_code == 200
        assert (await ac.get(f"{BASE}/{r.json()['id']}", headers=subg)).status_code == 404
