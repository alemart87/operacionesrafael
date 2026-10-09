"""SPH estimado (Televentas CLARO): cruce de agentes con vendedores por nombre, cálculo del SPH
de la operación y por asesor, y circuito de publicación por día (borrador → publicado → reemplazado)."""
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


def carga(vendedor, fecha="2026-09-15", estado="Vta_Finalizada", atribucion="pos"):
    return {"fecha_alta": fecha, "estado": estado, "vendedor": vendedor, "atribucion": atribucion}


D = "2026-09-15"
VENTAS = {
    "detalle_netas": [
        neta("ANA MARIA PEREZ GOMEZ", D), neta("ANA MARIA PEREZ GOMEZ", D), neta("ANA MARIA PEREZ GOMEZ", D, "GPON"),
        neta("ANA MARIA PEREZ GOMEZ", "2026-09-14"),               # otro día: no cuenta
        neta("NANCY GIMENEZ", None, fecha_carga=D),                 # sin fecha de venta: vale la de carga
        neta("ROBERTO CARLOS RIVEROS MORA", D), neta("ROBERTO CARLOS RIVEROS MORA", D),
        neta("CARLOS RAMON VENIALGO RIVEROS", "2026-09-10"),
        neta("PEDRO SOSA", D),                                      # de un agente con sesión abierta
        neta("CARLA VERA", D),
        neta("DOLLY GONZALEZ", D), neta("DOLLY GONZALEZ", D),       # vendedora sin agente conectado
        neta("SIN FECHA", None, fecha_carga=""),                     # no se puede ubicar en un día
    ],
    "productividad": {"detalle_cargas": [
        *[carga("ANA MARIA PEREZ GOMEZ") for _ in range(3)], carga("ANA MARIA PEREZ GOMEZ", estado="Vta_Rechazada"),
        carga("NANCY GIMENEZ"), carga("ROBERTO CARLOS RIVEROS MORA"), carga("ROBERTO CARLOS RIVEROS MORA"),
        carga("PEDRO SOSA"), carga("CARLA VERA"), carga("DOLLY GONZALEZ"), carga("DOLLY GONZALEZ"),
        carga("CARGADO POR EXP1 JUAN", atribucion="sin_atribuir"),
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
def test_sph_de_la_operacion_y_por_asesor():
    r = calcular(DIA, productividad(), VENTAS, FUENTES)
    k = r["kpis"]
    # Netas del día: 3 Pérez + 1 Nancy (por fecha de carga) + 2 Riveros + 1 Sosa + 1 Vera + 2 Dolly.
    assert k["netas"] == 10 and k["productos"] == {"Pospago": 9, "GPON": 1}
    # La sesión abierta queda fuera: sus horas y su neta.
    assert k["sesiones_abiertas"] == 1 and k["netas_sesion_abierta"] == 1 and k["netas_operacion"] == 9
    assert k["horas"] == 30 * H and k["sph"] == 0.3
    # Asesores vinculados con jornada válida: 24 h y 7 netas.
    assert k["horas_vinculadas"] == 24 * H and k["netas_vinculadas"] == 7 and k["sph_vinculados"] == 0.29
    assert k["netas_sin_agente"] == 2 and k["pct_cobertura"] == 77.8
    assert k["cargadas"] == 11 and k["pct_activadas"] == 90.9   # la rechazada no cuenta
    assert k["netas_sin_fecha_mes"] == 1
    assert k["niveles"] == {"exacto": 4, "probable": 2, "sin_cruce": 1} and k["vinculados"] == 6

    a = {f["clave"]: f for f in r["agentes"]}
    assert a["PEREZ, ANA"]["sph"] == 0.5 and a["PEREZ, ANA"]["productos"] == {"Pospago": 2, "GPON": 1}
    assert a["LOPEZ GIMENEZ, NANCY"]["nivel"] == "probable" and a["LOPEZ GIMENEZ, NANCY"]["sph"] == 0.2
    assert a["RIVEROS, CARLOS"]["netas"] == 0 and a["RIVEROS, CARLOS"]["sph"] == 0.0
    assert a["SOSA, PEDRO"]["sesion_abierta"] and a["SOSA, PEDRO"]["sph"] is None and a["SOSA, PEDRO"]["netas"] == 0
    assert a["SOSA, PEDRO"]["netas_sesion_abierta"] == 1 and a["SOSA, PEDRO"]["login"] == 0 and a["SOSA, PEDRO"]["login_abierta"] == 18 * H
    assert a["VERA, CARLA"]["sph"] == 1.0 and a["VERA, CARLA"]["en_ranking"] is False
    assert a["BENITEZ, ROSA"]["nivel"] == "sin_cruce" and a["BENITEZ, ROSA"]["netas"] is None
    assert [f["clave"] for f in r["agentes"] if f["en_ranking"]] == [
        "PEREZ, ANA", "RIVEROS, ROBERTO CARLOS", "LOPEZ GIMENEZ, NANCY", "RIVEROS, CARLOS"]

    assert r["ventas_sin_agente"] == [{"vendedor": "DOLLY GONZALEZ", "subcanal": "TKM", "netas": 2, "cargadas": 2}]
    assert {v["vendedor"] for v in r["vendedores"]} >= {"DOLLY GONZALEZ", "CARLOS RAMON VENIALGO RIVEROS"}
    assert "SIN VENDEDOR" not in {v["vendedor"] for v in r["vendedores"]}
    # Con un corte de ventas de 3 días después se avisa que las netas siguen activándose.
    assert r["fuentes"]["dias_despues"] == 3 and any("se siguen activando" in x for x in r["avisos"])


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
    assert [x["fecha"] for x in r["serie"]] == ["2026-09-14", D] and r["serie"][0]["netas"] == 1
    # El lunes suma 6 h y 1 neta de Pérez: 11 netas (10 sin la sesión abierta) en 36 h.
    assert k["netas"] == 11 and k["netas_operacion"] == 10 and k["horas"] == 36 * H and k["sph"] == 0.28
    a = {f["clave"]: f for f in r["agentes"]}
    assert a["PEREZ, ANA"]["dias"] == 2 and a["PEREZ, ANA"]["login"] == 12 * H and a["PEREZ, ANA"]["netas"] == 4
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


def test_sph_sin_fechas_de_venta_no_se_calcula():
    viejo = {"detalle_netas": [{"vendedor": "ANA PEREZ", "producto": "Pospago", "fecha_activacion": D}]}
    with pytest.raises(DatosIncompletos):
        calcular(DIA, productividad(), viejo, FUENTES)
    with pytest.raises(DatosIncompletos):
        calcular(DIA, {"agentes": []}, VENTAS, FUENTES)


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
        assert f["tipo"] == "dia" and f["dias_cubiertos"] == 1 and f["cobertura"] == [{"fecha": D, "productividad": "published", "horas": True, "ventas": True}]
        assert (await ac.get(f"{BASE}/fuentes", headers=lector, params=cuerpo)).status_code == 403
        dias = (await ac.get(f"{BASE}/dias", headers=analista)).json()
        assert dias["dias"][0]["fecha"] == D and dias["dias"][0]["cubre"] and dias["sugerida"] == D

        # Calcular: borrador del día, solo para gestión.
        r = await ac.post(f"{BASE}/calcular", headers=analista, json=cuerpo)
        assert r.status_code == 201, r.text
        i1 = r.json()["informe"]["id"]
        assert r.json()["informe"]["status"] == "draft" and r.json()["informe"]["sph"] == 0.3
        assert r.json()["informe"]["horas"] == 30 and r.json()["informe"]["ventas_corte"] == "2026-09-18"
        assert (await ac.get(f"{BASE}/informes", headers=lector)).json()["items"] == []
        assert (await ac.get(f"{BASE}/informes/{i1}", headers=lector)).status_code == 404
        det = (await ac.get(f"{BASE}/informes/{i1}", headers=analista)).json()
        assert det["data"]["kpis"]["netas"] == 10 and det["fuentes_nuevas"] == [] and det["vinculos"] == {}

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
        assert a["BENITEZ, ROSA"]["nivel"] == "manual" and a["BENITEZ, ROSA"]["netas"] == 2
        assert a["LOPEZ GIMENEZ, NANCY"]["nivel"] == "descartado" and a["LOPEZ GIMENEZ, NANCY"]["netas"] is None
        assert det["data"]["kpis"]["netas_sin_agente"] == 1 and det["data"]["kpis"]["pct_cobertura"] == 88.9
        assert det["vinculos"] == {"BENITEZ, ROSA": "DOLLY GONZALEZ", "LOPEZ GIMENEZ, NANCY": None}

        # Publicar; calcular otra vez genera otro borrador y publicarlo exige confirmar el reemplazo.
        r = await ac.post(f"{BASE}/informes/{i1}/publicar", headers=analista, json={})
        assert r.status_code == 200 and r.json()["status"] == "published"
        assert [x["id"] for x in (await ac.get(f"{BASE}/informes", headers=lector)).json()["items"]] == [i1]
        assert (await ac.get(f"{BASE}/informes/{i1}", headers=lector)).json()["data"]["kpis"]["sph"] == 0.3
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
