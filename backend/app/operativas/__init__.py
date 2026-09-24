"""Código de las operativas (módulos independientes).

Cada operativa es un paquete `operativas/<slug>/` que expone `ROUTERS` y
`WORKERS`; `main.py` monta los primeros y supervisa los segundos. Importar
este paquete registra también sus modelos en `Base.metadata`.

El catálogo (nombres, utilidades y permisos) sigue en `core/operativas.py`.
"""
from __future__ import annotations

from . import televentas_claro

_MODULOS = [televentas_claro]

ROUTERS = [r for m in _MODULOS for r in m.ROUTERS]
WORKERS = {nombre: w for m in _MODULOS for nombre, w in m.WORKERS.items()}
