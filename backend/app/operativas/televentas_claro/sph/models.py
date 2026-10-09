"""SPH estimado — Televentas Claro. Informes por día y vínculos manuales agente → vendedor."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Float, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ....core.database import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


# Mismo circuito que Productividad y Ventas Netas:
#   draft     → visible solo para gestión; "Calcular" y "Recalcular" lo rehacen.
#   published → el único válido del día. No cambia nunca: recalcular genera otro borrador.
#   replaced  → fue el publicado y otro lo reemplazó. Queda en el historial.
ESTADO_BORRADOR = "draft"
ESTADO_PUBLICADO = "published"
ESTADO_REEMPLAZADO = "replaced"


class SphInforme(Base):
    """SPH de un período (día, semana, mes o rango): las horas de Productividad cruzadas con las ventas del día de la
    hoja de productividad de Ventas Netas (hasta la v3, con las netas)."""
    __tablename__ = "sph_informes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    fecha: Mapped[date] = mapped_column(Date, nullable=False, index=True)  # inicio del período
    # Fin del período y tipo (dia, semana, mes, rango). Los informes anteriores a los períodos no los tienen: un día.
    hasta: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    tipo: Mapped[Optional[str]] = mapped_column(String(10), nullable=True, default="dia")
    dias: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, default=1)  # días que cuentan
    version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # del cálculo (vacía: anterior a la v4)
    status: Mapped[str] = mapped_column(String(12), default=ESTADO_BORRADOR, nullable=False, index=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    generated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    published_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    replaced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    replaced_by_report_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)

    # Fuentes con las que se calculó (quedan congeladas en `data`; acá para detectar datos más nuevos).
    prod_informe_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    ventas_report_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    ventas_corte: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Resumen desnormalizado para la lista (sin abrir el JSON).
    sph: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ventas: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # desde la v4: ventas del período que cuentan
    netas: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # hasta la v3: netas del período (después, 0)
    horas: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    agentes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    vinculados: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    pct_cobertura: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # % de las netas con asesor
    pct_activadas: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # hasta la v3: netas ÷ cargadas del día

    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class SphVinculo(Base):
    """Vínculo manual de un agente de la plataforma con un vendedor de Ventas Netas.

    Manda sobre el cruce automático en los cálculos siguientes. `vendedor` vacío =
    "no es ninguno de la lista": el agente queda sin vínculo aunque el nombre se parezca.
    """
    __tablename__ = "sph_vinculos"

    clave: Mapped[str] = mapped_column(String(200), primary_key=True)  # clave del agente en Productividad
    nombre: Mapped[str] = mapped_column(String(200), nullable=False)    # como lo muestra Productividad
    vendedor: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
