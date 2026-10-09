"""SPH estimado (Televentas CLARO): cruce de agentes con vendedores por nombre, cálculo del SPH de la operación
y por asesor con las ventas del día de la hoja de productividad (no las netas), y circuito de publicación por
período (borrador → publicado → reemplazado)."""
from __future__ import annotations

import asyncio
import uuid
from datetime import date

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import AsyncSessionLocal, Base, engine
from app.main import app
from app.operativas.televentas_claro.productividad.analyzer import PARAMETROS_DEFECTO, analizar_dia
from app.operativas.televentas_claro.productividad.models import ProdInforme
from app.operativas.televentas_claro.sph.models import SphInforme
from app.operativas.televentas_claro.sph.analyzer import (
    DatosIncompletos, calcular, calcular_periodo, cruzar, evaluar, partes_agente, tipo_periodo, tokens,
)
from app.operativas.televentas_claro.ventas_netas.models import VentasNetasReport
from tests.test_productividad import corte, fila, reporte

BASE = "/api/v1/televentas-claro/sph"
TC = "televentas_claro"
H = 3600
DIA = date(2026, 9, 15)

AGENTES = [
    fila("PEREZ, ANA", 6 * H, 8000, 200, 120, acw=900),
    fila("LOPEZ GIMENEZ, NANCY", 5 * H, 6000, 150, 90, acw=800),
    fila("Riveros, Roberto Carlos", 8 * H, 9000, 260, 150, acw=1000),
    fila("Riveros, Carlos", 4 * H, 4000, 120, 70, acw=500),
    fila("SOSA, PEDRO", 18 * H, 600, 10, 5, nr=17 * H),   # sesión abierta
    fila("Vera, Carla", 1 * H, 900, 30, 15, acw=100),     # menos de 2 h: fuera del ranking
    fila("Benitez, Rosa", 6 * H, 7000, 210, 120, acw=900),  # no figura como vendedora
]


def neta(vendedor, fecha_venta, producto="Pospago", fecha_carga=None, subcanal="TKM"):
    return {"sds_number": uuid.uuid4().hex[:10], "vendedor": vendedor, "subcanal": subcanal, "producto": producto,
            "fecha_venta": fecha_venta, "fecha_carga": fecha_venta if fecha_carga is None else fecha_carga,
            "fecha_activacion": "2026-09-16"}


def carga(vendedor, fecha="2026-09-15", estado="Vta_Finalizada", atribucion="pos", producto="Pospago", cancelada=False,
          sds=None):
    """Una venta de la hoja de productividad (CARGAS), como la deja Ventas Netas en `detalle_cargas`."""
    return {"sds_number": sds or uuid.uuid4().hex[:10], "fecha_alta": fecha, "estado": estado, "cancelada": cancelada,
            "vendedor": vendedor, "subcanal": None if atribucion == "sin_atribuir" else "TKM", "atribucion": atribucion,
            "producto": producto}


D = "2026-09-15"
VENTAS = {
    # Las netas (líneas activadas) no cuentan para el SPH: con estas, el resultado sería otro.
    "detalle_netas": [neta("ANA MARIA PEREZ GOMEZ", D), neta("DOLLY GONZALEZ", D), neta("ZULMA NUNEZ", D)],
    "productividad": {"detalle_cargas": [
        carga("ANA MARIA PEREZ GOMEZ"), carga("ANA MARIA PEREZ GOMEZ"), carga("ANA MARIA PEREZ GOMEZ", producto="Internet"),
        carga("ANA MARIA PEREZ GOMEZ", estado="Vta_Rechazada"),                  # rechazada: no cuenta
        carga("ANA MARIA PEREZ GOMEZ", fecha="2026-09-14"),                        # otro día
        carga("NANCY GIMENEZ", estado="Vta_A_Confirmar", atribucion="legajo"),     # pendiente: cuenta (vendedor por legajo)
        carga("ROBERTO CARLOS RIVEROS MORA"),
        carga("ROBERTO CARLOS RIVEROS MORA", estado="Vta_A_Confirmar", atribucion="linea"),  # vendedor por su línea activada
        carga("ROBERTO CARLOS RIVEROS MORA", cancelada=True),                      # cancelada administrativamente: no cuenta
        carga("CARLOS RAMON VENIALGO RIVEROS", fecha="2026-09-10"),
        carga("PEDRO SOSA"),                                                       # de un agente con sesión abierta
        carga("CARLA VERA"),
        carga("DOLLY GONZALEZ"), carga("DOLLY GONZALEZ", estado="Vta_Procesado", atribucion="legajo"),  # sin agente conectado
        carga("CARGADO POR EXP1 JUAN", estado="Vta_A_Confirmar", atribucion="sin_atribuir"),  # no se sabe quién vendió
    ]},
}
FUENTES = {"productividad": {"id": "p1", "status": "published"},
           "ventas": {"id": "v1", "status": "published", "fecha_dato": "2026-09-18"}}


def productividad() -> dict:
    return analizar_dia(DIA, [corte(DIA, 18, reporte(AGENTES))], dict(PARAMETROS_DEFECTO))


