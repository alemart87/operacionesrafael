"""Tablero de Power BI de Productividad: solo links de Power BI / Fabric (nunca HTML), uno publicado por día, lo cargan
gerente, sub gerente y coordinador (y el superadmin) y lo ven publicado los supervisores y quienes ven Productividad."""
from __future__ import annotations

import asyncio
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import Base, engine
from app.main import app
from app.operativas.televentas_claro.productividad import pbi_api as pbi

B = "/api/v1/televentas-claro/productividad/pbi"
TC = "televentas_claro"
IFRAME = ('<iframe title="SPH a Oct17" width="600" height="373.5" src="https://app.fabric.microsoft.com/view?r=eyJrIjoiZDc0NmEwZGEtMDUyNS00NmMxLTg0'
          'MzUtNjllMTBjYzM2ODU0IiwidCI6ImUzYmI0ODcyLTNjNjUtNGUzMy05N2VkLTE1MjcxMTU2YjBkMCJ9" frameborder="0" allowFullScreen="true"></iframe>')


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


async def _new_user(ac, admin, role):
    email = f"{role}-{uuid.uuid4().hex[:6]}@voicenter.com.py"
    r = await ac.post("/api/v1/users", headers=admin, json={
        "email": email, "password": "Clave1234!", "full_name": f"Usuario {role}", "role": role, "operativas": [TC]})
    assert r.status_code == 201, r.text
    return await _login(ac, email)


def test_interpretar():
    d = pbi.interpretar(IFRAME)
    assert d["url"].startswith("https://app.fabric.microsoft.com/view?r=eyJr") and d["titulo"] == "SPH a Oct17"
    assert d["ancho"] == 600 and d["alto"] == 373.5
    assert pbi.interpretar("https://app.powerbi.com/view?r=abc")["titulo"] == "Tablero de Power BI"
    for malo in ('<iframe src="https://evil.com/view?r=1"></iframe>', "http://app.powerbi.com/view?r=1",
                 '<script>alert(1)</script><iframe src="https://app.powerbi.com/view?r=1">', "https://app.powerbi.com.evil.com/view?r=1",
                 "https://user@app.powerbi.com/view?r=1", "https://app.powerbi.com/groups/me/reports", "https://app.powerbi.com/view",
                 "javascript:alert(1)", ""):
        with pytest.raises(pbi.CodigoInvalido):
            pbi.interpretar(malo)
    # El link se reconstruye: nada de fragmentos ni comillas que rompan el atributo.
    with pytest.raises(pbi.CodigoInvalido):
        pbi.interpretar('https://app.powerbi.com/view?r=abc&x="><script>')
    assert pbi.interpretar('https://app.powerbi.com/view?r=abc&x="q\'#frag')["url"] == "https://app.powerbi.com/view?r=abc&x=%22q%27"


@pytest.mark.asyncio
async def test_flujo():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        gerente = await _new_user(ac, admin, "gerente")
        subg = await _new_user(ac, admin, "sub_gerente")
        coord = await _new_user(ac, admin, "coordinador")
        controller = await _new_user(ac, admin, "controller")
        sup = await _new_user(ac, admin, "supervisor")
        cliente = await _new_user(ac, admin, "cliente")

        # Sin nada publicado.
        r = await ac.get(f"{B}/publicado", headers=sup)
        assert r.status_code == 200 and r.json()["tablero"] is None and not r.json()["puede_cargar"]
        assert (await ac.get(f"{B}/publicado", headers=cliente)).status_code == 403

        # Cargan gerente, sub gerente, coordinador y superadmin; el controller y el supervisor no.
        for h in (controller, sup):
            assert (await ac.post(B, headers=h, json={"codigo": IFRAME})).status_code == 403
        assert (await ac.post(B, headers=gerente, json={"codigo": "<script>x</script>"})).status_code == 400
        r = await ac.post(f"{B}/validar", headers=coord, json={"codigo": IFRAME})
        assert r.status_code == 200 and r.json()["titulo"] == "SPH a Oct17"

        r = await ac.post(B, headers=gerente, json={"codigo": IFRAME, "publicar": False, "fecha": "2026-01-01"})
        assert r.status_code == 400                                             # más de 60 días atrás
        hoy = (await ac.get(f"{B}/publicado", headers=sup)).json()["hoy"]
        r = await ac.post(B, headers=gerente, json={"codigo": IFRAME, "publicar": False})
        assert r.status_code == 201 and r.json()["estado"] == "guardado"
        guardado = r.json()["id"]
        assert (await ac.get(f"{B}/publicado", headers=sup)).json()["tablero"] is None   # solo se ve lo publicado

        r = await ac.post(B, headers=subg, json={"codigo": IFRAME.replace("SPH a Oct17", "SPH a Oct18")})
        assert r.status_code == 201 and r.json()["estado"] == "publicado"
        primero = r.json()["id"]
        d = (await ac.get(f"{B}/publicado", headers=sup)).json()
        assert d["tablero"]["titulo"] == "SPH a Oct18" and d["dias"] == [hoy] and "<" not in d["tablero"]["url"]

        # Publicar el guardado del mismo día reemplaza al anterior; eliminarlo vuelve al anterior.
        r = await ac.post(f"{B}/{guardado}/publicar", headers=coord)
        assert r.status_code == 200 and r.json()["estado"] == "publicado"
        assert (await ac.get(f"{B}/publicado", headers=sup)).json()["tablero"]["id"] == guardado
        h = {t["id"]: t["estado"] for t in (await ac.get(B, headers=admin)).json()["tableros"]}
        assert h == {guardado: "publicado", primero: "reemplazado"}
        assert (await ac.get(B, headers=sup)).status_code == 403
        assert (await ac.delete(f"{B}/{guardado}", headers=controller)).status_code == 403
        assert (await ac.delete(f"{B}/{guardado}", headers=gerente)).status_code == 200
        d = (await ac.get(f"{B}/publicado", headers=gerente)).json()
        assert d["tablero"]["id"] == primero and d["puede_cargar"]
        # Quien ve Productividad (el controller) también lo ve.
        assert (await ac.get(f"{B}/publicado", headers=controller)).json()["tablero"]["id"] == primero
