"use client";

import { formatGs } from "@/lib/format";

/** Explicación "cuadro por cuadro" de los KPIs de los simuladores de facturación
 *  (Televentas Claro) y veredicto final del negocio con todas las caídas. */

export type CuadroExplicado = {
  label: string;
  valor: string;
  queEs: string;
  comoLeerlo: string;
  accent?: "primary" | "cyan" | "orange" | "purple" | "neutral" | "ink";
};

const BORDE: Record<NonNullable<CuadroExplicado["accent"]>, string> = {
  primary: "border-brand-primary",
  cyan: "border-sky-500",
  orange: "border-brand-orange",
  purple: "border-brand-purple",
  neutral: "border-brand-slate",
  ink: "border-brand-ink",
};

export function ExplicacionCuadros({ titulo, intro, items, sinCard }: { titulo?: string; intro?: string; items: CuadroExplicado[]; sinCard?: boolean }) {
  const Wrapper = sinCard ? "div" : "section";
  return (
    <Wrapper className={sinCard ? "" : "card p-5"}>
      {!sinCard && <h2 className="font-display text-lg text-brand-ink uppercase mb-1">{titulo ?? "Qué significa cada cuadro"}</h2>}
      {intro && <p className="text-xs text-brand-slate mb-3">{intro}</p>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {items.map((it) => (
          <div key={it.label} className={`rounded-md border border-brand-border border-l-4 ${BORDE[it.accent ?? "neutral"]} bg-white px-3 py-2.5`}>
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate">{it.label}</div>
              <div className="font-mono text-xs font-semibold text-brand-ink whitespace-nowrap">{it.valor}</div>
            </div>
            <p className="text-[12px] text-brand-ink leading-snug mt-1"><b>Qué es:</b> {it.queEs}</p>
            <p className="text-[12px] text-brand-graphite leading-snug mt-1"><b>Cómo leerlo:</b> {it.comoLeerlo}</p>
          </div>
        ))}
      </div>
    </Wrapper>
  );
}

export type PasoPuente = {
  label: string;
  valor: number;
  tipo: "base" | "mas" | "menos" | "sub" | "final";
  nota?: string;
};

/** Veredicto: ¿ganamos o perdemos cuando cayeron todas las caídas? Con el puente
 *  desde lo facturado hasta el resultado final, paso a paso. */
export function VeredictoCierre({ gana, monto, titulo, respuesta, pasos, notas, sinCard }: {
  gana: boolean;
  monto: number;
  titulo: string;
  respuesta: string;
  pasos: PasoPuente[];
  notas: string[];
  sinCard?: boolean;
}) {
  return (
    <section className={sinCard ? `rounded-md p-4 border-2 ${gana ? "border-emerald-500 bg-emerald-50/40" : "border-brand-primary bg-brand-primary/5"}` : `card p-5 border-2 ${gana ? "border-emerald-500 bg-emerald-50/40" : "border-brand-primary bg-brand-primary/5"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[240px] flex-1">
          {!sinCard && <h2 className="text-[11px] uppercase tracking-wider2 text-brand-slate font-bold">{titulo}</h2>}
          <div className={`font-display text-3xl uppercase mt-1 ${gana ? "text-emerald-700" : "text-brand-primary"}`}>
            {gana ? "Ganamos" : "Perdemos"} {formatGs(Math.abs(monto))}
          </div>
          <p className="text-[14px] text-brand-ink leading-relaxed mt-2 font-medium">{respuesta}</p>
          <ul className="mt-3 space-y-1.5">
            {notas.map((n, i) => (
              <li key={i} className="text-[12px] text-brand-graphite leading-snug pl-3 border-l-2 border-brand-border">{n}</li>
            ))}
          </ul>
        </div>
        <div className="w-full lg:w-[420px] rounded-md border border-brand-border bg-white overflow-hidden">
          <div className="px-3 py-1.5 bg-brand-bg text-[9px] uppercase tracking-wider2 text-brand-slate font-bold">De lo facturado al resultado final</div>
          <table className="w-full text-[12px]">
            <tbody>
              {pasos.map((s, i) => {
                const cls = s.tipo === "final"
                  ? `font-bold ${gana ? "bg-emerald-600 text-white" : "bg-brand-primary text-white"}`
                  : s.tipo === "sub" ? "bg-brand-bg-soft font-semibold border-t border-brand-border"
                  : s.tipo === "base" ? "font-semibold" : "";
                const signo = s.tipo === "mas" ? "+" : s.tipo === "menos" ? "−" : "=";
                const mostrar = s.tipo === "mas" || s.tipo === "menos" ? Math.abs(s.valor) : s.valor;
                return (
                  <tr key={i} className={cls}>
                    <td className="px-3 py-1.5 align-top">
                      <span className={`inline-block w-4 ${s.tipo === "final" ? "" : "text-brand-slate"}`}>{s.tipo === "base" ? "" : signo}</span>
                      {s.label}
                      {s.nota && <div className={`text-[10px] font-normal ${s.tipo === "final" ? "text-white/80" : "text-brand-slate"}`}>{s.nota}</div>}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-mono whitespace-nowrap align-top ${s.tipo !== "final" && s.valor < 0 && s.tipo !== "menos" ? "text-brand-primary" : ""}`}>
                      {formatGs(mostrar)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
