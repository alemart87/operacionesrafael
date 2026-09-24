"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { apiFetch, getToken } from "@/lib/api";

export default function FacturacionUploadPage() {
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
        const data = await apiFetch<{ status: string; last_error: string | null }>(
          `/api/v1/televentas-claro/facturacion/uploads/${uploadId}`,
        );
        setStatus(data.status);
        if (data.status === "completed") {
          clearInterval(interval);
          const reports = await apiFetch<{ items: { id: string; upload_id: string }[] }>("/api/v1/televentas-claro/facturacion/reports");
          const mine = reports.items.find((r) => r.upload_id === uploadId) || reports.items[0];
          if (mine) router.push(`/televentas-claro/facturacion/reports/${mine.id}`);
        } else if (data.status === "failed") {
          clearInterval(interval);
          setError(data.last_error || "Error desconocido");
        }
      } catch (e: any) {
        clearInterval(interval);
        setError(e.message);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [uploadId, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError("Seleccionar archivo .txt"); return; }
    setError(null);
    setSubmitting(true);
    setStatus("uploading");
    const form = new FormData();
    form.append("file", file);
    try {
      const token = getToken();
      const r = await fetch("/api/v1/televentas-claro/facturacion/uploads", {
        method: "POST",
        body: form,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || "Error al subir");
      }
      const data = await r.json();
      setUploadId(data.id);
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
        <h1 className="font-display text-3xl text-brand-ink uppercase">Subir liquidación · Televentas CLARO</h1>
        <p className="text-sm text-brand-slate mt-1">
          Archivo <code>.txt</code> de liquidación de comisiones (delimitado por <code>;</code>). Cada archivo = una liquidación mensual. El período se detecta automáticamente.
        </p>
      </div>

      <form onSubmit={onSubmit} className="card p-7 max-w-3xl space-y-5">
        <div>
          <label className="label">Archivo de liquidación (.txt)</label>
          <input
            type="file"
            accept=".txt"
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
        {status && status !== "completed" && !error && (
          <div className="bg-brand-cyan/10 border border-brand-cyan/30 text-brand-cyan text-sm rounded-md p-3 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-brand-cyan animate-pulse" />
            Estado: <b>{status}</b> · procesando en cola…
          </div>
        )}

        <button type="submit" disabled={submitting || !!uploadId} className="btn-primary text-base">
          {submitting ? "Subiendo…" : "Procesar liquidación"}
        </button>
      </form>
    </AppShell>
  );
}
