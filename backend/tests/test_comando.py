"""Centro de comandos (modelo Líder Coach Comercial, fase 5): semáforo de supervisores, alertas del día que se abren
y se cierran solas, tomar / pedir revisión / descartar, línea de tiempo de cada supervisor y ficha del asesor."""
from __future__ import annotations

import asyncio
import uuid
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app.core.database import AsyncSessionLocal, Base, engine
from app.main import app
from app.operativas.televentas_claro.supervision import api as sup_api
from app.operativas.televentas_claro.supervision import coaching as coaching_srv
from app.operativas.televentas_claro.supervision import tickets as tickets_srv
from app.operativas.televentas_claro.supervision.calculo import PARAMETROS_DEFECTO
from app.operativas.televentas_claro.supervision.comando import (
    dias_habiles_entre, orden_semaforo, semaforo_fila, sincronizar,
)
from app.operativas.televentas_claro.supervision.models import (
    AlertaComando, EquipoAsignacion, ObjetivoSupervisor, Operador, SupParametros,
)
from app.operativas.televentas_claro.ventas_netas.models import VentasNetasReport

Z = ZoneInfo("America/Asuncion")
BASE = "/api/v1/televentas-claro/supervision"
TC = "televentas_claro"
PESOS = PARAMETROS_DEFECTO["pesos_dia"]
D = lambda m, d: date(2026, m, d)  # noqa: E731
L = lambda d, hh, mm=0: datetime(2026, 10, d, hh, mm, tzinfo=Z)  # noqa: E731  (octubre de 2026, hora de Asunción)


# ============================ reglas ============================
def test_dias_habiles_desde_la_ultima_gestion():
    p = {"pesos_dia": PESOS, "feriados": []}
    assert dias_habiles_entre(D(10, 9), D(10, 12), p) == 1.5      # viernes → lunes: sábado medio día, domingo nada
    assert dias_habiles_entre(D(10, 9), D(10, 14), p) == 3.5
    assert dias_habiles_entre(D(10, 9), D(10, 9), p) == 0
    assert dias_habiles_entre(D(10, 9), D(10, 14), {**p, "feriados": ["2026-10-12"]}) == 2.5


def _pr(estado="sin_objetivo", pct=None, provisoria=False):
    return {"estado": estado, "pct_proyeccion": pct, "provisoria": provisoria}


def _fila(nombre="Silvia", **kw):
    base = dict(info={"id": nombre.lower(), "nombre": nombre, "activo": True}, sc={"total": 70.0, "parcial": False, "partes": []},
                anterior=None, pospago=_pr(), gpon=_pr(), asesores=5, en_alerta=0, a_recuperar=0, alertas=Counter(),
                tickets=Counter(), seguimientos_vencidos=0, ultima=None, dias_sin_gestion=1.0, umbral=10.0)
    return semaforo_fila(**{**base, **kw})


def test_semaforo_atencion_revisar_y_al_dia_con_sus_motivos():
    assert _fila()["estado"] == "al_dia" and _fila()["motivos"] == []
    f = _fila(en_alerta=2, a_recuperar=4, tickets=Counter(por_vencer=1))
    assert f["estado"] == "revisar" and f["motivos"] == ["En crítico: 2 asesores sobre el 10% sin uso", "1 ticket por vencer"]
    f = _fila(tickets=Counter(vencido=2, en_plazo=1), seguimientos_vencidos=1, pospago=_pr("bajo_objetivo", 62.4),
              gpon=_pr("en_riesgo", 93.0), dias_sin_gestion=3.5, en_alerta=1, alertas=Counter(vencida=1, en_plazo=2))
    assert f["estado"] == "atencion" and f["motivos_rojo"] == 5 and f["tickets"] == {"abiertos": 3, "vencidos": 2, "por_vencer": 0}
    assert f["motivos"] == [
        "2 tickets vencidos", "1 alerta de uso sin coaching a tiempo", "1 seguimiento vencido", "Pospago proyecta 62% del objetivo",
        "Sin registrar gestión hace 3,5 días hábiles", "GPON en riesgo (93%)", "En crítico: 1 asesor sobre el 10% sin uso",
        "2 alertas esperando coaching"]
    # Una proyección provisoria no alarma; sin equipo, no se le pide gestión.
    assert _fila(pospago=_pr("bajo_objetivo", 40.0, provisoria=True), asesores=0, dias_sin_gestion=9.0)["estado"] == "al_dia"
    filas = [_fila("Ana"), _fila("Beto", en_alerta=1), _fila("Carla", tickets=Counter(vencido=1)),
             _fila("Dora", tickets=Counter(vencido=1), seguimientos_vencidos=2)]
    assert [f["nombre"] for f in sorted(filas, key=orden_semaforo)] == ["Dora", "Carla", "Beto", "Ana"]


