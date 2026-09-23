"""Catálogo de módulos operativos."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ...core.modules import MODULES
from ..deps import CurrentUser, get_current_user


router = APIRouter(prefix="/modules", tags=["modules"])


@router.get("")
async def list_modules(user: CurrentUser = Depends(get_current_user)) -> list[dict]:
    """Módulos del sistema; a los lectores se les filtra por allowed_modules."""
    return [m for m in MODULES if user.has_module(m["slug"])]
