"""Memoria de Voi por usuario (memory store de Claude Managed Agents).

Cada usuario tiene su propio store, montado en cada sesión suya con lectura y escritura: ahí Voi guarda preferencias,
contexto recurrente y el avance de un trabajo. Cada cambio queda versionado en Anthropic. El usuario la ve y la borra
desde el panel («Lo que Voi recuerda»); el superadmin la puede revisar.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import CurrentUser
from ..core.perfiles import perfil_name
from .cliente import cliente
from .models import AsistenteUsuario

INSTRUCCIONES = ("Memoria de esta persona con Voi: preferencias de trabajo, contexto recurrente y avance de tareas. "
                 "Revisala al empezar. Guardá solo lo útil para próximas conversaciones, ordenado y breve, en archivos "
                 "de Markdown chicos. Nunca guardes contraseñas, claves ni datos personales sensibles, ni cifras que "
                 "cambian (se consultan).")


async def asegurar(db: AsyncSession, user: CurrentUser) -> str:
    """El id del memory store del usuario; lo crea la primera vez."""
    row = await db.get(AsistenteUsuario, user.id)
    if row and row.memoria_id:
        return row.memoria_id
    store = await cliente().beta.memory_stores.create(
        name=f"Voi · {user.full_name}"[:120],
        description=(f"Memoria de Voi con {user.full_name} ({perfil_name(user.role)}) en la plataforma de Operaciones "
                     f"Voicenter: preferencias, contexto de trabajo y tareas en curso."),
        metadata={"usuario": user.id, "plataforma": "operaciones-voicenter"},
    )
    if row is None:
        row = AsistenteUsuario(user_id=user.id)
        db.add(row)
    row.memoria_id = store.id
    await db.commit()
    return store.id


async def verificar(db: AsyncSession, user_id: str) -> None:
    """Si el store ya no existe en Anthropic (borrado o de otra cuenta), se olvida: la próxima sesión crea uno nuevo."""
    row = await db.get(AsistenteUsuario, user_id)
    if not row or not row.memoria_id:
        return
    try:
        await cliente().beta.memory_stores.retrieve(row.memoria_id)
    except Exception as exc:  # noqa: BLE001
        if getattr(exc, "status_code", None) != 404:
            raise
        row.memoria_id = None
        await db.commit()


def recurso(memoria_id: str) -> dict[str, Any]:
    return {"type": "memory_store", "memory_store_id": memoria_id, "access": "read_write", "instructions": INSTRUCCIONES}


async def listar(db: AsyncSession, user_id: str) -> list[dict[str, Any]]:
    row = await db.get(AsistenteUsuario, user_id)
    if not row or not row.memoria_id:
        return []
    out: list[dict[str, Any]] = []
    async for m in cliente().beta.memory_stores.memories.list(row.memoria_id, view="full", limit=100):
        if getattr(m, "type", "memory") != "memory":
            continue
        out.append({"id": m.id, "ruta": m.path, "contenido": getattr(m, "content", None) or "",
                    "actualizada": getattr(m, "updated_at", None)})
    return out


async def borrar(db: AsyncSession, user_id: str, memoria_item_id: str) -> None:
    row = await db.get(AsistenteUsuario, user_id)
    if not row or not row.memoria_id:
        raise LookupError("Sin memoria")
    await cliente().beta.memory_stores.memories.delete(memoria_item_id, memory_store_id=row.memoria_id)
