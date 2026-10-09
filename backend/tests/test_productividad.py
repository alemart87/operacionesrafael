"""Productividad de llamadas (Televentas CLARO): lectura del reporte de tiempos, análisis del día
(meta de conversación, contacto desde 30 s, modos, turnos y tramos intradía), acumulado de
períodos y circuito de publicación por día (borrador → publicado → reemplazado)."""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import Base, engine
from app.main import app
from app.operativas.televentas_claro.productividad.analyzer import (
    PARAMETROS_DEFECTO, acumular, analizar_dia, banda, validar_parametros,
)
from app.operativas.televentas_claro.productividad.parser import (
    ArchivoInvalido, a_local, clave_agente, corte_de_nombre, es_prueba, nombre_visible, parse_tiempos,
)

BASE = "/api/v1/televentas-claro/productividad"
TC = "televentas_claro"
ZONA = ZoneInfo("America/Asuncion")
P = dict(PARAMETROS_DEFECTO)
H = 3600


def hms(s: int) -> str:
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def fila(nombre, login, conv, llamadas, cortas, acw=0, hold=0, nr=0, sep=",") -> str:
    """Una fila del reporte con los mismos cálculos que hace la plataforma."""
    handle = conv + hold + acw
    ready = max(login - nr - handle, 0)
    aht = handle // llamadas if llamadas else 0
    prom = conv // llamadas if llamadas else 0
    occ = f"{round(handle / login * 100, 2)}%" if login else "0%"
    valores = [hms(login), hms(ready), hms(nr), hms(handle), hms(conv), hms(hold), hms(acw), str(llamadas), str(cortas),
               hms(aht), hms(prom), occ]
    return sep.join([f'"{nombre}"', *valores])


def reporte(filas: list[str], umbral: int = 30, sep: str = ",") -> bytes:
    cab = ["Name", "Login Time", "Ready Time", "Not Ready Time", "Handle Time", "Out Time", "Hold Time", "ACW Time",
           "Out", f"Short Talk < {umbral}s", "AHT", "Avg Out Time", "Agent Occupancy"]
    return "\r\n".join([sep.join(cab), *filas]).encode()


def nombre_archivo(d: date, hh: int, mm: int = 0) -> str:
    """Como lo exporta la plataforma: marca de tiempo Unix en milisegundos."""
    ms = int(datetime(d.year, d.month, d.day, hh, mm, tzinfo=ZONA).timestamp() * 1000) + 981
    return f"Tiempos_Acumulados_{ms}.csv"


def corte(d: date, hh: int, contenido: bytes, mm: int = 0) -> dict:
    return {"id": f"c{hh}{mm}", "hora": datetime(d.year, d.month, d.day, hh, mm, tzinfo=ZONA), "archivo": "x.csv",
            **parse_tiempos(contenido)}


DIA = date(2026, 10, 7)
UN_CORTE = [
    fila("PEREZ, ANA", 6 * H, 9000, 300, 150, acw=3000),   # 41,7% de conversación → meta · automático
    fila("Lopez, Juan", 6 * H, 4320, 100, 80),              # 20%   → rojo · manual
    fila("GOMEZ, LUIS", 6 * H, 7200, 200, 100, acw=1000),   # 33,3% → bajo la meta
    fila("Benitez, Rosa", 6 * H, 12000, 250, 50, acw=500),  # 55,6% → sobre la meta
    fila("SOSA, PEDRO", 18 * H, 600, 10, 5, nr=17 * H),     # quedó logueado: sesión abierta
    fila("Vera, Carla", 2 * H, 0, 0, 0, nr=H),              # conectada sin llamadas
    fila("test_vc, test_vc", 0, 0, 0, 0),                   # cuenta de prueba
    fila("Ruiz, Mario", 0, 0, 0, 0),                        # no se conectó
]


