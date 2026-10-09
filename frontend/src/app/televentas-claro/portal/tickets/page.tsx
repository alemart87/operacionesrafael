"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { KpisTickets, ListaTickets, MetodoTickets, TicketDialog, useCarga } from "@/components/supervision/tickets";
import { SUP_API, mesActual, periodoDeUrl, periodoEnUrl, type PortalTickets } from "@/components/supervision/tipos";
import { SelectorMes } from "@/components/supervision/ui";

/** Portal del supervisor · tickets: los casos que le envían los jefes y el auditor, con sus plazos. */
export default function TicketsPortalPage() {
  return (
    <AppShell>
      <Tickets />
    </AppShell>
  );
}

function Tickets() {
  const [periodo, setPeriodo] = useState(periodoDeUrl);
  const { d, error, cargar } = useCarga<PortalTickets>(`${SUP_API}/portal/tickets?periodo=${periodo}`);
  const [abierto, setAbierto] = useState<string | null>(null);
  useEffect(() => { periodoEnUrl(periodo); }, [periodo]);
  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Mi portal · Líder Coach Comercial</div>
          <h1 className="font-display text-4xl sm:text-5xl text-brand-ink uppercase leading-tight">Tickets</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-2xl">
            Casos que te envían los jefes y el auditor. Respondé, pedí los datos que falten o resolvé dentro del plazo: tu cumplimiento
            suma al scoring.
          </p>
        </div>
        <SelectorMes periodo={periodo} onChange={setPeriodo} max={mesActual()} />
      </div>
      {error && !d && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {!d ? (
        !error && <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : (
        <div className="space-y-6">
          <KpisTickets bandeja={d.bandeja} mes={d.mes} dia={d.info.dia_completo} nombreMes={d.nombre_mes} />
          <section className="card min-w-0">
            <div className="px-5 pt-5 pb-3">
              <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Mi bandeja</h2>
              <p className="text-xs text-brand-slate mt-0.5">Los abiertos primero (lo vencido y lo que está por vencer arriba), después los de {d.nombre_mes.toLowerCase()} ya resueltos o cerrados.</p>
            </div>
            <ListaTickets items={d.items} dia={d.info.dia_completo} conSupervisor={false} onAbrir={(t) => setAbierto(t.id)}
              vacio="No tenés tickets abiertos ni de este mes." />
          </section>
          <MetodoTickets info={d.info} />
        </div>
      )}
      {abierto && <TicketDialog id={abierto} portal onClose={() => setAbierto(null)} onCambio={cargar} />}
    </>
  );
}
