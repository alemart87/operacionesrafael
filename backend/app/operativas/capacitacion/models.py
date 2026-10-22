"""Capacitación y Mentoría: grupos de capacitación, postulantes, sus estados, el seguimiento (comentarios con dictado),
el link seguro de cada postulante (test IPV y su propio feedback) y el historial."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from ...core.database import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


# Estados de un grupo y de un postulante (el orden es el del embudo).
ESTADOS_GRUPO = ("en_curso", "finalizada", "cancelada")
ESTADOS_POSTULANTE = ("en_capacitacion", "aprobo_escrita", "aprobo_mentoria", "alta_operativa", "abandono", "baja")
# Quién carga cada estado: el capacitador los de la sala; el mentor los del piso. Abandonar o darse de baja pueden pasar
# en cualquier etapa (el mentor, solo una vez que el postulante está en piso).
DE_CAPACITADOR = ("en_capacitacion", "aprobo_escrita", "abandono", "baja")
DE_MENTOR = ("aprobo_mentoria", "alta_operativa", "abandono", "baja")
EN_PISO = ("aprobo_escrita", "aprobo_mentoria")
SEXOS = ("F", "M", "X")


class CapGrupo(Base):
    """Un grupo de capacitación (modelo Capacitación ÁGIL: sala a la mañana con el capacitador, piso a la tarde con el
    mentor). Su duración va del inicio al cierre (finalizada o cancelada) o hasta hoy si sigue en curso."""
    __tablename__ = "cap_grupos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    operacion: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)        # campaña o cliente (Claro…)
    capacitador_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    mentores: Mapped[list] = mapped_column(JSON, default=list, nullable=False)           # ids de usuario
    estado: Mapped[str] = mapped_column(String(12), nullable=False, default="en_curso", index=True)
    fecha_inicio: Mapped[date] = mapped_column(Date, nullable=False)
    fin_previsto: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    fecha_fin: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    motivo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)                   # por qué se canceló
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class CapPostulante(Base):
    """Un postulante de un grupo. (`pruebas` queda reservado: las pruebas en papel no se usan por ahora.)"""
    __tablename__ = "cap_postulantes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    grupo_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    nombre: Mapped[str] = mapped_column(String(80), nullable=False)
    apellido: Mapped[str] = mapped_column(String(80), nullable=False)
    ci: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    edad: Mapped[int] = mapped_column(Integer, nullable=False)
    sexo: Mapped[str] = mapped_column(String(1), nullable=False)                         # F | M | X
    estado: Mapped[str] = mapped_column(String(16), nullable=False, default="en_capacitacion", index=True)
    estado_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    estado_por: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    # Hasta dónde llegó en el embudo (0 sala, 1 aprobó la escrita, 2 aprobó mentoría, 3 alta): si abandona o se da de
    # baja, queda la etapa en la que salió.
    etapa_max: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    motivo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)                   # del abandono o la baja
    pruebas: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class CapEnlace(Base):
    """El link seguro del postulante: con él hace el test IPV en su celular y deja su feedback. Se guarda la huella del
    token (y el token cifrado, para volver a mostrarlo); generar uno nuevo revoca el anterior. El IPV se responde una sola
    vez: un link por postulante (regenerarlo cambia el token y conserva lo respondido); las respuestas se guardan a medida que contesta y, al terminar, se corrige solo."""
    __tablename__ = "cap_enlaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    postulante_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    token_enc: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    origen: Mapped[str] = mapped_column(String(200), nullable=False)                  # la dirección de la plataforma
    activo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    vence_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ipv_estado: Mapped[str] = mapped_column(String(12), nullable=False, default="pendiente")   # pendiente | en_curso | terminado
    respuestas: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    resultado: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    iniciado_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    terminado_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ultimo_acceso_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    dispositivo: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)


class CapComentario(Base):
    """Un comentario de seguimiento del postulante: del capacitador o del mentor (feedback u oportunidad de mejora) o del
    propio postulante (su feedback, desde su link). Puede venir dictado (`audio_id`: el texto llega con la transcripción)."""
    __tablename__ = "cap_comentarios"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    postulante_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    grupo_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    autor_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)        # vacío: el postulante
    autor_rol: Mapped[str] = mapped_column(String(12), nullable=False)                # capacitador | mentor | gestion | postulante
    tipo: Mapped[str] = mapped_column(String(12), nullable=False)                     # feedback | oportunidad | postulante
    texto: Mapped[str] = mapped_column(Text, nullable=False, default="")
    audio_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class CapAudio(Base):
    """Un audio dictado para un comentario (del equipo o del postulante) y su transcripción (el mismo servicio que el
    coaching). El archivo vive en el disco persistente con su huella."""
    __tablename__ = "cap_audios"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    postulante_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    autor_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    ruta: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    mime: Mapped[str] = mapped_column(String(60), nullable=False)
    bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    duracion_s: Mapped[float] = mapped_column(Float, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    estado: Mapped[str] = mapped_column(String(14), nullable=False, default="pendiente", index=True)
    texto: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    modelo: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    error: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    intentos: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    transcrito_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    costo_usd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    borrado_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)   # retención


class CapEvento(Base):
    """El historial: alta del grupo y del postulante, cambios de estado, link generado, IPV terminado."""
    __tablename__ = "cap_eventos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    grupo_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    postulante_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    tipo: Mapped[str] = mapped_column(String(40), nullable=False)    # p. ej. entrenamiento_reiniciado (más de 20)
    de: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    a: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    por: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    datos: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


# ================================================================== entrenamientos con IA
ESTADOS_ENTRENAMIENTO = ("borrador", "activo", "archivado")


class CapEntrenamiento(Base):
    """Un entrenamiento: varios casos (clientes simulados por la IA) que el postulante atiende por chat desde su link.
    `producto` es la información oficial que el asesor tiene que dar bien (la usa solo el evaluador). Se aprueba con
    información correcta en al menos `umbral_info` % de los casos y nivel comercial promedio de `umbral_nivel` o más."""
    __tablename__ = "cap_entrenamientos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    instrucciones: Mapped[Optional[str]] = mapped_column(Text, nullable=True)            # lo que lee el postulante
    producto: Mapped[str] = mapped_column(Text, nullable=False, default="")               # información oficial
    empresa: Mapped[str] = mapped_column(String(80), nullable=False, default="Claro")      # a quién representa el asesor
    canal: Mapped[str] = mapped_column(String(20), nullable=False, default="chat")         # chat | whatsapp | llamada
    umbral_info: Mapped[int] = mapped_column(Integer, nullable=False, default=90)
    umbral_nivel: Mapped[int] = mapped_column(Integer, nullable=False, default=8)
    estado: Mapped[str] = mapped_column(String(12), nullable=False, default="borrador", index=True)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class CapCaso(Base):
    """Un caso del entrenamiento: quién es el cliente, qué le pasa, qué quiere, cómo se comporta (actitud al detalle),
    qué objeciones plantea y qué información tiene que darle bien el asesor."""
    __tablename__ = "cap_casos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    entrenamiento_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    orden: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    titulo: Mapped[str] = mapped_column(String(120), nullable=False)
    cliente_nombre: Mapped[str] = mapped_column(String(60), nullable=False)
    cliente_edad: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    situacion: Mapped[str] = mapped_column(Text, nullable=False, default="")
    objetivo: Mapped[str] = mapped_column(Text, nullable=False, default="")
    actitud: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)      # rasgos y niveles 1–5
    objeciones: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    info_correcta: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    primer_mensaje: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    detalles: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    max_turnos: Mapped[int] = mapped_column(Integer, nullable=False, default=14)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class CapAsignacion(Base):
    """Un entrenamiento enviado a un postulante: lo hace desde su link. `resultado` es la evaluación final. Si lo repite,
    cada vez es un intento nuevo (el anterior queda con su resultado)."""
    __tablename__ = "cap_asignaciones"
    __table_args__ = (UniqueConstraint("entrenamiento_id", "postulante_id", "intento", name="uq_cap_asignacion_intento"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    entrenamiento_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    postulante_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    grupo_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    estado: Mapped[str] = mapped_column(String(12), nullable=False, default="pendiente")   # pendiente | en_curso | evaluando | terminado
    resultado: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    asignado_por: Mapped[str] = mapped_column(String(36), nullable=False)
    asignado_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    iniciado_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    terminado_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    intentos_eval: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    intento: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class CapSesion(Base):
    """Una conversación de un caso: la del postulante (con asignación) o una prueba del mentor (`prueba_por`). Guarda el
    caso tal como era al empezar (`caso`), los mensajes, el tiempo, la evaluación de la IA y el consumo."""
    __tablename__ = "cap_sesiones"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    asignacion_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    caso_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    postulante_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    prueba_por: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    estado: Mapped[str] = mapped_column(String(12), nullable=False, default="en_curso", index=True)  # en_curso | evaluando | terminada | error
    caso: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    mensajes: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    fin_motivo: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)            # cliente | asesor | turnos
    evaluacion: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    iniciado_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    terminado_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    segundos: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tokens_entrada: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens_salida: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    costo_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    modelo: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    intentos_eval: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
