"use client";

/**
 * El chat del entrenamiento (lo usan el postulante y el mentor cuando prueba un caso): estilo mensajería, el cliente
 * «escribe» y manda sus mensajes de a uno con pausas naturales (a veces dos seguidos), y el reloj del caso corre arriba.
 * Si la respuesta falla, el texto vuelve a la caja para reintentar.
 */
import { ArrowLeft, Flag, LoaderCircle, SendHorizontal, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/portal/ui";
import type { MensajeChat } from "./tipos";

const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** Lo que tarda en «escribir» un mensaje según su largo (entre 0,7 y 2,6 s). */
const tipeo = (t: string) => Math.min(2600, Math.max(700, 450 + t.length * 28));

function Reloj({ desde, parado }: { desde: string; parado?: boolean }) {
  const [, setT] = useState(0);
  useEffect(() => { if (parado) return; const x = setInterval(() => setT((n) => n + 1), 1000); return () => clearInterval(x); }, [parado]);
  const s = Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 1000));
  return <span className="tabular-nums">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}

export function Chat({ cliente, titulo, mensajes: iniciales, iniciado, terminado: terminadoInicial, enviar, onTerminar, onVolver, pie, aviso }: {
  cliente: string; titulo?: string; mensajes: MensajeChat[]; iniciado: string; terminado: boolean;
  enviar: (texto: string) => Promise<{ nuevos: string[]; fin: boolean }>;
  onTerminar?: () => Promise<void>; onVolver?: () => void; pie?: (terminado: boolean) => ReactNode; aviso?: ReactNode;
}) {
  const [msgs, setMsgs] = useState<MensajeChat[]>(iniciales);
  const [texto, setTexto] = useState("");
  const [escribiendo, setEscribiendo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [terminado, setTerminado] = useState(terminadoInicial);
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abajo = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLTextAreaElement>(null);
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);
  useEffect(() => { abajo.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, escribiendo, terminado]);

  const mandar = useCallback(async () => {
    const t = texto.trim();
    if (!t || ocupado || terminado) return;
    setError(null);
    setOcupado(true);
    setTexto("");
    const propio: MensajeChat = { r: "asesor", t, at: new Date().toISOString() };
    setMsgs((m) => [...m, propio]);
    await espera(350);
    setEscribiendo(true);
    try {
      const r = await enviar(t);
      for (const [k, x] of r.nuevos.entries()) {
        if (k > 0) { setEscribiendo(false); await espera(250); setEscribiendo(true); }
        await espera(tipeo(x));
        if (!vivo.current) return;
        setMsgs((m) => [...m, { r: "cliente", t: x, at: new Date().toISOString() }]);
      }
      if (r.fin) setTerminado(true);
    } catch (e: any) {
      setMsgs((m) => m.filter((x) => x !== propio));
      setTexto(t);
      setError(e?.message ?? "No se pudo enviar. Probá de nuevo.");
    } finally {
      setEscribiendo(false);
      setOcupado(false);
      setTimeout(() => caja.current?.focus(), 50);
    }
  }, [texto, ocupado, terminado, enviar]);

  const terminar = async () => {
    if (!onTerminar) return;
    setOcupado(true);
    try { await onTerminar(); setTerminado(true); setConfirmar(false); } catch (e: any) { setError(e?.message ?? "No se pudo terminar."); } finally { setOcupado(false); }
  };

  const tecla = (ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // En la computadora, Enter envía (Shift+Enter, nueva línea). En el celular, Enter es nueva línea y se envía con el botón.
    if (ev.key === "Enter" && !ev.shiftKey && window.matchMedia("(pointer: fine)").matches) { ev.preventDefault(); mandar(); }
  };
  const inicial = cliente.trim().charAt(0).toUpperCase();
  // Pantalla completa sobre todo (fuera del contenido de la página, que tiene su propia capa por las transiciones).
  const [montado, setMontado] = useState(false);
  useEffect(() => {
    setMontado(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  if (!montado) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#EEF0F3]" role="dialog" aria-modal="true" aria-label={`Chat con ${cliente}`}>
      <header className="bg-white border-b border-brand-border px-3 py-2.5 flex items-center gap-3 pt-[calc(10px+env(safe-area-inset-top))]">
        {onVolver && (
          <button type="button" onClick={onVolver} aria-label="Volver" className="w-10 h-10 -ml-1 rounded-full flex items-center justify-center text-brand-slate hover:bg-brand-bg shrink-0">
            <ArrowLeft size={22} aria-hidden />
          </button>
        )}
        <span className="w-10 h-10 rounded-full bg-brand-ink text-white font-bold flex items-center justify-center shrink-0" aria-hidden>{inicial}</span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[15px] text-brand-ink truncate">{cliente}</div>
          <div className="text-[12px] text-brand-slate truncate" aria-live="polite">
            {terminado ? "Conversación terminada" : escribiendo ? <span className="text-emerald-700 font-semibold">escribiendo…</span> : titulo ?? "en línea"}
          </div>
        </div>
        <span className="text-[13px] text-brand-slate shrink-0" title="Tiempo del caso"><Reloj desde={iniciado} parado={terminado} /></span>
        {onTerminar && !terminado && (
          <button type="button" onClick={() => setConfirmar(true)} disabled={ocupado}
            className="min-h-[36px] px-3 rounded-full border border-brand-border text-[13px] font-semibold text-brand-ink inline-flex items-center gap-1 shrink-0">
            <Flag size={14} aria-hidden /> Terminar
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
        <div className="max-w-2xl mx-auto space-y-1.5">
          {aviso}
          {msgs.map((m, k) => {
            const propio = m.r === "asesor";
            const pegado = k > 0 && msgs[k - 1].r === m.r;
            return (
              <div key={k} className={cx("flex", propio ? "justify-end" : "justify-start", !pegado && k > 0 && "pt-2")}>
                <div className={cx("max-w-[82%] px-3.5 py-2 text-[15px] leading-snug whitespace-pre-wrap break-words shadow-sm animate-fade",
                  propio ? "bg-brand-ink text-white rounded-2xl rounded-br-md" : "bg-white text-brand-ink rounded-2xl rounded-bl-md")}>
                  {m.t}
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
          <div ref={abajo} className="h-1" />
        </div>
      </div>

      <div className="bg-white border-t border-brand-border px-3 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))]">
        <div className="max-w-2xl mx-auto">
          {error && (
            <p role="alert" className="mb-2 text-[13px] text-brand-primary-dark flex items-start gap-1.5"><TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />{error}</p>
          )}
          {confirmar ? (
            <div className="space-y-2">
              <p className="text-[14px] font-semibold text-brand-ink">¿Terminás esta conversación? Después no se puede seguir.</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirmar(false)} className="btn min-h-[48px] bg-white border border-brand-border text-brand-ink">Seguir</button>
                <button type="button" onClick={terminar} disabled={ocupado} className="btn min-h-[48px] bg-brand-ink text-white">
                  {ocupado ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : "Sí, terminar"}
                </button>
              </div>
            </div>
          ) : terminado ? (
            pie?.(true) ?? null
          ) : (
            <div className="flex items-end gap-2">
              <textarea ref={caja} value={texto} onChange={(e) => setTexto(e.target.value.slice(0, 1000))} onKeyDown={tecla} rows={1}
                placeholder="Escribí tu respuesta…" aria-label="Tu mensaje" disabled={ocupado && !escribiendo}
                className="flex-1 resize-none rounded-2xl border border-brand-border bg-brand-bg-soft px-4 py-3 text-[16px] leading-snug max-h-36 focus:outline-none focus:border-brand-ink"
                style={{ height: "auto" }} onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = `${Math.min(144, t.scrollHeight)}px`; }} />
              <button type="button" onClick={mandar} disabled={!texto.trim() || ocupado} aria-label="Enviar"
                className="w-12 h-12 rounded-full bg-brand-primary text-white flex items-center justify-center shrink-0 disabled:opacity-40 active:scale-95 transition">
                {ocupado ? <LoaderCircle size={20} className="animate-spin" aria-hidden /> : <SendHorizontal size={20} aria-hidden />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
