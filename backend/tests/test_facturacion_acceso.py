"""Facturación dentro de Televentas CLARO: visible y usable SOLO por el superadmin."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.api.deps import effective_permissions
from app.core import rate_limit
from app.core.operativas import ASSIGNABLE_PERMISSIONS, SUPERADMIN_ONLY_PERMISSIONS
from app.core.perfiles import DEFAULT_PERMISSIONS
from app.main import app

ADMIN = {"email": "admin@voicenter.com.py", "password": "Test1234!"}
TC = "televentas_claro"
FACT = f"{TC}.facturacion"
BASE = "/api/v1/televentas-claro/facturacion"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    rate_limit.clear_all()


def _login(client, email, password):
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def admin(client):
    return _login(client, **ADMIN)


@pytest.fixture
def coordinador_con_todo(client, admin):
    """Coordinador con TODOS los permisos asignables y la operativa asignada."""
    r = client.put("/api/v1/perfiles/coordinador", headers=admin,
                   json={"permissions": sorted(ASSIGNABLE_PERMISSIONS)})
    assert r.status_code == 200, r.text
    email = f"coord-{uuid.uuid4().hex[:8]}@voicenter.com.py"
    r = client.post("/api/v1/users", headers=admin, json={
        "email": email, "password": "Clave1234!", "full_name": "Coordinadora",
        "role": "coordinador", "operativas": [TC],
    })
    assert r.status_code == 201, r.text
    yield _login(client, email, "Clave1234!")
    client.put("/api/v1/perfiles/coordinador", headers=admin, json={"permissions": DEFAULT_PERMISSIONS["coordinador"]})


def test_facturacion_es_solo_superadmin_en_el_catalogo():
    assert FACT in SUPERADMIN_ONLY_PERMISSIONS
    assert FACT not in ASSIGNABLE_PERMISSIONS
    # Aunque el permiso aparezca en la DB del perfil, no se hace efectivo.
    assert FACT not in effective_permissions([f"{TC}.ver", FACT], [TC])


def test_superadmin_usa_facturacion(client, admin):
    assert client.get(f"{BASE}/reports", headers=admin).json() == {"items": [], "total": 0}
    assert client.get(f"{BASE}/simulador/parametros", headers=admin).status_code == 200
    assert client.get(f"{BASE}/gpon/parametros", headers=admin).status_code == 200
    acc = client.get("/api/v1/televentas-claro/facturacion-agent/access", headers=admin)
    assert acc.status_code == 200 and acc.json()["configured"] is False  # sin OPENAI_API_KEY en tests
    ut = {u["key"]: u["habilitada"] for u in client.get("/api/v1/televentas-claro", headers=admin).json()["utilidades"]}
    assert ut["facturacion"] is True


def test_ningun_perfil_accede_aunque_tenga_todo(client, coordinador_con_todo):
    h = coordinador_con_todo
    assert client.get("/api/v1/televentas-claro", headers=h).status_code == 200  # la operativa sí
    ut = {u["key"]: u["habilitada"] for u in client.get("/api/v1/televentas-claro", headers=h).json()["utilidades"]}
    assert ut["cargar"] is True and "facturacion" not in ut  # ni siquiera se lista
    assert FACT not in client.get("/api/v1/auth/me", headers=h).json()["permissions"]
    for path in ("/reports", "/uploads", "/simulador/parametros", "/gpon/parametros", "/simulaciones"):
        assert client.get(f"{BASE}{path}", headers=h).status_code == 403, path
    assert client.post(f"{BASE}/compare", headers=h, json={"report_ids": ["a", "b"]}).status_code == 403
    assert client.get("/api/v1/televentas-claro/facturacion-agent/access", headers=h).status_code == 403


def test_no_se_puede_asignar_a_un_perfil(client, admin):
    r = client.put("/api/v1/perfiles/coordinador", headers=admin, json={"permissions": [f"{TC}.ver", FACT]})
    assert r.status_code == 400
    assert "exclusivos del superadmin" in r.json()["detail"]
    fila = next(u for u in client.get("/api/v1/perfiles", headers=admin).json()["operativas"][0]["utilidades"]
                if u["key"] == "facturacion")
    assert fila["solo_superadmin"] is True


def test_subida_valida_extension(client, admin):
    r = client.post(f"{BASE}/uploads", headers=admin, files={"file": ("liq.csv", b"x", "text/csv")})
    assert r.status_code == 400
