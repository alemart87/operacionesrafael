"use client";

import { Check, CheckSquare2, Copy, Eye, Lightbulb, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { SEVERIDAD_CLS, SEVERIDAD_LABEL, type Severidad } from "../tipos";

/** Sección numerada de la guía (ancla para el índice). */
export function Seccion({ id, num, titulo, lead, children }: { id: string; num: string; titulo: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-36 guia-seccion">
      <div className="flex items-baseline gap-3 border-b-2 border-brand-ink pb-2 mb-3">
        <span className="font-display text-3xl sm:text-4xl text-brand-primary leading-none">{num}</span>
        <h2 className="font-display text-[26px] sm:text-4xl text-brand-ink uppercase leading-none min-w-0">{titulo}</h2>
      </div>
      {lead && <p className="text-[15px] leading-relaxed text-brand-graphite max-w-4xl mb-6">{lead}</p>}
      <div className="space-y-6">{children}</div>
    </section>
  );
}

/** Subtítulo dentro de una sección. */
export function Sub({ children, icono }: { children: ReactNode; icono?: ReactNode }) {
  return (
    <h3 className="font-display text-xl text-brand-ink uppercase leading-tight flex items-center gap-2">
      {icono && <span className="text-brand-primary">{icono}</span>}
      {children}
    </h3>
  );
}

const SIMBOLO: Record<Severidad, string> = { alta: "▲", media: "●", baja: "○", info: "○" };

/** Chip de severidad con el mismo código visual que hallazgos y datos llamativos. */
export function SevChip({ s, children }: { s: Severidad; children?: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold leading-tight whitespace-nowrap ${SEVERIDAD_CLS[s]}`}>
      <span aria-hidden>{SIMBOLO[s]}</span>
      {children ?? SEVERIDAD_LABEL[s]}
    </span>
  );
}

const CALLOUT = {
  caso: { cls: "border-l-brand-cyan bg-brand-cyan/5", kicker: "text-brand-cyan", icono: <Eye size={15} /> },
  ojo: { cls: "border-l-brand-orange bg-brand-orange/5", kicker: "text-[#B86E00]", icono: <TriangleAlert size={15} /> },
  clave: { cls: "border-l-brand-primary bg-brand-primary-light/50", kicker: "text-brand-primary-dark", icono: <Lightbulb size={15} /> },
};

/** Recuadro destacado: caso testigo (datos reales), "ojo" (trampa de lectura) o idea clave. */
export function Callout({ tipo, titulo, children }: { tipo: keyof typeof CALLOUT; titulo: string; children: ReactNode }) {
  const c = CALLOUT[tipo];
  return (
    <aside className={`card border-l-4 ${c.cls} p-4`}>
      <div className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider2 ${c.kicker}`}>{c.icono}{titulo}</div>
      <div className="text-sm text-brand-graphite leading-relaxed mt-1.5">{children}</div>
    </aside>
  );
}

/** Lista de verificaciones con casilla (se imprime para tildar a mano). */
export function Verificar({ titulo = "Qué verificar", items }: { titulo?: string; items: ReactNode[] }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider2 text-brand-ink mb-2 flex items-center gap-1.5"><CheckSquare2 size={15} className="text-brand-primary" />{titulo}</div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-brand-graphite leading-snug">
            <span className="mt-0.5 inline-block w-3.5 h-3.5 shrink-0 rounded-[3px] border-2 border-brand-slate/60" aria-hidden />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Recomendación tipo, con botón para copiarla y pegarla en un hallazgo. */
export function Recomendacion({ titulo = "Recomendación", texto, extra }: { titulo?: string; texto: string; extra?: ReactNode }) {
  return (
    <div className="card p-4 border-l-4 border-l-brand-ink">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-wider2 text-brand-ink">{titulo}</div>
        <CopiarTexto texto={texto} />
      </div>
      <p className="text-sm text-brand-graphite leading-relaxed mt-1.5">{texto}</p>
      {extra}
    </div>
  );
}

export function CopiarTexto({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setOk(true);
      setTimeout(() => setOk(false), 1600);
    } catch { /* sin permiso de portapapeles: no pasa nada */ }
  };
  return (
    <button type="button" onClick={copiar} className="no-print inline-flex items-center gap-1 text-[11px] font-semibold text-brand-slate hover:text-brand-primary whitespace-nowrap" title="Copiar para pegar en un hallazgo">
      {ok ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}{ok ? "Copiado" : "Copiar"}
    </button>
  );
}

/** Mini-visual de los patrones: ráfaga (un día pico), concentración (dona), umbral (barra con corte) o recientes/antiguas. */
export function MiniVisual({ tipo, pct = 0 }: { tipo: "rafaga" | "concentracion" | "umbral" | "reloj" | "portacion"; pct?: number }) {
  if (tipo === "rafaga") {
    const h = [8, 12, 6, 34, 10, 7, 9];
    return (
      <svg viewBox="0 0 84 40" className="w-[84px] h-10" aria-hidden>
        {h.map((v, i) => <rect key={i} x={i * 12} y={40 - v} width="8" height={v} rx="1.5" fill={v > 30 ? "#E6332A" : "#9CA3AF"} />)}
      </svg>
    );
  }
  if (tipo === "concentracion") {
    const r = 15, c = 2 * Math.PI * r, largo = (c * Math.min(pct, 100)) / 100;
    return (
      <svg viewBox="0 0 40 40" className="w-10 h-10" aria-hidden>
        <circle cx="20" cy="20" r={r} fill="none" stroke="#E5E7EB" strokeWidth="7" />
        <circle cx="20" cy="20" r={r} fill="none" stroke="#E6332A" strokeWidth="7" strokeDasharray={`${largo} ${c}`} transform="rotate(-90 20 20)" />
        <text x="20" y="23" textAnchor="middle" fontSize="9" fontWeight="700" fill="#0F1116">{pct}%</text>
      </svg>
    );
  }
  if (tipo === "umbral") {
    return (
      <svg viewBox="0 0 84 40" className="w-[84px] h-10" aria-hidden>
        <rect x="0" y="14" width="84" height="12" rx="3" fill="#E5E7EB" />
        <rect x="0" y="14" width={(84 * pct) / 100 * 0.62} height="12" rx="3" fill="#D6336C" />
        <line x1={(84 * pct) / 100} y1="6" x2={(84 * pct) / 100} y2="34" stroke="#0F1116" strokeWidth="2" strokeDasharray="3 2" />
      </svg>
    );
  }
  if (tipo === "portacion") {
    return (
      <svg viewBox="0 0 84 40" className="w-[84px] h-10" aria-hidden>
        <circle cx="12" cy="20" r="7" fill="#7B3FA0" />
        <path d="M22 20 H58" stroke="#9CA3AF" strokeWidth="2" strokeDasharray="4 3" />
        <path d="M56 15 L63 20 L56 25" fill="none" stroke="#9CA3AF" strokeWidth="2" />
        <circle cx="72" cy="20" r="7" fill="#D6336C" />
      </svg>
    );
  }
  // reloj: días desde la activación, recientes en gris y antiguas en rojo
  return (
    <svg viewBox="0 0 84 40" className="w-[84px] h-10" aria-hidden>
      {Array.from({ length: 7 }).map((_, i) => <rect key={i} x={i * 12} y="12" width="10" height="16" rx="2" fill={i < 3 ? "#D1D5DB" : "#E6332A"} opacity={i < 3 ? 1 : 0.55 + i * 0.07} />)}
    </svg>
  );
}
