"""Simulaciones guardadas del Simulador Anual (Facturación · Televentas Claro):
guardar con nombre y comentario, editar, marcar ítems, post-its y eliminar."""
from __future__ import annotations

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import Base, engine
from app.main import app


async def _ensure_schema() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


def setup_module(module):
    asyncio.run(_ensure_schema())


async def _login(ac, email, pwd):
    r = await ac.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_registro_de_simulaciones():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        h = await _login(ac, "admin@voicenter.com.py", "Test1234!")

        assert (await ac.get("/api/v1/televentas-claro/facturacion/simulaciones", headers=h)).json()["simulaciones"] == []

        # guardar
        r = await ac.post("/api/v1/televentas-claro/facturacion/simulaciones", headers=h, json={
            "nombre": "Escenario base 1.700", "comentario": "Sin ajuste de comisiones",
            "horizonte": 18, "parametros": {"ventas": 1700}, "ventas_por_mes": [1700] * 18,
            "marcas": [{"key": "kpi:resultado", "label": "Resultado a 18 meses"}, {"key": "kpi:resultado", "label": "dup"}],
            "postits": [{"texto": "Revisar zafra con Claro", "color": "amarillo", "item": "kpi:resultado", "x": 120, "y": 340.5}],
            "resumen": {"resultado_con_cola": 468131274},
        })
        assert r.status_code == 201, r.text
        s = r.json()
        sid = s["id"]
        assert s["nombre"] == "Escenario base 1.700" and s["horizonte"] == 18
        assert len(s["marcas"]) == 1                       # la duplicada se descarta
        assert s["postits"][0]["autor"] and s["postits"][0]["fecha"] and s["postits"][0]["id"]
        assert (s["postits"][0]["x"], s["postits"][0]["y"]) == (120.0, 340.5)   # posición en el lienzo
        assert s["created_by_nombre"]

        # horizonte inválido
        r = await ac.post("/api/v1/televentas-claro/facturacion/simulaciones", headers=h, json={
            "nombre": "x", "horizonte": 15, "parametros": {}, "ventas_por_mes": [1]})
        assert r.status_code == 400

        # listar (sin parámetros) y obtener (con parámetros)
        lst = (await ac.get("/api/v1/televentas-claro/facturacion/simulaciones", headers=h)).json()["simulaciones"]
        assert [x["id"] for x in lst] == [sid] and "parametros" not in lst[0]
        det = (await ac.get(f"/api/v1/televentas-claro/facturacion/simulaciones/{sid}", headers=h)).json()
        assert det["parametros"] == {"ventas": 1700} and len(det["ventas_por_mes"]) == 18

        # editar nombre, comentario, marcas y post-its (el existente conserva autor/fecha; el nuevo se firma)
        viejo = s["postits"][0]
        r = await ac.patch(f"/api/v1/televentas-claro/facturacion/simulaciones/{sid}", headers=h, json={
            "nombre": "Escenario base 1.700 (v2)", "comentario": "Con ajuste 5%",
            "marcas": [{"key": "mes:7", "label": "Mes 7"}],
            "postits": [viejo, {"texto": "Nuevo post-it", "color": "verde"}],
        })
        assert r.status_code == 200, r.text
        s2 = r.json()
        assert s2["nombre"].endswith("(v2)") and s2["comentario"] == "Con ajuste 5%"
        assert [m["key"] for m in s2["marcas"]] == ["mes:7"]
        assert len(s2["postits"]) == 2 and s2["postits"][0]["fecha"] == viejo["fecha"]
        assert s2["postits"][1]["autor"] and s2["updated_by_nombre"] and s2["updated_at"]

        r = await ac.patch(f"/api/v1/televentas-claro/facturacion/simulaciones/{sid}", headers=h, json={"nombre": "  "})
        assert r.status_code == 400

        # notas y comentarios: nueva firmada, edición registra quién/cuándo, tipo inválido → observación
        r = await ac.patch(f"/api/v1/televentas-claro/facturacion/simulaciones/{sid}", headers=h, json={
            "notas": [{"texto": "Supuesto: zafra promedio 2025", "tipo": "supuesto", "mes": "7"}, {"texto": "x", "tipo": "otro"}]})
        assert r.status_code == 200, r.text
        n = r.json()["notas"]
        assert len(n) == 2 and n[0]["autor"] and n[0]["fecha"] and n[0]["mes"] == 7 and n[0]["editada_por"] is None
        assert n[1]["tipo"] == "observacion" and n[1]["mes"] is None
        n[0]["texto"] = "Supuesto: zafra promedio 2025 (revisado)"
        r = await ac.patch(f"/api/v1/televentas-claro/facturacion/simulaciones/{sid}", headers=h, json={"notas": n})
        n2 = r.json()["notas"]
        assert n2[0]["editada_por"] and n2[0]["editada_el"] and n2[0]["fecha"] == n[0]["fecha"]
        assert n2[1]["editada_por"] is None

        # eliminar
        assert (await ac.delete(f"/api/v1/televentas-claro/facturacion/simulaciones/{sid}", headers=h)).status_code == 200
        assert (await ac.get(f"/api/v1/televentas-claro/facturacion/simulaciones/{sid}", headers=h)).status_code == 404
        assert (await ac.get("/api/v1/televentas-claro/facturacion/simulaciones", headers=h)).json()["simulaciones"] == []
