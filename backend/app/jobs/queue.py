"""Cola de trabajo genérica (Postgres + disco, sin Redis) para las cargas de las operativas.

Patrón:
* El endpoint solo guarda el archivo y deja la fila en `status='pending'`.
* Un worker hace polling, reclama cada job de forma ATÓMICA y lo procesa con
  concurrencia limitada (default 1, por ser parseo grande).
* El trabajo pesado lo corre el `runner` (normalmente aislado en subproceso,
  ver `isolated.py`) → nunca tumba la API.
* Recuperación al boot: jobs que quedaron en 'processing' (server caído) se
  marcan 'failed' (fail-safe, sin crash-loop).

El modelo de upload debe tener las columnas `id`, `status`, `uploaded_at`,
`started_at` y `last_error`.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime
from typing import Awaitable, Callable

from sqlalchemy import select, update

from ..core.database import session_scope
from ..core.logging import logger

_POLL_SECONDS = 5.0


class JobQueue:
    def __init__(self, name: str, model, runner: Callable[[str], Awaitable[None]]):
        self.name = name
        self.model = model
        self.runner = runner
        # Se crea dentro del worker para quedar atado a SU event loop (no al de import).
        self._wakeup: asyncio.Event | None = None

    def signal(self) -> None:
        """Despierta al worker (lo llama el endpoint al recibir un upload nuevo)."""
        if self._wakeup is not None:
            self._wakeup.set()

    def _concurrency(self) -> int:
        try:
            return max(1, int(os.getenv(f"{self.name.upper()}_WORKER_CONCURRENCY", "1")))
        except ValueError:
            return 1

    async def _reset_stale_processing(self) -> int:
        async with session_scope() as db:
            res = await db.execute(
                update(self.model)
                .where(self.model.status == "processing")
                .values(
                    status="failed",
                    last_error="El procesamiento se interrumpió y reinició el servidor "
                               "(posible archivo demasiado grande o corrupto). "
                               "Revisá el archivo y volvé a subirlo.",
                )
            )
            failed = res.rowcount or 0
            await db.commit()
        if failed:
            logger.warning(f"[{self.name}-queue] {failed} job(s) interrumpido(s) marcados 'failed' (fail-safe)")
        return failed

    async def _claim_next(self) -> str | None:
        """Reclama atómicamente el upload pendiente más antiguo. Devuelve id o None."""
        async with session_scope() as db:
            row = (await db.execute(
                select(self.model.id)
                .where(self.model.status == "pending")
                .order_by(self.model.uploaded_at.asc())
                .limit(1)
            )).first()
            if not row:
                return None
            uid = row[0]
            res = await db.execute(
                update(self.model)
                .where(self.model.id == uid, self.model.status == "pending")
                .values(status="processing", started_at=datetime.utcnow())
            )
            await db.commit()
            return uid if (res.rowcount or 0) == 1 else None

    async def _run(self, upload_id: str) -> None:
        try:
            await self.runner(upload_id)
        finally:
            self.signal()  # slot liberado: re-evaluar

    async def worker(self) -> None:
        self._wakeup = asyncio.Event()
        concurrency = self._concurrency()
        logger.info(f"[{self.name}-queue] worker iniciado (concurrencia={concurrency})")
        try:
            await self._reset_stale_processing()
        except Exception as exc:
            logger.exception(f"[{self.name}-queue] fail-safe de boot falló (sigo igual): {exc}")

        running: set[asyncio.Task] = set()
        while True:
            try:
                while len(running) < concurrency:
                    uid = await self._claim_next()
                    if uid is None:
                        break
                    task = asyncio.create_task(self._run(uid))
                    running.add(task)
                    task.add_done_callback(running.discard)

                self._wakeup.clear()
                try:
                    await asyncio.wait_for(self._wakeup.wait(), timeout=_POLL_SECONDS)
                except asyncio.TimeoutError:
                    pass
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                # NUNCA morir en silencio: un corte transitorio se loguea y se reintenta.
                logger.exception(f"[{self.name}-queue] error transitorio en el loop (reintento en 5s): {exc}")
                await asyncio.sleep(5)
