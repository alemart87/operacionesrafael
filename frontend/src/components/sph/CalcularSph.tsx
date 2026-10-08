"use client";

import { CalendarDays, CheckCircle2, Clock, PhoneCall, Receipt, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Procesando } from "@/components/Procesando";
import { ESTADO_LABEL, fechaCorta, fechaLarga, n, nombreMes } from "@/components/productividad/tipos";
import { apiFetch } from "@/lib/api";
import { SPH_API, SPH_HREF, type InformeSphResumen, type RespuestaDias, type RespuestaFuentes } from "./tipos";

/**
 * Elegir el día y calcular su SPH. Muestra qué informes se van a cruzar (y por qué no se
 * puede, si falta alguno); al calcular queda la pantalla «Procesando» y se abre el resultado.
 */
export function CalcularSph({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const router = useRouter();
  const [dias, setDias] = useState<RespuestaDias | null>(null);
  const [fecha, setFecha] = useState("");
  const [fuentes, setFuentes] = useState<RespuestaFuentes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [listo, setListo] = useState(false);
  const pedida = useRef("");

  useEffect(() => {
    if (!abierto) return;
    setError(null);
    apiFetch<RespuestaDias>(`${SPH_API}/dias`)
      .then((d) => { setDias(d); setFecha((f) => f || d.sugerida || d.dias[0]?.fecha || ""); })
      .catch((e) => setError(e.message));
  }, [abierto]);

  useEffect(() => {
    if (!abierto || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { setFuentes(null); return; }
    pedida.current = fecha;
    setFuentes(null);
    apiFetch<RespuestaFuentes>(`${SPH_API}/fuentes?fecha=${fecha}`)
      .then((f) => { if (pedida.current === f.fecha) setFuentes(f); }) // ignora respuestas de un día ya cambiado
      .catch((e) => setError(e.message));
  }, [abierto, fecha]);

  useEffect(() => {
    if (!abierto || calculando) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierto, calculando, onCerrar]);

  const calcular = async () => {
    setCalculando(true);
    setError(null);
    try {
      const r = await apiFetch<{ informe: InformeSphResumen }>(`${SPH_API}/calcular`, { method: "POST", body: JSON.stringify({ fecha }) });
      setListo(true);
      router.push(`${SPH_HREF}/informes/${r.informe.id}?calculado=1`);
    } catch (e: any) {
      setCalculando(false);
      setError(e.message);
    }
  };

  if (!abierto) return null;
  const recientes = (dias?.dias ?? []).slice(0, 12);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-[2px] animate-fade" onClick={() => !calculando && onCerrar()} />
        <div role="dialog" aria-modal="true" aria-labelledby="calcular-sph" className="relative w-full max-w-xl card shadow-elevated overflow-y-auto max-h-[92vh] animate-pop">
          <div className="h-1.5 bg-brand-cyan" />
          <div className="p-6">
            <h2 id="calcular-sph" className="font-display text-2xl text-brand-ink uppercase leading-tight">Calcular SPH</h2>
            <p className="text-sm text-brand-slate mt-1.5 leading-relaxed">
              Elegí el día. Se cruzan las <b>horas conectadas</b> del informe de Productividad con las <b>netas</b> del
              informe de Ventas Netas del mes, por fecha de venta. No hace falta subir nada.
            </p>

            <div className="mt-5">
              <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate mb-2">Días con informe de Productividad</div>
              {!dias ? (
                <div className="text-xs text-brand-mist">Cargando…</div>
              ) : !recientes.length ? (
                <div className="text-xs text-brand-slate">Todavía no hay informes de Productividad en los últimos dos meses.</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {recientes.map((d) => {
                    const activo = d.fecha === fecha;
                    const estado = d.sph.published ? { t: "Con SPH publicado", c: "bg-[#2A78D6]" }
                      : d.sph.draft ? { t: "SPH en borrador", c: "bg-brand-cyan" }
                      : d.cubre ? { t: "Listo para calcular", c: "bg-emerald-500" } : { t: "Faltan ventas", c: "bg-brand-mist" };
                    return (
                      <button key={d.fecha} type="button" onClick={() => setFecha(d.fecha)} aria-pressed={activo}
                        className={`text-left rounded-md border px-3 py-2 transition-colors ${activo ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border hover:border-brand-ink"}`}>
                        <div className="text-sm font-semibold capitalize">{fechaCorta(d.fecha)}</div>
                        <div className={`text-[11px] flex items-center gap-1.5 ${activo ? "text-white/80" : "text-brand-slate"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${estado.c}`} />{estado.t}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              <label className="mt-3 flex items-center gap-2 text-xs text-brand-slate">
                <CalendarDays size={14} /> Otro día
                <input type="date" className="input py-1.5 w-auto text-xs" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </label>
            </div>

            {fecha && (
              <div className="mt-5 rounded-md border border-brand-border divide-y divide-brand-border">
                <div className="px-4 py-2.5 text-xs font-semibold text-brand-ink capitalize">{fechaLarga(fecha)}</div>
                {!fuentes ? (
                  <div className="px-4 py-3 text-xs text-brand-mist">Buscando los informes del día…</div>
                ) : (
                  <>
                    <Fuente icono={<PhoneCall size={15} />} titulo="Horas · Productividad" ok={!!fuentes.productividad}>
                      {fuentes.productividad
                        ? <>{ESTADO_LABEL[fuentes.productividad.status]} · datos hasta las {fuentes.productividad.corte_final ?? "—"} · {n(fuentes.productividad.agentes)} agentes conectados</>
                        : "No hay informe de ese día."}
                    </Fuente>
                    <Fuente icono={<Receipt size={15} />} titulo={`Ventas · Ventas Netas${fuentes.ventas ? ` ${nombreMes(fuentes.ventas.periodo)}` : ""}`}
                      ok={!!fuentes.ventas && (!fuentes.ventas.fecha_dato || fuentes.ventas.fecha_dato >= fecha)}>
                      {fuentes.ventas
                        ? <>{ESTADO_LABEL[fuentes.ventas.status]} · corte del {fuentes.ventas.fecha_dato ? fechaCorta(fuentes.ventas.fecha_dato) : "—"} · {n(fuentes.ventas.netas)} netas en el mes</>
                        : "No hay informe del mes."}
                    </Fuente>
                  </>
                )}
              </div>
            )}

            {fuentes?.motivo && <div className="mt-3 rounded-md bg-brand-primary-light border border-brand-primary/30 text-brand-primary-dark text-sm p-3">{fuentes.motivo}</div>}
            {fuentes?.puede_calcular && (fuentes.sph.published || fuentes.sph.draft) && (
              <p className="mt-3 text-xs text-brand-slate flex items-start gap-1.5">
                <Clock size={13} className="mt-0.5 shrink-0" />
                {fuentes.sph.published
                  ? "Este día ya tiene un SPH publicado: se calcula un borrador nuevo para revisarlo y, si querés, reemplazarlo."
                  : "Este día ya tiene un SPH en borrador: se rehace con los datos actuales."}
              </p>
            )}
            {error && <div className="mt-3 rounded-md bg-brand-primary-light border border-brand-primary/30 text-brand-primary-dark text-sm p-3">{error}</div>}

            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={onCerrar} disabled={calculando} className="btn-secondary">Cancelar</button>
              <button type="button" onClick={calcular} disabled={!fuentes?.puede_calcular || calculando} className="btn-primary">Calcular SPH</button>
            </div>
          </div>
        </div>
      </div>
      <Procesando abierto={calculando} titulo="Calculando SPH" listo={listo}
        detalle={listo ? "Abriendo el resultado…"
          : <>Cruzando las horas de {n(fuentes?.productividad?.agentes ?? 0)} agentes con las netas del <span className="capitalize">{fechaCorta(fecha)}</span>…</>} />
    </>
  );
}

function Fuente({ icono, titulo, ok, children }: { icono: React.ReactNode; titulo: string; ok: boolean; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <span className="text-brand-slate mt-0.5">{icono}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-brand-ink">{titulo}</div>
        <div className="text-xs text-brand-slate mt-0.5">{children}</div>
      </div>
      {ok ? <CheckCircle2 size={18} className="text-emerald-600 shrink-0" aria-label="Disponible" />
        : <XCircle size={18} className="text-brand-primary shrink-0" aria-label="Falta" />}
    </div>
  );
}
