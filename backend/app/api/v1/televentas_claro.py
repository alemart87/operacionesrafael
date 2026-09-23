"""Operativa Televentas CLARO.

Módulo independiente. Cada endpoint se protege con el permiso de la utilidad
que implementa, por ejemplo:

    @router.post("/cargas", dependencies=[Depends(require_perm(f"{SLUG}.cargar"))])

Las utilidades disponibles están declaradas en `core/operativas.py`.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ...core.operativas import get_operativa
from ..deps import CurrentUser, require_perm
from .operativas import operativa_for_user


SLUG = "televentas_claro"

router = APIRouter(prefix="/televentas-claro", tags=["televentas-claro"])


@router.get("")
async def inicio(user: CurrentUser = Depends(require_perm(f"{SLUG}.ver"))) -> dict:
    """Portada de la operativa: datos y utilidades habilitadas para el usuario."""
    return operativa_for_user(get_operativa(SLUG), user)
