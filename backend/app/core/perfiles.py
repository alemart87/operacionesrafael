"""Perfiles de usuario (fijos) y sus permisos iniciales.

Los perfiles son fijos. Sus PERMISOS viven en la tabla `profiles` y los edita el
superadmin desde /admin/perfiles. `DEFAULT_PERMISSIONS` solo se usa para
sembrar la tabla la primera vez que arranca el sistema (o cuando se agrega un
perfil nuevo); nunca pisa lo que el superadmin ya configuró.
"""
from __future__ import annotations


PERFILES: list[dict] = [
    {"slug": "coordinador", "name": "Coordinador", "description": "Coordina la operativa. Acceso amplio."},
    {"slug": "supervisor", "name": "Supervisor", "description": "Supervisa equipos y sigue indicadores."},
    {"slug": "analista", "name": "Analista", "description": "Carga datos y prepara reportes."},
    {"slug": "cliente", "name": "Cliente", "description": "Consulta la información publicada."},
]

PERFIL_SLUGS: set[str] = {p["slug"] for p in PERFILES}
PERFIL_PATTERN = "^(" + "|".join(p["slug"] for p in PERFILES) + ")$"

_TC = "televentas_claro"

DEFAULT_PERMISSIONS: dict[str, list[str]] = {
    "coordinador": [f"{_TC}.{u}" for u in ("ver", "ventas_netas")],
    "supervisor": [f"{_TC}.{u}" for u in ("ver", "ventas_netas")],
    "analista": [f"{_TC}.{u}" for u in ("ver", "ventas_netas", "ventas_netas_gestion")],
    "cliente": [f"{_TC}.{u}" for u in ("ver",)],
}


def perfil_name(slug: str) -> str:
    if slug == "superadmin":
        return "Superadmin"
    return next((p["name"] for p in PERFILES if p["slug"] == slug), slug)