# ============================ parser ============================
def test_parser_lee_el_reporte_y_el_umbral_de_cortas():
    rep = parse_tiempos(reporte(UN_CORTE, umbral=10))
    assert rep["umbrales"] == [10] and len(rep["filas"]) == 8
    ana = rep["filas"][0]
    assert ana == {**ana, "nombre": "PEREZ, ANA", "login": 21600, "conversacion": 9000, "acw": 3000, "handle": 12000,
                   "llamadas": 300, "cortas_por_umbral": {10: 150}, "aht": 40, "ocupacion": 55.56}
    # Excel en español: separador ";", BOM y Windows-1252.
    alt = parse_tiempos("\ufeff".encode() + reporte([fila("Ñandú, José", H, 60, 2, 1, sep=";")], sep=";"))
    assert alt["filas"][0]["nombre"] == "Ñandú, José" and alt["umbrales"] == [30]
    assert parse_tiempos(reporte([fila("Ñandú, José", H, 60, 2, 1)]).decode().encode("cp1252"))["filas"][0]["nombre"] == "Ñandú, José"


def test_parser_valida_el_archivo():
    with pytest.raises(ArchivoInvalido, match="Out Time"):
        parse_tiempos(b"Name,Login Time\r\n\"A, B\",01:00:00")
    with pytest.raises(ArchivoInvalido, match="Fila 2"):
        parse_tiempos(reporte([fila("A, B", H, 60, 2, 1).replace("01:00:00", "1h", 1)]))
    with pytest.raises(ArchivoInvalido, match="más llamadas cortas"):
        parse_tiempos(reporte([fila("A, B", H, 60, 2, 5)]))
    with pytest.raises(ArchivoInvalido, match="vacío"):
        parse_tiempos(b"")
    with pytest.raises(ArchivoInvalido, match="no tiene filas"):
        parse_tiempos(reporte([]))


def test_fecha_y_hora_del_corte_salen_del_nombre_del_archivo():
    local = a_local(corte_de_nombre("Tiempos_Acumulados_1791406800981.csv"))
    assert (local.date(), local.strftime("%H:%M")) == (date(2026, 10, 7), "18:00")
    assert a_local(corte_de_nombre("Tiempos_Acumulados_1791406800981 (1).csv")) == local  # copia descargada dos veces
    assert a_local(corte_de_nombre("reporte_1791406800.csv")) == local                      # segundos
    assert corte_de_nombre("Tiempos_Acumulados.csv") is None
    assert corte_de_nombre("Tiempos_123.csv") is None


def test_nombres_de_agentes():
    assert nombre_visible("QUIÑONEZ, JESSICA BELEN") == "Quiñonez, Jessica Belen"
    assert nombre_visible("Gonzalez de Acosta, Mariela") == "Gonzalez de Acosta, Mariela"
    assert nombre_visible("FRETES,") == "Fretes"
    assert clave_agente("  Quiñonez ,  Jessica  Belen ") == clave_agente("QUIÑONEZ, JESSICA BELEN") == "QUINONEZ, JESSICA BELEN"
    assert es_prueba("test_vc, test_vc") and not es_prueba("Testa, Juan")


# ============================ análisis del día ============================
def test_bandas_de_la_meta_de_conversacion():
    assert [banda(x, P) for x in (24.9, 25, 36.9, 37, 47, 47.1, None)] == ["rojo", "bajo", "bajo", "meta", "meta", "sobre", None]


