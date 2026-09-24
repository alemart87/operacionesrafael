"use client";

import { useState } from "react";

/** Notas y comentarios sobre la simulación (zona de trabajo): tipificadas, con autor y
 *  fecha, opcionalmente referidas a un mes. Se guardan con la simulación. */

export type Nota = {
  id?: string; texto: string; tipo: string; mes?: number | null;
  autor?: string; fecha?: string; editada_por?: string | null; editada_el?: string | null;
};

export const TIPOS_NOTA: Record<string, { label: string; cls: string; punto: string; ayuda: string }> = {
  supuesto: { label: "Supuesto", cls: "bg-sky-100 text-sky-800 border-sky-300", punto: "#0EA5E9", ayuda: "qué se asumió para armar el escenario" },
  observacion: { label: "Observación", cls: "bg-brand-bg text-brand-graphite border-brand-border", punto: "#5B6275", ayuda: "algo que se ve en los números" },
  decision: { label: "Decisión", cls: "bg-emerald-100 text-emerald-800 border-emerald-300", punto: "#10B981", ayuda: "qué se decidió a partir de esto" },
  pendiente: { label: "Pendiente", cls: "bg-amber-100 text-amber-800 border-amber-300", punto: "#F59E0B", ayuda: "qué falta confirmar o revisar" },
  riesgo: { label: "Riesgo", cls: "bg-brand-primary/10 text-brand-primary border-brand-primary/30", punto: "#E6332A", ayuda: "qué puede salir distinto" },
};

const fecha = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("es-PY") : "");

