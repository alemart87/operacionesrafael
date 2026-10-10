"""Informe diario de la operación — Televentas Claro.

- `InformeDiario`: uno por autor y fecha. Es un borrador mientras se arma; al firmarlo queda cerrado, con su
  código de verificación, y solo se le agregan comentarios.
- `InformeCompromiso`: los compromisos de las métricas críticas, desde que se firma el informe. Los informes
  siguientes del mismo autor los siguen (cumplido, en curso o no cumplido) hasta cerrarlos.
- `InformeComentario`: lo que comenta el superadmin y lo que le responde el autor.
- `InformeFirma`: la firma manuscrita guardada de cada usuario y su cargo, para reusarlas.
- `InformeParametros`: el diccionario de palabras clave (lo edita el superadmin).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import JSON, Date, DateTime, Index, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from ....core.database import Base

OPERATIVA = "televentas_claro"
BORRADOR, FIRMADO = "borrador", "firmado"
ABIERTO, CUMPLIDO, NO_CUMPLIDO = "abierto", "cumplido", "no_cumplido"


def gen_uuid() -> str:
    return str(uuid.uuid4())


class InformeDiario(Base):
    __tablename__ = "informes_diarios"
    __table_args__ = (
        UniqueConstraint("operativa", "autor_id", "fecha", name="uq_informe_diario_autor_fecha"),
        Index("ix_informes_diarios_fecha_estado", "fecha", "estado"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    operativa: Mapped[str] = mapped_column(String(40), default=OPERATIVA, nullable=False)
    fecha: Mapped[date] = mapped_column(Date, nullable=False, index=True)          # el día que informa
    autor_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    autor_nombre: Mapped[str] = mapped_column(String(255), nullable=False)
    autor_cargo: Mapped[str] = mapped_column(String(120), nullable=False)
    estado: Mapped[str] = mapped_column(String(12), default=BORRADOR, nullable=False)
    # Zona manual: {"pospago": {"valor", "meta", "comentario"}, "gpon": {...}, "otros": [{"id", "nombre", "valor",
    # "meta", "comentario"}], "fuente": texto si se tomaron de la planilla}.
    resultados: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    resumen: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # [{"id", "nombre", "indicador", "anterior", "estado": critico|atencion|ok, "comentario", "compromiso",
    #   "responsable", "fecha_compromiso"}]
    metricas: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    # Datos importados de la plataforma, congelados al importarlos (los calcula el servidor).
    importados: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    # Seguimiento de compromisos anteriores: [{"compromiso_id", "estado", "nota"}] (al firmar, con su texto).
    seguimiento: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    # Al firmar: {"nombre", "cargo", "imagen", "firmado_at", "codigo"}.
    firma: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    firmado_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # El autor leyó los comentarios hasta este momento; el superadmin lo revisó (y cuándo).
    leido_autor_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    revisado_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    revisado_por: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)


class InformeCompromiso(Base):
    __tablename__ = "informes_diarios_compromisos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    operativa: Mapped[str] = mapped_column(String(40), default=OPERATIVA, nullable=False)
    informe_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)   # donde se asumió
    autor_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    fecha: Mapped[date] = mapped_column(Date, nullable=False)                         # del informe que lo asumió
    metrica: Mapped[str] = mapped_column(String(120), nullable=False)
    texto: Mapped[str] = mapped_column(Text, nullable=False)
    responsable: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    fecha_limite: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    estado: Mapped[str] = mapped_column(String(12), default=ABIERTO, nullable=False, index=True)
    cerrado_en: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)      # informe que lo cerró
    cerrado_fecha: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    # [{"fecha", "informe_id", "estado": cumplido|en_curso|no_cumplido, "nota"}]
    historial: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class InformeComentario(Base):
    __tablename__ = "informes_diarios_comentarios"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    informe_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    autor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    autor_nombre: Mapped[str] = mapped_column(String(255), nullable=False)
    rol: Mapped[str] = mapped_column(String(20), nullable=False)    # superadmin | autor
    texto: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class InformeFirma(Base):
    __tablename__ = "informes_diarios_firmas"

    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    imagen: Mapped[Optional[str]] = mapped_column(Text, nullable=True)       # data:image/png;base64,… (validada)
    cargo: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class InformeParametros(Base):
    __tablename__ = "informes_diarios_parametros"

    operativa: Mapped[str] = mapped_column(String(40), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)    # {"temas": [...]} (ver palabras.py)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
