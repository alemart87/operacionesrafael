"""Runner del Reporte de Facturación (Televentas Claro).

El parseo del .txt (~37k filas) corre AISLADO en subproceso (memoria + timeout
acotados) para que un archivo malo no pueda tumbar la API. El disparo y la
concurrencia las maneja `facturacion_queue`; este runner asume que el upload ya
fue reclamado (status='processing').
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import select

from ..core.database import session_scope
from ..core.logging import logger
from ..models.facturacion_report import FacturacionReport
from ..models.facturacion_upload import FacturacionUpload
from ..services.analyzers.facturacion import analyze_facturacion
from ..services.parsers.facturacion_parser import parse_facturacion
from .isolated import friendly_error, run_isolated


def _build(path: str) -> dict[str, Any]:
    """Trabajo pesado (sync) — corre en subproceso aislado."""
    parsed = parse_facturacion(path)
    return analyze_facturacion(parsed)


def _period_to_date(periodo: str | None) -> date | None:
    if not periodo or len(periodo) < 7:
        return None
    try:
        y, m = int(periodo[0:4]), int(periodo[5:7])
        return date(y, m, 1)
    except ValueError:
        return None


async def run_facturacion(upload_id: str) -> None:
    logger.info(f"[facturacion-job] start {upload_id}")

    async with session_scope() as db:
        upload = await db.get(FacturacionUpload, upload_id)
        if not upload:
            return
        existing = (await db.execute(
            select(FacturacionReport.id).where(FacturacionReport.upload_id == upload_id)
        )).first()
        if existing:
            upload.status = "completed"
            upload.completed_at = upload.completed_at or datetime.utcnow()
            await db.commit()
            logger.info(f"[facturacion-job] already done {upload_id}")
            return
        path = upload.file_path
        period_hint = upload.period_month

    try:
        analysis = await run_isolated(_build, path)
        k = analysis["kpis"]
        periodo = k.get("periodo")
        period_month = period_hint or _period_to_date(periodo) or datetime.utcnow().date().replace(day=1)

        async with session_scope() as db:
            report = FacturacionReport(
                upload_id=upload_id,
                period_month=period_month,
                nro_liquidacion=k.get("nro_liquidacion"),
                periodo=periodo,
                total=k["total"],
                creditos=k["creditos"],
                debitos=k["debitos"],
                ventas_activaciones=k["ventas_activaciones"],
                data=analysis,
            )
            db.add(report)
            up = await db.get(FacturacionUpload, upload_id)
            up.status = "completed"
            up.completed_at = datetime.utcnow()
            up.nro_liquidacion = k.get("nro_liquidacion")
            up.last_error = None
            await db.commit()
        logger.info(f"[facturacion-job] completed {upload_id} (liq {k.get('nro_liquidacion')})")

    except Exception as exc:
        logger.exception(f"[facturacion-job] failed {upload_id}: {exc}")
        async with session_scope() as db:
            up = await db.get(FacturacionUpload, upload_id)
            if up:
                up.status = "failed"
                up.last_error = friendly_error(exc)
                up.retry_count = (up.retry_count or 0) + 1
                await db.commit()
