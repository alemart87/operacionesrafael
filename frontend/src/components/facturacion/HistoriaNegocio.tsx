"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatGs, formatInt } from "@/lib/format";
import { describirVariaciones } from "./MesAfectado";
import { dominiosAlineados } from "./ejes";

/** Historia del negocio: línea de tiempo animada del escenario anual. Al dar play el
 *  gráfico se construye mes a mes y aparecen los hitos con alertas. Cada escena muestra
 *  el puente completo del mes (facturación + ajustes = ingreso neto; − costos = resultado;
 *  acumulado anterior + resultado = acumulado), que cierra exacto al guaraní. */

type Severidad = "info" | "ok" | "warning" | "alert";
type Hito = { paso: number; titulo: string; detalle: string; severidad: Severidad; icono: string };

const SEV: Record<Severidad, { cls: string; punto: string; label: string; anim: string }> = {
  info: { cls: "border-sky-300 bg-sky-50 text-sky-900", punto: "#0EA5E9", label: "Hito", anim: "hn-pop" },
  ok: { cls: "border-emerald-300 bg-emerald-50 text-emerald-900", punto: "#10B981", label: "Bien", anim: "hn-pop" },
  warning: { cls: "border-amber-300 bg-amber-50 text-amber-900", punto: "#F59E0B", label: "Atención", anim: "hn-wobble" },
  alert: { cls: "border-brand-primary/40 bg-brand-primary/5 text-brand-primary", punto: "#E6332A", label: "Alerta", anim: "hn-shake" },
};

const M = (v: number) => `${Math.round(v / 1e6)}M`;
const VELOCIDADES = [0.5, 1, 2, 4];