# ============================ cruce por nombre ============================
def test_palabras_del_nombre():
    assert tokens("Quiñonez de la Cruz, María José") == ["QUINONEZ", "CRUZ", "MARIA", "JOSE"]
    assert partes_agente("LOPEZ GIMENEZ, NANCY") == (["LOPEZ", "GIMENEZ"], ["NANCY"])
    assert partes_agente("FRETES,") == (["FRETES"], [])


def test_evaluar_un_agente_contra_un_vendedor():
    ev = lambda agente, vendedor: evaluar(*partes_agente(agente), tokens(vendedor))  # noqa: E731
    assert ev("PEREZ, ANA", "ANA MARIA PEREZ GOMEZ")[0] == "exacto"
    assert ev("Rotela, Mirian", "ROTELA ROMAN MIRIAN ELIZABETH")[0] == "exacto"      # orden distinto
    assert ev("QUIÑONEZ, JESSICA", "JESSICA QUINONES ROJAS")[0] == "probable"        # escritura
    assert ev("LOPEZ GIMENEZ, NANCY", "NANCY GIMENEZ")[0] == "probable"              # solo el segundo apellido
    assert ev("Riveros, Carlos", "CARLOS RAMON VENIALGO RIVEROS")[0] == "probable"   # ¿segundo apellido?
    assert ev("PEREZ, ANA", "ANALIA PEREZ") is None                                   # nombre distinto
    assert ev("PEREZ, ANA", "ANA GOMEZ") is None                                      # apellido distinto
    assert ev("FRETES,", "JUAN FRETES") is None                                       # sin nombre


def test_cruce_uno_a_uno_empates_y_vinculos_manuales():
    agentes = [{"clave": k} for k in ("RIVEROS, ROBERTO CARLOS", "RIVEROS, CARLOS", "GONZALEZ, MARIA", "FRETES,",
                                      "BENITEZ, ROSA", "PEREZ, ANA")]
    roster = ["ROBERTO CARLOS RIVEROS MORA", "CARLOS RAMON VENIALGO RIVEROS", "MARIA GONZALEZ LOPEZ",
              "MARIA GONZALEZ BENITEZ", "ROSA BENITEZ", "ANA PEREZ", "SIN VENDEDOR"]
    c = cruzar(agentes, roster)
    # El que trae los dos nombres se queda con su vendedor; el otro Riveros, con el que queda.
    assert c["RIVEROS, ROBERTO CARLOS"] == {"vendedor": "ROBERTO CARLOS RIVEROS MORA", "nivel": "exacto", "candidatos": []}
    assert c["RIVEROS, CARLOS"]["vendedor"] == "CARLOS RAMON VENIALGO RIVEROS"
    # Dos vendedores igual de parecidos: no se adivina.
    assert c["GONZALEZ, MARIA"]["nivel"] == "ambiguo"
    assert c["GONZALEZ, MARIA"]["candidatos"] == ["MARIA GONZALEZ BENITEZ", "MARIA GONZALEZ LOPEZ"]
    assert c["FRETES,"]["nivel"] == "incompleto"
    assert c["BENITEZ, ROSA"]["nivel"] == "exacto"

    # Los vínculos manuales mandan: el vendedor elegido sale del cruce automático.
    c = cruzar(agentes, roster, {"GONZALEZ, MARIA": "MARIA GONZALEZ LOPEZ", "BENITEZ, ROSA": None,
                                 "PEREZ, ANA": "ROSA BENITEZ"})
    assert c["GONZALEZ, MARIA"] == {"vendedor": "MARIA GONZALEZ LOPEZ", "nivel": "manual", "candidatos": []}
    assert c["BENITEZ, ROSA"]["nivel"] == "descartado" and c["BENITEZ, ROSA"]["vendedor"] is None
    assert c["PEREZ, ANA"]["vendedor"] == "ROSA BENITEZ"


