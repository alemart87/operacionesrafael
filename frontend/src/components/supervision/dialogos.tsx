"use client";

import { Ban, CalendarClock, ClipboardCheck, MessageSquarePlus, NotebookPen, Plus, Save, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fechaCorta } from "@/components/productividad/tipos";
import { apiFetch } from "@/lib/api";
import { ImpactoVista } from "./impacto";
import {
  METRICA, SUP_API, TIPO_COACHING, TIPO_NOTA, diasEntre, dm, num, sumarDias,
  type Coaching, type CoachingDetalle, type MetricaCoaching, type MiembroCoaching, type NotaBitacora, type TipoCoaching,
  type TipoNota, type VistaCoachingData,
} from "./tipos";

const TIPOS: TipoCoaching[] = ["diario", "semanal", "mensual"];
const METRICAS: MetricaCoaching[] = ["pospago", "gpon", "uso", "conversacion", "otra"];
const TIPOS_NOTA: TipoNota[] = ["novedad", "ausencia", "incidencia", "reconocimiento", "otro"];

// ------------------------------------------------------------------ marco de los diálogos
export function Modal({ titulo, sobre, onClose, children, pie, ancho = "max-w-xl", acento = "bg-brand-cyan" }: {
  titulo: ReactNode; sobre?: ReactNode; onClose: () => void; children: ReactNode; pie?: ReactNode; ancho?: string; acento?: string;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-[2px] animate-fade" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={typeof titulo === "string" ? titulo : undefined}
        className={`relative w-full ${ancho} card shadow-elevated max-h-[92vh] flex flex-col animate-pop`}>
        <div className={`h-1.5 ${acento} rounded-t-lg`} />
        <div className="px-5 py-4 border-b border-brand-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            {sobre && <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">{sobre}</div>}
            <h2 className="font-display text-2xl text-brand-ink uppercase leading-tight break-words">{titulo}</h2>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost -mr-2" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1 min-h-0">{children}</div>
        {pie && <div className="px-5 py-3.5 border-t border-brand-border flex flex-wrap justify-end gap-2">{pie}</div>}
      </div>
    </div>
  );
}

function Campo({ label, ayuda, children, htmlFor }: { label: string; ayuda?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {ayuda && <div className="text-[11px] text-brand-slate mt-1 leading-snug">{ayuda}</div>}
    </div>
  );
}

function AreaTexto({ id, valor, onChange, min, max, placeholder, filas = 3 }: {
  id: string; valor: string; onChange: (v: string) => void; min: number; max: number; placeholder?: string; filas?: number;
}) {
  const largo = valor.trim().length;
  return (
    <>
      <textarea id={id} className="input resize-y leading-relaxed" rows={filas} maxLength={max} placeholder={placeholder}
        value={valor} onChange={(e) => onChange(e.target.value)} />
      <div className={`text-[10px] text-right mt-0.5 tabular-nums ${largo && largo < min ? "text-[#8A5200]" : "text-brand-mist"}`}>
        {largo < min ? `${min - largo} caracteres más como mínimo` : `${largo} / ${max}`}
      </div>
    </>
  );
}

