"use client";

import {
  Ban, CircleCheck, CircleDashed, ClipboardCheck, Hourglass, Inbox, MessageSquare, MessageSquareReply, Pause, RotateCcw,
  Send, Shuffle, TriangleAlert, Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { fechaCorta, n } from "@/components/productividad/tipos";
import { apiFetch } from "@/lib/api";
import { Modal } from "./dialogos";
import {
  ESTADO_TICKET, PRIORIDAD, SITUACION, SUP_API, dm, duracionHabil, fechaHoraCorta, fechaHoraPy, num, plazoTexto,
  type AccionTicket, type BandejaTickets, type EventoTicket, type FilaTicketsSupervisor, type InfoTickets, type MetricasTickets,
  type OpcionesTicket, type PlazoSla, type PrioridadTicket, type SituacionSla, type Ticket, type TicketDetalle,
  type TipoTicket,
} from "./tipos";

const PRIORIDADES: PrioridadTicket[] = ["alta", "media", "baja"];
const ICONO_SITUACION: Partial<Record<SituacionSla, typeof TriangleAlert>> = {
  vencido: TriangleAlert, por_vencer: Hourglass, pausado: Pause, cumplido: CircleCheck, fuera_de_plazo: TriangleAlert, cerrado: CircleDashed,
};

function Chip({ label, chip, ayuda, icono }: { label: string; chip: string; ayuda?: string; icono?: ReactNode }) {
  return (
    <span title={ayuda} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0 text-[10px] font-semibold whitespace-nowrap ${chip}`}>
      {icono}{label}
    </span>
  );
}

export function SlaChip({ t }: { t: Pick<Ticket, "sla"> }) {
  const s = SITUACION[t.sla.situacion];
  const I = ICONO_SITUACION[t.sla.situacion];
  return <Chip label={s.label} chip={s.chip} ayuda={s.ayuda} icono={I ? <I size={11} aria-hidden /> : undefined} />;
}

export function EstadoTicketChip({ t }: { t: Pick<Ticket, "estado" | "motivo_cierre"> }) {
  const e = ESTADO_TICKET[t.estado];
  const label = t.estado === "cerrado" ? (t.motivo_cierre === "sin_respuesta" ? "Cerrado sin datos" : "Cancelado") : e.label;
  return <Chip label={label} chip={e.chip} />;
}

export function PrioridadChip({ p }: { p: PrioridadTicket }) {
  return <Chip label={PRIORIDAD[p].label} chip={PRIORIDAD[p].chip} ayuda={`Prioridad ${PRIORIDAD[p].label.toLowerCase()}`} />;
}

const numero = (x: number) => `#${String(x).padStart(4, "0")}`;

// ------------------------------------------------------------------ plazo: consumido contra el plazo
export function BarraPlazo({ titulo, p, dia, hecho, pausado }: { titulo: string; p: PlazoSla; dia: number; hecho: boolean; pausado?: boolean }) {
  const pct = Math.min(p.pct, 100);
  const color = p.cumplio === false || p.pct >= 100 ? "#E6332A" : p.pct >= 75 ? "#F39200" : "#00B2BF";
  let estado: string;
  if (hecho) estado = p.cumplio ? "en plazo" : "fuera de plazo";
  else if (p.cumplio === false) estado = `vencido hace ${duracionHabil(p.min - p.plazo, dia)}`;
  else if (pausado) estado = "pausado: espera datos";
  else estado = p.vence ? `vence ${fechaHoraCorta(p.vence)}` : "";
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-brand-ink">{titulo}</span>
        <span className="text-brand-slate tabular-nums">{duracionHabil(p.min, dia)} de {duracionHabil(p.plazo, dia)}</span>
      </div>
      <div className="relative h-2 mt-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,178,191,0.15)" }}
        role="img" aria-label={`${titulo}: ${num(p.pct, 0)}% del plazo usado`}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: color }} />
        <div className="absolute inset-y-0 w-px bg-brand-ink/40" style={{ left: "75%" }} aria-hidden />
      </div>
      <div className={`text-[11px] mt-1 ${p.cumplio === false ? "text-brand-primary-dark font-semibold" : "text-brand-slate"}`}>{estado}</div>
    </div>
  );
}

