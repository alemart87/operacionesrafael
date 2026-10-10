"use client";

import { MessageSquareText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode, type RefObject } from "react";

export const COACHING_PORTAL = "/televentas-claro/portal/coaching";

/** Abre el registro de un coaching en el portal (si se indica, ya con el asesor elegido). */
export const hrefNuevoCoaching = (operadorId?: string) =>
  `${COACHING_PORTAL}?nuevo=1${operadorId ? `&operador=${encodeURIComponent(operadorId)}` : ""}`;

/** Lee y limpia de la URL el pedido de abrir un coaching nuevo (`?nuevo=1&operador=…`): al recargar no se repite. */
export function leerNuevoCoaching(): { operador_id?: string } | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  if (q.get("nuevo") !== "1") return null;
  const operador = q.get("operador") || undefined;
  q.delete("nuevo");
  q.delete("operador");
  const resto = q.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${resto ? `?${resto}` : ""}`);
  return { operador_id: operador };
}

type Props = { children?: ReactNode; className?: string; title?: string; tabIndex?: number } & (
  | { href: string; onClick?: never }
  | { onClick: () => void; href?: never }
);

/**
 * «Hacer coaching»: la acción principal del supervisor. Brilla con un pulso (fijo, con el mismo halo, si el sistema
 * pide menos movimiento). Un enlace (`href`) o un botón (`onClick`).
 */
export function BotonCoaching({ children = "Hacer coaching", className = "", title, tabIndex, ...p }: Props) {
  const contenido = <><MessageSquareText size={20} aria-hidden strokeWidth={2.4} /> {children}</>;
  const cls = `btn-coaching print:hidden ${className}`;
  if (p.href) return <Link href={p.href} className={cls} title={title} tabIndex={tabIndex}>{contenido}</Link>;
  return <button type="button" onClick={p.onClick} className={cls} title={title} tabIndex={tabIndex}>{contenido}</button>;
}

/**
 * El mismo botón, flotante abajo a la derecha, cuando el principal (`ancla`) ya no se ve: al bajar por la página la
 * acción sigue a mano. Nunca hay dos pulsando a la vez.
 */
export function CoachingFlotante({ ancla, ...p }: { ancla: RefObject<HTMLElement> } & (
  { href: string; onClick?: never } | { onClick: () => void; href?: never }
)) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ancla.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    // El encabezado queda fijo arriba: el botón principal deja de verse cuando pasa por debajo de él.
    const alto = Math.round(document.querySelector("header")?.getBoundingClientRect().height ?? 0);
    const io = new IntersectionObserver(([e]) => setVisible(!e.isIntersecting), { rootMargin: `-${alto}px 0px 0px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [ancla]);
  return (
    <div aria-hidden={!visible}
      className={`fixed z-40 right-4 bottom-4 sm:right-6 sm:bottom-6 print:hidden transition-all duration-200 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"}`}>
      {visible && (p.href
        ? <BotonCoaching href={p.href} className="!px-5 !py-3.5 rounded-full" />
        : <BotonCoaching onClick={p.onClick!} className="!px-5 !py-3.5 rounded-full" />)}
    </div>
  );
}
