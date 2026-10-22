"use client";

/**
 * La barra del pulgar en el celular, para todos los perfiles menos el supervisor (que tiene la de su portal). Los jefes
 * (gerente, sub gerente, coordinador, controller y superadmin) tienen a mano el control de los supervisores, el coaching
 * del día y el analizador; el resto, sus módulos. «Menú» abre la navegación completa.
 */
import {
  BarChart3, Bot, ClipboardCheck, GraduationCap, Gauge, House, LayoutGrid, Menu, MessageSquareText, Radio, Siren, Sparkles, Truck, Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { can, type CurrentUserInfo } from "@/lib/api";
import { OPERATIVA_ROUTES } from "@/lib/operativas";

const SUP = "/televentas-claro/supervision";
const TC = "televentas_claro";

interface Item { href: string; label: string; corto?: string; icono: LucideIcon; central?: boolean; exacto?: boolean }

const ICONOS: Record<string, LucideIcon> = {
  ventas_netas: BarChart3, productividad: Gauge, sph: Sparkles, supervision: Users, logistica: Truck,
  informe_diario: ClipboardCheck, auditoria: Siren,
};

const CAP = "/capacitacion";
/** Capacitación y Mentoría: los grupos, el grupo en curso a un toque, los entrenamientos y el tablero en vivo
 * (las estadísticas quedan en el menú). */
const ITEMS_CAP: Item[] = [
  { href: CAP, label: "Grupos", icono: GraduationCap, exacto: true },
  { href: `${CAP}/en-curso`, label: "Mi grupo", icono: Users, central: true },
  { href: `${CAP}/entrenamientos`, label: "Entrenar", icono: Bot },
  { href: `${CAP}/vivo`, label: "En vivo", icono: Radio },
];
/** Perfiles que solo ven Capacitación: sin «Inicio» (los lleva al mismo lugar que «Grupos»). */
const SOLO_CAP = ["capacitador", "mentor", "rrhh"];

export function itemsDe(user: CurrentUserInfo, ruta = ""): Item[] {
  const ok = (u: string) => can(user, `${TC}.${u}`);
  // Quien solo ve Capacitación tiene las cuatro; los jefes, dentro del módulo, sin «En vivo» (está en el menú) para dejar «Inicio».
  if (can(user, "capacitacion.ver") && SOLO_CAP.includes(user.role)) return ITEMS_CAP;
  if (can(user, "capacitacion.ver") && (ruta === CAP || ruta.startsWith(`${CAP}/`))) return ITEMS_CAP.slice(0, 3);
  if (ok("control_supervisores")) {
    return [
      { href: `${SUP}/control`, label: "Control", icono: Users },
      { href: `${SUP}/coaching/hoy`, label: "Hoy", icono: MessageSquareText, central: true },
      ok("analisis_coaching")
        ? { href: `${SUP}/analisis`, label: "Análisis", icono: Sparkles }
        : { href: `${SUP}/comando`, label: "Comando", icono: Siren },
    ];
  }
  const tc = OPERATIVA_ROUTES.find((o) => o.slug === TC);
  const items: Item[] = (tc?.submodulos ?? []).filter((s) => ok(s.utilidad)).slice(0, 3)
    .map((s) => ({ href: s.href, label: s.label.split(" ")[0], icono: ICONOS[s.utilidad] ?? LayoutGrid }));
  return items.slice(0, 3);
}

export function NavInferior({ user, onMenu, menuAbierto }: { user: CurrentUserInfo; onMenu: () => void; menuAbierto: boolean }) {
  const ruta = usePathname() ?? "";
  const items: Item[] = [...(SOLO_CAP.includes(user.role) ? [] : [{ href: "/inicio", label: "Inicio", icono: House, exacto: true }]), ...itemsDe(user, ruta)];
  const activo = (i: Item) => (i.exacto ? ruta === i.href : ruta === i.href || ruta.startsWith(`${i.href}/`));
  return (
    <nav aria-label="Navegación rápida"
      className="barra-inferior md:hidden fixed inset-x-0 bottom-0 z-40 bg-white border-t border-brand-border pb-[env(safe-area-inset-bottom)] print:hidden">
      <ul className="flex h-16">
        {items.map((i) => {
          const on = activo(i);
          const I = i.icono;
          if (i.central) {
            return (
              <li key={i.href} className="flex-1 flex items-start justify-center">
                <Link href={i.href} aria-label={i.label === "Hoy" ? "Coaching del día" : i.label}
                  className="-mt-5 w-16 h-16 rounded-full bg-brand-primary text-white shadow-elevated ring-4 ring-white flex flex-col items-center justify-center active:scale-95 transition-transform">
                  <I size={24} strokeWidth={2.5} aria-hidden />
                  <span className="text-[9px] font-bold uppercase tracking-wider2 -mt-0.5">{i.label}</span>
                </Link>
              </li>
            );
          }
          return (
            <li key={i.href} className="flex-1 min-w-0">
              <Link href={i.href} aria-current={on ? "page" : undefined} aria-label={i.corto ? i.label : undefined}
                className={`h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold px-1 ${on ? "text-brand-primary" : "text-brand-slate"}`}>
                <I size={22} strokeWidth={on ? 2.5 : 2} aria-hidden />
                <span className="truncate max-w-full">{i.corto ?? i.label}</span>
              </Link>
            </li>
          );
        })}
        <li className="flex-1 min-w-0">
          <button type="button" onClick={onMenu} aria-expanded={menuAbierto}
            className={`w-full h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${menuAbierto ? "text-brand-primary" : "text-brand-slate"}`}>
            <Menu size={22} aria-hidden /> Menú
          </button>
        </li>
      </ul>
    </nav>
  );
}
