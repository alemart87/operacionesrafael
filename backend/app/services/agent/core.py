"""Motor de streaming de los agentes IA (OpenAI Agents SDK).

Patrón Database Agent / Tool-based RAG: el agente NO tiene los datos en el
prompt; usa tools read-only que traen datos puntuales, razona y responde.
El SDK `openai-agents` se importa de forma perezosa para que la app arranque
y los tests corran sin la dependencia ni la API key.

Cada agente especializado (ej. `facturacion_agent`) construye su `Agent` y
llama a `stream_agent(messages, context, build_fn=...)`.
"""
from __future__ import annotations

from datetime import date
from typing import Any, AsyncIterator, Callable

from ...core.config import settings
from .context import AgentContext


class AgentNotConfigured(RuntimeError):
    """El SDK no está instalado o falta OPENAI_API_KEY."""


def current_month() -> str:
    return date.today().strftime("%Y-%m")


def build_model_settings():
    """ModelSettings con el esfuerzo de razonamiento configurado (o None si no aplica)."""
    try:
        from agents import ModelSettings
    except Exception:
        return None
    try:
        from openai.types.shared import Reasoning
        rkwargs: dict[str, Any] = {"effort": settings.agent_reasoning_effort}
        if settings.agent_reasoning_summary:
            rkwargs["summary"] = settings.agent_reasoning_summary
        return ModelSettings(reasoning=Reasoning(**rkwargs))
    except Exception:
        return ModelSettings()


async def stream_agent(
    messages: list[dict], context: AgentContext, build_fn: Callable[[], Any],
) -> AsyncIterator[dict]:
    """Corre el agente en streaming. Emite eventos:
    {type:'token', text}, {type:'reasoning', text}, {type:'tool', name},
    {type:'canvas', artifact}, {type:'done', content, reasoning, artifacts, tool_trace, usage}.
    """
    try:
        from agents import Runner
    except ImportError as exc:
        raise AgentNotConfigured("El SDK 'openai-agents' no está instalado.") from exc

    agent = build_fn()
    result = Runner.run_streamed(
        agent, input=messages, context=context, max_turns=settings.agent_max_tool_turns,
    )

    emitted_canvas = 0
    full_text: list[str] = []
    full_reasoning: list[str] = []

    async for event in result.stream_events():
        etype = getattr(event, "type", "")
        if etype == "raw_response_event":
            data = getattr(event, "data", None)
            dtype = getattr(data, "type", "") or ""
            if dtype == "response.output_text.delta":
                delta = getattr(data, "delta", "") or ""
                if delta:
                    full_text.append(delta)
                    yield {"type": "token", "text": delta}
            elif dtype == "response.reasoning_summary_text.delta":
                delta = getattr(data, "delta", "") or ""
                if delta:
                    full_reasoning.append(delta)
                    yield {"type": "reasoning", "text": delta}
            elif dtype == "response.reasoning_summary_part.added" and full_reasoning:
                full_reasoning.append("\n\n")
                yield {"type": "reasoning", "text": "\n\n"}
        elif etype == "run_item_stream_event":
            item = getattr(event, "item", None)
            if getattr(item, "type", "") == "tool_call_item":
                raw = getattr(item, "raw_item", None)
                name = getattr(raw, "name", None) or "tool"
                context.tool_trace.append({"tool": name})
                yield {"type": "tool", "name": name}
            while emitted_canvas < len(context.canvas):
                yield {"type": "canvas", "artifact": context.canvas[emitted_canvas]}
                emitted_canvas += 1

    while emitted_canvas < len(context.canvas):
        yield {"type": "canvas", "artifact": context.canvas[emitted_canvas]}
        emitted_canvas += 1

    # Consumo de tokens del run completo (incluye los turnos de tools).
    usage_out: dict[str, int] = {"input_tokens": 0, "cached_tokens": 0,
                                 "output_tokens": 0, "reasoning_tokens": 0, "total_tokens": 0}
    try:
        usage = getattr(getattr(result, "context_wrapper", None), "usage", None)
        if usage:
            usage_out["input_tokens"] = int(getattr(usage, "input_tokens", 0) or 0)
            usage_out["output_tokens"] = int(getattr(usage, "output_tokens", 0) or 0)
            usage_out["total_tokens"] = int(getattr(usage, "total_tokens", 0) or 0)
            itd = getattr(usage, "input_tokens_details", None)
            if itd is not None:
                usage_out["cached_tokens"] = int(getattr(itd, "cached_tokens", 0) or 0)
            otd = getattr(usage, "output_tokens_details", None)
            if otd is not None:
                usage_out["reasoning_tokens"] = int(getattr(otd, "reasoning_tokens", 0) or 0)
    except Exception:
        pass

    content = "".join(full_text) or (getattr(result, "final_output", "") or "")
    yield {"type": "done", "content": content, "reasoning": "".join(full_reasoning),
           "artifacts": context.canvas, "tool_trace": context.tool_trace, "usage": usage_out}
