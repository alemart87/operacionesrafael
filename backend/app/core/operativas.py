"""Catálogo de OPERATIVAS (módulos independientes) y sus UTILIDADES.

Cada operativa declara sus utilidades. Cada utilidad es un permiso con la forma
`<slug_operativa>.<utilidad>`, por ejemplo `televentas_claro.ventas_netas`.

- La utilidad `ver` es el acceso a la operativa: sin ella, las demás no aplican.
- Una utilidad con `solo_perfiles: [...]` es RESTRINGIDA: además del superadmin,
  solo la pueden tener los perfiles listados (ni la matriz ni la API dejan
  asignarla a otro, y aunque figure en la base no se hace efectiva). Con la lista
  vacía es exclusiva del superadmin.
- Los perfiles de `PERFILES_SOLO_PORTAL` (el Supervisor) solo entran a su portal:
  únicamente pueden tener las utilidades marcadas `portal: True`.
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
        "description": "Operativa de televentas para Claro: ventas netas, productividad de llamadas, SPH estimado, supervisión de equipos, auditoría, facturación e indicadores.",
        "color": "#E6332A",
        "available": True,
        "utilidades": [
            {"key": "ver", "name": "Acceso a la operativa", "description": "Ver la operativa en el hub y entrar a ella.", "portal": True},
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
                "key": "productividad_pbi",
                "name": "Productividad · Cargar PBI",
                "description": "Cargar el tablero de Power BI del día (el código «Publicar en la web»), guardarlo o publicarlo y eliminarlo. Publicado, lo ven los supervisores en su portal («Tablero») y quienes ven Productividad. Uno por día; se muestra el del día más nuevo.",
                "solo_perfiles": ["gerente", "sub_gerente", "coordinador"],
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
                "key": "supervision",
                "name": "Supervisión · Ver tablero",
                "description": "Ver el centro de comandos (semáforo de supervisores y alertas del día), los equipos de cada mes, los objetivos de cada supervisor con su avance y su proyección al cierre, el scoring, los asesores en alerta por líneas sin uso, el detalle y la línea de tiempo de cada supervisor y la ficha de cada asesor.",
            },
            {
                "key": "supervision_gestion",
                "name": "Supervisión · Gestión",
                "description": "Armar los equipos del mes (asesores por supervisor, con fecha efectiva), cargar los objetivos de Pospago y GPON de cada supervisor y los días no laborables del calendario, y actuar sobre las alertas del centro de comandos (tomarlas o descartarlas; con Tickets de revisión, también pedir una revisión).",
            },
            {
                "key": "tickets",
                "name": "Supervisión · Tickets de revisión",
                "description": "Enviar casos a revisión a los supervisores (venta observada, línea sin uso, calidad de atención, reclamo, conducta u otro) y seguirlos: comentar, reabrir, reasignar y cancelar. Los plazos se miden en horas hábiles.",
            },
            {
                "key": "control_supervisores",
                "name": "Supervisión · Control de supervisores",
                "description": "Control rápido de lo que hacen los supervisores: coachings registrados, firmados y sin firmar, monitoreos y feedback, compromisos, audios y minutos grabados, seguimientos, notas y tickets, por supervisor y en la actividad del día; escuchar los audios y ver las firmas; validar las altas de asesores y los pedidos de pase.",
                "solo_perfiles": ["gerente", "sub_gerente", "coordinador", "controller"],
            },
            {
                "key": "analisis_coaching",
                "name": "Supervisión · Analizador de coaching",
                "description": "Análisis semántico de los coachings firmados: estadísticas, tiempo estimado, evaluación de cada supervisor, mapa de palabras del feedback y de los compromisos, e informes escritos por Claude (Haiku) con los textos y las transcripciones, sin nombres.",
                "solo_perfiles": ["gerente", "sub_gerente", "coordinador"],
            },
            {
                "key": "clima_equipo",
                "name": "Supervisión · Clima del equipo",
                "description": "La moral del equipo de un vistazo: el ánimo y el compromiso de cada supervisor y de su equipo (los asesores, siempre agregados), cómo fluctuó el día (feedback, termómetro y cierre), el mapa de moral, la tendencia y las alertas que llaman la atención, con su evidencia. Se mide con reglas al instante y de noche con Claude (Haiku), sin nombres.",
                "solo_perfiles": ["gerente", "sub_gerente", "coordinador"],
            },
            {
                "key": "supervision_parametros",
                "name": "Supervisión · Parámetros del modelo",
                "description": "Pesos y umbrales del scoring de asesores, supervisores y operación (cada cambio es una versión nueva y queda en el historial).",
                "solo_perfiles": ["sub_gerente"],
            },
            {
                "key": "operadores",
                "name": "Operadores · Vincular",
                "description": "Mantener el maestro de operadores: vincular el nombre de llamadas con el vendedor de Ventas Netas, separar, confirmar sin vínculo, renombrar y dar de baja. Lo usan Supervisión y el SPH.",
            },
            {
                "key": "portal_supervisor",
                "name": "Portal del supervisor",
                "description": "El portal del supervisor: su equipo, sus objetivos, su avance y proyección al cierre y sus asesores en alerta. Es lo único que ve el perfil Supervisor.",
                "solo_perfiles": ["supervisor"],
                "portal": True,
            },
            {
                "key": "logistica",
                "name": "Logística · Ver informes",
                "description": "Ver los informes publicados de logística de entregas: pedidos por estado (entregado, en gestión, devuelto) y región, motivos, línea de tiempo por estado, pendientes y demora por zona, vendedores y el detalle completo con filtro por estado.",
            },
            {
                "key": "logistica_gestion",
                "name": "Logística · Gestión",
                "description": "Subir el corte de pedidos de logística (.xlsx), ver borradores, publicar (uno por mes), reemplazar, recalcular y eliminar.",
            },
            {
                "key": "informe_diario",
                "name": "Informe diario",
                "description": "Preparar el informe diario de la operación: resultados del día (Pospago, GPON y otros), datos importados de la plataforma (llamadas, ventas del día, proyección y coaching), resumen, métricas críticas con indicador, comentario y compromiso, seguimiento de los compromisos anteriores y firma; se guarda con fecha y se descarga en PDF para enviar. El superadmin sigue los informes de todos, sus palabras clave, y los comenta.",
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
            {
                "key": "integraciones",
                "name": "Integraciones (API para KNIME y otras herramientas)",
                "description": "Claves de API de solo lectura para conectar herramientas de análisis (KNIME, Power BI, Python) a los datos ya publicados de la operativa: productividad, ventas netas, SPH e informes diarios firmados. Cada clave tiene vencimiento y límites de uso; todo uso queda registrado. Nunca incluye Facturación. El superadmin ve, bloquea y elimina todas las claves.",
                "solo_perfiles": ["sub_gerente"],
            },
            {
                "key": "asistente",
                "name": "Asistente IA (Voi)",
                "description": "Voi, el agente de la plataforma: consulta y explica los datos de los módulos que el usuario ya ve, prepara borradores y propone acciones que el usuario confirma, con memoria y conversaciones guardadas. Nunca ve más que el usuario. El superadmin sigue el consumo y las conversaciones.",
            },
        ],
    },
    {
        "slug": "capacitacion",
        "name": "Capacitación y Mentoría",
        "description": "Grupos de capacitación con el modelo Capacitación ÁGIL (sala a la mañana, mentoría en piso a la tarde): postulantes, estados, test IPV online con corrección automática, ficha del postulante, seguimiento con dictado, efectividad de cada grupo y estadísticas por sexo y edad.",
        "color": "#662483",
        "available": True,
        "utilidades": [
            {"key": "ver", "name": "Acceso al módulo", "description": "Ver Capacitación y Mentoría en el hub y entrar."},
            {
                "key": "capacitar",
                "name": "Capacitación · Grupos y postulantes",
                "description": "Crear grupos de capacitación y cambiar su estado (en curso, finalizada, cancelada); cargar postulantes y sus estados de capacitación (en capacitación, abandonó, dado de baja, aprobó la prueba escrita); generar el link del test IPV y cargar las otras pruebas; comentarios de seguimiento con dictado.",
            },
            {
                "key": "mentoria",
                "name": "Mentoría · Seguimiento en piso",
                "description": "Ver y acompañar a los postulantes de los grupos donde es mentor: comentarios de seguimiento con dictado y los estados finales (aprobó mentoría y OJT, alta operativa).",
            },
            {
                "key": "total",
                "name": "Capacitación · Vista completa",
                "description": "Todos los grupos de todos los capacitadores y mentores, con permiso para actuar en cualquiera, y las estadísticas generales (efectividad, IPV, sexo y edad).",
                "solo_perfiles": ["gerente", "sub_gerente", "rrhh"],
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

# Perfiles que solo entran a su portal (el Supervisor): únicamente las utilidades marcadas `portal`.
PERFILES_SOLO_PORTAL: frozenset[str] = frozenset({"supervisor"})
PORTAL_PERMISSIONS: set[str] = {
    f"{o['slug']}.{u['key']}" for o in OPERATIVAS for u in o["utilidades"] if u.get("portal")
}


# Perfiles de un solo módulo (Capacitador, Mentor, Gerencia de RRHH): únicamente las utilidades de esa operativa, y al
# crearlos o cambiarles el perfil quedan asignados solo a ella.
PERFILES_SOLO_MODULO: dict[str, str] = {"capacitador": "capacitacion", "mentor": "capacitacion", "rrhh": "capacitacion"}


def asignables(perfil: str | None) -> set[str]:
    """Permisos que se le pueden dar a ese perfil: los sin restricción y los restringidos que lo incluyen.
    Un perfil de solo portal, únicamente las utilidades del portal; uno de un solo módulo, solo las de ese módulo."""
    if perfil in PERFILES_SOLO_MODULO:
        pre = PERFILES_SOLO_MODULO[perfil] + "."
        return {p for p in ALL_PERMISSIONS if p.startswith(pre) and (p not in RESTRINGIDAS or perfil in RESTRINGIDAS[p])}
    if perfil in PERFILES_SOLO_PORTAL:
        return {p for p in PORTAL_PERMISSIONS if p not in RESTRINGIDAS or perfil in RESTRINGIDAS[p]}
    return ASSIGNABLE_PERMISSIONS | {p for p, perfiles in RESTRINGIDAS.items() if perfil in perfiles}


def utilidad_visible(slug_operativa: str, utilidad: dict, role: str) -> bool:
    """Una utilidad que el perfil no puede tener (restringida o fuera de su portal) no se le muestra."""
    return role == "superadmin" or f"{slug_operativa}.{utilidad['key']}" in asignables(role)


def get_operativa(slug: str) -> dict | None:
    return next((o for o in OPERATIVAS if o["slug"] == slug), None)


def operativas_de_perfil(perfil: str | None, slugs: list[str] | None) -> list[str]:
    """Las operativas de un usuario según su perfil: los de un solo módulo, solo esa; el resto, las elegidas."""
    if perfil in PERFILES_SOLO_MODULO:
        return [PERFILES_SOLO_MODULO[perfil]]
    return filter_operativas(slugs)


def filter_operativas(slugs: list[str] | None) -> list[str]:
    """Solo slugs de operativas válidas, sin duplicados, en orden de catálogo."""
    wanted = set(slugs or [])
    return [o["slug"] for o in OPERATIVAS if o["slug"] in wanted]


def filter_permissions(perms: list[str] | None, perfil: str | None = None) -> list[str]:
    """Solo los permisos que existen y se le pueden dar a ese perfil (sin perfil: los sin restricción)."""
    return sorted(set(perms or []) & asignables(perfil))
