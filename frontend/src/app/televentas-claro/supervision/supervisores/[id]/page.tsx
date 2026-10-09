"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrintButton } from "@/components/PrintButton";
import { fechaHora } from "@/components/productividad/tipos";
import { SUP_API, SUP_HREF, periodoDeUrl, periodoEnUrl, type DetalleSupervisor } from "@/components/supervision/tipos";
import { CriticoBadge, SelectorMes, TabsSupervisor, VistaSupervisor } from "@/components/supervision/ui";
import { apiFetch } from "@/lib/api";

export default function SupervisorPage() {
  return (
    <AppShell>
      <Detalle />
    </AppShell>
  );
}

function Detalle() {
  const { id } = useParams<{ id: string }>();
  const [periodo, setPeriodo] = useState(periodoDeUrl);
  const [d, setD] = useState<DetalleSupervisor | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    setError(null);
    try { setD(await apiFetch<DetalleSupervisor>(`${SUP_API}/supervisores/${id}?periodo=${p}`)); } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { setD(null); load(periodo); periodoEnUrl(periodo); }, [periodo, load]);

  return (
    <>
      <Link href={`${SUP_HREF}?periodo=${periodo}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-slate hover:text-brand-primary mb-4 print:hidden">
        <ArrowLeft size={14} /> Todos los supervisores
      </Link>
      <div className="mb-4 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Supervisor · {d?.nombre_mes ?? "…"}</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight flex items-center gap-3 flex-wrap">
            {d?.supervisor.nombre ?? "…"}
            {d && <CriticoBadge critico={d.critico} enAlerta={d.asesores_en_alerta} />}
          </h1>
          {d?.objetivo.updated_at && (
            <p className="text-xs text-brand-slate mt-2">
              Objetivos cargados por {d.objetivo.updated_by ?? "—"} el {fechaHora(d.objetivo.updated_at)}.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap print:hidden">
          <SelectorMes periodo={periodo} onChange={setPeriodo} />
          <PrintButton />
        </div>
      </div>
      <TabsSupervisor id={id} periodo={periodo} activa="resultados" />
      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {!d ? (
        !error && <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : (
        <VistaSupervisor d={d} lineasUrl={(op) => `${SUP_API}/lineas?periodo=${periodo}&operador_id=${op}`}
          fichaHref={(op) => `${SUP_HREF}/asesores/${op}?periodo=${periodo}`} />
      )}
    </>
  );
}
