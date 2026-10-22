"""Los entrenamientos desde el link del postulante: la lista con su avance, los casos y el chat con el cliente.

El postulante nunca ve la configuración del caso ni la evaluación: solo la charla. Cada caso se hace una vez (si se
corta, retoma la misma conversación); al cerrar el último, se evalúa en segundo plano y se completa su ficha.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from ...core.database import get_db
from . import entrenamientos as ent
from . import servicio as srv
from .models import CapAsignacion, CapCaso, CapEntrenamiento, CapSesion
from .publico_api import _toque, _vigente

router = APIRouter(prefix="/capacitacion/publico", tags=["capacitación · link del postulante"])


async def _asignacion(db: AsyncSession, aid: str, pid: str) -> tuple[CapAsignacion, CapEntrenamiento]:
    a = await db.get(CapAsignacion, aid)
    e = await db.get(CapEntrenamiento, a.entrenamiento_id) if a else None
    if not a or a.postulante_id != pid or not e or e.estado == "archivado":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entrenamiento no encontrado")
    return a, e


@router.get("/{token}/entrenamientos/{aid}")
async def ver(token: str, aid: str, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """El entrenamiento: instrucciones, casos en orden y cuáles ya hizo."""
    e_link, p, g = await _vigente(db, token, request)
    a, e = await _asignacion(db, aid, p.id)
    casos = await ent._casos(db, e.id)
    sesiones = (await db.execute(select(CapSesion).where(CapSesion.asignacion_id == a.id))).scalars().all()
    por_caso = {s.caso_id: s for s in sesiones}
    lista: list[dict[str, Any]] = []
    for i, c in enumerate(casos):
        s = por_caso.get(c.id)
        lista.append({"id": c.id, "orden": i + 1, "titulo": c.titulo, "cliente": c.cliente_nombre,
                      "estado": "hecho" if s and s.estado in srv.HECHOS else ("en_curso" if s else "pendiente"),
                      "segundos": s.segundos if s else None, "sesion_id": s.id if s else None})
    hechos = sum(1 for x in lista if x["estado"] == "hecho")
    _toque(e_link, request)
    await db.commit()
    return {"id": a.id, "nombre": e.nombre, "intento": a.intento or 1, "instrucciones": e.instrucciones, "empresa": e.empresa, "canal": e.canal,
            "casos": lista, "hechos": hechos, "total": len(lista), "pct": round(hechos / len(lista) * 100) if lista else 0,
            "terminado": a.estado in ("evaluando", "terminado"), "disponible": ent.ia.servicio_disponible()}


@router.post("/{token}/entrenamientos/{aid}/casos/{cid}")
async def iniciar(token: str, aid: str, cid: str, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Empieza (o retoma) la conversación de un caso."""
    e_link, p, g = await _vigente(db, token, request)
    a, e = await _asignacion(db, aid, p.id)
    c = await db.get(CapCaso, cid)
    if not c or c.entrenamiento_id != e.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Caso no encontrado")
    existente = (await db.execute(select(CapSesion).where(CapSesion.asignacion_id == a.id, CapSesion.caso_id == c.id)
                                  .order_by(CapSesion.iniciado_at.desc()))).scalars().first()
    if existente:
        return ent.sesion_publica(existente)
    async with ent.candado(f"{a.id}:{c.id}"):
        s = await ent.abrir(db, e=e, c=c, asignacion=a, postulante_id=p.id)
        if a.estado == "pendiente":
            a.estado, a.iniciado_at = "en_curso", srv.ahora()
        _toque(e_link, request)
        await db.commit()
    return ent.sesion_publica(s)


async def _sesion(db: AsyncSession, sid: str, pid: str) -> CapSesion:
    s = await db.get(CapSesion, sid)
    if not s or s.postulante_id != pid or not s.asignacion_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
    return s


@router.get("/{token}/sesiones/{sid}")
async def ver_sesion(token: str, sid: str, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    e_link, p, g = await _vigente(db, token, request)
    return ent.sesion_publica(await _sesion(db, sid, p.id))


@router.post("/{token}/sesiones/{sid}/mensajes")
async def mensaje(token: str, sid: str, payload: ent.Mensaje, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """El postulante escribe (uno o varios mensajes seguidos); el cliente contesta (1 a 3 mensajes) o cierra la charla."""
    e_link, p, g = await _vigente(db, token, request)
    s = await _sesion(db, sid, p.id)
    if await ent.respuestas_hoy(db, p.id) >= settings.entrenamiento_respuestas_dia:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Llegaste al máximo de mensajes de hoy. Seguí mañana.")
    async with ent.candado(s.id):
        await db.refresh(s)
        r = await ent.turno(db, s, payload.lista(), payload.lote)
        if r["fin"]:
            await _al_cerrar(db, s)
        _toque(e_link, request)
        await db.commit()
    if r["fin"]:
        ent.despertar()
    return {**r, "sesion": ent.sesion_publica(s)}


async def _al_cerrar(db: AsyncSession, s: CapSesion) -> None:
    a = await db.get(CapAsignacion, s.asignacion_id)
    await ent.actualizar_asignacion(db, a)


@router.post("/{token}/sesiones/{sid}/terminar")
async def terminar(token: str, sid: str, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """El postulante da por terminada la conversación (por ejemplo, después de despedirse)."""
    e_link, p, g = await _vigente(db, token, request)
    s = await _sesion(db, sid, p.id)
    async with ent.candado(s.id):
        await db.refresh(s)
        if s.estado == "en_curso":
            ent.cerrar(s, "asesor")
            await _al_cerrar(db, s)
            _toque(e_link, request)
            await db.commit()
    ent.despertar()
    return ent.sesion_publica(s)
