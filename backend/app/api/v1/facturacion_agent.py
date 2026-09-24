"""Agente de Facturación · Televentas CLARO (conversaciones, mensajes, chat SSE).

Acceso: utilidad `televentas_claro.facturacion` (solo superadmin).
Usa AgentConversation/AgentMessage con scope='facturacion'. Auditoría en cada mensaje.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from ...core.database import get_db, session_scope
from ...core.logging import logger
from ...models.agent import AgentConversation, AgentMessage
from ...services.agent.core import AgentNotConfigured, current_month
from ...services.agent.facturacion_agent import stream_facturacion_agent
from ...services.agent.pricing import compute_cost_usd
from ...services.agent.context import AgentContext
from ...services.audit_service import record_action
from ..deps import CurrentUser, client_ip, require_perm

require_facturacion_access = require_perm("televentas_claro.facturacion")


router = APIRouter(prefix="/televentas-claro/facturacion-agent", tags=["televentas-claro · facturación"])

_SCOPE = "facturacion"


class ConversationCreate(BaseModel):
    title: Optional[str] = None


class ConversationRename(BaseModel):
    title: str


class MessageCreate(BaseModel):
    content: str
    focus_refs: Optional[list[str]] = None  # reportes seleccionados (períodos/ids)


class ConversationRead(BaseModel):
    id: str
    title: Optional[str]
    scope: str
    created_at: datetime
    last_message_at: Optional[datetime]


class MessageRead(BaseModel):
    id: str
    role: str
    content: str
    reasoning: str = ""
    artifacts: list
    created_at: datetime


async def _own(conv_id: str, user: CurrentUser, db: AsyncSession) -> AgentConversation:
    conv = await db.get(AgentConversation, conv_id)
    if not conv or conv.user_id != user.id or conv.scope != _SCOPE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
    return conv


@router.get("/access")
async def access(user: CurrentUser = Depends(require_facturacion_access)) -> dict:
    return {
        "enabled": True,
        "configured": settings.agent_enabled,
        "model": settings.agent_model,
        "default_month": current_month(),
    }


@router.get("/conversations", response_model=list[ConversationRead])
async def list_conversations(
    user: CurrentUser = Depends(require_facturacion_access),
    db: AsyncSession = Depends(get_db),
) -> list[AgentConversation]:
    rows = await db.execute(
        select(AgentConversation)
        .where(AgentConversation.user_id == user.id, AgentConversation.scope == _SCOPE)
        .order_by(AgentConversation.last_message_at.desc().nullslast(),
                  AgentConversation.created_at.desc())
        .limit(100)
    )
    return rows.scalars().all()


@router.post("/conversations", response_model=ConversationRead, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    payload: ConversationCreate,
    user: CurrentUser = Depends(require_facturacion_access),
    db: AsyncSession = Depends(get_db),
) -> AgentConversation:
    conv = AgentConversation(user_id=user.id, scope=_SCOPE, title=payload.title)
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return conv


@router.patch("/conversations/{conv_id}", response_model=ConversationRead)
async def rename_conversation(
    conv_id: str, payload: ConversationRename,
    user: CurrentUser = Depends(require_facturacion_access),
    db: AsyncSession = Depends(get_db),
) -> AgentConversation:
    conv = await _own(conv_id, user, db)
    conv.title = payload.title.strip()[:255]
    await db.commit()
    await db.refresh(conv)
    return conv


@router.delete("/conversations/{conv_id}")
async def delete_conversation(
    conv_id: str,
    user: CurrentUser = Depends(require_facturacion_access),
    db: AsyncSession = Depends(get_db),
) -> dict:
    conv = await _own(conv_id, user, db)
    await db.execute(delete(AgentMessage).where(AgentMessage.conversation_id == conv_id))
    await db.delete(conv)
    await db.commit()
    return {"status": "deleted", "id": conv_id}


@router.get("/conversations/{conv_id}/messages", response_model=list[MessageRead])
async def list_messages(
    conv_id: str,
    user: CurrentUser = Depends(require_facturacion_access),
    db: AsyncSession = Depends(get_db),
) -> list[AgentMessage]:
    await _own(conv_id, user, db)
    rows = await db.execute(
        select(AgentMessage).where(AgentMessage.conversation_id == conv_id)
        .order_by(AgentMessage.created_at.asc())
    )
    return rows.scalars().all()


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/conversations/{conv_id}/messages")
async def post_message(
    conv_id: str, payload: MessageCreate, request: Request,
    user: CurrentUser = Depends(require_facturacion_access),
    db: AsyncSession = Depends(get_db),
):
    conv = await _own(conv_id, user, db)
    text = (payload.content or "").strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mensaje vacío")

    db.add(AgentMessage(conversation_id=conv_id, role="user", content=text))
    if not conv.title:
        conv.title = text[:60]
    conv.last_message_at = datetime.utcnow()
    await db.commit()

    rows = await db.execute(
        select(AgentMessage).where(AgentMessage.conversation_id == conv_id)
        .order_by(AgentMessage.created_at.desc()).limit(settings.agent_max_history)
    )
    history = list(reversed(rows.scalars().all()))
    messages = [{"role": m.role, "content": m.content} for m in history if m.content]

    focus_refs = [str(x).strip() for x in (payload.focus_refs or []) if str(x).strip()]
    if focus_refs:
        # Señal explícita al modelo del alcance seleccionado por el usuario.
        messages.insert(0, {
            "role": "user",
            "content": ("[Contexto del sistema] El usuario seleccionó estos reportes como FOCO: "
                        + ", ".join(focus_refs) + ". Centrá el análisis en ellos (1 → a fondo; 2+ → "
                        "comparalos y descomponé el cambio). Llamá fact_focus para confirmarlos."),
        })

    context = AgentContext(user_id=user.id, default_month=current_month(), focus_refs=focus_refs)
    uid = user.id
    ip = client_ip(request)

    async def event_stream():
        yield ":" + (" " * 2048) + "\n\n"
        yield _sse({"type": "start"})

        final_content = ""; final_reasoning = ""
        artifacts: list = []; tool_trace: list = []; usage: dict = {}
        queue: asyncio.Queue = asyncio.Queue()

        async def _produce():
            try:
                async for ev in stream_facturacion_agent(messages, context):
                    await queue.put(("ev", ev))
            except AgentNotConfigured as exc:
                await queue.put(("err", str(exc)))
            except Exception as exc:  # noqa: BLE001
                if exc.__class__.__name__ == "MaxTurnsExceeded":
                    await queue.put(("err", "La consulta requirió demasiados pasos y se detuvo. "
                                            "Probá acotarla."))
                else:
                    logger.exception(f"[facturacion-agent] error en {conv_id}: {exc}")
                    await queue.put(("err", "Ocurrió un error procesando la consulta."))
            finally:
                await queue.put(("end", None))

        producer = asyncio.create_task(_produce())
        failed = False
        while True:
            try:
                kind, pl = await asyncio.wait_for(queue.get(), timeout=2.0)
            except asyncio.TimeoutError:
                yield ": hb\n\n"
                continue
            if kind == "end":
                break
            if kind == "err":
                failed = True
                yield _sse({"type": "error", "message": pl})
                continue
            ev = pl
            if ev["type"] == "done":
                final_content = ev.get("content", "")
                final_reasoning = ev.get("reasoning", "")
                artifacts = ev.get("artifacts", [])
                tool_trace = ev.get("tool_trace", [])
                usage = ev.get("usage", {}) or {}
            yield _sse(ev)

        if failed:
            return

        try:
            async with session_scope() as s:
                cost = compute_cost_usd(usage.get("input_tokens", 0), usage.get("output_tokens", 0),
                                        usage.get("cached_tokens", 0))
                s.add(AgentMessage(
                    conversation_id=conv_id, role="assistant",
                    content=final_content, reasoning=final_reasoning,
                    artifacts=artifacts, tool_trace=tool_trace,
                    input_tokens=usage.get("input_tokens", 0),
                    cached_tokens=usage.get("cached_tokens", 0),
                    output_tokens=usage.get("output_tokens", 0),
                    reasoning_tokens=usage.get("reasoning_tokens", 0),
                    total_tokens=usage.get("total_tokens", 0),
                    cost_usd=cost,
                ))
                c = await s.get(AgentConversation, conv_id)
                if c:
                    c.last_message_at = datetime.utcnow()
                await s.commit()
                await record_action(
                    s, user_id=uid, action="facturacion_agent_message",
                    resource_type="agent_conversation", resource_id=conv_id, ip=ip,
                    extra={"scope": _SCOPE, "tools": [t.get("tool") for t in tool_trace]},
                )
        except Exception as exc:  # noqa: BLE001
            logger.exception(f"[facturacion-agent] no se pudo persistir: {exc}")

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "X-Accel-Buffering": "no",
    })