function ErrorMsg({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <p role="alert" className="text-sm text-brand-primary-dark bg-brand-primary-light/60 border border-brand-primary/20 rounded-md px-3 py-2 mt-3">{msg}</p>;
}

/** El primer día que se puede registrar: el del mes en curso, o hasta 2 días atrás si el mes recién empieza. */
function minimoRegistro(hoy: string, dias: number): string {
  const atras = sumarDias(hoy, -dias);
  const primero = `${hoy.slice(0, 7)}-01`;
  return atras < primero ? atras : primero;
}

function enEquipo(m: MiembroCoaching, fecha: string): boolean {
  return m.tramos.some((t) => t.desde <= fecha && fecha <= t.hasta);
}

function metricaSugerida(m: MiembroCoaching | undefined): MetricaCoaching | null {
  if (!m) return null;
  if (m.uso?.alerta) return "uso";
  if (m.conversacion?.roja) return "conversacion";
  return null;
}

// ------------------------------------------------------------------ registrar o corregir un coaching
export interface Inicial { operador_id?: string; metrica?: MetricaCoaching; tipo?: TipoCoaching; anterior_id?: string }

export function CoachingDialog({ vista, inicial, editar, onClose, onGuardado }: {
  vista: VistaCoachingData; inicial?: Inicial; editar?: Coaching; onClose: () => void; onGuardado: (c: CoachingDetalle) => void;
}) {
  const r = vista.reglas;
  const hoy = vista.hoy;
  const [operador, setOperador] = useState(editar?.operador_id ?? inicial?.operador_id ?? "");
  const [fecha, setFecha] = useState(editar?.fecha ?? hoy);
  const [tipo, setTipo] = useState<TipoCoaching>(editar?.tipo ?? inicial?.tipo ?? "semanal");
  const miembro = vista.equipo.find((m) => m.id === operador);
  const [metrica, setMetrica] = useState<MetricaCoaching>(editar?.metrica ?? inicial?.metrica ?? metricaSugerida(miembro) ?? "pospago");
  const [metricaTocada, setMetricaTocada] = useState(!!(editar || inicial?.metrica));
  const [diagnostico, setDiagnostico] = useState(editar?.diagnostico ?? "");
  const [compromiso, setCompromiso] = useState(editar?.compromiso ?? "");
  const sugerido = (t: TipoCoaching, f: string) => {
    const s = sumarDias(f, r.seguimiento_sugerido[t]);
    return s < hoy ? hoy : s;
  };
  const [seguimiento, setSeguimiento] = useState(editar?.seguimiento_fecha ?? sugerido(tipo, fecha));
  const [segTocado, setSegTocado] = useState(!!editar);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disponibles = useMemo(() => vista.equipo.filter((m) => enEquipo(m, fecha)), [vista.equipo, fecha]);
  useEffect(() => { if (!segTocado) setSeguimiento(sugerido(tipo, fecha)); }, [tipo, fecha]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const s = metricaSugerida(miembro);
    if (!metricaTocada && s) setMetrica(s);
  }, [operador]); // eslint-disable-line react-hooks/exhaustive-deps

  const atraso = diasEntre(fecha, hoy);
  const segMax = sumarDias(fecha, r.dias_seguimiento_max);
  const segMin = sumarDias(fecha, 1) > hoy ? sumarDias(fecha, 1) : hoy;
  const segIgual = !!editar && seguimiento === editar.seguimiento_fecha;
  const listo = !!operador && diagnostico.trim().length >= r.min_texto && compromiso.trim().length >= r.min_texto
    && (segIgual || (seguimiento >= segMin && seguimiento <= segMax));
  const sugerida = metricaSugerida(miembro);

  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const cambios = editar && Object.fromEntries(Object.entries({ tipo, metrica, diagnostico, compromiso, seguimiento_fecha: seguimiento })
        .filter(([k, v]) => (editar as any)[k] !== v));
      const c = editar
        ? await apiFetch<CoachingDetalle>(`${SUP_API}/portal/coaching/${editar.id}`, { method: "PATCH", body: JSON.stringify(cambios) })
        : await apiFetch<CoachingDetalle>(`${SUP_API}/portal/coaching`, {
          method: "POST",
          body: JSON.stringify({ operador_id: operador, fecha, tipo, metrica, diagnostico, compromiso, seguimiento_fecha: seguimiento,
            anterior_id: inicial?.anterior_id ?? null }),
        });
      onGuardado(c);
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };

  return (
    <Modal onClose={onClose} ancho="max-w-2xl" sobre={editar ? `Corregir · se puede durante ${r.horas_edicion} h` : inicial?.anterior_id ? "Nuevo coaching sobre la misma métrica" : "Registrar coaching"}
      titulo={editar ? editar.operador : miembro?.nombre ?? "Coaching"}
      pie={<>
        <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={!listo || ocupado} onClick={guardar}>
          {editar ? <Save size={15} /> : <Plus size={15} />} {ocupado ? "Guardando…" : editar ? "Guardar cambios" : "Registrar coaching"}
        </button>
      </>}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-[1fr_180px] gap-3">
          <Campo label="Asesor" htmlFor="c-asesor"
            ayuda={editar ? "El asesor y la fecha no se cambian: si están mal, anulalo y registralo de nuevo." : "Los asesores que tenías en tu equipo ese día."}>
            {editar ? (
              <div className="input bg-brand-bg-soft text-brand-graphite">{editar.operador}</div>
            ) : (
              <select id="c-asesor" className="input" value={operador} onChange={(e) => setOperador(e.target.value)} autoFocus>
                <option value="">Elegí un asesor…</option>
                {disponibles.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}{m.uso?.alerta ? ` · en alerta (${num(m.uso.pct_sin_uso)}% sin uso)` : ""}{m.conversacion?.roja ? " · conversación en rojo" : ""}{!m.coachings ? " · sin coaching este mes" : ""}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Campo label="Fecha del coaching" htmlFor="c-fecha">
            {editar ? (
              <div className="input bg-brand-bg-soft text-brand-graphite tabular-nums">{fechaCorta(editar.fecha)}</div>
            ) : (
              <input id="c-fecha" type="date" className="input tabular-nums" value={fecha} min={minimoRegistro(hoy, r.dias_termino)} max={hoy}
                onChange={(e) => e.target.value && setFecha(e.target.value)} />
            )}
          </Campo>
        </div>
        {!editar && atraso > r.dias_termino && (
          <p className="flex items-start gap-2 text-xs text-[#8A5200] bg-brand-orange/10 border border-brand-orange/30 rounded-md px-3 py-2">
            <TriangleAlert size={14} className="shrink-0 mt-0.5" aria-hidden />
            Más de 48 h de atraso: se registra y cuenta igual, pero queda marcado «fuera de término».
          </p>
        )}

        <Campo label="Tipo">
          <div role="radiogroup" aria-label="Tipo de coaching" className="grid sm:grid-cols-3 gap-2">
            {TIPOS.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={tipo === t} onClick={() => setTipo(t)}
                className={`text-left rounded-md border px-3 py-2 transition-colors ${tipo === t ? "border-brand-primary bg-brand-primary-light/60" : "border-brand-border hover:border-brand-slate"}`}>
                <div className="text-sm font-semibold text-brand-ink">{TIPO_COACHING[t].label}</div>
                <div className="text-[11px] text-brand-slate leading-snug mt-0.5">{TIPO_COACHING[t].ayuda}</div>
              </button>
            ))}
          </div>
        </Campo>

        <Campo label="Métrica que se trabajó" ayuda={<>{METRICA[metrica].ayuda}.</>}>
          <div role="radiogroup" aria-label="Métrica" className="flex flex-wrap gap-1.5">
            {METRICAS.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={metrica === m} onClick={() => { setMetrica(m); setMetricaTocada(true); }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${metrica === m ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border text-brand-graphite hover:border-brand-slate"}`}>
                {METRICA[m].label}
                {sugerida === m && <span className={`text-[9px] uppercase tracking-wider2 ${metrica === m ? "text-white/80" : "text-brand-primary-dark"}`}>{m === "uso" ? "en alerta" : "en rojo"}</span>}
              </button>
            ))}
          </div>
        </Campo>

        <Campo label="Diagnóstico" htmlFor="c-diag" ayuda="Qué dato miraste y qué práctica observaste (en la llamada, en las líneas o en los números).">
          <AreaTexto id="c-diag" valor={diagnostico} onChange={setDiagnostico} min={r.min_texto} max={r.max_texto}
            placeholder="Ej.: 3 de sus 8 líneas de la semana sin uso; en la escucha no confirma que el cliente va a usar la línea." />
        </Campo>
        <Campo label="Compromiso" htmlFor="c-comp" ayuda="Qué se compromete a hacer el asesor, concreto y medible.">
          <AreaTexto id="c-comp" valor={compromiso} onChange={setCompromiso} min={r.min_texto} max={r.max_texto}
            placeholder="Ej.: confirmar en cada venta el uso de la línea y avisar el mismo día si el cliente duda." />
        </Campo>

        <Campo label="Fecha de seguimiento" htmlFor="c-seg"
          ayuda={<>Sugerido para un coaching {TIPO_COACHING[tipo].label.toLowerCase()}: {r.seguimiento_sugerido[tipo]} días. Ese día registrás el
            seguimiento y el sistema mide el impacto; hasta {r.dias_seguimiento_max} días después del coaching.</>}>
          <div className="flex items-center gap-2 flex-wrap">
            <input id="c-seg" type="date" className="input tabular-nums max-w-[200px]" value={seguimiento} min={segMin} max={segMax}
              onChange={(e) => { if (e.target.value) { setSeguimiento(e.target.value); setSegTocado(true); } }} />
            <span className="text-xs text-brand-slate inline-flex items-center gap-1"><CalendarClock size={13} aria-hidden /> {fechaCorta(seguimiento)}</span>
          </div>
        </Campo>
        <ErrorMsg msg={error} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ seguimiento con el impacto medido
export function SeguimientoDialog({ c, vista, onClose, onGuardado, onNuevo }: {
  c: Coaching; vista: VistaCoachingData; onClose: () => void; onGuardado: (c: CoachingDetalle) => void; onNuevo: (c: Coaching) => void;
}) {
  const [comentario, setComentario] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<CoachingDetalle | null>(null);
  const r = vista.reglas;
  const temprano = vista.hoy <= c.fecha;

  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const x = await apiFetch<CoachingDetalle>(`${SUP_API}/portal/coaching/${c.id}/seguimiento`, { method: "POST", body: JSON.stringify({ comentario }) });
      setHecho(x);
      onGuardado(x);
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };

  if (hecho) {
    const mejoro = hecho.resultado === "mejoro";
    return (
      <Modal onClose={onClose} sobre="Seguimiento registrado" titulo={hecho.operador} acento={mejoro ? "bg-emerald-500" : "bg-brand-cyan"}
        pie={<>
          {!mejoro && (
            <button type="button" className="btn-secondary" onClick={() => onNuevo(hecho)}>
              <Plus size={15} /> Nuevo coaching sobre {METRICA[hecho.metrica].label.toLowerCase()}
            </button>
          )}
          <button type="button" className="btn-primary" onClick={onClose}>Listo</button>
        </>}>
        <ImpactoVista i={hecho.impacto} />
        {!mejoro && (
          <p className="text-xs text-brand-slate mt-4 leading-relaxed">
            Si el dato no mejoró, el modelo pide volver a observar y registrar un nuevo coaching sobre la misma métrica, con un
            compromiso nuevo.
          </p>
        )}
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} sobre={`Seguimiento · acordado para el ${dm(c.seguimiento_fecha)}`} titulo={c.operador}
      pie={<>
        <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={temprano || ocupado || comentario.trim().length < r.min_texto} onClick={guardar}>
          <ClipboardCheck size={15} /> {ocupado ? "Registrando…" : "Registrar seguimiento"}
        </button>
      </>}>
      <div className="space-y-4">
        <div className="rounded-md bg-brand-bg-soft border border-brand-border px-3.5 py-3">
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Compromiso del {dm(c.fecha)} · {METRICA[c.metrica].label}</div>
          <p className="text-sm text-brand-ink mt-1 whitespace-pre-line">{c.compromiso}</p>
        </div>
        <div>
          <div className="label">Impacto medido hasta hoy</div>
          <ImpactoVista i={c.impacto} />
          <p className="text-[11px] text-brand-slate mt-2">Al registrar, el sistema guarda esta medición con el seguimiento y calcula el resultado.</p>
        </div>
        <Campo label="Comentario del seguimiento" htmlFor="s-com" ayuda="Qué viste: si cumplió el compromiso y qué sigue.">
          <AreaTexto id="s-com" valor={comentario} onChange={setComentario} min={r.min_texto} max={r.max_texto} filas={4}
            placeholder="Ej.: cumple el chequeo de uso en todas las ventas que escuché; las líneas nuevas ya se usan." />
        </Campo>
        {temprano && <p className="text-xs text-[#8A5200]">El seguimiento se registra desde el día siguiente al coaching.</p>}
        <ErrorMsg msg={error} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ anular y aclarar
export function TextoDialog({ titulo, sobre, label, ayuda, placeholder, min, max, accion, peligro, url, campo, onClose, onGuardado }: {
  titulo: string; sobre: string; label: string; ayuda?: string; placeholder?: string; min: number; max: number; accion: string;
  peligro?: boolean; url: string; campo: string; onClose: () => void; onGuardado: (c: CoachingDetalle) => void;
}) {
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enviar = async () => {
    setOcupado(true);
    setError(null);
    try { onGuardado(await apiFetch<CoachingDetalle>(url, { method: "POST", body: JSON.stringify({ [campo]: texto }) })); }
    catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <Modal onClose={onClose} sobre={sobre} titulo={titulo} acento={peligro ? "bg-brand-primary" : "bg-brand-cyan"}
      pie={<>
        <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button type="button" className={peligro ? "btn-danger" : "btn-primary"} disabled={ocupado || texto.trim().length < min} onClick={enviar}>
          {peligro ? <Ban size={15} /> : <MessageSquarePlus size={15} />} {ocupado ? "Guardando…" : accion}
        </button>
      </>}>
      <Campo label={label} htmlFor="t-texto" ayuda={ayuda}>
        <AreaTexto id="t-texto" valor={texto} onChange={setTexto} min={min} max={max} placeholder={placeholder} />
      </Campo>
      <ErrorMsg msg={error} />
    </Modal>
  );
}

// ------------------------------------------------------------------ nota de bitácora
export function NotaDialog({ vista, onClose, onGuardado }: { vista: VistaCoachingData; onClose: () => void; onGuardado: (n: NotaBitacora) => void }) {
  const r = vista.reglas;
  const [fecha, setFecha] = useState(vista.hoy);
  const [tipo, setTipo] = useState<TipoNota>("novedad");
  const [operador, setOperador] = useState("");
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disponibles = vista.equipo.filter((m) => enEquipo(m, fecha));
  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try {
      onGuardado(await apiFetch<NotaBitacora>(`${SUP_API}/portal/bitacora`, {
        method: "POST", body: JSON.stringify({ fecha, tipo, texto, operador_id: operador || null }),
      }));
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <Modal onClose={onClose} sobre="Bitácora" titulo="Nueva nota"
      pie={<>
        <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={ocupado || texto.trim().length < 5} onClick={guardar}>
          <NotebookPen size={15} /> {ocupado ? "Guardando…" : "Guardar nota"}
        </button>
      </>}>
      <div className="space-y-4">
        <Campo label="Tipo">
          <div role="radiogroup" aria-label="Tipo de nota" className="flex flex-wrap gap-1.5">
            {TIPOS_NOTA.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={tipo === t} onClick={() => setTipo(t)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${tipo === t ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border text-brand-graphite hover:border-brand-slate"}`}>
                {TIPO_NOTA[t].label}
              </button>
            ))}
          </div>
        </Campo>
        <div className="grid sm:grid-cols-[180px_1fr] gap-3">
          <Campo label="Fecha" htmlFor="n-fecha">
            <input id="n-fecha" type="date" className="input tabular-nums" value={fecha} min={minimoRegistro(vista.hoy, r.dias_termino)} max={vista.hoy}
              onChange={(e) => e.target.value && setFecha(e.target.value)} />
          </Campo>
          <Campo label="Asesor (opcional)" htmlFor="n-asesor">
            <select id="n-asesor" className="input" value={operador} onChange={(e) => setOperador(e.target.value)}>
              <option value="">Del equipo en general</option>
              {disponibles.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>
          </Campo>
        </div>
        <Campo label="Nota" htmlFor="n-texto" ayuda="Las notas no se editan ni se borran: si algo cambió, agregá otra.">
          <AreaTexto id="n-texto" valor={texto} onChange={setTexto} min={5} max={r.max_texto} filas={4}
            placeholder="Ej.: corte de sistema de 10 a 11 h; el equipo pasó a llamadas manuales." />
        </Campo>
        <ErrorMsg msg={error} />
      </div>
    </Modal>
  );
}
