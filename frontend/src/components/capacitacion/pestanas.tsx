"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/portal/ui";
import { CAP_HREF } from "./tipos";

const PESTANAS = [
  { href: CAP_HREF, label: "Grupos", activa: (r: string) => r === CAP_HREF || r.startsWith(`${CAP_HREF}/grupos`) || r.startsWith(`${CAP_HREF}/postulantes`) },
  { href: `${CAP_HREF}/entrenamientos`, label: "Entrenamientos", activa: (r: string) => r.startsWith(`${CAP_HREF}/entrenamientos`) },
  { href: `${CAP_HREF}/estadisticas`, label: "Estadísticas", activa: (r: string) => r.startsWith(`${CAP_HREF}/estadisticas`) },
];

/** Las dos vistas del módulo: los grupos (y sus postulantes) y las estadísticas generales. */
export function Pestanas() {
  const ruta = usePathname() ?? "";
  return (
    <nav aria-label="Vistas" className="mb-5 hidden md:flex gap-1 border-b border-brand-border">
      {PESTANAS.map((p) => {
        const on = p.activa(ruta);
        return (
          <Link key={p.href} href={p.href} aria-current={on ? "page" : undefined}
            className={cx("min-h-[44px] px-4 inline-flex items-center text-sm font-semibold border-b-2 -mb-px",
              on ? "border-brand-primary text-brand-ink" : "border-transparent text-brand-slate hover:text-brand-ink")}>
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
