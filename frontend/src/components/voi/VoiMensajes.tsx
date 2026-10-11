"use client";

import {
  AlertTriangle, ArrowUpRight, BarChart3, BookOpen, Check, CheckCircle2, Copy, ExternalLink, Info, Loader2, Maximize2,
  ClipboardPenLine, MousePointerClick, RotateCcw, ShieldCheck, XCircle, Zap,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch } from "@/lib/api";
import {
  VOI_API, avisarHash, type AccionVoi, type AjustesEvidencia, type DetalleEvidencia, type GuiaVoi, type ItemVoi, type OpcionVoi,
} from "@/lib/voi";
import { pareceNumero } from "@/lib/voiFormato";
import { ICONO_TIPO, NOMBRE_TIPO } from "./lienzo/iconos";
import type { ArtefactoVoi } from "./lienzo/tipos";
import { TarjetaEvidencia, TarjetaModoAuditor } from "./VoiAuditor";
import { TarjetaGuia } from "./VoiGuia";
import { VoiIsotipo } from "./VoiIsotipo";

// ------------------------------------------------------------------ tablas del chat
interface TablaMd { linea: number; cabecera: string[]; filas: string[][] }

const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
function celdas(l: string): string[] {
  return l.trim().replace(/\\\|/g, "\u0000").replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/\u0000/g, "|"));
}
/** Las tablas Markdown de una respuesta, con la línea en la que empiezan (para encontrarlas al dibujar). */
function parsearTablas(texto: string): TablaMd[] {
  const lineas = texto.split("\n");
  const out: TablaMd[] = [];
  for (let i = 0; i < lineas.length - 1; i++) {
    if (lineas[i].includes("|") && SEP.test(lineas[i + 1])) {
      const filas: string[][] = [];
      let j = i + 2;
      while (j < lineas.length && lineas[j].includes("|") && lineas[j].trim()) filas.push(celdas(lineas[j++]));
      out.push({ linea: i + 1, cabecera: celdas(lineas[i]), filas });
      i = j - 1;
    }
  }
  return out;
}

function Inline({ texto }: { texto: string }) {
  return (
    <ReactMarkdown allowedElements={["p", "strong", "em", "code", "a"]} unwrapDisallowed
      components={{ p: ({ children }) => <Fragment>{children}</Fragment>, strong: ({ children }) => <strong className="font-semibold text-brand-ink">{children}</strong> }}>
      {texto}
    </ReactMarkdown>
  );
}

const FILAS_CHAT = 8;

