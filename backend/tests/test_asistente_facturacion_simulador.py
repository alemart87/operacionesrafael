"""Voi maneja el simulador convergente: corre escenarios, los compara, guarda simulaciones en el registro del trabajo,
las anota y las abre en la pantalla. Solo para quien tiene Facturación."""
from __future__ import annotations

import asyncio
import json

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.deps import CurrentUser
from app.asistente.herramientas import Ctx, ejecutar, obtener, para_usuario
from app.asistente.herramientas.base import ErrorHerramienta
from app.asistente.herramientas.facturacion_simulador import cambios_respecto_calibrado, entrada_anual
from app.asistente.permisos import modo
from app.core.database import AsyncSessionLocal, Base, engine
from app.core.perfiles import DEFAULT_PERMISSIONS
from app.main import app
from app.models.audit import AuditLog
from app.operativas.televentas_claro.facturacion.analyzers.presets import PRESET_IDEAL_MOVIL, ZAFRA_IDEAL
from app.operativas.televentas_claro.facturacion.models.simulacion import FacturacionSimulacion
from tests.test_asistente import BASE, TC, _esperar, _login, _nuevo, _publicado, _usuario, simulador  # noqa: F401

def setup_module(module):
    """Base limpia para el módulo (como en test_asistente)."""
    from app.main import _seed_profiles

    async def _prep():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await _seed_profiles()
    asyncio.run(_prep())


SIMULADOR = {"facturacion_simular_anual", "facturacion_simulaciones_guardadas", "facturacion_simulacion_guardada",
             "facturacion_guardar_simulacion", "facturacion_anotar_simulacion"}


def _ctx(db, user) -> Ctx:
    return Ctx(db=db, user=user, conversacion_id="x")


def test_solo_facturacion_tiene_el_simulador():
    sa = CurrentUser(id="superadmin", email="a", role="superadmin", full_name="Admin")
    assert SIMULADOR <= {h.nombre for h in para_usuario(sa, modo(sa))}
    assert SIMULADOR <= {h.nombre for h in para_usuario(_usuario("sub_gerente"), "gestion")}
    for rol in ("coordinador", "controller", "analista", "auditor", "cliente"):
        u = _usuario(rol, sorted(set(DEFAULT_PERMISSIONS.get(rol, [])) | {f"{TC}.asistente"}))
        assert not SIMULADOR & {h.nombre for h in para_usuario(u, modo(u))}, rol
    aud = _usuario("auditor", [*DEFAULT_PERMISSIONS["auditor"], f"{TC}.facturacion"])
    assert not SIMULADOR & {h.nombre for h in para_usuario(aud, "auditor")}


def test_entrada_normalizada_reproduce_la_pantalla():
    # Sin argumentos: los valores iniciales de la dirección con la zafra real (lo que abre la pantalla).
    e = entrada_anual({})
    assert e["horizonte"] == 12 and e["parametros"]["ventas"] == 1700 and e["parametros"]["costos"]["ventas_por_vendedor"] == 17
    assert e["parametros"]["zafra_pct"] != ZAFRA_IDEAL and e["gpon"]["activo"] and e["gpon"]["por_asesor_por_mes"] == [3.0] * 12
    # IDEAL + bono único + optimizar + nombres de meses + mes afectado con costos y GPON.
    e = entrada_anual({"preset": "ideal", "bono_unico": True, "optimizar": True, "primer_mes": "2027-01", "horizonte": 18,
                       "ventas_por_mes": [1700, 1800], "meses_afectados": {"4": {"porta_pct": 85, "comision_por_venta": 110000,
                                                                                  "gpon": {"objetivo": 300, "comision_por_venta": 90000}}},
                       "gpon": {"por_asesor": 2.5, "cambios": {"mora_pct_lineas": 20}}})
    p = e["parametros"]
    assert p["zafra_pct"] == ZAFRA_IDEAL and p["bono_unico"] and p["ajuste_comisiones_pct"] == 40 and p["devolver_bono_efectividad"] is False
    assert e["nombres_meses"][0] == "Enero 2027" and e["nombres_meses"][12] == "Enero 2028" and len(e["ventas_por_mes"]) == 18
    assert e["ventas_por_mes"][2] == 1800 and e["meses_afectados_movil"]["4"] == {"porta_pct": 85, "costos": {"comision_por_venta": 110000}}
    assert e["gpon"]["meses_afectados"]["4"] == {"objetivo": 300, "costos": {"comision_por_venta": 90000}}
    assert e["gpon"]["por_asesor_por_mes"][0] == 2.5 and e["gpon"]["parametros"]["mora_pct_lineas"] == 20
    assert {c["parametro"] for c in cambios_respecto_calibrado(p)} >= {"zafra_pct", "bono_unico", "ajuste_comisiones_pct", "costos.ventas_por_vendedor"}
    # Lo que no vale se rechaza con un mensaje para el modelo.
    for mala in ({"horizonte": 13}, {"meses_afectados": {"1": {"porta_pct": 80}}}, {"meses_afectados": {"3": {"zafra_pct": [1]}}},
                 {"cambios": {"zafra_pct": [99, 80]}}, {"cambios": {"inventado": 1}}, {"preset": "otro"},
                 {"cambios": {"planes": [{"plan": "NOEXISTE", "mix_pct": 10}]}}):
        with pytest.raises(ErrorHerramienta):
            entrada_anual(mala)


