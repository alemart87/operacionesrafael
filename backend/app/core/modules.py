"""Catálogo de módulos operativos de la Gerencia Expansión RM.

`slug` es el identificador estable que se guarda en User.allowed_modules.
Para agregar un módulo:
  1. Sumarlo a esta lista.
  2. Crear su router en `api/v1/` y montarlo en `main.py`.
  3. Crear sus rutas en el frontend (`src/app/<slug>/`) y su tarjeta en el hub
     (`src/app/inicio/page.tsx`).

Los módulos con `available: False` se muestran en el hub como "Próximamente".
"""
from __future__ import annotations


MODULES: list[dict] = [
    {
        "slug": "tablero",
        "name": "Tablero de Expansión",
        "description": "Indicadores principales de la Gerencia Expansión RM. Definición pendiente.",
        "available": False,
        "color": "#E6332A",
    },
]


MODULE_SLUGS = {m["slug"] for m in MODULES}


def is_valid_slug(slug: str) -> bool:
    return slug in MODULE_SLUGS


def filter_valid_slugs(slugs: list[str] | None) -> list[str] | None:
    """Devuelve solo los slugs válidos. None se preserva (= acceso total)."""
    if slugs is None:
        return None
    return [s for s in slugs if s in MODULE_SLUGS]