function TablaChat({ t, onAmpliar }: { t: TablaMd; onAmpliar?: (a: ArtefactoVoi) => void }) {
  const numericas = t.cabecera.map((_, c) => {
    const vals = t.filas.map((f) => (f[c] ?? "").replace(/\*/g, "")).filter((v) => v.trim() && v.trim() !== "—");
    return vals.length > 0 && vals.filter(pareceNumero).length >= Math.ceil(vals.length * 0.8);
  });
  const ampliar = () => onAmpliar?.({
    id: `tabla-${t.linea}-${t.cabecera.join("|").slice(0, 40)}`, tipo: "tabla", titulo: "Tabla de la respuesta", local: true,
    spec: {
      tipo: "tabla", titulo: "Tabla de la respuesta", formato: "numero",
      columnas: t.cabecera.map((c, i) => ({ campo: `c${i}`, nombre: c.replace(/\*/g, ""), formato: numericas[i] ? "numero" : "texto", crudo: true })),
      datos: t.filas.map((f) => Object.fromEntries(t.cabecera.map((_, i) => [`c${i}`, (f[i] ?? "").replace(/\*\*/g, "")]))),
    },
  });
  const visibles = t.filas.slice(0, FILAS_CHAT);
  return (
    <div className="my-2.5 rounded-xl border border-brand-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-brand-bg">
              {t.cabecera.map((c, i) => (
                <th key={i} className={`px-2.5 py-2 font-semibold text-brand-slate whitespace-nowrap ${numericas[i] ? "text-right" : "text-left"}`}><Inline texto={c} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.map((f, r) => (
              <tr key={r} className="border-t border-brand-border even:bg-brand-bg-soft">
                {t.cabecera.map((_, i) => (
                  <td key={i} className={`px-2.5 py-1.5 whitespace-nowrap ${numericas[i] ? "text-right tabular-nums text-brand-ink" : "text-brand-graphite"}`}>
                    <Inline texto={f[i] ?? ""} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onAmpliar && (
        <button type="button" onClick={ampliar}
          className="w-full flex items-center justify-center gap-1.5 border-t border-brand-border bg-white px-3 py-1.5 text-[11px] font-semibold text-brand-slate hover:text-brand-primary hover:bg-brand-bg-soft">
          <Maximize2 size={12} /> {t.filas.length > FILAS_CHAT ? `Ver las ${t.filas.length} filas en el lienzo` : "Ampliar en el lienzo (ordenar y descargar)"}
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ citas de la base de conocimiento
interface PasajeCita { id: string; documento: string; documento_id: string; pagina: number | null; seccion: string | null; texto: string; descargable: boolean }

interface PosGlobo { left: number; ancho: number; top?: number; bottom?: number; alto: number }

/** Chip de una cita: abre el pasaje exacto en un globo que se ubica donde entra (arriba o abajo, sin salirse de la
 * pantalla) y permite descargar el documento si la persona tiene alcance. */
function Cita({ id, children }: { id: string; children: React.ReactNode }) {
  const [abierta, setAbierta] = useState(false);
  const [pos, setPos] = useState<PosGlobo | null>(null);
  const [pasaje, setPasaje] = useState<PasajeCita | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const globo = useRef<HTMLDivElement>(null);

  const ubicar = useCallback(() => {
    const r = boton.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const ancho = Math.min(320, vw - 16);
    const left = Math.min(Math.max(8, r.left), vw - ancho - 8);
    const abajo = vh - r.bottom - 14, arriba = r.top - 14;
    setPos(abajo >= 260 || abajo >= arriba
      ? { left, ancho, top: r.bottom + 6, alto: Math.min(380, abajo) }
      : { left, ancho, bottom: vh - r.top + 6, alto: Math.min(380, arriba) });
  }, []);

  useEffect(() => {
    if (!abierta) return;
    ubicar();
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!boton.current?.contains(t) && !globo.current?.contains(t)) setAbierta(false);
    };
    const desplazar = (e: Event) => { if (!globo.current?.contains(e.target as Node)) setAbierta(false); };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setAbierta(false); boton.current?.focus(); }
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    window.addEventListener("scroll", desplazar, true);
    window.addEventListener("resize", ubicar);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("scroll", desplazar, true);
      window.removeEventListener("resize", ubicar);
    };
  }, [abierta, ubicar]);

  const abrir = async () => {
    setAbierta(!abierta);
    if (pasaje || error) return;
    try { setPasaje(await apiFetch<PasajeCita>(`${VOI_API}/citas/${encodeURIComponent(id)}`)); } catch (e: any) { setError(e.message); }
  };
  return (
    <>
      <button ref={boton} type="button" onClick={abrir} aria-expanded={abierta} title="Ver el pasaje citado"
        className="inline-flex items-center gap-1 rounded-md border border-brand-purple/25 bg-brand-purple/5 px-1.5 py-px text-[11px] font-semibold text-brand-purple hover:bg-brand-purple/10 align-baseline max-w-full">
        <BookOpen size={11} className="shrink-0" /> <span className="truncate">{children}</span>
      </button>
      {abierta && pos && typeof document !== "undefined" && createPortal(
        <div ref={globo} role="dialog" aria-label="Pasaje citado"
          style={{ position: "fixed", left: pos.left, width: pos.ancho, top: pos.top, bottom: pos.bottom, maxHeight: pos.alto }}
          className="z-[70] flex flex-col rounded-xl border border-brand-border bg-white p-3 shadow-elevated text-left animate-pop">
          {error ? <span className="text-xs text-brand-primary">{error}</span> : !pasaje ? (
            <span className="text-xs text-brand-mist inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Buscando el pasaje…</span>
          ) : (
            <>
              <span className="block text-xs font-semibold text-brand-ink">{pasaje.documento}</span>
              <span className="block text-[11px] text-brand-slate">
                {[pasaje.pagina ? `Página ${pasaje.pagina}` : null, pasaje.seccion].filter(Boolean).join(" · ")}
              </span>
              <span className="mt-2 block min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-xs text-brand-graphite leading-snug border-l-2 border-brand-purple/40 pl-2">{pasaje.texto}</span>
              {pasaje.descargable && (
                <a href={`${VOI_API}/documentos/${pasaje.documento_id}/archivo`} onClick={(e) => { e.preventDefault(); import("@/lib/api").then((m) => m.downloadFile(`${VOI_API}/documentos/${pasaje.documento_id}/archivo`, pasaje.documento)); }}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-primary hover:underline shrink-0">
                  Descargar el documento <ArrowUpRight size={12} />
                </a>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Deja pasar los enlaces internos y las citas (cita:frag_…); el resto, con el filtro estándar. */
function transformarUrl(url: string): string {
  return url.startsWith("cita:") ? url : defaultUrlTransform(url);
}

/** Markdown de Voi: enlaces internos navegan dentro de la app (el panel sigue abierto); los externos, en otra pestaña;
 * las citas de documentos abren el pasaje; las tablas se ven ordenadas y se pueden ampliar en el lienzo. */
export function VoiMarkdown({ texto, onNavegar, onAmpliar }: { texto: string; onNavegar?: () => void; onAmpliar?: (a: ArtefactoVoi) => void }) {
  const tablas = useMemo(() => parsearTablas(texto), [texto]);
  return (
    <div className="text-sm leading-relaxed text-brand-graphite break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={transformarUrl}
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
          table: ({ node, children }) => {
            const t = tablas.find((x) => x.linea === node?.position?.start?.line);
            if (t) return <TablaChat t={t} onAmpliar={onAmpliar} />;
            return <div className="overflow-x-auto my-2 rounded-lg border border-brand-border"><table className="text-xs w-full tabular-nums">{children}</table></div>;
          },
          th: ({ children }) => <th className="px-2.5 py-1.5 bg-brand-bg text-left font-semibold text-brand-slate whitespace-nowrap">{children}</th>,
          td: ({ children }) => <td className="px-2.5 py-1.5 border-t border-brand-border whitespace-nowrap">{children}</td>,
          a: ({ children, href }) => {
            const h = href ?? "";
            if (h.startsWith("cita:")) return <Cita id={h.slice(5)}>{children}</Cita>;
            if (h.startsWith("/") && !h.startsWith("//")) {
              return (
                <Link href={h} onClick={() => { onNavegar?.(); avisarHash(h); }} className="inline-flex items-center gap-0.5 font-semibold text-brand-primary hover:underline">
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

/** Tarjeta de algo que Voi mostró en el lienzo. */
function TarjetaLienzo({ a, onAbrir }: { a: ArtefactoVoi; onAbrir?: (id: string) => void }) {
  const Icono = ICONO_TIPO[a.tipo] ?? BarChart3;
  return (
    <button type="button" onClick={() => onAbrir?.(a.id)}
      className="group w-full text-left rounded-xl border border-brand-border bg-white hover:border-brand-cyan/60 hover:shadow-soft p-3 flex items-center gap-3 transition-all animate-pop">
      <span className="w-10 h-10 rounded-lg bg-brand-cyan/10 text-brand-cyan grid place-items-center flex-shrink-0"><Icono size={18} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-brand-ink truncate">{a.titulo}</span>
        <span className="block text-xs text-brand-slate">{NOMBRE_TIPO[a.tipo] ?? "Visualización"} · <span className="text-brand-cyan font-semibold group-hover:underline">Ver en el lienzo</span></span>
      </span>
      <ArrowUpRight size={16} className="text-brand-mist group-hover:text-brand-cyan flex-shrink-0" />
    </button>
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
  pendiente: { texto: "Necesita tu aprobación", clase: "text-brand-orange", borde: "border-brand-orange/50 bg-brand-orange/[0.05]" },
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
            <Check size={14} /> Aprobar
          </button>
          <button type="button" onClick={() => onCancelar(a)} className="btn-ghost px-3 py-1.5 text-xs">Cancelar</button>
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-brand-mist" title="Voi no hace nada que afecte a otros sin tu confirmación">
            <ShieldCheck size={12} /> Vos decidís
          </span>
        </div>
      )}
      {a.pantalla && a.estado === "ejecutada" && (
        <Link href={a.pantalla} onClick={() => { onNavegar?.(); avisarHash(a.pantalla ?? ""); }} className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline">
          Abrir <ArrowUpRight size={13} />
        </Link>
      )}
    </div>
  );
}

/** Una pregunta con botones: elegir es mandar el mensaje de la opción. Después de responder quedan apagados, con la
 * elegida marcada. */
function TarjetaOpciones({ b, respondida, elegida, onElegir }: {
  b: Extract<ItemVoi, { tipo: "opciones" }>;
  respondida: boolean;
  elegida?: OpcionVoi;
  onElegir?: (op: OpcionVoi) => void;
}) {
  return (
    <div className="rounded-xl border border-brand-border bg-white p-3.5 animate-pop">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider2 text-brand-cyan">
        <MousePointerClick size={12} /> Elegí con un toque
      </div>
      <p className="mt-1.5 text-sm font-semibold text-brand-ink leading-snug">{b.pregunta}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {b.opciones.map((o) => {
          const esElegida = elegida?.texto === o.texto;
          return (
            <button
              key={o.texto}
              type="button"
              disabled={respondida || !onElegir}
              onClick={() => onElegir?.(o)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                esElegida ? "border-brand-ink bg-brand-ink text-white"
                  : respondida ? "border-brand-border text-brand-mist"
                    : "border-brand-border bg-white text-brand-ink hover:border-brand-primary hover:text-brand-primary"}`}
            >
              {esElegida && <Check size={14} />}
              {o.texto}
              {o.ruta && !esElegida && <ArrowUpRight size={13} className={respondida ? "" : "text-brand-mist"} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TarjetaPantalla({ ruta, titulo, onAbrir }: { ruta: string; titulo?: string | null; onAbrir?: (ruta: string, titulo?: string | null) => void }) {
  return (
    <div className="rounded-xl border border-brand-border bg-white px-3.5 py-2.5 flex items-center gap-2.5 text-sm animate-pop">
      <ExternalLink size={15} className="text-brand-cyan flex-shrink-0" />
      <span className="min-w-0 flex-1 truncate text-brand-graphite">Abrí <span className="font-semibold text-brand-ink">{titulo ?? ruta}</span></span>
      {onAbrir && (
        <button type="button" onClick={() => onAbrir(ruta, titulo)} className="text-xs font-semibold text-brand-primary hover:underline whitespace-nowrap">
          Abrir de nuevo
        </button>
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

const esEvidencia = (a: AccionVoi): a is AccionVoi & { detalle: DetalleEvidencia } =>
  a.herramienta === "proponer_evidencia" && a.detalle?.tipo === "evidencia" && Array.isArray(a.detalle.piezas) && a.detalle.piezas.length > 0;

/** La conversación: mensajes del usuario y de Voi, pasos (agrupados), tarjetas de acción y avisos. */
export function VoiMensajes({
  items, parciales, onConfirmar, onConfirmarCon, onCancelar, onReintentar, onNavegar, onAbrirLienzo, onAmpliar, artefactos = [],
  codigoInforme, diario = false, onElegir, onVerGuia, onAbrirRuta,
}: {
  items: ItemVoi[];
  parciales: Record<string, string>;
  onConfirmar: (a: AccionVoi) => void;
  /** Confirmar con lo elegido en la tarjeta (las piezas que van al informe). */
  onConfirmarCon?: (a: AccionVoi, ajustes: AjustesEvidencia) => void;
  onCancelar: (a: AccionVoi) => void;
  onReintentar: (id: string, texto: string) => void;
  onNavegar?: () => void;
  onAbrirLienzo?: (id: string) => void;
  onAmpliar?: (a: ArtefactoVoi) => void;
  /** Lo que Voi mostró en el lienzo (para las tarjetas que proponen sumar piezas al informe). */
  artefactos?: ArtefactoVoi[];
  /** Cómo se nombra el informe destino del modo activo («AUD-…» o «Informe diario · dd/mm»). */
  codigoInforme?: string | null;
  /** El modo activo es el informe diario (cambia los textos de la tarjeta de figuras). */
  diario?: boolean;
  /** Elegir una de las opciones que ofreció Voi (botones). */
  onElegir?: (op: OpcionVoi) => void;
  /** Volver a abrir una guía paso a paso que Voi mostró. */
  onVerGuia?: (g: GuiaVoi) => void;
  /** Volver a abrir una pantalla que Voi abrió. */
  onAbrirRuta?: (ruta: string, titulo?: string | null) => void;
}) {
  const indice = new Map(items.map((it, i) => [it.id, i]));
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
                <VoiMarkdown texto={b.texto} onNavegar={onNavegar} onAmpliar={onAmpliar} />
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
        if (b.tipo === "lienzo") {
          return (
            <div key={b.id} className="ml-7">
              <TarjetaLienzo a={b.artefacto} onAbrir={onAbrirLienzo} />
            </div>
          );
        }
        if (b.tipo === "accion") {
          const a = b.accion;
          return (
            <div key={b.id} className="ml-7">
              {esEvidencia(a) && onConfirmarCon ? (
                <TarjetaEvidencia a={a} artefactos={artefactos} codigo={codigoInforme} diario={diario} onConfirmarCon={onConfirmarCon}
                  onCancelar={onCancelar} onAbrirLienzo={onAbrirLienzo} onNavegar={onNavegar} />
              ) : a.herramienta === "proponer_modo_auditor" ? (
                <TarjetaModoAuditor a={a} onConfirmar={onConfirmar} onCancelar={onCancelar} />
              ) : (
                <TarjetaAccion a={a} onConfirmar={onConfirmar} onCancelar={onCancelar} onNavegar={onNavegar} />
              )}
            </div>
          );
        }
        if (b.tipo === "opciones") {
          // Respondida si después hay un mensaje del usuario; la elegida, si coincide con una opción.
          const despues = items.slice((indice.get(b.id) ?? -1) + 1);
          const respuesta = despues.find((i) => i.tipo === "usuario") as Extract<ItemVoi, { tipo: "usuario" }> | undefined;
          const elegida = respuesta ? b.opciones.find((o) => (o.mensaje || o.texto).trim() === respuesta.texto.trim()) : undefined;
          return (
            <div key={b.id} className="ml-7">
              <TarjetaOpciones b={b} respondida={!!respuesta} elegida={elegida} onElegir={onElegir} />
            </div>
          );
        }
        if (b.tipo === "guia") {
          return (
            <div key={b.id} className="ml-7">
              <TarjetaGuia guia={b.guia} onVer={() => onVerGuia?.(b.guia)} onNavegar={onNavegar} />
            </div>
          );
        }
        if (b.tipo === "pantalla") {
          return (
            <div key={b.id} className="ml-7">
              <TarjetaPantalla ruta={b.ruta} titulo={b.titulo} onAbrir={onAbrirRuta ? (r, t) => { onAbrirRuta(r, t); onNavegar?.(); } : undefined} />
            </div>
          );
        }
        if (b.tipo === "modo") {
          return (
            <div key={b.id} className="py-1" role="status">
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-brand-border" />
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-graphite whitespace-nowrap">
                  {b.modo === "informe_diario"
                    ? <ClipboardPenLine size={13} className={b.activo ? "text-brand-purple" : "text-brand-mist"} />
                    : <ShieldCheck size={13} className={b.activo ? "text-brand-cyan" : "text-brand-mist"} />} {b.texto}
                </span>
                <span className="h-px flex-1 bg-brand-border" />
              </div>
              {b.activo && (
                <p className="mt-1 text-center text-[11px] text-brand-slate leading-snug">
                  {b.modo === "informe_diario"
                    ? "El agente mira los datos del día, te propone el contenido y te ofrece cada gráfico como figura del informe; vos revisás y firmás."
                    : "El agente busca alertas por su cuenta y te ofrece cada gráfico como figura del informe."}
                </p>
              )}
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
            {texto ? <VoiMarkdown texto={texto} onNavegar={onNavegar} onAmpliar={onAmpliar} /> : null}
            <span className="voi-cursor" aria-hidden />
          </div>
        </div>
      ))}
    </>
  );
}
