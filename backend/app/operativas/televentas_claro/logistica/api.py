"""API de Logística de entregas: subir el corte de pedidos, borradores, publicación (una por mes), reemplazo,
recálculo y eliminación. Misma lógica que Ventas Netas: quien gestiona ve todo; el resto, solo lo publicado."""
from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
from datetime import date, datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from ....api.deps import CurrentUser, client_ip, require_perm
from ....core.config import settings
from ....core.database import get_db
from ....models.user import User
from ....services.audit_service import record_action
from .analyzer import VERSION_ANALISIS, analizar, resumen_para_modelo
from .models import ESTADO_BORRADOR, ESTADO_PUBLICADO, ESTADO_REEMPLAZADO, LogisticaInforme, LogisticaUpload
from .parser import ArchivoInvalido, parse_logistica

SLUG = "televentas_claro"
PERM_VER, PERM_GESTION = f"{SLUG}.logistica", f"{SLUG}.logistica_gestion"
ZONA = ZoneInfo("America/Asuncion")
router = APIRouter(prefix="/televentas-claro/logistica", tags=["televentas-claro · logística"])
require_ver, require_gestion = require_perm(PERM_VER), require_perm(PERM_GESTION)


class PublicarPayload(BaseModel):
    confirm_replace: bool = False
    title: Optional[str] = Field(None, max_length=255)


def _iso(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat() if d else None


def _resumen(r: LogisticaInforme) -> dict[str, Any]:
    return {
        "id": r.id, "upload_id": r.upload_id, "periodo": r.periodo, "fecha_dato": r.fecha_dato.isoformat() if r.fecha_dato else None,
        "fecha_corte": r.fecha_corte.isoformat(), "version": r.version, "generated_at": _iso(r.generated_at), "generated_by": r.generated_by,
        "status": r.status, "published_at": _iso(r.published_at), "published_by": r.published_by, "replaced_at": _iso(r.replaced_at),
        "replaced_by_report_id": r.replaced_by_report_id, "title": r.title,
        "pedidos": r.pedidos, "entregados": r.entregados, "en_gestion": r.en_gestion, "devueltos": r.devueltos,
        "pct_entregados": r.pct_entregados, "demora_prom": r.demora_prom, "demora_max": r.demora_max,
        "demora_regiones": r.demora_regiones or {}, "proyeccion": r.proyeccion, "version_actual": VERSION_ANALISIS,
        "entrega_prom": r.entrega_prom, "entrega_max": r.entrega_max, "entrega_regiones": r.entrega_regiones,
    }


async def _nombres(db: AsyncSession, ids: set[str | None]) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))
    return {i: n for i, n in rows.all()}


def _aplicar(informe: LogisticaInforme, data: dict[str, Any]) -> None:
    res = resumen_para_modelo(data)
    informe.data = data
    informe.periodo = res["periodo"]
    informe.period_month = date.fromisoformat(res["periodo"] + "-01")
    informe.fecha_dato = date.fromisoformat(res["fecha_dato"])
    informe.version = res["version"]
    for k in ("pedidos", "entregados", "en_gestion", "devueltos", "pct_entregados", "demora_prom", "demora_max", "demora_regiones", "proyeccion",
              "entrega_prom", "entrega_max", "entrega_regiones"):
        setattr(informe, k, res[k])


