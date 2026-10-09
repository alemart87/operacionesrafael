"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { nombreMes } from "@/components/productividad/tipos";
import { BandejaJefes } from "@/components/supervision/tickets";
import { periodoDeUrl, periodoEnUrl } from "@/components/supervision/tipos";
import { SelectorMes } from "@/components/supervision/ui";

/** Tickets de revisión: los jefes y el auditor envían casos a los supervisores y siguen sus plazos. */
export default function TicketsPage() {
  return (
    <AppShell>
      <Tickets />
    </AppShell>
  );
}

function Tickets() {
  const [periodo, setPeriodo] = useState(periodoDeUrl);
  useEffect(() => { periodoEnUrl(periodo); }, [periodo]);
  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Supervisión · {nombreMes(periodo)}</div>
          <h1 className="font-display text-4xl sm:text-5xl text-brand-ink uppercase leading-tight">Tickets de revisión</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-2xl">
            Casos que los jefes y el auditor envían a los supervisores, con plazos en horas hábiles para responderlos y resolverlos.
            Primero, lo vencido.
          </p>
        </div>
        <SelectorMes periodo={periodo} onChange={setPeriodo} />
      </div>
      <BandejaJefes periodo={periodo} />
    </>
  );
}
