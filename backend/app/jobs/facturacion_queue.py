"""Cola de trabajo del módulo Facturación (Postgres + disco, sin Redis).

Mismo patrón seguro que `atencion_queue`:
* El endpoint solo guarda el .txt y deja la fila en `status='pending'`.
* Un worker hace polling, reclama cada job de forma ATÓMICA y lo procesa con
  concurrencia limitada (default 1, por ser parseo grande).
* El parseo pesado corre AISLADO en subproceso (ver runner) → nunca tumba la API.
* Recuperación al boot: jobs que quedaron en 'processing' (server caído) se
  marcan 'failed' (fail-safe, sin crash-loop).
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime

from sqlalchemy import select, update

from ..core.database import session_scope
from ..core.logging import logger
from ..models.facturacion_upload import FacturacionUpload
from .facturacion_runner import run_facturacion


def _concurrency() -> int:
    try:
        return max(1, int(os.getenv("FACTURACION_WORKER_CONCURRENCY", "1")))
    except ValueError:
        return 1


_POLL_SECONDS = 5.0
# Se crea dentro del worker para quedar atado a SU event loop (no al de import).
_wakeup: asyncio.Event | None = None


def signal_facturacion_queue() -> None:
    """Despierta al worker (lo llama el endpoint al recibir un upload nuevo)."""
    if _wakeup is not None:
        _wakeup.set()


async def _reset_stale_processing() -> int:
    failed = 0
    async with session_scope() as db:
        res = await db.execute(
            update(FacturacionUpload)
            .where(FacturacionUpload.status == "processing")
            .values(
                status="failed",
                last_error="El procesamiento se interrumpió y reinició el servidor "
                           "(posible archivo demasiado grande o corrupto). "
                           "Revisá el archivo y volvé a subirlo.",
            )
        )
        failed += res.rowcount or 0
        await db.commit()
    if failed:
        logger.warning(f"[facturacion-queue] {failed} job(s) interrumpido(s) marcados 'failed' (fail-safe)")
    return failed


async def _claim_next() -> str | None:
    """Reclama atómicamente el upload pendiente más antiguo. Devuelve id o None."""
    async with session_scope() as db:
        row = (await db.execute(
            select(FacturacionUpload.id)
            .where(FacturacionUpload.status == "pending")
            .order_by(FacturacionUpload.uploaded_at.asc())
            .limit(1)
        )).first()
        if not row:
            return None
        uid = row[0]
        res = await db.execute(
            update(FacturacionUpload)
            .where(FacturacionUpload.id == uid, FacturacionUpload.status == "pending")
            .values(status="processing", started_at=datetime.utcnow())
        )
        await db.commit()
        return uid if (res.rowcount or 0) == 1 else None


async def _run(upload_id: str) -> None:
    try:
        await run_facturacion(upload_id)
    finally:
        signal_facturacion_queue()  # slot liberado: re-evaluar


async def facturacion_worker() -> None:
    global _wakeup
    _wakeup = asyncio.Event()
    concurrency = _concurrency()
    logger.info(f"[facturacion-queue] worker iniciado (concurrencia={concurrency})")
    try:
        await _reset_stale_processing()
    except Exception as exc:
        logger.exception(f"[facturacion-queue] fail-safe de boot falló (sigo igual): {exc}")

    running: set[asyncio.Task] = set()
    while True:
        try:
            while len(running) < concurrency:
                uid = await _claim_next()
                if uid is None:
                    break
                task = asyncio.create_task(_run(uid))
                running.add(task)
                task.add_done_callback(running.discard)

            _wakeup.clear()
            try:
                await asyncio.wait_for(_wakeup.wait(), timeout=_POLL_SECONDS)
            except asyncio.TimeoutError:
                pass
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # NUNCA morir en silencio: un corte transitorio se loguea y se reintenta.
            logger.exception(f"[facturacion-queue] error transitorio en el loop (reintento en 5s): {exc}")
            await asyncio.sleep(5)
