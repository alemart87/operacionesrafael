"""Herramientas de consulta (nivel 1): los datos de cada módulo, con las reglas de su pantalla.

Cada una llama a los mismos endpoints que usa la pantalla del módulo, con el usuario real, y devuelve un resumen
compacto (con el enlace a la pantalla para ver el detalle). Quien no tiene «Gestión» de un módulo ve solo lo publicado.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from ...operativas.televentas_claro.auditoria import api as aud_api
from ...operativas.televentas_claro.informe_diario import api as inf_api
from ...operativas.televentas_claro.informe_diario import importar as imp
from ...operativas.televentas_claro.productividad import api as prod_api
from ...operativas.televentas_claro.sph import api as sph_api
from ...operativas.televentas_claro.supervision import api as sup_api
from ...operativas.televentas_claro.supervision import comando_api, tickets_api
from ...operativas.televentas_claro.ventas_netas import api as vn_api
from ..config import ahora_local
from .base import (TC, Ctx, ErrorHerramienta, Herramienta, compactar, esquema, fecha, horas, llamar, periodo,
                   registrar, seleccionar)

P_PROD, P_PROD_G = f"{TC}.productividad", f"{TC}.productividad_gestion"
P_VN, P_VN_G = f"{TC}.ventas_netas", f"{TC}.ventas_netas_gestion"
P_SPH, P_SPH_G = f"{TC}.sph", f"{TC}.sph_gestion"
P_SUP, P_TICKETS, P_INF, P_AUD = f"{TC}.supervision", f"{TC}.tickets", f"{TC}.informe_diario", f"{TC}.auditoria"
P_OPER = f"{TC}.operadores"
GESTION_AUD = frozenset({"superadmin", "gestion"})
TODOS = frozenset({"superadmin", "gestion", "auditor"})

_FECHA = {"type": "string", "description": "Día en formato AAAA-MM-DD. Si no se indica, hoy."}
_MES = {"type": "string", "description": "Mes en formato AAAA-MM. Si no se indica, el mes en curso."}


def hoy():
    return ahora_local().date()


def _publicado(snap: dict[str, Any], user, permiso_gestion: str, que: str) -> dict[str, Any]:
    if snap.get("estado") == "borrador" and not user.has_perm(permiso_gestion):
        raise ErrorHerramienta(f"{que} todavía no está publicado; cuando lo publiquen lo vas a poder consultar")
    return snap


async def _snapshot(ctx: Ctx, tipo: str, ref: str) -> dict[str, Any]:
    try:
        return await imp.importar(ctx.db, ctx.user, tipo, ref)
    except imp.FuenteNoDisponible as exc:
        raise ErrorHerramienta(str(exc)) from exc
    except PermissionError as exc:
        raise ErrorHerramienta("No tenés acceso a ese módulo") from exc


def _limpio(snap: dict[str, Any]) -> dict[str, Any]:
    return compactar(seleccionar(snap, ("titulo", "subtitulo", "fecha", "estado", "aviso", "kpis", "filas", "valores", "url")))


# ------------------------------------------------------------------ estado de los datos
async def _estado(ctx: Ctx, _: dict[str, Any]) -> Any:
    u, db = ctx.user, ctx.db
    out: dict[str, Any] = {"hoy": hoy().isoformat()}
    if u.has_perm(P_PROD):
        r = await llamar(prod_api.listar_informes, user=u, db=db)
        items = r.get("items", [])
        pub = [i for i in items if i.get("status") == "published"]
        out["productividad"] = {"ultimo_publicado": pub[0]["fecha"] if pub else None,
                                "borradores": [i["fecha"] for i in items if i.get("status") == "draft"][:10]
                                if u.has_perm(P_PROD_G) else None,
                                "pantalla": "/televentas-claro/productividad"}
    if u.has_perm(P_VN):
        r = (await llamar(vn_api.list_reports, user=u, db=db)).model_dump(mode="json")
        items = r.get("items", [])
        out["ventas_netas"] = {"informes": [seleccionar(i, ("periodo", "fecha_dato", "status", "netas")) for i in items[:6]],
                               "pantalla": "/televentas-claro/ventas-netas"}
    if u.has_perm(P_SPH):
        r = await llamar(sph_api.listar_informes, user=u, db=db)
        out["sph"] = {"informes": [seleccionar(i, ("tipo", "desde", "hasta", "status")) for i in r.get("items", [])[:8]],
                      "pantalla": "/televentas-claro/sph"}
    if u.has_perm(P_INF):
        r = await llamar(inf_api.mis_informes, desde=None, hasta=None, user=u, db=db)
        out["informe_diario"] = {"de_hoy": (r.get("de_hoy") or {}).get("estado") if r.get("de_hoy") else "sin preparar",
                                 "compromisos_abiertos": (r.get("compromisos") or {}).get("abiertos"),
                                 "pantalla": "/televentas-claro/informe-diario"}
    if len(out) == 1:
        raise ErrorHerramienta("No tenés acceso a módulos con datos cargados")
    return compactar(out)


registrar(Herramienta(
    nombre="estado_de_los_datos", etiqueta="Revisando qué datos hay cargados",
    descripcion=("Qué datos hay cargados en la plataforma y hasta qué fecha, por módulo (productividad, ventas netas, "
                 "SPH, informe diario): último día publicado, borradores pendientes (si el usuario gestiona) y el enlace "
                 "a cada pantalla. Usala cuando pregunten «cómo están los datos», qué falta cargar, o antes de un "
                 "análisis para saber qué períodos existen."),
    esquema=esquema(), fn=_estado, permisos=(P_PROD, P_VN, P_SPH, P_INF), modos=TODOS))


# ------------------------------------------------------------------ productividad de llamadas
async def _prod_dia(ctx: Ctx, a: dict[str, Any]) -> Any:
    d = fecha(a.get("fecha"), defecto=hoy())
    snap = _publicado(await _snapshot(ctx, "llamadas", d.isoformat()), ctx.user, P_PROD_G, "El informe de ese día")
    return _limpio(snap)


registrar(Herramienta(
    nombre="productividad_del_dia", etiqueta="Consultando la productividad del día",
    descripcion=("Productividad de llamadas de un día: agentes, horas conectadas, % de conversación y banda contra la "
                 "meta, llamadas, contacto, AHT, alertas y el detalle por turno. Usala para preguntas sobre un día "
                 "puntual (hoy, ayer, una fecha)."),
    esquema=esquema({"fecha": _FECHA}), fn=_prod_dia, permisos=(P_PROD,), modos=GESTION_AUD))


async def _prod_rango(ctx: Ctx, a: dict[str, Any]) -> Any:
    hasta = fecha(a.get("hasta"), "hasta", defecto=hoy())
    desde = fecha(a.get("desde"), "desde", defecto=hasta.replace(day=1))
    if desde > hasta:
        desde, hasta = hasta, desde
    if (hasta - desde).days > 92:
        raise ErrorHerramienta("El rango puede ser de hasta 93 días")
    r = await llamar(prod_api.acumulado, desde=desde, hasta=hasta, user=ctx.user, db=ctx.db)
    ac = r.get("acumulado") or {}
    if not ac or not ac.get("dias"):
        raise ErrorHerramienta(f"No hay días publicados de productividad entre {desde:%d/%m} y {hasta:%d/%m}")
    k = ac.get("kpis") or {}
    kpis = seleccionar(k, ("agentes", "agentes_por_dia", "llamadas", "llamadas_por_dia", "atendidas", "pct_conversacion",
                           "banda", "bandas", "pct_contacto", "prom_conversacion", "aht", "llamadas_hora", "pct_disponible",
                           "pct_pausa", "pct_gestion", "dias_sesion_abierta", "dias_sin_llamadas"))
    kpis["horas_conectadas"], kpis["horas_conversacion"] = horas(k.get("login")), horas(k.get("conversacion"))
    agentes = [x for x in ac.get("agentes") or [] if (x.get("llamadas") or 0) >= 20]
    agentes.sort(key=lambda x: x.get("pct_conversacion") or 0, reverse=True)
    fila = ("nombre", "pct_conversacion", "banda", "llamadas", "pct_contacto", "aht", "dias", "alertas")
    return compactar({
        "desde": desde.isoformat(), "hasta": hasta.isoformat(), "kpis": kpis,
        "parametros_meta": seleccionar(ac.get("parametros") or {}, ("meta_min", "meta_max", "rojo")),
        "por_dia": [seleccionar(x, ("fecha", "agentes", "llamadas", "pct_conversacion", "banda", "pct_contacto", "aht"))
                    for x in ac.get("dias") or []],
        "tramo_mejor": ac.get("tramo_mejor"), "tramo_peor": ac.get("tramo_peor"),
        "mejores_agentes": [seleccionar(x, fila) for x in agentes[:6]],
        "agentes_a_mejorar": [seleccionar(x, fila) for x in agentes[-6:][::-1]] if len(agentes) > 6 else [],
        "dias_pendientes_de_publicar": r.get("pendientes_publicar") or None,
        "pantalla": "/televentas-claro/productividad/acumulado",
    }, max_lista=40)


registrar(Herramienta(
    nombre="productividad_por_rango", etiqueta="Consultando la productividad acumulada",
    descripcion=("Productividad de llamadas acumulada entre dos fechas (hasta 93 días, solo días publicados): totales, "
                 "% de conversación contra la meta, contacto, AHT, la serie por día, el mejor y peor tramo horario, y los "
                 "agentes con mejor y peor % de conversación. Usala para semanas, meses, comparaciones o tendencias."),
    esquema=esquema({"desde": {"type": "string", "description": "AAAA-MM-DD; por defecto, el 1° del mes de «hasta»."},
                     "hasta": {"type": "string", "description": "AAAA-MM-DD; por defecto, hoy."}}),
    fn=_prod_rango, permisos=(P_PROD,), modos=GESTION_AUD))


# ------------------------------------------------------------------ ventas netas y cargas
async def _ventas_dia(ctx: Ctx, a: dict[str, Any]) -> Any:
    d = fecha(a.get("fecha"), defecto=hoy())
    snap = _publicado(await _snapshot(ctx, "cargas", d.isoformat()), ctx.user, P_VN_G, "La planilla de netas de ese mes")
    return _limpio(snap)


registrar(Herramienta(
    nombre="ventas_del_dia", etiqueta="Consultando las ventas del día",
    descripcion=("Ventas cargadas en un día según la planilla de netas más nueva del mes: Pospago, GPON (internet) e "
                 "IPTV del día y las netas acumuladas del mes. Usala para «cuánto vendimos hoy/ayer» o para completar "
                 "los resultados del informe diario."),
    esquema=esquema({"fecha": _FECHA}), fn=_ventas_dia, permisos=(P_VN,), modos=TODOS))


async def _ventas_mes(ctx: Ctx, a: dict[str, Any]) -> Any:
    per = periodo(a.get("mes"), hoy().strftime("%Y-%m"))
    lista = (await llamar(vn_api.list_reports, user=ctx.user, db=ctx.db)).items
    del_mes = [r for r in lista if r.periodo == per]
    if not del_mes:
        raise ErrorHerramienta(f"No hay informe de ventas netas {'publicado ' if not ctx.user.has_perm(P_VN_G) else ''}"
                               f"de {imp.mes_nombre(per)}")
    elegido = next((r for r in del_mes if r.status == "published"), del_mes[0])
    rep = await llamar(vn_api.get_report, report_id=elegido.id, request=ctx.request(), user=ctx.user, db=ctx.db)
    data = rep.data or {}
    k = data.get("kpis") or {}
    alertas = sorted(data.get("alertas") or [], key=lambda x: -(x.get("pct_sin_uso") or 0))
    vendedores = sorted(data.get("vendedores") or [], key=lambda x: -(x.get("netas") or x.get("total") or 0))
    return compactar({
        "mes": per, "estado": elegido.status, "fecha_dato": str(elegido.fecha_dato) if elegido.fecha_dato else None,
        "totales": {"netas": elegido.netas, "pospago": elegido.pospago, "gpon": elegido.gpon, "iptv": elegido.iptv,
                    "pospago_sin_uso": elegido.pospago_sin_uso, "pct_sin_uso": elegido.pct_sin_uso},
        "indicadores": seleccionar(k, ("portadas", "nativas", "pct_portacion", "pospago_con_uso", "pospago_en_espera",
                                       "pct_uso", "suspendidas", "vendedores", "vendedores_alerta", "cargas",
                                       "cargas_finalizadas", "finalizadas_sin_activar", "pendientes",
                                       "umbral_critico_sin_uso_pct", "min_lineas_alerta", "dias_espera_uso")),
        "por_producto": data.get("por_producto"),
        "cargas_por_dia": ((data.get("productividad") or {}).get("por_dia")),
        "vendedores_en_alerta": alertas[:15],
        "vendedores_con_mas_netas": vendedores[:10],
        "pendientes": seleccionar(data.get("pendientes") or {}, ("total", "portacion", "por_estado")),
        "pantalla": f"/televentas-claro/ventas-netas/reports/{elegido.id}",
    }, max_lista=35)


registrar(Herramienta(
    nombre="ventas_del_mes", etiqueta="Consultando las ventas netas del mes",
    descripcion=("Informe de ventas netas de un mes: netas, Pospago, GPON e IPTV, uso de las líneas (sin uso, en "
                 "espera), portabilidad, cargas por día, vendedores en alerta por líneas sin uso, los que más venden y "
                 "pendientes. Usala para el mes, el avance de ventas o las alertas de uso de líneas."),
    esquema=esquema({"mes": _MES}), fn=_ventas_mes, permisos=(P_VN,), modos=TODOS))


# ------------------------------------------------------------------ SPH
async def _sph(ctx: Ctx, a: dict[str, Any]) -> Any:
    r = await llamar(sph_api.listar_informes, user=ctx.user, db=ctx.db)
    items = r.get("items", [])
    if not ctx.user.has_perm(P_SPH_G):
        items = [i for i in items if i.get("status") == "published"]
    tipo = a.get("tipo")
    desde = a.get("desde")
    if tipo:
        items = [i for i in items if i.get("tipo") == tipo]
    if desde:
        d = fecha(desde, "desde")
        items = [i for i in items if i.get("desde") <= d.isoformat() <= i.get("hasta")] or \
                [i for i in items if i.get("desde") >= d.isoformat()]
    if not items:
        raise ErrorHerramienta("No hay informes de SPH publicados para ese período")
    elegido = items[0]
    rep = await llamar(sph_api.ver_informe, informe_id=elegido["id"], request=ctx.request(), user=ctx.user, db=ctx.db)
    data = rep.get("data") or {}
    k = dict(data.get("kpis") or {})
    k["horas"], k["horas_vinculadas"] = horas(k.get("horas")), horas(k.get("horas_vinculadas"))
    ranking = [x for x in data.get("agentes") or [] if x.get("en_ranking")]
    ranking.sort(key=lambda x: x.get("sph") or 0, reverse=True)
    fila = ("nombre", "sph", "netas", "cargadas", "llamadas", "nivel")
    return compactar({
        "periodo": seleccionar(elegido, ("tipo", "desde", "hasta", "status")),
        "kpis": k, "serie": data.get("serie"), "avisos": data.get("avisos"),
        "mejores": [dict(seleccionar(x, fila), horas=horas(x.get("login"))) for x in ranking[:6]],
        "a_mejorar": [dict(seleccionar(x, fila), horas=horas(x.get("login"))) for x in ranking[-6:][::-1]] if len(ranking) > 6 else [],
        "otros_informes": [seleccionar(i, ("tipo", "desde", "hasta")) for i in items[1:8]],
        "pantalla": f"/televentas-claro/sph/informes/{elegido['id']}",
    }, max_lista=35)


registrar(Herramienta(
    nombre="sph", etiqueta="Consultando el SPH",
    descripcion=("SPH estimado (ventas netas por hora conectada) de un informe: el de la operación, la serie por día, "
                 "cobertura del cruce de nombres, avisos de calidad del dato y los asesores con mejor y peor SPH. Sin "
                 "parámetros devuelve el informe más reciente. Usala para preguntas de SPH o rendimiento por hora."),
    esquema=esquema({"tipo": {"type": "string", "enum": ["dia", "semana", "mes", "rango"],
                              "description": "Tipo de informe a buscar."},
                     "desde": {"type": "string", "description": "AAAA-MM-DD: un día dentro del período buscado."}}),
    fn=_sph, permisos=(P_SPH,), modos=GESTION_AUD))


# ------------------------------------------------------------------ supervisión
async def _supervision(ctx: Ctx, a: dict[str, Any]) -> Any:
    per = periodo(a.get("mes"), hoy().strftime("%Y-%m"))
    r = await llamar(sup_api.resumen, periodo=per, user=ctx.user, db=ctx.db)
    return compactar({**seleccionar(r, ("periodo", "nombre_mes", "referencia", "calendario", "operacion", "supervisores",
                                        "sin_supervisor", "equipos_cargados", "parametros")),
                      "pantalla": "/televentas-claro/supervision"})


registrar(Herramienta(
    nombre="supervision_del_mes", etiqueta="Consultando objetivos y proyección",
    descripcion=("Objetivos del mes de Pospago y GPON, lo vendido, lo esperado al corte, la proyección al cierre, lo que "
                 "falta y el ritmo necesario: de la operación y de cada supervisor, con asesores en alerta y supervisores "
                 "críticos. Usala para «cómo venimos», proyección, cumplimiento de objetivos o por supervisor."),
    esquema=esquema({"mes": _MES}), fn=_supervision, permisos=(P_SUP,), modos=GESTION_AUD))


async def _comando(ctx: Ctx, a: dict[str, Any]) -> Any:
    r = await llamar(comando_api.centro, user=ctx.user, db=ctx.db)
    estados = set(a.get("estados") or ["abierta", "tomada"])
    alertas = [seleccionar(x, ("id", "tipo_nombre", "severidad", "estado", "titulo", "detalle", "supervisor", "operador",
                               "desde", "nueva", "nota", "ticket_numero", "puede_revision"))
               for x in r.get("alertas") or [] if x.get("estado") in estados]
    return compactar({
        "hoy": r.get("hoy"), "cabecera": r.get("cabecera"), "resumen_alertas": r.get("resumen_alertas"),
        "alertas": alertas,
        "semaforo_supervisores": [seleccionar(x, ("nombre", "estado", "motivos", "score")) for x in r.get("supervisores") or []],
        "reglas": r.get("reglas"), "puede_actuar": r.get("puede_actuar"), "puede_derivar": r.get("puede_derivar"),
        "pantalla": "/televentas-claro/supervision/comando",
    }, max_lista=30)


registrar(Herramienta(
    nombre="centro_de_comandos", etiqueta="Revisando el centro de comandos",
    descripcion=("El centro de comandos de hoy: cabecera de la operación, semáforo de supervisores con sus motivos y las "
                 "alertas (proyección baja, tickets o seguimientos vencidos, asesores sin uso de líneas, sin actividad, "
                 "sin supervisor o sin vincular), con su id, estado y si se pueden derivar a un ticket. Usala para "
                 "alertas, prioridades del día o antes de tomar, descartar o derivar una alerta."),
    esquema=esquema({"estados": {"type": "array", "items": {"type": "string", "enum": [
        "abierta", "tomada", "derivada", "descartada", "cerrada"]}, "description": "Por defecto: abierta y tomada."}}),
    fn=_comando, permisos=(P_SUP,), modos=TODOS))


async def _tickets(ctx: Ctx, a: dict[str, Any]) -> Any:
    vista = a.get("vista") if a.get("vista") in ("abiertos", "mes") else "abiertos"
    r = await llamar(tickets_api.listar, periodo=None, vista=vista, supervisor_id=None, mios=bool(a.get("mios")),
                     user=ctx.user, db=ctx.db)
    items = [{**seleccionar(x, ("numero", "tipo_nombre", "prioridad", "estado", "supervisor", "operador", "fecha_caso",
                                 "referencia", "descripcion", "creado_por_nombre", "created_at", "reaperturas")),
              "plazo": (x.get("sla") or {}).get("situacion")}
             for x in r.get("items") or []]
    return compactar({"vista": vista, "items": items, "bandeja": r.get("bandeja"), "mes": r.get("mes"),
                      "supervisores": [seleccionar(x, ("nombre", "bandeja")) for x in r.get("supervisores") or []],
                      "pantalla": "/televentas-claro/supervision/tickets"}, max_lista=30)


registrar(Herramienta(
    nombre="tickets_de_revision", etiqueta="Revisando los tickets de revisión",
    descripcion=("Tickets de revisión enviados a los supervisores: los abiertos (o los del mes), con tipo, prioridad, "
                 "estado, asesor, situación del plazo (en plazo, por vencer, vencido) y las métricas por supervisor. "
                 "Usala para seguimiento de casos, vencimientos o antes de enviar un ticket nuevo."),
    esquema=esquema({"vista": {"type": "string", "enum": ["abiertos", "mes"]},
                     "mios": {"type": "boolean", "description": "Solo los que envió el usuario."}}),
    fn=_tickets, permisos=(P_SUP,), modos=TODOS))        # la bandeja pide Supervisión (como la pantalla)


async def _coaching_dia(ctx: Ctx, a: dict[str, Any]) -> Any:
    d = fecha(a.get("fecha"), defecto=hoy())
    return _limpio(await _snapshot(ctx, "coaching", d.isoformat()))


registrar(Herramienta(
    nombre="coaching_del_dia", etiqueta="Consultando el coaching del día",
    descripcion=("Coachings registrados en un día por los supervisores, los seguimientos hechos con su resultado y los "
                 "seguimientos vencidos. Usala para preguntas de coaching de un día."),
    esquema=esquema({"fecha": _FECHA}), fn=_coaching_dia, permisos=(P_SUP,), modos=GESTION_AUD))


async def _personas(ctx: Ctx, a: dict[str, Any]) -> Any:
    q = (a.get("texto") or "").strip().lower()
    if len(q) < 2:
        raise ErrorHerramienta("Escribí al menos 2 letras del nombre")
    if ctx.user.has_perm(P_TICKETS):
        r = await llamar(tickets_api.opciones, user=ctx.user, db=ctx.db)
        asesores = r.get("asesores") or []
        sups = r.get("supervisores") or []
    else:
        r = await llamar(sup_api.listar_operadores, periodo=None, user=ctx.user, db=ctx.db)
        asesores = r.get("items") or []
        sups = (await llamar(sup_api.listar_supervisores, user=ctx.user, db=ctx.db)).get("items") or []

    def coincide(x: dict[str, Any]) -> bool:
        return any(q in str(x.get(k) or "").lower() for k in ("nombre", "agente", "vendedor"))

    return compactar({
        "asesores": [seleccionar(x, ("id", "nombre", "agente", "vendedor", "supervisor", "supervisor_id"))
                     for x in asesores if coincide(x)][:15],
        "supervisores": [seleccionar(x, ("id", "nombre", "activo")) for x in sups if coincide(x)][:10],
    })


registrar(Herramienta(
    nombre="buscar_personas", etiqueta="Buscando asesores y supervisores",
    descripcion=("Busca asesores (con su supervisor de hoy) y supervisores por parte del nombre y devuelve sus ids. Usala "
                 "antes de una acción que necesita el id de un asesor o supervisor (por ejemplo, enviar un ticket)."),
    esquema=esquema({"texto": {"type": "string", "description": "Parte del nombre."}}, ["texto"]),
    fn=_personas, permisos=(P_TICKETS, P_OPER, P_SUP), modos=TODOS))


# ------------------------------------------------------------------ informe diario
async def _informes(ctx: Ctx, a: dict[str, Any]) -> Any:
    hasta = fecha(a.get("hasta"), "hasta", defecto=hoy())
    desde = fecha(a.get("desde"), "desde", defecto=hasta - timedelta(days=13))
    r = await llamar(inf_api.mis_informes, desde=desde, hasta=hasta, user=ctx.user, db=ctx.db)
    items = [seleccionar(x, ("id", "fecha", "estado", "autor", "resumen", "pospago", "gpon", "metricas", "criticas",
                             "comentarios", "firmado_at")) for x in r.get("items") or []]
    return compactar({"hoy": r.get("hoy"), "de_hoy": r.get("de_hoy"), "racha": r.get("racha"), "informes": items,
                      "compromisos": r.get("compromisos"), "pantalla": "/televentas-claro/informe-diario"}, max_lista=20)


registrar(Herramienta(
    nombre="informes_diarios", etiqueta="Consultando tus informes diarios",
    descripcion=("Los informes diarios PROPIOS del usuario entre dos fechas: estado (borrador o firmado), resultados, "
                 "resumen, comentarios, la racha de días y sus compromisos abiertos o vencidos (con su id, para "
                 "registrar el seguimiento al preparar el informe). Usala antes de preparar uno. Para los informes de "
                 "todo el equipo, el superadmin usa seguimiento_informes_diarios."),
    esquema=esquema({"desde": {"type": "string", "description": "AAAA-MM-DD (por defecto, hace 13 días)."},
                     "hasta": {"type": "string", "description": "AAAA-MM-DD (por defecto, hoy)."}}),
    fn=_informes, permisos=(P_INF,), modos=GESTION_AUD))


async def _seguimiento_informes(ctx: Ctx, a: dict[str, Any]) -> Any:
    hasta = fecha(a.get("hasta"), "hasta", defecto=hoy())
    desde = fecha(a.get("desde"), "desde", defecto=hasta - timedelta(days=13))
    r = await llamar(inf_api.seguimiento, desde=desde, hasta=hasta, autor_id=(a.get("autor_id") or None),
                     user=ctx.user, db=ctx.db)
    autores = [{**seleccionar(x, ("id", "nombre", "cargo", "firmados", "esperados", "pct")),
                "faltan_dias": [d["fecha"] for d in x.get("dias") or [] if d.get("estado") in ("falta", "borrador")]}
               for x in r.get("autores") or []]
    informes = [seleccionar(x, ("id", "fecha", "autor", "estado", "resumen", "pospago", "gpon", "criticas", "nivel",
                                "comentarios", "revisado_at", "tarde")) for x in r.get("informes") or []]
    palabras = r.get("palabras") or {}
    return compactar({"desde": r.get("desde"), "hasta": r.get("hasta"), "kpis": r.get("kpis"), "autores": autores,
                      "informes": informes, "compromisos_abiertos": r.get("compromisos"),
                      "alertas_de_palabras": (palabras.get("alertas") or [])[:10],
                      "pantalla": "/televentas-claro/informe-diario/seguimiento"}, max_lista=25)


registrar(Herramienta(
    nombre="seguimiento_informes_diarios", etiqueta="Revisando el seguimiento de los informes diarios",
    descripcion=("Solo superadmin: el seguimiento de los informes diarios de todo el equipo en un rango (hasta 92 días; "
                 "por defecto, los últimos 14): cumplimiento por autor (firmados contra esperados y los días que faltan), "
                 "los informes con su id, resumen, métricas críticas y si ya se revisaron, los compromisos abiertos y "
                 "las alertas por palabras clave. Usala para saber quién no informó, qué está crítico o qué falta "
                 "revisar, y antes de comentar un informe."),
    esquema=esquema({"desde": {"type": "string", "description": "AAAA-MM-DD"},
                     "hasta": {"type": "string", "description": "AAAA-MM-DD"},
                     "autor_id": {"type": "string", "description": "Solo un autor (opcional)."}}),
    fn=_seguimiento_informes, modos=frozenset({"superadmin"})))


# ------------------------------------------------------------------ auditoría de ventas
async def _auditorias(ctx: Ctx, a: dict[str, Any]) -> Any:
    lista = await llamar(aud_api.listar, user=ctx.user, db=ctx.db)
    d = compactar(lista)
    # El enlace de cada informe va armado: Voi nunca tiene que inventarlo (la ruta lleva «/informes/»).
    for it in d.get("items") or [] if isinstance(d, dict) else []:
        if isinstance(it, dict) and it.get("id"):
            it["pantalla"] = f"/televentas-claro/auditoria/informes/{it['id']}"
    if a.get("id"):
        det = await llamar(aud_api.detalle, auditoria_id=str(a["id"]), user=ctx.user, db=ctx.db)
        det = compactar(det, max_lista=30)
        return {"detalle": det, "pantalla": f"/televentas-claro/auditoria/informes/{det.get('id') or a['id']}"}
    return {**d, "pantalla": "/televentas-claro/auditoria"}


async def _alertas_corte(ctx: Ctx, a: dict[str, Any]) -> Any:
    """Un solo llamado con lo que el auditor mira primero: netas y cargas del último corte publicado de Ventas Netas,
    con los vendedores críticos, los datos llamativos y los hallazgos automáticos, ya resumidos."""
    from ...operativas.televentas_claro.auditoria.schemas import RiesgosRequest
    from ...operativas.televentas_claro.auditoria.snapshot import hallazgos_automaticos

    lista = (await llamar(vn_api.list_reports, user=ctx.user, db=ctx.db)).items
    publicados = [r for r in lista if r.status == "published"]
    if a.get("mes"):
        per = periodo(a.get("mes"), hoy().strftime("%Y-%m"))
        publicados = [r for r in publicados if r.periodo == per]
    if not publicados:
        raise ErrorHerramienta("No hay un corte publicado de Ventas Netas" + (f" de {a['mes']}" if a.get("mes") else "") +
                               ": pedí que lo publiquen desde Ventas Netas.")
    elegido = publicados[0]                      # la lista viene del más nuevo al más viejo
    snap = await llamar(aud_api.riesgos, payload=RiesgosRequest(report_ids=[elegido.id]), request=ctx.request(),
                        user=ctx.user, db=ctx.db)
    k = snap.get("kpis") or {}
    ranking = snap.get("ranking") or []
    criticos = sorted((v for v in ranking if v.get("nivel") == "critico"), key=lambda v: -(v.get("pct_sin_uso") or 0))
    atencion = sorted((v for v in ranking if v.get("nivel") == "atencion"), key=lambda v: -(v.get("puntaje") or 0))
    vendedor = lambda v: {  # noqa: E731
        "vendedor": v.get("vendedor"), "netas": v.get("netas"), "pospago": v.get("pospago"), "sin_uso": v.get("sin_uso"),
        "pct_sin_uso": v.get("pct_sin_uso"), "sali_sin_uso": v.get("sali_sin_uso"), "suspendidas": v.get("suspendidas"),
        "en_espera": v.get("en_espera"), "senales": [x.get("texto") for x in (v.get("senales") or [])][:4]}
    hallazgos = [{"titulo": h.get("titulo"), "severidad": h.get("severidad"), "categoria": h.get("categoria"),
                  "vendedor": h.get("vendedor")} for h in hallazgos_automaticos(snap)]
    llamativos = sorted(snap.get("llamativos") or [], key=lambda x: {"alta": 0, "media": 1}.get(x.get("gravedad"), 2))
    return compactar({
        "corte": {"mes": elegido.periodo, "fecha_dato": str(elegido.fecha_dato) if elegido.fecha_dato else None,
                  "report_id": elegido.id, "pantalla": f"/televentas-claro/ventas-netas/reports/{elegido.id}"},
        "netas": seleccionar(k, ("netas", "pospago", "gpon", "iptv", "portadas", "pospago_sin_uso", "pct_sin_uso",
                                 "en_espera", "suspendidas", "sali_total", "sali_sin_uso", "sali_pct_sin_uso",
                                 "total_sin_uso")),
        "cargas": seleccionar(k, ("cargas", "cargas_finalizadas", "pct_finalizacion", "cargas_a_confirmar",
                                  "cargas_rechazadas", "pendientes", "finalizadas_sin_activar", "riesgo_alto",
                                  "sin_uso_riesgo_alto")),
        "vendedores": {"total": k.get("vendedores"), "criticos": k.get("vendedores_criticos"),
                       "alerta_media": k.get("vendedores_atencion"), "umbral_critico_pct": (snap.get("parametros") or {}).get("umbral_sin_uso_critico")},
        "criticos": [vendedor(v) for v in criticos[:8]],
        "alerta_media": [vendedor(v) for v in atencion[:5]],
        "datos_llamativos": [seleccionar(x, ("gravedad", "titulo", "cifra", "detalle")) for x in llamativos[:8]],
        "hallazgos_automaticos": hallazgos[:12],
        "advertencias": snap.get("advertencias") or None,
        "indicaciones": ("Respondé en pocas líneas: las 3 a 5 alertas más graves con su cifra y vendedor. Para profundizar "
                         "(líneas, cargas por día, un vendedor) usá ventas_del_mes o el lienzo; el centro de comandos y los "
                         "tickets, solo si el usuario quiere seguir investigando."),
    }, max_lista=12)


registrar(Herramienta(
    nombre="alertas_del_corte", etiqueta="Revisando las alertas del último corte de Ventas Netas",
    descripcion=("EL PRIMER PASO de cualquier investigación de auditoría, en un solo llamado: netas y cargas del último "
                 "corte publicado de Ventas Netas (o del mes pedido) con los vendedores críticos y en alerta media, los "
                 "datos llamativos y los hallazgos automáticos, ya resumidos. Usala antes que ventas_del_mes, el centro "
                 "de comandos o los tickets: con esto alcanza para decir qué no cierra; lo demás es para profundizar."),
    esquema=esquema({"mes": _MES}), fn=_alertas_corte, permisos=(P_AUD,), modos=TODOS))


registrar(Herramienta(
    nombre="auditorias_de_ventas", etiqueta="Consultando las auditorías de ventas",
    descripcion=("Informes de auditoría de ventas: estado, período, riesgos, hallazgos y seguimientos. Sin «id» lista "
                 "los informes; con «id» trae el detalle de uno (hallazgos, evidencia resumida y seguimientos). Usala "
                 "para preguntas de auditoría, riesgos de vendedores o hallazgos pendientes."),
    esquema=esquema({"id": {"type": "string", "description": "Id del informe de auditoría (opcional)."}}),
    fn=_auditorias, permisos=(P_AUD,), modos=TODOS))
