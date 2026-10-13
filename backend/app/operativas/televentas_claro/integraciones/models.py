"""Integraciones: claves de API de solo lectura para herramientas externas (KNIME, Power BI, Python) y el registro de
cada uso.

La clave se muestra una sola vez al crearla; acá queda su hash (SHA-256) y un prefijo para reconocerla. Cada llamada
a un dataset deja un registro (`integraciones_usos`) con el resultado: ok, límite superado, denegada o error. Los
límites por minuto y por día se cuentan sobre ese registro, así valen aunque haya más de una instancia.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ....core.database import Base
from ....models.user import gen_uuid

ACTIVA, BLOQUEADA = "activa", "bloqueada"
PREFIJO = "vcop_"   # las claves empiezan así: se reconocen en el header sin confundirlas con un JWT


class ApiClave(Base):
    __tablename__ = "integraciones_claves"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    prefijo: Mapped[str] = mapped_column(String(16), nullable=False, index=True)   # «vcop_» + 8 caracteres visibles
    hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    owner_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)   # de quién es la clave
    owner_nombre: Mapped[str] = mapped_column(String(255), nullable=False)
    creada_por: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expira_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    estado: Mapped[str] = mapped_column(String(12), default=ACTIVA, nullable=False)
    bloqueada_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    bloqueada_por: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    motivo_bloqueo: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    limite_minuto: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    limite_dia: Mapped[int] = mapped_column(Integer, default=5000, nullable=False)
    datasets: Mapped[list] = mapped_column(JSON, default=list, nullable=False)   # vacío = todos los del catálogo
    ultimo_uso_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ultimo_ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    usos: Mapped[int] = mapped_column(Integer, default=0, nullable=False)   # llamadas atendidas (ok) en total


class ApiUso(Base):
    __tablename__ = "integraciones_usos"
    __table_args__ = (Index("ix_integraciones_usos_clave_at", "clave_id", "at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    clave_id: Mapped[str] = mapped_column(String(36), nullable=False)
    clave_prefijo: Mapped[str] = mapped_column(String(16), nullable=False)   # queda aunque la clave se elimine
    clave_nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    dataset: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    ruta: Mapped[str] = mapped_column(String(300), nullable=False)
    ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    status: Mapped[int] = mapped_column(Integer, nullable=False)
    resultado: Mapped[str] = mapped_column(String(12), nullable=False)   # ok | limite | denegada | error
    filas: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    detalle: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
