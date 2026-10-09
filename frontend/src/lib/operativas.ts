/**
 * Rutas del frontend de cada operativa.
 *
 * El catálogo (nombre, color, utilidades) viene del backend
 * (`backend/app/core/operativas.py`). Acá solo se declara dónde vive cada
 * operativa en el frontend y sus submódulos. La barra de la operativa muestra
 * Inicio y un acceso por submódulo; la navegación interna de un submódulo
 * aparece solo al entrar en él. Un submódulo sin su utilidad no se muestra y
 * sus rutas redirigen al hub.
 */

/** Operativa tal como la devuelve el backend para el usuario actual. */
export interface Utilidad {
  key: string;
  name: string;
  description: string;
  habilitada: boolean;
  /** Restringida: además del superadmin, solo la pueden tener estos perfiles (vacío = solo superadmin). */
  solo_perfiles?: string[];
}

export interface OperativaInfo {
  slug: string;
  name: string;
  description: string;
  color: string;
  available: boolean;
  utilidades: Utilidad[];
}

/** Utilidad Facturación de Televentas CLARO: exclusiva del superadmin (no asignable a perfiles). */
export const PERM_FACTURACION = "televentas_claro.facturacion";
/** Ventas Netas: ver informes publicados / gestión (subir, publicar, reemplazar, eliminar). */
export const PERM_VENTAS_NETAS = "televentas_claro.ventas_netas";
export const PERM_VENTAS_NETAS_GESTION = "televentas_claro.ventas_netas_gestion";
/** Productividad de llamadas: ver informes publicados y acumulados / gestión (subir cortes, publicar). */
export const PERM_PRODUCTIVIDAD = "televentas_claro.productividad";
export const PERM_PRODUCTIVIDAD_GESTION = "televentas_claro.productividad_gestion";
/** SPH estimado: ver informes publicados / gestión (calcular, vincular nombres, publicar). */
export const PERM_SPH = "televentas_claro.sph";
export const PERM_SPH_GESTION = "televentas_claro.sph_gestion";
/** Auditoría de ventas: riesgos, informes de auditoría, hallazgos y seguimiento. */
export const PERM_AUDITORIA = "televentas_claro.auditoria";
/** Supervisión (modelo Líder Coach Comercial): ver / gestionar equipos, objetivos y calendario / vincular operadores. */
export const PERM_SUPERVISION = "televentas_claro.supervision";
export const PERM_SUPERVISION_GESTION = "televentas_claro.supervision_gestion";
export const PERM_OPERADORES = "televentas_claro.operadores";
/** Parámetros del modelo (pesos del scoring): solo sub gerente y superadmin. */
export const PERM_SUPERVISION_PARAMETROS = "televentas_claro.supervision_parametros";
/** Portal del supervisor: lo único que ve el perfil Supervisor. */
export const PERM_PORTAL_SUPERVISOR = "televentas_claro.portal_supervisor";
export const PORTAL_HREF = "/televentas-claro/portal";

export interface OperativaNavItem {
  href: string;
  label: string;
  /** Grupo dentro del submódulo (los ítems del mismo grupo van juntos con su rótulo). */
  grupo?: string;
  /** Utilidad extra que exige el ítem (además de la del submódulo). Sin ella no se muestra. */
  utilidad?: string;
  /** Activo solo con la ruta exacta (para rutas que son prefijo de otras). */
  exact?: boolean;
}

/**
 * Submódulo: la pantalla propia de una utilidad (p. ej. Facturación).
 * Su navegación interna solo se muestra al entrar al submódulo, y todas sus
 * rutas (`href` y lo que cuelga de él) exigen la utilidad.
 */
export interface Submodulo {
  /** Utilidad que habilita el submódulo (sin el prefijo de la operativa). */
  utilidad: string;
  label: string;
  /** Raíz del submódulo: su pantalla de entrada. */
  href: string;
  nav: OperativaNavItem[];
  /** Qué hace el módulo, en una frase (tarjeta del inicio de la operativa). */
  descripcion?: string;
  /** Qué se visualiza: etiquetas cortas para la tarjeta. */
  contenido?: string[];
  /** Utilidad de gestión del módulo, si la tiene: la tarjeta indica si el usuario puede operar. */
  gestion?: string;
  /** Qué puede hacer quien tiene la gestión (por defecto: subir cortes, publicar y eliminar). */
  gestionTexto?: string;
  /** Etiqueta de acceso en la tarjeta cuando el módulo no separa ver/gestionar (por defecto "Ver informes"). */
  acceso?: string;
}

