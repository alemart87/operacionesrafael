"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export interface Artifact {
  id: string;
  tipo: string;
  titulo: string;
  descripcion?: string | null;
  datos: any;
}

const PALETTE = ["#00B2BF", "#662483", "#E6332A", "#F39200", "#2563eb", "#10b981", "#0f172a", "#0891b2"];

const num = (v: any) => (typeof v === "number" ? v : parseFloat(v)) || 0;

const META_KEYS = new Set([
  "columnas", "columns", "filas", "rows", "kpis", "texto", "markdown", "text",
  "items", "data", "puntos", "series", "titulo", "title", "descripcion",
]);

// Normaliza una lista de items con label + valor(es), tolerante a varias claves.
// Fallback: si el modelo manda un objeto plano {etiqueta: numero}, lo convierte.
function asItems(datos: any): any[] {
  const arr = datos?.items || datos?.data || datos?.filas || datos?.puntos;
  if (Array.isArray(arr)) return arr;
  if (datos && typeof datos === "object" && !Array.isArray(datos)) {
    const entries = Object.entries(datos).filter(
      ([k, v]) =>
        !META_KEYS.has(k) &&
        (typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !isNaN(parseFloat(v as string)))),
    );
    if (entries.length) return entries.map(([k, v]) => ({ label: k, valor: num(v) }));
  }
  return [];
}
function labelOf(it: any) {
  return it.label ?? it.name ?? it.x ?? it.categoria ?? it.dia ?? it.mes ?? "";
}
function valueKeys(items: any[]): string[] {
  const first = items[0] || {};
  return Object.keys(first).filter((k) => typeof first[k] === "number" && !["id"].includes(k));
}

function Bars({ datos }: { datos: any }) {
  const items = asItems(datos).map((it) => ({ label: String(labelOf(it)), valor: num(it.valor ?? it.value ?? it.cantidad ?? it.y) }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, items.length * 34 + 30)}>
      <BarChart data={items} layout="vertical" margin={{ left: 8, right: 24 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 12, fill: "#475569" }} interval={0} />
        <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Bar dataKey="valor" radius={[0, 4, 4, 0]} barSize={18}>
          {items.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Lines({ datos }: { datos: any }) {
  const items = asItems(datos).map((it) => ({ ...it, label: String(labelOf(it)) }));
  const keys = valueKeys(items);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={items} margin={{ top: 8, right: 16, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
        <YAxis tick={{ fontSize: 11, fill: "#64748b" }} allowDecimals={false} />
        <Tooltip />
        {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {keys.map((k, i) => (
          <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 2 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function StackedBars({ datos }: { datos: any }) {
  const items = asItems(datos).map((it) => ({ ...it, label: String(labelOf(it)) }));
  const keys = valueKeys(items);
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={items} margin={{ top: 8, right: 16, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
        <YAxis tick={{ fontSize: 11, fill: "#64748b" }} allowDecimals={false} />
        <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {keys.map((k, i) => (
          <Bar key={k} dataKey={k} stackId="a" fill={PALETTE[i % PALETTE.length]} radius={[2, 2, 0, 0]} barSize={22} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function Areas({ datos }: { datos: any }) {
  const items = asItems(datos).map((it) => ({ ...it, label: String(labelOf(it)) }));
  const keys = valueKeys(items);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={items} margin={{ top: 8, right: 16, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
        <YAxis tick={{ fontSize: 11, fill: "#64748b" }} allowDecimals={false} />
        <Tooltip />
        {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {keys.map((k, i) => (
          <Area key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]}
            fill={PALETTE[i % PALETTE.length]} fillOpacity={0.18} strokeWidth={2} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

function Donut({ datos }: { datos: any }) {
  const items = asItems(datos).map((it) => ({ name: String(labelOf(it)), value: num(it.valor ?? it.value ?? it.cantidad) }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={items} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
          {items.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function Tabla({ datos }: { datos: any }) {
  const cols: string[] = datos?.columnas || datos?.columns || [];
  const rows: any[][] = datos?.filas || datos?.rows || [];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-brand-bg border-b border-brand-border">
          <tr className="text-[11px] uppercase tracking-wider2 text-brand-slate">
            {cols.map((c, i) => <th key={i} className={`px-3 py-2 ${i === 0 ? "text-left" : "text-right"}`}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-brand-border">
              {r.map((cell, ci) => (
                <td key={ci} className={`px-3 py-2 ${ci === 0 ? "text-left font-medium text-brand-ink" : "text-right"}`}>{String(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kpis({ datos }: { datos: any }) {
  let kpis: any[] = Array.isArray(datos?.kpis) ? datos.kpis : [];
  // Fallback: el modelo mandó items o un objeto plano {label: valor}.
  if (kpis.length === 0) {
    if (Array.isArray(datos?.items)) {
      kpis = datos.items.map((it: any) => ({ label: it.label ?? it.name, valor: it.valor ?? it.value, hint: it.hint }));
    } else if (datos && typeof datos === "object") {
      kpis = Object.entries(datos)
        .filter(([k, v]) => !META_KEYS.has(k) && typeof v !== "object" && v != null)
        .map(([k, v]) => ({ label: k, valor: v }));
    }
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {kpis.map((k, i) => (
        <div key={i} className="card p-4 border-l-[3px]" style={{ borderLeftColor: PALETTE[i % PALETTE.length] }}>
          <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">{k.label}</div>
          <div className="mt-1 font-display text-2xl text-brand-ink">{k.valor ?? k.value}</div>
          {k.hint && <div className="mt-1 text-[11px] text-brand-slate">{k.hint}</div>}
        </div>
      ))}
    </div>
  );
}

function Markdown({ datos }: { datos: any }) {
  const texto: string = datos?.texto || datos?.markdown || datos?.text || "";
  return <div className="text-sm text-brand-graphite whitespace-pre-wrap leading-relaxed">{texto}</div>;
}

export function CanvasArtifact({ artifact }: { artifact: Artifact }) {
  const { tipo, titulo, descripcion, datos } = artifact;
  return (
    <div className="card p-4 mb-4">
      <h3 className="font-display text-base text-brand-ink uppercase leading-tight mb-1">{titulo}</h3>
      {descripcion && <p className="text-xs text-brand-slate mb-3">{descripcion}</p>}
      {tipo === "bar" && <Bars datos={datos} />}
      {(tipo === "stacked-bar" || tipo === "stacked_bar") && <StackedBars datos={datos} />}
      {tipo === "line" && <Lines datos={datos} />}
      {tipo === "area" && <Areas datos={datos} />}
      {tipo === "donut" && <Donut datos={datos} />}
      {tipo === "table" && <Tabla datos={datos} />}
      {tipo === "kpis" && <Kpis datos={datos} />}
      {(tipo === "markdown" || !["bar", "stacked-bar", "stacked_bar", "line", "area", "donut", "table", "kpis"].includes(tipo)) && <Markdown datos={datos} />}
    </div>
  );
}