def test_informe_de_un_corte():
    d = analizar_dia(DIA, [corte(DIA, 18, reporte(UN_CORTE))], P)
    k = d["kpis"]
    assert (k["agentes"], k["agentes_validos"], k["dias_sesion_abierta"], k["dias_sin_llamadas"]) == (6, 5, 1, 1)
    assert (k["llamadas"], k["atendidas"], k["pct_contacto"]) == (860, 475, 55.2)
    # La sesión abierta no entra en el % de conversación ni en la jornada media.
    assert (k["pct_conversacion"], k["banda"], k["jornada_media"]) == (34.7, "bajo", 18720)
    assert k["bandas"] == {"rojo": 2, "bajo": 1, "meta": 1, "sobre": 1}
    assert k["conversacion"] == 9000 + 4320 + 7200 + 12000 + 600 and k["prom_conversacion"] == round(33120 / 860, 1)
    assert (d["modos"]["auto"]["agentes"], d["modos"]["manual"]["agentes"]) == (3, 2)
    assert d["modos"]["auto"]["llamadas"] == 750 and d["modos"]["manual"]["llamadas"] == 110

    por = {a["nombre"]: a for a in d["agentes"]}
    assert set(por) == {"Perez, Ana", "Lopez, Juan", "Gomez, Luis", "Benitez, Rosa", "Sosa, Pedro", "Vera, Carla"}
    assert (por["Perez, Ana"]["banda"], por["Perez, Ana"]["modo"], por["Perez, Ana"]["pct_conversacion"]) == ("meta", "auto", 41.7)
    assert (por["Sosa, Pedro"]["banda"], por["Sosa, Pedro"]["alertas"]) == (None, ["sesion_abierta"])
    assert (por["Vera, Carla"]["banda"], por["Vera, Carla"]["alertas"], por["Vera, Carla"]["modo"]) == ("rojo", ["sin_llamadas"], "sin_llamadas")
    assert [(a["tipo"], a["nombre"]) for a in d["alertas"]] == [("sesion_abierta", "Sosa, Pedro"), ("sin_llamadas", "Vera, Carla")]
    assert d["sin_conexion"] == ["Ruiz, Mario"]
    assert d["contacto"] == {"umbral": 30, "umbrales": [30], "regla": 30, "exacto": True, "mensaje": None}
    assert any("prueba" in a for a in d["avisos"])
    assert d["turnos"]["determinado"] is False and d["tramos"] == [] and d["tramo_mejor"] is None
    assert d["corte_final"] == "18:00"


def test_contacto_con_un_archivo_de_10_segundos_no_es_valido():
    d = analizar_dia(DIA, [corte(DIA, 18, reporte(UN_CORTE, umbral=10))], P)
    c = d["contacto"]
    assert (c["umbral"], c["regla"], c["exacto"]) == (10, 30, False)
    assert "no se puede medir" in c["mensaje"] and "Short Talk < 30s" in c["mensaje"]
    assert d["avisos"][0] == c["mensaje"]
    # En la lista de informes no se muestra un contacto que no cumple la regla.
    from app.operativas.televentas_claro.productividad.analyzer import resumen_lista
    assert resumen_lista(d)["pct_contacto"] is None


def test_varias_columnas_de_cortas_usa_la_de_la_regla():
    cab = ("Name,Login Time,Ready Time,Not Ready Time,Handle Time,Out Time,Hold Time,ACW Time,Out,"
           "Short Talk < 10s,Short Talk < 20s,Short Talk < 30s")
    contenido = f'{cab}\r\n"Perez, Ana",06:00:00,01:00:00,01:00:00,02:00:00,01:30:00,00:00:00,00:30:00,100,40,55,70'.encode()
    rep = parse_tiempos(contenido)
    assert rep["umbrales"] == [10, 20, 30] and rep["filas"][0]["cortas_por_umbral"] == {10: 40, 20: 55, 30: 70}
    d30 = analizar_dia(DIA, [{"id": "c", "hora": datetime(2026, 10, 7, 18, tzinfo=ZONA), "archivo": "x", **rep}], P)
    assert d30["contacto"]["exacto"] and (d30["kpis"]["atendidas"], d30["kpis"]["pct_contacto"]) == (30, 30.0)
    rep = parse_tiempos(contenido)
    d20 = analizar_dia(DIA, [{"id": "c", "hora": datetime(2026, 10, 7, 18, tzinfo=ZONA), "archivo": "x", **rep}],
                       {**P, "contacto_desde_seg": 20})
    assert d20["contacto"]["exacto"] and d20["kpis"]["atendidas"] == 45
    # Regla de 25 s: no hay columna exacta → se usa la de 20 s (techo) y el contacto no es válido.
    rep = parse_tiempos(contenido)
    d25 = analizar_dia(DIA, [{"id": "c", "hora": datetime(2026, 10, 7, 18, tzinfo=ZONA), "archivo": "x", **rep}],
                       {**P, "contacto_desde_seg": 25})
    assert (d25["contacto"]["umbral"], d25["contacto"]["exacto"]) == (20, False)


