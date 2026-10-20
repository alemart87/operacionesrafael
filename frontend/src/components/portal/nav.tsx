"use client";

import { ClipboardList, House, Plus, Ticket, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { PORTAL, cx } from "./ui";

const ITEMS = [
  { href: PORTAL, label: "Hoy", icono: House, exacto: true },
  { href: `${PORTAL}/equipo`, label: "Equipo", icono: Users },
  { href: `${PORTAL}/coaching/nuevo`, label: "Coaching", icono: Plus, central: true },
  { href: `${PORTAL}/coaching`, label: "Mi mes", icono: ClipboardList, exacto: true },
  { href: `${PORTAL}/tickets`, label: "Tickets", icono: Ticket },
];

/** La barra del pulgar del portal (solo en el celular): Hoy, Equipo, el coaching al centro, Mi mes y Tickets. */
export function PortalNav() {
  const ruta = usePathname() ?? "";
  // Dentro de un coaching (y su firma) la acción manda la pantalla: «Mi mes» queda marcado como sección.
  const activo = (href: string, exacto?: boolean) =>
    exacto ? ruta === href || (href === `${PORTAL}/coaching` && /\/coaching\/(?!nuevo)[^/]+/.test(ruta)) : ruta.startsWith(href);
  return (
    <nav aria-label="Portal del supervisor"
      className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-white border-t border-brand-border pb-[env(safe-area-inset-bottom)] print:hidden">
      <ul className="grid grid-cols-5 h-16">
        {ITEMS.map(({ href, label, icono: I, exacto, central }) => {
          const on = activo(href, exacto);
          if (central) {
            return (
              <li key={href} className="flex items-start justify-center">
                <Link href={href} data-voi="coaching" aria-label="Hacer coaching"
                  className="-mt-5 w-16 h-16 rounded-full bg-brand-primary text-white shadow-elevated ring-4 ring-white flex flex-col items-center justify-center active:scale-95 transition-transform">
                  <I size={26} strokeWidth={2.6} aria-hidden />
                  <span className="text-[9px] font-bold uppercase tracking-wider2 -mt-0.5">{label}</span>
                </Link>
              </li>
            );
          }
          return (
            <li key={href}>
              <Link href={href} aria-current={on ? "page" : undefined}
                className={cx("h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold",
                  on ? "text-brand-primary" : "text-brand-slate")}>
                <I size={22} strokeWidth={on ? 2.5 : 2} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** El marco de cada pantalla del portal: pensado para el celular, con la barra del pulgar. */
export function PortalShell({ children }: { children: ReactNode }) {
  return (
    <AppShell movil>
      {children}
      <PortalNav />
    </AppShell>
  );
}
