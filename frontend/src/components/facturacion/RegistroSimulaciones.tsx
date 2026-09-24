"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatGs, formatInt } from "@/lib/format";
import { NotasSimulacion, type Nota } from "./NotasSimulacion";

/** Barra lateral "Registro del trabajo" del Simulador Anual (Televentas Claro):
 *  simulación abierta, ítems marcados, post-its y simulaciones guardadas.
 *  Se muestra y oculta para dejar el lienzo libre. */

export type Marca = { key: string; label: string };
export type Postit = { id?: string; texto: string; color: string; item?: string | null; autor?: string; fecha?: string; x?: number; y?: number };
export type Snapshot = { parametros: any; ventas_por_mes: number[]; horizonte: number; meses_afectados: Record<string, any>; bonos_adicionales_por_mes: number[]; nombres_meses: string[]; resumen: any };

export const COLORES_POSTIT: Record<string, { label: string; bg: string; border: string }> = {
  amarillo: { label: "Amarillo", bg: "#FEF3C7", border: "#F59E0B" },
  rosa: { label: "Rosa", bg: "#FCE7F3", border: "#EC4899" },
  verde: { label: "Verde", bg: "#DCFCE7", border: "#22C55E" },
  celeste: { label: "Celeste", bg: "#E0F2FE", border: "#0EA5E9" },
};

export const ANCHO_BARRA = 372;   // px, para reservar espacio al lienzo cuando está abierta

const fecha = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("es-PY") : "—");

/** Pin para marcar un ítem (KPI, mes, fila del EERR). */
export function Pin({ marcado, onClick, className = "" }: { marcado: boolean; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={marcado ? "Quitar marca" : "Marcar este ítem"}
      className={`no-print inline-flex items-center justify-center w-6 h-6 rounded-full text-[13px] leading-none transition-colors ${
        marcado ? "bg-amber-400 text-white shadow" : "bg-white/80 border border-brand-border text-brand-slate opacity-40 hover:opacity-100 hover:border-amber-400 hover:text-amber-500"} ${className}`}>
      📌
    </button>
  );
}

