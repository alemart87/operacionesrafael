"""Capacitación y Mentoría — el link del postulante (sin usuario ni contraseña).

Con su link, el postulante hace el test IPV en el celular (una situación por pantalla, se guarda a medida que contesta y
puede seguir después) y deja su feedback escrito o dictado. Nunca ve sus resultados ni los comentarios del equipo.

Seguridad: el token (256 bits) se busca por su SHA-256; los tokens inválidos se limitan por IP. El link vale mientras
esté activo, no haya vencido, el postulante siga activo (no abandonó ni fue dado de baja) y el grupo no esté cancelado.
Solo se muestran el nombre de pila y el grupo. El IPV se responde una vez: terminado, se corrige solo y ya no se puede
cambiar. Tiene tiempo límite (IPV_MINUTOS, 75 por defecto: 1 h 15 min) desde que empieza, y pausar no lo detiene: si vence sin
terminar, se reinicia completo y el postulante ve un informe que le pide volver a empezar.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import client_ip
from ...core import rate_limit
from ...core.config import settings
from ...core.database import AsyncSessionLocal, get_db
from . import audios as audios_srv
from . import ipv
from . import servicio as srv
from .models import CapAudio, CapComentario, CapEnlace, CapGrupo, CapPostulante

router = APIRouter(prefix="/capacitacion/publico", tags=["capacitación · link del postulante"])
logger = logging.getLogger(__name__)

COMENTARIOS_DIA = 20
_CLAVE_RL = "capacitacion_link"


async def _vigente(db: AsyncSession, token: str, request: Request, *, bloquear: bool = False
                   ) -> tuple[CapEnlace, CapPostulante, CapGrupo]:
    ip = client_ip(request) or "-"
    if rate_limit.is_blocked(ip, _CLAVE_RL):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Demasiados intentos. Probá de nuevo en unos minutos.")
    e = None
    if 20 <= len(token) <= 100:
        q = select(CapEnlace).where(CapEnlace.token_hash == hashlib.sha256(token.encode()).hexdigest())
        e = (await db.execute(q.with_for_update() if bloquear else q)).scalar_one_or_none()
    if e is None or not e.activo:
        rate_limit.register_failure(ip, _CLAVE_RL)
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"code": "link_invalido",
                                                        "message": "Este link no es válido. Pedile uno nuevo a tu capacitador."})
    p = await db.get(CapPostulante, e.postulante_id)
    g = await db.get(CapGrupo, p.grupo_id) if p else None
    if srv.utc(e.vence_at) <= srv.ahora():
        raise HTTPException(status.HTTP_410_GONE, {"code": "link_vencido", "message": "Este link venció. Pedile uno nuevo a tu capacitador."})
    if not p or not g or g.estado == "cancelada" or p.estado in srv.SALIDAS:
        raise HTTPException(status.HTTP_410_GONE, {"code": "link_cerrado", "message": "Este link ya no está disponible."})
    return e, p, g


def _toque(e: CapEnlace, request: Request) -> None:
    e.ultimo_acceso_at = srv.ahora()
    e.dispositivo = (request.headers.get("user-agent") or "")[:300] or None


def _estado(e: CapEnlace, p: CapPostulante, g: CapGrupo) -> dict[str, Any]:
    return {"nombre": p.nombre, "grupo": g.nombre,
            "ipv": {"estado": e.ipv_estado, "respondidas": len(e.respuestas or {}), "total": ipv.TOTAL,
                    "terminado_at": srv.iso(e.terminado_at), "minutos": settings.ipv_minutos,
                    # El reloj lo pone el servidor: hasta cuándo puede responder y la hora de ahora (para corregir el del teléfono).
                    "limite_at": srv.iso(srv.ipv_limite(e)), "ahora": srv.iso(srv.ahora()),
                    # El informe del último vencimiento (se muestra hasta que vuelve a empezar).
                    "vencido": e.ipv_vencido if e.ipv_estado == "pendiente" else None}}


VENCIDO = {"code": "ipv_vencido", "message": "Se terminó el tiempo del test: se reinició y tenés que volver a empezar."}


async def _sin_tiempo(db: AsyncSession, e: CapEnlace, g: CapGrupo, *, gracia=srv.GRACIA_IPV) -> None:
    """Si el tiempo venció, se reinicia (queda guardado) y se corta el pedido con el aviso."""
    if srv.vencer_ipv(db, e, g.id, gracia=gracia):
        await db.commit()
        raise HTTPException(status.HTTP_410_GONE, VENCIDO)


@router.get("/{token}")
async def ver(token: str, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Lo que ve el postulante al abrir su link: su nombre de pila, el grupo y cómo va su test."""
    e, p, g = await _vigente(db, token, request)
    srv.vencer_ipv(db, e, g.id)
    _toque(e, request)
    await db.commit()
    mios = (await db.execute(select(func.count()).select_from(CapComentario).where(
        CapComentario.postulante_id == p.id, CapComentario.tipo == "postulante"))).scalar() or 0
    ents = [{k: x[k] for k in ("id", "nombre", "intento", "estado", "casos", "hechos", "pct", "guiado")}
            for x in (await srv.entrenamientos_de(db, [p.id])).get(p.id, []) if not x["archivado"]]
    return {**_estado(e, p, g), "comentarios": mios, "entrenamientos": ents}


