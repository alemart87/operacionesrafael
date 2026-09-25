"""Televentas CLARO · Auditoría de Ventas (utilidad `auditoria`).

Circuito de auditoría sobre los informes de Ventas Netas: riesgos y ranking de
vendedores en vivo, e informes de auditoría (AUD-AAAA-NNN) con los datos
analizados congelados, hallazgos automáticos y manuales con evidencia,
seguimiento, estados con historial y redacción para imprimir en PDF.

- `api.py`: fuentes, riesgos en vivo, informes, hallazgos, seguimiento, estados.
- `models.py` · `schemas.py`: tablas y contratos de la API.
- `snapshot.py`: consolidación de informes, ranking, señales, datos llamativos
  y hallazgos automáticos (lógica pura, cubierta por tests).
"""
from . import models  # noqa: F401  (registra las tablas en Base.metadata)
