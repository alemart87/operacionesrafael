"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fechaCorta, n } from "@/components/productividad/tipos";
import { FranjaDias } from "./ui";
import { fmtHoras, fmtSph, type CoberturaDia, type SerieDia } from "./tipos";

const C_BARRA = "#00B2BF";
const C_INK = "#0F1116";
const EJE = { fontSize: 11, fill: "#5B6275" };

/**
 * SPH de cada día que cuenta en el período (una sola tinta), con el SPH del período como línea
 * de referencia, la franja de días y el detalle en tabla.
 */
export function SerieSph({ serie, sph, desde, hasta, cobertura }: {
  serie: SerieDia[]; sph: number | null; desde: string; hasta: string; cobertura: CoberturaDia[];
}) {
  const datos = serie.map((x) => ({ ...x, etiqueta: fechaCorta(x.fecha) }));
  const tope = Math.max(0.5, Math.ceil((Math.max(...datos.map((d) => d.sph ?? 0), sph ?? 0) + 0.1) * 10) / 10);
  return (
    <section className="card p-5 min-w-0">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-display text-base uppercase text-brand-ink leading-tight">SPH por día</h3>
          <p className="text-xs text-brand-slate mt-0.5">Netas ÷ horas conectadas de cada día que cuenta. La línea es el SPH del período.</p>
        </div>
        <div className="min-w-0 max-w-full"><FranjaDias desde={desde} hasta={hasta} cobertura={cobertura} /></div>
      </div>
      <div className="h-64 mt-4">
        <ResponsiveContainer>
          <BarChart data={datos} margin={{ left: -14, right: 70, top: 18, bottom: 0 }} barCategoryGap="18%">
            <CartesianGrid vertical={false} stroke="#eef0f4" />
            <XAxis dataKey="etiqueta" tick={EJE} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
            <YAxis domain={[0, tope]} tick={EJE} axisLine={false} tickLine={false} tickFormatter={(v) => fmtSph(v)} />
            {sph !== null && (
              <ReferenceLine y={sph} stroke={C_INK} strokeDasharray="3 3"
                label={{ value: `Período ${fmtSph(sph)}`, position: "right", fontSize: 10, fill: C_INK }} />
            )}
            <Tooltip cursor={{ fill: "rgba(0,0,0,.04)" }} content={<Detalle />} />
            <Bar dataKey="sph" fill={C_BARRA} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
              {datos.length <= 16 && (
                <LabelList dataKey="sph" position="top" formatter={(v: number) => (v === null || v === undefined ? "" : fmtSph(v))} style={{ fontSize: 10, fill: C_INK }} />
              )}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 group">
        <summary className="text-xs font-semibold text-brand-primary cursor-pointer select-none">Ver el detalle por día</summary>
        <div className="mt-2 overflow-x-auto -mx-5 px-5">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border text-left">
                <th className="py-2 pr-3">Día</th>
                <th className="py-2 px-3 text-right">Agentes</th>
                <th className="py-2 px-3 text-right">Horas</th>
                <th className="py-2 px-3 text-right">Netas</th>
                <th className="py-2 px-3 text-right" title="Ventas cargadas ese día (sin rechazadas)">Cargadas</th>
                <th className="py-2 pl-3 text-right">SPH</th>
              </tr>
            </thead>
            <tbody>
              {serie.map((x) => (
                <tr key={x.fecha} className="border-b border-brand-border/60">
                  <td className="py-1.5 pr-3 capitalize">{fechaCorta(x.fecha)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{n(x.agentes)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{fmtHoras(x.horas)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{n(x.netas)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{n(x.cargadas)}</td>
                  <td className="py-1.5 pl-3 text-right tabular-nums font-semibold">{fmtSph(x.sph)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function Detalle({ active, payload }: { active?: boolean; payload?: { payload: SerieDia }[] }) {
  if (!active || !payload?.length) return null;
  const x = payload[0].payload;
  return (
    <div className="rounded-md border border-brand-border bg-white shadow-elevated px-3 py-2 text-xs">
      <div className="font-semibold text-brand-ink capitalize">{fechaCorta(x.fecha)}</div>
      <div className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-brand-slate">SPH</span><b className="text-right">{fmtSph(x.sph)}</b>
        <span className="text-brand-slate">Netas</span><span className="text-right">{n(x.netas)}</span>
        <span className="text-brand-slate">Horas</span><span className="text-right">{fmtHoras(x.horas)}</span>
        <span className="text-brand-slate">Agentes</span><span className="text-right">{n(x.agentes)}</span>
      </div>
    </div>
  );
}
