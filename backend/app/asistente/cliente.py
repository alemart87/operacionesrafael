"""Cliente de Anthropic (SDK oficial) compartido por todo Voi. La clave vive solo en el servidor.

Con `ASISTENTE_SIMULADOR=true` (pruebas y demostraciones, nunca en producción) usa un motor simulado que imita a
Claude Managed Agents sin llamar a Anthropic.
"""
from __future__ import annotations

from typing import Any

from ..core.config import settings

_cliente: Any = None


class NoConfigurado(RuntimeError):
    """Falta la clave de Anthropic (ANTHROPIC_API_KEY)."""


def cliente() -> Any:
    global _cliente
    if _cliente is None:
        from .config import simulador_activo
        if simulador_activo():
            from .simulador import ClienteSimulado
            _cliente = ClienteSimulado()
        elif settings.anthropic_api_key:
            from anthropic import AsyncAnthropic
            _cliente = AsyncAnthropic(api_key=settings.anthropic_api_key, max_retries=3, timeout=120.0)
        else:
            raise NoConfigurado("Falta ANTHROPIC_API_KEY en el servidor")
    return _cliente


def reiniciar() -> None:
    """Solo pruebas: vuelve a construir el cliente con la configuración actual."""
    global _cliente
    _cliente = None