# ============================ cálculo ============================
def test_sph_de_la_operacion_y_por_asesor_con_las_ventas_del_dia():
    r = calcular(DIA, productividad(), VENTAS, FUENTES)
    k = r["kpis"]
    # Ventas del día (hoja de productividad): 3 Pérez + 1 Nancy + 2 Riveros + 1 Sosa + 1 Vera + 2 Dolly + 1 sin vendedor.
    # Sin la rechazada ni la cancelada; las pendientes (a confirmar, procesado) cuentan.
    assert k["ventas"] == 11 and k["productos"] == {"Pospago": 10, "Internet": 1}
    assert k["estados"] == {"Vta_Finalizada": 7, "Vta_A_Confirmar": 3, "Vta_Procesado": 1, "Vta_Rechazada": 1,
                            "Vta_Cancelada_Adm": 1}
    assert (k["finalizadas"], k["pendientes"], k["no_cuentan"], k["pct_finalizadas"]) == (7, 4, 2, 63.6)
    # La sesión abierta queda fuera: sus horas y su venta.
    assert k["sesiones_abiertas"] == 1 and k["ventas_sesion_abierta"] == 1 and k["ventas_operacion"] == 10
    assert k["horas"] == 30 * H and k["sph"] == 0.33
    # Asesores vinculados con jornada válida: 24 h y 7 ventas.
    assert k["horas_vinculadas"] == 24 * H and k["ventas_vinculadas"] == 7 and k["sph_vinculados"] == 0.29
    assert k["ventas_sin_agente"] == 2 and k["ventas_sin_vendedor"] == 1 and k["pct_cobertura"] == 70.0
    assert k["niveles"] == {"exacto": 4, "probable": 2, "sin_cruce": 1} and k["vinculados"] == 6

    a = {f["clave"]: f for f in r["agentes"]}
    assert a["PEREZ, ANA"]["sph"] == 0.5 and a["PEREZ, ANA"]["productos"] == {"Pospago": 2, "Internet": 1}
    assert a["PEREZ, ANA"]["estados"] == {"Vta_Finalizada": 3, "Vta_Rechazada": 1}
    assert a["LOPEZ GIMENEZ, NANCY"]["nivel"] == "probable" and a["LOPEZ GIMENEZ, NANCY"]["sph"] == 0.2
    assert a["RIVEROS, ROBERTO CARLOS"]["ventas"] == 2 and a["RIVEROS, ROBERTO CARLOS"]["sph"] == 0.25
    assert a["RIVEROS, ROBERTO CARLOS"]["estados"] == {"Vta_Finalizada": 1, "Vta_A_Confirmar": 1, "Vta_Cancelada_Adm": 1}
    assert a["RIVEROS, CARLOS"]["ventas"] == 0 and a["RIVEROS, CARLOS"]["sph"] == 0.0
    assert a["SOSA, PEDRO"]["sesion_abierta"] and a["SOSA, PEDRO"]["sph"] is None and a["SOSA, PEDRO"]["ventas"] == 0
    assert a["SOSA, PEDRO"]["ventas_sesion_abierta"] == 1 and a["SOSA, PEDRO"]["login"] == 0 and a["SOSA, PEDRO"]["login_abierta"] == 18 * H
    assert a["VERA, CARLA"]["sph"] == 1.0 and a["VERA, CARLA"]["en_ranking"] is False
    assert a["BENITEZ, ROSA"]["nivel"] == "sin_cruce" and a["BENITEZ, ROSA"]["ventas"] is None
    assert [f["clave"] for f in r["agentes"] if f["en_ranking"]] == [
        "PEREZ, ANA", "RIVEROS, ROBERTO CARLOS", "LOPEZ GIMENEZ, NANCY", "RIVEROS, CARLOS"]

    assert r["ventas_sin_agente"] == [{"vendedor": "DOLLY GONZALEZ", "subcanal": "TKM", "ventas": 2,
                                       "estados": {"Vta_Finalizada": 1, "Vta_Procesado": 1}}]
    assert r["sin_vendedor"] == [{"cargado_por": "EXP1 JUAN", "ventas": 1}]
    vendedores = {v["vendedor"]: v for v in r["vendedores"]}
    assert set(vendedores) >= {"DOLLY GONZALEZ", "CARLOS RAMON VENIALGO RIVEROS"} and vendedores["ANA MARIA PEREZ GOMEZ"]["ventas_mes"] == 4
    # Ni el «sin vendedor» ni quien cargó sin POS son vendedores; las netas tampoco suman vendedores.
    assert not {"SIN VENDEDOR", "CARGADO POR EXP1 JUAN", "ZULMA NUNEZ"} & set(vendedores)
    assert r["version"] == 4 and r["base"] == "ventas" and r["serie"][0]["estados"] == k["estados"]
    assert any("1 venta(s) del día se cargaron sin POS" in x for x in r["avisos"])
    assert not any("mismo día" in x or "activ" in x and "netas" in x for x in r["avisos"])


def test_periodo_suma_dia_por_dia_y_avisa_los_dias_que_no_cuentan():
    lunes = date(2026, 9, 14)
    otro = analizar_dia(lunes, [corte(lunes, 18, reporte([fila("PEREZ, ANA", 6 * H, 8000, 200, 120, acw=900)]))],
                        dict(PARAMETROS_DEFECTO))
    produccion = {lunes: otro, DIA: productividad(), date(2026, 9, 16): productividad()}
    fuentes = {"productividad": [], "ventas": [{"id": "v1", "status": "published", "periodo": "2026-09", "fecha_dato": D}]}
    r = calcular_periodo(lunes, date(2026, 9, 17), produccion, {"2026-09": VENTAS}, fuentes, hasta_datos=date(2026, 9, 17))
    k = r["kpis"]
    assert r["tipo"] == "rango" and k["dias"] == 4 and k["dias_cubiertos"] == 2
    assert [c["fecha"] for c in r["cobertura"] if c["horas"] and c["ventas"]] == ["2026-09-14", D]
    assert [x["fecha"] for x in r["serie"]] == ["2026-09-14", D] and r["serie"][0]["ventas"] == 1
    # El lunes suma 6 h y 1 venta de Pérez: 12 ventas (11 sin la sesión abierta) en 36 h.
    assert k["ventas"] == 12 and k["ventas_operacion"] == 11 and k["horas"] == 36 * H and k["sph"] == 0.31
    a = {f["clave"]: f for f in r["agentes"]}
    assert a["PEREZ, ANA"]["dias"] == 2 and a["PEREZ, ANA"]["login"] == 12 * H and a["PEREZ, ANA"]["ventas"] == 4
    assert a["PEREZ, ANA"]["sph"] == 0.33 and a["PEREZ, ANA"]["en_ranking"]
    assert not a["LOPEZ GIMENEZ, NANCY"]["en_ranking"]  # en un período el ranking pide una jornada (6 h)
    assert any("Sin informe de Productividad" in x and "17/09" in x for x in r["avisos"])
    assert any("sin ventas al corte" in x and "16/09" in x for x in r["avisos"])
    with pytest.raises(DatosIncompletos):  # ningún día con horas y ventas
        calcular_periodo(date(2026, 9, 16), date(2026, 9, 17), produccion, {"2026-09": VENTAS}, fuentes)


