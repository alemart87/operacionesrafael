"""Supervisión — Televentas Claro: maestro de operadores, equipos del mes, objetivos y parámetros."""
from __future__ import annotations

import time
import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Float, Integer, JSON, String, Text, UniqueConstraint, func
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


# ------------------------------------------------------------------ coaching y bitácora (fase 3)
class Coaching(Base):
    """Un coaching del supervisor a un asesor: qué se trabajó, el compromiso y su seguimiento.

    La hora de registro la pone el servidor; con más de 48 h de atraso queda «fuera de término».
    Se edita (o se anula, si se cargó por error) durante 24 h; después solo se agregan el seguimiento y
    aclaraciones. Todo queda en `sup_coaching_eventos`. `base` es la foto del asesor al registrarlo (sus
    componentes y el uso de sus líneas por antigüedad); `impacto`, la medición al registrar el seguimiento."""
    __tablename__ = "sup_coachings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    operativa: Mapped[str] = mapped_column(String(40), default=OPERATIVA, nullable=False)
    supervisor_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    operador_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    fecha: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    tipo: Mapped[str] = mapped_column(String(10), nullable=False)        # diario | semanal | mensual
    metrica: Mapped[str] = mapped_column(String(15), nullable=False)     # pospago | gpon | uso | conversacion | otra
    diagnostico: Mapped[str] = mapped_column(Text, nullable=False)
    compromiso: Mapped[str] = mapped_column(Text, nullable=False)
    seguimiento_fecha: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    estado: Mapped[str] = mapped_column(String(10), nullable=False, default="abierto")  # abierto | cerrado | anulado
    anterior_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)  # el coaching sin mejora que continúa
    seguimiento_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    seguimiento_comentario: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resultado: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)  # mejoro | igual | empeoro | sin_datos
    base: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    impacto: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    fuera_de_termino: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class CoachingEvento(Base):
    """Historial de un coaching (solo se agrega): creado, editado, anulado, seguimiento, aclaración."""
    __tablename__ = "sup_coaching_eventos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    coaching_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    tipo: Mapped[str] = mapped_column(String(15), nullable=False)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    por: Mapped[str] = mapped_column(String(36), nullable=False)
    datos: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class BitacoraNota(Base):
    """Nota propia del supervisor: novedades, ausencias, incidencias, reconocimientos."""
    __tablename__ = "sup_bitacora"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    operativa: Mapped[str] = mapped_column(String(40), default=OPERATIVA, nullable=False)
    supervisor_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    fecha: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    tipo: Mapped[str] = mapped_column(String(15), nullable=False)  # novedad | ausencia | incidencia | reconocimiento | otro
    texto: Mapped[str] = mapped_column(Text, nullable=False)
    operador_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    fuera_de_termino: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AlertaAsesor(Base):
    """Un asesor en alerta por líneas sin uso dentro de un mes: desde cuándo y hasta cuándo.

    Aparece el día que se generó el informe de Ventas Netas que la mostró (o el día que empezó a
    medirse la gestión, si es posterior) y se cierra con el primer informe en que ya no está. Con la
    fecha en que apareció se mide el foco: coaching sobre uso dentro de los 5 días hábiles."""
    __tablename__ = "sup_alertas"
    __table_args__ = (UniqueConstraint("operativa", "periodo", "operador_id", "tipo", "desde", name="uq_sup_alerta"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    operativa: Mapped[str] = mapped_column(String(40), default=OPERATIVA, nullable=False)
    periodo: Mapped[str] = mapped_column(String(7), nullable=False, index=True)
    operador_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    tipo: Mapped[str] = mapped_column(String(15), nullable=False, default="uso")
    desde: Mapped[date] = mapped_column(Date, nullable=False)
    hasta: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    corte_desde: Mapped[Optional[date]] = mapped_column(Date, nullable=True)  # corte de Ventas Netas que la mostró
    corte_hasta: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    datos: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)    # uso del asesor al aparecer
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ------------------------------------------------------------------ tickets de revisión (fase 4)
class Ticket(Base):
    """Un caso que los jefes o el auditor envían a revisión a un supervisor, con plazos en horas hábiles.

    Estados: nuevo → en_gestion ↔ esperando (datos de quien lo pidió) → resuelto (se puede reabrir) | cerrado
    (cancelado o sin respuesta de quien lo pidió). El reloj de resolución corre en nuevo y en gestión:
    `consumido_min` acumula los minutos hábiles hasta `corriendo_desde` (vacío si está detenido). Los plazos
    se guardan al crear el ticket (si cambian los parámetros, no cambian los de los tickets ya enviados)."""
    __tablename__ = "sup_tickets"
    __table_args__ = (UniqueConstraint("operativa", "numero", name="uq_sup_ticket_numero"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    operativa: Mapped[str] = mapped_column(String(40), default=OPERATIVA, nullable=False)
    numero: Mapped[int] = mapped_column(Integer, nullable=False)
    tipo: Mapped[str] = mapped_column(String(20), nullable=False)
    prioridad: Mapped[str] = mapped_column(String(5), nullable=False)
    supervisor_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    operador_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    fecha_caso: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    referencia: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    descripcion: Mapped[str] = mapped_column(Text, nullable=False)
    estado: Mapped[str] = mapped_column(String(12), nullable=False, default="nuevo", index=True)
    estado_desde: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sla_respuesta_min: Mapped[int] = mapped_column(Integer, nullable=False)
    sla_resolucion_min: Mapped[int] = mapped_column(Integer, nullable=False)
    respuesta_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    respuesta_min: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    consumido_min: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    corriendo_desde: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resuelto_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resolucion_min: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cerrado_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    motivo_cierre: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # cancelado | sin_respuesta
    reaperturas: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    creado_por: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class TicketEvento(Base):
    """Historial de un ticket (solo se agrega): creado, respuesta, pedido de datos, datos, resuelto, reabierto,
    reasignado, comentario, cancelado y cierre automático."""
    __tablename__ = "sup_ticket_eventos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    ticket_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    tipo: Mapped[str] = mapped_column(String(20), nullable=False)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    orden: Mapped[int] = mapped_column(BigInteger, nullable=False, default=time.time_ns)  # desempata eventos del mismo instante
    por: Mapped[str] = mapped_column(String(36), nullable=False)
    texto: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    datos: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