@router.get("/{token}/ipv")
async def cuestionario(token: str, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Las 87 situaciones (sin la clave) y lo que ya respondió, para seguir en la primera sin responder (no se vuelve
    atrás)."""
    e, p, g = await _vigente(db, token, request)
    if srv.vencer_ipv(db, e, g.id):
        await db.commit()
    if e.ipv_estado == "terminado":
        return {**_estado(e, p, g), "preguntas": [], "respuestas": {}}
    return {**_estado(e, p, g), "preguntas": ipv.cuestionario(), "respuestas": e.respuestas or {}}


@router.post("/{token}/ipv/iniciar")
async def iniciar(token: str, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Empieza a correr el tiempo del test (al tocar «Empezar el test»). Si ya había empezado, no cambia nada."""
    e, p, g = await _vigente(db, token, request, bloquear=True)
    srv.vencer_ipv(db, e, g.id)
    if e.ipv_estado == "pendiente":
        _empezar(db, e, p, g)
    _toque(e, request)
    await db.commit()
    return _estado(e, p, g)


def _empezar(db: AsyncSession, e: CapEnlace, p: CapPostulante, g: CapGrupo) -> None:
    e.ipv_estado, e.iniciado_at, e.ipv_vencido, e.respuestas = "en_curso", srv.ahora(), None, {}
    srv.evento(db, grupo_id=g.id, postulante_id=p.id, tipo="ipv_inicio", por=None, minutos=settings.ipv_minutos)


class Respuestas(BaseModel):
    respuestas: Dict[str, str] = Field(default_factory=dict, max_length=ipv.TOTAL)


def _sumar(e: CapEnlace, nuevas: dict[int, str]) -> dict[int, str]:
    """Las respuestas nuevas sumadas a las guardadas, con dos reglas: una respuesta guardada no se cambia y las
    situaciones se contestan en orden, sin saltear (no quedan huecos para volver después). Reenviar la misma respuesta
    (un reintento sin señal) no es un error."""
    previas = {int(k): v for k, v in (e.respuestas or {}).items()}
    if any(n in previas and previas[n] != letra for n, letra in nuevas.items()):
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "respuesta_fija",
                                                       "message": "Esa respuesta ya quedó guardada y no se puede cambiar."})
    faltan = [n for n in ipv.OPCIONES if n not in previas]          # en el orden del test
    nuevos = sorted(n for n in nuevas if n not in previas)
    if nuevos != faltan[:len(nuevos)]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, {"code": "fuera_de_orden",
                                                          "message": "Las situaciones se responden en orden, sin saltear."})
    return {**previas, **nuevas}


@router.put("/{token}/ipv")
async def guardar(token: str, payload: Respuestas, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Guarda cada respuesta apenas la confirma. Queda fija: no se puede cambiar ni volver atrás."""
    e, p, g = await _vigente(db, token, request, bloquear=True)
    if e.ipv_estado == "terminado":
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya terminaste el test. ¡Gracias!")
    await _sin_tiempo(db, e, g)
    try:
        nuevas = ipv.validar({int(k): v for k, v in payload.respuestas.items()}, completas=False)
    except (ipv.RespuestasInvalidas, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Respuesta inválida") from exc
    if e.ipv_estado == "pendiente":       # una pantalla vieja que no llamó a /iniciar: el tiempo empieza ahora
        _empezar(db, e, p, g)
    e.respuestas = {str(k): v for k, v in _sumar(e, nuevas).items()}
    _toque(e, request)
    await db.commit()
    return {"respondidas": len(e.respuestas), "total": ipv.TOTAL}


@router.post("/{token}/ipv/terminar")
async def terminar(token: str, payload: Respuestas, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Cierra el test con las 87 respuestas: se corrige solo y queda en la ficha del postulante."""
    e, p, g = await _vigente(db, token, request, bloquear=True)
    if e.ipv_estado == "terminado":
        return {"terminado": True}
    await _sin_tiempo(db, e, g)
    if e.ipv_estado != "en_curso":          # el tiempo tiene que haber corrido: primero se empieza
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "ipv_sin_empezar", "message": "Primero tocá «Empezar el test»."})
    try:
        extra = ipv.validar({int(k): v for k, v in payload.respuestas.items()}, completas=False)
        todas = ipv.validar(_sumar(e, extra))
    except ipv.RespuestasInvalidas as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Respuesta inválida") from exc
    fin = srv.ahora()
    inicio = srv.utc(e.iniciado_at) or fin
    e.respuestas = {str(k): v for k, v in todas.items()}
    e.resultado = ipv.corregir(todas, segundos=(fin - inicio).total_seconds())
    e.ipv_estado, e.terminado_at = "terminado", fin
    e.iniciado_at = e.iniciado_at or fin
    _toque(e, request)
    srv.evento(db, grupo_id=g.id, postulante_id=p.id, tipo="ipv_terminado", por=None,
               dgv=e.resultado["escalas"][0]["decatipo"], segundos=e.resultado["segundos"])
    await db.commit()
    return {"terminado": True}


