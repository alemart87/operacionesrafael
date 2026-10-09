"use client";

import {
  ArrowDownRight, ArrowRight, ArrowUpRight, BellRing, CalendarClock, CalendarX, CircleCheck, CircleSlash, ClipboardCheck,
  Clock3, Hand, History, IdCard, Link2Off, MessageSquareText, Minus, NotebookPen, Send, Siren, Target, Ticket, TicketX,
  TrendingDown, TriangleAlert, UserRoundX, Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { n } from "@/components/productividad/tipos";
import { apiFetch } from "@/lib/api";
import { VerCoachingDialog } from "./coaching";
import { AreaTexto, Campo, ErrorMsg, Modal } from "./dialogos";
import { MedidorScore } from "./scoring";
import { TicketDialog } from "./tickets";
import {
  ESTADO, ESTADO_ALERTA_COMANDO, GRUPO_EVENTO, PRIORIDAD, SEMAFORO, SUP_API, SUP_HREF, dm, fechaHoraCorta, haceDiasHabiles,
  num, plazoTexto,
  type AlertaComando, type CabeceraComando, type CentroComandos, type EstadoSemaforo, type EventoLinea, type FilaSemaforo,
  type GrupoEvento, type LineaTiempo, type PrioridadTicket, type Proyeccion, type TipoAlertaComando, type TipoTicket,
} from "./tipos";
import { BarraAvance, EstadoChip } from "./ui";

const ROJO = "#E6332A";
const CYAN = "#00B2BF";
const CHIP_ROJO = "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30";
const CHIP_NARANJA = "bg-brand-orange/10 text-[#8A5200] border-brand-orange/40";
const PRIORIDADES: PrioridadTicket[] = ["alta", "media", "baja"];

const pl = (k: number, uno: string, varios: string) => `${n(k)} ${k === 1 ? uno : varios}`;

/** Hora de Asunción «HH:MM». */
const horaLocal = (iso: string) =>
  new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/** «vie 09/10 14:30», o solo «jue 08/10» si empieza con el día (una alerta de uso, un seguimiento vencido). */
const momento = (iso: string, dia: boolean) => (dia ? fechaHoraCorta(iso).slice(0, 9) : fechaHoraCorta(iso));
const numero = (x: number | null | undefined) => (x ? `#${String(x).padStart(4, "0")}` : "");

// ------------------------------------------------------------------ cabecera de la operación
function Tile({ titulo, valor, sub, tono, href, extra, children }: {
  titulo: string; valor: ReactNode; sub?: ReactNode; tono?: "rojo" | "naranja"; href?: string; extra?: ReactNode; children?: ReactNode;
}) {
  const color = tono === "rojo" ? "text-brand-primary-dark" : tono === "naranja" ? "text-[#8A5200]" : "text-brand-ink";
  const borde = tono === "rojo" ? "border-brand-primary/40" : tono === "naranja" ? "border-brand-orange/50" : "";
  const cuerpo = (
    <>
      <div className="flex items-start justify-between gap-2 min-h-[18px]">
        <span className="text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate leading-tight">{titulo}</span>
        {extra ?? (href && <ArrowRight size={14} aria-hidden className="text-brand-mist group-hover:text-brand-primary transition-colors shrink-0" />)}
      </div>
      <div className={`font-display text-4xl leading-none tabular-nums mt-2.5 ${color}`}>{valor}</div>
      {children && <div className="mt-3">{children}</div>}
      {sub && <div className="text-xs text-brand-slate mt-2 leading-snug">{sub}</div>}
    </>
  );
  const cls = `card p-4 min-w-0 flex flex-col ${borde}`;
  return href
    ? <Link href={href} className={`${cls} group hover:shadow-elevated transition-shadow`}>{cuerpo}</Link>
    : <div className={cls}>{cuerpo}</div>;
}

/** Barra fina de un porcentaje (0–100). */
function BarraPct({ pct, color = CYAN, etiqueta }: { pct: number | null; color?: string; etiqueta: string }) {
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,178,191,0.15)" }} role="img" aria-label={etiqueta}>
      {pct !== null && <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />}
    </div>
  );
}

/** % sin uso contra el umbral: la marca negra es el umbral; pasado, la barra va en rojo. */
export function BarraUmbral({ pct, umbral }: { pct: number | null; umbral: number }) {
  const max = Math.max(umbral * 2.5, pct ?? 0, 1);
  const w = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const malo = pct !== null && pct > umbral;
  return (
    <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,178,191,0.15)" }} role="img"
      aria-label={pct === null ? "Sin líneas evaluables" : `${num(pct)}% sin uso; umbral ${num(umbral)}%`}>
      {pct !== null && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: w(pct), background: malo ? ROJO : CYAN }} />}
      <div className="absolute inset-y-0 w-[2px] bg-brand-ink" style={{ left: `calc(${w(umbral)} - 1px)` }} aria-hidden />
    </div>
  );
}

function TileProyeccion({ titulo, p }: { titulo: string; p: Proyeccion }) {
  const firme = !p.provisoria;
  const tono = firme && p.estado === "bajo_objetivo" ? "rojo" : firme && p.estado === "en_riesgo" ? "naranja" : undefined;
  return (
    <Tile titulo={titulo} href={SUP_HREF} tono={tono} extra={<EstadoChip estado={p.estado} provisoria={p.provisoria} compacto />}
      valor={p.vendido === null ? "—" : <>{n(p.vendido)}{p.objetivo !== null && <span className="text-lg text-brand-slate"> / {n(p.objetivo)}</span>}</>}
      sub={p.proyeccion === null ? "Sin ventas del mes para proyectar" : (
        <>Cierra en <b className="text-brand-ink tabular-nums">{n(Math.round(p.proyeccion))}</b>
          {p.pct_proyeccion !== null ? ` · ${num(p.pct_proyeccion, 0)}% del objetivo` : " · sin objetivo cargado"}</>
      )}>
      {p.vendido !== null && <BarraAvance p={p} alto="h-1.5" etiqueta={`${titulo}: ${p.vendido} vendidas${p.objetivo ? ` de ${p.objetivo}` : ""}`} />}
    </Tile>
  );
}

