"use client";

/**
 * Dictado por voz del portal: graba en el celular (MediaRecorder), sube el audio como registro y espera la transcripción
 * que hace el servidor. Si no hay señal, el audio queda guardado en el teléfono (IndexedDB) y se sube cuando vuelve.
 * Nunca se manda nada a terceros desde el navegador: el audio va solo a nuestro servidor.
 */
import { CircleCheck, CloudOff, LoaderCircle, Mic, Pause, Play, Square, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SUP_API, type AudioCoaching } from "@/components/supervision/tipos";
import { ApiError, apiFetch, getToken } from "@/lib/api";
import { cx } from "./ui";

export type Hablante = "supervisor" | "asesor";
export type Destino = "item" | "compromiso" | "comentario" | "cierre";

export const MAX_SEGUNDOS = 300;
const MIMES = ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
const BARRAS = 28;

function elegirMime(): string | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return null;
  return MIMES.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) ?? "";
}

export const puedeGrabar = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && elegirMime() !== null;

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ------------------------------------------------------------------ grabación
type EstadoGrabacion = "inactiva" | "pidiendo" | "grabando";
export interface Grabado { blob: Blob; mime: string; duracion: number }

export function useGrabadora(maxSeg = MAX_SEGUNDOS) {
  const [estado, setEstado] = useState<EstadoGrabacion>("inactiva");
  const [segundos, setSegundos] = useState(0);
  const [niveles, setNiveles] = useState<number[]>(() => Array(BARRAS).fill(0));
  const [error, setError] = useState<string | null>(null);
  const r = useRef<{
    rec?: MediaRecorder; stream?: MediaStream; ctx?: AudioContext; raf?: number; timer?: ReturnType<typeof setInterval>;
    t0?: number; partes: Blob[]; lock?: { release: () => Promise<void> }; fin?: (g: Grabado | null) => void; cancelada?: boolean;
  }>({ partes: [] });

  const limpiar = useCallback(() => {
    const x = r.current;
    if (x.raf) cancelAnimationFrame(x.raf);
    if (x.timer) clearInterval(x.timer);
    x.stream?.getTracks().forEach((t) => t.stop());
    x.ctx?.close().catch(() => undefined);
    x.lock?.release().catch(() => undefined);
    r.current = { partes: [] };
    setEstado("inactiva");
    setNiveles(Array(BARRAS).fill(0));
  }, []);

  const terminar = useCallback((): Promise<Grabado | null> => new Promise((resolve) => {
    const x = r.current;
    if (!x.rec || x.rec.state === "inactive") { limpiar(); resolve(null); return; }
    x.fin = resolve;
    x.rec.stop();
  }), [limpiar]);

  const cancelar = useCallback(() => {
    r.current.cancelada = true;
    if (r.current.rec && r.current.rec.state !== "inactive") r.current.rec.stop();
    else limpiar();
  }, [limpiar]);

  const iniciar = useCallback(async (alLlegarAlTope?: () => void) => {
    setError(null);
    const mime = elegirMime();
    if (!navigator.mediaDevices?.getUserMedia || mime === null) {
      setError("Este navegador no permite grabar: escribilo.");
      return false;
    }
    setEstado("pidiendo");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e: any) {
      setEstado("inactiva");
      setError(e?.name === "NotAllowedError"
        ? "Permití el micrófono para grabar (tocá el candado de la barra del navegador)."
        : e?.name === "NotFoundError" ? "No encontramos un micrófono en este equipo." : "No se pudo abrir el micrófono.");
      return false;
    }
    const opciones: MediaRecorderOptions = { audioBitsPerSecond: 32000, ...(mime ? { mimeType: mime } : {}) };
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(stream, opciones); } catch { rec = new MediaRecorder(stream); }
    const x = r.current;
    x.rec = rec;
    x.stream = stream;
    x.partes = [];
    x.cancelada = false;
    rec.ondataavailable = (e) => { if (e.data && e.data.size) x.partes.push(e.data); };
    rec.onstop = () => {
      const tipo = rec.mimeType || mime || "audio/webm";
      const duracion = x.t0 ? (Date.now() - x.t0) / 1000 : 0;
      const g = !x.cancelada && x.partes.length ? { blob: new Blob(x.partes, { type: tipo }), mime: tipo, duracion } : null;
      const fin = x.fin;
      limpiar();
      fin?.(g);
    };
    // El nivel de la voz, para que se vea que está escuchando.
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AC();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      x.ctx = ctx;
      const buf = new Uint8Array(an.fftSize);
      let ultimo = 0;
      const paso = (t: number) => {
        if (t - ultimo > 90) {
          ultimo = t;
          an.getByteTimeDomainData(buf);
          let suma = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; suma += v * v; }
          const nivel = Math.min(1, Math.sqrt(suma / buf.length) * 4);
          setNiveles((n) => [...n.slice(1), nivel]);
        }
        x.raf = requestAnimationFrame(paso);
      };
      x.raf = requestAnimationFrame(paso);
    } catch { /* sin medidor: graba igual */ }
    try { x.lock = await (navigator as any).wakeLock?.request("screen"); } catch { /* la pantalla puede apagarse */ }
    x.t0 = Date.now();
    rec.start(1000);
    setSegundos(0);
    setEstado("grabando");
    x.timer = setInterval(() => {
      const s = (Date.now() - (x.t0 ?? Date.now())) / 1000;
      setSegundos(s);
      if (s >= maxSeg) {
        if (x.timer) clearInterval(x.timer);
        x.timer = undefined;
        if (alLlegarAlTope) alLlegarAlTope(); else x.rec?.stop();
      }
    }, 250);
    return true;
  }, [limpiar, maxSeg]);

  useEffect(() => () => { r.current.cancelada = true; r.current.rec?.state === "recording" && r.current.rec.stop(); }, []);
  return { estado, segundos, niveles, error, setError, iniciar, terminar, cancelar };
}

