"""Auditoría de Ventas (Televentas CLARO): análisis automático, informes de auditoría con datos
congelados, hallazgos, seguimiento, estados y permisos."""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import Base, engine, session_scope
from app.main import app
from app.operativas.televentas_claro.ventas_netas.models import VentasNetasReport, VentasNetasUpload
from tests.test_ventas_netas import _subir_y_procesar, build_xlsx

BASE = "/api/v1/televentas-claro/auditoria"
VN = "/api/v1/televentas-claro/ventas-netas"
TC = "televentas_claro"


def setup_module(module):
    from app.main import _seed_profiles

    async def _prep():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await _seed_profiles()
    asyncio.run(_prep())


async def _login(ac, email, pwd):
    r = await ac.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _new_user(ac, admin, role):
    email = f"{role}-{uuid.uuid4().hex[:6]}@voicenter.com.py"
    r = await ac.post("/api/v1/users", headers=admin, json={
        "email": email, "password": "Clave1234!", "full_name": f"Usuario {role}", "role": role, "operativas": [TC]})
    assert r.status_code == 201, r.text
    return await _login(ac, email, "Clave1234!")


@pytest.mark.asyncio
async def test_circuito_de_auditoria(tmp_path, monkeypatch):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        analista = await _new_user(ac, admin, "analista")        # tiene auditoría por defecto
        coordinador = await _new_user(ac, admin, "coordinador")  # no, hasta que el superadmin lo habilite
        supervisor = await _new_user(ac, admin, "supervisor")

        # Fuente: un informe de Ventas Netas (borrador sirve).
        r1 = await _subir_y_procesar(ac, analista, build_xlsx(tmp_path / "sep.xlsx"), monkeypatch)

        # Permisos
        assert (await ac.get(f"{BASE}/fuentes", headers=supervisor)).status_code == 403
        assert (await ac.get(f"{BASE}/fuentes", headers=coordinador)).status_code == 403
        fuentes = (await ac.get(f"{BASE}/fuentes", headers=analista)).json()
        assert [f["id"] for f in fuentes] == [r1] and fuentes[0]["status"] == "draft" and fuentes[0]["actualizada"]

        # Informe generado por una versión anterior del análisis (sin Sali Hablando ni productividad):
        # la auditoría lo recalcula sola desde los datos guardados, sin volver a subir el archivo.
        async with session_scope() as db:
            rep = await db.get(VentasNetasReport, r1)
            rep.data = {k: v for k, v in rep.data.items() if k not in ("productividad", "sali_hablando", "version")}
            rep.netas = 0
            await db.commit()
        f1 = (await ac.get(f"{BASE}/fuentes", headers=analista)).json()[0]
        assert f1["actualizada"] is False and f1["analysis_version"] == 0 and f1["netas"] == 0

        # Riesgos en vivo (no se guarda el análisis, pero la fuente queda actualizada)
        r = await ac.post(f"{BASE}/riesgos", headers=analista, json={"report_ids": [r1]})
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["kpis"]["netas"] == 6 and s["kpis"]["sali_sin_uso"] == 1 and s["periodos"] == ["2026-09"]
        assert s["advertencias"] == [] and s["fuentes"][0]["version"] == s["parametros"]["analysis_version"]
        # Las reglas que muestra la Guía del auditor son las mismas que aplicó el análisis.
        assert (await ac.get(f"{BASE}/parametros", headers=supervisor)).status_code == 403
        reglas = (await ac.get(f"{BASE}/parametros", headers=analista)).json()
        assert reglas == s["parametros"]
        assert reglas["umbral_uso_pct"] == 50 and reglas["pesos"]["sali_sin_uso"] == 3 and reglas["nivel_critico"]["sin_uso_antiguas"] == 5
        assert reglas["patrones"]["pospago_mismo_dia"] == {"min": 6, "pct": 40} and reglas["llamativos"]["pendientes_dias"] == 7
        f1 = (await ac.get(f"{BASE}/fuentes", headers=analista)).json()[0]
        assert f1["actualizada"] and f1["netas"] == 6
        det = (await ac.get(f"{VN}/reports/{r1}", headers=analista)).json()
        assert det["netas"] == 6 and "sali_hablando" in det["data"]
        rk = {v["vendedor"]: v for v in s["ranking"]}
        assert rk["ANA PEREZ"]["posicion"] == 1 and rk["ANA PEREZ"]["sali_sin_uso"] == 1
        assert rk["JUAN LOPEZ"]["suspendidas"] == 1 and rk["JUAN LOPEZ"]["nivel"] == "atencion"
        assert any(x["categoria"] == "sali_hablando" for x in s["llamativos"])
        assert len(s["lineas_sin_uso"]) == 2 and len(s["sali_lineas"]) == 1
        # Dos cortes del mismo mes no se mezclan
        r2 = await _subir_y_procesar(ac, analista, build_xlsx(tmp_path / "sep2.xlsx"), monkeypatch)
        assert (await ac.post(f"{BASE}/riesgos", headers=analista, json={"report_ids": [r1, r2]})).status_code == 400
        # Fuente vieja que no se puede recalcular (sin datos guardados ni archivo): se usa como está y se advierte.
        async with session_scope() as db:
            rep = await db.get(VentasNetasReport, r2)
            rep.data = {k: v for k, v in rep.data.items() if k not in ("sali_hablando", "version")}
            up = await db.get(VentasNetasUpload, rep.upload_id)
            up.parsed_gz = None
            os.remove(up.file_path)
            await db.commit()
        s2 = (await ac.post(f"{BASE}/riesgos", headers=analista, json={"report_ids": [r2]})).json()
        assert s2["kpis"]["netas"] == 6 and s2["kpis"]["sali_sin_uso"] == 0
        assert len(s2["advertencias"]) == 1 and "versión anterior" in s2["advertencias"][0] and s2["fuentes"][0]["version"] == 0
        assert r2 in [f["id"] for f in (await ac.get(f"{BASE}/fuentes", headers=analista)).json()]  # sigue disponible
        # Un corte reemplazado por otra publicación deja de ofrecerse como fuente.
        async with session_scope() as db:
            (await db.get(VentasNetasReport, r2)).status = "replaced"
            await db.commit()
        assert [f["id"] for f in (await ac.get(f"{BASE}/fuentes", headers=analista)).json()] == [r1]
        async with session_scope() as db:
            (await db.get(VentasNetasReport, r2)).status = "draft"
            await db.commit()

        # Crear informe de auditoría: datos congelados + hallazgos automáticos + resumen borrador
        r = await ac.post(f"{BASE}/informes", headers=analista, json={"titulo": "Auditoría septiembre", "report_ids": [r1]})
        assert r.status_code == 201, r.text
        a = r.json()
        aid = a["id"]
        assert a["codigo"].startswith("AUD-") and a["codigo"].endswith("-001") and a["status"] == "borrador"
        assert a["periodo_desde"] == "2026-09" and a["fuentes"][0]["report_id"] == r1
        assert a["snapshot"]["kpis"]["netas"] == 6 and a["resumen"].startswith("Se auditaron las ventas de septiembre 2026")
        assert a["editable"] and a["transiciones"] == ["en_revision"] and a["puede_eliminar"]
        cats = {h["categoria"] for h in a["hallazgos"]}
        assert {"sali_hablando", "activacion", "pendientes", "suspendidas", "vendedor"} <= cats
        h_juan = next(h for h in a["hallazgos"] if h["vendedor"] == "JUAN LOPEZ")
        assert h_juan["origen"] == "auto" and h_juan["severidad"] == "media" and h_juan["evidencia"]["resumen"]["suspendidas"] == 1
        assert all(h["codigo"] == f"H-{i:02d}" for i, h in enumerate(a["hallazgos"], start=1))
        assert a["seguimientos"][0]["tipo"] == "estado"
        assert (await ac.get(f"{BASE}/informes/{aid}", headers=supervisor)).status_code == 403

        # Redacción, gráficos y hallazgo manual
        r = await ac.patch(f"{BASE}/informes/{aid}", headers=analista, json={
            "conclusiones": "Se recomienda retener comisiones de las líneas sin uso.",
            "graficos": [{"key": "sali_por_dia", "titulo": "Sali Hablando por día", "nota": "Todas sin uso"}, {"key": "riesgo_uso"}],
        })
        assert r.status_code == 200 and r.json()["graficos"][0]["nota"] == "Todas sin uso"
        r = await ac.post(f"{BASE}/informes/{aid}/hallazgos", headers=analista, json={
            "titulo": "Ventas fuera de horario", "severidad": "baja", "categoria": "otro", "descripcion": "Detectado en muestreo."})
        assert r.status_code == 201 and r.json()["origen"] == "manual" and r.json()["codigo"] == f"H-{len(a['hallazgos']) + 1:02d}"
        h_manual = r.json()["id"]
        assert (await ac.post(f"{BASE}/informes/{aid}/hallazgos", headers=analista, json={"titulo": "x y z", "severidad": "enorme"})).status_code == 400
        r = await ac.patch(f"{BASE}/informes/{aid}/hallazgos/{h_juan['id']}", headers=analista,
                           json={"estado": "en_seguimiento", "responsable": "Supervisión", "nota": "Se contactó al vendedor."})
        assert r.status_code == 200 and r.json()["estado"] == "en_seguimiento"
        det = (await ac.get(f"{BASE}/informes/{aid}", headers=analista)).json()
        assert det["hallazgos_abiertos"] == len(det["hallazgos"]) and det["seguimientos"][0]["hallazgo_id"] == h_juan["id"]

        # Estados: borrador → en revisión → cerrado (contenido fijo, seguimiento sigue) → archivado (solo lectura)
        assert (await ac.post(f"{BASE}/informes/{aid}/estado", headers=analista, json={"status": "cerrado"})).status_code == 400
        assert (await ac.post(f"{BASE}/informes/{aid}/estado", headers=analista, json={"status": "en_revision"})).json()["status"] == "en_revision"
        r = await ac.post(f"{BASE}/informes/{aid}/estado", headers=analista, json={"status": "cerrado", "nota": "Emitido a Gerencia."})
        assert r.status_code == 200 and r.json()["status"] == "cerrado" and r.json()["closed_by"] and not r.json()["editable"] and not r.json()["puede_eliminar"]
        assert (await ac.patch(f"{BASE}/informes/{aid}", headers=analista, json={"resumen": "cambio"})).status_code == 409
        assert (await ac.patch(f"{BASE}/informes/{aid}/hallazgos/{h_manual}", headers=analista, json={"titulo": "otro título"})).status_code == 409
        assert (await ac.patch(f"{BASE}/informes/{aid}/hallazgos/{h_manual}", headers=analista, json={"estado": "resuelto"})).status_code == 200
        assert (await ac.post(f"{BASE}/informes/{aid}/seguimientos", headers=analista, json={"texto": "Reunión con supervisión."})).status_code == 201
        assert (await ac.delete(f"{BASE}/informes/{aid}/hallazgos/{h_manual}", headers=analista)).status_code == 409
        assert (await ac.delete(f"{BASE}/informes/{aid}", headers=analista)).status_code == 409
        assert (await ac.post(f"{BASE}/informes/{aid}/estado", headers=analista, json={"status": "archivado"})).json()["status"] == "archivado"
        assert (await ac.post(f"{BASE}/informes/{aid}/seguimientos", headers=analista, json={"texto": "x"})).status_code == 409
        assert (await ac.patch(f"{BASE}/informes/{aid}/hallazgos/{h_manual}", headers=analista, json={"estado": "abierto"})).status_code == 409
        det = (await ac.get(f"{BASE}/informes/{aid}", headers=analista)).json()
        assert [h["accion"] for h in det["historial"]] == ["crear", "estado", "estado", "estado"]

        # CRÍTICO: al borrar el informe de origen, la auditoría conserva los datos congelados.
        assert (await ac.delete(f"{VN}/reports/{r1}", headers=analista)).status_code == 200
        det = (await ac.get(f"{BASE}/informes/{aid}", headers=analista)).json()
        assert det["snapshot"]["kpis"]["netas"] == 6 and len(det["snapshot"]["ranking"]) == 3 and det["fuentes"][0]["report_id"] == r1
        assert len(det["hallazgos"]) == len(a["hallazgos"]) + 1

        # Lista con conteos y nombres; el coordinador entra cuando el superadmin le da la utilidad.
        lst = (await ac.get(f"{BASE}/informes", headers=analista)).json()
        assert lst["total"] == 1 and lst["items"][0]["hallazgos_total"] == len(det["hallazgos"]) and lst["usuarios"][det["created_by"]] == "Usuario analista"
        perms = (await ac.get("/api/v1/perfiles", headers=admin)).json()
        coord = next(p for p in perms["perfiles"] if p["slug"] == "coordinador")
        assert (await ac.put("/api/v1/perfiles/coordinador", headers=admin, json={"permissions": [*coord["permissions"], f"{TC}.auditoria"]})).status_code == 200
        assert (await ac.get(f"{BASE}/informes", headers=coordinador)).status_code == 200

        # Un borrador sí se elimina (solo su autor o el superadmin).
        r = await ac.post(f"{BASE}/informes", headers=analista, json={"titulo": "Borrador de prueba", "report_ids": [r2]})
        assert r.status_code == 201 and r.json()["codigo"].endswith("-002")
        bid = r.json()["id"]
        assert (await ac.get(f"{BASE}/informes/{bid}", headers=coordinador)).json()["puede_eliminar"] is False
        assert (await ac.get(f"{BASE}/informes/{bid}", headers=admin)).json()["puede_eliminar"] is True
        assert (await ac.delete(f"{BASE}/informes/{bid}", headers=coordinador)).status_code == 403
        assert (await ac.delete(f"{BASE}/informes/{bid}", headers=analista)).status_code == 200
        assert (await ac.get(f"{BASE}/informes/{bid}", headers=analista)).status_code == 404

        log = (await ac.get("/api/v1/audit", headers=admin)).json()
        acciones = [x["action"] for x in log]
        for esperada in ("create_auditoria", "update_auditoria", "auditoria_estado", "create_auditoria_hallazgo",
                         "update_auditoria_hallazgo", "create_auditoria_seguimiento", "delete_auditoria"):
            assert esperada in acciones, esperada
        reproc = [x for x in log if x["action"] == "reprocess_ventas_netas_report"]
        assert len(reproc) == 1 and reproc[0]["resource_id"] == r1 and reproc[0]["extra"]["origen"] == "auditoria" and reproc[0]["extra"]["anterior"] == 0
