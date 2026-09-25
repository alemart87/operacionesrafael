"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Senales } from "@/components/ventas-netas/ui";
import { apiFetch } from "@/lib/api";
import { TablaEvidencia } from "./RiesgosView";
import {
  AUD_API, CATEGORIA_LABEL, HALLAZGO_ESTADO_LABEL, SEVERIDAD_CLS, SEVERIDAD_LABEL, fechaCorta, n,
  type AuditoriaDetalle, type Hallazgo, type HallazgoEstado, type Severidad,
} from "./tipos";

const ESTADO_CLS: Record<HallazgoEstado, string> = {
  abierto: "badge-primary",
  en_seguimiento: "badge-cyan",
  resuelto: "badge-success",
  descartado: "badge-neutral line-through",
};

type Form = { titulo: string; descripcion: string; severidad: Severidad; categoria: string; vendedor: string; recomendacion: string; responsable: string; fecha_compromiso: string };
const vacio: Form = { titulo: "", descripcion: "", severidad: "media", categoria: "otro", vendedor: "", recomendacion: "", responsable: "", fecha_compromiso: "" };

/** Hallazgos del informe: automáticos y manuales, con severidad, estado, responsable, evidencia y notas. */
export function Hallazgos({ a, onChange }: { a: AuditoriaDetalle; onChange: () => Promise<void> }) {
  const [filtro, setFiltro] = useState<"todos" | HallazgoEstado>("todos");
  const [editando, setEditando] = useState<string | "nuevo" | null>(null);
  const [form, setForm] = useState<Form>(vacio);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nota, setNota] = useState<Record<string, string>>({});
  const [aEliminar, setAEliminar] = useState<Hallazgo | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lista = a.hallazgos.filter((h) => filtro === "todos" || h.estado === filtro);
  const conteo = (e: HallazgoEstado) => a.hallazgos.filter((h) => h.estado === e).length;

  const run = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    setError(null);
    try { await fn(); await onChange(); } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  const empezarEdicion = (h: Hallazgo) => {
    setForm({ titulo: h.titulo, descripcion: h.descripcion ?? "", severidad: h.severidad, categoria: h.categoria, vendedor: h.vendedor ?? "", recomendacion: h.recomendacion ?? "", responsable: h.responsable ?? "", fecha_compromiso: h.fecha_compromiso ?? "" });
    setEditando(h.id);
  };
  const guardar = () =>
    run(async () => {
      const body = { ...form, vendedor: form.vendedor || null, fecha_compromiso: form.fecha_compromiso || null, descripcion: form.descripcion || null, recomendacion: form.recomendacion || null, responsable: form.responsable || null };
      if (editando === "nuevo") await apiFetch(`${AUD_API}/informes/${a.id}/hallazgos`, { method: "POST", body: JSON.stringify(body) });
      else await apiFetch(`${AUD_API}/informes/${a.id}/hallazgos/${editando}`, { method: "PATCH", body: JSON.stringify(body) });
      setEditando(null);
    });
  const cambiarEstado = (h: Hallazgo, estado: HallazgoEstado) =>
    run(async () => {
      await apiFetch(`${AUD_API}/informes/${a.id}/hallazgos/${h.id}`, { method: "PATCH", body: JSON.stringify({ estado, nota: nota[h.id] || undefined }) });
      setNota((s) => ({ ...s, [h.id]: "" }));
    });
  const agregarNota = (h: Hallazgo) =>
    run(async () => {
      await apiFetch(`${AUD_API}/informes/${a.id}/seguimientos`, { method: "POST", body: JSON.stringify({ texto: nota[h.id], hallazgo_id: h.id }) });
      setNota((s) => ({ ...s, [h.id]: "" }));
    });

  const formulario = (
    <div className="card p-5 border-l-[3px] border-l-brand-cyan space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="label">Título</label>
          <input className="input" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Qué se encontró" />
        </div>
        <div>
          <label className="label">Severidad</label>
          <select className="input" value={form.severidad} onChange={(e) => setForm({ ...form, severidad: e.target.value as Severidad })}>
            {(Object.keys(SEVERIDAD_LABEL) as Severidad[]).map((s) => <option key={s} value={s}>{SEVERIDAD_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Categoría</label>
          <select className="input" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
            {Object.entries(CATEGORIA_LABEL).filter(([k]) => k !== "zona").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Vendedor (opcional)</label>
          <input className="input" list="vendedores-aud" value={form.vendedor} onChange={(e) => setForm({ ...form, vendedor: e.target.value })} />
          <datalist id="vendedores-aud">{a.snapshot.ranking?.map((v) => <option key={v.vendedor} value={v.vendedor} />)}</datalist>
        </div>
        <div>
          <label className="label">Responsable del seguimiento</label>
          <input className="input" value={form.responsable} onChange={(e) => setForm({ ...form, responsable: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Descripción</label>
          <textarea className="input min-h-[90px]" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Recomendación</label>
          <textarea className="input min-h-[70px]" value={form.recomendacion} onChange={(e) => setForm({ ...form, recomendacion: e.target.value })} />
        </div>
        <div>
          <label className="label">Fecha compromiso</label>
          <input type="date" className="input" value={form.fecha_compromiso} onChange={(e) => setForm({ ...form, fecha_compromiso: e.target.value })} />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={() => setEditando(null)} className="btn-secondary" disabled={ocupado}>Cancelar</button>
        <button onClick={guardar} className="btn-primary" disabled={ocupado || form.titulo.trim().length < 3}>{ocupado ? "Guardando…" : "Guardar hallazgo"}</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center gap-3 flex-wrap no-print">
        <div className="flex gap-1 flex-wrap">
          {(["todos", "abierto", "en_seguimiento", "resuelto", "descartado"] as const).map((e) => (
            <button key={e} onClick={() => setFiltro(e)} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${filtro === e ? "bg-brand-ink text-white" : "text-brand-slate hover:bg-brand-bg"}`}>
              {e === "todos" ? `Todos ${a.hallazgos.length}` : `${HALLAZGO_ESTADO_LABEL[e]} ${conteo(e)}`}
            </button>
          ))}
        </div>
        {a.editable && editando === null && (
          <button onClick={() => { setForm(vacio); setEditando("nuevo"); }} className="btn-primary ml-auto">Agregar hallazgo</button>
        )}
        {!a.editable && <span className="ml-auto text-xs text-brand-slate">Informe {a.status === "archivado" ? "archivado: solo lectura" : "cerrado: solo avanza el seguimiento (estado, responsable, notas)"}.</span>}
      </div>
      {error && <div className="card p-3 text-brand-primary text-sm">{error}</div>}
      {editando === "nuevo" && formulario}

      {lista.length === 0 && <div className="card p-8 text-center text-brand-slate">Sin hallazgos en este filtro.</div>}
      {lista.map((h) => (
        <article key={h.id} className={`card p-5 border-l-[3px] ${h.severidad === "alta" ? "border-l-brand-primary" : h.severidad === "media" ? "border-l-brand-orange" : "border-l-brand-cyan"} ${h.estado === "descartado" ? "opacity-60" : ""}`}>
          {editando === h.id ? formulario : (
            <>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-[11px]">
                    <span className="font-semibold text-brand-slate">{h.codigo}</span>
                    <span className={`rounded border px-1.5 py-0.5 font-semibold ${SEVERIDAD_CLS[h.severidad]}`}>{SEVERIDAD_LABEL[h.severidad]}</span>
                    <span className={ESTADO_CLS[h.estado]}>{HALLAZGO_ESTADO_LABEL[h.estado]}</span>
                    <span className="text-brand-mist">{CATEGORIA_LABEL[h.categoria] ?? h.categoria}{h.vendedor ? ` · ${h.vendedor}` : ""}</span>
                    <span className="text-brand-mist">{h.origen === "auto" ? "automático" : "manual"}</span>
                  </div>
                  <h3 className="font-display text-xl text-brand-ink uppercase leading-tight mt-1">{h.titulo}</h3>
                </div>
                <div className="flex items-center gap-2 no-print">
                  {a.con_seguimiento && (
                    <select className="input py-1.5 text-xs max-w-[160px]" value={h.estado} disabled={ocupado} onChange={(e) => cambiarEstado(h, e.target.value as HallazgoEstado)}>
                      {(Object.keys(HALLAZGO_ESTADO_LABEL) as HallazgoEstado[]).map((e) => <option key={e} value={e}>{HALLAZGO_ESTADO_LABEL[e]}</option>)}
                    </select>
                  )}
                  {a.editable && <button onClick={() => empezarEdicion(h)} className="btn-ghost text-xs">Editar</button>}
                  {a.status === "borrador" && <button onClick={() => setAEliminar(h)} className="btn-ghost text-xs text-brand-primary">Eliminar</button>}
                </div>
              </div>
              {h.descripcion && <p className="text-sm text-brand-graphite mt-3 leading-relaxed">{h.descripcion}</p>}
              {h.recomendacion && (
                <div className="mt-3 rounded-md bg-brand-bg-soft border border-brand-border p-3 text-sm">
                  <span className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate block mb-0.5">Recomendación</span>
                  {h.recomendacion}
                </div>
              )}
              <div className="mt-3 flex items-center gap-4 flex-wrap text-xs text-brand-slate">
                <span>Responsable: <b className="text-brand-ink">{h.responsable ?? "—"}</b></span>
                <span>Compromiso: <b className="text-brand-ink">{fechaCorta(h.fecha_compromiso)}</b></span>
                {h.evidencia?.senales && h.evidencia.senales.length > 0 && <span className="w-full"><Senales senales={h.evidencia.senales} /></span>}
              </div>
              {((h.evidencia?.lineas?.length ?? 0) > 0 || (h.evidencia?.sali?.length ?? 0) > 0 || (h.evidencia?.por_vendedor?.length ?? 0) > 0) && (
                <div className="mt-3">
                  <button onClick={() => setAbierto(abierto === h.id ? null : h.id)} className="text-xs font-semibold text-brand-cyan no-print">
                    {abierto === h.id ? "Ocultar evidencia" : `Ver evidencia (${n(h.evidencia.total ?? h.evidencia.lineas?.length ?? 0)} líneas${h.evidencia.sali?.length ? ` · ${n(h.evidencia.sali.length)} Sali Hablando` : ""})`}
                  </button>
                  {abierto === h.id && (
                    <div className="mt-2 space-y-3">
                      {h.evidencia.por_vendedor && h.evidencia.por_vendedor.length > 0 && (
                        <div className="text-xs text-brand-graphite">Por vendedor: {h.evidencia.por_vendedor.map((x) => `${x.vendedor} (${x.total})`).join(" · ")}</div>
                      )}
                      {h.evidencia.lineas && h.evidencia.lineas.length > 0 && <TablaEvidencia lineas={h.evidencia.lineas} />}
                      {h.evidencia.sali && h.evidencia.sali.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mb-1">Sali Hablando</div>
                          <TablaEvidencia lineas={h.evidencia.sali} />
                        </div>
                      )}
                      {(h.evidencia.total ?? 0) > (h.evidencia.lineas?.length ?? 0) && <p className="text-[11px] text-brand-mist">Se muestran las primeras {h.evidencia.lineas?.length} de {h.evidencia.total}.</p>}
                    </div>
                  )}
                </div>
              )}
              {a.con_seguimiento && (
                <div className="mt-3 flex gap-2 no-print">
                  <input className="input text-xs" placeholder="Nota de seguimiento para este hallazgo…" value={nota[h.id] ?? ""} onChange={(e) => setNota((s) => ({ ...s, [h.id]: e.target.value }))} />
                  <button onClick={() => agregarNota(h)} disabled={ocupado || !(nota[h.id] ?? "").trim()} className="btn-secondary py-1.5 text-xs whitespace-nowrap">Agregar nota</button>
                </div>
              )}
            </>
          )}
        </article>
      ))}

      <ConfirmDialog
        open={!!aEliminar}
        variant="danger"
        title="Eliminar hallazgo"
        confirmLabel="Eliminar"
        loading={ocupado}
        message={aEliminar && <>Se elimina <b>{aEliminar.codigo} · {aEliminar.titulo}</b>. Fuera de Borrador, en lugar de eliminar se marca como descartado.</>}
        onCancel={() => setAEliminar(null)}
        onConfirm={() => aEliminar && run(async () => { await apiFetch(`${AUD_API}/informes/${a.id}/hallazgos/${aEliminar.id}`, { method: "DELETE" }); setAEliminar(null); })}
      />
    </div>
  );
}
