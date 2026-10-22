"use client";

/**
 * Entrenamientos con IA para el equipo: editor de casos (el cliente y su actitud al detalle), probar un caso, enviar a
 * postulantes (con su link para WhatsApp), la evaluación de cada conversación y el resultado final.
 */
import { Check, CircleCheck, CircleX, Copy, MessageCircle, Plus, RotateCcw, Send, Target, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Boton, Casilla, Chips, Etiqueta, Fallo, Hoja, cx } from "@/components/portal/ui";
import { apiFetch } from "@/lib/api";
import { Chat } from "./chat";
import {
  CAP_API, conIntento, duracion, type Caso, type Catalogo, type EntPostulante, type EntrenamientoFila, type EvaluacionCaso, type GrupoDetalle,
  type EntResumen, type Resumen, type ResultadoEnt, type Sesion,
} from "./tipos";
import { abrirWhatsapp } from "./ui";

// ------------------------------------------------------------------ editor de casos
const VACIO: Omit<Caso, "id" | "orden"> = {
  titulo: "", cliente_nombre: "", cliente_edad: null, situacion: "", objetivo: "",
  actitud: { rasgos: [], paciencia: 3, cordialidad: 3, desconfianza: 3, interes: 3, habla: 3, tecnologia: 3 },
  objeciones: [], info_correcta: [], primer_mensaje: null, detalles: null, max_turnos: 14,
};

/** Una lista de frases que se agregan de a una (objeciones, información que tiene que dar bien). */
function ListaFrases({ valor, onChange, placeholder, max }: { valor: string[]; onChange: (v: string[]) => void; placeholder: string; max: number }) {
  const [t, setT] = useState("");
  const agregar = () => { const x = t.trim(); if (x && valor.length < max) { onChange([...valor, x]); setT(""); } };
  return (
    <div className="space-y-2">
      {valor.map((x, k) => (
        <div key={k} className="flex items-start gap-2 rounded-lg border border-brand-border bg-white px-3 py-2">
          <span className="text-[14px] text-brand-ink flex-1 leading-snug">{x}</span>
          <button type="button" aria-label="Quitar" onClick={() => onChange(valor.filter((_, i) => i !== k))} className="text-brand-mist hover:text-brand-primary shrink-0"><X size={16} /></button>
        </div>
      ))}
      {valor.length < max && (
        <div className="flex gap-2">
          <input className="input flex-1" value={t} placeholder={placeholder} onChange={(e) => setT(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregar(); } }} />
          <button type="button" onClick={agregar} disabled={!t.trim()} className="btn min-h-[44px] px-3 bg-brand-ink text-white disabled:opacity-40" aria-label="Agregar"><Plus size={18} /></button>
        </div>
      )}
    </div>
  );
}