def test_tipos_de_periodo():
    assert tipo_periodo(DIA, DIA) == "dia"
    assert tipo_periodo(date(2026, 9, 14), date(2026, 9, 20)) == "semana"   # lunes a domingo
    assert tipo_periodo(date(2026, 9, 1), date(2026, 9, 30)) == "mes"
    assert tipo_periodo(date(2026, 2, 1), date(2026, 2, 28)) == "mes"
    assert tipo_periodo(date(2026, 9, 15), date(2026, 9, 21)) == "rango"


def test_sin_la_hoja_de_productividad_no_se_calcula():
    viejo = {"detalle_netas": [neta("ANA MARIA PEREZ GOMEZ", D)]}  # informe de ventas anterior: solo netas
    with pytest.raises(DatosIncompletos, match="hoja de productividad"):
        calcular(DIA, productividad(), viejo, FUENTES)
    with pytest.raises(DatosIncompletos):
        calcular(DIA, {"agentes": []}, VENTAS, FUENTES)
    # Un mes sin ventas cargadas todavía sí se calcula (SPH 0).
    r = calcular(DIA, productividad(), {"productividad": {"detalle_cargas": []}}, FUENTES)
    assert r["kpis"]["ventas"] == 0 and r["kpis"]["sph"] == 0.0


def test_planilla_subida_el_mismo_dia_y_estados_que_no_se_conocen():
    ventas = {"productividad": {"detalle_cargas": [carga("ANA MARIA PEREZ GOMEZ"), carga("ANA MARIA PEREZ GOMEZ", estado="Vta_En_Revision")]}}
    f = {"productividad": [], "ventas": [{"id": "v", "status": "published", "periodo": "2026-09", "fecha_dato": D,
                                          "generated_at": "2026-09-15T19:00:00+00:00"}]}  # subida el 15 por la tarde
    r = calcular_periodo(DIA, DIA, {DIA: productividad()}, {"2026-09": ventas}, f)
    assert r["kpis"]["ventas"] == 2 and r["kpis"]["estados"] == {"Vta_Finalizada": 1, "Vta_En_Revision": 1}
    assert any("se subió el mismo día (15/09 a las" in x for x in r["avisos"])
    assert any("Vta_En_Revision: 1" in x for x in r["avisos"])
    # Subida el 16 (con el día cerrado): sin aviso.
    f["ventas"][0]["generated_at"] = "2026-09-16T11:00:00+00:00"
    r = calcular_periodo(DIA, DIA, {DIA: productividad()}, {"2026-09": ventas}, f)
    assert not any("mismo día" in x for x in r["avisos"])


# ============================ API: circuito ============================
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


async def _guardar(obj):
    async with AsyncSessionLocal() as db:
        db.add(obj)
        await db.commit()
        return obj.id


async def _corte_ventas(report_id: str, corte_ventas: date):
    async with AsyncSessionLocal() as db:
        r = await db.get(VentasNetasReport, report_id)
        r.fecha_dato = corte_ventas
        await db.commit()


