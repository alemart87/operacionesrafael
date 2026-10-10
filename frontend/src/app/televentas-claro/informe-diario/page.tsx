"use client";

import {
  ArrowRight, CalendarClock, CircleCheck, CircleDashed, FileDown, MessageSquareText, Radar, ShieldCheck, TriangleAlert, X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { PrepararInforme } from "@/components/informe-diario/boton";
import { Chip } from "@/components/informe-diario/campos";
import {
  CHIP, ID_API, ID_HREF, diaCorto, diaLargo, horaPy, inicialDia, numero, type DiaRacha, type MisInformes,
} from "@/components/informe-diario/tipos";
import { apiFetch, downloadFile } from "@/lib/api";

/** Mis informes diarios: preparar el de hoy, los últimos días, compromisos abiertos y comentarios. */
export default function InformeDiarioPage() {
  return (
    <AppShell>
      <MisInformesVista />
    </AppShell>
  );
}

const RACHA: Record<DiaRacha["estado"], { cls: string; label: string }> = {
  firmado: { cls: "bg-emerald-500 border-emerald-500 text-white", label: "Firmado" },
  borrador: { cls: "bg-brand-orange/15 border-brand-orange text-[#8A5200]", label: "Borrador" },
  falta: { cls: "bg-white border-brand-primary/50 text-brand-primary-dark border-dashed", label: "Sin informe" },
  hoy: { cls: "bg-white border-brand-ink text-brand-ink ring-2 ring-brand-ink/10", label: "Hoy" },
  libre: { cls: "bg-brand-bg border-brand-border text-brand-mist", label: "Sin actividad" },
};

function Racha({ dias }: { dias: DiaRacha[] }) {
  // En el celular no entran los 14: se muestra el final (lo más reciente).
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth; }, [dias]);
  return (
    <ol ref={ref} className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Últimos 14 días">
      {dias.map((x) => {
        const e = RACHA[x.estado];
        const cuerpo = (
          <>
            <span className="text-[9px] uppercase tracking-wider2 opacity-80">{inicialDia(x.fecha)}</span>
            <span className="font-display text-base leading-none tabular-nums">{x.fecha.slice(8, 10)}</span>
            {x.estado === "firmado" ? <CircleCheck size={11} aria-hidden /> : x.estado === "borrador" ? <CircleDashed size={11} aria-hidden /> : x.estado === "falta" ? <X size={11} aria-hidden /> : <span className="h-[11px]" />}
          </>
        );
        const cls = `w-10 shrink-0 rounded-md border flex flex-col items-center gap-0.5 py-1.5 ${e.cls}`;
        return (
          <li key={x.fecha} title={`${diaCorto(x.fecha)} · ${e.label}`}>
            {x.id ? <Link href={`${ID_HREF}/${x.id}`} className={`${cls} hover:opacity-90`}>{cuerpo}</Link> : <div className={cls}>{cuerpo}</div>}
          </li>
        );
      })}
    </ol>
  );
}

