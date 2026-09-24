"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatGs } from "@/lib/format";

/** Gráfico de cascada (waterfall) para los momentos de la liquidación: cada paso suma o resta
 *  sobre el anterior y los "totales" arrancan desde cero. Ejecutivo: valores en millones sobre cada barra. */
export type PasoCascada = { nombre: string; valor: number; tipo?: "delta" | "total"; color?: string; corto?: string };
/** Zona del gráfico: agrupa pasos consecutivos (índices desde..hasta) con un sombreado de fondo y una etiqueta. */
export type ZonaCascada = { nombre: string; desde: number; hasta: number; color: string; descripcion?: string };

const M = (v: number) => `${v < 0 ? "−" : ""}${Math.round(Math.abs(v) / 1e6)}M`;

export function Cascada({ pasos, zonas = [], altura = 300, colorTotal = "#0F1116" }: { pasos: PasoCascada[]; zonas?: ZonaCascada[]; altura?: number; colorTotal?: string }) {
  let acum = 0;
  const data = pasos.map((p) => {
    const esTotal = p.tipo === "total";
    let base: number, alto: number, fin: number;
    if (esTotal) {
      acum = p.valor; base = Math.min(0, p.valor); alto = Math.abs(p.valor); fin = p.valor;
    } else {
      const ini = acum; fin = acum + p.valor; acum = fin;
      base = Math.min(ini, fin); alto = Math.abs(p.valor);
    }
    const color = p.color ?? (esTotal ? colorTotal : p.valor >= 0 ? "#10B981" : "#E6332A");
    return { nombre: p.corto ?? p.nombre, nombreLargo: p.nombre, base, alto, fin, valor: esTotal ? p.valor : p.valor, color, esTotal };
  });
  const valores = data.flatMap((d) => [d.base, d.base + d.alto, 0]);
  const min = Math.min(...valores), max = Math.max(...valores);
  const margen = (max - min) * 0.12;
  const topExtra = zonas.length ? 0.16 : 0;
  const domMax = Math.ceil((max + margen + (max - min) * topExtra) / 1e8) * 1e8;
  const domMin = Math.floor((min - margen) / 1e8) * 1e8;
  return (
    <div>
    <div className="overflow-x-auto"><div className="min-w-[620px]">
    <ResponsiveContainer width="100%" height={altura}>
      <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 4 }} barCategoryGap="22%">
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
        {zonas.map((z, i) => (
          <ReferenceArea key={i} x1={data[z.desde]?.nombre} x2={data[z.hasta]?.nombre} y1={domMin} y2={domMax} fill={z.color} fillOpacity={0.13}
            stroke={z.color} strokeOpacity={0.35} strokeDasharray="4 3" ifOverflow="visible"
            label={{ value: z.nombre.toUpperCase(), position: "insideTop", fontSize: 10, fontWeight: 800, fill: z.color, offset: 6 }} />
        ))}
        <XAxis dataKey="nombre" fontSize={10} interval={0} tick={{ fill: "#4B5563" }} />
        <YAxis fontSize={10} tickFormatter={M} domain={[domMin, domMax]} width={44} />
        <Tooltip
          formatter={(_: any, __: any, item: any) => [formatGs(item.payload.valor), item.payload.esTotal ? "Total" : item.payload.valor >= 0 ? "Suma" : "Resta"]}
          labelFormatter={(_, payload: any) => payload?.[0]?.payload?.nombreLargo ?? ""}
        />
        <ReferenceLine y={0} stroke="#0F1116" />
        <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="alto" stackId="w" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={d.esTotal ? 1 : 0.85} />)}
          <LabelList dataKey="valor" position="top" fontSize={11} fontWeight={700} formatter={(v: any) => M(Number(v))} fill="#0F1116" />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </div></div>
    {zonas.length > 0 && (
      <div className="grid gap-2 mt-2 grid-cols-1 md:grid-cols-3">
        {zonas.map((z, i) => (
          <div key={i} className="rounded-md px-3 py-2 border-l-4" style={{ background: `${z.color}14`, borderLeftColor: z.color }}>
            <div className="text-[10px] uppercase tracking-wider2 font-extrabold" style={{ color: z.color }}>{z.nombre}</div>
            {z.descripcion && <div className="text-[11px] text-brand-ink leading-snug">{z.descripcion}</div>}
          </div>
        ))}
      </div>
    )}
    </div>
  );
}
