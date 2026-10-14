"""Logística de entregas — Televentas Claro. Cortes de pedidos subidos e informes por período (mes)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Float, Integer, JSON, LargeBinary, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ....core.database import Base
from ....models.user import gen_uuid

ESTADO_BORRADOR = "draft"
ESTADO_PUBLICADO = "published"
ESTADO_REEMPLAZADO = "replaced"


class LogisticaUpload(Base):
    """Un .xlsx de pedidos subido (un corte). Guarda las filas ya leídas para recalcular sin el archivo."""
    __tablename__ = "logistica_uploads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    uploaded_by: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    filename: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    file_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    parsed_gz: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    filas: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class LogisticaInforme(Base):
    """Informe de un corte. Período = mes de la fecha de venta de los pedidos; uno publicado por mes."""
    __tablename__ = "logistica_informes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    upload_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    periodo: Mapped[str] = mapped_column(String(7), nullable=False, index=True)   # 'YYYY-MM'
    period_month: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    fecha_dato: Mapped[Optional[date]] = mapped_column(Date, nullable=True)       # última fecha de venta del archivo
    fecha_corte: Mapped[date] = mapped_column(Date, nullable=False)                # el día del corte: desde acá se mide la demora
    version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    generated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(12), default=ESTADO_BORRADOR, nullable=False, index=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    published_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    replaced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    replaced_by_report_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Resumen desnormalizado para la lista.
    pedidos: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    entregados: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    en_gestion: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    devueltos: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    pct_entregados: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    demora_prom: Mapped[Optional[float]] = mapped_column(Float, nullable=True)    # días promedio de los pendientes
    demora_max: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Demora de los pendientes por región, para verla de un vistazo en la lista: {region: {n, dias_prom, dias_max, vencidos_6}}
    demora_regiones: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    proyeccion: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)   # pedidos proyectados a fin de mes
    # Tiempo de entrega de los entregados (fecha de entrega − venta, días hábiles): promedio, máximo y por región
    entrega_prom: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    entrega_max: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    entrega_regiones: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
