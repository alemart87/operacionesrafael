"use client";

/** Bloque "Cómo leer este gráfico" — guía de lectura en lenguaje claro debajo de cada gráfico. */
export function Lectura({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-md bg-brand-bg-soft border border-brand-border px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate mb-1">Cómo leer este gráfico</div>
      <p className="text-xs text-brand-graphite leading-relaxed">{children}</p>
    </div>
  );
}
