"use client";

import {
  Ban, CalendarClock, CalendarRange, ChevronDown, ChevronUp, CircleCheck, ClipboardCheck, Download, Info, Search, TriangleAlert,
  UserRound, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PrintButton } from "@/components/PrintButton";
import { fechaCorta, n } from "@/components/productividad/tipos";
import { apiFetch } from "@/lib/api";
import { descargarCsv } from "@/lib/csv";
import { VerCoachingDialog } from "./coaching";
import { ResultadoChip } from "./impacto";
import {
  METRICA, METRICAS_ORDEN, RESULTADO, SEGUIMIENTO, SUP_API, SUP_HREF, TIPO_COACHING, diasEntre, dm, fechaHoraPy, metricasDe,
  nombreMetricas, num, sumarDias,
  type CoachingRegistro, type FiltroResultado, type FiltroSeguimiento, type MetricaCoaching, type MetricaRegistro,
  type RegistroCoaching, type TipoCoaching,
} from "./tipos";

// ------------------------------------------------------------------ filtros (en la URL, para compartir la vista)
interface Filtros {
  desde: string;
  hasta: string;
  supervisor_id: string;
  operador_id: string;
  metrica: MetricaCoaching | "";
  tipo: TipoCoaching | "";
  seguimiento: FiltroSeguimiento | "";
  resultado: FiltroResultado | "";
  anulados: boolean;
}

const SEG_FILTRO: Record<FiltroSeguimiento, string> = {
  pendientes: "Pendientes (sin seguimiento)",
  proximos: "Próximos 7 días",
  vencidos: "Vencidos",
  a_tiempo: "Registrados a tiempo",
  tarde: "Registrados tarde",
};
const RES_FILTRO: Record<FiltroResultado, string> = {
  mejoro: "Mejoró", mixto: "Mixto (unas sí, otras no)", igual: "Igual", empeoro: "Empeoró", sin_mejora: "Sin mejora (igual o empeoró)",
  sin_datos: "Sin datos",
};

/** Hoy en la hora de la operación (Asunción), 'AAAA-MM-DD'. */
function hoyPy(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** El registro de los jefes filtrado por asesor o supervisor, de los últimos `dias` días. */
export function hrefRegistro({ asesor, supervisor, dias = 90 }: { asesor?: string; supervisor?: string; dias?: number }): string {
  const hoy = hoyPy();
  const q = new URLSearchParams({ desde: sumarDias(hoy, -(dias - 1)), hasta: hoy });
  if (supervisor) q.set("supervisor", supervisor);
  if (asesor) q.set("asesor", asesor);
  return `${SUP_HREF}/coaching/registro?${q}`;
}

function finDeMes(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(y, m, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function presets(hoy: string): { k: string; label: string; desde: string; hasta: string }[] {
  const primero = `${hoy.slice(0, 7)}-01`;
  const ultimoAnterior = sumarDias(primero, -1);
  return [
    { k: "mes", label: "Este mes", desde: primero, hasta: hoy },
    { k: "anterior", label: "Mes anterior", desde: `${ultimoAnterior.slice(0, 7)}-01`, hasta: finDeMes(ultimoAnterior) },
    { k: "7", label: "7 días", desde: sumarDias(hoy, -6), hasta: hoy },
    { k: "30", label: "30 días", desde: sumarDias(hoy, -29), hasta: hoy },
    { k: "90", label: "90 días", desde: sumarDias(hoy, -89), hasta: hoy },
    { k: "anio", label: "Este año", desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy },
  ];
}

const VALIDOS = {
  metrica: METRICAS_ORDEN as string[],
  tipo: ["diario", "semanal", "mensual"],
  seguimiento: Object.keys(SEG_FILTRO),
  resultado: Object.keys(RES_FILTRO),
};
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function filtrosDeUrl(): Filtros {
  const hoy = hoyPy();
  const base: Filtros = { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy, supervisor_id: "", operador_id: "", metrica: "", tipo: "", seguimiento: "", resultado: "", anulados: false };
  if (typeof window === "undefined") return base;
  const q = new URLSearchParams(window.location.search);
  const de = (k: keyof typeof VALIDOS) => { const v = q.get(k) ?? ""; return VALIDOS[k].includes(v) ? v : ""; };
  const desde = q.get("desde") ?? "";
  const hasta = q.get("hasta") ?? "";
  return {
    desde: FECHA.test(desde) ? desde : base.desde,
    hasta: FECHA.test(hasta) ? hasta : base.hasta,
    supervisor_id: (q.get("supervisor") ?? "").slice(0, 36),
    operador_id: (q.get("asesor") ?? "").slice(0, 36),
    metrica: de("metrica") as Filtros["metrica"],
    tipo: de("tipo") as Filtros["tipo"],
    seguimiento: de("seguimiento") as Filtros["seguimiento"],
    resultado: de("resultado") as Filtros["resultado"],
    anulados: q.get("anulados") === "1",
  };
}

function aUrl(f: Filtros, portal: boolean): string {
  const q = new URLSearchParams({ desde: f.desde, hasta: f.hasta });
  if (!portal && f.supervisor_id) q.set("supervisor", f.supervisor_id);
  if (f.operador_id) q.set("asesor", f.operador_id);
  for (const k of ["metrica", "tipo", "seguimiento", "resultado"] as const) if (f[k]) q.set(k, f[k]);
  if (f.anulados) q.set("anulados", "1");
  return q.toString();
}

function aApi(f: Filtros, portal: boolean): string {
  const q = new URLSearchParams({ desde: f.desde, hasta: f.hasta });
  if (!portal && f.supervisor_id) q.set("supervisor_id", f.supervisor_id);
  if (f.operador_id) q.set("operador_id", f.operador_id);
  for (const k of ["metrica", "tipo", "seguimiento", "resultado"] as const) if (f[k]) q.set(k, f[k]);
  if (f.anulados) q.set("anulados", "true");
  return q.toString();
}

// ------------------------------------------------------------------ piezas
const pl = (k: number, uno: string, varios: string) => `${n(k)} ${k === 1 ? uno : varios}`;
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${num(v, 0)}%`);
const ROJO = "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30";

function Chip({ label, chip, ayuda, icono }: { label: ReactNode; chip: string; ayuda?: string; icono?: ReactNode }) {
  return (
    <span title={ayuda} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0 text-[10px] font-semibold whitespace-nowrap ${chip}`}>
      {icono}{label}
    </span>
  );
}

