"""API de Voi para quien lo usa: estado, conversaciones, mensajes, eventos en vivo, confirmaciones y memoria.

Todo corre con la identidad del usuario: solo ve y maneja sus propias conversaciones. El superadmin tiene además su
consola (`admin_api.py`).
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import time
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import CurrentUser, bearer, get_current_user
from ..core.config import settings
from ..core.database import get_db, session_scope
from . import config, consumidor, consumo, difusion, memoria, publicacion, sesiones, transcripcion
from .cliente import NoConfigurado
from .herramientas.base import TC
from .models import AsistenteAccion, AsistenteConversacion
from .permisos import puede_usar

log = logging.getLogger("asistente.api")
router = APIRouter(prefix="/asistente", tags=["asistente"])

DURACION_STREAM = 300        # segundos: después el navegador se reconecta (y se vuelve a validar la sesión)
PRIVACIDAD = ("Voi trabaja con tus permisos: ve lo mismo que vos. Tus conversaciones quedan guardadas y el administrador "
              "puede revisarlas para controlar el uso y mejorar el servicio. No compartas contraseñas ni datos sensibles.")


async def usuario_voi(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not puede_usar(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tu perfil no tiene habilitado el asistente Voi.")
    return user


def sugerencias(user: CurrentUser, modo: str) -> list[str]:
    def p(u: str) -> bool:
        return user.has_perm(f"{TC}.{u}")

    s: list[str] = []
    if modo == "auditor":
        if p("auditoria"):
            s.append("¿Qué dice la última auditoría de ventas?")
        if p("ventas_netas"):
            s.append("¿Qué vendedores están en alerta de líneas sin uso este mes?")
        if p("supervision"):
            s.append("¿Qué alertas abiertas hay en el centro de comandos?")
        if p("tickets"):
            s.append("¿Qué tickets de revisión están por vencer?")
        return s[:4] or ["¿Qué puedo hacer con Voi?"]
    if p("informe_diario"):
        s.append("Prepará el borrador del informe diario de hoy")
    if p("productividad"):
        s.append("¿Cómo vino la productividad de llamadas ayer?")
    if p("ventas_netas"):
        s.append("Resumime las ventas netas del mes y quiénes están en alerta")
    if p("supervision"):
        s.append("¿Qué alertas críticas hay en el centro de comandos?")
    if len(s) < 4:
        s.append("¿Qué puedo hacer con Voi?")
    return s[:4]


def _motivo_no_disponible(user: CurrentUser, cfg: dict[str, Any], rec: dict[str, Any]) -> Optional[str]:
    if not config.clave_configurada():
        return "Voi todavía no está conectado: falta cargar la clave de Anthropic en el servidor."
    if not publicacion.listo(rec):
        return "Voi todavía no está publicado. El superadmin lo publica desde Administración → Asistente IA."
    if not user.is_superadmin and not cfg.get("habilitado", True):
        return "Voi está pausado por el administrador."
    return None


@router.get("/estado")
async def estado(user: CurrentUser = Depends(usuario_voi), db: AsyncSession = Depends(get_db)) -> dict:
    cfg, rec = await config.leer(db), await config.recursos(db)
    motivo = _motivo_no_disponible(user, cfg, rec)
    modo, herramientas, _ = sesiones.herramientas_y_habilidades(user, rec)
    return {
        "nombre": config.NOMBRE, "disponible": motivo is None, "motivo": motivo, "modo": modo,
        "simulador": config.simulador_activo(), "superadmin": user.is_superadmin,
        "herramientas": [{"nombre": h.nombre, "etiqueta": h.etiqueta, "nivel": h.nivel} for h in herramientas],
        "sugerencias": sugerencias(user, modo), "privacidad": PRIVACIDAD,
        "confirma_borradores": not cfg.get("autonomia", {}).get("borradores_sin_confirmar", True),
    }


# ------------------------------------------------------------------ conversaciones
class Pantalla(BaseModel):
    ruta: str = Field("", max_length=300)
    titulo: Optional[str] = Field(None, max_length=200)


class NuevaPayload(BaseModel):
    texto: Optional[str] = Field(None, max_length=8000)
    pantalla: Optional[Pantalla] = None


class MensajePayload(BaseModel):
    texto: str = Field(..., min_length=1, max_length=8000)
    pantalla: Optional[Pantalla] = None


class EditarPayload(BaseModel):
    titulo: Optional[str] = Field(None, min_length=1, max_length=200)
    fijada: Optional[bool] = None


async def _propia(db: AsyncSession, cid: str, user: CurrentUser) -> AsistenteConversacion:
    conv = await db.get(AsistenteConversacion, cid)
    if conv is None or conv.user_id != user.id or conv.oculta:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
    return conv


def _error_api(exc: Exception) -> HTTPException:
    """Un fallo al hablar con Anthropic, explicado para el usuario (el detalle queda en el log)."""
    code = getattr(exc, "status_code", None)
    if isinstance(exc, NoConfigurado):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Voi todavía no está conectado: falta la clave de Anthropic.")
    if code == 404:
        return HTTPException(status.HTTP_409_CONFLICT, "Esta conversación ya no está disponible: empezá una nueva.")
    if code == 429:
        return HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Voi está con mucha demanda: probá de nuevo en un minuto.")
    if code in (401, 403):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "La clave de Anthropic no es válida o no tiene acceso. "
                                                                  "Avisale al administrador.")
    return HTTPException(status.HTTP_502_BAD_GATEWAY, "No se pudo hablar con Voi en este momento. Probá de nuevo.")


async def _bloqueo(db: AsyncSession, user: CurrentUser) -> None:
    motivo = await consumo.bloqueo(db, user, await config.leer(db))
    if motivo:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, motivo)


async def _enviar(db: AsyncSession, conv: AsistenteConversacion, user: CurrentUser, texto: str,
                  pantalla: Optional[Pantalla]) -> None:
    try:
        await sesiones.enviar(db, conv, user, texto.strip(), pantalla.model_dump() if pantalla else None)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("No se pudo enviar el mensaje de %s a %s: %s", user.id, conv.id, exc)
        await db.rollback()
        if getattr(exc, "status_code", None) == 404:
            c = await db.get(AsistenteConversacion, conv.id)
            if c:
                c.estado = "terminated"
                await db.commit()
        raise _error_api(exc) from exc


@router.get("/conversaciones")
async def listar(limite: int = Query(40, ge=1, le=100), user: CurrentUser = Depends(usuario_voi),
                 db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(select(AsistenteConversacion).where(
        AsistenteConversacion.user_id == user.id, AsistenteConversacion.oculta.is_(False))
        .order_by(AsistenteConversacion.fijada.desc(), AsistenteConversacion.ultima_actividad.desc())
        .limit(limite))).scalars().all()
    return {"items": [transcripcion.conversacion_dict(c) for c in rows]}


@router.post("/conversaciones", status_code=201)
async def nueva(payload: NuevaPayload, user: CurrentUser = Depends(usuario_voi), db: AsyncSession = Depends(get_db)) -> dict:
    """Empieza una conversación (y, si viene, manda el primer mensaje)."""
    texto = (payload.texto or "").strip()
    if texto:
        await _bloqueo(db, user)
    try:
        conv = await sesiones.crear(db, user)
    except sesiones.NoDisponible as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("No se pudo crear la sesión de Voi para %s", user.id)
        raise _error_api(exc) from exc
    if texto:
        await _enviar(db, conv, user, texto, payload.pantalla)
        conv = await db.get(AsistenteConversacion, conv.id)
    return transcripcion.conversacion_dict(conv)


@router.get("/conversaciones/{cid}")
async def ver(cid: str, user: CurrentUser = Depends(usuario_voi), db: AsyncSession = Depends(get_db)) -> dict:
    return await transcripcion.construir(db, await _propia(db, cid, user))


@router.patch("/conversaciones/{cid}")
async def editar(cid: str, payload: EditarPayload, user: CurrentUser = Depends(usuario_voi),
                 db: AsyncSession = Depends(get_db)) -> dict:
    conv = await _propia(db, cid, user)
    if payload.titulo is not None:
        conv.titulo = payload.titulo.strip()[:200] or conv.titulo
    if payload.fijada is not None:
        conv.fijada = payload.fijada
    await db.commit()
    return transcripcion.conversacion_dict(conv)


@router.delete("/conversaciones/{cid}")
async def quitar(cid: str, user: CurrentUser = Depends(usuario_voi), db: AsyncSession = Depends(get_db)) -> dict:
    """La saca de la lista del usuario. La copia queda para el superadmin hasta que vence la retención."""
    conv = await _propia(db, cid, user)
    if conv.estado in ("running", "requires_action") and conv.session_id:
        try:
            await sesiones.detener(db, conv)
        except Exception as exc:  # noqa: BLE001 — igual se oculta
            log.warning("No se pudo detener %s al quitarla: %s", cid, exc)
            await db.rollback()
        conv = await db.get(AsistenteConversacion, cid)
    conv.oculta = True
    await db.commit()
    return {"ok": True}


@router.post("/conversaciones/{cid}/mensajes")
async def mensaje(cid: str, payload: MensajePayload, user: CurrentUser = Depends(usuario_voi),
                  db: AsyncSession = Depends(get_db)) -> dict:
    conv = await _propia(db, cid, user)
    if not conv.session_id or conv.estado in ("terminated", "borrada"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Esta conversación ya terminó: empezá una nueva.")
    if conv.estado == "budget_reached":
        raise HTTPException(status.HTTP_409_CONFLICT, "Esta conversación llegó a su tope de gasto: empezá una nueva "
                                                      "(Voi recuerda lo importante).")
    if conv.estado == "running" and consumidor.corriendo(conv.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Voi todavía está respondiendo: esperá o detené la respuesta.")
    cfg = await config.leer(db)
    if not user.is_superadmin and not cfg.get("habilitado", True):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Voi está pausado por el administrador.")
    await _bloqueo(db, user)
    await _enviar(db, conv, user, payload.texto, payload.pantalla)
    return {"ok": True, "conversacion": transcripcion.conversacion_dict(await db.get(AsistenteConversacion, cid))}


@router.post("/conversaciones/{cid}/detener")
async def detener(cid: str, user: CurrentUser = Depends(usuario_voi), db: AsyncSession = Depends(get_db)) -> dict:
    conv = await _propia(db, cid, user)
    if not conv.session_id or conv.estado in ("terminated", "borrada"):
        return {"ok": True}
    try:
        await sesiones.detener(db, conv)
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise _error_api(exc) from exc
    return {"ok": True}


# ------------------------------------------------------------------ eventos en vivo (SSE)
def _sse(datos: dict[str, Any]) -> str:
    return f"data: {json.dumps(datos, ensure_ascii=False, default=str)}\n\n"


@router.get("/conversaciones/{cid}/eventos")
async def eventos(cid: str, request: Request,
                  creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> StreamingResponse:
    """Lo que pasa en la conversación, en vivo. Primero manda la conversación completa y después cada novedad.
    No retiene una conexión a la base mientras está abierto (se autentica con una sesión corta)."""
    async with session_scope() as db:
        user = await get_current_user(request, creds, db)
        if not puede_usar(user):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Tu perfil no tiene habilitado el asistente Voi.")
        await _propia(db, cid, user)

    async def flujo():
        loop = asyncio.get_running_loop()
        async with difusion.suscribir(cid) as cola:      # primero suscribirse: nada se pierde entre medio
            async with session_scope() as db:
                conv = await db.get(AsistenteConversacion, cid)
                inicial = await transcripcion.construir(db, conv)
                trabajando = conv.estado in ("running", "requires_action")
            yield _sse({"tipo": "transcripcion", **inicial})
            if trabajando:
                consumidor.asegurar(cid)
            fin = loop.time() + DURACION_STREAM
            while loop.time() < fin:
                try:
                    ev = await asyncio.wait_for(cola.get(), timeout=max(0.05, min(15.0, fin - loop.time())))
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                if ev.get("tipo") == "uso" and not user.is_superadmin:
                    continue
                yield _sse(ev)
            yield _sse({"tipo": "reconectar"})

    return StreamingResponse(flujo(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


# ------------------------------------------------------------------ acciones (confirmar / cancelar)
async def _accion_propia(db: AsyncSession, aid: str, user: CurrentUser) -> AsistenteAccion:
    a = await db.get(AsistenteAccion, aid)
    if a is None or a.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Acción no encontrada")
    return a


@router.post("/acciones/{aid}/confirmar")
async def confirmar(aid: str, user: CurrentUser = Depends(usuario_voi), db: AsyncSession = Depends(get_db)) -> dict:
    await _accion_propia(db, aid, user)
    try:
        a = await consumidor.resolver(db, aid, confirmar=True)
    except Exception as exc:  # noqa: BLE001
        log.exception("No se pudo confirmar la acción %s", aid)
        await db.rollback()
        raise _error_api(exc) from exc
    return consumidor.accion_dict(a)


@router.post("/acciones/{aid}/cancelar")
async def cancelar(aid: str, user: CurrentUser = Depends(usuario_voi), db: AsyncSession = Depends(get_db)) -> dict:
    await _accion_propia(db, aid, user)
    try:
        a = await consumidor.resolver(db, aid, confirmar=False)
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise _error_api(exc) from exc
    return consumidor.accion_dict(a)


# ------------------------------------------------------------------ memoria
@router.get("/memoria")
async def ver_memoria(user: CurrentUser = Depends(usuario_voi), db: AsyncSession = Depends(get_db)) -> dict:
    if not config.clave_configurada():
        return {"items": []}
    try:
        return {"items": await memoria.listar(db, user.id)}
    except Exception as exc:  # noqa: BLE001
        log.warning("No se pudo leer la memoria de %s: %s", user.id, exc)
        raise _error_api(exc) from exc


@router.delete("/memoria/{mid}")
async def borrar_memoria(mid: str, user: CurrentUser = Depends(usuario_voi), db: AsyncSession = Depends(get_db)) -> dict:
    try:
        await memoria.borrar(db, user.id, mid)
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No hay memoria para borrar") from exc
    except Exception as exc:  # noqa: BLE001
        raise _error_api(exc) from exc
    return {"ok": True}


# ------------------------------------------------------------------ webhook de Anthropic (opcional)
def verificar_webhook(cuerpo: bytes, headers: dict[str, str], clave: str, *, tolerancia: int = 300) -> dict[str, Any]:
    """Firma de Standard Webhooks (la que usa Anthropic): HMAC-SHA256 de `id.timestamp.cuerpo` con el secreto `whsec_…`."""
    msg_id, ts, firmas = headers.get("webhook-id"), headers.get("webhook-timestamp"), headers.get("webhook-signature")
    if not (msg_id and ts and firmas):
        raise ValueError("faltan encabezados de firma")
    if abs(time.time() - int(ts)) > tolerancia:
        raise ValueError("timestamp fuera de tolerancia")
    secreto = base64.b64decode(clave.removeprefix("whsec_"))
    esperada = base64.b64encode(hmac.new(secreto, f"{msg_id}.{ts}.".encode() + cuerpo, hashlib.sha256).digest()).decode()
    if not any(hmac.compare_digest(esperada, f.split(",", 1)[1]) for f in firmas.split() if "," in f):
        raise ValueError("firma inválida")
    return json.loads(cuerpo)


@router.post("/webhooks/anthropic", include_in_schema=False)
async def webhook(request: Request) -> dict:
    """Aviso de Anthropic (sesión libre, esperando acción, tope…): se vuelve a escuchar esa conversación."""
    if not settings.anthropic_webhook_signing_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Webhook no configurado")
    cuerpo = await request.body()
    try:
        ev = verificar_webhook(cuerpo, {k.lower(): v for k, v in request.headers.items()},
                               settings.anthropic_webhook_signing_key)
    except (ValueError, TypeError) as exc:
        log.warning("Webhook de Anthropic rechazado: %s", exc)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Firma inválida") from exc
    datos = ev.get("data") or {}
    if str(datos.get("type", "")).startswith("session.") and datos.get("id"):
        async with session_scope() as db:
            cid = (await db.execute(select(AsistenteConversacion.id).where(
                AsistenteConversacion.session_id == datos["id"]))).scalar_one_or_none()
        if cid:
            consumidor.asegurar(cid, otra_vuelta=True)
    return {"ok": True}
