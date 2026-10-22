"""Operativa Capacitación y Mentoría.

- `models.py`: grupos, postulantes, el link seguro de cada postulante (con su IPV), comentarios, audios e historial.
- `ipv.py` / `ipv_datos.py`: el IPV (Inventario de Personalidad para Vendedores): 87 situaciones, la clave y los baremos
  tomados de la planilla de corrección, y la corrección automática.
- `servicio.py`: quién ve y hace qué, los estados, el embudo, la efectividad y las estadísticas por sexo y edad.
- `api.py`: grupos, postulantes, estados, link, seguimiento con dictado y ficha (capacitador, mentor y gestión).
- `publico_api.py`: el link del postulante (test IPV mobile y su feedback), sin usuario.
- `audios.py`: dictado y transcripción en segundo plano.
- `entrenamientos.py` / `entrenamiento_ia.py` / `entrenamientos_publico.py`: entrenamientos con IA (clientes simulados por
  chat, evaluación por caso y final) para el equipo y desde el link del postulante.
"""
from __future__ import annotations

from . import api, audios, entrenamientos, entrenamientos_publico, publico_api
from .migraciones import MIGRACIONES

ROUTERS = [api.router, publico_api.router, entrenamientos.router, entrenamientos_publico.router]
WORKERS = {"capacitacion_audios": audios.worker, "capacitacion_entrenamientos": entrenamientos.worker}
MIGRACIONES_DATOS = list(MIGRACIONES)
