"""Puente de herramientas de Voi: lo que el agente puede consultar y hacer en la plataforma.

`base.py` define cómo es una herramienta y sus niveles de autonomía; `datos.py` (consultas) y `acciones.py` (acciones)
las registran. `ejecutar` corre una con los permisos actuales del usuario y devuelve el resultado para el agente.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from . import acciones, datos, documentos, facturacion, investigacion, lienzo  # noqa: F401  (registran sus herramientas)
from .base import (CONFIRMAR, CONSULTAR, PROPIO, REGISTRO, Ctx, ErrorHerramienta, Herramienta, para_usuario)

log = logging.getLogger("asistente.herramientas")

__all__ = ["CONFIRMAR", "CONSULTAR", "PROPIO", "REGISTRO", "Ctx", "ErrorHerramienta", "Herramienta", "para_usuario",
           "ejecutar", "obtener"]


def obtener(nombre: str) -> Herramienta | None:
    """Acepta el nombre con otra capitalización (el modelo a veces la cambia)."""
    return REGISTRO.get(nombre) or next((h for k, h in REGISTRO.items() if k.lower() == (nombre or "").lower()), None)


async def ejecutar(h: Herramienta, entrada: dict[str, Any], ctx: Ctx, modo: str) -> tuple[str, bool]:
    """Corre la herramienta y devuelve (texto para el agente, es_error). Revisa el permiso en el momento."""
    if not h.disponible(ctx.user, modo):
        return ("No tenés permiso para esto en la plataforma: no lo intentes por otro camino; contale al usuario qué "
                "permiso le falta.", True)
    try:
        resultado = await h.fn(ctx, entrada if isinstance(entrada, dict) else {})
    except ErrorHerramienta as exc:
        await ctx.db.rollback()        # nada a medio hacer queda pendiente de guardar
        return (str(exc), True)
    except Exception as exc:  # noqa: BLE001 — un fallo nuestro no debe cortar la conversación
        log.exception("Herramienta %s falló", h.nombre)
        await ctx.db.rollback()
        return (f"La plataforma no pudo completar «{h.etiqueta}» ({type(exc).__name__}). Probá de nuevo o avisá a soporte.",
                True)
    return (json.dumps(resultado, ensure_ascii=False, default=str), False)