function MisInformesVista() {
  const { isSuperadmin } = useSession();
  const [d, setD] = useState<MisInformes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [otraFecha, setOtraFecha] = useState("");
  const load = useCallback(async () => {
    try { setD(await apiFetch<MisInformes>(ID_API)); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const minFecha = d ? (() => { const x = new Date(`${d.hoy}T12:00:00`); x.setDate(x.getDate() - d.dias_atras_max); return x.toISOString().slice(0, 10); })() : undefined;
  const h = d?.de_hoy;

  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Televentas Claro</div>
          <h1 className="font-display text-4xl sm:text-5xl text-brand-ink uppercase leading-tight">Informe diario</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-2xl">
            El seguimiento diario de la operación: resultados del día, datos de la plataforma, resumen, métricas críticas con sus
            compromisos y tu firma. Se guarda con fecha y se descarga en PDF para enviar.
          </p>
        </div>
        {isSuperadmin && (
          <Link href={`${ID_HREF}/seguimiento`} className="btn-secondary !py-2 !px-4 text-xs"><Radar size={15} /> Seguimiento de todos</Link>
        )}
      </div>
      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {!d ? (!error && <div className="card p-10 text-brand-slate">Cargando…</div>) : (
        <div className="space-y-6">
          {/* ---- hoy */}
          <section className="card overflow-visible p-5 sm:p-6 border-brand-primary/30 bg-gradient-to-r from-brand-primary-light/70 via-white to-white">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Hoy · {diaLargo(d.hoy)}</div>
                <h2 className="font-display text-2xl sm:text-3xl uppercase text-brand-ink leading-tight mt-1">
                  {!h ? "Todavía no preparaste el informe de hoy" : h.estado === "borrador" ? "Tenés el informe de hoy en borrador" : "Informe de hoy firmado"}
                </h2>
                {h && (
                  <p className="text-sm text-brand-graphite mt-1">
                    Pospago {numero(h.pospago)} · GPON {numero(h.gpon)} · {h.metricas} métrica(s) crítica(s)
                    {h.estado === "firmado" ? <> · firmado {horaPy(h.firmado_at)} · <span className="inline-flex items-center gap-1"><ShieldCheck size={13} aria-hidden /> {h.codigo}</span></> : <> · guardado {horaPy(h.updated_at)}</>}
                  </p>
                )}
              </div>
              <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
                {h?.estado === "firmado" ? (
                  <>
                    <button type="button" className="btn-secondary" onClick={() => downloadFile(`${ID_API}/${h.id}/pdf`).catch((e) => setError(e.message))}>
                      <FileDown size={16} /> Descargar PDF
                    </button>
                    <Link href={`${ID_HREF}/${h.id}`} className="btn-primary !px-6 !py-3 text-base">Ver el informe <ArrowRight size={17} /></Link>
                  </>
                ) : (
                  <PrepararInforme className="btn-primary !px-6 !py-3.5 text-base shadow-elevated" onError={setError}>
                    {h ? "Seguir con el informe de hoy" : "Preparar informe diario"}
                  </PrepararInforme>
                )}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0 max-w-full">
                <div className="text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate mb-1.5">Últimos 14 días</div>
                <Racha dias={d.racha} />
              </div>
              <div className="flex items-end gap-2">
                <div>
                  <label className="label" htmlFor="otra-fecha">Preparar otro día</label>
                  <input id="otra-fecha" type="date" className="input !py-1.5 tabular-nums w-[160px]" min={minFecha} max={d.hoy}
                    value={otraFecha} onChange={(e) => setOtraFecha(e.target.value)} />
                </div>
                {otraFecha && <PrepararInforme fecha={otraFecha} className="btn-secondary !py-2 !px-3 text-xs" onError={setError}>Abrir</PrepararInforme>}
              </div>
            </div>
          </section>

          {d.nuevos > 0 && (
            <div className="rounded-md border border-[#2A78D6]/30 bg-[#2A78D6]/10 px-4 py-3 text-sm text-[#1D5BA6] flex items-center gap-2">
              <MessageSquareText size={17} aria-hidden />
              <span>Tenés <b>{d.nuevos}</b> comentario{d.nuevos === 1 ? "" : "s"} nuevo{d.nuevos === 1 ? "" : "s"} del superadmin en tus informes.</span>
            </div>
          )}

          <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-5 items-start">
            {/* ---- historial */}
            <section className="card min-w-0">
              <div className="px-5 pt-5 pb-3">
                <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Mis informes</h2>
                <p className="text-xs text-brand-slate mt-0.5">Los últimos {Math.round((+new Date(d.hasta) - +new Date(d.desde)) / 86400000)} días.</p>
              </div>
              {!d.items.length ? (
                <p className="px-5 py-8 text-center text-sm text-brand-slate border-t border-brand-border">Todavía no hay informes.</p>
              ) : (
                <ul className="divide-y divide-brand-border border-t border-brand-border">
                  {d.items.map((x) => (
                    <li key={x.id}>
                      <Link href={`${ID_HREF}/${x.id}`} className="px-5 py-3 flex gap-3 hover:bg-brand-bg-soft transition-colors">
                        <div className="w-11 shrink-0 text-center rounded-md border border-brand-border py-1 h-fit">
                          <div className="font-display text-xl leading-none text-brand-ink tabular-nums">{x.fecha.slice(8, 10)}</div>
                          <div className="text-[9px] uppercase tracking-wider2 text-brand-slate">{diaCorto(x.fecha).split(" ")[0]}</div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {x.estado === "firmado" ? <Chip chip={CHIP.VERDE} icono={<CircleCheck size={10} aria-hidden />}>Firmado</Chip> : <Chip chip={CHIP.NARANJA}>Borrador</Chip>}
                            <span className="text-xs text-brand-graphite tabular-nums">Pospago <b>{numero(x.pospago)}</b> · GPON <b>{numero(x.gpon)}</b></span>
                            {x.criticas > 0 && <Chip chip={CHIP.ROJO}>{x.criticas} crítica{x.criticas === 1 ? "" : "s"}</Chip>}
                            {x.nuevos > 0 && <Chip chip={CHIP.AZUL} icono={<MessageSquareText size={10} aria-hidden />}>{x.nuevos} nuevo{x.nuevos === 1 ? "" : "s"}</Chip>}
                            {!x.nuevos && x.comentarios > 0 && <span className="text-[11px] text-brand-slate inline-flex items-center gap-1"><MessageSquareText size={11} aria-hidden /> {x.comentarios}</span>}
                            {x.revisado_at && <span className="text-[11px] text-emerald-700 inline-flex items-center gap-1"><CircleCheck size={11} aria-hidden /> revisado</span>}
                          </div>
                          {x.resumen && <p className="text-xs text-brand-slate mt-1 line-clamp-2">{x.resumen}</p>}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ---- compromisos abiertos */}
            <section className="card min-w-0">
              <div className="px-5 pt-5 pb-3">
                <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Compromisos abiertos</h2>
                <p className="text-xs text-brand-slate mt-0.5">
                  {d.compromisos.abiertos ? <>{d.compromisos.abiertos} por seguir en tu próximo informe{d.compromisos.vencidos ? <b className="text-brand-primary-dark"> · {d.compromisos.vencidos} vencido{d.compromisos.vencidos === 1 ? "" : "s"}</b> : ""}.</> : "No tenés compromisos abiertos."}
                </p>
              </div>
              {d.compromisos.items.length > 0 && (
                <ul className="divide-y divide-brand-border border-t border-brand-border">
                  {d.compromisos.items.map((c) => (
                    <li key={c.id} className={`px-5 py-3 ${c.vencido ? "shadow-[inset_3px_0_0_#E6332A]" : ""}`}>
                      <div className="text-sm font-semibold text-brand-ink">{c.metrica}</div>
                      <p className="text-xs text-brand-graphite line-clamp-2">{c.texto}</p>
                      <div className="text-[11px] text-brand-slate mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span>Del {diaCorto(c.fecha)}</span>
                        {c.fecha_limite && <span className="inline-flex items-center gap-1">· <CalendarClock size={11} aria-hidden /> {diaCorto(c.fecha_limite)}</span>}
                        {c.vencido && <Chip chip={CHIP.ROJO} icono={<TriangleAlert size={10} aria-hidden />}>Vencido</Chip>}
                        {c.ultimo && <span>· {c.ultimo.estado === "en_curso" ? "en curso" : c.ultimo.estado}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
