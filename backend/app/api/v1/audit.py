"""Auditoría: solo superadmin."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...models.audit import AuditLog
from ...models.user import User
from ...schemas.audit import AuditRead
from ..deps import CurrentUser, require_superadmin


router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=list[AuditRead])
async def list_audit(
    limit: int = Query(200, ge=1, le=1000),
    action: str | None = Query(None),
    user_id: str | None = Query(None),
    user: CurrentUser = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> list[AuditLog]:
    stmt = select(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)
    stmt = stmt.order_by(AuditLog.occurred_at.desc(), AuditLog.id.desc()).limit(limit)
    rows = await db.execute(stmt)
    return list(rows.scalars().all())


@router.get("/users-map")
async def users_map(
    user: CurrentUser = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, dict]:
    """user_id → {email, full_name} para mostrar nombres en la tabla de auditoría."""
    rows = (await db.execute(select(User))).scalars().all()
    out = {u.id: {"email": u.email, "full_name": u.full_name} for u in rows}
    out["superadmin"] = {"email": "superadmin", "full_name": "Superadmin"}
    return out
