"use client";

import {
  AlertTriangle, ArrowUpRight, Check, CheckCircle2, Copy, Info, Loader2, RotateCcw, ShieldCheck, XCircle, Zap,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AccionVoi, ItemVoi } from "@/lib/voi";
import { VoiIsotipo } from "./VoiIsotipo";

/** Markdown de Voi: enlaces internos navegan dentro de la app (el panel sigue abierto); los externos, en otra pestaña. */
export function VoiMarkdown({ texto, onNavegar }: { texto: string; onNavegar?: () => void }) {
  return (
    <div className="text-sm leading-relaxed text-brand-graphite break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-brand-ink">{children}</strong>,
          em: ({ children }) => <em className="italic text-brand-slate">{children}</em>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5 marker:text-brand-mist">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5 marker:text-brand-mist">{children}</ol>,
          li: ({ children }) => <li className="leading-snug">{children}</li>,
          h1: ({ children }) => <h3 className="font-display text-lg text-brand-ink uppercase mt-2 mb-1">{children}</h3>,
          h2: ({ children }) => <h3 className="font-semibold text-brand-ink mt-2 mb-1">{children}</h3>,
          h3: ({ children }) => <h4 className="font-semibold text-brand-graphite mt-2 mb-1">{children}</h4>,
          code: ({ children }) => <code className="bg-brand-bg rounded px-1 py-0.5 text-[0.85em] font-mono">{children}</code>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-brand-cyan bg-brand-cyan/5 rounded-r pl-3 pr-2 py-1.5 text-brand-slate my-2">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2 rounded-lg border border-brand-border">
              <table className="text-xs w-full tabular-nums">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="px-2.5 py-1.5 bg-brand-bg text-left font-semibold text-brand-slate whitespace-nowrap">{children}</th>,
          td: ({ children }) => <td className="px-2.5 py-1.5 border-t border-brand-border whitespace-nowrap">{children}</td>,
          a: ({ children, href }) => {
            const h = href ?? "";
            if (h.startsWith("/") && !h.startsWith("//")) {
              return (
                <Link href={h} onClick={onNavegar} className="inline-flex items-center gap-0.5 font-semibold text-brand-primary hover:underline">
                  {children}
                  <ArrowUpRight size={13} />
                </Link>
              );
            }
            return <a href={h} target="_blank" rel="noreferrer noopener" className="text-brand-cyan underline">{children}</a>;
          },
        }}
      >
        {texto}
      </ReactMarkdown>
    </div>
  );
}

function Copiar({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* sin portapapeles */ }
      }}
      className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-brand-mist hover:text-brand-ink p-1 rounded"
      title="Copiar respuesta"
      aria-label="Copiar respuesta"
    >
      {ok ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function Paso({ p }: { p: Extract<ItemVoi, { tipo: "paso" }> }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      {p.estado === "corriendo" ? (
        <Loader2 size={13} className="animate-spin text-brand-cyan mt-px flex-shrink-0" />
      ) : p.estado === "ok" ? (
        <CheckCircle2 size={13} className="text-brand-cyan mt-px flex-shrink-0" />
      ) : (
        <AlertTriangle size={13} className="text-brand-orange mt-px flex-shrink-0" />
      )}
      <span className={p.estado === "corriendo" ? "text-brand-graphite font-medium" : "text-brand-slate"}>
        {p.etiqueta || p.herramienta || "Trabajando"}
        {p.detalle && p.estado === "error" && <span className="block text-brand-mist">{p.detalle}</span>}
      </span>
    </li>
  );
}

const ESTADO_ACCION: Record<AccionVoi["estado"], { texto: string; clase: string; borde: string }> = {
  pendiente: { texto: "Necesita tu confirmación", clase: "text-brand-orange", borde: "border-brand-orange/50 bg-brand-orange/[0.05]" },
  ejecutando: { texto: "Haciéndolo…", clase: "text-brand-cyan", borde: "border-brand-cyan/40 bg-brand-cyan/[0.04]" },
  ejecutada: { texto: "Hecho", clase: "text-emerald-700", borde: "border-emerald-200 bg-emerald-50/60" },
  cancelada: { texto: "Cancelada", clase: "text-brand-slate", borde: "border-brand-border bg-brand-bg/60" },
  fallida: { texto: "No se pudo", clase: "text-brand-primary", borde: "border-brand-primary/30 bg-brand-primary-light/40" },
};

