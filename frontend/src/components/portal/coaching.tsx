"use client";

/** Piezas del coaching en el celular: monitoreos y feedback, compromisos, seguimiento y la constancia. */
import {
  Ban, CalendarClock, CalendarDays, Ear, FileText, Headphones, LoaderCircle, MessageSquarePlus, MessageSquareText, Mic,
  Pencil, Share2, Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  METRICA, METRICAS_ORDEN, NOMBRE_ITEM, RESULTADO_COMPROMISO, SUP_API, dm, sumarDias,
  type AudioCoaching, type CoachingDetalle, type CompromisoCoaching, type ItemCoaching, type MetricaCoaching,
  type ResultadoCompromiso, type TipoItemCoaching,
} from "@/components/supervision/tipos";
import { ApiError, apiFetch, getToken } from "@/lib/api";
import { Dictado, Escuchar, type Hablante } from "./grabadora";
import { Boton, Chips, Etiqueta, Fallo, Hoja, cx, hora } from "./ui";

export const DIAS_MAX = 45;

/** Hoy en Asunción ('AAAA-MM-DD'). */
export function hoyPy(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const DIAS_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
/** «mañana», «jue 23/10». */
export function diaCorto(iso: string | null | undefined, hoy = hoyPy()): string {
  if (!iso) return "—";
  if (iso === hoy) return "hoy";
  if (iso === sumarDias(hoy, 1)) return "mañana";
  const d = new Date(`${iso}T12:00:00`);
  return `${DIAS_SEMANA[d.getDay()]} ${dm(iso)}`;
}

export const OPCIONES_METRICA = METRICAS_ORDEN.map((m) => ({ v: m, label: METRICA[m].label, ayuda: METRICA[m].ayuda }));

export const audioUrl = (id: string, portal = true) => `${SUP_API}/${portal ? "portal" : "control"}/audios/${id}/archivo`;

async function enviar<T>(url: string, metodo: string, cuerpo?: unknown): Promise<T> {
  return apiFetch<T>(url, { method: metodo, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
}

const base = (id: string) => `${SUP_API}/portal/coaching/${id}`;

// ------------------------------------------------------------------ fechas con chips
export function ChipsFecha({ valor, onChange, desde, hasta, opciones, conSinFecha }: {
  valor: string | null; onChange: (v: string | null) => void; desde: string; hasta: string;
  opciones: { dias: number; label: string }[]; conSinFecha?: boolean;
}) {
  const hoy = hoyPy();
  const fijas = opciones.map((o) => ({ v: sumarDias(hoy, o.dias), label: o.label })).filter((o) => o.v >= desde && o.v <= hasta);
  const otra = valor && !fijas.some((f) => f.v === valor);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {conSinFecha && (
          <button type="button" onClick={() => onChange(null)} aria-pressed={valor === null}
            className={cx("min-h-[44px] px-4 rounded-full border text-sm font-semibold", valor === null ? "bg-brand-ink text-white border-brand-ink" : "bg-white border-brand-border text-brand-graphite")}>
            Sin fecha
          </button>
        )}
        {fijas.map((f) => (
          <button key={f.v} type="button" onClick={() => onChange(f.v)} aria-pressed={valor === f.v}
            className={cx("min-h-[44px] px-4 rounded-full border text-sm font-semibold", valor === f.v ? "bg-brand-ink text-white border-brand-ink" : "bg-white border-brand-border text-brand-graphite")}>
            {f.label}<span className={cx("ml-1 font-normal", valor === f.v ? "text-white/70" : "text-brand-slate")}>{dm(f.v)}</span>
          </button>
        ))}
      </div>
      <label className={cx("flex items-center gap-2 min-h-[48px] px-3 rounded-lg border", otra ? "border-brand-ink" : "border-brand-border")}>
        <CalendarDays size={18} className="text-brand-slate" aria-hidden />
        <span className="text-sm text-brand-slate">Otra fecha</span>
        <input type="date" className="ml-auto bg-transparent text-[15px] text-brand-ink font-semibold min-h-[44px] outline-none" min={desde} max={hasta}
          value={otra ? valor! : ""} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Elegir otra fecha" />
      </label>
    </div>
  );
}

// ------------------------------------------------------------------ tarjetas
function TextoPendiente({ audio }: { audio?: AudioCoaching }) {
  if (audio && (audio.estado === "pendiente" || audio.estado === "procesando")) {
    return <span className="inline-flex items-center gap-1.5 text-[#1D5BA6]"><LoaderCircle size={14} className="animate-spin" aria-hidden /> <span className="shimmer-text font-semibold">Transcribiendo…</span></span>;
  }
  return <span className="text-brand-primary-dark font-semibold">Falta el texto: tocá «Corregir» y escribilo.</span>;
}

export function ItemCard({ it, audio, editable, onEditar, onQuitar, portal = true }: {
  it: ItemCoaching; audio?: AudioCoaching; editable?: boolean; onEditar?: () => void; onQuitar?: () => void; portal?: boolean;
}) {
  return (
    <article className="card p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Etiqueta tono={it.tipo === "monitoreo" ? "azul" : "tinta"} icono={it.tipo === "monitoreo" ? Headphones : MessageSquareText}>{NOMBRE_ITEM[it.tipo]}</Etiqueta>
        <span className="text-xs text-brand-slate tabular-nums">{hora(it.at)}</span>
        {it.metricas.map((m) => <span key={m} className="text-xs font-semibold text-brand-graphite">· {METRICA[m]?.label ?? m}</span>)}
      </div>
      {it.referencia && <div className="text-xs text-brand-slate mt-1.5">Llamada / línea: <b className="text-brand-ink">{it.referencia}</b></div>}
      <p className="text-[15px] text-brand-ink leading-relaxed mt-2 whitespace-pre-line break-words">{it.texto || <TextoPendiente audio={audio} />}</p>
      {(audio?.archivo || editable) && (
        <div className="flex items-center gap-2 flex-wrap mt-3">
          {audio?.archivo && <Escuchar url={audioUrl(audio.id, portal)} duracion={audio.duracion_s} compacto />}
          {editable && (
            <span className="ml-auto flex gap-1">
              <button type="button" onClick={onEditar} className="min-h-[44px] px-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-ink rounded-lg hover:bg-brand-bg"><Pencil size={16} aria-hidden /> Corregir</button>
              <button type="button" onClick={onQuitar} className="min-h-[44px] px-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-primary rounded-lg hover:bg-brand-primary-light" aria-label="Quitar"><Trash2 size={16} aria-hidden /></button>
            </span>
          )}
        </div>
      )}
    </article>
  );
}

export function CompromisoCard({ x, n, audio, editable, onEditar, onQuitar, grande, portal = true }: {
  x: CompromisoCoaching; n: number; audio?: AudioCoaching; editable?: boolean; onEditar?: () => void; onQuitar?: () => void;
  grande?: boolean; portal?: boolean;
}) {
  const r = x.resultado ? RESULTADO_COMPROMISO[x.resultado] : null;
  return (
    <article className="card p-4 flex gap-3">
      <span className="w-9 h-9 rounded-full bg-brand-ink text-white font-display text-lg flex items-center justify-center shrink-0" aria-hidden>{n}</span>
      <div className="min-w-0 flex-1">
        <p className={cx("text-brand-ink leading-relaxed whitespace-pre-line break-words", grande ? "text-lg font-semibold" : "text-[15px]")}>
          {x.texto || <TextoPendiente audio={audio} />}
        </p>
        <div className="flex items-center gap-2 flex-wrap mt-2">
          {x.para && <Etiqueta tono="azul" icono={CalendarClock}>Para {diaCorto(x.para)}</Etiqueta>}
          {x.metrica && <Etiqueta>{METRICA[x.metrica]?.label}</Etiqueta>}
          {x.origen === "asesor" && x.audio_id && <Etiqueta icono={Mic}>Lo dijo el asesor</Etiqueta>}
          {r && <span className={cx("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold", r.chip)}>{r.label}</span>}
        </div>
        {x.nota && <p className="text-xs text-brand-slate mt-1.5">{x.nota}</p>}
        {(audio?.archivo || editable) && (
          <div className="flex items-center gap-2 flex-wrap mt-2">
            {audio?.archivo && <Escuchar url={audioUrl(audio.id, portal)} duracion={audio.duracion_s} compacto />}
            {editable && (
              <span className="ml-auto flex gap-1">
                <button type="button" onClick={onEditar} className="min-h-[44px] px-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-ink rounded-lg hover:bg-brand-bg"><Pencil size={16} aria-hidden /> Corregir</button>
                <button type="button" onClick={onQuitar} className="min-h-[44px] px-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-primary rounded-lg hover:bg-brand-primary-light" aria-label="Quitar"><Trash2 size={16} aria-hidden /></button>
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

// ------------------------------------------------------------------ hoja: monitoreo o feedback
export function HojaItem({ c, item, dictar, onClose, onGuardado }: {
  c: CoachingDetalle; item?: ItemCoaching; dictar?: boolean; onClose: () => void; onGuardado: (d: CoachingDetalle, msg: string) => void;
}) {
  const metricasCoaching = (c.metricas ?? []).filter((m) => m !== "otra");
  const [tipo, setTipo] = useState<TipoItemCoaching>(item?.tipo ?? (c.tipo === "diario" ? "monitoreo" : "feedback"));
  const [metricas, setMetricas] = useState<MetricaCoaching[]>(item?.metricas ?? (metricasCoaching.length ? metricasCoaching : []));
  const [texto, setTexto] = useState(item?.texto ?? "");
  const [referencia, setReferencia] = useState(item?.referencia ?? "");
  const [audioId, setAudioId] = useState<string | null>(null);
  const [grabando, setGrabando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = texto.trim();
  const listo = metricas.length > 0 && (t.length >= 5 || (!item && !!audioId)) && !grabando;
  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const d = item
        ? await enviar<CoachingDetalle>(`${base(c.id)}/items/${item.id}`, "PATCH", { tipo, metricas, texto: t, referencia })
        : await enviar<CoachingDetalle>(`${base(c.id)}/items`, "POST", { tipo, metricas, texto: t || null, referencia: referencia.trim() || null, audio_id: audioId });
      onGuardado(d, item ? "Corregido." : t ? `${NOMBRE_ITEM[tipo]} guardado.` : `${NOMBRE_ITEM[tipo]} guardado: el texto se completa cuando termine la transcripción.`);
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <Hoja sobre={c.operador} titulo={item ? "Corregir" : "Lo que observaste"} onClose={onClose} ocupada={ocupado || grabando}
      pie={<Boton onClick={guardar} disabled={!listo} ocupado={ocupado}>{item ? "Guardar cambios" : "Guardar"}</Boton>}>
      <div className="space-y-5">
        <div>
          <div className="label">¿Qué es?</div>
          <div className="grid grid-cols-2 gap-2">
            {(["monitoreo", "feedback"] as TipoItemCoaching[]).map((v) => (
              <button key={v} type="button" onClick={() => setTipo(v)} aria-pressed={tipo === v}
                className={cx("min-h-[64px] rounded-lg border-2 px-3 text-left", tipo === v ? "border-brand-ink bg-brand-bg-soft" : "border-brand-border")}>
                <span className="flex items-center gap-2 font-semibold text-brand-ink">
                  {v === "monitoreo" ? <Ear size={18} aria-hidden /> : <MessageSquareText size={18} aria-hidden />}{v === "monitoreo" ? "Monitoreo" : "Feedback"}
                </span>
                <span className="block text-xs text-brand-slate mt-0.5">{v === "monitoreo" ? "Escuchaste una llamada" : "Una observación o devolución"}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="label">¿Sobre qué?</div>
          <Chips opciones={OPCIONES_METRICA} valor={metricas} onChange={setMetricas} multiple etiqueta="Métricas" />
        </div>
        {tipo === "monitoreo" && (
          <div>
            <label className="label" htmlFor="ref">Llamada o línea (opcional)</label>
            <input id="ref" className="input !min-h-[48px] !text-base" value={referencia} maxLength={120} onChange={(e) => setReferencia(e.target.value)}
              placeholder="Ej.: 0981 123 456 · 10:40" />
          </div>
        )}
        {!item && (
          <Dictado coachingId={c.id} hablante="supervisor" destino="item" autoIniciar={dictar} onGrabando={setGrabando}
            etiqueta="Dictar lo que observaste" ayuda="Hablá normal: lo pasamos a texto y lo podés corregir."
            onSubido={(a) => setAudioId(a.id)} onTexto={(x) => setTexto((p) => (p.trim() ? `${p.trim()}\n${x}` : x))} />
        )}
        <div>
          <label className="label" htmlFor="obs">{item ? "Texto" : "O escribilo"}</label>
          <textarea id="obs" className="input !text-base min-h-[140px] leading-relaxed" value={texto} maxLength={2000}
            onChange={(e) => setTexto(e.target.value)} placeholder="Qué viste, qué hizo bien y qué tiene que corregir." />
          <div className="text-[11px] text-brand-slate mt-1 text-right tabular-nums">{texto.length} / 2000</div>
        </div>
        {error && <Fallo>{error}</Fallo>}
      </div>
    </Hoja>
  );
}

// ------------------------------------------------------------------ hoja: compromiso del asesor
export function HojaCompromiso({ c, comp, hablante, onClose, onGuardado }: {
  c: CoachingDetalle; comp?: CompromisoCoaching; hablante?: Hablante; onClose: () => void; onGuardado: (d: CoachingDetalle, msg: string) => void;
}) {
  const hoy = hoyPy();
  const [texto, setTexto] = useState(comp?.texto ?? "");
  const [para, setPara] = useState<string | null>(comp?.para ?? null);
  const [metrica, setMetrica] = useState<MetricaCoaching | null>(comp?.metrica ?? null);
  const [audio, setAudio] = useState<AudioCoaching | null>(null);
  const [grabando, setGrabando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = texto.trim();
  const listo = (t.length >= 5 || (!comp && !!audio)) && !grabando;
  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const d = comp
        ? await enviar<CoachingDetalle>(`${base(c.id)}/compromisos/${comp.id}`, "PATCH",
          { texto: t, ...(para ? { para } : { quitar_para: true }), ...(metrica ? { metrica } : {}) })
        : await enviar<CoachingDetalle>(`${base(c.id)}/compromisos`, "POST", {
          texto: t || null, para, metrica, audio_id: audio?.id ?? null,
          origen: audio?.hablante === "asesor" ? "asesor" : "supervisor",
        });
      onGuardado(d, comp ? "Compromiso corregido." : "Compromiso guardado.");
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  const quien = hablante ?? "asesor";
  return (
    <Hoja sobre={c.operador} titulo={comp ? "Corregir el compromiso" : "Compromiso del asesor"} onClose={onClose} ocupada={ocupado || grabando}
      pie={<Boton onClick={guardar} disabled={!listo} ocupado={ocupado}>{comp ? "Guardar cambios" : "Guardar compromiso"}</Boton>}>
      <div className="space-y-5">
        {!comp && (
          <Dictado coachingId={c.id} hablante={quien} destino="compromiso" autoIniciar={!!hablante} onGrabando={setGrabando}
            etiqueta={quien === "asesor" ? "Que lo diga el asesor" : "Dictar el compromiso"}
            ayuda={quien === "asesor" ? "Acercale el celular: que diga con sus palabras qué se compromete a hacer." : undefined}
            onSubido={setAudio} onTexto={(x) => setTexto((p) => (p.trim() ? `${p.trim()} ${x}` : x))} />
        )}
        <div>
          <label className="label" htmlFor="comp">{comp ? "Compromiso" : "O escribilo"}</label>
          <textarea id="comp" className="input !text-base min-h-[110px] leading-relaxed" value={texto} maxLength={1000}
            onChange={(e) => setTexto(e.target.value)} placeholder="Ej.: Ofrecer GPON en todas las llamadas de clientes con fibra disponible." />
        </div>
        <div>
          <div className="label">¿Para cuándo?</div>
          <ChipsFecha valor={para} onChange={setPara} desde={hoy} hasta={sumarDias(hoy, DIAS_MAX)} conSinFecha
            opciones={[{ dias: 0, label: "Hoy" }, { dias: 1, label: "Mañana" }, { dias: 3, label: "3 días" }, { dias: 7, label: "1 semana" }]} />
        </div>
        <div>
          <div className="label">Métrica (opcional)</div>
          <Chips opciones={OPCIONES_METRICA} valor={metrica ? [metrica] : []} onChange={(v) => setMetrica(v[0] === metrica ? null : v[0] ?? null)} etiqueta="Métrica" />
        </div>
        {error && <Fallo>{error}</Fallo>}
      </div>
    </Hoja>
  );
}

// ------------------------------------------------------------------ hoja: seguimiento
export function HojaSeguimiento({ c, onClose, onGuardado }: { c: CoachingDetalle; onClose: () => void; onGuardado: (d: CoachingDetalle) => void }) {
  const comps = c.compromisos ?? [];
  const [res, setRes] = useState<Record<string, ResultadoCompromiso | undefined>>({});
  const [comentario, setComentario] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const faltan = comps.filter((x) => !res[x.id]).length;
  const listo = comentario.trim().length >= 10 && faltan === 0;
  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try {
      onGuardado(await enviar<CoachingDetalle>(`${base(c.id)}/seguimiento`, "POST", {
        comentario: comentario.trim(), compromisos: comps.map((x) => ({ id: x.id, resultado: res[x.id] })),
      }));
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  const opciones = (Object.keys(RESULTADO_COMPROMISO) as ResultadoCompromiso[]).map((v) => ({ v, label: RESULTADO_COMPROMISO[v].label }));
  return (
    <Hoja sobre={c.operador} titulo="Seguimiento" onClose={onClose} ocupada={ocupado}
      pie={<Boton onClick={guardar} disabled={!listo} ocupado={ocupado}>Registrar seguimiento</Boton>}>
      <div className="space-y-5">
        {comps.length > 0 && (
          <div className="space-y-4">
            <div className="label !mb-0">¿Cómo le fue con cada compromiso?</div>
            {comps.map((x, i) => (
              <div key={x.id} className="rounded-lg border border-brand-border p-3">
                <p className="text-[15px] text-brand-ink font-semibold leading-snug"><span className="text-brand-slate">{i + 1}.</span> {x.texto}</p>
                <div className="mt-2.5"><Chips opciones={opciones} valor={res[x.id] ? [res[x.id]!] : []} onChange={(v) => setRes((r) => ({ ...r, [x.id]: v[0] }))} etiqueta={`Resultado del compromiso ${i + 1}`} /></div>
              </div>
            ))}
          </div>
        )}
        <div>
          <label className="label" htmlFor="seg">Comentario del seguimiento</label>
          <textarea id="seg" className="input !text-base min-h-[120px] leading-relaxed" value={comentario} maxLength={2000}
            onChange={(e) => setComentario(e.target.value)} placeholder="Qué cambió desde el coaching y cómo sigue." />
          <p className="text-[11px] text-brand-slate mt-1">El impacto en los datos (Pospago, GPON, uso, conversación) lo mide el sistema.</p>
        </div>
        {error && <Fallo>{error}</Fallo>}
      </div>
    </Hoja>
  );
}

// ------------------------------------------------------------------ hoja: texto simple (anular, aclaración)
export function HojaTexto({ titulo, sobre, ayuda, url, campo, min, max, accion, peligro, onClose, onGuardado }: {
  titulo: string; sobre?: string; ayuda: string; url: string; campo: string; min: number; max: number; accion: string;
  peligro?: boolean; onClose: () => void; onGuardado: (d: CoachingDetalle) => void;
}) {
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try { onGuardado(await enviar<CoachingDetalle>(url, "POST", { [campo]: texto.trim() })); } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <Hoja titulo={titulo} sobre={sobre} onClose={onClose} ocupada={ocupado}
      pie={<Boton onClick={guardar} tipo={peligro ? "peligro" : "primario"} icono={peligro ? Ban : MessageSquarePlus}
        disabled={texto.trim().length < min} ocupado={ocupado}>{accion}</Boton>}>
      <p className="text-sm text-brand-slate mb-3">{ayuda}</p>
      <textarea className="input !text-base min-h-[120px]" value={texto} maxLength={max} onChange={(e) => setTexto(e.target.value)} autoFocus />
      {error && <div className="mt-3"><Fallo>{error}</Fallo></div>}
    </Hoja>
  );
}

// ------------------------------------------------------------------ constancia (PDF)
export function useConstancia(c: { id: string; operador: string } | null, portal = true) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const compartible = useMemo(() => {
    if (typeof navigator === "undefined" || !navigator.canShare) return false;
    try { return navigator.canShare({ files: [new File([""], "x.pdf", { type: "application/pdf" })] }); } catch { return false; }
  }, []);
  useEffect(() => setError(null), [c?.id]);
  const abrir = async () => {
    if (!c) return;
    setOcupado(true);
    setError(null);
    try {
      const token = getToken();
      const r = await fetch(`${SUP_API}/${portal ? "portal/" : ""}coaching/${c.id}/comprobante`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new ApiError(typeof b.detail === "string" ? b.detail : `No se pudo generar la constancia (error ${r.status})`, r.status, b.detail);
      }
      const nombre = /filename="?([^";]+)"?/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "constancia-coaching.pdf";
      const archivo = new File([await r.blob()], nombre, { type: "application/pdf" });
      if (compartible) {
        try { await navigator.share({ files: [archivo], title: `Coaching · ${c.operador}` }); return; } catch (e: any) { if (e?.name === "AbortError") return; }
      }
      const url = URL.createObjectURL(archivo);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  const boton = (
    <Boton tipo="secundario" icono={compartible ? Share2 : FileText} onClick={abrir} ocupado={ocupado}>
      {compartible ? "Compartir constancia" : "Ver constancia (PDF)"}
    </Boton>
  );
  return { boton, error };
}
