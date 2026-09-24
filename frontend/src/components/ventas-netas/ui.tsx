"use client";

import type { ReactNode } from "react";
import { ESTADO_LABEL, type EstadoInforme } from "./tipos";
import type { Senal } from "./patrones";

export function EstadoBadge({ estado }: { estado: EstadoInforme }) {
  const cls = estado === "published" ? "badge-success" : estado === "replaced" ? "badge-neutral line-through" : "badge-cyan";
  return <span className={cls}>{ESTADO_LABEL[estado]}</span>;
}

export function Seccion({ titulo, sub, accion, children, className = "" }: {
  titulo: string; sub?: string; accion?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-lg text-brand-ink uppercase leading-tight">{titulo}</h2>
          {sub && <p className="text-xs text-brand-slate mt-0.5">{sub}</p>}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}

export type Col<T> = {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: T) => ReactNode;
  className?: string;
};

/** Tabla compacta con encabezado fijo. `alerta(row)` pinta la fila. */
export function Tabla<T extends Record<string, any>>({ cols, rows, alerta, vacio = "Sin datos", maxAlto, onRowClick }: {
  cols: Col<T>[]; rows: T[]; alerta?: (r: T) => boolean; vacio?: string; maxAlto?: string; onRowClick?: (r: T) => void;
}) {
  if (!rows.length) return <div className="text-sm text-brand-mist py-4">{vacio}</div>;
  const al = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
  return (
    <div className={`overflow-auto ${maxAlto ?? ""}`}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white">
          <tr className="text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
            {cols.map((c) => (
              <th key={c.key} className={`px-3 py-2 font-semibold ${al(c.align)} ${c.className ?? ""}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={`border-b border-brand-border/60 ${alerta?.(r) ? "bg-brand-primary-light/60 hover:bg-brand-primary-light" : "hover:bg-brand-bg/50"} ${onRowClick ? "cursor-pointer" : ""}`}
            >
              {cols.map((c) => (
                <td key={c.key} className={`px-3 py-1.5 ${al(c.align)} ${c.className ?? ""}`}>
                  {c.render ? c.render(r) : r[c.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Barra horizontal de proporción (con uso / sin uso), con etiqueta numérica siempre visible. */
export function BarraUso({ conUso, sinUso }: { conUso: number; sinUso: number }) {
  const total = conUso + sinUso;
  const p = total ? Math.round((conUso / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 rounded-full bg-brand-bg overflow-hidden flex" role="img" aria-label={`${p}% en uso`}>
        <div className="h-full bg-brand-cyan" style={{ width: `${p}%` }} />
        <div className="h-full bg-brand-primary" style={{ width: `${100 - p}%`, marginLeft: p > 0 && p < 100 ? 2 : 0 }} />
      </div>
      <span className="text-xs tabular-nums text-brand-graphite w-10 text-right">{p}%</span>
    </div>
  );
}

/** Píldora de uso: verde si supera el umbral, roja si no. */
export function PctUso({ v, umbral }: { v: number; umbral: number }) {
  const ok = v >= umbral;
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums font-semibold ${ok ? "text-emerald-700" : "text-brand-primary"}`}>
      {!ok && <span aria-hidden>▲</span>}
      {v.toLocaleString("es-PY", { maximumFractionDigits: 1 })}%
    </span>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: {
  value: T; onChange: (v: T) => void; items: { value: T; label: string; hint?: string }[];
}) {
  return (
    <div className="no-print flex gap-1 border-b border-brand-border mb-6" role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={`px-4 py-2.5 -mb-px border-b-2 text-sm font-semibold transition-colors ${
            value === it.value ? "border-brand-primary text-brand-ink" : "border-transparent text-brand-slate hover:text-brand-ink"
          }`}
        >
          {it.label}
          {it.hint && <span className="block text-[10px] font-normal text-brand-mist">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
}

const SENAL_CLS: Record<Senal["gravedad"], string> = {
  alta: "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30",
  media: "bg-brand-orange/10 text-brand-graphite border-brand-orange/40",
  info: "bg-brand-bg text-brand-slate border-brand-border",
};

/** Etiquetas del patrón de comportamiento (alta, media, info), con símbolo además del color. */
export function Senales({ senales }: { senales: Senal[] }) {
  if (!senales.length) return <span className="text-brand-mist text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1 py-0.5">
      {senales.map((s, i) => (
        <span key={i} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] leading-tight ${SENAL_CLS[s.gravedad]}`}>
          <span aria-hidden>{s.gravedad === "alta" ? "▲" : s.gravedad === "media" ? "●" : "○"}</span>
          {s.texto}
        </span>
      ))}
    </div>
  );
}
