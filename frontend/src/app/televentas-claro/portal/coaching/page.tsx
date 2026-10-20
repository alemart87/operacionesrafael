"use client";

import { History } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PortalShell } from "@/components/portal/nav";
import { VistaCoaching } from "@/components/supervision/coaching";
import { SUP_API, mesActual, periodoDeUrl, periodoEnUrl, type VistaCoachingData } from "@/components/supervision/tipos";
import { SelectorMes } from "@/components/supervision/ui";
import { apiFetch } from "@/lib/api";

/** Portal del supervisor · Mi mes: el coaching y la bitácora del mes (cada coaching se abre en su pantalla). */
export default function CoachingPortalPage() {
  return (
    <PortalShell>
      <Coaching />
    </PortalShell>
  );
}

function Coaching() {
  const [periodo, setPeriodo] = useState(periodoDeUrl);
  const [d, setD] = useState<VistaCoachingData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    setError(null);
    try { setD(await apiFetch<VistaCoachingData>(`${SUP_API}/portal/coaching?periodo=${p}`)); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { setD(null); load(periodo); periodoEnUrl(periodo); }, [periodo, load]);

  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Mi portal · Líder Coach Comercial</div>
          <h1 className="font-display text-[34px] sm:text-5xl text-brand-ink uppercase leading-tight">Mi mes</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-2xl">
            Tu gestión de coaching: devoluciones sin firmar, seguimientos, alertas de uso, el equipo y la bitácora. El sistema mide el
            impacto con los datos de llamadas y ventas, y tu gestión suma al scoring.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap print:hidden">
          <Link href="/televentas-claro/portal/historial" className="btn-secondary !py-2 !px-4 text-xs"><History size={15} /> Mi historial</Link>
          <SelectorMes periodo={periodo} onChange={setPeriodo} max={mesActual()} />
        </div>
      </div>
      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {!d ? (
        !error && <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : (
        <VistaCoaching d={d} portal onCambio={() => load(periodo)} />
      )}
    </>
  );
}