def _cond(tipo, clave, desde=None):
    return {"tipo": tipo, "clave": clave, "titulo": f"{tipo} {clave}", "detalle": "", "periodo": "2026-10", "supervisor_id": None,
            "operador_id": None, "desde": desde, "datos": {}}


# ============================ API ============================
def setup_module(module):
    from app.main import _seed_profiles

    async def _prep():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await _seed_profiles()
    asyncio.run(_prep())


@pytest.mark.asyncio
async def test_las_alertas_se_abren_se_cierran_solas_y_se_reabren_con_el_mismo_inicio():
    t0 = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)
    inicio = datetime(2026, 10, 5, 3, tzinfo=timezone.utc)  # medianoche de Asunción
    ka, ks = ("asesor_alerta", "prueba:1"), ("sin_actividad", "prueba:2")
    async with AsyncSessionLocal() as db:
        assert await sincronizar(db, {ka: _cond(*ka, inicio), ks: _cond(*ks)}, t0) == 2
        assert await sincronizar(db, {ka: _cond(*ka, inicio), ks: _cond(*ks)}, t0 + timedelta(hours=1)) == 0  # siguen igual
        assert await sincronizar(db, {}, t0 + timedelta(hours=2)) == 2                                         # se fueron
        assert await sincronizar(db, {ka: _cond(*ka, inicio), ks: _cond(*ks)}, t0 + timedelta(hours=3)) == 2   # volvieron
        filas = (await db.execute(select(AlertaComando).where(AlertaComando.clave.like("prueba:%")))).scalars().all()
        # La del mismo inicio se reabre (con lo que ya se había hecho); la que empieza cuando se ve es otra alerta.
        por_tipo = Counter(a.tipo for a in filas)
        assert por_tipo == {"asesor_alerta": 1, "sin_actividad": 2}
        assert all(a.hasta is None for a in filas if a.tipo == "asesor_alerta")
        assert sorted(a.hasta is None for a in filas if a.tipo == "sin_actividad") == [False, True]
        await db.execute(delete(AlertaComando).where(AlertaComando.clave.like("prueba:%")))
        await db.commit()


async def _login(ac, email, pwd="Clave1234!"):
    r = await ac.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _new_user(ac, admin, role, nombre=None):
    email = f"{role}-{uuid.uuid4().hex[:6]}@voicenter.com.py"
    r = await ac.post("/api/v1/users", headers=admin, json={
        "email": email, "password": "Clave1234!", "full_name": nombre or f"Usuario {role}", "role": role, "operativas": [TC]})
    assert r.status_code == 201, r.text
    return r.json()["id"], await _login(ac, email)


def _neta(vendedor, venta, corte_vn, consumo="SI"):
    activacion = venta + timedelta(days=1)
    dias = (corte_vn - activacion).days
    return {"sds_number": uuid.uuid4().hex[:10], "linea": "0981" + uuid.uuid4().hex[:6], "vendedor": vendedor,
            "subcanal": "TKM", "producto": "Pospago", "plan": "Plan X", "fecha_venta": venta.isoformat(),
            "fecha_carga": venta.isoformat(), "fecha_activacion": activacion.isoformat(), "consumo": consumo,
            "en_espera": consumo != "SI" and dias < 3, "dias": dias}


ANA, ROB, BETO, CARLA = "ANA MARIA PEREZ GOMEZ", "ROBERTO CARLOS RIVEROS MORA", "BETO GOMEZ", "CARLA SOSA"