/** Número que "cuenta" hasta su valor cuando cambia. */
function useCountUp(value: number, ms = 700): number {
  const [v, setV] = useState(value);
  const desde = useRef(value);
  useEffect(() => {
    const ini = desde.current, fin = value, t0 = performance.now();
    if (ini === fin) return;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setV(Math.round(ini + (fin - ini) * e));
      if (k < 1) raf = requestAnimationFrame(tick); else desde.current = fin;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return v;
}

function Cifra({ valor, signo, className = "" }: { valor: number; signo?: boolean; className?: string }) {
  const v = useCountUp(valor);
  return <span className={`font-mono tabular-nums ${className}`}>{signo && v > 0 ? "+" : ""}{formatGs(v)}</span>;
}

/** Puente aritmético: [a] op [b] = [c] … cada término con su etiqueta. */
function Puente({ pasos, tono = "oscuro" }: { pasos: Array<{ label: string; valor: number; op?: "+" | "−" | "="; destacado?: boolean }>; tono?: "oscuro" | "claro" }) {
  const base = tono === "oscuro" ? "text-white/60" : "text-brand-slate";
  const op = tono === "oscuro" ? "text-white/40" : "text-brand-slate/60";
  return (
    <div className="flex flex-wrap items-end gap-x-2 gap-y-2">
      {pasos.map((s, i) => (
        <div key={i} className="flex items-end gap-2">
          {s.op && <span className={`font-display text-2xl leading-none pb-0.5 ${s.op === "=" ? (tono === "oscuro" ? "text-white" : "text-brand-ink") : op}`}>{s.op}</span>}
          <div className={`${s.destacado ? (tono === "oscuro" ? "bg-white/10 rounded-md px-2 py-1 -mx-1" : "bg-brand-bg rounded-md px-2 py-1 -mx-1") : ""}`}>
            <div className={`text-[9px] uppercase tracking-wider2 font-bold ${base}`}>{s.label}</div>
            <Cifra valor={s.valor} className={`text-[15px] font-bold ${s.valor < 0 ? "text-brand-primary" : tono === "oscuro" ? (s.destacado ? "text-emerald-300" : "text-white") : "text-brand-ink"}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Construye los hitos de la historia a partir del resultado anual. */
function armarHitos(res: any, p: any, nombre: (i: number) => string): Hito[] {
  const meses: any[] = res.meses ?? [];
  const a = res.anual;
  const h = meses.length;
  const hc = res.headcount ?? {};
  const out: Hito[] = [];
  const bonosActivos = p?.bonos_activos !== false;
  const chb = Number(p?.chargeback_meses ?? 6);
  let primeraCaida = false, primeraCuota2 = false, primerRecalculo = false, primerResidual = false, enPerdida = false;

  for (let t = 0; t < h; t++) {
    const m = meses[t];
    const prev = meses[t - 1];
    if (t === 0) out.push({ paso: 0, severidad: "info", icono: "🚀", titulo: "Arranca la operación",
      detalle: `${hc.vendedores} vendedores, ${hc.supervisores} supervisores, ${hc.backoffice} backoffice; costo fijo ${formatGs(a.costos_fijos_mes)}/mes y objetivo CO ${formatInt(Number(p?.objetivo_co ?? 0))}. ${nombre(0)} factura ${formatGs(m.facturacion_bruta)} y todavía no devuelve nada.` });
    if (m.afectado) out.push({ paso: t, severidad: "info", icono: "🎚️", titulo: `${nombre(t)} se comporta distinto`, detalle: describirVariaciones(m.variaciones ?? {}, p).join(" · ") || "variaciones propias del mes." });
    if (m.bono_adicional > 0) out.push({ paso: t, severidad: "ok", icono: "🎁", titulo: "Bono adicional cargado a mano", detalle: `${formatGs(m.bono_adicional)} entran a la facturación de ${nombre(t)}; no se devuelven.` });
    if (bonosActivos && m.monto_bono_productividad === 0) out.push({ paso: t, severidad: "alert", icono: "🎯", titulo: "Sin bono productividad",
      detalle: `${nombre(t)} llega al ${m.cumplimiento_pct}% del objetivo: por debajo del ${Math.min(...((p?.escala_productividad ?? []).map((e: any) => Number(e.desde_pct))), 100)}% el bono productividad no se liquida.` });
    else if (bonosActivos && m.escalon_productividad >= 110) out.push({ paso: t, severidad: "ok", icono: "🏆", titulo: "Escalón máximo del bono", detalle: `${nombre(t)} cumple el ${m.cumplimiento_pct}% del objetivo: ${formatGs(m.monto_bono_productividad)} por línea.` });
    if (!primeraCaida && m.clawbacks < 0) { primeraCaida = true; out.push({ paso: t, severidad: "warning", icono: "📉", titulo: "Llegan las primeras caídas",
      detalle: `Las líneas de ${nombre(0)} que se cortan en el chargeback empiezan a devolverse: ${formatGs(Math.abs(m.clawbacks))} en ${nombre(t)}. Desde acá cada mes descuenta las caídas de los anteriores.` }); }
    if (!primerResidual && m.residual > 0) { primerResidual = true; out.push({ paso: t, severidad: "ok", icono: "💧", titulo: "Empieza a cobrarse el residual", detalle: `${formatGs(m.residual)} sobre las líneas activas de ${nombre(0)}; se cobra ${p?.residual_meses ?? 12} liquidaciones por cohorte.` }); }
    if (!primeraCuota2 && m.cuota2 > 0) { primeraCuota2 = true; out.push({ paso: t, severidad: "ok", icono: "💵", titulo: "Primera cuota 2", detalle: `Las líneas de ${nombre(0)} activas al día 90 con legajo completo cobran la cuota 2: ${formatGs(m.cuota2)}.` }); }
    if (!primerRecalculo && m.recalculo_productividad < 0) { primerRecalculo = true; out.push({ paso: t, severidad: "warning", icono: "🔁", titulo: "Recálculo del bono productividad",
      detalle: `Claro descuenta el bono de las líneas de ${nombre(0)} que no llegaron activas al día 180: ${formatGs(Math.abs(m.recalculo_productividad))}.` }); }
    if (t === chb) out.push({ paso: t, severidad: "info", icono: "🛡️", titulo: `${nombre(0)} sale del chargeback`, detalle: `Pasaron ${chb} meses: la primera cohorte ya no devuelve caídas; de acá en más solo suma residual.` });
    if (m.en_riesgo && prev && m.ventas < prev.ventas) out.push({ paso: t, severidad: "alert", icono: "🌊", titulo: "La ola de la zafra pega sobre menos ventas",
      detalle: `${nombre(t)} baja a ${formatInt(m.ventas)} ventas pero hereda ${formatGs(Math.abs(m.ola_devoluciones))} de devoluciones de los meses anteriores: hacían falta ${m.ventas_equilibrio == null ? "más del triple de" : formatInt(m.ventas_equilibrio)} ventas para no perder.` });
    if (m.resultado < 0 && !enPerdida) { enPerdida = true; out.push({ paso: t, severidad: "alert", icono: "🔻", titulo: "Mes en pérdida", detalle: `${nombre(t)} liquida ${formatGs(m.ingreso_neto)} contra ${formatGs(m.costo_total)} de costos: ${formatGs(m.resultado)}.` }); }
    else if (m.resultado >= 0 && enPerdida) { enPerdida = false; out.push({ paso: t, severidad: "ok", icono: "🔺", titulo: "Vuelve a ganar", detalle: `${nombre(t)} cierra con ${formatGs(m.resultado)} (${m.margen_pct}% sobre ingreso neto).` }); }
    if (prev && Math.sign(prev.acumulado) !== Math.sign(m.acumulado) && m.acumulado !== 0 && prev.acumulado !== 0)
      out.push({ paso: t, severidad: m.acumulado > 0 ? "ok" : "alert", icono: "⚖️", titulo: m.acumulado > 0 ? "El acumulado cruza a positivo" : "El acumulado cae a negativo", detalle: `Acumulado del período en ${nombre(t)}: ${formatGs(m.acumulado)}.` });
    if (a.peor_mes === m.mes && h > 1) out.push({ paso: t, severidad: "warning", icono: "🥶", titulo: "El peor mes del período", detalle: `${nombre(t)}: resultado ${formatGs(m.resultado)}.` });
    if (a.mejor_mes === m.mes && h > 1 && t !== 0) out.push({ paso: t, severidad: "ok", icono: "🔥", titulo: "El mejor mes del período", detalle: `${nombre(t)}: resultado ${formatGs(m.resultado)}.` });
    if (t === 12) out.push({ paso: t, severidad: "info", icono: "🏁", titulo: `${nombre(0)} completa su residual`, detalle: "La primera cohorte cobró las 12 liquidaciones: a partir de acá se mantiene en su nivel final de zafra." });
  }
  const cola = a.cola_post_12 ?? {};
  const v = a.veredicto ?? {};
  out.push({ paso: h, severidad: "info", icono: "⏳", titulo: `Fin de los ${h} meses: queda la cola`,
    detalle: `Resultado del período ${formatGs(a.resultado)}. Las últimas cohortes todavía tienen ${formatGs(cola.cobros ?? 0)} por cobrar (hasta el mes ${cola.ultimo_mes_residual}) y ${formatGs(Math.abs(cola.devoluciones ?? 0))} por devolver (hasta el mes ${cola.ultimo_mes_caidas}).` });
  out.push({ paso: h, severidad: v.gana ? "ok" : "alert", icono: v.gana ? "🏆" : "🚨", titulo: v.gana ? `Cierre: ganamos ${formatGs(v.resultado_final)}` : `Cierre: perdemos ${formatGs(Math.abs(v.resultado_final ?? 0))}`,
    detalle: v.la_cola_lo_da_vuelta ? "La cola pendiente da vuelta el signo del período." : "Con todas las caídas y todo el residual cobrado, este es el número final." });
  return out;
}

const AJUSTES: Array<[string, string, string]> = [
  ["residual", "Residual", "💧"], ["cuota2", "Cuota 2", "💵"], ["legajos", "Legajos", "📄"],
  ["clawbacks", "Caídas", "📉"], ["clawback_bonos", "Dev. bono efectividad", "↩️"], ["recalculo_productividad", "Recálculo bono prod.", "🔁"],
];

export function HistoriaNegocio({ res, p, nombre }: { res: any; p: any; nombre: (i: number) => string }) {
  const meses: any[] = res?.meses ?? [];
  const h = meses.length;
  const a = res?.anual;
  const [paso, setPaso] = useState(-1);
  const [play, setPlay] = useState(false);
  const [vel, setVel] = useState(1);
  const timer = useRef<any>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const hitos = useMemo(() => (res && a ? armarHitos(res, p, nombre) : []), [res, p, nombre, a]);
  useEffect(() => { setPaso(-1); setPlay(false); }, [res]);
  useEffect(() => {
    if (!play) { clearTimeout(timer.current); return; }
    if (paso >= h) { setPlay(false); return; }
    timer.current = setTimeout(() => setPaso((x) => Math.min(x + 1, h)), 1800 / vel);
    return () => clearTimeout(timer.current);
  }, [play, paso, vel, h]);
  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }); }, [paso]);

  if (!res || !a || !h) return null;

  const iniciar = () => { setPaso(0); setPlay(true); };
  const visibles = hitos.filter((x) => x.paso <= paso);
  const data = meses.map((m, i) => ({
    mes: m.mes, ingreso_neto: i <= paso ? m.ingreso_neto : null, costo_total: i <= paso ? m.costo_total : null,
    resultado: i <= paso ? m.resultado : null, margen_pct: i <= paso ? m.margen_pct : null,
    ola_devoluciones: i <= paso ? m.ola_devoluciones : null,
  }));
  // dominios fijos sobre TODOS los meses (no solo los ya revelados) para que la animación no reescale
  const ejes = dominiosAlineados(
    meses.flatMap((x: any) => [x.ingreso_neto, x.costo_total, x.resultado, x.ola_devoluciones]),
    meses.map((x: any) => x.margen_pct),
  );
  const mesActual = paso >= 0 && paso < h ? meses[paso] : null;
  const cierre = paso >= h;
  const cola = a.cola_post_12 ?? {};
  const marcadores = hitos.filter((x) => x.paso < h && x.paso <= paso && x.severidad !== "info")
    .reduce<Record<number, Hito>>((acc, x) => { if (!acc[x.paso] || x.severidad === "alert") acc[x.paso] = x; return acc; }, {});
  const progreso = paso < 0 ? 0 : Math.min(100, ((paso + 1) / (h + 1)) * 100);

  return (
    <div className="hn">
      <style>{`
        @keyframes hn-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @keyframes hn-pop { 0% { transform: scale(.4); opacity: 0; } 60% { transform: scale(1.18); opacity: 1; } 100% { transform: scale(1); } }
        @keyframes hn-shake { 0%,100% { transform: translateX(0) } 20% { transform: translateX(-4px) rotate(-6deg) } 40% { transform: translateX(4px) rotate(6deg) } 60% { transform: translateX(-3px) } 80% { transform: translateX(3px) } }
        @keyframes hn-wobble { 0%,100% { transform: rotate(0) } 25% { transform: rotate(-10deg) scale(1.1) } 75% { transform: rotate(10deg) scale(1.1) } }
        @keyframes hn-ring { 0% { box-shadow: 0 0 0 0 var(--hn-c) } 100% { box-shadow: 0 0 0 14px transparent } }
        @keyframes hn-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
        @keyframes hn-bar { from { width: 0 } }
        .hn-in { animation: hn-in .5s cubic-bezier(.2,.8,.2,1) both; }
        .hn-pop { animation: hn-pop .6s cubic-bezier(.2,.8,.2,1) both; }
        .hn-shake { animation: hn-pop .5s both, hn-shake .6s .5s ease-in-out; }
        .hn-wobble { animation: hn-pop .5s both, hn-wobble .7s .5s ease-in-out; }
        .hn-ring { animation: hn-ring 1.2s ease-out 2; }
        .hn-float { animation: hn-float 2.2s ease-in-out infinite; }
        .hn-bar { animation: hn-bar .6s ease-out both; }
        .hn .recharts-reference-dot circle { transform-box: fill-box; transform-origin: center; animation: hn-pop .6s cubic-bezier(.2,.8,.2,1) both; }
      `}</style>

      {/* ===== Controles ===== */}
      <div className="no-print flex flex-wrap items-center gap-3 mb-3">
        {paso < 0 ? (
          <button onClick={iniciar} className="btn-primary !px-6 !py-2.5 text-base shadow-lg hn-float">▶ Generar la historia</button>
        ) : (
          <>
            <button onClick={() => (paso >= h ? iniciar() : setPlay(!play))} className="btn-primary !px-5 !py-2 text-sm min-w-[110px]">
              {paso >= h ? "↻ Volver a ver" : play ? "❚❚ Pausa" : "▶ Play"}
            </button>
            <div className="inline-flex rounded-md border border-brand-border overflow-hidden bg-white">
              <button onClick={() => { setPlay(false); setPaso((x) => Math.max(0, x - 1)); }} className="px-3 py-1.5 text-sm font-bold text-brand-graphite hover:bg-brand-bg" title="Mes anterior">‹</button>
              <button onClick={() => { setPlay(false); setPaso((x) => Math.min(h, x + 1)); }} className="px-3 py-1.5 text-sm font-bold text-brand-graphite hover:bg-brand-bg border-l border-brand-border" title="Mes siguiente">›</button>
            </div>
            <button onClick={() => { setPlay(false); setPaso(-1); }} className="text-xs text-brand-slate hover:text-brand-ink">Reiniciar</button>
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate">Velocidad</span>
          <div className="inline-flex rounded-md border border-brand-border overflow-hidden bg-white">
            {VELOCIDADES.map((v) => (
              <button key={v} onClick={() => setVel(v)} className={`px-2.5 py-1 text-xs font-bold transition-colors ${vel === v ? "bg-brand-ink text-white" : "text-brand-graphite hover:bg-brand-bg"}`}>{v}×</button>
            ))}
          </div>
        </div>
      </div>

      {paso < 0 ? (
        <div className="rounded-md border-2 border-dashed border-brand-border p-8 text-center bg-gradient-to-b from-white to-brand-bg-soft">
          <div className="text-4xl mb-2 hn-float">🎬</div>
          <div className="font-display text-2xl text-brand-ink uppercase">La historia de estos {h} meses</div>
          <p className="text-sm text-brand-slate mt-2 max-w-2xl mx-auto">
            Al dar play el gráfico se construye mes a mes y van apareciendo los hitos: cuándo llegan las primeras caídas, cuándo se cobra la
            cuota 2, cuándo Claro recalcula los bonos, qué meses pierden, qué meses se comportan distinto y cómo cierra el negocio con
            todas las caídas. Cada escena muestra el puente completo del mes, que cierra exacto. {hitos.length} hitos preparados.
          </p>
        </div>
      ) : (
        <>
          {/* ===== Progreso + scrubber ===== */}
          <div className="no-print mb-3">
            <div className="h-1.5 rounded-full bg-brand-border overflow-hidden mb-1.5">
              <div className="h-full bg-gradient-to-r from-brand-ink to-brand-primary transition-[width] duration-700 ease-out" style={{ width: `${progreso}%` }} />
            </div>
            <div className="flex items-center gap-1">
              {meses.map((m, i) => {
                const mk = marcadores[i];
                return (
                  <button key={m.mes} onClick={() => { setPlay(false); setPaso(i); }} title={nombre(i)}
                    className={`relative flex-1 h-3 rounded-sm transition-all duration-300 ${i < paso ? "bg-brand-ink" : i === paso ? "bg-brand-primary scale-y-125" : "bg-brand-border hover:bg-brand-slate/40"}`}>
                    {mk && i <= paso && <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[11px] leading-none hn-pop">{mk.icono}</span>}
                  </button>
                );
              })}
              <button onClick={() => { setPlay(false); setPaso(h); }} title="Cierre" className={`w-7 h-3 rounded-sm transition-all ${paso >= h ? "bg-brand-primary scale-y-125" : "bg-brand-border"}`} />
            </div>
          </div>

          <div className="grid lg:grid-cols-[1fr_340px] gap-4">
            <div>
              {/* ===== Escena ===== */}
              <div key={paso} className="hn-in rounded-lg text-white px-5 py-4 mb-3 shadow-lg" style={{ background: "linear-gradient(135deg, #0F1116 0%, #2A2F3A 100%)" }}>
                <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider2 font-bold text-white/50">{cierre ? "Cierre con todas las caídas" : `Paso ${paso + 1} de ${h}`}</div>
                    <div className="font-display text-3xl uppercase leading-none mt-0.5">{cierre ? `Después del mes ${h}` : nombre(paso)}</div>
                  </div>
                  {mesActual && (
                    <div className="text-right">
                      <div className="text-[9px] uppercase tracking-wider2 text-white/50">Ventas del mes</div>
                      <div className="font-mono text-xl font-bold">{formatInt(mesActual.ventas)}</div>
                    </div>
                  )}
                </div>

                {mesActual ? (
                  <div className="space-y-3">
                    <Puente pasos={[
                      { label: "Facturación bruta del mes", valor: mesActual.facturacion_bruta },
                      { label: "Ajustes de cohortes anteriores", valor: mesActual.ajustes, op: "+" },
                      { label: "Ingreso neto liquidado", valor: mesActual.ingreso_neto, op: "=", destacado: true },
                    ]} />
                    <Puente pasos={[
                      { label: "Ingreso neto", valor: mesActual.ingreso_neto },
                      { label: "Costos del mes", valor: mesActual.costo_total, op: "−" },
                      { label: "Resultado del mes", valor: mesActual.resultado, op: "=", destacado: true },
                    ]} />
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <span className={`px-2 py-1 rounded-md border font-mono ${mesActual.resultado >= 0 ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-800"}`}>
                        Margen del mes: {Number(mesActual.margen_pct ?? 0).toFixed(1)}%
                      </span>
                      <span className="px-2 py-1 rounded-md border border-red-300 bg-red-50 text-red-800 font-mono">
                        Ola heredada: {formatGs(mesActual.ola_devoluciones ?? 0)}
                      </span>
                    </div>
                    <Puente pasos={[
                      { label: "Acumulado anterior", valor: mesActual.acumulado_anterior ?? mesActual.acumulado - mesActual.resultado },
                      { label: "Resultado del mes", valor: mesActual.resultado, op: "+" },
                      { label: "Acumulado", valor: mesActual.acumulado, op: "=", destacado: true },
                    ]} />
                  </div>
                ) : (
                  <Puente pasos={[
                    { label: `Resultado de los ${h} meses`, valor: a.resultado },
                    { label: "Por cobrar (cuota 2 y residual)", valor: cola.cobros ?? 0, op: "+" },
                    { label: "Por devolver (caídas pendientes)", valor: Math.abs(cola.devoluciones ?? 0), op: "−" },
                    { label: "Resultado final", valor: a.veredicto?.resultado_final ?? a.resultado_con_cola, op: "=", destacado: true },
                  ]} />
                )}
              </div>

              {/* Detalle de los ajustes y variables del mes */}
              {mesActual && (
                <div key={`d${paso}`} className="hn-in grid sm:grid-cols-2 gap-3 mb-3">
                  <div className="rounded-md border border-brand-border bg-white p-3">
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate">Ajustes de cohortes anteriores</span>
                      <Cifra valor={mesActual.ajustes} className="text-[12px] font-bold text-brand-ink" />
                    </div>
                    {mesActual.ajustes === 0 && paso === 0 ? (
                      <p className="text-[11px] text-brand-slate">Primer mes: todavía no hay cohortes anteriores que ajusten.</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {AJUSTES.map(([k, label, ic]) => (
                          <li key={k} className="flex items-center justify-between text-[11px]">
                            <span className="text-brand-graphite">{ic} {label}</span>
                            <Cifra valor={mesActual[k] ?? 0} signo className={`${(mesActual[k] ?? 0) < 0 ? "text-brand-primary" : (mesActual[k] ?? 0) > 0 ? "text-emerald-700" : "text-brand-slate"}`} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="rounded-md border border-brand-border bg-white p-3">
                    <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate mb-1.5">Variables en juego</div>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        ["🎯 Objetivo", formatInt(Number(mesActual.variaciones?.objetivo_co ?? p?.objetivo_co ?? 0))],
                        ["📈 Cumplimiento", `${mesActual.cumplimiento_pct}%`],
                        ["🏅 Bono prod.", mesActual.monto_bono_productividad ? `${formatGs(mesActual.monto_bono_productividad)}/línea` : "sin bono"],
                        ["🔀 Porta", `${mesActual.variaciones?.porta_pct ?? p?.porta_pct}%`],
                        ["📦 Efectividad", `${mesActual.variaciones?.efectividad_pct ?? p?.efectividad_pct}%`],
                        ["📡 Líneas activas", formatInt(mesActual.lineas_activas)],
                        ["👥 Ventas/vendedor", `${mesActual.ventas_por_vendedor}`],
                      ].map(([k, v]) => (
                        <span key={k} className={`px-2 py-0.5 rounded-full border text-[11px] ${mesActual.afectado ? "border-brand-purple/40 bg-brand-purple/5 text-brand-purple" : "border-brand-border bg-brand-bg-soft text-brand-graphite"}`}><b className="font-semibold">{k}</b> {v}</span>
                      ))}
                    </div>
                    {mesActual.afectado && <p className="text-[10px] text-brand-purple mt-1.5">Mes con variaciones propias: {describirVariaciones(mesActual.variaciones ?? {}, p).join(" · ")}</p>}
                  </div>
                </div>
              )}

              <div className="rounded-md border border-brand-border bg-white p-2">
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={data} margin={{ top: 18, right: 12 }}>
                    <defs>
                      <linearGradient id="hnRes" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#662483" stopOpacity={0.35} /><stop offset="100%" stopColor="#662483" stopOpacity={0.02} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="mes" fontSize={10} tickFormatter={(v: number) => { const n = nombre(v - 1); return n.length > 10 ? n.slice(0, 9) + "…" : n; }} />
                    <YAxis yAxisId="l" fontSize={10} tickFormatter={M} domain={ejes.izq} allowDataOverflow />
                    <YAxis yAxisId="r" orientation="right" fontSize={10} tickFormatter={(v: number) => `${Math.round(v)}%`} domain={ejes.der} ticks={ejes.ticksDer} allowDataOverflow />
                    <Tooltip
                      formatter={(v: any, name: any) => (name === "Margen del mes" ? `${Number(v).toFixed(1)}%` : formatGs(Number(v)))}
                      labelFormatter={(l) => nombre(Number(l) - 1)}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine yAxisId="l" y={0} stroke="#0F1116" />
                    <Bar yAxisId="l" dataKey="ingreso_neto" name="Ingreso neto" fill="#0EA5E9" fillOpacity={0.6} radius={[3, 3, 0, 0]} animationDuration={600} animationEasing="ease-out" />
                    <Bar yAxisId="l" dataKey="costo_total" name="Costos" fill="#F39200" fillOpacity={0.6} radius={[3, 3, 0, 0]} animationDuration={600} animationEasing="ease-out" />
                    <Area yAxisId="l" dataKey="ola_devoluciones" name="Ola de devoluciones heredadas" stroke="#E6332A" fill="#E6332A" fillOpacity={0.28} strokeWidth={1.5} type="monotone" connectNulls={false} animationDuration={600} />
                    <Area yAxisId="l" dataKey="resultado" name="Resultado del mes" stroke="#662483" fill="url(#hnRes)" strokeWidth={2} connectNulls={false} animationDuration={600} />
                    <Line yAxisId="r" dataKey="margen_pct" name="Margen del mes" stroke="#0F1116" strokeWidth={3} dot={{ r: 3, strokeWidth: 2, fill: "#fff" }} connectNulls={false} animationDuration={600} />
                    {Object.entries(marcadores).map(([i, hx]) => (
                      <ReferenceDot key={i} yAxisId="r" x={Number(i) + 1} y={meses[Number(i)].margen_pct} r={8} fill={SEV[hx.severidad].punto} stroke="#fff" strokeWidth={2.5}
                        label={{ value: hx.icono, position: "top", fontSize: 13 }} />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ===== Feed de hitos ===== */}
            <div className="rounded-lg border border-brand-border bg-white flex flex-col max-h-[380px] lg:max-h-[640px] shadow-sm">
              <div className="px-3 py-2 border-b border-brand-border flex items-center justify-between bg-brand-bg-soft rounded-t-lg">
                <span className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate">Hitos y alertas</span>
                <span className="text-[11px] font-mono text-brand-slate">{visibles.length} / {hitos.length}</span>
              </div>
              <div ref={feedRef} className="flex-1 overflow-y-auto p-2 space-y-2">
                {visibles.length === 0 && <p className="text-[12px] text-brand-slate p-2">Todavía no pasó nada: dale play.</p>}
                {visibles.map((x, i) => {
                  const s = SEV[x.severidad];
                  const nuevo = x.paso === paso;
                  return (
                    <div key={i} className={`${nuevo ? "hn-in" : ""} rounded-md border px-2.5 py-2 flex gap-2.5 transition-opacity ${s.cls} ${nuevo ? "" : "opacity-75"}`}>
                      <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base bg-white shadow ${nuevo ? `${s.anim} hn-ring` : ""}`}
                        style={{ ["--hn-c" as any]: s.punto + "66" }}>{x.icono}</span>
                      <div className="min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-[12px] font-bold leading-tight">{x.titulo}</span>
                          <span className="text-[9px] font-bold uppercase opacity-60 whitespace-nowrap">{x.paso >= h ? "cierre" : nombre(x.paso)}</span>
                        </div>
                        <p className="text-[11px] leading-snug mt-0.5 opacity-90">{x.detalle}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Impresión: la historia completa como lista */}
      <div className="print-only mt-4">
        <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate mb-1">Hitos de la historia</div>
        <ol className="space-y-1">
          {hitos.map((x, i) => (
            <li key={i} className="text-[11px] text-brand-ink"><b>{x.paso >= h ? "Cierre" : nombre(x.paso)} · {SEV[x.severidad].label}:</b> {x.titulo}. <span className="text-brand-graphite">{x.detalle}</span></li>
          ))}
        </ol>
      </div>
    </div>
  );
}
