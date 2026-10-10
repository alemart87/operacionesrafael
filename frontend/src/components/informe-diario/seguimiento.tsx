"use client";

import { CircleCheck, CircleDashed, Clock3, Plus, RotateCcw, Save, Trash2, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ErrorMsg, Modal } from "@/components/supervision/dialogos";
import { apiFetch } from "@/lib/api";
import { Chip } from "./campos";
import {
  CHIP, ID_API, ID_HREF, NIVEL, diaCorto, inicialDia, numero,
  type CeldaDia, type Diccionario, type PanelSeguimiento, type TemaDiccionario,
} from "./tipos";

// ------------------------------------------------------------------ indicadores
export function Kpi({ titulo, valor, sub, alerta, icono }: { titulo: string; valor: string; sub?: ReactNode; alerta?: boolean; icono?: ReactNode }) {
  return (
    <div className={`card p-4 flex flex-col gap-1.5 min-w-0 ${alerta ? "border-brand-primary/40" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate">{titulo}</div>
        {icono}
      </div>
      <div className={`font-display text-4xl leading-none tabular-nums ${alerta ? "text-brand-primary-dark" : "text-brand-ink"}`}>{valor}</div>
      {sub && <div className="text-xs text-brand-slate leading-snug">{sub}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ cumplimiento autor × día
const CELDA: Record<CeldaDia["estado"], { cls: string; label: string; icono: ReactNode }> = {
  firmado: { cls: "bg-emerald-500 text-white border-emerald-500", label: "Firmado", icono: <CircleCheck size={13} aria-hidden /> },
  borrador: { cls: "bg-brand-orange/15 text-[#8A5200] border-brand-orange", label: "Borrador sin firmar", icono: <CircleDashed size={13} aria-hidden /> },
  falta: { cls: "bg-white text-brand-primary-dark border-brand-primary/60 border-dashed", label: "Sin informe", icono: <X size={13} aria-hidden /> },
  libre: { cls: "bg-brand-bg text-brand-mist border-transparent", label: "No se espera (fin de semana, feriado o antes de empezar)", icono: <span className="text-[10px]">·</span> },
  futuro: { cls: "bg-transparent text-transparent border-transparent", label: "", icono: null },
};

export function Matriz({ p }: { p: PanelSeguimiento }) {
  return (
    <section className="card min-w-0">
      <div className="px-5 pt-5 pb-3">
        <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Cumplimiento por día</h2>
        <p className="text-xs text-brand-slate mt-0.5">
          Se espera un informe firmado por día hábil (de lunes a viernes, sin feriados){p.inicio ? `, desde el ${diaCorto(p.inicio)}, cuando empezó el informe diario` : ""}. Tocá un día para abrir su informe.
        </p>
      </div>
      {!p.autores.length ? (
        <p className="px-5 py-8 text-center text-sm text-brand-slate border-t border-brand-border">No hay usuarios con el informe diario habilitado.</p>
      ) : (
        <div className="overflow-x-auto border-t border-brand-border">
          <table className="text-sm border-separate border-spacing-0">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider2 text-brand-slate">
                <th className="sticky left-0 z-10 bg-white text-left px-4 py-2 min-w-[170px]">Autor</th>
                {p.dias.map((x) => (
                  <th key={x.fecha} className={`px-0.5 py-2 text-center font-semibold ${x.esperado ? "" : "text-brand-mist"}`}>
                    <div>{inicialDia(x.fecha)}</div>
                    <div className="font-display text-sm leading-none tabular-nums text-brand-ink">{x.fecha.slice(8, 10)}</div>
                  </th>
                ))}
                <th className="px-4 py-2 text-right">Cumple</th>
              </tr>
            </thead>
            <tbody>
              {p.autores.map((a) => (
                <tr key={a.id}>
                  <td className="sticky left-0 z-10 bg-white px-4 py-1.5 border-t border-brand-border">
                    <div className="font-semibold text-brand-ink text-sm truncate max-w-[200px]">{a.nombre}</div>
                    <div className="text-[11px] text-brand-slate">{a.cargo}</div>
                  </td>
                  {a.dias.map((c) => {
                    const e = CELDA[c.estado];
                    const titulo = `${diaCorto(c.fecha)} · ${e.label}${c.hora ? ` · ${c.hora}${c.tarde ? " (al día siguiente o después)" : ""}` : ""}${c.nivel && c.nivel !== "bajo" ? ` · ${NIVEL[c.nivel].label}` : ""}`;
                    const caja = (
                      <span className={`relative w-8 h-8 rounded-md border flex items-center justify-center ${e.cls}`}>
                        {e.icono}
                        {c.nivel === "alto" && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-brand-primary ring-2 ring-white" aria-hidden />}
                        {c.tarde && <Clock3 size={9} className="absolute bottom-0.5 right-0.5" aria-hidden />}
                      </span>
                    );
                    return (
                      <td key={c.fecha} className="px-0.5 py-1.5 border-t border-brand-border">
                        {c.id ? <Link href={`${ID_HREF}/${c.id}`} title={titulo} aria-label={titulo} className="block hover:scale-105 transition-transform">{caja}</Link>
                          : c.estado === "futuro" ? <span className="block w-8 h-8" /> : <span title={titulo} aria-label={titulo} className="block">{caja}</span>}
                      </td>
                    );
                  })}
                  <td className="px-4 py-1.5 border-t border-brand-border text-right tabular-nums">
                    <b className={a.pct !== null && a.pct < 80 ? "text-brand-primary-dark" : "text-brand-ink"}>{a.pct === null ? "—" : `${numero(a.pct, 0)}%`}</b>
                    <div className="text-[10px] text-brand-slate">{a.firmados}/{a.esperados}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-5 py-3 border-t border-brand-border flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-brand-slate">
        {(["firmado", "borrador", "falta", "libre"] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5"><span className={`w-5 h-5 rounded border flex items-center justify-center ${CELDA[k].cls}`}>{CELDA[k].icono}</span>{CELDA[k].label}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-brand-primary" /> Alerta alta por palabras clave</span>
        <span className="inline-flex items-center gap-1.5"><Clock3 size={11} /> Firmado después de su día</span>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ palabras clave del período
export function Palabras({ p, onDiccionario }: { p: PanelSeguimiento; onDiccionario: () => void }) {
  const temas = [...p.palabras.temas].sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...temas.map((t) => t.n));
  const maxDia = Math.max(1, ...p.palabras.por_dia.map((x) => x.total));
  const porDia = Object.fromEntries(p.palabras.por_dia.map((x) => [x.fecha, x]));
  return (
    <section className="card min-w-0">
      <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Palabras clave</h2>
          <p className="text-xs text-brand-slate mt-0.5">Qué temas aparecen en los informes firmados del período (resumen, comentarios, compromisos y notas).</p>
        </div>
        <button type="button" className="btn-secondary !py-1.5 !px-3 text-xs" onClick={onDiccionario}>Diccionario</button>
      </div>
      <div className="px-5 pb-5 space-y-5">
        <ul className="space-y-2" aria-label="Menciones por tema">
          {temas.map((t) => (
            <li key={t.clave} className="grid grid-cols-[minmax(0,180px)_1fr_auto] items-center gap-3">
              <span className={`text-xs font-semibold truncate inline-flex items-center gap-1 ${t.critico ? "text-brand-primary-dark" : "text-brand-ink"}`}>
                {t.critico && <TriangleAlert size={12} aria-hidden />}{t.nombre}
              </span>
              <span className="h-3 rounded bg-brand-bg overflow-hidden" title={`${t.nombre}: ${t.n} menciones en ${t.informes} informe(s)`}>
                <span className={`block h-full rounded ${t.critico ? "bg-brand-primary" : "bg-brand-slate/70"}`} style={{ width: `${(t.n / max) * 100}%` }} />
              </span>
              <span className="text-xs tabular-nums text-brand-graphite w-16 text-right"><b>{t.n}</b> <span className="text-brand-slate">· {t.informes} inf.</span></span>
            </li>
          ))}
        </ul>
        {p.palabras.claves.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate mb-1.5">Las más mencionadas</div>
            <div className="flex flex-wrap gap-1.5">
              {p.palabras.claves.slice(0, 20).map((c) => {
                const critico = p.palabras.temas.find((t) => t.clave === c.tema)?.critico;
                return <Chip key={c.clave} chip={critico ? CHIP.ROJO : CHIP.GRIS} title={`${c.n} veces en ${c.informes} informe(s) · clave «${c.clave}»`}>{c.forma ?? c.clave} · {c.n}</Chip>;
              })}
            </div>
          </div>
        )}
        {p.palabras.por_dia.length > 0 && (
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate">Menciones por día</span>
              <span className="text-[11px] text-brand-slate inline-flex items-center gap-3">
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-brand-slate/60" /> Todas</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-brand-primary" /> De temas críticos</span>
              </span>
            </div>
            <div className="flex items-end gap-1 h-24 border-b border-brand-border" role="img"
              aria-label={p.palabras.por_dia.map((x) => `${diaCorto(x.fecha)}: ${x.total} menciones, ${x.criticas} críticas`).join("; ")}>
              {p.dias.map(({ fecha }) => {
                const x = porDia[fecha];
                return (
                  <div key={fecha} className="flex-1 min-w-[8px] h-full flex justify-center"
                    title={x ? `${diaCorto(fecha)}: ${x.total} menciones · ${x.criticas} de temas críticos · ${x.informes} informe(s)` : `${diaCorto(fecha)}: sin informes firmados`}>
                    <div className="w-full max-w-[22px] h-full flex flex-col justify-end gap-[2px]">
                      {x && x.total - x.criticas > 0 && <span className="block rounded-t-[3px] bg-brand-slate/60" style={{ height: `${((x.total - x.criticas) / maxDia) * 100}%` }} />}
                      {x && x.criticas > 0 && <span className={`block bg-brand-primary ${x.total - x.criticas > 0 ? "" : "rounded-t-[3px]"}`} style={{ height: `${(x.criticas / maxDia) * 100}%` }} />}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1 mt-1">
              {p.dias.map(({ fecha }) => <span key={fecha} className="flex-1 min-w-[8px] text-center text-[9px] text-brand-slate tabular-nums">{fecha.slice(8, 10)}</span>)}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ alertas
export function Alertas({ p }: { p: PanelSeguimiento }) {
  return (
    <section className="card min-w-0">
      <div className="px-5 pt-5 pb-3">
        <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Alertas</h2>
        <p className="text-xs text-brand-slate mt-0.5">Informes con menciones de temas críticos: alta con 3 o más, media con 1 o 2.</p>
      </div>
      {!p.palabras.alertas.length ? (
        <p className="px-5 py-6 text-center text-sm text-brand-slate border-t border-brand-border">Sin alertas en el período.</p>
      ) : (
        <ul className="divide-y divide-brand-border border-t border-brand-border">
          {p.palabras.alertas.map((a) => (
            <li key={a.id}>
              <Link href={`${ID_HREF}/${a.id}`} className={`px-5 py-2.5 flex items-center justify-between gap-3 hover:bg-brand-bg-soft ${a.nivel === "alto" ? "shadow-[inset_3px_0_0_#E6332A]" : ""}`}>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-brand-ink truncate">{a.autor} <span className="font-normal text-brand-slate text-xs">· {diaCorto(a.fecha)}</span></div>
                  <div className="text-[11px] text-brand-slate truncate">{a.claves.join(" · ")}</div>
                </div>
                <Chip chip={NIVEL[a.nivel].chip} icono={<TriangleAlert size={10} aria-hidden />}>{a.criticas}</Chip>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ el diccionario
export function DialogoDiccionario({ onClose, onGuardado }: { onClose: () => void; onGuardado: () => void }) {
  const [d, setD] = useState<Diccionario | null>(null);
  const [temas, setTemas] = useState<TemaDiccionario[]>([]);
  const [nuevas, setNuevas] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<Diccionario>(`${ID_API}/palabras`).then((x) => { setD(x); setTemas(x.temas); }).catch((e) => setError(e.message));
  }, []);
  const set = (i: number, x: Partial<TemaDiccionario>) => setTemas((l) => l.map((t, k) => (k === i ? { ...t, ...x } : t)));
  const agregarPalabras = (i: number) => {
    const ps = (nuevas[i] ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!ps.length) return;
    set(i, { palabras: [...temas[i].palabras, ...ps.filter((p) => !temas[i].palabras.includes(p))] });
    setNuevas((x) => ({ ...x, [i]: "" }));
  };
  const guardar = async (restablecer = false) => {
    setOcupado(true);
    setError(null);
    try {
      const x = await apiFetch<Diccionario>(`${ID_API}/palabras`, { method: "PUT", body: JSON.stringify(restablecer ? { restablecer: true } : { temas }) });
      setD(x);
      setTemas(x.temas);
      onGuardado();
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <Modal onClose={onClose} sobre="Palabras clave" titulo="Diccionario" ancho="max-w-3xl"
      pie={<>
        <button type="button" className="btn-ghost mr-auto" disabled={ocupado || d?.por_defecto} onClick={() => guardar(true)}><RotateCcw size={15} /> Restablecer</button>
        <button type="button" className="btn-secondary" onClick={onClose}>Cerrar</button>
        <button type="button" className="btn-primary" disabled={ocupado || !temas.length} onClick={() => guardar()}><Save size={15} /> {ocupado ? "Guardando…" : "Guardar"}</button>
      </>}>
      {!d ? <p className="text-sm text-brand-slate">Cargando…</p> : (
        <div className="space-y-4">
          <p className="text-xs text-brand-slate leading-relaxed">
            El sistema busca estas palabras y frases (sin importar mayúsculas ni tildes, con su plural). Con <b>*</b> al final es una raíz:
            «ausen*» encuentra ausencia, ausente y ausentismo. No cuentan si van negadas («no hubo caídas»). Los temas críticos definen la
            alerta: alta con {d.reglas.alto} o más menciones, media con {d.reglas.medio} o 2.
            {d.updated_by && <> Último cambio: {d.updated_by}.</>}
          </p>
          {temas.map((t, i) => (
            <div key={`${t.clave}-${i}`} className={`rounded-md border px-3.5 py-3 ${t.critico ? "border-brand-primary/40" : "border-brand-border"}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <input className="input !py-1.5 text-sm font-semibold flex-1 min-w-[160px]" maxLength={60} value={t.nombre} aria-label="Nombre del tema"
                  onChange={(e) => set(i, { nombre: e.target.value })} />
                <label className="inline-flex items-center gap-1.5 text-xs text-brand-graphite cursor-pointer">
                  <input type="checkbox" className="accent-brand-primary" checked={t.critico} onChange={(e) => set(i, { critico: e.target.checked })} /> Crítico
                </label>
                <button type="button" className="btn-ghost !p-1.5 hover:text-brand-primary" aria-label={`Quitar el tema ${t.nombre}`}
                  onClick={() => setTemas((l) => l.filter((_, k) => k !== i))}><Trash2 size={15} /></button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {t.palabras.map((p) => (
                  <span key={p} className="inline-flex items-center gap-1 rounded-full border border-brand-border bg-white pl-2.5 pr-1 py-0.5 text-xs">
                    {p}
                    <button type="button" className="rounded-full p-0.5 hover:bg-brand-bg hover:text-brand-primary" aria-label={`Quitar ${p}`}
                      onClick={() => set(i, { palabras: t.palabras.filter((x) => x !== p) })}><X size={12} /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <input className="input !py-1.5 text-sm" placeholder="Agregar palabras (separadas por coma)" value={nuevas[i] ?? ""} aria-label={`Agregar palabras a ${t.nombre}`}
                  onChange={(e) => setNuevas((x) => ({ ...x, [i]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregarPalabras(i); } }} />
                <button type="button" className="btn-secondary !py-1.5 !px-3 text-xs" onClick={() => agregarPalabras(i)}>Agregar</button>
              </div>
            </div>
          ))}
          <button type="button" className="w-full rounded-md border-2 border-dashed border-brand-border py-2.5 text-sm font-semibold text-brand-slate hover:border-brand-primary hover:text-brand-primary inline-flex items-center justify-center gap-1.5"
            onClick={() => setTemas((l) => [...l, { clave: `tema_${Date.now().toString(36)}`, nombre: "Tema nuevo", critico: false, palabras: [] }])}>
            <Plus size={16} /> Agregar tema
          </button>
        </div>
      )}
      <ErrorMsg msg={error} />
    </Modal>
  );
}
