"""Operativa Televentas CLARO.

- `router.py`: portada de la operativa (`televentas_claro.ver`).
- `facturacion/`: submódulo de la utilidad Facturación.

Cada submódulo nuevo va en su propia carpeta y suma acá sus routers y workers.
"""
from __future__ import annotations

from .facturacion import agent_api as facturacion_agent_api
from .facturacion import api as facturacion_api
from .facturacion.jobs.queue import facturacion_worker
from .router import router

ROUTERS = [router, facturacion_api.router, facturacion_agent_api.router]

# Workers de fondo: nombre -> coroutine factory. main.py los supervisa.
WORKERS = {"facturacion": facturacion_worker}
