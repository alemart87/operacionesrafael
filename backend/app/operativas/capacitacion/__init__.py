"""Operativa Capacitación y Mentoría.

- `models.py`: grupos, postulantes, el link seguro de cada postulante (con su IPV), comentarios, audios e historial.
- `ipv.py` / `ipv_datos.py`: el IPV (Inventario de Personalidad para Vendedores): 87 situaciones, la clave y los baremos
  tomados de la planilla de corrección, y la corrección automática; también las pruebas en papel (Dominó y atención).
- `servicio.py`: quién ve y hace qué, los estados, el embudo, la efectividad y las estadísticas por sexo y edad.
- `api.py`: grupos, postulantes, estados, pruebas, link, seguimiento con dictado y ficha (capacitador, mentor y gestión).
- `publico_api.py`: el link del postulante (test IPV mobile y su feedback), sin usuario.
- `audios.py`: dictado y transcripción en segundo plano.
"""
from __future__ import annotations

from . import api, audios, publico_api
from .migraciones import MIGRACIONES

ROUTERS = [api.router, publico_api.router]
WORKERS = {"capacitacion_audios": audios.worker}
MIGRACIONES_DATOS = list(MIGRACIONES)
