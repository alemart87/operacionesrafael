"use client";

import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Clock, Info, PhoneCall, PhoneOff, Trophy, Zap, Hand } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  BANDA, BANDAS, MODO_LABEL, TURNO_LABEL, horas, medida, n, pct, rangoBanda, reloj, segundos,
  type Agente, type Alerta, type Banda, type InfoContacto, type Parametros, type Resumen, type TramoExtremo, type Turnos,
} from "./tipos";

// ------------------------------------------------------------------ bandas
const ICONO_BANDA: Record<Banda, typeof AlertTriangle> = { rojo: AlertTriangle, bajo: ArrowDown, meta: CheckCircle2, sobre: ArrowUp };

export function IconoBanda({ banda, size = 14 }: { banda: Banda; size?: number }) {
  const I = ICONO_BANDA[banda];
  return <I size={size} aria-hidden />;
}

/** Estado frente a la meta: siempre color + ícono + texto (nunca solo color). */
export function BandaChip({ banda, valor, compacto }: { banda: Banda | null; valor?: number | null; compacto?: boolean }) {
  if (!banda) return <span className="text-brand-mist text-xs">—</span>;
  const b = BANDA[banda];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap tabular-nums ${b.chip}`}
      title={b.nombre}>
      <IconoBanda banda={banda} size={11} />
      {valor !== undefined ? pct(valor) : null}
      {!compacto && <span className={valor !== undefined ? "font-normal opacity-80" : ""}>{valor !== undefined ? ` · ${b.nombre}` : b.nombre}</span>}
    </span>
  );
}

// ------------------------------------------------------------------ indicador
export function Indicador({ titulo, valor, detalle, borde = "border-l-brand-ink", onClick, cta, icono }: {
  titulo: string; valor: ReactNode; detalle?: ReactNode; borde?: string; onClick?: () => void; cta?: string; icono?: ReactNode;
}) {
  const cuerpo = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">{titulo}</div>
        {icono && <span className="text-brand-mist">{icono}</span>}
      </div>
      <div className="mt-1.5 font-display text-3xl text-brand-ink leading-none tabular-nums">{valor}</div>
      {detalle && <div className="mt-2 text-xs text-brand-slate leading-snug">{detalle}</div>}
      {cta && <div className="mt-2.5 text-xs font-semibold text-brand-primary print:hidden">{cta} →</div>}
    </>
  );
  const cls = `card p-5 border-l-[3px] ${borde} text-left`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} transition-all hover:shadow-elevated hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-brand-primary`}>
      {cuerpo}
    </button>
  ) : <div className={cls}>{cuerpo}</div>;
}

// ------------------------------------------------------------------ avisos
export function AvisoContacto({ contacto }: { contacto: InfoContacto }) {
  if (contacto.exacto) return null;
  const { umbral, umbrales, regla } = contacto;
  const motivo = umbrales.length > 1
    ? <>los archivos miden las llamadas cortas con umbrales distintos ({umbrales.map((u) => `${u} s`).join(" y ")}).</>
    : umbral === null
      ? <>el archivo no indica desde cuántos segundos cuenta las llamadas cortas.</>
      : <>el archivo solo informa cuántas llamadas duraron <b>menos de {umbral} s</b> («Short Talk &lt; {umbral}s») y no separa las de {umbral} a {regla} s
        (contestador, mensaje de la operadora o corte durante la presentación).</>;
  return (
    <div className="rounded-md border border-brand-orange/40 bg-brand-orange/10 p-3.5 text-sm text-brand-graphite flex gap-3">
      <AlertTriangle size={18} className="text-brand-orange shrink-0 mt-0.5" />
      <div>
        <b>Con este reporte no se puede medir el contacto</b> (regla: {regla} s o más de conversación): {motivo}{" "}
        El contacto queda fuera del informe hasta que el reporte venga con «Short Talk &lt; {regla}s» o con el detalle de llamadas;
        el resto de los indicadores sí es válido.
      </div>
    </div>
  );
}

