"use client";

/**
 * Piezas del tablero «En vivo» de los entrenamientos: el reloj que corre con la hora del servidor, el estado de cada
 * conversación con su tiempo (como el Pulse de un contact center) y el monitor para mirar una conversación mientras pasa.
 */
import { Bot, ChevronDown, Clock3, Pause } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Fallo, Hoja, cx } from "@/components/portal/ui";
import { apiFetch } from "@/lib/api";
import { EvaluacionVista } from "./entrenamientos";
import { CAP_API, type EstadoVivo, type Sesion } from "./tipos";

/** La hora «de ahora» corregida con la del servidor, que avanza cada segundo. */
export function useAhora(offset: number): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => { const x = setInterval(() => setT(Date.now()), 1000); return () => clearInterval(x); }, []);
  return t + offset;
}

export const mmss = (s: number | null | undefined) => {
  if (s === null || s === undefined) return "—";
  const n = Math.max(0, Math.round(s));
  return n >= 3600 ? `${Math.floor(n / 3600)} h ${Math.floor((n % 3600) / 60)} min` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};
export const segDesde = (iso: string | null | undefined, ahora: number) => (iso ? Math.max(0, (ahora - new Date(iso).getTime()) / 1000) : null);

/** Color del tiempo de espera del cliente: normal, amarillo o rojo (umbrales del servidor). */
export function tonoEspera(estado: EstadoVivo, seg: number | null, u: { amarillo: number; rojo: number }): "normal" | "amarillo" | "rojo" {
  if (estado !== "responde_asesor" || seg === null) return "normal";
  return seg >= u.rojo ? "rojo" : seg >= u.amarillo ? "amarillo" : "normal";
}

const ESTILO_TONO = {
  normal: "bg-white text-brand-ink border-brand-border",
  amarillo: "bg-amber-50 text-amber-900 border-amber-300",
  rojo: "bg-red-50 text-red-800 border-red-300",
};

/** «Le toca al postulante · 1:24»: el estado con su tiempo (ícono + texto, nunca solo color). */
export function EstadoVivoChip({ estado, seg, umbrales, grande }: { estado: EstadoVivo; seg: number | null; umbrales: { amarillo: number; rojo: number }; grande?: boolean }) {
  const tono = tonoEspera(estado, seg, umbrales);
  const base = cx("inline-flex items-center gap-1.5 rounded-full border font-semibold tabular-nums", grande ? "px-3 py-1.5 text-[13px]" : "px-2.5 py-1 text-[12px]");
  if (estado === "responde_cliente") {
    return <span className={cx(base, "bg-sky-50 text-sky-900 border-sky-200")}><Bot size={14} aria-hidden /> Cliente escribiendo</span>;
  }
  if (estado === "en_pausa") {
    return <span className={cx(base, "bg-brand-bg text-brand-slate border-brand-border")}><Pause size={14} aria-hidden /> En pausa · {mmss(seg)}</span>;
  }
  return (
    <span className={cx(base, ESTILO_TONO[tono])}>
      <Clock3 size={14} aria-hidden /> {tono === "rojo" ? "Demorado" : "Le toca al postulante"} · {mmss(seg)}
    </span>
  );
}

/** El punto que late: «en vivo». */
export function PuntoVivo({ apagado }: { apagado?: boolean }) {
  return (
    <span className="relative inline-flex w-2.5 h-2.5" aria-hidden>
      {!apagado && <span className="absolute inset-0 rounded-full bg-brand-primary opacity-60 animate-ping" />}
      <span className={cx("relative w-2.5 h-2.5 rounded-full", apagado ? "bg-brand-mist" : "bg-brand-primary")} />
    </span>
  );
}

