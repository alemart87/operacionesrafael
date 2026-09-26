"""Operativa Televentas CLARO.

- `router.py`: portada de la operativa (`televentas_claro.ver`).
- `ventas_netas/`: submódulo de las utilidades Ventas Netas (ver / gestión).
- `auditoria/`: submódulo de la utilidad Auditoría de ventas.
- `facturacion/`: submódulo de la utilidad Facturación (solo superadmin).

Cada submódulo nuevo va en su propia carpeta y suma acá sus routers y workers.
"""
from __future__ import annotations

from .auditoria import api as auditoria_api
from .facturacion import agent_api as facturacion_agent_api
from .facturacion import api as facturacion_api
from .facturacion.jobs.queue import facturacion_worker
from .router import router
from .ventas_netas import api as ventas_netas_api
from .ventas_netas.jobs import actualizar_desactualizados as ventas_netas_actualizar
from .ventas_netas.jobs import queue as ventas_netas_queue

ROUTERS = [router, ventas_netas_api.router, auditoria_api.router, facturacion_api.router, facturacion_agent_api.router]

# Workers de fondo: nombre -> coroutine factory. main.py los supervisa.
WORKERS = {"ventas_netas": ventas_netas_queue.worker, "facturacion": facturacion_worker}

# Tareas de una sola vez al arrancar (en segundo plano): nombre -> coroutine factory.
AL_ARRANCAR = {"ventas_netas_actualizar": ventas_netas_actualizar}
