"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AlertasDia, CabeceraOperacion, MetodoComando, RutinaCard, Semaforo } from "@/components/supervision/comando";
import { SUP_API, fechaHoraCorta, type CentroComandos } from "@/components/supervision/tipos";
import { FuenteDatos } from "@/components/supervision/ui";
import { apiFetch } from "@/lib/api";

const REFRESCO_MS = 5 * 60 * 1000; // con la pestaña a la vista, se pone al día cada 5 minutos

export default function ComandoPage() {
  return (
    <AppShell>
      <Vista />
    </AppShell>
  );
}

function Vista() {
  const [d, setD] = useState<CentroComandos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const enCurso = useRef(false);

  const cargar = useCallback(async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    setCargando(true);
    setError(null);
    try { setD(await apiFetch<CentroComandos>(`${SUP_API}/comando`)); } catch (e: any) { setError(e.message); }
    finally { enCurso.current = false; setCargando(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === "visible") cargar(); }, REFRESCO_MS);
    return () => window.clearInterval(t);
  }, [cargar]);

  const hoy = d ? new Date(`${d.hoy}T12:00:00`).toLocaleDateString("es-PY", { weekday: "long", day: "numeric", month: "long" }) : "";
  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Supervisión{hoy && ` · ${hoy}`}</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Centro de comandos</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-3xl">
            Qué supervisor necesita atención hoy y qué hizo cada uno: cómo viene la operación, el semáforo de supervisores y las alertas del día,
            con quién las tomó y las revisiones pedidas.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {d && <span className="text-[11px] text-brand-slate tabular-nums">Actualizado {fechaHoraCorta(d.actualizado).slice(-5)}</span>}
          <button type="button" className="btn-secondary !py-2 !px-4" onClick={cargar} disabled={cargando}>
            <RefreshCw size={15} className={cargando ? "animate-spin" : ""} aria-hidden /> {cargando ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>
      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {!d ? (
        !error && <div className="card p-10 text-brand-slate">Cargando el día de la operación…</div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <FuenteDatos ventas={d.ventas} cal={d.calendario} />
            {d.pendientes_vincular > 0 && (
              <span className="text-xs text-[#8A5200]">{d.pendientes_vincular} nombre(s) sin vincular en el maestro de operadores</span>
            )}
          </div>
          <CabeceraOperacion d={d} />
          <Semaforo filas={d.supervisores} umbral={d.parametros.umbral_sin_uso} diasSinGestion={d.reglas.dias_sin_gestion} />
          <AlertasDia d={d} onCambio={cargar} />
          <div className="grid xl:grid-cols-2 gap-6">
            <RutinaCard />
            <MetodoComando d={d} />
          </div>
        </div>
      )}
    </>
  );
}