/** Contenedor que agrega el pin y el resaltado a cualquier bloque (ej. un KpiCard). */
export function Marcable({ marcado, onToggle, children }: { marcado: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className={`relative rounded-md ${marcado ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}>
      {children}
      <div className="absolute top-1.5 right-1.5"><Pin marcado={marcado} onClick={onToggle} /></div>
      {marcado && <span className="print-only absolute top-1 right-2 text-[10px] font-bold text-amber-600">MARCADO</span>}
    </div>
  );
}

function Seccion({ titulo, extra, abierta = true, children }: { titulo: string; extra?: React.ReactNode; abierta?: boolean; children: React.ReactNode }) {
  return (
    <details open={abierta} className="group border-b border-brand-border">
      <summary className="cursor-pointer select-none flex items-center justify-between gap-2 px-4 py-2.5 text-[10px] uppercase tracking-wider2 font-bold text-brand-slate hover:bg-brand-bg">
        <span className="flex items-center gap-1.5"><span className="text-brand-slate/60 group-open:rotate-90 transition-transform">▸</span>{titulo}</span>
        {extra}
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

export function RegistroSimulaciones({ abierta, setAbierta, listo, getSnapshot, onAbrir, actual, setActual, marcas, setMarcas, postits, setPostits, notas, setNotas, nombresMeses, negocio = "movil" }: {
  abierta: boolean; setAbierta: (v: boolean) => void;
  negocio?: "movil" | "gpon";                        // cada negocio ve solo sus simulaciones guardadas
  listo: boolean;                                   // hay simulación en pantalla para guardar
  getSnapshot: () => Snapshot;
  onAbrir: (sim: any) => void;
  actual: any | null;                                // simulación guardada abierta
  setActual: (s: any | null) => void;
  marcas: Marca[]; setMarcas: (m: Marca[]) => void;
  postits: Postit[]; setPostits: (p: Postit[]) => void;
  notas: Nota[]; setNotas: (n: Nota[]) => void;
  nombresMeses: string[];
}) {
  const [lista, setLista] = useState<any[]>([]);
  const [verGuardadas, setVerGuardadas] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [form, setForm] = useState<null | "nueva" | "editar">(null);
  const [nombre, setNombre] = useState("");
  const [comentario, setComentario] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [piTexto, setPiTexto] = useState("");
  const [piColor, setPiColor] = useState("amarillo");
  const [piItem, setPiItem] = useState("");
  const skipSync = useRef(false);

  const esDelNegocio = (s: any) => ((s?.negocio === "GPON" || s?.parametros?.negocio === "GPON") ? "gpon" : "movil") === negocio;
  const cargarLista = () => apiFetch<any>("/api/v1/televentas-claro/facturacion/simulaciones").then((d) => setLista((d.simulaciones ?? []).filter(esDelNegocio))).catch(() => setLista([]));
  useEffect(() => { cargarLista(); }, []);

  // En el celular la barra ocupa toda la pantalla: bloquear el scroll de fondo mientras está abierta.
  useEffect(() => {
    if (!abierta || !window.matchMedia("(max-width: 639px)").matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [abierta]);

  const aviso = (msg: string) => { setOk(msg); setTimeout(() => setOk(null), 2500); };
  const run = async (fn: () => Promise<any>, exito?: string) => {
    setError(null);
    try { const r = await fn(); if (exito) aviso(exito); return r; } catch (e: any) { setError(e.message || "No se pudo guardar."); return null; }
  };

  // Marcas, post-its y notas de una simulación abierta se persisten solos.
  useEffect(() => {
    if (!actual) { skipSync.current = false; return; }
    if (skipSync.current) { skipSync.current = false; return; }
    const t = setTimeout(() => {
      apiFetch<any>(`/api/v1/televentas-claro/facturacion/simulaciones/${actual.id}`, { method: "PATCH", body: JSON.stringify({ marcas, postits, notas }) })
        .then((s) => {
          // El servidor firma lo nuevo (id, autor, fecha): reasignar solo si cambió, y saltar el próximo disparo.
          const cambioPostits = JSON.stringify(s.postits ?? []) !== JSON.stringify(postits);
          const cambioNotas = JSON.stringify(s.notas ?? []) !== JSON.stringify(notas);
          if (cambioPostits || cambioNotas) skipSync.current = true;
          if (cambioPostits) setPostits(s.postits ?? []);
          if (cambioNotas) setNotas(s.notas ?? []);
          setActual({ ...actual, marcas: s.marcas, postits: s.postits, notas: s.notas, updated_at: s.updated_at, updated_by_nombre: s.updated_by_nombre });
          cargarLista();
        })
        .catch((e) => setError(e.message));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marcas, postits, notas]);

  const abrir = async (id: string) => {
    const s = await run(() => apiFetch<any>(`/api/v1/televentas-claro/facturacion/simulaciones/${id}`));
    if (!s) return;
    skipSync.current = true;
    onAbrir(s);
    setActual(s);
    setForm(null);
    setVerGuardadas(false);
    aviso(`"${s.nombre}" abierta.`);
  };
  const cerrar = () => { skipSync.current = true; setActual(null); setMarcas([]); setPostits([]); setNotas([]); setForm(null); };

  const guardarNueva = async () => {
    if (!nombre.trim()) return;
    setGuardando(true);
    const s = await run(() => apiFetch<any>("/api/v1/televentas-claro/facturacion/simulaciones", {
      method: "POST", body: JSON.stringify({ nombre: nombre.trim(), comentario: comentario.trim() || null, ...getSnapshot(), marcas, postits, notas }),
    }), "Simulación guardada.");
    setGuardando(false);
    if (!s) return;
    skipSync.current = true;
    setActual(s); setPostits(s.postits ?? []); setNotas(s.notas ?? []); setForm(null); cargarLista();
  };
  const guardarCambios = async () => {
    if (!actual) return;
    setGuardando(true);
    const s = await run(() => apiFetch<any>(`/api/v1/televentas-claro/facturacion/simulaciones/${actual.id}`, {
      method: "PATCH", body: JSON.stringify({ ...getSnapshot(), marcas, postits, notas }),
    }), "Cambios guardados.");
    setGuardando(false);
    if (s) { setActual(s); cargarLista(); }
  };
  const guardarNombre = async () => {
    if (!actual || !nombre.trim()) return;
    const s = await run(() => apiFetch<any>(`/api/v1/televentas-claro/facturacion/simulaciones/${actual.id}`, {
      method: "PATCH", body: JSON.stringify({ nombre: nombre.trim(), comentario: comentario.trim() }),
    }), "Nombre y comentario actualizados.");
    if (s) { setActual(s); setForm(null); cargarLista(); }
  };
  const eliminar = async (s: any) => {
    if (!window.confirm(`¿Eliminar la simulación "${s.nombre}"?\n\nSe borran también sus marcas y post-its. Queda en la auditoría.`)) return;
    const r = await run(() => apiFetch<any>(`/api/v1/televentas-claro/facturacion/simulaciones/${s.id}`, { method: "DELETE" }), "Simulación eliminada.");
    if (r) { if (actual?.id === s.id) cerrar(); cargarLista(); }
  };

  const agregarPostit = () => {
    if (!piTexto.trim()) return;
    const n = postits.length;
    setPostits([...postits, { texto: piTexto.trim(), color: piColor, item: piItem || null, x: 24 + (n % 6) * 36, y: 40 + (n % 6) * 28 }]);
    setPiTexto(""); setPiItem("");
  };
  const quitarPostit = (i: number) => setPostits(postits.filter((_, j) => j !== i));
  const quitarMarca = (key: string) => setMarcas(marcas.filter((m) => m.key !== key));

  const snap = listo ? getSnapshot() : null;
  const sinGuardar = !!actual && !!snap && (
    JSON.stringify(snap.parametros) !== JSON.stringify(actual.parametros)
    || JSON.stringify(snap.ventas_por_mes) !== JSON.stringify(actual.ventas_por_mes)
    || JSON.stringify(snap.meses_afectados ?? {}) !== JSON.stringify(actual.meses_afectados ?? {})
    || JSON.stringify(snap.bonos_adicionales_por_mes ?? []) !== JSON.stringify((actual.bonos_adicionales_por_mes ?? []).map(Number))
    || JSON.stringify(snap.nombres_meses ?? []) !== JSON.stringify(actual.nombres_meses ?? [])
    || snap.horizonte !== actual.horizonte);

  const abrirForm = (tipo: "nueva" | "editar") => {
    setNombre(tipo === "editar" && actual ? actual.nombre : "");
    setComentario(tipo === "editar" && actual ? (actual.comentario ?? "") : "");
    setForm(tipo);
  };

  const listaFiltrada = lista.filter((s) => !filtro.trim() || `${s.nombre} ${s.comentario ?? ""}`.toLowerCase().includes(filtro.toLowerCase()));

  // Pestaña para reabrir la barra cuando está oculta.
  if (!abierta) {
    return (
      <>
        <button onClick={() => setAbierta(true)} title="Mostrar el registro del trabajo"
          className="no-print hidden sm:block fixed right-0 top-1/2 -translate-y-1/2 z-50 rounded-l-md bg-brand-ink text-white shadow-lg px-2 py-4 [writing-mode:vertical-rl] rotate-180 text-[11px] font-bold uppercase tracking-wider2 hover:bg-brand-graphite">
          Registro del trabajo{actual ? ` · ${actual.nombre}` : ""}{sinGuardar ? " · sin guardar" : ""}
        </button>
        <button onClick={() => setAbierta(true)} title="Registro del trabajo"
          className="no-print sm:hidden fixed bottom-4 right-4 z-50 rounded-full bg-brand-ink text-white shadow-xl pl-3 pr-4 py-3 text-xs font-bold flex items-center gap-2">
          <span className="text-base leading-none">📋</span> Registro
          {sinGuardar && <span className="w-2.5 h-2.5 rounded-full bg-brand-orange" title="cambios sin guardar" />}
          {(marcas.length + postits.length + notas.length) > 0 && <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-[10px]">{marcas.length + postits.length + notas.length}</span>}
        </button>
      </>
    );
  }

  return (
    <>
      <style>{`@media (max-width: 639px) { .rs-aside input, .rs-aside textarea, .rs-aside select { font-size: 16px; } }`}</style>
      <div className="no-print sm:hidden fixed inset-0 z-40 bg-brand-ink/40" onClick={() => setAbierta(false)} />
      <aside className="rs-aside no-print fixed inset-y-0 right-0 z-50 w-full sm:w-[372px] bg-white sm:border-l border-brand-border shadow-2xl flex flex-col" style={{ height: "100dvh" }}>
      {/* ===== Cabecera ===== */}
      <div className="px-4 py-3 bg-brand-ink text-white">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider2 font-bold text-white/70">Registro del trabajo</div>
            <div className="font-display text-base uppercase leading-tight truncate" title={actual?.nombre}>{actual ? actual.nombre : "Simulación sin guardar"}</div>
            {actual ? (
              <div className="text-[10px] text-white/70 leading-snug mt-0.5">
                {actual.created_by_nombre || "—"} · {fecha(actual.created_at)}{actual.updated_at && <> · editada {fecha(actual.updated_at)}</>} · {actual.horizonte} m · {notas.length} nota(s)
              </div>
            ) : (
              <div className="text-[10px] text-white/60 mt-0.5">{listo ? "Lista para guardar" : "Seteá el mes 1 para poder guardar"}</div>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-1">
            <button onClick={() => setVerGuardadas(true)} title="Ver, abrir o eliminar simulaciones guardadas"
              className="px-2 py-1 rounded text-[10px] font-bold bg-white/15 hover:bg-white/25 whitespace-nowrap">Guardadas · {lista.length}</button>
            <button onClick={() => setAbierta(false)} title="Ocultar barra y ver la proyección"
              className="h-9 -mr-1 px-2.5 flex items-center justify-center gap-1 rounded-md text-white hover:bg-white/10 sm:text-white/80 sm:hover:text-white">
              <span className="sm:hidden text-xs font-bold">✕ Cerrar</span>
              <span className="hidden sm:inline text-2xl leading-none">›</span>
            </button>
          </div>
        </div>
        {sinGuardar && <div className="mt-2 text-[10px] font-bold px-2 py-1 rounded bg-brand-orange text-white">Cambios sin guardar (variables, ventas, nombres, bonos o meses afectados)</div>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {actual ? (
            <>
              <button onClick={guardarCambios} disabled={guardando || !listo} className={`px-2.5 py-1 rounded text-[11px] font-bold disabled:opacity-40 ${sinGuardar ? "bg-brand-orange text-white" : "bg-white/15 hover:bg-white/25"}`}>{guardando ? "Guardando…" : "Guardar cambios"}</button>
              <button onClick={() => abrirForm("nueva")} disabled={!listo} className="px-2.5 py-1 rounded text-[11px] font-bold bg-white/15 hover:bg-white/25 disabled:opacity-40">Guardar como nueva</button>
              <button onClick={() => abrirForm("editar")} className="px-2.5 py-1 rounded text-[11px] font-bold bg-white/15 hover:bg-white/25">Nombre / comentario</button>
              <button onClick={() => eliminar(actual)} className="px-2.5 py-1 rounded text-[11px] font-bold bg-brand-primary hover:bg-brand-primary/90">Eliminar</button>
              <button onClick={cerrar} title="Quitar la simulación guardada de pantalla (no la borra)" className="px-2 py-1 text-[11px] text-white/70 hover:text-white">Cerrar simulación</button>
            </>
          ) : (
            <>
              <button onClick={() => abrirForm("nueva")} disabled={!listo} className="px-3 py-1.5 rounded text-[11px] font-bold bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-40">Guardar simulación</button>
              {lista.length > 0 && <button onClick={() => setVerGuardadas(true)} className="px-3 py-1.5 rounded text-[11px] font-bold bg-white/15 hover:bg-white/25">Abrir una guardada</button>}
            </>
          )}
        </div>
        {ok && <div className="mt-1.5 text-[11px] text-emerald-300 font-semibold">{ok}</div>}
      </div>

      {error && <div className="mx-3 mt-2 text-[11px] text-brand-primary bg-brand-primary/5 border border-brand-primary/30 rounded px-2 py-1.5">{error}</div>}

      {form && (
        <div className="m-3 rounded-md border-2 border-brand-primary bg-brand-primary/5 p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-primary">{form === "nueva" ? "Guardar simulación" : "Editar nombre y comentario"}</div>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus placeholder='Nombre. Ej.: "Base 1.700 · ajuste 5%"' className="input w-full !py-1.5 text-sm" />
          <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={3} placeholder="Comentario: qué se probó, supuestos, para quién" className="input w-full !py-1.5 text-sm" />
          <div className="flex gap-2">
            <button onClick={form === "nueva" ? guardarNueva : guardarNombre} disabled={guardando || !nombre.trim()} className="btn-primary !py-1.5 !px-4 text-sm disabled:opacity-50">{guardando ? "Guardando…" : "Guardar"}</button>
            <button onClick={() => setForm(null)} className="text-sm text-brand-slate hover:text-brand-ink px-2">Cancelar</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {actual?.comentario && (
          <div className="px-4 py-3 border-b border-brand-border bg-brand-bg-soft">
            <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate mb-1">Comentario</div>
            <p className="text-[13px] text-brand-ink leading-relaxed whitespace-pre-line">{actual.comentario}</p>
          </div>
        )}

        <Seccion titulo="Notas y comentarios" extra={<span className="text-brand-ink">{notas.length}</span>}>
          <NotasSimulacion notas={notas} setNotas={setNotas} nombres={nombresMeses} guardaSola={!!actual} compacto />
        </Seccion>

        <Seccion titulo="Ítems marcados" extra={<span className="text-brand-ink">{marcas.length}</span>}>
          {marcas.length === 0 ? (
            <p className="text-[12px] text-brand-slate">Nada marcado. Usá el 📌 sobre los cuadros, los meses o las filas del EERR.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {marcas.map((m) => (
                <li key={m.key} className="flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 text-amber-800 text-[11px] font-semibold pl-2 pr-1 py-0.5">
                  📌 {m.label}
                  <button onClick={() => quitarMarca(m.key)} className="ml-1 w-4 h-4 rounded-full hover:bg-amber-300 text-[10px]" title="Quitar marca">✕</button>
                </li>
              ))}
            </ul>
          )}
        </Seccion>

        <Seccion titulo="Post-its" extra={<span className="text-brand-ink">{postits.length}</span>}>
          <textarea value={piTexto} onChange={(e) => setPiTexto(e.target.value)} rows={2} placeholder="Comentario suelto: una duda, una idea, algo para revisar con Claro…" className="input w-full !py-1.5 text-[13px]" />
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex gap-1">
              {Object.entries(COLORES_POSTIT).map(([k, c]) => (
                <button key={k} onClick={() => setPiColor(k)} title={c.label} className={`w-5 h-5 rounded border-2 ${piColor === k ? "border-brand-ink scale-110" : "border-transparent"}`} style={{ background: c.bg }} />
              ))}
            </div>
            <select value={piItem} onChange={(e) => setPiItem(e.target.value)} className="flex-1 min-w-0 text-[11px] border border-brand-border rounded px-1.5 py-1 bg-white">
              <option value="">Sin ítem asociado</option>
              {marcas.map((m) => <option key={m.key} value={m.key}>Sobre: {m.label}</option>)}
            </select>
            <button onClick={agregarPostit} disabled={!piTexto.trim()} className="btn-primary !py-1 !px-2.5 text-[11px] disabled:opacity-50">Pegar</button>
          </div>
          <p className="text-[10px] text-brand-slate mt-1">El post-it aparece sobre el lienzo: arrastralo desde su franja de color y soltalo donde quieras.</p>
          {postits.length > 0 && (
            <ul className="mt-2 space-y-1">
              {postits.map((pi, i) => {
                const c = COLORES_POSTIT[pi.color] ?? COLORES_POSTIT.amarillo;
                return (
                  <li key={pi.id ?? i} className="flex items-start gap-2 text-[12px] text-brand-ink">
                    <span className="mt-1 w-3 h-3 rounded-sm shrink-0" style={{ background: c.bg, border: `1px solid ${c.border}` }} />
                    <span className="flex-1 line-clamp-2">{pi.texto}</span>
                    <button onClick={() => quitarPostit(i)} className="text-[11px] text-brand-slate hover:text-brand-primary" title="Quitar post-it">✕</button>
                  </li>
                );
              })}
            </ul>
          )}
          {!actual && postits.length + marcas.length > 0 && <p className="text-[10px] text-brand-orange mt-1.5">Marcas y post-its se guardan al guardar la simulación.</p>}
        </Seccion>

      </div>

      {/* ===== Diálogo: simulaciones guardadas ===== */}
      {verGuardadas && (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-brand-ink/40 sm:p-4" onClick={() => setVerGuardadas(false)}>
          <div className="w-full max-w-4xl max-h-[92dvh] sm:max-h-[85vh] flex flex-col rounded-t-xl sm:rounded-lg bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-4 pb-3 border-b border-brand-border flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate">Registro del trabajo</div>
                <h2 className="font-display text-xl text-brand-ink uppercase">Simulaciones guardadas · {lista.length}</h2>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar por nombre o comentario…" className="input !py-1.5 text-base sm:text-sm flex-1 sm:w-64" />
                <button onClick={() => setVerGuardadas(false)} className="text-brand-slate hover:text-brand-ink text-xl leading-none px-1">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {lista.length === 0 ? (
                <p className="p-6 text-sm text-brand-slate">Todavía no hay simulaciones guardadas. Seteá el mes 1, cargá las ventas y usá "Guardar simulación".</p>
              ) : (
                <>
                <ul className="md:hidden divide-y divide-brand-border">
                  {listaFiltrada.map((s) => {
                    const r = s.resumen || {};
                    const fin = r.resultado_con_cola ?? r.resultado;
                    const activa = actual?.id === s.id;
                    return (
                      <li key={s.id} className={`px-4 py-3 ${activa ? "bg-amber-50" : ""}`}>
                        <div className="text-[14px] font-semibold text-brand-ink leading-tight">{s.nombre}{activa && <span className="ml-2 text-[9px] font-bold uppercase text-amber-700">abierta</span>}</div>
                        {s.comentario && <div className="text-[12px] text-brand-slate line-clamp-2 mt-0.5">{s.comentario}</div>}
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-brand-slate">
                          <span>{s.horizonte} m</span>
                          {r.ventas != null && <span>{formatInt(r.ventas)} ventas</span>}
                          {fin != null && <span className={`font-mono font-bold ${fin < 0 ? "text-brand-primary" : "text-emerald-700"}`}>{formatGs(fin)}</span>}
                          <span>{fecha(s.created_at)}{s.created_by_nombre ? ` · ${s.created_by_nombre}` : ""}</span>
                        </div>
                        <div className="mt-2 flex gap-2">
                          {!activa && <button onClick={() => abrir(s.id)} className="btn-primary !py-1.5 !px-4 text-sm">Abrir</button>}
                          <button onClick={() => eliminar(s)} className="px-3 py-1.5 text-sm font-semibold text-brand-slate hover:text-brand-primary">Eliminar</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <table className="hidden md:table w-full text-xs">
                  <thead className="bg-brand-bg text-[9px] uppercase tracking-wider2 text-brand-slate sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left">Nombre</th>
                      <th className="px-3 py-2 text-right">Horizonte</th>
                      <th className="px-3 py-2 text-right">Ventas</th>
                      <th className="px-3 py-2 text-right">Resultado final</th>
                      <th className="px-3 py-2 text-center">📌 / 📝 / notas</th>
                      <th className="px-3 py-2 text-right">Guardada</th>
                      <th className="px-4 py-2 text-right"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {listaFiltrada.map((s) => {
                      const r = s.resumen || {};
                      const fin = r.resultado_con_cola ?? r.resultado;
                      const activa = actual?.id === s.id;
                      return (
                        <tr key={s.id} className={`border-t border-brand-border ${activa ? "bg-amber-50" : "hover:bg-brand-bg-soft"}`}>
                          <td className="px-4 py-2">
                            <div className="text-[13px] font-semibold text-brand-ink">{s.nombre}{activa && <span className="ml-2 text-[9px] font-bold uppercase text-amber-700">abierta</span>}</div>
                            {s.comentario && <div className="text-[11px] text-brand-slate line-clamp-2 max-w-md">{s.comentario}</div>}
                          </td>
                          <td className="px-3 py-2 text-right">{s.horizonte} m</td>
                          <td className="px-3 py-2 text-right font-mono">{r.ventas != null ? formatInt(r.ventas) : "—"}</td>
                          <td className={`px-3 py-2 text-right font-mono font-bold ${fin != null && fin < 0 ? "text-brand-primary" : "text-emerald-700"}`}>{fin != null ? formatGs(fin) : "—"}</td>
                          <td className="px-3 py-2 text-center text-brand-slate">{(s.marcas ?? []).length} / {(s.postits ?? []).length} / {(s.notas ?? []).length}</td>
                          <td className="px-3 py-2 text-right text-brand-slate whitespace-nowrap">{fecha(s.created_at)}<div className="text-[10px]">{s.created_by_nombre}</div></td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            {!activa && <button onClick={() => abrir(s.id)} className="font-bold text-brand-primary hover:underline mr-3">Abrir</button>}
                            <button onClick={() => eliminar(s)} className="font-semibold text-brand-slate hover:text-brand-primary hover:underline">Eliminar</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Celular: salida siempre a mano para volver a la proyección */}
      <div className="sm:hidden shrink-0 border-t border-brand-border bg-white p-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        <button onClick={() => setAbierta(false)} className="btn-primary w-full !py-3 text-base">Ver la proyección ›</button>
      </div>
    </aside>
    </>
  );
}
