"""Helper for inserting audit log rows."""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from ..models.audit import AuditLog


async def record_action(
    db: AsyncSession,
    *,
    user_id: Optional[str],
    action: str,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    extra: Optional[dict[str, Any]] = None,
) -> None:
    def _clip(v: Optional[str], n: int) -> Optional[str]:
        return v[:n] if isinstance(v, str) and len(v) > n else v

    # Truncado defensivo: los campos del audit son VARCHAR acotados; nunca queremos
    # que un registro de auditoría tumbe (500) la operación que está auditando.
    row = AuditLog(
        user_id=_clip(user_id, 36),
        action=_clip(action, 100),
        resource_type=_clip(resource_type, 100),
        resource_id=_clip(resource_id, 100),
        ip_address=_clip(ip, 64),
        user_agent=_clip(user_agent, 500),
        extra=extra or {},
    )
    db.add(row)
    await db.commit()