export function Avisos({ avisos, excluir }: { avisos: string[]; excluir?: string | null }) {
  const [abierto, setAbierto] = useState(false);
  const lista = avisos.filter((a) => a !== excluir);
  if (!lista.length) return null;
  return (
    <div className="rounded-md border border-brand-border bg-white p-3 text-xs text-brand-slate">
      <button type="button" onClick={() => setAbierto((v) => !v)} className="flex items-center gap-2 font-semibold text-brand-graphite">
        <Info size={14} /> {lista.length} nota(s) sobre los datos del archivo {abierto ? "▾" : "▸"}
      </button>
      {abierto && <ul className="mt-2 space-y-1 list-disc pl-6">{lista.map((a, i) => <li key={i}>{a}</li>)}</ul>}
    </div>
  );
}

// ------------------------------------------------------------------ meta de conversación (semáforo)
/**
 * % de conversación del equipo contra la meta: escala con las cuatro zonas, marca del equipo,
 * cada agente como una muesca, y el conteo por banda (clic → lista de esos agentes).
 */
export function MetaConversacion({ r, agentes, p, onVerBanda, titulo = "Meta de conversación" }: {
  r: Resumen; agentes: Agente[]; p: Parametros; onVerBanda: (b: Banda) => void; titulo?: string;
}) {
  const valor = r.pct_conversacion;
  const tope = Math.max(70, Math.ceil(((Math.max(valor ?? 0, ...agentes.map((a) => a.pct_conversacion ?? 0)) + 5) / 10)) * 10);
  const x = (v: number) => `${Math.min(Math.max(v / tope, 0), 1) * 100}%`;
  const zonas: { b: Banda; desde: number; hasta: number }[] = [
    { b: "rojo", desde: 0, hasta: p.rojo }, { b: "bajo", desde: p.rojo, hasta: p.meta_min },
    { b: "meta", desde: p.meta_min, hasta: p.meta_max }, { b: "sobre", desde: p.meta_max, hasta: tope },
  ];
  const bandas = r.bandas ?? { rojo: 0, bajo: 0, meta: 0, sobre: 0 };
  const evaluados = BANDAS.reduce((s, b) => s + bandas[b], 0);
  const banda = r.banda;
  return (
    <section className="card p-5 lg:col-span-2 min-w-0">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-lg uppercase text-brand-ink leading-tight">{titulo}</h2>
          <p className="text-xs text-brand-slate mt-0.5">
            Tiempo de conversación ÷ tiempo conectado. Meta: <b>{p.meta_min}% a {p.meta_max}%</b> · debajo de {p.rojo}%, rojo.
          </p>
        </div>
        {banda && (
          <div className="text-right">
            <div className="font-display text-4xl leading-none tabular-nums" style={{ color: BANDA[banda].color }}>{pct(valor)}</div>
            <div className="mt-1"><BandaChip banda={banda} /></div>
          </div>
        )}
      </div>

      {/* Escala */}
      <div className="mt-6 mb-2 relative" role="img" aria-label={`Equipo ${pct(valor)}; meta entre ${p.meta_min}% y ${p.meta_max}%`}>
        <div className="flex h-3 rounded-full overflow-hidden">
          {zonas.map((z) => (
            <div key={z.b} style={{ width: `${((z.hasta - z.desde) / tope) * 100}%`, background: BANDA[z.b].color, opacity: z.b === "meta" ? 0.9 : 0.35 }} />
          ))}
        </div>
        {/* agentes */}
        <div className="absolute inset-x-0 top-0 h-3 pointer-events-none">
          {agentes.filter((a) => a.pct_conversacion !== null && a.banda).map((a) => (
            <span key={a.clave} className="absolute top-[-3px] w-[2px] h-[18px] rounded-full bg-brand-ink/45" style={{ left: x(a.pct_conversacion!) }} />
          ))}
        </div>
        {valor !== null && (
          <div className="absolute -top-2.5 -translate-x-1/2 flex flex-col items-center" style={{ left: x(valor) }}>
            <span className="w-4 h-4 rounded-full border-[3px] border-white shadow-elevated" style={{ background: banda ? BANDA[banda].color : "#0F1116" }} />
          </div>
        )}
        <div className="relative h-5 mt-1 text-[10px] text-brand-slate tabular-nums">
          {[0, p.rojo, p.meta_min, p.meta_max].map((v) => (
            <span key={v} className="absolute -translate-x-1/2" style={{ left: x(v) }}>{v}%</span>
          ))}
          <span className="absolute right-0">{tope}%</span>
        </div>
      </div>
      <p className="text-[11px] text-brand-mist mb-4">Cada muesca es un agente; el círculo es el equipo.</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {BANDAS.map((b) => (
          <button key={b} type="button" onClick={() => onVerBanda(b)} disabled={!bandas[b]}
            className={`text-left rounded-lg border px-3 py-2.5 transition-all disabled:opacity-50 disabled:cursor-default enabled:hover:shadow-soft enabled:hover:-translate-y-0.5 ${BANDA[b].chip}`}>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider2"><IconoBanda banda={b} size={12} /> {BANDA[b].nombre}</div>
            <div className="font-display text-2xl leading-tight tabular-nums text-brand-ink">{n(bandas[b])}</div>
            <div className="text-[10px] opacity-80">{rangoBanda(b, p)} · {evaluados ? Math.round((bandas[b] / evaluados) * 100) : 0}%</div>
          </button>
        ))}
      </div>
      {bandas.rojo > 0 && (
        <button type="button" onClick={() => onVerBanda("rojo")} className="mt-4 btn-primary text-sm">
          <AlertTriangle size={15} /> Ver los {n(bandas.rojo)} agentes en rojo
        </button>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ contacto
export function ContactoCard({ r, contacto, mejor, peor, onVerHorario }: {
  r: Resumen; contacto: InfoContacto; mejor: TramoExtremo | null; peor: TramoExtremo | null; onVerHorario?: () => void;
}) {
  const m = medida(contacto);
  return (
    <section className="card p-5 flex flex-col min-w-0">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg uppercase text-brand-ink leading-tight">Efectividad de contacto</h2>
        <PhoneCall size={16} className="text-brand-mist" />
      </div>
      <p className="text-xs text-brand-slate mt-0.5">Contacto = llamada con <b>{m.regla} s o más</b> de conversación.</p>
      {m.exacto ? (
        <>
          <div className="mt-3 font-display text-4xl text-brand-ink leading-none tabular-nums">{pct(r.pct_contacto)}</div>
          <div className="text-xs text-brand-slate mt-1.5">{n(r.atendidas)} contactos de {n(r.llamadas)} llamadas</div>
          <div className="mt-3 h-2 rounded-full bg-brand-bg overflow-hidden" aria-hidden>
            <div className="h-full rounded-full bg-brand-cyan" style={{ width: `${r.pct_contacto ?? 0}%` }} />
          </div>
          {mejor ? (
            <div className="mt-4 space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-brand-slate">Mejor horario</span>
                <b className="text-emerald-700 tabular-nums">{mejor.desde}–{mejor.hasta} · {pct(mejor.pct_contacto)}</b>
              </div>
              {peor && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-brand-slate">Peor horario</span>
                  <b className="text-brand-primary-dark tabular-nums">{peor.desde}–{peor.hasta} · {pct(peor.pct_contacto)}</b>
                </div>
              )}
              {onVerHorario && <button type="button" onClick={onVerHorario} className="text-brand-primary font-semibold mt-1">Ver la curva por horario →</button>}
            </div>
          ) : (
            <p className="mt-4 text-[11px] text-brand-mist leading-snug">La efectividad por horario aparece cuando el día tiene varios cortes (por ejemplo, el reporte exportado cada hora).</p>
          )}
        </>
      ) : (
        <>
          <div className="mt-3 font-display text-3xl text-brand-mist leading-none">Sin medición</div>
          <p className="mt-2 text-xs text-brand-graphite leading-relaxed">
            El reporte trae solo las llamadas de menos de {m.umbral} s: no permite saber cuántas llegaron a {m.regla} s de conversación.
          </p>
          <div className="mt-3 rounded-md border border-brand-border bg-brand-bg-soft p-3 text-[11px] text-brand-slate leading-relaxed">
            <b className="text-brand-ink">Qué hace falta:</b> que la plataforma exporte la columna «Short Talk &lt; {m.regla}s» en este mismo reporte
            (el sistema la reconoce sola) o el detalle de llamadas con su duración.
          </div>
          <p className="mt-3 text-[11px] text-brand-mist">{n(r.llamadas)} llamadas · {(r.llamadas_hora ?? 0).toLocaleString("es-PY")} por hora conectada.</p>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ jornada y turnos
export function JornadaTurnos({ r, turnos, compacto }: { r: Resumen; turnos: Turnos; compacto?: boolean }) {
  const filas = turnos.determinado ? (["manana", "tarde"] as const).filter((t) => turnos[t]) : [];
  return (
    <section className={`card p-5 min-w-0 ${compacto ? "" : "flex flex-col"}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg uppercase text-brand-ink leading-tight">Jornada laboral</h2>
        <Clock size={16} className="text-brand-mist" />
      </div>
      <p className="text-xs text-brand-slate mt-0.5">Tiempo medio conectado por agente (sin sesiones abiertas).</p>
      <div className="mt-3 font-display text-4xl text-brand-ink leading-none tabular-nums">{horas(r.jornada_media)}</div>
      <div className="text-xs text-brand-slate mt-1.5">{n(r.dias_validos)} jornadas válidas · pausa {pct(r.pct_pausa)} del tiempo</div>
      {filas.length ? (
        <div className="mt-4 space-y-2">
          {filas.map((t) => {
            const x = turnos[t]!;
            return (
              <div key={t} className="rounded-md border border-brand-border px-3 py-2">
                <div className="flex items-center justify-between text-xs">
                  <b className="text-brand-ink">{TURNO_LABEL[t]}</b>
                  <span className="tabular-nums text-brand-slate">
                    {turnos.dias ? `${n(x.dias_validos)} jornadas en ${n(turnos.dias)} día(s)` : `${n(x.dias_validos)} agentes`}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs mt-1 tabular-nums">
                  <span>Jornada <b>{horas(x.jornada_media)}</b></span>
                  <span>Contacto <b>{pct(x.pct_contacto)}</b></span>
                  <BandaChip banda={x.banda} valor={x.pct_conversacion} compacto />
                </div>
              </div>
            );
          })}
          {turnos.corte && <p className="text-[10px] text-brand-mist">Turno según el corte de las {turnos.corte}.</p>}
        </div>
      ) : (
        <p className="mt-4 text-[11px] text-brand-mist leading-snug">{turnos.motivo}</p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ discador automático vs manual
export function ComparacionModos({ modos, contacto, periodo }: { modos: { auto: Resumen; manual: Resumen }; contacto: InfoContacto; periodo?: boolean }) {
  const filas: { label: string; f: (r: Resumen) => ReactNode }[] = [
    periodo
      ? { label: "Agentes por día", f: (r) => (r.agentes_por_dia ?? 0).toLocaleString("es-PY") }
      : { label: "Agentes", f: (r) => n(r.dias) },
    { label: "Llamadas", f: (r) => n(r.llamadas) },
    ...(medida(contacto).exacto ? [{ label: medida(contacto).rotulo, f: (r: Resumen) => <>{n(r.atendidas)} <span className="text-brand-slate">· {pct(r.pct_contacto)}</span></> }] : []),
    { label: "% de conversación", f: (r) => <BandaChip banda={r.banda} valor={r.pct_conversacion} compacto /> },
    { label: "Promedio de conversación", f: (r) => segundos(r.prom_conversacion) },
    { label: "Llamadas por hora conectada", f: (r) => (r.llamadas_hora ?? 0).toLocaleString("es-PY") },
    { label: "AHT", f: (r) => segundos(r.aht) },
    { label: "Jornada media", f: (r) => horas(r.jornada_media) },
  ];
  const total = (modos.auto.llamadas || 0) + (modos.manual.llamadas || 0);
  return (
    <section className="card p-5 min-w-0">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="font-display text-lg uppercase text-brand-ink leading-tight">Discador automático vs. discado manual</h2>
          <p className="text-xs text-brand-slate mt-0.5">Se detecta por agente: el discador automático registra tiempo de tipificación (ACW); el discado manual no.</p>
        </div>
        {total > 0 && (
          <div className="flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5"><Zap size={13} className="text-brand-ink" /> {Math.round((modos.auto.llamadas / total) * 100)}% de las llamadas</span>
            <span className="inline-flex items-center gap-1.5"><Hand size={13} className="text-brand-slate" /> {Math.round((modos.manual.llamadas / total) * 100)}%</span>
          </div>
        )}
      </div>
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
              <th className="text-left py-2 font-semibold" />
              <th className="text-right py-2 px-3 font-semibold"><span className="inline-flex items-center gap-1.5"><Zap size={12} /> {MODO_LABEL.auto}</span></th>
              <th className="text-right py-2 pl-3 font-semibold"><span className="inline-flex items-center gap-1.5"><Hand size={12} /> {MODO_LABEL.manual}</span></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.label} className="border-b border-brand-border/60 last:border-0">
                <td className="py-2 text-brand-slate text-xs">{f.label}</td>
                <td className="py-2 px-3 text-right tabular-nums font-semibold text-brand-ink">{modos.auto.dias ? f.f(modos.auto) : "—"}</td>
                <td className="py-2 pl-3 text-right tabular-nums font-semibold text-brand-ink">{modos.manual.dias ? f.f(modos.manual) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ ranking de efectividad
export function RankingEfectividad({ agentes, p, contacto, onVerTodo, onAgente }: {
  agentes: Agente[]; p: Parametros; contacto: InfoContacto; onVerTodo: () => void; onAgente?: (a: Agente) => void;
}) {
  const m = medida(contacto);
  // Con contacto válido: % de contacto. Sin él: % de conversación (el indicador de la meta).
  const valor = (a: Agente) => (m.exacto ? a.pct_contacto : a.pct_conversacion);
  const ranking = agentes
    .filter((a) => a.llamadas >= p.min_llamadas_ranking && valor(a) !== null && !a.alertas.includes("sesion_abierta"))
    .sort((a, b) => (valor(b) ?? 0) - (valor(a) ?? 0) || b.llamadas - a.llamadas)
    .slice(0, 10);
  const tope = Math.max(...ranking.map((a) => valor(a) ?? 0), 1);
  return (
    <section className="card p-5 min-w-0">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="font-display text-lg uppercase text-brand-ink leading-tight flex items-center gap-2"><Trophy size={16} className="text-brand-orange" /> Asesores más efectivos</h2>
          <p className="text-xs text-brand-slate mt-0.5">
            {m.exacto
              ? <>Por % de contacto (≥ {m.regla} s), con {p.min_llamadas_ranking} llamadas o más.</>
              : <>Por % de conversación, con {p.min_llamadas_ranking} llamadas o más. Pasa a ordenarse por contacto cuando el reporte lo permita.</>}
          </p>
        </div>
        <button type="button" onClick={onVerTodo} className="text-xs font-semibold text-brand-primary whitespace-nowrap">Ranking completo →</button>
      </div>
      {!ranking.length ? (
        <p className="text-sm text-brand-mist">Ningún agente llegó a {p.min_llamadas_ranking} llamadas.</p>
      ) : (
        <ol className="space-y-2">
          {ranking.map((a, i) => (
            <li key={a.clave}>
              <button type="button" onClick={() => onAgente?.(a)} className="w-full grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 text-left group">
                <span className={`grid place-items-center w-7 h-7 rounded-full text-xs font-bold tabular-nums ${i === 0 ? "bg-brand-ink text-white" : i < 3 ? "bg-brand-bg text-brand-ink" : "text-brand-slate"}`}>{i + 1}</span>
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2 min-w-0">
                    <span className="text-sm font-semibold text-brand-ink truncate group-hover:text-brand-primary">{a.nombre}</span>
                    {a.modo && a.modo !== "sin_llamadas" && <span className="text-[10px] text-brand-slate whitespace-nowrap">{a.modo === "auto" ? "Automático" : "Manual"}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="flex-1 h-1.5 rounded-full bg-brand-bg overflow-hidden">
                      <span className="block h-full rounded-full" style={{ width: `${((valor(a) ?? 0) / tope) * 100}%`, background: m.exacto ? "#00B2BF" : (a.banda ? BANDA[a.banda].color : "#0F1116") }} />
                    </span>
                    <span className="text-[11px] text-brand-slate tabular-nums whitespace-nowrap">
                      {m.exacto ? `${n(a.atendidas)} de ${n(a.llamadas)}` : `${n(a.llamadas)} llamadas`}
                    </span>
                  </span>
                </span>
                {m.exacto ? <b className="tabular-nums text-brand-ink">{pct(valor(a))}</b> : <BandaChip banda={a.banda} valor={a.pct_conversacion} compacto />}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ alertas
export function AlertasLista({ alertas, p }: { alertas: Alerta[]; p: Parametros }) {
  if (!alertas.length) return null;
  const abiertas = alertas.filter((a) => a.tipo === "sesion_abierta");
  const sinLlamadas = alertas.filter((a) => a.tipo === "sin_llamadas");
  return (
    <section className="card p-5 border-l-[3px] border-l-brand-primary min-w-0">
      <h2 className="font-display text-lg uppercase text-brand-ink leading-tight flex items-center gap-2"><AlertTriangle size={16} className="text-brand-primary" /> Alertas</h2>
      <div className="grid md:grid-cols-2 gap-5 mt-3">
        {abiertas.length > 0 && (
          <div className="min-w-0">
            <div className="text-xs font-semibold text-brand-ink">Sesiones abiertas ({n(abiertas.length)})</div>
            <p className="text-[11px] text-brand-slate mb-2">{p.sesion_abierta_horas} h o más conectados: se quedaron logueados. No entran en la meta ni en la jornada media.</p>
            <ul className="space-y-1.5">
              {abiertas.map((a) => (
                <li key={a.clave} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-md bg-brand-primary-light/50 px-3 py-1.5 text-sm">
                  <span className="font-semibold text-brand-ink truncate min-w-0">{a.nombre}</span>
                  <span className="text-xs text-brand-slate tabular-nums whitespace-nowrap">{reloj(a.login)} h · pausa {pct(a.pct_pausa)} · {n(a.llamadas)} llamadas</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {sinLlamadas.length > 0 && (
          <div className="min-w-0">
            <div className="text-xs font-semibold text-brand-ink flex items-center gap-1.5"><PhoneOff size={13} /> Conectados sin llamadas ({n(sinLlamadas.length)})</div>
            <p className="text-[11px] text-brand-slate mb-2">30 minutos o más conectados y ninguna llamada.</p>
            <ul className="space-y-1.5">
              {sinLlamadas.map((a) => (
                <li key={a.clave} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-md bg-brand-bg px-3 py-1.5 text-sm">
                  <span className="font-semibold text-brand-ink truncate min-w-0">{a.nombre}</span>
                  <span className="text-xs text-brand-slate tabular-nums whitespace-nowrap">{reloj(a.login)} h conectado · pausa {pct(a.pct_pausa)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ distribución del tiempo
export function DistribucionTiempo({ r }: { r: Resumen }) {
  const otrasGestion = Math.max((r.pct_gestion ?? 0) - (r.pct_conversacion ?? 0) - (r.pct_tipificacion ?? 0) - (r.pct_espera ?? 0), 0);
  const partes = [
    { k: "Conversación", v: r.pct_conversacion, c: "#0F1116" },
    { k: "Tipificación", v: r.pct_tipificacion, c: "#5B6275" },
    { k: "Espera", v: r.pct_espera, c: "#9CA3AF" },
    { k: "Otras interacciones", v: Math.round(otrasGestion * 10) / 10, c: "#C9CDD6" },
    { k: "Disponible", v: r.pct_disponible, c: "#00B2BF" },
    { k: "Pausa", v: r.pct_pausa, c: "#F39200" },
    { k: "Otros estados", v: r.pct_otros, c: "#E5E7EB" },
  ].filter((x) => (x.v ?? 0) > 0);
  return (
    <section className="card p-5 min-w-0">
      <h2 className="font-display text-lg uppercase text-brand-ink leading-tight">¿En qué se va la jornada?</h2>
      <p className="text-xs text-brand-slate mt-0.5">Reparto del tiempo conectado del equipo (sin sesiones abiertas).</p>
      <div className="mt-4 flex h-6 rounded-md overflow-hidden" role="img" aria-label="Reparto del tiempo conectado">
        {partes.map((x, i) => (
          <div key={x.k} title={`${x.k}: ${pct(x.v)}`} style={{ width: `${x.v}%`, background: x.c, marginLeft: i ? 2 : 0 }} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
        {partes.map((x) => (
          <div key={x.k} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0 border border-black/5" style={{ background: x.c }} />
            <span className="text-brand-slate">{x.k}</span>
            <b className="ml-auto tabular-nums text-brand-ink">{pct(x.v)}</b>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-brand-mist mt-3">Otros estados: tiempo conectado que la plataforma no informa como disponible, pausa ni gestión (por ejemplo, discado).</p>
    </section>
  );
}
