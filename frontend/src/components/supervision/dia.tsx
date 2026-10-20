"use client";

/**
 * Coaching del día (gerente, sub gerente, coordinador y controller): cómo vienen los coachings de hoy de un vistazo
 * —firmados, en curso, sin firmar y seguimientos—, por supervisor, y la revisión del jefe (bien hecho / a mejorar con un
 * comentario que el supervisor ve en su portal). Pensado primero para el celular.
 */
import {
  CalendarClock, CircleCheck, ClipboardCheck, Clock3, Eye, Headphones, ListChecks, Mic, PenLine, RefreshCw,
  ThumbsUp, TriangleAlert, MessageSquareText,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { diaCorto, hoyPy } from "@/components/portal/coaching";
import { Boton, Cargando, Etiqueta, Fallo, Hoja, cx, hora, plural, useAviso } from "@/components/portal/ui";
import { fechaLarga } from "@/components/productividad/tipos";
import { apiFetch } from "@/lib/api";
import { VerCoachingDialog } from "./coaching";
import {
  SUP_API, TIPO_COACHING, dm, nombreMetricas, sumarDias,
  type CoachingDelDia, type CoachingDia, type RevisionJefe, type Valoracion,
} from "./tipos";

type Filtro = "todos" | "firmados" | "en_curso" | "sin_firmar" | "seguimientos" | "por_revisar";
const FILTROS: Record<Filtro, { label: string; pasa: (c: CoachingDia) => boolean }> = {
  todos: { label: "Todos", pasa: () => true },
  firmados: { label: "Firmados", pasa: (c) => c.estado_dia === "firmado" },
  en_curso: { label: "En curso", pasa: (c) => c.estado_dia === "en_curso" },
  sin_firmar: { label: "Sin firmar", pasa: (c) => c.estado === "pendiente" },
  seguimientos: { label: "Seguimientos", pasa: (c) => c.estado_dia === "seguimiento" || c.estado_dia === "seguimiento_pendiente" },
  por_revisar: { label: "Por revisar", pasa: (c) => c.estado_dia === "firmado" && !c.revision },
};
const REFRESCO_MS = 60_000;

function EstadoChip({ c }: { c: CoachingDia }) {
  if (c.estado_dia === "firmado") return <Etiqueta tono="verde" icono={PenLine}>Firmado {hora(c.firmado_at)}</Etiqueta>;
  if (c.estado === "pendiente") {
    return c.devolucion_vencida
      ? <Etiqueta tono="rojo" icono={TriangleAlert}>Sin firmar · venció {dm(c.vence_devolucion)}</Etiqueta>
      : <Etiqueta tono="naranja" icono={PenLine}>{c.estado_dia === "en_curso" ? "En curso" : "Sin firmar"} · hasta {dm(c.vence_devolucion)}</Etiqueta>;
  }
  if (c.estado_dia === "seguimiento") return <Etiqueta tono="azul" icono={ClipboardCheck}>Seguimiento registrado</Etiqueta>;
  if (c.seguimiento === "vencido") return <Etiqueta tono="rojo" icono={CalendarClock}>Seguimiento vencido · era {dm(c.seguimiento_fecha)}</Etiqueta>;
  if (c.estado_dia === "seguimiento_pendiente") return <Etiqueta tono="azul" icono={CalendarClock}>Seguimiento para hoy</Etiqueta>;
  return <Etiqueta>Con movimiento</Etiqueta>;
}

function RevisionChip({ r }: { r: RevisionJefe }) {
  return r.valoracion === "bien"
    ? <Etiqueta tono="verde" icono={ThumbsUp}>Bien hecho · {r.por.split(" ")[0]}</Etiqueta>
    : <Etiqueta tono="naranja" icono={TriangleAlert}>A mejorar · {r.por.split(" ")[0]}</Etiqueta>;
}

function Tarjeta({ c, onVer, onRevisar }: { c: CoachingDia; onVer: () => void; onRevisar: () => void }) {
  const cumplidos = c.cumplimiento.cumplido ?? 0;
  const total = Object.values(c.cumplimiento).reduce((a, b) => a + (b ?? 0), 0);
  return (
    <li className={cx("card p-4 min-w-0", c.devolucion_vencida || c.seguimiento === "vencido" ? "shadow-[inset_3px_0_0_#E6332A]" : "")}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <EstadoChip c={c} />
        {c.revision && <RevisionChip r={c.revision} />}
      </div>
      <h3 className="font-semibold text-[16px] text-brand-ink mt-2 leading-snug break-words">{c.operador}</h3>
      <p className="text-[13px] text-brand-slate">{c.supervisor} · {TIPO_COACHING[c.tipo].label} · {nombreMetricas(c.metricas)}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-brand-graphite">
        {c.monitoreos > 0 && <span className="inline-flex items-center gap-1"><Headphones size={13} aria-hidden /> {plural(c.monitoreos, "monitoreo", "monitoreos")}</span>}
        {c.feedback > 0 && <span className="inline-flex items-center gap-1"><MessageSquareText size={13} aria-hidden /> {plural(c.feedback, "feedback", "feedback")}</span>}
        <span className="inline-flex items-center gap-1"><ListChecks size={13} aria-hidden /> {plural(c.compromisos, "compromiso", "compromisos")}</span>
        {c.audios > 0 && <span className="inline-flex items-center gap-1"><Mic size={13} aria-hidden /> {plural(c.audios, "audio", "audios")}{c.voz_asesor ? " · voz del asesor" : ""}</span>}
        {c.minutos !== null && <span className="inline-flex items-center gap-1"><Clock3 size={13} aria-hidden /> ≈ {c.minutos} min</span>}
        {total > 0 && <span className="inline-flex items-center gap-1"><CircleCheck size={13} aria-hidden /> {cumplidos} de {total} cumplidos</span>}
      </div>
      {c.resumen && <p className="text-sm text-brand-ink mt-2 line-clamp-3 break-words">{c.resumen}</p>}
      {c.compromiso && <p className="text-[13px] text-brand-graphite mt-1 line-clamp-2 break-words"><b className="text-brand-slate font-semibold">Compromiso:</b> {c.compromiso}</p>}
      {c.revision?.comentario && (
        <p className="text-[13px] text-brand-graphite mt-2 rounded-md bg-brand-bg px-3 py-2 break-words">
          <b>{c.revision.por}:</b> {c.revision.comentario}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 mt-3">
        <button type="button" onClick={onVer} className="btn min-h-[44px] bg-white border border-brand-border text-brand-ink hover:border-brand-ink text-sm">
          <Eye size={16} aria-hidden /> Ver
        </button>
        <button type="button" onClick={onRevisar} className="btn min-h-[44px] bg-brand-ink text-white hover:bg-brand-graphite text-sm">
          <ThumbsUp size={16} aria-hidden /> {c.revision ? "Revisar de nuevo" : "Revisar"}
        </button>
      </div>
    </li>
  );
}

function HojaRevision({ c, onClose, onGuardada }: { c: CoachingDia; onClose: () => void; onGuardada: (r: RevisionJefe) => void }) {
  const [valoracion, setValoracion] = useState<Valoracion | null>(null);
  const [comentario, setComentario] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listo = valoracion === "bien" || (valoracion === "mejorar" && comentario.trim().length >= 5);
  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try {
      onGuardada(await apiFetch<RevisionJefe>(`${SUP_API}/control/coaching/${c.id}/revision`, {
        method: "POST", body: JSON.stringify({ valoracion, comentario: comentario.trim() || null }),
      }));
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  const opcion = (v: Valoracion, titulo: string, sub: string, I: typeof ThumbsUp, tono: string) => (
    <button type="button" onClick={() => setValoracion(v)} aria-pressed={valoracion === v}
      className={cx("min-h-[72px] rounded-lg border-2 px-3 py-2 text-left", valoracion === v ? tono : "border-brand-border")}>
      <span className="flex items-center gap-2 font-semibold text-brand-ink"><I size={18} aria-hidden /> {titulo}</span>
      <span className="block text-xs text-brand-slate mt-0.5">{sub}</span>
    </button>
  );
  return (
    <Hoja sobre={`${c.operador} · ${c.supervisor}`} titulo="Revisar el coaching" onClose={onClose} ocupada={ocupado}
      pie={<Boton onClick={guardar} disabled={!listo} ocupado={ocupado}>Guardar revisión</Boton>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {opcion("bien", "Bien hecho", "Lo hizo como se espera", ThumbsUp, "border-emerald-500 bg-emerald-50")}
          {opcion("mejorar", "A mejorar", "Decile qué cambiar", TriangleAlert, "border-brand-orange bg-brand-orange/10")}
        </div>
        <div>
          <label className="label" htmlFor="rev">{valoracion === "mejorar" ? "Qué tiene que mejorar" : "Comentario (opcional)"}</label>
          <textarea id="rev" className="input !text-base min-h-[110px]" maxLength={1000} value={comentario} onChange={(e) => setComentario(e.target.value)}
            placeholder="Ej.: El compromiso no tiene fecha ni la métrica que tiene que mover." />
          <p className="text-[11px] text-brand-slate mt-1">El supervisor lo ve en su portal. No cambia lo firmado: queda en el historial del coaching.</p>
        </div>
        {error && <Fallo>{error}</Fallo>}
      </div>
    </Hoja>
  );
}

export function CoachingDelDiaVista() {
  const hoy = hoyPy();
  const [fecha, setFecha] = useState(hoy);
  const [d, setD] = useState<CoachingDelDia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [sup, setSup] = useState<string | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [revisar, setRevisar] = useState<CoachingDia | null>(null);
  const [aviso, avisar] = useAviso();

  const cargar = useCallback(async (f: string, quieto = false) => {
    if (!quieto) setCargando(true);
    setError(null);
    try { setD(await apiFetch<CoachingDelDia>(`${SUP_API}/control/dia?fecha=${f}`)); } catch (e: any) { setError(e.message); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar(fecha); }, [fecha, cargar]);
  useEffect(() => {
    if (fecha !== hoy) return;
    const t = window.setInterval(() => { if (document.visibilityState === "visible") cargar(fecha, true); }, REFRESCO_MS);
    return () => window.clearInterval(t);
  }, [fecha, hoy, cargar]);

  const lista = useMemo(() => (d?.coachings ?? []).filter((c) => FILTROS[filtro].pasa(c) && (!sup || c.supervisor_id === sup)), [d, filtro, sup]);
  const k = d?.kpis;
  const dias = [{ f: hoy, l: "Hoy" }, { f: sumarDias(hoy, -1), l: "Ayer" }, { f: sumarDias(hoy, -2), l: diaCorto(sumarDias(hoy, -2), hoy) }];
  const tile = (f: Filtro, titulo: string, valor: number | string, sub: string, alerta = false) => (
    <button type="button" onClick={() => setFiltro(filtro === f ? "todos" : f)} aria-pressed={filtro === f}
      className={cx("card p-3.5 text-left min-w-0", filtro === f && "ring-2 ring-brand-ink", alerta && "shadow-[inset_3px_0_0_#E6332A]")}>
      <div className="text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate truncate">{titulo}</div>
      <div className="font-display text-[34px] leading-none tabular-nums text-brand-ink mt-1">{valor}</div>
      <div className={cx("text-xs mt-1 leading-snug", alerta ? "text-brand-primary-dark font-semibold" : "text-brand-slate")}>{sub}</div>
    </button>
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4 flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-1">Supervisión · {fechaLarga(fecha)}</div>
          <h1 className="font-display text-[34px] sm:text-4xl uppercase text-brand-ink leading-tight">Coaching del día</h1>
          <p className="text-sm text-brand-slate mt-1 max-w-2xl">Lo que firmaron, lo que está en curso o sin firmar y los seguimientos. Revisá cada coaching: el supervisor ve tu devolución.</p>
        </div>
        <button type="button" onClick={() => cargar(fecha)} disabled={cargando} className="btn-secondary !py-2 !px-4 min-h-[44px]">
          <RefreshCw size={15} className={cargando ? "animate-spin" : ""} aria-hidden /> {d ? hora(d.actualizado) : "Actualizar"}
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 mb-4" role="group" aria-label="Día">
        {dias.map(({ f, l }) => (
          <button key={f} type="button" onClick={() => setFecha(f)} aria-pressed={fecha === f}
            className={cx("min-h-[44px] px-4 rounded-full border text-sm font-semibold whitespace-nowrap shrink-0",
              fecha === f ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-graphite border-brand-border")}>{l}</button>
        ))}
        <input type="date" className="input !w-auto !min-h-[44px] shrink-0" value={fecha} max={hoy} onChange={(e) => e.target.value && setFecha(e.target.value)} aria-label="Elegir día" />
      </div>
      {error && <Fallo onReintentar={() => cargar(fecha)}>{error}</Fallo>}
      {!d || !k ? (!error && <Cargando filas={5} />) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {tile("firmados", "Firmados", k.firmados, k.minutos_prom !== null ? `≈ ${k.minutos_prom} min cada uno` : "en el día")}
            {tile("en_curso", "En curso", k.en_curso, "sin firmar, con movimiento")}
            {tile("sin_firmar", "Sin firmar", k.sin_firmar, k.sin_firmar_vencidos ? `${k.sin_firmar_vencidos} vencidas` : "esperan la devolución", k.sin_firmar_vencidos > 0)}
            {tile("seguimientos", "Seguimientos", k.seguimientos, `${k.seguimientos_pendientes} pendientes`)}
            {tile("seguimientos", "Seg. vencidos", k.seguimientos_vencidos, "pasó la fecha acordada", k.seguimientos_vencidos > 0)}
            {tile("por_revisar", "Por revisar", k.por_revisar, `${k.revisados} revisados`)}
          </div>

          {d.supervisores.length > 0 && (
            <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" role="group" aria-label="Supervisores">
              {d.supervisores.map((s) => (
                <button key={s.id} type="button" onClick={() => setSup(sup === s.id ? null : s.id)} aria-pressed={sup === s.id}
                  className={cx("shrink-0 rounded-lg border px-3 py-2 text-left min-w-[150px]", sup === s.id ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border bg-white")}>
                  <div className="text-sm font-semibold truncate max-w-[170px]">{s.nombre}</div>
                  <div className={cx("text-[11px] tabular-nums", sup === s.id ? "text-white/70" : "text-brand-slate")}>
                    {s.firmados} firmados · {s.en_curso} en curso{s.vencidas ? ` · ${s.vencidas} vencidas` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" role="tablist" aria-label="Filtrar">
            {(Object.keys(FILTROS) as Filtro[]).map((f) => {
              const n = (d.coachings ?? []).filter((c) => FILTROS[f].pasa(c) && (!sup || c.supervisor_id === sup)).length;
              return (
                <button key={f} type="button" role="tab" aria-selected={filtro === f} onClick={() => setFiltro(f)}
                  className={cx("min-h-[40px] px-3.5 rounded-full border text-sm font-semibold whitespace-nowrap shrink-0",
                    filtro === f ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-graphite border-brand-border")}>
                  {FILTROS[f].label} <span className={filtro === f ? "text-white/70" : "text-brand-slate"}>{n}</span>
                </button>
              );
            })}
          </div>

          {!lista.length ? (
            <p className="card p-6 text-center text-sm text-brand-slate">
              {d.coachings.length ? "Nada en este grupo." : fecha === hoy ? "Todavía no hay coachings hoy." : "No hubo coachings ese día."}
            </p>
          ) : (
            <ul className="grid md:grid-cols-2 gap-3">
              {lista.map((c) => <Tarjeta key={c.id} c={c} onVer={() => setVer(c.id)} onRevisar={() => setRevisar(c)} />)}
            </ul>
          )}
        </div>
      )}
      {ver && <VerCoachingDialog id={ver} onClose={() => setVer(null)} />}
      {revisar && (
        <HojaRevision c={revisar} onClose={() => setRevisar(null)} onGuardada={(r) => {
          setD((x) => x && ({
            ...x, coachings: x.coachings.map((c) => (c.id === revisar.id ? { ...c, revision: r, revisiones: c.revisiones + 1 } : c)),
            kpis: { ...x.kpis, por_revisar: Math.max(0, x.kpis.por_revisar - (revisar.estado_dia === "firmado" && !revisar.revision ? 1 : 0)),
              revisados: x.kpis.revisados + (revisar.estado_dia === "firmado" && !revisar.revision ? 1 : 0) },
          }));
          setRevisar(null);
          avisar(r.valoracion === "bien" ? "Revisión guardada: bien hecho." : "Revisión guardada: el supervisor ve qué mejorar.");
        }} />
      )}
      {aviso}
    </div>
  );
}
