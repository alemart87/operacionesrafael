"""Integraciones: claves de API para KNIME y otras herramientas.

- Solo el sub gerente y el superadmin tienen la utilidad; el resto no la ve ni la puede tener.
- La clave se muestra una sola vez; con ella se leen los datasets (JSON o CSV) y nunca Facturación.
- Límites por minuto y por día, registro de cada uso (también los rechazados), bloqueo (dueño o superadmin),
  desbloqueo y eliminación (solo superadmin), todo auditado.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.database import AsyncSessionLocal, Base, engine
from app.core.operativas import RESTRINGIDAS, asignables
from app.main import app
from app.models.audit import AuditLog
from app.operativas.televentas_claro.informe_diario.models import FIRMADO, InformeDiario
from app.operativas.televentas_claro.integraciones import datasets as ds
from app.operativas.televentas_claro.integraciones.models import ApiClave, ApiUso
from app.operativas.televentas_claro.productividad.models import ESTADO_PUBLICADO, ProdInforme

TC = "televentas_claro"
PERM = f"{TC}.integraciones"
BASE = "/api/v1/televentas-claro/integraciones"


def setup_module(module):
    from app.main import _seed_profiles

    async def _prep():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await _seed_profiles()
        async with AsyncSessionLocal() as db:
            db.add(ProdInforme(fecha=date(2026, 10, 6), status=ESTADO_PUBLICADO, cortes=2, corte_final="18:00", agentes=3,
                               llamadas=120, atendidas=80, pct_contacto=40.5, pct_conversacion=38.2, banda="meta",
                               jornada_media=21000, alertas=1,
                               data={"kpis": {"llamadas": 120, "pct_conversacion": 38.2, "bandas": {"meta": 2, "rojo": 1}},
                                     "agentes": [{"clave": "perez ana", "nombre": "PEREZ, ANA", "login": 21600, "llamadas": 60,
                                                  "pct_conversacion": 41.7, "modo": "automatico", "turno": "mañana",
                                                  "alertas": ["sesion_abierta"], "tramos": [[1, 2, 3, 4]]},
                                                 {"clave": "lopez juan", "nombre": "Lopez, Juan", "login": 21600, "llamadas": 60,
                                                  "pct_conversacion": 20.0, "modo": "manual", "turno": "tarde", "alertas": [], "tramos": []}]}))
            db.add(ProdInforme(fecha=date(2026, 10, 7), status="draft", cortes=1, agentes=1, llamadas=5, atendidas=3,
                               data={"kpis": {"llamadas": 5}, "agentes": []}))
            db.add(InformeDiario(fecha=date(2026, 10, 6), autor_id="x", autor_nombre="Paola Coordinadora", autor_cargo="Coordinadora",
                                 estado=FIRMADO, resultados={"pospago": {"valor": 44, "meta": 50, "comentario": "Faltó cierre"},
                                                            "gpon": {"valor": 15, "meta": 15}, "otros": [{"nombre": "IPTV", "valor": 3}]},
                                 resumen="Día con buena conversación a la mañana.", importados=[{"id": "a", "tipo": "llamadas"}],
                                 metricas=[{"id": "m1", "nombre": "% conversación", "indicador": "31%", "estado": "critico",
                                            "comentario": "Bajo", "compromiso": "Coaching a 3 agentes", "responsable": "Paola",
                                            "fecha_compromiso": "2026-10-08"},
                                           {"id": "m2", "nombre": "Pausas", "indicador": "9%", "estado": "ok", "comentario": "", "compromiso": ""}],
                                 firmado_at=datetime(2026, 10, 6, 22, 0, tzinfo=timezone.utc)))
            db.add(InformeDiario(fecha=date(2026, 10, 7), autor_id="x", autor_nombre="Paola Coordinadora", autor_cargo="Coordinadora",
                                 estado="borrador", resultados={}, resumen="", metricas=[]))
            await db.commit()
    asyncio.run(_prep())


async def _login(ac, email, pwd="Clave1234!"):
    r = await ac.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _new_user(ac, admin, role):
    email = f"{role}-{uuid.uuid4().hex[:6]}@voicenter.com.py"
    r = await ac.post("/api/v1/users", headers=admin, json={
        "email": email, "password": "Clave1234!", "full_name": f"Usuario {role}", "role": role, "operativas": [TC]})
    assert r.status_code == 201, r.text
    return r.json()["id"], await _login(ac, email)


def _bearer(secreto: str) -> dict:
    return {"Authorization": f"Bearer {secreto}"}


def test_la_utilidad_es_solo_de_sub_gerente_y_superadmin():
    assert RESTRINGIDAS[PERM] == {"sub_gerente"}
    assert PERM in asignables("sub_gerente") and PERM not in asignables("controller") and PERM not in asignables("coordinador")
    assert "facturacion" not in " ".join(ds.CATALOGO)   # ningún dataset de facturación


def test_plano_aplana_dicts_y_descarta_listas():
    assert ds.plano({"a": 1, "b": {"c": 2, "d": {"e": None}}, "l": [1, 2]}) == {"a": 1, "b_c": 2, "b_d_e": None}
    with pytest.raises(ValueError):
        ds.rango(date(2026, 1, 1), date(2025, 1, 1))
    with pytest.raises(ValueError):
        ds.rango(date(2020, 1, 1), date(2026, 1, 1))


@pytest.mark.asyncio
async def test_claves_datasets_limites_registro_bloqueo_y_eliminacion():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        sub_id, subg = await _new_user(ac, admin, "sub_gerente")
        _, controller = await _new_user(ac, admin, "controller")

        # Quién entra: el controller no; el sub gerente y el superadmin sí (y los datasets solo se ven con la utilidad).
        assert (await ac.get(f"{BASE}/claves", headers=controller)).status_code == 403
        assert (await ac.get(f"{BASE}/datasets", headers=controller)).status_code == 403
        r = await ac.get(f"{BASE}/claves", headers=subg)
        assert r.status_code == 200 and r.json()["items"] == [] and r.json()["superadmin"] is False
        assert {d["nombre"] for d in r.json()["datasets"]} == set(ds.CATALOGO)

        # El sub gerente crea una clave: el secreto se ve una sola vez y nunca vuelve en la lista.
        r = await ac.post(f"{BASE}/claves", headers=subg, json={"nombre": "KNIME de Sergio", "vigencia_dias": 30, "limite_minuto": 4, "limite_dia": 100})
        assert r.status_code == 201, r.text
        secreto, clave = r.json()["secreto"], r.json()["clave"]
        assert secreto.startswith("vcop_") and len(secreto) == 45 and clave["prefijo"] == secreto[:13]
        assert clave["estado"] == "activa" and clave["limite_minuto"] == 4 and clave["datasets"] == []
        r = await ac.get(f"{BASE}/claves", headers=subg)
        assert [c["id"] for c in r.json()["items"]] == [clave["id"]] and "secreto" not in str(r.json())
        assert (await ac.post(f"{BASE}/claves", headers=subg, json={"nombre": "xx", "datasets": ["facturacion"]})).status_code == 400

        # Con la clave (como KNIME: Authorization: Bearer) se leen el catálogo y los datasets; sin ella, 401.
        assert (await ac.get(f"{BASE}/datasets")).status_code == 401
        r = await ac.get(f"{BASE}/datasets", headers=_bearer(secreto))
        assert r.status_code == 200 and len(r.json()["items"]) == len(ds.CATALOGO)
        r = await ac.get(f"{BASE}/datasets/productividad_dias?desde=2026-10-01&hasta=2026-10-10", headers=_bearer(secreto))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["filas"] == 1 and d["items"][0]["fecha"] == "2026-10-06" and d["items"][0]["kpi_bandas_meta"] == 2
        assert "kpi_llamadas" in d["columnas"] and d["items"][0]["estado"] == "published"
        # Los borradores solo si se piden; las listas anidadas no van (alertas queda como texto).
        r = await ac.get(f"{BASE}/datasets/productividad_dias?desde=2026-10-01&hasta=2026-10-10&borradores=1", headers={"X-API-Key": secreto})
        assert r.status_code == 200 and r.json()["filas"] == 2
        r = await ac.get(f"{BASE}/datasets/productividad_agentes?desde=2026-10-01&hasta=2026-10-10&formato=csv", headers=_bearer(secreto))
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and r.headers["X-Filas"] == "2"
        lineas = r.content.decode("utf-8-sig").splitlines()
        assert lineas[0].startswith("informe_id,fecha,estado,clave,nombre") and "tramos" not in lineas[0]
        assert "PEREZ, ANA" in r.text and "sesion_abierta" in r.text
        # El quinto uso del minuto (el catálogo también cuenta) supera el límite: 429 con Retry-After y queda registrado como «limite».
        r = await ac.get(f"{BASE}/datasets/sph_informes", headers=_bearer(secreto))
        assert r.status_code == 429 and r.headers["Retry-After"] == "60" and "por minuto" in r.json()["detail"]
        r = await ac.get(f"{BASE}/claves/{clave['id']}/usos", headers=subg)
        usos = r.json()["items"]
        assert [u["resultado"] for u in usos] == ["limite", "ok", "ok", "ok", "ok"]
        assert usos[1]["dataset"] == "productividad_agentes" and usos[-1]["dataset"] is None and usos[1]["filas"] == 2 and usos[1]["status"] == 200
        assert r.json()["clave"]["usos"] == 4 and r.json()["clave"]["usos_hoy"] == 4 and r.json()["clave"]["rechazos_hoy"] == 1
        # Dataset desconocido: 404 y registrado como error.
        r = await ac.get(f"{BASE}/datasets/facturacion_liquidaciones", headers=_bearer(secreto))
        assert r.status_code in (404, 429)

        # Una clave acotada a un dataset no lee otro.
        r = await ac.post(f"{BASE}/claves", headers=admin, json={"nombre": "Solo SPH", "datasets": ["sph_informes"], "limite_minuto": 50})
        sec2, clave2 = r.json()["secreto"], r.json()["clave"]
        assert (await ac.get(f"{BASE}/datasets/sph_informes", headers=_bearer(sec2))).status_code == 200
        r = await ac.get(f"{BASE}/datasets/productividad_dias", headers=_bearer(sec2))
        assert r.status_code == 403 and "no tiene acceso" in r.json()["detail"]
        assert [d["nombre"] for d in (await ac.get(f"{BASE}/datasets", headers=_bearer(sec2))).json()["items"]] == ["sph_informes"]

        # Informe diario: solo los firmados, sin comentarios; una métrica por fila.
        r = await ac.get(f"{BASE}/datasets/informes_diarios?desde=2026-10-01&hasta=2026-10-10", headers=admin)   # sesión con la utilidad
        assert r.status_code == 200 and r.json()["filas"] == 1
        f = r.json()["items"][0]
        assert f["pospago_valor"] == 44 and f["metricas_criticas"] == 1 and f["compromisos"] == 1 and f["datos_importados"] == "llamadas"
        assert "comentarios" not in f and "figuras" not in f
        r = await ac.get(f"{BASE}/datasets/informes_diarios_metricas?desde=2026-10-01&hasta=2026-10-10", headers=admin)
        assert r.json()["filas"] == 2 and r.json()["items"][0]["compromiso"] == "Coaching a 3 agentes"

        # Clave desconocida: 401 y el intento queda registrado para el superadmin.
        r = await ac.get(f"{BASE}/datasets/sph_informes", headers=_bearer("vcop_" + "0" * 40))
        assert r.status_code == 401
        r = await ac.get(f"{BASE}/usos", headers=admin)
        assert any(u["clave"] == "(clave desconocida)" and u["resultado"] == "denegada" for u in r.json()["items"])
        assert r.json()["por_dia"] and r.json()["por_dia"][-1]["ok"] >= 5
        # El sub gerente solo ve los usos de sus claves.
        r = await ac.get(f"{BASE}/usos", headers=subg)
        assert {u["clave_id"] for u in r.json()["items"]} == {clave["id"]}

        # El superadmin ve todas las claves; el sub gerente no ve la del superadmin.
        r = await ac.get(f"{BASE}/claves", headers=admin)
        assert {c["id"] for c in r.json()["items"]} == {clave["id"], clave2["id"]} and r.json()["superadmin"] is True
        assert (await ac.get(f"{BASE}/claves/{clave2['id']}/usos", headers=subg)).status_code == 404

        # Bloquear: el dueño puede; la clave deja de servir (403 registrado). Desbloquear: solo el superadmin.
        r = await ac.post(f"{BASE}/claves/{clave['id']}/bloquear", headers=subg, json={"motivo": "Se filtró en un correo"})
        assert r.status_code == 200 and r.json()["estado"] == "bloqueada" and r.json()["motivo_bloqueo"] == "Se filtró en un correo"
        r = await ac.get(f"{BASE}/datasets/sph_informes", headers=_bearer(secreto))
        assert r.status_code == 403 and "bloqueada" in r.json()["detail"]
        assert (await ac.post(f"{BASE}/claves/{clave['id']}/desbloquear", headers=subg)).status_code == 403
        assert (await ac.patch(f"{BASE}/claves/{clave['id']}/limites", headers=subg, json={"limite_minuto": 9, "limite_dia": 9})).status_code == 403
        r = await ac.post(f"{BASE}/claves/{clave['id']}/desbloquear", headers=admin)
        assert r.status_code == 200 and r.json()["estado"] == "activa"
        r = await ac.patch(f"{BASE}/claves/{clave['id']}/limites", headers=admin, json={"limite_minuto": 100, "limite_dia": 10})
        assert r.status_code == 200 and r.json()["limite_minuto"] == 100

        # Vencida: no sirve más.
        async with AsyncSessionLocal() as db:
            c = await db.get(ApiClave, clave2["id"])
            c.expira_at = datetime.now(timezone.utc) - timedelta(minutes=1)
            await db.commit()
        r = await ac.get(f"{BASE}/datasets/sph_informes", headers=_bearer(sec2))
        assert r.status_code == 403 and "venció" in r.json()["detail"]
        assert (await ac.get(f"{BASE}/claves", headers=admin)).json()["items"][0]["vencida"] in (True, False)

        # Eliminar: solo el superadmin; la clave desaparece, el registro de usos queda con su prefijo.
        assert (await ac.delete(f"{BASE}/claves/{clave['id']}", headers=subg)).status_code == 403
        assert (await ac.delete(f"{BASE}/claves/{clave['id']}", headers=admin)).status_code == 200
        assert (await ac.get(f"{BASE}/datasets/sph_informes", headers=_bearer(secreto))).status_code == 401
        async with AsyncSessionLocal() as db:
            assert await db.get(ApiClave, clave["id"]) is None
            quedan = (await db.execute(select(ApiUso).where(ApiUso.clave_id == clave["id"]))).scalars().all()
            assert len(quedan) >= 6 and quedan[0].clave_prefijo == clave["prefijo"]
            acciones = [a.action for a in (await db.execute(select(AuditLog).where(AuditLog.resource_type == "integraciones_clave"))).scalars().all()]
        for a in ("integraciones_clave_creada", "integraciones_clave_bloqueada", "integraciones_clave_desbloqueada",
                  "integraciones_clave_limites", "integraciones_clave_eliminada"):
            assert a in acciones
