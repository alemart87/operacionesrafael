"""Televentas CLARO · Facturación (utilidad `facturacion`, solo superadmin).

Liquidación de comisiones de Claro: parser del .txt, análisis, comparativo,
simuladores (móvil y GPON), criterios y agente IA.

- `api.py` / `agent_api.py`: routers, todos con `require_perm("televentas_claro.facturacion")`.
- `models/` · `schemas.py`: tablas y contratos de la API.
- `parser.py` · `analyzers/`: lógica pura (sin DB), cubierta por tests.
- `jobs/`: cola supervisada que parsea cada carga en un subproceso aislado.
- `agent/`: agente y herramientas sobre el motor compartido `services/agent`.
"""