// ------------------------------------------------------------------ lista
export function ListaTickets({ items, onAbrir, dia, conSupervisor = true, vacio }: {
  items: Ticket[]; onAbrir: (t: Ticket) => void; dia: number; conSupervisor?: boolean; vacio: string;
}) {
  if (!items.length) {
    return (
      <div className="px-5 py-10 text-center text-sm text-brand-slate border-t border-brand-border">
        <Inbox size={22} className="mx-auto mb-2 text-brand-mist" aria-hidden />{vacio}
      </div>
    );
  }
  return (
    <ul className="divide-y divide-brand-border border-t border-brand-border">
      {items.map((t) => {
        const abierto = ["nuevo", "en_gestion", "esperando"].includes(t.estado);
        const plazo = !t.respuesta_at ? t.sla.respuesta : t.sla.resolucion;
        const alerta = t.sla.situacion === "vencido";
        return (
          <li key={t.id}>
            <button type="button" onClick={() => onAbrir(t)}
              className={`w-full text-left px-5 py-3 flex gap-3 hover:bg-brand-bg-soft transition-colors ${alerta ? "shadow-[inset_3px_0_0_#E6332A]" : ""} ${abierto ? "" : "opacity-80"}`}>
              <span className="font-display text-lg text-brand-slate tabular-nums leading-tight w-14 shrink-0">{numero(t.numero)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
                  <span className="font-semibold text-sm text-brand-ink">{t.tipo_nombre}</span>
                  {t.operador && <span className="text-sm text-brand-graphite">· {t.operador}</span>}
                  <PrioridadChip p={t.prioridad} />
                  <EstadoTicketChip t={t} />
                  <SlaChip t={t} />
                  {t.reaperturas > 0 && <Chip label={`Reabierto ${t.reaperturas}×`} chip="bg-brand-bg text-brand-slate border-brand-border" />}
                </div>
                <p className="text-xs text-brand-graphite mt-0.5 line-clamp-1">{t.descripcion}</p>
                <div className="text-[11px] text-brand-slate mt-0.5 flex flex-wrap gap-x-2">
                  {t.referencia && <span>{t.referencia}</span>}
                  <span>Enviado por {t.creado_por_nombre} · {fechaHoraCorta(t.created_at)}</span>
                  {conSupervisor && <span>· a {t.supervisor}</span>}
                </div>
              </div>
              {abierto && (
                <div className="hidden sm:block w-40 shrink-0 text-right text-[11px] text-brand-slate">
                  <div className="font-semibold text-brand-ink">{!t.respuesta_at ? "Primera respuesta" : "Resolución"}</div>
                  {t.estado === "esperando" ? "Pausado" : plazo.cumplio === false ? (
                    <span className="text-brand-primary-dark font-semibold">Vencido</span>
                  ) : plazo.vence ? `vence ${fechaHoraCorta(plazo.vence)}` : "—"}
                  <div>{duracionHabil(plazo.min, dia)} de {duracionHabil(plazo.plazo, dia)}</div>
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ detalle con historial y acciones
const EVENTO: Record<EventoTicket["tipo"], { label: string; icono: typeof Send }> = {
  creado: { label: "envió el ticket", icono: Send },
  respuesta: { label: "respondió (primera respuesta)", icono: MessageSquareReply },
  comentario: { label: "comentó", icono: MessageSquare },
  pedido_datos: { label: "pidió datos", icono: Pause },
  datos: { label: "mandó los datos pedidos", icono: Undo2 },
  resuelto: { label: "resolvió el ticket", icono: CircleCheck },
  reabierto: { label: "reabrió el ticket", icono: RotateCcw },
  reasignado: { label: "lo reasignó", icono: Shuffle },
  cancelado: { label: "canceló el ticket", icono: Ban },
  cerrado_auto: { label: "lo cerró: no llegaron los datos pedidos", icono: CircleDashed },
};

const ACCION: Record<AccionTicket, { label: string; url: string; icono: typeof Send; clase: string }> = {
  responder: { label: "Responder", url: "responder", icono: MessageSquareReply, clase: "btn-secondary" },
  pedir_datos: { label: "Pedir datos", url: "pedir-datos", icono: Pause, clase: "btn-secondary" },
  resolver: { label: "Resolver", url: "resolver", icono: ClipboardCheck, clase: "btn-primary" },
  comentar: { label: "Comentar", url: "comentario", icono: MessageSquare, clase: "btn-primary" },
  reabrir: { label: "Reabrir", url: "reabrir", icono: RotateCcw, clase: "btn-secondary" },
  cancelar: { label: "Cancelar ticket", url: "cancelar", icono: Ban, clase: "btn-danger" },
  reasignar: { label: "Reasignar", url: "reasignar", icono: Shuffle, clase: "btn-secondary" },
};

export function TicketDialog({ id, portal, onClose, onCambio, supervisores }: {
  id: string; portal: boolean; onClose: () => void; onCambio: () => void; supervisores?: { id: string; nombre: string }[];
}) {
  const [t, setT] = useState<TicketDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [destino, setDestino] = useState("");
  const [ocupado, setOcupado] = useState<AccionTicket | null>(null);
  const base = `${SUP_API}/${portal ? "portal/" : ""}tickets/${id}`;
  useEffect(() => {
    setT(null);
    apiFetch<TicketDetalle>(base).then(setT).catch((e) => setError(e.message));
  }, [base]);

  const hacer = async (a: AccionTicket) => {
    setOcupado(a);
    setError(null);
    try {
      const body = a === "reasignar" ? { texto, supervisor_id: destino } : { texto };
      setT(await apiFetch<TicketDetalle>(`${base}/${ACCION[a].url}`, { method: "POST", body: JSON.stringify(body) }));
      setTexto("");
      setDestino("");
      onCambio();
    } catch (e: any) { setError(e.message); } finally { setOcupado(null); }
  };

  const dia = t?.info.dia_completo ?? 720;
  const acciones = t?.acciones ?? [];
  const minimo = (a: AccionTicket) => (a === "comentar" || a === "cancelar" || a === "reasignar" ? 5 : 10);
  const otrosSup = (supervisores ?? []).filter((s) => s.id !== t?.supervisor_id);
  const etiquetaTexto = portal
    ? "Tu respuesta (la ve quien envió el ticket)"
    : t?.estado === "esperando" ? "Los datos que pidió el supervisor" : "Comentario, motivo o datos";
  return (
    <Modal onClose={onClose} ancho="max-w-3xl" acento={t?.sla.situacion === "vencido" ? "bg-brand-primary" : "bg-brand-cyan"}
      sobre={t ? `Ticket ${numero(t.numero)} · ${t.tipo_nombre}` : "Ticket"} titulo={t ? (t.operador ?? "Sin asesor") : "…"}>
      {error && <p role="alert" className="text-sm text-brand-primary-dark bg-brand-primary-light/60 border border-brand-primary/20 rounded-md px-3 py-2 mb-3">{error}</p>}
      {!t && !error && <p className="text-sm text-brand-slate">Cargando…</p>}
      {t && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <PrioridadChip p={t.prioridad} />
            <EstadoTicketChip t={t} />
            <SlaChip t={t} />
            {t.reaperturas > 0 && <Chip label={`Reabierto ${t.reaperturas}×`} chip="bg-brand-bg text-brand-slate border-brand-border" />}
          </div>
          <dl className="grid sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
            <div><dt className="text-brand-slate">Supervisor</dt><dd className="font-semibold text-brand-ink">{t.supervisor}</dd></div>
            <div><dt className="text-brand-slate">Fecha del caso</dt><dd className="font-semibold text-brand-ink">{t.fecha_caso ? fechaCorta(t.fecha_caso) : "—"}</dd></div>
            <div><dt className="text-brand-slate">Referencia</dt><dd className="font-semibold text-brand-ink break-words">{t.referencia ?? "—"}</dd></div>
            <div className="sm:col-span-3"><dt className="text-brand-slate">Enviado por</dt><dd className="text-brand-ink">{t.creado_por_nombre} · {fechaHoraPy(t.created_at)}</dd></div>
          </dl>
          <div className="rounded-md border border-brand-border px-3.5 py-3">
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">Descripción</div>
            <p className="text-sm text-brand-ink mt-1 whitespace-pre-line break-words">{t.descripcion}</p>
          </div>
          {t.estado !== "cerrado" && (
            <div className="grid sm:grid-cols-2 gap-4">
              <BarraPlazo titulo="Primera respuesta" p={t.sla.respuesta} dia={dia} hecho={!!t.respuesta_at} />
              <BarraPlazo titulo="Resolución" p={t.sla.resolucion} dia={dia} hecho={t.estado === "resuelto"} pausado={t.estado === "esperando"} />
            </div>
          )}
          <div>
            <div className="label">Historial</div>
            <ol className="space-y-3">
              {t.eventos.map((e) => {
                const ev = EVENTO[e.tipo];
                const I = ev.icono;
                const reasignacion = e.tipo === "reasignado" ? (supervisores ?? []).find((s) => s.id === e.datos.a)?.nombre : null;
                return (
                  <li key={e.id} className="flex gap-3">
                    <span className="w-7 h-7 rounded-full bg-brand-bg border border-brand-border flex items-center justify-center shrink-0 text-brand-slate">
                      <I size={13} aria-hidden />
                    </span>
                    <div className="min-w-0 text-sm">
                      <div className="text-brand-ink"><b>{e.por}</b> {ev.label}{reasignacion ? ` a ${reasignacion}` : ""} <span className="text-[11px] text-brand-slate">· {fechaHoraPy(e.at)}</span></div>
                      {e.texto && e.tipo !== "creado" && <p className="text-xs text-brand-graphite mt-0.5 whitespace-pre-line break-words">{e.texto}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
          {acciones.length > 0 && (
            <div className="rounded-md border border-brand-border bg-brand-bg-soft p-3.5 space-y-3">
              <label className="label" htmlFor="tk-texto">{etiquetaTexto}</label>
              <textarea id="tk-texto" className="input resize-y" rows={3} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)}
                placeholder={portal ? "Ej.: escuché la venta: el cliente confirmó los datos; se corrigió el formulario." : "Ej.: la línea es 0981 123 456."} />
              {acciones.includes("reasignar") && (
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-xs text-brand-slate" htmlFor="tk-destino">Reasignar a</label>
                  <select id="tk-destino" className="input !w-auto !py-1.5 text-xs" value={destino} onChange={(e) => setDestino(e.target.value)}>
                    <option value="">Elegí un supervisor…</option>
                    {otrosSup.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                {acciones.map((a) => {
                  const x = ACCION[a];
                  const I = x.icono;
                  const falta = texto.trim().length < minimo(a) || (a === "reasignar" && !destino);
                  const label = a === "comentar" && t.estado === "esperando" ? "Enviar los datos" : x.label;
                  return (
                    <button key={a} type="button" className={`${x.clase} !px-3.5 !py-2`} disabled={!!ocupado || falta} onClick={() => hacer(a)}>
                      <I size={15} aria-hidden /> {ocupado === a ? "Guardando…" : label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-brand-slate">
                {portal
                  ? "Lo primero que hagas (responder, pedir datos o resolver) cuenta como primera respuesta. Pedir datos detiene el reloj hasta que contesten."
                  : t.estado === "esperando"
                    ? `El supervisor espera datos: si no llegan en ${t.info.dias_espera} días hábiles, el ticket se cierra solo.`
                    : "Comentá, reabrí (si la respuesta no resolvió el caso), reasigná o cancelá. Todo queda en el historial."}
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ enviar un ticket
export function NuevoTicketDialog({ info, onClose, onEnviado }: { info: InfoTickets; onClose: () => void; onEnviado: (t: TicketDetalle) => void }) {
  const [op, setOp] = useState<OpcionesTicket | null>(null);
  const [tipo, setTipo] = useState<TipoTicket>("venta_observada");
  const [prioridad, setPrioridad] = useState<PrioridadTicket>("media");
  const [asesor, setAsesor] = useState("");
  const [fecha, setFecha] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [destino, setDestino] = useState<{ supervisor_id: string | null; supervisor: string | null } | null>(null);
  const [referencia, setReferencia] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<OpcionesTicket>(`${SUP_API}/tickets/opciones`).then((o) => { setOp(o); setFecha(o.hoy); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setDestino(null);
    if (!asesor || !fecha) return;
    apiFetch<{ supervisor_id: string | null; supervisor: string | null }>(`${SUP_API}/tickets/destino?operador_id=${encodeURIComponent(asesor)}&fecha=${fecha}`)
      .then(setDestino).catch(() => setDestino(null));
  }, [asesor, fecha]);

  const necesitaSup = !asesor || (destino !== null && !destino.supervisor_id);
  const listo = descripcion.trim().length >= 10 && (!necesitaSup || !!supervisor) && (!asesor || destino !== null);
  const enviar = async () => {
    setOcupado(true);
    setError(null);
    try {
      onEnviado(await apiFetch<TicketDetalle>(`${SUP_API}/tickets`, {
        method: "POST",
        body: JSON.stringify({ tipo, prioridad, operador_id: asesor || null, fecha_caso: asesor ? fecha : null,
          supervisor_id: necesitaSup ? supervisor : null, referencia: referencia || null, descripcion }),
      }));
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };

  const tipos = Object.entries(info.tipos) as [TipoTicket, string][];
  return (
    <Modal onClose={onClose} ancho="max-w-2xl" sobre="Tickets de revisión" titulo="Enviar un caso a revisión"
      pie={<>
        <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={!listo || ocupado} onClick={enviar}><Send size={15} /> {ocupado ? "Enviando…" : "Enviar ticket"}</button>
      </>}>
      {!op && !error && <p className="text-sm text-brand-slate">Cargando…</p>}
      {op && (
        <div className="space-y-4">
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
                    Respuesta en {plazoTexto(info.plazos_texto[p].respuesta)}; resolución en {plazoTexto(info.plazos_texto[p].resolucion)}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="grid sm:grid-cols-[1fr_180px] gap-3">
            <div>
              <label className="label" htmlFor="tk-asesor">Asesor (opcional)</label>
              <select id="tk-asesor" className="input" value={asesor} onChange={(e) => setAsesor(e.target.value)}>
                <option value="">Sin asesor: elegir el supervisor</option>
                {op.asesores.map((a) => <option key={a.id} value={a.id}>{a.nombre}{a.supervisor ? ` · hoy con ${a.supervisor}` : " · sin supervisor hoy"}</option>)}
              </select>
            </div>
            {asesor && (
              <div>
                <label className="label" htmlFor="tk-fecha">Fecha del caso</label>
                <input id="tk-fecha" type="date" className="input tabular-nums" value={fecha} max={op.hoy} onChange={(e) => e.target.value && setFecha(e.target.value)} />
              </div>
            )}
          </div>
          {asesor && destino?.supervisor && (
            <p className="text-xs text-[#1D5BA6] bg-[#2A78D6]/10 border border-[#2A78D6]/30 rounded-md px-3 py-2">
              Llega a <b>{destino.supervisor}</b>: tenía a este asesor el {dm(fecha)}.
            </p>
          )}
          {necesitaSup && (
            <div>
              <label className="label" htmlFor="tk-sup">Supervisor</label>
              <select id="tk-sup" className="input" value={supervisor} onChange={(e) => setSupervisor(e.target.value)}>
                <option value="">Elegí a quién enviarlo…</option>
                {op.supervisores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
              {asesor && <p className="text-[11px] text-[#8A5200] mt-1">Ese asesor no tenía supervisor el {dm(fecha)}: elegí a quién enviarlo.</p>}
            </div>
          )}
          <div>
            <label className="label" htmlFor="tk-ref">Referencia</label>
            <input id="tk-ref" className="input" maxLength={120} placeholder="Línea, SDS o fecha y hora de la llamada" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="tk-desc">Descripción</label>
            <textarea id="tk-desc" className="input resize-y" rows={4} maxLength={4000} value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Qué se observó y qué se espera del supervisor." />
            <div className={`text-[10px] text-right mt-0.5 tabular-nums ${descripcion.trim().length && descripcion.trim().length < 10 ? "text-[#8A5200]" : "text-brand-mist"}`}>
              {descripcion.trim().length < 10 ? `${10 - descripcion.trim().length} caracteres más como mínimo` : `${descripcion.trim().length} / 4000`}
            </div>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-brand-primary-dark bg-brand-primary-light/60 border border-brand-primary/20 rounded-md px-3 py-2 mt-3">{error}</p>}
    </Modal>
  );
}

// ------------------------------------------------------------------ métricas
function Kpi({ titulo, valor, sub, tono, barra }: { titulo: string; valor: string; sub?: ReactNode; tono?: "rojo" | "naranja"; barra?: number | null }) {
  const color = tono === "rojo" ? "text-brand-primary-dark" : tono === "naranja" ? "text-[#8A5200]" : "text-brand-ink";
  return (
    <div className={`card p-4 flex flex-col gap-2 min-w-0 ${tono === "rojo" ? "border-brand-primary/40" : ""}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate">{titulo}</div>
      <div className={`font-display text-4xl leading-none tabular-nums ${color}`}>{valor}</div>
      {barra !== undefined && (
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,178,191,0.15)" }} aria-hidden>
          {barra !== null && <div className="h-full rounded-full" style={{ width: `${Math.min(barra, 100)}%`, background: "#00B2BF" }} />}
        </div>
      )}
      {sub && <div className="text-xs text-brand-slate leading-snug">{sub}</div>}
    </div>
  );
}

/** Bandeja de hoy y cumplimiento y velocidad del mes (mediana y percentil 90 en tiempo hábil). */
export function KpisTickets({ bandeja, mes, dia, nombreMes }: {
  bandeja: Pick<MetricasTickets, "abiertos" | "vencidos" | "por_vencer" | "esperando" | "mas_antiguo_min">; mes: MetricasTickets; dia: number; nombreMes: string;
}) {
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <Kpi titulo="Abiertos hoy" valor={n(bandeja.abiertos)} tono={bandeja.vencidos ? "rojo" : bandeja.por_vencer ? "naranja" : undefined}
        sub={<>{n(bandeja.vencidos)} vencido(s) · {n(bandeja.por_vencer)} por vencer · {n(bandeja.esperando)} esperando datos
          {bandeja.mas_antiguo_min !== null && <> · el más antiguo, {duracionHabil(bandeja.mas_antiguo_min, dia)}</>}</>} />
      <Kpi titulo={`En plazo · ${nombreMes.toLowerCase().split(" ")[0]}`} valor={mes.cumplimiento === null ? "—" : `${num(mes.cumplimiento, 0)}%`} barra={mes.cumplimiento}
        sub={mes.evaluados ? `${n(mes.en_plazo)} de ${n(mes.evaluados)} respondidos y resueltos en plazo · ${n(mes.total)} enviados` : `${n(mes.total)} enviados; todavía ninguno resuelto o vencido`} />
      <Kpi titulo="Primera respuesta" valor={duracionHabil(mes.respuesta.mediana, dia)}
        sub={mes.respuesta.n ? <>Mediana de {n(mes.respuesta.n)} · el 90% en {duracionHabil(mes.respuesta.p90, dia)} o menos</> : "Sin respuestas este mes"} />
      <Kpi titulo="Resolución" valor={duracionHabil(mes.resolucion.mediana, dia)}
        sub={mes.resolucion.n ? <>Mediana de {n(mes.resolucion.n)} · el 90% en {duracionHabil(mes.resolucion.p90, dia)} o menos · {n(mes.reabiertos)} reabierto(s)</> : "Sin tickets resueltos este mes"} />
    </div>
  );
}

export function TablaSupervisoresTickets({ filas, dia, onFiltrar }: { filas: FilaTicketsSupervisor[]; dia: number; onFiltrar?: (id: string) => void }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm min-w-[900px]">
        <thead>
          <tr className="bg-brand-bg text-[10px] uppercase tracking-wider2 text-brand-slate">
            <th className="text-left px-5 py-2.5">Supervisor</th>
            <th className="text-right px-3 py-2.5">Abiertos</th>
            <th className="text-right px-3 py-2.5">Vencidos</th>
            <th className="text-right px-3 py-2.5">Por vencer</th>
            <th className="text-right px-3 py-2.5" title="Tickets enviados en el mes">Del mes</th>
            <th className="text-right px-3 py-2.5" title="Respondidos y resueltos en plazo, de los ya resueltos o vencidos">En plazo</th>
            <th className="text-right px-3 py-2.5" title="Mediana · percentil 90">1.ª respuesta</th>
            <th className="text-right px-3 py-2.5" title="Mediana · percentil 90">Resolución</th>
            <th className="text-right px-5 py-2.5">Reaperturas</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} className={`border-t border-brand-border ${f.bandeja.vencidos ? "shadow-[inset_3px_0_0_#E6332A]" : ""}`}>
              <td className="px-5 py-2.5 font-semibold text-brand-ink">
                {onFiltrar ? <button type="button" className="hover:text-brand-primary text-left" onClick={() => onFiltrar(f.id)}>{f.nombre}</button> : f.nombre}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{n(f.bandeja.abiertos)}</td>
              <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${f.bandeja.vencidos ? "text-brand-primary-dark" : "text-brand-mist"}`}>{n(f.bandeja.vencidos)}</td>
              <td className={`px-3 py-2.5 text-right tabular-nums ${f.bandeja.por_vencer ? "text-[#8A5200] font-semibold" : "text-brand-mist"}`}>{n(f.bandeja.por_vencer)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{n(f.mes.total)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{f.mes.cumplimiento === null ? <span className="text-brand-mist">—</span> : <><b>{num(f.mes.cumplimiento, 0)}%</b> <span className="text-[11px] text-brand-slate">{n(f.mes.en_plazo)}/{n(f.mes.evaluados)}</span></>}</td>
              <td className="px-3 py-2.5 text-right text-xs tabular-nums whitespace-nowrap">{f.mes.respuesta.n ? `${duracionHabil(f.mes.respuesta.mediana, dia)} · ${duracionHabil(f.mes.respuesta.p90, dia)}` : "—"}</td>
              <td className="px-3 py-2.5 text-right text-xs tabular-nums whitespace-nowrap">{f.mes.resolucion.n ? `${duracionHabil(f.mes.resolucion.mediana, dia)} · ${duracionHabil(f.mes.resolucion.p90, dia)}` : "—"}</td>
              <td className="px-5 py-2.5 text-right tabular-nums">{f.mes.reaperturas ? n(f.mes.reaperturas) : <span className="text-brand-mist">0</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ cómo funciona
const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export function MetodoTickets({ info }: { info: InfoTickets }) {
  const horario = useMemo(() => {
    if (!info.horario) return null;
    return DIAS.map((d, i) => ({ d, f: info.horario?.[String(i)] })).filter((x) => x.f).map((x) => `${x.d} de ${x.f![0]} a ${x.f![1]}`).join("; ");
  }, [info.horario]);
  return (
    <section className="card p-5">
      <h2 className="font-display text-lg uppercase text-brand-ink leading-tight">Cómo funcionan los plazos</h2>
      <div className="grid md:grid-cols-3 gap-5 mt-3 text-xs text-brand-slate leading-relaxed">
        <div>
          <div className="font-semibold text-brand-ink text-sm">Plazos por prioridad</div>
          <table className="w-full mt-1.5 text-xs">
            <thead><tr className="text-[10px] uppercase tracking-wider2 text-brand-slate"><th className="text-left py-1">Prioridad</th><th className="text-left py-1">Respuesta</th><th className="text-left py-1">Resolución</th></tr></thead>
            <tbody>
              {PRIORIDADES.map((p) => (
                <tr key={p} className="border-t border-brand-border">
                  <td className="py-1 font-semibold text-brand-ink">{PRIORIDAD[p].label}</td>
                  <td className="py-1">{plazoTexto(info.plazos_texto[p].respuesta)}</td>
                  <td className="py-1">{plazoTexto(info.plazos_texto[p].resolucion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2">Un día hábil es una jornada completa ({duracionHabil(info.dia_completo, info.dia_completo + 1)}).{horario ? ` Horario de atención: ${horario}.` : ""}</p>
        </div>
        <div>
          <div className="font-semibold text-brand-ink text-sm">El reloj</div>
          <p className="mt-1">
            La primera respuesta corre desde que se envía hasta que el supervisor responde, pide datos o resuelve. La resolución corre
            mientras el ticket está nuevo o en gestión: se detiene mientras espera datos de quien lo envió (si no llegan en{" "}
            {info.dias_espera} días hábiles, se cierra solo) y sigue desde donde estaba si se reabre. Al {info.por_vencer}% del plazo pasa
            a «por vencer».
          </p>
        </div>
        <div>
          <div className="font-semibold text-brand-ink text-sm">Cumplimiento y scoring</div>
          <p className="mt-1">
            En plazo: respondido y resuelto dentro de sus dos plazos. Un ticket vencido cuenta como fuera de plazo; los abiertos en plazo,
            los cancelados y los cerrados sin los datos pedidos no cuentan. Un resuelto se puede reabrir durante {info.dias_reabrir} días
            hábiles. Velocidad en mediana y percentil 90 (el promedio se deforma con pocos casos largos). Suma 10 puntos al supervisor.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Carga una bandeja y la recarga sin perder lo que se ve (al filtrar y después de cada acción). */
export function useCarga<T>(url: string | null) {
  const [d, setD] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const cargar = useCallback(async () => {
    if (!url) return;
    setError(null);
    setCargando(true);
    try { setD(await apiFetch<T>(url)); } catch (e: any) { setError(e.message); } finally { setCargando(false); }
  }, [url]);
  useEffect(() => { cargar(); }, [cargar]);
  return { d, error, cargar, cargando };
}

// ------------------------------------------------------------------ bandeja de los jefes (general o de un supervisor)
export function BandejaJefes({ periodo, supervisorFijo }: { periodo: string; supervisorFijo?: string }) {
  const [vista, setVista] = useState<"abiertos" | "mes">("abiertos");
  const [filtro, setFiltro] = useState("");
  const [mios, setMios] = useState(false);
  const sup = supervisorFijo ?? filtro;
  const url = `${SUP_API}/tickets?periodo=${periodo}&vista=${vista}${sup ? `&supervisor_id=${encodeURIComponent(sup)}` : ""}${mios ? "&mios=true" : ""}`;
  const { d, error, cargar, cargando } = useCarga<BandejaTickets>(url);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  if (error && !d) return <div className="card p-4 text-sm text-brand-primary">{error}</div>;
  if (!d) return <div className="card p-10 text-brand-slate">Cargando…</div>;
  const dia = d.info.dia_completo;
  const fila = supervisorFijo ? d.supervisores.find((f) => f.id === supervisorFijo) : undefined;
  const supervisores = d.supervisores.map((f) => ({ id: f.id, nombre: f.nombre }));
  return (
    <div className="space-y-6">
      {aviso && (
        <div role="status" className="flex items-start justify-between gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-md px-3 py-2.5">
          <span className="inline-flex items-center gap-2"><CircleCheck size={16} aria-hidden /> {aviso}</span>
          <button type="button" className="text-xs font-semibold hover:underline" onClick={() => setAviso(null)}>Cerrar</button>
        </div>
      )}
      {supervisorFijo ? (
        fila ? <KpisTickets bandeja={fila.bandeja} mes={fila.mes} dia={dia} nombreMes={d.nombre_mes} />
          : <p className="text-sm text-brand-slate">Sin tickets para este supervisor.</p>
      ) : (
        <KpisTickets bandeja={d.bandeja} mes={d.mes} dia={dia} nombreMes={d.nombre_mes} />
      )}
      <section className="card min-w-0">
        <div className="px-5 pt-5 pb-3 flex items-end justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-md border border-brand-border overflow-hidden" role="tablist" aria-label="Qué tickets ver">
              {(["abiertos", "mes"] as const).map((v) => (
                <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)}
                  className={`px-3 py-1.5 text-xs font-semibold border-l first:border-l-0 border-brand-border transition-colors ${vista === v ? "bg-brand-ink text-white" : "bg-white text-brand-slate hover:bg-brand-bg"}`}>
                  {v === "abiertos" ? "Abiertos" : `Enviados en ${d.nombre_mes.toLowerCase().split(" ")[0]}`}
                </button>
              ))}
            </div>
            {!supervisorFijo && (
              <select aria-label="Filtrar por supervisor" className="input !w-auto !py-1.5 text-xs" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
                <option value="">Todos los supervisores</option>
                {supervisores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            )}
            <label className="inline-flex items-center gap-1.5 text-xs text-brand-slate cursor-pointer">
              <input type="checkbox" className="accent-[#E6332A]" checked={mios} onChange={(e) => setMios(e.target.checked)} /> Enviados por mí
            </label>
            {cargando && <span className="text-[11px] text-brand-mist">Actualizando…</span>}
          </div>
          {d.puede_enviar && (
            <button type="button" className="btn-primary" onClick={() => setNuevo(true)}><Send size={15} /> Enviar ticket</button>
          )}
        </div>
        <ListaTickets items={d.items} dia={dia} conSupervisor={!supervisorFijo} onAbrir={(t) => setAbierto(t.id)}
          vacio={vista === "abiertos" ? "No hay tickets abiertos." : "No se enviaron tickets en el mes."} />
      </section>
      {!supervisorFijo && d.supervisores.length > 0 && (
        <section className="card min-w-0">
          <div className="px-5 pt-5 pb-3">
            <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Por supervisor</h2>
            <p className="text-xs text-brand-slate mt-0.5">Bandeja de hoy y lo del mes: cumplimiento, velocidad (mediana · percentil 90) y reaperturas. Primero quien tiene vencidos.</p>
          </div>
          <TablaSupervisoresTickets filas={d.supervisores} dia={dia} onFiltrar={(id) => { setFiltro(id); setVista("abiertos"); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
        </section>
      )}
      <MetodoTickets info={d.info} />
      {abierto && <TicketDialog id={abierto} portal={false} supervisores={supervisores} onClose={() => setAbierto(null)} onCambio={cargar} />}
      {nuevo && (
        <NuevoTicketDialog info={d.info} onClose={() => setNuevo(false)}
          onEnviado={(t) => { setNuevo(false); setAviso(`Ticket ${numero(t.numero)} enviado a ${t.supervisor}.`); cargar(); }} />
      )}
    </div>
  );
}

