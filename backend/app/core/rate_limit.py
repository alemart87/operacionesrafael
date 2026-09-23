"""Rate limit en memoria para el login (por IP + email).

Suficiente para 1 instancia (Render, 1 servicio). Si se escala a varias
instancias, mover el contador a Postgres o Redis.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from .config import settings


_attempts: dict[str, deque[float]] = defaultdict(deque)


def _key(ip: str, email: str) -> str:
    return f"{ip}|{email.lower().strip()}"


def _prune(q: deque[float], now: float) -> None:
    window = settings.login_window_minutes * 60
    while q and now - q[0] > window:
        q.popleft()


def is_blocked(ip: str, email: str) -> bool:
    now = time.monotonic()
    q = _attempts[_key(ip, email)]
    _prune(q, now)
    return len(q) >= settings.login_max_attempts


def register_failure(ip: str, email: str) -> None:
    _attempts[_key(ip, email)].append(time.monotonic())


def reset(ip: str, email: str) -> None:
    _attempts.pop(_key(ip, email), None)


def clear_all() -> None:
    """Solo para tests."""
    _attempts.clear()
