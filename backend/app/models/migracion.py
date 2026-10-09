"""Migraciones de datos de una sola vez (p. ej. dar a los perfiles existentes una utilidad nueva).

A diferencia de `MIGRATIONS_IDEMPOTENT` (DDL que corre en cada arranque), cada una corre una vez:
queda anotada acá y no se repite, así no pisa lo que después cambie el superadmin.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


class MigracionDatos(Base):
    __tablename__ = "migraciones_datos"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    aplicada_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    resultado: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
