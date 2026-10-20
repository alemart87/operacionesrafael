"""Creación rápida de usuarios: link con QR que vence a los 30 minutos, registro con el perfil elegido y entrada directa."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core import rate_limit
from app.main import app

ADMIN = {"email": "admin@voicenter.com.py", "password": "Test1234!"}
ORIGEN = "https://operaciones.example.com"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    rate_limit.clear_all()
    yield


def _auth(client, email=ADMIN["email"], password=ADMIN["password"]):
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _crear(client, h, **kw):
    body = {"perfil": "supervisor", "operativas": ["televentas_claro"], "max_usos": 2, "origen": ORIGEN, **kw}
    return client.post("/api/v1/invitaciones", headers=h, json=body)


def _token(inv):
    return inv["url"].rsplit("/", 1)[1]


def test_solo_el_superadmin_crea_links(client):
    h = _auth(client)
    r = client.post("/api/v1/users", headers=h, json={"email": "coord.inv@voicenter.com.py", "password": "Clave1234",
                                                       "full_name": "Coord Inv", "role": "coordinador", "operativas": ["televentas_claro"]})
    assert r.status_code == 201, r.text
    hc = _auth(client, "coord.inv@voicenter.com.py", "Clave1234")
    assert _crear(client, hc).status_code == 403
    assert client.get("/api/v1/invitaciones", headers=hc).status_code == 403
    assert client.get("/api/v1/invitaciones").status_code == 401


def test_validaciones_al_crear(client):
    h = _auth(client)
    assert _crear(client, h, origen="javascript:alert(1)").status_code == 400
    assert _crear(client, h, operativas=["no_existe"]).status_code == 400
    assert _crear(client, h, perfil="superadmin").status_code == 422
    assert _crear(client, h, max_usos=0).status_code == 422
    assert _crear(client, h, max_usos=1000).status_code == 400
    assert _crear(client, h, dominio="no es un dominio").status_code == 400


def test_link_qr_registro_y_entrada_directa(client):
    h = _auth(client)
    r = _crear(client, h, nota="Capacitación octubre", dominio="@Voicenter.com.py")
    assert r.status_code == 201, r.text
    inv = r.json()
    assert inv["estado"] == "vigente" and inv["dominio"] == "voicenter.com.py"
    assert inv["url"].startswith(f"{ORIGEN}/registro/") and "<svg" in inv["qr_svg"]
    assert 29 * 60 <= inv["segundos"] <= 30 * 60
    token = _token(inv)
    assert len(token) >= 40

    # Lo que ve quien abre el link (sin sesión).
    p = client.get(f"/api/v1/registro/{token}")
    assert p.status_code == 200, p.text
    info = p.json()
    assert info["perfil"]["slug"] == "supervisor" and info["operativas"] == [{"slug": "televentas_claro", "name": "Televentas CLARO"}]
    assert "politica" in info and "token" not in str(info)

    # Validaciones del registro.
    base = {"full_name": "Ana Gómez", "email": "ana.gomez@voicenter.com.py", "password": "ClaveSegura1"}
    assert client.post(f"/api/v1/registro/{token}", json={**base, "email": "ana@gmail.com"}).status_code == 400   # otro dominio
    assert client.post(f"/api/v1/registro/{token}", json={**base, "full_name": "Ana"}).status_code == 400        # sin apellido
    assert client.post(f"/api/v1/registro/{token}", json={**base, "email": ADMIN["email"]}).status_code in (400, 409)

    r = client.post(f"/api/v1/registro/{token}", json=base)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["creado"] and body["ingreso"] and body["user_role"] == "supervisor"
    assert body["user_operativas"] == ["televentas_claro"] and body["requiere_cambio_contrasena"] is False
    # Ya está adentro con su perfil.
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}).json()
    assert me["role"] == "supervisor" and me["email"] == "ana.gomez@voicenter.com.py"
    # Y puede volver a entrar con su contraseña.
    _auth(client, "ana.gomez@voicenter.com.py", "ClaveSegura1")

    # El mismo correo no se registra dos veces.
    assert client.post(f"/api/v1/registro/{token}", json=base).status_code == 409

    # El superadmin ve quién se registró; el cupo se descuenta.
    d = client.get(f"/api/v1/invitaciones/{inv['id']}", headers=h).json()
    assert d["usos"] == 1 and [x["email"] for x in d["registrados"]] == ["ana.gomez@voicenter.com.py"]
    assert d["url"] == inv["url"]          # mientras está vigente se puede volver a mostrar el QR

    # Segundo y último lugar; después, agotado.
    r = client.post(f"/api/v1/registro/{token}", json={**base, "full_name": "Beto Pérez", "email": "beto.perez@voicenter.com.py"})
    assert r.status_code == 201, r.text
    r = client.post(f"/api/v1/registro/{token}", json={**base, "full_name": "Carla Ruiz", "email": "carla.ruiz@voicenter.com.py"})
    assert r.status_code == 410 and r.json()["detail"]["code"] == "link_agotada"
    d = client.get(f"/api/v1/invitaciones/{inv['id']}", headers=h).json()
    assert d["estado"] == "agotada" and d["url"] is None and d["qr_svg"] is None

    # Auditoría.
    acciones = {x["action"] for x in client.get("/api/v1/audit?limit=500", headers=h).json()}
    assert {"invitacion_creada", "usuario_registrado_con_link"} <= acciones


def test_politica_de_contrasena(client):
    h = _auth(client)
    token = _token(_crear(client, h, perfil="analista").json())
    r = client.post(f"/api/v1/registro/{token}", json={"full_name": "Dani Sosa", "email": "dani.sosa@x.com", "password": "corta"})
    assert r.status_code == 422


def test_revocado_y_vencido(client):
    h = _auth(client)
    inv = _crear(client, h).json()
    token = _token(inv)
    assert client.post(f"/api/v1/invitaciones/{inv['id']}/revocar", headers=h).json()["estado"] == "revocada"
    r = client.get(f"/api/v1/registro/{token}")
    assert r.status_code == 410 and r.json()["detail"]["code"] == "link_revocada"

    inv = _crear(client, h).json()
    token = _token(inv)
    # Vencido: se atrasa el vencimiento del link directo en la base de prueba.
    import os
    import sqlite3
    ruta = os.environ["DATABASE_URL"].split("///", 1)[1]
    with sqlite3.connect(ruta) as cx:
        vencio = (datetime.now(timezone.utc) - timedelta(minutes=1)).strftime("%Y-%m-%d %H:%M:%S.%f")
        cx.execute("UPDATE invitaciones_registro SET expires_at = ? WHERE id = ?", (vencio, inv["id"]))
    r = client.post(f"/api/v1/registro/{token}", json={"full_name": "Eva Lima", "email": "eva.lima@x.com", "password": "ClaveSegura1"})
    assert r.status_code == 410 and r.json()["detail"]["code"] == "link_vencida"
    d = client.get(f"/api/v1/invitaciones/{inv['id']}", headers=h).json()
    assert d["estado"] == "vencida" and d["url"] is None


def test_links_invalidos_se_limitan_por_ip(client):
    for _ in range(3):
        assert client.get("/api/v1/registro/" + "x" * 43).status_code == 404
    assert client.get("/api/v1/registro/" + "y" * 43).status_code == 429


def test_perfil_sensible_marcado(client):
    h = _auth(client)
    inv = _crear(client, h, perfil="sub_gerente", max_usos=1).json()
    assert inv["sensible"] is True
    assert _crear(client, h, perfil="analista").json()["sensible"] is False
