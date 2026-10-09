"use client";

import { AlertTriangle, ChevronRight, ClipboardList, FileText, NotebookPen, Ticket as TicketIcon, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { PrintButton } from "@/components/PrintButton";
import { fechaCorta, n, nombreMes } from "@/components/productividad/tipos";
import { EstadoCoaching, VerCoachingDialog } from "@/components/supervision/coaching";
import { BarraUmbral } from "@/components/supervision/comando";
import { Desglose, MedidorScore, Tendencia } from "@/components/supervision/scoring";
import { ListaTickets, TicketDialog } from "@/components/supervision/tickets";
import {
  ALERTA, METRICA, SUP_API, SUP_HREF, TIPO_COACHING, TIPO_NOTA, dm, num, periodoDeUrl, periodoEnUrl, sumarMeses,
  type FichaAsesor,
} from "@/components/supervision/tipos";
import { FuenteDatos, Identidades, LineasDialog, SelectorMes } from "@/components/supervision/ui";
import { apiFetch } from "@/lib/api";

/** Ficha de un asesor en el mes: del supervisor al asesor y del asesor a sus líneas y tickets (jefes). */
export default function FichaAsesorPage() {
  return (
    <AppShell>
      <Ficha />
    </AppShell>
  );
}

function Tarjeta({ titulo, sub, icono, children, accion }: { titulo: string; sub?: ReactNode; icono?: ReactNode; children: ReactNode; accion?: ReactNode }) {
  return (
    <section className="card min-w-0">
      <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-display text-xl uppercase text-brand-ink leading-tight inline-flex items-center gap-2">{icono}{titulo}</h2>
          {sub && <p className="text-xs text-brand-slate mt-0.5">{sub}</p>}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}

function Vacio({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-brand-slate border-t border-brand-border">{children}</p>;
}

function Ficha() {
  const { id } = useParams<{ id: string }>();
  const [periodo, setPeriodo] = useState(periodoDeUrl);
  const [d, setD] = useState<FichaAsesor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lineas, setLineas] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);
  const [coaching, setCoaching] = useState<string | null>(null);

  const cargar = useCallback(async (p: string) => {
    setError(null);
    try { setD(await apiFetch<FichaAsesor>(`${SUP_API}/asesores/${id}?periodo=${p}`)); } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { setD(null); cargar(periodo); periodoEnUrl(periodo); }, [periodo, cargar]);

  const a = d?.asesor;
  const sc = d?.scoring;
  const pr = d && sc ? { min_evaluables: d.parametros.min_evaluables, min_horas: sc.parametros.min_horas_conversacion } : undefined;
  return (
    <>
      <nav aria-label="Ruta" className="flex items-center gap-1 text-xs font-semibold text-brand-slate mb-4 flex-wrap print:hidden">
        <Link href={`${SUP_HREF}/comando`} className="hover:text-brand-primary">Centro de comandos</Link>
        {d?.supervisor && (
          <>
            <ChevronRight size={13} aria-hidden />
            <Link href={`${SUP_HREF}/supervisores/${d.supervisor.id}?periodo=${periodo}`} className="hover:text-brand-primary">{d.supervisor.nombre}</Link>
          </>
        )}
        <ChevronRight size={13} aria-hidden />
        <span className="text-brand-ink">{a?.nombre ?? "…"}</span>
      </nav>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Asesor · {nombreMes(periodo)}</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight flex items-center gap-3 flex-wrap">
            {a?.nombre ?? "…"}
            {d?.uso?.alerta && (
              <span className="inline-flex items-center gap-1 rounded bg-brand-primary text-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider2 font-sans">
                <AlertTriangle size={11} aria-hidden /> En alerta de uso
              </span>
            )}
            {a && !a.activo && <span className="badge-neutral font-sans">Inactivo</span>}
          </h1>
          {a && (
            <div className="mt-1">
              <Identidades agente={a.agente} vendedor={a.vendedor} subcanal={a.subcanal} />
              {a.legajo && <div className="text-[11px] text-brand-slate mt-0.5">Legajo {a.legajo}</div>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap print:hidden">
          <SelectorMes periodo={periodo} onChange={setPeriodo} />
          <PrintButton />
        </div>
      </div>
      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {!d || !a ? (
        !error && <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : (
        <div className="space-y-6">
          <FuenteDatos ventas={d.ventas} cal={d.calendario} />
          <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-5 items-start">
            {/* Scoring */}
            <section className="card p-5 min-w-0 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-lg uppercase text-brand-ink leading-tight">Scoring del mes</h2>
                {sc?.parcial && <span className="text-[10px] font-semibold uppercase tracking-wider2 text-brand-mist">Parcial</span>}
              </div>
              {sc ? (
                <>
                  <div>
                    <div className="font-display text-5xl text-brand-ink leading-none tabular-nums">
                      {sc.total === null ? "—" : num(sc.total, 0)}<span className="text-lg text-brand-slate"> / 100</span>
                    </div>
                    <div className="mt-1.5"><Tendencia actual={sc.total} anterior={sc.anterior} mes={nombreMes(sumarMeses(d.periodo, -1))} /></div>
                  </div>
                  <MedidorScore total={sc.parcial ? null : sc.total} />
                  <Desglose comps={sc.componentes} pr={pr} />
                  <p className="text-[11px] text-brand-slate">
                    {sc.dias !== null ? <>Días trabajados en el equipo hasta el corte: <b className="text-brand-ink tabular-nums">{num(sc.dias)}</b>. </> : null}
                    Pospago y GPON contra la parte del objetivo del equipo que le toca por esos días.
                  </p>
                </>
              ) : <p className="text-sm text-brand-slate">Sin actividad para puntuar en el mes.</p>}
            </section>

            <div className="space-y-5 min-w-0">
              {/* Ventas y uso */}
              <section className={`card p-5 min-w-0 flex flex-col gap-4 ${d.uso?.alerta ? "border-brand-primary/40" : ""}`}>
                <h2 className="font-display text-lg uppercase text-brand-ink leading-tight">Ventas y uso de líneas</h2>
                <dl className="grid grid-cols-2 gap-3">
                  <div><dt className="text-xs text-brand-slate">Pospago</dt><dd className="font-display text-4xl text-brand-ink tabular-nums leading-none mt-1">{d.netas ? n(d.netas.pospago) : "—"}</dd></div>
                  <div><dt className="text-xs text-brand-slate">GPON</dt><dd className="font-display text-4xl text-brand-ink tabular-nums leading-none mt-1">{d.netas ? n(d.netas.gpon) : "—"}</dd></div>
                </dl>
                {d.uso && d.uso.evaluables ? (
                  <div className="pt-3 border-t border-brand-border space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-brand-slate">Sin uso</span>
                      <span className={`font-display text-3xl tabular-nums leading-none ${d.uso.alerta ? "text-brand-primary-dark" : "text-brand-ink"}`}>{num(d.uso.pct_sin_uso)}%</span>
                    </div>
                    <BarraUmbral pct={d.uso.pct_sin_uso} umbral={d.parametros.umbral_sin_uso} />
                    <p className="text-[11px] text-brand-slate">
                      {n(d.uso.sin_uso)} de {n(d.uso.evaluables)} Pospago evaluables sin uso · umbral {num(d.parametros.umbral_sin_uso)}%
                      {d.uso.alerta && <> · <b className="text-brand-primary-dark">recuperar {n(d.uso.a_recuperar)}</b></>}
                      {!!d.uso.en_espera && <> · {n(d.uso.en_espera)} en espera</>}
                    </p>
                  </div>
                ) : <p className="text-xs text-brand-slate pt-3 border-t border-brand-border">Sin líneas Pospago evaluables en el mes.</p>}
                {!!(d.uso && (d.uso.sin_uso || d.uso.en_espera)) && (
                  <button type="button" className="btn-secondary !py-2 self-start" onClick={() => setLineas(true)}><FileText size={15} aria-hidden /> Ver líneas sin uso</button>
                )}
              </section>

              {/* Equipo */}
              <section className="card p-5 min-w-0 flex flex-col gap-3">
                <h2 className="font-display text-lg uppercase text-brand-ink leading-tight inline-flex items-center gap-2"><Users size={17} aria-hidden /> Equipo</h2>
                <div>
                  <div className="text-xs text-brand-slate">Supervisor hoy</div>
                  {d.supervisor ? (
                    <Link href={`${SUP_HREF}/supervisores/${d.supervisor.id}?periodo=${periodo}`} className="text-base font-semibold text-brand-ink hover:text-brand-primary">{d.supervisor.nombre}</Link>
                  ) : <div className="text-base font-semibold text-brand-primary-dark">Sin supervisor</div>}
                </div>
                <div>
                  <div className="text-xs text-brand-slate mb-1.5">En {d.nombre_mes.toLowerCase()}</div>
                  {d.tramos.length ? (
                    <ol className="space-y-1.5">
                      {d.tramos.map((t) => (
                        <li key={t.desde} className="flex items-center gap-2 text-sm">
                          <span className="tabular-nums text-[11px] text-brand-slate w-[92px] shrink-0">{dm(t.desde)} – {dm(t.hasta)}</span>
                          <span className={`font-semibold ${t.supervisor ? "text-brand-ink" : "text-brand-mist"}`}>{t.supervisor ?? "Sin supervisor"}</span>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="text-sm text-brand-slate">No estuvo en ningún equipo este mes.</p>}
                </div>
                {a.ultima_vez && <p className="text-[11px] text-brand-slate">Última actividad en los informes: {fechaCorta(a.ultima_vez)}.</p>}
              </section>
            </div>
          </div>

          {d.alertas_uso.length > 0 && (
            <Tarjeta titulo="Alertas de uso" icono={<AlertTriangle size={17} aria-hidden />}
              sub={`Cuándo apareció cada una y si tuvo coaching sobre uso de líneas dentro de los ${sc?.parametros.dias_foco ?? 5} días hábiles.`}>
              <ul className="divide-y divide-brand-border border-t border-brand-border">
                {d.alertas_uso.map((x) => {
                  const e = ALERTA[x.estado];
                  return (
                    <li key={x.id} className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                      <div className="text-sm">
                        <span className="font-semibold text-brand-ink">Desde el {dm(x.desde)}</span>
                        <span className="text-brand-slate"> · plazo para el coaching: {dm(x.vence)}{x.hasta && ` · salió de la alerta el ${dm(x.hasta)}`}</span>
                        {x.datos.pct_sin_uso !== undefined && (
                          <div className="text-[11px] text-brand-slate">{num(x.datos.pct_sin_uso)}% sin uso al aparecer ({n(x.datos.sin_uso ?? 0)} de {n(x.datos.evaluables ?? 0)})</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span title={e.ayuda} className={`inline-flex items-center rounded border px-1.5 py-0 text-[10px] font-semibold ${e.chip}`}>{e.label}</span>
                        {x.coaching_id && <button type="button" className="text-xs font-semibold text-brand-primary hover:underline" onClick={() => setCoaching(x.coaching_id!)}>Ver coaching</button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Tarjeta>
          )}

          <div className="grid xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-6 items-start">
            <div className="space-y-6 min-w-0">
              <Tarjeta titulo="Coachings" icono={<ClipboardList size={17} aria-hidden />}
                sub={`Los de ${d.nombre_mes.toLowerCase()} (de cualquier supervisor) y los que todavía esperan su seguimiento.`}>
                {d.coachings.length ? (
                  <ul className="divide-y divide-brand-border border-t border-brand-border">
                    {d.coachings.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => setCoaching(c.id)}
                          className={`w-full text-left px-5 py-3 hover:bg-brand-bg-soft transition-colors ${c.estado === "anulado" ? "opacity-60" : ""}`}>
                          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
                            <span className="text-sm font-semibold text-brand-ink">{METRICA[c.metrica].label}</span>
                            <span className="text-xs text-brand-slate">· {TIPO_COACHING[c.tipo].label} · {fechaCorta(c.fecha)} · {c.supervisor}</span>
                            <EstadoCoaching c={c} />
                          </div>
                          <p className={`text-xs mt-0.5 line-clamp-1 ${c.estado === "anulado" ? "line-through text-brand-slate" : "text-brand-graphite"}`}>{c.compromiso}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <Vacio>Sin coachings en el mes.</Vacio>}
              </Tarjeta>
              <Tarjeta titulo="Tickets" icono={<TicketIcon size={17} aria-hidden />} sub="Los casos de revisión sobre este asesor de los últimos 4 meses (y los abiertos).">
                <ListaTickets items={d.tickets} dia={d.dia_completo} onAbrir={(t) => setTicket(t.id)} vacio="Sin tickets sobre este asesor." />
              </Tarjeta>
            </div>
            <Tarjeta titulo="Bitácora" icono={<NotebookPen size={17} aria-hidden />} sub="Notas de los supervisores sobre este asesor en el mes.">
              {d.notas.length ? (
                <ul className="divide-y divide-brand-border border-t border-brand-border">
                  {d.notas.map((x) => (
                    <li key={x.id} className="px-5 py-3">
                      <div className="flex items-center gap-2 flex-wrap text-[11px] text-brand-slate">
                        <span className={`inline-flex items-center rounded border px-1.5 py-0 text-[10px] font-semibold ${TIPO_NOTA[x.tipo].chip}`}>{TIPO_NOTA[x.tipo].label}</span>
                        <span>{fechaCorta(x.fecha)} · {x.supervisor}</span>
                      </div>
                      <p className="text-sm text-brand-graphite mt-1 whitespace-pre-line break-words">{x.texto}</p>
                    </li>
                  ))}
                </ul>
              ) : <Vacio>Sin notas sobre este asesor en el mes.</Vacio>}
            </Tarjeta>
          </div>
        </div>
      )}
      <LineasDialog url={lineas ? `${SUP_API}/lineas?periodo=${periodo}&operador_id=${id}` : null} onClose={() => setLineas(false)} />
      {ticket && <TicketDialog id={ticket} portal={false} onClose={() => setTicket(null)} onCambio={() => cargar(periodo)} />}
      {coaching && <VerCoachingDialog id={coaching} onClose={() => setCoaching(null)} />}
    </>
  );
}
