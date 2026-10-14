"""Logística de entregas: el corte de pedidos (.xlsx) → informe del mes con estados, motivos, línea de tiempo, pendientes y demora."""
from __future__ import annotations

from . import analyzer, api, models, parser  # noqa: F401
from .migraciones import MIGRACIONES  # noqa: F401
