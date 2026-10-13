"use client";

import { Check, Copy, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { DatasetInfo, INT_API, urlDataset } from "./tipos";

function Codigo({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  const copiar = async () => { try { await navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1800); } catch { /* sin portapapeles */ } };
  return (
    <div className="relative">
      <pre className="rounded-md border border-brand-border bg-brand-bg px-3 py-2.5 text-xs overflow-x-auto whitespace-pre-wrap break-all">{texto}</pre>
      <button type="button" onClick={copiar} className="absolute top-1.5 right-1.5 btn-ghost !px-2 !py-1 text-xs" aria-label="Copiar">{ok ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}</button>
    </div>
  );
}

const PASOS = [
  { t: "Guardá la clave en KNIME", d: "Nodo Credentials Configuration (o Credentials Widget): pegá la clave como contraseña y dejá el usuario vacío. Queda cifrada con la clave maestra de KNIME y sale como variable de flujo." },
  { t: "GET Request", d: "Pegá la URL del dataset (abajo). En la pestaña Authentication elegí Bearer y apuntá a la variable del paso 1; en KNIME anterior a 5.4, agregá en Request Headers «Authorization» con valor «Bearer <clave>». Header «Accept: application/json»." },
  { t: "JSON Path", d: "Sobre la columna del cuerpo: expresión $.items[*] en modo colección, y después Ungroup. Cada fila del dataset queda como una fila de la tabla. Alternativa: pedí el dataset con formato=csv y leelo con CSV Reader desde la columna binaria." },
  { t: "Series históricas", d: "Con Table Row To Variable Loop Start recorrés rangos de fechas (desde y hasta) o ids de informe y acumulás con Loop End." },
];

export function GuiaKnime() {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [elegido, setElegido] = useState<string>("productividad_agentes");
  const [prueba, setPrueba] = useState<{ filas: number; columnas: string[]; items: Record<string, unknown>[] } | null>(null);
  const [probando, setProbando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiFetch<{ datasets: DatasetInfo[] }>(`${INT_API}/claves`).then((r) => setDatasets(r.datasets)).catch(() => undefined); }, []);
  const hoy = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const hace30 = useMemo(() => new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), []);
  const url = urlDataset(elegido, `?desde=${hace30}&hasta=${hoy}`);
  const probar = async () => {
    setProbando(true);
    setError(null);
    try {
      const r = await apiFetch<{ filas: number; columnas: string[]; items: Record<string, unknown>[] }>(`${INT_API}/datasets/${elegido}?desde=${hace30}&hasta=${hoy}`);
      setPrueba({ filas: r.filas, columnas: r.columnas, items: r.items.slice(0, 8) });
    } catch (e: any) { setError(e.message); } finally { setProbando(false); }
  };
  const d = datasets.find((x) => x.nombre === elegido);

  return (
    <>
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Integraciones</div>
        <h1 className="font-display text-3xl text-brand-ink uppercase mt-1">Conectar KNIME</h1>
        <p className="text-sm text-brand-slate mt-1 max-w-3xl">KNIME Analytics Platform (la aplicación de escritorio) se conecta por HTTPS con los nodos REST que trae instalados. Hace falta una <Link href="/televentas-claro/integraciones" className="text-brand-primary underline">clave de API</Link>. Lo mismo sirve para Power BI, Excel, Python o cualquier herramienta que haga llamadas HTTP.</p>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="font-display text-xl uppercase text-brand-ink mb-3">El workflow, paso a paso</h2>
            <ol className="space-y-3">
              {PASOS.map((p, i) => (
                <li key={p.t} className="flex gap-3">
                  <span className="w-7 h-7 shrink-0 rounded-full bg-brand-ink text-white grid place-items-center font-display text-base">{i + 1}</span>
                  <div><div className="font-semibold text-brand-ink">{p.t}</div><p className="text-sm text-brand-graphite mt-0.5">{p.d}</p></div>
                </li>
              ))}
            </ol>
          </section>

          <section className="card p-5">
            <h2 className="font-display text-xl uppercase text-brand-ink mb-1">La URL del dataset</h2>
            <p className="text-xs text-brand-slate mb-3">Parámetros opcionales: <code>desde</code> y <code>hasta</code> (YYYY-MM-DD, por defecto los últimos 30 días, hasta 400), <code>formato=csv</code> y <code>borradores=1</code> para incluir lo no publicado o no firmado. La respuesta JSON trae <code>filas</code>, <code>columnas</code> e <code>items</code>.</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {datasets.map((x) => (
                <button key={x.nombre} type="button" onClick={() => { setElegido(x.nombre); setPrueba(null); }}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${elegido === x.nombre ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border text-brand-graphite hover:border-brand-slate"}`}>{x.titulo}</button>
              ))}
            </div>
            {d && <p className="text-sm text-brand-graphite mb-2"><b>{d.titulo}.</b> {d.descripcion} <span className="text-brand-slate">Filtro de fechas: {d.fecha}.</span></p>}
            <Codigo texto={url} />
            <div className="mt-3 text-xs text-brand-slate">Desde la terminal o para probar la clave:</div>
            <Codigo texto={`curl -H "Authorization: Bearer vcop_TU_CLAVE" "${url}"`} />
            <div className="mt-3 flex items-center gap-3">
              <button type="button" className="btn-secondary" onClick={probar} disabled={probando}><Play size={15} /> {probando ? "Consultando…" : "Probar con mi sesión"}</button>
              <span className="text-xs text-brand-slate">Lo que vería KNIME (primeras filas), sin gastar una clave.</span>
            </div>
            {error && <div className="mt-3 rounded-md border border-brand-primary/30 bg-brand-primary-light px-3 py-2 text-sm text-brand-primary-dark">{error}</div>}
            {prueba && (
              <div className="mt-3">
                <div className="text-xs text-brand-slate mb-1">{prueba.filas.toLocaleString("es-PY")} fila(s) · {prueba.columnas.length} columna(s){prueba.filas > 8 ? " · se muestran 8" : ""}</div>
                {prueba.items.length === 0 ? <div className="text-sm text-brand-slate">Sin datos publicados en el rango.</div> : (
                  <div className="overflow-x-auto rounded-md border border-brand-border">
                    <table className="text-xs whitespace-nowrap">
                      <thead><tr className="bg-brand-bg text-left">{prueba.columnas.map((c) => <th key={c} className="px-2 py-1 font-semibold text-brand-slate">{c}</th>)}</tr></thead>
                      <tbody>{prueba.items.map((f, i) => <tr key={i} className="border-t border-brand-border/60">{prueba.columnas.map((c) => <td key={c} className="px-2 py-1 tabular-nums">{String(f[c] ?? "")}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="card p-5">
            <h2 className="font-display text-lg uppercase text-brand-ink mb-2">Qué tener en cuenta</h2>
            <ul className="text-sm text-brand-graphite space-y-2 list-disc pl-5">
              <li>Solo lectura sobre lo <b>publicado o firmado</b>. Facturación no se expone.</li>
              <li>Cada clave tiene <b>vencimiento y límites</b> por minuto y por día; al pasarse responde 429 con <code>Retry-After</code>.</li>
              <li>Todo uso queda en el <Link href="/televentas-claro/integraciones/usos" className="text-brand-primary underline">registro</Link>: dataset, filas, IP y resultado.</li>
              <li>La clave vive en la PC del analista: una por persona, y bloquearla ante cualquier duda.</li>
              <li>Catálogo con la clave: <code>GET {INT_API}/datasets</code>.</li>
            </ul>
          </section>
          <section className="card p-5">
            <h2 className="font-display text-lg uppercase text-brand-ink mb-2">Python o Power BI</h2>
            <Codigo texto={`import requests, pandas as pd\nr = requests.get("${urlDataset(elegido)}",\n    headers={"Authorization": "Bearer vcop_TU_CLAVE"}, timeout=60)\nr.raise_for_status()\ndf = pd.DataFrame(r.json()["items"])`} />
            <p className="text-xs text-brand-slate mt-2">En Power BI: Obtener datos → Web → Avanzado, con el header Authorization.</p>
          </section>
        </aside>
      </div>
    </>
  );
}
