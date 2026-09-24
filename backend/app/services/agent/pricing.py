"""Cálculo de costo de las consultas del Agente (precios del modelo, USD)."""
from __future__ import annotations

from ...core.config import settings


def compute_cost_usd(input_tokens: int, output_tokens: int, cached_tokens: int = 0) -> float:
    """Costo en USD de un turno.

    `input_tokens` incluye los `cached_tokens`; los cacheados se facturan a su
    tarifa reducida y el resto del input a la tarifa normal.
    """
    cached = max(0, min(cached_tokens or 0, input_tokens or 0))
    fresh_input = max(0, (input_tokens or 0) - cached)
    cost = (
        fresh_input / 1_000_000 * settings.agent_price_input_per_mtok
        + cached / 1_000_000 * settings.agent_price_cached_input_per_mtok
        + (output_tokens or 0) / 1_000_000 * settings.agent_price_output_per_mtok
    )
    return round(cost, 6)


def pricing_info() -> dict:
    return {
        "model": settings.agent_model,
        "input_per_mtok": settings.agent_price_input_per_mtok,
        "cached_input_per_mtok": settings.agent_price_cached_input_per_mtok,
        "output_per_mtok": settings.agent_price_output_per_mtok,
        "currency": "USD",
    }
