"""Dictado de los comentarios de seguimiento (capacitador, mentor y el propio postulante desde su link).

Mismas reglas que los audios del coaching (ver `televentas_claro/supervision/audios.py`, de donde se toman la detección
del tipo real, la ruta segura dentro de UPLOAD_DIR y el servicio de transcripción): tamaño, duración y minutos por día con
tope; el archivo con su huella SHA-256 en el disco persistente (`UPLOAD_DIR/capacitacion/audios/<AAAA-MM>/<id>.<ext>`);
la transcripción en segundo plano con hasta 3 intentos y el texto llega solo al comentario que se guardó vacío.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from ...core.database import AsyncSessionLocal
from ..televentas_claro.supervision import audios as base
from .models import CapAudio, CapComentario
from .servicio import ZONA, ahora, iso

logger = logging.getLogger(__name__)

CARPETA = "capacitacion/audios"
MAX_INTENTOS = 3
LOTE = 4
ATASCADO = timedelta(minutes=10)
MINUTOS_DIA_POSTULANTE = 10          # el postulante dicta su feedback: tope propio por día

_despertar = asyncio.Event()
AudioInvalido = base.AudioInvalido


async def segundos_hoy(db: AsyncSession, *, autor_id: Optional[str], postulante_id: str, momento: datetime) -> float:
    desde = momento.astimezone(ZONA).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    q = select(func.coalesce(func.sum(CapAudio.duracion_s), 0.0)).where(CapAudio.created_at >= desde)
    q = q.where(CapAudio.autor_id == autor_id) if autor_id else q.where(CapAudio.autor_id.is_(None),
                                                                         CapAudio.postulante_id == postulante_id)
    return float((await db.execute(q)).scalar() or 0.0)


async def guardar(db: AsyncSession, *, postulante_id: str, autor_id: Optional[str], datos: bytes, duracion_s: float) -> CapAudio:
    """Valida y guarda el audio (sin commit); la transcripción queda en cola. Sin autor: lo dictó el postulante."""
    if len(datos) < base.MIN_BYTES:
        raise AudioInvalido("El audio está vacío o es demasiado corto")
    if len(datos) > settings.transcripcion_max_mb * 1024 * 1024:
        raise AudioInvalido(f"El audio supera los {settings.transcripcion_max_mb} MB")
    tipo = base.tipo_real(datos[:16])
    if not tipo:
        raise AudioInvalido("El archivo no es un audio válido (se aceptan WebM, MP4, OGG, WAV y MP3)")
    if not (0.3 <= duracion_s <= settings.transcripcion_max_segundos + 5):
        raise AudioInvalido(f"Cada audio puede durar hasta {settings.transcripcion_max_segundos // 60} minutos")
    momento = ahora()
    tope = (settings.transcripcion_minutos_dia if autor_id else MINUTOS_DIA_POSTULANTE) * 60
    if await segundos_hoy(db, autor_id=autor_id, postulante_id=postulante_id, momento=momento) + duracion_s > tope:
        raise AudioInvalido(f"Llegaste al tope de {tope // 60} minutos de audio por día")
    mime, ext = tipo
    a = CapAudio(postulante_id=postulante_id, autor_id=autor_id, mime=mime, bytes=len(datos), duracion_s=round(float(duracion_s), 1),
                 sha256=hashlib.sha256(datos).hexdigest(), estado="pendiente" if base.servicio_disponible() else "sin_servicio",
                 created_at=momento)
    db.add(a)
    await db.flush()
    rel = f"{CARPETA}/{momento.astimezone(ZONA):%Y-%m}/{a.id}.{ext}"
    destino = base.ruta(rel)
    if destino is None:  # pragma: no cover - UPLOAD_DIR mal configurado
        raise AudioInvalido("No se pudo guardar el audio")
    await asyncio.to_thread(base._escribir, destino, datos)
    a.ruta = rel
    return a


def despertar() -> None:
    _despertar.set()


def a_dict(a: CapAudio) -> dict[str, Any]:
    return {"id": a.id, "estado": a.estado, "texto": a.texto, "duracion_s": a.duracion_s, "mime": a.mime,
            "error": a.error if a.estado == "error" else None, "created_at": iso(a.created_at),
            "archivo": a.ruta is not None and a.borrado_at is None}


async def procesar_uno(db: AsyncSession, a: CapAudio) -> None:
    a.estado, a.intentos = "transcribiendo", (a.intentos or 0) + 1
    await db.commit()
    p = base.ruta(a.ruta)
    try:
        if p is None or not p.exists():
            raise FileNotFoundError("archivo")
        datos = await asyncio.to_thread(p.read_bytes)
        texto, modelo = await base.transcribir(datos, mime=a.mime, nombre=p.name, duracion_s=a.duracion_s)
    except Exception as exc:  # noqa: BLE001 — se anota y se reintenta
        sin = str(exc) == "sin_servicio"
        motivo = "sin servicio de transcripción" if sin else (
            "el archivo no está en el disco" if isinstance(exc, FileNotFoundError) else type(exc).__name__)
        logger.warning("Transcripción del audio de capacitación %s falló (intento %s): %s", a.id, a.intentos, motivo)
        a.error = motivo[:300]
        a.estado = "sin_servicio" if sin else ("error" if a.intentos >= MAX_INTENTOS else "pendiente")
        await db.commit()
        return
    a.texto, a.modelo, a.error = texto, modelo, None
    a.estado, a.transcrito_at = "listo", ahora()
    a.costo_usd = 0.0 if modelo.startswith("simulador") else round(a.duracion_s / 60 * base.precio_minuto(modelo), 5)
    if texto:
        await db.execute(update(CapComentario).where(CapComentario.audio_id == a.id, CapComentario.texto == "").values(texto=texto))
    await db.commit()


async def procesar_pendientes(limite: int = LOTE) -> int:
    async with AsyncSessionLocal() as db:
        atascados = ahora() - ATASCADO
        q = select(CapAudio).where(
            CapAudio.borrado_at.is_(None),
            (CapAudio.estado == "pendiente") | ((CapAudio.estado == "transcribiendo") & (CapAudio.created_at < atascados)),
            CapAudio.intentos < MAX_INTENTOS).order_by(CapAudio.created_at).limit(limite)
        filas = list((await db.execute(q)).scalars().all())
        for a in filas:
            await procesar_uno(db, a)
        return len(filas)


async def reactivar_sin_servicio() -> int:
    if not base.servicio_disponible():
        return 0
    async with AsyncSessionLocal() as db:
        r = await db.execute(update(CapAudio).where(CapAudio.estado == "sin_servicio", CapAudio.borrado_at.is_(None))
                             .values(estado="pendiente", intentos=0))
        await db.commit()
        return r.rowcount or 0


async def aplicar_retencion() -> int:
    """Pasada la retención se borra el archivo; quedan el texto y la huella."""
    limite = ahora() - timedelta(days=settings.transcripcion_retencion_dias)
    async with AsyncSessionLocal() as db:
        viejos = list((await db.execute(select(CapAudio).where(CapAudio.created_at < limite, CapAudio.borrado_at.is_(None)))).scalars().all())
        for a in viejos:
            p = base.ruta(a.ruta)
            if p is not None:
                try:
                    p.unlink(missing_ok=True)
                except OSError:  # pragma: no cover - permisos del disco
                    continue
            a.ruta, a.borrado_at = None, ahora()
        await db.commit()
        return len(viejos)


async def worker() -> None:
    await reactivar_sin_servicio()
    ultima: datetime | None = None
    while True:
        try:
            await asyncio.wait_for(_despertar.wait(), timeout=15)
        except asyncio.TimeoutError:
            pass
        _despertar.clear()
        while await procesar_pendientes():
            pass
        if ultima is None or ahora() - ultima > timedelta(days=1):
            await aplicar_retencion()
            ultima = ahora()