export function NotasSimulacion({ notas, setNotas, nombres, guardaSola, compacto, soloImpresion }: {
  notas: Nota[]; setNotas: (n: Nota[]) => void;
  nombres: string[];                 // nombre de cada mes (índice 0 = mes 1)
  guardaSola: boolean;               // hay simulación guardada abierta: las notas se persisten solas
  compacto?: boolean;                // versión para la barra lateral (sin card ni título)
  soloImpresion?: boolean;           // solo sale en el PDF (el lienzo no la muestra en pantalla)
}) {
  const [texto, setTexto] = useState("");
  const [tipo, setTipo] = useState("observacion");
  const [mes, setMes] = useState("");
  const [filtro, setFiltro] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTexto, setEditTexto] = useState("");

  const agregar = () => {
    if (!texto.trim()) return;
    setNotas([...notas, { texto: texto.trim(), tipo, mes: mes ? Number(mes) : null }]);
    setTexto(""); setMes("");
  };
  const quitar = (i: number) => {
    if (!window.confirm("¿Eliminar esta nota?")) return;
    setNotas(notas.filter((_, j) => j !== i));
  };
  const guardarEdicion = (i: number) => {
    if (!editTexto.trim()) return;
    setNotas(notas.map((n, j) => (j === i ? { ...n, texto: editTexto.trim() } : n)));
    setEditId(null);
  };
  const cambiarTipo = (i: number, t: string) => setNotas(notas.map((n, j) => (j === i ? { ...n, tipo: t } : n)));

  const conteo = (t: string) => notas.filter((n) => n.tipo === t).length;
  const visibles = notas.map((n, i) => ({ n, i })).filter(({ n }) => !filtro || n.tipo === filtro);
  const nombreMes = (m?: number | null) => (m ? nombres[m - 1] || `Mes ${m}` : "");

  const Wrapper = compacto ? "div" : "section";
  return (
    <Wrapper className={compacto ? "" : `card p-5 border-l-4 border-brand-ink ${soloImpresion ? "print-only" : ""}`}>
      {!compacto && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
            <h2 className="font-display text-lg text-brand-ink uppercase">Notas y comentarios sobre la simulación</h2>
            <span className="text-[11px] text-brand-slate">{notas.length} nota(s)</span>
          </div>
          <p className="text-xs text-brand-slate mb-3 max-w-3xl">
            Qué se asumió, qué se ve, qué se decidió, qué queda pendiente y qué puede salir distinto. Cada nota lleva autor y fecha.
          </p>
        </>
      )}

      {/* ===== Alta ===== */}
      {!soloImpresion && (
        <div className={`no-print rounded-md border border-brand-border bg-brand-bg-soft ${compacto ? "p-2 mb-3" : "p-3 mb-4"}`}>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={compacto ? 3 : 2}
            placeholder={compacto ? "Qué se asumió, qué se ve, qué se decidió, qué queda pendiente…" : 'Ej.: "Se asume zafra promedio 2025; si la retención del mes 1 baja del 80%, el resultado a 18 meses se da vuelta."'}
            className="input w-full !py-1.5 text-[13px]" />
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {Object.entries(TIPOS_NOTA).map(([k, t]) => (
              <button key={k} onClick={() => setTipo(k)} title={t.ayuda}
                className={`px-1.5 py-0.5 rounded-full border text-[10px] font-bold ${t.cls} ${tipo === k ? "ring-2 ring-brand-ink/40" : "opacity-60 hover:opacity-100"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <select value={mes} onChange={(e) => setMes(e.target.value)} className="flex-1 min-w-0 text-[11px] border border-brand-border rounded px-2 py-1 bg-white">
              <option value="">Sobre toda la simulación</option>
              {nombres.map((nm, i) => <option key={i} value={i + 1}>Sobre: {nm || `Mes ${i + 1}`}</option>)}
            </select>
            <button onClick={agregar} disabled={!texto.trim()} className="btn-primary !py-1 !px-3 text-[12px] disabled:opacity-50">Agregar</button>
          </div>
          <p className="text-[10px] text-brand-slate mt-1.5">{guardaSola ? "Se guardan solas con la simulación abierta." : "Se guardan al guardar la simulación."} Salen en el PDF.</p>
        </div>
      )}

      {/* ===== Filtro por tipo ===== */}
      {notas.length > 0 && (
        <div className="no-print flex flex-wrap gap-1 mb-3">
          <button onClick={() => setFiltro(null)} className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${!filtro ? "bg-brand-ink text-white border-brand-ink" : "border-brand-border text-brand-graphite"}`}>Todas · {notas.length}</button>
          {Object.entries(TIPOS_NOTA).filter(([k]) => conteo(k) > 0).map(([k, t]) => (
            <button key={k} onClick={() => setFiltro(filtro === k ? null : k)} className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${t.cls} ${filtro === k ? "ring-2 ring-brand-ink/40" : ""}`}>
              {t.label} · {conteo(k)}
            </button>
          ))}
        </div>
      )}

      {/* ===== Lista ===== */}
      {notas.length === 0 ? (
        <p className="text-sm text-brand-slate">Sin notas todavía.</p>
      ) : (
        <ol className={compacto ? "space-y-1.5" : "space-y-2"}>
          {visibles.map(({ n, i }) => {
            const t = TIPOS_NOTA[n.tipo] ?? TIPOS_NOTA.observacion;
            const editando = editId === (n.id ?? `i-${i}`);
            return (
              <li key={n.id ?? `i-${i}`} className={`rounded-md border border-brand-border bg-white flex gap-2 ${compacto ? "px-2 py-1.5" : "px-3 py-2 gap-3"}`} style={{ borderLeft: `4px solid ${t.punto}` }}>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <select value={n.tipo} onChange={(e) => cambiarTipo(i, e.target.value)} title="Cambiar tipo"
                      className={`no-print rounded-full border text-[10px] font-bold px-1.5 py-0.5 ${t.cls}`}>
                      {Object.entries(TIPOS_NOTA).map(([k, tt]) => <option key={k} value={k}>{tt.label}</option>)}
                    </select>
                    <span className={`print-only rounded-full border text-[10px] font-bold px-1.5 py-0.5 ${t.cls}`}>{t.label}</span>
                    {n.mes && <span className="text-[10px] font-bold text-brand-purple bg-brand-purple/10 rounded px-1.5 py-0.5">{nombreMes(n.mes)}</span>}
                    <span className="text-[10px] text-brand-slate">
                      {n.autor || "sin guardar"}{n.fecha ? ` · ${fecha(n.fecha)}` : ""}
                      {n.editada_por && <> · editada por {n.editada_por} el {fecha(n.editada_el)}</>}
                    </span>
                  </div>
                  {editando ? (
                    <div className="no-print">
                      <textarea value={editTexto} onChange={(e) => setEditTexto(e.target.value)} rows={3} autoFocus className="input w-full !py-1.5 text-sm" />
                      <div className="flex gap-2 mt-1">
                        <button onClick={() => guardarEdicion(i)} disabled={!editTexto.trim()} className="btn-primary !py-1 !px-3 text-xs disabled:opacity-50">Guardar</button>
                        <button onClick={() => setEditId(null)} className="text-xs text-brand-slate hover:text-brand-ink px-2">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13px] text-brand-ink leading-relaxed whitespace-pre-line">{n.texto}</p>
                  )}
                </div>
                {!editando && (
                  <div className="no-print flex flex-col gap-1 text-[11px] font-semibold shrink-0">
                    <button onClick={() => { setEditId(n.id ?? `i-${i}`); setEditTexto(n.texto); }} className="text-brand-ink hover:text-brand-primary hover:underline">Editar</button>
                    <button onClick={() => quitar(i)} className="text-brand-primary hover:underline">Eliminar</button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Wrapper>
  );
}
