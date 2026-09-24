"""Ventas Netas — Televentas Claro. Cortes diarios subidos e informes por período."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Float, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ....core.database import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


class VentasNetasUpload(Base):
    """Un archivo .xlsx de Claro subido (un corte diario)."""
    __tablename__ = "ventas_netas_uploads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    uploaded_by: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    filename: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    file_path: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    file_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False, index=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


# Estados de un informe:
#   draft     → corte procesado, visible solo para gestión. Puede haber muchos por período.
#   published → el único válido del período. Lo ven todos los perfiles con "ver informes".
#   replaced  → fue el publicado y otro lo reemplazó. Queda en el historial, no cuenta.
ESTADO_BORRADOR = "draft"
ESTADO_PUBLICADO = "published"
ESTADO_REEMPLAZADO = "replaced"


class VentasNetasReport(Base):
    """Informe generado a partir de un corte. Período = mes de la venta/activación."""
    __tablename__ = "ventas_netas_reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    upload_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    periodo: Mapped[str] = mapped_column(String(7), nullable=False, index=True)  # 'YYYY-MM'
    period_month: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    fecha_dato: Mapped[Optional[date]] = mapped_column(Date, nullable=True)  # corte del archivo
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    generated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)

    status: Mapped[str] = mapped_column(String(12), default=ESTADO_BORRADOR, nullable=False, index=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    published_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    replaced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    replaced_by_report_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # KPIs desnormalizados para listar sin abrir el JSON.
    netas: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    pospago: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    gpon: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    iptv: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    pospago_sin_uso: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    pct_sin_uso: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    pendientes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
