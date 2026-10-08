"""Catálogo de OPERATIVAS (módulos independientes) y sus UTILIDADES.

Cada operativa declara sus utilidades. Cada utilidad es un permiso con la forma
`<slug_operativa>.<utilidad>`, por ejemplo `televentas_claro.ventas_netas`.

- La utilidad `ver` es el acceso a la operativa: sin ella, las demás no aplican.
- Una utilidad con `solo_perfiles: [...]` es RESTRINGIDA: además del superadmin,
  solo la pueden tener los perfiles listados (ni la matriz ni la API dejan
  asignarla a otro, y aunque figure en la base no se hace efectiva). Con la lista
  vacía es exclusiva del superadmin.
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
        "description": "Operativa de televentas para Claro: ventas netas, productividad de llamadas, SPH estimado, auditoría, facturación e indicadores.",
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
                "key": "productividad",
                "name": "Productividad · Ver informes",
                "description": "Ver los informes diarios publicados de productividad de llamadas (meta de conversación, contacto por horario, discador, turnos y jornada) y sus acumulados semanal y mensual.",
            },
            {
                "key": "productividad_gestion",
                "name": "Productividad · Gestión",
                "description": "Subir los cortes del reporte de tiempos de la plataforma, ver borradores, publicar (uno por día), reemplazar, recalcular y eliminar.",
            },
            {
                "key": "sph",
                "name": "SPH · Ver informes",
                "description": "Ver los informes publicados de SPH estimado (ventas netas por hora conectada) por día, semana, mes o rango: el de la operación y el de cada asesor, con qué tan seguro es el cruce de nombres.",
            },
            {
                "key": "sph_gestion",
                "name": "SPH · Gestión",
                "description": "Calcular el SPH de un día, una semana, un mes o un rango cruzando Productividad con Ventas Netas, vincular agentes con vendedores a mano, publicar (uno por período), reemplazar, recalcular y eliminar.",
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
                "solo_perfiles": ["sub_gerente"],
            },
        ],
    },
]


OPERATIVA_SLUGS: set[str] = {o["slug"] for o in OPERATIVAS}

ALL_PERMISSIONS: set[str] = {
    f"{o['slug']}.{u['key']}" for o in OPERATIVAS for u in o["utilidades"]
}


# Utilidades restringidas: permiso → perfiles que la pueden tener (vacío = solo el superadmin).
RESTRINGIDAS: dict[str, frozenset[str]] = {
    f"{o['slug']}.{u['key']}": frozenset(u["solo_perfiles"])
    for o in OPERATIVAS for u in o["utilidades"] if "solo_perfiles" in u
}

# Permisos exclusivos del superadmin (restringidos sin ningún perfil habilitado).
SUPERADMIN_ONLY_PERMISSIONS: set[str] = {p for p, perfiles in RESTRINGIDAS.items() if not perfiles}

# Permisos sin restricción: los puede tener cualquier perfil.
ASSIGNABLE_PERMISSIONS: set[str] = ALL_PERMISSIONS - set(RESTRINGIDAS)


def asignables(perfil: str | None) -> set[str]:
    """Permisos que se le pueden dar a ese perfil: los sin restricción y los restringidos que lo incluyen."""
    return ASSIGNABLE_PERMISSIONS | {p for p, perfiles in RESTRINGIDAS.items() if perfil in perfiles}


def utilidad_visible(slug_operativa: str, utilidad: dict, role: str) -> bool:
    """Una utilidad restringida solo se le muestra al superadmin y a los perfiles habilitados."""
    perm = f"{slug_operativa}.{utilidad['key']}"
    return role == "superadmin" or perm not in RESTRINGIDAS or role in RESTRINGIDAS[perm]


def get_operativa(slug: str) -> dict | None:
    return next((o for o in OPERATIVAS if o["slug"] == slug), None)


def filter_operativas(slugs: list[str] | None) -> list[str]:
    """Solo slugs de operativas válidas, sin duplicados, en orden de catálogo."""
    wanted = set(slugs or [])
    return [o["slug"] for o in OPERATIVAS if o["slug"] in wanted]


def filter_permissions(perms: list[str] | None, perfil: str | None = None) -> list[str]:
    """Solo los permisos que existen y se le pueden dar a ese perfil (sin perfil: los sin restricción)."""
    return sorted(set(perms or []) & asignables(perfil))