// ------------------------------------------------------------------ cola local (sin señal)
const DB = "voicenter-portal";
const STORE = "audios";

export interface AudioLocal {
  id: string; coachingId: string; hablante: Hablante; destino: Destino; duracion: number; mime: string; blob: Blob; at: number;
}

function abrirDb(): Promise<IDBDatabase> {
  return new Promise((ok, mal) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => ok(req.result);
    req.onerror = () => mal(req.error);
  });
}

async function tx<T>(modo: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await abrirDb();
  return new Promise((ok, mal) => {
    const t = db.transaction(STORE, modo);
    const req = f(t.objectStore(STORE));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => mal(req.error);
  });
}

export async function guardarLocal(a: AudioLocal): Promise<boolean> {
  try { await tx("readwrite", (s) => s.put(a)); return true; } catch { return false; }
}
export async function localesDe(coachingId: string): Promise<AudioLocal[]> {
  try { return ((await tx("readonly", (s) => s.getAll())) as AudioLocal[]).filter((a) => a.coachingId === coachingId); } catch { return []; }
}
export async function borrarLocal(id: string): Promise<void> {
  try { await tx("readwrite", (s) => s.delete(id)); } catch { /* nada */ }
}

// ------------------------------------------------------------------ subir y esperar la transcripción
const sinRed = (e: unknown) => e instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine);

/** El «coaching» de los audios del cierre del día del supervisor (no son de un coaching: van a su propio endpoint). */
export const CIERRE = "cierre";

export async function subirAudio(coachingId: string, g: { blob: Blob; mime: string; duracion: number }, hablante: Hablante,
  destino: Destino): Promise<AudioCoaching> {
  const url = coachingId === CIERRE ? `${SUP_API}/portal/cierre/audios` : `${SUP_API}/portal/coaching/${coachingId}/audios`;
  const ext = g.mime.includes("mp4") ? "m4a" : g.mime.includes("ogg") ? "ogg" : g.mime.includes("wav") ? "wav" : "webm";
  let espera = 1000;
  for (let intento = 0; ; intento++) {
    const fd = new FormData();
    fd.append("archivo", new File([g.blob], `grabacion.${ext}`, { type: g.mime.split(";")[0] }));
    fd.append("duracion", String(Math.max(0.5, Math.round(g.duracion * 10) / 10)));
    fd.append("hablante", hablante);
    fd.append("destino", destino);
    try {
      return await apiFetch<AudioCoaching>(url, { method: "POST", body: fd });
    } catch (e) {
      if (!sinRed(e) || intento >= 2) throw e;
      await new Promise((ok) => setTimeout(ok, espera));
      espera *= 3;
    }
  }
}

