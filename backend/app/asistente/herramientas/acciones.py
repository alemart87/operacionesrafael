"""Herramientas de acción: Voi hace cosas en la plataforma con los mismos servicios (y reglas) que las pantallas.

- Nivel 2 (lo propio): preparar el borrador del informe diario. Corre sola (configurable) y nunca firma.
- Nivel 3 (afecta a otros): enviar un ticket de revisión, tomar, descartar o derivar una alerta del centro de comandos.
  La plataforma muestra una tarjeta con lo que va a hacer y espera que el usuario confirme.
"""
from __future__ import annotations

import uuid
from typing import Any

from starlette.responses import Response

from ...operativas.televentas_claro.informe_diario import api as inf_api
from ...operativas.televentas_claro.informe_diario import informe as inf_srv
from ...operativas.televentas_claro.informe_diario.models import FIRMADO
from ...operativas.televentas_claro.supervision import comando_api, tickets_api
from ...operativas.televentas_claro.supervision.models import AlertaComando, Operador
from ...operativas.televentas_claro.supervision import api as sup_api
from .base import (CONFIRMAR, PROPIO, TC, Ctx, ErrorHerramienta, Herramienta, compactar, esquema, fecha, llamar,
                   registrar, seleccionar, texto)
from .datos import hoy

P_INF, P_TICKETS, P_GESTION = f"{TC}.informe_diario", f"{TC}.tickets", f"{TC}.supervision_gestion"
GESTION = frozenset({"superadmin", "gestion"})
TIPOS_TICKET = ["venta_observada", "linea_sin_uso", "calidad", "reclamo", "conducta", "otro"]
NOMBRE_TIPO = {"venta_observada": "venta observada", "linea_sin_uso": "línea sin uso", "calidad": "calidad de atención",
               "reclamo": "reclamo", "conducta": "conducta", "otro": "otro"}
_RES = {"type": "object", "additionalProperties": False, "properties": {
    "valor": {"type": "number", "description": "Cantidad del día."},
    "meta": {"type": "number", "description": "Meta del día (opcional)."},
    "comentario": {"type": "string"}}}


# ------------------------------------------------------------------ informe diario (nivel 2)
async def _preparar_informe(ctx: Ctx, a: dict[str, Any]) -> Any:
    u, db = ctx.user, ctx.db
    d = fecha(a.get("fecha"), defecto=hoy())
    r = await llamar(inf_api.preparar, payload=inf_api.CrearPayload(fecha=d), request=ctx.request(), response=Response(),
                     user=u, db=db)
    inf = await inf_srv.del_autor(db, u.id, d)
    if inf is None:
        raise ErrorHerramienta("No se pudo abrir el informe")
    if inf.estado == FIRMADO:
        raise ErrorHerramienta(f"El informe del {d:%d/%m} ya está firmado: no se puede cambiar")
    cambios: list[str] = []
    resultados = dict(inf.resultados or {})
    for clave in ("pospago", "gpon"):
        nuevo = a.get(clave)
        if isinstance(nuevo, dict) and nuevo:
            resultados[clave] = {**(resultados.get(clave) or {"valor": None, "meta": None, "comentario": ""}),
                                 **{k: v for k, v in nuevo.items() if k in ("valor", "meta", "comentario") and v is not None}}
            cambios.append(f"resultado de {clave.upper() if clave == 'gpon' else 'Pospago'}")
    resumen = inf.resumen or ""
    if a.get("resumen"):
        resumen = texto(a["resumen"], "el resumen", minimo=20, maximo=5000)
        cambios.append("resumen")
    metricas = list(inf.metricas or [])
    for m in (a.get("metricas") or [])[: max(0, 20 - len(metricas))]:
        metricas.append({"id": uuid.uuid4().hex[:12], "nombre": texto(m.get("nombre"), "el nombre de la métrica", 2, 120),
                         "indicador": str(m.get("indicador") or "")[:60], "anterior": None,
                         "estado": m.get("estado") if m.get("estado") in ("critico", "atencion", "ok") else "critico",
                         "comentario": str(m.get("comentario") or "")[:1500], "compromiso": str(m.get("compromiso") or "")[:1000],
                         "responsable": str(m.get("responsable") or "")[:120],
                         "fecha_compromiso": m.get("fecha_compromiso") or None})
    if len(metricas) > len(inf.metricas or []):
        cambios.append(f"{len(metricas) - len(inf.metricas or [])} métrica(s) crítica(s)")
    payload = inf_api.GuardarPayload(resultados=resultados, resumen=resumen, metricas=metricas,
                                     seguimiento=inf.seguimiento or [], importados=[x["id"] for x in inf.importados or []])
    await llamar(inf_api.guardar, informe_id=inf.id, payload=payload, user=u, db=db)
    avisos: list[str] = []
    for tipo in a.get("importar") or []:
        ref = d.strftime("%Y-%m") if tipo == "proyeccion" else d.isoformat()
        try:
            await llamar(inf_api.importar, informe_id=inf.id, payload=inf_api.ImportarPayload(tipo=tipo, ref=ref),
                         request=ctx.request(), user=u, db=db)
            cambios.append(f"datos importados: {tipo}")
        except ErrorHerramienta as exc:
            avisos.append(f"{tipo}: {exc}")
    return compactar({"id": inf.id, "fecha": d.isoformat(), "nuevo": r.get("nuevo"), "estado": "borrador",
                      "cambios": cambios or ["sin cambios: el borrador quedó abierto"], "avisos": avisos or None,
                      "pantalla": f"/televentas-claro/informe-diario/{inf.id}",
                      "importante": "Quedó en borrador. Voi nunca firma: el usuario lo revisa y lo firma desde la pantalla."})