def _comprimir(filas: list[dict[str, Any]]) -> bytes:
    return gzip.compress(json.dumps(filas, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _descomprimir(gz: bytes) -> list[dict[str, Any]]:
    return json.loads(gzip.decompress(gz).decode("utf-8"))


async def _visible(db: AsyncSession, informe_id: str, user: CurrentUser) -> LogisticaInforme:
    r = await db.get(LogisticaInforme, informe_id[:36])
    if r is None or (not user.has_perm(PERM_GESTION) and r.status != ESTADO_PUBLICADO):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    return r


# ------------------------------------------------------------------ subir
@router.post("/uploads", status_code=status.HTTP_201_CREATED)
async def subir(request: Request, file: UploadFile = File(..., description="Corte de pedidos de logística (.xlsx)"),
                fecha_corte: Optional[str] = Form(None), user: CurrentUser = Depends(require_gestion),
                db: AsyncSession = Depends(get_db)) -> dict:
    """Sube el .xlsx, lo lee y arma el borrador del mes en el mismo pedido (son pocos miles de filas)."""
    nombre = file.filename or ""
    if not nombre.lower().endswith(".xlsx"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Se espera el archivo .xlsx de pedidos de logística")
    contenido = await file.read()
    if len(contenido) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"El archivo excede {settings.max_upload_size_mb}MB")
    try:
        corte = date.fromisoformat(fecha_corte) if fecha_corte else datetime.now(ZONA).date()
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Fecha del corte inválida (YYYY-MM-DD)") from exc
    if corte > datetime.now(ZONA).date():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La fecha del corte no puede ser futura")
    try:
        leido = await asyncio.to_thread(parse_logistica, contenido)
        data = await asyncio.to_thread(analizar, leido["filas"], corte)
    except ArchivoInvalido as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    if date.fromisoformat(data["kpis"]["hasta"]) > corte:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"El archivo tiene ventas del {data['kpis']['hasta']}, posteriores a la fecha del corte ({corte:%d/%m/%Y}).")

    up = LogisticaUpload(uploaded_by=user.id, filename=nombre[:500], file_sha256=hashlib.sha256(contenido).hexdigest(),
                         parsed_gz=_comprimir(leido["filas"]), filas=len(leido["filas"]))
    db.add(up)
    await db.flush()
    informe = LogisticaInforme(upload_id=up.id, periodo=data["periodo"], period_month=date.fromisoformat(data["periodo"] + "-01"),
                               fecha_corte=corte, generated_by=user.id)
    _aplicar(informe, data)
    db.add(informe)
    await db.commit()
    await db.refresh(informe)
    await record_action(db, user_id=user.id, action="logistica_corte_subido", resource_type="logistica_informe", resource_id=informe.id,
                        ip=client_ip(request), extra={"archivo": nombre, "periodo": informe.periodo, "pedidos": informe.pedidos,
                                                       "fecha_corte": corte.isoformat()})
    return {"informe": _resumen(informe), "avisos": data["avisos"]}


# ------------------------------------------------------------------ informes
@router.get("/informes")
async def listar(user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    q = select(LogisticaInforme).options(defer(LogisticaInforme.data))
    if not user.has_perm(PERM_GESTION):
        q = q.where(LogisticaInforme.status == ESTADO_PUBLICADO)
    rows = (await db.execute(q.order_by(LogisticaInforme.period_month.desc(), LogisticaInforme.fecha_corte.desc(),
                                        LogisticaInforme.generated_at.desc()).limit(500))).scalars().all()
    nombres = await _nombres(db, {r.generated_by for r in rows} | {r.published_by for r in rows})
    return {"items": [_resumen(r) for r in rows], "total": len(rows), "usuarios": nombres, "gestion": user.has_perm(PERM_GESTION)}


@router.get("/informes/{informe_id}")
async def ver(informe_id: str, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    r = await _visible(db, informe_id, user)
    nombres = await _nombres(db, {r.generated_by, r.published_by})
    return {**_resumen(r), "data": r.data, "usuarios": nombres}


@router.post("/informes/{informe_id}/publicar")
async def publicar(informe_id: str, payload: PublicarPayload, request: Request, user: CurrentUser = Depends(require_gestion),
                   db: AsyncSession = Depends(get_db)) -> dict:
    r = await _visible(db, informe_id, user)
    if r.status == ESTADO_PUBLICADO:
        return _resumen(r)
    actual = (await db.execute(select(LogisticaInforme).options(defer(LogisticaInforme.data)).where(
        LogisticaInforme.periodo == r.periodo, LogisticaInforme.status == ESTADO_PUBLICADO))).scalar_one_or_none()
    if actual and not payload.confirm_replace:
        nombres = await _nombres(db, {actual.published_by})
        raise HTTPException(status.HTTP_409_CONFLICT, detail={
            "code": "replace_required",
            "message": f"Ya existe una publicación del período {r.periodo}. Si continuás, la reemplaza.",
            "existing": {"id": actual.id, "fecha_corte": actual.fecha_corte.isoformat(), "fecha_dato": actual.fecha_dato.isoformat() if actual.fecha_dato else None,
                         "published_at": _iso(actual.published_at), "published_by": nombres.get(actual.published_by or "", actual.published_by),
                         "pedidos": actual.pedidos, "pct_entregados": actual.pct_entregados},
        })
    ahora = datetime.now(timezone.utc)
    if actual:
        actual.status, actual.replaced_at, actual.replaced_by_report_id = ESTADO_REEMPLAZADO, ahora, r.id
    r.status, r.published_at, r.published_by = ESTADO_PUBLICADO, ahora, user.id
    r.replaced_at, r.replaced_by_report_id = None, None   # un reemplazado puede volver a publicarse
    if payload.title is not None:
        r.title = payload.title.strip() or None
    await db.commit()
    await db.refresh(r)
    await record_action(db, user_id=user.id, action="logistica_informe_reemplazado" if actual else "logistica_informe_publicado",
                        resource_type="logistica_informe", resource_id=r.id, ip=client_ip(request),
                        extra={"periodo": r.periodo, "reemplaza_a": actual.id if actual else None})
    return _resumen(r)


@router.post("/informes/{informe_id}/despublicar")
async def despublicar(informe_id: str, request: Request, user: CurrentUser = Depends(require_gestion),
                      db: AsyncSession = Depends(get_db)) -> dict:
    r = await _visible(db, informe_id, user)
    if r.status != ESTADO_PUBLICADO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El informe no está publicado")
    r.status, r.published_at, r.published_by = ESTADO_BORRADOR, None, None
    await db.commit()
    await record_action(db, user_id=user.id, action="logistica_informe_despublicado", resource_type="logistica_informe",
                        resource_id=r.id, ip=client_ip(request), extra={"periodo": r.periodo})
    return _resumen(r)


@router.post("/informes/{informe_id}/recalcular")
async def recalcular(informe_id: str, request: Request, user: CurrentUser = Depends(require_gestion),
                     db: AsyncSession = Depends(get_db)) -> dict:
    """Vuelve a correr el análisis con las filas guardadas del archivo (cuando cambia la versión del análisis)."""
    r = await _visible(db, informe_id, user)
    up = await db.get(LogisticaUpload, r.upload_id)
    if up is None or not up.parsed_gz:
        raise HTTPException(status.HTTP_409_CONFLICT, "No quedaron guardadas las filas del archivo: subilo de nuevo")
    filas = await asyncio.to_thread(_descomprimir, up.parsed_gz)
    data = await asyncio.to_thread(analizar, filas, r.fecha_corte)
    _aplicar(r, data)
    r.generated_at, r.generated_by = datetime.now(timezone.utc), user.id
    await db.commit()
    await db.refresh(r)
    await record_action(db, user_id=user.id, action="logistica_informe_recalculado", resource_type="logistica_informe",
                        resource_id=r.id, ip=client_ip(request), extra={"periodo": r.periodo, "version": r.version})
    return {**_resumen(r), "data": r.data}


@router.delete("/informes/{informe_id}")
async def eliminar(informe_id: str, request: Request, user: CurrentUser = Depends(require_gestion),
                   db: AsyncSession = Depends(get_db)) -> dict:
    r = await _visible(db, informe_id, user)
    if r.status == ESTADO_PUBLICADO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Un informe publicado no se elimina: despublicalo primero")
    periodo, upload_id = r.periodo, r.upload_id
    await db.delete(r)
    otros = (await db.execute(select(LogisticaInforme.id).where(LogisticaInforme.upload_id == upload_id))).first()
    if otros is None:
        up = await db.get(LogisticaUpload, upload_id)
        if up is not None:
            await db.delete(up)
    await db.commit()
    await record_action(db, user_id=user.id, action="logistica_informe_eliminado", resource_type="logistica_informe",
                        resource_id=informe_id, ip=client_ip(request), extra={"periodo": periodo})
    return {"status": "deleted"}
