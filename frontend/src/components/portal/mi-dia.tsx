"use client";

/**
 * «Mi día» dentro de Hoy del portal: la barra del objetivo de feedback con sus hitos (el cierre del día suma un punto
 * más), la calidad de los feedback con qué hacer, la pista de calidad mientras se escribe y la hoja del cierre del día.
 */
import { CircleCheck, Flag, Flame, Frown, Lightbulb, Meh, MoonStar, Smile, Star } from "lucide-react";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  NIVEL_CALIDAD, SUP_API, type ComoTermino, type MiDia, type ResultadoCompromiso,
} from "@/components/supervision/tipos";
import { Boton, Etiqueta, Fallo, Fila, Hoja, Seccion, cx, plural } from "./ui";
import { diaCorto } from "./coaching";

const DIAS_CORTOS = ["D", "L", "M", "M", "J", "V", "S"];

// ------------------------------------------------------------------ barra del objetivo de feedback
export function BarraObjetivo({ d, onCierre }: { d: MiDia; onCierre: () => void }) {
  const pct = Math.min(100, (d.feedbacks / d.objetivo) * 100);
  const cumplido = d.feedbacks >= d.objetivo;
  const faltan = Math.max(0, d.objetivo - d.feedbacks);
  const marcas = d.hitos.filter((h) => h.meta !== null && h.meta !== d.objetivo);
  return (
    <section className="card p-4" aria-label="Objetivo de feedback de hoy">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold">Feedback de hoy</span>
        <span className="text-xs text-brand-slate tabular-nums">{d.puntos} de {d.puntos_max} puntos</span>
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className={cx("font-display text-5xl leading-none tabular-nums", cumplido ? "text-emerald-700" : "text-brand-ink")}>{d.feedbacks}</span>
        <span className="font-display text-2xl text-brand-slate">/ {d.objetivo}</span>
        <span className="text-sm text-brand-slate ml-1">{cumplido ? "¡Objetivo cumplido!" : `te ${faltan === 1 ? "falta" : "faltan"} ${faltan}`}</span>
      </div>

      {/* La barra con las marcas de los hitos y el punto extra del cierre a la derecha */}
      <div className="mt-3 flex items-center gap-2">
        <div className="relative flex-1 h-3 rounded-full bg-brand-bg" role="progressbar" aria-valuemin={0} aria-valuemax={d.objetivo} aria-valuenow={d.feedbacks}
          aria-label={`${d.feedbacks} de ${d.objetivo} feedback`}>
          <div className={cx("h-full rounded-full transition-[width] duration-500", cumplido ? "bg-emerald-600" : "bg-[#00B2BF]")} style={{ width: `${pct}%` }} />
          {marcas.map((h) => (
            <span key={h.clave} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1 h-5 rounded-full bg-white ring-1 ring-brand-border"
              style={{ left: `${((h.meta ?? 0) / d.objetivo) * 100}%` }} aria-hidden />
          ))}
        </div>
        <button type="button" onClick={onCierre} aria-label={d.cierre ? "Día cerrado: punto extra sumado" : "Cerrar el día: suma un punto"}
          className={cx("w-9 h-9 rounded-full grid place-items-center shrink-0 border-2",
            d.cierre ? "bg-[#F2A900] border-[#F2A900] text-white" : "border-dashed border-brand-mist text-brand-mist")}>
          <Star size={16} fill={d.cierre ? "currentColor" : "none"} aria-hidden />
        </button>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
        {d.hitos.map((h) => (
          <li key={h.clave} className={cx("inline-flex items-center gap-1 text-xs", h.logrado ? "text-emerald-700 font-semibold" : "text-brand-slate")}>
            {h.logrado ? <CircleCheck size={14} aria-hidden /> : <span className="w-3.5 h-3.5 rounded-full border border-brand-mist" aria-hidden />}
            {h.nombre}{h.meta ? ` (${h.meta})` : h.extra ? " +1" : ""}
          </li>
        ))}
      </ul>

      <div className="mt-3 pt-3 border-t border-brand-border flex items-center justify-between gap-3">
        <div className="flex gap-1.5" aria-label="Últimos 7 días">
          {d.semana.map((s) => {
            const dia = new Date(`${s.dia}T12:00:00`);
            const ok = s.feedbacks >= d.objetivo;
            return (
              <span key={s.dia} title={`${diaCorto(s.dia)}: ${s.feedbacks} feedback`}
                className={cx("w-7 h-8 rounded-md grid place-items-center text-[10px] font-semibold leading-none",
                  !s.habil ? "bg-brand-bg-soft text-brand-mist" : ok ? "bg-emerald-600 text-white" : s.feedbacks ? "bg-[#00B2BF]/15 text-[#00646C]" : "bg-brand-bg text-brand-slate",
                  s.dia === d.fecha && "ring-2 ring-brand-ink")}>
                <span>{DIAS_CORTOS[dia.getDay()]}</span><span className="tabular-nums">{s.habil ? s.feedbacks : "·"}</span>
              </span>
            );
          })}
        </div>
        {d.racha > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#8A5200]"><Flame size={15} aria-hidden /> {plural(d.racha, "día", "días")} seguidos</span>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ fila del cierre en «Para hoy»
export function FilaCierre({ d, onAbrir }: { d: MiDia; onAbrir: () => void }) {
  if (d.cierre) {
    return <Fila icono={Flag} tono="verde" onClick={onAbrir} titulo="Día cerrado · +1 punto" sub={`Mañana: ${d.cierre.compromiso}`} />;
  }
  return (
    <Fila icono={MoonStar} tono="azul" onClick={onAbrir} titulo="Cerrá tu día"
      sub={d.anterior ? "Tus resultados, si cumpliste el compromiso de ayer y el de mañana · suma 1 punto" : "Tus resultados y tu compromiso para mañana · suma 1 punto"} />
  );
}

// ------------------------------------------------------------------ calidad de mis feedback
export function CalidadFeedback({ d }: { d: MiDia }) {
  const c = d.calidad;
  if (!c.feedbacks) {
    return (
      <Seccion titulo="Calidad de mis feedback">
        <div className="card px-4 py-5 text-sm text-brand-slate">Cuando cargues feedback, acá ves qué tan completos son y qué podés mejorar.</div>
      </Seccion>
    );
  }
  const nivel = c.nivel ? NIVEL_CALIDAD[c.nivel] : null;
  return (
    <Seccion titulo="Calidad de mis feedback" sub={`Últimos ${c.dias} días · ${plural(c.feedbacks, "feedback", "feedback")}`}>
      <div className="card p-4 space-y-4">
        <div className="flex items-center gap-4">
          <div className="relative w-16 h-16 shrink-0" aria-label={`Calidad ${c.puntaje} de 100`}>
            <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90" aria-hidden>
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#EEF0F4" strokeWidth="4" />
              <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="4" strokeLinecap="round"
                stroke={c.nivel === "muy_bien" ? "#0E8F5E" : c.nivel === "bien" ? "#1D5BA6" : "#C27A00"}
                strokeDasharray={`${((c.puntaje ?? 0) / 100) * 97.4} 97.4`} />
            </svg>
            <span className="absolute inset-0 grid place-items-center font-display text-xl tabular-nums text-brand-ink">{c.puntaje}</span>
          </div>
          <div className="min-w-0">
            {nivel && <Etiqueta tono={nivel.tono}>{nivel.label}</Etiqueta>}
            <p className="text-sm text-brand-slate mt-1">
              {c.palabras_prom} palabras en promedio{c.cortos ? ` · ${plural(c.cortos, "corto", "cortos")}` : ""}{c.largos ? ` · ${plural(c.largos, "largo", "largos")}` : ""}
            </p>
          </div>
        </div>
        <ul className="space-y-2">
          {Object.entries(c.criterios).map(([k, nombre]) => {
            const v = c.senales[k] ?? 0;
            return (
              <li key={k}>
                <div className="flex items-baseline justify-between text-sm"><span className="text-brand-ink">{nombre}</span><span className="tabular-nums text-brand-slate">{v}%</span></div>
                <div className="h-1.5 rounded-full bg-brand-bg mt-1"><div className={cx("h-full rounded-full", v >= 70 ? "bg-emerald-600" : v >= 40 ? "bg-[#1D5BA6]" : "bg-[#C27A00]")} style={{ width: `${v}%` }} /></div>
              </li>
            );
          })}
        </ul>
        {c.recomendaciones.length > 0 ? (
          <div className="rounded-lg bg-brand-bg-soft border border-brand-border p-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-brand-ink"><Lightbulb size={16} className="text-[#C27A00]" aria-hidden /> Qué podés hacer</div>
            <ul className="mt-2 space-y-2">
              {c.recomendaciones.map((r) => <li key={r.clave} className="text-sm text-brand-graphite leading-snug">{r.texto}</li>)}
            </ul>
          </div>
        ) : <p className="text-sm text-emerald-800 flex items-center gap-1.5"><CircleCheck size={16} aria-hidden /> Tus feedback están completos: seguí así.</p>}
        {c.ultimos.length > 0 && (
          <details>
            <summary className="min-h-[44px] flex items-center cursor-pointer text-sm font-semibold text-brand-ink">Mis últimos feedback</summary>
            <ul className="divide-y divide-brand-border">
              {c.ultimos.map((u, i) => (
                <li key={i} className="py-2.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Etiqueta tono={NIVEL_CALIDAD[u.nivel].tono}>{u.puntaje}</Etiqueta>
                    {u.problema === "corto" && <Etiqueta tono="naranja">Corto</Etiqueta>}
                    {u.problema === "largo" && <Etiqueta tono="naranja">Largo</Etiqueta>}
                    <span className="text-[11px] text-brand-slate">{u.palabras} palabras</span>
                  </div>
                  <p className="text-sm text-brand-graphite mt-1 line-clamp-2 break-words">{u.texto}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Seccion>
  );
}

// ------------------------------------------------------------------ hoja: cierre del día
const COMO: { v: ComoTermino; label: string; icono: typeof Smile }[] = [
  { v: "bien", label: "Bien", icono: Smile }, { v: "normal", label: "Normal", icono: Meh }, { v: "dificil", label: "Difícil", icono: Frown },
];
const CUMPLIO: { v: ResultadoCompromiso; label: string }[] = [
  { v: "cumplido", label: "Sí" }, { v: "parcial", label: "En parte" }, { v: "no_cumplido", label: "No" },
];

export function HojaCierre({ d, onClose, onGuardado }: { d: MiDia; onClose: () => void; onGuardado: (x: MiDia) => void }) {
  const [resultados, setResultados] = useState(d.cierre?.resultados ?? "");
  const [compromiso, setCompromiso] = useState(d.cierre?.compromiso ?? "");
  const [como, setComo] = useState<ComoTermino | null>(d.cierre?.como_termino ?? null);
  const [cumplio, setCumplio] = useState<ResultadoCompromiso | null>(d.cierre?.cumplio_anterior ?? null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listo = resultados.trim().length >= 10 && compromiso.trim().length >= 10 && !!como && (!d.anterior || !!cumplio);
  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try {
      onGuardado(await apiFetch<MiDia>(`${SUP_API}/portal/cierre`, {
        method: "PUT", body: JSON.stringify({ resultados, compromiso, como_termino: como, cumplio_anterior: d.anterior ? cumplio : null }),
      }));
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  const boton = (activo: boolean) => cx("min-h-[52px] rounded-lg border-2 px-2 font-semibold text-sm flex items-center justify-center gap-1.5",
    activo ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border text-brand-ink");
  return (
    <Hoja sobre={`Hoy · ${plural(d.feedbacks, "feedback", "feedback")} de ${d.objetivo}`} titulo={d.cierre ? "Corregir mi cierre" : "Cerrar mi día"} onClose={onClose} ocupada={ocupado}
      pie={<Boton icono={Flag} onClick={guardar} disabled={!listo} ocupado={ocupado}>{d.cierre ? "Guardar cambios" : "Cerrar el día · +1 punto"}</Boton>}>
      <div className="space-y-5">
        {d.anterior && (
          <div className="rounded-lg border border-brand-border p-3">
            <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Tu compromiso del {diaCorto(d.anterior.fecha)}</div>
            <p className="text-[15px] text-brand-ink mt-1 break-words">{d.anterior.compromiso}</p>
            <div className="label mt-3">¿Lo cumpliste?</div>
            <div className="grid grid-cols-3 gap-2">
              {CUMPLIO.map((x) => <button key={x.v} type="button" aria-pressed={cumplio === x.v} onClick={() => setCumplio(x.v)} className={boton(cumplio === x.v)}>{x.label}</button>)}
            </div>
          </div>
        )}
        <div>
          <div className="label">¿Cómo terminaste el día?</div>
          <div className="grid grid-cols-3 gap-2">
            {COMO.map(({ v, label, icono: I }) => (
              <button key={v} type="button" aria-pressed={como === v} onClick={() => setComo(v)} className={boton(como === v)}><I size={18} aria-hidden /> {label}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="resultados">¿Cómo te fue hoy?</label>
          <textarea id="resultados" className="input !text-base min-h-[110px] leading-relaxed" maxLength={2000} value={resultados}
            onChange={(e) => setResultados(e.target.value)} placeholder="Ej.: 7 feedback, el equipo vendió 14 Pospago; faltó trabajar GPON con Ana y Beto." />
        </div>
        <div>
          <label className="label" htmlFor="compromiso">Tu compromiso para mañana</label>
          <textarea id="compromiso" className="input !text-base min-h-[90px] leading-relaxed" maxLength={1000} value={compromiso}
            onChange={(e) => setCompromiso(e.target.value)} placeholder="Ej.: Hacer los 8 feedback antes de las 15 h, empezando por los que tienen líneas sin uso." />
          <p className="text-[11px] text-brand-slate mt-1">Mañana te preguntamos si lo cumpliste. Lo ven tus jefes.</p>
        </div>
        {error && <Fallo>{error}</Fallo>}
      </div>
    </Hoja>
  );
}
