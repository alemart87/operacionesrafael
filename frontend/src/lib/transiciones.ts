"use client";

/**
 * Navegación suave entre pantallas, como pasar una hoja.
 *
 * Con la API de View Transitions del navegador (Chrome, Edge, Safari y Firefox recientes) el cambio de pantalla se
 * anima de verdad: la hoja que se va gira apenas hacia la izquierda mientras entra la nueva; la cabecera y el panel
 * de Voi quedan quietos (tienen su propio nombre de transición). Sin la API, o con «reducir movimiento» en el
 * sistema, la pantalla nueva solo aparece con su fundido (`.pagina-entra`).
 *
 * Se intercepta el clic en los enlaces internos en fase de captura: `preventDefault()` hace que el `Link` de Next
 * no navegue por su cuenta (respeta `defaultPrevented`) pero sí corra su `onClick`; la navegación la hace el router
 * dentro de la transición, y la promesa se resuelve cuando cambia la ruta (o a los 800 ms, por las dudas).
 */
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect } from "react";

type DocumentoConTransiciones = Document & {
  startViewTransition?: (cb: () => Promise<void> | void) => { finished: Promise<void> };
};

const ESPERA_MAXIMA = 700;
/** La ruta a la que se está yendo con la transición de hoja: su pantalla no repite el fundido propio. */
let rutaConHoja: string | null = null;
/** Lo que espera la transición para tomar la foto de la pantalla nueva. Vive fuera de React: el cromo de la app se
 * monta de nuevo con cada pantalla, y es la instancia nueva la que avisa que ya está. */
let pendiente: (() => void) | null = null;
export const navegacionConHoja = (pathname: string | null): boolean => !!pathname && rutaConHoja === pathname;

export function soportaTransiciones(): boolean {
  if (typeof document === "undefined") return false;
  return typeof (document as DocumentoConTransiciones).startViewTransition === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Hace la navegación dentro de una transición de hoja (si el navegador la soporta); si no, navega sin más. */
export function navegarConHoja(router: { push: (href: string) => void }, href: string): void {
  const doc = document as DocumentoConTransiciones;
  if (!soportaTransiciones() || !doc.startViewTransition) {
    router.push(href);
    return;
  }
  const destino = href.split(/[?#]/)[0];
  rutaConHoja = destino;
  const t = doc.startViewTransition(() => new Promise<void>((resolve) => {
    const listo = () => { if (pendiente === listo) pendiente = null; resolve(); };
    pendiente = listo;
    setTimeout(listo, ESPERA_MAXIMA);
    router.push(href);
  }));
  t.finished.catch(() => undefined).finally(() => { if (rutaConHoja === destino) rutaConHoja = null; });
}

/** Lleva los clics en enlaces internos por la transición de hoja. Va en el cromo de la app (una sola vez). */
export function useNavegacionSuave(): void {
  const router = useRouter();
  const pathname = usePathname();

  // La ruta cambió (o el cromo de la pantalla nueva se montó): ya está en el DOM, la transición puede tomar su foto.
  useLayoutEffect(() => { pendiente?.(); }, [pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target || a.hasAttribute("download") || a.getAttribute("rel")?.includes("external")) return;
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("#") || /^[a-z]+:/i.test(href) && !href.startsWith(location.origin)) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;   // misma pantalla: pestañas, anclas
      if (!soportaTransiciones()) return;
      e.preventDefault();
      navegarConHoja(router, url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);
}
