"""Contexto compartido por las tools de un agente durante un turno."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class AgentContext:
    user_id: str
    default_month: str                                    # YYYY-MM (mes por defecto = actual)
    canvas: list[dict] = field(default_factory=list)      # artefactos emitidos al panel derecho
    tool_trace: list[dict] = field(default_factory=list)  # auditoría de tools usadas
    # Reportes seleccionados por el usuario: el agente enfoca su análisis en estas
    # referencias (períodos/ids). Vacío = sin restricción.
    focus_refs: list[str] = field(default_factory=list)