/** Un nivel de 1 a 5 con su palabra (paciencia, desconfianza…). */
function Nivel({ nombre, escala, valor, onChange }: { nombre: string; escala: string[]; valor: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex justify-between text-[13px]"><span className="font-semibold text-brand-ink">{nombre}</span><span className="text-brand-slate">{escala[valor - 1]}</span></div>
      <div className="mt-1 grid grid-cols-5 gap-1" role="radiogroup" aria-label={nombre}>
        {escala.map((x, k) => (
          <button key={x} type="button" role="radio" aria-checked={valor === k + 1} title={x} onClick={() => onChange(k + 1)}
            className={cx("h-9 rounded-md border text-[12px] font-semibold", k + 1 <= valor ? "bg-brand-ink border-brand-ink text-white" : "bg-white border-brand-border text-brand-slate")}>
            {k + 1}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EditorCaso({ eid, caso, catalogo, onClose, onListo }: {
  eid: string; caso?: Caso; catalogo: Catalogo; onClose: () => void; onListo: (c: Caso) => void;
}) {
  const [f, setF] = useState<Omit<Caso, "id" | "orden">>(caso ? { ...caso } : VACIO);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const listo = f.titulo.trim().length >= 2 && f.cliente_nombre.trim().length >= 2 && f.objetivo.trim().length > 0;
  const guardar = async () => {
    setOcupado(true); setError(null);
    try {
      const c = await apiFetch<Caso>(caso ? `${CAP_API}/casos/${caso.id}` : `${CAP_API}/entrenamientos/${eid}/casos`,
        { method: caso ? "PATCH" : "POST", body: JSON.stringify({ ...f, primer_mensaje: f.primer_mensaje || null, detalles: f.detalles || null }) });
      onListo(c);
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <Hoja titulo={caso ? "Editar caso" : "Nuevo caso"} sobre="El cliente que va a atender el postulante" onClose={onClose} ocupada={ocupado}
      pie={<Boton onClick={guardar} ocupado={ocupado} disabled={!listo}>Guardar caso</Boton>}>
      <div className="space-y-5">
        <div><label className="label" htmlFor="ct">Título del caso</label>
          <input id="ct" className="input" value={f.titulo} maxLength={120} placeholder="Ej.: Portabilidad con cliente desconfiado" onChange={(e) => set("titulo", e.target.value)} /></div>
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <div><label className="label" htmlFor="cn">Nombre del cliente</label>
            <input id="cn" className="input" value={f.cliente_nombre} maxLength={60} placeholder="Ej.: Rosa Benítez" onChange={(e) => set("cliente_nombre", e.target.value)} /></div>
          <div><label className="label" htmlFor="ce">Edad</label>
            <input id="ce" className="input" inputMode="numeric" value={f.cliente_edad ?? ""} onChange={(e) => set("cliente_edad", e.target.value ? Number(e.target.value.replace(/\D/g, "")) || null : null)} /></div>
        </div>
        <div><label className="label" htmlFor="cs">Su situación</label>
          <textarea id="cs" className="input min-h-[72px]" value={f.situacion} maxLength={3000} placeholder="Ej.: Tiene Tigo hace 10 años, le llegó una promo de Claro por SMS." onChange={(e) => set("situacion", e.target.value)} /></div>
        <div><label className="label" htmlFor="co">Qué quiere</label>
          <textarea id="co" className="input min-h-[60px]" value={f.objetivo} maxLength={1500} placeholder="Ej.: Saber si le conviene pasarse sin perder su número." onChange={(e) => set("objetivo", e.target.value)} /></div>

        <fieldset className="space-y-3">
          <legend className="label">Cómo es (actitud)</legend>
          <Chips multiple etiqueta="Rasgos" opciones={Object.entries(catalogo.rasgos).map(([v, ayuda]) => ({ v, label: v.charAt(0).toUpperCase() + v.slice(1), ayuda }))}
            valor={f.actitud.rasgos} onChange={(v) => set("actitud", { ...f.actitud, rasgos: v.slice(0, 6) })} />
          <div className="grid sm:grid-cols-2 gap-3 pt-1">
            {Object.entries(catalogo.niveles).map(([k, n]) => (
              <Nivel key={k} nombre={n.nombre} escala={n.escala} valor={(f.actitud as any)[k] ?? 3} onChange={(v) => set("actitud", { ...f.actitud, [k]: v })} />
            ))}
          </div>
        </fieldset>

        <div><span className="label">Objeciones que va a plantear</span>
          <ListaFrases valor={f.objeciones} onChange={(v) => set("objeciones", v)} max={12} placeholder="Ej.: ¿Y si después me suben el precio?" /></div>
        <div><span className="label">Respuestas correctas: lo que tiene que dar bien</span>
          <p className="text-[12px] text-brand-slate -mt-1 mb-2">La IA corrige con esto (y con la información oficial del entrenamiento): revisa cada dato y, si lo da mal o no lo da, se lo marca con el correcto en su devolución. El cliente simulado no la conoce.</p>
          <ListaFrases valor={f.info_correcta} onChange={(v) => set("info_correcta", v)} max={20} placeholder="Ej.: El plan cuesta 99.000 Gs por mes" /></div>
        <div><label className="label" htmlFor="cp">Primer mensaje del cliente (opcional)</label>
          <textarea id="cp" className="input min-h-[60px]" value={f.primer_mensaje ?? ""} maxLength={1000} placeholder="Si lo dejás vacío, la IA lo escribe. Una línea en blanco = dos mensajes seguidos." onChange={(e) => set("primer_mensaje", e.target.value)} /></div>
        <div><label className="label" htmlFor="cd">Más detalles del personaje (opcional)</label>
          <textarea id="cd" className="input min-h-[60px]" value={f.detalles ?? ""} maxLength={2000} placeholder="Ej.: Escribe con faltas, usa «jaja», menciona a su hija." onChange={(e) => set("detalles", e.target.value)} /></div>
        <div><span className="label">Largo máximo de la charla</span>
          <Chips etiqueta="Turnos" opciones={[8, 12, 16, 20].map((n) => ({ v: String(n), label: `${n} respuestas` }))}
            valor={[String(f.max_turnos)]} onChange={(v) => v[0] && set("max_turnos", Number(v[0]))} /></div>
        {error && <Fallo>{error}</Fallo>}
      </div>
    </Hoja>
  );
}

// ------------------------------------------------------------------ evaluación
const ESTADO_DATO: Record<string, { label: string; tono: "verde" | "rojo" | "naranja" | "gris" }> = {
  correcto: { label: "Correcto", tono: "verde" }, incorrecto: { label: "Incorrecto", tono: "rojo" },
  omitido: { label: "No lo dijo", tono: "naranja" }, no_aplica: { label: "No aplicó", tono: "gris" },
};

export function EvaluacionVista({ ev, criterios }: { ev: EvaluacionCaso; criterios?: Record<string, string> }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className={cx("rounded-lg border px-3 py-2", ev.info_correcta ? "bg-emerald-50 border-emerald-200" : "bg-brand-primary-light border-brand-primary/25")}>
          <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate">Información</div>
          <div className={cx("font-semibold text-[15px] inline-flex items-center gap-1", ev.info_correcta ? "text-emerald-800" : "text-brand-primary-dark")}>
            {ev.info_correcta ? <><CircleCheck size={16} aria-hidden /> Correcta</> : <><CircleX size={16} aria-hidden /> Con errores</>}
          </div>
        </div>
        <div className="rounded-lg border border-brand-border bg-white px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate">Nivel comercial</div>
          <div className="font-display text-2xl text-brand-ink leading-none tabular-nums">{ev.nivel}<span className="text-sm text-brand-slate"> / 10</span></div>
        </div>
      </div>
      {ev.resumen && <p className="text-[14px] text-brand-ink leading-snug">{ev.resumen}</p>}
      {ev.datos.length > 0 && (
        <ul className="space-y-1.5">
          {ev.datos.map((d, k) => (
            <li key={k} className="text-[13px] leading-snug">
              <Etiqueta tono={ESTADO_DATO[d.estado]?.tono ?? "gris"}>{ESTADO_DATO[d.estado]?.label ?? d.estado}</Etiqueta>{" "}
              <span className="text-brand-ink">{d.dato}</span>{d.detalle && <span className="text-brand-slate"> — {d.detalle}</span>}
            </li>
          ))}
        </ul>
      )}
      {ev.errores.length > 0 && (
        <div className="rounded-lg bg-brand-primary-light/60 px-3 py-2 text-[13px] text-brand-primary-dark">
          <b>Dijo algo incorrecto:</b> {ev.errores.join(" · ")}
        </div>
      )}
      {criterios && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {Object.entries(ev.criterios).map(([k, v]) => (
            <div key={k} className="text-[12px]">
              <div className="flex justify-between"><span className="text-brand-slate">{criterios[k] ?? k}</span><b className="tabular-nums">{v}</b></div>
              <div className="h-1.5 rounded-full bg-brand-bg overflow-hidden"><div className="h-full bg-brand-ink rounded-full" style={{ width: `${v * 10}%` }} /></div>
            </div>
          ))}
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-2">
        {ev.fuertes.length > 0 && <div className="text-[13px]"><b className="text-emerald-800">Bien:</b> {ev.fuertes.join(" · ")}</div>}
        {ev.mejorar.length > 0 && <div className="text-[13px]"><b className="text-brand-primary-dark">Mejorar:</b> {ev.mejorar.join(" · ")}</div>}
      </div>
      {ev.devolucion && (
        <div className="rounded-lg border border-brand-border bg-brand-bg-soft px-3 py-2 text-[13px] text-brand-ink">
          <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">Lo que leyó el postulante</div>
          {ev.devolucion}
        </div>
      )}
    </div>
  );
}

/** El resultado final de un entrenamiento: perfil comercial, información correcta y la recomendación. */
export function ResultadoVista({ r }: { r: ResultadoEnt }) {
  return (
    <div className="space-y-3">
      <div className={cx("rounded-xl px-4 py-3", r.aprobado ? "bg-emerald-50 border border-emerald-200" : "bg-brand-primary-light border border-brand-primary/25")}>
        <div className={cx("font-semibold text-[16px] inline-flex items-center gap-1.5", r.aprobado ? "text-emerald-800" : "text-brand-primary-dark")}>
          {r.aprobado ? <CircleCheck size={18} aria-hidden /> : <CircleX size={18} aria-hidden />}
          {r.aprobado ? "Recomendado para incorporar" : "No recomendado todavía"}
        </div>
        <p className="text-[14px] text-brand-ink mt-1 leading-snug">{r.resumen}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-brand-border bg-white px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate">Perfil comercial</div>
          <div className="font-display text-2xl leading-none tabular-nums">{r.nivel_promedio}<span className="text-sm text-brand-slate"> / 10</span></div>
          <div className={cx("text-[12px] font-semibold mt-1", r.perfil_comercial ? "text-emerald-700" : "text-brand-primary-dark")}>
            {r.perfil_comercial ? "Cumple" : "No cumple"} (pide {r.umbral_nivel} o más)</div>
        </div>
        <div className="rounded-lg border border-brand-border bg-white px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate">Información correcta</div>
          <div className="font-display text-2xl leading-none tabular-nums">{r.info_ok}<span className="text-sm text-brand-slate"> de {r.casos} casos</span></div>
          <div className={cx("text-[12px] font-semibold mt-1", r.informacion_correcta ? "text-emerald-700" : "text-brand-primary-dark")}>
            {r.informacion_correcta ? "Cumple" : "No cumple"} ({Math.round(r.info_pct)}%, pide {r.umbral_info}%)</div>
        </div>
      </div>
      {r.mejorar.length > 0 && (
        <div><div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate mb-1">Qué tiene que mejorar</div>
          <ul className="space-y-1">{r.mejorar.map((x) => <li key={x} className="text-[14px] text-brand-ink flex gap-2"><Target size={15} className="mt-0.5 shrink-0 text-brand-primary" aria-hidden />{x}</li>)}</ul></div>
      )}
      {r.fuertes.length > 0 && (
        <div><div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate mb-1">Lo que hace bien</div>
          <ul className="space-y-1">{r.fuertes.map((x) => <li key={x} className="text-[14px] text-brand-ink flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-emerald-700" aria-hidden />{x}</li>)}</ul></div>
      )}
      <p className="text-[11px] text-brand-mist">Tiempo total {duracion(r.segundos)}. Evaluado con IA a partir de las conversaciones; el IPV no interviene.</p>
    </div>
  );
}

// ------------------------------------------------------------------ ver una conversación
export function VerConversacion({ sid, criterios, onClose }: { sid: string; criterios?: Record<string, string>; onClose: () => void }) {
  const [s, setS] = useState<Sesion | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiFetch<Sesion>(`${CAP_API}/sesiones/${sid}`).then(setS).catch((e) => setError(e.message)); }, [sid]);
  return (
    <Hoja titulo={s ? s.cliente : "Conversación"} sobre={s?.titulo} onClose={onClose}>
      {error && <Fallo>{error}</Fallo>}
      {!s && !error && <div className="h-40 rounded-lg bg-brand-bg animate-pulse" />}
      {s && (
        <div className="space-y-4">
          <div className="text-[12px] text-brand-slate">{s.turnos} respuestas del asesor · {duracion(s.segundos)}</div>
          <div className="rounded-xl bg-[#EEF0F3] p-3 space-y-1.5 max-h-[45vh] overflow-y-auto">
            {s.mensajes.map((m, k) => (
              <div key={k} className={cx("flex", m.r === "asesor" ? "justify-end" : "justify-start")}>
                <div className={cx("max-w-[85%] px-3 py-1.5 text-[14px] leading-snug whitespace-pre-wrap rounded-2xl",
                  m.r === "asesor" ? "bg-brand-ink text-white rounded-br-md" : "bg-white text-brand-ink rounded-bl-md")}>{m.t}</div>
              </div>
            ))}
          </div>
          {s.evaluacion ? <EvaluacionVista ev={s.evaluacion} criterios={criterios} />
            : <p className="text-sm text-brand-slate">{s.estado === "error" ? `No se pudo evaluar: ${s.error ?? ""}` : "Evaluando…"}</p>}
        </div>
      )}
    </Hoja>
  );
}

// ------------------------------------------------------------------ probar un caso (el mentor hace de asesor)
export function ProbarCaso({ caso, criterios, onClose }: { caso: Caso; criterios?: Record<string, string>; onClose: () => void }) {
  const [s, setS] = useState<Sesion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ev, setEv] = useState<Sesion | null>(null);
  const [evaluando, setEvaluando] = useState(false);
  useEffect(() => { apiFetch<Sesion>(`${CAP_API}/casos/${caso.id}/probar`, { method: "POST" }).then(setS).catch((e) => setError(e.message)); }, [caso.id]);
  const enviar = useCallback((textos: string[], lote: string) =>
    apiFetch<{ nuevos: string[]; fin: boolean }>(`${CAP_API}/sesiones/${s!.id}/mensajes`, { method: "POST", body: JSON.stringify({ textos, lote }) }), [s]);
  const evaluar = async () => {
    setEvaluando(true);
    try { setEv(await apiFetch<Sesion>(`${CAP_API}/sesiones/${s!.id}/terminar`, { method: "POST" })); }
    catch (e: any) { setError(e.message); } finally { setEvaluando(false); }
  };
  if (error && !s) return <Hoja titulo="Probar caso" onClose={onClose}><Fallo>{error}</Fallo></Hoja>;
  if (!s) return <Hoja titulo="Probar caso" onClose={onClose}><div className="h-32 rounded-lg bg-brand-bg animate-pulse" /><p className="text-sm text-brand-slate mt-3">El cliente está entrando al chat…</p></Hoja>;
  if (ev?.evaluacion) {
    return (
      <Hoja titulo="Cómo te evaluaría la IA" sobre={`Prueba · ${caso.titulo}`} onClose={onClose}
        pie={<Boton onClick={onClose}>Listo</Boton>}>
        <EvaluacionVista ev={ev.evaluacion} criterios={criterios} />
      </Hoja>
    );
  }
  return (
    <Chat id={s.id} cliente={s.cliente} titulo={`Prueba · ${caso.titulo}`} mensajes={s.mensajes} iniciado={s.iniciado_at} terminado={s.estado !== "en_curso"}
      enviar={enviar} onVolver={onClose} onTerminar={evaluar}
      aviso={<p className="text-center text-[12px] text-brand-slate pb-2">Prueba: vos hacés de asesor. No queda en ninguna ficha.</p>}
      pie={() => <Boton onClick={evaluar} ocupado={evaluando}>Ver cómo me evaluaría</Boton>} />
  );
}

// ------------------------------------------------------------------ enviar a postulantes
interface Enviado { postulante_id: string; nombre: string; apellido: string; url: string | null; omitido?: string; ya_enviado?: boolean; intento?: number }

/** Cómo está un postulante con un entrenamiento: sin enviar, lo tiene sin terminar o lo terminó (se puede repetir). */
function conEste(ents: EntResumen[], eid: string): { tiene: boolean; terminado: boolean; intento: number } {
  const mios = ents.filter((e) => e.entrenamiento_id === eid);
  if (!mios.length) return { tiene: false, terminado: false, intento: 0 };
  const ult = mios.reduce((a, b) => ((b.intento ?? 1) > (a.intento ?? 1) ? b : a));
  return { tiene: true, terminado: ult.estado === "terminado", intento: ult.intento ?? 1 };
}

async function enviarA(eid: string, pids: string[]) {
  // `repetir`: a quien ya lo terminó se le manda de nuevo como otro intento (no hay tope de entrenamientos).
  return apiFetch<{ enviados: Enviado[] }>(`${CAP_API}/entrenamientos/${eid}/enviar`,
    { method: "POST", body: JSON.stringify({ postulante_ids: pids, origen: window.location.origin, repetir: true }) });
}

export function HojaEnviar({ eid, nombre, meta, borrador, grupoInicial, onClose, onListo }: {
  eid: string; nombre: string; meta: number; borrador?: boolean; grupoInicial?: string; onClose: () => void; onListo?: () => void;
}) {
  const [grupos, setGrupos] = useState<Resumen["grupos"] | null>(null);
  const [gid, setGid] = useState<string | null>(grupoInicial ?? null);
  const [g, setG] = useState<GrupoDetalle | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<Enviado[] | null>(null);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    apiFetch<Resumen>(`${CAP_API}/resumen?estado=en_curso`).then((r) => {
      setGrupos(r.grupos);
      if (!grupoInicial && r.grupos.length === 1) setGid(r.grupos[0].id);
    }).catch((e) => setError(e.message));
  }, [grupoInicial]);
  useEffect(() => {
    if (!gid) return;
    setG(null);
    apiFetch<GrupoDetalle>(`${CAP_API}/grupos/${gid}`).then((x) => {
      setG(x);
      // Por defecto, los activos que todavía no lo tienen.
      setSel(x.postulantes.filter((p) => !["abandono", "baja"].includes(p.estado) && !p.entrenamientos.some((e) => e.entrenamiento_id === eid)).map((p) => p.id));
    }).catch((e) => setError(e.message));
  }, [gid, eid]);
  const activos = useMemo(() => (g?.postulantes ?? []).filter((p) => !["abandono", "baja"].includes(p.estado)), [g]);
  const enviar = async () => {
    setOcupado(true); setError(null);
    try {
      const r = await enviarA(eid, sel);
      setHecho(r.enviados); onListo?.();
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  const mensaje = (x: Enviado) => `Hola ${x.nombre}, tenés un entrenamiento nuevo de Voicenter: «${nombre}». Entrá con tu link (es personal): ${x.url}`;
  const copiarTodos = async () => {
    const t = (hecho ?? []).filter((x) => x.url).map((x) => `${x.nombre} ${x.apellido}: ${x.url}`).join("\n");
    try { await navigator.clipboard.writeText(t); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sin portapapeles */ }
  };

  if (hecho) {
    return (
      <Hoja titulo="¡Enviado!" sobre={nombre} onClose={onClose} pie={<Boton onClick={onClose}>Listo</Boton>}>
        <p className="text-sm text-brand-slate mb-3">Ya lo ven en su link. Mandáselo por WhatsApp a cada uno (se abre con el mensaje listo):</p>
        <ul className="card divide-y divide-brand-border overflow-hidden">
          {hecho.map((x) => (
            <li key={x.postulante_id} className="px-3 py-2.5 flex items-center gap-3">
              <span className="flex-1 min-w-0 text-[15px] text-brand-ink">{x.nombre} {x.apellido}
                {x.omitido && <span className="block text-[12px] text-brand-slate">No se envió: {x.omitido}</span>}
                {x.ya_enviado && <span className="block text-[12px] text-brand-slate">Ya lo tenía sin terminar: le reenviás el link</span>}
                {!x.ya_enviado && (x.intento ?? 1) > 1 && <span className="block text-[12px] text-brand-slate">Lo repite ({x.intento}.º intento)</span>}</span>
              {x.url && (
                <button type="button" onClick={() => abrirWhatsapp(mensaje(x))}
                  className="btn min-h-[44px] px-3 bg-emerald-600 text-white text-sm"><MessageCircle size={16} aria-hidden /> WhatsApp</button>
              )}
            </li>
          ))}
        </ul>
        <button type="button" onClick={copiarTodos} className="mt-3 btn-ghost text-sm"><Copy size={15} aria-hidden /> {copiado ? "¡Copiados!" : "Copiar todos los links"}</button>
      </Hoja>
    );
  }
  return (
    <Hoja titulo="Enviar entrenamiento" sobre={nombre} onClose={onClose} ocupada={ocupado}
      pie={<Boton icono={Send} onClick={enviar} ocupado={ocupado} disabled={!sel.length}>
        {borrador ? `Activar y enviar (${sel.length})` : `Enviar a ${sel.length} postulante${sel.length === 1 ? "" : "s"}`}</Boton>}>
      <div className="space-y-4">
        {borrador && <AvisoBorrador />}
        {!grupoInicial && (
          <div><span className="label">Grupo</span>
            {grupos === null ? <div className="h-11 rounded-lg bg-brand-bg animate-pulse" /> : grupos.length === 0 ? <p className="text-sm text-brand-slate">No tenés grupos en curso.</p> : (
              <Chips etiqueta="Grupo" opciones={grupos.map((x) => ({ v: x.id, label: x.nombre }))} valor={gid ? [gid] : []} onChange={(v) => setGid(v[0] ?? null)} />
            )}</div>
        )}
        {gid && !g && <div className="h-32 rounded-lg bg-brand-bg animate-pulse" />}
        {g && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="label !mb-0">Postulantes</span>
              <button type="button" className="text-sm font-semibold text-brand-primary" onClick={() => setSel(sel.length === activos.length ? [] : activos.map((p) => p.id))}>
                {sel.length === activos.length ? "Ninguno" : "Todos"}
              </button>
            </div>
            <div className="space-y-2">
              {activos.map((p) => {
                const ya = conEste(p.entrenamientos, eid);
                return (
                  <Casilla key={p.id} checked={sel.includes(p.id)} onChange={(v) => setSel(v ? [...sel, p.id] : sel.filter((x) => x !== p.id))}
                    sub={<>{p.avance.terminados} hechos (mínimo {meta})
                      {ya.terminado ? ` · lo terminó: si lo elegís, lo repite (${ya.intento + 1}.º intento)` : ya.tiene ? " · ya lo tiene, sin terminar" : ""}</>}>
                    {p.apellido}, {p.nombre}
                  </Casilla>
                );
              })}
              {!activos.length && <p className="text-sm text-brand-slate">No hay postulantes activos en este grupo.</p>}
            </div>
          </div>
        )}
        {error && <Fallo>{error}</Fallo>}
      </div>
    </Hoja>
  );
}

/** Entrenamientos terminados frente al mínimo por postulante. No es un tope: al llegar, la barra queda llena y el número sigue sumando. */
export function MetaEntrenamientos({ hechos, meta, compacta }: { hechos: number; meta: number; compacta?: boolean }) {
  const llego = hechos >= meta;
  const pct = Math.min(100, Math.round((hechos / Math.max(1, meta)) * 100));
  return (
    <span className={cx("inline-flex items-center gap-1.5", compacta ? "text-[12px]" : "text-[13px]")}
      title={`Mínimo: ${meta} entrenamientos por postulante. Pueden hacer más.`}>
      <span className="w-14 h-1.5 rounded-full bg-brand-bg overflow-hidden" aria-hidden><span className="block h-full rounded-full" style={{ width: `${pct}%`, background: llego ? "#15803D" : "#0F1116" }} /></span>
      <span className={cx("tabular-nums inline-flex items-center gap-0.5", llego ? "text-emerald-700 font-semibold" : "text-brand-slate")}>
        {llego ? <>{hechos} entren. <Check size={13} aria-label="llegó al mínimo" /></> : <>{hechos} de {meta} entren.</>}
      </span>
    </span>
  );
}


/** Un entrenamiento en borrador se puede enviar: al enviarlo se activa (y lo ven los postulantes). */
export function AvisoBorrador() {
  return (
    <p className="rounded-lg border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-[13px] text-[#5C3700]">
      <b>Está en borrador.</b> Al enviarlo se activa y lo ven los postulantes.
    </p>
  );
}

// ------------------------------------------------------------------ en la ficha del postulante
/** Enviarle un entrenamiento a un postulante (desde su ficha o desde el grupo). */
export function HojaEnviarA({ pid, nombre, onClose, onListo }: { pid: string; nombre: string; onClose: () => void; onListo?: () => void }) {
  const [lista, setLista] = useState<(EntrenamientoFila & { ya: ReturnType<typeof conEste> })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ ent: string; url: string | null } | null>(null);
  useEffect(() => {
    Promise.all([apiFetch<{ entrenamientos: EntrenamientoFila[] }>(`${CAP_API}/entrenamientos`),
      apiFetch<{ entrenamientos: EntPostulante[] }>(`${CAP_API}/postulantes/${pid}/entrenamientos`)])
      .then(([a, b]) => {
        // Primero los activos; los borradores, después y marcados (al enviarlos se activan).
        setLista(a.entrenamientos.filter((e) => e.estado !== "archivado" && e.casos > 0).map((e) => ({ ...e, ya: conEste(b.entrenamientos, e.id) }))
          .sort((x, y) => Number(x.estado === "borrador") - Number(y.estado === "borrador")));
      }).catch((e) => setError(e.message));
  }, [pid]);
  const enviar = async (e: EntrenamientoFila) => {
    setOcupado(e.id); setError(null);
    try {
      const r = await enviarA(e.id, [pid]);
      setHecho({ ent: conIntento(e.nombre, r.enviados[0]?.intento), url: r.enviados[0]?.url ?? null }); onListo?.();
    } catch (x: any) { setError(x.message); } finally { setOcupado(null); }
  };
  if (hecho) {
    return (
      <Hoja titulo="¡Enviado!" sobre={nombre} onClose={onClose} pie={<Boton tipo="secundario" onClick={onClose}>Listo</Boton>}>
        <p className="text-[15px] text-brand-ink">«{hecho.ent}» ya aparece en el link de {nombre.split(" ")[0]}.</p>
        {hecho.url && <div className="mt-4"><Boton icono={MessageCircle} onClick={() => abrirWhatsapp(`Hola ${nombre.split(" ")[0]}, tenés un entrenamiento nuevo de Voicenter: «${hecho.ent}». Entrá con tu link (es personal): ${hecho.url}`)}>Avisarle por WhatsApp</Boton></div>}
      </Hoja>
    );
  }
  return (
    <Hoja titulo="Enviar entrenamiento" sobre={nombre} onClose={onClose}>
      {error && <Fallo>{error}</Fallo>}
      {!lista && !error && <div className="h-32 rounded-lg bg-brand-bg animate-pulse" />}
      {lista && lista.length === 0 && <p className="text-sm text-brand-slate">No hay entrenamientos listos. Crealos en <b>Entrenamientos</b>.</p>}
      {lista && lista.length > 0 && (
        <ul className="space-y-2">
          {lista.map((e) => {
            const bloqueado = e.ya.tiene && !e.ya.terminado;
            return (
              <li key={e.id}>
                <button type="button" disabled={!!ocupado || bloqueado} onClick={() => enviar(e)}
                  className={cx("w-full text-left card px-4 py-3 flex items-center gap-3 min-h-[60px]", bloqueado ? "opacity-60" : "hover:border-brand-ink active:bg-brand-bg-soft")}>
                  <span className="min-w-0 flex-1"><span className="flex items-center gap-2 flex-wrap font-semibold text-[15px] text-brand-ink">{e.nombre}
                    {e.estado === "borrador" && <Etiqueta tono="naranja">Borrador</Etiqueta>}</span>
                    <span className="block text-[12px] text-brand-slate">{e.casos} caso{e.casos === 1 ? "" : "s"}
                      {e.ya.terminado ? ` · lo terminó: tocá para repetirlo (${e.ya.intento + 1}.º intento)` : bloqueado ? " · ya lo tiene, sin terminar" : ""}
                      {e.estado === "borrador" && !bloqueado && " · se activa al enviarlo"}</span></span>
                  {ocupado === e.id ? <span className="text-[12px] text-brand-slate">Enviando…</span>
                    : e.ya.terminado ? <RotateCcw size={18} className="text-brand-primary" aria-hidden />
                    : !bloqueado && <Send size={18} className="text-brand-primary" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Hoja>
  );
}

const ESTADO_ASIG: Record<string, { label: string; tono: "gris" | "azul" | "verde" | "naranja" }> = {
  pendiente: { label: "Sin empezar", tono: "gris" }, en_curso: { label: "En curso", tono: "azul" },
  evaluando: { label: "Evaluando", tono: "naranja" }, terminado: { label: "Terminado", tono: "verde" },
};

export function EntrenamientosFicha({ pid, nombre, meta, puedeEnviar, criterios }: {
  pid: string; nombre: string; meta: number; puedeEnviar: boolean; criterios?: Record<string, string>;
}) {
  const [lista, setLista] = useState<EntPostulante[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [enviar, setEnviar] = useState(false);
  const cargar = useCallback(() => {
    apiFetch<{ entrenamientos: EntPostulante[] }>(`${CAP_API}/postulantes/${pid}/entrenamientos`).then((r) => setLista(r.entrenamientos)).catch((e) => setError(e.message));
  }, [pid]);
  useEffect(cargar, [cargar]);
  // Mientras haya algo evaluándose, se refresca solo.
  useEffect(() => {
    if (!lista?.some((x) => x.estado === "evaluando" || x.casos_detalle.some((c) => c.sesion?.estado === "evaluando"))) return;
    const t = setTimeout(cargar, 5000);
    return () => clearTimeout(t);
  }, [lista, cargar]);
  const terminados = lista?.filter((x) => x.estado === "terminado").length ?? 0;
  const pendientes = (lista?.length ?? 0) - terminados;
  const [repitiendo, setRepitiendo] = useState<string | null>(null);
  const repetir = async (x: EntPostulante) => {
    setRepitiendo(x.id); setError(null);
    try { await enviarA(x.entrenamiento_id, [pid]); cargar(); } catch (e: any) { setError(e.message); } finally { setRepitiendo(null); }
  };
  // El último intento de cada entrenamiento (solo ese se puede repetir).
  const ultimo = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of lista ?? []) { const y = (lista ?? []).find((z) => z.id === m.get(x.entrenamiento_id)); if (!y || (x.intento ?? 1) > (y.intento ?? 1)) m.set(x.entrenamiento_id, x.id); }
    return new Set(m.values());
  }, [lista]);
  return (
    <div className="space-y-3">
      <div className="card px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate">Mínimo del equipo</div>
          <div className="text-[15px] text-brand-ink">
            {terminados >= meta
              ? <><b>{terminados}</b> entrenamientos hechos · superó el mínimo de {meta} <Check size={15} className="inline text-emerald-700" aria-hidden /></>
              : <><b>{terminados}</b> de <b>{meta}</b> entrenamientos hechos</>}
            {pendientes > 0 ? ` · ${pendientes} pendiente${pendientes === 1 ? "" : "s"}` : ""}
          </div>
          <div className="text-[12px] text-brand-slate">{meta} es el mínimo: puede hacer más y repetir los que ya terminó.</div>
          <div className="mt-2 h-2 rounded-full bg-brand-bg overflow-hidden" role="progressbar" aria-label="Entrenamientos hechos"
            aria-valuenow={terminados} aria-valuemin={0} aria-valuemax={meta}>
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.round((terminados / Math.max(1, meta)) * 100))}%`, background: terminados >= meta ? "#15803D" : "#0F1116" }} />
          </div>
        </div>
        {puedeEnviar && <Boton icono={Send} onClick={() => setEnviar(true)} className="sm:!w-auto">Enviar entrenamiento</Boton>}
      </div>
      {error && <Fallo>{error}</Fallo>}
      {lista?.map((x) => {
        const abiertoX = abierto === x.id;
        return (
          <div key={x.id} className="card overflow-hidden">
            <button type="button" onClick={() => setAbierto(abiertoX ? null : x.id)} className="w-full text-left px-4 py-3" aria-expanded={abiertoX}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-[15px] text-brand-ink flex-1 min-w-0">{conIntento(x.nombre, x.intento)}</span>
                {x.resultado ? <Etiqueta tono={x.resultado.aprobado ? "verde" : "rojo"}>{x.resultado.aprobado ? "Recomendado" : "No recomendado"}</Etiqueta>
                  : <Etiqueta tono={ESTADO_ASIG[x.estado]?.tono ?? "gris"}>{ESTADO_ASIG[x.estado]?.label ?? x.estado}</Etiqueta>}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-brand-bg overflow-hidden"><div className="h-full rounded-full" style={{ width: `${x.pct}%`, background: x.estado === "terminado" ? "#15803D" : "#0F1116" }} /></div>
                <span className="text-[12px] text-brand-slate tabular-nums">{x.pct}% · {x.hechos}/{x.casos} casos</span>
              </div>
              {x.resultado && <div className="mt-1 text-[12px] text-brand-slate">Perfil comercial {x.resultado.nivel_promedio}/10 · información correcta en {x.resultado.info_ok} de {x.resultado.casos} casos</div>}
            </button>
            {abiertoX && (
              <div className="border-t border-brand-border px-4 py-3 space-y-3">
                {x.resultado && <ResultadoVista r={x.resultado} />}
                {puedeEnviar && x.estado === "terminado" && ultimo.has(x.id) && !x.archivado && (
                  <Boton tipo="secundario" icono={RotateCcw} ocupado={repitiendo === x.id} onClick={() => repetir(x)} className="sm:!w-auto !min-h-[48px]">
                    Repetir este entrenamiento
                  </Boton>
                )}
                <ul className="divide-y divide-brand-border">
                  {x.casos_detalle.map((c) => (
                    <li key={c.caso_id} className="py-2.5 flex items-center gap-3">
                      <span className="w-7 h-7 rounded-full bg-brand-bg text-[12px] font-bold flex items-center justify-center shrink-0">{c.orden}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] text-brand-ink">{c.titulo}</span>
                        <span className="block text-[12px] text-brand-slate">
                          {!c.sesion ? "Sin hacer" : c.sesion.estado === "en_curso" ? "Chateando" : c.sesion.estado === "evaluando" ? "Evaluando…" : c.sesion.estado === "error" ? "No se pudo evaluar"
                            : <>Nivel {c.sesion.nivel}/10 · {c.sesion.info_correcta ? "información correcta" : "información con errores"} · {duracion(c.sesion.segundos)}</>}
                        </span>
                      </span>
                      {c.sesion && c.sesion.estado !== "en_curso" && <button type="button" onClick={() => setVer(c.sesion!.id)} className="btn-ghost text-sm shrink-0">Ver</button>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
      {lista?.length === 0 && <div className="card p-6 text-center text-sm text-brand-slate">Todavía no tiene entrenamientos.</div>}
      {ver && <VerConversacion sid={ver} criterios={criterios} onClose={() => setVer(null)} />}
      {enviar && <HojaEnviarA pid={pid} nombre={nombre} onClose={() => { setEnviar(false); cargar(); }} />}
    </div>
  );
}
