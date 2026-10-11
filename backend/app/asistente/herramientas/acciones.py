"""Herramientas de acción: Voi hace cosas en la plataforma con los mismos servicios (y reglas) que las pantallas.

- Nivel 2 (lo propio): preparar el borrador del informe diario (y el seguimiento de sus compromisos), preparar un
  informe de auditoría en borrador y agregarle hallazgos. Corren solas (configurable) y nunca firman ni cierran.
- Nivel 3 (afecta a otros): enviar un ticket de revisión y darle seguimiento (comentar, reabrir, cancelar,
  reasignar), tomar, descartar o derivar una alerta del centro de comandos, comentar un informe diario. La plataforma
  muestra una tarjeta con lo que va a hacer y espera que el usuario confirme.
"""
from __future__ import annotations

import re
import uuid
from typing import Any

from sqlalchemy import select
from starlette.responses import Response

from ...operativas.televentas_claro.auditoria import api as aud_api
from ...operativas.televentas_claro.auditoria.models import CATEGORIAS, SEVERIDADES, Auditoria
from ...operativas.televentas_claro.auditoria.schemas import AuditoriaCreate, HallazgoCreate, HallazgoRead
from ...operativas.televentas_claro.informe_diario import api as inf_api
from ...operativas.televentas_claro.informe_diario import informe as inf_srv
from ...operativas.televentas_claro.informe_diario.models import FIRMADO, InformeDiario
from ...operativas.televentas_claro.supervision import comando_api, tickets_api
from ...operativas.televentas_claro.supervision.models import AlertaComando, Operador, Ticket
from ...operativas.televentas_claro.supervision import api as sup_api
from .. import investigacion
from ..models import AsistenteConversacion
from .base import (CONFIRMAR, PROPIO, TC, Ctx, ErrorHerramienta, Herramienta, compactar, esquema, fecha, llamar,
                   registrar, seleccionar, texto)
from .datos import hoy

P_INF, P_TICKETS, P_GESTION = f"{TC}.informe_diario", f"{TC}.tickets", f"{TC}.supervision_gestion"
P_AUD = f"{TC}.auditoria"
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
    seguimiento = {x["compromiso_id"]: x for x in inf.seguimiento or [] if isinstance(x, dict) and x.get("compromiso_id")}
    for x in (a.get("seguimiento") or [])[:60]:
        if not isinstance(x, dict) or not x.get("compromiso_id"):
            continue
        if x.get("estado") not in ("cumplido", "en_curso", "no_cumplido"):
            raise ErrorHerramienta("Estado de compromiso inválido: cumplido, en_curso o no_cumplido")
        seguimiento[str(x["compromiso_id"])[:36]] = {"compromiso_id": str(x["compromiso_id"])[:36], "estado": x["estado"],
                                                     "nota": str(x.get("nota") or "")[:1000]}
    if a.get("seguimiento"):
        cambios.append(f"seguimiento de {len(a.get('seguimiento') or [])} compromiso(s)")
    payload = inf_api.GuardarPayload(resultados=resultados, resumen=resumen, metricas=metricas,
                                     seguimiento=list(seguimiento.values()), importados=[x["id"] for x in inf.importados or []])
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
                             ("métricas críticas", "metricas"), ("datos importados", "importar"),
                             ("el seguimiento de compromisos", "seguimiento")) if a.get(k)]
    return f"Preparar el borrador del informe diario del {d:%d/%m}" + (f" con {', '.join(partes)}" if partes else "") + \
        ". Queda en borrador para que lo revises y lo firmes."


