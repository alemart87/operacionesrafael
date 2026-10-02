"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrintButton, PrintHeader } from "@/components/PrintButton";
import { SinUsoDetalle } from "@/components/ventas-netas/SinUsoDetalle";
import { EstadoBadge } from "@/components/ventas-netas/ui";
import { VN_API, VN_HREF, fechaCorta, nombrePeriodo, type InformeDetalle } from "@/components/ventas-netas/tipos";
import { apiFetch } from "@/lib/api";

/** Pospago sin uso de un informe: ranking por vendedor, líneas y fechas de venta (se abre en una pestaña nueva). */
export default function SinUsoPage() {
  return (
    <AppShell>
      <Contenido />
    </AppShell>
  );
}

function Contenido() {
  const { id } = useParams<{ id: string }>();
  const [r, setR] = useState<InformeDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<InformeDetalle>(`${VN_API}/reports/${id}`).then(setR).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (r) document.title = `Sin uso · ${nombrePeriodo(r.periodo)} · Ventas Netas`;
  }, [r]);

  if (error) return <div className="card p-8 text-brand-primary">{error}</div>;
  if (!r) return <div className="card p-10 text-brand-slate">Cargando…</div>;

  const titulo = `Pospago sin uso · ${nombrePeriodo(r.periodo)}`;
  return (
    <>
      <PrintHeader titulo={titulo} subtitulo={`Ventas Netas · corte al ${fechaCorta(r.fecha_dato)}`} />
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap print:hidden">
        <div>
          <div className="text-xs text-brand-slate">
            <Link href={VN_HREF} className="hover:text-brand-primary">Ventas Netas</Link>
            <span className="mx-2">/</span>
            <Link href={`${VN_HREF}/reports/${id}`} className="hover:text-brand-primary">{nombrePeriodo(r.periodo)}</Link>
            <span className="mx-2">/</span>
            <span className="text-brand-ink font-semibold">Sin uso</span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="font-display text-3xl text-brand-ink uppercase leading-tight">{titulo}</h1>
            <EstadoBadge estado={r.status} />
          </div>
          <p className="text-sm text-brand-slate mt-1">
            Alerta PFI · corte al <b>{fechaCorta(r.fecha_dato)}</b> · líneas Pospago sin consumo de datos con 3 o más días de activadas.
          </p>
        </div>
        <PrintButton label="Imprimir" />
      </div>
      <SinUsoDetalle d={r.data} periodo={r.periodo} />
    </>
  );
}
