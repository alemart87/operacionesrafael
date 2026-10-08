"use client";

import { Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { CampoNumero } from "@/components/seguridad/admin/comunes";
import { apiFetch } from "@/lib/api";
import { BANDA, PROD_API, fechaHora, type Parametros, type RespuestaParametros } from "./tipos";

/** Metas y reglas vigentes del módulo; el superadmin las edita desde acá. */
export function ParametrosModulo({ onCambio }: { onCambio?: (p: Parametros) => void }) {
  const [r, setR] = useState<RespuestaParametros | null>(null);
  const [borrador, setBorrador] = useState<Parametros | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    apiFetch<RespuestaParametros>(`${PROD_API}/parametros`).then((d) => { setR(d); onCambio?.(d.parametros); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!r) return null;
  const p = r.parametros;

  const guardar = async () => {
    if (!borrador) return;
    setGuardando(true);
    setError(null);
    try {
      const d = await apiFetch<RespuestaParametros>(`${PROD_API}/parametros`, { method: "PUT", body: JSON.stringify({ parametros: borrador }) });
      setR(d);
      onCambio?.(d.parametros);
      setBorrador(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  const item = (label: string, valor: React.ReactNode) => (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider2 text-brand-slate">{label}</span>
      <span className="text-sm font-semibold text-brand-ink tabular-nums">{valor}</span>
    </div>
  );
  const set = (k: keyof Parametros, v: number | string) => setBorrador((b) => (b ? { ...b, [k]: v } : b));

  return (
    <>
      <div className="card px-5 py-3.5 flex flex-wrap items-center gap-x-8 gap-y-3">
        {item("Meta de conversación", <span style={{ color: BANDA.meta.color }}>{p.meta_min}% a {p.meta_max}%</span>)}
        {item("Rojo", <span style={{ color: BANDA.rojo.color }}>menos de {p.rojo}%</span>)}
        {item("Contacto", `${p.contacto_desde_seg} s o más de conversación`)}
        {item("Sesión abierta", `${p.sesion_abierta_horas} h o más conectado`)}
        {item("Cambio de turno", `${p.cambio_turno} h`)}
        {item("Ranking de efectividad", `desde ${p.min_llamadas_ranking} llamadas`)}
        {r.puede_editar && (
          <button type="button" onClick={() => setBorrador({ ...p })} className="btn-ghost text-xs ml-auto">
            <Settings2 size={14} /> Editar metas
          </button>
        )}
      </div>

      {borrador && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-[2px] animate-fade" onClick={() => !guardando && setBorrador(null)} />
          <div role="dialog" aria-modal="true" className="relative w-full max-w-2xl card shadow-elevated animate-pop overflow-y-auto max-h-[92vh]">
            <div className="h-1.5 bg-brand-cyan" />
            <div className="p-6 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl text-brand-ink uppercase leading-tight">Metas y reglas</h2>
                  <p className="text-sm text-brand-slate mt-1">
                    Rigen para los informes que se generen desde ahora y para los acumulados. Un informe ya generado se puede recalcular.
                  </p>
                </div>
                <button className="btn-ghost -mr-2 -mt-1" onClick={() => setBorrador(null)} aria-label="Cerrar"><X size={16} /></button>
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <CampoNumero label="Meta: desde" sufijo="%" min={1} max={99} valor={borrador.meta_min} onChange={(v) => set("meta_min", v)} ayuda="% de conversación" />
                <CampoNumero label="Meta: hasta" sufijo="%" min={2} max={100} valor={borrador.meta_max} onChange={(v) => set("meta_max", v)} ayuda="% de conversación" />
                <CampoNumero label="Rojo: menos de" sufijo="%" min={1} max={98} valor={borrador.rojo} onChange={(v) => set("rojo", v)} ayuda="Por debajo, el agente está en rojo." />
                <CampoNumero label="Contacto desde" sufijo="seg" min={5} max={120} valor={borrador.contacto_desde_seg} onChange={(v) => set("contacto_desde_seg", v)} ayuda="Debajo puede ser solo el contestador." />
                <CampoNumero label="Sesión abierta desde" sufijo="horas" min={6} max={24} valor={borrador.sesion_abierta_horas} onChange={(v) => set("sesion_abierta_horas", v)} ayuda="Quedó logueado: alerta." />
                <CampoNumero label="Ranking desde" sufijo="llamadas" min={1} max={1000} valor={borrador.min_llamadas_ranking} onChange={(v) => set("min_llamadas_ranking", v)} ayuda="Mínimo para el ranking de efectividad." />
                <div>
                  <label className="label">Cambio de turno</label>
                  <input type="time" className="input" value={borrador.cambio_turno} onChange={(e) => set("cambio_turno", e.target.value)} />
                  <p className="text-[11px] text-brand-mist mt-1">Separa mañana y tarde (hace falta un corte cerca de esta hora).</p>
                </div>
              </div>
              {error && <div className="rounded-md border border-brand-primary/30 bg-brand-primary-light px-4 py-2.5 text-sm text-brand-primary-dark">{error}</div>}
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-[11px] text-brand-mist">{r.actualizado.en ? `Última modificación: ${r.actualizado.por ?? "—"} · ${fechaHora(r.actualizado.en)}` : "Valores por defecto"}</span>
                <div className="flex gap-2">
                  <button className="btn-secondary" disabled={guardando} onClick={() => setBorrador({ ...r.defecto })}>Valores por defecto</button>
                  <button className="btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
