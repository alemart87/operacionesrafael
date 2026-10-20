"""Links de creación rápida de usuarios (invitaciones con QR que vencen a los 30 minutos)."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .user import gen_uuid


class Invitacion(Base):
    __tablename__ = "invitaciones_registro"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    # SHA-256 del token del link: así se busca. El token en claro nunca se guarda sin cifrar.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    # El token cifrado (Fernet): para volver a mostrar el QR mientras está vigente. Se borra al vencer o revocarse.
    token_enc: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    perfil: Mapped[str] = mapped_column(String(30), nullable=False)
    operativas: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # La dirección de la plataforma que se usó para armar el link (la del navegador del superadmin).
    origen: Mapped[str] = mapped_column(String(200), nullable=False)
    nota: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    # Solo correos de este dominio (opcional), p. ej. «voicenter.com.py».
    dominio: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    max_usos: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    usos: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    creada_por: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    revocada_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    revocada_por: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
