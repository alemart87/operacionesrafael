"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { AUD_API, AUD_HREF, ESTADO_AUD_LABEL, fechaHora, n, rangoPeriodos, type AuditoriaResumen, type EstadoAuditoria } from "@/components/auditoria/tipos";
import { apiFetch } from "@/lib/api";

const ESTADO_CLS: Record<EstadoAuditoria, string> = { borrador: "badge-cyan", en_revision: "badge-primary", cerrado: "badge-success", archivado: "badge-neutral" };

export default function AuditoriaPage() {
  return (
    <AppShell>
      <Panel />
    </AppShell>
  );
}

function Panel() {
  const [lista, setLista] = useState<{ items: AuditoriaResumen[]; usuarios: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"curso" | "cerrados" | "archivados" | "todos">("curso");

  useEffect(() => {
    apiFetch(`${AUD_API}/informes`).then(setLista).catch((e) => setError(e.message));
  }, []);

  const items = useMemo(() => {
    const all = lista?.items ?? [];
    if (filtro === "curso") return all.filter((a) => a.status === "borrador" || a.status === "en_revision");
    if (filtro === "cerrados") return all.filter((a) => a.status === "cerrado");
    if (filtro === "archivados") return all.filter((a) => a.status === "archivado");
    return all;
  }, [lista, filtro]);
  const all = lista?.items ?? [];
  const nombre = (id: string | null) => (id && lista?.usuarios[id]) || "—";

  return (
    <>
      <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Televentas CLARO</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Auditoría de Ventas</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-2xl">
            Informes de auditoría sobre las ventas netas. Cada informe congela los datos que analizó, arranca con los hallazgos automáticos y sigue su circuito: borrador, revisión, cierre y archivo.
          </p>
        </div>
        <Link href={`${AUD_HREF}/riesgos`} className="btn-primary">Nuevo informe de auditoría</Link>
      </div>

      {error && <div className="card p-4 text-brand-primary mb-4">{error}</div>}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="En curso" value={n(all.filter((a) => a.status === "borrador" || a.status === "en_revision").length)} hint="borradores y en revisión" accent="cyan" />
        <KpiCard label="Cerrados" value={n(all.filter((a) => a.status === "cerrado").length)} hint="emitidos, con seguimiento" accent="secondary" />
        <KpiCard label="Hallazgos abiertos" value={n(all.filter((a) => a.status !== "archivado").reduce((s, a) => s + a.hallazgos_abiertos, 0))} hint="en informes no archivados" accent="danger" />
        <KpiCard label="Severidad alta" value={n(all.filter((a) => a.status !== "archivado").reduce((s, a) => s + a.hallazgos_alta, 0))} hint="hallazgos de severidad alta vigentes" accent="orange" />
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-brand-border flex items-center gap-2 flex-wrap">
          {([["curso", "En curso"], ["cerrados", "Cerrados"], ["archivados", "Archivados"], ["todos", "Todos"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setFiltro(v)} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${filtro === v ? "bg-brand-ink text-white" : "text-brand-slate hover:bg-brand-bg"}`}>{l}</button>
          ))}
        </div>
        {!lista ? (
          <div className="p-10 text-brand-slate">Cargando…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-brand-slate">
            {all.length === 0 ? "Todavía no hay informes de auditoría. Empezá por Riesgos: elegí los informes de Ventas Netas a analizar y creá el primero." : "Nada en este filtro."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
                <th className="px-5 py-2.5">Informe</th>
                <th className="px-3 py-2.5">Período</th>
                <th className="px-3 py-2.5">Estado</th>
                <th className="px-3 py-2.5 text-right">Fuentes</th>
                <th className="px-3 py-2.5 text-right">Hallazgos</th>
                <th className="px-3 py-2.5 text-right">Abiertos</th>
                <th className="px-3 py-2.5 text-right">Alta</th>
                <th className="px-3 py-2.5">Auditor</th>
                <th className="px-5 py-2.5">Última actividad</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b border-brand-border/60 hover:bg-brand-bg/50">
                  <td className="px-5 py-2.5">
                    <Link href={`${AUD_HREF}/informes/${a.id}`} className="font-semibold text-brand-ink hover:text-brand-primary">
                      <span className="text-brand-slate text-xs mr-2">{a.codigo}</span>{a.titulo}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">{rangoPeriodos(a)}</td>
                  <td className="px-3 py-2.5"><span className={ESTADO_CLS[a.status]}>{ESTADO_AUD_LABEL[a.status]}</span></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{n(a.fuentes.length)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{n(a.hallazgos_total)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{a.hallazgos_abiertos ? <b className="text-brand-primary">{n(a.hallazgos_abiertos)}</b> : "0"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{n(a.hallazgos_alta)}</td>
                  <td className="px-3 py-2.5 text-xs">{nombre(a.created_by)}</td>
                  <td className="px-5 py-2.5 text-xs text-brand-slate">{fechaHora(a.updated_at ?? a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
