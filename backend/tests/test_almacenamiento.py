"""Almacenamiento: los archivos van al disco persistente (aunque UPLOAD_DIR haya quedado afuera), el superadmin ve
dónde queda cada cosa y Facturación se procesa con la copia de la base cuando el archivo ya no está."""
from __future__ import annotations

import asyncio
import gzip
import uuid
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal, Base, engine
from app.main import app
from app.operativas.televentas_claro.facturacion.jobs import runner
from app.operativas.televentas_claro.facturacion.migraciones import copia_en_base
from app.operativas.televentas_claro.facturacion.models.report import FacturacionReport
from app.operativas.televentas_claro.facturacion.models.upload import FacturacionUpload
from app.operativas.televentas_claro.ventas_netas.models import VentasNetasUpload
from app.services import almacenamiento

ADMIN = {"email": "admin@voicenter.com.py", "password": "Test1234!"}


def _liquidacion() -> bytes:
    def fila(desc: str, importe: str) -> str:
        c = [""] * 30
        c[0], c[5], c[14], c[17], c[19], c[25] = "LQ-77", desc, "15/09/2026 10:00", importe, "1", "PLAN1"
        return ";".join(c)
    return ("\n".join(["Liquidacion;a;b;c;d;Desc", fila("ACTIVACIONES", "1000.50"), fila("ACTIVACIONES", "500"),
                       fila("SUSPENSIONES", "-200")]) + "\n").encode("cp1252")


def setup_module(module):
    from app.main import _seed_profiles  # sin lifespan (AsyncClient) hay que sembrar los perfiles a mano

    async def _prep():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await _seed_profiles()
    asyncio.run(_prep())


async def _login(ac, email, password):
    r = await ac.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_en_produccion_usa_el_disco_montado_si_upload_dir_quedo_afuera(tmp_path, monkeypatch):
    disco = tmp_path / "persistent"
    disco.mkdir()
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path / "efimero" / "uploads"))
    monkeypatch.setattr(almacenamiento, "discos_montados", lambda: [str(disco)])
    monkeypatch.setattr(almacenamiento, "disco_de", lambda p: str(disco) if str(p).startswith(str(disco)) else None)
    estado = almacenamiento.resolver_upload_dir()
    assert estado["ajustado"] and estado["efectivo"] == str(disco / "uploads") and estado["disco"] == str(disco)
    assert settings.upload_dir == str(disco / "uploads") and (disco / "uploads").is_dir()
    # Con UPLOAD_DIR ya dentro del disco no se toca nada.
    monkeypatch.setattr(settings, "upload_dir", str(disco / "archivos"))
    estado = almacenamiento.resolver_upload_dir()
    assert not estado["ajustado"] and settings.upload_dir == str(disco / "archivos")
    # Con dos discos no se adivina: queda como está (y el diagnóstico lo marca).
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path / "efimero" / "uploads"))
    monkeypatch.setattr(almacenamiento, "discos_montados", lambda: [str(disco), str(tmp_path / "otro")])
    estado = almacenamiento.resolver_upload_dir()
    assert not estado["ajustado"] and estado["disco"] is None