# ------------------------------------------------------------------ el feedback del postulante
class Comentario(BaseModel):
    texto: str = Field("", max_length=3000)
    audio_id: Optional[str] = Field(None, max_length=36)


async def _hoy(db: AsyncSession, pid: str) -> int:
    desde = srv.ahora().astimezone(srv.ZONA).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    return (await db.execute(select(func.count()).select_from(CapComentario).where(
        CapComentario.postulante_id == pid, CapComentario.tipo == "postulante", CapComentario.created_at >= desde))).scalar() or 0


@router.post("/{token}/comentarios", status_code=status.HTTP_201_CREATED)
async def comentar(token: str, payload: Comentario, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    e, p, g = await _vigente(db, token, request)
    if await _hoy(db, p.id) >= COMENTARIOS_DIA:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Ya dejaste muchos comentarios hoy. ¡Gracias!")
    a = None
    if payload.audio_id:
        a = await db.get(CapAudio, payload.audio_id)
        if not a or a.postulante_id != p.id or a.autor_id is not None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Audio no encontrado")
    texto = payload.texto.strip() or (a.texto if a and a.texto else "")
    if not texto and not a:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Escribí o dictá tu comentario")
    db.add(CapComentario(postulante_id=p.id, grupo_id=g.id, autor_id=None, autor_rol="postulante", tipo="postulante",
                         texto=texto, audio_id=a.id if a else None, created_at=srv.ahora()))
    _toque(e, request)
    await db.commit()
    return {"ok": True}


@router.post("/{token}/audios", status_code=status.HTTP_201_CREATED)
async def subir_audio(token: str, request: Request, archivo: UploadFile = File(...), duracion: float = Form(...),
                      db: AsyncSession = Depends(get_db)) -> dict:
    e, p, g = await _vigente(db, token, request)
    datos = await archivo.read(settings.transcripcion_max_mb * 1024 * 1024 + 1)
    try:
        a = await audios_srv.guardar(db, postulante_id=p.id, autor_id=None, datos=datos, duracion_s=duracion)
    except audios_srv.AudioInvalido as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await db.commit()
    audios_srv.despertar()
    return audios_srv.a_dict(a)


@router.get("/{token}/audios/{audio_id}")
async def estado_audio(token: str, audio_id: str, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    e, p, g = await _vigente(db, token, request)
    a = await db.get(CapAudio, audio_id)
    if not a or a.postulante_id != p.id or a.autor_id is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Audio no encontrado")
    return audios_srv.a_dict(a)


# ------------------------------------------------------------------ los que se quedaron sin tiempo
async def vencer_pendientes() -> int:
    """Reinicia los tests en curso a los que se les terminó el tiempo (aunque el postulante no vuelva a entrar), así el
    equipo ve el estado real. Devuelve cuántos reinició."""
    limite = srv.ahora() - timedelta(minutes=settings.ipv_minutos) - srv.GRACIA_IPV
    n = 0
    async with AsyncSessionLocal() as db:
        q = select(CapEnlace, CapPostulante.grupo_id).join(CapPostulante, CapPostulante.id == CapEnlace.postulante_id).where(
            CapEnlace.ipv_estado == "en_curso", CapEnlace.iniciado_at < limite)
        for e, gid in (await db.execute(q)).all():
            n += srv.vencer_ipv(db, e, gid, gracia=srv.GRACIA_IPV)
        await db.commit()
    return n


async def worker() -> None:
    while True:
        try:
            if n := await vencer_pendientes():
                logger.info("IPV: %s test(s) reiniciado(s) por tiempo", n)
        except Exception:  # noqa: BLE001 — se reintenta en la próxima vuelta
            logger.exception("IPV: falló la revisión de tests vencidos")
        await asyncio.sleep(60)
