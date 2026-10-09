"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrintButton } from "@/components/PrintButton";
import { VistaCoaching } from "@/components/supervision/coaching";
import { SUP_API, SUP_HREF, periodoDeUrl, periodoEnUrl, type VistaCoachingData } from "@/components/supervision/tipos";
import { SelectorMes, TabsSupervisor } from "@/components/supervision/ui";
import { apiFetch } from "@/lib/api";

/** Coaching y bitácora de un supervisor, para los jefes (solo lectura). */
export default function CoachingSupervisorPage() {
  return (
    <AppShell>
      <Detalle />
    </AppShell>
  );
}

function Detalle() {
  const { id } = useParams<{ id: string }>();
  const [periodo, setPeriodo] = useState(periodoDeUrl);
  const [d, setD] = useState<VistaCoachingData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    setError(null);
    try { setD(await apiFetch<VistaCoachingData>(`${SUP_API}/coaching?supervisor_id=${encodeURIComponent(id)}&periodo=${p}`)); }
    catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { setD(null); load(periodo); periodoEnUrl(periodo); }, [periodo, load]);

  return (
    <>
      <Link href={`${SUP_HREF}/coaching${periodo ? `?periodo=${periodo}` : ""}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-slate hover:text-brand-primary mb-4 print:hidden">
        <ArrowLeft size={14} /> Gestión de coaching de todos los supervisores
      </Link>
      <div className="mb-4 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Supervisor · {d?.nombre_mes ?? "…"}</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">{d?.supervisor.nombre ?? "…"}</h1>
          <p className="text-xs text-brand-slate mt-2">Lo que registró en su portal: coachings, seguimientos, alertas de uso y bitácora. Solo lectura.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap print:hidden">
          <SelectorMes periodo={periodo} onChange={setPeriodo} />
          <PrintButton />
        </div>
      </div>
      <TabsSupervisor id={id} periodo={periodo} activa="coaching" />
      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {!d ? (
        !error && <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : (
        <VistaCoaching d={d} portal={false} onCambio={() => load(periodo)} />
      )}
    </>
  );
}
