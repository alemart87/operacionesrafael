"""Logística de entregas: parser del .xlsx de pedidos, análisis (estado × región, motivos, línea de tiempo, pendientes y
demora por zona), API con borrador, publicación única por mes, reemplazo, despublicación, recálculo y eliminación; quién
ve qué; y el dataset para Integraciones."""
from __future__ import annotations

import asyncio
import io
import uuid
from datetime import date, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from openpyxl import Workbook

from app.core.database import Base, engine
from app.main import app
from app.operativas.televentas_claro.logistica.analyzer import analizar, dias_habiles
from app.operativas.televentas_claro.logistica.parser import ArchivoInvalido, estado_canonico, parse_logistica
from app.operativas.televentas_claro.logistica.proyeccion import proyectar

TC = "televentas_claro"
BASE = "/api/v1/televentas-claro/logistica"
CAB = ["Nro. Formulario", "LINEA_ORIG", "Nro. Documento Cliente", "Nombre Completa", "Ciudad Cliente", "Departamento", "REGION",
       "Fecha Venta", "Ven_Nombre Completo", "Promoción", "ESTADO", "MOTIVO"]


def fila(form, cliente, ciudad, depto, region, fecha, vendedor, estado, motivo=None, promo="PORTABILIDAD", linea=None, doc=1234567):
    return [form, linea, doc, cliente, ciudad, depto, region, datetime(fecha.year, fecha.month, fecha.day), vendedor, promo, estado, motivo]


PEDIDOS = [
    fila("F1", "AGUILERA, GUSTAVO", "SAN LORENZO", "CENTRAL", "CENTRAL", date(2026, 10, 1), "SALINAS, BRANDON", "ENTREGADO", "ENTREGADO"),
    fila("F2", "ALCARAZ, FRANCISCO", "ASUNCION", "CENTRAL", "CENTRAL", date(2026, 10, 1), "NUÑEZ, EVELYN", "ENTREGADO", "ENTREGADO", linea="F2"),
    fila("F3", "ALDERETE, CESAR", "CIUDAD DEL ESTE", "ALTO PARANA", "INTERIOR", date(2026, 10, 1), "PANIAGUA, OLGA", "EN GESTION", "EN GESTION"),
    fila("F4", "BENITEZ, ROSA", "ENCARNACION", "ITAPUA", "INTERIOR", date(2026, 10, 2), "NUÑEZ, EVELYN", "EN GESTIÓN", "INCONTACTABLE LLAMADAS Y WHATSAPP"),
    fila("F5", "CACERES, ANA", "LUQUE", "CENTRAL", "CENTRAL", date(2026, 10, 3), "SALINAS, BRANDON", "DEVUELTO", "RECHAZADO EAPN POR TITULARIDAD"),
    fila("F6", "DUARTE, LUIS", "LUQUE", "CENTRAL", "CENTRAL", date(2026, 10, 6), "SALINAS, BRANDON", "EN GESTION", None),
    fila("F6", "DUARTE, LUIS", "LUQUE", "CENTRAL", "CENTRAL", date(2026, 10, 6), "SALINAS, BRANDON", "ENTREGADO", "ENTREGADO", promo="PLAN CONTROL"),
    fila("F7", "ESQUIVEL, JUAN", "CAPIATA", "CENTRAL", "CENTRAL", date(2026, 10, 8), "NUÑEZ, EVELYN", "ENTREGADO", None),
]


def xlsx(filas=PEDIDOS, cab=CAB, titulo=None) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Hoja1"
    if titulo:
        ws.append([titulo]); ws.append([])
    ws.append(cab)
    for f in filas:
        ws.append(f)
    buf = io.BytesIO(); wb.save(buf)
    return buf.getvalue()


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


