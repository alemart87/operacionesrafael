"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { apiFetch, CurrentUserInfo, can } from "@/lib/api";
import { PERM_FACTURACION } from "@/lib/operativas";

interface ReportItem {
  id: string;
  periodo: string | null;
  nro_liquidacion: string | null;
  generated_at: string;
  total: number;
  creditos: number;
  debitos: number;
  ventas_activaciones: number;
  is_published: boolean;
  title: string | null;
}

function gs(v: number) {
  return "Gs " + Math.round(v).toLocaleString("es-PY");
}

export default function TeleventasClaroHub() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const data = await apiFetch<{ items: ReportItem[] }>("/api/v1/televentas-claro/facturacion/reports");
    setReports(data.items);
  };

  useEffect(() => {
    (async () => {
      try {
        const me = await apiFetch<CurrentUserInfo>("/api/v1/auth/me");
        if (!can(me, PERM_FACTURACION)) {
          setDenied(true);
          return;
        }
        setCanManage(can(me, PERM_FACTURACION));
        await load();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const togglePublish = async (r: ReportItem) => {
    await apiFetch(`/api/v1/televentas-claro/facturacion/reports/${r.id}/publish`, {
      method: "POST",
      body: JSON.stringify({ is_published: !r.is_published }),
    });
    await load();
  };

  const remove = async (r: ReportItem) => {
    if (!confirm(`¿Eliminar el reporte ${r.periodo || r.nro_liquidacion}? Esta acción no se puede deshacer.`)) return;
    await apiFetch(`/api/v1/televentas-claro/facturacion/reports/${r.id}`, { method: "DELETE" });
    await load();
  };

  if (loading) return <AppShell><div className="card p-10 text-brand-slate">Cargando…</div></AppShell>;

  if (denied)
    return (
      <AppShell>
        <div className="card p-12 text-center max-w-xl mx-auto">
          <h1 className="font-display text-2xl text-brand-ink uppercase mb-2">Acceso restringido</h1>
          <p className="text-brand-slate">Facturación de Televentas CLARO es exclusiva del superadmin.</p>
        </div>
      </AppShell>
    );

  return (
    <AppShell>
      <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Televentas CLARO · Solo superadmin</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Facturación</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-2xl">
            Liquidación de comisiones: detalle por concepto, drivers operativos y comparativos mensuales.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href="/televentas-claro/facturacion/agente"
            className="inline-flex items-center gap-2 rounded-md border border-[#662483]/30 bg-[#662483]/5 text-[#662483] hover:bg-[#662483]/10 px-3.5 py-2 text-sm font-semibold transition-colors"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
            Agente IA
          </Link>
          <Link
            href="/televentas-claro/facturacion/compare"
            className="inline-flex items-center gap-2 rounded-md border border-brand-border bg-white text-brand-graphite hover:border-brand-ink hover:text-brand-ink px-3.5 py-2 text-sm font-semibold transition-colors"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m7 14 3-3 3 3 5-5"/></svg>
            Comparar
          </Link>
          {canManage && (
            <Link
              href="/televentas-claro/facturacion/upload"
              className="inline-flex items-center gap-2 rounded-md bg-brand-primary text-white hover:bg-brand-primary-dark px-3.5 py-2 text-sm font-semibold shadow-soft transition-colors"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>
              Subir liquidación
            </Link>
          )}
        </div>
      </div>

      {error && <div className="card p-4 text-brand-primary mb-4">{error}</div>}

      {reports.length === 0 ? (
        <div className="card p-12 text-center text-brand-slate">
          Aún no hay reportes. {canManage && "Subí un archivo .txt de liquidación para generar el primero."}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
                <th className="px-4 py-3">Período / Liq.</th>
                <th className="px-4 py-3 text-right">Facturación neta</th>
                <th className="px-4 py-3 text-right">Créditos</th>
                <th className="px-4 py-3 text-right">Débitos</th>
                <th className="px-4 py-3 text-right">Ventas</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="border-b border-brand-border/60 hover:bg-brand-bg/50">
                  <td className="px-4 py-3">
                    <Link href={`/televentas-claro/facturacion/reports/${r.id}`} className="font-semibold text-brand-ink hover:text-brand-primary">
                      {r.title || r.periodo || "—"}
                    </Link>
                    <div className="text-xs text-brand-slate">Liq {r.nro_liquidacion || "?"}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{gs(r.total)}</td>
                  <td className="px-4 py-3 text-right text-emerald-700">{gs(r.creditos)}</td>
                  <td className="px-4 py-3 text-right text-brand-primary">{gs(r.debitos)}</td>
                  <td className="px-4 py-3 text-right">{r.ventas_activaciones.toLocaleString("es-PY")}</td>
                  <td className="px-4 py-3">
                    {r.is_published ? <span className="badge-success">Publicado</span> : <span className="badge-neutral">Borrador</span>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link href={`/televentas-claro/facturacion/reports/${r.id}`} className="text-brand-primary text-xs font-semibold mr-3">Ver</Link>
                    {canManage && (
                      <>
                        <button onClick={() => togglePublish(r)} className="text-brand-cyan text-xs font-semibold mr-3">
                          {r.is_published ? "Despublicar" : "Publicar"}
                        </button>
                        <button onClick={() => remove(r)} className="text-brand-slate hover:text-brand-primary text-xs font-semibold">Eliminar</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
