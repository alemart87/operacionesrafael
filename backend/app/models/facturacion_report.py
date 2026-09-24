"""Reporte de Facturación — Televentas Claro. KPIs + data JSON (todas las descripciones)."""
from __future__ import annotations

import uuid
from datetime import datetime, date
from typing import Optional

from sqlalchemy import Boolean, DateTime, Date, Integer, Numeric, String, JSON, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


class FacturacionReport(Base):
    __tablename__ = "facturacion_reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    upload_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    period_month: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    nro_liquidacion: Mapped[Optional[str]] = mapped_column(String(40), nullable=True, index=True)
    periodo: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # 'YYYY-MM'
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    total: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    creditos: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    debitos: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    ventas_activaciones: Mapped[int] = mapped_column(Integer, default=0)

    is_published: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    published_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
