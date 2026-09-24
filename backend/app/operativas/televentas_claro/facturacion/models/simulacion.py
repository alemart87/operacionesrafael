"""Simulaciones guardadas del Simulador Anual (Facturación · Televentas Claro).

Registro del trabajo: cada simulación guarda su nombre, comentario, horizonte,
las variables del mes 1, las ventas por mes, los ítems marcados y los post-its
(comentarios sueltos) con autor y fecha. `resumen` es una foto de los totales
al momento de guardar, para listar sin recalcular.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .....core.database import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


class FacturacionSimulacion(Base):
    __tablename__ = "facturacion_simulaciones"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    nombre: Mapped[str] = mapped_column(String(160), nullable=False)
    comentario: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    horizonte: Mapped[int] = mapped_column(Integer, nullable=False, default=12)
    parametros: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    ventas_por_mes: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    meses_afectados: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)  # {"7": {variaciones}}
    bonos_adicionales_por_mes: Mapped[list] = mapped_column(JSON, nullable=False, default=list)  # Gs a mano por mes
    nombres_meses: Mapped[list] = mapped_column(JSON, nullable=False, default=list)             # nombres editables
    marcas: Mapped[list] = mapped_column(JSON, nullable=False, default=list)     # [{key, label}]
    postits: Mapped[list] = mapped_column(JSON, nullable=False, default=list)    # [{id, texto, color, item, autor, fecha}]
    notas: Mapped[list] = mapped_column(JSON, nullable=False, default=list)      # [{id, texto, tipo, mes, autor, fecha}]
    resumen: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)    # foto de anual al guardar

    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by_nombre: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_by_nombre: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), onupdate=func.now(), nullable=True
    )
