"""Los entrenamientos desde el link del postulante: la lista con su avance, los casos y el chat con el cliente.

El postulante nunca ve la configuración del caso. Cada caso se hace una vez (si se corta, retoma la misma
conversación). Al cerrar cada caso, la IA lo evalúa en segundo plano y el postulante recibe una devolución corta: qué
mejorar, los datos que tenía que dar bien (con el correcto) y algo que hizo bien. Nunca ve puntajes ni la
recomendación de incorporación: eso queda para el equipo. Al terminar el último caso, ve lo que hizo bien y qué mejorar.
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
        ev = (s.evaluacion or {}) if s else {}
        lista.append({"id": c.id, "orden": i + 1, "titulo": c.titulo, "cliente": c.cliente_nombre,
                      "estado": "hecho" if s and s.estado in srv.HECHOS else ("en_curso" if s else "pendiente"),
                      "segundos": s.segundos if s else None, "sesion_id": s.id if s else None,
                      "info_ok": ev.get("info_correcta") if s and s.estado == "terminada" else None})
    hechos = sum(1 for x in lista if x["estado"] == "hecho")
    r = a.resultado or {}
    _toque(e_link, request)
    await db.commit()
    return {"id": a.id, "nombre": e.nombre, "intento": a.intento or 1, "instrucciones": e.instrucciones, "empresa": e.empresa, "canal": e.canal,
            "casos": lista, "hechos": hechos, "total": len(lista), "pct": round(hechos / len(lista) * 100) if lista else 0,
            "terminado": a.estado in ("evaluando", "terminado"), "disponible": ent.ia.servicio_disponible(),
            # La devolución final para el postulante: lo que hizo bien y qué mejorar (sin el resumen ni la recomendación).
            "devolucion_final": {"fuertes": r.get("fuertes") or [], "mejorar": r.get("mejorar") or []} if a.estado == "terminado" else None}


@router.post("/{token}/entrenamientos/{aid}/casos/{cid}")
async def iniciar(token: str, aid: str, cid: str, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Empieza (o retoma) la conversación de un caso."""
    e_link, p, g = await _vigente(db, token, request)
    a, e = await _asignacion(db, aid, p.id)
    c = await db.get(CapCaso, cid)
    if not c or c.entrenamiento_id != e.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Caso no encontrado")
    async def existente() -> CapSesion | None:
        return (await db.execute(select(CapSesion).where(CapSesion.asignacion_id == a.id, CapSesion.caso_id == c.id)
                                 .order_by(CapSesion.iniciado_at.desc()))).scalars().first()
    if (s := await existente()) is not None:
        return ent.sesion_publica(s)
    async with ent.candado(f"{a.id}:{c.id}"):
        # Se vuelve a mirar adentro del candado: dos toques seguidos no abren dos conversaciones del mismo caso.
        if (s := await existente()) is not None:
            return ent.sesion_publica(s)
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


def devolucion(s: CapSesion) -> dict[str, Any]:
    """La devolución corta de un caso para el postulante. Sin puntajes, sin nivel y sin la recomendación."""
    if s.estado == "en_curso":
        return {"estado": "en_curso"}
    if s.estado == "evaluando":
        return {"estado": "evaluando"}
    ev = s.evaluacion or {}
    if s.estado != "terminada" or not ev:
        return {"estado": "sin_devolucion"}
    texto = ev.get("devolucion") or " ".join([*(ev.get("mejorar") or [])[:1], *(ev.get("fuertes") or [])[:1]])
    corregir = [{"dato": d["dato"], "detalle": d.get("detalle") or ""} for d in ev.get("datos") or []
                if d.get("estado") in ("incorrecto", "omitido")][:3]
    return {"estado": "lista", "info_ok": bool(ev.get("info_correcta")), "devolucion": texto, "corregir": corregir}


@router.get("/{token}/sesiones/{sid}/devolucion")
async def ver_devolucion(token: str, sid: str, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Lo que le devolvemos al postulante de un caso, apenas la IA lo evalúa (la pantalla la consulta hasta que está)."""
    e_link, p, g = await _vigente(db, token, request)
    return devolucion(await _sesion(db, sid, p.id))


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
