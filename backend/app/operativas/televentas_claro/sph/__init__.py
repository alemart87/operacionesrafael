"""Televentas CLARO · SPH estimado (utilidades `sph` y `sph_gestion`).

SPH = ventas por hora. Cruza dos módulos que ya existen, sin subir archivos nuevos:

- Horas: el informe de Productividad de llamadas del día (tiempo conectado de cada agente).
- Ventas: el informe de Ventas Netas del mes (netas con su fecha de venta y su vendedor).

No hay un ID común entre la plataforma de llamadas y las ventas de Claro: el agente
se vincula con el vendedor por nombre. El SPH de la operación no depende de ese
cruce; el SPH por asesor es estimado y cada vínculo dice qué tan seguro es.

- `analyzer.py`: cruce por nombre y cálculo (lógica pura, sin DB).
- `models.py`: informes SPH por día (borrador/publicado/reemplazado) y vínculos manuales.
- `api.py`: calcular, informes, publicar/reemplazar, recalcular y vínculos.
"""
from . import models  # noqa: F401  (registra las tablas en Base.metadata)