@pytest.mark.asyncio
async def test_diagnostico_solo_superadmin_y_marca_lo_que_no_tiene_respaldo():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, **ADMIN)
        email = f"coord-{uuid.uuid4().hex[:6]}@voicenter.com.py"
        r = await ac.post("/api/v1/users", headers=admin, json={"email": email, "password": "Clave1234!", "full_name": "Coord",
                                                               "role": "coordinador", "operativas": ["televentas_claro"]})
        assert r.status_code == 201, r.text
        coord = await _login(ac, email, "Clave1234!")
        assert (await ac.get("/api/v1/sistema/almacenamiento", headers=coord)).status_code == 403
        async with AsyncSessionLocal() as db:
            # Un corte de Ventas Netas viejo: sin los datos en la base y sin el archivo → no se puede recalcular.
            db.add(VentasNetasUpload(uploaded_by="x", filename="viejo.xlsx", file_path="/no/existe/viejo.xlsx", status="completed"))
            # Uno nuevo: con los datos en la base.
            db.add(VentasNetasUpload(uploaded_by="x", filename="nuevo.xlsx", file_path="/no/existe/nuevo.xlsx", status="completed",
                                     parsed_gz=gzip.compress(b"{}")))
            db.add(FacturacionUpload(uploaded_by="x", filename="l.txt", file_path="/no/existe/l.txt", status="completed",
                                     contenido_gz=gzip.compress(_liquidacion())))
            await db.commit()
        d = (await ac.get("/api/v1/sistema/almacenamiento", headers=admin)).json()
    assert d["base"]["motor"] == "sqlite" and d["base"]["persistente"] is True  # en desarrollo, SQLite vale
    assert d["archivos"]["ruta"] == str(settings.upload_path.resolve()) and "espacio" in d["archivos"]
    m = {x["modulo"]: x for x in d["modulos"]}
    assert m["Ventas Netas"]["sin_respaldo"] >= 1 and m["Ventas Netas"]["en_base"] >= 1
    assert m["Facturación"]["en_base"] >= 1 and m["Productividad"]["sin_respaldo"] == 0
    assert any("Ventas Netas" in x["texto"] for x in d["mensajes"])
    assert "postgres" not in str(d).lower() or d["base"]["motor"] == "postgresql"  # nunca la URL ni credenciales
    assert settings.secret_key not in str(d)


@pytest.mark.asyncio
async def test_facturacion_se_procesa_con_la_copia_de_la_base_si_falta_el_archivo(monkeypatch):
    usados: list[tuple[str, bytes]] = []

    async def _sin_subproceso(fn, path):  # el aislamiento en subproceso no es lo que se prueba acá
        usados.append((path, Path(path).read_bytes()))
        return fn(path)
    monkeypatch.setattr(runner, "run_isolated", _sin_subproceso)

    async with AsyncSessionLocal() as db:
        up = FacturacionUpload(uploaded_by="x", filename="liq.txt", file_path="/no/existe/liq.txt", status="processing",
                               contenido_gz=gzip.compress(_liquidacion()))
        db.add(up)
        await db.commit()
        uid = up.id
    await runner.run_facturacion(uid)
    async with AsyncSessionLocal() as db:
        rep = (await db.execute(select(FacturacionReport).where(FacturacionReport.upload_id == uid))).scalars().first()
        st = (await db.get(FacturacionUpload, uid)).status
    assert st == "completed" and rep is not None and rep.nro_liquidacion == "LQ-77" and float(rep.total) == 1300.5
    path, contenido = usados[0]
    assert contenido == _liquidacion() and not Path(path).exists()  # se procesó la copia y el temporal se borró


@pytest.mark.asyncio
async def test_la_migracion_copia_a_la_base_las_liquidaciones_que_tienen_archivo(tmp_path):
    archivo = tmp_path / "liq.txt"
    archivo.write_bytes(_liquidacion())
    async with AsyncSessionLocal() as db:
        a = FacturacionUpload(uploaded_by="x", filename="liq.txt", file_path=str(archivo), status="completed")
        b = FacturacionUpload(uploaded_by="x", filename="perdida.txt", file_path=str(tmp_path / "perdida.txt"), status="completed")
        db.add_all([a, b])
        await db.commit()
        con, sin = a.id, b.id
    async with AsyncSessionLocal() as db:
        res = await copia_en_base(db)
    async with AsyncSessionLocal() as db:
        copias = dict((await db.execute(select(FacturacionUpload.id, FacturacionUpload.contenido_gz)
                                        .where(FacturacionUpload.id.in_([con, sin])))).all())
    assert res["copiadas"] >= 1 and res["sin_archivo"] >= 1
    assert gzip.decompress(copias[con]) == _liquidacion() and copias[sin] is None
