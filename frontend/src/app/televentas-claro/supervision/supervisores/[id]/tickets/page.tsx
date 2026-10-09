"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { nombreMes } from "@/components/productividad/tipos";
import { BandejaJefes } from "@/components/supervision/tickets";
import { SUP_API, SUP_HREF, periodoDeUrl, periodoEnUrl, type SupervisorRef } from "@/components/supervision/tipos";
import { SelectorMes, TabsSupervisor } from "@/components/supervision/ui";
import { apiFetch } from "@/lib/api";

/** Los tickets de un supervisor, para los jefes. */
export default function TicketsSupervisorPage() {
  return (
    <AppShell>
      <Detalle />
    </AppShell>
  );
}

function Detalle() {
  const { id } = useParams<{ id: string }>();
  const [periodo, setPeriodo] = useState(periodoDeUrl);
  const [nombre, setNombre] = useState<string | null>(null);
  useEffect(() => { periodoEnUrl(periodo); }, [periodo]);
  useEffect(() => {
    apiFetch<{ items: SupervisorRef[] }>(`${SUP_API}/supervisores`)
      .then((r) => setNombre(r.items.find((s) => s.id === id)?.nombre ?? "Supervisor"))
      .catch(() => setNombre("Supervisor"));
  }, [id]);
  return (
    <>
      <Link href={`${SUP_HREF}/tickets${periodo ? `?periodo=${periodo}` : ""}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-slate hover:text-brand-primary mb-4 print:hidden">
        <ArrowLeft size={14} /> Tickets de todos los supervisores
      </Link>
      <div className="mb-4 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Supervisor · {nombreMes(periodo)}</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">{nombre ?? "…"}</h1>
          <p className="text-xs text-brand-slate mt-2">Sus tickets de revisión: la bandeja de hoy, el cumplimiento del mes y cada caso con su historial.</p>
        </div>
        <SelectorMes periodo={periodo} onChange={setPeriodo} />
      </div>
      <TabsSupervisor id={id} periodo={periodo} activa="tickets" />
      <BandejaJefes periodo={periodo} supervisorFijo={id} />
    </>
  );
}
