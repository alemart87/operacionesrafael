"""Permisos de cada perfil, editables por el superadmin."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


class Profile(Base):
    __tablename__ = "profiles"

    # Slug del perfil: coordinador | supervisor | analista | cliente
    slug: Mapped[str] = mapped_column(String(30), primary_key=True)
    # Lista de permisos "<operativa>.<utilidad>"
    permissions: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
