"""El puente en vivo entre una sesión de Claude Managed Agents y la plataforma.

Por cada conversación con trabajo en curso corre una tarea que:
1. abre el stream de eventos de la sesión (con vista previa del texto) y, para no perder nada si se cortó, repasa la
   lista de eventos desde el último que guardó (con margen: cada evento se guarda una sola vez);
2. guarda cada evento en la base y, recién guardado, lo reparte a los navegadores conectados;
3. cuando el agente pide una herramienta de la plataforma, la ejecuta con los permisos del dueño de la conversación y le
   devuelve el resultado; si la acción necesita confirmación, deja la tarjeta pendiente y espera al usuario;
4. registra el consumo informado por Anthropic.

Cada pedido de herramienta queda en `asistente_acciones` (uno por evento): así se ejecuta y se responde una sola vez,
aunque se corte la conexión o se reinicie el servidor (al volver, lo que quedó sin responder se completa).
La tarea termina cuando la sesión queda libre (fin de turno, tope, rechazo, error) o esperando solo al usuario.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import session_scope
from ..services.audit_service import record_action
from . import config, consumo, difusion
from .cliente import cliente
from .herramientas import CONFIRMAR, Ctx, ErrorHerramienta, Herramienta, ejecutar, obtener
from .models import (CANCELADA, EJECUTADA, EJECUTANDO, FALLIDA, PENDIENTE, AsistenteAccion, AsistenteConversacion,
                     AsistenteEvento)
from .permisos import modo as modo_de
from .permisos import puede_usar, usuario

log = logging.getLogger("asistente.consumidor")

_tareas: dict[str, asyncio.Task] = {}
_otra_vuelta: set[str] = set()      # se pidió escuchar mientras la tarea ya cerraba: se relanza al terminar
_en_curso: set[str] = set()         # acciones ejecutándose ahora en este proceso
FIN = {"end_turn", "budget_reached", "refusal", "retries_exhausted"}
MARGEN = timedelta(minutes=10)      # al repasar la lista, un poco antes del último evento guardado
SIN_EVENTOS = 900                   # segundos sin novedades en el stream: se cierra (un mensaje nuevo lo reabre)
RECONEXIONES = 5
ETIQUETA_ESPACIO = {"read": "Leyendo un archivo de trabajo", "write": "Guardando un archivo de trabajo",
                    "edit": "Editando un archivo de trabajo", "glob": "Buscando archivos de trabajo",
                    "grep": "Buscando en los archivos de trabajo", "bash": "Calculando"}
ETIQUETA_MEMORIA = {"read": "Revisando mi memoria", "write": "Guardando en mi memoria", "edit": "Actualizando mi memoria",
                    "glob": "Revisando mi memoria", "grep": "Buscando en mi memoria"}
ERRORES = {"model_overloaded_error": "Claude está con mucha demanda; reintenta solo.",
           "model_rate_limited_error": "Se alcanzó el límite de uso por minuto; reintenta solo.",
           "billing_error": "Hay un problema con la facturación de la cuenta de Anthropic: avisale al administrador.",
           "model_request_failed_error": "Falló un pedido al modelo; reintenta solo."}
AVISOS_FIN = {"budget_reached": "Esta conversación llegó a su tope de gasto: empezá una nueva (Voi recuerda lo importante).",
              "refusal": "Voi no puede ayudar con ese pedido.",
              "retries_exhausted": "No se pudo completar después de varios intentos. Probá de nuevo en un rato."}
CONTEXTO_ABRE = "<contexto_plataforma>"
CANCELADA_TEXTO = "El usuario canceló esta acción: no se hizo. No la repitas salvo que te la vuelva a pedir."
CORTADA_TEXTO = ("Se cortó la conexión mientras se hacía esta acción y no se puede confirmar si se completó. Pedile al "
                 "usuario que lo revise en la pantalla antes de repetirla.")
NO_PROCESADA_TEXTO = ("La plataforma no pudo procesar este pedido (se reinició o falló mientras lo ejecutaba). Contale al "
                      "usuario y, si hace falta, volvé a pedirlo.")


class Ocupado(RuntimeError):
    """Una acción de esta conversación se está ejecutando ahora mismo: hay que esperar a que termine."""


def _es_corte(exc: BaseException) -> bool:
    """Un problema de red o de tiempo (transitorio), no un error de la plataforma."""
    nombre = type(exc).__name__.lower()
    return isinstance(exc, (ConnectionError, TimeoutError, OSError)) or "connection" in nombre or "timeout" in nombre


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def etiqueta_espacio(nombre: Any, entrada: Any) -> str:
    """Qué está haciendo Voi en su contenedor, en palabras (la memoria se monta en /mnt/memory)."""
    e = entrada if isinstance(entrada, dict) else {}
    ruta = str(e.get("file_path") or e.get("path") or e.get("pattern") or "")
    if "/mnt/memory" in ruta or "/mnt/memory" in str(e.get("command") or ""):
        return ETIQUETA_MEMORIA.get(nombre, "Revisando mi memoria")
    return ETIQUETA_ESPACIO.get(nombre, "Trabajando")


# ------------------------------------------------------------------ tareas
def corriendo(conversacion_id: str) -> bool:
    t = _tareas.get(conversacion_id)
    return bool(t and not t.done())


def asegurar(conversacion_id: str, *, otra_vuelta: bool = False) -> None:
    """Arranca el consumidor de la conversación si no está corriendo. `otra_vuelta`: algo nuevo va a pasar (un mensaje,
    una confirmación); si la tarea ya estaba cerrando, se relanza al terminar para no perderlo."""
    if corriendo(conversacion_id):
        if otra_vuelta:
            _otra_vuelta.add(conversacion_id)
        return
    _tareas[conversacion_id] = asyncio.create_task(_correr(conversacion_id), name=f"voi-{conversacion_id[:8]}")


async def detener_todos() -> None:
    tareas = list(_tareas.values())
    for t in tareas:
        t.cancel()
    await asyncio.gather(*tareas, return_exceptions=True)


def activos() -> int:
    return sum(1 for t in _tareas.values() if not t.done())


# ------------------------------------------------------------------ utilidades
def _dump(ev: Any) -> dict[str, Any]:
    return ev.model_dump(mode="json") if hasattr(ev, "model_dump") else dict(ev)


def texto_de(content: Any) -> str:
    """El texto de un mensaje (sin el bloque de contexto de la plataforma, si fue dentro del mensaje)."""
    return "".join(b.get("text", "") for b in (content or []) if isinstance(b, dict) and b.get("type") == "text"
                   and not str(b.get("text", "")).startswith(CONTEXTO_ABRE))


def _fecha(valor: Any) -> datetime | None:
    if not valor:
        return None
    try:
        d = datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _json(texto: str) -> dict[str, Any]:
    try:
        v = json.loads(texto)
        return v if isinstance(v, dict) else {"valor": v}
    except (TypeError, ValueError):
        return {"mensaje": texto}


def accion_dict(a: AsistenteAccion, etiqueta: str | None = None) -> dict[str, Any]:
    h = obtener(a.herramienta)
    res = a.resultado or {}
    d = {"id": a.id, "evento_id": a.evento_id, "herramienta": a.herramienta,
         "etiqueta": etiqueta or (h.etiqueta if h else a.herramienta), "nivel": a.nivel, "resumen": a.resumen,
         "estado": a.estado, "pantalla": res.get("pantalla") if isinstance(res, dict) else None,
         "mensaje": (res.get("mensaje") or res.get("motivo")) if isinstance(res, dict) else None,
         "created_at": a.created_at.isoformat() if a.created_at else None,
         "resuelta_at": a.resuelta_at.isoformat() if a.resuelta_at else None}
    if h is not None and h.tarjeta is not None:
        try:
            d["detalle"] = h.tarjeta(a.entrada or {})
        except Exception:  # noqa: BLE001 — la tarjeta se ve igual, sin el detalle
            log.warning("No se pudo armar el detalle de la tarjeta de %s", a.herramienta)
    return d


# ------------------------------------------------------------------ el consumidor
async def _correr(cid: str) -> None:
    cancelado = False
    try:
        async with session_scope() as db:
            conv = await db.get(AsistenteConversacion, cid)
            if not conv or not conv.session_id or conv.estado == "borrada":
                return
            session_id = conv.session_id
        c = cliente()
        for intento in range(RECONEXIONES):
            if await _escuchar(c, cid, session_id):
                break
            await asyncio.sleep(min(2 ** intento, 15))      # el stream se cortó con la sesión trabajando: se reabre
    except asyncio.CancelledError:
        cancelado = True
        raise
    except Exception as exc:  # noqa: BLE001 — se registra y se avisa; un mensaje o una confirmación lo vuelve a arrancar
        log.exception("Consumidor de %s falló", cid)
        difusion.publicar(cid, {"tipo": "error", "mensaje": f"Se cortó la conexión con Voi ({type(exc).__name__}). "
                                                           "Reintentá en unos segundos."})
    finally:
        _tareas.pop(cid, None)
        if cid in _otra_vuelta:
            _otra_vuelta.discard(cid)
            if not cancelado:
                asegurar(cid)


async def _escuchar(c: Any, cid: str, session_id: str) -> bool:
    """Una vuelta: abre el stream, repasa lo pendiente y escucha. True si la sesión quedó libre (se puede cerrar)."""
    async with session_scope() as db:
        conv = await db.get(AsistenteConversacion, cid)
        ultimo = _fecha((conv.contexto or {}).get("ultimo_at")) if conv else None
    stream = await c.beta.sessions.events.stream(session_id, event_deltas=["agent.message"])
    try:
        # Lo que pasó mientras nadie escuchaba (el stream ya está abierto: no se pierde nada entre medio).
        kw: dict[str, Any] = {"order": "asc", "limit": 100}
        if ultimo:
            kw["created_at_gte"] = (ultimo - MARGEN).isoformat()
        libre: bool | None = None
        async for ev in c.beta.sessions.events.list(session_id, **kw):
            r = await _procesar(cid, _dump(ev))
            if r is not None:
                libre = r
        if libre is None:
            libre = await _sin_novedades(c, cid, session_id)
        if libre:
            return True
        it = stream.__aiter__()
        while True:
            try:
                ev = await asyncio.wait_for(it.__anext__(), timeout=SIN_EVENTOS)
            except StopAsyncIteration:
                return False
            except asyncio.TimeoutError:
                return True
            if await _procesar(cid, _dump(ev)) is True:
                return True
    finally:
        try:
            await stream.close()
        except Exception:  # noqa: BLE001
            pass


async def _sin_novedades(c: Any, cid: str, session_id: str) -> bool:
    """El repaso no trajo cambios de estado: se le pregunta a la sesión y se completa lo nuestro que quedó sin responder."""
    s = await c.beta.sessions.retrieve(session_id)
    estado = getattr(s, "status", None) or (s.get("status") if isinstance(s, dict) else None)
    if estado == "terminated":
        async with session_scope() as db:
            conv = await db.get(AsistenteConversacion, cid)
            if conv:
                conv.estado = "terminated"
                await db.commit()
        return True
    if estado in ("running", "rescheduling"):
        return False
    salida: list[dict[str, Any]] = []
    async with session_scope() as db:
        conv = await db.get(AsistenteConversacion, cid)
        if conv is None:
            return True
        sid, perfil = conv.session_id, conv.perfil
        filas = (await db.execute(select(AsistenteAccion).where(
            AsistenteAccion.conversacion_id == cid, AsistenteAccion.respondida_at.is_(None),
            AsistenteAccion.estado != PENDIENTE))).scalars().all()
        ids = [a.id for a in filas if a.id not in _en_curso]
        for aid in ids:
            a = await db.get(AsistenteAccion, aid)
            await _completar(db, a, sid, perfil, salida)
    _repartir(cid, salida)
    return not ids


def _repartir(cid: str, salida: list[dict[str, Any]]) -> None:
    for p in salida:
        difusion.publicar(cid, p)


async def _guardar(db: AsyncSession, cid: str, ev: dict[str, Any]) -> bool:
    """Guarda el evento una sola vez. Devuelve False si ya estaba."""
    existe = (await db.execute(select(AsistenteEvento.id).where(
        AsistenteEvento.conversacion_id == cid, AsistenteEvento.evento_id == ev["id"]))).first()
    if existe:
        return False
    db.add(AsistenteEvento(conversacion_id=cid, evento_id=ev["id"], tipo=ev.get("type", "")[:60], datos=ev))
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return False
    return True


async def _procesar(cid: str, ev: dict[str, Any]) -> bool | None:
    """Procesa un evento. Devuelve True si la sesión quedó libre (se puede dejar de escuchar), False si sigue
    trabajando, None si el evento no cambia eso."""
    tipo = ev.get("type", "")
    if tipo == "event_start":
        if (ev.get("event") or {}).get("type") == "agent.message":
            difusion.publicar(cid, {"tipo": "escribiendo", "id": ev["event"].get("id")})
        return None
    if tipo == "event_delta":
        contenido = (ev.get("delta") or {}).get("content") or {}
        if contenido.get("type") == "text":
            difusion.publicar(cid, {"tipo": "parcial", "id": ev.get("event_id"), "texto": contenido.get("text", "")})
        return None
    if tipo == "span.model_request_end":
        difusion.publicar(cid, {"tipo": "fin_parcial"})
        return None
    if tipo.startswith("span.") or not ev.get("id"):
        return None
    salida: list[dict[str, Any]] = []
    async with session_scope() as db:
        conv = await db.get(AsistenteConversacion, cid)
        if conv is None:
            return True
        nuevo = True if tipo == "session.usage" else await _guardar(db, cid, ev)
        conv = await db.get(AsistenteConversacion, cid)        # por si hubo rollback
        procesado = _fecha(ev.get("processed_at"))
        if nuevo and procesado and tipo != "session.usage":
            previo = _fecha((conv.contexto or {}).get("ultimo_at"))
            if previo is None or procesado > previo:
                conv.contexto = {**(conv.contexto or {}), "ultimo_at": procesado.isoformat()}
        await db.commit()                                       # guardado antes de actuar
        libre = await _aplicar(db, conv, ev, nuevo, salida)
        await db.commit()
    _repartir(cid, salida)
    return libre


async def _aplicar(db: AsyncSession, conv: AsistenteConversacion, ev: dict[str, Any], nuevo: bool,
                   salida: list[dict[str, Any]]) -> bool | None:
    tipo = ev.get("type", "")

    def pub(t: str, **datos: Any) -> None:
        salida.append({"tipo": t, **datos})

    if nuevo and tipo != "session.usage":
        conv.ultima_actividad = _ahora()
    if tipo == "agent.custom_tool_use":
        await _herramienta(db, conv, ev, salida)            # idempotente: también en el repaso
        return None
    if tipo == "user.custom_tool_result":
        await _respondida(db, conv.id, ev.get("custom_tool_use_id"))
        return None
    if tipo == "session.status_idle":
        stop = (ev.get("stop_reason") or {}).get("type") or "end_turn"
        if nuevo:
            conv.estado = {"requires_action": "requires_action", "budget_reached": "budget_reached"}.get(stop, "idle")
            conv.stop_reason = stop
            pub("estado", estado=conv.estado, motivo=stop, aviso=AVISOS_FIN.get(stop),
                categoria=(ev.get("stop_details") or {}).get("category"))
        if stop == "requires_action":
            return await _solo_espera_al_usuario(db, conv.id, (ev.get("stop_reason") or {}).get("event_ids") or [])
        return True
    if tipo in ("session.status_terminated", "session.deleted"):
        if nuevo:
            conv.estado = "terminated"
            pub("estado", estado="terminated", aviso="Esta conversación terminó: empezá una nueva.")
        return True
    if tipo in ("session.status_running", "session.status_rescheduled"):
        if nuevo:
            conv.estado = "running"
            pub("estado", estado="running")
        return False
    if tipo == "session.usage":
        pub("uso", **await consumo.registrar_uso(db, conv, ev.get("usage") or {}))
        return None
    if not nuevo:
        return None
    if tipo == "agent.message":
        pub("mensaje", id=ev["id"], texto=texto_de(ev.get("content")))
    elif tipo == "user.message":
        pub("usuario", id=ev["id"], texto=texto_de(ev.get("content")))
    elif tipo == "agent.thinking":
        pub("pensando")
    elif tipo == "agent.tool_use":
        pub("paso", id=ev["id"], herramienta=ev.get("name"), estado="corriendo",
            etiqueta=etiqueta_espacio(ev.get("name"), ev.get("input")))
        if ev.get("evaluated_permission") == "ask":   # no debería pasar (always_allow): nunca queda colgado
            await cliente().beta.sessions.events.send(conv.session_id, events=[{
                "type": "user.tool_confirmation", "tool_use_id": ev["id"], "result": "deny",
                "deny_message": "En esta plataforma el espacio de trabajo no pide permisos: seguí sin esa acción."}])
    elif tipo == "agent.tool_result":
        pub("paso", id=ev.get("tool_use_id"), estado="error" if ev.get("is_error") else "ok")
    elif tipo == "session.error":
        err = ev.get("error") or {}
        conv.error = str(err.get("message") or err.get("type") or "error")[:1000]
        pub("error", mensaje=ERRORES.get(err.get("type"), "Hubo un problema al procesar el pedido."),
            reintenta=((err.get("retry_status") or {}).get("type") == "retrying"))
    elif tipo == "agent.thread_context_compacted":
        pub("aviso", texto="Resumí lo anterior de la conversación para poder seguir.")
    return None


async def _solo_espera_al_usuario(db: AsyncSession, cid: str, ids: list[str]) -> bool:
    """La sesión espera resultados: si todos son acciones que esperan la confirmación del usuario, se deja de escuchar
    (la confirmación vuelve a abrir). Si alguno ya se respondió o se está respondiendo, se sigue escuchando."""
    if not ids:
        return False
    filas = (await db.execute(select(AsistenteAccion.evento_id, AsistenteAccion.estado).where(
        AsistenteAccion.conversacion_id == cid, AsistenteAccion.evento_id.in_(ids)))).all()
    pendientes = {e for e, estado in filas if estado == PENDIENTE}
    return len(pendientes) == len(set(ids))


# ------------------------------------------------------------------ herramientas de la plataforma
async def _resultado(session_id: str, evento_id: str, texto: str, es_error: bool) -> None:
    await cliente().beta.sessions.events.send(session_id, events=[{
        "type": "user.custom_tool_result", "custom_tool_use_id": evento_id, "is_error": es_error,
        "content": [{"type": "text", "text": texto or ("Error" if es_error else "Listo")}]}])


async def _responder(db: AsyncSession, a: AsistenteAccion, session_id: str) -> None:
    await _resultado(session_id, a.evento_id, a.respuesta or "", a.estado != EJECUTADA)
    a.respondida_at = _ahora()
    if a.nivel <= 1:
        a.respuesta = None          # la copia queda en el evento de la sesión
    await db.commit()


async def _respondida(db: AsyncSession, cid: str, evento_id: str | None) -> None:
    if not evento_id:
        return
    a = (await db.execute(select(AsistenteAccion).where(AsistenteAccion.conversacion_id == cid,
                                                         AsistenteAccion.evento_id == evento_id))).scalar_one_or_none()
    if a is not None and a.respondida_at is None and a.estado != PENDIENTE:
        a.respondida_at = _ahora()
        if a.nivel <= 1:
            a.respuesta = None


async def _herramienta(db: AsyncSession, conv: AsistenteConversacion, ev: dict[str, Any],
                       salida: list[dict[str, Any]]) -> None:
    """El agente pidió una herramienta de la plataforma (una sola vez por evento). Si algo nuestro falla, igual se le
    responde a la sesión: una sesión esperando un resultado que nunca llega rechaza todo lo demás."""
    sid = conv.session_id
    try:
        await _herramienta_interna(db, conv, ev, salida)
    except Exception as exc:  # noqa: BLE001
        if _es_corte(exc):
            raise               # se cortó la red: al volver a escuchar (o con el próximo mensaje) se completa
        log.exception("Herramienta %s de %s falló por fuera de su ejecución", ev.get("name"), conv.id)
        await db.rollback()
        try:
            await _resultado(sid, ev["id"], NO_PROCESADA_TEXTO, True)
        except Exception as exc2:  # noqa: BLE001 — se reintenta al próximo mensaje (resultados sin responder)
            log.warning("No se pudo responder el pedido %s de %s: %s", ev.get("id"), conv.id, exc2)
        salida.append({"tipo": "paso", "id": ev["id"], "herramienta": ev.get("name"), "estado": "error",
                       "detalle": f"No se pudo procesar ({type(exc).__name__})."})


async def _herramienta_interna(db: AsyncSession, conv: AsistenteConversacion, ev: dict[str, Any],
                               salida: list[dict[str, Any]]) -> None:
    cid, sid, uid, perfil = conv.id, conv.session_id, conv.user_id, conv.perfil
    previa = (await db.execute(select(AsistenteAccion).where(AsistenteAccion.conversacion_id == cid,
                                                              AsistenteAccion.evento_id == ev["id"]))).scalar_one_or_none()
    if previa is not None:
        await _completar(db, previa, sid, perfil, salida)
        return
    nombre = str(ev.get("name") or "")
    h = obtener(nombre)
    user = await usuario(db, uid)
    entrada = ev.get("input") if isinstance(ev.get("input"), dict) else {}
    a = AsistenteAccion(conversacion_id=cid, user_id=uid, herramienta=(h.nombre if h else nombre)[:80],
                        nivel=h.nivel if h else 1, entrada=entrada, resumen=h.etiqueta if h else nombre[:200],
                        evento_id=ev["id"], hilo_id=ev.get("session_thread_id"), estado=EJECUTANDO)
    if h is None or user is None or not puede_usar(user):
        a.estado, a.resuelta_at = FALLIDA, _ahora()
        a.respuesta = "Esa herramienta no está disponible para este usuario."
        if await _alta(db, a):
            await _responder(db, a, sid)
        return
    cfg = await config.leer(db)
    if nivel_confirmacion(h.nivel, cfg):
        try:
            a.resumen = (await h.resumen(Ctx(db=db, user=user, conversacion_id=cid), entrada)) if h.resumen else h.etiqueta
        except Exception as exc:  # noqa: BLE001 — sin resumen igual se puede confirmar o cancelar
            log.warning("Resumen de %s falló: %s", h.nombre, exc)
            await db.rollback()
            a.resumen = h.etiqueta
        a.estado = PENDIENTE
        if await _alta(db, a):
            salida.append({"tipo": "accion", "accion": accion_dict(a, h.etiqueta)})
        return
    if h.nivel > 1 and h.resumen:          # lo propio corre solo, pero la tarjeta dice qué hizo
        try:
            a.resumen = await h.resumen(Ctx(db=db, user=user, conversacion_id=cid), entrada)
        except Exception as exc:  # noqa: BLE001
            log.warning("Resumen de %s falló: %s", h.nombre, exc)
            await db.rollback()
    if not await _alta(db, a):
        return
    difusion.publicar(cid, {"tipo": "paso", "id": ev["id"], "herramienta": h.nombre, "etiqueta": h.etiqueta,
                            "estado": "corriendo"})
    await _ejecutar_y_responder(db, a.id, h, user, cid, sid, perfil, salida)


async def _alta(db: AsyncSession, a: AsistenteAccion) -> bool:
    """Registra la llamada. False si otro ya la había registrado (nunca se ejecuta dos veces)."""
    db.add(a)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return False
    return True


async def _ejecutar_y_responder(db: AsyncSession, accion_id: str, h: Herramienta, user: Any, cid: str, sid: str,
                                perfil: str, salida: list[dict[str, Any]], *, confirmada: bool = False) -> None:
    _en_curso.add(accion_id)
    try:
        a = await db.get(AsistenteAccion, accion_id)
        entrada = dict(a.entrada or {})
        ctx = Ctx(db=db, user=user, conversacion_id=cid, extra={"evento_id": a.evento_id})
        texto, es_error = await ejecutar(h, entrada, ctx, modo_de(user))
        a = await db.get(AsistenteAccion, accion_id)          # recargada (la herramienta pudo deshacer cambios)
        a.estado, a.resuelta_at, a.respuesta = (FALLIDA if es_error else EJECUTADA), _ahora(), texto
        if h.nivel > 1 or h.guardar_resultado:
            a.resultado = _json(texto)
        await consumo.contar(db, a.user_id, perfil, herramientas=1, acciones=1 if h.nivel > 1 else 0)
        await db.commit()
        if h.nivel > 1:
            await record_action(db, user_id=user.id, action="asistente_accion", resource_type="asistente_accion",
                                resource_id=a.id, ip="asistente", user_agent="Voi (asistente de la plataforma)",
                                extra={"herramienta": h.nombre, "nivel": h.nivel, "conversacion": cid,
                                       "ok": not es_error, "confirmada": confirmada, "via": "Voi"})
            a = await db.get(AsistenteAccion, accion_id)
            salida.append({"tipo": "accion", "accion": accion_dict(a, h.etiqueta)})
        await _responder(db, a, sid)
        salida.append({"tipo": "paso", "id": a.evento_id, "herramienta": h.nombre, "etiqueta": h.etiqueta,
                       "estado": "error" if es_error else "ok", "detalle": texto[:300] if es_error else None})
        if not es_error:
            salida.extend(ctx.extra.get("publicar") or [])     # p. ej. lo que se mostró en el lienzo
    finally:
        _en_curso.discard(accion_id)


async def _completar(db: AsyncSession, a: AsistenteAccion, sid: str, perfil: str, salida: list[dict[str, Any]]) -> None:
    """Una llamada ya registrada: si quedó sin responder (corte o reinicio), se completa."""
    if a.respondida_at is not None or a.estado == PENDIENTE or a.id in _en_curso:
        return
    if a.estado == EJECUTANDO:
        h = obtener(a.herramienta)
        user = await usuario(db, a.user_id)
        if h is not None and user is not None and puede_usar(user) and h.nivel < CONFIRMAR:
            # Consultas y borradores propios se pueden repetir sin riesgo.
            await _ejecutar_y_responder(db, a.id, h, user, a.conversacion_id, sid, perfil, salida)
            return
        a.estado, a.resuelta_at, a.respuesta = FALLIDA, _ahora(), CORTADA_TEXTO
        a.resultado = {**(a.resultado or {}), "mensaje": "Se cortó mientras se hacía: revisalo en la pantalla."}
        await db.commit()
        salida.append({"tipo": "accion", "accion": accion_dict(a)})
    if a.respuesta is None:
        a.respuesta = _texto_resultado(a)
    await _responder(db, a, sid)


def nivel_confirmacion(nivel: int, cfg: dict[str, Any]) -> bool:
    """¿Esta herramienta espera la confirmación del usuario?"""
    return nivel >= CONFIRMAR or (nivel == 2 and not cfg.get("autonomia", {}).get("borradores_sin_confirmar", True))


# ------------------------------------------------------------------ confirmar, cancelar, retomar
async def _tomar(db: AsyncSession, accion_id: str, estado: str) -> bool:
    """Pasa una acción pendiente a `estado` de forma atómica (un doble clic o dos pestañas no la ejecutan dos veces)."""
    r = await db.execute(update(AsistenteAccion).where(AsistenteAccion.id == accion_id,
                                                       AsistenteAccion.estado == PENDIENTE).values(estado=estado))
    await db.commit()
    return (r.rowcount or 0) == 1


class AjusteInvalido(ValueError):
    """Lo que el usuario eligió en la tarjeta no es válido (la acción sigue pendiente)."""


async def resolver(db: AsyncSession, accion_id: str, *, confirmar: bool,
                   ajustes: dict[str, Any] | None = None) -> AsistenteAccion | None:
    """El usuario confirmó o canceló una acción pendiente: se ejecuta (o no) y se le avisa al agente. `ajustes`: lo que
    eligió en la tarjeta (solo para herramientas que lo admiten: p. ej. qué piezas sumar al informe)."""
    a = await db.get(AsistenteAccion, accion_id)
    if a is None:
        return None
    conv = await db.get(AsistenteConversacion, a.conversacion_id)
    if conv is None or a.estado != PENDIENTE:
        return a
    cid, sid, perfil = conv.id, conv.session_id, conv.perfil
    user = await usuario(db, a.user_id)
    h = obtener(a.herramienta)
    puede = bool(user and h and puede_usar(user))
    salida: list[dict[str, Any]] = []
    nada_elegido = False
    if confirmar and puede and ajustes and h.ajustar is not None:
        try:
            ajustada = h.ajustar(dict(a.entrada or {}), ajustes)
        except ErrorHerramienta as exc:
            raise AjusteInvalido(str(exc)) from exc
        if ajustada is None:
            nada_elegido = True              # eligió no sumar nada: es como cancelar, con su motivo
        else:
            a.entrada = ajustada
            await db.commit()
    if nada_elegido:
        confirmar = False
    if confirmar and puede:
        if not await _tomar(db, accion_id, EJECUTANDO):
            return await db.get(AsistenteAccion, accion_id)
        difusion.publicar(cid, {"tipo": "paso", "id": a.evento_id, "herramienta": h.nombre, "etiqueta": h.etiqueta,
                                "estado": "corriendo"})
        await _ejecutar_y_responder(db, accion_id, h, user, cid, sid, perfil, salida, confirmada=True)
    else:
        if not await _tomar(db, accion_id, CANCELADA):
            return await db.get(AsistenteAccion, accion_id)
        a = await db.get(AsistenteAccion, accion_id)
        a.resuelta_at = _ahora()
        if nada_elegido:
            a.resultado = {"motivo": "No elegiste ninguna: no se sumó nada."}
            a.respuesta = ("El usuario no eligió ninguna de las piezas propuestas: no se sumó nada al informe. No las "
                           "vuelvas a proponer salvo que lo pida.")
        else:
            a.resultado = {"motivo": "Cancelada por el usuario." if not confirmar else "Ya no tenés permiso para esta acción."}
            a.respuesta = CANCELADA_TEXTO if not confirmar else (
                "El usuario ya no tiene permiso para esta acción: no se hizo. Contale qué permiso le falta.")
        await db.commit()
        await record_action(db, user_id=a.user_id, action="asistente_accion_cancelada", resource_type="asistente_accion",
                            resource_id=a.id, ip="asistente", user_agent="Voi (asistente de la plataforma)",
                            extra={"herramienta": a.herramienta, "nivel": a.nivel, "conversacion": cid, "via": "Voi"})
        a = await db.get(AsistenteAccion, accion_id)
        await _responder(db, a, sid)
        salida.append({"tipo": "accion", "accion": accion_dict(a)})
    _repartir(cid, salida)
    async with session_scope() as db2:      # vuelve a escuchar: el agente sigue con el resultado
        c2 = await db2.get(AsistenteConversacion, cid)
        if c2 and c2.estado == "requires_action":
            c2.estado = "running"
            await db2.commit()
    asegurar(cid, otra_vuelta=True)
    return await db.get(AsistenteAccion, accion_id)


async def cancelar_pendientes(db: AsyncSession, conv: AsistenteConversacion, motivo: str) -> tuple[list[dict[str, Any]], list[str]]:
    """Las acciones que esperaban confirmación se cancelan (el usuario siguió escribiendo o detuvo la respuesta).
    Devuelve los resultados para mandarle al agente junto con lo que siga (mensaje o interrupción) y sus ids, para
    marcarlas respondidas cuando el envío salga bien (si falla, el consumidor las reenvía después)."""
    ids = (await db.execute(select(AsistenteAccion.id).where(
        AsistenteAccion.conversacion_id == conv.id, AsistenteAccion.estado == PENDIENTE))).scalars().all()
    eventos: list[dict[str, Any]] = []
    tomadas: list[str] = []
    for aid in ids:
        if not await _tomar(db, aid, CANCELADA):
            continue
        a = await db.get(AsistenteAccion, aid)
        a.resuelta_at = _ahora()
        a.resultado = {"motivo": motivo[:1].upper() + motivo[1:] + "."}
        a.respuesta = f"Acción no realizada: {motivo}. No la repitas salvo que el usuario la vuelva a pedir."
        eventos.append({"type": "user.custom_tool_result", "custom_tool_use_id": a.evento_id, "is_error": True,
                        "content": [{"type": "text", "text": a.respuesta}]})
        tomadas.append(aid)
        difusion.publicar(conv.id, {"tipo": "accion", "accion": accion_dict(a)})
    await db.commit()
    return eventos, tomadas


def _texto_resultado(a: AsistenteAccion) -> str:
    if a.respuesta:
        return a.respuesta
    if a.resultado:
        return json.dumps(a.resultado, ensure_ascii=False, default=str)
    return CANCELADA_TEXTO if a.estado == CANCELADA else "Listo."


def _evento_resultado(a: AsistenteAccion) -> dict[str, Any]:
    return {"type": "user.custom_tool_result", "custom_tool_use_id": a.evento_id, "is_error": a.estado != EJECUTADA,
            "content": [{"type": "text", "text": _texto_resultado(a)}]}


async def completar_sin_responder(db: AsyncSession, conv: AsistenteConversacion) -> None:
    """Antes de mandar un mensaje: lo que quedó sin responder a Anthropic (un corte o un reinicio) se completa igual
    que al volver a escuchar: una consulta se repite, una acción cortada a mitad se da por fallida, y lo ya resuelto se
    reenvía. Si una acción se está ejecutando ahora mismo, `Ocupado`: hay que esperar a que termine."""
    filas = (await db.execute(select(AsistenteAccion).where(
        AsistenteAccion.conversacion_id == conv.id, AsistenteAccion.respondida_at.is_(None),
        AsistenteAccion.estado != PENDIENTE))).scalars().all()
    if any(a.id in _en_curso for a in filas):
        raise Ocupado()
    salida: list[dict[str, Any]] = []
    for a in filas:
        await _completar(db, a, conv.session_id, conv.perfil, salida)
    _repartir(conv.id, salida)


async def responder_reclamados(db: AsyncSession, conv: AsistenteConversacion, evento_ids: list[str]) -> list[dict[str, Any]]:
    """Anthropic dice que la sesión espera estos pedidos: se les responde con lo que haya. Uno que está pendiente de
    confirmación se cancela; uno que nunca se registró (falló antes de anotarlo) queda como fallido, con lo que el
    evento guardado cuente de él. Devuelve los resultados para mandar antes del mensaje."""
    eventos: list[dict[str, Any]] = []
    for eid in evento_ids:
        a = (await db.execute(select(AsistenteAccion).where(AsistenteAccion.conversacion_id == conv.id,
                                                             AsistenteAccion.evento_id == eid))).scalar_one_or_none()
        if a is None:
            guardado = (await db.execute(select(AsistenteEvento).where(AsistenteEvento.conversacion_id == conv.id,
                                                                        AsistenteEvento.evento_id == eid))).scalar_one_or_none()
            datos = (guardado.datos if guardado else None) or {}
            a = AsistenteAccion(conversacion_id=conv.id, user_id=conv.user_id, herramienta=str(datos.get("name") or "desconocida")[:80],
                                nivel=1, entrada=datos.get("input") if isinstance(datos.get("input"), dict) else {},
                                resumen="Pedido que la plataforma no pudo procesar", evento_id=eid, estado=FALLIDA,
                                respuesta=NO_PROCESADA_TEXTO, resuelta_at=_ahora())
            db.add(a)
        elif a.estado == PENDIENTE:
            a.estado, a.resuelta_at = CANCELADA, _ahora()
            a.resultado = {"motivo": "El usuario siguió la conversación sin confirmarla."}
            a.respuesta = "Acción no realizada: el usuario siguió la conversación sin confirmarla. No la repitas salvo que la vuelva a pedir."
        elif a.estado == EJECUTANDO and a.id not in _en_curso:
            a.estado, a.resuelta_at, a.respuesta = FALLIDA, _ahora(), CORTADA_TEXTO
        elif a.id in _en_curso:
            raise Ocupado()
        a.respondida_at = None          # Anthropic no lo tiene: se vuelve a mandar
        eventos.append(_evento_resultado(a))
        difusion.publicar(conv.id, {"tipo": "accion", "accion": accion_dict(a)} if a.nivel > 1 else
                          {"tipo": "paso", "id": a.evento_id, "herramienta": a.herramienta, "estado": "error",
                           "detalle": "No se pudo procesar."})
    await db.commit()
    return eventos


async def marcar_respondidas(db: AsyncSession, ids: list[str]) -> None:
    for aid in ids:
        a = await db.get(AsistenteAccion, aid)
        if a is not None and a.respondida_at is None:
            a.respondida_at = _ahora()
    await db.commit()


async def reanudar_pendientes() -> int:
    """Al arrancar: las conversaciones que quedaron trabajando o esperando una herramienta vuelven a escucharse."""
    async with session_scope() as db:
        convs = (await db.execute(select(AsistenteConversacion.id).where(
            AsistenteConversacion.estado.in_(("running", "requires_action"))))).scalars().all()
    for cid in convs:
        asegurar(cid)
    return len(convs)
