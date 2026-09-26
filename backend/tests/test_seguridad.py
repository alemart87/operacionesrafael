"""Seguridad de acceso: sesiones, inactividad, vencimiento, bloqueo, contraseñas, horarios, excepciones y 2FA."""
from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.core import rate_limit
from app.core.database import Base, engine, session_scope
from app.main import app
from app.models.seguridad import UserSession
from app.models.user import User
from app.services import seguridad as seg

SEG = "/api/v1/seguridad"
ME = "/api/v1/auth/me"


def setup_module(module):
    from app.main import _seed_profiles

    async def _prep():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await _seed_profiles()
    asyncio.run(_prep())


def _h(r):
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _login_raw(ac, email, pwd):
    rate_limit.clear_all()
    return await ac.post("/api/v1/auth/login", json={"email": email, "password": pwd})


async def _crear(ac, admin, role="analista", pwd="Clave1234!x"):
    email = f"{role}-{uuid.uuid4().hex[:6]}@voicenter.com.py"
    r = await ac.post("/api/v1/users", headers=admin, json={"email": email, "password": pwd, "full_name": f"U {role}", "role": role, "operativas": []})
    assert r.status_code == 201, r.text
    return email, r.json()["id"]


async def _config(ac, admin, **secciones):
    cfg = (await ac.get(f"{SEG}/config", headers=admin)).json()["config"]
    for k, v in secciones.items():
        cfg[k] = {**cfg[k], **v}
    r = await ac.put(f"{SEG}/config", headers=admin, json={"config": cfg})
    assert r.status_code == 200, r.text
    return r.json()["config"]


async def _sesion(email) -> UserSession:
    from sqlalchemy import select
    async with session_scope() as db:
        return (await db.execute(select(UserSession).where(UserSession.email == email, UserSession.ended_at.is_(None))
                                 .order_by(UserSession.created_at.desc()))).scalars().first()


