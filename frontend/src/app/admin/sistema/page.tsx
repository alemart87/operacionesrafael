"use client";

import { AlertTriangle, CheckCircle2, Database, FolderOpen, HardDrive, Info, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

interface Modulo {
  modulo: string; total: number; en_base: number | null; en_disco: number | null; sin_respaldo: number; que: string; recalcula: string;
}
interface Diagnostico {
  entorno: string;
  estado: "ok" | "riesgo";
  base: { motor: string; version: string | null; bytes: number | null; persistente?: boolean; error?: string };
  archivos: {
    ruta: string; configurado: string; ajustado: boolean; disco: string | null; discos: string[];
    espacio: { total: number; usado: number; libre: number } | null;
    carpetas: { carpeta: string; archivos: number; bytes: number }[];
  };
  modulos: Modulo[];
  mensajes: { nivel: "riesgo" | "aviso"; texto: string }[];
}

const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("es-PY"));
function tamano(b: number | null | undefined): string {
  if (b === null || b === undefined) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let x = b;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return `${x.toLocaleString("es-PY", { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
}
const CARPETA: Record<string, string> = { ventas_netas: "Ventas Netas", facturacion: "Facturación", photos: "Fotos de perfil" };

/** Dónde quedan los datos (solo superadmin): la base, el disco persistente y qué se recalcula sin el disco. */
export default function SistemaPage() {
  return (
    <AppShell>
      <Sistema />
    </AppShell>
  );
}

function Sistema() {
  const [d, setD] = useState<Diagnostico | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const load = useCallback(async () => {
    setCargando(true);
    setError(null);
    try { setD(await apiFetch<Diagnostico>("/api/v1/sistema/almacenamiento")); } catch (e: any) { setError(e.message); }
    setCargando(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const motor = d?.base.motor === "postgresql" ? "PostgreSQL" : d?.base.motor === "sqlite" ? "SQLite" : d?.base.motor;
  const esp = d?.archivos.espacio;
  const pctUsado = esp && esp.total ? Math.round((esp.usado / esp.total) * 100) : null;

  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Administración · Sistema</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Almacenamiento</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-3xl">
            Dónde quedan los datos. La <b>base de datos</b> guarda todas las tablas, los informes y lo necesario para recalcularlos; el
            <b> disco</b> guarda los archivos originales y las fotos. Lo que no está en un lugar persistente se pierde en cada despliegue.
          </p>
        </div>
        <button type="button" onClick={load} disabled={cargando} className="btn-secondary"><RefreshCw size={15} className={cargando ? "animate-spin" : ""} /> Actualizar</button>
      </div>

      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {!d ? (!error && <div className="card p-10 text-brand-slate">Cargando…</div>) : (
        <div className="space-y-5">
          <div role="status" className={`rounded-md border p-4 flex items-start gap-3 ${d.estado === "ok" ? "border-emerald-300 bg-emerald-50" : "border-brand-primary/40 bg-brand-primary-light"}`}>
            {d.estado === "ok" ? <CheckCircle2 size={20} className="text-emerald-600 shrink-0 mt-0.5" /> : <AlertTriangle size={20} className="text-brand-primary-dark shrink-0 mt-0.5" />}
            <div className="min-w-0 text-sm text-brand-graphite">
              <div className="font-semibold text-brand-ink">
                {d.estado === "ok" ? "Los datos están en lugares persistentes." : "Hay datos que se pueden perder en el próximo despliegue."}
              </div>
              {d.mensajes.length > 0 ? (
                <ul className="mt-1.5 space-y-1 list-disc pl-5">
                  {d.mensajes.map((m, i) => <li key={i} className={m.nivel === "riesgo" ? "text-brand-primary-dark" : ""}>{m.texto}</li>)}
                </ul>
              ) : <p className="mt-0.5 text-brand-slate">La base y el disco de archivos son persistentes, y todo lo que se recalcula tiene su respaldo.</p>}
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <section className="card p-5 min-w-0">
              <h2 className="font-display text-xl uppercase text-brand-ink leading-tight flex items-center gap-2"><Database size={17} className="text-brand-slate" /> Base de datos</h2>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div><dt className="text-xs text-brand-slate">Motor</dt><dd className="font-semibold text-brand-ink">{motor}{d.base.version ? ` ${d.base.version}` : ""}</dd></div>
                <div><dt className="text-xs text-brand-slate">Tamaño</dt><dd className="font-semibold text-brand-ink tabular-nums">{tamano(d.base.bytes)}</dd></div>
                <div className="col-span-2">
                  <dt className="text-xs text-brand-slate">Persistencia</dt>
                  <dd className={`font-semibold ${d.base.persistente === false ? "text-brand-primary-dark" : "text-emerald-700"}`}>
                    {d.base.motor === "postgresql" ? "Persistente: es un servicio aparte, no depende del disco ni de los despliegues."
                      : d.base.persistente === false ? "Se pierde en cada despliegue: no está en un disco persistente." : "Archivo local (desarrollo)."}
                  </dd>
                </div>
              </dl>
              {d.base.error && <p className="text-xs text-brand-primary mt-3">No se pudo consultar todo: {d.base.error}</p>}
            </section>

            <section className="card p-5 min-w-0">
              <h2 className="font-display text-xl uppercase text-brand-ink leading-tight flex items-center gap-2"><HardDrive size={17} className="text-brand-slate" /> Disco de archivos</h2>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div className="col-span-2 min-w-0">
                  <dt className="text-xs text-brand-slate">Carpeta en uso</dt>
                  <dd className="font-mono text-xs text-brand-ink break-all">{d.archivos.ruta}</dd>
                  {d.archivos.ajustado && <dd className="text-[11px] text-[#8A5200] mt-0.5">Configurada en {d.archivos.configurado}, fuera del disco: se ajustó sola.</dd>}
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-brand-slate">Disco persistente</dt>
                  <dd className={`font-semibold ${d.archivos.disco ? "text-emerald-700" : "text-brand-primary-dark"}`}>
                    {d.archivos.disco ? <span className="font-mono text-xs">{d.archivos.disco}</span> : "Ninguno: efímero"}
                  </dd>
                  {!d.archivos.disco && d.archivos.discos.length > 0 && (
                    <dd className="text-[11px] text-brand-slate mt-0.5">Montados: <span className="font-mono">{d.archivos.discos.join(", ")}</span></dd>
                  )}
                </div>
                <div>
                  <dt className="text-xs text-brand-slate">Espacio</dt>
                  <dd className="font-semibold text-brand-ink tabular-nums">{esp ? `${tamano(esp.libre)} libres de ${tamano(esp.total)}` : "—"}</dd>
                </div>
              </dl>
              {pctUsado !== null && (
                <div className="mt-3">
                  <div className="h-2 rounded-full bg-brand-bg overflow-hidden" role="img" aria-label={`${pctUsado}% usado`}>
                    <div className={`h-full rounded-full ${pctUsado > 90 ? "bg-brand-primary" : "bg-brand-cyan"}`} style={{ width: `${Math.max(pctUsado, 1)}%` }} />
                  </div>
                  <div className="text-[11px] text-brand-slate mt-1">{pctUsado}% usado</div>
                </div>
              )}
              {d.archivos.carpetas.length > 0 && (
                <ul className="mt-4 divide-y divide-brand-border border-t border-brand-border text-sm">
                  {d.archivos.carpetas.map((c) => (
                    <li key={c.carpeta} className="py-2 flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-brand-graphite"><FolderOpen size={14} className="text-brand-slate" /> {CARPETA[c.carpeta] ?? c.carpeta}</span>
                      <span className="text-xs text-brand-slate tabular-nums">{n(c.archivos)} archivo(s) · {tamano(c.bytes)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="card min-w-0">
            <div className="p-5 pb-3">
              <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Qué se puede recalcular sin el disco</h2>
              <p className="text-xs text-brand-slate mt-0.5">
                Cada módulo guarda en la base lo que necesita para recalcular sus informes. «Sin respaldo» = ni en la base ni en el disco.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="bg-brand-bg text-[10px] uppercase tracking-wider2 text-brand-slate text-left">
                    <th className="px-5 py-2.5">Módulo</th>
                    <th className="px-3 py-2.5">Qué guarda</th>
                    <th className="px-3 py-2.5 text-right">Cargas</th>
                    <th className="px-3 py-2.5 text-right">En la base</th>
                    <th className="px-3 py-2.5 text-right">En el disco</th>
                    <th className="px-3 py-2.5 text-right">Sin respaldo</th>
                    <th className="px-5 py-2.5">Se recalcula</th>
                  </tr>
                </thead>
                <tbody>
                  {d.modulos.map((m) => (
                    <tr key={m.modulo} className="border-t border-brand-border">
                      <td className="px-5 py-2.5 font-semibold text-brand-ink whitespace-nowrap">{m.modulo}</td>
                      <td className="px-3 py-2.5 text-brand-graphite">{m.que}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{n(m.total)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{n(m.en_base)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{n(m.en_disco)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${m.sin_respaldo ? "text-brand-primary-dark" : "text-emerald-700"}`}>{n(m.sin_respaldo)}</td>
                      <td className="px-5 py-2.5 text-xs text-brand-slate">{m.recalcula}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-display text-lg uppercase text-brand-ink leading-tight flex items-center gap-2"><Info size={16} className="text-brand-slate" /> Cómo tiene que quedar en Render</h2>
            <ol className="mt-3 space-y-2 text-sm text-brand-graphite list-decimal pl-5">
              <li>
                <b>Disco del servicio web</b> (Disks): su <i>Mount path</i> (p. ej. <code className="font-mono text-xs">/persistent</code>) es lo único que
                sobrevive a un despliegue; Render le toma una copia automática cada 24 h.
              </li>
              <li>
                <b>Variable <code className="font-mono text-xs">UPLOAD_DIR</code></b> = <code className="font-mono text-xs">&lt;mount path&gt;/uploads</code>{" "}
                (p. ej. <code className="font-mono text-xs">/persistent/uploads</code>). Si quedó afuera y hay un solo disco, el sistema la ajusta solo, pero conviene dejarla explícita.
              </li>
              <li>
                <b>Base PostgreSQL</b> en un plan pago: tiene respaldo continuo y se puede recuperar a un momento de los últimos días. Las gratuitas no tienen recuperación.
              </li>
            </ol>
            <p className="text-xs text-brand-slate mt-3">
              Con un disco, cada despliegue deja el servicio sin respuesta unos segundos mientras Render cambia de instancia.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