@pytest.mark.asyncio
async def test_flujo_calcular_vincular_y_publicar():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        analista = await _new_user(ac, admin, "analista")      # gestión (perfil sembrado)
        lector = await _new_user(ac, admin, "coordinador")  # solo ve lo publicado (el supervisor solo entra a su portal)
        cuerpo = {"fecha": DIA.isoformat()}

        # Sin fuentes no se calcula: primero falta Productividad, después Ventas Netas.
        assert (await ac.post(f"{BASE}/calcular", headers=lector, json=cuerpo)).status_code == 403
        r = await ac.post(f"{BASE}/calcular", headers=analista, json=cuerpo)
        assert r.status_code == 409 and "Productividad" in r.json()["detail"]["message"]
        await _guardar(ProdInforme(fecha=DIA, status="published", data=productividad()))
        r = await ac.post(f"{BASE}/calcular", headers=analista, json=cuerpo)
        assert r.status_code == 409 and "Ventas Netas" in r.json()["detail"]["message"]
        vid = await _guardar(VentasNetasReport(upload_id="u1", periodo="2026-09", period_month=date(2026, 9, 1),
                                               fecha_dato=date(2026, 9, 14), status="published", data=VENTAS))
        r = await ac.post(f"{BASE}/calcular", headers=analista, json=cuerpo)
        assert r.status_code == 409 and "todavía no trae" in r.json()["detail"]["message"]
        await _corte_ventas(vid, date(2026, 9, 18))

        f = (await ac.get(f"{BASE}/fuentes", headers=analista, params=cuerpo)).json()
        assert f["puede_calcular"] and f["ventas"][0]["fecha_dato"] == "2026-09-18" and f["sph"] == {}
        assert f["ventas"][0]["ventas"] == 13  # las del mes que cuentan (sin la rechazada ni la cancelada)
        assert f["tipo"] == "dia" and f["dias_cubiertos"] == 1 and f["cobertura"] == [{"fecha": D, "productividad": "published", "horas": True, "ventas": True}]
        assert (await ac.get(f"{BASE}/fuentes", headers=lector, params=cuerpo)).status_code == 403
        dias = (await ac.get(f"{BASE}/dias", headers=analista)).json()
        assert dias["dias"][0]["fecha"] == D and dias["dias"][0]["cubre"] and dias["sugerida"] == D

        # Calcular: borrador del día, solo para gestión.
        r = await ac.post(f"{BASE}/calcular", headers=analista, json=cuerpo)
        assert r.status_code == 201, r.text
        i1 = r.json()["informe"]["id"]
        assert r.json()["informe"]["status"] == "draft" and r.json()["informe"]["sph"] == 0.33
        assert (r.json()["informe"]["ventas"], r.json()["informe"]["base"], r.json()["informe"]["version"]) == (11, "ventas", 4)
        assert r.json()["informe"]["horas"] == 30 and r.json()["informe"]["ventas_corte"] == "2026-09-18"
        assert (await ac.get(f"{BASE}/informes", headers=lector)).json()["items"] == []
        assert (await ac.get(f"{BASE}/informes/{i1}", headers=lector)).status_code == 404
        det = (await ac.get(f"{BASE}/informes/{i1}", headers=analista)).json()
        assert det["data"]["kpis"]["ventas"] == 11 and det["fuentes_nuevas"] == [] and det["vinculos"] == {}

        # Vínculos a mano: Benítez es Dolly González; Nancy no es ninguno de la lista.
        assert (await ac.put(f"{BASE}/vinculos", headers=lector, json={
            "clave": "BENITEZ, ROSA", "nombre": "Benitez, Rosa", "accion": "vincular", "vendedor": "DOLLY GONZALEZ"})).status_code == 403
        r = await ac.put(f"{BASE}/vinculos", headers=analista, json={
            "clave": "BENITEZ, ROSA", "nombre": "Benitez, Rosa", "accion": "vincular", "vendedor": "DOLLY GONZALEZ"})
        assert r.status_code == 200, r.text
        r = await ac.put(f"{BASE}/vinculos", headers=analista, json={
            "clave": "PEREZ, ANA", "nombre": "Perez, Ana", "accion": "vincular", "vendedor": "DOLLY GONZALEZ"})
        assert r.status_code == 409 and "Benitez" in r.json()["detail"]
        assert (await ac.put(f"{BASE}/vinculos", headers=analista, json={
            "clave": "PEREZ, ANA", "nombre": "Perez, Ana", "accion": "vincular"})).status_code == 400
        assert (await ac.put(f"{BASE}/vinculos", headers=analista, json={
            "clave": "PEREZ, ANA", "nombre": "Perez, Ana", "accion": "vincular", "vendedor": "SIN VENDEDOR"})).status_code == 400
        assert (await ac.put(f"{BASE}/vinculos", headers=analista, json={
            "clave": "LOPEZ GIMENEZ, NANCY", "nombre": "Lopez Gimenez, Nancy", "accion": "descartar"})).status_code == 200

        # Recalcular un borrador lo rehace en el lugar, con los vínculos.
        r = (await ac.post(f"{BASE}/informes/{i1}/recalcular", headers=analista)).json()
        assert r["nuevo_borrador"] is False and r["informe"]["id"] == i1
        det = (await ac.get(f"{BASE}/informes/{i1}", headers=analista)).json()
        a = {x["clave"]: x for x in det["data"]["agentes"]}
        assert a["BENITEZ, ROSA"]["nivel"] == "manual" and a["BENITEZ, ROSA"]["ventas"] == 2
        assert a["LOPEZ GIMENEZ, NANCY"]["nivel"] == "descartado" and a["LOPEZ GIMENEZ, NANCY"]["ventas"] is None
        assert det["data"]["kpis"]["ventas_sin_agente"] == 1 and det["data"]["kpis"]["pct_cobertura"] == 80.0
        assert det["vinculos"] == {"BENITEZ, ROSA": "DOLLY GONZALEZ", "LOPEZ GIMENEZ, NANCY": None}

        # Publicar; calcular otra vez genera otro borrador y publicarlo exige confirmar el reemplazo.
        r = await ac.post(f"{BASE}/informes/{i1}/publicar", headers=analista, json={})
        assert r.status_code == 200 and r.json()["status"] == "published"
        assert [x["id"] for x in (await ac.get(f"{BASE}/informes", headers=lector)).json()["items"]] == [i1]
        assert (await ac.get(f"{BASE}/informes/{i1}", headers=lector)).json()["data"]["kpis"]["sph"] == 0.33
        i2 = (await ac.post(f"{BASE}/calcular", headers=analista, json=cuerpo)).json()["informe"]["id"]
        assert i2 != i1
        r = await ac.post(f"{BASE}/informes/{i2}/publicar", headers=analista, json={})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "replace_required"
        assert r.json()["detail"]["existing"]["id"] == i1
        r = await ac.post(f"{BASE}/informes/{i2}/publicar", headers=analista, json={"confirm_replace": True})
        assert r.status_code == 200
        items = {x["id"]: x for x in (await ac.get(f"{BASE}/informes", headers=analista)).json()["items"]}
        assert items[i1]["status"] == "replaced" and items[i1]["replaced_by_report_id"] == i2

        # Un corte de ventas más nuevo se avisa; recalcular un publicado genera un borrador.
        await _corte_ventas(vid, date(2026, 9, 20))
        assert (await ac.get(f"{BASE}/informes/{i2}", headers=analista)).json()["fuentes_nuevas"] == ["Ventas Netas"]
        r = (await ac.post(f"{BASE}/informes/{i2}/recalcular", headers=analista)).json()
        i3 = r["informe"]["id"]
        assert r["nuevo_borrador"] is True and r["informe"]["ventas_corte"] == "2026-09-20"
        assert (await ac.get(f"{BASE}/informes/{i3}", headers=analista)).json()["fuentes_nuevas"] == []

        # Volver al cruce automático borra el vínculo manual.
        assert (await ac.put(f"{BASE}/vinculos", headers=analista, json={
            "clave": "BENITEZ, ROSA", "nombre": "Benitez, Rosa", "accion": "automatico"})).status_code == 200
        v = (await ac.get(f"{BASE}/vinculos", headers=analista)).json()["items"]
        assert [(x["clave"], x["vendedor"], x["updated_by"]) for x in v] == [("LOPEZ GIMENEZ, NANCY", None, "Usuario analista")]
        assert (await ac.get(f"{BASE}/vinculos", headers=lector)).status_code == 403

        # Semana: es otro período (se publica aparte del día) y suma solo los días que cuentan.
        semana = {"desde": "2026-09-14", "hasta": "2026-09-20"}
        assert (await ac.post(f"{BASE}/calcular", headers=analista, json={"desde": "2026-09-20", "hasta": "2026-09-14"})).status_code == 400
        assert (await ac.post(f"{BASE}/calcular", headers=analista, json={"desde": "2026-07-01", "hasta": "2026-09-30"})).status_code == 400
        f = (await ac.get(f"{BASE}/fuentes", headers=analista, params=semana)).json()
        assert f["tipo"] == "semana" and f["dias"] == 7 and f["dias_cubiertos"] == 1 and f["puede_calcular"]
        r = await ac.post(f"{BASE}/calcular", headers=analista, json=semana)
        assert r.status_code == 201, r.text
        sem = r.json()["informe"]
        assert sem["tipo"] == "semana" and sem["desde"] == "2026-09-14" and sem["hasta"] == "2026-09-20" and sem["dias"] == 1
        assert (await ac.post(f"{BASE}/informes/{sem['id']}/publicar", headers=analista, json={})).status_code == 200
        publicados = [x for x in (await ac.get(f"{BASE}/informes", headers=lector)).json()["items"]]
        assert {(x["tipo"], x["desde"]) for x in publicados} == {("semana", "2026-09-14"), ("dia", D)}
        det = (await ac.get(f"{BASE}/informes/{sem['id']}", headers=lector)).json()
        assert det["data"]["kpis"]["dias_cubiertos"] == 1 and len(det["data"]["serie"]) == 1
        assert (await ac.get(f"{BASE}/dias", headers=analista)).json()["dias"][0]["sph"] == {"published": i2, "draft": i3}  # la semana no cuenta como SPH del día

        # No se elimina un publicado; despublicar lo vuelve borrador.
        assert (await ac.delete(f"{BASE}/informes/{i2}", headers=analista)).status_code == 400
        assert (await ac.post(f"{BASE}/informes/{i2}/despublicar", headers=analista)).json()["status"] == "draft"
        assert [x["tipo"] for x in (await ac.get(f"{BASE}/informes", headers=lector)).json()["items"]] == ["semana"]
        assert (await ac.delete(f"{BASE}/informes/{i2}", headers=lector)).status_code == 403
        assert (await ac.delete(f"{BASE}/informes/{i2}", headers=analista)).status_code == 200
        assert (await ac.get(f"{BASE}/informes/{i2}", headers=analista)).status_code == 404


