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

export interface OperativaNavItem {
  href: string;
  label: string;
  /** Grupo dentro del submódulo (los ítems del mismo grupo van juntos con su rótulo). */
  grupo?: string;
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
        utilidad: "facturacion", // solo superadmin
        label: "Facturación",
        href: "/televentas-claro/facturacion",
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
