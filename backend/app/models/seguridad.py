"""Seguridad de acceso: sesiones controladas por el servidor y configuración que define el superadmin."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class UserSession(Base):
    """Una sesión iniciada. Cada token lleva su id: si la sesión se cierra, el token deja de servir."""
    __tablename__ = "user_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)  # "superadmin" para el de .env
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(400), nullable=True)
    mfa: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    # logout | cerrada | inactividad | vencida | horario | usuario_inactivo
    end_reason: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    ended_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    fuera_horario_registrado: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class SecuritySettings(Base):
    """Fila única (id=1) con la política de seguridad y el segundo factor del superadmin de .env."""
    __tablename__ = "security_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    superadmin_totp_enc: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    superadmin_totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    superadmin_recovery: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
