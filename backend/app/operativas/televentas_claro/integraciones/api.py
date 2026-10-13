"""API de Integraciones.

- Gestión de claves (sesión de la plataforma con la utilidad `televentas_claro.integraciones`: sub gerente y
  superadmin). El sub gerente crea, ve y bloquea las suyas; el superadmin ve todas, bloquea, desbloquea y elimina.
- Datasets de solo lectura (`/integraciones/datasets/…`): se atienden con una clave de API (`Authorization: Bearer
  vcop_…` o `X-API-Key`), que es lo que manda KNIME; también con la sesión de alguien con la utilidad, para probar
  desde la pantalla. Cada llamada con clave queda registrada (ok, límite, denegada, error).
"""
from __future__ import annotations

import csv
import io
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, bearer, client_ip, get_current_user, require_perm
from ....core.database import get_db
from ....services.audit_service import record_action
from . import claves as srv
from . import datasets as ds
from .models import ACTIVA, BLOQUEADA, ApiClave, ApiUso

SLUG = "televentas_claro"
PERM = f"{SLUG}.integraciones"
router = APIRouter(prefix="/televentas-claro/integraciones", tags=["televentas-claro · integraciones"])
require_integraciones = require_perm(PERM)


# ------------------------------------------------------------------ gestión de claves
class CrearPayload(BaseModel):
    nombre: str = Field(..., min_length=2, max_length=120)
    vigencia_dias: int = Field(365, ge=1, le=srv.MAX_VIGENCIA_DIAS)
    limite_minuto: int = Field(60, ge=1, le=srv.MAX_LIMITE_MINUTO)
    limite_dia: int = Field(5000, ge=1, le=srv.MAX_LIMITE_DIA)
    datasets: list[str] = Field(default_factory=list, max_length=50)   # vacío = todos


class BloquearPayload(BaseModel):
    motivo: str = Field("", max_length=300)


class LimitesPayload(BaseModel):
    limite_minuto: int = Field(..., ge=1, le=srv.MAX_LIMITE_MINUTO)
    limite_dia: int = Field(..., ge=1, le=srv.MAX_LIMITE_DIA)


async def _usos_de_hoy(db: AsyncSession) -> dict[str, tuple[int, int]]:
    """{clave_id: (ok hoy, rechazos hoy)}."""
    q = (select(ApiUso.clave_id, ApiUso.resultado, func.count()).where(ApiUso.at >= srv.inicio_del_dia())
         .group_by(ApiUso.clave_id, ApiUso.resultado))
    out: dict[str, list[int]] = {}
    for cid, res, n in (await db.execute(q)).all():
        x = out.setdefault(cid, [0, 0])
        x[0 if res == "ok" else 1] += int(n)
    return {k: (v[0], v[1]) for k, v in out.items()}


