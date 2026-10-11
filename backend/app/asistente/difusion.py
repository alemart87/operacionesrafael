"""Reparto en vivo de lo que pasa en una conversación hacia los navegadores conectados (SSE).

Un solo proceso (uvicorn con un worker): alcanza con colas en memoria por conversación. Si nadie está mirando, los
eventos igual quedan guardados en la base y se recuperan al abrir la conversación.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

_subs: dict[str, set[asyncio.Queue]] = defaultdict(set)


def publicar(conversacion_id: str, evento: dict[str, Any]) -> None:
    for q in list(_subs.get(conversacion_id, ())):
        if q.qsize() < 500:          # un navegador colgado no acumula memoria sin fin
            q.put_nowait(evento)


@asynccontextmanager
async def suscribir(conversacion_id: str) -> AsyncIterator[asyncio.Queue]:
    q: asyncio.Queue = asyncio.Queue()
    _subs[conversacion_id].add(q)
    try:
        yield q
    finally:
        _subs[conversacion_id].discard(q)
        if not _subs[conversacion_id]:
            _subs.pop(conversacion_id, None)


def mirando(conversacion_id: str) -> bool:
    return bool(_subs.get(conversacion_id))
