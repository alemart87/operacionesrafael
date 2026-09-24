"use client";

import { useState } from "react";

/** Sección plegable del simulador: se abre al tocar el título. En la impresión
 *  siempre sale abierta. `envuelto=false` deja el contenido fuera de la tarjeta
 *  (para bloques que ya son tarjetas: gráficos, EERR). */
export function Bloque({ titulo, hint, abierto = false, envuelto = true, accent = "ink", children }: {
  titulo: string; hint?: React.ReactNode; abierto?: boolean; envuelto?: boolean;
  accent?: "ink" | "primary" | "purple" | "orange"; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(abierto);
  const borde = { ink: "border-l-brand-ink", primary: "border-l-brand-primary", purple: "border-l-brand-purple", orange: "border-l-brand-orange" }[accent];
  const header = (
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
      className={`w-full flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-left border-l-4 ${borde} hover:bg-brand-bg-soft transition-colors`}>
      <span className="flex items-center gap-2.5 min-w-0">
        <span className={`no-print text-brand-slate text-sm transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        <span className="font-display text-lg text-brand-ink uppercase leading-tight">{titulo}</span>
      </span>
      {hint && <span className="text-[11px] text-brand-slate">{hint}</span>}
    </button>
  );
  const cuerpo = `${open ? "" : "hidden"} print:block`;
  if (envuelto) {
    return (
      <section className="card overflow-hidden">
        {header}
        <div className={`${cuerpo} px-5 pb-5 pt-2 border-t border-brand-border`}>{children}</div>
      </section>
    );
  }
  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">{header}</div>
      <div className={`${cuerpo} space-y-6`}>{children}</div>
    </div>
  );
}
