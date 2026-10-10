"use client";

import { useEffect, useState, type ReactNode } from "react";

/** Una sección del informe, numerada: el orden en que se arma. */
export function Seccion({ n, titulo, sub, accion, children, id }: {
  n?: number; titulo: string; sub?: ReactNode; accion?: ReactNode; children: ReactNode; id?: string;
}) {
  return (
    <section id={id} className="card min-w-0 scroll-mt-24">
      <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          {n !== undefined && (
            <span className="w-7 h-7 rounded-full bg-brand-ink text-white font-display text-base flex items-center justify-center shrink-0 mt-0.5" aria-hidden>
              {n}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">{titulo}</h2>
            {sub && <p className="text-xs text-brand-slate mt-0.5 leading-relaxed">{sub}</p>}
          </div>
        </div>
        {accion}
      </div>
      <div className="px-4 sm:px-5 pb-4 sm:pb-5">{children}</div>
    </section>
  );
}

/** Número con teclado numérico en el celular: acepta coma o punto decimal; vacío = sin dato. */
export function CampoNumero({ id, valor, onChange, placeholder, className = "", grande, label }: {
  id: string; valor: number | null; onChange: (v: number | null) => void; placeholder?: string; className?: string; grande?: boolean; label?: string;
}) {
  const aTexto = (v: number | null) => (v === null || v === undefined ? "" : String(v).replace(".", ","));
  const [texto, setTexto] = useState(aTexto(valor));
  const [foco, setFoco] = useState(false);
  useEffect(() => { if (!foco) setTexto(aTexto(valor)); }, [valor, foco]);
  const cambiar = (t: string) => {
    const limpio = t.replace(/[^\d.,]/g, "");
    setTexto(limpio);
    if (!limpio.trim()) return onChange(null);
    const n = Number(limpio.replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(n) && n >= 0 && n <= 1_000_000) onChange(n);
  };
  return (
    <input id={id} type="text" inputMode="decimal" autoComplete="off" aria-label={label} placeholder={placeholder}
      className={`input tabular-nums ${grande ? "!text-3xl sm:!text-4xl !font-display !py-2 text-brand-ink" : ""} ${className}`}
      value={texto} onFocus={() => setFoco(true)} onBlur={() => setFoco(false)} onChange={(e) => cambiar(e.target.value)} />
  );
}

/** Opciones excluyentes como botones (con teclado y lector de pantalla: radiogroup). */
export function Segmentado<T extends string>({ valor, opciones, onChange, etiqueta, chico }: {
  valor: T | null; opciones: { v: T; label: string; activo: string }[]; onChange: (v: T) => void; etiqueta: string; chico?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="inline-flex flex-wrap gap-1.5">
      {opciones.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={valor === o.v} onClick={() => onChange(o.v)}
          className={`rounded-full border font-semibold transition-colors ${chico ? "px-2.5 py-0.5 text-[11px]" : "px-3 py-1 text-xs"} ${
            valor === o.v ? o.activo : "border-brand-border text-brand-graphite hover:border-brand-slate bg-white"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ children, chip, title, icono }: { children: ReactNode; chip: string; title?: string; icono?: ReactNode }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0 text-[10px] font-semibold whitespace-nowrap ${chip}`}>
      {icono}{children}
    </span>
  );
}
