"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LOG_API, LOG_HREF, type InformeResumen } from "@/components/logistica/tipos";
import { getToken } from "@/lib/api";

const hoy = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function LogisticaUploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [fechaCorte, setFechaCorte] = useState(hoy());
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError("Elegí el archivo .xlsx de pedidos."); return; }
    setError(null);
    setSubiendo(true);
    const form = new FormData();
    form.append("file", file);
    form.append("fecha_corte", fechaCorte);
    try {
      const token = getToken();
      const r = await fetch(`${LOG_API}/uploads`, { method: "POST", body: form, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof body.detail === "string" ? body.detail : body.detail?.message || "No se pudo subir el archivo");
      const informe: InformeResumen = body.informe;
      router.push(`${LOG_HREF}/informes/${informe.id}`);
    } catch (err: any) { setError(err.message); setSubiendo(false); }
  };

  return (
    <AppShell>
      <div className="mb-6">
        <Link href={LOG_HREF} className="text-xs text-brand-slate hover:text-brand-primary">← Informes</Link>
        <h1 className="font-display text-3xl text-brand-ink uppercase mt-1">Subir corte de pedidos</h1>
        <p className="text-sm text-brand-slate mt-1 max-w-2xl">
          El <code>.xlsx</code> de logística con una fila por pedido: <b>Nro. Formulario</b>, cliente, ciudad, departamento, <b>REGION</b>,{" "}
          <b>Fecha Venta</b>, vendedor, promoción, <b>ESTADO</b> y <b>MOTIVO</b>. El sistema detecta el mes por la fecha de venta y genera un
          <b> borrador</b> al instante; después lo publicás desde la lista.
        </p>
      </div>
      <form onSubmit={onSubmit} className="card p-7 max-w-3xl space-y-5">
        <div data-voi="archivo" className="rounded-lg">
          <label className="label">Archivo de pedidos (.xlsx)</label>
          <div onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }} onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastrando(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
            className={`rounded-lg border-2 border-dashed p-5 transition-colors ${arrastrando ? "border-brand-primary bg-brand-primary-light/40" : "border-brand-border"}`}>
            <input type="file" accept=".xlsx" disabled={subiendo} onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-brand-slate file:mr-4 file:py-2.5 file:px-5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:uppercase file:tracking-wider2 file:bg-brand-ink file:text-white hover:file:bg-brand-primary cursor-pointer" />
            <p className="text-xs text-brand-slate mt-2">O arrastrá el archivo acá.</p>
            {file && <p className="mt-1.5 text-xs text-emerald-700 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{file.name} ({(file.size / 1024).toFixed(0)} KB)</p>}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="fecha-corte">Fecha del corte</label>
          <input id="fecha-corte" type="date" className="input w-auto tabular-nums" value={fechaCorte} max={hoy()} onChange={(e) => setFechaCorte(e.target.value)} disabled={subiendo} />
          <p className="text-[11px] text-brand-slate mt-1">El día en que se bajó el reporte (por defecto, hoy). Desde ahí se mide la <b>demora</b> de los pedidos en gestión: días hábiles desde la venta hasta el corte, <b>sin contar los domingos</b>.</p>
        </div>
        {error && <div className="bg-brand-primary-light border border-brand-primary/30 text-brand-primary-dark text-sm rounded-md p-3">{error}</div>}
        <button type="submit" data-voi="procesar" disabled={subiendo} className="btn-primary text-base">{subiendo ? "Procesando…" : "Procesar corte"}</button>
      </form>
    </AppShell>
  );
}
