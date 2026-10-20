"use client";

/**
 * Cierre del día y ánimo de los supervisores (para los jefes, en el Control y en el Coaching del día): lo que contó
 * cada uno al terminar el día, su compromiso para mañana, si cumplió el anterior, cuántos feedback hizo contra el
 * objetivo y el ánimo detectado de la última semana, con una alerta cuando conviene hablar con él.
 */
import { AlertTriangle, Flag, Frown, Meh, MessageSquareText, Smile } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Etiqueta, cx, hora, plural } from "@/components/portal/ui";
import {
  ANIMO, EMOCION, NIVEL_CALIDAD, RESULTADO_COMPROMISO, SUP_API, type CierreSupervisor, type CierresJefes, type ComoTermino, type EtiquetaAnimo,
} from "./tipos";

const COMO: Record<ComoTermino, { label: string; icono: typeof Smile }> = {
  bien: { label: "Terminó bien", icono: Smile }, normal: { label: "Terminó normal", icono: Meh }, dificil: { label: "Día difícil", icono: Frown },
};
const DIA = ["D", "L", "M", "M", "J", "V", "S"];

function ChipAnimo({ e }: { e: EtiquetaAnimo }) {
  const a = ANIMO[e];
  return <span className={cx("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", a.chip)}>Ánimo {a.label.toLowerCase()}</span>;
}

function Semana({ s }: { s: CierreSupervisor["animo"] }) {
  return (
    <div className="flex gap-1.5" aria-label="Ánimo de los últimos 7 días">
      {s.map((x) => (
        <span key={x.dia} className="flex flex-col items-center gap-0.5" title={`${x.dia}: ${x.etiqueta ? ANIMO[x.etiqueta].label : "sin cierre"}`}>
          <span className="w-3.5 h-3.5 rounded-full border" style={x.etiqueta ? { background: ANIMO[x.etiqueta].color, borderColor: ANIMO[x.etiqueta].color } : { borderColor: "#C9CED8" }} />
          <span className="text-[9px] text-brand-mist">{DIA[new Date(`${x.dia}T12:00:00`).getDay()]}</span>
        </span>
      ))}
    </div>
  );
}