function TileScore({ c, mesAnterior }: { c: CabeceraComando; mesAnterior: string }) {
  const d = c.score !== null && c.score_anterior !== null ? Math.round((c.score - c.score_anterior) * 10) / 10 : null;
  const Icono = d === null || d === 0 ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <Link href={`${SUP_HREF}/tablero`}
      className="group col-span-2 lg:row-span-2 xl:col-span-1 rounded-lg bg-brand-ink text-white p-5 flex flex-col gap-4 shadow-soft hover:shadow-elevated transition-shadow min-w-0">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider2 text-white/60">Score de la operación</span>
        <ArrowRight size={14} aria-hidden className="text-white/40 group-hover:text-white transition-colors" />
      </div>
      <div className="mt-auto">
        <div className="font-display text-7xl leading-none tabular-nums">
          {c.score === null ? "—" : num(c.score, 0)}<span className="text-2xl text-white/45"> / 100</span>
        </div>
        <div className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${d === null ? "text-white/50" : d > 0 ? "text-emerald-300" : d < 0 ? "text-[#FF9A8F]" : "text-white/70"}`}>
          {d !== null && <Icono size={14} aria-hidden />}
          {d === null ? `Sin puntaje en ${mesAnterior}` : `${d > 0 ? "+" : ""}${num(d)} vs ${mesAnterior}`}
        </div>
      </div>
      <MedidorScore total={c.score_parcial ? null : c.score} />
      <p className="text-[11px] text-white/55 leading-snug">
        {c.score_parcial ? "Parcial: todavía faltan datos de ventas, uso o conversación." : "Ventas contra objetivo, uso de líneas y conversación de todo el piso."}
      </p>
    </Link>
  );
}

/** Cabecera: cómo viene la operación hoy, en una mirada. */
export function CabeceraOperacion({ d }: { d: CentroComandos }) {
  const c = d.cabecera;
  const r = d.resumen_alertas;
  const cob = c.cobertura.de ? (c.cobertura.con / c.cobertura.de) * 100 : null;
  const usoMalo = c.uso.pct_sin_uso !== null && c.uso.pct_sin_uso > c.uso.umbral;
  const mesAnterior = new Date(`${d.periodo}-15T12:00:00`);
  mesAnterior.setMonth(mesAnterior.getMonth() - 1);
  const nombreAnterior = mesAnterior.toLocaleDateString("es-PY", { month: "long" });
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      <TileScore c={c} mesAnterior={nombreAnterior} />
      <TileProyeccion titulo="Pospago" p={c.pospago} />
      <TileProyeccion titulo="GPON" p={c.gpon} />
      <Tile titulo="Líneas sin uso" tono={usoMalo ? "rojo" : undefined} valor={c.uso.pct_sin_uso === null ? "—" : `${num(c.uso.pct_sin_uso)}%`}
        sub={c.uso.evaluables ? <>{n(c.uso.sin_uso)} de {n(c.uso.evaluables)} Pospago evaluables · umbral {num(c.uso.umbral)}%</> : "Sin líneas evaluables todavía"}>
        <BarraUmbral pct={c.uso.pct_sin_uso} umbral={c.uso.umbral} />
      </Tile>
      <Tile titulo="Alertas sin tomar" href="#alertas" tono={r.abiertas ? "naranja" : undefined} valor={n(r.abiertas)}
        sub={`${pl(r.nuevas, "nueva", "nuevas")} hoy · ${pl(r.tomadas + r.derivadas, "tomada", "tomadas")} · ${pl(r.cerradas, "resuelta", "resueltas")} hoy`} />
      <Tile titulo="Supervisores en crítico" href={SUP_HREF} tono={c.supervisores_criticos ? "rojo" : undefined}
        valor={<>{n(c.supervisores_criticos)}<span className="text-lg text-brand-slate"> / {n(c.supervisores)}</span></>}
        sub={c.asesores_en_alerta
          ? `${pl(c.asesores_en_alerta, "asesor", "asesores")} sobre el ${num(c.uso.umbral)}% sin uso`
          : `Ningún asesor sobre el ${num(c.uso.umbral)}% sin uso`} />
      <Tile titulo="Líneas a recuperar" tono={c.a_recuperar ? "naranja" : undefined} valor={n(c.a_recuperar)}
        sub={c.a_recuperar ? `Tienen que empezar a usarse para que cada asesor vuelva al ${num(c.uso.umbral)}%` : "Nada que recuperar"} />
      <Tile titulo="Tickets abiertos" href={`${SUP_HREF}/tickets`} tono={c.tickets.vencidos ? "rojo" : c.tickets.por_vencer ? "naranja" : undefined}
        valor={n(c.tickets.abiertos)} sub={`${pl(c.tickets.vencidos, "vencido", "vencidos")} · ${n(c.tickets.por_vencer)} por vencer`} />
      <Tile titulo="Cobertura de coaching" href={`${SUP_HREF}/coaching`} valor={cob === null ? "—" : `${num(cob, 0)}%`}
        sub={c.cobertura.de ? `${n(c.cobertura.con)} de ${pl(c.cobertura.de, "asesor", "asesores")} con coaching en el mes` : "Sin asesores en equipos"}>
        <BarraPct pct={cob} etiqueta={`Cobertura de coaching: ${cob === null ? "sin datos" : `${num(cob, 0)}%`}`} />
      </Tile>
    </div>
  );
}

// ------------------------------------------------------------------ semáforo de supervisores
function ProyMini({ p }: { p: Proyeccion }) {
  if (p.vendido === null) return <span className="text-brand-mist">—</span>;
  const firme = !p.provisoria;
  const tono = firme && p.estado === "bajo_objetivo" ? "text-brand-primary-dark" : firme && p.estado === "en_riesgo" ? "text-[#8A5200]"
    : p.estado === "en_camino" ? "text-emerald-700" : "text-brand-ink";
  return (
    <div className="tabular-nums" title={`${ESTADO[p.estado].label}${p.provisoria ? " · provisoria" : ""}: proyección al cierre contra el objetivo`}>
      <div className={`text-sm font-semibold ${tono}`}>{p.pct_proyeccion !== null ? `${num(p.pct_proyeccion, 0)}%` : `${n(p.vendido)} netas`}</div>
      <div className="text-[11px] text-brand-slate">{p.objetivo !== null ? `lleva ${n(p.vendido)} de ${n(p.objetivo)}` : "sin objetivo"}</div>
    </div>
  );
}

function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider2 text-brand-slate">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function Motivos({ f }: { f: FilaSemaforo }) {
  if (!f.motivos.length) {
    return <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><CircleCheck size={13} aria-hidden /> Sin pendientes</p>;
  }
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Motivos">
      {f.motivos.map((m, i) => (
        <li key={m} className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold leading-tight ${i < f.motivos_rojo ? CHIP_ROJO : CHIP_NARANJA}`}>{m}</li>
      ))}
    </ul>
  );
}

