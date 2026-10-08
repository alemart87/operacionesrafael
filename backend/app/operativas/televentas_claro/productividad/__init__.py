"""Televentas CLARO · Productividad de llamadas (utilidades `productividad` y `productividad_gestion`).

Cada archivo "Tiempos Acumulados" de la plataforma de discado es un CORTE: los
tiempos y llamadas de cada agente acumulados desde las 00:00 hasta la hora del
export, que viene en el nombre del archivo (y define la fecha de gestión).

- Con un corte por día: informe diario, acumulado semanal y mensual.
- Con varios cortes en el día: la diferencia entre un corte y el siguiente da
  la curva por horario (intradía) y permite separar los turnos.

- `parser.py`: lee el CSV y la fecha/hora del nombre (lógica pura, sin DB).
- `analyzer.py`: informe del día a partir de sus cortes y acumulado de períodos.
- `models.py`: cortes, informes diarios (borrador/publicado/reemplazado) y parámetros.
- `api.py`: subir cortes, informes, publicar/reemplazar, acumulado y parámetros.
"""
from . import models  # noqa: F401  (registra las tablas en Base.metadata)
