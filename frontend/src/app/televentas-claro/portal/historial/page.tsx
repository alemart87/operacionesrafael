"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { RegistroCoachingVista } from "@/components/supervision/registro";

/** Portal del supervisor · historial de sus coachings y seguimientos por rango de fechas. */
export default function HistorialCoachingPage() {
  return (
    <AppShell>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Mi portal · Líder Coach Comercial</div>
          <h1 className="font-display text-4xl sm:text-5xl text-brand-ink uppercase leading-tight">Mi historial de coaching</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-3xl">
            Tus coachings y seguimientos en el rango que elijas: qué trabajaste con cada asesor, el compromiso, tu devolución y el
            resultado medido. Para registrar o hacer un seguimiento, andá a «Coaching y bitácora».
          </p>
        </div>
        <Link href="/televentas-claro/portal/coaching" className="btn-ghost text-xs print:hidden"><ArrowLeft size={14} /> Coaching y bitácora</Link>
      </div>
      <RegistroCoachingVista portal />
    </AppShell>
  );
}