/** Mirar una conversación mientras pasa (sin que el postulante vea nada distinto). Se actualiza cada 2,5 segundos. */
export function Monitor({ sid, postulante, offset, umbrales, criterios, onClose }: {
  sid: string; postulante: string; offset: number; umbrales: { amarillo: number; rojo: number }; criterios?: Record<string, string>; onClose: () => void;
}) {
  const [s, setS] = useState<Sesion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verCaso, setVerCaso] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const pegado = useRef(true);
  const ahora = useAhora(offset);
  const sigue = !s || s.estado === "en_curso" || s.estado === "evaluando";
  useEffect(() => {
    let vivo = true;
    let t: ReturnType<typeof setTimeout>;
    const cargar = async () => {
      if (!document.hidden) {
        try { const x = await apiFetch<Sesion>(`${CAP_API}/sesiones/${sid}`); if (vivo) { setS(x); setError(null); } }
        catch (e: any) { if (vivo) setError(e.message); }
      }
      if (vivo) t = setTimeout(cargar, 2500);
    };
    if (sigue) cargar();
    return () => { vivo = false; clearTimeout(t); };
  }, [sid, sigue]);
  // Baja sola con cada mensaje nuevo, salvo que quien mira haya subido a leer algo anterior.
  useEffect(() => { const c = caja.current; if (c && pegado.current) c.scrollTop = c.scrollHeight; }, [s?.mensajes.length]);
  const ms = s?.mensajes ?? [];
  const ultimo = ms[ms.length - 1];
  const estado: EstadoVivo | null = s?.estado !== "en_curso" ? null : ultimo?.r === "asesor" ? "responde_cliente" : "responde_asesor";
  return (
    <Hoja titulo={postulante} sobre={s?.entrenamiento ? `En vivo · ${s.entrenamiento}` : "En vivo"} onClose={onClose}>
      {error && !s && <Fallo>{error}</Fallo>}
      {!s && !error && <div className="h-48 rounded-lg bg-brand-bg animate-pulse" />}
      {s && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] text-brand-ink"><b>{s.cliente}</b> · {s.titulo}</span>
            {estado ? <EstadoVivoChip estado={estado} seg={segDesde(ultimo?.at, ahora)} umbrales={umbrales} />
              : <span className="text-[12px] font-semibold text-brand-slate">{s.estado === "evaluando" ? "Terminó · evaluando…" : "Terminó"}</span>}
          </div>
          <div className="text-[12px] text-brand-slate tabular-nums">
            {s.estado === "en_curso" ? <>En curso hace {mmss(segDesde(s.iniciado_at, ahora))}</> : <>Duró {mmss(s.segundos)}</>} · {s.turnos} de {s.max_turnos} respuestas del postulante
          </div>
          {(s.objetivo || (s.info_correcta ?? []).length > 0) && (
            <div className="rounded-lg border border-brand-border">
              <button type="button" onClick={() => setVerCaso(!verCaso)} aria-expanded={verCaso}
                className="w-full min-h-[44px] px-3 flex items-center justify-between text-[13px] font-semibold text-brand-ink">
                Qué tiene que lograr <ChevronDown size={16} className={cx("transition-transform", verCaso && "rotate-180")} aria-hidden />
              </button>
              {verCaso && (
                <div className="px-3 pb-3 text-[13px] text-brand-slate space-y-1.5">
                  {s.objetivo && <p><b className="text-brand-ink">El cliente quiere:</b> {s.objetivo}</p>}
                  {(s.info_correcta ?? []).length > 0 && (
                    <div><b className="text-brand-ink">Datos que tiene que dar bien:</b>
                      <ul className="list-disc pl-5">{s.info_correcta!.map((x) => <li key={x}>{x}</li>)}</ul></div>
                  )}
                </div>
              )}
            </div>
          )}
          <div ref={caja} onScroll={(e) => { const c = e.currentTarget; pegado.current = c.scrollHeight - c.scrollTop - c.clientHeight < 40; }}
            className="rounded-xl bg-[#EEF0F3] p-3 space-y-1.5 h-[46dvh] md:h-[50vh] overflow-y-auto" aria-live="polite">
            {ms.map((m, k) => {
              const nuevoTurno = k === 0 || ms[k - 1].r !== m.r;
              return (
                <div key={k} className={cx("flex flex-col", m.r === "asesor" ? "items-end" : "items-start", nuevoTurno && k > 0 && "pt-1.5")}>
                  {nuevoTurno && <span className="text-[10px] uppercase tracking-wider2 text-brand-slate px-1">{m.r === "asesor" ? postulante.split(" ")[0] : s.cliente.split(" ")[0]}</span>}
                  <div className={cx("max-w-[85%] px-3 py-1.5 text-[14px] leading-snug whitespace-pre-wrap break-words rounded-2xl animate-fade",
                    m.r === "asesor" ? "bg-brand-ink text-white rounded-br-md" : "bg-white text-brand-ink rounded-bl-md")}>{m.t}</div>
                </div>
              );
            })}
            {estado === "responde_cliente" && (
              <div className="flex justify-start pt-1.5" aria-label="El cliente está escribiendo">
                <div className="bg-white rounded-2xl rounded-bl-md px-3 py-2.5 flex gap-1">
                  {[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-brand-mist grabando-punto" style={{ animationDelay: `${i * 0.18}s` }} />)}
                </div>
              </div>
            )}
          </div>
          {s.estado !== "en_curso" && (
            s.evaluacion ? <EvaluacionVista ev={s.evaluacion} criterios={criterios} />
              : <p className="text-sm text-brand-slate">{s.estado === "error" ? `No se pudo evaluar: ${s.error ?? ""}` : "La IA la está evaluando…"}</p>
          )}
          {error && <p className="text-[12px] text-brand-primary-dark">Sin conexión con el servidor: reintentando…</p>}
        </div>
      )}
    </Hoja>
  );
}
