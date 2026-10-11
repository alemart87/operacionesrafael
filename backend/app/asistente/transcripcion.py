"""La conversación lista para mostrar, armada con la copia de eventos guardada en la base.

- Para el usuario: sus mensajes, las respuestas de Voi, los pasos (qué consultó), las tarjetas de acción y los avisos.
- Para el superadmin (`completo=True`): además el contexto que recibió el agente, qué pidió cada herramienta y qué le
  devolvió la plataforma (acotado).
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .consumidor import AVISOS_FIN, ERRORES, accion_dict, etiqueta_espacio, texto_de
from .herramientas import obtener
from .herramientas.lienzo import artefacto_dict
from .models import (EJECUTADA, FALLIDA, PENDIENTE, AsistenteAccion, AsistenteArtefacto, AsistenteConversacion,
                     AsistenteEvento)

ESTADO_PASO = {EJECUTADA: "ok", FALLIDA: "error", "cancelada": "error"}


def conversacion_dict(c: AsistenteConversacion, *, admin: bool = False) -> dict[str, Any]:
    d: dict[str, Any] = {
        "id": c.id, "titulo": c.titulo, "tipo": c.tipo, "fijada": c.fijada, "estado": c.estado,
        "stop_reason": c.stop_reason, "mensajes": c.mensajes,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "ultima_actividad": c.ultima_actividad.isoformat() if c.ultima_actividad else None,
        "disponible": c.estado not in ("terminated", "borrada", "budget_reached") and bool(c.session_id),
    }
    if admin:
        d.update({"user_id": c.user_id, "user_nombre": c.user_nombre, "perfil": c.perfil, "oculta": c.oculta,
                  "costo_usd": round((c.costo_centavos or 0) / 100, 2),
                  "tope_usd": round(c.tope_centavos / 100, 2) if c.tope_centavos else None,
                  "tokens": c.tokens or {}, "session_id": c.session_id, "agente_version": c.agente_version,
                  "modo": (c.contexto or {}).get("modo"), "herramientas": (c.contexto or {}).get("herramientas", []),
                  "pantalla": (c.contexto or {}).get("pantalla"), "error": c.error, "temas": c.temas or [],
                  "sesion_borrada_at": c.sesion_borrada_at.isoformat() if c.sesion_borrada_at else None})
    return d


def _recortar(texto: str, n: int = 4000) -> str:
    return texto if len(texto) <= n else texto[:n] + f"… ({len(texto) - n} caracteres más)"


async def construir(db: AsyncSession, conv: AsistenteConversacion, *, completo: bool = False) -> dict[str, Any]:
    eventos = (await db.execute(select(AsistenteEvento).where(AsistenteEvento.conversacion_id == conv.id)
                                .order_by(AsistenteEvento.id))).scalars().all()
    acciones = {a.evento_id: a for a in (await db.execute(select(AsistenteAccion).where(
        AsistenteAccion.conversacion_id == conv.id))).scalars().all()}
    artefactos = (await db.execute(select(AsistenteArtefacto).where(AsistenteArtefacto.conversacion_id == conv.id)
                                   .order_by(AsistenteArtefacto.created_at))).scalars().all()
    por_evento = {a.evento_id: a for a in artefactos if a.evento_id}
    items: list[dict[str, Any]] = []
    pasos: dict[str, dict[str, Any]] = {}
    for e in eventos:
        d, t = e.datos or {}, e.tipo
        at = d.get("processed_at") or (e.created_at.isoformat() if e.created_at else None)
        if t == "user.message":
            items.append({"tipo": "usuario", "id": e.evento_id, "texto": texto_de(d.get("content")), "at": at})
        elif t == "agent.message":
            items.append({"tipo": "voi", "id": e.evento_id, "texto": texto_de(d.get("content")), "at": at})
        elif t == "agent.custom_tool_use":
            a = acciones.get(e.evento_id)
            h = obtener(d.get("name") or "")
            if e.evento_id in por_evento:          # lo que se mostró en el lienzo
                item = {"tipo": "lienzo", "id": e.evento_id, "artefacto": artefacto_dict(por_evento[e.evento_id]), "at": at}
            elif a is not None and a.nivel > 1:
                item = {"tipo": "accion", "id": e.evento_id, "accion": accion_dict(a), "at": at}
            else:
                item = {"tipo": "paso", "id": e.evento_id, "herramienta": d.get("name"),
                        "etiqueta": h.etiqueta if h else d.get("name"), "at": at,
                        "estado": ESTADO_PASO.get(a.estado, "corriendo") if a else "corriendo"}
            if completo:
                item["entrada"] = d.get("input") or {}
            pasos[e.evento_id] = item
            items.append(item)
        elif t == "agent.tool_use":
            item = {"tipo": "paso", "id": e.evento_id, "herramienta": d.get("name"), "at": at, "estado": "corriendo",
                    "etiqueta": etiqueta_espacio(d.get("name"), d.get("input"))}
            if completo:
                item["entrada"] = d.get("input") or {}
            pasos[e.evento_id] = item
            items.append(item)
        elif t == "agent.tool_result":
            p = pasos.get(d.get("tool_use_id"))
            if p is not None:
                p["estado"] = "error" if d.get("is_error") else "ok"
                if completo:
                    p["resultado"] = _recortar(texto_de(d.get("content")), 1500)
        elif t == "user.custom_tool_result":
            p = pasos.get(d.get("custom_tool_use_id"))
            if p is not None:
                if p["tipo"] == "paso":
                    p["estado"] = "error" if d.get("is_error") else "ok"
                if completo:
                    p["resultado"] = _recortar(texto_de(d.get("content")))
        elif t == "session.status_idle":
            stop = (d.get("stop_reason") or {}).get("type")
            if stop in AVISOS_FIN:
                items.append({"tipo": "aviso", "id": e.evento_id, "nivel": "alerta", "texto": AVISOS_FIN[stop], "at": at})
        elif t == "session.error":
            err = d.get("error") or {}
            texto = ERRORES.get(err.get("type"), "Hubo un problema al procesar el pedido.")
            if completo and err.get("message"):
                texto += f" ({err.get('type')}: {err.get('message')})"
            items.append({"tipo": "aviso", "id": e.evento_id, "nivel": "error", "texto": texto, "at": at})
        elif t == "agent.thread_context_compacted":
            items.append({"tipo": "aviso", "id": e.evento_id, "nivel": "info",
                          "texto": "Resumí lo anterior de la conversación para poder seguir.", "at": at})
        elif t == "user.interrupt":
            items.append({"tipo": "aviso", "id": e.evento_id, "nivel": "info", "texto": "Detuviste la respuesta.", "at": at})
        elif completo and t == "system.message":
            items.append({"tipo": "contexto", "id": e.evento_id, "texto": texto_de(d.get("content")), "at": at})
        elif completo and t == "agent.thinking":
            items.append({"tipo": "pensando", "id": e.evento_id, "at": at})
    return {"conversacion": conversacion_dict(conv, admin=completo), "items": items,
            "pendientes": [accion_dict(a) for a in acciones.values() if a.estado == PENDIENTE],
            "artefactos": [artefacto_dict(a) for a in artefactos]}
