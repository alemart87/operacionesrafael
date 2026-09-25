"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RiesgosView } from "@/components/auditoria/RiesgosView";
import { AUD_API, AUD_HREF, fechaCorta, n, nombrePeriodo, pct, type Fuente, type Snapshot } from "@/components/auditoria/tipos";
import { apiFetch } from "@/lib/api";

const STATUS_LABEL: Record<Fuente["status"], string> = { published: "Publicado", draft: "Borrador", replaced: "Reemplazado" };

export default function RiesgosPage() {
  return (
    <AppShell>
      <Riesgos />
    </AppShell>
  );
}

function Riesgos() {
  const router = useRouter();
  const [fuentes, setFuentes] = useState<Fuente[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crear, setCrear] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [alcance, setAlcance] = useState("");
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    apiFetch<Fuente[]>(`${AUD_API}/fuentes`)
      .then((f) => {
        setFuentes(f);
        // Por defecto: el publicado de cada mes; si no hay, el corte más reciente.
        const porPeriodo = new Map<string, Fuente>();
        for (const x of f) {
          const cur = porPeriodo.get(x.periodo);
          if (!cur || (x.status === "published" && cur.status !== "published") || (cur.status !== "published" && (x.fecha_dato ?? "") > (cur.fecha_dato ?? ""))) porPeriodo.set(x.periodo, x);
        }
        const ultimo = [...porPeriodo.values()].sort((a, b) => b.periodo.localeCompare(a.periodo))[0];
        setSel(new Set(ultimo ? [ultimo.id] : []));
      })
      .catch((e) => setError(e.message));
  }, []);

  const porPeriodo = useMemo(() => {
    const m = new Map<string, Fuente[]>();
    for (const f of fuentes ?? []) m.set(f.periodo, [...(m.get(f.periodo) ?? []), f]);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [fuentes]);
  const periodosSel = new Set((fuentes ?? []).filter((f) => sel.has(f.id)).map((f) => f.periodo));
  const conflicto = (fuentes ?? []).filter((f) => sel.has(f.id)).length !== periodosSel.size;

  const toggle = (f: Fuente) => {
    const s = new Set(sel);
    if (s.has(f.id)) s.delete(f.id);
    else {
      // Un solo corte por mes: reemplaza el que estuviera elegido de ese período.
      for (const x of fuentes ?? []) if (x.periodo === f.periodo) s.delete(x.id);
      s.add(f.id);
    }
    setSel(s);
    setSnapshot(null);
  };

  const analizar = async () => {
    setAnalizando(true);
    setError(null);
    try {
      setSnapshot(await apiFetch<Snapshot>(`${AUD_API}/riesgos`, { method: "POST", body: JSON.stringify({ report_ids: [...sel] }) }));
    } catch (e: any) { setError(e.message); } finally { setAnalizando(false); }
  };

  const abrirCrear = () => {
    const per = [...periodosSel].sort();
    setTitulo(`Auditoría de ventas · ${per.length === 1 ? nombrePeriodo(per[0]) : `${nombrePeriodo(per[0])} a ${nombrePeriodo(per[per.length - 1])}`}`);
    setAlcance(`Revisión de las ventas netas de Televentas CLARO de ${per.map(nombrePeriodo).join(", ")}: líneas sin uso (alerta PFI), portaciones Sali Hablando, riesgo de las cargas, cargas pendientes y finalizadas sin activar, y comportamiento por vendedor.`);
    setCrear(true);
  };
  const crearInforme = async () => {
    setCreando(true);
    setError(null);
    try {
      const a = await apiFetch<{ id: string }>(`${AUD_API}/informes`, { method: "POST", body: JSON.stringify({ titulo, alcance, report_ids: [...sel] }) });
      router.push(`${AUD_HREF}/informes/${a.id}`);
    } catch (e: any) { setError(e.message); setCreando(false); }
  };

  return (
    <>
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Auditoría de Ventas</div>
        <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Riesgos</h1>
        <p className="text-sm text-brand-slate mt-2 max-w-2xl">Elegí los informes de Ventas Netas a analizar (uno por mes). El análisis muestra los riesgos en vivo; desde ahí se crea el informe de auditoría con esos datos congelados.</p>
      </div>

      {error && <div className="card p-4 text-brand-primary mb-4">{error}</div>}

      <section className="card p-5 mb-6">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <h2 className="font-display text-lg text-brand-ink uppercase">Fuentes</h2>
          <div className="flex gap-2">
            <button onClick={analizar} disabled={sel.size === 0 || analizando || conflicto} className="btn-secondary">{analizando ? "Analizando…" : `Analizar ${sel.size} fuente${sel.size === 1 ? "" : "s"}`}</button>
            <button onClick={abrirCrear} disabled={sel.size === 0 || conflicto} className="btn-primary">Crear informe de auditoría</button>
          </div>
        </div>
        {!fuentes ? (
          <div className="text-brand-slate text-sm">Cargando…</div>
        ) : fuentes.length === 0 ? (
          <div className="text-brand-slate text-sm">No hay informes de Ventas Netas todavía. Subí un corte en Ventas Netas para poder auditarlo.</div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {porPeriodo.map(([periodo, lista]) => (
              <div key={periodo} className="rounded-lg border border-brand-border p-3">
                <div className="font-display text-lg text-brand-ink uppercase mb-2">{nombrePeriodo(periodo)}</div>
                <ul className="space-y-1.5">
                  {lista.map((f) => (
                    <li key={f.id}>
                      <label className={`flex items-start gap-2 rounded-md p-2 cursor-pointer text-sm ${sel.has(f.id) ? "bg-brand-primary-light/60" : "hover:bg-brand-bg"}`}>
                        <input type="checkbox" className="mt-0.5" checked={sel.has(f.id)} onChange={() => toggle(f)} />
                        <span>
                          <span className="font-semibold">Corte al {fechaCorta(f.fecha_dato)}</span>{" "}
                          <span className={f.status === "published" ? "badge-success" : f.status === "draft" ? "badge-cyan" : "badge-neutral"}>{STATUS_LABEL[f.status]}</span>
                          {!f.actualizada && <span className="badge-orange ml-1" title={`Analizado con la versión ${f.analysis_version}; la auditoría lo recalcula sola al analizarlo.`}>Se actualiza al analizar</span>}
                          <span className="block text-xs text-brand-slate">{n(f.netas)} netas · {n(f.pospago_sin_uso)} sin uso ({pct(f.pct_sin_uso)}) · {n(f.pendientes)} pendientes</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {snapshot && <RiesgosView s={snapshot} />}
      {!snapshot && fuentes && fuentes.length > 0 && (
        <div className="card p-10 text-center text-brand-slate">Tocá <b>Analizar</b> para ver los riesgos de las fuentes elegidas.</div>
      )}

      {crear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-[2px]" onClick={() => !creando && setCrear(false)} />
          <div role="dialog" aria-modal="true" className="relative w-full max-w-xl card shadow-elevated animate-pop">
            <div className="h-1.5 bg-brand-primary" />
            <div className="p-6 space-y-4">
              <div>
                <h2 className="font-display text-2xl text-brand-ink uppercase leading-tight">Nuevo informe de auditoría</h2>
                <p className="text-sm text-brand-slate mt-1">Se congelan los datos de {sel.size} fuente{sel.size === 1 ? "" : "s"} y se generan los hallazgos automáticos. Después lo trabajás en Borrador.</p>
              </div>
              <div>
                <label className="label">Título</label>
                <input className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
              </div>
              <div>
                <label className="label">Alcance</label>
                <textarea className="input min-h-[100px]" value={alcance} onChange={(e) => setAlcance(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setCrear(false)} disabled={creando} className="btn-secondary">Cancelar</button>
                <button onClick={crearInforme} disabled={creando || titulo.trim().length < 3} className="btn-primary">{creando ? "Creando…" : "Crear informe"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
