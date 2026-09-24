"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { apiFetch, CurrentUserInfo, can } from "@/lib/api";
import { PERM_FACTURACION } from "@/lib/operativas";

const PALETTE = ["#00B2BF", "#662483", "#E6332A", "#F39200", "#2563eb", "#10b981", "#0f172a", "#0891b2"];
const POS = "#10b981";
const NEG = "#E6332A";

function gs(v: number) {
  const s = "Gs " + Math.abs(Math.round(v)).toLocaleString("es-PY");
  return v < 0 ? "−" + s : s;
}
// Eje compacto en millones de Gs.
function gsM(v: number) {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1).replace(".", ",") + " MM";
  if (a >= 1e6) return Math.round(v / 1e6) + " M";
  if (a >= 1e3) return Math.round(v / 1e3) + " K";
  return String(Math.round(v));
}

interface RepItem { id: string; periodo: string | null; nro_liquidacion: string | null; total: number; is_published: boolean; title: string | null; }

export default function ComparePage() {
  const [reports, setReports] = useState<RepItem[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const me = await apiFetch<CurrentUserInfo>("/api/v1/auth/me");
        if (!can(me, PERM_FACTURACION)) { setError("Acceso restringido."); return; }
        const data = await apiFetch<{ items: RepItem[] }>("/api/v1/televentas-claro/facturacion/reports");
        setReports(data.items);
      } catch (e: any) { setError(e.message); }
    })();
  }, []);

  const toggle = (id: string) => {
    const n = new Set(sel);
    n.has(id) ? n.delete(id) : n.add(id);
    setSel(n);
  };

  const run = async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiFetch("/api/v1/televentas-claro/facturacion/compare", {
        method: "POST", body: JSON.stringify({ report_ids: Array.from(sel) }),
      });
      setResult(res);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <AppShell>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap print:hidden">
        <div>
          <Link href="/televentas-claro/facturacion" className="text-xs text-brand-slate hover:text-brand-primary">← Volver</Link>
          <h1 className="font-display text-3xl text-brand-ink uppercase mt-1">Comparar facturaciones</h1>
          <p className="text-sm text-brand-slate">Seleccioná 2 o más reportes (mínimo recomendado: 3 meses).</p>
        </div>
        <div className="flex gap-2">
          {result && <button onClick={() => window.print()} className="btn-outline">Imprimir</button>}
          <button onClick={run} disabled={sel.size < 2 || loading} className="btn-primary">
            {loading ? "Comparando…" : `Comparar (${sel.size})`}
          </button>
        </div>
      </div>

      {error && <div className="card p-4 text-brand-primary mb-4">{error}</div>}

      {/* Selector */}
      <div className="card p-4 mb-6 print:hidden">
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
          {reports.map((r) => (
            <label key={r.id} className={`flex items-center gap-2 p-2 rounded border cursor-pointer ${sel.has(r.id) ? "border-brand-primary bg-brand-primary-light" : "border-brand-border"}`}>
              <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
              <span className="text-sm">
                <b>{r.periodo || r.title || "—"}</b> <span className="text-brand-slate">· {gs(r.total)}</span>
                {!r.is_published && <span className="badge-neutral ml-1 text-[9px]">borrador</span>}
              </span>
            </label>
          ))}
        </div>
      </div>

      {result && <CompareResult result={result} />}
    </AppShell>
  );
}

