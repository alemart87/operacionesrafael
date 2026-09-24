"""Televentas CLARO · Ventas Netas (utilidades `ventas_netas` y `ventas_netas_gestion`).

Cortes diarios del archivo .xlsx de ventas de Claro → informe por período
(mes de venta/activación) con visión negocio y operativa, publicación única
por mes y planilla descargable.

- `api.py`: uploads, informes, publicar/reemplazar/despublicar, export.
- `models.py` · `schemas.py`: tablas y contratos de la API.
- `parser.py` · `analyzer.py`: lógica pura (sin DB), cubierta por tests.
- `exports.py`: planilla .xlsx de la visión operativa.
- `jobs.py`: cola supervisada; parsea cada corte en un subproceso aislado.
"""
from . import models  # noqa: F401  (registra las tablas en Base.metadata)
