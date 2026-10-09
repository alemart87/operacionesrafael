"""Operativa Televentas CLARO.

- `router.py`: portada de la operativa (`televentas_claro.ver`).
- `ventas_netas/`: submódulo de las utilidades Ventas Netas (ver / gestión).
- `auditoria/`: submódulo de la utilidad Auditoría de ventas.
- `productividad/`: submódulo de Productividad de llamadas (ver / gestión).
- `sph/`: submódulo SPH estimado: cruza Productividad con Ventas Netas (ver / gestión).
- `supervision/`: equipos del mes, objetivos y proyección por supervisor, maestro de operadores
  (fuente única de los vínculos agente ↔ vendedor, también para el SPH) y portal del supervisor.
- `fuentes.py`: qué informe de Productividad y de Ventas Netas vale para cada día y cada mes.
- `facturacion/`: submódulo de la utilidad Facturación (solo superadmin).

Cada submódulo nuevo va en su propia carpeta y suma acá sus routers y workers.
"""
from __future__ import annotations

from .auditoria import api as auditoria_api
from .facturacion import agent_api as facturacion_agent_api
from .facturacion import api as facturacion_api
from .facturacion.jobs.queue import facturacion_worker
from .productividad import api as productividad_api
from .router import router
from .sph import api as sph_api
from .supervision import api as supervision_api
from .supervision import coaching_api as supervision_coaching_api
from .supervision import tickets_api as supervision_tickets_api
from .supervision.migraciones import MIGRACIONES as supervision_migraciones
from .ventas_netas import api as ventas_netas_api
from .ventas_netas.jobs import actualizar_desactualizados as ventas_netas_actualizar
from .ventas_netas.jobs import queue as ventas_netas_queue

ROUTERS = [router, ventas_netas_api.router, productividad_api.router, sph_api.router, supervision_api.router,
           supervision_coaching_api.router, supervision_tickets_api.router,
           auditoria_api.router, facturacion_api.router, facturacion_agent_api.router]

# Workers de fondo: nombre -> coroutine factory. main.py los supervisa.
WORKERS = {"ventas_netas": ventas_netas_queue.worker, "facturacion": facturacion_worker}

# Tareas de una sola vez al arrancar (en segundo plano): nombre -> coroutine factory.
AL_ARRANCAR = {"ventas_netas_actualizar": ventas_netas_actualizar}

# Migraciones de datos de una sola vez (id, coroutine(db)): main.py las corre al arrancar y las anota.
MIGRACIONES_DATOS = [*supervision_migraciones]
