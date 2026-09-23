/**
 * Rutas del frontend de cada operativa.
 *
 * El catálogo (nombre, color, utilidades) viene del backend
 * (`backend/app/core/operativas.py`). Acá solo se declara dónde vive cada
 * operativa en el frontend y su navegación interna. Cada ítem de navegación
 * indica la utilidad que exige: si el usuario no la tiene, no se muestra.
 */

/** Operativa tal como la devuelve el backend para el usuario actual. */
export interface Utilidad {
  key: string;
  name: string;
  description: string;
  habilitada: boolean;
}

export interface OperativaInfo {
  slug: string;
  name: string;
  description: string;
  color: string;
  available: boolean;
  utilidades: Utilidad[];
}

export interface OperativaNavItem {
  href: string;
  label: string;
  /** Utilidad requerida (sin el prefijo de la operativa). */
  utilidad: string;
}

export interface OperativaRoute {
  slug: string;
  name: string;
  href: string;
  nav: OperativaNavItem[];
}

export const OPERATIVA_ROUTES: OperativaRoute[] = [
  {
    slug: "televentas_claro",
    name: "Televentas CLARO",
    href: "/televentas-claro",
    nav: [{ href: "/televentas-claro", label: "Inicio", utilidad: "ver" }],
  },
];

export function operativaRoute(slug: string): OperativaRoute | undefined {
  return OPERATIVA_ROUTES.find((o) => o.slug === slug);
}

/** Operativa a la que pertenece una ruta, si alguna. */
export function operativaFromPath(pathname: string | null): OperativaRoute | undefined {
  if (!pathname) return undefined;
  return OPERATIVA_ROUTES.find((o) => pathname === o.href || pathname.startsWith(`${o.href}/`));
}
