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
  /** Exclusiva del superadmin: no se asigna a perfiles. */
  solo_superadmin?: boolean;
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
/** Auditoría de ventas: riesgos, informes de auditoría, hallazgos y seguimiento. */
export const PERM_AUDITORIA = "televentas_claro.auditoria";

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
        utilidad: "auditoria",
        label: "Auditoría de Ventas",
        href: "/televentas-claro/auditoria",
        descripcion: "Circuito de auditoría sobre las ventas: riesgos y ranking de vendedores, informes con hallazgos y evidencia, seguimiento, estados y PDF.",
        contenido: ["Riesgos y datos llamativos", "Vendedores riesgosos", "Hallazgos con evidencia", "Seguimiento y estados", "Informe imprimible en PDF", "Datos congelados"],
        acceso: "Ver y auditar",
        nav: [
          { href: "/televentas-claro/auditoria", label: "Informes de auditoría", exact: true },
          { href: "/televentas-claro/auditoria/riesgos", label: "Riesgos" },
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
