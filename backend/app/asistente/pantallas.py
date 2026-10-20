"""Catálogo de pantallas y guías de la plataforma para Voi: qué hay, dónde está, quién la ve y cómo se hacen las
tareas comunes.

Es la fuente única que usan las herramientas de guía (`herramientas/guia.py`: abrir una pantalla, guiar paso a paso y
ofrecer opciones), el contexto de cada mensaje (qué es la pantalla que el usuario está viendo) y la burbuja de Voi en la
cabecera (la pista de cada pantalla). Todo se filtra por los permisos reales del usuario: Voi nunca lleva a nadie a una
pantalla que no puede ver, y cuando no puede, dice qué utilidad le falta.

Las guías describen las pantallas tal como son: cada paso puede señalar un ancla (`data-voi="…"` en el frontend) que
la plataforma resalta mientras el usuario sigue la guía.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Optional

from ..api.deps import CurrentUser
from ..core.operativas import OPERATIVAS

TC = "televentas_claro"


def _p(*utilidades: str) -> tuple[str, ...]:
    return tuple(f"{TC}.{u}" for u in utilidades)


@dataclass(frozen=True)
class Paso:
    texto: str
    ancla: Optional[str] = None          # elemento de la pantalla que se resalta (data-voi)


@dataclass(frozen=True)
class Pista:
    """Lo que la burbuja «AI VOI» sugiere en esa pantalla: el texto, el botón y lo que manda al tocarlo."""
    texto: str
    boton: str
    mensaje: str


@dataclass(frozen=True)
class Pantalla:
    ruta: str
    titulo: str
    modulo: str
    que_hace: str
    permisos: tuple[str, ...] = ()       # alcanza con uno; vacío = cualquiera con sesión
    solo_superadmin: bool = False
    claves: tuple[str, ...] = ()         # palabras con las que la gente la nombra (sin tildes, en minúsculas)
    anclas: tuple[str, ...] = ()         # elementos que se pueden resaltar
    pista: Optional[Pista] = None
    sugerencias: tuple[str, ...] = ()    # chips de bienvenida de Voi en esa pantalla
    confidencial: bool = False


@dataclass(frozen=True)
class Guia:
    clave: str
    titulo: str
    ruta: str                            # la pantalla donde se hace
    pasos: tuple[Paso, ...]
    claves: tuple[str, ...] = ()
    permisos: tuple[str, ...] = ()
    solo_superadmin: bool = False
    nota: Optional[str] = None
    voi: Optional[str] = None            # qué puede hacer Voi por su cuenta en esta tarea


# ------------------------------------------------------------------ pantallas
_VN, _PROD, _SPH, _SUP, _ID, _AUD, _FACT, _PORTAL = ("Ventas Netas", "Productividad", "SPH estimado", "Supervisión",
                                                      "Informe diario", "Auditoría de ventas", "Facturación", "Mi portal")

PANTALLAS: tuple[Pantalla, ...] = (
    Pantalla("/inicio", "Inicio", "Plataforma", "El hub de operativas: desde acá se entra a cada operativa.",
             claves=("inicio", "hub", "home", "principal"),
             pista=Pista("Hola, soy Voi. Puedo abrir pantallas, guiarte paso a paso y preparar cosas por vos.",
                         "¿Qué podés hacer?", "¿Qué puedo hacer con Voi?"),
             sugerencias=("¿Qué puedo hacer con Voi?",)),
    Pantalla("/televentas-claro", "Televentas CLARO · Inicio", "Televentas CLARO",
             "Los módulos de la operativa y el acceso a preparar el informe diario.", permisos=_p("ver"),
             claves=("televentas", "claro", "operativa", "modulos"),
             pista=Pista("Decime qué necesitás hacer y te llevo a la pantalla o lo hago por vos.",
                         "Ver opciones", "¿Qué puedo hacer con Voi?")),
    Pantalla("/televentas-claro/ventas-netas", f"{_VN} · Informes", _VN,
             "Los informes del mes a partir del corte diario de Claro: netas, cargas, líneas sin uso, vendedores críticos "
             "y la planilla; quien gestiona publica, reemplaza o elimina desde la lista.",
             permisos=_p("ventas_netas"), claves=("ventas netas", "netas", "cargas", "corte de claro", "informes de ventas",
                                                  "lineas sin uso", "vendedores criticos", "publicar ventas"),
             anclas=("publicar", "subir"),
             pista=Pista("¿Querés que te resuma el último corte o que te guíe para publicarlo?",
                         "Resumir el corte", "Resumime las ventas netas del mes y quiénes están en alerta"),
             sugerencias=("Resumime las ventas netas del mes y quiénes están en alerta", "¿Cómo publico un corte?")),
    Pantalla("/televentas-claro/logistica", "Logística · Informes", "Logística",
             "Los informes del mes de logística de entregas a partir del corte de pedidos: entregados, en gestión y devueltos por "
             "región, motivos, línea de tiempo por estado, pendientes con su demora por zona y el detalle con filtro por estado; "
             "quien gestiona publica (uno por mes), reemplaza o elimina desde la lista.",
             permisos=_p("logistica"), claves=("logistica", "entregas", "pedidos", "en gestion", "devueltos", "entregados",
                                               "demora", "pendientes de entrega", "motivos de entrega"),
             anclas=("publicar", "subir"),
             pista=Pista("¿Querés que te cuente cómo vienen las entregas del mes y qué pedidos están demorados?",
                         "Ver entregas", "Resumime las entregas del mes: entregados, en gestión, devueltos y los pedidos más demorados"),
             sugerencias=("Resumime las entregas del mes: entregados, en gestión, devueltos y los pedidos más demorados",)),
    Pantalla("/televentas-claro/logistica/upload", "Logística · Subir corte", "Logística",
             "Subir el .xlsx de pedidos de logística (una fila por pedido con estado y motivo): arma el borrador del mes que después se publica.",
             permisos=_p("logistica_gestion"), claves=("subir corte de logistica", "subir pedidos", "cargar pedidos", "subir entregas",
                                                       "xlsx de logistica"),
             anclas=("archivo", "procesar"),
             pista=Pista("¿Te guío para subir el corte de pedidos?", "Sí, guiame", "¿Cómo subo el corte de logística?")),
    Pantalla("/televentas-claro/ventas-netas/upload", f"{_VN} · Subir corte", _VN,
             "Subir el .xlsx de Claro (hojas DDI, CARGAS y PORTABILIDAD): genera un borrador del mes que después se publica.",
             permisos=_p("ventas_netas_gestion"), claves=("subir corte", "subir ventas", "cargar corte", "cargar ventas",
                                                          "subir el corte de claro", "xlsx", "planilla de claro"),
             anclas=("archivo", "procesar"),
             pista=Pista("¿Te guío para subir el corte de Claro? Te marco dónde tocar.", "Sí, guiame",
                         "Guiame para subir el corte de ventas"),
             sugerencias=("Guiame para subir el corte de ventas", "¿Qué pasa después de subir el corte?")),
    Pantalla("/televentas-claro/productividad", f"{_PROD} · Informes diarios", _PROD,
             "Los informes diarios de productividad de llamadas: meta de conversación, contacto por horario, discador y "
             "turnos; quien gestiona publica (uno por día) desde la lista.",
             permisos=_p("productividad"), claves=("productividad", "llamadas", "informe diario de llamadas", "aht",
                                                   "conversacion", "discador"),
             anclas=("publicar", "subir"),
             pista=Pista("¿Te cuento cómo vino la productividad de ayer?", "Sí, contame",
                         "¿Cómo vino la productividad de llamadas ayer?"),
             sugerencias=("¿Cómo vino la productividad de llamadas ayer?",)),
    Pantalla("/televentas-claro/productividad/acumulado", f"{_PROD} · Acumulado", _PROD,
             "La productividad acumulada por semana y por mes.", permisos=_p("productividad"),
             claves=("acumulado", "productividad semanal", "productividad mensual", "acumulado semanal")),
    Pantalla("/televentas-claro/productividad/subir", f"{_PROD} · Subir cortes", _PROD,
             "Subir los cortes del reporte Tiempos Acumulados (.csv) de la plataforma de llamadas: cada corte actualiza el "
             "borrador del día.",
             permisos=_p("productividad_gestion"), claves=("subir cortes", "subir llamadas", "cargar cortes", "tiempos acumulados",
                                                           "csv", "subir productividad", "cargar llamadas"),
             anclas=("archivos", "procesar"),
             pista=Pista("¿Te guío para subir los cortes de llamadas?", "Sí, guiame", "Guiame para subir los cortes de llamadas"),
             sugerencias=("Guiame para subir los cortes de llamadas",)),
    Pantalla("/televentas-claro/sph", f"{_SPH} · Informes", _SPH,
             "Ventas netas por hora conectada: los informes publicados por día, semana, mes o rango y, con gestión, "
             "«Calcular SPH».",
             permisos=_p("sph"), claves=("sph", "ventas por hora", "hora conectada", "calcular sph"),
             anclas=("calcular",),
             pista=Pista("¿Querés ver el SPH del último informe o calcular uno nuevo?", "Ver el SPH", "¿Cómo está el SPH?"),
             sugerencias=("¿Cómo está el SPH?", "¿Cómo calculo el SPH de la semana?")),
    Pantalla("/televentas-claro/sph/vinculos", f"{_SPH} · Vínculos", _SPH,
             "Los vínculos entre el nombre de llamadas y el vendedor de Ventas Netas corregidos a mano.",
             permisos=_p("sph_gestion"), claves=("vinculos", "cruce de nombres", "vincular agente", "nombres sph")),
    Pantalla("/televentas-claro/supervision/comando", f"{_SUP} · Centro de comandos", _SUP,
             "El semáforo de supervisores y las alertas del día: tomarlas, descartarlas o pedir una revisión.",
             permisos=_p("supervision"), claves=("centro de comandos", "comando", "alertas", "semaforo", "alertas del dia"),
             pista=Pista("¿Reviso las alertas críticas de hoy y te digo por dónde empezar?", "Sí, revisalas",
                         "¿Qué alertas críticas hay en el centro de comandos?"),
             sugerencias=("¿Qué alertas críticas hay en el centro de comandos?",)),
    Pantalla("/televentas-claro/supervision", f"{_SUP} · Objetivos y proyección", _SUP,
             "Los objetivos de Pospago y GPON de cada supervisor, lo vendido por su equipo y la proyección al cierre; con "
             "gestión, «Cargar objetivos».",
             permisos=_p("supervision"), claves=("supervision", "objetivos", "proyeccion", "cierre del mes", "cargar objetivos"),
             anclas=("objetivos",),
             pista=Pista("¿Te muestro cómo cierra el mes al ritmo actual?", "Sí, mostrame", "¿Cómo viene la proyección del mes?"),
             sugerencias=("¿Cómo viene la proyección del mes?",)),
    Pantalla("/televentas-claro/supervision/tablero", f"{_SUP} · Tablero", _SUP,
             "El scoring de la operación, de cada supervisor y de cada asesor.", permisos=_p("supervision"),
             claves=("tablero", "scoring", "puntaje", "ranking de supervisores")),
    Pantalla("/televentas-claro/supervision/coaching", f"{_SUP} · Coaching", _SUP,
             "La gestión de coaching de los supervisores: quién hizo coaching, a quién y con qué impacto.",
             permisos=_p("supervision"), claves=("coaching", "devolucion", "coach")),
    Pantalla("/televentas-claro/supervision/coaching/registro", f"{_SUP} · Registro de coaching", _SUP,
             "El registro de coaching por rango de fechas.", permisos=_p("supervision"),
             claves=("registro de coaching", "historial de coaching")),
    Pantalla("/televentas-claro/supervision/tickets", f"{_SUP} · Tickets", _SUP,
             "Los tickets de revisión enviados a los supervisores, con sus plazos; con la utilidad Tickets se envían y se "
             "les da seguimiento.",
             permisos=_p("supervision", "tickets"), claves=("tickets", "ticket de revision", "revision", "casos"),
             anclas=("enviar",),
             pista=Pista("¿Te digo qué tickets están por vencer?", "Sí, decime", "¿Qué tickets de revisión están por vencer?"),
             sugerencias=("¿Qué tickets de revisión están por vencer?", "¿Cómo envío un ticket?")),
    Pantalla("/televentas-claro/supervision/equipos", f"{_SUP} · Equipos del mes", _SUP,
             "Los asesores de cada supervisor en cada mes; con gestión se arman y se copian de un mes a otro.",
             permisos=_p("supervision"), claves=("equipos", "equipo del mes", "armar equipos", "asesores por supervisor"),
             anclas=("asignar",)),
    Pantalla("/televentas-claro/supervision/operadores", f"{_SUP} · Operadores", _SUP,
             "El maestro de operadores: vincular el nombre de llamadas con el vendedor de Ventas Netas.",
             permisos=_p("supervision", "operadores"), claves=("operadores", "vincular", "maestro de operadores", "nombres"),
             anclas=("vincular",)),
    Pantalla("/televentas-claro/supervision/calendario", f"{_SUP} · Calendario", _SUP,
             "Los días no laborables que usan la proyección y los plazos.", permisos=_p("supervision"),
             claves=("calendario", "feriados", "dias no laborables")),
    Pantalla("/televentas-claro/supervision/parametros", f"{_SUP} · Parámetros", _SUP,
             "Los pesos y umbrales del scoring (cada cambio es una versión).", permisos=_p("supervision_parametros"),
             claves=("parametros", "pesos", "umbrales", "scoring")),
    Pantalla("/televentas-claro/informe-diario", f"{_ID} · Mis informes", _ID,
             "Preparar el informe diario (borrador del día), firmarlo y descargar el PDF; también los anteriores y los "
             "compromisos abiertos.",
             permisos=_p("informe_diario"), claves=("informe diario", "mis informes", "informe de hoy", "firmar", "preparar informe"),
             anclas=("preparar",),
             pista=Pista("¿Te preparo el borrador del informe diario de hoy con los datos cargados?", "Sí, preparalo",
                         "Prepará el borrador del informe diario de hoy"),
             sugerencias=("Prepará el borrador del informe diario de hoy", "¿Cómo firmo el informe diario?")),
    Pantalla("/televentas-claro/informe-diario/seguimiento", f"{_ID} · Seguimiento", _ID,
             "El seguimiento de los informes diarios de todos: cumplimiento, compromisos, palabras clave y comentarios.",
             solo_superadmin=True, claves=("seguimiento de informes", "seguimiento del informe diario", "cumplimiento")),
    Pantalla("/televentas-claro/portal", f"{_PORTAL} · Mi equipo", _PORTAL,
             "El portal del supervisor: su equipo, sus objetivos, su proyección y sus asesores en alerta.",
             permisos=_p("portal_supervisor"), claves=("mi portal", "mi equipo", "portal del supervisor")),
    Pantalla("/televentas-claro/portal/coaching", f"{_PORTAL} · Coaching y bitácora", _PORTAL,
             "Registrar un coaching, los seguimientos y la bitácora del supervisor.", permisos=_p("portal_supervisor"),
             claves=("hacer coaching", "mi coaching", "bitacora"), anclas=("coaching",)),
    Pantalla("/televentas-claro/portal/historial", f"{_PORTAL} · Mi historial", _PORTAL,
             "El historial del supervisor.", permisos=_p("portal_supervisor"), claves=("mi historial",)),
    Pantalla("/televentas-claro/portal/tickets", f"{_PORTAL} · Tickets", _PORTAL,
             "Los tickets que le enviaron al supervisor.", permisos=_p("portal_supervisor"), claves=("mis tickets",)),
    Pantalla("/televentas-claro/auditoria", f"{_AUD} · Informes", _AUD,
             "Los informes de auditoría con sus hallazgos, evidencia, seguimiento y estados; cada uno se abre en "
             "/televentas-claro/auditoria/informes/<id>.",
             permisos=_p("auditoria"), claves=("auditoria", "auditorias", "informes de auditoria", "hallazgos", "evidencia"),
             anclas=("nuevo", "subir", "capturar"),
             pista=Pista("¿Investigamos el último corte en modo auditor? Busco lo que no cierra.", "Sí, investiguemos",
                         "Hacé un barrido de alertas del último corte y decime qué no cierra"),
             sugerencias=("Hacé un barrido de alertas del último corte y decime qué no cierra", "¿Cómo subo evidencia a un informe?")),
    Pantalla("/televentas-claro/auditoria/riesgos", f"{_AUD} · Riesgos", _AUD,
             "Los riesgos y datos llamativos de los cortes de Ventas Netas; desde acá se crea un informe de auditoría.",
             permisos=_p("auditoria"), claves=("riesgos", "ranking de vendedores", "datos llamativos", "crear informe de auditoria",
                                               "nuevo informe de auditoria"),
             anclas=("crear",)),
    Pantalla("/televentas-claro/auditoria/guia", f"{_AUD} · Guía del auditor", _AUD,
             "La guía del circuito de auditoría.", permisos=_p("auditoria"), claves=("guia del auditor", "circuito de auditoria")),
    Pantalla("/televentas-claro/facturacion", f"{_FACT} · Liquidaciones", _FACT,
             "Las liquidaciones de comisiones de Claro cargadas.", permisos=_p("facturacion"), confidencial=True,
             claves=("facturacion", "liquidaciones", "comisiones", "liquidacion")),
    Pantalla("/televentas-claro/facturacion/compare", f"{_FACT} · Comparar", _FACT,
             "Comparar liquidaciones entre meses.", permisos=_p("facturacion"), confidencial=True,
             claves=("comparar liquidaciones", "comparativo")),
    Pantalla("/televentas-claro/facturacion/upload", f"{_FACT} · Subir liquidación", _FACT,
             "Subir el archivo .txt de liquidación de Claro.", permisos=_p("facturacion"), confidencial=True,
             claves=("subir liquidacion", "cargar liquidacion", "txt de claro"), anclas=("archivo", "procesar")),
    Pantalla("/televentas-claro/facturacion/simulador", f"{_FACT} · Simulador", _FACT,
             "Simular la liquidación móvil.", permisos=_p("facturacion"), confidencial=True,
             claves=("simulador", "simular comisiones", "simular facturacion")),
    Pantalla("/televentas-claro/facturacion/simulador-anual", f"{_FACT} · Simulador convergente", _FACT,
             "El simulador convergente: balance a 12 o 18 meses del pospago y el GPON vendidos por la misma estructura, "
             "con el registro del trabajo (simulaciones guardadas, notas, marcas y post-its). Con ?abrir=<id> abre una "
             "simulación guardada.", permisos=_p("facturacion"), confidencial=True,
             claves=("simulador anual", "anual", "simulador convergente", "convergente", "escenario", "simulacion guardada",
                     "registro del trabajo", "balance anual", "zafra", "bono unico")),
    Pantalla("/televentas-claro/facturacion/gpon", f"{_FACT} · Simulador GPON", _FACT,
             "Simular la liquidación de GPON.", permisos=_p("facturacion"), confidencial=True, claves=("simulador gpon",)),
    Pantalla("/televentas-claro/facturacion/criterios", f"{_FACT} · Criterios", _FACT,
             "Los criterios con que se liquida.", permisos=_p("facturacion"), confidencial=True,
             claves=("criterios", "criterios de liquidacion", "reglas de comisiones")),
    Pantalla("/televentas-claro/facturacion/agente", f"{_FACT} · Agente IA", _FACT,
             "El agente IA de facturación.", permisos=_p("facturacion"), confidencial=True, claves=("agente de facturacion",)),
    Pantalla("/perfil", "Mi perfil", "Plataforma",
             "Los datos del usuario: foto, contraseña y segundo factor.",
             claves=("perfil", "mi perfil", "contrasena", "cambiar contrasena", "foto", "segundo factor", "2fa"),
             anclas=("foto", "contrasena")),
    Pantalla("/admin/users", "Administración · Usuarios", "Administración",
             "Alta, baja y edición de usuarios. «Creación rápida»: link y QR de 30 minutos para que se registren solos con el perfil elegido.",
             solo_superadmin=True, claves=("usuarios", "crear usuario", "alta de usuario", "administrar usuarios",
                                           "creacion rapida", "link de registro", "qr de registro", "invitar usuarios")),
    Pantalla("/admin/perfiles", "Administración · Perfiles", "Administración",
             "La matriz de utilidades por perfil: qué ve y qué puede cada perfil.", solo_superadmin=True,
             claves=("perfiles", "permisos", "utilidades", "matriz de perfiles")),
    Pantalla("/admin/audit", "Administración · Auditoría del sistema", "Administración",
             "El registro de acciones de la plataforma.", solo_superadmin=True, claves=("registro de auditoria", "log", "acciones")),
    Pantalla("/admin/seguridad", "Administración · Seguridad", "Administración",
             "Políticas de acceso: horarios, intentos, sesiones.", solo_superadmin=True, claves=("seguridad", "horarios de acceso")),
    Pantalla("/admin/sistema", "Administración · Sistema", "Administración",
             "El estado del sistema y el almacenamiento.", solo_superadmin=True, claves=("sistema", "almacenamiento", "disco")),
    Pantalla("/admin/asistente", "Administración · Asistente IA", "Administración",
             "La consola de Voi: publicar el agente, topes, consumo, conversaciones y la base de conocimiento (documentos).",
             solo_superadmin=True, claves=("consola de voi", "asistente ia", "base de conocimiento", "documentos de voi",
                                           "subir documento", "configurar voi"), anclas=("documento",)),
)

# ------------------------------------------------------------------ guías paso a paso
GUIAS: tuple[Guia, ...] = (
    Guia("subir_corte_ventas", "Subir el corte de ventas de Claro", "/televentas-claro/ventas-netas/upload",
         permisos=_p("ventas_netas_gestion"),
         claves=("subir corte", "subir el corte", "cargar corte", "subir ventas", "cargar ventas", "subir ventas netas",
                 "corte de claro", "xlsx", "subir las netas", "cargar las netas", "subir un corte"),
         pasos=(Paso("Tené a mano el archivo .xlsx que manda Claro, con las hojas DDI, CARGAS y PORTABILIDAD."),
                Paso("Tocá «Elegir archivo» y seleccioná ese .xlsx (también podés arrastrarlo).", "archivo"),
                Paso("Tocá «Procesar corte». La plataforma detecta el mes por la fecha de venta y arma un borrador.", "procesar"),
                Paso("Al terminar se abre el informe. Revisalo y, si está bien, publicalo desde la lista «Informes» "
                     "(hay una publicación válida por mes; si ya había una, reemplazar pide confirmación).")),
         nota="Si el archivo falla, el error dice qué hoja o columna falta: corregilo y volvé a subirlo.",
         voi="Subir el archivo lo hace el usuario; Voi puede resumir el corte apenas esté y avisar qué vendedores quedan en alerta."),
    Guia("subir_corte_logistica", "Subir el corte de pedidos de logística", "/televentas-claro/logistica/upload",
         permisos=_p("logistica_gestion"),
         claves=("subir corte de logistica", "subir pedidos", "cargar pedidos", "subir entregas", "cargar el corte de logistica",
                 "xlsx de logistica", "subir logistica"),
         pasos=(Paso("Tené a mano el .xlsx de pedidos: una fila por pedido con Nro. Formulario, cliente, ciudad, departamento, "
                     "REGION, Fecha Venta, vendedor, promoción, ESTADO y MOTIVO."),
                Paso("Elegí el archivo y, si el corte no es de hoy, indicá la fecha del corte (desde ahí se mide la demora).", "archivo"),
                Paso("Tocá «Procesar corte»: la plataforma arma el borrador del mes al instante.", "procesar"),
                Paso("Revisá el informe (filtrá por estado, mirá los pendientes y su demora) y publicalo desde «Informes»; "
                     "hay una publicación válida por mes y reemplazar pide confirmación.")),
         nota="Si el archivo falla, el error dice qué columna falta: corregilo y volvé a subirlo.",
         voi="Subir el archivo lo hace el usuario; Voi puede resumir el corte apenas esté y listar los pedidos más demorados."),
    Guia("subir_cortes_llamadas", "Subir los cortes de llamadas (Productividad)", "/televentas-claro/productividad/subir",
         permisos=_p("productividad_gestion"),
         claves=("subir cortes", "subir llamadas", "cargar llamadas", "cargar cortes", "tiempos acumulados", "csv",
                 "subir productividad", "cargar productividad", "cortes de llamadas"),
         pasos=(Paso("Descargá el reporte «Tiempos Acumulados» de la plataforma de llamadas en .csv (hasta 2 MB cada uno). "
                     "No le cambies el nombre: trae la fecha y la hora del corte."),
                Paso("Arrastrá los archivos a la zona punteada o hacé clic ahí para elegirlos. Podés subir varios a la vez.",
                     "archivos"),
                Paso("Revisá la fecha y la hora detectadas de cada archivo; si alguno no la trae, indicala a mano."),
                Paso("Tocá «Procesar»: cada corte actualiza el borrador de su día (el último corte reemplaza al de la misma hora).",
                     "procesar"),
                Paso("Al terminar se abre el informe del día. Publicalo desde «Informes diarios» (uno publicado por día).")),
         voi="Voi puede explicar el informe del día apenas esté cargado y compararlo con el anterior."),
    Guia("publicar_ventas_netas", "Publicar un corte de Ventas Netas", "/televentas-claro/ventas-netas",
         permisos=_p("ventas_netas_gestion"),
         claves=("publicar corte", "publicar ventas", "publicar las netas", "publicar ventas netas", "publicar el informe de ventas"),
         pasos=(Paso("En la lista «Informes», ubicá el borrador del mes (estado Borrador)."),
                Paso("Tocá «Publicar» en esa fila.", "publicar"),
                Paso("Si ya había uno publicado ese mes, la plataforma pide confirmar el reemplazo: el anterior queda como "
                     "reemplazado y el nuevo pasa a ser el válido."),
                Paso("Quien tiene «Ver informes» ya lo ve; SPH y Auditoría usan ese corte publicado.")),
         voi="Voi puede decirte qué cambia respecto del publicado anterior antes de que publiques."),
    Guia("publicar_productividad", "Publicar el informe diario de Productividad", "/televentas-claro/productividad",
         permisos=_p("productividad_gestion"),
         claves=("publicar productividad", "publicar llamadas", "publicar el informe de llamadas", "publicar el dia"),
         pasos=(Paso("En «Informes diarios», ubicá el borrador del día."),
                Paso("Tocá «Publicar» en esa fila (hay uno publicado por día; reemplazar pide confirmación).", "publicar"),
                Paso("El acumulado semanal y mensual se recalcula solo con lo publicado."))),
    Guia("calcular_sph", "Calcular y publicar el SPH", "/televentas-claro/sph", permisos=_p("sph_gestion"),
         claves=("calcular sph", "calcular el sph", "sph de la semana", "sph del mes", "publicar sph", "como se calcula el sph"),
         pasos=(Paso("Necesitás Productividad y Ventas Netas publicados del período."),
                Paso("En «Calcular SPH» elegí el período: día, semana, mes o rango.", "calcular"),
                Paso("Revisá el cruce de nombres (agente de llamadas ↔ vendedor) y las ventas sin asesor; corregí vínculos en «Vínculos»."),
                Paso("Publicá el informe del período (uno por período).")),
         voi="Voi puede leerte el SPH de la operación y el ranking por asesor del último informe."),
    Guia("preparar_informe_diario", "Preparar y firmar el informe diario", "/televentas-claro/informe-diario",
         permisos=_p("informe_diario"),
         claves=("informe diario", "preparar el informe", "firmar el informe", "informe de hoy", "como firmo", "hacer el informe"),
         pasos=(Paso("Tocá «Preparar informe diario»: abre el borrador de hoy (o lo retoma).", "preparar"),
                Paso("Completá los resultados del día (Pospago, GPON y otros), el resumen y las métricas críticas con su "
                     "compromiso. Se guarda solo mientras escribís."),
                Paso("Importá los datos de la plataforma: llamadas, cargas del día, proyección y coaching."),
                Paso("Revisá el seguimiento de los compromisos anteriores y firmá con tu cargo (la firma manuscrita es opcional)."),
                Paso("Descargá el PDF para enviarlo. Un informe firmado ya no se edita.")),
         voi="Voi puede dejarte el borrador listo con los datos del día (preparar_informe_diario); vos lo revisás y lo firmás."),
    Guia("enviar_ticket", "Enviar un ticket de revisión", "/televentas-claro/supervision/tickets", permisos=_p("tickets"),
         claves=("enviar ticket", "mandar ticket", "crear ticket", "ticket de revision", "pedir revision", "como envio un ticket"),
         pasos=(Paso("Tocá «Enviar ticket».", "enviar"),
                Paso("Elegí el tipo (venta observada, línea sin uso, calidad, reclamo, conducta u otro) y la prioridad: "
                     "el plazo se mide en horas hábiles."),
                Paso("Indicá el asesor (llega al supervisor que lo tenía ese día) o el supervisor, y describí el caso con sus datos."),
                Paso("El supervisor responde desde su portal; vos seguís el ticket acá: comentar, reabrir, reasignar o cancelar.")),
         voi="Voi puede enviarlo por vos: decile a quién y qué revisar, y lo aprobás con un botón."),
    Guia("gestionar_alertas", "Trabajar las alertas del centro de comandos", "/televentas-claro/supervision/comando",
         permisos=_p("supervision"),
         claves=("alertas del centro de comandos", "tomar alerta", "descartar alerta", "centro de comandos", "trabajar alertas"),
         pasos=(Paso("El semáforo muestra a cada supervisor según sus alertas del día; las críticas van primero."),
                Paso("En cada alerta: «Tomar» (con una nota de qué hiciste), «Descartar» (con el motivo) o «Pedir revisión» "
                     "(crea un ticket al supervisor)."),
                Paso("Lo que tomaste queda registrado con tu nombre y la fecha.")),
         voi="Voi puede tomar, descartar o derivar una alerta por vos (lo aprobás con un botón)."),
    Guia("nuevo_informe_auditoria", "Crear un informe de auditoría", "/televentas-claro/auditoria/riesgos", permisos=_p("auditoria"),
         claves=("crear informe de auditoria", "nuevo informe de auditoria", "nueva auditoria", "preparar auditoria", "auditar"),
         pasos=(Paso("En «Riesgos», marcá los cortes de Ventas Netas que querés auditar (uno por mes)."),
                Paso("Tocá «Crear informe de auditoría»: queda en borrador con el resumen y los hallazgos automáticos.", "crear"),
                Paso("Completá los hallazgos (severidad, vendedor, recomendación, responsable) y sumá evidencia."),
                Paso("Pasalo a revisión y cerralo desde el informe; el PDF sale de «Vista para imprimir».")),
         voi="Voi puede prepararlo (preparar_auditoria), agregar hallazgos e investigar en modo auditor."),
    Guia("subir_evidencia", "Subir evidencia (imágenes) a un informe de auditoría", "/televentas-claro/auditoria", permisos=_p("auditoria"),
         claves=("subir evidencia", "subir imagenes", "subir captura", "evidencia", "cargar evidencia", "agregar imagenes al informe",
                 "pegar captura"),
         pasos=(Paso("Abrí el informe (en borrador o en revisión) y entrá a la pestaña «Evidencia»."),
                Paso("Tocá «Subir imágenes» (se abre el selector en el Escritorio), pegá una captura con Ctrl + V o usá "
                     "«Capturar pantalla».", "subir"),
                Paso("Cada imagen queda como Figura N: ponele título y nota, y asociala a un hallazgo si corresponde."),
                Paso("Las figuras salen en el informe ejecutivo y en el extenso, con su índice.")),
         voi="En modo auditor, Voi te ofrece cada gráfico del lienzo como figura del informe."),
    Guia("armar_equipos", "Armar los equipos del mes", "/televentas-claro/supervision/equipos", permisos=_p("supervision_gestion"),
         claves=("armar equipos", "equipos del mes", "asignar asesores", "cargar equipos", "copiar equipos"),
         pasos=(Paso("Elegí el mes. Si es igual al anterior, «Copiar del mes anterior» trae los equipos."),
                Paso("Asigná cada asesor a su supervisor con la fecha efectiva.", "asignar"),
                Paso("Los objetivos, la proyección y las alertas usan estos equipos."))),
    Guia("cargar_objetivos", "Cargar los objetivos de Pospago y GPON", "/televentas-claro/supervision", permisos=_p("supervision_gestion"),
         claves=("cargar objetivos", "objetivos del mes", "meta de pospago", "meta de gpon", "poner objetivos"),
         pasos=(Paso("Elegí el mes y tocá «Cargar objetivos».", "objetivos"),
                Paso("Escribí el objetivo de Pospago y de GPON de cada supervisor y guardá."),
                Paso("La proyección al cierre y el semáforo se recalculan con lo vendido por cada equipo."))),
    Guia("vincular_operadores", "Vincular el nombre de llamadas con el vendedor", "/televentas-claro/supervision/operadores",
         permisos=_p("operadores"),
         claves=("vincular operador", "vincular nombres", "maestro de operadores", "nombre de llamadas", "vincular asesor"),
         pasos=(Paso("Buscá el operador por su nombre de llamadas."),
                Paso("Tocá «Vincular» y elegí el vendedor de Ventas Netas que corresponde.", "vincular"),
                Paso("Supervisión y el SPH usan ese vínculo; también podés separar o confirmar sin vínculo."))),
    Guia("subir_liquidacion", "Subir una liquidación de Claro", "/televentas-claro/facturacion/upload", permisos=_p("facturacion"),
         claves=("subir liquidacion", "cargar liquidacion", "liquidacion de claro"),
         pasos=(Paso("Tené el archivo .txt de liquidación que manda Claro."),
                Paso("Elegí el archivo.", "archivo"),
                Paso("Tocá «Procesar»: la liquidación queda en Reportes y se puede comparar con otros meses.", "procesar"))),
    Guia("cambiar_foto_o_contrasena", "Cambiar la foto o la contraseña", "/perfil",
         claves=("cambiar contrasena", "cambiar la clave", "cambiar foto", "foto de perfil", "mi perfil", "segundo factor"),
         pasos=(Paso("En «Datos del perfil», «Cambiar foto» abre el selector (PNG, JPG o WebP).", "foto"),
                Paso("En «Cambiar contraseña», escribí la actual y la nueva dos veces.", "contrasena"),
                Paso("El segundo factor se activa desde la misma pantalla, si tu perfil lo pide."))),
    Guia("subir_documento_voi", "Subir un documento a la base de conocimiento de Voi", "/admin/asistente", solo_superadmin=True,
         claves=("subir documento", "base de conocimiento", "documento para voi", "cargar manual", "subir manual"),
         pasos=(Paso("En la consola de Voi, pestaña «Base de conocimiento», tocá «Subir un documento».", "documento"),
                Paso("Elegí el archivo (PDF, Word, Excel o texto), ponele título y descripción, y definí quién puede consultarlo."),
                Paso("Voi lo lee en fragmentos y lo cita con página y sección cuando responde."))),
)


# ------------------------------------------------------------------ búsqueda
def normalizar(t: str) -> str:
    t = "".join(c for c in unicodedata.normalize("NFD", t or "") if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9/#?=&_\-\s]", " ", t).strip()


# Formas de decir lo mismo: «subo», «subís», «subir» → subir; y las palabras que no distinguen nada.
_VERBOS = (
    (r"\b(subo|subis|subes|subimos|suba|subirlo|subirla)\b", "subir"), (r"\b(cargo|cargas|cargamos|cargue|cargarlo|cargarla)\b", "cargar"),
    (r"\b(publico|publicas|publicamos|publique|publicarlo)\b", "publicar"), (r"\b(calculo|calculas|calcule|calcularlo)\b", "calcular"),
    (r"\b(envio|envias|envie|mando|mandas|mande|mandar|enviarlo|mandarlo)\b", "enviar"), (r"\b(preparo|preparas|prepare|prepararlo)\b", "preparar"),
    (r"\b(creo|creas|cree|crearlo)\b", "crear"), (r"\b(armo|armas|arme|armarlos)\b", "armar"),
    (r"\b(vinculo|vinculas|vincule|vincularlo)\b", "vincular"), (r"\b(firmo|firmas|firme|firmarlo)\b", "firmar"),
    (r"\b(cambio|cambias|cambie|cambiarla)\b", "cambiar"), (r"\b(abro|abris|abri|abrime|abrila)\b", "abrir"),
    (r"\b(hago|haces|hace|hacer|haga)\b", "hacer"), (r"\b(veo|ves|ver|vea|mirar|miro)\b", "ver"),
)
_VACIAS = frozenset("el la los las un una unos unas de del al a mi mis me te para por que como se en y o lo le es "
                    "esta este esto quiero necesito puedo podes tengo hay con sin ya".split())


def canon(t: str) -> str:
    """La forma canónica para comparar: sin tildes ni mayúsculas, verbos en infinitivo y sin palabras vacías."""
    n = normalizar(t)
    for patron, forma in _VERBOS:
        n = re.sub(patron, forma, n)
    return " ".join(w for w in n.split() if w not in _VACIAS)


def nombre_permiso(perm: str) -> str:
    """«Ventas Netas · Gestión» para televentas_claro.ventas_netas_gestion."""
    slug, _, key = perm.partition(".")
    for o in OPERATIVAS:
        if o["slug"] == slug:
            for u in o["utilidades"]:
                if u["key"] == key:
                    return u["name"]
    return perm


def puede(user: CurrentUser, permisos: tuple[str, ...], solo_superadmin: bool = False) -> bool:
    if user.is_superadmin:
        return True
    if solo_superadmin:
        return False
    return not permisos or any(user.has_perm(p) for p in permisos)


def falta(item: Pantalla | Guia) -> str:
    """Qué le falta a quien no puede: la utilidad (o que es solo del superadmin)."""
    if item.solo_superadmin:
        return "es solo para el superadmin"
    return "le falta la utilidad " + " o ".join(f"«{nombre_permiso(p)}»" for p in item.permisos)


def visibles(user: CurrentUser) -> list[Pantalla]:
    return [p for p in PANTALLAS if puede(user, p.permisos, p.solo_superadmin)]


def guias_visibles(user: CurrentUser) -> list[Guia]:
    return [g for g in GUIAS if puede(user, g.permisos, g.solo_superadmin)]


def _puntaje(texto_c: str, titulo: str, claves: tuple[str, ...]) -> int:
    """Cuánto se parece lo pedido (ya canónico) a esta pantalla o guía: la clave más larga contenida vale por su largo;
    las palabras del título que aparecen suman un poco."""
    mejor = max((len(c) for c in (canon(k) for k in claves) if c and f" {c} " in f" {texto_c} "), default=0)
    palabras = [w for w in canon(titulo).split() if len(w) > 3]
    coincidencias = sum(1 for w in palabras if re.search(rf"\b{re.escape(w)}", texto_c))
    return mejor * 3 + coincidencias * 4


def _mejor(user: CurrentUser, texto: str, items):
    """(lo mejor que puede ver, lo mejor que NO puede ver) para lo pedido. Si lo que no puede ver coincide claramente
    mejor que lo que puede, se devuelve solo eso: la herramienta le explica qué utilidad le falta en vez de llevarlo a
    otra pantalla parecida."""
    n = canon(texto)
    if not n:
        return None, None
    visible, oculto = None, None
    mv = mo = 0
    for it in items:
        s = _puntaje(n, it.titulo, it.claves)
        if s <= 0:
            continue
        if puede(user, it.permisos, it.solo_superadmin):
            if s > mv:
                visible, mv = it, s
        elif s > mo:
            oculto, mo = it, s
    if oculto is not None and mo > mv:
        return None, oculto
    return visible, None


def buscar_pantalla(user: CurrentUser, texto: str) -> tuple[Optional[Pantalla], Optional[Pantalla]]:
    return _mejor(user, texto, PANTALLAS)


def buscar_guia(user: CurrentUser, texto: str) -> tuple[Optional[Guia], Optional[Guia]]:
    return _mejor(user, texto, GUIAS)


def pantalla_de_ruta(ruta: str) -> Optional[Pantalla]:
    """La pantalla del catálogo a la que pertenece una ruta (la de prefijo más largo), p. ej.
    /televentas-claro/auditoria/informes/<id>#evidencia → Auditoría · Informes."""
    camino = (ruta or "").split("#", 1)[0].split("?", 1)[0].rstrip("/") or "/"
    mejor = None
    for p in PANTALLAS:
        if camino == p.ruta or camino.startswith(p.ruta + "/"):
            if mejor is None or len(p.ruta) > len(mejor.ruta):
                mejor = p
    return mejor


