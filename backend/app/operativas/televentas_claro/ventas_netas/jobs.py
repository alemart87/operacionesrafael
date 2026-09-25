"""Cola y runner de Ventas Netas: parsea cada corte en subproceso aislado y genera el informe (borrador)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from ....core.database import session_scope
from ....core.logging import logger
from ....jobs.isolated import friendly_error, run_isolated
from ....jobs.queue import JobQueue
from .analyzer import analyze_ventas_netas
from .models import ESTADO_BORRADOR, VentasNetasReport, VentasNetasUpload
from .parser import parse_ventas_netas


def _build(path: str) -> dict[str, Any]:
    """Trabajo pesado (sync) — corre en subproceso aislado."""
    return analyze_ventas_netas(parse_ventas_netas(path))


ANALYSIS_VERSION = 4  # sube cuando el análisis agrega bloques: los informes viejos se pueden actualizar


def aplicar_analisis(report: VentasNetasReport, analysis: dict[str, Any]) -> None:
    """Vuelca el análisis en las columnas desnormalizadas y el JSON del informe."""
    k = analysis["kpis"]
    y, m = (int(x) for x in k["periodo"].split("-"))
    report.periodo = k["periodo"]
    report.period_month = date(y, m, 1)
    report.fecha_dato = date.fromisoformat(k["fecha_dato"]) if k.get("fecha_dato") else None
    report.netas, report.pospago, report.gpon, report.iptv = k["netas"], k["pospago"], k["gpon"], k["iptv"]
    report.pospago_sin_uso, report.pct_sin_uso, report.pendientes = k["pospago_sin_uso"], k["pct_sin_uso"], k["pendientes"]
    report.data = {**analysis, "version": ANALYSIS_VERSION}


async def analizar_archivo(path: str) -> dict[str, Any]:
    return await run_isolated(_build, path)


async def run_ventas_netas(upload_id: str) -> None:
    logger.info(f"[ventas-netas-job] start {upload_id}")
    async with session_scope() as db:
        upload = await db.get(VentasNetasUpload, upload_id)
        if not upload:
            return
        path, uploaded_by = upload.file_path, upload.uploaded_by

    try:
        analysis = await analizar_archivo(path)
        k = analysis["kpis"]
        async with session_scope() as db:
            report = VentasNetasReport(upload_id=upload_id, periodo=k["periodo"], period_month=date.today(),
                                       generated_by=uploaded_by, status=ESTADO_BORRADOR)
            aplicar_analisis(report, analysis)
            db.add(report)
            up = await db.get(VentasNetasUpload, upload_id)
            up.status = "completed"
            up.completed_at = datetime.utcnow()
            up.last_error = None
            await db.commit()
        logger.info(f"[ventas-netas-job] completed {upload_id} (período {k['periodo']}, corte {k.get('fecha_dato')})")
    except Exception as exc:
        logger.exception(f"[ventas-netas-job] failed {upload_id}: {exc}")
        async with session_scope() as db:
            up = await db.get(VentasNetasUpload, upload_id)
            if up:
                up.status = "failed"
                up.last_error = friendly_error(exc)
                up.retry_count = (up.retry_count or 0) + 1
                await db.commit()


queue = JobQueue("ventas_netas", VentasNetasUpload, run_ventas_netas)
