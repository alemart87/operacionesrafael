"""Hub de operativas: qué operativas ve el usuario y qué utilidades tiene en cada una."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ...core.operativas import OPERATIVAS, utilidad_visible
from ..deps import CurrentUser, get_current_user


router = APIRouter(prefix="/operativas", tags=["operativas"])


def operativa_for_user(op: dict, user: CurrentUser) -> dict:
    return {
        "slug": op["slug"],
        "name": op["name"],
        "description": op["description"],
        "color": op["color"],
        "available": op["available"],
        # Las utilidades restringidas ni siquiera se muestran a los perfiles que no las pueden tener.
        "utilidades": [
            {**u, "habilitada": user.has_perm(f"{op['slug']}.{u['key']}")}
            for u in op["utilidades"]
            if utilidad_visible(op["slug"], u, user.role)
        ],
    }


@router.get("")
async def list_operativas(user: CurrentUser = Depends(get_current_user)) -> list[dict]:
    """Operativas a las que el usuario tiene acceso (superadmin: todas)."""
    return [operativa_for_user(op, user) for op in OPERATIVAS if user.can_access(op["slug"])]