async def _clave_visible(db: AsyncSession, clave_id: str, user: CurrentUser) -> ApiClave:
    c = await db.get(ApiClave, clave_id[:36])
    if c is None or (not user.is_superadmin and c.owner_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No existe esa clave")
    return c


@router.get("/claves")
async def listar(user: CurrentUser = Depends(require_integraciones), db: AsyncSession = Depends(get_db)) -> dict:
    q = select(ApiClave)
    if not user.is_superadmin:
        q = q.where(ApiClave.owner_id == user.id)
    rows = (await db.execute(q.order_by(ApiClave.created_at.desc()))).scalars().all()
    hoy = await _usos_de_hoy(db)
    return {"items": [srv.clave_dict(c, *hoy.get(c.id, (0, 0))) for c in rows], "superadmin": user.is_superadmin,
            "datasets": ds.catalogo_dict(), "limites_max": {"minuto": srv.MAX_LIMITE_MINUTO, "dia": srv.MAX_LIMITE_DIA,
                                                            "vigencia_dias": srv.MAX_VIGENCIA_DIAS}}


@router.post("/claves", status_code=status.HTTP_201_CREATED)
async def crear(payload: CrearPayload, request: Request, user: CurrentUser = Depends(require_integraciones),
                db: AsyncSession = Depends(get_db)) -> dict:
    desconocidos = [d for d in payload.datasets if d not in ds.CATALOGO]
    if desconocidos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Dataset desconocido: {', '.join(desconocidos)}")
    secreto, prefijo, h = srv.generar()
    c = ApiClave(nombre=payload.nombre.strip(), prefijo=prefijo, hash=h, owner_id=user.id, owner_nombre=user.full_name,
                 creada_por=user.id, expira_at=srv.ahora() + timedelta(days=payload.vigencia_dias),
                 limite_minuto=payload.limite_minuto, limite_dia=payload.limite_dia, datasets=sorted(set(payload.datasets)))
    db.add(c)
    await db.commit()
    await db.refresh(c)
    await record_action(db, user_id=user.id, action="integraciones_clave_creada", resource_type="integraciones_clave",
                        resource_id=c.id, ip=client_ip(request),
                        extra={"nombre": c.nombre, "prefijo": c.prefijo, "vigencia_dias": payload.vigencia_dias,
                               "limite_minuto": c.limite_minuto, "limite_dia": c.limite_dia, "datasets": c.datasets})
    # El secreto se muestra una sola vez: no se guarda en ningún lado.
    return {"clave": srv.clave_dict(c), "secreto": secreto}


@router.post("/claves/{clave_id}/bloquear")
async def bloquear(clave_id: str, payload: BloquearPayload, request: Request, user: CurrentUser = Depends(require_integraciones),
                   db: AsyncSession = Depends(get_db)) -> dict:
    c = await _clave_visible(db, clave_id, user)
    if c.estado != BLOQUEADA:
        c.estado, c.bloqueada_at, c.bloqueada_por, c.motivo_bloqueo = BLOQUEADA, srv.ahora(), user.id, payload.motivo.strip() or None
        await db.commit()
        await record_action(db, user_id=user.id, action="integraciones_clave_bloqueada", resource_type="integraciones_clave",
                            resource_id=c.id, ip=client_ip(request), extra={"nombre": c.nombre, "prefijo": c.prefijo, "motivo": c.motivo_bloqueo})
    return srv.clave_dict(c)


@router.post("/claves/{clave_id}/desbloquear")
async def desbloquear(clave_id: str, request: Request, user: CurrentUser = Depends(require_integraciones),
                      db: AsyncSession = Depends(get_db)) -> dict:
    if not user.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo el superadmin desbloquea una clave")
    c = await _clave_visible(db, clave_id, user)
    if c.estado != ACTIVA:
        c.estado, c.bloqueada_at, c.bloqueada_por, c.motivo_bloqueo = ACTIVA, None, None, None
        await db.commit()
        await record_action(db, user_id=user.id, action="integraciones_clave_desbloqueada", resource_type="integraciones_clave",
                            resource_id=c.id, ip=client_ip(request), extra={"nombre": c.nombre, "prefijo": c.prefijo})
    return srv.clave_dict(c)


@router.patch("/claves/{clave_id}/limites")
async def limites(clave_id: str, payload: LimitesPayload, request: Request, user: CurrentUser = Depends(require_integraciones),
                  db: AsyncSession = Depends(get_db)) -> dict:
    if not user.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo el superadmin cambia los límites")
    c = await _clave_visible(db, clave_id, user)
    antes = {"limite_minuto": c.limite_minuto, "limite_dia": c.limite_dia}
    c.limite_minuto, c.limite_dia = payload.limite_minuto, payload.limite_dia
    await db.commit()
    await record_action(db, user_id=user.id, action="integraciones_clave_limites", resource_type="integraciones_clave",
                        resource_id=c.id, ip=client_ip(request),
                        extra={"nombre": c.nombre, "antes": antes, "despues": {"limite_minuto": c.limite_minuto, "limite_dia": c.limite_dia}})
    return srv.clave_dict(c)


@router.delete("/claves/{clave_id}")
async def eliminar(clave_id: str, request: Request, user: CurrentUser = Depends(require_integraciones),
                   db: AsyncSession = Depends(get_db)) -> dict:
    if not user.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo el superadmin elimina una clave (vos podés bloquearla)")
    c = await _clave_visible(db, clave_id, user)
    nombre, prefijo = c.nombre, c.prefijo
    await db.delete(c)   # el registro de usos queda (con el prefijo y el nombre) para la auditoría
    await db.commit()
    await record_action(db, user_id=user.id, action="integraciones_clave_eliminada", resource_type="integraciones_clave",
                        resource_id=clave_id, ip=client_ip(request), extra={"nombre": nombre, "prefijo": prefijo})
    return {"status": "deleted"}


@router.get("/claves/{clave_id}/usos")
async def usos_de(clave_id: str, limit: int = Query(200, ge=1, le=2000), user: CurrentUser = Depends(require_integraciones),
                  db: AsyncSession = Depends(get_db)) -> dict:
    c = await _clave_visible(db, clave_id, user)
    rows = (await db.execute(select(ApiUso).where(ApiUso.clave_id == c.id).order_by(ApiUso.at.desc()).limit(limit))).scalars().all()
    hoy = await _usos_de_hoy(db)
    return {"clave": srv.clave_dict(c, *hoy.get(c.id, (0, 0))), "items": [srv.uso_dict(u) for u in rows]}


@router.get("/usos")
async def usos(dias: int = Query(7, ge=1, le=90), limit: int = Query(300, ge=1, le=2000),
               user: CurrentUser = Depends(require_integraciones), db: AsyncSession = Depends(get_db)) -> dict:
    """Los últimos usos de todas las claves (el sub gerente, los de las suyas) y el resumen por día."""
    desde = srv.inicio_del_dia() - timedelta(days=dias - 1)
    q = select(ApiUso).where(ApiUso.at >= desde)
    if not user.is_superadmin:
        propias = [cid for (cid,) in (await db.execute(select(ApiClave.id).where(ApiClave.owner_id == user.id))).all()]
        q = q.where(ApiUso.clave_id.in_(propias or ["-"]))
    rows = (await db.execute(q.order_by(ApiUso.at.desc()).limit(limit))).scalars().all()
    por_dia: dict[str, dict[str, int]] = {}
    for u in rows:
        d = srv._utc(u.at).astimezone(srv.ZONA).date().isoformat()
        x = por_dia.setdefault(d, {"ok": 0, "limite": 0, "denegada": 0, "error": 0})
        x[u.resultado if u.resultado in x else "error"] += 1
    return {"desde": desde.astimezone(srv.ZONA).date().isoformat(), "items": [srv.uso_dict(u) for u in rows],
            "por_dia": [{"fecha": k, **v} for k, v in sorted(por_dia.items())]}


# ------------------------------------------------------------------ datasets (clave de API o sesión con la utilidad)
class Actor:
    def __init__(self, clave: Optional[ApiClave] = None, user: Optional[CurrentUser] = None):
        self.clave, self.user = clave, user


async def actor(request: Request, db: AsyncSession = Depends(get_db)) -> Actor:
    """Quién pide el dataset: una clave de API válida, o un usuario con la utilidad. Los rechazos de clave se registran."""
    secreto = srv.secreto_del_pedido(request)
    dataset = request.path_params.get("nombre")
    if secreto:
        try:
            c = await srv.validar(db, secreto, dataset)
        except srv.ClaveRechazada as r:
            c = getattr(r, "clave", None)
            await srv.registrar(db, c, request, dataset=dataset, status_code=r.codigo, resultado=r.resultado, detalle=r.mensaje,
                                prefijo=secreto[: len(srv.PREFIJO) + srv.VISIBLES])
            raise srv.http_error(r) from None
        return Actor(clave=c)
    creds = await bearer(request)
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Falta la clave de API (Authorization: Bearer vcop_…)")
    user = await get_current_user(request, creds, db)
    if not user.has_perm(PERM):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenés permiso para esta acción")
    return Actor(user=user)


@router.get("/datasets")
async def catalogo(request: Request, a: Actor = Depends(actor), db: AsyncSession = Depends(get_db)) -> dict:
    items = ds.catalogo_dict()
    if a.clave is not None and a.clave.datasets:
        items = [d for d in items if d["nombre"] in a.clave.datasets]
    if a.clave is not None:
        await srv.registrar(db, a.clave, request, dataset=None, status_code=200, resultado="ok", filas=len(items))
    return {"items": items, "parametros": {"desde": "YYYY-MM-DD (por defecto, 30 días atrás)", "hasta": "YYYY-MM-DD (por defecto, hoy)",
                                           "formato": "json | csv", "borradores": "1 para incluir lo no publicado / no firmado"},
            "max_dias": ds.MAX_DIAS, "max_filas": ds.MAX_FILAS}


@router.get("/datasets/{nombre}")
async def dataset(nombre: str, request: Request, desde: Optional[date] = Query(None), hasta: Optional[date] = Query(None),
                  formato: Literal["json", "csv"] = Query("json"), borradores: bool = Query(False),
                  a: Actor = Depends(actor), db: AsyncSession = Depends(get_db)) -> Response:
    t0 = time.perf_counter()
    d = ds.CATALOGO.get(nombre)
    if d is None:
        if a.clave is not None:
            await srv.registrar(db, a.clave, request, dataset=nombre, status_code=404, resultado="error", detalle="dataset desconocido")
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No existe el dataset «{nombre}». Ver /integraciones/datasets")
    try:
        d0, d1 = ds.rango(desde, hasta)
        filas = await d["fn"](db, d0, d1, borradores)
    except ValueError as exc:
        if a.clave is not None:
            await srv.registrar(db, a.clave, request, dataset=nombre, status_code=400, resultado="error", detalle=str(exc))
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    truncado = len(filas) > ds.MAX_FILAS
    filas = filas[: ds.MAX_FILAS]
    ms = int((time.perf_counter() - t0) * 1000)
    if a.clave is not None:
        await srv.registrar(db, a.clave, request, dataset=nombre, status_code=200, resultado="ok", filas=len(filas), ms=ms)
    cols = ds.columnas(filas)
    if formato == "csv":
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        for f in filas:
            w.writerow({k: ("" if v is None else v) for k, v in f.items()})
        return Response(buf.getvalue().encode("utf-8-sig"), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{nombre}_{d0}_{d1}.csv"', "X-Filas": str(len(filas))})
    return _json({"dataset": nombre, "desde": d0.isoformat(), "hasta": d1.isoformat(), "borradores": borradores, "filas": len(filas),
                  "truncado": truncado, "columnas": cols, "generado_at": datetime.now(timezone.utc).isoformat(), "items": filas})


def _json(data: dict[str, Any]) -> Response:
    import json
    return Response(json.dumps(data, ensure_ascii=False, default=str), media_type="application/json")
