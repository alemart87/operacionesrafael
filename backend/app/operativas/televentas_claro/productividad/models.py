"""Productividad de llamadas — Televentas Claro. Cortes del reporte de tiempos e informes diarios."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Float, Integer, JSON, LargeBinary, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ....core.database import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


class ProdCorte(Base):
    """Un archivo "Tiempos Acumulados" subido: totales por agente desde las 00:00 hasta la hora del corte."""
    __tablename__ = "prod_llamadas_cortes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    fecha: Mapped[date] = mapped_column(Date, nullable=False, index=True)  # fecha de gestión (hora de Asunción)
    corte_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)  # al minuto, UTC
    hora_origen: Mapped[str] = mapped_column(String(10), default="archivo", nullable=False)  # archivo | manual
    filename: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # El CSV original comprimido: fuente para recalcular el día sin depender del disco.
    contenido_gz: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    agentes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # con login en el corte
    llamadas: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    umbrales_cortas: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)  # "10,20,30" (Short Talk < N s)
    uploaded_by: Mapped[str] = mapped_column(String(36), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# Estados de un informe diario (mismo circuito que Ventas Netas):
#   draft     → visible solo para gestión; se actualiza con cada corte nuevo del día.
#   published → el único válido del día. Es el que entra en los acumulados.
#   replaced  → fue el publicado y otro lo reemplazó. Queda en el historial, no cuenta.
ESTADO_BORRADOR = "draft"
ESTADO_PUBLICADO = "published"
ESTADO_REEMPLAZADO = "replaced"


class ProdInforme(Base):
    """Informe de productividad de un día, generado a partir de sus cortes."""
    __tablename__ = "prod_llamadas_informes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    fecha: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(12), default=ESTADO_BORRADOR, nullable=False, index=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    generated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    published_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    replaced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    replaced_by_report_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)

    # Resumen desnormalizado para la lista (sin abrir el JSON).
    cortes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    corte_final: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)  # 'HH:MM'
    agentes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    llamadas: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    atendidas: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    pct_contacto: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pct_conversacion: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    banda: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    jornada_media: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # segundos
    alertas: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class ProdParametros(Base):
    """Metas y reglas del módulo (una sola fila, id=1). Las define el superadmin."""
    __tablename__ = "prod_llamadas_parametros"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