const TERMINADO = new Set(["listo", "error", "sin_servicio"]);

export async function esperarTranscripcion(audio: AudioCoaching, cancelado: () => boolean): Promise<AudioCoaching> {
  let a = audio;
  for (let i = 0; i < 160 && !TERMINADO.has(a.estado) && !cancelado(); i++) {
    await new Promise((ok) => setTimeout(ok, i < 20 ? 1500 : 3000));
    try { a = await apiFetch<AudioCoaching>(`${SUP_API}/portal/audios/${a.id}`); } catch (e) { if (!sinRed(e)) throw e; }
  }
  return a;
}

// ------------------------------------------------------------------ el botón de dictado
type Fase =
  | { f: "nada" } | { f: "subiendo" } | { f: "transcribiendo"; audio: AudioCoaching } | { f: "listo"; audio: AudioCoaching }
  | { f: "sin_texto"; audio: AudioCoaching; motivo: string } | { f: "local" } | { f: "error"; msg: string };

/**
 * «Dictar»: un toque graba, otro termina. Avisa con `onSubido` en cuanto el audio está en el servidor (ya se puede
 * guardar: el texto llega solo) y con `onTexto` cuando la transcripción está lista.
 */
export function Dictado({ coachingId, hablante, destino, etiqueta = "Dictar", ayuda, autoIniciar, onSubido, onTexto, onGrabando, principal = true }: {
  coachingId: string; hablante: Hablante; destino: Destino; etiqueta?: string; ayuda?: string; autoIniciar?: boolean;
  onSubido?: (a: AudioCoaching) => void; onTexto?: (texto: string, a: AudioCoaching) => void; onGrabando?: (v: boolean) => void;
  principal?: boolean;
}) {
  const g = useGrabadora();
  const [fase, setFase] = useState<Fase>({ f: "nada" });
  const vivo = useRef(true);
  const pendienteLocal = useRef<AudioLocal | null>(null);
  useEffect(() => () => { vivo.current = false; }, []);
  useEffect(() => { onGrabando?.(g.estado !== "inactiva"); }, [g.estado, onGrabando]);

  const procesar = useCallback(async (grabado: Grabado) => {
    setFase({ f: "subiendo" });
    let audio: AudioCoaching;
    try {
      audio = await subirAudio(coachingId, grabado, hablante, destino);
    } catch (e) {
      if (sinRed(e) && coachingId !== CIERRE) {
        const local: AudioLocal = { id: crypto.randomUUID?.() ?? String(Date.now()), coachingId, hablante, destino,
          duracion: grabado.duracion, mime: grabado.mime, blob: grabado.blob, at: Date.now() };
        pendienteLocal.current = local;
        await guardarLocal(local);
        if (vivo.current) setFase({ f: "local" });
        return;
      }
      if (vivo.current) setFase({ f: "error", msg: e instanceof ApiError ? e.message : "No se pudo subir el audio." });
      return;
    }
    if (pendienteLocal.current) { await borrarLocal(pendienteLocal.current.id); pendienteLocal.current = null; }
    onSubido?.(audio);
    if (!vivo.current) return;
    setFase({ f: "transcribiendo", audio });
    try {
      const a = await esperarTranscripcion(audio, () => !vivo.current);
      if (!vivo.current) return;
      if (a.estado === "listo" && a.texto) { setFase({ f: "listo", audio: a }); onTexto?.(a.texto, a); }
      else if (a.estado === "sin_servicio") setFase({ f: "sin_texto", audio: a, motivo: "La transcripción automática no está activa: escribilo vos. El audio queda guardado." });
      else if (a.estado === "error") setFase({ f: "sin_texto", audio: a, motivo: "No se pudo transcribir: escribilo vos. El audio queda guardado." });
      else setFase({ f: "sin_texto", audio: a, motivo: "La transcripción está tardando: podés guardar igual, el texto se completa solo." });
    } catch {
      if (vivo.current) setFase({ f: "sin_texto", audio, motivo: "No pudimos ver si terminó la transcripción: se completa sola." });
    }
  }, [coachingId, hablante, destino, onSubido, onTexto]);

  // Sin señal: cuando vuelve, se sube solo.
  useEffect(() => {
    if (fase.f !== "local") return;
    const volver = () => {
      const l = pendienteLocal.current;
      if (l) procesar({ blob: l.blob, mime: l.mime, duracion: l.duracion });
    };
    window.addEventListener("online", volver);
    return () => window.removeEventListener("online", volver);
  }, [fase.f, procesar]);

  const listo = useCallback(async () => {
    const x = await g.terminar();
    if (x && x.duracion >= 0.8) procesar(x);
    else if (x) g.setError("Fue muy corto: mantené la grabación al menos un segundo.");
  }, [g, procesar]);

  const empezar = useCallback(() => { setFase({ f: "nada" }); g.iniciar(listo); }, [g, listo]);
  const arrancado = useRef(false);
  useEffect(() => {
    if (autoIniciar && !arrancado.current && puedeGrabar()) { arrancado.current = true; empezar(); }
  }, [autoIniciar, empezar]);

  if (g.estado === "grabando" || g.estado === "pidiendo") {
    const quedan = MAX_SEGUNDOS - g.segundos;
    return (
      <div className="rounded-xl border-2 border-brand-primary/40 bg-brand-primary-light/50 p-4" role="group" aria-label="Grabando">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-brand-primary-dark font-semibold">
            <span className="w-3 h-3 rounded-full bg-brand-primary grabando-punto" aria-hidden />
            {g.estado === "pidiendo" ? "Abriendo el micrófono…" : hablante === "asesor" ? "Grabando al asesor" : "Grabando"}
          </div>
          <div className="font-display text-2xl tabular-nums text-brand-ink" aria-live="off">
            {mmss(g.segundos)}<span className="text-sm text-brand-slate"> / {mmss(MAX_SEGUNDOS)}</span>
          </div>
        </div>
        <div className="mt-3 h-12 flex items-center gap-[3px]" aria-hidden>
          {g.niveles.map((v, i) => (
            <span key={i} className="flex-1 rounded-full bg-brand-primary transition-[height] duration-100"
              style={{ height: `${Math.max(8, Math.round(v * 100))}%`, opacity: 0.35 + v * 0.65 }} />
          ))}
        </div>
        {quedan <= 30 && g.estado === "grabando" && (
          <p className="mt-2 text-xs font-semibold text-brand-primary-dark">Quedan {Math.ceil(quedan)} s: se corta sola a los 5 minutos.</p>
        )}
        <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
          <button type="button" onClick={g.cancelar} className="btn min-h-[56px] px-4 bg-white border border-brand-border text-brand-slate" aria-label="Descartar la grabación">
            <X size={20} aria-hidden /> Descartar
          </button>
          <button type="button" onClick={listo} disabled={g.estado !== "grabando"}
            className="btn min-h-[56px] px-5 text-base bg-brand-ink text-white hover:bg-brand-graphite">
            <Square size={18} fill="currentColor" aria-hidden /> Terminé
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {(fase.f === "nada" || fase.f === "error" || fase.f === "listo" || fase.f === "sin_texto") && (
        <button type="button" onClick={empezar}
          className={cx("btn w-full min-h-[56px] px-5 text-base",
            principal && fase.f === "nada" ? "bg-brand-primary text-white hover:bg-brand-primary-dark shadow-soft"
              : "bg-white text-brand-ink border border-brand-border hover:border-brand-primary hover:text-brand-primary")}>
          <Mic size={20} aria-hidden strokeWidth={2.4} /> {fase.f === "nada" ? etiqueta : "Grabar de nuevo"}
        </button>
      )}
      {fase.f === "nada" && ayuda && !g.error && <p className="text-xs text-brand-slate text-center">{ayuda}</p>}
      {g.error && <Linea tono="error" icono={TriangleAlert}>{g.error}</Linea>}
      {fase.f === "subiendo" && <Linea tono="info" icono={LoaderCircle} gira>Subiendo el audio…</Linea>}
      {fase.f === "transcribiendo" && (
        <Linea tono="info" icono={LoaderCircle} gira>
          <span className="shimmer-text font-semibold">Transcribiendo…</span> El audio ya quedó guardado: podés seguir, el texto llega solo.
        </Linea>
      )}
      {fase.f === "listo" && <Linea tono="ok" icono={CircleCheck}>Listo: revisá el texto y corregí lo que haga falta.</Linea>}
      {fase.f === "sin_texto" && <Linea tono="aviso" icono={TriangleAlert}>{fase.motivo}</Linea>}
      {fase.f === "local" && (
        <Linea tono="aviso" icono={CloudOff}>Sin señal: el audio quedó guardado en este celular y se sube solo cuando vuelva la conexión.</Linea>
      )}
      {fase.f === "error" && <Linea tono="error" icono={TriangleAlert}>{fase.msg}</Linea>}
    </div>
  );
}

function Linea({ tono, icono: I, gira, children }: { tono: "ok" | "info" | "aviso" | "error"; icono: typeof Mic; gira?: boolean; children: React.ReactNode }) {
  const c = {
    ok: "text-emerald-800 bg-emerald-50 border-emerald-200", info: "text-[#1D5BA6] bg-[#2A78D6]/10 border-[#2A78D6]/30",
    aviso: "text-[#8A5200] bg-brand-orange/10 border-brand-orange/40", error: "text-brand-primary-dark bg-brand-primary-light border-brand-primary/30",
  }[tono];
  return (
    <p className={cx("text-[13px] leading-snug rounded-lg border px-3 py-2.5 flex items-start gap-2", c)} role={tono === "error" ? "alert" : "status"}>
      <I size={16} className={cx("shrink-0 mt-0.5", gira && "animate-spin")} aria-hidden /> <span className="min-w-0">{children}</span>
    </p>
  );
}

// ------------------------------------------------------------------ escuchar
/** Reproduce un audio guardado (se baja con la sesión al tocar «Escuchar»: no se cargan audios que nadie oye). */
export function Escuchar({ url, duracion, compacto }: { url: string; duracion?: number; compacto?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sonando, setSonando] = useState(false);
  const el = useRef<HTMLAudioElement>(null);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  const tocar = async () => {
    if (src) {
      if (el.current?.paused) el.current.play().catch(() => undefined); else el.current?.pause();
      return;
    }
    setCargando(true);
    setError(null);
    try {
      const token = getToken();
      const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(typeof b.detail === "string" ? b.detail : `No se pudo cargar el audio (error ${r.status})`);
      }
      setSrc(URL.createObjectURL(await r.blob()));
    } catch (e: any) { setError(e.message); } finally { setCargando(false); }
  };
  useEffect(() => { if (src) el.current?.play().catch(() => undefined); }, [src]);
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <button type="button" onClick={tocar} disabled={cargando}
        className={cx("inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-white font-semibold text-brand-ink hover:border-brand-ink",
          compacto ? "min-h-[36px] px-3 text-xs" : "min-h-[44px] px-4 text-sm")}>
        {cargando ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : sonando ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
        {sonando ? "Pausa" : "Escuchar"}{duracion ? <span className="text-brand-slate font-normal tabular-nums">· {mmss(duracion)}</span> : null}
      </button>
      {src && <audio ref={el} src={src} onPlay={() => setSonando(true)} onPause={() => setSonando(false)} onEnded={() => setSonando(false)} className="hidden" />}
      {error && <span className="text-xs text-brand-primary-dark">{error}</span>}
    </span>
  );
}
