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
 * - En la computadora se ve como una consola: la conversación al centro y, al costado, el entrenamiento, el tiempo del
 *   caso, la cola de clientes y cómo escribir.
 * - Entrenamiento guiado: al empezar y después de cada respuesta del cliente, el entrenador IA manda sus consejos para
 *   el próximo mensaje; salen flotando como burbujas sobre la caja de texto, se van solas (o con un toque) y quedan
 *   para volver a leerlas. Se piden aparte de la charla: no la demoran, y si fallan, la charla sigue.
 */
import { ArrowLeft, Check, CheckCheck, Clock3, Flag, GraduationCap, Keyboard, Lightbulb, LoaderCircle, MessagesSquare, RotateCcw, SendHorizontal, ThumbsUp, TriangleAlert, WifiOff, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/portal/ui";
import type { Consejo, ConsejosTurno, MensajeChat, TipoConsejo } from "./tipos";

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
/** «Hoy» o la fecha, como el separador de un chat. */
const dia = (iso: string) => {
  const zona = { timeZone: "America/Asuncion" } as const;
  const f = (d: Date) => d.toLocaleDateString("es-PY", { ...zona, day: "2-digit", month: "2-digit", year: "numeric" });
  return f(new Date(iso)) === f(new Date()) ? "Hoy" : f(new Date(iso));
};
/** Un color sobrio y fijo por cliente para su avatar. */
const COLORES = ["#334155", "#2A78D6", "#0E7490", "#7C3AED", "#B45309", "#BE185D", "#15803D"];
const colorDe = (nombre: string) => COLORES[[...nombre].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORES.length];
/** El fondo de la conversación: gris claro con una trama de puntos muy suave. */
const FONDO = { backgroundColor: "#EEF1F5", backgroundImage: "radial-gradient(rgba(15,17,22,0.055) 1px, transparent 1px)", backgroundSize: "16px 16px" };

/** Un caso del entrenamiento en la cola de clientes. */
export interface PasoChat { estado: "hecho" | "actual" | "pendiente"; cliente?: string }

/** El entrenador IA del entrenamiento guiado. */
export interface Entrenador {
  /** Los consejos para el próximo mensaje (uno por turno: si ya se dieron, devuelve los mismos sin costo). */
  pedir: () => Promise<{ turno: number; consejos: Consejo[] }>;
  /** Los que ya salieron (al volver a entrar a la conversación). */
  previos?: ConsejosTurno[];
}
export const TIPO_CONSEJO: Record<TipoConsejo, { nombre: string; color: string; icono: LucideIcon }> = {
  sugerencia: { nombre: "Sugerencia", color: "#2A78D6", icono: Lightbulb },
  bien: { nombre: "¡Bien!", color: "#15803D", icono: ThumbsUp },
  alerta: { nombre: "Ojo", color: "#E6332A", icono: TriangleAlert },
};
/** Cuánto queda a la vista una burbuja según su largo (entre 7 y 14 s). */
const ALAVISTA = (t: string) => Math.min(14000, Math.max(7000, 4000 + t.length * 60));
/** Cuándo salió un consejo; `de`: «tu» para el postulante, «su» para el equipo. */
export const cuandoConsejo = (turno: number, de: "tu" | "su" = "tu") => (turno === 0 ? "Para empezar" : `Después de ${de} ${turno}.ª respuesta`);

/** Un consejo en una línea (la lista para volver a leer y el visor del equipo). */
export function ConsejoItem({ c }: { c: Consejo }) {
  const x = TIPO_CONSEJO[c.tipo] ?? TIPO_CONSEJO.sugerencia;
  return (
    <li className="flex gap-2.5 text-[14px] leading-snug text-brand-ink">
      <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-white mt-px" style={{ background: x.color }}><x.icono size={13} aria-hidden /></span>
      <span><span className="sr-only">{x.nombre}: </span>{c.texto}</span>
    </li>
  );
}

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

export function Chat({ id, cliente, titulo, entrenamiento, pasos, mensajes: iniciales, iniciado, terminado: terminadoInicial, enviar, onTerminar, onVolver, pie, aviso, cierre, entrenador }: {
  /** La conversación (para guardar el borrador). */
  id: string;
  cliente: string; titulo?: string; mensajes: MensajeChat[]; iniciado: string; terminado: boolean;
  /** El nombre del entrenamiento (en la computadora se ve en el panel del costado). */
  entrenamiento?: string;
  /** Los casos del entrenamiento (hechos, el actual y los que esperan): arriba en el celular y al costado en la
   * computadora, como una cola de clientes. */
  pasos?: PasoChat[];
  /** Lo que aparece en la charla cuando termina (por ejemplo, la devolución). */
  cierre?: ReactNode;
  /** Manda uno o varios mensajes seguidos con su marca de lote; devuelve lo que contestó el cliente. */
  enviar: (textos: string[], lote: string) => Promise<{ nuevos: string[]; fin: boolean }>;
  onTerminar?: () => Promise<void>; onVolver?: () => void; pie?: (terminado: boolean) => ReactNode; aviso?: ReactNode;
  /** Entrenamiento guiado: el entrenador IA y sus consejos en burbujas. */
  entrenador?: Entrenador;
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

  // ---------------------------------------------------------------- el entrenador (guiado)
  const [consejos, setConsejos] = useState<ConsejosTurno[]>(entrenador?.previos ?? []);
  const [flotan, setFlotan] = useState<{ k: string; c: Consejo; dura: number; sale?: boolean }[]>([]);
  const [pensando, setPensando] = useState(false);
  const [verConsejos, setVerConsejos] = useState(false);
  const entrenadorRef = useRef(entrenador);
  entrenadorRef.current = entrenador;
  const pidiendo = useRef(false);
  const soltar = (k: string) => {
    setFlotan((xs) => xs.map((x) => (x.k === k ? { ...x, sale: true } : x)));
    setTimeout(() => { if (vivo.current) setFlotan((xs) => xs.filter((x) => x.k !== k)); }, 420);
  };
  const soltarRef = useRef(soltar);
  soltarRef.current = soltar;
  const pedirConsejo = useCallback(async () => {
    const e = entrenadorRef.current;
    if (!e || pidiendo.current || terminadoRef.current) return;
    pidiendo.current = true; setPensando(true);
    try {
      const r = await e.pedir();
      if (!vivo.current || terminadoRef.current || !r.consejos.length) return;
      setConsejos((h) => (h.some((x) => x.turno === r.turno) ? h : [...h, { turno: r.turno, items: r.consejos }]));
      // Salen de a una, flotando; como mucho dos a la vista (la más vieja se va).
      r.consejos.forEach((c, i) => setTimeout(() => {
        if (!vivo.current || terminadoRef.current) return;
        const k = nuevoId(); const dura = ALAVISTA(c.texto);
        setFlotan((xs) => { const quedan = xs.filter((x) => !x.sale); if (quedan.length >= 2) setTimeout(() => soltarRef.current(quedan[0].k), 0); return [...xs, { k, c, dura }]; });
        setTimeout(() => soltarRef.current(k), dura);
      }, 250 + i * 650));
    } catch { /* el entrenador es una ayuda: si no responde, la charla sigue igual */ }
    finally { pidiendo.current = false; if (vivo.current) setPensando(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (terminado) setFlotan([]); }, [terminado]);
  // Mientras hay burbujas a la vista, la charla deja lugar abajo para que no tapen el último mensaje.
  const capa = useRef<HTMLDivElement>(null);
  const [altoCapa, setAltoCapa] = useState(0);
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
      if (!r.fin) pedirConsejo();
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
    flotan.forEach((x) => { if (!x.sale) soltar(x.k); });
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
  const actual = pasos ? pasos.findIndex((p) => p.estado === "actual") + 1 : 0;
  const esperan = pasos?.filter((p) => p.estado === "pendiente").length ?? 0;
  const color = colorDe(cliente);
  const totalConsejos = consejos.reduce((n, x) => n + x.items.length, 0);
  const ultimoConsejo = consejos.length ? consejos.reduce((a, b) => (b.turno > a.turno ? b : a)) : null;

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
  // En la computadora, el cursor ya queda en la caja para escribir.
  useEffect(() => { if (montado && !terminadoRef.current && window.matchMedia("(pointer: fine)").matches) caja.current?.focus(); }, [montado]);
  // Guiado: al entrar, el consejo para este momento de la charla (si ya se dio, vuelve el mismo).
  useEffect(() => { if (montado) pedirConsejo(); }, [montado, pedirConsejo]);
  useEffect(() => {
    const el = capa.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setAltoCapa(el.offsetHeight > 20 ? el.offsetHeight : 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [montado, terminado]);
  useEffect(() => { if (altoCapa) abajo.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [altoCapa]);
  if (!montado) return null;

  const botonTerminar = (clase: string) => onTerminar && !terminado && (
    <button type="button" onClick={() => setConfirmar(true)} disabled={cerrando || confirmar} className={clase}>
      <Flag size={14} aria-hidden /> Terminar
    </button>
  );

  return createPortal(
    <div className="fixed inset-x-0 top-0 h-[100dvh] z-[70] flex bg-[#DCE0E6] lg:p-6" role="dialog" aria-modal="true" aria-label={`Chat con ${cliente}`}
      style={vista ? { height: vista.h, transform: `translateY(${vista.top}px)` } : undefined}>
      <div className="flex-1 min-h-0 w-full flex bg-white lg:max-w-[1240px] lg:mx-auto lg:rounded-2xl lg:overflow-hidden lg:border lg:border-black/5 lg:shadow-[0_28px_70px_-28px_rgba(15,17,22,0.5)]">
        {/* En la computadora: el entrenamiento, el tiempo y la cola de clientes, al costado (como la consola de un asesor). */}
        <aside className="hidden lg:flex w-[300px] xl:w-[320px] shrink-0 flex-col border-r border-brand-border bg-white">
          <div className="px-5 pt-5 pb-4 border-b border-brand-border">
            {onVolver && (
              <button type="button" onClick={onVolver} className="inline-flex items-center gap-1.5 text-[13px] text-brand-slate hover:text-brand-ink mb-3">
                <ArrowLeft size={16} aria-hidden /> Volver
              </button>
            )}
            <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">{entrenador ? "Entrenamiento guiado" : entrenamiento ? "Entrenamiento" : "Conversación de práctica"}</div>
            <div className="font-display text-[22px] uppercase leading-tight text-brand-ink break-words">{entrenamiento ?? titulo ?? cliente}</div>
            {entrenador && <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#2A78D6]/10 text-[#1D5BA6] text-[11px] font-semibold px-2 py-0.5"><GraduationCap size={12} aria-hidden /> Práctica · no suma a la evaluación</span>}
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            <div className="rounded-xl bg-brand-bg px-4 py-3">
              <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">Tiempo del caso</div>
              <div className="font-display text-[40px] leading-none text-brand-ink mt-1"><Reloj desde={iniciado} parado={terminado} /></div>
              {pasos && pasos.length > 1 && (
                <div className="text-[12px] text-brand-slate mt-1.5">Caso {actual || pasos.length} de {pasos.length} · {esperan ? `${esperan} en espera` : "el último"}</div>
              )}
            </div>
            {entrenador && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate inline-flex items-center gap-1"><GraduationCap size={13} aria-hidden /> Tu entrenador</span>
                  {totalConsejos > 0 && <button type="button" onClick={() => setVerConsejos(true)} className="text-[12px] font-semibold text-brand-primary hover:underline">Ver todos ({totalConsejos})</button>}
                </div>
                {ultimoConsejo ? (
                  <div className="rounded-xl border border-brand-border px-3 py-2.5">
                    <div className="text-[11px] text-brand-slate mb-1.5">{cuandoConsejo(ultimoConsejo.turno)}</div>
                    <ul className="space-y-2">{ultimoConsejo.items.map((c, i) => <ConsejoItem key={i} c={c} />)}</ul>
                  </div>
                ) : <p className="text-[13px] text-brand-slate leading-snug">{pensando ? "Está mirando la charla…" : "Te va a ir dando consejos para cada mensaje, en burbujas sobre la caja de texto."}</p>}
              </div>
            )}
            {pasos && pasos.length > 1 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate mb-1.5">Tus clientes</div>
                <ol className="space-y-0.5">
                  {pasos.map((p, i) => (
                    <li key={i} className={cx("flex items-center gap-3 rounded-lg px-2.5 py-2", p.estado === "actual" && "bg-brand-bg")} aria-current={p.estado === "actual" ? "step" : undefined}>
                      <span className={cx("w-7 h-7 rounded-full text-[12px] font-bold flex items-center justify-center shrink-0",
                        p.estado === "hecho" ? "bg-emerald-50 text-emerald-700" : p.estado === "actual" ? "bg-brand-ink text-white" : "bg-white border border-brand-border text-brand-slate")}>
                        {p.estado === "hecho" ? <Check size={14} aria-hidden /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold text-brand-ink truncate">{p.cliente ?? `Cliente ${i + 1}`}</span>
                        <span className={cx("block text-[11px]", p.estado === "actual" && !terminado ? "text-emerald-700 font-semibold" : "text-brand-slate")}>
                          {p.estado === "hecho" ? "Atendido" : p.estado === "actual" ? (terminado ? "Terminado" : "En atención") : "En espera"}
                        </span>
                      </span>
                      {p.estado === "actual" && !terminado && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden />}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div>
              <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate mb-2">Cómo escribir</div>
              <ul className="space-y-2.5 text-[13px] text-brand-slate leading-snug">
                <li className="flex gap-2.5"><Keyboard size={16} className="mt-0.5 shrink-0 text-brand-ink" aria-hidden />
                  <span><b className="text-brand-ink font-semibold">Enter</b> envía; <b className="text-brand-ink font-semibold">Shift + Enter</b>, nueva línea.</span></li>
                <li className="flex gap-2.5"><MessagesSquare size={16} className="mt-0.5 shrink-0 text-brand-ink" aria-hidden />
                  <span>Podés mandar varios mensajes seguidos: el cliente contesta cuando hacés una pausa.</span></li>
                <li className="flex gap-2.5"><CheckCheck size={16} className="mt-0.5 shrink-0 text-sky-500" aria-hidden />
                  <span>Dos tildes azules: el cliente ya lo leyó.</span></li>
              </ul>
            </div>
          </div>
          {onTerminar && !terminado && (
            <div className="px-5 py-4 border-t border-brand-border">
              {botonTerminar("btn w-full min-h-[44px] bg-white border border-brand-border text-[14px] font-semibold text-brand-ink hover:border-brand-ink gap-1.5")}
            </div>
          )}
        </aside>

        <section className="flex-1 min-w-0 flex flex-col">
          <header className="bg-white border-b border-brand-border px-3 lg:px-5 py-2.5 flex items-center gap-3 pt-[calc(10px+env(safe-area-inset-top))] lg:pt-2.5">
            {onVolver && (
              <button type="button" onClick={onVolver} aria-label="Volver" className="lg:hidden w-10 h-10 -ml-1 rounded-full flex items-center justify-center text-brand-slate hover:bg-brand-bg shrink-0">
                <ArrowLeft size={22} aria-hidden />
              </button>
            )}
            <span className="relative w-10 h-10 rounded-full text-white font-bold flex items-center justify-center shrink-0" style={{ background: color }} aria-hidden>
              {inicial}
              {!terminado && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-[15px] text-brand-ink truncate">{cliente}</div>
              <div className="text-[12px] text-brand-slate truncate" aria-live="polite">
                {terminado ? "Conversación terminada" : escribiendo ? <span className="text-emerald-700 font-semibold">escribiendo…</span> : <span className="lg:hidden">{titulo ?? "en línea"}</span>}
                {!terminado && !escribiendo && <span className="hidden lg:inline">en línea</span>}
              </div>
            </div>
            {!(pasos && pasos.length > 1) && <span className="lg:hidden text-[13px] text-brand-slate shrink-0" title="Tiempo del caso"><Reloj desde={iniciado} parado={terminado} /></span>}
            {entrenador && (
              <button type="button" onClick={() => setVerConsejos(true)} aria-label={`Consejos del entrenador (${totalConsejos})`}
                className="lg:hidden relative w-10 h-10 rounded-full border border-brand-border text-[#1D5BA6] flex items-center justify-center shrink-0">
                <GraduationCap size={19} aria-hidden />
                {totalConsejos > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#2A78D6] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">{totalConsejos}</span>}
              </button>
            )}
            {botonTerminar("lg:hidden min-h-[36px] px-3 rounded-full border border-brand-border text-[13px] font-semibold text-brand-ink inline-flex items-center gap-1 shrink-0")}
          </header>
          {pasos && pasos.length > 1 && (
            <div className="lg:hidden bg-white border-b border-brand-border px-4 py-2">
              <div className="max-w-2xl mx-auto flex items-center gap-3">
                <span className="text-[12px] font-bold text-brand-ink tabular-nums shrink-0">Caso {actual || pasos.length} de {pasos.length}</span>
                <span className="flex-1 flex gap-1" aria-hidden>
                  {pasos.map((p, i) => <span key={i} className={cx("h-1.5 flex-1 rounded-full", p.estado === "hecho" ? "bg-emerald-500" : p.estado === "actual" ? "bg-brand-ink" : "bg-brand-border")} />)}
                </span>
                <span className="text-[12px] text-brand-slate shrink-0 inline-flex items-center gap-1" title={`Tiempo del caso${esperan ? ` · ${esperan} en espera` : ""}`}>
                  <Clock3 size={13} aria-hidden /><Reloj desde={iniciado} parado={terminado} /></span>
              </div>
            </div>
          )}
          {!enLinea && (
            <div role="status" className="bg-amber-50 border-b border-amber-200 text-amber-900 text-[13px] px-4 py-2 flex items-center gap-2">
              <WifiOff size={15} aria-hidden /> Sin conexión. Tus mensajes salen cuando vuelva.
            </div>
          )}

          <div className="flex-1 overflow-y-auto overscroll-contain px-3 lg:px-8 py-4" style={FONDO}>
            <div className="max-w-2xl lg:max-w-3xl mx-auto">
              <div className="flex justify-center mb-3">
                <span className="rounded-md bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-brand-slate shadow-sm">{dia(iniciado)}</span>
              </div>
              {aviso}
              {msgs.map((m, i) => {
                const propio = m.r === "asesor";
                const primero = i === 0 || msgs[i - 1].r !== m.r;
                return (
                  <div key={m.k} className={cx("flex", propio ? "justify-end" : "justify-start", primero ? (i > 0 ? "pt-3" : "") : "pt-0.5")}>
                    <div className={cx("max-w-[82%] lg:max-w-[68%] pl-3.5 pr-2.5 pt-2 pb-1 text-[15px] leading-snug rounded-2xl shadow-[0_1px_1.5px_rgba(15,17,22,0.12)] animate-fade",
                      propio ? "bg-brand-ink text-white" : "bg-white text-brand-ink",
                      primero && (propio ? "rounded-tr-[4px]" : "rounded-tl-[4px]"),
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
                <div className={cx("flex justify-start", msgs[msgs.length - 1]?.r === "cliente" ? "pt-0.5" : "pt-3")} aria-label={`${cliente} está escribiendo`}>
                  <div className="bg-white rounded-2xl rounded-tl-[4px] px-4 py-3 shadow-[0_1px_1.5px_rgba(15,17,22,0.12)] flex gap-1">
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
              {/* Al final de la charla; con burbujas del entrenador a la vista, crece para que no tapen el último mensaje. */}
              <div ref={abajo} style={{ height: altoCapa ? altoCapa + 12 : 4 }} />
            </div>
          </div>

          <div className="relative bg-white border-t border-brand-border px-3 lg:px-8 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] lg:pb-3">
            {entrenador && !terminado && (
              // Las burbujas del entrenador: suben flotando sobre la caja de texto y se van solas (o con un toque).
              <div ref={capa} className="absolute inset-x-0 bottom-full px-3 lg:px-8 pb-3 pointer-events-none z-10" aria-live="polite">
                <div className="max-w-2xl lg:max-w-3xl mx-auto flex flex-col items-end gap-2">
                  {pensando && !flotan.length && (
                    <span className="consejo-entra inline-flex items-center gap-2 rounded-full bg-white/95 border border-brand-border shadow-sm px-3 py-1.5 text-[12px] text-brand-slate">
                      <GraduationCap size={14} className="text-[#2A78D6]" aria-hidden /> Tu entrenador está mirando
                      <span className="flex gap-0.5" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className="w-1 h-1 rounded-full bg-brand-mist grabando-punto" style={{ animationDelay: `${i * 0.18}s` }} />)}</span>
                    </span>
                  )}
                  {flotan.map((x) => {
                    const tipo = TIPO_CONSEJO[x.c.tipo] ?? TIPO_CONSEJO.sugerencia;
                    return (
                      <div key={x.k} className={cx("pointer-events-auto w-full max-w-[380px]", x.sale ? "consejo-sale" : "consejo-entra")}>
                        <button type="button" onClick={() => soltar(x.k)} title="Tocá para cerrar"
                          className="consejo-flota relative w-full text-left overflow-hidden rounded-2xl rounded-br-md bg-white border pl-3 pr-3.5 pt-2.5 pb-3 flex gap-2.5 shadow-[0_14px_34px_-14px_rgba(15,17,22,0.5)]"
                          style={{ borderColor: `${tipo.color}40` }}>
                          <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white" style={{ background: tipo.color }}><tipo.icono size={16} aria-hidden /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[10px] uppercase tracking-wider2 font-semibold" style={{ color: tipo.color }}>Entrenador · {tipo.nombre}</span>
                            <span className="block text-[14px] leading-snug text-brand-ink">{x.c.texto}</span>
                          </span>
                          <span className="absolute left-0 bottom-0 h-[3px] consejo-tiempo" style={{ background: tipo.color, animationDuration: `${x.dura}ms` }} aria-hidden />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="max-w-2xl lg:max-w-3xl mx-auto">
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
                  <div className="grid grid-cols-2 gap-2 lg:max-w-md">
                    <button type="button" onClick={() => setConfirmar(false)} className="btn min-h-[48px] bg-white border border-brand-border text-brand-ink">Seguir</button>
                    <button type="button" onClick={terminar} disabled={cerrando} className="btn min-h-[48px] bg-brand-ink text-white">
                      {cerrando ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : "Sí, terminar"}
                    </button>
                  </div>
                </div>
              ) : terminado ? (
                pie?.(true) ?? null
              ) : (
                <>
                  <div className="flex items-end gap-2">
                    <textarea ref={caja} value={texto} onChange={(e) => cambiar(e.target.value)} onKeyDown={tecla} rows={1}
                      placeholder="Escribí tu respuesta…" aria-label="Tu mensaje" enterKeyHint="send" autoComplete="off" autoCorrect="on" spellCheck
                      className="flex-1 resize-none rounded-2xl border border-brand-border bg-brand-bg-soft px-4 py-3 text-[16px] leading-snug max-h-36 focus:outline-none focus:border-brand-ink focus:bg-white"
                      style={{ height: "auto" }} onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = `${Math.min(144, t.scrollHeight)}px`; }} />
                    <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={mandar} disabled={!texto.trim()} aria-label="Enviar"
                      className="w-12 h-12 rounded-full bg-brand-primary text-white flex items-center justify-center shrink-0 disabled:opacity-40 active:scale-95 transition">
                      <SendHorizontal size={20} aria-hidden />
                    </button>
                  </div>
                  <div className="hidden lg:flex items-center justify-between mt-1.5 px-1 text-[11px] text-brand-mist">
                    <span>Enter para enviar · Shift + Enter, nueva línea</span>
                    {texto.length > MAX_TEXTO - 200 && <span className="tabular-nums">{texto.length}/{MAX_TEXTO}</span>}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
      {verConsejos && (
        <div className="absolute inset-0 z-20 bg-[rgba(15,17,22,0.45)] flex items-end lg:items-center justify-center animate-fade" onClick={() => setVerConsejos(false)}>
          <div role="dialog" aria-label="Consejos del entrenador" onClick={(e) => e.stopPropagation()}
            className="hoja-sube w-full lg:max-w-md max-h-[80%] bg-white rounded-t-2xl lg:rounded-2xl flex flex-col shadow-2xl pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-brand-border">
              <span className="w-9 h-9 rounded-full bg-[#2A78D6]/10 text-[#1D5BA6] flex items-center justify-center shrink-0"><GraduationCap size={18} aria-hidden /></span>
              <div className="flex-1 min-w-0"><div className="font-semibold text-[16px] text-brand-ink">Tu entrenador</div>
                <div className="text-[12px] text-brand-slate">Práctica guiada · no suma a tu evaluación</div></div>
              <button type="button" onClick={() => setVerConsejos(false)} aria-label="Cerrar" className="w-10 h-10 rounded-full flex items-center justify-center text-brand-slate hover:bg-brand-bg"><X size={20} aria-hidden /></button>
            </div>
            <div className="overflow-y-auto px-5 py-4 space-y-4">
              {consejos.length === 0 && <p className="text-[14px] text-brand-slate">{pensando ? "Está mirando la charla…" : "Todavía no hay consejos. Van a ir saliendo mientras chateás."}</p>}
              {[...consejos].sort((a, b) => b.turno - a.turno).map((x) => (
                <div key={x.turno}>
                  <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate mb-1.5">{cuandoConsejo(x.turno)}</div>
                  <ul className="space-y-2">{x.items.map((c, i) => <ConsejoItem key={i} c={c} />)}</ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
