"""Catálogo de OPERATIVAS (módulos independientes) y sus UTILIDADES.

Cada operativa declara sus utilidades. Cada utilidad es un permiso con la forma
`<slug_operativa>.<utilidad>`, por ejemplo `televentas_claro.ventas_netas`.

- La utilidad `ver` es el acceso a la operativa: sin ella, las demás no aplican.
- Una utilidad con `solo_superadmin: True` es exclusiva del superadmin: no se
  puede asignar a ningún perfil (ni desde la matriz ni por API). Para delegarla
  más adelante alcanza con quitar esa marca.
- El superadmin asigna utilidades a cada perfil en /admin/perfiles.
- A cada usuario se le asignan las operativas en las que trabaja.

Para agregar una operativa: sumarla acá con sus utilidades, crear su paquete en
`app/operativas/<slug>/` (routers protegidos con `require_perm`) y sus páginas
en el frontend (`src/app/<ruta>/`), y registrar la ruta en `src/lib/operativas.ts`.
Para agregar una utilidad a una operativa existente: sumarla a su lista.
Aparece sola en la matriz de perfiles, desmarcada para todos los perfiles.
"""
from __future__ import annotations


UTILIDAD_VER = "ver"

OPERATIVAS: list[dict] = [
    {
        "slug": "televentas_claro",
        "name": "Televentas CLARO",
        "description": "Operativa de televentas para Claro: ventas netas, facturación e indicadores.",
        "color": "#E6332A",
        "available": True,
        "utilidades": [
            {"key": "ver", "name": "Acceso a la operativa", "description": "Ver la operativa en el hub y entrar a ella."},
            {
                "key": "ventas_netas",
                "name": "Ventas Netas · Ver informes",
                "description": "Ver los informes publicados de ventas netas del mes (visión negocio y operativa) y descargarlos.",
            },
            {
                "key": "ventas_netas_gestion",
                "name": "Ventas Netas · Gestión",
                "description": "Subir los cortes diarios de Claro, ver borradores, publicar (una publicación por mes), reemplazar y eliminar.",
            },
            {
                "key": "auditoria",
                "name": "Auditoría de ventas",
                "description": "Circuito de auditoría: riesgos y ranking de vendedores, informes de auditoría con hallazgos, seguimiento, estados y PDF. Los datos analizados quedan congelados en cada informe.",
            },
            {
                "key": "facturacion",
                "name": "Facturación",
                "description": "Liquidaciones de comisiones de Claro: reportes, comparativos, simuladores (móvil y GPON), criterios y agente IA.",
                "solo_superadmin": True,
            },
        ],
    },
]


OPERATIVA_SLUGS: set[str] = {o["slug"] for o in OPERATIVAS}

ALL_PERMISSIONS: set[str] = {
    f"{o['slug']}.{u['key']}" for o in OPERATIVAS for u in o["utilidades"]
}


# Permisos exclusivos del superadmin (no asignables a perfiles).
SUPERADMIN_ONLY_PERMISSIONS: set[str] = {
    f"{o['slug']}.{u['key']}" for o in OPERATIVAS for u in o["utilidades"] if u.get("solo_superadmin")
}

# Permisos que el superadmin puede asignar a los perfiles.
ASSIGNABLE_PERMISSIONS: set[str] = ALL_PERMISSIONS - SUPERADMIN_ONLY_PERMISSIONS


def get_operativa(slug: str) -> dict | None:
    return next((o for o in OPERATIVAS if o["slug"] == slug), None)


def filter_operativas(slugs: list[str] | None) -> list[str]:
    """Solo slugs de operativas válidas, sin duplicados, en orden de catálogo."""
    wanted = set(slugs or [])
    return [o["slug"] for o in OPERATIVAS if o["slug"] in wanted]


def filter_permissions(perms: list[str] | None) -> list[str]:
    """Solo permisos asignables a perfiles (existen y no son exclusivos del superadmin)."""
    return sorted(set(perms or []) & ASSIGNABLE_PERMISSIONS)