@pytest.mark.asyncio
async def test_simular_anual_y_comparar_escenarios(simulador):
    async with AsyncSessionLocal() as db:
        sg = _usuario("sub_gerente")
        texto, error = await ejecutar(obtener("facturacion_simular_anual"), {}, _ctx(db, sg), "gestion")
        d = json.loads(texto)
        assert not error and d["negocio"].startswith("Convergente") and d["estructura_mes_1"]["vendedores"] == 100
        assert d["anual"]["veredicto"]["gana"] in (True, False) and len(d["meses"]) == 12 and d["meses"][0]["ventas"] == 1700
        assert d["escenario"]["preset"] == "inicial" and d["zafra"]["es_la_ideal"] is False
        assert d["entrada_normalizada"]["ventas_por_mes"][0] == 1700 and "confidenciales" in d["importante"]
        assert d["pantalla"].endswith("/simulador-anual")
        # Escenarios: la base primero y las diferencias contra ella.
        texto, error = await ejecutar(obtener("facturacion_simular_anual"),
                                      {"ventas": 1700, "escenarios": [{"nombre": "Vigente"}, {"nombre": "Propuesta 2027", "bono_unico": True, "optimizar": True},
                                                                      {"nombre": "Sin GPON", "gpon": {"activo": False}}]},
                                      _ctx(db, sg), "gestion")
        d = json.loads(texto)
        assert not error and d["comparacion"]["base"] == "Vigente"
        fila = next(f for f in d["comparacion"]["indicadores"] if f["indicador"] == "resultado")
        assert "Propuesta 2027 (diferencia)" in fila and fila["Propuesta 2027"] != fila["Vigente"]
        assert d["escenarios"]["Sin GPON"]["por_negocio"]["gpon"]["incluido"] is False and d["escenarios"]["Propuesta 2027"]["escenario"]["bono_unico"]
        assert "meses" not in d["escenarios"]["Vigente"]
        # Sin permiso: nada.
        texto, error = await ejecutar(obtener("facturacion_simular_anual"), {}, _ctx(db, _usuario("coordinador")), "gestion")
        assert error and "permiso" in texto and "Gs" not in texto


