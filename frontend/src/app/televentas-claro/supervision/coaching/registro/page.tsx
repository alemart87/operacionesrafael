"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { RegistroCoachingVista } from "@/components/supervision/registro";
import { SUP_HREF } from "@/components/supervision/tipos";

/** Registro de coaching de toda la operación por rango de fechas (jefes, solo lectura). */
export default function RegistroCoachingPage() {
  return (
    <AppShell>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Supervisión · Coaching</div>
          <h1 className="font-display text-4xl sm:text-5xl text-brand-ink uppercase leading-tight">Registro de coaching</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-3xl">
            Todos los coachings y seguimientos de la operación en el rango que elijas: qué se trabajó con cada asesor, el compromiso,
            la devolución del seguimiento y el resultado que midió el sistema. Filtrá por supervisor, asesor, métrica y estado.
          </p>
        </div>
        <Link href={`${SUP_HREF}/coaching`} className="btn-ghost text-xs print:hidden"><ArrowLeft size={14} /> Gestión del mes</Link>
      </div>
      <RegistroCoachingVista portal={false} />
    </AppShell>
  );
}