registrar(Herramienta(
    nombre="preparar_informe_diario", etiqueta="Preparando el borrador del informe diario", nivel=PROPIO,
    descripcion=("Abre (o retoma) el BORRADOR del informe diario del usuario para una fecha y le carga lo que le pases: "
                 "resultados del día de Pospago y GPON, el resumen, métricas críticas con su indicador, estado, "
                 "comentario y compromiso, e importa datos de la plataforma (llamadas, cargas del día, proyección o "
                 "coaching). También registra el seguimiento de los compromisos abiertos (cumplido, en curso o no "
                 "cumplido, con una nota; los ids salen de informes_diarios). Nunca firma: el usuario revisa y firma. "
                 "Antes de usarla, consultá los datos del día para proponer valores reales. Las métricas se agregan a "
                 "las que ya tenga el borrador."),
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
        "seguimiento": {"type": "array", "maxItems": 30, "items": {"type": "object", "additionalProperties": False,
                        "properties": {"compromiso_id": {"type": "string"},
                                       "estado": {"type": "string", "enum": ["cumplido", "en_curso", "no_cumplido"]},
                                       "nota": {"type": "string"}},
                        "required": ["compromiso_id", "estado"]}},
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


# ------------------------------------------------------------------ seguimiento de un ticket (nivel 3)
ACCIONES_TICKET = {"comentar": "Comentar", "reabrir": "Reabrir", "cancelar": "Cancelar", "reasignar": "Reasignar"}


async def _ticket_de(ctx: Ctx, valor: Any) -> Ticket:
    """Por número («12», «#12», «TK-12») o por id."""
    v = str(valor or "").strip()
    t = None
    if len(v) >= 32:
        t = await ctx.db.get(Ticket, v)
    elif (m := re.search(r"\d+", v)):
        t = (await ctx.db.execute(select(Ticket).where(Ticket.operativa == tickets_api.OPERATIVA,
                                                       Ticket.numero == int(m.group())))).scalar_one_or_none()
    if t is None or t.operativa != tickets_api.OPERATIVA:
        raise ErrorHerramienta("No encontré ese ticket: usá el número que muestra tickets_de_revision.")
    return t


async def _seguir_ticket(ctx: Ctx, a: dict[str, Any]) -> Any:
    t = await _ticket_de(ctx, a.get("ticket"))
    accion = a.get("accion")
    kw = {"ticket_id": t.id, "request": ctx.request(), "user": ctx.user, "db": ctx.db}
    if accion == "comentar":
        r = await llamar(tickets_api.comentar, payload=tickets_api.TextoPayload(
            texto=texto(a.get("texto"), "el comentario", minimo=5, maximo=4000)), **kw)
    elif accion == "reabrir":
        r = await llamar(tickets_api.reabrir, payload=tickets_api.TextoPayload(
            texto=texto(a.get("texto"), "el motivo de la reapertura", minimo=10, maximo=4000)), **kw)
    elif accion == "cancelar":
        r = await llamar(tickets_api.cancelar, payload=tickets_api.TextoPayload(
            texto=texto(a.get("texto"), "el motivo", minimo=5, maximo=4000)), **kw)
    elif accion == "reasignar":
        if not a.get("supervisor_id"):
            raise ErrorHerramienta("Para reasignar falta supervisor_id (buscalo con buscar_personas)")
        r = await llamar(tickets_api.reasignar, payload=tickets_api.ReasignarPayload(
            texto=texto(a.get("texto"), "el motivo", minimo=5, maximo=4000), supervisor_id=str(a["supervisor_id"])[:36]),
            **kw)
    else:
        raise ErrorHerramienta("Acción inválida: comentar, reabrir, cancelar o reasignar")
    return compactar({**seleccionar(r, ("numero", "tipo_nombre", "prioridad", "estado", "estado_nombre", "supervisor",
                                        "operador", "reaperturas")),
                      "hecho": f"{ACCIONES_TICKET[accion]} el ticket #{t.numero}",
                      "pantalla": "/televentas-claro/supervision/tickets"})


async def _resumen_seguir_ticket(ctx: Ctx, a: dict[str, Any]) -> str:
    try:
        t = await _ticket_de(ctx, a.get("ticket"))
        quien = f" #{t.numero}"
        if t.operador_id:
            o = await ctx.db.get(Operador, t.operador_id)
            quien += f" ({o.nombre})" if o else ""
    except ErrorHerramienta:
        quien = f" {a.get('ticket')}"
    txt = str(a.get("texto") or "")[:300]
    accion = a.get("accion")
    if accion == "reasignar":
        nombres = await sup_api._nombres(ctx.db, {str(a.get("supervisor_id") or "")})
        return f"Reasignar el ticket{quien} a {nombres.get(str(a.get('supervisor_id') or ''), 'otro supervisor')}: «{txt}»"
    if accion == "cancelar":
        return f"Cancelar el ticket{quien} con el motivo: «{txt}»"
    if accion == "reabrir":
        return f"Reabrir el ticket{quien}: «{txt}»"
    return f"Comentar el ticket{quien}: «{txt}»"


registrar(Herramienta(
    nombre="seguimiento_ticket", etiqueta="Dando seguimiento a un ticket", nivel=CONFIRMAR,
    descripcion=("Seguimiento de un ticket de revisión ya enviado (el número sale de tickets_de_revision): «comentar» "
                 "(si el ticket esperaba datos, es la respuesta y el plazo vuelve a correr), «reabrir» (solo uno "
                 "resuelto, dentro de los 5 días hábiles, con el motivo), «cancelar» (uno abierto, con el motivo) o "
                 "«reasignar» a otro supervisor activo (supervisor_id de buscar_personas; el plazo sigue corriendo). El "
                 "usuario confirma antes."),
    esquema=esquema({
        "ticket": {"type": "string", "description": "Número del ticket (p. ej. «12»)."},
        "accion": {"type": "string", "enum": list(ACCIONES_TICKET)},
        "texto": {"type": "string", "description": "Comentario o motivo (al menos 5 caracteres; 10 para reabrir)."},
        "supervisor_id": {"type": "string", "description": "Solo para reasignar."},
    }, ["ticket", "accion", "texto"]),
    fn=_seguir_ticket, resumen=_resumen_seguir_ticket, permisos=(P_TICKETS,)))


# ------------------------------------------------------------------ comentar un informe diario (nivel 3)
async def _informe_visible(ctx: Ctx, informe_id: Any) -> InformeDiario:
    inf = await ctx.db.get(InformeDiario, str(informe_id or "")[:36])
    if inf is None or not (ctx.user.is_superadmin or inf.autor_id == ctx.user.id):
        raise ErrorHerramienta("No encontré ese informe (los ids salen de informes_diarios o seguimiento_informes_diarios)")
    return inf


async def _comentar_informe(ctx: Ctx, a: dict[str, Any]) -> Any:
    inf = await _informe_visible(ctx, a.get("informe_id"))
    hecho: list[str] = []
    if a.get("texto"):
        r = await llamar(inf_api.comentar, informe_id=inf.id, payload=inf_api.ComentarioPayload(
            texto=texto(a.get("texto"), "el comentario", minimo=2, maximo=2000)), request=ctx.request(),
            user=ctx.user, db=ctx.db)
        hecho.append("comentario agregado" + (" (y quedó revisado)" if ctx.user.is_superadmin else ""))
        revisado_at = r.get("revisado_at")
    elif a.get("revisado") is None:
        raise ErrorHerramienta("Indicá el comentario o si se marca como revisado")
    if a.get("revisado") is not None and not a.get("texto"):
        if not ctx.user.is_superadmin:
            raise ErrorHerramienta("Solo el superadmin marca un informe como revisado")
        r = await llamar(inf_api.revisado, informe_id=inf.id, payload=inf_api.RevisadoPayload(revisado=bool(a["revisado"])),
                         request=ctx.request(), user=ctx.user, db=ctx.db)
        hecho.append("marcado como revisado" if a["revisado"] else "desmarcado como revisado")
        revisado_at = r.get("revisado_at")
    return {"informe": inf.id, "autor": inf.autor_nombre, "fecha": inf.fecha.isoformat(), "hecho": hecho,
            "revisado_at": revisado_at, "pantalla": f"/televentas-claro/informe-diario/{inf.id}"}


async def _resumen_comentar_informe(ctx: Ctx, a: dict[str, Any]) -> str:
    try:
        inf = await _informe_visible(ctx, a.get("informe_id"))
        de = f"el informe diario de {inf.autor_nombre} del {inf.fecha:%d/%m}"
    except ErrorHerramienta:
        de = "el informe diario"
    if a.get("texto"):
        return f"Comentar {de}: «{str(a['texto'])[:300]}»" + (" (queda marcado como revisado)"
                                                               if ctx.user.is_superadmin else "")
    return f"{'Marcar' if a.get('revisado') else 'Desmarcar'} como revisado {de}"


registrar(Herramienta(
    nombre="comentar_informe_diario", etiqueta="Comentando un informe diario", nivel=CONFIRMAR,
    descripcion=("Comenta un informe diario FIRMADO (el superadmin comenta los de todos y el comentario lo deja revisado; "
                 "el autor responde en el suyo) o, solo el superadmin, lo marca o desmarca como revisado sin comentar "
                 "(`revisado`). El autor ve el comentario en su informe. El usuario confirma antes."),
    esquema=esquema({
        "informe_id": {"type": "string"},
        "texto": {"type": "string", "description": "El comentario (hasta 2.000 caracteres)."},
        "revisado": {"type": "boolean", "description": "Solo superadmin y sin comentario: marcar (true) o desmarcar."},
    }, ["informe_id"]),
    fn=_comentar_informe, resumen=_resumen_comentar_informe, permisos=(P_INF,), modos=GESTION))


# ------------------------------------------------------------------ auditoría de ventas (nivel 2)
async def _fuentes_por_mes(ctx: Ctx, meses: list[str]) -> list[str]:
    """El corte de Ventas Netas de cada mes: el publicado más reciente o, si no hay, el último borrador."""
    disponibles = await llamar(aud_api.fuentes, user=ctx.user, db=ctx.db)
    ids, faltan = [], []
    for mes in meses:
        del_mes = [f for f in disponibles if str(f.periodo)[:7] == mes]
        elegido = next((f for f in del_mes if f.status == "published"), del_mes[0] if del_mes else None)
        if elegido is None:
            faltan.append(mes)
        else:
            ids.append(elegido.id)
    if faltan:
        raise ErrorHerramienta(f"No hay informes de Ventas Netas para: {', '.join(faltan)}. Cargá esos cortes primero.")
    return ids


def _meses(valor: Any) -> list[str]:
    meses = []
    for m in (valor or [])[:24]:
        v = str(m).strip()[:7]
        if not re.fullmatch(r"\d{4}-\d{2}", v):
            raise ErrorHerramienta("Los meses van como AAAA-MM")
        if v not in meses:
            meses.append(v)
    if not meses:
        raise ErrorHerramienta("Indicá al menos un mes (AAAA-MM)")
    return sorted(meses)


async def _preparar_auditoria(ctx: Ctx, a: dict[str, Any]) -> Any:
    meses = _meses(a.get("meses"))
    ids = await _fuentes_por_mes(ctx, meses)
    payload = AuditoriaCreate(titulo=texto(a.get("titulo"), "el título", minimo=3, maximo=255),
                              alcance=(str(a.get("alcance") or "").strip()[:2000] or None), report_ids=ids)
    r = await llamar(aud_api.crear, payload=payload, request=ctx.request(), user=ctx.user, db=ctx.db)
    d = r.model_dump(mode="json") if hasattr(r, "model_dump") else dict(r)
    hallazgos = [seleccionar(h, ("codigo", "titulo", "severidad", "categoria", "vendedor")) for h in d.get("hallazgos") or []]
    # En modo auditor sin informe destino, el que se acaba de crear pasa a serlo.
    conv = await ctx.db.get(AsistenteConversacion, ctx.conversacion_id)
    destino = None
    if conv is not None and (inv := investigacion.estado(conv)) is not None and not inv.get("auditoria_id"):
        nuevo = await investigacion.activar(ctx.db, conv, ctx.user, d.get("id"), por="voi")
        ctx.extra.setdefault("publicar", []).append({"tipo": "investigacion", "investigacion": nuevo})
        destino = "Quedó como informe destino del modo auditor: ya podés proponer evidencia."
    return compactar({**seleccionar(d, ("id", "codigo", "titulo", "status", "periodo_desde", "periodo_hasta", "resumen")),
                      "hallazgos_automaticos": hallazgos, "meses": meses, "modo_auditor": destino,
                      "pantalla": f"/televentas-claro/auditoria/informes/{d.get('id')}",
                      "importante": "Quedó en BORRADOR con los hallazgos automáticos: el auditor lo revisa, completa y "
                                    "cambia de estado desde la pantalla."}, max_lista=15)


async def _resumen_auditoria(ctx: Ctx, a: dict[str, Any]) -> str:
    meses = ", ".join(str(m)[:7] for m in (a.get("meses") or [])[:24])
    return f"Crear el informe de auditoría «{str(a.get('titulo') or '')[:120]}» en borrador con Ventas Netas de {meses}."


registrar(Herramienta(
    nombre="preparar_auditoria", etiqueta="Preparando un informe de auditoría", nivel=PROPIO,
    descripcion=("Crea un informe de auditoría de ventas en BORRADOR a partir de los informes de Ventas Netas de los "
                 "meses indicados (uno por mes; toma el corte publicado más reciente). Genera el código, el resumen y "
                 "los hallazgos automáticos (riesgos de vendedores, líneas sin uso, «salí hablando», etc.). No lo pasa a "
                 "revisión ni lo cierra: eso lo hace el auditor desde la pantalla."),
    esquema=esquema({
        "titulo": {"type": "string", "description": "Título del informe (3 a 255 caracteres)."},
        "meses": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 24,
                  "description": "Meses AAAA-MM a auditar."},
        "alcance": {"type": "string", "description": "Alcance u objetivo (opcional)."},
    }, ["titulo", "meses"]),
    fn=_preparar_auditoria, resumen=_resumen_auditoria, permisos=(P_AUD,)))


async def _auditoria_de(ctx: Ctx, valor: Any) -> Auditoria:
    v = str(valor or "").strip()
    a = await ctx.db.get(Auditoria, v[:36]) if v else None
    if a is None and v:
        a = (await ctx.db.execute(select(Auditoria).where(Auditoria.codigo == v.upper()[:40]))).scalar_one_or_none()
    if a is None:
        raise ErrorHerramienta("No encontré ese informe de auditoría (usá su id o su código, p. ej. AUD-2026-003)")
    return a


async def _agregar_hallazgo(ctx: Ctx, a: dict[str, Any]) -> Any:
    aud = await _auditoria_de(ctx, a.get("auditoria"))
    if a.get("severidad", "media") not in SEVERIDADES:
        raise ErrorHerramienta(f"Severidad inválida: {', '.join(SEVERIDADES)}")
    if a.get("categoria", "otro") not in CATEGORIAS:
        raise ErrorHerramienta(f"Categoría inválida: {', '.join(CATEGORIAS)}")
    payload = HallazgoCreate(
        titulo=texto(a.get("titulo"), "el título", minimo=3, maximo=255),
        descripcion=(str(a.get("descripcion") or "").strip()[:4000] or None), severidad=a.get("severidad", "media"),
        categoria=a.get("categoria", "otro"), vendedor=(str(a.get("vendedor") or "").strip()[:255] or None),
        recomendacion=(str(a.get("recomendacion") or "").strip()[:4000] or None),
        responsable=(str(a.get("responsable") or "").strip()[:255] or None),
        fecha_compromiso=fecha(a["fecha_compromiso"], "la fecha de compromiso") if a.get("fecha_compromiso") else None)
    h = await llamar(aud_api.crear_hallazgo, auditoria_id=aud.id, payload=payload, request=ctx.request(), user=ctx.user,
                     db=ctx.db)
    d = HallazgoRead.model_validate(h).model_dump(mode="json")
    return {**seleccionar(d, ("codigo", "titulo", "severidad", "categoria", "vendedor", "estado", "responsable",
                              "fecha_compromiso")),
            "auditoria": aud.codigo, "pantalla": f"/televentas-claro/auditoria/informes/{aud.id}#hallazgos"}


async def _resumen_hallazgo(ctx: Ctx, a: dict[str, Any]) -> str:
    try:
        aud = await _auditoria_de(ctx, a.get("auditoria"))
        en = f" en {aud.codigo}"
    except ErrorHerramienta:
        en = ""
    return (f"Agregar el hallazgo «{str(a.get('titulo') or '')[:150]}» (severidad {a.get('severidad', 'media')})"
            f"{en}" + (f", vendedor {a['vendedor']}" if a.get("vendedor") else "") + ".")


registrar(Herramienta(
    nombre="agregar_hallazgo", etiqueta="Agregando un hallazgo de auditoría", nivel=PROPIO,
    descripcion=("Agrega un hallazgo a un informe de auditoría que esté en borrador o en revisión (`auditoria`: id o "
                 "código AUD-…, de auditorias_de_ventas): título, descripción con la evidencia, severidad, categoría, "
                 "vendedor, recomendación, responsable y fecha de compromiso. Basalo en datos consultados, no en "
                 "suposiciones."),
    esquema=esquema({
        "auditoria": {"type": "string"},
        "titulo": {"type": "string"}, "descripcion": {"type": "string"},
        "severidad": {"type": "string", "enum": list(SEVERIDADES)},
        "categoria": {"type": "string", "enum": list(CATEGORIAS)},
        "vendedor": {"type": "string"}, "recomendacion": {"type": "string"}, "responsable": {"type": "string"},
        "fecha_compromiso": {"type": "string", "description": "AAAA-MM-DD"},
    }, ["auditoria", "titulo"]),
    fn=_agregar_hallazgo, resumen=_resumen_hallazgo, permisos=(P_AUD,)))
