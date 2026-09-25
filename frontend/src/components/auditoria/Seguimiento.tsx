"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { AUD_API, fechaHora, type AuditoriaDetalle } from "./tipos";

const TIPO_CLS: Record<string, string> = { nota: "bg-brand-cyan", estado: "bg-brand-ink", hallazgo: "bg-brand-orange" };
const TIPO_LABEL: Record<string, string> = { nota: "Nota", estado: "Estado", hallazgo: "Hallazgo" };

/** Bitácora del informe: notas del auditor, cambios de estado y de hallazgos, en orden cronológico inverso. */
export function Seguimiento({ a, onChange }: { a: AuditoriaDetalle; onChange: () => Promise<void> }) {
  const [texto, setTexto] = useState("");
  const [hallazgoId, setHallazgoId] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nombre = (id: string | null) => (id && a.usuarios[id]) || "—";
  const hallazgo = (id: string | null) => a.hallazgos.find((h) => h.id === id);

  const agregar = async () => {
    setOcupado(true);
    setError(null);
    try {
      await apiFetch(`${AUD_API}/informes/${a.id}/seguimientos`, { method: "POST", body: JSON.stringify({ texto, hallazgo_id: hallazgoId || null }) });
      setTexto("");
      setHallazgoId("");
      await onChange();
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-3">
        {a.con_seguimiento ? (
          <div className="card p-4 space-y-2 no-print">
            <label className="label">Nueva nota de seguimiento</label>
            <textarea className="input min-h-[80px]" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Qué se hizo, con quién se habló, qué queda pendiente…" />
            <div className="flex items-center gap-2 flex-wrap">
              <select className="input max-w-xs" value={hallazgoId} onChange={(e) => setHallazgoId(e.target.value)}>
                <option value="">Sin hallazgo asociado</option>
                {a.hallazgos.map((h) => <option key={h.id} value={h.id}>{h.codigo} · {h.titulo.slice(0, 60)}</option>)}
              </select>
              <button onClick={agregar} disabled={ocupado || texto.trim().length === 0} className="btn-primary ml-auto">{ocupado ? "Guardando…" : "Agregar nota"}</button>
            </div>
            {error && <div className="text-sm text-brand-primary">{error}</div>}
          </div>
        ) : (
          <div className="card p-4 text-sm text-brand-slate">Informe archivado: la bitácora es de solo lectura.</div>
        )}
        <ol className="relative border-l-2 border-brand-border ml-3 space-y-4 pt-2">
          {a.seguimientos.map((s) => {
            const h = hallazgo(s.hallazgo_id);
            return (
              <li key={s.id} className="ml-5">
                <span className={`absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full ring-4 ring-brand-bg ${TIPO_CLS[s.tipo] ?? "bg-brand-mist"}`} />
                <div className="text-[11px] text-brand-slate flex items-center gap-2 flex-wrap">
                  <span className="font-semibold uppercase tracking-wider2">{TIPO_LABEL[s.tipo] ?? s.tipo}</span>
                  <span>{fechaHora(s.created_at)}</span>
                  <span>· {nombre(s.created_by)}</span>
                  {h && <span className="badge-neutral">{h.codigo}</span>}
                </div>
                <p className="text-sm text-brand-graphite mt-0.5 whitespace-pre-line">{s.texto}</p>
              </li>
            );
          })}
          {a.seguimientos.length === 0 && <li className="ml-5 text-sm text-brand-mist">Sin movimientos todavía.</li>}
        </ol>
      </div>
      <div className="space-y-4">
        <div className="card p-4">
          <h3 className="font-display text-lg text-brand-ink uppercase mb-2">Historial de estados</h3>
          <ul className="space-y-2 text-sm">
            {[...a.historial].reverse().map((h, i) => (
              <li key={i} className="border-b border-brand-border/60 pb-2 last:border-0">
                <div className="text-[11px] text-brand-slate">{fechaHora(h.fecha)} · {nombre(h.usuario)}</div>
                <div className="text-brand-graphite"><b className="capitalize">{h.accion}</b>{h.detalle ? `: ${h.detalle}` : ""}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="card p-4 text-xs text-brand-slate space-y-1">
          <div>Creado por <b className="text-brand-ink">{nombre(a.created_by)}</b> el {fechaHora(a.created_at)}</div>
          {a.updated_at && <div>Última modificación: {nombre(a.updated_by)} · {fechaHora(a.updated_at)}</div>}
          {a.closed_at && <div>Cerrado por <b className="text-brand-ink">{nombre(a.closed_by)}</b> el {fechaHora(a.closed_at)}</div>}
        </div>
      </div>
    </div>
  );
}
