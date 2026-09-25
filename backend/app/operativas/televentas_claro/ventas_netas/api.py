"""API de Ventas Netas — Televentas Claro.

Permisos:
* `televentas_claro.ventas_netas`          → ver informes PUBLICADOS y descargarlos.
* `televentas_claro.ventas_netas_gestion`  → subir cortes, ver borradores, publicar, reemplazar, eliminar.

Publicación: como máximo un informe publicado por período. Publicar sobre un
período que ya tiene uno exige `confirm_replace=True`; si no viene, la API
responde 409 con los datos del publicado actual para que la pantalla lo avise.
"""
from __future__ import annotations

import hashlib
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip, require_perm
from ....core.config import settings
from ....core.database import get_db
from ....models.user import User
from ....services.audit_service import record_action
from .exports import build_xlsx
from .jobs import ANALYSIS_VERSION, analizar_archivo, analizar_guardado, aplicar_analisis, comprimir_parsed, queue
from .models import ESTADO_BORRADOR, ESTADO_PUBLICADO, ESTADO_REEMPLAZADO, VentasNetasReport, VentasNetasUpload
from .schemas import PublishRequest, ReportDetail, ReportList, ReportSummary, UploadList, UploadRead

PERM_VER = "televentas_claro.ventas_netas"
PERM_GESTION = "televentas_claro.ventas_netas_gestion"
require_ver = require_perm(PERM_VER)
require_gestion = require_perm(PERM_GESTION)

router = APIRouter(prefix="/televentas-claro/ventas-netas", tags=["televentas-claro · ventas netas"])


def _es_xlsx(filename: str | None) -> bool:
    return bool(filename) and filename.lower().endswith(".xlsx")


async def _get_report_visible(db: AsyncSession, report_id: str, user: CurrentUser) -> VentasNetasReport:
    """Gestión ve todo; el resto solo lo publicado."""
    report = await db.get(VentasNetasReport, report_id)
    if not report or (report.status != ESTADO_PUBLICADO and not user.has_perm(PERM_GESTION)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    return report


async def _nombres(db: AsyncSession, ids: set[str]) -> dict[str, str]:
    ids = {i for i in ids if i}
    out = {"superadmin": settings.superadmin_name}
    if not ids:
        return out
    rows = await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))
    out.update({i: n for i, n in rows.all()})
    return out


# ============================ UPLOADS ============================
@router.post("/uploads", response_model=UploadRead, status_code=status.HTTP_202_ACCEPTED)
async def create_upload(
    request: Request,
    file: UploadFile = File(..., description="Corte diario de ventas de Claro (.xlsx)"),
    user: CurrentUser = Depends(require_gestion),
    db: AsyncSession = Depends(get_db),
) -> VentasNetasUpload:
    # Validar ANTES de crear la fila: si no, queda un upload 'pending' sin archivo en la cola.
    if not _es_xlsx(file.filename):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Se espera el archivo .xlsx de ventas de Claro")
    content = await file.read()
    if len(content) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"El archivo excede {settings.max_upload_size_mb}MB")

    upload = VentasNetasUpload(uploaded_by=user.id, status="pending")
    db.add(upload)
    await db.commit()
    await db.refresh(upload)

    target_dir = settings.upload_path / "ventas_netas" / upload.id
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / file.filename
    target.write_bytes(content)
    upload.filename, upload.file_path = file.filename, str(target.resolve())
    upload.file_sha256 = hashlib.sha256(content).hexdigest()
    await db.commit()

    await record_action(
        db, user_id=user.id, action="create_ventas_netas_upload",
        resource_type="ventas_netas_upload", resource_id=upload.id,
        ip=client_ip(request), extra={"filename": upload.filename},
    )
    queue.signal()
    return upload


@router.get("/uploads", response_model=UploadList)
async def list_uploads(user: CurrentUser = Depends(require_gestion), db: AsyncSession = Depends(get_db)) -> UploadList:
    rows = await db.execute(select(VentasNetasUpload).order_by(VentasNetasUpload.uploaded_at.desc()).limit(100))
    items = rows.scalars().all()
    return UploadList(items=[UploadRead.model_validate(u) for u in items], total=len(items))


@router.get("/uploads/{upload_id}", response_model=UploadRead)
async def get_upload(
    upload_id: str, user: CurrentUser = Depends(require_gestion), db: AsyncSession = Depends(get_db),
) -> VentasNetasUpload:
    upload = await db.get(VentasNetasUpload, upload_id)
    if not upload:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Upload no encontrado")
    return upload


# ============================ REPORTS ============================
@router.get("/reports", response_model=ReportList)
async def list_reports(user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> ReportList:
    q = select(VentasNetasReport)
    if not user.has_perm(PERM_GESTION):
        q = q.where(VentasNetasReport.status == ESTADO_PUBLICADO)
    rows = await db.execute(
        q.order_by(VentasNetasReport.period_month.desc(), VentasNetasReport.fecha_dato.desc(),
                   VentasNetasReport.generated_at.desc()).limit(500)
    )
    items = rows.scalars().all()
    nombres = await _nombres(db, {r.published_by for r in items} | {r.generated_by for r in items})
    return ReportList(items=[ReportSummary.model_validate(r) for r in items], total=len(items), usuarios=nombres)


@router.get("/reports/{report_id}", response_model=ReportDetail)
async def get_report(
    report_id: str, request: Request,
    user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db),
) -> VentasNetasReport:
    report = await _get_report_visible(db, report_id, user)
    await record_action(
        db, user_id=user.id, action="view_ventas_netas_report",
        resource_type="ventas_netas_report", resource_id=report_id, ip=client_ip(request),
    )
    return report


