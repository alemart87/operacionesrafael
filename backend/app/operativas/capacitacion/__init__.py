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
- `en_vivo.py`: el tablero en vivo de los entrenamientos (conversaciones en curso e indicadores del día).
- `informe_ia.py`: el informe de la IA sobre un postulante (IPV con su baremo y entrenamientos) para el equipo.
- `registro_rapido.py`: creación rápida de postulantes (link o QR de 20 minutos por grupo; se registran solos).
"""
from __future__ import annotations

from . import api, audios, en_vivo, entrenamientos, entrenamientos_publico, ficha_pdf, informe_ia, publico_api, registro_rapido
from .migraciones import MIGRACIONES

ROUTERS = [api.router, publico_api.router, entrenamientos.router, entrenamientos_publico.router, en_vivo.router, ficha_pdf.router,
           informe_ia.router, registro_rapido.router, registro_rapido.publico]
WORKERS = {"capacitacion_audios": audios.worker, "capacitacion_entrenamientos": entrenamientos.worker,
           "capacitacion_ipv": publico_api.worker, "capacitacion_informes": informe_ia.worker}
MIGRACIONES_DATOS = list(MIGRACIONES)
