"""Ejecución aislada de trabajo pesado/peligroso (parseo de archivos subidos).

Corre una función en un SUBPROCESO separado (contexto 'spawn', memoria limpia)
con tope de memoria (RLIMIT_AS) y timeout. Si el archivo provoca OOM, segfault o
un cuelgue, muere el subproceso —no la API— y el llamador recibe una excepción
que el runner convierte en job 'failed'. Así un upload mal formado no puede
tumbar el sistema.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import multiprocessing
from typing import Any, Callable

from ..core.config import settings
from ..core.logging import logger


def _init_limits(max_bytes: int) -> None:
    if max_bytes and max_bytes > 0:
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (max_bytes, max_bytes))
        except Exception:  # pragma: no cover - depende del SO
            pass


async def run_isolated(func: Callable[..., Any], *args: Any) -> Any:
    """Ejecuta `func(*args)` en un subproceso con tiempo (y opcionalmente memoria)
    acotados. Lanza TimeoutError / BrokenProcessPool / la excepción del worker si
    algo falla; el runner que llama lo captura y marca el job 'failed'.
    """
    mem_mb = max(0, settings.upload_proc_mem_mb)
    mem_bytes = mem_mb * 1024 * 1024  # 0 = sin RLIMIT
    timeout = max(10, settings.upload_proc_timeout_s)
    ctx = multiprocessing.get_context("spawn")
    executor = concurrent.futures.ProcessPoolExecutor(
        max_workers=1, mp_context=ctx, initializer=_init_limits, initargs=(mem_bytes,),
    )
    loop = asyncio.get_running_loop()
    try:
        return await asyncio.wait_for(loop.run_in_executor(executor, func, *args), timeout=timeout)
    except asyncio.TimeoutError as exc:
        raise TimeoutError(f"El procesamiento superó el límite de {timeout}s") from exc
    finally:
        # Forzar la terminación del subproceso (incluso si quedó colgado/OOM).
        for proc in list(getattr(executor, "_processes", {}).values()):
            try:
                proc.terminate()
            except Exception:
                pass
        executor.shutdown(wait=False, cancel_futures=True)


def friendly_error(exc: BaseException) -> str:
    """Mensaje claro para el usuario sobre por qué falló su carga."""
    import concurrent.futures
    if isinstance(exc, TimeoutError):
        return ("El procesamiento tardó demasiado. El archivo parece muy grande o tener un "
                "formato incorrecto. Revisalo y volvé a subirlo.")
    if isinstance(exc, MemoryError):
        return ("El archivo consumió demasiada memoria. Verificá que sea el archivo correcto "
                "y que no esté dañado, y volvé a subirlo.")
    if isinstance(exc, concurrent.futures.process.BrokenProcessPool):
        return ("No se pudo procesar el archivo (posible formato inválido, dañado o demasiado "
                "grande). Corregilo y volvé a subirlo.")
    msg = str(exc).strip()
    return msg[:300] if msg else ("No se pudo procesar el archivo. Verificá el formato y volvé a subirlo.")