def _tres_cortes():
    ana_10 = fila("Perez, Ana", 3 * H, 3600, 100, 50, acw=600)
    ana_13 = fila("Perez, Ana", 6 * H, 7200, 200, 90, acw=1200)
    beto_19 = fila("Duarte, Beto", 6 * H, 8000, 240, 140, acw=1500)
    return [
        corte(DIA, 10, reporte([ana_10])),                                       # Beto todavía no está en el reporte
        corte(DIA, 13, reporte([ana_13, fila("Duarte, Beto", 0, 0, 0, 0)])),
        corte(DIA, 19, reporte([ana_13, beto_19])),
    ]


def test_tramos_intradia_y_turnos_con_varios_cortes():
    d = analizar_dia(DIA, _tres_cortes(), P)
    t = [(x["desde"], x["hasta"], x["minutos"], x["llamadas"], x["atendidas"], x["pct_contacto"]) for x in d["tramos"]]
    assert t == [("00:00", "10:00", 600, 100, 50, 50.0), ("10:00", "13:00", 180, 100, 60, 60.0),
                 ("13:00", "19:00", 360, 240, 100, 41.7)]
    assert d["tramos"][1]["agentes_activos"] == 1 and d["tramos"][1]["pct_conversacion"] == round(3600 / (3 * H) * 100, 1)
    assert (d["tramo_mejor"]["desde"], d["tramo_peor"]["desde"]) == ("10:00", "13:00")
    # Turno según el corte de las 13:00: Ana ya había hecho su jornada; Beto la hizo después.
    assert d["turnos"]["determinado"] and d["turnos"]["corte"] == "13:00"
    por = {a["nombre"]: a for a in d["agentes"]}
    assert (por["Perez, Ana"]["turno"], por["Duarte, Beto"]["turno"]) == ("manana", "tarde")
    assert d["turnos"]["manana"]["agentes"] == 1 and d["turnos"]["tarde"]["jornada_media"] == 6 * H
    assert por["Perez, Ana"]["tramos"] == [[100, 50, 3600, 3 * H], [100, 60, 3600, 3 * H], [0, 0, 0, 0]]
    # Totales del día = último corte.
    assert (d["kpis"]["llamadas"], d["kpis"]["atendidas"]) == (440, 210)


def test_un_corte_que_baja_respecto_del_anterior_se_avisa():
    cortes = _tres_cortes() + [corte(DIA, 19, reporte([fila("Perez, Ana", 2 * H, 100, 10, 5)]), mm=30)]
    d = analizar_dia(DIA, cortes, P)
    assert any("19:30" in a and "menores" in a for a in d["avisos"])
    assert d["tramos"][-1]["llamadas"] == 0  # el tramo con valores que bajan se toma en cero


def test_parametros_validados():
    assert validar_parametros({"meta_min": "35", "cambio_turno": "9:30"})["cambio_turno"] == "09:30"
    for malo in ({"meta_min": 50}, {"rojo": 40}, {"sesion_abierta_horas": 3}, {"cambio_turno": "20:00"},
                 {"contacto_desde_seg": 2}, {"meta_max": "x"}):
        with pytest.raises(ValueError):
            validar_parametros(malo)