export interface OperativaRoute {
  slug: string;
  name: string;
  /** Inicio de la operativa. */
  href: string;
  submodulos: Submodulo[];
}

export const OPERATIVA_ROUTES: OperativaRoute[] = [
  {
    slug: "televentas_claro",
    name: "Televentas CLARO",
    href: "/televentas-claro",
    submodulos: [
      {
        utilidad: "ventas_netas",
        label: "Ventas Netas",
        href: "/televentas-claro/ventas-netas",
        descripcion: "Ventas cerradas del mes a partir del corte diario de Claro, con una publicación válida por mes.",
        contenido: ["Salud y gestión de riesgos", "Líneas sin uso (alerta PFI)", "Productividad diaria", "Vendedores críticos", "Zonas: Capital-Central e Interior", "Planilla descargable"],
        gestion: "ventas_netas_gestion",
        nav: [
          { href: "/televentas-claro/ventas-netas", label: "Informes", exact: true },
          { href: "/televentas-claro/ventas-netas/upload", label: "Subir corte", utilidad: "ventas_netas_gestion" },
        ],
      },
      {
        utilidad: "productividad",
        label: "Productividad",
        href: "/televentas-claro/productividad",
        descripcion: "Productividad de llamadas a partir del reporte de tiempos de la plataforma: meta de conversación, contacto por horario, discador y turnos.",
        contenido: ["Meta de conversación y agentes en rojo", "Contacto por horario (desde 30 s)", "Asesores más efectivos", "Discador automático vs manual", "Turnos y jornada media", "Acumulado semanal y mensual"],
        gestion: "productividad_gestion",
        nav: [
          { href: "/televentas-claro/productividad", label: "Informes diarios", exact: true },
          { href: "/televentas-claro/productividad/acumulado", label: "Acumulado" },
          { href: "/televentas-claro/productividad/subir", label: "Subir cortes", utilidad: "productividad_gestion" },
        ],
      },
      {
        utilidad: "sph",
        label: "SPH estimado",
        href: "/televentas-claro/sph",
        descripcion: "Ventas netas por hora conectada: cruza las horas de Productividad con las netas de Ventas Netas, para la operación y por asesor.",
        contenido: ["SPH de la operación", "Día, semana, mes o rango", "Ranking de SPH por asesor", "Cruce de nombres agente ↔ vendedor", "Netas sin asesor", "Vínculos corregidos a mano"],
        gestion: "sph_gestion",
        gestionTexto: "Podés calcular, vincular nombres y publicar.",
        nav: [
          { href: "/televentas-claro/sph", label: "Informes SPH", exact: true },
          { href: "/televentas-claro/sph/vinculos", label: "Vínculos", utilidad: "sph_gestion" },
        ],
      },
      {
        utilidad: "supervision",
        label: "Supervisión",
        href: "/televentas-claro/supervision",
        descripcion: "Modelo Líder Coach Comercial: el centro de comandos de los jefes, equipos del mes por supervisor, objetivos de Pospago y GPON, avance y proyección al cierre, asesores en alerta por líneas sin uso, la gestión de coaching de cada supervisor y los tickets de revisión con sus plazos.",
        contenido: ["Centro de comandos: semáforo y alertas del día", "Objetivos y proyección al cierre", "Scoring de asesores y supervisores", "Gestión de coaching", "Tickets de revisión con plazos", "Línea de tiempo de cada supervisor", "Ficha de cada asesor", "Equipos del mes y maestro de operadores"],
        gestion: "supervision_gestion",
        gestionTexto: "Podés armar los equipos, cargar objetivos y el calendario.",
        nav: [
          { href: "/televentas-claro/supervision/comando", label: "Centro de comandos" },
          { href: "/televentas-claro/supervision", label: "Objetivos y proyección", exact: true },
          { href: "/televentas-claro/supervision/tablero", label: "Tablero" },
          { href: "/televentas-claro/supervision/coaching", label: "Coaching" },
          { href: "/televentas-claro/supervision/tickets", label: "Tickets" },
          { href: "/televentas-claro/supervision/equipos", label: "Equipos del mes" },
          { href: "/televentas-claro/supervision/operadores", label: "Operadores" },
          { href: "/televentas-claro/supervision/calendario", label: "Calendario" },
          { href: "/televentas-claro/supervision/parametros", label: "Parámetros", utilidad: "supervision_parametros" },
        ],
      },
      {
        utilidad: "portal_supervisor",
        label: "Mi portal",
        href: "/televentas-claro/portal",
        descripcion: "Tu equipo del mes, tus objetivos de Pospago y GPON, tu avance y proyección al cierre, tus asesores en alerta, tu registro de coaching, seguimientos y bitácora, y los tickets que te envían.",
        contenido: ["Objetivos del mes", "Proyección al cierre", "Asesores en alerta", "Coaching con impacto medido", "Seguimientos", "Bitácora", "Tickets"],
        acceso: "Mi equipo",
        nav: [
          { href: "/televentas-claro/portal", label: "Mi equipo", exact: true },
          { href: "/televentas-claro/portal/coaching", label: "Coaching y bitácora" },
          { href: "/televentas-claro/portal/tickets", label: "Tickets" },
        ],
      },
      {
        utilidad: "auditoria",
        label: "Auditoría de Ventas",
        href: "/televentas-claro/auditoria",
        descripcion: "Circuito de auditoría sobre las ventas: riesgos y ranking de vendedores, informes con hallazgos y evidencia, seguimiento, estados y PDF.",
        contenido: ["Riesgos y datos llamativos", "Vendedores riesgosos", "Hallazgos con evidencia", "Seguimiento y estados", "Informe imprimible en PDF", "Guía del auditor"],
        acceso: "Ver y auditar",
        nav: [
          { href: "/televentas-claro/auditoria", label: "Informes de auditoría", exact: true },
          { href: "/televentas-claro/auditoria/riesgos", label: "Riesgos" },
          { href: "/televentas-claro/auditoria/guia", label: "Guía del auditor" },
        ],
      },
      {
        utilidad: "facturacion", // solo superadmin
        label: "Facturación",
        href: "/televentas-claro/facturacion",
        descripcion: "Liquidación de comisiones de Claro: qué se cobró, por qué y cómo proyectarlo.",
        contenido: ["Reportes de liquidación", "Comparativo entre meses", "Simuladores móvil y GPON", "Criterios", "Agente IA"],
        nav: [
          { href: "/televentas-claro/facturacion", label: "Liquidaciones", grupo: "Reportes", exact: true },
          { href: "/televentas-claro/facturacion/compare", label: "Comparar", grupo: "Reportes" },
          { href: "/televentas-claro/facturacion/upload", label: "Subir liquidación", grupo: "Reportes" },
          { href: "/televentas-claro/facturacion/simulador", label: "Simulador", grupo: "Simuladores", exact: true },
          { href: "/televentas-claro/facturacion/simulador-anual", label: "Anual", grupo: "Simuladores" },
          { href: "/televentas-claro/facturacion/gpon", label: "GPON", grupo: "Simuladores" },
          { href: "/televentas-claro/facturacion/criterios", label: "Criterios", grupo: "Herramientas" },
          { href: "/televentas-claro/facturacion/agente", label: "Agente IA", grupo: "Herramientas" },
        ],
      },
    ],
  },
];

export function operativaRoute(slug: string): OperativaRoute | undefined {
  return OPERATIVA_ROUTES.find((o) => o.slug === slug);
}

/** ¿La ruta está activa para este ítem de navegación? */
export function isNavActive(item: OperativaNavItem, pathname: string | null): boolean {
  return item.exact ? pathname === item.href : underPath(pathname, item.href);
}

function underPath(pathname: string | null, href: string): boolean {
  return !!pathname && (pathname === href || pathname.startsWith(`${href}/`));
}

/** Submódulo de la operativa en el que está la ruta, si alguno. */
export function submoduloFromPath(route: OperativaRoute, pathname: string | null): Submodulo | undefined {
  return route.submodulos.find((s) => underPath(pathname, s.href));
}

/** Utilidades que exige la ruta dentro de la operativa (siempre al menos "ver"). */
export function requiredUtilidades(route: OperativaRoute, pathname: string | null): string[] {
  const sub = submoduloFromPath(route, pathname);
  return sub ? ["ver", sub.utilidad] : ["ver"];
}

/** Operativa a la que pertenece una ruta, si alguna. */
export function operativaFromPath(pathname: string | null): OperativaRoute | undefined {
  return OPERATIVA_ROUTES.find((o) => underPath(pathname, o.href));
}