def ruta_limpia(ruta: str) -> Optional[str]:
    """Una ruta interna válida (sin dominio, sin «//», sin espacios) o None."""
    r = (ruta or "").strip()
    if not r.startswith("/") or r.startswith("//") or len(r) > 300 or re.search(r"\s|[<>\"']", r):
        return None
    return r


def guia_dict(g: Guia) -> dict[str, Any]:
    return {"clave": g.clave, "titulo": g.titulo, "ruta": g.ruta, "nota": g.nota, "voi": g.voi,
            "pasos": [{"n": i + 1, "texto": p.texto, "ancla": p.ancla} for i, p in enumerate(g.pasos)]}


def pantalla_dict(p: Pantalla, user: CurrentUser) -> dict[str, Any]:
    guias = [{"clave": g.clave, "titulo": g.titulo} for g in guias_visibles(user) if g.ruta == p.ruta]
    return {"ruta": p.ruta, "titulo": p.titulo, "modulo": p.modulo, "que_hace": p.que_hace,
            "pista": ({"texto": p.pista.texto, "boton": p.pista.boton, "mensaje": p.pista.mensaje} if p.pista else None),
            "sugerencias": list(p.sugerencias), "guias": guias, "anclas": list(p.anclas)}


def catalogo(user: CurrentUser) -> list[dict[str, Any]]:
    """Lo que el navegador necesita: las pantallas que el usuario puede abrir, con su pista y sus guías."""
    return [pantalla_dict(p, user) for p in visibles(user)]