export function TarjetaAccion({ a, onConfirmar, onCancelar, onNavegar }: {
  a: AccionVoi;
  onConfirmar: (a: AccionVoi) => void;
  onCancelar: (a: AccionVoi) => void;
  onNavegar?: () => void;
}) {
  const e = ESTADO_ACCION[a.estado] ?? ESTADO_ACCION.pendiente;
  return (
    <div className={`rounded-xl border p-3.5 ${e.borde} animate-pop`}>
      <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider2 ${e.clase}`}>
        {a.estado === "ejecutando" ? <Loader2 size={12} className="animate-spin" /> :
          a.estado === "ejecutada" ? <CheckCircle2 size={12} /> :
          a.estado === "fallida" ? <XCircle size={12} /> :
          a.estado === "cancelada" ? <XCircle size={12} /> : <Zap size={12} />}
        {e.texto}
        {a.nivel === 2 && a.estado === "pendiente" && <span className="font-medium normal-case tracking-normal text-brand-slate">· es tuyo</span>}
      </div>
      <p className="mt-1.5 text-sm font-medium text-brand-ink leading-snug">{a.resumen || a.etiqueta}</p>
      {a.mensaje && a.estado !== "pendiente" && <p className="mt-1.5 text-xs text-brand-slate">{a.mensaje}</p>}
      {a.estado === "pendiente" && (
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={() => onConfirmar(a)} className="btn-primary px-4 py-1.5 text-xs">
            <Check size={14} /> Confirmar
          </button>
          <button type="button" onClick={() => onCancelar(a)} className="btn-ghost px-3 py-1.5 text-xs">Cancelar</button>
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-brand-mist" title="Voi no hace nada que afecte a otros sin tu confirmación">
            <ShieldCheck size={12} /> Vos decidís
          </span>
        </div>
      )}
      {a.pantalla && a.estado === "ejecutada" && (
        <Link href={a.pantalla} onClick={onNavegar} className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline">
          Abrir <ArrowUpRight size={13} />
        </Link>
      )}
    </div>
  );
}

const FRASES = ["Pensando…", "Revisando tus datos…", "Consultando la plataforma…", "Ordenando lo que encontré…", "Armando la respuesta…"];

export function Trabajando() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % FRASES.length), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-2.5 pl-0.5" aria-live="polite">
      <VoiIsotipo size={18} estado="pensando" />
      <span key={i} className="shimmer-text text-sm font-medium animate-fade">{FRASES[i]}</span>
    </div>
  );
}

/** La conversación: mensajes del usuario y de Voi, pasos (agrupados), tarjetas de acción y avisos. */
export function VoiMensajes({ items, parciales, onConfirmar, onCancelar, onReintentar, onNavegar }: {
  items: ItemVoi[];
  parciales: Record<string, string>;
  onConfirmar: (a: AccionVoi) => void;
  onCancelar: (a: AccionVoi) => void;
  onReintentar: (id: string, texto: string) => void;
  onNavegar?: () => void;
}) {
  // Pasos seguidos se muestran juntos, como un recorrido de lo que hizo Voi.
  const bloques: (ItemVoi | { tipo: "pasos"; id: string; pasos: Extract<ItemVoi, { tipo: "paso" }>[] })[] = [];
  for (const it of items) {
    if (it.tipo === "contexto" || it.tipo === "pensando") continue;
    const ultimo = bloques[bloques.length - 1];
    if (it.tipo === "paso") {
      if (ultimo && ultimo.tipo === "pasos") ultimo.pasos.push(it);
      else bloques.push({ tipo: "pasos", id: `pasos-${it.id}`, pasos: [it] });
    } else bloques.push(it);
  }
  return (
    <>
      {bloques.map((b) => {
        if (b.tipo === "usuario") {
          return (
            <div key={b.id} className="flex flex-col items-end">
              <div className={`max-w-[88%] rounded-2xl rounded-br-md bg-brand-ink text-white px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${b.pendiente ? "opacity-70" : ""}`}>
                {b.texto}
              </div>
              {b.error && (
                <div className="mt-1 flex items-center gap-2 text-xs text-brand-primary">
                  <AlertTriangle size={12} /> {b.error}
                  <button type="button" onClick={() => onReintentar(b.id, b.texto)} className="inline-flex items-center gap-1 font-semibold hover:underline">
                    <RotateCcw size={12} /> Reintentar
                  </button>
                </div>
              )}
            </div>
          );
        }
        if (b.tipo === "voi") {
          return (
            <div key={b.id} className="group flex gap-2.5">
              <VoiIsotipo size={18} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <VoiMarkdown texto={b.texto} onNavegar={onNavegar} />
                <div className="h-5 flex items-center"><Copiar texto={b.texto} /></div>
              </div>
            </div>
          );
        }
        if (b.tipo === "pasos") {
          return (
            <ul key={b.id} className="ml-7 space-y-1 border-l-2 border-brand-border pl-3 py-0.5">
              {b.pasos.map((p) => <Paso key={p.id} p={p} />)}
            </ul>
          );
        }
        if (b.tipo === "accion") {
          return (
            <div key={b.id} className="ml-7">
              <TarjetaAccion a={b.accion} onConfirmar={onConfirmar} onCancelar={onCancelar} onNavegar={onNavegar} />
            </div>
          );
        }
        if (b.tipo === "aviso") {
          const Icono = b.nivel === "error" ? XCircle : b.nivel === "alerta" ? AlertTriangle : Info;
          return (
            <div key={b.id} className="flex justify-center">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
                b.nivel === "error" ? "bg-brand-primary-light text-brand-primary-dark" :
                b.nivel === "alerta" ? "bg-brand-orange/10 text-brand-orange" : "bg-brand-bg text-brand-slate"}`}>
                <Icono size={12} /> {b.texto}
              </span>
            </div>
          );
        }
        return null;
      })}
      {Object.entries(parciales).map(([id, texto]) => (
        <div key={`p-${id}`} className="flex gap-2.5">
          <VoiIsotipo size={18} estado="hablando" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            {texto ? <VoiMarkdown texto={texto} onNavegar={onNavegar} /> : null}
            <span className="voi-cursor" aria-hidden />
          </div>
        </div>
      ))}
    </>
  );
}