@pytest.mark.asyncio
async def test_guardar_anotar_y_abrir_simulaciones(simulador):
    async with AsyncSessionLocal() as db:
        sg = _usuario("sub_gerente")
        texto, error = await ejecutar(obtener("facturacion_simulaciones_guardadas"), {}, _ctx(db, sg), "gestion")
        assert not error and json.loads(texto)["simulaciones"] == []
        texto, error = await ejecutar(obtener("facturacion_guardar_simulacion"),
                                      {"nombre": "Ideal · 1.800 ventas · bono único", "preset": "ideal", "bono_unico": True,
                                       "ventas_por_mes": [1800], "primer_mes": "2027-01", "comentario": "Escenario para la reunión con Claro",
                                       "notas": [{"texto": "Se asume la zafra ideal desde el mes 1.", "tipo": "supuesto"}, "Revisar el recupero"]},
                                      _ctx(db, sg), "gestion")
        d = json.loads(texto)
        assert not error and d["ok"] and d["pantalla"] == f"/televentas-claro/facturacion/simulador-anual?abrir={d['id']}"
        assert d["resultado"]["escenario"]["bono_unico"] and d["resultado"]["estructura_mes_1"]["vendedores"] > 100
        s = await db.get(FacturacionSimulacion, d["id"])
        assert s and s.created_by == sg.id and s.parametros["convergente"]["activo"] and s.parametros["bono_unico"]
        assert s.ventas_por_mes[0] == 1800 and len(s.ventas_por_mes) == 12 and s.nombres_meses[0] == "Enero 2027"
        assert [n["tipo"] for n in s.notas] == ["supuesto", "observacion"] and s.notas[0]["autor"] == sg.full_name
        assert s.resumen["bono_unico"] and s.resumen["convergente"] and s.resumen["guardada_por"] == "Voi"
        audit = (await db.execute(select(AuditLog).where(AuditLog.resource_id == s.id))).scalars().all()
        assert any(a.action == "create_facturacion_simulacion" and (a.extra or {}).get("origen") == "voi" for a in audit)
        # Sin nombre no se guarda; el nombre lo pide la herramienta.
        texto, error = await ejecutar(obtener("facturacion_guardar_simulacion"), {"ventas": 1700}, _ctx(db, sg), "gestion")
        assert error and "nombre" in texto
        # Listar, abrir por nombre (parcial) y recalcular.
        texto, error = await ejecutar(obtener("facturacion_simulaciones_guardadas"), {}, _ctx(db, sg), "gestion")
        lista = json.loads(texto)["simulaciones"]
        assert len(lista) == 1 and lista[0]["nombre"].startswith("Ideal") and lista[0]["pantalla"].endswith(f"?abrir={s.id}")
        texto, error = await ejecutar(obtener("facturacion_simulacion_guardada"), {"referencia": "bono único", "recalcular": True},
                                      _ctx(db, sg), "gestion")
        d = json.loads(texto)
        assert not error and d["id"] == s.id and d["zafra"]["es_la_ideal"] and d["gpon"]["activo"]
        assert {c["parametro"] for c in d["cambios_respecto_calibrado"]} >= {"bono_unico", "zafra_pct"}
        assert d["recalculo"]["anual"]["resultado"] == s.resumen["resultado"]
        # Anotar: suma notas sin borrar las anteriores, y cambia el comentario.
        texto, error = await ejecutar(obtener("facturacion_anotar_simulacion"),
                                      {"referencia": s.id, "notas": [{"texto": "Se decide presentar este escenario.", "tipo": "decision", "mes": 3}],
                                       "comentario": "Presentado a la dirección"},
                                      _ctx(db, sg), "gestion")
        d = json.loads(texto)
        assert not error and d["notas"] == 3
        await db.refresh(s)
        assert s.comentario == "Presentado a la dirección" and s.notas[2]["tipo"] == "decision" and s.notas[2]["mes"] == 3
        texto, error = await ejecutar(obtener("facturacion_anotar_simulacion"), {"referencia": s.id}, _ctx(db, sg), "gestion")
        assert error and "notas" in texto
        texto, error = await ejecutar(obtener("facturacion_simulacion_guardada"), {"referencia": "no existe"}, _ctx(db, sg), "gestion")
        assert error and "No encontré" in texto


@pytest.mark.asyncio
async def test_conversacion_simula_y_guarda_con_el_simulador(simulador):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        await _publicado(ac, admin)
        _, subg = await _nuevo(ac, admin, "sub_gerente", "Sofía Subgerente")
        est = (await ac.get(f"{BASE}/estado", headers=subg)).json()
        assert SIMULADOR <= {h["nombre"] for h in est["herramientas"]}
        r = await ac.post(f"{BASE}/conversaciones", headers=subg, json={"texto": "Simulá el balance anual convergente con 1800 ventas"})
        cid = r.json()["id"]
        await _esperar(cid)
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=subg)).json()
        pasos = [i for i in t["items"] if i["tipo"] == "paso"]
        assert pasos and pasos[0]["herramienta"] == "facturacion_simular_anual" and pasos[0]["estado"] == "ok"
        r = await ac.post(f"{BASE}/conversaciones/{cid}/mensajes", headers=subg, json={"texto": "Guardá la simulación como Prueba desde Voi"})
        assert r.status_code == 200, r.text
        await _esperar(cid)
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=subg)).json()
        # Guardar es una acción propia (nivel 2): queda como «accion» en la conversación, no como «paso».
        acciones = [i for i in t["items"] if i["tipo"] == "accion"]
        assert acciones and acciones[-1]["accion"]["herramienta"] == "facturacion_guardar_simulacion", t["items"]
        assert t["items"][-1]["tipo"] == "voi" and "regis" in t["items"][-1]["texto"].lower()
        async with AsyncSessionLocal() as db:
            todas = (await db.execute(select(FacturacionSimulacion))).scalars().all()
            s = [x for x in todas if x.nombre == "Prueba desde Voi"]
            assert len(s) == 1, [x.nombre for x in todas]
            assert s[0].created_by_nombre == "Sofía Subgerente" and s[0].resumen.get("guardada_por") == "Voi"
        # Quien no tiene Facturación no llega ni a la herramienta.
        _, coord = await _nuevo(ac, admin, "coordinador")
        r = await ac.post(f"{BASE}/conversaciones", headers=coord, json={"texto": "Simulá el balance anual convergente con 1800 ventas"})
        cid = r.json()["id"]
        await _esperar(cid)
        t = (await ac.get(f"{BASE}/conversaciones/{cid}", headers=coord)).json()
        assert not [i for i in t["items"] if i["tipo"] == "paso" and str(i.get("herramienta", "")).startswith("facturacion")]
