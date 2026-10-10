"""Migraciones de datos de Facturación (una sola vez, ver models/migracion.py)."""
from __future__ import annotations

import asyncio
import gzip
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models.upload import FacturacionUpload


def _leer_gz(path: str) -> bytes | None:
    try:
        p = Path(path)
        return gzip.compress(p.read_bytes()) if p.is_file() else None
    except OSError:
        return None


async def copia_en_base(db: AsyncSession) -> dict[str, Any]:
    """Las liquidaciones cargadas antes de guardar su copia en la base: si el archivo sigue en el disco, se copia.
    Las que ya no lo tienen quedan como están (su informe ya está en la base)."""
    filas = (await db.execute(select(FacturacionUpload.id, FacturacionUpload.file_path)
                              .where(FacturacionUpload.contenido_gz.is_(None)))).all()
    copiadas = sin_archivo = 0
    for uid, path in filas:
        gz = await asyncio.to_thread(_leer_gz, path) if path else None
        if gz is None:
            sin_archivo += 1
            continue
        up = await db.get(FacturacionUpload, uid)
        up.contenido_gz = gz
        copiadas += 1
        await db.commit()  # de a una: una liquidación pesa varios MB sin comprimir
    return {"copiadas": copiadas, "sin_archivo": sin_archivo}


MIGRACIONES = [("facturacion_copia_en_base_v1", copia_en_base)]