# ============================ parser y análisis ============================
def test_parser_reconoce_columnas_estados_y_fechas():
    r = parse_logistica(xlsx(titulo="Reporte de entregas"))   # tolera títulos arriba del encabezado
    assert len(r["filas"]) == 8 and r["hoja"] == "Hoja1"
    f = r["filas"][3]
    assert f == {**f, "formulario": "F4", "region": "INTERIOR", "fecha": "2026-10-02", "estado": "EN GESTION",
                 "motivo": "INCONTACTABLE LLAMADAS Y WHATSAPP", "motivo_informado": True}
    assert r["filas"][5]["motivo"] == "EN GESTION" and r["filas"][5]["motivo_informado"] is False
    assert estado_canonico("Devuelto ") == "DEVUELTO" and estado_canonico("en gestión") == "EN GESTION" and estado_canonico("ENTREGADO") == "ENTREGADO"
    # Encabezados con otros nombres y fechas como texto.
    alt = xlsx([["X1", "Cliente X", "ASUNCION", "CENTRAL", "CENTRAL", "05/10/2026", "VEND", "Entregado"]],
               cab=["Formulario", "Cliente", "Ciudad", "Depto", "Zona", "Fecha", "Vendedor", "Estado"])
    assert parse_logistica(alt)["filas"][0]["fecha"] == "2026-10-05"
    with pytest.raises(ArchivoInvalido, match="encabezados"):
        parse_logistica(xlsx(cab=["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]))
    with pytest.raises(ArchivoInvalido, match="válido"):
        parse_logistica(b"no es un xlsx")
    with pytest.raises(ArchivoInvalido, match="fecha de venta"):
        parse_logistica(xlsx([["X1", None, None, "C", "A", "D", "R", "sin fecha", "V", "P", "ENTREGADO", None]]))


def test_demora_en_dias_habiles_sin_domingos():
    # Octubre 2026: el 10 es sábado, el 11 domingo, el 14 miércoles.
    assert dias_habiles(date(2026, 10, 10), date(2026, 10, 14)) == 3      # lun, mar y mié: el domingo 11 no cuenta
    assert dias_habiles(date(2026, 10, 10), date(2026, 10, 11)) == 0      # solo pasó un domingo
    assert dias_habiles(date(2026, 10, 5), date(2026, 10, 12)) == 6       # una semana completa menos el domingo
    assert dias_habiles(date(2026, 10, 14), date(2026, 10, 14)) == 0      # vendido el día del corte
    assert dias_habiles(date(2026, 10, 15), date(2026, 10, 14)) == 0      # nunca negativo
    assert dias_habiles(date(2026, 9, 28), date(2026, 10, 14)) == 14      # 16 corridos menos los domingos 4 y 11


def test_analisis_estado_region_motivos_serie_y_pendientes():
    d = analizar(parse_logistica(xlsx())["filas"], date(2026, 10, 10))
    k = d["kpis"]
    assert (k["pedidos"], k["entregados"], k["en_gestion"], k["devueltos"], k["pct_entregados"]) == (8, 4, 3, 1, 50.0)
    assert d["periodo"] == "2026-10" and d["estados"] == ["ENTREGADO", "EN GESTION", "DEVUELTO"] and d["regiones"] == ["CENTRAL", "INTERIOR"]
    central = d["por_region"][0]
    assert central["region"] == "CENTRAL" and central["total"] == 6 and central["estados"] == {"ENTREGADO": 4, "EN GESTION": 1, "DEVUELTO": 1}
    assert central["pct"]["ENTREGADO"] == 66.7
    # Motivos de EN GESTION por región (lo que la tabla dinámica muestra con el filtro de estado).
    m = {x["motivo"]: x["regiones"] for x in d["motivos"]["EN GESTION"]}
    assert m == {"EN GESTION": {"CENTRAL": 1, "INTERIOR": 1}, "INCONTACTABLE LLAMADAS Y WHATSAPP": {"CENTRAL": 0, "INTERIOR": 1}}
    assert d["motivos"]["todos"][0]["motivo"] == "ENTREGADO" and d["motivos"]["todos"][0]["total"] == 4
    # Línea de tiempo: del día y acumulado por estado.
    assert [s["fecha"] for s in d["serie"]] == ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-06", "2026-10-08"]
    assert d["serie"][0]["estados"] == {"ENTREGADO": 2, "EN GESTION": 1, "DEVUELTO": 0}
    assert d["serie"][-1]["acumulado"] == {"ENTREGADO": 4, "EN GESTION": 3, "DEVUELTO": 1} and d["serie"][-1]["acumulado_total"] == 8
    # Pendientes: demora en días hábiles desde la venta hasta el corte (sábado 10/10): el domingo 4/10 no cuenta.
    # F3 (1/10) → 8, F4 (2/10) → 7, F6 (6/10) → 4.
    p = d["pendientes"]
    assert k["metodo_demora"].startswith("días hábiles")
    assert p["n"] == 3 and p["dias_max"] == 8 and p["dias_prom"] == 6.3 and p["tramos"] == {"0-2": 0, "3-5": 1, "6-10": 2, "11+": 0}
    assert [(z["region"], z["n"], z["dias_max"]) for z in p["por_zona"]] == [("CENTRAL", 1, 4), ("INTERIOR", 2, 8)]
    assert p["por_zona"][1]["departamentos"][0]["departamento"] in ("ALTO PARANA", "ITAPUA")
    assert p["lista"][0]["formulario"] == "F3" and p["lista"][0]["dias"] == 8 and p["lista"][0]["dias_corridos"] == 9 and p["vencidos_6"] == 2
    assert d["vendedores"][0]["vendedor"] == "SALINAS, BRANDON" and d["vendedores"][0]["estados"]["EN GESTION"] == 1
    assert d["promociones"][1]["promocion"] == "PLAN CONTROL"
    assert len(d["pedidos"]) == 8 and d["pedidos"][0]["dias"] == 8 and d["pedidos"][0]["dias_corridos"] == 9
    assert any("F6" in a for a in d["avisos"]) and any("sin motivo" in a for a in d["avisos"])


def test_proyeccion_a_fin_de_mes_con_el_ritmo_de_los_dias_en_la_media_o_mas():
    # Octubre 2026: arranque lento (1/10 jue, 2 vie, 3 sáb) y después toma ritmo; sin domingos.
    por_dia = {"2026-10-01": 10, "2026-10-02": 12, "2026-10-03": 8, "2026-10-05": 40, "2026-10-06": 44, "2026-10-07": 36,
               "2026-10-08": 42, "2026-10-09": 38, "2026-10-10": 20, "2026-10-12": 50}
    pedidos = [{"fecha": f, "region": "CENTRAL" if i % 3 else "INTERIOR"} for f, k in por_dia.items() for i in range(k)]
    p = proyectar(pedidos, "2026-10", 90.0)
    assert p["disponible"] and p["acumulado"] == 300 and p["dias_con_ventas"] == 10 and p["dias_laborables"] == [0, 1, 2, 3, 4, 5]
    assert p["media_diaria"] == 30.0 and p["dias_en_ritmo"] == ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12"]
    assert p["ritmo"] == 41.7 and p["dias_restantes"] == 17   # del 13 al 31 sin los domingos 18 y 25
    assert p["proyeccion"] == 300 + round(250 / 6 * 17) and p["intervalo_95"]["bajo"] < p["proyeccion"] < p["intervalo_95"]["alto"]
    assert p["rango"]["conservador"] == 300 + 30 * 17 and p["rango"]["tendencia"] > p["proyeccion"]
    assert p["entregas_esperadas"] == round(p["proyeccion"] * 0.9) and set(p["por_region"]) == {"CENTRAL", "INTERIOR"}
    assert p["serie"][9]["acumulado"] == 300 and p["serie"][-1]["fecha"] == "2026-10-31" and p["serie"][-1]["proyectado"] == p["proyeccion"]
    assert sum(r["proyeccion"] for r in p["por_region"].values()) == pytest.approx(p["proyeccion"], abs=3)
    # Pocos días: no hay proyección, con el motivo. Mes completo: tampoco.
    assert proyectar(pedidos[:12], "2026-10", 90.0)["disponible"] is False
    assert "días con ventas" in proyectar([{"fecha": "2026-10-01", "region": "CENTRAL"}], "2026-10", None)["motivo"]
    cerrado = proyectar([{"fecha": f"2026-09-{d:02d}", "region": "CENTRAL"} for d in (28, 29, 30)], "2026-09", None)
    assert cerrado["disponible"] is False and "completo" in cerrado["motivo"]


# ============================ API ============================
@pytest.mark.asyncio
async def test_api_borrador_publicacion_unica_reemplazo_y_permisos():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        analista = await _new_user(ac, admin, "analista")      # gestión
        auditor = await _new_user(ac, admin, "auditor")        # solo ver
        supervisor = await _new_user(ac, admin, "supervisor")  # nada

        # Subir: solo gestión; el análisis arma el borrador al instante.
        r = await ac.post(f"{BASE}/uploads", headers=auditor, files={"file": ("pedidos.xlsx", xlsx(), "application/octet-stream")})
        assert r.status_code == 403
        r = await ac.post(f"{BASE}/uploads", headers=analista, files={"file": ("pedidos.xlsx", xlsx(), "application/octet-stream")},
                          data={"fecha_corte": "2026-10-10"})
        assert r.status_code == 201, r.text
        inf = r.json()["informe"]
        assert inf["status"] == "draft" and inf["periodo"] == "2026-10" and inf["pedidos"] == 8 and inf["fecha_corte"] == "2026-10-10"
        assert inf["fecha_dato"] == "2026-10-08" and inf["demora_prom"] == 6.3 and r.json()["avisos"]
        assert inf["proyeccion"] and inf["proyeccion"] > 8 and inf["version"] == 3
        assert inf["demora_regiones"] == {"CENTRAL": {"n": 1, "dias_prom": 4.0, "dias_max": 4, "vencidos_6": 0},
                                          "INTERIOR": {"n": 2, "dias_prom": 7.5, "dias_max": 8, "vencidos_6": 2}}
        # Errores claros.
        r = await ac.post(f"{BASE}/uploads", headers=analista, files={"file": ("pedidos.txt", b"x", "text/plain")})
        assert r.status_code == 400
        r = await ac.post(f"{BASE}/uploads", headers=analista, files={"file": ("p.xlsx", xlsx(), "application/octet-stream")}, data={"fecha_corte": "2026-10-05"})
        assert r.status_code == 400 and "posteriores" in r.json()["detail"]
        r = await ac.post(f"{BASE}/uploads", headers=analista, files={"file": ("p.xlsx", xlsx(cab=["A"] * 12), "application/octet-stream")})
        assert r.status_code == 400 and "encabezados" in r.json()["detail"]

        # Quién ve: el auditor no ve borradores; el supervisor nada.
        assert (await ac.get(f"{BASE}/informes", headers=supervisor)).status_code == 403
        assert (await ac.get(f"{BASE}/informes", headers=auditor)).json()["items"] == []
        assert (await ac.get(f"{BASE}/informes/{inf['id']}", headers=auditor)).status_code == 404
        r = await ac.get(f"{BASE}/informes/{inf['id']}", headers=analista)
        assert r.status_code == 200 and r.json()["data"]["kpis"]["pedidos"] == 8 and len(r.json()["data"]["pedidos"]) == 8
        assert r.json()["data"]["proyeccion"]["disponible"] is True and r.json()["data"]["proyeccion"]["proyeccion"] == inf["proyeccion"]

        # Publicar: una por mes; la segunda pide confirmación y reemplaza.
        r = await ac.post(f"{BASE}/informes/{inf['id']}/publicar", headers=analista, json={})
        assert r.status_code == 200 and r.json()["status"] == "published"
        assert (await ac.get(f"{BASE}/informes", headers=auditor)).json()["items"][0]["id"] == inf["id"]
        assert (await ac.get(f"{BASE}/informes/{inf['id']}", headers=auditor)).status_code == 200
        r = await ac.post(f"{BASE}/uploads", headers=admin, files={"file": ("p2.xlsx", xlsx(PEDIDOS[:5]), "application/octet-stream")}, data={"fecha_corte": "2026-10-11"})
        inf2 = r.json()["informe"]
        r = await ac.post(f"{BASE}/informes/{inf2['id']}/publicar", headers=admin, json={})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "replace_required" and r.json()["detail"]["existing"]["id"] == inf["id"]
        r = await ac.post(f"{BASE}/informes/{inf2['id']}/publicar", headers=admin, json={"confirm_replace": True, "title": "Corte del 11"})
        assert r.status_code == 200 and r.json()["title"] == "Corte del 11"
        lista = (await ac.get(f"{BASE}/informes", headers=admin)).json()
        estados = {i["id"]: i["status"] for i in lista["items"]}
        assert estados == {inf["id"]: "replaced", inf2["id"]: "published"} and lista["gestion"] is True
        # Un publicado no se elimina; despublicar sí, y recalcular mantiene los números.
        assert (await ac.delete(f"{BASE}/informes/{inf2['id']}", headers=analista)).status_code == 400
        r = await ac.post(f"{BASE}/informes/{inf2['id']}/recalcular", headers=analista)
        assert r.status_code == 200 and r.json()["pedidos"] == 5 and r.json()["data"]["kpis"]["pedidos"] == 5
        r = await ac.post(f"{BASE}/informes/{inf2['id']}/despublicar", headers=analista)
        assert r.status_code == 200 and r.json()["status"] == "draft"
        assert (await ac.get(f"{BASE}/informes", headers=auditor)).json()["items"] == []
        assert (await ac.delete(f"{BASE}/informes/{inf2['id']}", headers=analista)).status_code == 200
        assert (await ac.get(f"{BASE}/informes/{inf2['id']}", headers=admin)).status_code == 404

        # Dataset para Integraciones: solo lo publicado (volvemos a publicar el primero).
        assert (await ac.post(f"{BASE}/informes/{inf['id']}/publicar", headers=admin, json={"confirm_replace": True})).status_code == 200
        r = await ac.get("/api/v1/televentas-claro/integraciones/datasets/logistica_pedidos?desde=2026-10-01&hasta=2026-10-31", headers=admin)
        assert r.status_code == 200 and r.json()["filas"] == 8
        f = r.json()["items"][0]
        assert f["formulario"] == "F1" and f["estado"] == "ENTREGADO" and f["dias"] == 8 and f["dias_corridos"] == 9 and "motivo_informado" not in f