function Kpi({ titulo, valor, sub, alerta, activo, onClick, icono }: {
  titulo: string; valor: string; sub?: ReactNode; alerta?: boolean; activo?: boolean; onClick?: () => void; icono?: ReactNode;
}) {
  const cuerpo = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate">{titulo}</div>
        {icono}
      </div>
      <div className={`font-display text-4xl leading-none tabular-nums ${alerta ? "text-brand-primary-dark" : "text-brand-ink"}`}>{valor}</div>
      {sub && <div className="text-xs text-brand-slate leading-snug">{sub}</div>}
    </>
  );
  const cls = `card p-4 flex flex-col gap-2 min-w-0 text-left ${alerta ? "border-brand-primary/40" : ""} ${activo ? "ring-2 ring-brand-ink/80" : ""}`;
  if (!onClick) return <div className={cls}>{cuerpo}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={!!activo} className={`${cls} hover:border-brand-slate transition-colors`}>
      {cuerpo}
    </button>
  );
}

function Seccion({ titulo, sub, accion, children }: { titulo: string; sub?: ReactNode; accion?: ReactNode; children: ReactNode }) {
  return (
    <section className="card min-w-0">
      <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">{titulo}</h2>
          {sub && <p className="text-xs text-brand-slate mt-0.5 leading-relaxed">{sub}</p>}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}

/** Resultado de los seguimientos de una métrica: mejoró, igual, empeoró y sin datos (barra 100% apilada). */
const SEGMENTOS = [
  { k: "mejoro", label: "Mejoró", color: "bg-emerald-500" },
  { k: "igual", label: "Igual", color: "bg-[#B9BFCC]" },
  { k: "empeoro", label: "Empeoró", color: "bg-brand-primary" },
  { k: "sin_datos", label: "Sin datos", color: "bg-[repeating-linear-gradient(45deg,#E5E7EB_0_3px,#F6F7FB_3px_6px)]" },
] as const;

function BarraResultados({ x }: { x: MetricaRegistro }) {
  const total = x.mejoro + x.igual + x.empeoro + x.sin_datos;
  if (!total) return <span className="text-[11px] text-brand-mist">Sin seguimientos todavía</span>;
  const segs = SEGMENTOS.filter((s) => x[s.k] > 0);
  return (
    <div className="flex h-3 w-full gap-[2px]" role="img" aria-label={segs.map((s) => `${s.label}: ${x[s.k]}`).join(" · ")}>
      {segs.map((s, i) => (
        <div key={s.k} title={`${s.label}: ${n(x[s.k])} de ${n(total)}`} style={{ width: `${(x[s.k] / total) * 100}%` }}
          className={`${s.color} min-w-[4px] ${i === 0 ? "rounded-l" : ""} ${i === segs.length - 1 ? "rounded-r" : ""}`} />
      ))}
    </div>
  );
}

function PorMetrica({ filas, onFiltrar, activa }: { filas: MetricaRegistro[]; onFiltrar: (m: MetricaCoaching) => void; activa: string }) {
  return (
    <Seccion titulo="Por métrica" sub="Cuántos coachings trabajaron cada métrica y cómo le fue a esa métrica en sus seguimientos (un coaching con varias cuenta en cada una).">
      {!filas.length ? <p className="px-5 py-8 text-center text-sm text-brand-slate border-t border-brand-border">Sin coachings en el rango.</p> : (
        <>
          <div className="px-5 pb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-brand-slate" aria-hidden>
            {SEGMENTOS.map((s) => <span key={s.k} className="inline-flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${s.color}`} />{s.label}</span>)}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="bg-brand-bg text-[10px] uppercase tracking-wider2 text-brand-slate">
                  <th className="text-left px-5 py-2">Métrica</th>
                  <th className="text-right px-3 py-2">Coachings</th>
                  <th className="text-left px-3 py-2 w-[40%]">Resultado de los seguimientos</th>
                  <th className="text-right px-5 py-2" title="Mejoró, sobre los seguimientos con datos">Mejora</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((x) => (
                  <tr key={x.metrica} className={`border-t border-brand-border ${activa === x.metrica ? "bg-brand-bg-soft" : ""}`}>
                    <td className="px-5 py-2.5">
                      <button type="button" onClick={() => onFiltrar(x.metrica)} className="font-semibold text-brand-ink hover:text-brand-primary text-left">
                        {METRICA[x.metrica].label}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <b className="text-brand-ink">{n(x.coachings)}</b>
                      <div className="text-[10px] text-brand-slate">{pl(x.cerrados, "con seguimiento", "con seguimiento")}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <BarraResultados x={x} />
                      {x.cerrados > 0 && (
                        <div className="text-[10px] text-brand-slate mt-1 tabular-nums">
                          {n(x.mejoro)} mejoró · {n(x.igual)} igual · {n(x.empeoro)} empeoró{x.sin_datos ? ` · ${n(x.sin_datos)} sin datos` : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums font-semibold text-brand-ink">{pct(x.pct_mejora)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Seccion>
  );
}

function PorSupervisor({ d, onFiltrar, activo }: { d: RegistroCoaching; onFiltrar: (id: string) => void; activo: string }) {
  return (
    <Seccion titulo="Por supervisor" sub="Tocá un supervisor para ver solo sus coachings.">
      {!d.por_supervisor.length ? <p className="px-5 py-8 text-center text-sm text-brand-slate border-t border-brand-border">Sin coachings en el rango.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="bg-brand-bg text-[10px] uppercase tracking-wider2 text-brand-slate">
                <th className="text-left px-5 py-2">Supervisor</th>
                <th className="text-right px-3 py-2">Coachings</th>
                <th className="text-right px-3 py-2" title="Seguimientos registrados en la fecha acordada (o al día siguiente), sobre los que ya tenían que estar">A tiempo</th>
                <th className="text-left px-3 py-2">Pendientes</th>
                <th className="text-right px-3 py-2" title="Mejoró, sobre los seguimientos con datos">Mejora</th>
                <th className="text-right px-5 py-2">Último</th>
              </tr>
            </thead>
            <tbody>
              {d.por_supervisor.map((f) => (
                <tr key={f.id} className={`border-t border-brand-border align-top ${activo === f.id ? "bg-brand-bg-soft" : ""} ${f.vencido ? "shadow-[inset_3px_0_0_#E6332A]" : ""}`}>
                  <td className="px-5 py-2.5">
                    <button type="button" onClick={() => onFiltrar(f.id)} className="font-semibold text-brand-ink hover:text-brand-primary text-left">{f.nombre}</button>
                    <div className="text-[11px] text-brand-slate">{pl(f.asesores, "asesor", "asesores")}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-brand-ink">{n(f.coachings)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <b className="text-brand-ink">{pct(f.pct_a_tiempo)}</b>
                    {(f.tarde > 0 || f.vencido > 0) && (
                      <div className="text-[10px] text-brand-slate">{f.tarde ? `${n(f.tarde)} tarde` : ""}{f.tarde && f.vencido ? " · " : ""}{f.vencido ? <span className="text-brand-primary-dark font-semibold">{pl(f.vencido, "vencido", "vencidos")}</span> : ""}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-brand-slate">
                    {f.pendientes ? (
                      <>
                        <div><b className="text-brand-ink">{n(f.pendientes)}</b> sin seguimiento</div>
                        {f.proximos > 0 && <div className="text-[#1D5BA6] font-semibold">{pl(f.proximos, "próximo", "próximos")}</div>}
                      </>
                    ) : <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><CircleCheck size={12} aria-hidden /> Al día</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{pct(f.pct_mejora)}</td>
                  <td className="px-5 py-2.5 text-right text-xs text-brand-slate tabular-nums">{dm(f.ultimo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Seccion>
  );
}

const ASESORES_VISIBLES = 10;

function PorAsesor({ d, portal, onFiltrar, activo }: { d: RegistroCoaching; portal: boolean; onFiltrar: (id: string) => void; activo: string }) {
  const [todos, setTodos] = useState(false);
  const filas = todos ? d.por_asesor : d.por_asesor.slice(0, ASESORES_VISIBLES);
  return (
    <Seccion titulo="Por asesor" sub="Cuántos coachings tuvo cada asesor, sobre qué y cómo terminaron. Tocá un asesor para ver su historia."
      accion={d.por_asesor.length > ASESORES_VISIBLES ? (
        <button type="button" className="btn-ghost text-xs" onClick={() => setTodos((t) => !t)}>
          {todos ? <><ChevronUp size={14} /> Ver menos</> : <><ChevronDown size={14} /> Ver los {n(d.por_asesor.length)}</>}
        </button>
      ) : undefined}>
      {!d.por_asesor.length ? <p className="px-5 py-8 text-center text-sm text-brand-slate border-t border-brand-border">Sin coachings en el rango.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr className="bg-brand-bg text-[10px] uppercase tracking-wider2 text-brand-slate">
                <th className="text-left px-5 py-2">Asesor</th>
                <th className="text-right px-3 py-2">Coachings</th>
                <th className="text-left px-3 py-2">Métricas trabajadas</th>
                <th className="text-left px-3 py-2">Seguimientos</th>
                <th className="text-right px-5 py-2">Último</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => (
                <tr key={a.id} className={`border-t border-brand-border align-top ${activo === a.id ? "bg-brand-bg-soft" : ""}`}>
                  <td className="px-5 py-2.5">
                    <button type="button" onClick={() => onFiltrar(a.id)} className="font-semibold text-brand-ink hover:text-brand-primary text-left">{a.nombre}</button>
                    {!portal && <div className="text-[11px] text-brand-slate">{a.supervisores.join(" · ")}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-brand-ink">{n(a.coachings)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {METRICAS_ORDEN.filter((m) => a.metricas[m]).map((m) => (
                        <Chip key={m} label={<>{METRICA[m].label} <span className="font-normal opacity-80">×{a.metricas[m]}</span></>} chip="bg-brand-bg text-brand-graphite border-brand-border" />
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-brand-slate">
                    <div className="flex flex-wrap gap-1">
                      {a.vencido > 0 && <Chip label={pl(a.vencido, "vencido", "vencidos")} chip={ROJO} icono={<TriangleAlert size={10} aria-hidden />} />}
                      {a.pendientes - a.vencido > 0 && <Chip label={pl(a.pendientes - a.vencido, "pendiente", "pendientes")} chip="bg-brand-bg text-brand-slate border-brand-border" />}
                      {a.mejoro > 0 && <Chip label={`${n(a.mejoro)} mejoró`} chip={RESULTADO.mejoro.chip} />}
                      {a.sin_mejora > 0 && <Chip label={`${n(a.sin_mejora)} sin mejora`} chip={RESULTADO.empeoro.chip} />}
                      {a.cerrados - a.mejoro - a.sin_mejora > 0 && <Chip label={`${n(a.cerrados - a.mejoro - a.sin_mejora)} mixto o sin datos`} chip="bg-brand-bg text-brand-slate border-brand-border" />}
                    </div>
                  </td>
                  <td className="px-5 py-2.5 text-right text-xs text-brand-slate tabular-nums">{dm(a.ultimo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Seccion>
  );
}

// ------------------------------------------------------------------ la lista: qué se trabajó y la devolución
function Texto({ titulo, children, tono }: { titulo: string; children: ReactNode; tono?: string }) {
  return (
    <div className="min-w-0">
      <div className={`text-[10px] uppercase tracking-wider2 ${tono ?? "text-brand-slate"}`}>{titulo}</div>
      <p className="text-[13px] text-brand-graphite mt-0.5 whitespace-pre-line break-words line-clamp-4">{children}</p>
    </div>
  );
}

function SeguimientoChip({ c, hoy }: { c: CoachingRegistro; hoy: string }) {
  if (!c.seguimiento) return null;
  const s = SEGUIMIENTO[c.seguimiento];
  let label = s.label;
  if (c.seguimiento === "proximo") {
    const dias = diasEntre(hoy, c.seguimiento_fecha);
    label = dias === 1 ? "Seguimiento mañana" : `Seguimiento en ${dias} días`;
  }
  const icono = c.seguimiento === "vencido" ? <TriangleAlert size={10} aria-hidden />
    : c.seguimiento === "a_tiempo" ? <CircleCheck size={10} aria-hidden /> : <CalendarClock size={10} aria-hidden />;
  return <Chip label={label} chip={s.chip} ayuda={s.ayuda} icono={icono} />;
}

function ItemCoaching({ c, hoy, portal, onAbrir }: { c: CoachingRegistro; hoy: string; portal: boolean; onAbrir: () => void }) {
  const anulado = c.estado === "anulado";
  const varias = c.resultados.length > 1;
  return (
    <li className={anulado ? "opacity-60" : ""}>
      <button type="button" onClick={onAbrir} className="w-full text-left px-5 py-4 flex gap-3 hover:bg-brand-bg-soft transition-colors">
        <div className="w-11 shrink-0 text-center rounded-md border border-brand-border py-1 h-fit">
          <div className="font-display text-xl leading-none text-brand-ink tabular-nums">{c.fecha.slice(8, 10)}</div>
          <div className="text-[9px] uppercase tracking-wider2 text-brand-slate">{fechaCorta(c.fecha).split(" ")[0]}</div>
          <div className="text-[9px] text-brand-mist tabular-nums">{c.fecha.slice(5, 7)}/{c.fecha.slice(2, 4)}</div>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-x-3 gap-y-1 flex-wrap">
            <div className="min-w-0">
              <div className={`font-semibold text-sm text-brand-ink ${anulado ? "line-through" : ""}`}>{c.operador}</div>
              <div className="text-[11px] text-brand-slate">{TIPO_COACHING[c.tipo].label}{!portal && <> · por <b className="font-semibold text-brand-graphite">{c.supervisor}</b></>}</div>
            </div>
            <div className="flex flex-wrap gap-1">
              {metricasDe(c).map((m) => <Chip key={m} label={METRICA[m].label} chip="bg-brand-ink text-white border-brand-ink" />)}
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-x-4 gap-y-2">
            <Texto titulo="Qué se trabajó (diagnóstico)">{c.diagnostico}</Texto>
            <Texto titulo="Compromiso">{c.compromiso}</Texto>
            {c.seguimiento_comentario ? (
              <Texto titulo={`Devolución del seguimiento · ${c.seguimiento_at ? fechaHoraPy(c.seguimiento_at) : ""}`} tono="text-emerald-800">
                {c.seguimiento_comentario}
              </Texto>
            ) : (
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">Seguimiento</div>
                <p className="text-[13px] text-brand-slate mt-0.5">
                  {anulado ? "Anulado: no lleva seguimiento." : <>Acordado para el <b className="text-brand-ink">{fechaCorta(c.seguimiento_fecha)}</b>: todavía sin devolución.</>}
                </p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {anulado ? <Chip label="Anulado" chip="bg-brand-bg text-brand-slate border-brand-border" icono={<Ban size={10} aria-hidden />} /> : <SeguimientoChip c={c} hoy={hoy} />}
            {c.estado === "cerrado" && c.resultado && (
              <ResultadoChip r={c.resultado} compacto delta={varias ? null : c.resultados[0]?.delta} metrica={c.resultados[0]?.metrica} />
            )}
            {varias && c.resultados.map((x) => (
              <span key={x.metrica} className="inline-flex items-center gap-1 text-[10px] text-brand-slate">
                <span className="font-semibold text-brand-graphite">{METRICA[x.metrica].label}:</span> <ResultadoChip r={x.resultado} compacto />
              </span>
            ))}
            {c.fuera_de_termino && <Chip label="Fuera de término" chip="bg-brand-orange/10 text-[#8A5200] border-brand-orange/40" ayuda="Se registró con más de 48 h de atraso: cuenta igual" />}
            {c.anterior_id && <Chip label="Continúa un coaching sin mejora" chip="bg-brand-bg text-brand-slate border-brand-border" />}
          </div>
        </div>
      </button>
    </li>
  );
}

const PAGINA = 40;

// ------------------------------------------------------------------ la vista
/**
 * Registro de coaching por rango de fechas: los jefes ven el de toda la operación y el supervisor, su historial
 * (`portal`). Qué se trabajó, el compromiso, la devolución del seguimiento y el resultado medido, con los indicadores
 * del rango por métrica, por supervisor y por asesor.
 */
export function RegistroCoachingVista({ portal }: { portal: boolean }) {
  const [f, setF] = useState<Filtros>(filtrosDeUrl);
  const [d, setD] = useState<RegistroCoaching | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");
  const [visibles, setVisibles] = useState(PAGINA);
  const [abierto, setAbierto] = useState<string | null>(null);
  const pedido = useRef(0);

  const load = useCallback(async (x: Filtros) => {
    const yo = ++pedido.current;
    setCargando(true);
    setError(null);
    try {
      const r = await apiFetch<RegistroCoaching>(`${SUP_API}/${portal ? "portal/" : ""}registro?${aApi(x, portal)}`);
      if (yo === pedido.current) setD(r);
    } catch (e: any) {
      if (yo === pedido.current) setError(e.message);
    } finally {
      if (yo === pedido.current) setCargando(false);
    }
  }, [portal]);

  useEffect(() => {
    load(f);
    setVisibles(PAGINA);
    window.history.replaceState(null, "", `${window.location.pathname}?${aUrl(f, portal)}`);
  }, [f, load, portal]);

  const cambiar = (x: Partial<Filtros>) => setF((p) => ({ ...p, ...x }));
  /** Un clic en una fila o un indicador filtra por eso; otro clic lo saca. */
  const alternar = (k: Exclude<keyof Filtros, "anulados" | "desde" | "hasta">, v: string) =>
    setF((p) => ({ ...p, [k]: p[k] === v ? "" : v }));
  const hoy = d?.hoy ?? hoyPy();
  const rangos = presets(hoy);
  const filtrado = !!(f.supervisor_id || f.operador_id || f.metrica || f.tipo || f.seguimiento || f.resultado || f.anulados);
  const limpiar = () => setF((p) => ({ ...p, supervisor_id: "", operador_id: "", metrica: "", tipo: "", seguimiento: "", resultado: "", anulados: false }));

  const items = useMemo(() => {
    const t = buscar.trim().toLowerCase();
    if (!d || !t) return d?.items ?? [];
    return d.items.filter((c) => [c.operador, c.supervisor, c.diagnostico, c.compromiso, c.seguimiento_comentario ?? ""]
      .some((s) => s.toLowerCase().includes(t)));
  }, [d, buscar]);

  const exportar = () => {
    if (!d) return;
    descargarCsv(`${portal ? "mi-historial" : "registro"}-coaching_${d.desde}_${d.hasta}.csv`, [
      "Fecha", "Supervisor", "Asesor", "Tipo", "Métricas", "Diagnóstico (qué se trabajó)", "Compromiso", "Seguimiento acordado",
      "Estado del seguimiento", "Seguimiento registrado", "Devolución del seguimiento", "Resultado", "Resultado por métrica",
      "Fuera de término", "Estado", "Registrado",
    ], items.map((c) => [
      c.fecha, c.supervisor, c.operador, TIPO_COACHING[c.tipo].label, nombreMetricas(c), c.diagnostico, c.compromiso, c.seguimiento_fecha,
      c.seguimiento ? SEGUIMIENTO[c.seguimiento].corto : "", c.seguimiento_at ? fechaHoraPy(c.seguimiento_at) : "", c.seguimiento_comentario ?? "",
      c.resultado ? RESULTADO[c.resultado].label : "",
      c.resultados.map((x) => `${METRICA[x.metrica].label}: ${RESULTADO[x.resultado].label}`).join(" · "),
      c.fuera_de_termino ? "Sí" : "No", c.estado, fechaHoraPy(c.created_at),
    ]));
  };

  const k = d?.kpis;
  const sinMejora = k ? k.resultados.igual + k.resultados.empeoro : 0;
  const conDatos = k ? k.resultados.mejoro + k.resultados.mixto + sinMejora : 0;
  const supervisor = d?.opciones.supervisores.find((s) => s.id === f.supervisor_id);
  const asesor = d?.opciones.asesores.find((s) => s.id === f.operador_id);

  return (
    <div className="space-y-6">
      {/* ---- filtros */}
      <section className="card p-4 space-y-3 print:hidden" aria-label="Filtros">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <div className="label flex items-center gap-1.5"><CalendarRange size={13} aria-hidden /> Rango</div>
            <div className="flex flex-wrap gap-1.5">
              {rangos.map((r) => {
                const on = f.desde === r.desde && f.hasta === r.hasta;
                return (
                  <button key={r.k} type="button" aria-pressed={on} onClick={() => cambiar({ desde: r.desde, hasta: r.hasta })}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${on ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border text-brand-graphite hover:border-brand-slate"}`}>
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="label" htmlFor="r-desde">Desde</label>
              <input id="r-desde" type="date" className="input tabular-nums !py-1.5 w-[150px]" value={f.desde} max={f.hasta}
                onChange={(e) => e.target.value && cambiar({ desde: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="r-hasta">Hasta</label>
              <input id="r-hasta" type="date" className="input tabular-nums !py-1.5 w-[150px]" value={f.hasta} min={f.desde} max={hoy}
                onChange={(e) => e.target.value && cambiar({ hasta: e.target.value })} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {!portal && (
            <div className="min-w-0">
              <label className="label" htmlFor="r-sup">Supervisor</label>
              <select id="r-sup" className="input !py-1.5" value={f.supervisor_id} onChange={(e) => cambiar({ supervisor_id: e.target.value })}>
                <option value="">Todos</option>
                {d?.opciones.supervisores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                {f.supervisor_id && !supervisor && <option value={f.supervisor_id}>Elegido</option>}
              </select>
            </div>
          )}
          <div className="min-w-0">
            <label className="label" htmlFor="r-asesor">Asesor</label>
            <select id="r-asesor" className="input !py-1.5" value={f.operador_id} onChange={(e) => cambiar({ operador_id: e.target.value })}>
              <option value="">Todos</option>
              {d?.opciones.asesores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              {f.operador_id && !asesor && <option value={f.operador_id}>Elegido</option>}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label" htmlFor="r-metrica">Métrica</label>
            <select id="r-metrica" className="input !py-1.5" value={f.metrica} onChange={(e) => cambiar({ metrica: e.target.value as Filtros["metrica"] })}>
              <option value="">Todas</option>
              {METRICAS_ORDEN.map((m) => <option key={m} value={m}>{METRICA[m].label}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label" htmlFor="r-tipo">Tipo</label>
            <select id="r-tipo" className="input !py-1.5" value={f.tipo} onChange={(e) => cambiar({ tipo: e.target.value as Filtros["tipo"] })}>
              <option value="">Todos</option>
              {(["diario", "semanal", "mensual"] as TipoCoaching[]).map((t) => <option key={t} value={t}>{TIPO_COACHING[t].label}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label" htmlFor="r-seg">Seguimiento</label>
            <select id="r-seg" className="input !py-1.5" value={f.seguimiento} onChange={(e) => cambiar({ seguimiento: e.target.value as Filtros["seguimiento"] })}>
              <option value="">Todos</option>
              {(Object.keys(SEG_FILTRO) as FiltroSeguimiento[]).map((s) => <option key={s} value={s}>{SEG_FILTRO[s]}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label" htmlFor="r-res">Resultado</label>
            <select id="r-res" className="input !py-1.5" value={f.resultado} onChange={(e) => cambiar({ resultado: e.target.value as Filtros["resultado"] })}>
              <option value="">Todos</option>
              {(Object.keys(RES_FILTRO) as FiltroResultado[]).map((s) => <option key={s} value={s}>{RES_FILTRO[s]}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-brand-graphite cursor-pointer select-none">
            <input type="checkbox" className="accent-brand-primary" checked={f.anulados} onChange={(e) => cambiar({ anulados: e.target.checked })} />
            Mostrar también los anulados
          </label>
          <div className="flex items-center gap-3">
            {cargando && d && <span className="text-[11px] text-brand-slate" role="status">Actualizando…</span>}
            {filtrado && <button type="button" className="btn-ghost text-xs !px-2 !py-1" onClick={limpiar}><X size={13} /> Limpiar filtros</button>}
          </div>
        </div>
      </section>

      {error && <div className="card p-4 text-sm text-brand-primary">{error}</div>}
      {!d || !k ? (
        !error && <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-brand-graphite">
              Del <b>{fechaCorta(d.desde)}</b> al <b>{fechaCorta(d.hasta)}</b>
              <span className="text-brand-slate"> · {pl(diasEntre(d.desde, d.hasta) + 1, "día", "días")}</span>
              {supervisor && <> · <UserRound size={13} className="inline -mt-0.5" aria-hidden /> {supervisor.nombre}</>}
              {asesor && <> · asesor <b>{asesor.nombre}</b></>}
            </p>
            <div className="flex items-center gap-2 print:hidden">
              <button type="button" onClick={exportar} disabled={!items.length} className="btn-secondary text-xs !px-3 !py-2"><Download size={14} /> CSV</button>
              <PrintButton />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Kpi titulo="Coachings" valor={n(k.coachings)}
              sub={<>{pl(k.asesores, "asesor", "asesores")}{!portal && <> · {pl(k.supervisores, "supervisor", "supervisores")}</>}
                {k.fuera_de_termino > 0 && <> · <span className="text-[#8A5200]">{n(k.fuera_de_termino)} fuera de término</span></>}
                {k.anulados > 0 && <> · {pl(k.anulados, "anulado", "anulados")}</>}</>} />
            <Kpi titulo="Seguimientos a tiempo" valor={pct(k.pct_a_tiempo)} alerta={k.seguimientos.vencido > 0}
              activo={f.seguimiento === "vencidos"} onClick={k.seguimientos.vencido > 0 ? () => alternar("seguimiento", "vencidos") : undefined}
              icono={k.seguimientos.vencido > 0 ? <TriangleAlert size={15} className="text-brand-primary" aria-hidden /> : <ClipboardCheck size={15} className="text-brand-slate" aria-hidden />}
              sub={<>{n(k.seguimientos.a_tiempo)} a tiempo · {n(k.seguimientos.tarde)} tarde · {k.seguimientos.vencido > 0
                ? <b className="text-brand-primary-dark">{pl(k.seguimientos.vencido, "vencido", "vencidos")}</b> : "0 vencidos"}</>} />
            <Kpi titulo="Próximos seguimientos" valor={n(k.proximos)} activo={f.seguimiento === "proximos"}
              onClick={k.proximos > 0 ? () => alternar("seguimiento", "proximos") : undefined}
              icono={<CalendarClock size={15} className="text-[#1D5BA6]" aria-hidden />}
              sub={<>Hasta el {fechaCorta(d.proximos_hasta)}{k.seguimientos.hoy > 0 && <> · <b className="text-[#1D5BA6]">{n(k.seguimientos.hoy)} para hoy</b></>}</>} />
            <Kpi titulo="Mejora medida" valor={pct(k.pct_mejora)}
              icono={<CircleCheck size={15} className="text-emerald-600" aria-hidden />}
              sub={conDatos ? <>{n(k.resultados.mejoro)} mejoró · {n(k.resultados.mixto)} mixto · {n(sinMejora)} sin mejora, de {pl(conDatos, "seguimiento con datos", "seguimientos con datos")}</>
                : `${pl(k.cerrados, "seguimiento registrado", "seguimientos registrados")}, todavía sin datos para medir.`} />
          </div>

          <div className={`grid gap-5 items-start ${portal ? "" : "xl:grid-cols-2"}`}>
            <PorMetrica filas={d.por_metrica} activa={f.metrica} onFiltrar={(m) => alternar("metrica", m)} />
            {!portal && <PorSupervisor d={d} activo={f.supervisor_id} onFiltrar={(id) => alternar("supervisor_id", id)} />}
          </div>
          <PorAsesor d={d} portal={portal} activo={f.operador_id} onFiltrar={(id) => alternar("operador_id", id)} />

          <Seccion titulo="Coachings y seguimientos"
            sub={<>Lo que se trabajó con cada asesor, el compromiso y la devolución del seguimiento, con el resultado que midió el sistema. Tocá uno para ver el detalle, la medición y su historial (aclaraciones incluidas).</>}
            accion={(
              <div className="relative w-full sm:w-80 print:hidden">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mist" aria-hidden />
                <input type="search" className="input !py-1.5 pl-8" placeholder="Buscar asesor, tema o devolución…" value={buscar}
                  onChange={(e) => { setBuscar(e.target.value); setVisibles(PAGINA); }} aria-label="Buscar en los coachings" />
              </div>
            )}>
            {d.truncado && (
              <p className="mx-5 mb-3 text-xs text-[#1D5BA6] bg-[#2A78D6]/10 border border-[#2A78D6]/30 rounded-md px-3 py-2 flex items-start gap-2">
                <Info size={14} className="shrink-0 mt-0.5" aria-hidden />
                Se listan los {n(d.items.length)} más recientes de {n(d.total_items)}: los indicadores cuentan todos. Acotá el rango o filtrá para ver el resto.
              </p>
            )}
            {!items.length ? (
              <div className="px-5 py-10 text-center border-t border-brand-border">
                <p className="text-sm text-brand-slate">{buscar ? "Ningún coaching coincide con la búsqueda." : "No hay coachings con estos filtros en el rango."}</p>
                {(filtrado || buscar) && (
                  <button type="button" className="btn-ghost text-xs mt-2" onClick={() => { limpiar(); setBuscar(""); }}><X size={13} /> Limpiar filtros y búsqueda</button>
                )}
              </div>
            ) : (
              <>
                <ul className="divide-y divide-brand-border border-t border-brand-border">
                  {items.slice(0, visibles).map((c) => <ItemCoaching key={c.id} c={c} hoy={hoy} portal={portal} onAbrir={() => setAbierto(c.id)} />)}
                </ul>
                <div className="px-5 py-3 border-t border-brand-border flex items-center justify-between gap-3 flex-wrap text-xs text-brand-slate">
                  <span>Mostrando {n(Math.min(visibles, items.length))} de {n(items.length)}</span>
                  {visibles < items.length && (
                    <button type="button" className="btn-secondary text-xs !px-3 !py-1.5 print:hidden" onClick={() => setVisibles((v) => v + PAGINA)}>
                      <ChevronDown size={14} /> Mostrar {n(Math.min(PAGINA, items.length - visibles))} más
                    </button>
                  )}
                </div>
              </>
            )}
          </Seccion>
        </>
      )}
      {abierto && <VerCoachingDialog id={abierto} portal={portal} onClose={() => setAbierto(null)} />}
    </div>
  );
}
