"use client";

import { ArrowLeft, CalendarClock, CircleCheck, ClipboardList, MessageSquareText, ShieldAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { Chip } from "@/components/informe-diario/campos";
import { Alertas, DialogoDiccionario, Kpi, Matriz, Palabras } from "@/components/informe-diario/seguimiento";
import {
  CHIP, ID_API, ID_HREF, NIVEL, diaCorto, horaPy, numero, type PanelSeguimiento,
} from "@/components/informe-diario/tipos";
import { apiFetch } from "@/lib/api";

/** Seguimiento de los informes diarios (superadmin): quién lo presenta, compromisos, palabras clave y comentarios. */
export default function SeguimientoInformesPage() {
  return (
    <AppShell>
      <Seguimiento />
    </AppShell>
  );
}

function hoyPy(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function menos(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function Seguimiento() {
  const { isSuperadmin } = useSession();
  const hoy = hoyPy();
  const [rango, setRango] = useState({ desde: menos(hoy, 13), hasta: hoy });
  const [autor, setAutor] = useState("");
  const [p, setP] = useState<PanelSeguimiento | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [diccionario, setDiccionario] = useState(false);

  const load = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const q = new URLSearchParams({ desde: rango.desde, hasta: rango.hasta });
      if (autor) q.set("autor_id", autor);
      setP(await apiFetch<PanelSeguimiento>(`${ID_API}/seguimiento?${q}`));
    } catch (e: any) { setError(e.message); } finally { setCargando(false); }
  }, [rango, autor]);
  useEffect(() => { if (isSuperadmin) load(); }, [load, isSuperadmin]);

  if (!isSuperadmin) {
    return <div className="card p-6 text-sm text-brand-slate flex items-center gap-2"><ShieldAlert size={16} /> El seguimiento de los informes es del superadmin.</div>;
  }
  const presets = [
    { label: "7 días", desde: menos(hoy, 6), hasta: hoy },
    { label: "14 días", desde: menos(hoy, 13), hasta: hoy },
    { label: "30 días", desde: menos(hoy, 29), hasta: hoy },
    { label: "Este mes", desde: `${hoy.slice(0, 7)}-01`, hasta: hoy },
  ];
  const k = p?.kpis;

  return (
    <>
      <Link href={ID_HREF} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-slate hover:text-brand-primary mb-4 print:hidden">
        <ArrowLeft size={14} /> Mis informes
      </Link>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Informe diario · Superadmin</div>
          <h1 className="font-display text-4xl sm:text-5xl text-brand-ink uppercase leading-tight">Seguimiento de informes</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-3xl">
            Quién presenta su informe cada día, los compromisos abiertos y vencidos, las palabras clave que se repiten y los informes
            por revisar o comentar.
          </p>
        </div>
      </div>

      <section className="card p-4 mb-6 flex flex-wrap items-end gap-3 print:hidden" aria-label="Filtros">
        <div>
          <div className="label">Período</div>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((x) => {
              const on = rango.desde === x.desde && rango.hasta === x.hasta;
              return (
                <button key={x.label} type="button" aria-pressed={on} onClick={() => setRango({ desde: x.desde, hasta: x.hasta })}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${on ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border text-brand-graphite hover:border-brand-slate"}`}>
                  {x.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="label" htmlFor="s-desde">Desde</label>
            <input id="s-desde" type="date" className="input !py-1.5 tabular-nums w-[150px]" value={rango.desde} max={rango.hasta}
              onChange={(e) => e.target.value && setRango((r) => ({ ...r, desde: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="s-hasta">Hasta</label>
            <input id="s-hasta" type="date" className="input !py-1.5 tabular-nums w-[150px]" value={rango.hasta} min={rango.desde} max={hoy}
              onChange={(e) => e.target.value && setRango((r) => ({ ...r, hasta: e.target.value }))} />
          </div>
        </div>
        <div className="min-w-[200px]">
          <label className="label" htmlFor="s-autor">Autor</label>
          <select id="s-autor" className="input !py-1.5" value={autor} onChange={(e) => setAutor(e.target.value)}>
            <option value="">Todos</option>
            {p?.opciones.autores.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </div>
        {cargando && p && <span className="text-[11px] text-brand-slate ml-auto" role="status">Actualizando…</span>}
      </section>

      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {!p || !k ? (!error && <div className="card p-10 text-brand-slate">Cargando…</div>) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Kpi titulo="Cumplimiento" valor={k.pct_cumplimiento === null ? "—" : `${numero(k.pct_cumplimiento, 0)}%`} alerta={k.pct_cumplimiento !== null && k.pct_cumplimiento < 80}
              sub={<>{k.esperados - k.faltan} de {k.esperados} días hábiles con informe firmado{k.faltan ? <> · <b className="text-brand-primary-dark">{k.faltan} sin informe</b></> : ""}</>}
              icono={<CircleCheck size={15} className="text-emerald-600" aria-hidden />} />
            <Kpi titulo="Informes firmados" valor={numero(k.firmados)} sub={k.borradores ? `${k.borradores} borrador(es) sin firmar` : "Sin borradores pendientes"}
              icono={<ClipboardList size={15} className="text-brand-slate" aria-hidden />} />
            <Kpi titulo="Sin revisar" valor={numero(k.sin_revisar)} sub={`${k.comentarios} comentario(s) en el período`}
              icono={<MessageSquareText size={15} className="text-[#1D5BA6]" aria-hidden />} />
            <Kpi titulo="Alertas altas" valor={numero(k.alertas)} alerta={k.alertas > 0} sub="Informes con 3 o más menciones de temas críticos"
              icono={<TriangleAlert size={15} className={k.alertas ? "text-brand-primary" : "text-brand-slate"} aria-hidden />} />
            <Kpi titulo="Compromisos abiertos" valor={numero(k.compromisos_abiertos)} alerta={k.compromisos_vencidos > 0}
              sub={<>{k.compromisos_vencidos ? <b className="text-brand-primary-dark">{k.compromisos_vencidos} vencido(s)</b> : "Ninguno vencido"} · {k.cumplidos} cumplido(s) y {k.no_cumplidos} no cumplido(s) en el período</>}
              icono={<CalendarClock size={15} className="text-brand-slate" aria-hidden />} />
          </div>

          <Matriz p={p} />

          <div className="grid xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-5 items-start">
            <Palabras p={p} onDiccionario={() => setDiccionario(true)} />
            <Alertas p={p} />
          </div>

          <div className="grid xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-5 items-start">
            {/* ---- informes */}
            <section className="card min-w-0">
              <div className="px-5 pt-5 pb-3">
                <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Informes del período</h2>
                <p className="text-xs text-brand-slate mt-0.5">Abrí cada uno para leerlo con las palabras clave resaltadas, comentarlo y marcarlo revisado.</p>
              </div>
              {!p.informes.length ? <p className="px-5 py-8 text-center text-sm text-brand-slate border-t border-brand-border">Sin informes en el período.</p> : (
                <ul className="divide-y divide-brand-border border-t border-brand-border">
                  {p.informes.map((x) => (
                    <li key={x.id}>
                      <Link href={`${ID_HREF}/${x.id}`} className="px-5 py-3 flex gap-3 hover:bg-brand-bg-soft transition-colors">
                        <div className="w-11 shrink-0 text-center rounded-md border border-brand-border py-1 h-fit">
                          <div className="font-display text-xl leading-none text-brand-ink tabular-nums">{x.fecha.slice(8, 10)}</div>
                          <div className="text-[9px] uppercase tracking-wider2 text-brand-slate">{diaCorto(x.fecha).split(" ")[0]}</div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-sm text-brand-ink">{x.autor}</span>
                            {x.estado === "firmado" ? <Chip chip={CHIP.VERDE}>Firmado {x.hora ?? ""}</Chip> : <Chip chip={CHIP.NARANJA}>Borrador</Chip>}
                            {x.nivel && x.nivel !== "bajo" && <Chip chip={NIVEL[x.nivel].chip} icono={<TriangleAlert size={10} aria-hidden />}>{NIVEL[x.nivel].label}</Chip>}
                            {x.estado === "firmado" && !x.revisado_at && <Chip chip={CHIP.AZUL}>Sin revisar</Chip>}
                            {x.comentarios > 0 && <span className="text-[11px] text-brand-slate inline-flex items-center gap-1"><MessageSquareText size={11} aria-hidden /> {x.comentarios}</span>}
                          </div>
                          <div className="text-xs text-brand-graphite mt-0.5 tabular-nums">Pospago <b>{numero(x.pospago)}</b> · GPON <b>{numero(x.gpon)}</b> · {x.metricas} métrica(s){x.criticas ? `, ${x.criticas} crítica(s)` : ""}</div>
                          {x.resumen && <p className="text-xs text-brand-slate mt-0.5 line-clamp-2">{x.resumen}</p>}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ---- compromisos */}
            <section className="card min-w-0">
              <div className="px-5 pt-5 pb-3">
                <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Compromisos abiertos</h2>
                <p className="text-xs text-brand-slate mt-0.5">Los que todavía no se cerraron (primero los vencidos).</p>
              </div>
              {!p.compromisos.length ? <p className="px-5 py-8 text-center text-sm text-brand-slate border-t border-brand-border">Sin compromisos abiertos.</p> : (
                <ul className="divide-y divide-brand-border border-t border-brand-border">
                  {p.compromisos.map((c) => (
                    <li key={c.id}>
                      <Link href={`${ID_HREF}/${c.informe_id}`} className={`block px-5 py-2.5 hover:bg-brand-bg-soft ${c.vencido ? "shadow-[inset_3px_0_0_#E6332A]" : ""}`}>
                        <div className="text-sm font-semibold text-brand-ink">{c.metrica} <span className="text-[11px] font-normal text-brand-slate">· {c.autor}</span></div>
                        <p className="text-xs text-brand-graphite line-clamp-2">{c.texto}</p>
                        <div className="text-[11px] text-brand-slate mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span>Del {diaCorto(c.fecha)}</span>
                          {c.fecha_limite && <span>· para el {diaCorto(c.fecha_limite)}</span>}
                          {c.vencido && <Chip chip={CHIP.ROJO} icono={<TriangleAlert size={10} aria-hidden />}>Vencido</Chip>}
                          {c.ultimo && <span>· en curso ({diaCorto(c.ultimo.fecha)})</span>}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <p className="text-[11px] text-brand-slate">Actualizado {horaPy(new Date().toISOString())} · del {diaCorto(p.desde)} al {diaCorto(p.hasta)}.</p>
        </div>
      )}
      {diccionario && <DialogoDiccionario onClose={() => setDiccionario(false)} onGuardado={load} />}
    </>
  );
}