# ============================ cada planilla de ventas reemplaza a la anterior ============================
def _neta_act(vendedor, venta, activacion, sds=None):
    """Una neta con su día de venta y de activación (mes de la planilla = mes de activación)."""
    return {"sds_number": sds or uuid.uuid4().hex[:10], "vendedor": vendedor, "subcanal": "TKM", "producto": "Pospago",
            "fecha_venta": venta, "fecha_carga": venta, "fecha_activacion": activacion}


def _prod_del(d: date, hh: int = 18, agentes=AGENTES) -> dict:
    return analizar_dia(d, [corte(d, hh, reporte(agentes))], dict(PARAMETROS_DEFECTO))


def test_las_ventas_de_fin_de_mes_salen_de_la_hoja_de_productividad_de_su_mes():
    """Lo vendido el 30/09 que se activa en octubre llega como neta en la planilla de octubre; para el SPH cuenta el día
    en que se cargó, con la hoja de productividad de septiembre. La planilla de octubre no le suma nada al 30/09."""
    fin = date(2026, 9, 30)
    septiembre = {"detalle_netas": [], "productividad": {"detalle_cargas": [
        carga("ANA MARIA PEREZ GOMEZ", "2026-09-30"),
        carga("ANA MARIA PEREZ GOMEZ", "2026-09-30", estado="Vta_A_Confirmar", atribucion="legajo"),
        carga("ANA MARIA PEREZ GOMEZ", "2026-09-29"),   # otro día
    ]}}
    octubre = {"detalle_netas": [_neta_act("ANA MARIA PEREZ GOMEZ", "2026-09-30", "2026-10-02")],
               "productividad": {"detalle_cargas": [carga("ANA MARIA PEREZ GOMEZ", "2026-10-01"),
                                                    carga("ANA MARIA PEREZ GOMEZ", "2026-09-30")]}}
    fuentes = {"productividad": [], "ventas": [
        {"id": "v9", "status": "published", "periodo": "2026-09", "fecha_dato": "2026-09-30"},
        {"id": "v10", "status": "draft", "periodo": "2026-10", "fecha_dato": "2026-10-03"}]}
    r = calcular_periodo(fin, fin, {fin: _prod_del(fin)}, {"2026-09": septiembre, "2026-10": octubre}, fuentes)
    assert r["kpis"]["ventas"] == 2
    a = {f["clave"]: f for f in r["agentes"]}
    assert a["PEREZ, ANA"]["ventas"] == 2 and a["PEREZ, ANA"]["estados"] == {"Vta_Finalizada": 1, "Vta_A_Confirmar": 1}


