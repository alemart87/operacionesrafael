"""Perfiles, permisos editables y acceso a la operativa Televentas CLARO."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.core import rate_limit
from app.core.perfiles import DEFAULT_PERMISSIONS
from app.main import app

ADMIN = {"email": "admin@voicenter.com.py", "password": "Test1234!"}
TC = "televentas_claro"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    rate_limit.clear_all()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _login(client, email, password):
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture
def admin(client):
    return _auth(_login(client, **ADMIN))


def _new_user(client, admin, role, operativas):
    email = f"{role}-{uuid.uuid4().hex[:8]}@voicenter.com.py"
    r = client.post("/api/v1/users", headers=admin, json={
        "email": email, "password": "Clave1234!", "full_name": f"Usuario {role}",
        "role": role, "operativas": operativas,
    })
    assert r.status_code == 201, r.text
    return r.json()["id"], _auth(_login(client, email, "Clave1234!"))


def _set_perms(client, admin, role, perms):
    r = client.put(f"/api/v1/perfiles/{role}", headers=admin, json={"permissions": perms})
    assert r.status_code == 200, r.text
    return r.json()


def test_perfiles_sembrados_con_defaults(client, admin):
    body = client.get("/api/v1/perfiles", headers=admin).json()
    slugs = [p["slug"] for p in body["perfiles"]]
    assert slugs == ["coordinador", "supervisor", "analista", "cliente"]
    assert body["operativas"][0]["slug"] == TC
    cliente = next(p for p in body["perfiles"] if p["slug"] == "cliente")
    assert cliente["permissions"] == sorted(DEFAULT_PERMISSIONS["cliente"])


def test_superadmin_ve_todo(client, admin):
    me = client.get("/api/v1/auth/me", headers=admin).json()
    assert me["visible_operativas"] == [TC]
    assert f"{TC}.ventas_netas" in me["permissions"]
    ops = client.get("/api/v1/operativas", headers=admin).json()
    assert all(u["habilitada"] for u in ops[0]["utilidades"])
    assert client.get("/api/v1/televentas-claro", headers=admin).status_code == 200


def test_crear_usuarios_de_cada_perfil(client, admin):
    for role in ("coordinador", "supervisor", "analista", "cliente"):
        _new_user(client, admin, role, [TC])
    r = client.post("/api/v1/users", headers=admin, json={
        "email": "x@voicenter.com.py", "password": "Clave1234!", "full_name": "X", "role": "gerente",
    })
    assert r.status_code == 422


def test_sin_operativa_asignada_no_accede(client, admin):
    _, tok = _new_user(client, admin, "coordinador", [])
    assert client.get("/api/v1/operativas", headers=tok).json() == []
    assert client.get("/api/v1/televentas-claro", headers=tok).status_code == 403
    # Operativas inexistentes se descartan al asignar.
    uid, _ = _new_user(client, admin, "coordinador", [TC, "no_existe"])
    users = client.get("/api/v1/users", headers=admin).json()
    assert next(u for u in users if u["id"] == uid)["operativas"] == [TC]


def test_superadmin_cambia_permisos_y_se_aplica_en_vivo(client, admin):
    _, tok = _new_user(client, admin, "cliente", [TC])

    ut = {u["key"]: u["habilitada"] for u in client.get("/api/v1/televentas-claro", headers=tok).json()["utilidades"]}
    assert ut["ver"] is True and ut["ventas_netas"] is False

    # Se le da "ventas_netas" al perfil Cliente: el mismo token ya lo refleja.
    _set_perms(client, admin, "cliente", [f"{TC}.ver", f"{TC}.ventas_netas"])
    ut = {u["key"]: u["habilitada"] for u in client.get("/api/v1/televentas-claro", headers=tok).json()["utilidades"]}
    assert ut["ventas_netas"] is True

    # Sin "ver", el perfil pierde el acceso completo aunque tenga otras utilidades.
    _set_perms(client, admin, "cliente", [f"{TC}.ventas_netas"])
    assert client.get("/api/v1/televentas-claro", headers=tok).status_code == 403
    assert client.get("/api/v1/auth/me", headers=tok).json()["permissions"] == []

    # Restaurar defaults para no afectar otros tests.
    _set_perms(client, admin, "cliente", DEFAULT_PERMISSIONS["cliente"])


def test_cambio_de_perfil_de_un_usuario(client, admin):
    uid, tok = _new_user(client, admin, "cliente", [TC])
    assert f"{TC}.ventas_netas" not in client.get("/api/v1/auth/me", headers=tok).json()["permissions"]
    client.patch(f"/api/v1/users/{uid}", headers=admin, json={"role": "coordinador"})
    assert f"{TC}.ventas_netas" in client.get("/api/v1/auth/me", headers=tok).json()["permissions"]


def test_validaciones_de_perfiles(client, admin):
    r = client.put("/api/v1/perfiles/cliente", headers=admin, json={"permissions": ["inventado.ver"]})
    assert r.status_code == 400
    assert client.put("/api/v1/perfiles/gerente", headers=admin, json={"permissions": []}).status_code == 404
    _, tok = _new_user(client, admin, "coordinador", [TC])
    assert client.get("/api/v1/perfiles", headers=tok).status_code == 403
    assert client.put("/api/v1/perfiles/cliente", headers=tok, json={"permissions": []}).status_code == 403


def test_cambio_de_permisos_queda_auditado(client, admin):
    _set_perms(client, admin, "cliente", [f"{TC}.ver", f"{TC}.ventas_netas"])
    _set_perms(client, admin, "cliente", DEFAULT_PERMISSIONS["cliente"])
    rows = client.get("/api/v1/audit?action=update_profile_permissions", headers=admin).json()
    assert rows and rows[0]["resource_id"] == "cliente"
    assert rows[0]["extra"]["quitados"] == [f"{TC}.ventas_netas"]
