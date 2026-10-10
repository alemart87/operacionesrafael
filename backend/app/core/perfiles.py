"""Perfiles de usuario (fijos) y sus permisos iniciales.

Los perfiles son fijos. Sus PERMISOS viven en la tabla `profiles` y los edita el
superadmin desde /admin/perfiles. `DEFAULT_PERMISSIONS` solo se usa para
sembrar la tabla la primera vez que arranca el sistema (o cuando se agrega un
perfil nuevo); nunca pisa lo que el superadmin ya configuró.
"""
from __future__ import annotations

from .operativas import OPERATIVAS


PERFILES: list[dict] = [
    {"slug": "sub_gerente", "name": "Sub gerente", "description": "Conduce la operación: todos los módulos, incluida Facturación."},
    {"slug": "controller", "name": "Controller", "description": "Controla la operación: todos los módulos menos Facturación (el informe diario se le puede asignar). Puede tener varias operativas."},
    {"slug": "coordinador", "name": "Coordinador", "description": "Coordina la operativa. Acceso amplio."},
    {"slug": "supervisor", "name": "Supervisor", "description": "Líder coach de su equipo: entra solo a su portal (equipo, objetivos, proyección y alertas)."},
    {"slug": "analista", "name": "Analista", "description": "Carga datos y prepara reportes."},
    {"slug": "auditor", "name": "Auditor", "description": "Revisa ventas y casos, envía tickets de revisión y sigue el tablero de supervisión."},
    {"slug": "cliente", "name": "Cliente", "description": "Consulta la información publicada."},
]

PERFIL_SLUGS: set[str] = {p["slug"] for p in PERFILES}
PERFIL_PATTERN = "^(" + "|".join(p["slug"] for p in PERFILES) + ")$"

_TC = "televentas_claro"
# Todas las utilidades de Televentas CLARO, en el orden del catálogo.
_TODAS_TC = [u["key"] for o in OPERATIVAS if o["slug"] == _TC for u in o["utilidades"]]

DEFAULT_PERMISSIONS: dict[str, list[str]] = {
    "sub_gerente": [f"{_TC}.{u}" for u in _TODAS_TC],
    # El informe diario lo preparan el coordinador y el sub gerente (y el superadmin); el controller no, salvo que se le asigne.
    "controller": [f"{_TC}.{u}" for u in _TODAS_TC if u not in ("facturacion", "informe_diario")],
    "coordinador": [f"{_TC}.{u}" for u in ("ver", "ventas_netas", "productividad", "sph",
                                            "supervision", "supervision_gestion", "tickets", "operadores", "informe_diario")],
    # El supervisor solo entra a su portal (ver core/operativas.PERFILES_SOLO_PORTAL).
    "supervisor": [f"{_TC}.{u}" for u in ("ver", "portal_supervisor")],
    "analista": [f"{_TC}.{u}" for u in ("ver", "ventas_netas", "ventas_netas_gestion", "auditoria",
                                         "productividad", "productividad_gestion", "sph", "sph_gestion",
                                         "supervision", "operadores")],
    "auditor": [f"{_TC}.{u}" for u in ("ver", "ventas_netas", "auditoria", "supervision", "tickets")],
    "cliente": [f"{_TC}.{u}" for u in ("ver",)],
}


def perfil_name(slug: str) -> str:
    if slug == "superadmin":
        return "Superadmin"
    return next((p["name"] for p in PERFILES if p["slug"] == slug), slug)
