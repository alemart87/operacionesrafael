"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { fechaHora } from "@/components/productividad/tipos";
import { SUP_API, mesActual, periodoDeUrl, periodoEnUrl, type DetalleSupervisor } from "@/components/supervision/tipos";
import { CoachingFlotante, hrefNuevoCoaching } from "@/components/supervision/hacer-coaching";
import { CriticoBadge, ParaHoyCard, SelectorMes, VistaSupervisor } from "@/components/supervision/ui";
import { apiFetch } from "@/lib/api";

/** Portal del supervisor (modelo Líder Coach Comercial): lo único que ve el perfil Supervisor. */
export default function PortalPage() {
  return (
    <AppShell>
      <Portal />
    </AppShell>
  );
}

function Portal() {
  const { user } = useSession();
  const [periodo, setPeriodo] = useState(periodoDeUrl);
  const [d, setD] = useState<DetalleSupervisor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ancla = useRef<HTMLDivElement>(null);

  const load = useCallback(async (p: string) => {
    setError(null);
    try { setD(await apiFetch<DetalleSupervisor>(`${SUP_API}/portal?periodo=${p}`)); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { setD(null); load(periodo); periodoEnUrl(periodo); }, [periodo, load]);

  const nombre = user.full_name.split(" ")[0];
  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Mi portal · Líder Coach Comercial</div>
          <h1 className="font-display text-4xl sm:text-5xl text-brand-ink uppercase leading-tight flex items-center gap-3 flex-wrap">
            <span>Hola, <span className="text-brand-primary">{nombre}</span></span>
            {d && <CriticoBadge critico={d.critico} enAlerta={d.asesores_en_alerta} />}
          </h1>
          <p className="text-sm text-brand-slate mt-2 max-w-2xl">
            Tu equipo de {d?.nombre_mes.toLowerCase() ?? "este mes"}: tus objetivos, lo que llevan vendido, cómo cerrarías el mes al
            ritmo actual y qué asesores necesitan coaching. El coaching y la bitácora se registran en «Coaching y bitácora».
          </p>
          {d?.objetivo.updated_at && (
            <p className="text-xs text-brand-slate mt-1">Objetivos cargados por {d.objetivo.updated_by ?? "—"} el {fechaHora(d.objetivo.updated_at)}.</p>
          )}
        </div>
        <SelectorMes periodo={periodo} onChange={setPeriodo} max={mesActual()} />
      </div>
      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {!d ? (
        !error && <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : (
        <div className="space-y-6">
          {d.coaching && periodo === mesActual() && (
            <>
              <div ref={ancla}>
                <ParaHoyCard x={d.coaching} href="/televentas-claro/portal/coaching" hrefTickets="/televentas-claro/portal/tickets"
                  nuevoCoaching={hrefNuevoCoaching()} />
              </div>
              <CoachingFlotante ancla={ancla} href={hrefNuevoCoaching()} />
            </>
          )}
          <VistaSupervisor d={d} lineasUrl={(op) => `${SUP_API}/portal/lineas?periodo=${periodo}&operador_id=${op}`}
            coachingHref={periodo === mesActual() ? hrefNuevoCoaching : undefined} />
          {d.coaching && periodo === mesActual() && <div className="h-10 print:hidden" aria-hidden />}
        </div>
      )}
    </>
  );
}
