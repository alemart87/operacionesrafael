"""Voi, el agente de la plataforma, construido sobre Claude Managed Agents.

- `claude/`: la definición del agente en archivos (agente, entorno y habilidades), versionada con el código.
- `publicacion.py`: la publica en Anthropic (crea o actualiza solo lo que cambió).
- `herramientas/`: lo que Voi consulta y hace en la plataforma, con los permisos de quien conversa.
- `sesiones.py` y `consumidor.py`: cada conversación es una sesión; el consumidor escucha sus eventos, ejecuta las
  herramientas (con confirmación cuando corresponde), guarda todo y lo reparte en vivo al navegador.
- `memoria.py`: la memoria de cada usuario (memory store). `consumo.py`: costos y topes.
- `conocimiento.py` y `conocimiento_api.py`: la base de conocimiento (documentos del superadmin, búsqueda y citas).
- `api.py` (usuarios) y `admin_api.py` (consola del superadmin).
- `simulador.py`: un motor que imita a Managed Agents para pruebas y demostraciones (sin clave).
"""
from __future__ import annotations

from typing import Any

from ..core.database import session_scope
from . import admin_api, api, config, conocimiento_api, consumidor, publicacion
from .migraciones import MIGRACIONES

ROUTERS = [api.router, admin_api.router, conocimiento_api.router, conocimiento_api.admin_router]
WORKERS: dict[str, Any] = {}
MIGRACIONES_DATOS = list(MIGRACIONES)


async def publicar_al_arrancar() -> Any:
    """Si hay clave y la definición del repositorio cambió, publica la versión nueva del agente."""
    if not config.clave_configurada():
        return "sin clave de Anthropic: Voi queda visible pero sin conectar"
    async with session_scope() as db:
        if not publicacion.desactualizado(await config.recursos(db)):
            return "al día"
        return (await publicacion.publicar(db, por="sistema"))["cambios"]


async def reanudar() -> Any:
    return {"conversaciones": await consumidor.reanudar_pendientes()}


AL_ARRANCAR = {"asistente_publicar": publicar_al_arrancar, "asistente_reanudar": reanudar}
