"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { VN_API, VN_HREF, type ListaInformes } from "@/components/ventas-netas/tipos";
import { apiFetch, getToken } from "@/lib/api";

const ESTADO: Record<string, string> = {
  uploading: "Subiendo el archivo…",
  pending: "En cola de procesamiento…",
  processing: "Procesando el corte (DDI, CARGAS y PORTABILIDAD)…",
};

export default function VentasNetasUploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);

  useEffect(() => {
    if (!uploadId) return;
    const interval = setInterval(async () => {
      try {
        const data = await apiFetch<{ status: string; last_error: string | null }>(`${VN_API}/uploads/${uploadId}`);
        setStatus(data.status);
        if (data.status === "completed") {
          clearInterval(interval);
          const lista = await apiFetch<ListaInformes>(`${VN_API}/reports`);
          const mio = lista.items.find((r) => r.upload_id === uploadId);
          router.push(mio ? `${VN_HREF}/reports/${mio.id}` : VN_HREF);
        } else if (data.status === "failed") {
          clearInterval(interval);
          setError(data.last_error || "No se pudo procesar el archivo.");
          setUploadId(null);
          setStatus(null);
        }
      } catch (e: any) {
        clearInterval(interval);
        setError(e.message);
        setUploadId(null);
        setStatus(null);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [uploadId, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError("Seleccioná el archivo .xlsx de Claro."); return; }
    setError(null);
    setSubmitting(true);
    setStatus("uploading");
    const form = new FormData();
    form.append("file", file);
    try {
      const token = getToken();
      const r = await fetch(`${VN_API}/uploads`, { method: "POST", body: form, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(typeof body.detail === "string" ? body.detail : "Error al subir el archivo");
      }
      setUploadId((await r.json()).id);
      setStatus("pending");
    } catch (err: any) {
      setError(err.message);
      setStatus(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="mb-6">
        <Link href={VN_HREF} className="text-xs text-brand-slate hover:text-brand-primary">← Informes</Link>
        <h1 className="font-display text-3xl text-brand-ink uppercase mt-1">Subir corte de ventas</h1>
        <p className="text-sm text-brand-slate mt-1 max-w-2xl">
          El archivo <code>.xlsx</code> que envía Claro con las hojas <b>DDI</b>, <b>CARGAS</b> y <b>PORTABILIDAD</b>.
          El sistema detecta el mes por la fecha de venta y genera un <b>borrador</b>; después lo publicás desde la lista.
        </p>
      </div>

      <form onSubmit={onSubmit} className="card p-7 max-w-3xl space-y-5">
        <div>
          <label className="label">Archivo de ventas (.xlsx)</label>
          <input
            type="file"
            accept=".xlsx"
            disabled={!!uploadId}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-brand-slate file:mr-4 file:py-2.5 file:px-5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:uppercase file:tracking-wider2 file:bg-brand-ink file:text-white hover:file:bg-brand-primary cursor-pointer"
          />
          {file && (
            <p className="mt-1.5 text-xs text-emerald-700 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
            </p>
          )}
        </div>

        {error && (
          <div className="bg-brand-primary-light border border-brand-primary/30 text-brand-primary-dark text-sm rounded-md p-3">{error}</div>
        )}
        {status && !error && (
          <div className="bg-brand-cyan/10 border border-brand-cyan/30 text-brand-cyan text-sm rounded-md p-3 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-brand-cyan animate-pulse" />
            {ESTADO[status] ?? status}
          </div>
        )}

        <button type="submit" disabled={submitting || !!uploadId} className="btn-primary text-base">
          {submitting ? "Subiendo…" : "Procesar corte"}
        </button>
      </form>
    </AppShell>
  );
}
