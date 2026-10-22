"use client";

/**
 * El chat del entrenamiento (lo usan el postulante y el mentor cuando prueba un caso), con la fluidez de una app de
 * mensajería:
 * - El asesor puede mandar varios mensajes seguidos sin esperar: quedan en cola y salen juntos cuando hace una pausa
 *   (o deja de escribir), y el cliente contesta a todos. Mientras el cliente escribe se puede seguir escribiendo.
 * - El cliente «lee» (✓✓), «escribe» y manda sus mensajes de a uno con pausas naturales; la demora de la IA se descuenta
 *   del tipeo para que no sume espera.
 * - Si se corta la conexión, los mensajes esperan y se reintentan con la misma marca de lote (el servidor no duplica).
 * - El borrador se guarda en el teléfono y la pantalla se acomoda al teclado del celular.
 */
import { ArrowLeft, Check, CheckCheck, Clock3, Flag, LoaderCircle, RotateCcw, SendHorizontal, TriangleAlert, WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/portal/ui";
import type { MensajeChat } from "./tipos";

const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** Lo que tarda en «escribir» un mensaje según su largo (entre 0,7 y 2,6 s). */
const tipeo = (t: string) => Math.min(2600, Math.max(700, 450 + t.length * 28));
const PAUSA = 1300;          // sin mandar ni teclear durante este tiempo, la cola sale
const TECLEANDO = 2500;      // si está escribiendo otro mensaje, se espera un poco más…
const MAX_ESPERA = 7000;     // …pero nunca más que esto desde el primer mensaje en cola
const REINTENTOS = [1500, 3000, 6000];
const MAX_TEXTO = 1000;

type Estado = "cola" | "enviando" | "visto" | "error";
interface Burbuja extends MensajeChat { k: string; estado?: Estado }

const nuevoId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit", timeZone: "America/Asuncion" });
const reintentable = (e: any) => e?.status === undefined || [502, 503, 504].includes(e.status);

function guardado(clave: string): string {
  try { return window.localStorage.getItem(clave) ?? ""; } catch { return ""; }
}
function guardar(clave: string, v: string) {
  try { if (v) window.localStorage.setItem(clave, v); else window.localStorage.removeItem(clave); } catch { /* sin almacenamiento */ }
}

function Reloj({ desde, parado }: { desde: string; parado?: boolean }) {
  const [, setT] = useState(0);
  useEffect(() => { if (parado) return; const x = setInterval(() => setT((n) => n + 1), 1000); return () => clearInterval(x); }, [parado]);
  const s = Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 1000));
  const dos = (n: number) => String(n).padStart(2, "0");
  return <span className="tabular-nums">{s >= 3600 ? `${Math.floor(s / 3600)}:${dos(Math.floor((s % 3600) / 60))}:${dos(s % 60)}` : `${Math.floor(s / 60)}:${dos(s % 60)}`}</span>;
}

function Tilde({ estado }: { estado?: Estado }) {
  if (estado === "cola") return <Clock3 size={12} className="opacity-70" aria-label="en cola" />;
  if (estado === "enviando") return <Check size={13} className="opacity-70" aria-label="enviado" />;
  if (estado === "error") return <TriangleAlert size={13} className="text-red-300" aria-label="no se envió" />;
  return <CheckCheck size={13} className="text-sky-300" aria-label="visto" />;
}