async def _resumen_informe(ctx: Ctx, a: dict[str, Any]) -> str:
    d = fecha(a.get("fecha"), defecto=hoy())
    partes = [p for p, k in (("resumen", "resumen"), ("resultados de Pospago", "pospago"), ("resultados de GPON", "gpon"),
                             ("métricas críticas", "metricas"), ("datos importados", "importar")) if a.get(k)]
    return f"Preparar el borrador del informe diario del {d:%d/%m}" + (f" con {', '.join(partes)}" if partes else "") + \
        ". Queda en borrador para que lo revises y lo firmes."


registrar(Herramienta(
    nombre="preparar_informe_diario", etiqueta="Preparando el borrador del informe diario", nivel=PROPIO,
    descripcion=("Abre (o retoma) el BORRADOR del informe diario del usuario para una fecha y le carga lo que le pases: "
                 "resultados del día de Pospago y GPON, el resumen, métricas críticas con su indicador, estado, "
                 "comentario y compromiso, e importa datos de la plataforma (llamadas, cargas del día, proyección o "
                 "coaching). Nunca firma: el usuario revisa y firma. Antes de usarla, consultá los datos del día para "
                 "proponer valores reales. Las métricas se agregan a las que ya tenga el borrador."),
    esquema=esquema({
        "fecha": {"type": "string", "description": "AAAA-MM-DD (hoy o hasta 7 días atrás). Por defecto, hoy."},
        "resumen": {"type": "string", "description": "Resumen del día (al menos 20 caracteres)."},
        "pospago": _RES, "gpon": _RES,
        "metricas": {"type": "array", "maxItems": 10, "items": {"type": "object", "additionalProperties": False,
                     "properties": {"nombre": {"type": "string"}, "indicador": {"type": "string"},
                                    "estado": {"type": "string", "enum": ["critico", "atencion", "ok"]},
                                    "comentario": {"type": "string"}, "compromiso": {"type": "string"},
                                    "responsable": {"type": "string"},
                                    "fecha_compromiso": {"type": "string", "description": "AAAA-MM-DD"}},
                     "required": ["nombre"]}},
        "importar": {"type": "array", "items": {"type": "string", "enum": ["llamadas", "cargas", "proyeccion", "coaching"]}},
    }),
    fn=_preparar_informe, resumen=_resumen_informe, permisos=(P_INF,), modos=GESTION))


# ------------------------------------------------------------------ ticket de revisión (nivel 3)
async def _enviar_ticket(ctx: Ctx, a: dict[str, Any]) -> Any:
    if a.get("tipo") not in TIPOS_TICKET:
        raise ErrorHerramienta(f"Tipo de ticket inválido; usá uno de: {', '.join(TIPOS_TICKET)}")
    if a.get("prioridad") not in ("alta", "media", "baja"):
        raise ErrorHerramienta("Prioridad inválida: alta, media o baja")
    payload = tickets_api.TicketPayload(
        tipo=a["tipo"], prioridad=a["prioridad"], operador_id=a.get("operador_id") or None,
        fecha_caso=fecha(a["fecha_caso"], "la fecha del caso") if a.get("fecha_caso") else None,
        supervisor_id=a.get("supervisor_id") or None, referencia=(a.get("referencia") or None),
        descripcion=texto(a.get("descripcion"), "la descripción", minimo=10, maximo=2000))
    r = await llamar(tickets_api.enviar, payload=payload, request=ctx.request(), user=ctx.user, db=ctx.db)
    return compactar({**seleccionar(r, ("numero", "tipo_nombre", "prioridad", "estado", "supervisor", "operador",
                                        "fecha_caso")),
                      "pantalla": "/televentas-claro/supervision/tickets"})


async def _resumen_ticket(ctx: Ctx, a: dict[str, Any]) -> str:
    destino = ""
    if a.get("operador_id"):
        o = await ctx.db.get(Operador, a["operador_id"])
        destino = f" sobre {o.nombre} (llega a su supervisor de ese día)" if o else ""
    elif a.get("supervisor_id"):
        nombres = await sup_api._nombres(ctx.db, {a["supervisor_id"]})
        destino = f" a {nombres.get(a['supervisor_id'], 'el supervisor')}"
    return (f"Enviar un ticket de revisión de {NOMBRE_TIPO.get(a.get('tipo'), a.get('tipo'))}, prioridad "
            f"{a.get('prioridad')}{destino}: «{str(a.get('descripcion') or '')[:300]}»")


