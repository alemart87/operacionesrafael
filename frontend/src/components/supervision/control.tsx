"use client";

/**
 * Control de supervisores: qué hizo cada supervisor, contado y en vivo, para el gerente, el sub gerente, el coordinador,
 * el controller y el superadmin. Resumen del rango, actividad por día, la tabla por supervisor, el registro de
 * actividad (con los audios para escuchar) y las altas de asesores y pedidos de pase por resolver.
 */
import {
  CalendarCheck, Check, CircleCheck, CircleDashed, ClipboardCheck, Clock3, Headphones, Link2, MessageSquareText, Mic,
  NotebookPen, PenLine, RefreshCw, Send, Ticket, TriangleAlert, UserPlus, Users, X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { hoyPy } from "@/components/portal/coaching";
import { Escuchar } from "@/components/portal/grabadora";
import { fechaCorta } from "@/components/productividad/tipos";
import { apiFetch } from "@/lib/api";
import { VerCoachingDialog } from "./coaching";
import {
  SUP_API, SUP_HREF, dm, fechaHoraCorta, num, sumarDias,
  type ActividadControl, type ControlSupervisores, type EstadoControl, type EventoControl, type FilaControl, type PendientesControl,
} from "./tipos";

const REFRESCO_MS = 60 * 1000;
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const plural = (k: number, uno: string, varios: string) => `${k.toLocaleString("es-PY")} ${k === 1 ? uno : varios}`;

// ------------------------------------------------------------------ rango
type Preset = "hoy" | "ayer" | "7d" | "mes" | "otro";
interface Rango { preset: Preset; desde: string; hasta: string }

export function rangoDe(preset: Preset, hoy = hoyPy()): Rango {
  if (preset === "ayer") { const a = sumarDias(hoy, -1); return { preset, desde: a, hasta: a }; }
  if (preset === "7d") return { preset, desde: sumarDias(hoy, -6), hasta: hoy };
  if (preset === "mes") return { preset, desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
  return { preset: "hoy", desde: hoy, hasta: hoy };
}

function SelectorRango({ r, onChange }: { r: Rango; onChange: (r: Rango) => void }) {
  const hoy = hoyPy();
  const opciones: { p: Preset; label: string }[] = [
    { p: "hoy", label: "Hoy" }, { p: "ayer", label: "Ayer" }, { p: "7d", label: "Últimos 7 días" }, { p: "mes", label: "Este mes" }, { p: "otro", label: "Elegir" },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Rango">
      {opciones.map(({ p, label }) => (
        <button key={p} type="button" aria-pressed={r.preset === p}
          onClick={() => onChange(p === "otro" ? { ...r, preset: "otro" } : rangoDe(p, hoy))}
          className={cx("min-h-[40px] px-3.5 rounded-full border text-sm font-semibold",
            r.preset === p ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-graphite border-brand-border hover:border-brand-ink")}>
          {label}
        </button>
      ))}
      {r.preset === "otro" && (
        <span className="flex items-center gap-1.5">
          <input type="date" className="input !py-1.5 !w-auto tabular-nums" value={r.desde} max={r.hasta} aria-label="Desde"
            onChange={(e) => e.target.value && onChange({ ...r, desde: e.target.value })} />
          <span className="text-brand-slate text-sm">a</span>
          <input type="date" className="input !py-1.5 !w-auto tabular-nums" value={r.hasta} min={r.desde} max={hoy} aria-label="Hasta"
            onChange={(e) => e.target.value && onChange({ ...r, hasta: e.target.value })} />
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ piezas
function Tile({ titulo, valor, sub, icono: I, alerta, onClick }: {
  titulo: string; valor: ReactNode; sub?: ReactNode; icono: typeof Users; alerta?: boolean; onClick?: () => void;
}) {
  const cuerpo = (
    <>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate">
        <I size={14} aria-hidden /> {titulo}
      </div>
      <div className="font-display text-4xl leading-none tabular-nums mt-2 text-brand-ink">{valor}</div>
      {sub && <div className="text-xs text-brand-slate mt-1.5 leading-snug">{sub}</div>}
    </>
  );
  const cls = cx("card p-4 text-left min-w-0", alerta && "border-brand-primary/40 shadow-[inset_3px_0_0_#E6332A]");
  return onClick ? <button type="button" onClick={onClick} className={cx(cls, "hover:border-brand-ink")}>{cuerpo}</button> : <div className={cls}>{cuerpo}</div>;
}

const ESTADO: Record<EstadoControl, { label: string; chip: string }> = {
  activo: { label: "Con actividad", chip: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  quieto: { label: "Nada en el rango", chip: "bg-brand-orange/10 text-[#8A5200] border-brand-orange/40" },
  sin_actividad: { label: "Sin actividad", chip: "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30" },
};

function Chip({ children, chip, title }: { children: ReactNode; chip: string; title?: string }) {
  return <span title={title} className={cx("inline-flex items-center gap-1 rounded border px-1.5 py-0 text-[10px] font-semibold whitespace-nowrap", chip)}>{children}</span>;
}

function hace(iso: string | null): string {
  if (!iso) return "nunca";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "recién";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return fechaHoraCorta(iso);
}

function EstadoSupervisor({ f, dias }: { f: FilaControl; dias: number }) {
  const e = ESTADO[f.estado];
  return (
    <span className="flex flex-col gap-0.5 items-start">
      <Chip chip={e.chip} title={f.estado === "sin_actividad" ? `${dias} o más días hábiles sin registrar nada` : undefined}>
        {f.estado === "activo" ? <CircleCheck size={10} aria-hidden /> : f.estado === "sin_actividad" ? <TriangleAlert size={10} aria-hidden /> : <CircleDashed size={10} aria-hidden />}
        {e.label}
      </Chip>
      <span className="text-[11px] text-brand-slate">Última: {hace(f.ultima_actividad)}</span>
    </span>
  );
}

// ------------------------------------------------------------------ actividad por día
function PorDia({ serie }: { serie: ControlSupervisores["por_dia"] }) {
  const [sobre, setSobre] = useState<number | null>(null);
  const total = (x: ControlSupervisores["por_dia"][number]) => x.coachings + x.items + x.firmados + x.seguimientos + x.notas + x.tickets;
  const max = Math.max(1, ...serie.map(total));
  const marcas = serie.length <= 10 ? serie.map((_, i) => i) : serie.map((_, i) => i).filter((i) => i % Math.ceil(serie.length / 8) === 0 || i === serie.length - 1);
  return (
    <section className="card p-5">
      <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Actividad por día</h2>
      <p className="text-xs text-brand-slate mt-0.5">Lo que registraron entre todos: coachings, monitoreos y feedback, firmas, seguimientos, notas y tickets.</p>
      <div className="relative mt-4 h-40 flex items-end gap-[3px]" onMouseLeave={() => setSobre(null)}>
        {serie.map((x, i) => {
          const t = total(x);
          return (
            <button key={x.dia} type="button" className="relative flex-1 h-full flex items-end focus:outline-none group" aria-label={`${fechaCorta(x.dia)}: ${t} acciones`}
              onMouseEnter={() => setSobre(i)} onFocus={() => setSobre(i)} onBlur={() => setSobre(null)}>
              <span className={cx("w-full rounded-t-[4px] transition-colors", sobre === i ? "bg-brand-ink" : "bg-brand-cyan")}
                style={{ height: `${t ? Math.max(3, (t / max) * 100) : 0}%` }} />
              {!t && <span className="absolute bottom-0 inset-x-0 h-px bg-brand-border" aria-hidden />}
            </button>
          );
        })}
        {sobre !== null && (() => {
          const x = serie[sobre];
          const izq = (sobre + 0.5) / serie.length;
          return (
            <div className="absolute -top-2 z-10 -translate-y-full pointer-events-none" style={{ left: `${izq * 100}%`, transform: `translate(${izq > 0.7 ? "-100%" : izq < 0.3 ? "0" : "-50%"}, -100%)` }}>
              <div className="rounded-md bg-brand-ink text-white text-xs px-3 py-2 shadow-elevated whitespace-nowrap">
                <div className="font-semibold mb-1">{fechaCorta(x.dia)} · {total(x)} acciones</div>
                <div className="text-white/80 tabular-nums">{x.coachings} coachings · {x.items} monitoreos/feedback · {x.firmados} firmas</div>
                <div className="text-white/80 tabular-nums">{x.seguimientos} seguimientos · {x.audios} audios · {x.notas} notas · {x.tickets} tickets</div>
              </div>
            </div>
          );
        })()}
      </div>
      <div className="relative h-5 mt-1.5">
        {marcas.map((i) => (
          <span key={i} className="absolute text-[10px] text-brand-slate tabular-nums -translate-x-1/2" style={{ left: `${((i + 0.5) / serie.length) * 100}%` }}>{dm(serie[i].dia)}</span>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ tabla por supervisor
const n0 = (v: number) => (v ? v.toLocaleString("es-PY") : <span className="text-brand-mist">0</span>);

function Cobertura({ c }: { c: FilaControl["cobertura"] }) {
  if (c.pct === null) return <span className="text-brand-mist">—</span>;
  const tono = c.pct >= 100 ? "bg-emerald-500" : c.pct >= 60 ? "bg-brand-orange" : "bg-brand-primary";
  return (
    <span className="block min-w-[84px]">
      <span className="flex justify-between text-xs tabular-nums"><b className="text-brand-ink">{c.pct}%</b><span className="text-brand-slate">{c.con_coaching}/{c.asesores}</span></span>
      <span className="block h-1.5 rounded-full bg-brand-bg mt-1 overflow-hidden"><span className={cx("block h-full rounded-full", tono)} style={{ width: `${Math.min(100, c.pct)}%` }} /></span>
    </span>
  );
}

function TablaSupervisores({ filas, dias, sel, onSel, nombreMes }: {
  filas: FilaControl[]; dias: number; sel: string | null; onSel: (id: string | null) => void; nombreMes: string;
}) {
  const th = "px-3 py-2.5 text-[10px] uppercase tracking-wider2 text-brand-slate font-semibold text-right whitespace-nowrap";
  const td = "px-3 py-3 text-sm tabular-nums text-right text-brand-ink";
  return (
    <section className="card overflow-hidden">
      <div className="px-5 pt-5 pb-3">
        <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Por supervisor</h2>
        <p className="text-xs text-brand-slate mt-0.5">
          Lo que hizo cada uno en el rango. La cobertura es del mes ({nombreMes.toLowerCase()}): asesores del equipo con un coaching terminado.
          Tocá un supervisor para ver su actividad.
        </p>
      </div>
      {/* Pantallas anchas: la tabla. */}
      <div className="hidden lg:block overflow-x-auto border-t border-brand-border">
        <table className="w-full">
          <thead className="bg-brand-bg-soft">
            <tr>
              <th className={cx(th, "text-left")}>Supervisor</th>
              <th className={cx(th, "text-left")}>Estado</th>
              <th className={cx(th, "text-left")}>Cobertura</th>
              <th className={th} title="Coachings abiertos en el rango · firmados en el rango">Coachings · firmados</th>
              <th className={th}>Monitoreos</th>
              <th className={th}>Feedback</th>
              <th className={th}>Compromisos</th>
              <th className={th} title="Audios grabados · minutos">Audios · min</th>
              <th className={th}>Seguimientos</th>
              <th className={th} title="Devoluciones sin firmar (hoy) · vencidas">Sin firmar</th>
              <th className={th} title="Seguimientos vencidos (hoy)">Seg. vencidos</th>
              <th className={th}>Tickets</th>
              <th className={th}>Notas</th>
              <th className={th}>Altas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {filas.map((f) => (
              <tr key={f.id} onClick={() => onSel(sel === f.id ? null : f.id)}
                className={cx("cursor-pointer hover:bg-brand-bg-soft", sel === f.id && "bg-brand-primary-light/40", f.estado === "sin_actividad" && "shadow-[inset_3px_0_0_#E6332A]")}>
                <td className="px-3 py-3 text-left">
                  <div className="font-semibold text-sm text-brand-ink whitespace-nowrap">{f.nombre}</div>
                  <div className="text-[11px] text-brand-slate">{plural(f.asesores, "asesor", "asesores")}{!f.activo && " · inactivo"}</div>
                </td>
                <td className="px-3 py-3 text-left"><EstadoSupervisor f={f} dias={dias} /></td>
                <td className="px-3 py-3 text-left"><Cobertura c={f.cobertura} /></td>
                <td className={td}>{n0(f.coachings)} · <b>{n0(f.firmados)}</b></td>
                <td className={td}>{n0(f.monitoreos)}</td>
                <td className={td}>{n0(f.feedback)}</td>
                <td className={td}>{n0(f.compromisos)}</td>
                <td className={td}>{n0(f.audios)}{f.audios > 0 && <span className="text-brand-slate"> · {num(f.minutos)}</span>}</td>
                <td className={td}>{n0(f.seguimientos)}</td>
                <td className={td}>
                  {n0(f.sin_firmar)}{f.sin_firmar_vencidos > 0 && <b className="text-brand-primary-dark"> · {f.sin_firmar_vencidos} venc.</b>}
                </td>
                <td className={cx(td, f.seguimientos_vencidos > 0 && "text-brand-primary-dark font-semibold")}>{n0(f.seguimientos_vencidos)}</td>
                <td className={td}>{n0(f.tickets)}</td>
                <td className={td}>{n0(f.notas)}</td>
                <td className={td}>{n0(f.altas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Celular y tablet: una tarjeta por supervisor. */}
      <ul className="lg:hidden divide-y divide-brand-border border-t border-brand-border">
        {filas.map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => onSel(sel === f.id ? null : f.id)}
              className={cx("w-full text-left px-4 py-4", sel === f.id && "bg-brand-primary-light/40", f.estado === "sin_actividad" && "shadow-[inset_3px_0_0_#E6332A]")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-[15px] text-brand-ink truncate">{f.nombre}</div>
                  <div className="text-[11px] text-brand-slate">{plural(f.asesores, "asesor", "asesores")}</div>
                </div>
                <EstadoSupervisor f={f} dias={dias} />
              </div>
              <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                {[
                  ["Firmados", f.firmados], ["Monit.", f.monitoreos], ["Feedback", f.feedback], ["Audios", f.audios],
                  ["Compr.", f.compromisos], ["Seguim.", f.seguimientos], ["Sin firmar", f.sin_firmar], ["Tickets", f.tickets],
                ].map(([k, v]) => (
                  <div key={k as string} className={cx("rounded-md border px-1 py-1.5", k === "Sin firmar" && f.sin_firmar_vencidos ? "border-brand-primary/40 bg-brand-primary-light/40" : "border-brand-border")}>
                    <div className="font-display text-xl text-brand-ink tabular-nums leading-none">{v as number}</div>
                    <div className="text-[10px] text-brand-slate mt-0.5">{k}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3"><Cobertura c={f.cobertura} /></div>
            </button>
          </li>
        ))}
      </ul>
      {!filas.length && <p className="px-5 py-8 text-center text-sm text-brand-slate border-t border-brand-border">Todavía no hay supervisores con equipo este mes.</p>}
    </section>
  );
}

// ------------------------------------------------------------------ registro de actividad
const GRUPOS = [
  { g: "todo", label: "Todo" }, { g: "coaching", label: "Coaching" }, { g: "audios", label: "Con audio" },
  { g: "tickets", label: "Tickets" }, { g: "bitacora", label: "Bitácora" }, { g: "equipo", label: "Altas y pases" },
] as const;
type Grupo = (typeof GRUPOS)[number]["g"];

function icono(e: EventoControl): typeof Users {
  if (e.grupo === "tickets") return Ticket;
  if (e.grupo === "bitacora") return NotebookPen;
  if (e.grupo === "equipo") return UserPlus;
  return ({
    item: e.titulo.startsWith("Monitoreo") ? Headphones : MessageSquareText, compromiso: CalendarCheck, firmado: PenLine,
    seguimiento: ClipboardCheck, audio: Mic, anulado: X,
  } as Record<string, typeof Users>)[e.tipo] ?? MessageSquareText;
}

function Actividad({ r, filas, sel, onSel, refresco }: {
  r: Rango; filas: FilaControl[]; sel: string | null; onSel: (id: string | null) => void; refresco: number;
}) {
  const [d, setD] = useState<ActividadControl | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grupo, setGrupo] = useState<Grupo>("todo");
  const [coaching, setCoaching] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    apiFetch<ActividadControl>(`${SUP_API}/control/actividad?desde=${r.desde}&hasta=${r.hasta}&limite=300${sel ? `&supervisor_id=${encodeURIComponent(sel)}` : ""}`)
      .then(setD).catch((e) => setError(e.message));
  }, [r.desde, r.hasta, sel, refresco]);
  // Un audio dictado para un monitoreo o un compromiso ya se escucha en ese registro: su «grabó un audio» sobra.
  const conRegistro = new Set((d?.items ?? []).filter((e) => e.tipo !== "audio" && e.audio).map((e) => e.audio!.id));
  const items = (d?.items ?? []).filter((e) => !(e.tipo === "audio" && e.audio && conRegistro.has(e.audio.id)))
    .filter((e) => grupo === "todo" || (grupo === "audios" ? !!e.audio : e.grupo === grupo));
  const dias: { dia: string; items: EventoControl[] }[] = [];
  for (const e of items) {
    const dia = e.at ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date(e.at)) : "—";
    const ultimo = dias[dias.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.items.push(e); else dias.push({ dia, items: [e] });
  }
  const nombre = filas.find((f) => f.id === sel)?.nombre;
  return (
    <section className="card min-w-0" id="actividad">
      <div className="px-5 pt-5 pb-3 flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Actividad{nombre ? ` de ${nombre}` : ""}</h2>
          <p className="text-xs text-brand-slate mt-0.5">Cada cosa que registraron, lo más nuevo primero. Los audios se escuchan acá (queda en la auditoría).</p>
        </div>
        <select className="input !w-auto !py-2 text-sm" value={sel ?? ""} onChange={(e) => onSel(e.target.value || null)} aria-label="Supervisor">
          <option value="">Todos los supervisores</option>
          {filas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
        </select>
      </div>
      <div className="px-5 pb-3 flex gap-2 overflow-x-auto">
        {GRUPOS.map(({ g, label }) => (
          <button key={g} type="button" aria-pressed={grupo === g} onClick={() => setGrupo(g)}
            className={cx("min-h-[36px] px-3 rounded-full border text-xs font-semibold whitespace-nowrap",
              grupo === g ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-graphite border-brand-border")}>
            {label}
          </button>
        ))}
      </div>
      {error && <p className="px-5 pb-4 text-sm text-brand-primary">{error}</p>}
      {!d && !error && <p className="px-5 pb-6 text-sm text-brand-slate">Cargando…</p>}
      {d && !items.length && <p className="px-5 py-8 text-center text-sm text-brand-slate border-t border-brand-border">Nada registrado en el rango.</p>}
      {dias.map(({ dia, items }) => (
        <div key={dia} className="border-t border-brand-border">
          <div className="px-5 py-2 bg-brand-bg-soft text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold sticky top-[64px] md:top-[100px] z-[1]">
            {dia === hoyPy() ? "Hoy" : fechaCorta(dia)} · {items.length}
          </div>
          <ol className="divide-y divide-brand-border">
            {items.map((e, k) => {
              const I = icono(e);
              return (
                <li key={`${e.at}-${k}`} className="px-5 py-3 flex gap-3">
                  <span className="text-[11px] text-brand-slate tabular-nums w-10 shrink-0 pt-1">{e.at ? fechaHoraCorta(e.at).slice(-5) : ""}</span>
                  <span className={cx("w-8 h-8 rounded-full flex items-center justify-center shrink-0 border",
                    e.tipo === "firmado" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-brand-bg text-brand-slate border-brand-border")}>
                    <I size={15} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-brand-ink">
                      <b>{e.supervisor}</b> · {e.titulo}{e.asesor && <> · <span className="text-brand-graphite">{e.asesor}</span></>}
                    </div>
                    {e.detalle && <p className="text-xs text-brand-graphite mt-0.5 break-words">{e.detalle}</p>}
                    {e.audio && (
                      <div className="mt-1.5 flex items-start gap-2 flex-wrap">
                        {e.audio.archivo ? <Escuchar url={`${SUP_API}/control/audios/${e.audio.id}/archivo`} duracion={e.audio.segundos} compacto />
                          : <span className="text-[11px] text-brand-slate">El audio ya no está guardado (queda su transcripción).</span>}
                        {e.tipo === "audio" && e.audio.texto && <p className="text-xs text-brand-slate italic basis-full break-words">«{e.audio.texto}»</p>}
                      </div>
                    )}
                    <div className="flex gap-3 mt-1">
                      {e.coaching_id && (
                        <button type="button" onClick={() => setCoaching(e.coaching_id!)} className="text-[11px] font-semibold text-brand-primary hover:underline">Ver coaching</button>
                      )}
                      {e.operador_id && <Link href={`${SUP_HREF}/asesores/${e.operador_id}`} className="text-[11px] font-semibold text-brand-slate hover:text-brand-primary">Ficha del asesor</Link>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
      {d?.truncado && <p className="px-5 py-3 text-xs text-brand-slate border-t border-brand-border">Se muestran los últimos 300: achicá el rango o elegí un supervisor para ver el resto.</p>}
      {coaching && <VerCoachingDialog id={coaching} onClose={() => setCoaching(null)} />}
    </section>
  );
}

// ------------------------------------------------------------------ altas y pases
function Pendientes({ refresco, onCambio }: { refresco: number; onCambio: () => void }) {
  const [d, setD] = useState<PendientesControl | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const cargar = useCallback(() => {
    apiFetch<PendientesControl>(`${SUP_API}/control/pendientes`).then(setD).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { cargar(); }, [cargar, refresco]);
  const accion = async (k: string, url: string, body: unknown) => {
    setOcupado(k);
    setError(null);
    try { await apiFetch(url, { method: "POST", body: JSON.stringify(body) }); cargar(); onCambio(); } catch (e: any) { setError(e.message); } finally { setOcupado(null); }
  };
  if (!d) return error ? <p className="text-sm text-brand-primary">{error}</p> : null;
  const total = d.altas.length + d.pases.length;
  return (
    <section className="card min-w-0" id="pendientes">
      <div className="px-5 pt-5 pb-3">
        <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Altas y pases por resolver</h2>
        <p className="text-xs text-brand-slate mt-0.5">
          Asesores que cargaron los supervisores desde el portal (ya están en su equipo: validalos o unilos con quien figura en los
          informes) y pedidos para pasar un asesor de equipo.
        </p>
      </div>
      {error && <p className="px-5 pb-3 text-sm text-brand-primary">{error}</p>}
      {!total && <p className="px-5 py-6 text-center text-sm text-brand-slate border-t border-brand-border">Nada por resolver.</p>}
      {d.altas.length > 0 && (
        <ul className="divide-y divide-brand-border border-t border-brand-border">
          {d.altas.map((a) => (
            <li key={a.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Chip chip="bg-brand-orange/10 text-[#8A5200] border-brand-orange/40"><UserPlus size={10} aria-hidden /> Alta por validar</Chip>
                    <span className="font-semibold text-sm text-brand-ink">{a.nombre}</span>
                  </div>
                  <div className="text-[11px] text-brand-slate mt-0.5">
                    Cargado por {a.alta_por} {a.alta_at ? hace(a.alta_at) : ""}{a.documento && ` · CI ${a.documento}`}{a.subcanal && ` · ${a.subcanal}`}
                    {a.supervisor_hoy && ` · hoy con ${a.supervisor_hoy}`}
                  </div>
                </div>
                {d.puede_validar && (
                  <button type="button" className="btn-secondary !py-2 !px-3 text-xs" disabled={!!ocupado}
                    onClick={() => accion(`v-${a.id}`, `${SUP_API}/control/altas/${a.id}/validar`, {})}>
                    <Check size={14} aria-hidden /> Es una persona nueva
                  </button>
                )}
              </div>
              {a.sugeridos.length > 0 && (
                <div className="mt-2.5">
                  <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mb-1">¿Es alguien que ya aparece en los informes?</div>
                  <ul className="flex flex-wrap gap-2">
                    {a.sugeridos.map((s) => (
                      <li key={s.id} className="rounded-md border border-brand-border px-3 py-2 text-xs flex items-center gap-3">
                        <span className="min-w-0">
                          <b className="block text-brand-ink">{s.nombre}</b>
                          <span className="text-brand-slate">{[s.agente && `Llamadas: ${s.agente}`, s.vendedor && `Ventas: ${s.vendedor}`].filter(Boolean).join(" · ")}</span>
                        </span>
                        {d.puede_validar && (
                          <button type="button" className="btn-ghost !px-2 !py-1 !text-xs text-brand-primary" disabled={!!ocupado}
                            onClick={() => window.confirm(`¿Unir a «${a.nombre}» con «${s.nombre}»? Sus coachings, equipos y notas pasan a «${s.nombre}».`)
                              && accion(`u-${a.id}`, `${SUP_API}/control/altas/${a.id}/unir`, { con: s.id })}>
                            <Link2 size={13} aria-hidden /> Unir
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!d.puede_validar && <p className="text-[11px] text-brand-slate mt-2">Lo valida quien mantiene el maestro de operadores.</p>}
            </li>
          ))}
        </ul>
      )}
      {d.pases.length > 0 && (
        <ul className="divide-y divide-brand-border border-t border-brand-border">
          {d.pases.map((x) => (
            <li key={x.id} className="px-5 py-4 flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Chip chip="bg-[#2A78D6]/10 text-[#1D5BA6] border-[#2A78D6]/30"><Send size={10} aria-hidden /> Pedido de pase</Chip>
                  <span className="font-semibold text-sm text-brand-ink">{x.operador}</span>
                </div>
                <div className="text-[11px] text-brand-slate mt-0.5">
                  {x.pedido_por} lo pide para su equipo {x.created_at ? hace(x.created_at) : ""}
                  {x.supervisor_actual ? ` · hoy está con ${x.supervisor_actual}` : " · hoy no tiene equipo"}
                </div>
                {x.nota && <p className="text-xs text-brand-graphite mt-1">{x.nota}</p>}
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost !py-2 !px-3 text-xs" disabled={!!ocupado}
                  onClick={() => accion(`r-${x.id}`, `${SUP_API}/control/pases/${x.id}/resolver`, { aprobar: false })}>Rechazar</button>
                {d.puede_asignar && (
                  <button type="button" className="btn-primary !py-2 !px-3 text-xs" disabled={!!ocupado}
                    onClick={() => accion(`a-${x.id}`, `${SUP_API}/control/pases/${x.id}/resolver`, { aprobar: true })}>
                    <Check size={14} aria-hidden /> Pasarlo desde hoy
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ la pantalla
export function ControlSupervisoresVista() {
  const [r, setR] = useState<Rango>(() => rangoDe("hoy"));
  const [d, setD] = useState<ControlSupervisores | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [refresco, setRefresco] = useState(0);
  const enCurso = useRef(false);

  const cargar = useCallback(async (rr: Rango) => {
    if (enCurso.current) return;
    enCurso.current = true;
    setCargando(true);
    setError(null);
    try { setD(await apiFetch<ControlSupervisores>(`${SUP_API}/control?desde=${rr.desde}&hasta=${rr.hasta}`)); }
    catch (e: any) { setError(e.message); } finally { enCurso.current = false; setCargando(false); }
  }, []);
  useEffect(() => { cargar(r); }, [r, cargar]);
  const refrescar = useCallback(() => { cargar(r); setRefresco((k) => k + 1); }, [cargar, r]);
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === "visible") refrescar(); }, REFRESCO_MS);
    return () => window.clearInterval(t);
  }, [refrescar]);
  const elegir = (id: string | null) => {
    setSel(id);
    if (id) document.getElementById("actividad")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const k = d?.kpis;
  const filas = useMemo(() => d?.supervisores ?? [], [d]);
  const rangoTexto = d ? (d.desde === d.hasta ? (d.desde === d.hoy ? "hoy" : `el ${fechaCorta(d.desde)}`) : `del ${dm(d.desde)} al ${dm(d.hasta)}`) : "";

  return (
    <>
      <div className="mb-5 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Supervisión · control rápido</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Control de supervisores</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-3xl">
            Qué está haciendo cada supervisor, contado y en vivo: coachings, monitoreos, feedback, compromisos, firmas, audios,
            seguimientos, tickets y altas de asesores. Se actualiza solo cada minuto.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {d && <span className="text-[11px] text-brand-slate tabular-nums inline-flex items-center gap-1"><Clock3 size={12} aria-hidden /> {fechaHoraCorta(d.actualizado).slice(-5)}</span>}
          <button type="button" className="btn-secondary !py-2 !px-4" onClick={refrescar} disabled={cargando}>
            <RefreshCw size={15} className={cargando ? "animate-spin" : ""} aria-hidden /> Actualizar
          </button>
        </div>
      </div>
      <SelectorRango r={r} onChange={setR} />
      {error && <div className="card p-4 text-sm text-brand-primary mt-4">{error}</div>}
      {!d || !k ? (!error && <div className="card p-10 text-brand-slate mt-5">Cargando…</div>) : (
        <div className="space-y-6 mt-5">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Tile titulo="Supervisores" icono={Users} valor={<>{k.activos}<span className="text-xl text-brand-slate"> / {k.supervisores}</span></>}
              sub={<>con actividad {rangoTexto}{k.sin_actividad > 0 && <b className="text-brand-primary-dark"> · {k.sin_actividad} sin actividad hace {d.reglas.dias_sin_gestion}+ días</b>}</>}
              alerta={k.sin_actividad > 0} />
            <Tile titulo="Coachings firmados" icono={PenLine} valor={k.firmados} sub={`${plural(k.coachings, "abierto", "abiertos")} ${rangoTexto}`} />
            <Tile titulo="Monitoreos y feedback" icono={Headphones} valor={k.monitoreos + k.feedback}
              sub={`${plural(k.monitoreos, "monitoreo", "monitoreos")} · ${plural(k.feedback, "feedback", "feedback")} · ${plural(k.compromisos, "compromiso", "compromisos")}`} />
            <Tile titulo="Audios" icono={Mic} valor={k.audios}
              sub={`${num(k.minutos)} min · ${plural(k.voz_asesor, "del asesor", "del asesor")}${k.costo_usd ? ` · US$ ${k.costo_usd.toFixed(2)}` : ""}`} />
            <Tile titulo="Sin firmar" icono={PenLine} valor={k.sin_firmar} alerta={k.sin_firmar_vencidos > 0}
              sub={k.sin_firmar_vencidos ? <b className="text-brand-primary-dark">{plural(k.sin_firmar_vencidos, "vencida", "vencidas")} (más de {d.reglas.dias_devolucion} días hábiles)</b> : "devoluciones esperando la firma, hoy"} />
            <Tile titulo="Seguimientos" icono={ClipboardCheck} valor={k.seguimientos} alerta={k.seguimientos_vencidos > 0}
              sub={k.seguimientos_vencidos ? <b className="text-brand-primary-dark">{plural(k.seguimientos_vencidos, "vencido", "vencidos")} hoy</b> : `registrados ${rangoTexto}`} />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-brand-slate">
            <span><Ticket size={12} className="inline -mt-0.5" aria-hidden /> {plural(k.tickets, "respuesta a tickets", "respuestas a tickets")}</span>
            <span><NotebookPen size={12} className="inline -mt-0.5" aria-hidden /> {plural(k.notas, "nota de bitácora", "notas de bitácora")}</span>
            <span><UserPlus size={12} className="inline -mt-0.5" aria-hidden /> {plural(k.altas, "alta de asesor", "altas de asesores")}</span>
            {(k.altas_por_validar > 0 || k.pases_pendientes > 0) && (
              <a href="#pendientes" className="font-semibold text-brand-primary hover:underline">
                {[k.altas_por_validar && plural(k.altas_por_validar, "alta por validar", "altas por validar"),
                  k.pases_pendientes && plural(k.pases_pendientes, "pase por resolver", "pases por resolver")].filter(Boolean).join(" · ")}
              </a>
            )}
          </div>
          {d.por_dia.length > 1 && <PorDia serie={d.por_dia} />}
          <TablaSupervisores filas={filas} dias={d.reglas.dias_sin_gestion} sel={sel} onSel={elegir} nombreMes={d.nombre_mes} />
          <div className="grid xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-6 items-start">
            <Actividad r={r} filas={filas} sel={sel} onSel={setSel} refresco={refresco} />
            <Pendientes refresco={refresco} onCambio={() => cargar(r)} />
          </div>
        </div>
      )}
    </>
  );
}