# ============================ acumulado ============================
def test_acumulado_suma_dias_y_recalcula():
    d1 = analizar_dia(DIA, [corte(DIA, 18, reporte(UN_CORTE))], P)
    otro = date(2026, 10, 8)
    d2 = analizar_dia(otro, _tres_cortes_de(otro), P)
    d3 = analizar_dia(date(2026, 10, 9), _tres_cortes_de(date(2026, 10, 9)), P)
    a = acumular([d2, d1, d3], P)
    k = a["kpis"]
    assert [x["fecha"] for x in a["dias"]] == ["2026-10-07", "2026-10-08", "2026-10-09"]
    assert k["dias_publicados"] == 3 and k["llamadas"] == 860 + 440 + 440 and k["atendidas"] == 475 + 210 + 210
    assert k["agentes"] == 7 and k["agentes_por_dia"] == round((6 + 2 + 2) / 3, 1)
    ana = next(x for x in a["agentes"] if x["nombre"] == "Perez, Ana")
    assert (ana["dias"], ana["llamadas"], ana["turno"]) == (3, 300 + 200 + 200, "manana")
    assert ana["pct_conversacion"] == round((9000 + 7200 * 2) / (6 * H * 3) * 100, 1)
    assert ana["dias_banda"]["meta"] == 1
    pedro = next(x for x in a["agentes"] if x["nombre"] == "Sosa, Pedro")
    assert (pedro["dias_sesion_abierta"], pedro["alertas"], pedro["banda"]) == (1, ["sesion_abierta"], None)
    # Tramos iguales de distintos días se suman.
    t = {(x["desde"], x["hasta"]): x for x in a["tramos"]}
    assert t[("10:00", "13:00")]["dias"] == 2 and t[("10:00", "13:00")]["llamadas"] == 200
    assert a["turnos"]["determinado"] and a["turnos"]["dias"] == 2
    assert a["contacto"]["exacto"] is True


def _tres_cortes_de(d: date):
    return [{**c, "hora": c["hora"].replace(year=d.year, month=d.month, day=d.day)} for c in _tres_cortes()]


# ============================ API: circuito de publicación ============================
async def _login(ac, email, pwd):
    r = await ac.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _new_user(ac, admin, role):
    email = f"{role}-{uuid.uuid4().hex[:6]}@voicenter.com.py"
    r = await ac.post("/api/v1/users", headers=admin, json={
        "email": email, "password": "Clave1234!", "full_name": f"Usuario {role}", "role": role, "operativas": [TC]})
    assert r.status_code == 201, r.text
    return await _login(ac, email, "Clave1234!")


def setup_module(module):
    from app.main import _seed_profiles  # sin lifespan (AsyncClient) hay que sembrar los perfiles a mano

    async def _prep():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await _seed_profiles()
    asyncio.run(_prep())


async def _subir(ac, h, nombre, contenido, **form):
    return await ac.post(f"{BASE}/cortes", headers=h, files={"file": (nombre, contenido, "text/csv")}, data=form)


