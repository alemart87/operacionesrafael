"use client";

/**
 * Piezas del portal del supervisor pensadas para el celular: filas y botones de 56 px o más (a mano del pulgar), hojas
 * que suben desde abajo, chips grandes y avisos breves. En pantallas anchas se ven igual de sobrias.
 */
import { CircleCheck, ChevronRight, LoaderCircle, TriangleAlert, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const PORTAL = "/televentas-claro/portal";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ------------------------------------------------------------------ encabezados
export function Encabezado({ sobre, titulo, children, accion }: { sobre?: ReactNode; titulo: ReactNode; children?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        {sobre && <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-1">{sobre}</div>}
        <h1 className="font-display text-[34px] sm:text-5xl text-brand-ink uppercase leading-[1.05]">{titulo}</h1>
        {children && <div className="text-sm text-brand-slate mt-1.5 max-w-2xl">{children}</div>}
      </div>
      {accion}
    </div>
  );
}

export function Seccion({ titulo, sub, accion, children, className }: {
  titulo: ReactNode; sub?: ReactNode; accion?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cx("min-w-0", className)}>
      <div className="flex items-end justify-between gap-3 mb-2 px-0.5">
        <div className="min-w-0">
          <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">{titulo}</h2>
          {sub && <p className="text-xs text-brand-slate leading-snug mt-0.5">{sub}</p>}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ filas tocables
type Tono = "rojo" | "naranja" | "azul" | "verde" | "gris" | "tinta";
const TILE: Record<Tono, string> = {
  rojo: "bg-brand-primary-light text-brand-primary-dark",
  naranja: "bg-brand-orange/10 text-[#8A5200]",
  azul: "bg-[#2A78D6]/10 text-[#1D5BA6]",
  verde: "bg-emerald-50 text-emerald-700",
  gris: "bg-brand-bg text-brand-slate",
  tinta: "bg-brand-ink text-white",
};
const BORDE: Record<Tono, string> = {
  rojo: "shadow-[inset_3px_0_0_#E6332A]", naranja: "shadow-[inset_3px_0_0_#F39200]", azul: "", verde: "", gris: "", tinta: "",
};

/** Una fila de lista de 64 px o más: ícono, título, detalle y lo que va a la derecha. Enlace o botón. */
export function Fila({ icono: I, tono = "gris", titulo, sub, derecha, href, onClick, marcada, disabled }: {
  icono?: LucideIcon; tono?: Tono; titulo: ReactNode; sub?: ReactNode; derecha?: ReactNode; href?: string;
  onClick?: () => void; marcada?: boolean; disabled?: boolean;
}) {
  const cuerpo = (
    <>
      {I && (
        <span className={cx("w-11 h-11 rounded-lg flex items-center justify-center shrink-0", TILE[tono])}>
          <I size={21} aria-hidden strokeWidth={2.2} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-[15px] text-brand-ink leading-snug break-words">{titulo}</span>
        {sub && <span className="block text-[13px] text-brand-slate leading-snug mt-0.5 break-words">{sub}</span>}
      </span>
      {derecha}
      {(href || onClick) && <ChevronRight size={20} className="text-brand-mist shrink-0" aria-hidden />}
    </>
  );
  const cls = cx("w-full min-h-[64px] px-4 py-3 flex items-center gap-3 text-left bg-white transition-colors",
    (href || onClick) && "active:bg-brand-bg hover:bg-brand-bg-soft", marcada && BORDE[tono], disabled && "opacity-60 pointer-events-none");
  if (href) return <Link href={href} className={cls}>{cuerpo}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{cuerpo}</button>;
  return <div className={cls}>{cuerpo}</div>;
}

/** Contenedor de filas con separadores. */
export function Lista({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("card overflow-hidden divide-y divide-brand-border", className)}>{children}</div>;
}

// ------------------------------------------------------------------ botones grandes
export function Boton({ children, onClick, href, tipo = "primario", icono: I, disabled, ocupado, className, type = "button", ...rest }: {
  children: ReactNode; onClick?: () => void; href?: string; tipo?: "primario" | "secundario" | "fantasma" | "peligro";
  icono?: LucideIcon; disabled?: boolean; ocupado?: boolean; className?: string; type?: "button" | "submit";
  "data-voi"?: string;
}) {
  const base = "btn min-h-[56px] px-5 text-base w-full";
  const estilo = {
    primario: "bg-brand-primary text-white hover:bg-brand-primary-dark active:scale-[0.99] shadow-soft",
    secundario: "bg-white text-brand-ink border border-brand-border hover:border-brand-primary hover:text-brand-primary",
    fantasma: "text-brand-slate hover:bg-brand-bg hover:text-brand-ink",
    peligro: "bg-white text-brand-primary border border-brand-primary/50 hover:bg-brand-primary hover:text-white",
  }[tipo];
  const contenido = <>{ocupado ? <LoaderCircle size={20} className="animate-spin" aria-hidden /> : I && <I size={20} aria-hidden strokeWidth={2.3} className="shrink-0" />}{children}</>;
  if (href) return <Link href={href} className={cx(base, estilo, className)} {...rest}>{contenido}</Link>;
  return <button type={type} onClick={onClick} disabled={disabled || ocupado} className={cx(base, estilo, className)} {...rest}>{contenido}</button>;
}

/** Barra fija abajo con la acción principal de la pantalla (sobre la barra de navegación en el celular). */
export function BarraAccion({ children, conNav = true }: { children: ReactNode; conNav?: boolean }) {
  return (
    <>
      <div className="h-24 md:h-4" aria-hidden />
      <div className={cx("fixed inset-x-0 z-30 md:static md:z-auto md:mt-4",
        conNav ? "bottom-[calc(64px+env(safe-area-inset-bottom))] md:bottom-auto" : "bottom-0 pb-[env(safe-area-inset-bottom)] md:pb-0")}>
        <div className="bg-white/95 backdrop-blur border-t border-brand-border md:border-0 md:bg-transparent px-4 py-3 md:px-0 md:py-0">
          <div className="max-w-screen-sm md:max-w-none mx-auto flex gap-2">{children}</div>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ chips
export function Chips<T extends string>({ opciones, valor, onChange, multiple, etiqueta }: {
  opciones: { v: T; label: string; ayuda?: string }[]; valor: T[]; onChange: (v: T[]) => void; multiple?: boolean; etiqueta?: string;
}) {
  return (
    <div role={multiple ? "group" : "radiogroup"} aria-label={etiqueta} className="flex flex-wrap gap-2">
      {opciones.map((o) => {
        const on = valor.includes(o.v);
        return (
          <button key={o.v} type="button" role={multiple ? "checkbox" : "radio"} aria-checked={on} title={o.ayuda}
            onClick={() => onChange(multiple ? (on ? valor.filter((x) => x !== o.v) : [...valor, o.v]) : [o.v])}
            className={cx("min-h-[44px] px-4 rounded-full border text-sm font-semibold transition-colors inline-flex items-center gap-1.5",
              on ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-graphite border-brand-border hover:border-brand-ink")}>
            {on && multiple && <CircleCheck size={15} aria-hidden />}{o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Vistas excluyentes de una misma pantalla (control segmentado): una sola fila a lo ancho en el celular. */
export function Segmentos<T extends string>({ opciones, valor, onChange, etiqueta }: {
  opciones: { v: T; label: string; n?: number }[]; valor: T; onChange: (v: T) => void; etiqueta: string;
}) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="grid md:inline-grid grid-flow-col auto-cols-fr gap-1 rounded-xl border border-brand-border bg-brand-bg p-1">
      {opciones.map((o) => {
        const on = o.v === valor;
        return (
          <button key={o.v} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.v)}
            className={cx("min-h-[44px] min-w-0 px-2 md:px-4 rounded-lg text-[13px] md:text-sm font-semibold inline-flex items-center justify-center gap-1 transition-colors",
              on ? "bg-white text-brand-ink shadow-sm" : "text-brand-slate hover:text-brand-ink")}>
            <span className="truncate">{o.label}</span>
            {o.n != null && <span className={cx("tabular-nums font-normal", on ? "text-brand-slate" : "text-brand-mist")}>{o.n}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Etiqueta({ children, tono = "gris", icono: I }: { children: ReactNode; tono?: Tono; icono?: LucideIcon }) {
  const c = {
    rojo: "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30",
    naranja: "bg-brand-orange/10 text-[#8A5200] border-brand-orange/40",
    azul: "bg-[#2A78D6]/10 text-[#1D5BA6] border-[#2A78D6]/30",
    verde: "bg-emerald-50 text-emerald-800 border-emerald-200",
    gris: "bg-brand-bg text-brand-slate border-brand-border",
    tinta: "bg-brand-ink text-white border-brand-ink",
  }[tono];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", c)}>
      {I && <I size={12} aria-hidden />}{children}
    </span>
  );
}

// ------------------------------------------------------------------ hoja inferior
/**
 * Una hoja que sube desde abajo (en pantallas anchas, un diálogo centrado). Bloquea el scroll de atrás, se cierra con
 * Escape o tocando afuera (si no está ocupada) y deja la acción principal fija abajo.
 */
export function Hoja({ titulo, sobre, onClose, children, pie, ocupada }: {
  titulo: ReactNode; sobre?: ReactNode; onClose: () => void; children: ReactNode; pie?: ReactNode; ocupada?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Por referencia: la pantalla de atrás se refresca sola (p. ej. mientras transcribe) y no tiene que volver a enfocar la
  // hoja ni sacarle el foco al texto que se está escribiendo.
  const cerrar = useRef({ onClose, ocupada });
  cerrar.current = { onClose, ocupada };
  // Se dibuja en el cliente (el portal necesita el documento).
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  useEffect(() => {
    if (!montado) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !cerrar.current.ocupada) cerrar.current.onClose(); };
    window.addEventListener("keydown", tecla);
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", tecla); };
  }, [montado]);
  if (!montado) return null;
  // Sobre todo lo demás (fuera del contenido de la página, que tiene su propia capa por las transiciones).
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Cerrar" tabIndex={-1} className="absolute inset-0 bg-brand-ink/45 animate-fade"
        onClick={() => { if (!ocupada) onClose(); }} />
      <div ref={panel} tabIndex={-1}
        className="relative w-full md:max-w-xl bg-white rounded-t-2xl md:rounded-xl shadow-elevated flex flex-col max-h-[94dvh] md:max-h-[88vh] outline-none hoja-sube">
        <div className="md:hidden pt-2 flex justify-center" aria-hidden><span className="w-10 h-1.5 rounded-full bg-brand-border" /></div>
        <div className="flex items-start justify-between gap-3 px-5 pt-3 md:pt-5 pb-3 border-b border-brand-border">
          <div className="min-w-0">
            {sobre && <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">{sobre}</div>}
            <h2 className="font-display text-2xl uppercase text-brand-ink leading-tight break-words">{titulo}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={ocupada} aria-label="Cerrar"
            className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-brand-slate hover:bg-brand-bg shrink-0">
            <X size={22} aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {pie && <div className="border-t border-brand-border px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] md:pb-4 flex flex-col-reverse sm:flex-row gap-2">{pie}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ estados
export function Cargando({ filas = 3 }: { filas?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: filas }).map((_, i) => <div key={i} className="h-16 rounded-lg bg-white border border-brand-border animate-pulse" />)}
    </div>
  );
}

export function Fallo({ children, onReintentar }: { children: ReactNode; onReintentar?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-brand-primary/30 bg-brand-primary-light px-4 py-3 text-sm text-brand-primary-dark flex items-start gap-2">
      <TriangleAlert size={18} className="shrink-0 mt-0.5" aria-hidden />
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {onReintentar && <button type="button" className="font-semibold underline shrink-0" onClick={onReintentar}>Reintentar</button>}
    </div>
  );
}

/** Aviso breve que aparece arriba (en el celular, sin tapar la acción de abajo) y se va solo. */
export function useAviso(): [ReactNode, (m: string, tono?: "ok" | "error") => void] {
  const [m, setM] = useState<{ t: string; tono: "ok" | "error"; k: number } | null>(null);
  useEffect(() => {
    if (!m) return;
    const t = setTimeout(() => setM(null), m.tono === "error" ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [m]);
  const nodo = m && (
    <div key={m.k} role="status" aria-live="polite"
      className="fixed z-[60] inset-x-4 top-20 md:top-auto md:bottom-6 md:inset-x-auto md:right-6 md:max-w-sm flex justify-center pointer-events-none">
      <div className={cx("pointer-events-auto rounded-lg shadow-elevated px-4 py-3 text-sm font-semibold flex items-start gap-2 animate-fade",
        m.tono === "ok" ? "bg-brand-ink text-white" : "bg-brand-primary text-white")}>
        {m.tono === "ok" ? <CircleCheck size={18} className="shrink-0" aria-hidden /> : <TriangleAlert size={18} className="shrink-0" aria-hidden />}
        <span className="break-words">{m.t}</span>
      </div>
    </div>
  );
  const avisar = useCallback((t: string, tono: "ok" | "error" = "ok") => setM({ t, tono, k: Date.now() }), []);
  return [nodo, avisar];
}

/** Pasos del coaching: 1 asesor · 2 lo que observaste · 3 compromisos · 4 devolución. */
export function Pasos({ actual, total = 4, nombres }: { actual: number; total?: number; nombres: string[] }) {
  return (
    <div aria-label={`Paso ${actual} de ${total}: ${nombres[actual - 1]}`}>
      <div className="flex gap-1.5" aria-hidden>
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={cx("h-1.5 flex-1 rounded-full", i < actual ? "bg-brand-primary" : "bg-brand-border")} />
        ))}
      </div>
      <div className="mt-1.5 text-[11px] uppercase tracking-wider2 text-brand-slate">Paso {actual} de {total} · <b className="text-brand-ink">{nombres[actual - 1]}</b></div>
    </div>
  );
}

/** Casilla grande (toda la fila se toca). */
export function Casilla({ checked, onChange, children, sub }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; sub?: ReactNode }) {
  return (
    <label className={cx("flex items-start gap-3 min-h-[56px] px-4 py-3 rounded-lg border cursor-pointer select-none transition-colors",
      checked ? "border-brand-ink bg-brand-bg-soft" : "border-brand-border bg-white")}>
      <input type="checkbox" className="mt-0.5 w-6 h-6 accent-[#0F1116] shrink-0" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-brand-ink leading-snug">{children}</span>
        {sub && <span className="block text-xs text-brand-slate mt-0.5 leading-snug">{sub}</span>}
      </span>
    </label>
  );
}

/** «hace 3 h», «ayer», «el 12/10». */
export function hace(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "recién";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  if (s < 2 * 86400) return "ayer";
  return `el ${new Date(iso).toLocaleDateString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit" })}`;
}

/** Hora corta en Asunción («14:05»). */
export function hora(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("es-PY", { timeZone: "America/Asuncion", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export const plural = (k: number, uno: string, varios: string) => `${k} ${k === 1 ? uno : varios}`;
