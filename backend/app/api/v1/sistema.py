"""Sistema: estado del almacenamiento (solo superadmin). Dónde quedan la base y los archivos, si el disco es
persistente y qué se puede recalcular sin él. Nunca expone credenciales ni la URL de la base."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...services.almacenamiento import diagnostico
from ...services.audit_service import record_action
from ..deps import CurrentUser, client_ip, require_superadmin

router = APIRouter(prefix="/sistema", tags=["sistema"])


@router.get("/almacenamiento")
async def ver_almacenamiento(request: Request, user: CurrentUser = Depends(require_superadmin),
                             db: AsyncSession = Depends(get_db)) -> dict:
    out = await diagnostico(db)
    await record_action(db, user_id=user.id, action="view_almacenamiento", resource_type="sistema",
                        resource_id="almacenamiento", ip=client_ip(request), extra={"estado": out["estado"]})
    return out
