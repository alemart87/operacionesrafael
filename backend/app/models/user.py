"""Usuarios en DB. El superadmin vive solo en .env."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    # Perfil: coordinador | supervisor | analista | cliente (ver core/perfiles.py)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="analista")
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    photo_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # Operativas asignadas (slugs). Lista vacía = ninguna.
    operativas: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- seguridad de acceso (columnas nullable: las filas viejas quedan en None = valores por defecto)
    failed_attempts: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, default=0)
    last_failed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    must_change_password: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=False)
    password_changed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    password_history: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    totp_secret_enc: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    totp_enabled: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=False)
    totp_recovery: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    # Excepción de horario que da el superadmin (vence sola)
    access_exception_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    access_exception_note: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
