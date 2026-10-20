"use client";

import { NotebookPen, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import {
  SUP_API, TIPO_NOTA, sumarDias,
  type MetricaCoaching, type MiembroCoaching, type NotaBitacora, type TipoCoaching,
  type TipoNota, type VistaCoachingData,
} from "./tipos";

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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
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

export function Campo({ label, ayuda, children, htmlFor }: { label: string; ayuda?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {ayuda && <div className="text-[11px] text-brand-slate mt-1 leading-snug">{ayuda}</div>}
    </div>
  );
}

export function AreaTexto({ id, valor, onChange, min, max, placeholder, filas = 3 }: {
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

export function ErrorMsg({ msg }: { msg: string | null }) {
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

// ------------------------------------------------------------------ coaching nuevo desde una alerta o un asesor
export interface Inicial { operador_id?: string; metricas?: MetricaCoaching[]; tipo?: TipoCoaching; anterior_id?: string }

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
