"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

interface ProcesandoProps {
  abierto: boolean;
  titulo?: string;
  /** Lo que se está haciendo ahora (cambia durante el proceso). */
  detalle?: ReactNode;
  /** Avance de un lote (p. ej. archivos). Sin avance, la barra es indeterminada. */
  avance?: { hecho: number; total: number } | null;
  /** Terminó: se muestra «Listo» mientras se abre el resultado. */
  listo?: boolean;
  aviso?: ReactNode;
}

/** Pantalla de espera mientras el sistema procesa: bloquea la página y muestra el avance. */
export function Procesando({
  abierto, titulo = "Procesando", detalle, avance = null, listo = false,
  aviso = "No cierres ni recargues esta página.",
}: ProcesandoProps) {
  if (!abierto) return null;
  const porcentaje = listo ? 100 : avance && avance.total ? Math.min(100, Math.round((avance.hecho / avance.total) * 100)) : null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4 no-print">
      <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-[2px] animate-fade" />
      <div role="alertdialog" aria-modal="true" aria-busy={!listo} aria-labelledby="procesando-titulo"
        className="relative card w-full max-w-sm shadow-elevated animate-pop overflow-hidden">
        <div className={`h-1.5 ${listo ? "bg-emerald-500" : "bg-brand-cyan"}`} />
        <div className="p-6 text-center">
          {listo
            ? <CheckCircle2 size={36} className="mx-auto text-emerald-600" />
            : <Loader2 size={36} className="mx-auto text-brand-cyan animate-spin" />}
          <h2 id="procesando-titulo" className="font-display text-2xl uppercase text-brand-ink mt-3">{listo ? "Listo" : titulo}</h2>
          <div aria-live="polite" className="text-sm text-brand-slate mt-1 min-h-[1.25rem]">{detalle}</div>
          <div className="mt-4 h-1.5 rounded-full bg-brand-bg overflow-hidden" role="progressbar"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={porcentaje ?? undefined}>
            {porcentaje === null
              ? <div className="h-full w-full shimmer-bar" />
              : <div className={`h-full transition-[width] duration-300 ${listo ? "bg-emerald-500" : "bg-brand-cyan"}`} style={{ width: `${porcentaje}%` }} />}
          </div>
          {avance && !listo && <div className="text-[11px] text-brand-mist mt-1.5 tabular-nums">{avance.hecho} de {avance.total} listo(s)</div>}
          {!listo && aviso && <p className="text-xs text-brand-slate mt-4">{aviso}</p>}
        </div>
      </div>
    </div>
  );
}
