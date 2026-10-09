"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LineaDeTiempo } from "@/components/supervision/comando";
import { SUP_API, SUP_HREF, periodoDeUrl, periodoEnUrl, type LineaTiempo, type SupervisorRef } from "@/components/supervision/tipos";
import { SelectorMes, TabsSupervisor } from "@/components/supervision/ui";
import { apiFetch } from "@/lib/api";

/** Trazabilidad de un supervisor: todo lo que pasó en el mes, para los jefes. */
export default function LineaSupervisorPage() {
  return (
    <AppShell>
      <Detalle />
    </AppShell>
  );
}

function Detalle() {
  const { id } = useParams<{ id: string }>();
  const [periodo, setPeriodo] = useState(periodoDeUrl);
  const [d, setD] = useState<LineaTiempo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supervisores, setSupervisores] = useState<SupervisorRef[]>([]);

  const cargar = useCallback(async (p: string) => {
    setError(null);
    try { setD(await apiFetch<LineaTiempo>(`${SUP_API}/supervisores/${id}/linea?periodo=${p}`)); } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { setD(null); cargar(periodo); periodoEnUrl(periodo); }, [periodo, cargar]);
  useEffect(() => {
    apiFetch<{ items: SupervisorRef[] }>(`${SUP_API}/supervisores`).then((r) => setSupervisores(r.items)).catch(() => setSupervisores([]));
  }, []);

  return (
    <>
      <Link href={`${SUP_HREF}/comando`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-slate hover:text-brand-primary mb-4 print:hidden">
        <ArrowLeft size={14} /> Centro de comandos
      </Link>
      <div className="mb-4 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Supervisor · {d?.nombre_mes ?? "…"}</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">{d?.supervisor.nombre ?? "…"}</h1>
          <p className="text-xs text-brand-slate mt-2">Qué hizo en el mes y qué le pasó a su equipo, en orden.</p>
        </div>
        <SelectorMes periodo={periodo} onChange={setPeriodo} />
      </div>
      <TabsSupervisor id={id} periodo={periodo} activa="linea" />
      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {!d ? (
        !error && <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : (
        <LineaDeTiempo d={d} supervisores={supervisores.map((s) => ({ id: s.id, nombre: s.nombre }))} onCambio={() => cargar(periodo)} />
      )}
    </>
  );
}
