"""Supervisión — Televentas Claro: maestro de operadores, equipos del mes, objetivos y parámetros."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Integer, JSON, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from ....core.database import Base

OPERATIVA = "televentas_claro"


def gen_uuid() -> str:
    return str(uuid.uuid4())


# Estado del cruce de un operador:
#   con las dos identidades → exacto | probable (cruce automático por nombre) | manual (lo vinculó una persona)
#   solo el agente de llamadas → ambiguo | sin_cruce | incompleto (por revisar) | descartado (confirmado: no vende)
#   solo el vendedor de ventas → sin_agente (por revisar) | solo_ventas (confirmado: no usa la plataforma)
VINCULADO = ("exacto", "probable", "manual")
AGENTE_PENDIENTE = ("ambiguo", "sin_cruce", "incompleto")
VENDEDOR_PENDIENTE = ("sin_agente",)


class Operador(Base):
    """Una persona del piso: su nombre en llamadas (agente de Productividad) y en ventas (vendedor del POS).

    No hay un ID común entre las dos fuentes: el cruce automático usa el mismo motor que el SPH y lo
    que decide una persona manda. Es la fuente única de los vínculos (Supervisión y SPH)."""
    __tablename__ = "sup_operadores"
    __table_args__ = (
        UniqueConstraint("operativa", "agente_clave", name="uq_sup_operador_agente"),
        UniqueConstraint("operativa", "vendedor", name="uq_sup_operador_vendedor"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    operativa: Mapped[str] = mapped_column(String(40), default=OPERATIVA, nullable=False, index=True)
    nombre: Mapped[str] = mapped_column(String(200), nullable=False)
    nombre_manual: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # lo renombró una persona
    agente_clave: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)   # clave de Productividad
    agente_nombre: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)  # como lo muestra Productividad
    vendedor: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)       # POS sin el prefijo del subcanal
    subcanal: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    legajo: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    cruce: Mapped[str] = mapped_column(String(20), nullable=False, default="sin_cruce")
    candidatos: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    activo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    primera_vez: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    ultima_vez: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)


class EquipoAsignacion(Base):
    """Asesor → supervisor dentro de un mes, desde una fecha (fecha efectiva).

    El supervisor de un asesor un día D del mes es el de la asignación con el mayor `desde` ≤ D.
    `supervisor_id` vacío = sin supervisor desde esa fecha. Cada mes se arma (o se copia del anterior)."""
    __tablename__ = "sup_equipo_asignaciones"
    __table_args__ = (UniqueConstraint("operativa", "periodo", "operador_id", "desde", name="uq_sup_asignacion"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    operativa: Mapped[str] = mapped_column(String(40), default=OPERATIVA, nullable=False)
    periodo: Mapped[str] = mapped_column(String(7), nullable=False, index=True)  # 'YYYY-MM'
    operador_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    supervisor_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    desde: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)


class ObjetivoSupervisor(Base):
    """Objetivos del mes de un supervisor (netas de su equipo). Los cargan los jefes."""
    __tablename__ = "sup_objetivos"
    __table_args__ = (UniqueConstraint("operativa", "periodo", "supervisor_id", name="uq_sup_objetivo"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    operativa: Mapped[str] = mapped_column(String(40), default=OPERATIVA, nullable=False)
    periodo: Mapped[str] = mapped_column(String(7), nullable=False, index=True)
    supervisor_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    pospago: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    gpon: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)


class SupParametros(Base):
    """Parámetros de Supervisión de una operativa (una fila): calendario de días hábiles y días no laborables."""
    __tablename__ = "sup_parametros"

    operativa: Mapped[str] = mapped_column(String(40), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)


class OperadoresSync(Base):
    """Última detección de operadores de un mes: con qué informes se hizo (firma) y qué encontró."""
    __tablename__ = "sup_operadores_sync"

    id: Mapped[str] = mapped_column(String(60), primary_key=True)  # '<operativa>:<YYYY-MM>'
    firma: Mapped[str] = mapped_column(String(64), nullable=False)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    resumen: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