export function EstadoSemaforoChip({ estado }: { estado: EstadoSemaforo }) {
  const s = SEMAFORO[estado];
  return (
    <span title={s.ayuda} className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${s.chip}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} aria-hidden />{s.label}
    </span>
  );
}

function FilaSemaforoItem({ f, umbral, diasSinGestion }: { f: FilaSemaforo; umbral: number; diasSinGestion: number }) {
  const s = SEMAFORO[f.estado];
  const detalle = `${SUP_HREF}/supervisores/${f.id}`;
  const cob = f.cobertura;
  const sinGestion = !!f.asesores && f.dias_sin_gestion !== null && f.dias_sin_gestion >= diasSinGestion;
  return (
    <li className="relative px-5 py-4">
      <span aria-hidden className="absolute left-0 inset-y-0 w-1" style={{ background: s.color }} />
      <div className="flex flex-col xl:flex-row xl:items-start gap-3 xl:gap-6">
        <div className="xl:w-72 shrink-0 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={detalle} className="font-semibold text-brand-ink hover:text-brand-primary">{f.nombre}</Link>
            <EstadoSemaforoChip estado={f.estado} />
          </div>
          <div className="text-[11px] text-brand-slate mt-0.5">
            {f.asesores ? pl(f.asesores, "asesor", "asesores") : "Sin equipo este mes"}{!f.activo && " · ya no es supervisor"}
          </div>
          <Motivos f={f} />
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-3 flex-1 min-w-0">
          <Dato label="Score">
            <div className="flex items-baseline gap-2 tabular-nums">
              <span className={`text-sm font-semibold ${f.parcial ? "text-brand-slate" : "text-brand-ink"}`}>{f.score === null ? "—" : num(f.score, 0)}</span>
              {f.score !== null && f.anterior !== null && <TendenciaMini actual={f.score} anterior={f.anterior} />}
            </div>
            <div className="mt-1.5 w-16"><MedidorScore total={f.parcial ? null : f.score} alto="h-1" /></div>
          </Dato>
          <Dato label="Pospago"><ProyMini p={f.pospago} /></Dato>
          <Dato label="GPON"><ProyMini p={f.gpon} /></Dato>
          <Dato label="Uso de líneas">
            {f.asesores_en_alerta ? (
              <div className="tabular-nums">
                <div className="text-sm font-semibold text-brand-primary-dark">{pl(f.asesores_en_alerta, "en alerta", "en alerta")}</div>
                <div className="text-[11px] text-brand-slate">{pl(f.a_recuperar, "línea", "líneas")} a recuperar</div>
              </div>
            ) : <span className="text-[11px] font-semibold text-emerald-700" title={`Nadie sobre el ${num(umbral)}% sin uso`}>Sin alertas</span>}
          </Dato>
          <Dato label="Con coaching">
            <div className="text-sm font-semibold text-brand-ink tabular-nums" title={cob?.detalle}>
              {cob && cob.de ? `${n(cob.con ?? 0)} de ${n(cob.de)}` : "—"}
            </div>
            <div className={`text-[11px] ${sinGestion ? "text-brand-primary-dark font-semibold" : "text-brand-slate"}`}
              title={f.ultima_gestion ? `Última gestión registrada: ${fechaHoraCorta(f.ultima_gestion)}` : undefined}>
              {f.ultima_gestion ? `Gestión: ${fechaHoraCorta(f.ultima_gestion).slice(0, 9)} · ${haceDiasHabiles(f.dias_sin_gestion)}` : "Sin gestión registrada"}
            </div>
          </Dato>
          <Dato label="Tickets">
            {f.tickets.vencidos ? <span className="text-sm font-semibold text-brand-primary-dark">{pl(f.tickets.vencidos, "vencido", "vencidos")}</span>
              : f.tickets.por_vencer ? <span className="text-sm font-semibold text-[#8A5200]">{n(f.tickets.por_vencer)} por vencer</span>
                : <span className="text-sm text-brand-ink tabular-nums">{f.tickets.abiertos ? pl(f.tickets.abiertos, "abierto", "abiertos") : <span className="text-brand-mist">—</span>}</span>}
            {!!f.seguimientos_vencidos && <div className="text-[11px] text-brand-primary-dark">{pl(f.seguimientos_vencidos, "seguimiento vencido", "seguimientos vencidos")}</div>}
          </Dato>
        </dl>
        <div className="flex xl:flex-col gap-4 xl:gap-1.5 xl:items-end shrink-0 text-xs font-semibold">
          <Link href={detalle} className="inline-flex items-center gap-1 text-brand-primary hover:underline whitespace-nowrap">Detalle <ArrowRight size={13} aria-hidden /></Link>
          <Link href={`${detalle}/linea`} className="inline-flex items-center gap-1 text-brand-slate hover:text-brand-primary whitespace-nowrap"><History size={13} aria-hidden /> Línea de tiempo</Link>
        </div>
      </div>
    </li>
  );
}

