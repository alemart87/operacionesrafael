"""Operativa Televentas CLARO.

- `router.py`: portada de la operativa (`televentas_claro.ver`).
- `ventas_netas/`: submódulo de las utilidades Ventas Netas (ver / gestión).
- `auditoria/`: submódulo de la utilidad Auditoría de ventas.
- `productividad/`: submódulo de Productividad de llamadas (ver / gestión).
- `sph/`: submódulo SPH estimado: cruza Productividad con Ventas Netas (ver / gestión).
- `supervision/`: equipos del mes, objetivos y proyección por supervisor, maestro de operadores
  (fuente única de los vínculos agente ↔ vendedor, también para el SPH), portal del supervisor, scoring,
  coaching y bitácora, tickets de revisión, el centro de comandos, el control de supervisores, el coaching del día y el
  analizador semántico de coaching.
- `fuentes.py`: qué informe de Productividad y de Ventas Netas vale para cada día y cada mes.
- `informe_diario/`: el informe diario de la operación (coordinador, sub gerente y superadmin) y su seguimiento.
- `facturacion/`: submódulo de la utilidad Facturación (solo superadmin).
- `integraciones/`: claves de API de solo lectura y datasets planos para KNIME y otras herramientas (sub gerente y superadmin).
- `logistica/`: logística de entregas: el corte de pedidos (.xlsx) → informe del mes por estado, región y motivo, línea de
  tiempo, pendientes y demora por zona (ver / gestión).

Cada submódulo nuevo va en su propia carpeta y suma acá sus routers y workers.
"""
from __future__ import annotations

from .auditoria import api as auditoria_api
from .auditoria import evidencias as auditoria_evidencias
from .facturacion import agent_api as facturacion_agent_api
from .facturacion import api as facturacion_api
from .facturacion.jobs.queue import facturacion_worker
from .informe_diario import api as informe_diario_api
from .informe_diario.migraciones import MIGRACIONES as informe_diario_migraciones
from .integraciones import api as integraciones_api
from .integraciones.migraciones import MIGRACIONES as integraciones_migraciones
from .logistica import api as logistica_api
from .logistica.migraciones import MIGRACIONES as logistica_migraciones
from .auditoria.migraciones import MIGRACIONES as auditoria_migraciones
from .productividad import api as productividad_api
from .productividad import pbi_api as productividad_pbi_api
from .router import router
from .sph import api as sph_api
from .supervision import api as supervision_api
from .supervision import coaching_api as supervision_coaching_api
from .supervision import analisis as supervision_analisis
from .supervision import analisis_api as supervision_analisis_api
from .supervision import audios as supervision_audios
from .supervision import clima as supervision_clima
from .supervision import clima_api as supervision_clima_api
from .supervision import comando_api as supervision_comando_api
from .supervision import control_api as supervision_control_api
from .supervision import devolucion_api as supervision_devolucion_api
from .supervision import dia_api as supervision_dia_api
from .supervision import mi_dia_api as supervision_mi_dia_api
from .supervision import tickets_api as supervision_tickets_api
from .facturacion.migraciones import MIGRACIONES as facturacion_migraciones
from .supervision.migraciones import MIGRACIONES as supervision_migraciones
from .ventas_netas import api as ventas_netas_api
from .ventas_netas.jobs import actualizar_desactualizados as ventas_netas_actualizar
from .ventas_netas.jobs import queue as ventas_netas_queue

ROUTERS = [router, ventas_netas_api.router, productividad_api.router, productividad_pbi_api.router, sph_api.router, supervision_api.router,
           supervision_coaching_api.router, supervision_devolucion_api.router, supervision_control_api.router,
           supervision_dia_api.router, supervision_mi_dia_api.router, supervision_clima_api.router, supervision_analisis_api.router,
           supervision_tickets_api.router, supervision_comando_api.router,
           informe_diario_api.router, auditoria_api.router, auditoria_evidencias.router, facturacion_api.router,
           facturacion_agent_api.router, integraciones_api.router, logistica_api.router]

# Workers de fondo: nombre -> coroutine factory. main.py los supervisa.
WORKERS = {"ventas_netas": ventas_netas_queue.worker, "facturacion": facturacion_worker,
           "transcripcion_audios": supervision_audios.worker, "analisis_coaching": supervision_analisis.worker,
           "clima_equipo": supervision_clima.worker}

# Tareas de una sola vez al arrancar (en segundo plano): nombre -> coroutine factory.
AL_ARRANCAR = {"ventas_netas_actualizar": ventas_netas_actualizar, "clima_historia": supervision_clima.historia}

# Migraciones de datos de una sola vez (id, coroutine(db)): main.py las corre al arrancar y las anota.
MIGRACIONES_DATOS = [*supervision_migraciones, *facturacion_migraciones, *informe_diario_migraciones, *integraciones_migraciones,
                     *logistica_migraciones, *auditoria_migraciones]
