"use client";

import {
  Ban, CalendarCheck, CalendarClock, CircleCheck, CircleDashed, ClipboardCheck, CornerDownRight, History, Info, MessageSquarePlus,
  MessageSquareText, NotebookPen, Pencil, Plus, Target, Ticket, TriangleAlert, Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { fechaCorta, fechaLarga, n } from "@/components/productividad/tipos";
import { apiFetch } from "@/lib/api";
import { CoachingDialog, Modal, NotaDialog, SeguimientoDialog, TextoDialog, type Inicial } from "./dialogos";
import { BotonCoaching, CoachingFlotante, leerNuevoCoaching } from "./hacer-coaching";
import { ImpactoVista, ResultadoChip } from "./impacto";
import { MedidorScore, ScoreCelda } from "./scoring";
import {
  ALERTA, METRICA, SEGUIMIENTO, SUP_API, TIPO_COACHING, TIPO_NOTA, diasEntre, dm, fechaHoraPy, metricasDe, nombreMetricas, num,
  type AlertaFoco, type Coaching, type CoachingDetalle, type Componente, type EventoCoaching, type MiembroCoaching,
  type NotaBitacora, type ReglasCoaching, type VistaCoachingData,
} from "./tipos";

type Dialogo =
  | { tipo: "nuevo"; inicial?: Inicial }
  | { tipo: "editar"; c: Coaching }
  | { tipo: "seguimiento"; c: Coaching }
  | { tipo: "anular"; c: Coaching }
  | { tipo: "aclaracion"; c: Coaching }
  | { tipo: "detalle"; id: string }
  | { tipo: "nota" }
  | null;

function Chip({ label, chip, ayuda, icono }: { label: string; chip: string; ayuda?: string; icono?: ReactNode }) {
  return (
    <span title={ayuda} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0 text-[10px] font-semibold whitespace-nowrap ${chip}`}>
      {icono}{label}
    </span>
  );
}

function Vacio({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-brand-slate border-t border-brand-border">{children}</p>;
}

function Cabecera({ titulo, sub, accion }: { titulo: string; sub?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">{titulo}</h2>
        {sub && <p className="text-xs text-brand-slate mt-0.5 leading-relaxed">{sub}</p>}
      </div>
      {accion}
    </div>
  );
}

const plural = (k: number, uno: string, varios: string) => `${n(k)} ${k === 1 ? uno : varios}`;

// ------------------------------------------------------------------ gestión del mes (lo que suma al scoring)
const ICONO_PARTE: Record<string, typeof Users> = { cobertura: Users, foco: Target, seguimiento: CalendarCheck, tickets: Ticket };

function KpiGestion({ p }: { p: Componente }) {
  const I = ICONO_PARTE[p.clave] ?? Users;
  const evaluado = p.rel !== null;
  return (
    <div className="card p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate">
          <I size={14} aria-hidden /> {p.nombre}
        </div>
        <span className="text-[11px] text-brand-slate tabular-nums whitespace-nowrap">
          {evaluado ? <><b className="text-brand-ink">{num(p.puntos)}</b> / {num(p.peso_efectivo)} pts</> : p.pendiente ? "Pendiente" : "No se evalúa"}
        </span>
      </div>
      <div className={`font-display text-4xl leading-none tabular-nums ${evaluado ? "text-brand-ink" : "text-brand-mist"}`}>
        {evaluado ? `${num(p.valor, 0)}%` : "—"}
      </div>
      <MedidorScore total={evaluado ? p.valor : null} alto="h-1.5" />
      <p className="text-xs text-brand-slate leading-snug">
        {p.detalle ?? (p.clave === "tickets" ? "Se suma con los tickets de revisión" : "Se suma con el registro de coaching")}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ alertas de uso (foco)
function AlertasCard({ alertas, diasFoco, onCoaching }: { alertas: AlertaFoco[]; diasFoco: number; onCoaching?: (i: Inicial) => void }) {
  return (
    <section className="card min-w-0 flex flex-col">
      <Cabecera titulo="Alertas de uso"
        sub={`Cada asesor en alerta necesita un coaching sobre uso de líneas dentro de los ${diasFoco} días hábiles desde que aparece.`} />
      {!alertas.length ? <Vacio>Sin alertas de uso este mes.</Vacio> : (
        <ul className="divide-y divide-brand-border border-t border-brand-border">
          {alertas.map((a) => {
            const e = ALERTA[a.estado];
            const pct = a.datos.pct_sin_uso;
            return (
              <li key={a.id} className={`px-5 py-3 flex items-center gap-x-3 gap-y-2 flex-wrap ${a.estado === "vencida" ? "shadow-[inset_3px_0_0_#E6332A]" : ""}`}>
                <div className="min-w-0 flex-1 basis-48">
                  <div className="font-semibold text-sm text-brand-ink truncate">{a.operador}</div>
                  <div className="text-[11px] text-brand-slate">
                    Desde el {dm(a.desde)}{pct !== null && pct !== undefined ? ` · ${num(pct)}% sin uso (${n(a.datos.sin_uso)} de ${n(a.datos.evaluables)})` : ""}
                    {a.estado === "en_plazo" && <> · vence el <b className="text-brand-ink">{fechaCorta(a.vence)}</b></>}
                    {a.estado === "vencida" && <> · venció el {fechaCorta(a.vence)}</>}
                    {a.estado === "cubierta" && a.coaching_fecha && <> · coaching el {dm(a.coaching_fecha)}</>}
                    {a.estado === "resuelta" && a.hasta && <> · salió el {dm(a.hasta)}</>}
                  </div>
                </div>
                <Chip label={e.label} chip={e.chip} ayuda={e.ayuda}
                  icono={a.estado === "cubierta" ? <CircleCheck size={11} aria-hidden /> : a.estado === "vencida" ? <TriangleAlert size={11} aria-hidden /> : undefined} />
                {onCoaching && (a.estado === "en_plazo" || a.estado === "vencida") && (
                  <button type="button" onClick={() => onCoaching({ operador_id: a.operador_id, metricas: ["uso"] })} className="btn-coaching-sm">
                    <MessageSquareText size={14} aria-hidden /> Hacer coaching
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ seguimientos pendientes
const DIAS_AVISO = 7; // «en N días»: los de la próxima semana

/** Cuándo toca el seguimiento, para el chip: «Hoy», «Último día», «Mañana», «En 3 días»… (en azul los próximos). */
export function cuandoSeguimiento(c: Coaching, hoy: string, proximosHasta?: string): { label: string; chip: string; ayuda: string } | null {
  if (!c.seguimiento) return null;
  const s = SEGUIMIENTO[c.seguimiento];
  if (c.seguimiento === "hoy") {
    return c.seguimiento_fecha < hoy
      ? { label: "Último día", chip: s.chip, ayuda: "Era ayer: registrándolo hoy todavía está a tiempo" }
      : { label: "Hoy", chip: s.chip, ayuda: s.ayuda };
  }
  if (c.seguimiento === "proximo") {
    const dias = diasEntre(hoy, c.seguimiento_fecha);
    if (dias <= DIAS_AVISO) {
      const pronto = proximosHasta ? c.seguimiento_fecha <= proximosHasta : dias <= 2;
      return { label: dias === 1 ? "Mañana" : `En ${dias} días`, chip: pronto ? SEGUIMIENTO.hoy.chip : s.chip, ayuda: `Acordado para el ${dm(c.seguimiento_fecha)}` };
    }
  }
  return { label: s.corto, chip: s.chip, ayuda: s.ayuda };
}

function SeguimientosCard({ pendientes, hoy, proximosHasta, onSeguimiento, onAbrir }: {
  pendientes: Coaching[]; hoy: string; proximosHasta?: string; onSeguimiento?: (c: Coaching) => void; onAbrir: (c: Coaching) => void;
}) {
  const vencidos = pendientes.filter((c) => c.seguimiento === "vencido").length;
  const deHoy = pendientes.filter((c) => c.seguimiento === "hoy").length;
  const proximos = proximosHasta ? pendientes.filter((c) => c.seguimiento === "proximo" && c.seguimiento_fecha <= proximosHasta).length : 0;
  return (
    <section className="card min-w-0 flex flex-col">
      <Cabecera titulo="Seguimientos"
        sub={<>Los compromisos que esperan su seguimiento. A tiempo: en la fecha acordada o al día siguiente.
          {vencidos > 0 && <b className="text-brand-primary-dark"> {plural(vencidos, "vencido", "vencidos")}.</b>}
          {deHoy > 0 && <b className="text-[#1D5BA6]"> {plural(deHoy, "para hoy", "para hoy")}.</b>}
          {proximos > 0 && <span className="text-[#1D5BA6]"> {plural(proximos, "próximo", "próximos")} (hasta el {fechaCorta(proximosHasta)}).</span>}</>} />
      {!pendientes.length ? <Vacio>No hay compromisos esperando seguimiento.</Vacio> : (
        <ul className="divide-y divide-brand-border border-t border-brand-border">
          {pendientes.map((c) => {
            const s = cuandoSeguimiento(c, hoy, proximosHasta);
            return (
              <li key={c.id} className="px-5 py-3 flex items-center gap-x-3 gap-y-2 flex-wrap">
                <button type="button" onClick={() => onAbrir(c)} className="min-w-0 flex-1 basis-48 text-left group">
                  <div className="font-semibold text-sm text-brand-ink truncate group-hover:text-brand-primary">{c.operador}</div>
                  <div className="text-[11px] text-brand-slate truncate">
                    {nombreMetricas(c)} · acordado para el <b className="text-brand-ink">{fechaCorta(c.seguimiento_fecha)}</b> · {c.compromiso}
                  </div>
                </button>
                {s && <Chip label={s.label} chip={s.chip} ayuda={s.ayuda} icono={c.seguimiento === "vencido" ? <TriangleAlert size={11} aria-hidden /> : <CalendarClock size={11} aria-hidden />} />}
                {onSeguimiento && (
                  <button type="button" onClick={() => onSeguimiento(c)}
                    className="text-xs font-semibold text-brand-primary hover:underline inline-flex items-center gap-1">
                    <ClipboardCheck size={13} aria-hidden /> Seguimiento
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ equipo y cobertura
function EquipoCoaching({ equipo, nombreMes, onCoaching }: { equipo: MiembroCoaching[]; nombreMes: string; onCoaching?: (i: Inicial) => void }) {
  const actuales = equipo.filter((m) => m.actual);
  const con = actuales.filter((m) => m.coachings > 0).length;
  return (
    <section className="card min-w-0">
      <Cabecera titulo="Equipo y cobertura"
        sub={actuales.length ? `${n(con)} de ${plural(actuales.length, "asesor", "asesores")} del equipo actual con coaching en ${nombreMes.toLowerCase()}.` : undefined} />
      {!equipo.length ? <Vacio>Sin asesores asignados este mes.</Vacio> : (
        <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 px-5 pb-5">
          {equipo.map((m) => {
            const sin = m.actual && !m.coachings;
            return (
              <li key={m.id} className={`rounded-md border px-3.5 py-3 flex flex-col gap-2 min-w-0 ${m.actual ? "border-brand-border bg-white" : "border-dashed border-brand-border bg-brand-bg-soft"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className={`font-semibold text-sm truncate ${m.actual ? "text-brand-ink" : "text-brand-slate"}`}>{m.nombre}</div>
                    {!m.actual && m.tramos.length > 0 && <div className="text-[11px] text-[#1D5BA6]">Estuvo hasta el {dm(m.tramos[m.tramos.length - 1].hasta)}</div>}
                  </div>
                  {m.actual && <div className="w-24 shrink-0"><ScoreCelda total={m.score} parcial={m.parcial} /></div>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {m.uso?.alerta && <Chip label={`En alerta · ${num(m.uso.pct_sin_uso)}% sin uso`} chip="bg-brand-primary-light text-brand-primary-dark border-brand-primary/30" icono={<TriangleAlert size={11} aria-hidden />} />}
                  {m.conversacion?.roja && <Chip label={`Conversación en rojo · ${num(m.conversacion.valor)}%`} chip="bg-brand-primary-light text-brand-primary-dark border-brand-primary/30" />}
                  {m.conversacion?.sobre_meta && <Chip label="Conversación sobre la meta" chip="bg-brand-orange/10 text-[#8A5200] border-brand-orange/40" />}
                </div>
                <div className="flex items-center justify-between gap-2 mt-auto">
                  {sin ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-brand-slate">
                      <CircleDashed size={12} aria-hidden /> Sin coaching este mes
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-brand-slate">
                      {m.coachings ? <><CircleCheck size={12} className="text-emerald-600" aria-hidden />{plural(m.coachings, "coaching", "coachings")} · último el {dm(m.ultimo_coaching)}</> : "Sin coaching"}
                    </span>
                  )}
                  {onCoaching && m.actual && (
                    <button type="button" onClick={() => onCoaching({ operador_id: m.id })}
                      className={`${sin ? "btn-coaching-sm" : "btn-coaching-sm-outline"} shrink-0`}
                      title={sin ? "No tiene coaching este mes" : `Registrar otro coaching a ${m.nombre}`}>
                      <MessageSquareText size={14} aria-hidden /> {sin ? "Hacer coaching" : "Coaching"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ coachings del mes
export function EstadoCoaching({ c }: { c: Coaching }) {
  if (c.estado === "anulado") return <Chip label="Anulado" chip="bg-brand-bg text-brand-slate border-brand-border" icono={<Ban size={11} aria-hidden />} />;
  const s = c.seguimiento ? SEGUIMIENTO[c.seguimiento] : null;
  return (
    <>
      {c.estado === "cerrado" && c.resultado && <ResultadoChip r={c.resultado} delta={c.impacto?.delta} metrica={c.metrica} compacto />}
      {s && <Chip label={s.label} chip={s.chip} ayuda={s.ayuda} />}
    </>
  );
}

function ListaCoachings({ items, nombreMes, onAbrir }: { items: Coaching[]; nombreMes: string; onAbrir: (c: Coaching) => void }) {
  const validos = items.filter((c) => c.estado !== "anulado");
  return (
    <section className="card min-w-0">
      <Cabecera titulo={`Coachings de ${nombreMes.toLowerCase().split(" ")[0]}`}
        sub={validos.length ? `${plural(validos.length, "coaching registrado", "coachings registrados")}${validos.some((c) => c.fuera_de_termino) ? ` · ${n(validos.filter((c) => c.fuera_de_termino).length)} fuera de término` : ""}.` : undefined} />
      {!items.length ? <Vacio>Todavía no hay coachings registrados en {nombreMes.toLowerCase()}.</Vacio> : (
        <ul className="divide-y divide-brand-border border-t border-brand-border">
          {items.map((c) => {
            const anulado = c.estado === "anulado";
            return (
              <li key={c.id}>
                <button type="button" onClick={() => onAbrir(c)}
                  className={`w-full text-left px-5 py-3 flex gap-3 hover:bg-brand-bg-soft transition-colors ${anulado ? "opacity-60" : ""}`}>
                  <div className="w-11 shrink-0 text-center rounded-md border border-brand-border py-1 h-fit">
                    <div className="font-display text-xl leading-none text-brand-ink tabular-nums">{c.fecha.slice(8, 10)}</div>
                    <div className="text-[9px] uppercase tracking-wider2 text-brand-slate">{fechaCorta(c.fecha).split(" ")[0]}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
                      <span className={`font-semibold text-sm text-brand-ink ${anulado ? "line-through" : ""}`}>{c.operador}</span>
                      <span className="text-[11px] text-brand-slate">{TIPO_COACHING[c.tipo].label} · {nombreMetricas(c)}</span>
                    </div>
                    <p className="text-xs text-brand-graphite mt-0.5 line-clamp-2">{c.compromiso}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      <EstadoCoaching c={c} />
                      {c.fuera_de_termino && <Chip label="Fuera de término" chip="bg-brand-orange/10 text-[#8A5200] border-brand-orange/40"
                        ayuda="Se registró con más de 48 h de atraso: cuenta igual" />}
                      {c.anterior_id && <Chip label="Continúa un coaching sin mejora" chip="bg-brand-bg text-brand-slate border-brand-border" />}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ bitácora
function BitacoraCard({ notas, onNueva }: { notas: NotaBitacora[]; onNueva?: () => void }) {
  return (
    <section className="card min-w-0 flex flex-col">
      <Cabecera titulo="Bitácora" sub="Novedades, ausencias, incidencias y reconocimientos del equipo."
        accion={onNueva && (
          <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={onNueva}><NotebookPen size={14} /> Nota</button>
        )} />
      {!notas.length ? <Vacio>Sin notas este mes.</Vacio> : (
        <ol className="border-t border-brand-border px-5 py-4 space-y-4">
          {notas.map((x) => {
            const t = TIPO_NOTA[x.tipo];
            return (
              <li key={x.id} className="relative pl-4 border-l-2 border-brand-border">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-semibold text-brand-ink tabular-nums">{fechaCorta(x.fecha)}</span>
                  <Chip label={t.label} chip={t.chip} />
                  {x.operador && <span className="text-[11px] text-brand-slate">{x.operador}</span>}
                  {x.fuera_de_termino && <Chip label="Fuera de término" chip="bg-brand-orange/10 text-[#8A5200] border-brand-orange/40" />}
                </div>
                <p className="text-sm text-brand-graphite mt-1 whitespace-pre-line break-words">{x.texto}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ cómo funciona
export function MetodoCoaching({ r }: { r: ReglasCoaching }) {
  return (
    <section className="card p-5">
      <h2 className="font-display text-lg uppercase text-brand-ink leading-tight">Cómo funciona el registro</h2>
      <div className="grid md:grid-cols-3 gap-5 mt-3 text-xs text-brand-slate leading-relaxed">
        <div>
          <div className="font-semibold text-brand-ink text-sm">Registro</div>
          <p className="mt-1">
            La hora la pone el sistema. Un coaching se carga con hasta 48 h de atraso; después cuenta igual, pero queda «fuera de
            término». Se corrige o se anula durante {r.horas_edicion} h; después solo se agregan el seguimiento y aclaraciones, y todo
            queda en el historial. Cada supervisor registra solo para los asesores que tenía ese día.
          </p>
        </div>
        <div>
          <div className="font-semibold text-brand-ink text-sm">Gestión en el scoring</div>
          <p className="mt-1">
            Cobertura: % del equipo actual con al menos un coaching en el mes. Foco: % de las alertas de uso con coaching sobre uso
            dentro de los {r.dias_foco} días hábiles desde que aparecen (las que siguen en plazo o se resolvieron solas antes no cuentan).
            Seguimientos: % de los compromisos seguidos en la fecha acordada o al día siguiente.
          </p>
        </div>
        <div>
          <div className="font-semibold text-brand-ink text-sm">Impacto medido</div>
          <p className="mt-1">
            Conversación: 5 días con conexión antes del coaching contra 5 después. Pospago y GPON: netas por hora conectada, con las
            netas ya maduras (se activan hasta 7 días después de la venta). Uso: % sin uso de las líneas vendidas después contra las de
            antes, con la misma antigüedad. Igual, mejoró o empeoró lo calcula el sistema.
          </p>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ detalle de un coaching (con su historial)
const EVENTO: Record<EventoCoaching["tipo"], { label: string; icono: typeof Plus }> = {
  creado: { label: "Registró el coaching", icono: Plus },
  editado: { label: "Corrigió", icono: Pencil },
  anulado: { label: "Anuló el coaching", icono: Ban },
  seguimiento: { label: "Registró el seguimiento", icono: ClipboardCheck },
  aclaracion: { label: "Agregó una aclaración", icono: MessageSquarePlus },
};
const CAMPO: Record<string, string> = {
  tipo: "tipo", metrica: "métrica", metricas: "métricas", diagnostico: "diagnóstico", compromiso: "compromiso", seguimiento_fecha: "fecha de seguimiento",
};

function textoEvento(e: EventoCoaching): ReactNode {
  const d = e.datos;
  if (e.tipo === "editado") {
    const ms = d.despues?.metricas && d.antes?.metricas ? ` (métricas: ${nombreMetricas(d.antes.metricas)} → ${nombreMetricas(d.despues.metricas)})` : "";
    return `Cambió ${Object.keys(d.despues ?? {}).map((k) => CAMPO[k] ?? k).join(", ")}${ms}.`;
  }
  if (e.tipo === "anulado") return d.motivo;
  if (e.tipo === "aclaracion") return d.texto;
  if (e.tipo === "seguimiento") return <>{d.comentario}{d.a_tiempo === false && <span className="text-[#8A5200]"> · fuera de la fecha acordada</span>}</>;
  if (e.tipo === "creado" && d.fuera_de_termino) return <span className="text-[#8A5200]">Con más de 48 h de atraso: fuera de término.</span>;
  return null;
}

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-brand-border px-3.5 py-3 min-w-0">
      <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">{titulo}</div>
      <div className="text-sm text-brand-ink mt-1 whitespace-pre-line break-words">{children}</div>
    </div>
  );
}

const ORDEN_FOTO = ["pospago", "uso", "conversacion", "gpon"];

function FotoBase({ base }: { base: Coaching["base"] }) {
  const comps = (base.componentes ?? []).filter((c) => c.clave && ORDEN_FOTO.includes(c.clave));
  if (base.score === undefined && !comps.length) return null;
  const val = (c: Partial<Componente>) => {
    if (c.valor === null || c.valor === undefined) return "—";
    if (c.clave === "uso") return `${num(c.valor)}% sin uso`;
    if (c.clave === "conversacion") return `${num(c.valor)}%`;
    return `${num(c.valor, 0)}% del esperado`;
  };
  return (
    <div>
      <div className="label">Cómo estaba al registrarlo</div>
      <div className="flex flex-wrap gap-2">
        <div className="rounded-md border border-brand-border px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">Score</div>
          <div className="font-display text-xl text-brand-ink tabular-nums leading-tight">{base.score === null || base.score === undefined ? "—" : num(base.score, 0)}</div>
        </div>
        {comps.sort((a, b) => ORDEN_FOTO.indexOf(a.clave!) - ORDEN_FOTO.indexOf(b.clave!)).map((c) => (
          <div key={c.clave} className="rounded-md border border-brand-border px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">{METRICA[c.clave as keyof typeof METRICA]?.label ?? c.clave}</div>
            <div className="text-sm font-semibold text-brand-ink tabular-nums leading-tight mt-0.5">{val(c)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetalleDialog({ id, portal, soloLectura, onClose, onAccion, onAbrir }: {
  id: string; portal: boolean; soloLectura?: boolean; onClose: () => void; onAccion: (d: Dialogo) => void; onAbrir: (id: string) => void;
}) {
  const [c, setC] = useState<CoachingDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setC(null);
    apiFetch<CoachingDetalle>(`${SUP_API}/${portal ? "portal/" : ""}coaching/${id}`).then(setC).catch((e) => setError(e.message));
  }, [id, portal]);
  const acciones = c && portal && !soloLectura && c.estado !== "anulado";
  return (
    <Modal onClose={onClose} ancho="max-w-3xl" sobre={c ? `${TIPO_COACHING[c.tipo].label} · ${fechaLarga(c.fecha)}` : "Coaching"}
      titulo={c?.operador ?? "…"} acento={c?.estado === "anulado" ? "bg-brand-mist" : "bg-brand-cyan"}
      pie={acciones ? <>
        {c.editable && <button type="button" className="btn-ghost text-brand-primary" onClick={() => onAccion({ tipo: "anular", c })}><Ban size={15} /> Anular</button>}
        <button type="button" className="btn-secondary" onClick={() => onAccion({ tipo: "aclaracion", c })}><MessageSquarePlus size={15} /> Aclaración</button>
        {c.editable && <button type="button" className="btn-secondary" onClick={() => onAccion({ tipo: "editar", c })}><Pencil size={15} /> Corregir</button>}
        {c.estado === "abierto" && <button type="button" className="btn-primary" onClick={() => onAccion({ tipo: "seguimiento", c })}><ClipboardCheck size={15} /> Registrar seguimiento</button>}
      </> : undefined}>
      {error && <p className="text-sm text-brand-primary">{error}</p>}
      {!c && !error && <p className="text-sm text-brand-slate">Cargando…</p>}
      {c && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-1.5">
            {metricasDe(c).map((m) => <Chip key={m} label={METRICA[m].label} chip="bg-brand-ink text-white border-brand-ink" />)}
            <EstadoCoaching c={c} />
            {c.fuera_de_termino && <Chip label="Fuera de término" chip="bg-brand-orange/10 text-[#8A5200] border-brand-orange/40" ayuda="Se registró con más de 48 h de atraso: cuenta igual" />}
            <span className="text-[11px] text-brand-slate">Registrado por {c.supervisor} el {fechaHoraPy(c.created_at)}</span>
          </div>
          {(c.anterior_id || c.siguientes.length > 0) && (
            <div className="flex flex-wrap gap-3 text-xs">
              {c.anterior_id && (
                <button type="button" onClick={() => onAbrir(c.anterior_id!)} className="inline-flex items-center gap-1 font-semibold text-brand-primary hover:underline">
                  <History size={13} aria-hidden /> Continúa un coaching sin mejora
                </button>
              )}
              {c.siguientes.map((s) => (
                <button key={s.id} type="button" onClick={() => onAbrir(s.id)} className="inline-flex items-center gap-1 font-semibold text-brand-primary hover:underline">
                  <CornerDownRight size={13} aria-hidden /> Siguió con otro coaching el {dm(s.fecha)}
                </button>
              ))}
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-3">
            <Bloque titulo="Diagnóstico">{c.diagnostico}</Bloque>
            <Bloque titulo="Compromiso">{c.compromiso}</Bloque>
          </div>
          <div>
            <div className="label">Seguimiento</div>
            <p className="text-sm text-brand-ink">
              Acordado para el <b>{fechaLarga(c.seguimiento_fecha)}</b>
              {c.seguimiento_at && <span className="text-brand-slate"> · registrado el {fechaHoraPy(c.seguimiento_at)}</span>}
            </p>
            {c.seguimiento_comentario && <p className="text-sm text-brand-graphite mt-1 whitespace-pre-line break-words">{c.seguimiento_comentario}</p>}
          </div>
          {c.estado !== "anulado" && (
            <div>
              <div className="label">{c.impacto_guardado ? "Impacto medido al registrar el seguimiento" : "Impacto medido hasta hoy"}</div>
              <ImpactoVista i={c.impacto} />
            </div>
          )}
          <FotoBase base={c.base} />
          <div>
            <div className="label">Historial</div>
            <ol className="space-y-3">
              {c.eventos.map((e) => {
                const ev = EVENTO[e.tipo];
                const I = ev.icono;
                const extra = textoEvento(e);
                return (
                  <li key={e.id} className="flex gap-3">
                    <span className="w-7 h-7 rounded-full bg-brand-bg border border-brand-border flex items-center justify-center shrink-0 text-brand-slate">
                      <I size={13} aria-hidden />
                    </span>
                    <div className="min-w-0 text-sm">
                      <div className="text-brand-ink"><b>{e.por}</b> · {ev.label.toLowerCase()} <span className="text-[11px] text-brand-slate">· {fechaHoraPy(e.at)}</span></div>
                      {extra && <div className="text-xs text-brand-graphite mt-0.5 whitespace-pre-line break-words">{extra}</div>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * El detalle de un coaching en solo lectura: los jefes (desde el centro de comandos, la ficha del asesor o el registro) y
 * el supervisor desde su historial (`portal`: lo pide por el portal, que solo le da los suyos).
 */
export function VerCoachingDialog({ id, portal = false, onClose }: { id: string; portal?: boolean; onClose: () => void }) {
  const [actual, setActual] = useState(id);
  useEffect(() => setActual(id), [id]);
  return <DetalleDialog id={actual} portal={portal} soloLectura onClose={onClose} onAccion={() => undefined} onAbrir={setActual} />;
}

// ------------------------------------------------------------------ la vista completa
/** Coaching y bitácora de un supervisor en el mes: el portal (registra) y los jefes (solo lectura). */
export function VistaCoaching({ d, portal, onCambio }: { d: VistaCoachingData; portal: boolean; onCambio: () => void }) {
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const mesEnCurso = d.periodo === d.hoy.slice(0, 7);
  const puede = portal && d.puede_registrar && mesEnCurso;
  const cerrar = useCallback(() => setDialogo(null), []);
  const nuevo = useCallback((inicial?: Inicial) => setDialogo({ tipo: "nuevo", inicial }), []);
  const abrir = useCallback((c: Coaching) => setDialogo({ tipo: "detalle", id: c.id }), []);
  const ancla = useRef<HTMLDivElement>(null);
  // Desde «Mi equipo» (botón «Hacer coaching» o el de un asesor) se llega con ?nuevo=1: se abre el registro una vez.
  const pedido = useRef(false);
  useEffect(() => {
    if (!puede || pedido.current) return;
    pedido.current = true;
    const x = leerNuevoCoaching();
    if (x) nuevo(x.operador_id && d.equipo.some((m) => m.id === x.operador_id && m.actual) ? { operador_id: x.operador_id } : undefined);
  }, [puede, nuevo, d.equipo]);
  const sinCoaching = d.equipo.filter((m) => m.actual && !m.coachings).length;
  const alertasEsperando = d.alertas.filter((a) => a.estado === "en_plazo" || a.estado === "vencida").length;
  const listo = (msg: string) => { setDialogo(null); setAviso(msg); onCambio(); };
  const ultimo = `${d.periodo}-31`;
  const gestionDespues = d.gestion_desde && d.gestion_desde > ultimo;
  const partes = (d.scoring?.partes ?? []).filter((p) => p.clave !== "resultado");

  return (
    <div className="space-y-6">
      {aviso && (
        <div role="status" className="flex items-start justify-between gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-md px-3 py-2.5">
          <span className="inline-flex items-center gap-2"><CircleCheck size={16} aria-hidden /> {aviso}</span>
          <button type="button" className="text-xs font-semibold hover:underline" onClick={() => setAviso(null)}>Cerrar</button>
        </div>
      )}
      {puede && (
        <section aria-label="Hacer coaching"
          className="card overflow-visible border-brand-primary/30 bg-gradient-to-r from-brand-primary-light/70 via-white to-white p-5 sm:p-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 max-w-2xl">
            <h2 className="font-display text-2xl sm:text-3xl uppercase text-brand-ink leading-tight">¿Con quién hacés coaching hoy?</h2>
            <p className="text-sm text-brand-graphite mt-1">
              {sinCoaching || alertasEsperando ? (
                <>
                  {sinCoaching > 0 && <b className="text-brand-primary-dark">{plural(sinCoaching, "asesor sin coaching", "asesores sin coaching")} este mes</b>}
                  {sinCoaching > 0 && alertasEsperando > 0 && " · "}
                  {alertasEsperando > 0 && <b className="text-brand-primary-dark">{plural(alertasEsperando, "alerta de uso esperando coaching", "alertas de uso esperando coaching")}</b>}
                </>
              ) : "Todo el equipo tiene coaching este mes: seguí con los compromisos y sus seguimientos."}
            </p>
            <p className="text-xs text-brand-slate mt-1">
              Cada coaching parte de un dato, termina en un compromiso con fecha y se cierra cuando el dato del asesor mejora.
            </p>
          </div>
          {/* En el celular, el botón principal arriba y a lo ancho (a mano del pulgar). */}
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
            <button type="button" className="btn-secondary" onClick={() => setDialogo({ tipo: "nota" })}><NotebookPen size={15} /> Nota de bitácora</button>
            <div ref={ancla} className="flex"><BotonCoaching onClick={() => nuevo()} className="w-full sm:w-auto" /></div>
          </div>
        </section>
      )}
      {puede && <CoachingFlotante ancla={ancla} onClick={() => nuevo()} />}
      {portal && !mesEnCurso && (
        <p className="text-xs text-brand-slate flex items-center gap-1.5"><Info size={13} aria-hidden /> Estás viendo otro mes: para registrar, volvé a este mes.</p>
      )}
      {(gestionDespues || (d.gestion_desde && d.gestion_desde.slice(0, 7) === d.periodo)) && (
        <p className="text-xs text-[#1D5BA6] bg-[#2A78D6]/10 border border-[#2A78D6]/30 rounded-md px-3 py-2 flex items-start gap-2">
          <Info size={14} className="shrink-0 mt-0.5" aria-hidden />
          {gestionDespues
            ? `La gestión se mide desde el ${fechaLarga(d.gestion_desde)}: este mes no suma al scoring.`
            : `La gestión se mide desde el ${fechaLarga(d.gestion_desde)}, el día en que empezó el registro de coaching.`}
        </p>
      )}

      {partes.length > 0 && (
        <section aria-label="Gestión del mes">
          <h2 className="font-display text-xl uppercase text-brand-ink leading-tight mb-3">Gestión del mes</h2>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {partes.map((p) => <KpiGestion key={p.clave} p={p} />)}
          </div>
        </section>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <AlertasCard alertas={d.alertas} diasFoco={d.reglas.dias_foco} onCoaching={puede ? nuevo : undefined} />
        <SeguimientosCard pendientes={d.pendientes} hoy={d.hoy} proximosHasta={d.proximos_hasta} onAbrir={abrir}
          onSeguimiento={portal && d.puede_registrar ? (c) => setDialogo({ tipo: "seguimiento", c }) : undefined} />
      </div>
      <EquipoCoaching equipo={d.equipo} nombreMes={d.nombre_mes} onCoaching={puede ? nuevo : undefined} />
      <div className="grid xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-5 items-start">
        <ListaCoachings items={d.items} nombreMes={d.nombre_mes} onAbrir={abrir} />
        <BitacoraCard notas={d.notas} onNueva={puede ? () => setDialogo({ tipo: "nota" }) : undefined} />
      </div>
      <MetodoCoaching r={d.reglas} />
      {puede && <div className="h-16 print:hidden" aria-hidden />}{/* lugar para el botón flotante al final */}

      {dialogo?.tipo === "nuevo" && (
        <CoachingDialog vista={d} inicial={dialogo.inicial} onClose={cerrar}
          onGuardado={(c) => listo(`Coaching de ${c.operador} registrado${c.fuera_de_termino ? " (fuera de término)" : ""}. Seguimiento el ${dm(c.seguimiento_fecha)}.`)} />
      )}
      {dialogo?.tipo === "editar" && (
        <CoachingDialog vista={d} editar={dialogo.c} onClose={cerrar} onGuardado={(c) => listo(`Coaching de ${c.operador} corregido.`)} />
      )}
      {dialogo?.tipo === "seguimiento" && (
        <SeguimientoDialog c={dialogo.c} vista={d} onClose={() => { setDialogo(null); onCambio(); }}
          onGuardado={() => onCambio()}
          onNuevo={(c, metricas) => setDialogo({ tipo: "nuevo", inicial: { operador_id: c.operador_id, metricas, anterior_id: c.id } })} />
      )}
      {dialogo?.tipo === "anular" && (
        <TextoDialog titulo={dialogo.c.operador} sobre={`Anular el coaching del ${dm(dialogo.c.fecha)}`} label="Motivo"
          ayuda="Solo si se cargó por error. No se borra: queda tachado y en el historial." min={5} max={500} accion="Anular coaching" peligro
          url={`${SUP_API}/portal/coaching/${dialogo.c.id}/anular`} campo="motivo" onClose={cerrar}
          onGuardado={(c) => listo(`Coaching de ${c.operador} anulado.`)} />
      )}
      {dialogo?.tipo === "aclaracion" && (
        <TextoDialog titulo={dialogo.c.operador} sobre={`Aclaración al coaching del ${dm(dialogo.c.fecha)}`} label="Aclaración"
          ayuda="No cambia lo registrado: se agrega al historial con la fecha y hora de hoy." min={5} max={1000} accion="Agregar aclaración"
          url={`${SUP_API}/portal/coaching/${dialogo.c.id}/aclaracion`} campo="texto" onClose={cerrar}
          onGuardado={(c) => listo(`Aclaración agregada al coaching de ${c.operador}.`)} />
      )}
      {dialogo?.tipo === "nota" && (
        <NotaDialog vista={d} onClose={cerrar} onGuardado={() => listo("Nota agregada a la bitácora.")} />
      )}
      {dialogo?.tipo === "detalle" && (
        <DetalleDialog id={dialogo.id} portal={portal} onClose={cerrar} onAccion={setDialogo}
          onAbrir={(id) => setDialogo({ tipo: "detalle", id })} />
      )}
    </div>
  );
}
