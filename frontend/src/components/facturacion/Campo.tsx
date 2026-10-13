"use client";

import { NumeroInput } from "./NumeroInput";

/** Fila "etiqueta · ayuda · input" de los paneles de variables (pospago y GPON).
 *  La columna derecha tiene SIEMPRE el mismo ancho (input de 120 px + hueco de 20 px para el
 *  sufijo, aunque no haya sufijo) para que todos los cuadros seteables queden alineados en vertical. */
export function Campo({ label, hint, value, onChange, step = 1, suffix, min, destacado, className = "" }: {
  label: string; hint?: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string; min?: number;
  destacado?: "orange" | "primary"; className?: string;
}) {
  const color = destacado === "orange" ? "text-brand-orange" : destacado === "primary" ? "text-brand-primary" : "";
  const borde = destacado === "orange" ? "border-brand-orange" : destacado === "primary" ? "border-brand-primary" : "";
  return (
    <label className={`flex items-center gap-3 ${destacado ? `rounded-md border-2 ${borde} ${destacado === "orange" ? "bg-brand-orange/5" : "bg-brand-primary/5"} px-2 py-1.5` : ""} ${className}`}>
      <span className="flex-1 min-w-0">
        <span className={`block text-sm ${destacado ? `font-bold ${color}` : "text-brand-ink"}`}>{label}</span>
        {hint && <span className={`block text-[10px] ${destacado ? `${color} opacity-80` : "text-brand-slate"}`}>{hint}</span>}
      </span>
      <span className="flex items-center gap-1 shrink-0">
        <NumeroInput step={step} min={min} value={value} onChange={onChange}
          className={`input w-[120px] !py-1 text-sm text-right ${destacado ? `font-bold ${color} ${borde}` : ""}`} />
        <span className="text-xs text-brand-slate w-5 text-left">{suffix ?? ""}</span>
      </span>
    </label>
  );
}
