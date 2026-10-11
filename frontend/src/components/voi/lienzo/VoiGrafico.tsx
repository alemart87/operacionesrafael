"use client";

/**
 * Dibuja una pieza del lienzo de Voi (gráfico, indicadores o tabla) con las reglas de visualización de la plataforma:
 * marcas finas (barras ≤ 24 px con punta redondeada, líneas de 2 px), grilla recesiva, una serie sin leyenda y dos o
 * más con leyenda, color por serie (nunca por posición), resaltado de una categoría, tooltips que muestran todas las
 * series y, siempre, la tabla de datos como alternativa.
 */
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Minus } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, Pie, PieChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { FormatoVoi, aNumero, formatear, formatearEje } from "@/lib/voiFormato";
import { BUENO, ColumnaVoi, EJE, GRILLA, GRIS, MALO, PiezaVoi, SERIES, TINTA, nombreX } from "./tipos";

const color = (i: number) => SERIES[i % SERIES.length];
const TICK = { fontSize: 11, fill: EJE };

// ------------------------------------------------------------------ tooltip
function TooltipVoi({ active, payload, label, formato, x }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-brand-border bg-white px-3 py-2 shadow-elevated text-xs min-w-[140px]">
      {label !== undefined && <div className="text-brand-slate mb-1">{x ? String(label) : label}</div>}
      <div className="space-y-0.5">
        {payload.map((p: any) => (
          <div key={p.dataKey ?? p.name} className="flex items-center gap-2">
            <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: p.color ?? p.payload?.fill }} />
            <span className="font-semibold text-brand-ink tabular-nums">{formatear(p.value, formato)}</span>
            {payload.length > 1 || p.name !== undefined ? <span className="text-brand-slate truncate">{p.name}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function LeyendaVoi({ series, linea = false }: { series: { nombre: string; color: string }[]; linea?: boolean }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-brand-graphite mb-2">
      {series.map((s) => (
        <span key={s.nombre} className="inline-flex items-center gap-1.5">
          <span className={linea ? "inline-block w-3.5 h-0.5 rounded-full" : "inline-block w-2.5 h-2.5 rounded-[3px]"} style={{ background: s.color }} />
          {s.nombre}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ indicadores
export function Kpis({ spec }: { spec: PiezaVoi }) {
  const kpis = spec.kpis ?? [];
  return (
    <div className={`grid gap-3 ${kpis.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : kpis.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}>
      {kpis.map((k) => {
        const v = k.variacion;
        const bueno = v === null || v === undefined || v === 0 ? null : (v > 0) === (k.bueno_si === "sube");
        const Flecha = !v ? Minus : v > 0 ? ArrowUp : ArrowDown;
        return (
          <div key={k.titulo} className="rounded-xl border border-brand-border bg-white p-4">
            <div className="text-xs text-brand-slate">{k.titulo}</div>
            <div className="mt-1 text-2xl font-semibold text-brand-ink leading-tight">{formatear(k.valor, k.formato)}</div>
            {(v !== null && v !== undefined) || k.detalle ? (
              <div className="mt-1 flex items-center gap-1.5 text-xs">
                {v !== null && v !== undefined && (
                  <span className="inline-flex items-center gap-0.5 font-semibold" style={{ color: bueno === null ? EJE : bueno ? BUENO : MALO }}
                    title={bueno === null ? "Sin cambio" : bueno ? "Cambio favorable" : "Cambio desfavorable"}>
                    <Flecha size={12} /> {formatear(Math.abs(v), "porcentaje")}
                  </span>
                )}
                {k.detalle && <span className="text-brand-slate truncate">{k.detalle}</span>}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ tabla
export function TablaVoi({ spec, maxAlto = 420 }: { spec: PiezaVoi; maxAlto?: number }) {
  const columnas: ColumnaVoi[] = spec.columnas ?? (spec.x ? [{ campo: spec.x, nombre: nombreX(spec), formato: "texto" as FormatoVoi },
    ...(spec.series ?? []).map((s) => ({ campo: s.campo, nombre: s.nombre, formato: spec.formato }))] : []);
  const [orden, setOrden] = useState<{ campo: string; asc: boolean } | null>(null);
  const filas = useMemo(() => {
    const d = [...(spec.datos ?? [])];
    if (orden) {
      d.sort((a, b) => {
        const va = a[orden.campo], vb = b[orden.campo];
        const na = typeof va === "number" ? va : aNumero(va), nb = typeof vb === "number" ? vb : aNumero(vb);
        const r = na !== null && nb !== null ? na - nb : String(va ?? "").localeCompare(String(vb ?? ""), "es");
        return orden.asc ? r : -r;
      });
    }
    return d;
  }, [spec.datos, orden]);
  return (
    <div className="overflow-auto rounded-lg border border-brand-border" style={{ maxHeight: maxAlto }}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-brand-bg z-[1]">
          <tr>
            {columnas.map((c) => {
              const num = c.formato !== "texto";
              const activo = orden?.campo === c.campo;
              return (
                <th key={c.campo} className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate whitespace-nowrap ${num ? "text-right" : "text-left"}`}>
                  <button type="button" className={`inline-flex items-center gap-1 hover:text-brand-ink ${num ? "flex-row-reverse" : ""}`}
                    onClick={() => setOrden(activo ? { campo: c.campo, asc: !orden!.asc } : { campo: c.campo, asc: !num })}>
                    {c.nombre}
                    {activo ? (orden!.asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <span className="w-3" />}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-t border-brand-border even:bg-brand-bg-soft">
              {columnas.map((c) => (
                <td key={c.campo} className={`px-3 py-1.5 whitespace-nowrap ${c.formato !== "texto" ? "text-right tabular-nums" : "text-brand-graphite"}`}>
                  {c.formato !== "texto" && !c.crudo
                    ? formatear(typeof f[c.campo] === "number" ? f[c.campo] : aNumero(f[c.campo]), c.formato)
                    : String(f[c.campo] ?? "—") || "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ gráficos
function anchoEtiquetas(datos: Record<string, any>[], x: string): number {
  const largo = Math.max(...datos.map((d) => String(d[x] ?? "").length), 4);
  return Math.min(190, Math.max(56, largo * 6.6 + 12));
}

function Barras({ spec, compacto }: { spec: PiezaVoi; compacto?: boolean }) {
  const datos = spec.datos ?? [];
  const x = spec.x!;
  const series = spec.series ?? [];
  const una = series.length === 1;
  const grosor = Math.min(22, una ? 20 : Math.floor(28 / series.length) + 4);
  const filaAlto = una ? 30 : series.length * (grosor + 2) + 12;
  const alto = Math.max(140, datos.length * filaAlto + 36);
  return (
    <>
      <LeyendaVoi series={series.map((s, i) => ({ nombre: s.nombre, color: color(i) }))} />
      <ResponsiveContainer width="100%" height={compacto ? Math.min(alto, 320) : alto}>
        <BarChart data={datos} layout="vertical" margin={{ top: 4, right: una ? 64 : 16, bottom: 4, left: 4 }} barGap={2} barCategoryGap={una ? "24%" : "18%"}>
          <CartesianGrid horizontal={false} stroke={GRILLA} />
          <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} tickFormatter={(v) => formatearEje(v, spec.formato)} />
          <YAxis type="category" dataKey={x} width={anchoEtiquetas(datos, x)} tick={{ ...TICK, fill: TINTA }} tickLine={false} axisLine={{ stroke: GRILLA }} interval={0} />
          <Tooltip cursor={{ fill: "rgba(15,17,22,0.04)" }} content={<TooltipVoi formato={spec.formato} />} />
          {spec.meta !== undefined && (
            <ReferenceLine x={spec.meta} stroke={EJE} strokeDasharray="4 4" label={{ value: spec.meta_nombre ?? "Meta", position: "top", fill: EJE, fontSize: 11 }} />
          )}
          {series.map((s, i) => (
            <Bar key={s.campo} dataKey={s.campo} name={s.nombre} fill={color(i)} barSize={grosor} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {una && spec.destacar && datos.map((d, j) => <Cell key={j} fill={d[x] === spec.destacar ? color(0) : GRIS} />)}
              {una && datos.length <= 30 && (
                <LabelList dataKey={s.campo} position="right" formatter={(v: number) => formatear(v, spec.formato)} style={{ fontSize: 11, fill: TINTA }} />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

function Columnas({ spec, compacto, apiladas }: { spec: PiezaVoi; compacto?: boolean; apiladas?: boolean }) {
  const datos = spec.datos ?? [];
  const x = spec.x!;
  const series = spec.series ?? [];
  const una = series.length === 1;
  const ultima = series.length - 1;
  return (
    <>
      <LeyendaVoi series={series.map((s, i) => ({ nombre: s.nombre, color: color(i) }))} />
      <ResponsiveContainer width="100%" height={compacto ? 240 : 360}>
        <BarChart data={datos} margin={{ top: una ? 18 : 8, right: 8, bottom: 0, left: 4 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={GRILLA} />
          <XAxis dataKey={x} tick={TICK} tickLine={false} axisLine={{ stroke: GRILLA }} interval="preserveStartEnd" minTickGap={8} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => formatearEje(v, spec.formato)} />
          <Tooltip cursor={{ fill: "rgba(15,17,22,0.04)" }} content={<TooltipVoi formato={spec.formato} />} />
          {spec.meta !== undefined && !apiladas && (
            <ReferenceLine y={spec.meta} stroke={EJE} strokeDasharray="4 4" label={{ value: spec.meta_nombre ?? "Meta", position: "insideTopRight", fill: EJE, fontSize: 11 }} />
          )}
          {series.map((s, i) => (
            <Bar key={s.campo} dataKey={s.campo} name={s.nombre} fill={color(i)} maxBarSize={24} isAnimationActive={false}
              stackId={apiladas ? "a" : undefined} radius={apiladas ? (i === ultima ? [4, 4, 0, 0] : [0, 0, 0, 0]) : [4, 4, 0, 0]}
              stroke={apiladas ? "#FFFFFF" : undefined} strokeWidth={apiladas ? 2 : 0}>
              {una && spec.destacar && datos.map((d, j) => <Cell key={j} fill={d[x] === spec.destacar ? color(0) : GRIS} />)}
              {una && datos.length <= 14 && (
                <LabelList dataKey={s.campo} position="top" formatter={(v: number) => formatear(v, spec.formato)} style={{ fontSize: 11, fill: TINTA }} />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

function ApiladasHorizontal({ spec, compacto }: { spec: PiezaVoi; compacto?: boolean }) {
  const datos = spec.datos ?? [];
  const x = spec.x!;
  const series = spec.series ?? [];
  const alto = Math.max(140, datos.length * 30 + 36);
  return (
    <>
      <LeyendaVoi series={series.map((s, i) => ({ nombre: s.nombre, color: color(i) }))} />
      <ResponsiveContainer width="100%" height={compacto ? Math.min(alto, 320) : alto}>
        <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap="24%">
          <CartesianGrid horizontal={false} stroke={GRILLA} />
          <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} tickFormatter={(v) => formatearEje(v, spec.formato)} />
          <YAxis type="category" dataKey={x} width={anchoEtiquetas(datos, x)} tick={{ ...TICK, fill: TINTA }} tickLine={false} axisLine={{ stroke: GRILLA }} interval={0} />
          <Tooltip cursor={{ fill: "rgba(15,17,22,0.04)" }} content={<TooltipVoi formato={spec.formato} />} />
          {series.map((s, i) => (
            <Bar key={s.campo} dataKey={s.campo} name={s.nombre} fill={color(i)} stackId="a" barSize={20} isAnimationActive={false}
              radius={i === series.length - 1 ? [0, 4, 4, 0] : [0, 0, 0, 0]} stroke="#FFFFFF" strokeWidth={2} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

function Lineas({ spec, compacto, area }: { spec: PiezaVoi; compacto?: boolean; area?: boolean }) {
  const datos = spec.datos ?? [];
  const x = spec.x!;
  const series = spec.series ?? [];
  const ultimo = datos.length - 1;
  const punto = (i: number) => (props: any) => props.index === ultimo
    ? <circle key={`f-${i}`} cx={props.cx} cy={props.cy} r={4} fill={color(i)} stroke="#FFFFFF" strokeWidth={2} />
    : <g key={`p-${i}-${props.index}`} />;
  const comun = (
    <>
      <CartesianGrid vertical={false} stroke={GRILLA} />
      <XAxis dataKey={x} tick={TICK} tickLine={false} axisLine={{ stroke: GRILLA }} interval="preserveStartEnd" minTickGap={16} />
      <YAxis tick={TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => formatearEje(v, spec.formato)} />
      <Tooltip cursor={{ stroke: "#9CA3AF", strokeWidth: 1 }} content={<TooltipVoi formato={spec.formato} />} />
      {spec.meta !== undefined && (
        <ReferenceLine y={spec.meta} stroke={EJE} strokeDasharray="4 4" label={{ value: spec.meta_nombre ?? "Meta", position: "insideTopRight", fill: EJE, fontSize: 11 }} />
      )}
    </>
  );
  return (
    <>
      <LeyendaVoi linea series={series.map((s, i) => ({ nombre: s.nombre, color: color(i) }))} />
      <ResponsiveContainer width="100%" height={compacto ? 240 : 360}>
        {area && series.length === 1 ? (
          <AreaChart data={datos} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            {comun}
            <Area dataKey={series[0].campo} name={series[0].nombre} stroke={color(0)} strokeWidth={2} fill={color(0)} fillOpacity={0.1}
              dot={punto(0)} activeDot={{ r: 5, stroke: "#FFFFFF", strokeWidth: 2 }} isAnimationActive={false} type="monotone" />
          </AreaChart>
        ) : (
          <LineChart data={datos} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            {comun}
            {series.map((s, i) => (
              <Line key={s.campo} dataKey={s.campo} name={s.nombre} stroke={color(i)} strokeWidth={2} dot={punto(i)} connectNulls
                activeDot={{ r: 5, stroke: "#FFFFFF", strokeWidth: 2 }} isAnimationActive={false} type="monotone" strokeLinecap="round" />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </>
  );
}

function Dona({ spec, compacto }: { spec: PiezaVoi; compacto?: boolean }) {
  const datos = spec.datos ?? [];
  const x = spec.x!;
  const campo = spec.series?.[0]?.campo ?? "";
  const total = datos.reduce((t, d) => t + (Number(d[campo]) || 0), 0);
  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <div className="relative w-[200px] h-[200px] flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={datos} dataKey={campo} nameKey={x} innerRadius="62%" outerRadius="100%" stroke="#FFFFFF" strokeWidth={2} isAnimationActive={false}>
              {datos.map((_, i) => <Cell key={i} fill={color(i)} />)}
            </Pie>
            <Tooltip content={<TooltipVoi formato={spec.formato} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center">
            <div className="text-lg font-semibold text-brand-ink">{formatear(total, spec.formato)}</div>
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">Total</div>
          </div>
        </div>
      </div>
      <ul className={`flex-1 w-full space-y-1.5 ${compacto ? "text-xs" : "text-sm"}`}>
        {datos.map((d, i) => {
          const v = Number(d[campo]) || 0;
          return (
            <li key={String(d[x])} className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-[3px] flex-shrink-0" style={{ background: color(i) }} />
              <span className="text-brand-graphite truncate flex-1">{String(d[x])}</span>
              <span className="tabular-nums text-brand-ink font-semibold">{formatear(v, spec.formato)}</span>
              <span className="tabular-nums text-brand-slate w-14 text-right">{total ? formatear((v / total) * 100, "porcentaje") : "—"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** El cuerpo de una pieza (sin título): el gráfico, los indicadores o la tabla. */
export function CuerpoPieza({ spec, verDatos = false, compacto = false }: { spec: PiezaVoi; verDatos?: boolean; compacto?: boolean }) {
  if (spec.tipo === "kpis") return <Kpis spec={spec} />;
  if (spec.tipo === "tabla" || verDatos) return <TablaVoi spec={spec} maxAlto={compacto ? 300 : 460} />;
  switch (spec.tipo) {
    case "barras":
      return <Barras spec={spec} compacto={compacto} />;
    case "columnas":
      return <Columnas spec={spec} compacto={compacto} />;
    case "apiladas": {
      const largo = Math.max(...(spec.datos ?? []).map((d) => String(d[spec.x!] ?? "").length), 0);
      return (spec.datos?.length ?? 0) > 8 || largo > 10 ? <ApiladasHorizontal spec={spec} compacto={compacto} /> : <Columnas spec={spec} compacto={compacto} apiladas />;
    }
    case "lineas":
      return <Lineas spec={spec} compacto={compacto} />;
    case "area":
      return <Lineas spec={spec} compacto={compacto} area />;
    case "dona":
      return <Dona spec={spec} compacto={compacto} />;
    default:
      return null;
  }
}
