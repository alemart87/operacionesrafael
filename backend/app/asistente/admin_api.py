"""Consola de Voi para el superadmin: estado de la conexión, publicación del agente, configuración y topes, consumo y
conversaciones de todos (cada lectura de una conversación ajena queda en la auditoría)."""
from __future__ import annotations

import logging
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import CurrentUser, require_superadmin
from ..core.config import settings
from ..core.database import get_db
from ..core.perfiles import perfil_name
from ..models.user import User
from ..services.audit_service import record_action
from . import config, consumidor, consumo, definicion, publicacion, transcripcion
from .cliente import cliente
from .herramientas import REGISTRO
from .models import EJECUTADA, FALLIDA, AsistenteAccion, AsistenteConversacion, AsistenteUsoDiario

log = logging.getLogger("asistente.admin")
router = APIRouter(prefix="/asistente/admin", tags=["asistente-admin"])


def _usd(centavos: int | None) -> float:
    return round((centavos or 0) / 100, 2)


@router.get("/estado")
async def estado(_: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    cfg, rec = await config.leer(db), await config.recursos(db)
    gasto = await consumo.gasto_mes(db)
    tope = float(cfg["topes"].get("mensual_usd") or 0)
    alerta = bool(tope) and gasto >= tope * 100 * float(cfg["topes"].get("alerta_pct") or 80) / 100
    habs = rec.get("habilidades") or {}
    return {
        "clave": bool(settings.anthropic_api_key), "simulador": config.simulador_activo(),
        "conectado": config.clave_configurada(), "webhook": bool(settings.anthropic_webhook_signing_key),
        "modelo": definicion.modelo(), "publicado": publicacion.listo(rec),
        "desactualizado": publicacion.desactualizado(rec), "agente": rec.get("agente"), "entorno": rec.get("entorno"),
        "habilidades": [{"nombre": h.nombre, "titulo": h.titulo, "descripcion": h.descripcion,
                         "version": (habs.get(h.nombre) or {}).get("version"),
                         "al_dia": (habs.get(h.nombre) or {}).get("huella") == h.huella,
                         "permisos": list(definicion.PERMISO_HABILIDAD.get(h.nombre, ())),
                         "auditor": h.nombre in definicion.HABILIDADES_AUDITOR}
                        for h in definicion.habilidades()],
        "herramientas": [{"nombre": h.nombre, "etiqueta": h.etiqueta, "nivel": h.nivel, "permisos": list(h.permisos),
                          "modos": sorted(h.modos)} for h in sorted(REGISTRO.values(), key=lambda x: (x.nivel, x.nombre))],
        "config": cfg, "gasto_mes_usd": _usd(gasto), "tope_mes_usd": tope, "alerta_consumo": alerta,
        "consumidores_activos": consumidor.activos(),
    }


# ------------------------------------------------------------------ configuración
class Topes(BaseModel):
    mensual_usd: Optional[float] = Field(None, ge=0, le=100000)
    alerta_pct: Optional[int] = Field(None, ge=1, le=100)
    conversacion_usd: Optional[float] = Field(None, ge=0.05, le=100)
    usuario_dia_usd: Optional[float] = Field(None, ge=0, le=1000)
    mensajes_minuto: Optional[int] = Field(None, ge=1, le=60)


class Retencion(BaseModel):
    sesion_dias: Optional[int] = Field(None, ge=1, le=365)
    copia_meses: Optional[int] = Field(None, ge=1, le=60)


class Autonomia(BaseModel):
    borradores_sin_confirmar: Optional[bool] = None


class ConfigPayload(BaseModel):
    habilitado: Optional[bool] = None
    topes: Optional[Topes] = None
    retencion: Optional[Retencion] = None
    autonomia: Optional[Autonomia] = None


@router.put("/config")
async def guardar_config(payload: ConfigPayload, user: CurrentUser = Depends(require_superadmin),
                         db: AsyncSession = Depends(get_db)) -> dict:
    cambios = payload.model_dump(exclude_none=True)
    cfg = await config.guardar(db, cambios, user.id)
    await record_action(db, user_id=user.id, action="asistente_config", resource_type="asistente", extra=cambios)
    return cfg


class PublicarPayload(BaseModel):
    forzar: bool = False


@router.post("/publicar")
async def publicar(payload: PublicarPayload, user: CurrentUser = Depends(require_superadmin),
                   db: AsyncSession = Depends(get_db)) -> dict:
    if not config.clave_configurada():
        raise HTTPException(status.HTTP_409_CONFLICT, "Falta cargar ANTHROPIC_API_KEY en el servidor (Render → Environment).")
    try:
        r = await publicacion.publicar(db, por=user.id, forzar=payload.forzar)
    except Exception as exc:  # noqa: BLE001
        log.exception("Publicación de Voi falló")
        await db.rollback()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"No se pudo publicar en Anthropic: {type(exc).__name__}: "
                                                         f"{str(exc)[:300]}") from exc
    await record_action(db, user_id=user.id, action="asistente_publicar", resource_type="asistente",
                        extra={"cambios": r["cambios"], "agente": (r["recursos"].get("agente") or {}).get("version")})
    return r


