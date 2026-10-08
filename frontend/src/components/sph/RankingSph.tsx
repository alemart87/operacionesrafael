"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { n } from "@/components/productividad/tipos";
import { NIVEL, fmtHoras, fmtProductos, fmtSph, type AgenteSph } from "./tipos";

const C_BARRA = "#00B2BF";
const C_INK = "#0F1116";
const EJE = { fontSize: 11, fill: "#5B6275" };
const FILA = 24;

/** Nombre en una sola línea, recortado al ancho del eje (más angosto en el celular). */
function Nombre({ x, y, payload, max }: { x?: number; y?: number; payload?: { value: string }; max: number }) {
  const t = payload?.value ?? "";
  return (
    <text x={(x ?? 0) - 4} y={y} dy={4} textAnchor="end" fontSize={11} fill="#2A2F3A">
      {t.length > max ? `${t.slice(0, max - 1)}…` : t}
      {t.length > max && <title>{t}</title>}
    </text>
  );
}

function useAnchoEje() {
  const [angosto, setAngosto] = useState(false);
  useEffect(() => {
    const medir = () => setAngosto(window.innerWidth < 640);
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);
  return angosto ? { ancho: 118, max: 17 } : { ancho: 196, max: 30 };
}

/**
 * Ranking de SPH por asesor (barras horizontales, una sola tinta). La línea es el promedio de
 * los asesores vinculados: la misma base que cada barra. Un vínculo probable lleva «≈» en el nombre.
 */
export function RankingSph({ agentes, promedio, minHoras }: { agentes: AgenteSph[]; promedio: number | null; minHoras: number }) {
  const datos = agentes
    .filter((a) => a.en_ranking && a.sph !== null)
    .sort((a, b) => (b.sph ?? 0) - (a.sph ?? 0) || (b.netas ?? 0) - (a.netas ?? 0))
    .map((a) => ({ ...a, etiqueta: `${a.nombre}${a.nivel === "probable" ? " ≈" : ""}` }));
  const tope = Math.max(0.5, Math.ceil(((datos[0]?.sph ?? 0) + 0.1) * 10) / 10);
  const eje = useAnchoEje();

  return (
    <section className="card p-5 min-w-0">
      <h3 className="font-display text-base uppercase text-brand-ink leading-tight">SPH por asesor</h3>
      <p className="text-xs text-brand-slate mt-0.5">
        Netas ÷ horas conectadas, asesores con {minHoras} h o más. La línea es el promedio de los asesores vinculados.
        {datos.some((d) => d.nivel === "probable") && <> <b>≈</b> vínculo probable: revisalo en la tabla.</>}
      </p>
      {!datos.length ? (
        <p className="text-sm text-brand-mist py-10 text-center">No hay asesores vinculados con {minHoras} h conectadas o más.</p>
      ) : (
        <div className="mt-3" style={{ height: datos.length * FILA + 40 }}>
          <ResponsiveContainer>
            <BarChart data={datos} layout="vertical" margin={{ left: 4, right: 44, top: 18, bottom: 0 }} barCategoryGap={5}>
              <CartesianGrid horizontal={false} stroke="#eef0f4" />
              <XAxis type="number" domain={[0, tope]} tick={EJE} axisLine={false} tickLine={false}
                tickFormatter={(v) => fmtSph(v)} orientation="top" />
              <YAxis type="category" dataKey="etiqueta" width={eje.ancho} tick={<Nombre max={eje.max} />} axisLine={false} tickLine={false} interval={0} />
              {promedio !== null && (
                // El rótulo va abajo a la derecha de la línea: ahí están los SPH más bajos y no tapa barras.
                <ReferenceLine x={promedio} stroke={C_INK} strokeDasharray="3 3"
                  label={({ viewBox }: { viewBox: { x: number; y: number; height: number } }) => (
                    <text x={viewBox.x + 6} y={viewBox.y + viewBox.height - 6} fontSize={10} fill={C_INK}>Promedio {fmtSph(promedio)}</text>
                  )} />
              )}
              <Tooltip cursor={{ fill: "rgba(0,0,0,.04)" }} content={<Detalle />} />
              <Bar dataKey="sph" fill={C_BARRA} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
                <LabelList dataKey="sph" position="right" formatter={(v: number) => fmtSph(v)} style={{ fontSize: 10, fill: C_INK }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function Detalle({ active, payload }: { active?: boolean; payload?: { payload: AgenteSph }[] }) {
  if (!active || !payload?.length) return null;
  const a = payload[0].payload;
  return (
    <div className="rounded-md border border-brand-border bg-white shadow-elevated px-3 py-2 text-xs max-w-[260px]">
      <div className="font-semibold text-brand-ink">{a.nombre}</div>
      <div className="text-brand-slate">{a.vendedor} · {NIVEL[a.nivel].label.toLowerCase()}</div>
      <div className="mt-1.5 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-brand-slate">SPH</span><b className="text-right">{fmtSph(a.sph)}</b>
        <span className="text-brand-slate">Netas</span><span className="text-right">{n(a.netas ?? 0)}</span>
        <span className="text-brand-slate">Horas</span><span className="text-right">{fmtHoras(a.login)}</span>
      </div>
      {!!a.netas && <div className="text-brand-slate mt-1">{fmtProductos(a.productos)}</div>}
    </div>
  );
}
