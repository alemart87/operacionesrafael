"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Clock, PhoneCall, Receipt, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/components/AppShell";
import { Procesando } from "@/components/Procesando";
import {
  ESTADO_LABEL, fechaCorta, finDeMes, isoDia, lunesDe, n, nombreMes, sumarDias,
} from "@/components/productividad/tipos";
import { apiFetch } from "@/lib/api";
import { PERM_PRODUCTIVIDAD_GESTION, PERM_VENTAS_NETAS_GESTION } from "@/lib/operativas";
import { FranjaDias } from "./ui";
import {
  SPH_API, SPH_HREF, TIPO_LABEL, etiquetaPeriodo,
  type InformeSphResumen, type RespuestaDias, type RespuestaFuentes, type TipoPeriodo,
} from "./tipos";

const MAX_DIAS = 62;
const DEL: Record<TipoPeriodo, string> = { dia: "del día", semana: "de la semana", mes: "del mes", rango: "del rango" };

/**
 * Elegir el período (día, semana, mes o rango) y calcular su SPH. Muestra qué días cuentan (con horas
 * y ventas al corte), qué informes se van a cruzar y qué falta subir; al calcular queda la pantalla
 * «Procesando» y se abre el resultado.
 */
export function CalcularSph({ abierto, onCerrar, tipo = "dia" }: { abierto: boolean; onCerrar: () => void; tipo?: TipoPeriodo }) {
  const router = useRouter();
  const { can } = useSession();
  const hoy = useMemo(() => isoDia(new Date()), []);
  const [modo, setModo] = useState<TipoPeriodo>("dia");
  const [dias, setDias] = useState<RespuestaDias | null>(null);
  const [dia, setDia] = useState("");
  const [semana, setSemana] = useState(lunesDe(hoy));
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const [rango, setRango] = useState({ desde: sumarDias(hoy, -6), hasta: hoy });
  const [fuentes, setFuentes] = useState<RespuestaFuentes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [listo, setListo] = useState(false);
  const pedido = useRef("");

  useEffect(() => { if (abierto) setModo(tipo); }, [abierto, tipo]);

  useEffect(() => {
    if (!abierto) return;
    setError(null);
    apiFetch<RespuestaDias>(`${SPH_API}/dias`)
      .then((d) => {
        setDias(d);
        const base = d.sugerida || d.dias[0]?.fecha || hoy;
        setDia((x) => x || base);
        setSemana(lunesDe(base));
        setMes(base.slice(0, 7));
      })
      .catch((e) => setError(e.message));
  }, [abierto, hoy]);

  const periodo = useMemo((): { desde: string; hasta: string } | null => {
    const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (modo === "dia") return ok(dia) ? { desde: dia, hasta: dia } : null;
    if (modo === "semana") return ok(semana) ? { desde: semana, hasta: sumarDias(semana, 6) } : null;
    if (modo === "mes") return /^\d{4}-\d{2}$/.test(mes) ? { desde: `${mes}-01`, hasta: finDeMes(`${mes}-01`) } : null;
    return ok(rango.desde) && ok(rango.hasta) ? { desde: rango.desde, hasta: rango.hasta } : null;
  }, [modo, dia, semana, mes, rango]);

  const errorRango = modo === "rango" && periodo
    ? periodo.hasta < periodo.desde ? "La fecha final es anterior a la inicial."
      : (new Date(`${periodo.hasta}T12:00`).getTime() - new Date(`${periodo.desde}T12:00`).getTime()) / 864e5 + 1 > MAX_DIAS
        ? `El rango puede tener hasta ${MAX_DIAS} días.` : null
    : null;

  useEffect(() => {
    if (!abierto || !periodo || errorRango) { setFuentes(null); return; }
    const clave = `${periodo.desde}|${periodo.hasta}`;
    pedido.current = clave;
    setFuentes(null);
    apiFetch<RespuestaFuentes>(`${SPH_API}/fuentes?desde=${periodo.desde}&hasta=${periodo.hasta}`)
      .then((f) => { if (pedido.current === `${f.desde}|${f.hasta}`) setFuentes(f); }) // ignora respuestas viejas
      .catch((e) => setError(e.message));
  }, [abierto, periodo, errorRango]);

  useEffect(() => {
    if (!abierto || calculando) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierto, calculando, onCerrar]);

  const calcular = async () => {
    if (!periodo) return;
    setCalculando(true);
    setError(null);
    try {
      const r = await apiFetch<{ informe: InformeSphResumen }>(`${SPH_API}/calcular`, { method: "POST", body: JSON.stringify(periodo) });
      setListo(true);
      router.push(`${SPH_HREF}/informes/${r.informe.id}?calculado=1`);
    } catch (e: any) {
      setCalculando(false);
      setError(e.message);
    }
  };

  if (!abierto) return null;
  const faltanHoras = !!fuentes?.cobertura.some((c) => !c.horas);
  const faltanVentas = !!fuentes?.cobertura.some((c) => c.horas && !c.ventas);
  const semanas = Array.from({ length: 5 }, (_, i) => sumarDias(lunesDe(hoy), -7 * i));
  const meses = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(`${hoy.slice(0, 7)}-01T12:00`);
    d.setMonth(d.getMonth() - i);
    return isoDia(d).slice(0, 7);
  });

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-[2px] animate-fade" onClick={() => !calculando && onCerrar()} />
        <div role="dialog" aria-modal="true" aria-labelledby="calcular-sph" className="relative w-full max-w-2xl card shadow-elevated overflow-y-auto max-h-[92vh] animate-pop">
          <div className="h-1.5 bg-brand-cyan" />
          <div className="p-6">
            <h2 id="calcular-sph" className="font-display text-2xl text-brand-ink uppercase leading-tight">Calcular SPH</h2>
            <p className="text-sm text-brand-slate mt-1.5 leading-relaxed">
              Elegí el período. Se cruzan las <b>horas conectadas</b> de los informes de Productividad con las <b>ventas del día</b> de
              la hoja de productividad de Ventas Netas: las cargadas ese día, finalizadas o pendientes (no las rechazadas ni las
              canceladas). Un día cuenta si tiene horas y la planilla de ventas ya lo alcanza.
            </p>

            <div className="mt-5 grid grid-cols-4 gap-1 rounded-lg bg-brand-bg p-1" role="tablist" aria-label="Tipo de período">
              {(["dia", "semana", "mes", "rango"] as TipoPeriodo[]).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={modo === t} onClick={() => setModo(t)}
                  className={`rounded-md py-2 text-sm font-semibold transition-colors ${modo === t ? "bg-white text-brand-ink shadow-soft" : "text-brand-slate hover:text-brand-ink"}`}>
                  {TIPO_LABEL[t]}
                </button>
              ))}
            </div>

            <div className="mt-4">
              {modo === "dia" && (
                <>
                  {!dias ? <div className="text-xs text-brand-mist">Cargando…</div> : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {dias.dias.slice(0, 8).map((d) => {
                        const activo = d.fecha === dia;
                        const estado = d.sph.published ? { t: "Con SPH publicado", c: "bg-[#2A78D6]" }
                          : d.sph.draft ? { t: "SPH en borrador", c: "bg-brand-cyan" }
                          : d.cubre ? { t: "Listo para calcular", c: "bg-emerald-500" } : { t: "Faltan ventas", c: "bg-brand-mist" };
                        return (
                          <button key={d.fecha} type="button" onClick={() => setDia(d.fecha)} aria-pressed={activo}
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
                    <input type="date" className="input py-1.5 w-auto text-xs" value={dia} max={hoy} onChange={(e) => setDia(e.target.value)} />
                  </label>
                </>
              )}
              {modo === "semana" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label="Semana anterior" onClick={() => setSemana(sumarDias(semana, -7))} className="btn-secondary px-2.5 py-2"><ChevronLeft size={16} /></button>
                    <div className="flex-1 text-center text-sm font-semibold text-brand-ink">{etiquetaPeriodo(semana, sumarDias(semana, 6), "semana")}</div>
                    <button type="button" aria-label="Semana siguiente" disabled={semana >= lunesDe(hoy)} onClick={() => setSemana(sumarDias(semana, 7))} className="btn-secondary px-2.5 py-2"><ChevronRight size={16} /></button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {semanas.map((l, i) => (
                      <button key={l} type="button" onClick={() => setSemana(l)} aria-pressed={semana === l}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${semana === l ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-slate border-brand-border hover:border-brand-ink"}`}>
                        {i === 0 ? "Esta semana" : i === 1 ? "Semana pasada" : `${l.slice(8, 10)}/${l.slice(5, 7)}–${sumarDias(l, 6).slice(8, 10)}/${sumarDias(l, 6).slice(5, 7)}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {modo === "mes" && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {meses.map((m, i) => (
                    <button key={m} type="button" onClick={() => setMes(m)} aria-pressed={mes === m}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${mes === m ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-slate border-brand-border hover:border-brand-ink"}`}>
                      {nombreMes(m)}{i === 0 ? " (en curso)" : ""}
                    </button>
                  ))}
                  <input type="month" aria-label="Otro mes" className="input py-1.5 w-auto text-xs" value={mes} max={hoy.slice(0, 7)} onChange={(e) => setMes(e.target.value)} />
                </div>
              )}
              {modo === "rango" && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-brand-slate">
                  <label className="flex items-center gap-2">Desde <input type="date" className="input py-1.5 w-auto text-xs" value={rango.desde} max={hoy} onChange={(e) => setRango({ ...rango, desde: e.target.value })} /></label>
                  <label className="flex items-center gap-2">Hasta <input type="date" className="input py-1.5 w-auto text-xs" value={rango.hasta} onChange={(e) => setRango({ ...rango, hasta: e.target.value })} /></label>
                  <span className="text-brand-mist">Hasta {MAX_DIAS} días.</span>
                </div>
              )}
            </div>

            {errorRango && <div className="mt-3 rounded-md bg-brand-primary-light border border-brand-primary/30 text-brand-primary-dark text-sm p-3">{errorRango}</div>}

            {periodo && !errorRango && (
              <div className="mt-5 rounded-md border border-brand-border">
                <div className="px-4 py-2.5 border-b border-brand-border flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-xs font-semibold text-brand-ink">{etiquetaPeriodo(periodo.desde, periodo.hasta, modo)}</span>
                  {fuentes && <span className="text-xs text-brand-slate"><b className="text-brand-ink">{n(fuentes.dias_cubiertos)}</b> de {n(fuentes.dias)} día(s) cuentan</span>}
                </div>
                {!fuentes ? (
                  <div className="px-4 py-3 text-xs text-brand-mist">Buscando los informes del período…</div>
                ) : (
                  <>
                    {modo !== "dia" && <div className="px-4 py-3"><FranjaDias desde={fuentes.desde} hasta={fuentes.hasta} cobertura={fuentes.cobertura} /></div>}
                    <div className="divide-y divide-brand-border border-t border-brand-border">
                      <Fuente icono={<PhoneCall size={15} />} titulo="Horas · Productividad" ok={fuentes.cobertura.some((c) => c.horas)}>
                        {fuentes.productividad.length
                          ? modo === "dia"
                            ? <>{ESTADO_LABEL[fuentes.productividad[0].status]} · datos hasta las {fuentes.productividad[0].corte_final ?? "—"} · {n(fuentes.productividad[0].agentes)} agentes conectados</>
                            : <>{n(fuentes.productividad.length)} informe(s) de día{fuentes.productividad.some((p) => p.status !== "published") && <> · {n(fuentes.productividad.filter((p) => p.status !== "published").length)} en borrador</>}</>
                          : "No hay informes de Productividad en el período."}
                      </Fuente>
                      <Fuente icono={<Receipt size={15} />} titulo="Ventas · Ventas Netas" ok={fuentes.cobertura.some((c) => c.horas && c.ventas)}>
                        {fuentes.ventas.length
                          ? fuentes.ventas.map((v) => (
                            <span key={v.id} className="block">
                              {nombreMes(v.periodo)}: corte del {v.fecha_dato ? fechaCorta(v.fecha_dato) : "—"} · {ESTADO_LABEL[v.status].toLowerCase()}
                              {v.ventas != null ? <> · {n(v.ventas)} ventas en el mes</> : <span className="text-brand-primary"> · sin la hoja de productividad: recalculalo en Ventas Netas</span>}
                            </span>
                          ))
                          : "No hay informe de Ventas Netas del mes."}
                      </Fuente>
                    </div>
                  </>
                )}
              </div>
            )}

            {fuentes?.motivo && <div className="mt-3 rounded-md bg-brand-primary-light border border-brand-primary/30 text-brand-primary-dark text-sm p-3">{fuentes.motivo}</div>}
            {fuentes && (faltanHoras || faltanVentas) && (can(PERM_PRODUCTIVIDAD_GESTION) || can(PERM_VENTAS_NETAS_GESTION)) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-brand-slate">
                <span>Para que cuenten más días:</span>
                {faltanHoras && can(PERM_PRODUCTIVIDAD_GESTION) && (
                  <Link href="/televentas-claro/productividad/subir" className="btn-secondary text-xs px-3 py-1.5"><Upload size={13} /> Subir cortes de llamadas</Link>
                )}
                {faltanVentas && can(PERM_VENTAS_NETAS_GESTION) && (
                  <Link href="/televentas-claro/ventas-netas/upload" className="btn-secondary text-xs px-3 py-1.5"><Upload size={13} /> Subir corte de ventas</Link>
                )}
              </div>
            )}
            {fuentes?.puede_calcular && (fuentes.sph.published || fuentes.sph.draft) && (
              <p className="mt-3 text-xs text-brand-slate flex items-start gap-1.5">
                <Clock size={13} className="mt-0.5 shrink-0" />
                {fuentes.sph.published
                  ? "Este período ya tiene un SPH publicado: se calcula un borrador nuevo para revisarlo y, si querés, reemplazarlo."
                  : "Este período ya tiene un SPH en borrador: se rehace con los datos actuales."}
              </p>
            )}
            {error && <div className="mt-3 rounded-md bg-brand-primary-light border border-brand-primary/30 text-brand-primary-dark text-sm p-3">{error}</div>}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
              <button type="button" onClick={onCerrar} disabled={calculando} className="btn-secondary">Cancelar</button>
              <button type="button" onClick={calcular} disabled={!fuentes?.puede_calcular || calculando} className="btn-primary text-base px-6">
                Calcular SPH {DEL[modo]}
              </button>
            </div>
          </div>
        </div>
      </div>
      <Procesando abierto={calculando} titulo="Calculando SPH" listo={listo}
        detalle={listo ? "Abriendo el resultado…"
          : <>Cruzando las horas de {n(fuentes?.dias_cubiertos ?? 1)} día(s) con las ventas de cada día…</>} />
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
      <span className={`mt-0.5 text-[10px] font-semibold uppercase tracking-wider2 shrink-0 ${ok ? "text-emerald-700" : "text-brand-primary"}`}>{ok ? "Listo" : "Falta"}</span>
    </div>
  );
}
