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
#   cargado por un supervisor desde el portal, sin nombre en llamadas ni en ventas → alta_supervisor (por validar)
#   | alta_validada (un jefe confirmó que es una persona nueva; se une cuando aparezca en los informes)
ALTA_PENDIENTE = ("alta_supervisor",)


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
    # Alta desde el portal: el supervisor lo cargó porque no lo encontraba (`origen` = "alta_supervisor").
    origen: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    alta_por: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    alta_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    documento: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)   # cédula o legajo que cargó el supervisor
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

    Desde la devolución con firma: se crea «pendiente» (sin firmar) y junta varios monitoreos y feedback
    (`sup_coaching_items`) y los compromisos del asesor (`sup_coaching_compromisos`). Termina cuando el asesor
    firma (`sup_coaching_firmas`): pasa a «abierto» (espera el seguimiento), queda bloqueado y guarda la huella
    SHA-256 de lo firmado. Recién ahí cuenta en la gestión, con la fecha de la firma. `diagnostico` y
    `compromiso` resumen los ítems y los compromisos (para el registro y las vistas anteriores). Los coachings
    anteriores a la firma (`firmado_at` vacío y estado distinto de «pendiente») siguen como estaban.

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
    metrica: Mapped[str] = mapped_column(String(15), nullable=False)     # la principal: la primera de `metricas`
    # Las que se trabajaron (pospago | gpon | uso | conversacion | otra), en ese orden. Vacía en los anteriores: solo `metrica`.
    metricas: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    diagnostico: Mapped[str] = mapped_column(Text, nullable=False)
    compromiso: Mapped[str] = mapped_column(Text, nullable=False)
    seguimiento_fecha: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    estado: Mapped[str] = mapped_column(String(10), nullable=False, default="abierto")  # pendiente | abierto | cerrado | anulado
    anterior_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)  # el coaching sin mejora que continúa
    seguimiento_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    seguimiento_comentario: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resultado: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)  # mejoro | igual | empeoro | sin_datos
    base: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    impacto: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    fuera_de_termino: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    firmado_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    huella: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)    # SHA-256 de lo que firmó el asesor
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class CoachingItem(Base):
    """Un monitoreo de llamada o un feedback dentro de un coaching. La hora la pone el servidor.
    Se agregan, corrigen o quitan mientras el coaching está sin firmar (todo queda en el historial)."""
    __tablename__ = "sup_coaching_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    coaching_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    tipo: Mapped[str] = mapped_column(String(12), nullable=False)          # monitoreo | feedback
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    metricas: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    texto: Mapped[str] = mapped_column(Text, nullable=False)
    referencia: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)   # llamada, hora o número de venta
    audio_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class CoachingCompromiso(Base):
    """Un compromiso del asesor (lo puede dictar él): qué va a hacer y para cuándo. En el seguimiento se marca
    cumplido, parcial o no cumplido."""
    __tablename__ = "sup_coaching_compromisos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    coaching_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    orden: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    texto: Mapped[str] = mapped_column(Text, nullable=False)
    para: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    metrica: Mapped[Optional[str]] = mapped_column(String(15), nullable=True)
    origen: Mapped[str] = mapped_column(String(12), nullable=False, default="asesor")   # asesor | supervisor
    audio_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    resultado: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)         # cumplido | parcial | no_cumplido
    nota: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class CoachingAudio(Base):
    """Un audio grabado en el celular (del supervisor o del asesor) y su transcripción.

    El archivo vive en el disco persistente (`UPLOAD_DIR/supervision/audios/…`) con su huella SHA-256; la ruta la
    arma el servidor. La transcripción la hace el servicio configurado (OpenAI) en segundo plano: pendiente →
    transcribiendo → listo | error | sin_servicio. Quedan el texto original y el costo. Pasado el plazo de
    retención se borra el archivo y quedan el texto y la huella (`borrado_at`)."""
    __tablename__ = "sup_audios"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    coaching_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    supervisor_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    hablante: Mapped[str] = mapped_column(String(12), nullable=False)       # supervisor | asesor
    destino: Mapped[str] = mapped_column(String(12), nullable=False)        # item | compromiso | comentario
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
    costo_usd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    transcrito_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    borrado_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class CoachingFirma(Base):
    """Una firma del coaching: la del asesor (dibujada en el celular del supervisor) y la del supervisor.
    Guarda la imagen (PNG validado, en la base: tiene respaldo continuo), la hora del servidor, la huella de lo
    firmado, si aceptó los compromisos, su comentario (texto o audio) y el dispositivo."""
    __tablename__ = "sup_coaching_firmas"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    coaching_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    firmante: Mapped[str] = mapped_column(String(12), nullable=False)       # asesor | supervisor
    nombre: Mapped[str] = mapped_column(String(200), nullable=False)
    imagen: Mapped[str] = mapped_column(Text, nullable=False)               # data:image/png;base64,…
    firmado_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    huella: Mapped[str] = mapped_column(String(64), nullable=False)
    acepto: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    comentario: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    comentario_audio_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    consentimiento_audio: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    dispositivo: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)