export function Chat({ id, cliente, titulo, pasos, mensajes: iniciales, iniciado, terminado: terminadoInicial, enviar, onTerminar, onVolver, pie, aviso, cierre }: {
  /** La conversación (para guardar el borrador). */
  id: string;
  cliente: string; titulo?: string; mensajes: MensajeChat[]; iniciado: string; terminado: boolean;
  /** Los casos del entrenamiento (hechos, el actual y los que esperan): se ven arriba, como una cola de clientes. */
  pasos?: ("hecho" | "actual" | "pendiente")[];
  /** Lo que aparece en la charla cuando termina (por ejemplo, la devolución). */
  cierre?: ReactNode;
  /** Manda uno o varios mensajes seguidos con su marca de lote; devuelve lo que contestó el cliente. */
  enviar: (textos: string[], lote: string) => Promise<{ nuevos: string[]; fin: boolean }>;
  onTerminar?: () => Promise<void>; onVolver?: () => void; pie?: (terminado: boolean) => ReactNode; aviso?: ReactNode;
}) {
  const claveBorrador = `cap-chat-borrador:${id}`;
  const [msgs, setMsgs] = useState<Burbuja[]>(() => iniciales.map((m, i) => ({ ...m, k: `s${i}`, estado: m.r === "asesor" ? "visto" : undefined })));
  const [texto, setTexto] = useState("");
  const [escribiendo, setEscribiendo] = useState(false);
  const [terminado, setTerminado] = useState(terminadoInicial);
  const [cerrando, setCerrando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallido, setFallido] = useState(false);
  const [enLinea, setEnLinea] = useState(true);
  const abajo = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLTextAreaElement>(null);
  const vivo = useRef(true);
  // `lote`/`fijos`: si un envío falló, sus mensajes (los primeros `fijos`) se reintentan solos y con la misma marca.
  const cola = useRef<{ items: Burbuja[]; desde: number; lote: string | null; fijos: number }>({ items: [], desde: 0, lote: null, fijos: 0 });
  const ocupado = useRef(false);
  const fallidoRef = useRef(false);
  const ultimaTecla = useRef(0);
  const ultimoEnvio = useRef(0);
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminadoRef = useRef(terminadoInicial);
  useEffect(() => { terminadoRef.current = terminado; }, [terminado]);
  useEffect(() => () => { vivo.current = false; if (reloj.current) clearTimeout(reloj.current); }, []);
  useEffect(() => { setTexto(guardado(claveBorrador)); }, [claveBorrador]);
  useEffect(() => { abajo.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, escribiendo, terminado]);

  const marcar = (ks: string[], estado: Estado) => setMsgs((m) => m.map((x) => (ks.includes(x.k) ? { ...x, estado } : x)));

  // ---------------------------------------------------------------- la cola: sale junta cuando el asesor hace una pausa
  const despachar = useCallback(async () => {
    const c = cola.current;
    if (!c.items.length) return;
    // Un reintento manda solo lo que falló y con la misma marca (el servidor no duplica); lo nuevo sale después.
    const items = c.lote ? c.items.slice(0, c.fijos) : c.items;
    const resto = c.lote ? c.items.slice(c.fijos) : [];
    const lote = c.lote ?? nuevoId();
    cola.current = { items: resto, desde: resto.length ? Date.now() : 0, lote: null, fijos: 0 };
    ocupado.current = true;
    setError(null); setFallido(false); fallidoRef.current = false;
    const ks = items.map((x) => x.k);
    marcar(ks, "enviando");
    const t0 = Date.now();
    // Mientras la IA piensa, el cliente ya «leyó» y está escribiendo, como en cualquier chat.
    const leer = setTimeout(() => { if (vivo.current) { marcar(ks, "visto"); setEscribiendo(true); } }, 600);
    try {
      let r: { nuevos: string[]; fin: boolean } | null = null;
      for (let intento = 0; ; intento++) {
        try { r = await enviar(items.map((x) => x.t), lote); break; } catch (e: any) {
          if (!reintentable(e) || intento >= REINTENTOS.length || !vivo.current) throw e;
          await espera(REINTENTOS[intento]);
        }
      }
      clearTimeout(leer);
      if (!vivo.current || !r) return;
      marcar(ks, "visto");
      // Lo que tardó la IA se descuenta del tipeo del primer mensaje: no suma espera.
      for (const [k, x] of r.nuevos.entries()) {
        setEscribiendo(true);
        await espera(k === 0 ? Math.max(300, tipeo(x) - (Date.now() - t0)) : tipeo(x));
        if (!vivo.current) return;
        // Va antes de lo que el asesor escribió mientras tanto (así quedó guardado en el servidor).
        setMsgs((m) => {
          const nuevo: Burbuja = { r: "cliente", t: x, at: new Date().toISOString(), k: nuevoId() };
          const i = m.findIndex((y) => y.estado === "cola");
          return i < 0 ? [...m, nuevo] : [...m.slice(0, i), nuevo, ...m.slice(i)];
        });
        setEscribiendo(false);
        if (k < r.nuevos.length - 1) await espera(250);
      }
      if (r.fin) {
        // El cliente se fue: lo que quedó en cola ya no se puede mandar.
        const pendientes = cola.current.items.map((x) => x.k);
        cola.current = { items: [], desde: 0, lote: null, fijos: 0 };
        setMsgs((m) => m.filter((x) => !pendientes.includes(x.k)));
        setTerminado(true);
      }
    } catch (e: any) {
      clearTimeout(leer);
      if (!vivo.current) return;
      if (e?.status === 409 && /terminó/i.test(e?.message ?? "")) { setTerminado(true); return; }
      // Vuelven al principio de la cola con la misma marca de lote, para reintentar sin duplicar.
      cola.current = { items: [...items, ...cola.current.items], desde: Date.now(), lote, fijos: items.length };
      marcar(ks, "error");
      setFallido(true); fallidoRef.current = true;
      setError(reintentable(e) ? "No se pudo enviar: revisá la conexión." : e?.message ?? "No se pudo enviar.");
    } finally {
      setEscribiendo(false);
      ocupado.current = false;
      if (vivo.current) programar(0);
    }
  }, [enviar]); // eslint-disable-line react-hooks/exhaustive-deps

  const intentar = useCallback(() => {
    reloj.current = null;
    const c = cola.current;
    if (ocupado.current || !c.items.length || terminadoRef.current || fallidoRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return programar(1000);
    const ahora = Date.now();
    const quieto = ahora - Math.max(ultimoEnvio.current, ultimaTecla.current);
    const tecleando = (caja.current?.value.trim().length ?? 0) > 0 && ahora - ultimaTecla.current < TECLEANDO;
    if ((quieto < PAUSA || tecleando) && ahora - c.desde < MAX_ESPERA) return programar(250);
    despachar();
  }, [despachar]); // eslint-disable-line react-hooks/exhaustive-deps
  function programar(ms: number) {
    if (reloj.current) clearTimeout(reloj.current);
    reloj.current = setTimeout(() => intentarRef.current(), ms);
  }
  const intentarRef = useRef(intentar);
  useEffect(() => { intentarRef.current = intentar; }, [intentar]);

  const mandar = () => {
    const t = texto.trim().slice(0, MAX_TEXTO);
    if (!t || terminado) return;
    const b: Burbuja = { r: "asesor", t, at: new Date().toISOString(), k: nuevoId(), estado: "cola" };
    setMsgs((m) => [...m, b]);
    if (!cola.current.items.length) cola.current.desde = Date.now();
    cola.current.items.push(b);
    ultimoEnvio.current = Date.now();
    setTexto(""); guardar(claveBorrador, "");
    if (caja.current) caja.current.style.height = "auto";
    caja.current?.focus();
    if (!fallidoRef.current) programar(PAUSA);
  };
  const reintentar = () => { if (!ocupado.current) despachar(); };
  const reintentarRef = useRef(reintentar);
  reintentarRef.current = reintentar;

  // Sin conexión: avisa y espera; al volver, sale lo que estaba en cola.
  useEffect(() => {
    const on = () => { setEnLinea(true); if (fallidoRef.current) reintentarRef.current(); else programar(300); };
    const off = () => setEnLinea(false);
    setEnLinea(navigator.onLine !== false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Si cierra la pestaña con mensajes sin mandar, se le avisa.
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => { if (cola.current.items.length || ocupado.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, []);

  const terminar = async () => {
    if (!onTerminar) return;
    setCerrando(true);
    try { await onTerminar(); setTerminado(true); setConfirmar(false); } catch (e: any) { setError(e?.message ?? "No se pudo terminar."); } finally { setCerrando(false); }
  };

  const tecla = (ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // En la computadora, Enter envía (Shift+Enter, nueva línea). En el celular, Enter es nueva línea y se envía con el botón.
    if (ev.key === "Enter" && !ev.shiftKey && window.matchMedia("(pointer: fine)").matches) { ev.preventDefault(); mandar(); }
  };
  const cambiar = (v: string) => {
    const t = v.slice(0, MAX_TEXTO);
    setTexto(t); guardar(claveBorrador, t);
    ultimaTecla.current = Date.now();
  };
  const inicial = cliente.trim().charAt(0).toUpperCase();
  const pendientes = msgs.some((x) => x.estado === "cola" || x.estado === "enviando");

  // Pantalla completa sobre todo y del alto visible (con el teclado del celular abierto, el chat se acomoda arriba).
  const [montado, setMontado] = useState(false);
  const [vista, setVista] = useState<{ h: number; top: number } | null>(null);
  useEffect(() => {
    setMontado(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const v = window.visualViewport;
    const f = () => { if (v) setVista({ h: v.height, top: v.offsetTop }); };
    f();
    v?.addEventListener("resize", f); v?.addEventListener("scroll", f);
    return () => { document.body.style.overflow = prev; v?.removeEventListener("resize", f); v?.removeEventListener("scroll", f); };
  }, []);
  useEffect(() => { abajo.current?.scrollIntoView({ block: "end" }); }, [vista?.h]);
  if (!montado) return null;

  return createPortal(
    <div className="fixed inset-x-0 top-0 h-[100dvh] z-[70] flex flex-col bg-[#EEF0F3]" role="dialog" aria-modal="true" aria-label={`Chat con ${cliente}`}
      style={vista ? { height: vista.h, transform: `translateY(${vista.top}px)` } : undefined}>
      <header className="bg-white border-b border-brand-border px-3 py-2.5 flex items-center gap-3 pt-[calc(10px+env(safe-area-inset-top))]">
        {onVolver && (
          <button type="button" onClick={onVolver} aria-label="Volver" className="w-10 h-10 -ml-1 rounded-full flex items-center justify-center text-brand-slate hover:bg-brand-bg shrink-0">
            <ArrowLeft size={22} aria-hidden />
          </button>
        )}
        <span className="relative w-10 h-10 rounded-full bg-brand-ink text-white font-bold flex items-center justify-center shrink-0" aria-hidden>
          {inicial}
          {!terminado && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[15px] text-brand-ink truncate">{cliente}</div>
          <div className="text-[12px] text-brand-slate truncate" aria-live="polite">
            {terminado ? "Conversación terminada" : escribiendo ? <span className="text-emerald-700 font-semibold">escribiendo…</span> : titulo ?? "en línea"}
          </div>
        </div>
        <span className="text-[13px] text-brand-slate shrink-0" title="Tiempo del caso"><Reloj desde={iniciado} parado={terminado} /></span>
        {onTerminar && !terminado && (
          <button type="button" onClick={() => setConfirmar(true)} disabled={cerrando}
            className="min-h-[36px] px-3 rounded-full border border-brand-border text-[13px] font-semibold text-brand-ink inline-flex items-center gap-1 shrink-0">
            <Flag size={14} aria-hidden /> Terminar
          </button>
        )}
      </header>
      {pasos && pasos.length > 1 && (() => {
        const actual = pasos.indexOf("actual") + 1;
        const esperan = pasos.filter((p) => p === "pendiente").length;
        return (
          <div className="bg-white border-b border-brand-border px-4 py-2">
            <div className="max-w-2xl mx-auto flex items-center gap-3">
              <span className="text-[12px] font-bold text-brand-ink tabular-nums shrink-0">Caso {actual || pasos.length} de {pasos.length}</span>
              <span className="flex-1 flex gap-1" aria-hidden>
                {pasos.map((p, i) => <span key={i} className={cx("h-1.5 flex-1 rounded-full", p === "hecho" ? "bg-emerald-500" : p === "actual" ? "bg-brand-ink" : "bg-brand-border")} />)}
              </span>
              <span className="text-[12px] text-brand-slate shrink-0">{esperan ? `${esperan} en espera` : "el último"}</span>
            </div>
          </div>
        );
      })()}
      {!enLinea && (
        <div role="status" className="bg-amber-50 border-b border-amber-200 text-amber-900 text-[13px] px-4 py-2 flex items-center gap-2">
          <WifiOff size={15} aria-hidden /> Sin conexión. Tus mensajes salen cuando vuelva.
        </div>
      )}

      <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
        <div className="max-w-2xl mx-auto space-y-1.5">
          {aviso}
          {msgs.map((m, i) => {
            const propio = m.r === "asesor";
            const pegado = i > 0 && msgs[i - 1].r === m.r;
            return (
              <div key={m.k} className={cx("flex", propio ? "justify-end" : "justify-start", !pegado && i > 0 && "pt-2")}>
                <div className={cx("max-w-[82%] pl-3.5 pr-2.5 pt-2 pb-1 text-[15px] leading-snug shadow-sm animate-fade",
                  propio ? "bg-brand-ink text-white rounded-2xl rounded-br-md" : "bg-white text-brand-ink rounded-2xl rounded-bl-md",
                  m.estado === "error" && "ring-2 ring-red-400")}>
                  <span className="whitespace-pre-wrap break-words">{m.t}</span>
                  <span className={cx("float-right ml-2 mt-1.5 inline-flex items-center gap-0.5 text-[10px] leading-none select-none", propio ? "text-white/60" : "text-brand-mist")}>
                    {hora(m.at)}{propio && <Tilde estado={m.estado} />}
                  </span>
                </div>
              </div>
            );
          })}
          {escribiendo && (
            <div className="flex justify-start pt-2" aria-label={`${cliente} está escribiendo`}>
              <div className="bg-white rounded-2xl rounded-bl-md px-4 py-3 shadow-sm flex gap-1">
                {[0, 1, 2].map((i) => <span key={i} className="w-2 h-2 rounded-full bg-brand-mist grabando-punto" style={{ animationDelay: `${i * 0.18}s` }} />)}
              </div>
            </div>
          )}
          {terminado && (
            <div className="pt-4 text-center">
              <span className="inline-block rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-brand-slate shadow-sm">La conversación terminó</span>
            </div>
          )}
          {terminado && cierre}
          <div ref={abajo} className="h-1" />
        </div>
      </div>

      <div className="bg-white border-t border-brand-border px-3 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))]">
        <div className="max-w-2xl mx-auto">
          {error && (
            <div role="alert" className="mb-2 text-[13px] text-brand-primary-dark flex items-center gap-2">
              <TriangleAlert size={15} className="shrink-0" aria-hidden /><span className="flex-1">{error}</span>
              {fallido && (
                <button type="button" onClick={reintentar} className="min-h-[36px] px-3 rounded-full bg-brand-ink text-white text-[13px] font-semibold inline-flex items-center gap-1 shrink-0">
                  <RotateCcw size={14} aria-hidden /> Reintentar
                </button>
              )}
            </div>
          )}
          {confirmar ? (
            <div className="space-y-2">
              <p className="text-[14px] font-semibold text-brand-ink">¿Terminás esta conversación? Después no se puede seguir.</p>
              {pendientes && <p className="text-[13px] text-brand-slate">Hay mensajes que todavía no llegaron al cliente.</p>}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirmar(false)} className="btn min-h-[48px] bg-white border border-brand-border text-brand-ink">Seguir</button>
                <button type="button" onClick={terminar} disabled={cerrando} className="btn min-h-[48px] bg-brand-ink text-white">
                  {cerrando ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : "Sí, terminar"}
                </button>
              </div>
            </div>
          ) : terminado ? (
            pie?.(true) ?? null
          ) : (
            <div className="flex items-end gap-2">
              <textarea ref={caja} value={texto} onChange={(e) => cambiar(e.target.value)} onKeyDown={tecla} rows={1}
                placeholder="Escribí tu respuesta…" aria-label="Tu mensaje" enterKeyHint="send" autoComplete="off" autoCorrect="on" spellCheck
                className="flex-1 resize-none rounded-2xl border border-brand-border bg-brand-bg-soft px-4 py-3 text-[16px] leading-snug max-h-36 focus:outline-none focus:border-brand-ink"
                style={{ height: "auto" }} onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = `${Math.min(144, t.scrollHeight)}px`; }} />
              <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={mandar} disabled={!texto.trim()} aria-label="Enviar"
                className="w-12 h-12 rounded-full bg-brand-primary text-white flex items-center justify-center shrink-0 disabled:opacity-40 active:scale-95 transition">
                <SendHorizontal size={20} aria-hidden />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
