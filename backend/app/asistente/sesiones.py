"""Conversaciones de Voi = sesiones de Claude Managed Agents.

Al crear una sesión se le da al agente publicado (versión fija) solo lo que el usuario puede usar: las herramientas de
la plataforma según sus permisos y su modo, las habilidades de sus módulos, su memoria (lectura y escritura) y un tope
de gasto. Cada mensaje del usuario va como `user.message`; el contexto (quién es, fecha y pantalla) como
`system.message`, sin tocar las instrucciones fijas del agente.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import CurrentUser
from ..core.operativas import OPERATIVAS
from ..core.perfiles import perfil_name
from . import config, consumidor, consumo, definicion, memoria, pantallas, publicacion
from . import investigacion as investigacion_svc
from .cliente import cliente
from .herramientas import para_usuario
from .models import AsistenteConversacion
from .permisos import modo as modo_de

log = logging.getLogger("asistente.sesiones")

DIAS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
MODO_TEXTO = {
    "superadmin": "superadmin: ve y puede todo en la plataforma.",
    "gestion": "trabaja con los módulos de su perfil (los que tienen herramienta en esta sesión).",
    "auditor": ("MODO AUDITORÍA: trabajá solo con auditoría de ventas y alertas (informes de auditoría, vendedores en "
                "alerta de Ventas Netas, alertas del centro de comandos y tickets). Si pide otra cosa, explicá que en su "
                "perfil Voi está acotado a auditoría y alertas."),
}
# Si la API no aceptara `system.message`, el contexto viaja como primer bloque del mensaje (y no se muestra).
_contexto_en_mensaje = False


class NoDisponible(RuntimeError):
    """Voi no se puede usar ahora (el mensaje es para el usuario)."""


def _habilidad_permitida(nombre: str, user: CurrentUser, modo: str) -> bool:
    if modo == "auditor" and nombre not in definicion.HABILIDADES_AUDITOR:
        return False
    req = definicion.PERMISO_HABILIDAD.get(nombre)
    return not req or any(user.has_perm(p) for p in req)


def _modulos(user: CurrentUser) -> str:
    nombres = []
    for o in OPERATIVAS:
        for u in o["utilidades"]:
            if u["key"] not in ("ver", "asistente") and user.has_perm(f"{o['slug']}.{u['key']}"):
                nombres.append(u["name"])
    return "; ".join(nombres) or "ninguno"


def contexto_texto(user: CurrentUser, modo: str, pantalla: dict[str, Any] | None,
                   investigacion: dict[str, Any] | None = None) -> str:
    ahora = config.ahora_local()
    lineas = [
        "Contexto de la plataforma para este mensaje (no lo repitas salvo que haga falta):",
        f"- Usuario: {user.full_name} · perfil {perfil_name(user.role)} · {MODO_TEXTO.get(modo, '')}",
        f"- Utilidades de su perfil: {_modulos(user)}.",
        f"- Fecha y hora en Asunción: {DIAS[ahora.weekday()]} {ahora:%d/%m/%Y %H:%M}.",
    ]
    if pantalla and pantalla.get("ruta"):
        titulo = f" — {str(pantalla['titulo'])[:200]}" if pantalla.get("titulo") else ""
        p = pantallas.pantalla_de_ruta(str(pantalla["ruta"]))
        que = f" Es: {p.que_hace}" if p is not None else ""
        lineas.append(f"- Está viendo la pantalla {str(pantalla['ruta'])[:200]}{titulo}.{que}")
    lineas.extend(investigacion_svc.contexto_lineas(investigacion, puede=investigacion_svc.puede_investigar(user)))
    return "\n".join(lineas)


def herramientas_y_habilidades(user: CurrentUser, rec: dict[str, Any]) -> tuple[str, list, list[dict[str, Any]]]:
    modo = modo_de(user)
    herramientas = para_usuario(user, modo)
    skills = [{"type": "custom", "skill_id": h["id"], "version": str(h["version"])}
              for nombre, h in sorted((rec.get("habilidades") or {}).items()) if _habilidad_permitida(nombre, user, modo)]
    return modo, herramientas, skills


async def _definiciones(db: AsyncSession, user: CurrentUser, herramientas: list) -> tuple[list, list[dict[str, Any]]]:
    """Las definiciones para esta sesión: algunas herramientas se describen según la persona (p. ej. con los documentos
    que puede consultar) y quedan afuera si no tienen nada para ella."""
    usadas, definiciones = [], []
    for h in herramientas:
        d = h.definicion()
        if h.preparar is not None:
            try:
                descripcion = await h.preparar(db, user)
            except Exception as exc:  # noqa: BLE001 — sin esa herramienta igual se puede conversar
                log.warning("No se pudo preparar %s para %s: %s", h.nombre, user.id, exc)
                await db.rollback()
                continue
            if descripcion is None:
                continue
            d = {**d, "description": descripcion}
        usadas.append(h)
        definiciones.append(d)
    return usadas, definiciones


async def crear(db: AsyncSession, user: CurrentUser, *, tipo: str = "chat") -> AsistenteConversacion:
    try:
        return await _crear(db, user, tipo)
    except Exception as exc:
        if getattr(exc, "status_code", None) != 404:
            raise
        # Algo de lo publicado ya no existe en Anthropic (borrado desde la consola o clave de otra cuenta): se
        # republica, se rehace la memoria si hace falta y se intenta una vez más.
        log.warning("Anthropic respondió 404 al crear la sesión (%s): se republica y se reintenta", exc)
        await publicacion.publicar(db, por="sistema")
        await memoria.verificar(db, user.id)
        return await _crear(db, user, tipo)


async def _crear(db: AsyncSession, user: CurrentUser, tipo: str) -> AsistenteConversacion:
    cfg = await config.leer(db)
    if not config.clave_configurada():
        raise NoDisponible("Voi todavía no está conectado: falta cargar la clave de Anthropic en el servidor.")
    rec = await config.recursos(db)
    if not publicacion.listo(rec):
        raise NoDisponible("Voi todavía no está publicado. El superadmin lo publica desde Administración → Asistente IA.")
    if not user.is_superadmin and not cfg.get("habilitado", True):
        raise NoDisponible("Voi está pausado por el administrador.")
    modo, herramientas, skills = herramientas_y_habilidades(user, rec)
    herramientas, definiciones = await _definiciones(db, user, herramientas)
    tools = [*definicion.toolset(), *definiciones]
    recursos: list[dict[str, Any]] = []
    try:
        recursos.append(memoria.recurso(await memoria.asegurar(db, user)))
    except Exception as exc:  # noqa: BLE001 — sin memoria igual se puede conversar
        log.warning("Memoria de %s no disponible: %s", user.id, exc)
        await db.rollback()
    tope = config.centavos(cfg["topes"].get("conversacion_usd"))
    esfuerzo = (cfg.get("modelo") or {}).get("esfuerzo")
    esfuerzo = esfuerzo if esfuerzo in config.ESFUERZOS else "medium"
    agente = rec["agente"]
    conv = AsistenteConversacion(user_id=user.id, user_nombre=user.full_name, perfil=user.role, tipo=tipo,
                                 contexto={"modo": modo, "herramientas": [h.nombre for h in herramientas],
                                           "habilidades": [s["skill_id"] for s in skills], "memoria": bool(recursos),
                                           "esfuerzo": esfuerzo},
                                 tope_centavos=tope, agente_version=agente.get("version"))
    db.add(conv)
    await db.flush()
    kw: dict[str, Any] = {
        "agent": {"type": "agent_with_overrides", "id": agente["id"],
                  **({"version": agente["version"]} if agente.get("version") else {}), "tools": tools, "skills": skills,
                  "model": {"id": definicion.modelo()["id"], "effort": esfuerzo}},
        "environment_id": rec["entorno"]["id"],
        "title": f"Voi · {user.full_name} · {config.ahora_local():%d/%m %H:%M}"[:200],
        "metadata": {"usuario": user.id, "perfil": user.role, "modo": modo, "conversacion": conv.id,
                     "plataforma": "operaciones-voicenter"},
    }
    if recursos:
        # Solo el encabezado de Managed Agents (lo pone el SDK): Anthropic rechaza combinarlo con el de memoria.
        kw["resources"] = recursos
    if tope:
        kw["budget"] = {"type": "limit", "max_list_cost": {"amount": str(tope), "currency": "USD"}}
    try:
        sesion = await cliente().beta.sessions.create(**kw)
    except Exception:
        await db.rollback()
        raise
    conv.session_id, conv.estado = sesion.id, "idle"
    await db.commit()
    return conv


def _eventos_mensaje(texto: str, contexto: str) -> list[dict[str, Any]]:
    if _contexto_en_mensaje:
        return [{"type": "user.message", "content": [
            {"type": "text", "text": f"{consumidor.CONTEXTO_ABRE}\n{contexto}\n</contexto_plataforma>"},
            {"type": "text", "text": texto}]}]
    return [{"type": "system.message", "content": [{"type": "text", "text": contexto}]},
            {"type": "user.message", "content": [{"type": "text", "text": texto}]}]


async def _enviar_eventos(session_id: str, previos: list[dict[str, Any]], texto: str, contexto: str) -> None:
    global _contexto_en_mensaje
    try:
        await cliente().beta.sessions.events.send(session_id, events=[*previos, *_eventos_mensaje(texto, contexto)])
    except Exception as exc:
        if _contexto_en_mensaje or "system" not in str(exc).lower() or getattr(exc, "status_code", None) != 400:
            raise
        log.warning("La API no aceptó system.message (%s): el contexto va dentro del mensaje", exc)
        _contexto_en_mensaje = True
        await cliente().beta.sessions.events.send(session_id, events=[*previos, *_eventos_mensaje(texto, contexto)])


async def enviar(db: AsyncSession, conv: AsistenteConversacion, user: CurrentUser, texto: str,
                 pantalla: dict[str, Any] | None) -> None:
    """Manda el mensaje del usuario (y el contexto). Si había acciones esperando confirmación, se cancelan: el usuario
    siguió la conversación sin confirmarlas."""
    previos, canceladas = await consumidor.cancelar_pendientes(db, conv, "el usuario siguió la conversación sin confirmarla")
    await _enviar_eventos(conv.session_id, previos, texto,
                          contexto_texto(user, modo_de(user), pantalla, investigacion_svc.estado(conv)))
    await consumidor.marcar_respondidas(db, canceladas)
    conv = await db.get(AsistenteConversacion, conv.id)
    if conv.mensajes == 0 and conv.titulo == "Nueva conversación":
        conv.titulo = (texto.strip().splitlines()[0] if texto.strip() else "Conversación")[:80]
    conv.mensajes += 1
    conv.estado = "running"
    conv.ultima_actividad = datetime.now(timezone.utc)
    if pantalla:
        conv.contexto = {**(conv.contexto or {}), "pantalla": pantalla}
    await consumo.contar(db, conv.user_id, conv.perfil, mensajes=1)
    await db.commit()
    consumidor.asegurar(conv.id, otra_vuelta=True)


async def detener(db: AsyncSession, conv: AsistenteConversacion) -> None:
    previos, canceladas = await consumidor.cancelar_pendientes(db, conv, "el usuario detuvo la respuesta")
    await cliente().beta.sessions.events.send(conv.session_id, events=[*previos, {"type": "user.interrupt"}])
    await consumidor.marcar_respondidas(db, canceladas)
    consumidor.asegurar(conv.id, otra_vuelta=True)