registrar(Herramienta(
    nombre="enviar_ticket_revision", etiqueta="Enviando un ticket de revisión", nivel=CONFIRMAR,
    descripcion=("Envía un caso a revisión a un supervisor (ticket con plazos según la prioridad). Si nombra a un asesor "
                 "(operador_id), llega al supervisor que lo tenía el día del caso; si no, indicá supervisor_id. Usá "
                 "buscar_personas para obtener los ids. El usuario confirma antes de enviarlo."),
    esquema=esquema({
        "tipo": {"type": "string", "enum": TIPOS_TICKET}, "prioridad": {"type": "string", "enum": ["alta", "media", "baja"]},
        "descripcion": {"type": "string", "description": "Qué hay que revisar, con los datos del caso."},
        "operador_id": {"type": "string", "description": "Id del asesor (de buscar_personas)."},
        "supervisor_id": {"type": "string", "description": "Id del supervisor, si no hay asesor."},
        "fecha_caso": {"type": "string", "description": "AAAA-MM-DD, de los últimos días."},
        "referencia": {"type": "string", "description": "Línea, SDS u otra referencia (opcional)."},
    }, ["tipo", "prioridad", "descripcion"]),
    fn=_enviar_ticket, resumen=_resumen_ticket, permisos=(P_TICKETS,)))


# ------------------------------------------------------------------ alertas del centro de comandos (nivel 3)
async def _gestionar_alerta(ctx: Ctx, a: dict[str, Any]) -> Any:
    accion, alerta_id = a.get("accion"), str(a.get("alerta_id") or "")
    if not alerta_id:
        raise ErrorHerramienta("Falta el id de la alerta (sale de centro_de_comandos)")
    kw = {"alerta_id": alerta_id, "request": ctx.request(), "user": ctx.user, "db": ctx.db}
    if accion == "tomar":
        r = await llamar(comando_api.tomar, payload=comando_api.TomarPayload(nota=a.get("texto") or None), **kw)
    elif accion == "descartar":
        r = await llamar(comando_api.descartar, payload=comando_api.DescartarPayload(
            motivo=texto(a.get("texto"), "el motivo", minimo=5, maximo=500)), **kw)
    elif accion == "derivar":
        if not ctx.user.has_perm(P_TICKETS):
            raise ErrorHerramienta("Para derivar una alerta a un ticket hace falta poder enviar tickets de revisión")
        r = await llamar(comando_api.pedir_revision, payload=comando_api.RevisionPayload(
            prioridad=a.get("prioridad") if a.get("prioridad") in ("alta", "media", "baja") else "media",
            texto=texto(a.get("texto"), "el pedido de revisión", minimo=10, maximo=2000),
            tipo=a.get("tipo") if a.get("tipo") in TIPOS_TICKET else None), **kw)
    else:
        raise ErrorHerramienta("Acción inválida: tomar, descartar o derivar")
    return compactar({**seleccionar(r, ("titulo", "estado", "nota", "descartada_motivo", "ticket_numero", "ticket")),
                      "pantalla": "/televentas-claro/supervision/comando"})


async def _resumen_alerta(ctx: Ctx, a: dict[str, Any]) -> str:
    al = await ctx.db.get(AlertaComando, str(a.get("alerta_id") or ""))
    titulo = f"«{al.titulo}»" if al else "la alerta"
    t = str(a.get("texto") or "")[:300]
    if a.get("accion") == "tomar":
        return f"Tomar {titulo}" + (f" con la nota: «{t}»" if t else "")
    if a.get("accion") == "descartar":
        return f"Descartar {titulo} con el motivo: «{t}»"
    return f"Derivar {titulo} a un ticket de revisión (prioridad {a.get('prioridad') or 'media'}): «{t}»"


registrar(Herramienta(
    nombre="gestionar_alerta", etiqueta="Actuando sobre una alerta", nivel=CONFIRMAR,
    descripcion=("Actúa sobre una alerta del centro de comandos (el id sale de centro_de_comandos): «tomar» (con una "
                 "nota de qué se hizo), «descartar» (con el motivo) o «derivar» a un ticket de revisión al supervisor de "
                 "la alerta (con el pedido y la prioridad). El usuario confirma antes."),
    esquema=esquema({
        "alerta_id": {"type": "string"}, "accion": {"type": "string", "enum": ["tomar", "descartar", "derivar"]},
        "texto": {"type": "string", "description": "Nota (tomar), motivo (descartar) o pedido de revisión (derivar)."},
        "prioridad": {"type": "string", "enum": ["alta", "media", "baja"], "description": "Solo para derivar."},
        "tipo": {"type": "string", "enum": TIPOS_TICKET, "description": "Tipo de ticket al derivar (opcional)."},
    }, ["alerta_id", "accion"]),
    fn=_gestionar_alerta, resumen=_resumen_alerta, permisos=(P_GESTION,), modos=GESTION))