function CompareResult({ result }: { result: any }) {
  const cols = result.columnas || [];
  const labels: string[] = cols.map((c: any) => c.label);
  const totales: number[] = result.totales || [];
  const creditos: number[] = result.creditos || [];
  const debitos: number[] = result.debitos || [];
  const ventas: number[] = result.ventas || [];
  const variaciones: (number | null)[] = result.variaciones || [];
  const n = labels.length;

  // Serie principal por mes
  const serie = labels.map((label, i) => ({
    label,
    Créditos: creditos[i] ?? 0,
    Débitos: debitos[i] ?? 0,
    Neto: totales[i] ?? 0,
    Ventas: ventas[i] ?? 0,
  }));

  // KPIs ejecutivos
  const last = n - 1;
  const promedio = totales.length ? totales.reduce((a, b) => a + b, 0) / totales.length : 0;
  const varLast = variaciones[last];
  const idxMax = totales.indexOf(Math.max(...totales));
  const idxMin = totales.indexOf(Math.min(...totales));
  const ticketLast = ventas[last] ? totales[last] / ventas[last] : 0;

  // Descomposición del último cambio (delta por concepto)
  const decomp = (result.descomposicion || [])
    .slice()
    .sort((a: any, b: any) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 12)
    .map((d: any) => ({ label: d.descripcion, delta: d.delta, pct: d.pct_del_cambio }));
  const deltaTotal: number = result.delta_total || 0;

  // Drivers a lo largo de los meses (multi-línea).
  // Se grafica la MAGNITUD (valor absoluto): así "más alto = más grande" para todos.
  // Plotear penalidades en negativo invierte la lectura (más suspensiones quedaría "más abajo").
  const driverMeta = (result.drivers || []).map((d: any) => {
    const isDebito = (d.valores || []).some((v: number) => v < 0);
    return { key: isDebito ? `${d.nombre} (débito)` : d.nombre, isDebito, valores: d.valores || [] };
  });
  const driversSerie = labels.map((label, i) => {
    const row: any = { label };
    driverMeta.forEach((d: any) => { row[d.key] = Math.abs(d.valores?.[i] ?? 0); });
    return row;
  });

  return (
    <div className="space-y-6">
      {/* KPIs ejecutivos */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label={`Neto · ${labels[last] ?? ""}`} value={gs(totales[last] ?? 0)} accent
          sub={varLast == null ? "primer mes" : `${varLast > 0 ? "+" : ""}${varLast}% vs mes previo`}
          subColor={varLast == null ? "" : varLast < 0 ? "text-brand-primary" : "text-emerald-700"} />
        <Kpi label="Promedio del período" value={gs(promedio)} sub={`${n} meses comparados`} />
        <Kpi label="Mejor mes" value={labels[idxMax] ?? "—"} sub={gs(totales[idxMax] ?? 0)} subColor="text-emerald-700" />
        <Kpi label="Menor mes" value={labels[idxMin] ?? "—"} sub={gs(totales[idxMin] ?? 0)} subColor="text-brand-primary" />
      </div>

      {/* Evolución de facturación + Ventas */}
      <div className="grid lg:grid-cols-3 gap-6">
        <ChartCard className="lg:col-span-2" title="Evolución de la facturación"
          subtitle="Créditos (+) y débitos (−) por mes, con la línea de facturación neta.">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={serie} margin={{ top: 8, right: 12, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis tickFormatter={gsM} tick={{ fontSize: 11, fill: "#64748b" }} width={56} />
              <Tooltip formatter={(v: any, k: any) => [gs(Number(v)), k]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="#cbd5e1" />
              <Bar dataKey="Créditos" fill={POS} radius={[3, 3, 0, 0]} barSize={18} />
              <Bar dataKey="Débitos" fill={NEG} radius={[0, 0, 3, 3]} barSize={18} />
              <Line dataKey="Neto" type="monotone" stroke="#662483" strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Ventas (activaciones)" subtitle="Volumen mensual de activaciones.">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={serie} margin={{ top: 8, right: 12, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis tick={{ fontSize: 11, fill: "#64748b" }} width={42} allowDecimals={false} />
              <Tooltip formatter={(v: any) => [Number(v).toLocaleString("es-PY"), "Activaciones"]} />
              <Bar dataKey="Ventas" fill="#00B2BF" radius={[3, 3, 0, 0]} barSize={26} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Descomposición del cambio (lo más importante) */}
      {decomp.length > 0 && (
        <ChartCard
          title={`Qué movió la facturación · ${labels[last - 1] ?? ""} → ${labels[last] ?? ""}`}
          subtitle={`Aporte de cada concepto al cambio total de ${deltaTotal >= 0 ? "+" : ""}${gs(deltaTotal)}. Verde suma, rojo resta.`}
        >
          <ResponsiveContainer width="100%" height={Math.max(220, decomp.length * 34 + 30)}>
            <ComposedChart data={decomp} layout="vertical" margin={{ left: 8, right: 64 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" horizontal={false} />
              <XAxis type="number" tickFormatter={gsM} tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis type="category" dataKey="label" width={210} tick={{ fontSize: 11, fill: "#475569" }} interval={0} />
              <Tooltip formatter={(v: any, _k: any, p: any) => [`${gs(Number(v))} · ${p?.payload?.pct ?? 0}% del cambio`, "Delta"]} />
              <ReferenceLine x={0} stroke="#94a3b8" />
              <Bar dataKey="delta" radius={[0, 3, 3, 0]} barSize={18}>
                {decomp.map((d: any, i: number) => <Cell key={i} fill={d.delta < 0 ? NEG : POS} />)}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Drivers operativos a lo largo del tiempo */}
      {driverMeta.length > 0 && (
        <ChartCard title="Drivers operativos"
          subtitle="Magnitud mensual de cada concepto. Las penalidades (suspensiones, documentación) se muestran en valor absoluto y con línea punteada: más alto = mayor penalidad.">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={driversSerie} margin={{ top: 8, right: 16, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis tickFormatter={gsM} tick={{ fontSize: 11, fill: "#64748b" }} width={56} domain={[0, "auto"]} />
              <Tooltip formatter={(v: any, k: any) => [gs(Number(v)), k]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {driverMeta.map((d: any, i: number) => (
                <Line key={d.key} dataKey={d.key} type="monotone" stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={2} strokeDasharray={d.isDebito ? "5 4" : undefined} dot={{ r: 2 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Hallazgos */}
      {result.hallazgos?.length > 0 && (
        <div className="card p-5">
          <h2 className="font-display text-base uppercase text-brand-ink mb-2">Hallazgos</h2>
          <ul className="space-y-1.5 text-sm text-brand-ink">
            {result.hallazgos.map((h: string, i: number) => (
              <li key={i} className="flex gap-2"><span className="text-brand-cyan">›</span><span>{h}</span></li>
            ))}
          </ul>
        </div>
      )}

      {/* ===== Tablas de detalle ===== */}
      <h2 className="font-display text-lg uppercase text-brand-ink pt-2">Detalle numérico</h2>

      {/* Totales + variaciones */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
              <th className="px-4 py-2.5"> </th>
              {cols.map((c: any) => <th key={c.id} className="px-4 py-2.5 text-right">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            <Row label="Facturación neta" values={result.totales} bold />
            <Row label="Créditos" values={result.creditos} cls="text-emerald-700" />
            <Row label="Débitos" values={result.debitos} cls="text-brand-primary" />
            <tr className="border-b border-brand-border/50">
              <td className="px-4 py-2 font-medium">Variación mensual</td>
              {variaciones.map((v, i) => (
                <td key={i} className={`px-4 py-2 text-right ${v == null ? "text-brand-slate" : v < 0 ? "text-brand-primary" : "text-emerald-700"}`}>{v == null ? "—" : `${v > 0 ? "+" : ""}${v}%`}</td>
              ))}
            </tr>
            <tr className="border-b border-brand-border/50">
              <td className="px-4 py-2">Ventas (activaciones)</td>
              {ventas.map((v, i) => <td key={i} className="px-4 py-2 text-right">{v.toLocaleString("es-PY")}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Matriz completa por concepto */}
      <div className="card overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-brand-border"><h2 className="font-display text-base uppercase text-brand-ink">Comparativo por concepto ({result.conceptos.length})</h2></div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
              <th className="px-4 py-2">Concepto</th>
              {cols.map((c: any) => <th key={c.id} className="px-4 py-2 text-right">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {result.conceptos.map((c: any, i: number) => <Row key={i} label={c.descripcion} values={c.valores} signo />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, subColor, accent }: { label: string; value: string; sub?: string; subColor?: string; accent?: boolean }) {
  return (
    <div className={`card p-4 ${accent ? "border-l-4 border-brand-primary" : ""}`}>
      <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">{label}</div>
      <div className="font-display text-2xl mt-1 text-brand-ink">{value}</div>
      {sub && <div className={`text-xs mt-0.5 ${subColor || "text-brand-slate"}`}>{sub}</div>}
    </div>
  );
}

function ChartCard({ title, subtitle, children, className }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`card p-5 ${className || ""}`}>
      <h2 className="font-display text-base uppercase text-brand-ink leading-tight">{title}</h2>
      {subtitle && <p className="text-xs text-brand-slate mb-3 mt-0.5">{subtitle}</p>}
      {children}
    </div>
  );
}

function Row({ label, values, bold, cls, signo }: { label: string; values: number[]; bold?: boolean; cls?: string; signo?: boolean }) {
  return (
    <tr className="border-b border-brand-border/50">
      <td className={`px-4 py-2 ${bold ? "font-semibold" : ""}`}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`px-4 py-2 text-right ${bold ? "font-semibold" : ""} ${cls || (signo && v < 0 ? "text-brand-primary" : "")}`}>{gs(v)}</td>
      ))}
    </tr>
  );
}
