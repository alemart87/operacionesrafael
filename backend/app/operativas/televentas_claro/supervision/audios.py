"""Audios del coaching: se graban en el celular (supervisor o asesor), se guardan como registro y se transcriben.

- El archivo se valida por su contenido real (no por la extensión ni por lo que dice el navegador): WebM/Opus de
  Android, MP4/AAC de iPhone, OGG, WAV o MP3. Tamaño y duración con tope; un tope de minutos por usuario y por día
  limita el costo.
- Vive en el disco persistente (`UPLOAD_DIR/supervision/audios/<AAAA-MM>/<id>.<ext>`) con su huella SHA-256. La ruta
  la arma el servidor y nunca sale del directorio de subidas.
- La transcripción corre en segundo plano (worker supervisado): pendiente → transcribiendo → listo | error, con hasta
  3 intentos. La hace OpenAI con `TRANSCRIPCION_MODELO` (por defecto gpt-transcribe) y la `OPENAI_API_KEY` del
  servidor; el navegador nunca la ve. Se guardan el texto original, el modelo y el costo estimado por minuto.
- Si el ítem o el compromiso se guardó sin texto (el supervisor no esperó la transcripción), el texto llega solo.
- Retención: pasado `TRANSCRIPCION_RETENCION_DIAS` se borra el archivo; quedan el texto y la huella.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ....core.config import settings
from ....core.database import AsyncSessionLocal
from .alertas import ZONA
from .models import Coaching, CoachingAudio, CoachingCompromiso, CoachingEvento, CoachingItem

logger = logging.getLogger(__name__)

CARPETA = "supervision/audios"
HABLANTES = ("supervisor", "asesor")
DESTINOS = ("item", "compromiso", "comentario")
MIN_BYTES = 800
MAX_INTENTOS = 3
LOTE = 4
ATASCADO = timedelta(minutes=10)     # «transcribiendo» por más que esto: el proceso se reinició; se reintenta
# Precio por minuto de audio (US$), para el costo estimado de cada transcripción.
PRECIO_MINUTO = {"gpt-transcribe": 0.0045, "gpt-4o-mini-transcribe": 0.003, "gpt-4o-transcribe": 0.006, "whisper-1": 0.006}
# Lo que ayuda al modelo a escribir bien los nombres propios y la jerga de la operación.
PROMPT = ("Coaching de televentas de Claro Paraguay en Voicenter. Español de Paraguay. Términos frecuentes: Pospago, "
          "GPON, IPTV, portabilidad, Sali Hablando, línea sin uso, conversión, SPH, chip, plan, asesor, supervisor.")
SIMULADO = "Transcripción de prueba: el cliente no confirmó el uso de la línea y se acordó preguntar el uso antes de ofrecer."

_despertar = asyncio.Event()


class AudioInvalido(ValueError):
    """El audio no se puede guardar (el mensaje es para el usuario)."""


# ------------------------------------------------------------------ tipo real y archivos
def tipo_real(cabeza: bytes) -> tuple[str, str] | None:
    """(mime, extensión) según los primeros bytes del archivo; None si no es un audio aceptado."""
    if cabeza.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio/webm", "webm"
    if len(cabeza) >= 12 and cabeza[4:8] == b"ftyp":
        return "audio/mp4", "m4a"
    if cabeza.startswith(b"OggS"):
        return "audio/ogg", "ogg"
    if cabeza.startswith(b"RIFF") and cabeza[8:12] == b"WAVE":
        return "audio/wav", "wav"
    if cabeza.startswith(b"ID3") or (len(cabeza) > 1 and cabeza[0] == 0xFF and (cabeza[1] & 0xE0) == 0xE0):
        return "audio/mpeg", "mp3"
    return None


def ruta(relativa: Optional[str]) -> Optional[Path]:
    """La ruta absoluta de un audio guardado, solo si queda dentro de UPLOAD_DIR."""
    if not relativa:
        return None
    base = settings.upload_path.resolve()
    p = (base / relativa).resolve()
    return p if p.is_relative_to(base) else None


def _escribir(destino: Path, datos: bytes) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(destino.suffix + ".tmp")
    tmp.write_bytes(datos)
    tmp.replace(destino)


def simulador() -> bool:
    """El simulador de transcripción es solo para desarrollo y pruebas: en producción se ignora."""
    return settings.transcripcion_simulador and settings.env != "production"


def servicio_disponible() -> bool:
    return bool(simulador() or settings.openai_api_key)


def precio_minuto(modelo: str) -> float:
    return next((v for k, v in sorted(PRECIO_MINUTO.items(), key=lambda kv: -len(kv[0])) if modelo.startswith(k)),
                PRECIO_MINUTO["gpt-transcribe"])


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


async def segundos_hoy(db: AsyncSession, user_id: str, momento: datetime) -> float:
    """Lo que grabó hoy (día de Paraguay) ese usuario, en segundos."""
    local = momento.astimezone(ZONA)
    desde = local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    q = select(func.coalesce(func.sum(CoachingAudio.duracion_s), 0.0)).where(
        CoachingAudio.created_by == user_id, CoachingAudio.created_at >= desde)
    return float((await db.execute(q)).scalar() or 0.0)


async def guardar(db: AsyncSession, *, c: Coaching, user_id: str, datos: bytes, duracion_s: float, hablante: str,
                  destino: str, momento: datetime) -> CoachingAudio:
    """Valida y guarda el audio (sin commit). La transcripción queda en cola."""
    if hablante not in HABLANTES or destino not in DESTINOS:
        raise AudioInvalido("Audio mal identificado")
    if len(datos) < MIN_BYTES:
        raise AudioInvalido("El audio está vacío o es demasiado corto")
    if len(datos) > settings.transcripcion_max_mb * 1024 * 1024:
        raise AudioInvalido(f"El audio supera los {settings.transcripcion_max_mb} MB")
    tipo = tipo_real(datos[:16])
    if not tipo:
        raise AudioInvalido("El archivo no es un audio válido (se aceptan WebM, MP4, OGG, WAV y MP3)")
    if not (0.3 <= duracion_s <= settings.transcripcion_max_segundos + 5):
        raise AudioInvalido(f"Cada audio puede durar hasta {settings.transcripcion_max_segundos // 60} minutos")
    usados = await segundos_hoy(db, user_id, momento)
    if usados + duracion_s > settings.transcripcion_minutos_dia * 60:
        raise AudioInvalido(f"Llegaste al tope de {settings.transcripcion_minutos_dia} minutos de audio por día")
    mime, ext = tipo
    a = CoachingAudio(coaching_id=c.id, supervisor_id=c.supervisor_id, hablante=hablante, destino=destino, mime=mime,
                      bytes=len(datos), duracion_s=round(float(duracion_s), 1), sha256=hashlib.sha256(datos).hexdigest(),
                      estado="pendiente" if servicio_disponible() else "sin_servicio", created_by=user_id, created_at=momento)
    db.add(a)
    await db.flush()
    rel = f"{CARPETA}/{momento.astimezone(ZONA):%Y-%m}/{a.id}.{ext}"
    destino_abs = ruta(rel)
    if destino_abs is None:  # pragma: no cover - UPLOAD_DIR mal configurado
        raise AudioInvalido("No se pudo guardar el audio")
    await asyncio.to_thread(_escribir, destino_abs, datos)
    a.ruta = rel
    return a


def despertar() -> None:
    """Avisa al worker que hay audios nuevos (después del commit)."""
    _despertar.set()


def a_dict(a: CoachingAudio) -> dict[str, Any]:
    return {"id": a.id, "coaching_id": a.coaching_id, "hablante": a.hablante, "destino": a.destino, "mime": a.mime,
            "bytes": a.bytes, "duracion_s": a.duracion_s, "sha256": a.sha256, "estado": a.estado, "texto": a.texto,
            "modelo": a.modelo, "error": a.error if a.estado == "error" else None, "costo_usd": a.costo_usd,
            "created_at": _iso(a.created_at), "transcrito_at": _iso(a.transcrito_at),
            "archivo": a.ruta is not None and a.borrado_at is None, "borrado_at": _iso(a.borrado_at)}


def _iso(d: datetime | None) -> str | None:
    if d is None:
        return None
    return (d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d).isoformat()


# ------------------------------------------------------------------ transcripción
async def transcribir(datos: bytes, *, mime: str, nombre: str, duracion_s: float) -> tuple[str, str]:
    """(texto, modelo). Con el simulador, un texto fijo. Con OpenAI, el modelo configurado; si rechaza la pista de
    idioma (los modelos nuevos usan `languages`, los anteriores `language`), reintenta sin ella."""
    modelo = settings.transcripcion_modelo
    if simulador():
        if settings.transcripcion_simulador_demora:
            await asyncio.sleep(settings.transcripcion_simulador_demora)
        return SIMULADO, f"simulador:{modelo}"
    if not settings.openai_api_key:
        raise RuntimeError("sin_servicio")
    from openai import AsyncOpenAI, BadRequestError

    cliente = AsyncOpenAI(api_key=settings.openai_api_key, timeout=180, max_retries=2)
    base: dict[str, Any] = {"file": (nombre, datos, mime), "model": modelo, "response_format": "json", "prompt": PROMPT}
    idioma: dict[str, Any] = ({"extra_body": {"languages": ["es"]}} if modelo.startswith("gpt-transcribe")
                              else {"language": "es"})
    try:
        r = await cliente.audio.transcriptions.create(**base, **idioma)
    except BadRequestError:
        r = await cliente.audio.transcriptions.create(**base)
    texto = (getattr(r, "text", None) if not isinstance(r, str) else r) or ""
    return texto.strip(), modelo


async def _completar_textos(db: AsyncSession, a: CoachingAudio) -> None:
    """Lo que se guardó sin texto esperando la transcripción, la recibe ahora (y el resumen del coaching)."""
    from . import coaching as srv

    if not a.texto:
        return
    n = 0
    for modelo in (CoachingItem, CoachingCompromiso):
        r = await db.execute(update(modelo).where(modelo.audio_id == a.id, modelo.texto == "").values(texto=a.texto))
        n += r.rowcount or 0
    c = await db.get(Coaching, a.coaching_id)
    if n and c is not None and c.estado == srv.PENDIENTE:
        srv.resumir(c, await srv.items_de(db, c.id), await srv.compromisos_de(db, c.id))


async def procesar_uno(db: AsyncSession, a: CoachingAudio) -> None:
    a.estado, a.intentos = "transcribiendo", (a.intentos or 0) + 1
    await db.commit()
    p = ruta(a.ruta)
    try:
        if p is None or not p.exists():
            raise FileNotFoundError("archivo")
        datos = await asyncio.to_thread(p.read_bytes)
        texto, modelo = await transcribir(datos, mime=a.mime, nombre=p.name, duracion_s=a.duracion_s)
    except Exception as exc:  # noqa: BLE001 — cualquier error se anota y se reintenta
        motivo = "sin servicio de transcripción" if str(exc) == "sin_servicio" else (
            "el archivo no está en el disco" if isinstance(exc, FileNotFoundError) else type(exc).__name__)
        logger.warning("Transcripción del audio %s falló (intento %s): %s", a.id, a.intentos, motivo)
        a.error = motivo[:300]
        a.estado = "sin_servicio" if str(exc) == "sin_servicio" else ("error" if a.intentos >= MAX_INTENTOS else "pendiente")
        await db.commit()
        return
    a.texto, a.modelo, a.error = texto, modelo, None
    a.estado, a.transcrito_at = "listo", _ahora()
    a.costo_usd = 0.0 if modelo.startswith("simulador") else round(a.duracion_s / 60 * precio_minuto(modelo), 5)
    await _completar_textos(db, a)
    db.add(CoachingEvento(coaching_id=a.coaching_id, tipo="transcripcion", at=_ahora(), por=a.created_by,
                          datos={"audio_id": a.id, "transcripto": True, "segundos": a.duracion_s}))
    await db.commit()


async def procesar_pendientes(limite: int = LOTE) -> int:
    """Transcribe los audios en cola (y los que quedaron a medias por un reinicio). Devuelve cuántos procesó."""
    async with AsyncSessionLocal() as db:
        atascados = _ahora() - ATASCADO
        q = select(CoachingAudio).where(
            CoachingAudio.borrado_at.is_(None),
            ((CoachingAudio.estado == "pendiente") |
             ((CoachingAudio.estado == "transcribiendo") & (CoachingAudio.created_at < atascados))),
            CoachingAudio.intentos < MAX_INTENTOS).order_by(CoachingAudio.created_at).limit(limite)
        filas = list((await db.execute(q)).scalars().all())
        for a in filas:
            await procesar_uno(db, a)
        return len(filas)


async def reactivar_sin_servicio() -> int:
    """Al configurar la clave: los audios que quedaron «sin servicio» vuelven a la cola."""
    if not servicio_disponible():
        return 0
    async with AsyncSessionLocal() as db:
        r = await db.execute(update(CoachingAudio).where(CoachingAudio.estado == "sin_servicio", CoachingAudio.borrado_at.is_(None))
                             .values(estado="pendiente", intentos=0))
        await db.commit()
        return r.rowcount or 0


async def aplicar_retencion() -> int:
    """Borra los archivos de audio más viejos que la retención; quedan el texto, la huella y la constancia."""
    limite = _ahora() - timedelta(days=settings.transcripcion_retencion_dias)
    async with AsyncSessionLocal() as db:
        viejos = list((await db.execute(select(CoachingAudio).where(
            CoachingAudio.created_at < limite, CoachingAudio.borrado_at.is_(None)))).scalars().all())
        for a in viejos:
            p = ruta(a.ruta)
            if p is not None:
                try:
                    p.unlink(missing_ok=True)
                except OSError:  # pragma: no cover - permisos del disco
                    continue
            a.ruta, a.borrado_at = None, _ahora()
        await db.commit()
        return len(viejos)


async def worker() -> None:
    """Cola de transcripción: despierta con cada audio nuevo (o cada 15 s) y una vez por día aplica la retención."""
    await reactivar_sin_servicio()
    ultima_retencion: datetime | None = None
    while True:
        try:
            await asyncio.wait_for(_despertar.wait(), timeout=15)
        except asyncio.TimeoutError:
            pass
        _despertar.clear()
        while await procesar_pendientes():
            pass
        if ultima_retencion is None or _ahora() - ultima_retencion > timedelta(days=1):
            borrados = await aplicar_retencion()
            if borrados:
                logger.info("Retención de audios: %s archivo(s) borrado(s)", borrados)
            ultima_retencion = _ahora()