function TendenciaMini({ actual, anterior }: { actual: number; anterior: number }) {
  const d = Math.round((actual - anterior) * 10) / 10;
  const Icono = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold ${d > 0 ? "text-emerald-700" : d < 0 ? "text-brand-primary-dark" : "text-brand-slate"}`}
      title={`Mes anterior: ${num(anterior)}`}>
      <Icono size={12} aria-hidden />{d > 0 ? "+" : ""}{num(d)}
    </span>
  );
}

export function Semaforo({ filas, umbral, diasSinGestion }: { filas: FilaSemaforo[]; umbral: number; diasSinGestion: number }) {
  const cuenta = (e: EstadoSemaforo) => filas.filter((f) => f.estado === e).length;
  return (
    <section className="card min-w-0" aria-labelledby="semaforo-titulo">
      <div className="px-5 pt-5 pb-3 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 id="semaforo-titulo" className="font-display text-xl uppercase text-brand-ink leading-tight">Semáforo de supervisores</h2>
          <p className="text-xs text-brand-slate mt-0.5">
            Primero quien necesita atención hoy. Motivos en rojo: vencidos o fuera de objetivo; en naranja: todavía a tiempo.
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap" aria-label="Resumen del semáforo">
          {(["atencion", "revisar", "al_dia"] as EstadoSemaforo[]).map((e) => (
            <span key={e} className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-semibold ${SEMAFORO[e].chip}`}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: SEMAFORO[e].color }} aria-hidden />
              {SEMAFORO[e].label} <b className="tabular-nums">{cuenta(e)}</b>
            </span>
          ))}
        </div>
      </div>
      {filas.length ? (
        <ul className="divide-y divide-brand-border border-t border-brand-border">
          {filas.map((f) => <FilaSemaforoItem key={f.id} f={f} umbral={umbral} diasSinGestion={diasSinGestion} />)}
        </ul>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-brand-slate border-t border-brand-border">No hay supervisores activos ni equipos este mes.</p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ alertas del día
type Filtro = "atender" | "sin_tomar" | "nuevas" | "resueltas" | "todas";
const FILTROS: { k: Filtro; label: string; f: (a: AlertaComando) => boolean }[] = [
  { k: "atender", label: "Para atender", f: (a) => a.estado === "abierta" || a.estado === "tomada" || a.estado === "derivada" },
  { k: "sin_tomar", label: "Sin tomar", f: (a) => a.estado === "abierta" },
  { k: "nuevas", label: "Nuevas hoy", f: (a) => a.nueva && a.estado !== "cerrada" },
  { k: "resueltas", label: "Resueltas hoy", f: (a) => a.estado === "cerrada" },
  { k: "todas", label: "Todas", f: () => true },
];

const ICONO_ALERTA: Record<TipoAlertaComando, typeof Siren> = {
  ticket_vencido: TicketX, supervisor_critico: Siren, proyeccion_bajo: TrendingDown, seguimiento_vencido: CalendarX,
  asesor_alerta: TriangleAlert, sin_actividad: Clock3, sin_supervisor: UserRoundX, sin_vincular: Link2Off,
};
const COLOR_SEVERIDAD = ["#E6332A", "#F39200", "#5B6275"];

type Accion = "tomar" | "revision" | "descartar";

function EnlaceAlerta({ href, onClick, icono: I, children }: { href?: string; onClick?: () => void; icono: typeof Siren; children: ReactNode }) {
  const cls = "inline-flex items-center gap-1 text-[11px] font-semibold text-brand-slate hover:text-brand-primary whitespace-nowrap";
  return href
    ? <Link href={href} className={cls}><I size={12} aria-hidden />{children}</Link>
    : <button type="button" onClick={onClick} className={cls}><I size={12} aria-hidden />{children}</button>;
}

function ItemAlerta({ a, puedeActuar, puedeDerivar, onAccion, onTicket, onCoaching }: {
  a: AlertaComando; puedeActuar: boolean; puedeDerivar: boolean; onAccion: (x: Accion, a: AlertaComando) => void; onTicket: (id: string) => void;
  onCoaching: (id: string) => void;
}) {
  const I = ICONO_ALERTA[a.tipo] ?? BellRing;
  const activa = a.estado !== "cerrada" && a.estado !== "descartada";
  const color = activa ? COLOR_SEVERIDAD[a.severidad] ?? COLOR_SEVERIDAD[2] : a.estado === "cerrada" ? "#059669" : "#9CA3AF";
  const e = ESTADO_ALERTA_COMANDO[a.estado];
  const ticketVencido = a.tipo === "ticket_vencido" && a.datos.ticket_id ? { id: a.datos.ticket_id, numero: a.datos.numero } : null;
  return (
    <li className={`relative px-5 py-4 flex gap-3.5 ${activa ? "" : "bg-brand-bg-soft"}`}>
      <span aria-hidden className="absolute left-0 inset-y-0 w-1" style={{ background: color }} />
      <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: `${color}17`, color }}>
        {a.estado === "cerrada" ? <CircleCheck size={17} aria-hidden /> : <I size={17} aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[11px]">
          <span className="font-semibold uppercase tracking-wider2 text-brand-slate">{a.tipo_nombre}</span>
          <span title={e.ayuda} className={`inline-flex items-center rounded border px-1.5 py-0 text-[10px] font-semibold ${e.chip}`}>{e.label}</span>
          {a.nueva && activa && <span className="rounded bg-brand-ink text-white px-1.5 py-0 text-[10px] font-bold uppercase tracking-wider2">Nueva</span>}
          <span className="text-brand-slate tabular-nums">desde {momento(a.desde, a.desde_dia)}</span>
        </div>
        <div className={`mt-1 text-sm font-semibold break-words ${activa ? "text-brand-ink" : "text-brand-slate"}`}>{a.titulo}</div>
        <p className="text-xs text-brand-graphite mt-0.5 leading-relaxed break-words">{a.detalle}</p>

        {(a.tomada_por || a.nota || a.ticket_id || a.descartada_por || a.hasta) && (
          <div className="mt-2 space-y-1.5 text-[11px] text-brand-slate">
            {a.tomada_por && (
              <div className="flex items-center gap-1"><Hand size={12} aria-hidden /> Tomada por <b className="text-brand-ink">{a.tomada_por}</b> · {fechaHoraCorta(a.tomada_at)}</div>
            )}
            {a.nota && (
              <blockquote className="border-l-2 border-brand-cyan/60 pl-2.5 text-xs text-brand-graphite whitespace-pre-line break-words">
                {a.nota}
                <div className="text-[10px] text-brand-slate mt-0.5">{a.nota_por ?? a.tomada_por} · {fechaHoraCorta(a.nota_at)}</div>
              </blockquote>
            )}
            {a.ticket_id && (
              <button type="button" onClick={() => onTicket(a.ticket_id!)} className="inline-flex items-center gap-1 font-semibold text-[#00727A] hover:underline">
                <Send size={12} aria-hidden /> Revisión pedida: ticket {numero(a.ticket_numero)}
              </button>
            )}
            {a.descartada_por && (
              <div className="flex items-start gap-1"><CircleSlash size={12} className="mt-0.5 shrink-0" aria-hidden />
                <span>Descartada por <b className="text-brand-ink">{a.descartada_por}</b>: {a.descartada_motivo}</span>
              </div>
            )}
            {a.hasta && (
              <div className="flex items-center gap-1 text-emerald-700 font-semibold"><CircleCheck size={12} aria-hidden /> Se cerró sola: la condición dejó de cumplirse · {fechaHoraCorta(a.hasta)}</div>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {puedeActuar && activa && (
            <div className="flex flex-wrap gap-2">
              {a.puede_revision && puedeDerivar && (
                <button type="button" className="btn-primary !px-3 !py-1.5 !text-xs" onClick={() => onAccion("revision", a)}>
                  <Send size={13} aria-hidden /> Pedir revisión
                </button>
              )}
              <button type="button" className="btn-secondary !px-3 !py-1.5 !text-xs" onClick={() => onAccion("tomar", a)}>
                {a.tomada_por ? <><MessageSquareText size={13} aria-hidden /> Anotar qué se hizo</> : <><Hand size={13} aria-hidden /> Tomar</>}
              </button>
              {a.estado !== "derivada" && (
                <button type="button" className="btn-ghost !px-2.5 !py-1.5 !text-xs" onClick={() => onAccion("descartar", a)}>
                  <CircleSlash size={13} aria-hidden /> Descartar
                </button>
              )}
            </div>
          )}
          {puedeActuar && a.estado === "cerrada" && (
            <button type="button" className="btn-ghost !px-2.5 !py-1.5 !text-xs" onClick={() => onAccion("tomar", a)}>
              <MessageSquareText size={13} aria-hidden /> {a.nota ? "Cambiar la nota" : "Anotar cómo se resolvió"}
            </button>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {ticketVencido && <EnlaceAlerta icono={Ticket} onClick={() => onTicket(ticketVencido.id)}>Ver ticket {numero(ticketVencido.numero)}</EnlaceAlerta>}
            {a.tipo === "seguimiento_vencido" && a.datos.coaching_id && (
              <EnlaceAlerta icono={ClipboardCheck} onClick={() => onCoaching(a.datos.coaching_id!)}>Ver coaching</EnlaceAlerta>
            )}
            {a.operador_id && <EnlaceAlerta icono={IdCard} href={`${SUP_HREF}/asesores/${a.operador_id}`}>Ficha de {a.operador ?? "el asesor"}</EnlaceAlerta>}
            {a.supervisor_id && a.tipo !== "ticket_vencido" && (
              a.tipo === "sin_actividad"
                ? <EnlaceAlerta icono={History} href={`${SUP_HREF}/supervisores/${a.supervisor_id}/linea`}>Línea de tiempo</EnlaceAlerta>
                : <EnlaceAlerta icono={Users} href={`${SUP_HREF}/supervisores/${a.supervisor_id}`}>{a.supervisor ?? "Supervisor"}</EnlaceAlerta>
            )}
            {a.tipo === "sin_supervisor" && <EnlaceAlerta icono={Users} href={`${SUP_HREF}/equipos`}>Equipos del mes</EnlaceAlerta>}
            {a.tipo === "sin_vincular" && <EnlaceAlerta icono={Link2Off} href={`${SUP_HREF}/operadores`}>Maestro de operadores</EnlaceAlerta>}
          </div>
        </div>
      </div>
    </li>
  );
}

function ResumenAlerta({ a }: { a: AlertaComando }) {
  return (
    <div className="rounded-md border border-brand-border bg-brand-bg-soft px-3 py-2.5 mb-4">
      <div className="text-sm font-semibold text-brand-ink break-words">{a.titulo}</div>
      <p className="text-xs text-brand-slate mt-0.5 break-words">{a.detalle}</p>
    </div>
  );
}

function TomarDialog({ a, onClose, onHecho }: { a: AlertaComando; onClose: () => void; onHecho: (x: AlertaComando) => void }) {
  const requiere = !!a.tomada_por || a.estado === "cerrada";
  const [nota, setNota] = useState(a.nota ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const largo = nota.trim().length;
  const valido = requiere ? largo >= 5 : largo === 0 || largo >= 5;
  const enviar = async () => {
    setOcupado(true);
    setError(null);
    try {
      onHecho(await apiFetch<AlertaComando>(`${SUP_API}/comando/alertas/${a.id}/tomar`, {
        method: "POST", body: JSON.stringify({ nota: nota.trim() || null }),
      }));
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <Modal onClose={onClose} sobre={a.tipo_nombre} titulo={requiere ? "Anotar qué se hizo" : "Tomar la alerta"}
      pie={<>
        <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={ocupado || !valido} onClick={enviar}>
          {requiere ? <MessageSquareText size={15} aria-hidden /> : <Hand size={15} aria-hidden />} {ocupado ? "Guardando…" : requiere ? "Guardar nota" : "Tomar"}
        </button>
      </>}>
      <ResumenAlerta a={a} />
      {a.tomada_por && <p className="text-xs text-brand-slate mb-3">La tomó <b className="text-brand-ink">{a.tomada_por}</b> el {fechaHoraCorta(a.tomada_at)}.</p>}
      <Campo label={requiere ? "Qué se hizo" : "Qué vas a hacer o qué hiciste (opcional)"} htmlFor="al-nota"
        ayuda="Queda en la alerta y en la línea de tiempo del supervisor.">
        <AreaTexto id="al-nota" valor={nota} onChange={setNota} min={requiere || largo ? 5 : 0} max={1000} filas={3}
          placeholder="Ej.: hablé con la supervisora; registra hoy el coaching sobre uso y el seguimiento queda para el lunes." />
      </Campo>
      <ErrorMsg msg={error} />
    </Modal>
  );
}

function RevisionDialog({ a, d, onClose, onHecho }: {
  a: AlertaComando; d: CentroComandos; onClose: () => void; onHecho: (x: AlertaComando & { ticket: { id: string; numero: number } }) => void;
}) {
  const [prioridad, setPrioridad] = useState<PrioridadTicket>(a.severidad === 0 ? "alta" : a.severidad === 1 ? "media" : "baja");
  const [tipo, setTipo] = useState<TipoTicket>(d.tipo_revision[a.tipo] ?? "otro");
  const [texto, setTexto] = useState(`${a.titulo}.\n${a.detalle}\n\nRevisar: `);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = document.getElementById("rv-texto") as HTMLTextAreaElement | null;
    if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
  }, []);
  const enviar = async () => {
    setOcupado(true);
    setError(null);
    try {
      onHecho(await apiFetch(`${SUP_API}/comando/alertas/${a.id}/revision`, {
        method: "POST", body: JSON.stringify({ prioridad, tipo, texto }),
      }));
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  const tipos = Object.entries(d.tipos_ticket) as [TipoTicket, string][];
  return (
    <Modal onClose={onClose} ancho="max-w-2xl" sobre="Pedir revisión" titulo={`Ticket a ${a.supervisor ?? "el supervisor"}`}
      pie={<>
        <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={ocupado || texto.trim().length < 10} onClick={enviar}>
          <Send size={15} aria-hidden /> {ocupado ? "Enviando…" : "Enviar ticket"}
        </button>
      </>}>
      <div className="space-y-4">
        <p className="text-xs text-[#1D5BA6] bg-[#2A78D6]/10 border border-[#2A78D6]/30 rounded-md px-3 py-2">
          Llega a <b>{a.supervisor}</b>{a.operador && <> sobre <b>{a.operador}</b> (caso del {dm(a.desde.slice(0, 10))})</>}, con los plazos de la
          prioridad. La alerta queda derivada a ese ticket.
        </p>
        <div>
          <div className="label">Tipo</div>
          <div role="radiogroup" aria-label="Tipo de caso" className="flex flex-wrap gap-1.5">
            {tipos.map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={tipo === k} onClick={() => setTipo(k)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${tipo === k ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border text-brand-graphite hover:border-brand-slate"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="label">Prioridad</div>
          <div role="radiogroup" aria-label="Prioridad" className="grid sm:grid-cols-3 gap-2">
            {PRIORIDADES.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={prioridad === p} onClick={() => setPrioridad(p)}
                className={`text-left rounded-md border px-3 py-2 transition-colors ${prioridad === p ? "border-brand-primary bg-brand-primary-light/60" : "border-brand-border hover:border-brand-slate"}`}>
                <div className="text-sm font-semibold text-brand-ink">{PRIORIDAD[p].label}</div>
                <div className="text-[11px] text-brand-slate leading-snug mt-0.5">
                  Respuesta en {plazoTexto(d.plazos[p].respuesta)}; resolución en {plazoTexto(d.plazos[p].resolucion)}
                </div>
              </button>
            ))}
          </div>
        </div>
        <Campo label="Qué tiene que revisar" htmlFor="rv-texto" ayuda={`Va como descripción del ticket, con la referencia «Centro de comandos · ${a.tipo_nombre}».`}>
          <AreaTexto id="rv-texto" valor={texto} onChange={setTexto} min={10} max={4000} filas={6} />
        </Campo>
        <ErrorMsg msg={error} />
      </div>
    </Modal>
  );
}

function DescartarDialog({ a, onClose, onHecho }: { a: AlertaComando; onClose: () => void; onHecho: (x: AlertaComando) => void }) {
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enviar = async () => {
    setOcupado(true);
    setError(null);
    try {
      onHecho(await apiFetch<AlertaComando>(`${SUP_API}/comando/alertas/${a.id}/descartar`, { method: "POST", body: JSON.stringify({ motivo }) }));
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <Modal onClose={onClose} sobre={a.tipo_nombre} titulo="Descartar la alerta" acento="bg-brand-mist"
      pie={<>
        <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn-danger" disabled={ocupado || motivo.trim().length < 5} onClick={enviar}>
          <CircleSlash size={15} aria-hidden /> {ocupado ? "Guardando…" : "Descartar"}
        </button>
      </>}>
      <ResumenAlerta a={a} />
      <Campo label="Por qué no requiere acción" htmlFor="al-motivo"
        ayuda="Queda el motivo y quién la descartó. Si la condición se va y vuelve a aparecer, es una alerta nueva.">
        <AreaTexto id="al-motivo" valor={motivo} onChange={setMotivo} min={5} max={500} placeholder="Ej.: la asesora está de vacaciones hasta el lunes." />
      </Campo>
      <ErrorMsg msg={error} />
    </Modal>
  );
}

/** Alertas del día: lo que hoy pide atención, quién lo tomó y qué se hizo. */
export function AlertasDia({ d, onCambio }: { d: CentroComandos; onCambio: () => void }) {
  const [filtro, setFiltro] = useState<Filtro>("atender");
  const [sup, setSup] = useState("");
  const [cambios, setCambios] = useState<Record<string, AlertaComando>>({});
  const [dialogo, setDialogo] = useState<{ accion: Accion; a: AlertaComando } | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [coaching, setCoaching] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Lo que se acaba de hacer se ve al instante; la recarga trae el resto (y lo reemplaza).
  useEffect(() => { setCambios({}); }, [d.alertas]);
  const alertas = useMemo(() => d.alertas.map((a) => (cambios[a.id] ? { ...a, ...cambios[a.id] } : a)), [d.alertas, cambios]);
  const supervisores = useMemo(() => {
    const m = new Map<string, string>();
    alertas.forEach((a) => a.supervisor_id && m.set(a.supervisor_id, a.supervisor ?? "—"));
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [alertas]);
  const porSup = alertas.filter((a) => !sup || (sup === "__general__" ? !a.supervisor_id : a.supervisor_id === sup));
  const actual = FILTROS.find((x) => x.k === filtro)!;
  const visibles = porSup.filter(actual.f);

  const hecho = (x: AlertaComando, texto: string) => {
    setCambios((c) => ({ ...c, [x.id]: x }));
    setDialogo(null);
    setAviso(texto);
    onCambio();
  };
  const lista = d.supervisores.filter((s) => s.activo).map((s) => ({ id: s.id, nombre: s.nombre }));

  return (
    <section id="alertas" className="card min-w-0 scroll-mt-24" aria-labelledby="alertas-titulo">
      <div className="px-5 pt-5 pb-3 space-y-3">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h2 id="alertas-titulo" className="font-display text-xl uppercase text-brand-ink leading-tight">Alertas del día</h2>
            <p className="text-xs text-brand-slate mt-0.5 max-w-2xl">
              Se abren solas cuando aparece la condición y se cierran cuando deja de cumplirse. Cada una muestra quién la tomó y qué hizo.
              {!d.puede_actuar && " Tomarlas, pedir revisiones y descartarlas es de quienes gestionan Supervisión: acá se ven en lectura."}
            </p>
          </div>
          <select aria-label="Filtrar por supervisor" className="input !w-auto !py-1.5 text-xs" value={sup} onChange={(e) => setSup(e.target.value)}>
            <option value="">Todos los supervisores</option>
            {supervisores.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
            <option value="__general__">De la operación (sin supervisor)</option>
          </select>
        </div>
        <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="Qué alertas ver">
          {FILTROS.map((x) => {
            const k = porSup.filter(x.f).length;
            return (
              <button key={x.k} type="button" role="tab" aria-selected={filtro === x.k} onClick={() => setFiltro(x.k)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors inline-flex items-center gap-1.5 ${filtro === x.k ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border text-brand-graphite hover:border-brand-slate"}`}>
                {x.label}<span className={`tabular-nums ${filtro === x.k ? "text-white/70" : "text-brand-slate"}`}>{k}</span>
              </button>
            );
          })}
        </div>
        {aviso && (
          <div role="status" className="flex items-start justify-between gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-md px-3 py-2">
            <span className="inline-flex items-center gap-2"><CircleCheck size={16} aria-hidden /> {aviso}</span>
            <button type="button" className="text-xs font-semibold hover:underline" onClick={() => setAviso(null)}>Cerrar</button>
          </div>
        )}
      </div>
      {visibles.length ? (
        <ul className="divide-y divide-brand-border border-t border-brand-border">
          {visibles.map((a) => (
            <ItemAlerta key={a.id} a={a} puedeActuar={d.puede_actuar} puedeDerivar={d.puede_derivar} onAccion={(accion, x) => setDialogo({ accion, a: x })}
              onTicket={setTicket} onCoaching={setCoaching} />
          ))}
        </ul>
      ) : (
        <div className="px-5 py-10 text-center text-sm text-brand-slate border-t border-brand-border">
          <CircleCheck size={22} className="mx-auto mb-2 text-emerald-600" aria-hidden />
          {filtro === "resueltas" ? "Todavía no se resolvió ninguna hoy." : filtro === "todas" ? "Sin alertas hoy." : "Nada pendiente con este filtro."}
        </div>
      )}
      {dialogo?.accion === "tomar" && (
        <TomarDialog a={dialogo.a} onClose={() => setDialogo(null)}
          onHecho={(x) => hecho(x, dialogo.a.tomada_por || dialogo.a.estado === "cerrada" ? "Nota guardada." : "Alerta tomada.")} />
      )}
      {dialogo?.accion === "revision" && (
        <RevisionDialog a={dialogo.a} d={d} onClose={() => setDialogo(null)}
          onHecho={(x) => hecho(x, `Ticket ${numero(x.ticket.numero)} enviado a ${x.supervisor ?? "el supervisor"}.`)} />
      )}
      {dialogo?.accion === "descartar" && (
        <DescartarDialog a={dialogo.a} onClose={() => setDialogo(null)} onHecho={(x) => hecho(x, "Alerta descartada.")} />
      )}
      {ticket && <TicketDialog id={ticket} portal={false} supervisores={lista} onClose={() => setTicket(null)} onCambio={onCambio} />}
      {coaching && <VerCoachingDialog id={coaching} onClose={() => setCoaching(null)} />}
    </section>
  );
}

// ------------------------------------------------------------------ rutina y método
const RUTINA = [
  { quien: "Coordinador", cuando: "Cada día, 15 min", que: "Alertas del día: toma cada una o la deriva como ticket. Supervisores sin actividad." },
  { quien: "Coordinador", cuando: "Cada semana, 30 min por supervisor", que: "Avance, proyección, asesores en alerta, coachings y tickets, con los datos en pantalla." },
  { quien: "Sub gerente y controller", cuando: "Cada semana", que: "Ranking y tendencias; supervisores que siguen en crítico o bajo objetivo." },
  { quien: "Sub gerente", cuando: "Fin de mes", que: "Cierre con el corte final de Ventas Netas y objetivos del mes siguiente." },
];

export function RutinaCard() {
  return (
    <section className="card p-5 min-w-0">
      <h2 className="font-display text-lg uppercase text-brand-ink leading-tight">Rutina de seguimiento</h2>
      <p className="text-xs text-brand-slate mt-0.5">Quién mira el centro de comandos y cada cuánto, según la guía del modelo.</p>
      <ol className="mt-3 divide-y divide-brand-border">
        {RUTINA.map((r) => (
          <li key={r.quien + r.cuando} className="py-2.5 grid sm:grid-cols-[190px_minmax(0,1fr)] gap-x-4 gap-y-0.5">
            <div>
              <div className="text-sm font-semibold text-brand-ink">{r.quien}</div>
              <div className="text-[11px] text-brand-slate inline-flex items-center gap-1"><CalendarClock size={12} aria-hidden /> {r.cuando}</div>
            </div>
            <p className="text-xs text-brand-graphite leading-relaxed">{r.que}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function MetodoComando({ d }: { d: CentroComandos }) {
  const r = d.reglas;
  return (
    <section className="card p-5 min-w-0">
      <h2 className="font-display text-lg uppercase text-brand-ink leading-tight">Cómo funciona</h2>
      <div className="mt-3 space-y-3 text-xs text-brand-slate leading-relaxed">
        <p>
          <b className="text-brand-ink">Atención:</b> un ticket o un seguimiento vencido, una alerta de uso sin coaching en {r.dias_foco} días hábiles,
          una proyección por debajo del {num(r.semaforo_en_riesgo, 0)}% del objetivo (si no es provisoria) o {r.dias_sin_gestion} días hábiles o más
          sin registrar gestión. <b className="text-brand-ink">Revisar:</b> asesores sobre el {num(r.umbral_sin_uso)}% sin uso, proyección en riesgo
          o plazos por vencer. <b className="text-brand-ink">Al día:</b> nada de eso.
        </p>
        <p>
          <b className="text-brand-ink">Gestión registrada:</b> coachings, seguimientos, notas de bitácora y respuestas a tickets
          {d.gestion_desde ? `, desde el ${dm(d.gestion_desde)}` : ""}. Los días hábiles salen del calendario de la operación.
        </p>
        <p>
          <b className="text-brand-ink">Alertas:</b> se ponen al día cada vez que se abre esta pantalla. Tomarla deja quién la atiende y qué hizo;
          pedir revisión manda un ticket al supervisor con sus plazos; descartarla pide el motivo. Todo queda en la auditoría y en la línea de
          tiempo del supervisor.
        </p>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ línea de tiempo de un supervisor
const ICONO_GRUPO: Record<GrupoEvento, typeof Siren> = {
  coaching: MessageSquareText, seguimiento: ClipboardCheck, ticket: Ticket, nota: NotebookPen, equipo: Users, objetivo: Target, alerta: BellRing,
};

const diaLocal = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

function etiquetaDia(dia: string, hoy: string): string {
  const d = new Date(`${dia}T12:00:00`);
  const h = new Date(`${hoy}T12:00:00`);
  const dif = Math.round((h.getTime() - d.getTime()) / 86400000);
  const largo = d.toLocaleDateString("es-PY", { weekday: "long", day: "numeric", month: "long" });
  return dif === 0 ? `Hoy · ${largo}` : dif === 1 ? `Ayer · ${largo}` : largo.charAt(0).toUpperCase() + largo.slice(1);
}

export function LineaDeTiempo({ d, supervisores, onCambio }: {
  d: LineaTiempo; supervisores?: { id: string; nombre: string }[]; onCambio?: () => void;
}) {
  const [grupo, setGrupo] = useState<GrupoEvento | "">("");
  const [ticket, setTicket] = useState<string | null>(null);
  const [coaching, setCoaching] = useState<string | null>(null);
  const eventos = grupo ? d.eventos.filter((e) => e.grupo === grupo) : d.eventos;
  const dias = useMemo(() => {
    const out: { dia: string; items: EventoLinea[] }[] = [];
    for (const e of eventos) {
      const k = e.at ? diaLocal(e.at) : "—";
      if (out.length && out[out.length - 1].dia === k) out[out.length - 1].items.push(e);
      else out.push({ dia: k, items: [e] });
    }
    return out;
  }, [eventos]);
  const grupos = (Object.keys(GRUPO_EVENTO) as GrupoEvento[]).filter((g) => d.grupos[g]);
  return (
    <section className="card min-w-0">
      <div className="px-5 pt-5 pb-3 space-y-3">
        <div>
          <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Línea de tiempo</h2>
          <p className="text-xs text-brand-slate mt-0.5">
            Todo lo que pasó con {d.supervisor.nombre} en {d.nombre_mes.toLowerCase()}, lo más nuevo primero: coachings y seguimientos, notas,
            tickets, cambios de equipo, objetivos y las alertas del centro de comandos.
          </p>
        </div>
        {!!grupos.length && (
          <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="Qué eventos ver">
            {[{ g: "" as const, label: "Todo", k: d.eventos.length }, ...grupos.map((g) => ({ g, label: GRUPO_EVENTO[g].label, k: d.grupos[g] ?? 0 }))].map((x) => (
              <button key={x.g || "todo"} type="button" role="tab" aria-selected={grupo === x.g} onClick={() => setGrupo(x.g)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors inline-flex items-center gap-1.5 ${grupo === x.g ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border text-brand-graphite hover:border-brand-slate"}`}>
                {x.g && <span className="w-1.5 h-1.5 rounded-full" style={{ background: GRUPO_EVENTO[x.g].color }} aria-hidden />}
                {x.label}<span className={`tabular-nums ${grupo === x.g ? "text-white/70" : "text-brand-slate"}`}>{x.k}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {!dias.length ? (
        <div className="px-5 py-10 text-center text-sm text-brand-slate border-t border-brand-border">
          <History size={22} className="mx-auto mb-2 text-brand-mist" aria-hidden />Sin movimientos en {d.nombre_mes.toLowerCase()}.
        </div>
      ) : (
        <ol className="px-5 pb-6 border-t border-brand-border">
          {dias.map(({ dia, items }) => (
            <li key={dia} className="pt-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate mb-1">{dia === "—" ? "Sin fecha" : etiquetaDia(dia, d.hoy)}</h3>
              <ol className="relative ml-3.5 border-l border-brand-border">
                {items.map((e, i) => {
                  const I = ICONO_GRUPO[e.grupo] ?? History;
                  const color = GRUPO_EVENTO[e.grupo]?.color ?? "#5B6275";
                  return (
                    <li key={`${e.at}-${i}`} className="relative pl-7 py-2.5 grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2">
                      <span className="absolute -left-[14px] top-2 w-7 h-7 rounded-full bg-white border-2 flex items-center justify-center"
                        style={{ borderColor: color, color }} aria-hidden>
                        <I size={13} />
                      </span>
                      <span className="text-[11px] tabular-nums text-brand-slate pt-0.5" title={e.dia ? "Empieza con el día" : undefined}>
                        {e.at && !e.dia ? horaLocal(e.at) : "·"}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-brand-ink break-words">{e.titulo}</div>
                        {e.detalle && <p className="text-xs text-brand-graphite mt-0.5 whitespace-pre-line break-words line-clamp-4">{e.detalle}</p>}
                        {(e.por || e.ticket_id || e.coaching_id || e.operador_id) && (
                          <div className="text-[11px] text-brand-slate mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            {e.por && <span>por {e.por}</span>}
                            {e.ticket_id && <button type="button" onClick={() => setTicket(e.ticket_id!)} className="font-semibold text-brand-primary hover:underline">Ver ticket</button>}
                            {e.coaching_id && <button type="button" onClick={() => setCoaching(e.coaching_id!)} className="font-semibold text-brand-primary hover:underline">Ver coaching</button>}
                            {e.operador_id && (
                              <Link href={`${SUP_HREF}/asesores/${e.operador_id}?periodo=${d.periodo}`} className="font-semibold text-brand-primary hover:underline">Ficha del asesor</Link>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}
      {ticket && <TicketDialog id={ticket} portal={false} supervisores={supervisores} onClose={() => setTicket(null)} onCambio={() => onCambio?.()} />}
      {coaching && <VerCoachingDialog id={coaching} onClose={() => setCoaching(null)} />}
    </section>
  );
}