@router.post("/probar")
async def probar(_: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    """Prueba la clave: lee el entorno publicado (o la lista de entornos)."""
    if not config.clave_configurada():
        return {"ok": False, "mensaje": "Falta ANTHROPIC_API_KEY en el servidor."}
    rec = await config.recursos(db)
    t0 = time.monotonic()
    try:
        c = cliente()
        if (rec.get("entorno") or {}).get("id"):
            await c.beta.environments.retrieve(rec["entorno"]["id"])
        else:
            async for _e in c.beta.environments.list(limit=1):
                break
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "mensaje": f"{type(exc).__name__}: {str(exc)[:300]}"}
    return {"ok": True, "mensaje": "Conexión con Anthropic correcta" + (" (simulador)" if config.simulador_activo() else ""),
            "latencia_ms": int((time.monotonic() - t0) * 1000)}


# ------------------------------------------------------------------ consumo
async def _nombres(db: AsyncSession, ids: set[str]) -> dict[str, str]:
    out = {"superadmin": settings.superadmin_name}
    ids = {i for i in ids if i != "superadmin"}
    if ids:
        for uid, nombre in (await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))).all():
            out[uid] = nombre
    return out


@router.get("/consumo")
async def ver_consumo(desde: Optional[date] = None, hasta: Optional[date] = None,
                      _: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    hoy = consumo.hoy()
    hasta = hasta or hoy
    desde = desde or hasta.replace(day=1)
    if desde > hasta or (hasta - desde).days > 400:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Rango inválido (máximo 400 días)")
    filas = (await db.execute(select(AsistenteUsoDiario).where(
        AsistenteUsoDiario.fecha >= desde, AsistenteUsoDiario.fecha <= hasta))).scalars().all()
    por_dia: dict[str, dict[str, Any]] = {}
    por_usuario: dict[str, dict[str, Any]] = {}
    por_perfil: dict[str, dict[str, Any]] = defaultdict(lambda: {"costo": 0, "mensajes": 0, "usuarios": set()})
    tot = defaultdict(int)
    for r in filas:
        d = por_dia.setdefault(r.fecha.isoformat(), {"fecha": r.fecha.isoformat(), "costo": 0, "mensajes": 0,
                                                     "herramientas": 0, "acciones": 0, "usuarios": 0})
        u = por_usuario.setdefault(r.user_id, {"user_id": r.user_id, "perfil": r.perfil, "costo": 0, "mensajes": 0,
                                               "herramientas": 0, "acciones": 0, "dias": 0})
        for k in ("mensajes", "herramientas", "acciones"):
            d[k] += getattr(r, k)
            u[k] += getattr(r, k)
            tot[k] += getattr(r, k)
        for k in ("input_tokens", "output_tokens", "cache_lectura", "cache_escritura"):
            tot[k] += getattr(r, k)
        d["costo"] += r.costo_centavos
        d["usuarios"] += 1
        u["costo"] += r.costo_centavos
        u["dias"] += 1
        p = por_perfil[r.perfil]
        p["costo"] += r.costo_centavos
        p["mensajes"] += r.mensajes
        p["usuarios"].add(r.user_id)
        tot["costo"] += r.costo_centavos
    nombres = await _nombres(db, set(por_usuario))
    inicio = datetime.combine(desde, datetime.min.time(), tzinfo=config.ZONA).astimezone(timezone.utc)
    fin = datetime.combine(hasta + timedelta(days=1), datetime.min.time(), tzinfo=config.ZONA).astimezone(timezone.utc)
    usos = (await db.execute(select(AsistenteAccion.herramienta, AsistenteAccion.estado, func.count()).where(
        AsistenteAccion.created_at >= inicio, AsistenteAccion.created_at < fin)
        .group_by(AsistenteAccion.herramienta, AsistenteAccion.estado))).all()
    herramientas: dict[str, dict[str, Any]] = {}
    for nombre, estado_, n in usos:
        h = REGISTRO.get(nombre)
        x = herramientas.setdefault(nombre, {"nombre": nombre, "etiqueta": h.etiqueta if h else nombre,
                                             "nivel": h.nivel if h else None, "usos": 0, "errores": 0, "canceladas": 0})
        x["usos"] += n
        if estado_ == FALLIDA:
            x["errores"] += n
        elif estado_ == "cancelada":
            x["canceladas"] += n
    convs = (await db.execute(select(func.count()).select_from(AsistenteConversacion).where(
        AsistenteConversacion.created_at >= inicio, AsistenteConversacion.created_at < fin))).scalar() or 0
    return {
        "desde": desde.isoformat(), "hasta": hasta.isoformat(), "conversaciones": convs,
        "totales": {**{k: v for k, v in tot.items() if k != "costo"}, "costo_usd": _usd(tot["costo"]),
                    "usuarios": len(por_usuario)},
        "por_dia": [{**d, "costo_usd": _usd(d.pop("costo"))} for d in sorted(por_dia.values(), key=lambda x: x["fecha"])],
        "por_usuario": sorted(({**u, "nombre": nombres.get(u["user_id"], u["user_id"]), "perfil_nombre": perfil_name(u["perfil"]),
                                "costo_usd": _usd(u.pop("costo"))} for u in por_usuario.values()),
                              key=lambda x: -x["costo_usd"]),
        "por_perfil": sorted(({"perfil": k, "perfil_nombre": perfil_name(k), "costo_usd": _usd(v["costo"]),
                               "mensajes": v["mensajes"], "usuarios": len(v["usuarios"])} for k, v in por_perfil.items()),
                             key=lambda x: -x["costo_usd"]),
        "por_herramienta": sorted(herramientas.values(), key=lambda x: -x["usos"]),
    }


# ------------------------------------------------------------------ conversaciones de todos
@router.get("/conversaciones")
async def conversaciones(usuario: Optional[str] = None, perfil: Optional[str] = None, q: Optional[str] = None,
                         desde: Optional[date] = None, hasta: Optional[date] = None,
                         limite: int = Query(50, ge=1, le=200), pagina: int = Query(1, ge=1),
                         _: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    filtros = []
    if usuario:
        filtros.append(AsistenteConversacion.user_id == usuario)
    if perfil:
        filtros.append(AsistenteConversacion.perfil == perfil)
    if q:
        patron = f"%{q.strip()[:80]}%"
        filtros.append(or_(AsistenteConversacion.titulo.ilike(patron), AsistenteConversacion.user_nombre.ilike(patron)))
    if desde:
        filtros.append(AsistenteConversacion.ultima_actividad >= datetime.combine(desde, datetime.min.time(), tzinfo=config.ZONA))
    if hasta:
        filtros.append(AsistenteConversacion.ultima_actividad < datetime.combine(hasta + timedelta(days=1), datetime.min.time(),
                                                                                 tzinfo=config.ZONA))
    total = (await db.execute(select(func.count()).select_from(AsistenteConversacion).where(*filtros))).scalar() or 0
    rows = (await db.execute(select(AsistenteConversacion).where(*filtros)
                             .order_by(AsistenteConversacion.ultima_actividad.desc())
                             .offset((pagina - 1) * limite).limit(limite))).scalars().all()
    ids = [c.id for c in rows]
    acciones: dict[str, dict[str, int]] = defaultdict(lambda: {"consultas": 0, "acciones": 0})
    if ids:
        for cid, nivel, n in (await db.execute(select(AsistenteAccion.conversacion_id, AsistenteAccion.nivel, func.count())
                                                .where(AsistenteAccion.conversacion_id.in_(ids))
                                                .group_by(AsistenteAccion.conversacion_id, AsistenteAccion.nivel))).all():
            acciones[cid]["acciones" if (nivel or 1) > 1 else "consultas"] += n
    return {"total": total, "pagina": pagina,
            "items": [{**transcripcion.conversacion_dict(c, admin=True), **acciones[c.id],
                       "perfil_nombre": perfil_name(c.perfil)} for c in rows]}


@router.get("/conversaciones/{cid}")
async def conversacion(cid: str, user: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    conv = await db.get(AsistenteConversacion, cid)
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
    datos = await transcripcion.construir(db, conv, completo=True)
    if conv.user_id != user.id:
        await record_action(db, user_id=user.id, action="asistente_ver_conversacion", resource_type="asistente_conversacion",
                            resource_id=cid, extra={"de": conv.user_id, "perfil": conv.perfil})
    return datos


@router.get("/acciones")
async def acciones_recientes(limite: int = Query(50, ge=1, le=200), _: CurrentUser = Depends(require_superadmin),
                             db: AsyncSession = Depends(get_db)) -> dict:
    """Las últimas acciones de Voi (lo que propuso o hizo, no las consultas)."""
    rows = (await db.execute(select(AsistenteAccion).where(AsistenteAccion.nivel > 1)
                             .order_by(AsistenteAccion.created_at.desc()).limit(limite))).scalars().all()
    nombres = await _nombres(db, {a.user_id for a in rows})
    return {"items": [{**consumidor.accion_dict(a), "user_id": a.user_id, "user_nombre": nombres.get(a.user_id, a.user_id),
                       "conversacion_id": a.conversacion_id, "ok": a.estado == EJECUTADA} for a in rows]}