@router.get("/reports/{report_id}/export.xlsx")
async def export_report(
    report_id: str, request: Request,
    user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db),
) -> Response:
    report = await _get_report_visible(db, report_id, user)
    content = build_xlsx(report)
    await record_action(
        db, user_id=user.id, action="export_ventas_netas_report",
        resource_type="ventas_netas_report", resource_id=report_id, ip=client_ip(request),
    )
    corte = report.fecha_dato.isoformat() if report.fecha_dato else "sin-corte"
    return Response(
        content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="ventas-netas_{report.periodo}_corte-{corte}.xlsx"'},
    )


@router.post("/reports/{report_id}/publish", response_model=ReportSummary)
async def publish_report(
    report_id: str, payload: PublishRequest, request: Request,
    user: CurrentUser = Depends(require_gestion), db: AsyncSession = Depends(get_db),
) -> VentasNetasReport:
    report = await db.get(VentasNetasReport, report_id)
    if not report:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    if report.status == ESTADO_PUBLICADO:
        return report

    actual = (await db.execute(
        select(VentasNetasReport).where(
            VentasNetasReport.periodo == report.periodo, VentasNetasReport.status == ESTADO_PUBLICADO,
        )
    )).scalar_one_or_none()

    if actual and not payload.confirm_replace:
        nombres = await _nombres(db, {actual.published_by})
        raise HTTPException(status.HTTP_409_CONFLICT, detail={
            "code": "replace_required",
            "message": f"Ya existe una publicación del período {report.periodo}. Si continuás, la reemplaza.",
            "existing": {
                "id": actual.id,
                "fecha_dato": actual.fecha_dato.isoformat() if actual.fecha_dato else None,
                "published_at": actual.published_at.isoformat() if actual.published_at else None,
                "published_by": nombres.get(actual.published_by or "", actual.published_by),
                "netas": actual.netas,
            },
        })

    ahora = datetime.utcnow()
    if actual:
        actual.status = ESTADO_REEMPLAZADO
        actual.replaced_at = ahora
        actual.replaced_by_report_id = report.id
    report.status = ESTADO_PUBLICADO
    report.published_at = ahora
    report.published_by = user.id
    if payload.title is not None:
        report.title = payload.title
    await db.commit()
    await db.refresh(report)
    await record_action(
        db, user_id=user.id,
        action="replace_ventas_netas_report" if actual else "publish_ventas_netas_report",
        resource_type="ventas_netas_report", resource_id=report_id, ip=client_ip(request),
        extra={"periodo": report.periodo, "reemplaza_a": actual.id if actual else None},
    )
    return report


@router.post("/reports/{report_id}/reprocess", response_model=ReportSummary)
async def reprocess_report(
    report_id: str, request: Request,
    user: CurrentUser = Depends(require_gestion), db: AsyncSession = Depends(get_db),
) -> VentasNetasReport:
    """Recalcula el informe (para informes generados por una versión anterior del análisis).

    Usa los datos leídos que quedaron guardados en la base; el archivo original
    es solo un respaldo para cargas anteriores a que se guardaran esos datos.
    """
    report = await db.get(VentasNetasReport, report_id)
    if not report:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    upload = await db.get(VentasNetasUpload, report.upload_id)
    try:
        if upload and upload.parsed_gz:
            analysis = analizar_guardado(upload.parsed_gz)
        elif upload and upload.file_path and Path(upload.file_path).exists():
            resultado = await analizar_archivo(upload.file_path)
            analysis = resultado["analysis"]
            upload.parsed_gz = comprimir_parsed(resultado["parsed"])  # de acá en más ya no depende del archivo
        else:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Este corte se cargó antes de que el sistema guardara sus datos, y el archivo ya no está en el "
                "servidor. Es la única vez: subí ese corte de nuevo y de ahí en más se recalcula solo.",
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"No se pudo recalcular el informe: {exc}") from exc
    aplicar_analisis(report, analysis)
    await db.commit()
    await db.refresh(report)
    await record_action(
        db, user_id=user.id, action="reprocess_ventas_netas_report",
        resource_type="ventas_netas_report", resource_id=report_id, ip=client_ip(request),
        extra={"periodo": report.periodo, "version": ANALYSIS_VERSION},
    )
    return report


@router.post("/reports/{report_id}/unpublish", response_model=ReportSummary)
async def unpublish_report(
    report_id: str, request: Request,
    user: CurrentUser = Depends(require_gestion), db: AsyncSession = Depends(get_db),
) -> VentasNetasReport:
    report = await db.get(VentasNetasReport, report_id)
    if not report:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    if report.status != ESTADO_PUBLICADO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El informe no está publicado")
    report.status = ESTADO_BORRADOR
    report.published_at = None
    report.published_by = None
    await db.commit()
    await db.refresh(report)
    await record_action(
        db, user_id=user.id, action="unpublish_ventas_netas_report",
        resource_type="ventas_netas_report", resource_id=report_id, ip=client_ip(request),
        extra={"periodo": report.periodo},
    )
    return report


@router.delete("/reports/{report_id}")
async def delete_report(
    report_id: str, request: Request,
    user: CurrentUser = Depends(require_gestion), db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    report = await db.get(VentasNetasReport, report_id)
    if not report:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    if report.status == ESTADO_PUBLICADO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El informe está publicado: despublicalo antes de eliminarlo")
    await db.delete(report)
    await db.commit()
    await record_action(
        db, user_id=user.id, action="delete_ventas_netas_report",
        resource_type="ventas_netas_report", resource_id=report_id, ip=client_ip(request),
        extra={"periodo": report.periodo, "status": report.status},
    )
    return {"status": "deleted"}