function Tarjeta({ f, hoy }: { f: CierreSupervisor; hoy: boolean }) {
  const c = f.cierre;
  const pct = Math.min(100, (f.feedbacks / f.objetivo) * 100);
  const como = c?.como_termino ? COMO[c.como_termino] : null;
  return (
    <li className={cx("card p-4 min-w-0", f.alerta && "border-brand-orange/50")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-brand-ink truncate">{f.nombre}</div>
          <div className="text-xs text-brand-slate">{f.puntos} de {f.objetivo + 1} puntos{c?.at ? ` · cerró ${hora(c.at)}` : ""}</div>
        </div>
        {c?.animo?.etiqueta && <ChipAnimo e={c.animo.etiqueta} />}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex justify-between text-xs"><span className="text-brand-slate">Feedback</span><span className="font-semibold tabular-nums text-brand-ink">{f.feedbacks} / {f.objetivo}</span></div>
          <div className="h-1.5 rounded-full bg-brand-bg mt-1"><div className={cx("h-full rounded-full", f.feedbacks >= f.objetivo ? "bg-emerald-600" : "bg-[#00B2BF]")} style={{ width: `${pct}%` }} /></div>
        </div>
        {f.calidad !== null && f.calidad_nivel && <Etiqueta tono={NIVEL_CALIDAD[f.calidad_nivel].tono}>Calidad {f.calidad}</Etiqueta>}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <Semana s={f.animo} />
        {como && <span className="inline-flex items-center gap-1 text-xs text-brand-slate"><como.icono size={14} aria-hidden /> {como.label}</span>}
      </div>

      {f.alerta && (
        <p className="mt-3 rounded-md bg-brand-orange/10 border border-brand-orange/40 px-2.5 py-2 text-xs text-[#8A5200] flex gap-1.5">
          <AlertTriangle size={14} className="shrink-0 mt-px" aria-hidden /> {f.alerta}
        </p>
      )}

      {c ? (
        <div className="mt-3 space-y-2.5 text-sm">
          <div>
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">Cómo le fue</div>
            <p className="text-brand-ink break-words whitespace-pre-line">{c.resultados}</p>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">Compromiso para mañana</div>
            <p className="text-brand-ink break-words">{c.compromiso}</p>
          </div>
          {f.anterior && (
            <div className="rounded-md bg-brand-bg-soft px-2.5 py-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider2 text-brand-slate">Compromiso anterior</span>
                {c.cumplio_anterior && (
                  <span className={cx("inline-flex rounded-md border px-1.5 py-px text-[10px] font-semibold", RESULTADO_COMPROMISO[c.cumplio_anterior].chip)}>
                    {RESULTADO_COMPROMISO[c.cumplio_anterior].label}
                  </span>
                )}
              </div>
              <p className="text-xs text-brand-graphite mt-0.5 break-words">{f.anterior.compromiso}</p>
            </div>
          )}
          {(c.animo?.emociones?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1">
              {c.animo.emociones.map((e) => <Etiqueta key={e}>{EMOCION[e] ?? e}</Etiqueta>)}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-brand-slate flex items-center gap-1.5"><Flag size={14} aria-hidden /> {hoy ? "Todavía no cerró el día." : "No cargó el cierre."}</p>
      )}
    </li>
  );
}

export function CierresDelDia({ fecha }: { fecha: string }) {
  const [d, setD] = useState<CierresJefes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    try { setD(await apiFetch<CierresJefes>(`${SUP_API}/control/cierres?fecha=${fecha}`)); setError(null); } catch (e: any) { setError(e.message); }
  }, [fecha]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (!d || d.fecha !== d.hoy) return;
    const t = window.setInterval(() => { if (document.visibilityState === "visible") cargar(); }, 60_000);
    return () => window.clearInterval(t);
  }, [d, cargar]);
  if (error) return <p className="card p-4 text-sm text-brand-primary">{error}</p>;
  if (!d || !d.supervisores.length) return null;
  const k = d.kpis;
  const total = Object.values(k.animo).reduce((a, b) => a + b, 0);
  return (
    <section className="space-y-3" id="cierres">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-display text-2xl uppercase text-brand-ink leading-tight flex items-center gap-2"><MessageSquareText size={20} aria-hidden /> Cierre del día y ánimo</h2>
          <p className="text-sm text-brand-slate">Lo que contó cada supervisor al terminar el día, su compromiso para mañana y cómo está.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="card p-3"><div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Cerraron el día</div><div className="font-display text-3xl tabular-nums text-brand-ink">{k.con_cierre}<span className="text-lg text-brand-slate"> / {k.supervisores}</span></div></div>
        <div className="card p-3"><div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Objetivo de feedback</div><div className="font-display text-3xl tabular-nums text-brand-ink">{k.objetivo_cumplido}<span className="text-lg text-brand-slate"> / {k.supervisores}</span></div><div className="text-[11px] text-brand-slate">{d.objetivo} por día · {plural(k.feedbacks, "feedback", "feedback")}</div></div>
        <div className={cx("card p-3", k.alertas > 0 && "border-brand-orange/50")}><div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Para charlar</div><div className="font-display text-3xl tabular-nums text-brand-ink">{k.alertas}</div><div className="text-[11px] text-brand-slate">con alerta de ánimo</div></div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Ánimo del día</div>
          {total ? (
            <>
              <div className="flex h-2.5 rounded-full overflow-hidden mt-2 gap-px" role="img" aria-label={Object.entries(k.animo).map(([e, n]) => `${ANIMO[e as EtiquetaAnimo].label}: ${n}`).join(", ")}>
                {(Object.keys(ANIMO) as EtiquetaAnimo[]).filter((e) => k.animo[e]).map((e) => <span key={e} style={{ width: `${(k.animo[e] / total) * 100}%`, background: ANIMO[e].color }} />)}
              </div>
              <div className="flex flex-wrap gap-x-2 mt-1.5 text-[10px] text-brand-slate">
                {(Object.keys(ANIMO) as EtiquetaAnimo[]).filter((e) => k.animo[e]).map((e) => <span key={e}>{ANIMO[e].label} {k.animo[e]}</span>)}
              </div>
            </>
          ) : <div className="text-sm text-brand-slate mt-1">Sin cierres todavía</div>}
        </div>
      </div>
      <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {d.supervisores.map((f) => <Tarjeta key={f.id} f={f} hoy={d.fecha === d.hoy} />)}
      </ul>
    </section>
  );
}
