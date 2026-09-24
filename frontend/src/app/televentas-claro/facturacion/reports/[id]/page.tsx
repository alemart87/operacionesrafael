"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { apiFetch, CurrentUserInfo, can } from "@/lib/api";
import { PERM_FACTURACION } from "@/lib/operativas";

function gs(v: number) {
  const s = "Gs " + Math.abs(Math.round(v)).toLocaleString("es-PY");
  return v < 0 ? "−" + s : s;
}

interface ReportData {
  id: string;
  periodo: string | null;
  nro_liquidacion: string | null;
  total: number; creditos: number; debitos: number; ventas_activaciones: number;
  is_published: boolean;
  title: string | null;
  data: any;
}

export default function FacturacionReportPage() {
  const { id } = useParams<{ id: string }>();
  const [r, setR] = useState<ReportData | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const rep = await apiFetch<ReportData>(`/api/v1/televentas-claro/facturacion/reports/${id}`);
    setR(rep);
  };

  useEffect(() => {
    (async () => {
      try {
        const me = await apiFetch<CurrentUserInfo>("/api/v1/auth/me");
        setCanManage(can(me, PERM_FACTURACION));
        await load();
      } catch (e: any) { setError(e.message); }
    })();
  }, [id]);

  if (error) return <AppShell><div className="card p-8 text-brand-primary">{error}</div></AppShell>;
  if (!r) return <AppShell><div className="card p-10 text-brand-slate">Cargando…</div></AppShell>;

  const d = r.data || {};
  const conceptos: any[] = d.conceptos || [];
  const ventas = d.ventas || {};
  const susp = d.suspensiones || {};
  const doc = d.doc_faltante || {};
  const planMix: any[] = d.plan_mix || [];
  const planesRent: any[] = d.planes_rentables || [];
  const suspDia: any[] = susp.por_dia || [];

  const togglePublish = async () => {
    await apiFetch(`/api/v1/televentas-claro/facturacion/reports/${id}/publish`, {
      method: "POST", body: JSON.stringify({ is_published: !r.is_published }),
    });
    await load();
  };

  return (
    <AppShell>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap print:mb-2">
        <div>
          <Link href="/televentas-claro/facturacion" className="text-xs text-brand-slate hover:text-brand-primary print:hidden">← Volver</Link>
          <h1 className="font-display text-3xl text-brand-ink uppercase leading-tight mt-1">
            Facturación · {r.periodo || r.title || "—"}
          </h1>
          <p className="text-sm text-brand-slate">Liquidación {r.nro_liquidacion} · {(d.kpis?.total_rows || 0).toLocaleString("es-PY")} movimientos</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button onClick={() => window.print()} className="btn-outline">Imprimir</button>
          {canManage && (
            <button onClick={togglePublish} className="btn-primary">
              {r.is_published ? "Despublicar" : "Publicar"}
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Facturación neta" value={gs(r.total)} accent />
        <Kpi label="Créditos" value={gs(r.creditos)} color="text-emerald-700" />
        <Kpi label="Débitos" value={gs(r.debitos)} color="text-brand-primary" />
        <Kpi label="Ventas (activaciones)" value={r.ventas_activaciones.toLocaleString("es-PY")} sub={`Ticket ${gs(ventas.ticket || 0)}`} />
      </div>

      {/* Análisis rápido */}
      {d.analisis_rapido?.length > 0 && (
        <div className="card p-5 mb-6">
          <h2 className="font-display text-lg text-brand-ink uppercase mb-3">Análisis rápido</h2>
          <ul className="space-y-1.5 text-sm text-brand-ink">
            {d.analisis_rapido.map((a: string, i: number) => (
              <li key={i} className="flex gap-2"><span className="text-brand-cyan">›</span><span>{a}</span></li>
            ))}
          </ul>
        </div>
      )}

      {/* Mix de planes + curva diaria de suspensiones */}
      {(planMix.length > 0 || suspDia.length > 0) && (
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {planMix.length > 0 && <PlanMixCard mix={planMix} rentables={planesRent} />}
          {suspDia.length > 0 && <DailyCurveCard title="Suspensiones por fecha de venta" rows={suspDia} />}
        </div>
      )}

      {/* TODAS las descripciones de concepto */}
      <div className="card overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-brand-border">
          <h2 className="font-display text-lg text-brand-ink uppercase">Detalle por concepto ({conceptos.length})</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
              <th className="px-5 py-2.5">Descripción de concepto</th>
              <th className="px-5 py-2.5 text-right">Importe</th>
              <th className="px-5 py-2.5 text-right">Registros</th>
              <th className="px-5 py-2.5 text-right">% del grupo</th>
            </tr>
          </thead>
          <tbody>
            {conceptos.map((c, i) => (
              <tr key={i} className="border-b border-brand-border/50">
                <td className="px-5 py-2">{c.descripcion}</td>
                <td className={`px-5 py-2 text-right font-medium ${c.importe < 0 ? "text-brand-primary" : c.importe > 0 ? "text-emerald-700" : "text-brand-slate"}`}>{gs(c.importe)}</td>
                <td className="px-5 py-2 text-right text-brand-slate">{(c.registros || 0).toLocaleString("es-PY")}</td>
                <td className="px-5 py-2 text-right text-brand-slate">{c.pct}%</td>
              </tr>
            ))}
            <tr className="bg-brand-bg font-semibold">
              <td className="px-5 py-2.5">TOTAL FACTURACIÓN NETA</td>
              <td className="px-5 py-2.5 text-right">{gs(r.total)}</td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Cohortes: suspensiones y documentación faltante */}
      <div className="grid md:grid-cols-2 gap-6">
        <CohorteCard title={`Suspensiones (PFI) · ${susp.registros || 0} líneas`} monto={gs(susp.monto || 0)} rows={susp.por_mes_venta || []} />
        <div className="card p-5">
          <h3 className="font-display text-base text-brand-ink uppercase mb-1">Documentación faltante · {doc.registros || 0} legajos</h3>
          <p className="text-sm text-brand-primary font-semibold mb-3">{gs(doc.monto || 0)} · promedio {gs(doc.promedio || 0)}</p>
          {doc.por_motivo?.length > 0 && (
            <table className="w-full text-sm mb-3">
              <tbody>
                {doc.por_motivo.map((m: any, i: number) => (
                  <tr key={i} className="border-b border-brand-border/40">
                    <td className="py-1.5">{m.motivo}</td>
                    <td className="py-1.5 text-right text-brand-slate">{m.registros}</td>
                    <td className="py-1.5 text-right">{gs(m.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <CohorteRows rows={doc.por_mes_venta || []} label="Por mes de venta" />
        </div>
      </div>
    </AppShell>
  );
}

function Kpi({ label, value, sub, accent, color }: { label: string; value: string; sub?: string; accent?: boolean; color?: string }) {
  return (
    <div className={`card p-4 ${accent ? "border-l-4 border-brand-primary" : ""}`}>
      <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">{label}</div>
      <div className={`font-display text-2xl mt-1 ${color || "text-brand-ink"}`}>{value}</div>
      {sub && <div className="text-xs text-brand-slate mt-0.5">{sub}</div>}
    </div>
  );
}

function CohorteCard({ title, monto, rows }: { title: string; monto: string; rows: any[] }) {
  return (
    <div className="card p-5">
      <h3 className="font-display text-base text-brand-ink uppercase mb-1">{title}</h3>
      <p className="text-sm text-brand-primary font-semibold mb-3">{monto}</p>
      <CohorteRows rows={rows} label="Por mes de venta de la línea" />
    </div>
  );
}

function PlanMixCard({ mix, rentables }: { mix: any[]; rentables: any[] }) {
  const totalAct = mix.reduce((s, p) => s + (p.activaciones || 0), 0) || 1;
  const masVendido = mix[0];
  const masRentable = rentables[0];
  return (
    <div className="card p-5">
      <h3 className="font-display text-base text-brand-ink uppercase mb-1">Mix de planes · {mix.length}</h3>
      <p className="text-xs text-brand-slate mb-3">
        Más vendido <b className="text-brand-ink">{masVendido?.plan}</b> · mayor ticket{" "}
        <b className="text-brand-ink">{masRentable?.plan}</b> ({gs(masRentable?.ticket || 0)}/act.)
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
            <th className="py-1.5">Plan</th>
            <th className="py-1.5 text-right">Activ.</th>
            <th className="py-1.5 text-right">Mix</th>
            <th className="py-1.5 text-right">Ticket</th>
          </tr>
        </thead>
        <tbody>
          {mix.map((p, i) => (
            <tr key={i} className="border-b border-brand-border/40">
              <td className="py-1.5 font-medium">{p.plan}</td>
              <td className="py-1.5 text-right">{(p.activaciones || 0).toLocaleString("es-PY")}</td>
              <td className="py-1.5 text-right text-brand-slate">{Math.round((p.activaciones / totalAct) * 100)}%</td>
              <td className="py-1.5 text-right">{gs(p.ticket || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyCurveCard({ title, rows }: { title: string; rows: any[] }) {
  const max = Math.max(...rows.map((x) => x.registros || 0), 1);
  return (
    <div className="card p-5">
      <h3 className="font-display text-base text-brand-ink uppercase mb-3">{title}</h3>
      <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
        {rows.map((x, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-20 text-brand-slate tabular-nums">{x.fecha}</span>
            <div className="flex-1 bg-brand-bg rounded h-3 overflow-hidden">
              <div className="bg-brand-primary/70 h-full rounded" style={{ width: `${(x.registros / max) * 100}%` }} />
            </div>
            <span className="w-8 text-right tabular-nums">{x.registros}</span>
            <span className="w-24 text-right text-brand-slate tabular-nums">{gs(x.monto || 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CohorteRows({ rows, label }: { rows: any[]; label: string }) {
  if (!rows?.length) return <p className="text-xs text-brand-slate">Sin datos.</p>;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-1">{label}</div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((x, i) => (
            <tr key={i} className="border-b border-brand-border/40">
              <td className="py-1.5">{x.mes}</td>
              <td className="py-1.5 text-right text-brand-slate">{x.registros}</td>
              <td className="py-1.5 text-right">{gs(x.monto)}</td>
              <td className="py-1.5 text-right text-brand-slate w-14">{x.pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
