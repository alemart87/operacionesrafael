"""Tablas de Voi, el agente de la plataforma (Claude Managed Agents).

- `AsistenteConfig`: configuración (una fila): encendido, perfiles, topes de gasto, retención y los recursos publicados
  en Anthropic (entorno, habilidades y versión del agente).
- `AsistenteUsuario`: lo de cada usuario en Anthropic: su memoria (memory store).
- `AsistenteConversacion`: una conversación = una sesión de Managed Agents, con su estado, costo y contexto.
- `AsistenteEvento`: copia de cada evento de la sesión (lo que dijo cada uno, cada herramienta, el consumo). Es lo que
  lee la consola del superadmin y lo que queda cuando la sesión se borra en Anthropic.
- `AsistenteAccion`: cada herramienta de la plataforma que Voi usó: las consultas (nivel 1) y las acciones que propuso o
  hizo (con su nivel de autonomía, la confirmación y el resultado). Garantiza que cada pedido del agente se ejecute y se
  responda una sola vez, aunque se corte la conexión o se reinicie el servidor.
- `AsistenteUsoDiario`: consumo por usuario y día (US$ y tokens), para la consola y los topes.
- `AsistenteArtefacto`: lo que Voi mostró en el lienzo (gráficos, tablas, indicadores, tableros), por conversación;
  marcado como confidencial si la conversación ya usó datos de Facturación.
- `AsistenteDocumento` y `AsistenteFragmento`: la base de conocimiento que sube el superadmin (el archivo original, su
  texto en fragmentos para buscar y citar, y quién lo puede consultar).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, Date, DateTime, Index, Integer, LargeBinary, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base

# Estados de una llamada a herramienta / acción
PENDIENTE, EJECUTANDO, EJECUTADA, CANCELADA, FALLIDA = "pendiente", "ejecutando", "ejecutada", "cancelada", "fallida"


def gen_uuid() -> str:
    return str(uuid.uuid4())


class AsistenteConfig(Base):
    __tablename__ = "asistente_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    # Lo publicado en Anthropic: {"entorno": {...}, "habilidades": {slug: {...}}, "agente": {...}}.
    recursos: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)


class AsistenteUsuario(Base):
    __tablename__ = "asistente_usuarios"

    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    memoria_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)   # memstore_…
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AsistenteConversacion(Base):
    __tablename__ = "asistente_conversaciones"
    __table_args__ = (Index("ix_asistente_conv_usuario_actividad", "user_id", "ultima_actividad"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    user_nombre: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    perfil: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    titulo: Mapped[str] = mapped_column(String(200), default="Nueva conversación", nullable=False)
    tipo: Mapped[str] = mapped_column(String(12), default="chat", nullable=False)          # chat | mision
    fijada: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # El usuario la sacó de su lista: deja de verla, pero el superadmin la conserva hasta que vence la retención.
    oculta: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    session_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, index=True)   # sesn_… de Anthropic
    agente_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # creando | idle | running | requires_action | budget_reached | terminated | error | borrada
    estado: Mapped[str] = mapped_column(String(20), default="creando", nullable=False)
    stop_reason: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    tope_centavos: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    costo_centavos: Mapped[int] = mapped_column(Integer, default=0, nullable=False)       # list cost de la sesión
    tokens: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    # Lo que se le dio a la sesión: {"herramientas": [...], "habilidades": [...], "pantalla": {...}}
    contexto: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    # Modo auditor (investigación): {"auditoria_id", "codigo", "titulo", "estado", "desde", "por"} o vacío. Columna
    # propia: la escriben el usuario y Voi sin pisar lo que el consumidor anota en `contexto`.
    investigacion: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    mensajes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    temas: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ultima_actividad: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sesion_borrada_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class AsistenteEvento(Base):
    __tablename__ = "asistente_eventos"
    __table_args__ = (UniqueConstraint("conversacion_id", "evento_id", name="uq_asistente_evento"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversacion_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    evento_id: Mapped[str] = mapped_column(String(80), nullable=False)
    tipo: Mapped[str] = mapped_column(String(60), nullable=False)
    datos: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AsistenteAccion(Base):
    __tablename__ = "asistente_acciones"
    __table_args__ = (UniqueConstraint("conversacion_id", "evento_id", name="uq_asistente_accion_evento"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    conversacion_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    herramienta: Mapped[str] = mapped_column(String(80), nullable=False)
    nivel: Mapped[int] = mapped_column(Integer, nullable=False)
    entrada: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    resumen: Mapped[str] = mapped_column(Text, default="", nullable=False)          # qué va a hacer, en palabras
    estado: Mapped[str] = mapped_column(String(12), default=PENDIENTE, nullable=False)   # pendiente|ejecutando|…
    resultado: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    evento_id: Mapped[str] = mapped_column(String(80), nullable=False)               # el agent.custom_tool_use
    hilo_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    # El texto que se le devuelve al agente: se guarda hasta que Anthropic lo recibe (por si hay que reenviarlo).
    respuesta: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    respondida_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    resuelta_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class AsistenteUsoDiario(Base):
    __tablename__ = "asistente_uso_diario"

    fecha: Mapped[date] = mapped_column(Date, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    perfil: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    mensajes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    herramientas: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    acciones: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cache_lectura: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cache_escritura: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    costo_centavos: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class AsistenteArtefacto(Base):
    __tablename__ = "asistente_artefactos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    conversacion_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    evento_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)      # el pedido del agente
    tipo: Mapped[str] = mapped_column(String(20), nullable=False)
    titulo: Mapped[str] = mapped_column(String(200), nullable=False)
    spec: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)           # ya validada y normalizada
    # La conversación ya había usado datos de Facturación: la pieza no puede ir a un informe que ven otros perfiles.
    confidencial: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AsistenteDocumento(Base):
    __tablename__ = "asistente_documentos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    titulo: Mapped[str] = mapped_column(String(200), nullable=False)
    descripcion: Mapped[str] = mapped_column(Text, default="", nullable=False)       # qué contiene (ayuda a Voi)
    archivo_nombre: Mapped[str] = mapped_column(String(255), nullable=False)
    mime: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    paginas: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Quién lo puede consultar: {"tipo": "todos" | "permisos" | "superadmin", "permisos": ["<operativa>.<utilidad>", …]}
    alcance: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    activo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    contenido_gz: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)  # el archivo original (comprimido)
    caracteres: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    fragmentos: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)


class AsistenteFragmento(Base):
    __tablename__ = "asistente_fragmentos"
    __table_args__ = (Index("ix_asistente_fragmento_doc_orden", "documento_id", "orden"),)

    id: Mapped[str] = mapped_column(String(24), primary_key=True)                     # frag_… (lo que cita Voi)
    documento_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    orden: Mapped[int] = mapped_column(Integer, nullable=False)
    pagina: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    seccion: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    texto: Mapped[str] = mapped_column(Text, nullable=False)
    terminos: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)       # término normalizado → veces
