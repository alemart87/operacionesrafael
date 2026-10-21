"""Perfiles de usuario (fijos) y sus permisos iniciales.

Los perfiles son fijos. Sus PERMISOS viven en la tabla `profiles` y los edita el
superadmin desde /admin/perfiles. `DEFAULT_PERMISSIONS` solo se usa para
sembrar la tabla la primera vez que arranca el sistema (o cuando se agrega un
perfil nuevo); nunca pisa lo que el superadmin ya configuró.
"""
from __future__ import annotations

from .operativas import OPERATIVAS, asignables


PERFILES: list[dict] = [
    {"slug": "gerente", "name": "Gerente", "description": "Dirige la gerencia: todos los módulos menos Facturación e Integraciones, con el control de lo que hacen los supervisores."},
    {"slug": "sub_gerente", "name": "Sub gerente", "description": "Conduce la operación: todos los módulos, incluida Facturación."},
    {"slug": "controller", "name": "Controller", "description": "Controla la operación: todos los módulos menos Facturación (el informe diario y el asistente se le pueden asignar). Puede tener varias operativas."},
    {"slug": "coordinador", "name": "Coordinador", "description": "Coordina la operativa. Acceso amplio."},
    {"slug": "supervisor", "name": "Supervisor", "description": "Líder coach de su equipo: entra solo a su portal (equipo, objetivos, proyección y alertas)."},
    {"slug": "analista", "name": "Analista", "description": "Carga datos y prepara reportes."},
    {"slug": "auditor", "name": "Auditor", "description": "Revisa ventas y casos, envía tickets de revisión y sigue el tablero de supervisión."},
    {"slug": "cliente", "name": "Cliente", "description": "Consulta la información publicada."},
    {"slug": "capacitador", "name": "Capacitador", "description": "Capacitación y Mentoría: crea sus grupos y postulantes, actualiza los estados de capacitación, toma el IPV y hace el seguimiento. Solo ve este módulo."},
    {"slug": "mentor", "name": "Mentor", "description": "Capacitación y Mentoría: acompaña en piso a los postulantes de sus grupos y carga los estados finales (mentoría y OJT, alta operativa). Solo ve este módulo."},
    {"slug": "rrhh", "name": "Gerencia de RRHH", "description": "Capacitación y Mentoría con acceso completo: todos los grupos, fichas y estadísticas. Solo ve este módulo."},
]

PERFIL_SLUGS: set[str] = {p["slug"] for p in PERFILES}
PERFIL_PATTERN = "^(" + "|".join(p["slug"] for p in PERFILES) + ")$"

_TC = "televentas_claro"
# Todas las utilidades de Televentas CLARO, en el orden del catálogo.
_TODAS_TC = [u["key"] for o in OPERATIVAS if o["slug"] == _TC for u in o["utilidades"]]
_CAP = "capacitacion"
_TODAS_CAP = [f"{_CAP}.{u['key']}" for o in OPERATIVAS if o["slug"] == _CAP for u in o["utilidades"]]

DEFAULT_PERMISSIONS: dict[str, list[str]] = {
    # El gerente arranca con todo lo que su perfil puede tener: nunca las restringidas a otros perfiles (Facturación,
    # Integraciones, el portal del supervisor).
    "gerente": [f"{_TC}.{u}" for u in _TODAS_TC if f"{_TC}.{u}" in asignables("gerente")] + _TODAS_CAP,
    "sub_gerente": [f"{_TC}.{u}" for u in _TODAS_TC] + _TODAS_CAP,
    # El informe diario lo preparan el coordinador y el sub gerente (y el superadmin); el controller no, salvo que se le asigne.
    # El asistente (Voi) arranca con sub gerente, coordinador y auditor; al resto se le puede asignar.
    "controller": [f"{_TC}.{u}" for u in _TODAS_TC if u not in ("facturacion", "informe_diario", "asistente", "integraciones")],
    "coordinador": [f"{_TC}.{u}" for u in ("ver", "ventas_netas", "productividad", "productividad_pbi", "sph", "supervision",
                                            "supervision_gestion", "tickets", "control_supervisores", "analisis_coaching", "clima_equipo", "operadores",
                                            "informe_diario", "asistente", "logistica")],
    # El supervisor solo entra a su portal (ver core/operativas.PERFILES_SOLO_PORTAL).
    "supervisor": [f"{_TC}.{u}" for u in ("ver", "portal_supervisor")],
    "analista": [f"{_TC}.{u}" for u in ("ver", "ventas_netas", "ventas_netas_gestion", "auditoria",
                                         "productividad", "productividad_gestion", "sph", "sph_gestion",
                                         "supervision", "operadores", "logistica", "logistica_gestion")],
    # El auditor ve todos los módulos para elegir qué auditar; nunca Facturación ni Integraciones (ni los exclusivos de
    # otro perfil: parámetros de supervisión y el portal del supervisor). La gestión no es suya: ni subir o publicar
    # (`*_gestion`) ni mantener el maestro de operadores (vincular, renombrar, dar de baja); los operadores los ve
    # igual, con Supervisión.
    "auditor": [f"{_TC}.{u}" for u in _TODAS_TC if u not in ("facturacion", "integraciones", "supervision_parametros",
                                                               "portal_supervisor", "operadores") and not u.endswith("_gestion")],
    "cliente": [f"{_TC}.{u}" for u in ("ver",)],
    # Capacitación y Mentoría (perfiles de un solo módulo, ver core/operativas.PERFILES_SOLO_MODULO).
    "capacitador": [f"{_CAP}.{u}" for u in ("ver", "capacitar")],
    "mentor": [f"{_CAP}.{u}" for u in ("ver", "mentoria")],
    "rrhh": _TODAS_CAP,
}


def perfil_name(slug: str) -> str:
    if slug == "superadmin":
        return "Superadmin"
    return next((p["name"] for p in PERFILES if p["slug"] == slug), slug)
