"""Consumo y topes de Voi.

- El costo oficial de cada sesión lo informa Anthropic en el evento `session.usage` (`list_cost`, en centavos de US$,
  precio de lista: tokens + tiempo de ejecución). Se guarda la diferencia contra lo ya contado, por usuario y día.
- Topes: el de cada sesión lo aplica Anthropic (presupuesto duro); acá se controlan el del usuario por día, el del mes
  de toda la plataforma y las ráfagas de mensajes. El superadmin no tiene tope diario.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import date
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import CurrentUser
from ..core.database import engine
from .config import ahora_local
from .models import AsistenteConversacion, AsistenteUsoDiario

_rafagas: dict[str, deque] = defaultdict(deque)
_CAMPOS = ("mensajes", "herramientas", "acciones", "input_tokens", "output_tokens", "cache_lectura", "cache_escritura",
           "costo_centavos")


def hoy() -> date:
    return ahora_local().date()


async def _sumar(db: AsyncSession, user_id: str, perfil: str, **sumas: int) -> None:
    """Suma al día del usuario con SQL (crea la fila si falta): atómico aunque la API y el consumidor sumen a la vez."""
    d = hoy()
    if engine.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    await db.execute(insert(AsistenteUsoDiario).values(fecha=d, user_id=user_id, perfil=perfil, **{k: 0 for k in _CAMPOS})
                     .on_conflict_do_nothing(index_elements=["fecha", "user_id"]))
    valores = {k: getattr(AsistenteUsoDiario, k) + int(v) for k, v in sumas.items() if v}
    if valores:
        await db.execute(update(AsistenteUsoDiario).where(AsistenteUsoDiario.fecha == d,
                                                          AsistenteUsoDiario.user_id == user_id).values(**valores))


async def contar(db: AsyncSession, user_id: str, perfil: str, *, mensajes: int = 0, herramientas: int = 0,
                 acciones: int = 0) -> None:
    await _sumar(db, user_id, perfil, mensajes=mensajes, herramientas=herramientas, acciones=acciones)


def _int(x: Any) -> int:
    try:
        return int(x or 0)
    except (TypeError, ValueError):
        return 0


async def registrar_uso(db: AsyncSession, conv: AsistenteConversacion, uso: dict[str, Any]) -> dict[str, Any]:
    """Aplica una foto acumulada de `session.usage`: suma al día la diferencia contra lo ya contado."""
    cache = uso.get("cache_creation") or {}
    nuevo = {
        "input_tokens": _int(uso.get("input_tokens")), "output_tokens": _int(uso.get("output_tokens")),
        "cache_lectura": _int(uso.get("cache_read_input_tokens")),
        "cache_escritura": _int(cache.get("ephemeral_5m_input_tokens")) + _int(cache.get("ephemeral_1h_input_tokens")),
    }
    costo = _int((uso.get("list_cost") or {}).get("amount")) if (uso.get("list_cost") or {}).get("currency", "USD") == "USD" else 0
    previo = dict(conv.tokens or {})
    sumas = {k: max(0, nuevo[k] - _int(previo.get(k))) for k in nuevo}
    sumas["costo_centavos"] = max(0, costo - (conv.costo_centavos or 0))
    await _sumar(db, conv.user_id, conv.perfil, **sumas)
    conv.tokens = {**nuevo, "segundos": float(uso.get("active_seconds") or 0)}
    conv.costo_centavos = max(costo, conv.costo_centavos or 0)
    return {"costo_usd": round(conv.costo_centavos / 100, 2), **conv.tokens}


async def gasto_mes(db: AsyncSession) -> int:
    primero = hoy().replace(day=1)
    return _int((await db.execute(select(func.coalesce(func.sum(AsistenteUsoDiario.costo_centavos), 0))
                 .where(AsistenteUsoDiario.fecha >= primero))).scalar())


async def gasto_usuario_hoy(db: AsyncSession, user_id: str) -> int:
    return _int((await db.execute(select(AsistenteUsoDiario.costo_centavos).where(
        AsistenteUsoDiario.fecha == hoy(), AsistenteUsoDiario.user_id == user_id))).scalar())


async def bloqueo(db: AsyncSession, user: CurrentUser, cfg: dict[str, Any]) -> str | None:
    """Motivo para no aceptar un mensaje nuevo (o None si se puede)."""
    topes = cfg["topes"]
    ahora = time.monotonic()
    q = _rafagas[user.id]
    while q and ahora - q[0] > 60:
        q.popleft()
    if len(q) >= int(topes.get("mensajes_minuto") or 6):
        return "Vas muy rápido: esperá unos segundos antes de mandar otro mensaje."
    if not user.is_superadmin:
        if not cfg.get("habilitado", True):
            return "Voi está pausado por el administrador."
        mes = await gasto_mes(db)
        if topes.get("mensual_usd") and mes >= float(topes["mensual_usd"]) * 100:
            return "Se alcanzó el presupuesto mensual de Voi. Avisale al administrador."
        dia = await gasto_usuario_hoy(db, user.id)
        if topes.get("usuario_dia_usd") and dia >= float(topes["usuario_dia_usd"]) * 100:
            return "Llegaste al tope diario de uso de Voi. Mañana se renueva."
    q.append(ahora)
    return None
