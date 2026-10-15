"""Auditoría de Ventas — Televentas Claro.

Un informe de auditoría (AUD-AAAA-NNN) se arma sobre uno o más informes de Ventas
Netas. Al crearlo se **congela** una copia de los datos analizados (`snapshot`):
aunque después se eliminen los informes de origen, la auditoría conserva todo.
Sobre esa copia el auditor trabaja hallazgos, seguimiento, redacción y gráficos.

La **evidencia visual** del informe (`AuditoriaEvidencia`) son figuras numeradas: piezas del lienzo de Voi (gráficos,
tablas, indicadores y tableros, congelados al sumarlas) e imágenes que sube el auditor (capturas, fotos), guardadas en
el disco persistente (`UPLOAD_DIR/auditoria/<informe>/`).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Index, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ....core.database import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


# Estados del informe de auditoría y transiciones permitidas.
#   borrador     → el auditor lo arma.
#   en_revision  → lo revisa la coordinación; puede volver a borrador o cerrarse.
#   cerrado      → emitido: la redacción y los hallazgos quedan fijos, sigue el seguimiento.
#   archivado    → seguimiento terminado; solo lectura.
ESTADOS = ["borrador", "en_revision", "cerrado", "archivado"]
TRANSICIONES: dict[str, set[str]] = {
    "borrador": {"en_revision"},
    "en_revision": {"borrador", "cerrado"},
    "cerrado": {"en_revision", "archivado"},
    "archivado": {"cerrado"},
}
ESTADOS_EDITABLES = {"borrador", "en_revision"}          # redacción, gráficos, alta/edición de hallazgos
ESTADOS_CON_SEGUIMIENTO = {"borrador", "en_revision", "cerrado"}  # notas y estado de los hallazgos

HALLAZGO_ESTADOS = ["abierto", "en_seguimiento", "resuelto", "descartado"]
HALLAZGO_ESTADO_LABEL = {"abierto": "Abierto", "en_seguimiento": "En seguimiento", "resuelto": "Resuelto", "descartado": "Descartado"}
SEVERIDADES = ["alta", "media", "baja", "info"]
EVIDENCIA_TIPOS = ["grafico", "imagen"]          # pieza del lienzo (congelada) | imagen subida
EVIDENCIA_ORIGENES = ["voi", "lienzo", "subida"]  # la propuso Voi · la eligió el usuario en el lienzo · la subió
MAX_EVIDENCIAS = 60
CATEGORIAS = ["vendedor", "sali_hablando", "sin_uso", "activacion", "pendientes", "suspendidas", "riesgo",
              "productividad", "sph", "logistica", "supervision", "informe_diario", "cruce", "otro"]


class Auditoria(Base):
    __tablename__ = "auditorias"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    codigo: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    titulo: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="borrador", nullable=False, index=True)
    periodo_desde: Mapped[Optional[str]] = mapped_column(String(7), nullable=True)  # 'YYYY-MM'
    periodo_hasta: Mapped[Optional[str]] = mapped_column(String(7), nullable=True)

    # Redacción del auditor.
    alcance: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resumen: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    conclusiones: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    recomendaciones: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Fuentes (qué informes de Ventas Netas se usaron y cómo estaban), datos congelados,
    # gráficos elegidos por el auditor e historial de estados.
    fuentes: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    graficos: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    historial: Mapped[list] = mapped_column(JSON, default=list, nullable=False)

    created_by: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditoriaHallazgo(Base):
    __tablename__ = "auditoria_hallazgos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    auditoria_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    orden: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    codigo: Mapped[str] = mapped_column(String(10), nullable=False)  # H-01, H-02…
    titulo: Mapped[str] = mapped_column(String(255), nullable=False)
    descripcion: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    severidad: Mapped[str] = mapped_column(String(8), default="media", nullable=False)
    categoria: Mapped[str] = mapped_column(String(30), default="otro", nullable=False)
    vendedor: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    estado: Mapped[str] = mapped_column(String(16), default="abierto", nullable=False, index=True)
    recomendacion: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    responsable: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    fecha_compromiso: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    evidencia: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    origen: Mapped[str] = mapped_column(String(8), default="auto", nullable=False)  # auto | manual

    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditoriaSeguimiento(Base):
    """Bitácora del informe: notas del auditor, cambios de estado y de hallazgos."""
    __tablename__ = "auditoria_seguimientos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    auditoria_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    hallazgo_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    tipo: Mapped[str] = mapped_column(String(16), default="nota", nullable=False)  # nota | estado | hallazgo
    texto: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    # Con microsegundos desde Python: varias entradas en el mismo segundo conservan el orden real.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, server_default=func.now(), nullable=False)


class AuditoriaEvidencia(Base):
    """Una figura del informe: una pieza del lienzo de Voi (con su especificación congelada: el gráfico se vuelve a
    dibujar igual, en pantalla y en el PDF) o una imagen subida (en el disco persistente, sin metadatos)."""
    __tablename__ = "auditoria_evidencias"
    __table_args__ = (Index("ix_auditoria_evidencia_orden", "auditoria_id", "orden"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    auditoria_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    orden: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tipo: Mapped[str] = mapped_column(String(10), nullable=False)                     # grafico | imagen
    titulo: Mapped[str] = mapped_column(String(255), nullable=False)
    nota: Mapped[Optional[str]] = mapped_column(Text, nullable=True)                  # lectura / comentario del auditor
    hallazgo_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    spec: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)                 # pieza del lienzo (normalizada)
    # Imagen: rutas relativas a UPLOAD_DIR (las arma el servidor; nunca vienen del usuario).
    archivo: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    miniatura: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    archivo_nombre: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # cómo se llamaba al subirla
    bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    ancho: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    alto: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    origen: Mapped[str] = mapped_column(String(10), default="subida", nullable=False)
    conversacion_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)   # de qué conversación de Voi salió
    artefacto_id: Mapped[Optional[str]] = mapped_column(String(48), nullable=True)      # pieza (o «pieza#parte») del lienzo

    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, server_default=func.now(), nullable=False)
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