class PedidoPase(Base):
    """Un supervisor pide que le pasen a su equipo un asesor que figura en otro equipo (lo resuelven los jefes)."""
    __tablename__ = "sup_pedidos_pase"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    operativa: Mapped[str] = mapped_column(String(40), default=OPERATIVA, nullable=False)
    operador_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    pedido_por: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    supervisor_actual: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    estado: Mapped[str] = mapped_column(String(12), nullable=False, default="pendiente", index=True)  # pendiente | resuelto | rechazado
    nota: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    resuelto_por: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    resuelto_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class CoachingEvento(Base):
    """Historial de un coaching (solo se agrega): creado, editado, monitoreos y compromisos, audios, firma, anulado,
    seguimiento, aclaración y la revisión de los jefes."""
    __tablename__ = "sup_coaching_eventos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    coaching_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    tipo: Mapped[str] = mapped_column(String(30), nullable=False)   # «compromiso_editado» tiene 18
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


# ------------------------------------------------------------------ centro de comandos (fase 5)
class AlertaComando(Base):
    """Una alerta del día del centro de comandos: una condición que hoy pide atención de los jefes.

    Se abre cuando la condición aparece (supervisor en crítico, asesor que cruza el umbral de sin uso,
    proyección bajo el 90%, ticket o seguimiento vencido, asesores sin supervisor, nombres sin vincular,
    supervisor sin registrar gestión) y se cierra sola cuando deja de cumplirse. Guarda quién la tomó, qué
    hizo y, si se pidió una revisión, el ticket que se envió. `clave` identifica la condición (p. ej. el
    supervisor o el ticket) dentro de su tipo."""
    __tablename__ = "sup_alertas_comando"
    __table_args__ = (UniqueConstraint("operativa", "tipo", "clave", "desde", name="uq_sup_alerta_comando"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    operativa: Mapped[str] = mapped_column(String(40), default=OPERATIVA, nullable=False)
    tipo: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    clave: Mapped[str] = mapped_column(String(120), nullable=False)
    periodo: Mapped[Optional[str]] = mapped_column(String(7), nullable=True)
    supervisor_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    operador_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    titulo: Mapped[str] = mapped_column(String(240), nullable=False)
    detalle: Mapped[str] = mapped_column(Text, nullable=False, default="")
    datos: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    desde: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    visto_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    hasta: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    tomada_por: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    tomada_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    nota: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    nota_por: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    nota_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ticket_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    descartada_por: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    descartada_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    descartada_motivo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)



class AnalisisInforme(Base):
    """Un informe del analizador semántico de coaching: lo escribe Claude (Haiku) con los textos de los coachings
    firmados de un rango, en segundo plano. Guarda el resultado, el modelo, los tokens y el costo."""
    __tablename__ = "sup_analisis_informes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    operativa: Mapped[str] = mapped_column(String(40), default=OPERATIVA, nullable=False)
    desde: Mapped[date] = mapped_column(Date, nullable=False)
    hasta: Mapped[date] = mapped_column(Date, nullable=False)
    supervisor_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)   # sin él: toda la operación
    estado: Mapped[str] = mapped_column(String(14), nullable=False, default="pendiente", index=True)  # pendiente | procesando | listo | error
    coachings: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    modelo: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    resultado: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    entrada_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    salida_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    costo_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    intentos: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pedido_por: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    terminado_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