@pytest.mark.asyncio
async def test_vale_la_planilla_de_ventas_mas_nueva_y_el_corte_de_llamadas_mas_completo():
    from datetime import datetime, timezone

    from app.operativas.televentas_claro.fuentes import informes_productividad, informes_ventas

    t = lambda h: datetime(2025, 3, 11, h, tzinfo=timezone.utc)  # noqa: E731
    async with AsyncSessionLocal() as db:
        db.add_all([
            VentasNetasReport(upload_id="s1", periodo="2025-03", period_month=date(2025, 3, 1), fecha_dato=date(2025, 3, 9),
                              status="published", generated_at=t(9), data={}),
            VentasNetasReport(upload_id="s2", periodo="2025-03", period_month=date(2025, 3, 1), fecha_dato=date(2025, 3, 10),
                              status="draft", generated_at=t(10), data={}),
            ProdInforme(fecha=date(2025, 3, 10), status="published", corte_final="14:00", generated_at=t(9), data={}),
            ProdInforme(fecha=date(2025, 3, 10), status="draft", corte_final="19:00", generated_at=t(10), data={}),
            ProdInforme(fecha=date(2025, 3, 7), status="published", corte_final="19:00", generated_at=t(8), data={}),
            ProdInforme(fecha=date(2025, 3, 7), status="draft", corte_final="19:00", generated_at=t(11), data={}),
        ])
        await db.commit()
        # La planilla subida el 11 (corte del 10) reemplaza a la publicada del 9 aunque todavía no se publicó.
        v = (await informes_ventas(db, {"2025-03"}))["2025-03"]
        assert (v.upload_id, v.status) == ("s2", "draft")
        # Llamadas: vale el día más completo (el corte de las 19:00); a igual corte, el publicado.
        p = await informes_productividad(db, date(2025, 3, 7), date(2025, 3, 10))
        assert (p[date(2025, 3, 10)].corte_final, p[date(2025, 3, 10)].status) == ("19:00", "draft")
        assert p[date(2025, 3, 7)].status == "published"
        # A igual corte de ventas, el publicado.
        db.add(VentasNetasReport(upload_id="s3", periodo="2025-03", period_month=date(2025, 3, 1), fecha_dato=date(2025, 3, 10),
                                 status="published", generated_at=t(8), data={}))
        await db.commit()
        assert (await informes_ventas(db, {"2025-03"}))["2025-03"].upload_id == "s3"