@pytest.mark.asyncio
async def test_flujo_de_cortes_y_publicacion():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        analista = await _new_user(ac, admin, "analista")      # gestión (perfil sembrado)
        lector = await _new_user(ac, admin, "coordinador")  # solo ve lo publicado (el supervisor solo entra a su portal)

        dia18 = reporte(UN_CORTE)
        # Permisos y validaciones de la carga.
        assert (await _subir(ac, lector, nombre_archivo(DIA, 18), dia18)).status_code == 403
        assert (await _subir(ac, analista, "tiempos.xlsx", dia18)).status_code == 400
        r = await _subir(ac, analista, "Tiempos_Acumulados.csv", dia18)
        assert r.status_code == 400 and r.json()["detail"]["code"] == "sin_fecha"
        r = await _subir(ac, analista, nombre_archivo(date(2031, 1, 1), 10), dia18)
        assert r.status_code == 400 and "futura" in r.json()["detail"]
        assert (await _subir(ac, analista, nombre_archivo(DIA, 18), b"Name,Out\r\n")).status_code == 400

        # Primer corte del día (las 18:00): borrador solo para gestión.
        r = await _subir(ac, analista, nombre_archivo(DIA, 18), dia18)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["corte"]["fecha"] == "2026-10-07" and body["corte"]["hora"] == "18:00" and body["corte"]["umbrales_cortas"] == [30]
        i1 = body["informe"]["id"]
        assert body["informe"]["status"] == "draft" and body["informe"]["llamadas"] == 860 and body["informe"]["banda"] == "bajo"
        assert (await ac.get(f"{BASE}/informes", headers=lector)).json()["items"] == []
        assert (await ac.get(f"{BASE}/informes/{i1}", headers=lector)).status_code == 404
        det = (await ac.get(f"{BASE}/informes/{i1}", headers=analista)).json()
        assert det["data"]["kpis"]["agentes"] == 6 and len(det["cortes_del_dia"]) == 1 and det["cortes_nuevos"] == 0

        # Corte sin marca de tiempo en el nombre: con fecha y hora indicadas a mano.
        otro = date(2026, 10, 6)
        r = await _subir(ac, analista, "tiempos_lunes.csv", dia18, fecha_hora="2026-10-06T19:30")
        assert r.status_code == 201 and r.json()["corte"]["hora_origen"] == "manual" and r.json()["corte"]["fecha"] == "2026-10-06"

        # Publicar.
        r = await ac.post(f"{BASE}/informes/{i1}/publicar", headers=analista, json={})
        assert r.status_code == 200 and r.json()["status"] == "published"
        assert [x["id"] for x in (await ac.get(f"{BASE}/informes", headers=lector)).json()["items"]] == [i1]
        assert (await ac.get(f"{BASE}/informes/{i1}", headers=lector)).json()["data"]["kpis"]["llamadas"] == 860

        # Un corte de mitad de día: nuevo borrador del día con dos cortes (no toca el publicado).
        r = await _subir(ac, analista, nombre_archivo(DIA, 13), reporte([fila("PEREZ, ANA", 3 * H, 4000, 150, 70, acw=1500)]))
        i2 = r.json()["informe"]["id"]
        assert i2 != i1 and r.json()["informe"]["cortes"] == 2
        det = (await ac.get(f"{BASE}/informes/{i2}", headers=analista)).json()
        assert [t["hasta"] for t in det["data"]["tramos"]] == ["13:00", "18:00"] and det["data"]["turnos"]["determinado"]
        assert (await ac.get(f"{BASE}/informes/{i1}", headers=analista)).json()["cortes_nuevos"] == 1

        # Subir otra vez el mismo archivo reemplaza el corte (no duplica).
        r = await _subir(ac, analista, nombre_archivo(DIA, 13), reporte([fila("PEREZ, ANA", 3 * H, 4100, 151, 70, acw=1500)]))
        assert r.json()["reemplazo"] is True and r.json()["informe"]["id"] == i2 and r.json()["informe"]["cortes"] == 2

        # Publicar el nuevo exige confirmar el reemplazo.
        r = await ac.post(f"{BASE}/informes/{i2}/publicar", headers=analista, json={})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "replace_required"
        assert r.json()["detail"]["existing"]["id"] == i1 and r.json()["detail"]["existing"]["published_by"] == "Usuario analista"
        r = await ac.post(f"{BASE}/informes/{i2}/publicar", headers=analista, json={"confirm_replace": True})
        assert r.status_code == 200 and r.json()["status"] == "published"
        items = {x["id"]: x for x in (await ac.get(f"{BASE}/informes", headers=analista)).json()["items"]}
        assert items[i1]["status"] == "replaced" and items[i1]["replaced_by_report_id"] == i2

        # Acumulado: solo lo publicado; gestión ve qué días tienen borrador sin publicar.
        acu = (await ac.get(f"{BASE}/acumulado", headers=lector, params={"desde": "2026-10-05", "hasta": "2026-10-11"})).json()
        assert acu["acumulado"]["kpis"]["dias_publicados"] == 1 and acu["acumulado"]["dias"][0]["informe_id"] == i2
        assert acu["pendientes_publicar"] == [] and acu["ultimo_publicado"] == "2026-10-07"
        acu = (await ac.get(f"{BASE}/acumulado", headers=analista, params={"desde": "2026-10-05", "hasta": "2026-10-11"})).json()
        assert acu["pendientes_publicar"] == ["2026-10-06"]
        assert (await ac.get(f"{BASE}/acumulado", headers=analista, params={"desde": "2026-10-11", "hasta": "2026-10-05"})).status_code == 400
        assert (await ac.get(f"{BASE}/acumulado", headers=analista, params={"desde": "2026-01-01", "hasta": "2026-12-31"})).status_code == 400

        # Parámetros: todos los ven; solo el superadmin los cambia.
        par = (await ac.get(f"{BASE}/parametros", headers=lector)).json()
        assert par["parametros"]["meta_min"] == 37 and par["parametros"]["contacto_desde_seg"] == 30 and par["puede_editar"] is False
        assert (await ac.put(f"{BASE}/parametros", headers=analista, json={"parametros": {"meta_min": 35}})).status_code == 403
        assert (await ac.put(f"{BASE}/parametros", headers=admin, json={"parametros": {"meta_min": 50}})).status_code == 400
        r = await ac.put(f"{BASE}/parametros", headers=admin, json={"parametros": {**par["parametros"], "meta_min": 33}})
        assert r.status_code == 200 and r.json()["parametros"]["meta_min"] == 33
        assert (await ac.get(f"{BASE}/informes/{i2}", headers=analista)).json()["parametros_distintos"] is True

        # Recalcular un publicado no lo toca: genera el borrador del día con los parámetros vigentes.
        assert (await ac.post(f"{BASE}/informes/{i2}/recalcular", headers=lector)).status_code == 403
        r = (await ac.post(f"{BASE}/informes/{i2}/recalcular", headers=analista)).json()
        i3 = r["informe"]["id"]
        assert r["nuevo_borrador"] is True and r["informe"]["status"] == "draft"
        assert (await ac.get(f"{BASE}/informes/{i3}", headers=analista)).json()["data"]["parametros"]["meta_min"] == 33
        assert (await ac.get(f"{BASE}/informes/{i2}", headers=analista)).json()["data"]["parametros"]["meta_min"] == 37

        # Eliminar el corte de las 13:00 rehace el borrador del día con el corte que queda.
        cortes = (await ac.get(f"{BASE}/cortes", headers=analista, params={"fecha": "2026-10-07"})).json()["items"]
        assert [c["hora"] for c in cortes] == ["13:00", "18:00"]
        assert (await ac.get(f"{BASE}/cortes", headers=lector, params={"fecha": "2026-10-07"})).status_code == 403
        r = (await ac.delete(f"{BASE}/cortes/{cortes[0]['id']}", headers=analista)).json()
        assert r["informe"]["id"] == i3 and r["informe"]["cortes"] == 1

        # No se elimina un publicado; despublicar lo vuelve borrador.
        assert (await ac.delete(f"{BASE}/informes/{i2}", headers=analista)).status_code == 400
        assert (await ac.post(f"{BASE}/informes/{i2}/despublicar", headers=analista)).json()["status"] == "draft"
        assert (await ac.get(f"{BASE}/informes", headers=lector)).json()["items"] == []
        assert (await ac.delete(f"{BASE}/informes/{i2}", headers=lector)).status_code == 403
        assert (await ac.delete(f"{BASE}/informes/{i2}", headers=analista)).status_code == 200
        assert (await ac.get(f"{BASE}/informes/{i2}", headers=analista)).status_code == 404