@pytest.mark.asyncio
async def test_centro_de_comandos_semaforo_alertas_acciones_y_trazabilidad(monkeypatch):
    reloj = {"t": L(9, 10)}  # viernes 9/10, 10 h

    def ahora():
        return reloj["t"].astimezone(timezone.utc)

    def a(d, hh, mm=0):
        reloj["t"] = L(d, hh, mm)

    monkeypatch.setattr(sup_api, "hoy", lambda: reloj["t"].date())
    monkeypatch.setattr(coaching_srv, "ahora", ahora)
    monkeypatch.setattr(tickets_srv, "ahora", ahora)

    # Ventas al 8/10: Riveros con 3 sin uso de 5 (en alerta); Ana sin problemas; Carla vende y no tiene equipo.
    corte = D(10, 8)
    lineas = [_neta(ANA, D(10, d), corte) for d in (1, 2, 5, 6, 7)]
    lineas += [_neta(ROB, v, corte, c) for v, c in ((D(9, 30), "SI"), (D(10, 1), "SI"), (D(10, 2), "NO"), (D(10, 3), "NO"), (D(10, 4), "NO"))]
    lineas += [_neta(CARLA, D(10, d), corte) for d in (5, 6)]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        admin = await _login(ac, "admin@voicenter.com.py", "Test1234!")
        coord_id, coord = await _new_user(ac, admin, "coordinador", "Paola Coordinadora")
        _, auditor = await _new_user(ac, admin, "auditor", "Andrés Auditor")
        _, controller = await _new_user(ac, admin, "controller", "Carla Controller")
        _, analista = await _new_user(ac, admin, "analista")
        s1, sup1 = await _new_user(ac, admin, "supervisor", "Silvia Uno")
        s2, _ = await _new_user(ac, admin, "supervisor", "Sergio Dos")
        async with AsyncSessionLocal() as db:
            ana = Operador(nombre="Perez, Ana", agente_clave="PEREZ, ANA", vendedor=ANA, cruce="manual", ultima_vez=corte)
            rob = Operador(nombre="Riveros, Roberto Carlos", agente_clave="RIVEROS, ROBERTO CARLOS", vendedor=ROB, cruce="manual",
                           ultima_vez=corte)
            beto = Operador(nombre="Gomez, Beto", agente_clave="GOMEZ, BETO", vendedor=BETO, cruce="manual", ultima_vez=corte)
            otros = [Operador(nombre=f"{x}, Prueba", agente_clave=f"{x.upper()}, PRUEBA", cruce="descartado", ultima_vez=corte)
                     for x in ("Diaz", "Escobar", "Franco")]
            db.add_all([ana, rob, beto, *otros])
            await db.flush()
            db.add_all([
                EquipoAsignacion(periodo="2026-10", operador_id=ana.id, supervisor_id=s1, desde=D(10, 1), created_at=L(1, 8), created_by=coord_id),
                EquipoAsignacion(periodo="2026-10", operador_id=rob.id, supervisor_id=s1, desde=D(10, 1), created_at=L(1, 8), created_by=coord_id),
                *(EquipoAsignacion(periodo="2026-10", operador_id=o.id, supervisor_id=s2, desde=D(10, 1), created_at=L(1, 8), created_by=coord_id)
                  for o in (beto, *otros)),
                ObjetivoSupervisor(periodo="2026-10", supervisor_id=s1, pospago=100, updated_at=L(1, 9), updated_by=coord_id),
                SupParametros(operativa=TC, data={"gestion_desde": "2026-10-01"}),
                VentasNetasReport(upload_id="u-cmd", periodo="2026-10", period_month=D(10, 1), fecha_dato=corte, status="published",
                                  generated_at=datetime(2026, 10, 8, 14, tzinfo=timezone.utc),
                                  data={"detalle_netas": lineas, "productividad": {"detalle_cargas": []}}),
            ])
            await db.commit()
            ana_id, rob_id = ana.id, rob.id

        # Viernes: Silvia registra un coaching sobre uso a Riveros con seguimiento el lunes 12.
        r = await ac.post(f"{BASE}/portal/coaching", headers=sup1, json={
            "operador_id": rob_id, "fecha": "2026-10-09", "tipo": "semanal", "metrica": "uso",
            "diagnostico": "Vende líneas a clientes que no las usan.", "compromiso": "Confirmar el uso en cada venta.",
            "seguimiento_fecha": "2026-10-12"})
        assert r.status_code == 201, r.text
        coaching = r.json()
        # Lunes 9 h: la coordinadora le envía un ticket de prioridad alta (2 h para la primera respuesta).
        a(12, 9)
        t1 = (await ac.post(f"{BASE}/tickets", headers=coord, json={
            "tipo": "reclamo", "prioridad": "alta", "supervisor_id": s1, "descripcion": "Cliente reclama una venta no autorizada."})).json()

        # ---- Miércoles 14, 17 h: el centro de comandos.
        a(14, 17)
        assert (await ac.get(f"{BASE}/comando", headers=sup1)).status_code == 403  # el supervisor solo entra a su portal
        r = await ac.get(f"{BASE}/comando", headers=analista)
        assert r.status_code == 200 and not r.json()["puede_actuar"]
        r = await ac.get(f"{BASE}/comando", headers=auditor)  # auditoría: en lectura (envía tickets desde Tickets)
        assert r.status_code == 200 and not r.json()["puede_actuar"] and not r.json()["puede_derivar"]
        c = (await ac.get(f"{BASE}/comando", headers=coord)).json()
        assert c["puede_actuar"] and c["puede_derivar"] and c["hoy"] == "2026-10-14" and c["pendientes_vincular"] == 1
        cab = c["cabecera"]
        assert (cab["supervisores_criticos"], cab["supervisores"], cab["asesores_en_alerta"], cab["a_recuperar"]) == (1, 2, 1, 3)
        assert cab["tickets"] == {"abiertos": 1, "vencidos": 1, "por_vencer": 0} and cab["cobertura"] == {"con": 1, "de": 6}
        assert cab["uso"] == {"pct_sin_uso": 25.0, "evaluables": 12, "sin_uso": 3, "umbral": 10.0}
        assert cab["pospago"]["objetivo"] == 100 and cab["pospago"]["vendido"] == 12 and cab["pospago"]["estado"] == "bajo_objetivo"

        # Semáforo: los dos en atención; Silvia primero (más motivos en rojo).
        silvia, sergio = c["supervisores"]
        assert (silvia["nombre"], silvia["estado"], sergio["nombre"], sergio["estado"]) == ("Silvia Uno", "atencion", "Sergio Dos", "atencion")
        assert silvia["motivos"] == ["1 ticket vencido", "1 seguimiento vencido", "Pospago proyecta 38% del objetivo",
                                     "Sin registrar gestión hace 3,5 días hábiles", "En crítico: 1 asesor sobre el 10% sin uso"]
        assert silvia["dias_sin_gestion"] == 3.5 and silvia["asesores"] == 2 and silvia["seguimientos_vencidos"] == 1
        assert silvia["ultima_gestion"] == L(9, 10).astimezone(timezone.utc).isoformat()
        assert sergio["motivos"] == ["Sin registrar gestión hace 10 días hábiles"] and sergio["ultima_gestion"] is None

        # Alertas del día: cada condición una vez, con su detalle; las que empezaron hoy, «nuevas».
        al = {(x["tipo"], x["supervisor"]): x for x in c["alertas"]}
        assert {x["estado"] for x in c["alertas"]} == {"abierta"} and len(c["alertas"]) == 9
        assert c["resumen_alertas"] == {"abiertas": 9, "tomadas": 0, "derivadas": 0, "descartadas": 0, "cerradas": 0, "nuevas": 6}
        assert al[("ticket_vencido", "Silvia Uno")]["titulo"] == "Ticket #0001 vencido · Silvia Uno"
        assert al[("ticket_vencido", "Silvia Uno")]["desde"] == L(12, 11).astimezone(timezone.utc).isoformat()  # venció a las 11
        assert al[("supervisor_critico", "Silvia Uno")]["detalle"] == "1 asesor con más del 10% de sus líneas sin uso · 3 líneas a recuperar."
        riveros = al[("asesor_alerta", "Silvia Uno")]
        assert riveros["titulo"] == "Riveros, Roberto Carlos cruzó el 10% de líneas sin uso" and riveros["operador_id"] == rob_id
        assert riveros["operador"] == "Riveros, Roberto Carlos" and c["tipo_revision"]["asesor_alerta"] == "linea_sin_uso"
        assert c["plazos"]["alta"] == {"respuesta": "2h", "resolucion": "1d"}
        assert riveros["detalle"] == "60% sin uso (3 de 5) · Silvia Uno · 3 líneas a recuperar." and not riveros["nueva"]
        assert riveros["desde_dia"] and not al[("ticket_vencido", "Silvia Uno")]["desde_dia"]  # empieza con el día / a una hora
        assert al[("seguimiento_vencido", "Silvia Uno")]["detalle"] == \
            "Coaching a Riveros, Roberto Carlos del 09/10 sobre uso de líneas: el seguimiento era el 12/10."
        assert al[("proyeccion_bajo", "Silvia Uno")]["titulo"] == "Silvia Uno: Pospago proyecta 38% del objetivo"
        assert al[("sin_actividad", "Sergio Dos")]["detalle"] == "Todavía no registró gestión."
        assert al[("sin_actividad", "Silvia Uno")]["detalle"] == \
            "Ni coachings, ni seguimientos, ni notas, ni respuestas a tickets desde el 09/10."
        assert al[("sin_supervisor", None)]["titulo"] == "1 asesor sin supervisor"
        assert al[("sin_supervisor", None)]["detalle"] == \
            "Vendieron o se conectaron este mes y hoy no tienen equipo: Carla Sosa. Sus netas no suman a ningún supervisor."
        assert al[("sin_vincular", None)]["titulo"] == "1 nombre sin vincular"
        assert [x["tipo"] for x in c["alertas"]][:3] == ["proyeccion_bajo", "supervisor_critico", "ticket_vencido"]  # graves primero
        assert {k: x["puede_revision"] for k, x in al.items() if k[0] in ("ticket_vencido", "sin_supervisor", "asesor_alerta")} == {
            ("ticket_vencido", "Silvia Uno"): False, ("sin_supervisor", None): False, ("asesor_alerta", "Silvia Uno"): True}
        # Al volver a abrir el centro no se duplican.
        assert len((await ac.get(f"{BASE}/comando", headers=coord)).json()["alertas"]) == 9

        # ---- Tomar: quién la tomó y qué hizo. Actúan quienes gestionan Supervisión; auditoría y análisis, no.
        url = lambda x, accion: f"{BASE}/comando/alertas/{x['id']}/{accion}"  # noqa: E731
        sergio_al = al[("sin_actividad", "Sergio Dos")]
        assert (await ac.post(url(sergio_al, "tomar"), headers=analista, json={})).status_code == 403
        assert (await ac.post(url(sergio_al, "tomar"), headers=auditor, json={"nota": "Lo veo yo."})).status_code == 403
        assert (await ac.post(url(sergio_al, "descartar"), headers=auditor, json={"motivo": "No aplica hoy"})).status_code == 403
        assert (await ac.post(url(sergio_al, "tomar"), headers=coord, json={"nota": "ok"})).status_code == 400
        r = await ac.post(url(sergio_al, "tomar"), headers=coord, json={"nota": "Lo llamé: hoy registra los coachings de la semana."})
        assert r.status_code == 200, r.text
        assert (r.json()["estado"], r.json()["tomada_por"], r.json()["nota_por"]) == ("tomada", "Paola Coordinadora", "Paola Coordinadora")
        assert (await ac.post(url(sergio_al, "tomar"), headers=controller, json={})).status_code == 409  # ya la tomó otra persona
        r = await ac.post(url(sergio_al, "tomar"), headers=controller, json={"nota": "Revisado con la coordinadora."})
        assert (r.json()["tomada_por"], r.json()["nota_por"], r.json()["nota"]) == ("Paola Coordinadora", "Carla Controller", "Revisado con la coordinadora.")

        # ---- Pedir revisión con un clic: un ticket a Silvia con el asesor; la alerta queda derivada.
        texto = "Riveros tiene 3 de 5 líneas sin uso: revisar las ventas con el cliente."
        assert (await ac.post(url(riveros, "revision"), headers=auditor, json={"prioridad": "media", "texto": texto})).status_code == 403
        assert (await ac.post(url(al[("ticket_vencido", "Silvia Uno")], "revision"), headers=coord,
                              json={"prioridad": "alta", "texto": texto})).status_code == 400
        assert (await ac.post(url(al[("sin_supervisor", None)], "revision"), headers=coord, json={"prioridad": "alta", "texto": texto})).status_code == 400
        assert (await ac.post(url(riveros, "revision"), headers=coord, json={"prioridad": "media", "texto": "corto"})).status_code == 400
        r = await ac.post(url(riveros, "revision"), headers=coord, json={"prioridad": "media", "texto": texto})
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["estado"] == "derivada" and d["ticket_numero"] == 2 and d["tomada_por"] == "Paola Coordinadora"
        assert d["operador"] == "Riveros, Roberto Carlos"
        t2 = (await ac.get(f"{BASE}/tickets/{d['ticket']['id']}", headers=coord)).json()
        assert (t2["supervisor"], t2["operador"], t2["tipo"], t2["prioridad"], t2["fecha_caso"]) == (
            "Silvia Uno", "Riveros, Roberto Carlos", "linea_sin_uso", "media", "2026-10-08")
        assert t2["referencia"] == "Centro de comandos · Asesor en alerta" and t2["descripcion"] == texto
        assert (await ac.post(url(riveros, "revision"), headers=coord, json={"prioridad": "media", "texto": texto})).status_code == 409
        assert (await ac.post(url(riveros, "descartar"), headers=coord, json={"motivo": "No corresponde"})).status_code == 409
        # Le llega a Silvia en su bandeja.
        assert {t["numero"] for t in (await ac.get(f"{BASE}/portal/tickets", headers=sup1)).json()["items"]} == {1, 2}

        # ---- Descartar, con el motivo.
        vincular = al[("sin_vincular", None)]
        assert (await ac.post(url(vincular, "descartar"), headers=coord, json={"motivo": "no"})).status_code == 400
        r = await ac.post(url(vincular, "descartar"), headers=coord, json={"motivo": "Se vincula en el cierre del mes."})
        assert r.json()["estado"] == "descartada" and r.json()["descartada_motivo"] == "Se vincula en el cierre del mes."
        assert (await ac.post(url(vincular, "descartar"), headers=coord, json={"motivo": "Otra vez lo mismo"})).status_code == 409
        assert (await ac.post(url(vincular, "tomar"), headers=coord, json={"nota": "Lo tomo igual."})).status_code == 409

        # ---- Jueves 10 h: Silvia responde y resuelve el ticket y registra el seguimiento: esas alertas se cierran solas.
        a(15, 10)
        await ac.post(f"{BASE}/portal/tickets/{t1['id']}/responder", headers=sup1, json={"texto": "Llamo al cliente y te cuento."})
        r = await ac.post(f"{BASE}/portal/tickets/{t1['id']}/resolver", headers=sup1, json={"texto": "Se anuló la venta con el cliente."})
        assert r.json()["estado"] == "resuelto"
        r = await ac.post(f"{BASE}/portal/coaching/{coaching['id']}/seguimiento", headers=sup1,
                          json={"comentario": "Ya confirma el uso en cada venta."})
        assert r.status_code == 200, r.text
        c = (await ac.get(f"{BASE}/comando", headers=coord)).json()
        estados = {(x["tipo"], x["supervisor"]): x["estado"] for x in c["alertas"]}
        assert estados == {
            ("ticket_vencido", "Silvia Uno"): "cerrada", ("seguimiento_vencido", "Silvia Uno"): "cerrada",
            ("sin_actividad", "Silvia Uno"): "cerrada", ("sin_actividad", "Sergio Dos"): "tomada",
            ("asesor_alerta", "Silvia Uno"): "derivada", ("supervisor_critico", "Silvia Uno"): "abierta",
            ("proyeccion_bajo", "Silvia Uno"): "abierta", ("sin_supervisor", None): "abierta", ("sin_vincular", None): "descartada"}
        assert next(x for x in c["alertas"] if x["tipo"] == "sin_actividad" and x["estado"] == "tomada")["titulo"] == \
            "Sergio Dos sin registrar gestión hace 11 días hábiles"
        silvia = next(f for f in c["supervisores"] if f["id"] == s1)
        assert silvia["motivos"] == ["Pospago proyecta 38% del objetivo", "En crítico: 1 asesor sobre el 10% sin uso"]
        assert silvia["dias_sin_gestion"] == 0 and silvia["tickets"] == {"abiertos": 1, "vencidos": 0, "por_vencer": 0}
        # Una nota sobre una alerta que ya se cerró sola: queda registrado cómo se resolvió.
        cerrada = next(x for x in c["alertas"] if x["tipo"] == "ticket_vencido")
        assert (await ac.post(url(cerrada, "tomar"), headers=coord, json={})).status_code == 409
        r = await ac.post(url(cerrada, "tomar"), headers=coord, json={"nota": "Silvia lo resolvió con el cliente."})
        assert r.json()["estado"] == "cerrada" and r.json()["nota"] == "Silvia lo resolvió con el cliente."

        # ---- Línea de tiempo de Silvia: coaching, seguimiento, tickets, equipo, objetivos y alertas.
        r = await ac.get(f"{BASE}/supervisores/{s1}/linea", headers=analista, params={"periodo": "2026-10"})
        assert r.status_code == 200, r.text
        lt = r.json()
        titulos = [e["titulo"] for e in lt["eventos"]]
        assert lt["eventos"][0]["at"] >= lt["eventos"][-1]["at"]  # lo más nuevo primero
        for t in ("Coaching semanal a Riveros, Roberto Carlos sobre uso de líneas", "Seguimiento del coaching a Riveros, Roberto Carlos",
                  "Recibió el ticket #0001 de Paola Coordinadora", "Respondió el ticket #0001", "Resolvió el ticket #0001",
                  "Recibió el ticket #0002 de Paola Coordinadora", "Ingresó Perez, Ana al equipo", "Objetivos del mes",
                  "Paola Coordinadora tomó la alerta «Asesor en alerta»", "Paola Coordinadora tomó la alerta «Ticket vencido»"):
            assert t in titulos, t
        seg = next(e for e in lt["eventos"] if e["grupo"] == "seguimiento")
        assert seg["coaching_id"] == coaching["id"] and seg["detalle"].startswith("Resultado:")
        assert lt["grupos"]["ticket"] == 4 and lt["grupos"]["equipo"] == 2 and lt["grupos"]["objetivo"] == 1
        assert not any("Sergio" in t for t in titulos)
        r = await ac.get(f"{BASE}/supervisores/{s2}/linea", headers=coord, params={"periodo": "2026-10"})
        assert [e["titulo"] for e in r.json()["eventos"] if e["grupo"] == "alerta"][0] == "Paola Coordinadora tomó la alerta «Sin registrar gestión»"
        # Los ingresos hechos juntos (armar el equipo del mes) van en un solo evento.
        equipo = [e for e in r.json()["eventos"] if e["grupo"] == "equipo"]
        assert [(e["titulo"], e["detalle"]) for e in equipo] == [
            ("Equipo del mes: 4 asesores", "Desde el 01/10: Diaz, Prueba, Escobar, Prueba, Franco, Prueba, Gomez, Beto.")]
        assert (await ac.get(f"{BASE}/supervisores/no-existe/linea", headers=coord)).status_code == 404
        assert (await ac.get(f"{BASE}/supervisores/{s1}/linea", headers=sup1)).status_code == 403

        # ---- Ficha del asesor: equipo, puntaje, ventas y uso, coachings, tickets y alertas de uso.
        r = await ac.get(f"{BASE}/asesores/{rob_id}", headers=analista, params={"periodo": "2026-10"})
        assert r.status_code == 200, r.text
        f = r.json()
        assert f["asesor"]["nombre"] == "Riveros, Roberto Carlos" and f["supervisor"] == {"id": s1, "nombre": "Silvia Uno"}
        assert f["tramos"] == [{"desde": "2026-10-01", "hasta": "2026-10-31", "supervisor_id": s1, "supervisor": "Silvia Uno"}]
        assert f["netas"] == {"pospago": 5, "gpon": 0} and f["ventas"]["fecha_dato"] == "2026-10-08" and f["uso"]["alerta"] and f["uso"]["pct_sin_uso"] == 60.0
        assert f["scoring"]["total"] is not None and {x["clave"] for x in f["scoring"]["componentes"]} == {"pospago", "uso", "conversacion", "gpon"}
        assert [(x["estado"], x["metrica"], x["resultado"] is not None) for x in f["coachings"]] == [("cerrado", "uso", True)]
        assert [x["numero"] for x in f["tickets"]] == [2] and not f["puede_enviar"]
        assert [(x["desde"], x["vence"], x["estado"]) for x in f["alertas_uso"]] == [("2026-10-08", "2026-10-15", "cubierta")]
        assert (await ac.get(f"{BASE}/asesores/{ana_id}", headers=coord)).json()["alertas_uso"] == []
        assert (await ac.get(f"{BASE}/asesores/no-existe", headers=coord)).status_code == 404
        assert (await ac.get(f"{BASE}/asesores/{rob_id}", headers=sup1)).status_code == 403
