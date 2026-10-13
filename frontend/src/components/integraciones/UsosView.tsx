"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { INT_API, RESULTADO, Uso, fechaHora } from "./tipos";

const n = (v: number) => v.toLocaleString("es-PY");
type Dia = { fecha: string; ok: number; limite: number; denegada: number; error: number };

export function UsosView() {
  const [dias, setDias] = useState(7);
  const [data, setData] = useState<{ desde: string; items: Uso[]; por_dia: Dia[] } | null>(null);
  const [filtro, setFiltro] = useState<"todos" | Uso["resultado"]>("todos");
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    try { setData(await apiFetch(`${INT_API}/usos?dias=${dias}&limit=1000`)); } catch (e: any) { setError(e.message); }
  }, [dias]);
  useEffect(() => { cargar(); }, [cargar]);
  const items = (data?.items ?? []).filter((u) => filtro === "todos" || u.resultado === filtro);
  const total = (data?.por_dia ?? []).reduce((a, d) => ({ ok: a.ok + d.ok, rech: a.rech + d.limite + d.denegada + d.error }), { ok: 0, rech: 0 });
  const max = Math.max(1, ...(data?.por_dia ?? []).map((d) => d.ok + d.limite + d.denegada + d.error));

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Integraciones</div>
          <h1 className="font-display text-3xl text-brand-ink uppercase mt-1">Registro de uso</h1>
          <p className="text-sm text-brand-slate mt-1 max-w-3xl">Cada llamada con una clave de API: atendida, por encima del límite, denegada (clave bloqueada, vencida, desconocida o sin acceso al dataset) o con error.</p>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <button key={d} type="button" onClick={() => setDias(d)} className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${dias === d ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border text-brand-graphite"}`}>{d} días</button>
          ))}
        </div>
      </div>
      {error && <div className="mb-4 rounded-md border border-brand-primary/30 bg-brand-primary-light px-3 py-2.5 text-sm text-brand-primary-dark">{error}</div>}
      {data && (
        <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
          <div className="card p-4">
            <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold">Desde el {data.desde.split("-").reverse().join("/")}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-brand-bg px-3 py-2"><div className="text-brand-slate">Atendidas</div><div className="font-display text-xl text-brand-ink tabular-nums">{n(total.ok)}</div></div>
              <div className="rounded-md bg-brand-bg px-3 py-2"><div className="text-brand-slate">Rechazadas</div><div className={`font-display text-xl tabular-nums ${total.rech ? "text-brand-primary" : "text-brand-ink"}`}>{n(total.rech)}</div></div>
            </div>
            <div className="mt-3 space-y-1.5">
              {data.por_dia.length === 0 && <div className="text-xs text-brand-slate">Sin llamadas en el período.</div>}
              {data.por_dia.map((d) => {
                const t = d.ok + d.limite + d.denegada + d.error;
                return (
                  <div key={d.fecha} className="text-xs">
                    <div className="flex justify-between text-brand-slate"><span className="tabular-nums">{d.fecha.slice(8)}/{d.fecha.slice(5, 7)}</span><span className="tabular-nums">{n(t)}</span></div>
                    <div className="h-1.5 rounded-full bg-brand-bg overflow-hidden flex">
                      <div className="bg-brand-cyan" style={{ width: `${(d.ok / max) * 100}%` }} />
                      <div className="bg-brand-primary" style={{ width: `${((t - d.ok) / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card p-4 min-w-0">
            <div className="flex flex-wrap gap-1 mb-3">
              {(["todos", "ok", "limite", "denegada", "error"] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFiltro(f)} className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${filtro === f ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border text-brand-graphite"}`}>
                  {f === "todos" ? "Todos" : RESULTADO[f].label}
                </button>
              ))}
              <span className="ml-auto text-xs text-brand-slate self-center">{n(items.length)} registro(s)</span>
            </div>
            {items.length === 0 ? <div className="text-sm text-brand-slate">Nada que mostrar.</div> : (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
                    <th className="py-1.5 pr-3">Cuándo</th><th className="py-1.5 pr-3">Clave</th><th className="py-1.5 pr-3">Dataset</th><th className="py-1.5 pr-3">Resultado</th>
                    <th className="py-1.5 pr-3 text-right">Filas</th><th className="py-1.5 pr-3 text-right">ms</th><th className="py-1.5 pr-3">IP</th><th className="py-1.5">Detalle</th>
                  </tr></thead>
                  <tbody>
                    {items.map((u) => (
                      <tr key={u.id} className="border-b border-brand-border/60 align-top">
                        <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{fechaHora(u.at)}</td>
                        <td className="py-1.5 pr-3"><b className="text-brand-ink">{u.clave}</b> <code className="text-brand-slate">{u.prefijo}…</code></td>
                        <td className="py-1.5 pr-3"><code>{u.dataset ?? "catálogo"}</code></td>
                        <td className="py-1.5 pr-3"><span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${RESULTADO[u.resultado].clase}`}>{RESULTADO[u.resultado].label} · {u.status}</span></td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{n(u.filas)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{n(u.ms)}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{u.ip ?? "—"}</td>
                        <td className="py-1.5 text-brand-slate max-w-[280px]">{u.detalle ?? (u.user_agent ? u.user_agent.slice(0, 70) : "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