@pytest.mark.asyncio
async def test_seguridad_de_acceso():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = _h(await _login_raw(ac, "admin@voicenter.com.py", "Test1234!"))
        email, uid = await _crear(ac, admin)
        r = await _login_raw(ac, email, "Clave1234!x")
        assert r.status_code == 200 and r.json()["recomendar_2fa"] is True
        user = _h(r)
        ref = r.json()["refresh_token"]
        me = (await ac.get(ME, headers=user)).json()
        assert me["seguridad"]["inactividad_minutos"] == 60 and me["seguridad"]["sesion_expira"]

        # Solo el superadmin administra la seguridad
        assert (await ac.get(f"{SEG}/config", headers=user)).status_code == 403
        assert (await ac.get(f"{SEG}/sesiones", headers=user)).status_code == 403

        # --- Cerrar sesiones a distancia
        act = (await ac.get(f"{SEG}/sesiones", headers=admin)).json()["activas"]
        mia = next(s for s in act if s["email"] == email)
        assert any(s["es_la_mia"] for s in act)
        assert (await ac.post(f"{SEG}/sesiones/{mia['id']}/cerrar", headers=admin)).json()["cerradas"] == 1
        r = await ac.get(ME, headers=user)
        assert r.status_code == 401 and r.json()["detail"]["code"] == "sesion_cerrada"
        r = await ac.post("/api/v1/auth/refresh", json={"refresh_token": ref})
        assert r.status_code == 401  # el refresh no revive una sesión cerrada

        # por usuario y "todas menos la mía"
        u1 = _h(await _login_raw(ac, email, "Clave1234!x"))
        u2 = _h(await _login_raw(ac, email, "Clave1234!x"))
        assert (await ac.post(f"{SEG}/usuarios/{uid}/cerrar-sesiones", headers=admin)).json()["cerradas"] == 2
        assert (await ac.get(ME, headers=u1)).status_code == 401 and (await ac.get(ME, headers=u2)).status_code == 401
        u1 = _h(await _login_raw(ac, email, "Clave1234!x"))
        assert (await ac.post(f"{SEG}/sesiones/cerrar-todas", headers=admin)).json()["cerradas"] >= 1
        assert (await ac.get(ME, headers=u1)).status_code == 401
        assert (await ac.get(ME, headers=admin)).status_code == 200  # la del superadmin sigue

        # --- Inactividad (60 min) y vencimiento de la sesión
        u1 = _h(await _login_raw(ac, email, "Clave1234!x"))
        async with session_scope() as db:
            s = await db.get(UserSession, (await _sesion(email)).id)
            s.last_seen_at = datetime.now(timezone.utc) - timedelta(minutes=61)
            await db.commit()
        r = await ac.get(ME, headers=u1)
        assert r.status_code == 401 and r.json()["detail"]["code"] == "sesion_inactividad"
        u1 = _h(await _login_raw(ac, email, "Clave1234!x"))
        async with session_scope() as db:
            s = await db.get(UserSession, (await _sesion(email)).id)
            s.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            await db.commit()
        assert (await ac.get(ME, headers=u1)).json()["detail"]["code"] == "sesion_vencida"

        # --- Salir cierra la sesión en el servidor
        u1 = _h(await _login_raw(ac, email, "Clave1234!x"))
        assert (await ac.post("/api/v1/auth/logout", headers=u1)).status_code == 200
        assert (await ac.get(ME, headers=u1)).status_code == 401

        # --- Bloqueo persistente por intentos fallidos + desbloqueo manual
        await _config(ac, admin, bloqueo={"max_intentos": 3, "ventana_minutos": 15, "bloqueo_minutos": 30})
        for i in range(2):
            assert (await _login_raw(ac, email, "mala")).status_code == 401
        r = await _login_raw(ac, email, "mala")
        assert r.status_code == 423 and "bloqueado" in r.json()["detail"]
        assert (await _login_raw(ac, email, "Clave1234!x")).status_code == 423  # ni con la correcta
        est = {u["id"]: u for u in (await ac.get(f"{SEG}/usuarios", headers=admin)).json()}
        assert est[uid]["bloqueado_hasta"] and est[uid]["intentos_fallidos"] == 3
        assert (await ac.post(f"{SEG}/usuarios/{uid}/desbloquear", headers=admin)).status_code == 200
        assert (await _login_raw(ac, email, "Clave1234!x")).status_code == 200

        # --- Política de contraseñas, cambio en el primer ingreso, historial y vencimiento
        await _config(ac, admin, contrasenas={"min_largo": 10, "mayus_minus": True, "numero": True, "simbolo": False,
                                              "vencimiento_dias": 90, "historial": 2, "cambio_primer_ingreso": True})
        r = await ac.post("/api/v1/users", headers=admin, json={"email": "debil@voicenter.com.py", "password": "corta", "full_name": "Débil", "role": "analista", "operativas": []})
        assert r.status_code == 422 or (r.status_code == 400 and "al menos 10" in r.json()["detail"])
        e2, uid2 = await _crear(ac, admin, pwd="Temporal2026x")
        r = await _login_raw(ac, e2, "Temporal2026x")
        assert r.json()["requiere_cambio_contrasena"] is True
        h2 = _h(r)
        r = await ac.get("/api/v1/operativas", headers=h2)
        assert r.status_code == 403 and r.json()["detail"]["code"] == "cambio_contrasena"
        assert (await ac.get(ME, headers=h2)).json()["seguridad"]["motivo_cambio"] == "primer_ingreso"
        cp = "/api/v1/auth/change-password"
        assert (await ac.post(cp, headers=h2, json={"current_password": "Temporal2026x", "new_password": "Temporal2026x"})).status_code == 400
        assert (await ac.post(cp, headers=h2, json={"current_password": "Temporal2026x", "new_password": "sinmayus2026"})).status_code == 400
        assert (await ac.post(cp, headers=h2, json={"current_password": "Temporal2026x", "new_password": "Nueva2026abc"})).status_code == 200
        assert (await ac.get("/api/v1/operativas", headers=h2)).status_code == 200
        assert (await ac.post(cp, headers=h2, json={"current_password": "Nueva2026abc", "new_password": "Temporal2026x"})).status_code == 400  # historial
        async with session_scope() as db:
            (await db.get(User, uid2)).password_changed_at = datetime.now(timezone.utc) - timedelta(days=91)
            await db.commit()
        r = await ac.get("/api/v1/operativas", headers=h2)
        assert r.status_code == 403 and r.json()["detail"]["code"] == "cambio_contrasena"
        assert (await ac.get(ME, headers=h2)).json()["seguridad"]["motivo_cambio"] == "vencida"
        await _config(ac, admin, contrasenas={"vencimiento_dias": 0})

        # --- Horarios por perfil: bloquear, cortar a quien ya estaba adentro, excepción y superadmin exento
        sin_franjas = {str(d): [] for d in range(7)}
        cfg = (await ac.get(f"{SEG}/config", headers=admin)).json()["config"]
        cfg["horarios"]["modo"] = "registrar"
        cfg["horarios"]["perfiles"]["analista"]["dias"] = sin_franjas
        assert (await ac.put(f"{SEG}/config", headers=admin, json={"config": cfg})).status_code == 200
        dentro = _h(await _login_raw(ac, email, "Clave1234!x"))  # modo registrar: entra y queda anotado
        assert (await ac.get(ME, headers=dentro)).status_code == 200
        cfg["horarios"]["modo"] = "bloquear"
        assert (await ac.put(f"{SEG}/config", headers=admin, json={"config": cfg})).status_code == 200
        r = await ac.get(ME, headers=dentro)
        assert r.status_code == 401 and r.json()["detail"]["code"] == "sesion_horario"
        r = await _login_raw(ac, email, "Clave1234!x")
        assert r.status_code == 403 and r.json()["detail"]["code"] == "fuera_de_horario"
        hasta = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        assert (await ac.put(f"{SEG}/usuarios/{uid}/excepcion", headers=admin, json={"hasta": hasta, "nota": "Cierre de mes"})).status_code == 200
        r = await _login_raw(ac, email, "Clave1234!x")
        assert r.status_code == 200
        assert (await ac.get(ME, headers=_h(r))).json()["seguridad"]["acceso_hasta"]
        assert (await ac.delete(f"{SEG}/usuarios/{uid}/excepcion", headers=admin)).status_code == 200
        assert (await ac.get(ME, headers=_h(r))).status_code == 401
        assert (await _login_raw(ac, "admin@voicenter.com.py", "Test1234!")).status_code == 200  # nunca queda afuera
        malo = (await ac.get(f"{SEG}/config", headers=admin)).json()["config"]
        malo["horarios"]["perfiles"]["analista"]["dias"]["0"] = [["19:00", "07:00"]]
        assert (await ac.put(f"{SEG}/config", headers=admin, json={"config": malo})).status_code == 400
        cfg["horarios"]["modo"] = "desactivado"
        assert (await ac.put(f"{SEG}/config", headers=admin, json={"config": cfg})).status_code == 200

        # --- Segundo factor (opcional): activar, login en dos pasos, código de recuperación, reinicio por el admin
        h = _h(await _login_raw(ac, email, "Clave1234!x"))
        ini = (await ac.post("/api/v1/auth/2fa/iniciar", headers=h)).json()
        assert ini["qr_svg"].startswith("<svg") and ini["uri"].startswith("otpauth://")
        secreto = ini["secreto"].replace(" ", "")
        assert (await ac.post("/api/v1/auth/2fa/activar", headers=h, json={"codigo": "000000"})).status_code == 400
        act = (await ac.post("/api/v1/auth/2fa/activar", headers=h, json={"codigo": seg._totp(secreto, int(time.time() // 30))})).json()
        assert act["activo"] and len(act["codigos_recuperacion"]) == 8
        r = await _login_raw(ac, email, "Clave1234!x")
        assert r.json()["requiere_2fa"] is True and "access_token" not in r.json()
        des = r.json()["desafio"]
        assert (await ac.post("/api/v1/auth/login/2fa", json={"desafio": des, "codigo": "123456"})).status_code == 401
        r = await ac.post("/api/v1/auth/login/2fa", json={"desafio": des, "codigo": seg._totp(secreto, int(time.time() // 30))})
        assert r.status_code == 200 and r.json()["recomendar_2fa"] is False
        assert (await ac.get(ME, headers=_h(r))).json()["seguridad"]["dos_factores_activo"] is True
        cod = act["codigos_recuperacion"][0]
        rate_limit.clear_all()
        assert (await ac.post("/api/v1/auth/login/2fa", json={"desafio": des, "codigo": cod})).status_code == 200
        assert (await ac.post("/api/v1/auth/login/2fa", json={"desafio": des, "codigo": cod})).status_code == 401  # un solo uso
        assert (await ac.post(f"{SEG}/usuarios/{uid}/reset-2fa", headers=admin)).status_code == 200
        r = await _login_raw(ac, email, "Clave1234!x")
        assert "access_token" in r.json()

        # --- Desactivar al usuario corta sus sesiones
        h = _h(r)
        assert (await ac.patch(f"/api/v1/users/{uid}", headers=admin, json={"is_active": False})).status_code == 200
        r = await ac.get(ME, headers=h)
        assert r.status_code == 401

        acciones = {a["action"] for a in (await ac.get("/api/v1/audit", headers=admin, params={"limit": 500})).json()}
        for a in ("sesion_cerrada", "sesiones_usuario_cerradas", "sesiones_todas_cerradas", "usuario_bloqueado", "usuario_desbloqueado",
                  "seguridad_config", "acceso_fuera_de_horario", "excepcion_horario", "2fa_activado", "2fa_reiniciado", "logout"):
            assert a in acciones, a
