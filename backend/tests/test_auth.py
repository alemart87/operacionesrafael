"""Smoke tests del sistema de login, roles y gestión de usuarios."""
import pytest
from fastapi.testclient import TestClient

from app.core import rate_limit
from app.main import app

ADMIN = {"email": "admin@voicenter.com.py", "password": "Test1234!"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    rate_limit.clear_all()
    yield


def _login(client, email, password):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/api/v1/health").status_code == 200


def test_superadmin_login_and_me(client):
    r = _login(client, **ADMIN)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user_role"] == "superadmin"
    me = client.get("/api/v1/auth/me", headers=_auth(body["access_token"])).json()
    assert me["role"] == "superadmin"
    assert me["can_edit_profile"] is False


def test_bad_password_and_rate_limit(client):
    for _ in range(3):
        assert _login(client, ADMIN["email"], "mala").status_code == 401
    # Superado el máximo: bloqueado incluso con la contraseña correcta.
    assert _login(client, **ADMIN).status_code == 429


def test_protected_requires_token(client):
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/users").status_code == 401


def test_user_lifecycle(client):
    admin_tok = _login(client, **ADMIN).json()["access_token"]

    r = client.post("/api/v1/users", headers=_auth(admin_tok), json={
        "email": "Lector@Voicenter.com.py", "password": "Lector123!",
        "full_name": "Lector Prueba", "role": "viewer", "allowed_modules": [],
    })
    assert r.status_code == 201, r.text
    uid = r.json()["id"]
    assert r.json()["email"] == "lector@voicenter.com.py"

    # Duplicado
    r = client.post("/api/v1/users", headers=_auth(admin_tok), json={
        "email": "lector@voicenter.com.py", "password": "Lector123!",
        "full_name": "Otro", "role": "viewer",
    })
    assert r.status_code == 409

    # El lector entra, no ve módulos y no puede gestionar usuarios.
    tok = _login(client, "lector@voicenter.com.py", "Lector123!").json()["access_token"]
    assert client.get("/api/v1/modules", headers=_auth(tok)).json() == []
    assert client.get("/api/v1/users", headers=_auth(tok)).status_code == 403
    assert client.get("/api/v1/audit", headers=_auth(tok)).status_code == 403

    # Cambio de contraseña propio
    r = client.post("/api/v1/auth/change-password", headers=_auth(tok), json={
        "current_password": "Lector123!", "new_password": "Nueva1234!",
    })
    assert r.status_code == 200
    assert _login(client, "lector@voicenter.com.py", "Nueva1234!").status_code == 200

    # Baja lógica: ya no puede entrar
    assert client.delete(f"/api/v1/users/{uid}", headers=_auth(admin_tok)).status_code == 200
    assert _login(client, "lector@voicenter.com.py", "Nueva1234!").status_code == 401

    # Quedó auditado
    actions = [a["action"] for a in client.get("/api/v1/audit", headers=_auth(admin_tok)).json()]
    assert "create_user" in actions and "deactivate_user" in actions


def test_refresh_token(client):
    body = _login(client, **ADMIN).json()
    r = client.post("/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert r.status_code == 200
    # Un access token no sirve como refresh
    r = client.post("/api/v1/auth/refresh", json={"refresh_token": body["access_token"]})
    assert r.status_code == 401