@pytest.mark.asyncio
async def test_llamadas_del_10_y_planilla_de_ventas_subida_el_11_sin_publicar():
    """El caso de todos los días: el 10 se suben las llamadas; el 11, la planilla de Ventas Netas (con corte del 10). El SPH
    del 10 toma de su hoja de productividad las ventas cargadas el 10 y las divide por las horas del 10, aunque la
    planilla no esté publicada. Cada planilla nueva trae el último estado de cada venta."""
    from datetime import datetime, timezone

    dia = date(2025, 4, 10)
    d = dia.isoformat()
    pendiente = "SDS-PENDIENTE"
    abril = lambda estado="Vta_A_Confirmar", extra=(): {  # noqa: E731
        "detalle_netas": [_neta_act("ANA MARIA PEREZ GOMEZ", "2025-03-28", d)],  # se activó el 10 pero se vendió en marzo
        "productividad": {"detalle_cargas": [
            carga("ANA MARIA PEREZ GOMEZ", "2025-04-08"),   # de días anteriores: no cuenta para el 10
            carga("ANA MARIA PEREZ GOMEZ", d), carga("ANA MARIA PEREZ GOMEZ", d, estado=estado, atribucion="legajo", sds=pendiente),
            carga("ROBERTO CARLOS RIVEROS MORA", d), *extra]}}
    hora = lambda dd, hh: datetime(2025, 4, dd, hh, tzinfo=timezone.utc)  # noqa: E731
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        analista = await _new_user(ac, admin, "analista")
        prod = _prod_del(dia)
        await _guardar(ProdInforme(fecha=dia, status="published", corte_final=prod["corte_final"], data=prod))
        # Publicada: la planilla con corte del 9 (todavía no trae el 10).
        await _guardar(VentasNetasReport(upload_id="a9", periodo="2025-04", period_month=date(2025, 4, 1),
                                         fecha_dato=date(2025, 4, 9), status="published", generated_at=hora(10, 11),
                                         data=abril()))
        r = await ac.post(f"{BASE}/calcular", headers=analista, json={"fecha": d})
        assert r.status_code == 409 and "todavía no trae" in r.json()["detail"]["message"]
        # El 11 se sube la planilla nueva (corte del 10): reemplaza a la anterior sin publicarla.
        nueva = await _guardar(VentasNetasReport(upload_id="a10", periodo="2025-04", period_month=date(2025, 4, 1),
                                                 fecha_dato=dia, status="draft", generated_at=hora(11, 11), data=abril()))
        r = await ac.post(f"{BASE}/calcular", headers=analista, json={"fecha": d})
        assert r.status_code == 201, r.text
        inf = r.json()["informe"]
        assert inf["ventas_corte"] == d and inf["ventas"] == 3   # la neta activada el 10 (vendida en marzo) no cuenta
        det = (await ac.get(f"{BASE}/informes/{inf['id']}", headers=analista)).json()
        a = {x["clave"]: x for x in det["data"]["agentes"]}
        assert a["PEREZ, ANA"]["ventas"] == 2 and a["RIVEROS, ROBERTO CARLOS"]["ventas"] == 1
        assert a["PEREZ, ANA"]["login"] == 6 * H  # contra las horas del 10
        assert [x["id"] for x in det["data"]["fuentes"]["ventas"]] == [nueva]
        assert any("borrador de Ventas Netas" in x for x in det["data"]["avisos"])
        assert not any("mismo día" in x for x in det["data"]["avisos"])  # se subió el 11: el 10 está completo
        # El 12 llega otra planilla (corte del 11): la venta pendiente del 10 se rechazó. El SPH avisa y, al recalcular, la saca.
        await _guardar(VentasNetasReport(upload_id="a11", periodo="2025-04", period_month=date(2025, 4, 1),
                                         fecha_dato=date(2025, 4, 11), status="draft", generated_at=hora(12, 11),
                                         data=abril("Vta_Rechazada", [carga("ANA MARIA PEREZ GOMEZ", "2025-04-11")])))
        assert (await ac.get(f"{BASE}/informes/{inf['id']}", headers=analista)).json()["fuentes_nuevas"] == ["Ventas Netas"]
        r = (await ac.post(f"{BASE}/informes/{inf['id']}/recalcular", headers=analista)).json()
        assert r["informe"]["ventas"] == 2 and r["informe"]["ventas_corte"] == "2025-04-11"
        det = (await ac.get(f"{BASE}/informes/{r['informe']['id']}", headers=analista)).json()
        assert det["data"]["kpis"]["estados"] == {"Vta_Finalizada": 2, "Vta_Rechazada": 1}
        # Una planilla subida el mismo día que se calcula puede no traer el día completo: se avisa.
        await _guardar(VentasNetasReport(upload_id="a12", periodo="2025-04", period_month=date(2025, 4, 1),
                                         fecha_dato=date(2025, 4, 12), status="draft", generated_at=hora(12, 20), data=abril()))
        await _guardar(ProdInforme(fecha=date(2025, 4, 12), status="published", corte_final=prod["corte_final"],
                                   data=_prod_del(date(2025, 4, 12))))
        r = await ac.post(f"{BASE}/calcular", headers=analista, json={"fecha": "2025-04-12"})
        det = (await ac.get(f"{BASE}/informes/{r.json()['informe']['id']}", headers=analista)).json()
        assert any("se subió el mismo día (12/04" in x for x in det["data"]["avisos"])
        # Las ventas de un día salen solo de la planilla de su mes: la de mayo no entra ni para el 28/04.
        await _guardar(VentasNetasReport(upload_id="m1", periodo="2025-05", period_month=date(2025, 5, 1),
                                         fecha_dato=date(2025, 5, 3), status="draft", data={"productividad": {"detalle_cargas": []}}))
        periodos = lambda f: [v["periodo"] for v in f["ventas"]]  # noqa: E731
        assert periodos((await ac.get(f"{BASE}/fuentes", headers=analista, params={"fecha": "2025-04-28"})).json()) == ["2025-04"]


@pytest.mark.asyncio
async def test_los_sph_anteriores_siguen_mostrando_sus_netas():
    """Los SPH calculados con las netas (hasta la v3) no cambian: la lista los marca para recalcularlos."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        analista = await _new_user(ac, admin, "analista")
        viejo = await _guardar(SphInforme(fecha=date(2025, 6, 2), hasta=date(2025, 6, 2), tipo="dia", status="published",
                                          sph=0.3, netas=9, horas=30, data={"version": 3, "kpis": {"netas": 9}}))
        items = {x["id"]: x for x in (await ac.get(f"{BASE}/informes", headers=analista)).json()["items"]}
        assert (items[viejo]["base"], items[viejo]["ventas"], items[viejo]["version"]) == ("netas", 9, None)
        det = (await ac.get(f"{BASE}/informes/{viejo}", headers=analista)).json()
        assert det["version_actual"] == 4 and det["data"]["version"] == 3
