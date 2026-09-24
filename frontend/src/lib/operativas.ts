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
  /** Utilidad requerida (sin el prefijo de la operativa). */
  utilidad: string;
  /** Grupo de la barra (los ítems del mismo grupo van juntos con su rótulo). */
  grupo?: string;
  /** Activo solo con la ruta exacta (para rutas que son prefijo de otras). */
  exact?: boolean;
}

/** Rutas que exigen una utilidad: entrar sin ella redirige al hub. */
export interface OperativaGuard {
  prefix: string;
  utilidad: string;
}

export interface OperativaRoute {
  slug: string;
  name: string;
  href: string;
  nav: OperativaNavItem[];
  guards?: OperativaGuard[];
}

export const OPERATIVA_ROUTES: OperativaRoute[] = [
  {
    slug: "televentas_claro",
    name: "Televentas CLARO",
    href: "/televentas-claro",
    nav: [
      { href: "/televentas-claro", label: "Inicio", utilidad: "ver", exact: true },
      // Facturación: solo superadmin
      { href: "/televentas-claro/facturacion", label: "Reportes", utilidad: "facturacion", grupo: "Facturación", exact: true },
      { href: "/televentas-claro/facturacion/compare", label: "Comparar", utilidad: "facturacion", grupo: "Facturación" },
      { href: "/televentas-claro/facturacion/simulador", label: "Simulador", utilidad: "facturacion", grupo: "Facturación", exact: true },
      { href: "/televentas-claro/facturacion/simulador-anual", label: "Simulador anual", utilidad: "facturacion", grupo: "Facturación" },
      { href: "/televentas-claro/facturacion/gpon", label: "GPON", utilidad: "facturacion", grupo: "Facturación" },
      { href: "/televentas-claro/facturacion/criterios", label: "Criterios", utilidad: "facturacion", grupo: "Facturación" },
      { href: "/televentas-claro/facturacion/agente", label: "Agente IA", utilidad: "facturacion", grupo: "Facturación" },
      { href: "/televentas-claro/facturacion/upload", label: "Subir liquidación", utilidad: "facturacion", grupo: "Facturación" },
    ],
    guards: [{ prefix: "/televentas-claro/facturacion", utilidad: "facturacion" }],
  },
];

export function operativaRoute(slug: string): OperativaRoute | undefined {
  return OPERATIVA_ROUTES.find((o) => o.slug === slug);
}

/** ¿La ruta está activa para este ítem de navegación? */
export function isNavActive(item: OperativaNavItem, pathname: string | null): boolean {
  if (!pathname) return false;
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Utilidades que exige la ruta dentro de la operativa (siempre al menos "ver"). */
export function requiredUtilidades(route: OperativaRoute, pathname: string | null): string[] {
  const extra = (route.guards ?? [])
    .filter((g) => pathname === g.prefix || !!pathname?.startsWith(`${g.prefix}/`))
    .map((g) => g.utilidad);
  return ["ver", ...extra];
}

/** Operativa a la que pertenece una ruta, si alguna. */
export function operativaFromPath(pathname: string | null): OperativaRoute | undefined {
  if (!pathname) return undefined;
  return OPERATIVA_ROUTES.find((o) => pathname === o.href || pathname.startsWith(`${o.href}/`));
}
