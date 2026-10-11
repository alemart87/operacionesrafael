"use client";

/**
 * Evidencia visual del informe de auditoría: figuras numeradas con piezas del lienzo de Voi (gráficos, tablas,
 * indicadores) e imágenes que aporta el auditor (capturas, fotos). Las imágenes viven en el disco persistente, sin
 * metadatos, y se piden con la sesión (nunca son públicas).
 *
 * - EvidenciaTab: subir (elegir, arrastrar o pegar con Ctrl+V), editar título, lectura y hallazgo, ordenar y quitar.
 * - FiguraInforme: la figura tal como sale en el informe ejecutivo y en el extenso (y en el PDF).
 */
import {
  ArrowLeft, ArrowRight, Camera, ChevronLeft, ChevronRight, ClipboardPaste, Expand, FileImage, GripVertical, ImageOff, ImagePlus,
  Loader2, Pencil, ShieldCheck, Trash2, UploadCloud, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CuerpoPieza } from "@/components/voi/lienzo/VoiGrafico";
import { ICONO_TIPO, NOMBRE_TIPO } from "@/components/voi/lienzo/iconos";
import { VoiIsotipo } from "@/components/voi/VoiIsotipo";
import { useVoi } from "@/components/voi/VoiProvider";
import { apiFetch, getToken, refreshSession } from "@/lib/api";
import {
  EXTENSIONES_IMAGEN, MAX_IMAGEN_MB, capturarPantalla, elegirImagenes as elegirImagenesCompartido, esImagen, marcaDeTiempo,
} from "@/lib/imagenes";
import { guardado } from "./Autoguardado";
import { AUD_API, ORIGEN_EVIDENCIA, fechaHora, type AuditoriaDetalle, type Evidencia, type Hallazgo } from "./tipos";

const MAX_MB = MAX_IMAGEN_MB;
const EXTENSIONES = EXTENSIONES_IMAGEN;
const elegirImagenes = (respaldo: HTMLInputElement | null) => elegirImagenesCompartido(respaldo, "evidencia-auditoria");


// ------------------------------------------------------------------ imágenes con la sesión
const cache = new Map<string, Promise<string>>();

function rutaImagen(e: Evidencia, variante: "completa" | "miniatura") {
  return `${AUD_API}/informes/${e.auditoria_id}/evidencias/${e.id}/imagen?v=${variante}`;
}

async function pedir(url: string, reintento = false): Promise<string> {
  const token = getToken();
  const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (r.status === 401 && !reintento && (await refreshSession())) return pedir(url, true);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return URL.createObjectURL(await r.blob());
}

function imagen(e: Evidencia, variante: "completa" | "miniatura"): Promise<string> {
  const clave = `${e.id}:${variante}`;
  let p = cache.get(clave);
  if (!p) {
    p = pedir(rutaImagen(e, variante));
    p.catch(() => cache.delete(clave));
    cache.set(clave, p);
  }
  return p;
}

function olvidarImagen(id: string) {
  for (const v of ["completa", "miniatura"] as const) {
    const p = cache.get(`${id}:${v}`);
    cache.delete(`${id}:${v}`);
    p?.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
  }
}

/** La imagen de una figura (pedida con la sesión). Mientras carga queda marcada para que el PDF la espere. */
export function ImagenEvidencia({ e, variante = "miniatura", className = "", onClick }: {
  e: Evidencia;
  variante?: "completa" | "miniatura";
  className?: string;
  onClick?: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!e.disponible) return;
    let vivo = true;
    setError(false);
    imagen(e, variante).then((u) => vivo && setSrc(u)).catch(() => vivo && setError(true));
    return () => { vivo = false; };
  }, [e, variante]);

  if (!e.disponible || error) {
    return (
      <div className={`grid place-items-center bg-brand-bg text-brand-mist text-xs text-center p-4 ${className}`}>
        <span className="flex flex-col items-center gap-1.5"><ImageOff size={22} />
          {e.disponible ? "No se pudo cargar la imagen" : "La imagen ya no está en el almacenamiento"}</span>
      </div>
    );
  }
  if (!src) return <div data-evidencia-cargando="1" className={`shimmer-bar ${className}`} aria-label="Cargando la imagen" />;
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img data-evidencia src={src} alt={e.titulo} className={className} draggable={false} />;
  return onClick ? <button type="button" onClick={onClick} className="block w-full" aria-label={`Ampliar: ${e.titulo}`}>{img}</button> : img;
}

// ------------------------------------------------------------------ figura del informe (ejecutivo, extenso y PDF)
export function fuenteFigura(e: Evidencia, nombre: (id: string | null) => string): string {
  const fecha = fechaHora(e.created_at);
  if (e.tipo === "imagen") {
    const medidas = e.ancho && e.alto ? ` · ${e.ancho}×${e.alto} px` : "";
    return `Imagen aportada por ${nombre(e.created_by)}${e.archivo_nombre ? ` · ${e.archivo_nombre}` : ""}${medidas} · ${fecha}`;
  }
  const base = e.origen === "voi" ? "Voi, en la investigación del auditor" : "Lienzo de Voi";
  return `${base} · elegida por ${nombre(e.created_by)} · ${fecha}${e.spec?.nota ? ` · ${e.spec.nota}` : ""}`;
}

/** Una figura numerada como sale en el informe: título, gráfico o imagen, lectura del auditor, fuente y hallazgo. */
export function FiguraInforme({ e, numero, hallazgo, nombre, compacta = false }: {
  e: Evidencia;
  numero: number;
  hallazgo?: Hallazgo;
  nombre: (id: string | null) => string;
  compacta?: boolean;
}) {
  return (
    <figure className="figura-informe card p-5 break-inside-avoid" id={`figura-${numero}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center rounded bg-brand-ink px-2 py-0.5 text-xs font-semibold text-white">Figura {numero}</span>
        <span className="text-xs text-brand-slate">
          {e.tipo === "imagen" ? "Imagen" : NOMBRE_TIPO[e.spec?.tipo ?? ""] ?? "Gráfico"} · {ORIGEN_EVIDENCIA[e.origen]}
        </span>
        {hallazgo && (
          <span className="ml-auto inline-flex items-center rounded border border-brand-border bg-brand-bg px-2 py-0.5 text-xs font-semibold text-brand-graphite">
            Respalda {hallazgo.codigo}
          </span>
        )}
      </div>
      <h3 className="font-display text-xl uppercase text-brand-ink leading-tight mt-2">{e.titulo}</h3>
      <div className="mt-3">
        {e.tipo === "imagen" ? (
          <div className="rounded-lg border border-brand-border bg-brand-bg-soft p-2 flex justify-center">
            <ImagenEvidencia e={e} variante="completa" className={`w-auto max-w-full object-contain rounded ${compacta ? "max-h-[110mm]" : "max-h-[125mm]"}`} />
          </div>
        ) : e.spec ? (
          <CuerpoPieza spec={e.spec} fijo={960} compacto={compacta} />
        ) : null}
      </div>
      {e.nota && (
        <div className="mt-3 rounded-md border-l-4 border-l-brand-cyan bg-brand-cyan/5 px-3 py-2 text-sm text-brand-graphite whitespace-pre-line">
          <b className="text-[11px] uppercase tracking-wider2 text-brand-cyan">Lectura del auditor · </b>{e.nota}
        </div>
      )}
      <figcaption className="mt-2 text-[11px] text-brand-slate">Fuente: {fuenteFigura(e, nombre)}</figcaption>
    </figure>
  );
}

/** «Figura 2, Figura 5»: las figuras que respaldan un hallazgo. */
export function figurasDeHallazgo(evidencias: Evidencia[], hallazgoId: string): number[] {
  return evidencias.map((e, i) => (e.hallazgo_id === hallazgoId ? i + 1 : 0)).filter(Boolean);
}

// ------------------------------------------------------------------ subida con progreso
interface Subida { id: string; nombre: string; progreso: number; error: string | null }

function subir(aid: string, archivo: File, onProgreso: (p: number) => void, titulo?: string, reintento = false): Promise<Evidencia> {
  return new Promise((ok, mal) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${AUD_API}/informes/${aid}/evidencias/imagen`);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) onProgreso(Math.round((ev.loaded / ev.total) * 100)); };
    xhr.onload = async () => {
      if (xhr.status === 401 && !reintento && (await refreshSession())) {
        subir(aid, archivo, onProgreso, titulo, true).then(ok, mal);
        return;
      }
      let cuerpo: any = null;
      try { cuerpo = JSON.parse(xhr.responseText); } catch { /* sin cuerpo */ }
      if (xhr.status >= 200 && xhr.status < 300) ok(cuerpo as Evidencia);
      else mal(new Error(typeof cuerpo?.detail === "string" ? cuerpo.detail : `No se pudo subir (error ${xhr.status})`));
    };
    xhr.onerror = () => mal(new Error("Se cortó la conexión mientras subía la imagen"));
    const datos = new FormData();
    datos.append("archivo", archivo, archivo.name || "captura.png");
    if (titulo) datos.append("titulo", titulo);
    xhr.send(datos);
  });
}

// ------------------------------------------------------------------ visor (pantalla completa)
function Visor({ lista, inicio, onCerrar, nombre, hallazgos }: {
  lista: Evidencia[];
  inicio: number;
  onCerrar: () => void;
  nombre: (id: string | null) => string;
  hallazgos: Hallazgo[];
}) {
  const [i, setI] = useState(inicio);
  const e = lista[i];
  useEffect(() => {
    const f = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onCerrar();
      if (ev.key === "ArrowRight") setI((x) => Math.min(lista.length - 1, x + 1));
      if (ev.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", f);
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", f); document.body.style.overflow = previo; };
  }, [lista.length, onCerrar]);
  if (!e || typeof document === "undefined") return null;
  const h = hallazgos.find((x) => x.id === e.hallazgo_id);
  // En el body: ningún contenedor de la página (con transformaciones o desbordes) lo recorta.
  return createPortal(
    <div className="fixed inset-0 z-[80] bg-brand-ink/95 flex flex-col no-print animate-fade" role="dialog" aria-modal="true" aria-label={`Figura ${i + 1}`}>
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <span className="rounded bg-white/10 px-2 py-0.5 text-xs font-semibold whitespace-nowrap">Figura {i + 1} de {lista.length}</span>
        <span className="font-display text-xl uppercase truncate">{e.titulo}</span>
        <button type="button" onClick={onCerrar} aria-label="Cerrar" className="ml-auto w-10 h-10 grid place-items-center rounded-lg hover:bg-white/10"><X size={20} /></button>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-4 sm:px-16 pb-2">
        {i > 0 && (
          <button type="button" onClick={() => setI(i - 1)} aria-label="Figura anterior" className="absolute left-2 sm:left-4 z-10 w-11 h-11 rounded-full bg-white/10 text-white grid place-items-center hover:bg-white/20"><ChevronLeft size={22} /></button>
        )}
        {e.tipo === "imagen" ? (
          <ImagenEvidencia key={e.id} e={e} variante="completa" className="max-h-full max-w-full object-contain rounded-lg shadow-2xl" />
        ) : e.spec ? (
          <div key={e.id} className="w-full max-w-5xl max-h-full overflow-auto rounded-2xl bg-white p-5"><CuerpoPieza spec={e.spec} /></div>
        ) : null}
        {i < lista.length - 1 && (
          <button type="button" onClick={() => setI(i + 1)} aria-label="Figura siguiente" className="absolute right-2 sm:right-4 z-10 w-11 h-11 rounded-full bg-white/10 text-white grid place-items-center hover:bg-white/20"><ChevronRight size={22} /></button>
        )}
      </div>
      <div className="px-4 sm:px-16 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-white/80 text-sm max-w-5xl mx-auto w-full">
        {e.nota && <p className="text-white/90 whitespace-pre-line">{e.nota}</p>}
        <p className="mt-1 text-[11px] text-white/60">{h ? `Respalda ${h.codigo} · ` : ""}{fuenteFigura(e, nombre)}</p>
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ tarjeta de una figura (pestaña Evidencia)
function TarjetaFigura({ e, numero, total, editable, hallazgos, nombre, onMover, onGuardar, onQuitar, onVer, arrastre }: {
  e: Evidencia;
  numero: number;
  total: number;
  editable: boolean;
  hallazgos: Hallazgo[];
  nombre: (id: string | null) => string;
  onMover: (d: -1 | 1) => void;
  onGuardar: (cambios: { titulo: string; nota: string; hallazgo_id: string }) => Promise<void>;
  onQuitar: () => void;
  onVer: () => void;
  arrastre: React.HTMLAttributes<HTMLElement> & { draggable?: boolean; "data-sobre"?: boolean };
}) {
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ titulo: e.titulo, nota: e.nota ?? "", hallazgo_id: e.hallazgo_id ?? "" });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setForm({ titulo: e.titulo, nota: e.nota ?? "", hallazgo_id: e.hallazgo_id ?? "" }), [e]);
  const h = hallazgos.find((x) => x.id === e.hallazgo_id);
  const Icono = e.tipo === "imagen" ? FileImage : ICONO_TIPO[e.spec?.tipo ?? ""] ?? FileImage;
  const { "data-sobre": sobre, ...arrastreProps } = arrastre;

  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try { await onGuardar(form); setEditando(false); } catch (err: any) { setError(err.message); } finally { setOcupado(false); }
  };

  return (
    <article {...arrastreProps} draggable={!!arrastreProps.draggable && !editando}
      className={`group card overflow-hidden flex flex-col transition-all ${sobre ? "ring-2 ring-brand-cyan ring-offset-2" : "hover:shadow-elevated"}`}>
      {/* Encabezado: número, origen y ver en grande (nada queda encima de la imagen o del gráfico). */}
      <div className="flex items-center gap-2 pl-4 pr-2 py-2 border-b border-brand-border">
        {editable && (
          <span className="hidden md:inline-flex -ml-1.5 text-brand-mist cursor-grab" title="Arrastrá para ordenar" aria-hidden>
            <GripVertical size={14} />
          </span>
        )}
        <span className="rounded bg-brand-ink px-2 py-0.5 text-xs font-semibold text-white whitespace-nowrap">Figura {numero}</span>
        <span className="min-w-0 inline-flex items-center gap-1 text-xs text-brand-slate">
          <Icono size={12} className="flex-shrink-0" /> <span className="truncate">{ORIGEN_EVIDENCIA[e.origen]}</span>
        </span>
        <button type="button" onClick={onVer} title="Ver en grande" aria-label="Ver en grande"
          className="ml-auto w-8 h-8 grid place-items-center rounded-md text-brand-slate hover:bg-brand-bg hover:text-brand-ink flex-shrink-0">
          <Expand size={14} />
        </button>
      </div>
      <div className="h-44 bg-brand-bg-soft border-b border-brand-border overflow-hidden">
        {e.tipo === "imagen" ? (
          <ImagenEvidencia e={e} className="w-full h-44 object-contain p-2" onClick={onVer} />
        ) : e.spec ? (
          <button type="button" onClick={onVer} className="block w-full h-44 text-left overflow-hidden" aria-label={`Ampliar: ${e.titulo}`}>
            <div className="pointer-events-none origin-top-left scale-[0.6] w-[166.67%] px-5 py-4">
              <CuerpoPieza spec={e.spec} compacto />
            </div>
          </button>
        ) : null}
      </div>
      <div className="p-4 flex-1 flex flex-col">
        {editando ? (
          <div className="space-y-2">
            <input className="input py-2 text-sm font-semibold" value={form.titulo} maxLength={255} onChange={(ev) => setForm({ ...form, titulo: ev.target.value })} placeholder="Título: la conclusión que muestra" aria-label="Título de la figura" />
            <textarea className="input text-sm min-h-[72px]" value={form.nota} maxLength={4000} onChange={(ev) => setForm({ ...form, nota: ev.target.value })} placeholder="Lectura del auditor: qué muestra, por qué importa, fuente y corte" aria-label="Lectura del auditor" />
            <select className="input text-sm" value={form.hallazgo_id} onChange={(ev) => setForm({ ...form, hallazgo_id: ev.target.value })} aria-label="Hallazgo que respalda">
              <option value="">No respalda un hallazgo en particular</option>
              {hallazgos.filter((x) => x.estado !== "descartado" || x.id === e.hallazgo_id).map((x) => (
                <option key={x.id} value={x.id}>{x.codigo} · {x.titulo.slice(0, 70)}</option>
              ))}
            </select>
            {error && <p className="text-xs text-brand-primary">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={guardar} disabled={ocupado || !form.titulo.trim()} className="btn-primary px-3 py-1.5 text-xs">{ocupado ? "Guardando…" : "Guardar"}</button>
              <button type="button" onClick={() => { setEditando(false); setForm({ titulo: e.titulo, nota: e.nota ?? "", hallazgo_id: e.hallazgo_id ?? "" }); }} className="btn-ghost px-3 py-1.5 text-xs">Cancelar</button>
            </div>
          </div>
        ) : (
          <>
            <h3 className="font-semibold text-brand-ink leading-snug">{e.titulo}</h3>
            {e.nota ? <p className="mt-1 text-sm text-brand-graphite leading-snug line-clamp-3 whitespace-pre-line">{e.nota}</p>
              : editable && <button type="button" onClick={() => setEditando(true)} className="mt-1 text-left text-xs text-brand-mist hover:text-brand-cyan">+ Agregar la lectura del auditor</button>}
            <div className="mt-auto pt-3 flex items-center gap-2 flex-wrap text-[11px] text-brand-slate">
              {h && <span className="rounded border border-brand-border bg-brand-bg px-1.5 py-0.5 font-semibold text-brand-graphite">Respalda {h.codigo}</span>}
              <span className="truncate">{nombre(e.created_by)} · {fechaHora(e.created_at)}</span>
            </div>
          </>
        )}
      </div>
      {editable && !editando && (
        <div className="border-t border-brand-border px-2 py-1.5 flex items-center gap-0.5">
          <button type="button" onClick={() => onMover(-1)} disabled={numero === 1} className="w-8 h-8 grid place-items-center rounded-md text-brand-slate hover:bg-brand-bg disabled:opacity-30" title="Antes" aria-label="Mover antes"><ArrowLeft size={14} /></button>
          <button type="button" onClick={() => onMover(1)} disabled={numero === total} className="w-8 h-8 grid place-items-center rounded-md text-brand-slate hover:bg-brand-bg disabled:opacity-30" title="Después" aria-label="Mover después"><ArrowRight size={14} /></button>
          <button type="button" onClick={() => setEditando(true)} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-brand-slate hover:bg-brand-bg hover:text-brand-ink"><Pencil size={13} /> Editar</button>
          <button type="button" onClick={onQuitar} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-brand-slate hover:bg-brand-primary-light hover:text-brand-primary"><Trash2 size={13} /> Quitar</button>
        </div>
      )}
    </article>
  );
}

// ------------------------------------------------------------------ pestaña Evidencia
export function EvidenciaTab({ a, onChange }: { a: AuditoriaDetalle; onChange: () => Promise<void> }) {
  const voi = useVoi();
  const [lista, setLista] = useState<Evidencia[]>(a.evidencias);
  const [subidas, setSubidas] = useState<Subida[]>([]);
  const [sobreZona, setSobreZona] = useState(false);
  const [arrastrada, setArrastrada] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [visor, setVisor] = useState<number | null>(null);
  const [quitar, setQuitar] = useState<Evidencia | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const nombre = useCallback((id: string | null) => (id && a.usuarios[id]) || "—", [a.usuarios]);
  useEffect(() => setLista(a.evidencias), [a.evidencias]);

  const editable = a.editable;
  const graficos = lista.filter((e) => e.tipo === "grafico").length;
  const imagenes = lista.length - graficos;

  /** Sube de a una (el orden de las figuras es el orden de los archivos). `titulos`: para capturas pegadas. */
  const subirArchivos = useCallback(async (archivos: File[], titulos?: string[]) => {
    if (!editable) return;
    setError(null);
    const validos: File[] = [];
    for (const f of archivos) {
      if (!esImagen(f)) {
        setSubidas((s) => [...s, { id: `${Date.now()}-${Math.random()}`, nombre: f.name, progreso: 0, error: "No es una imagen PNG, JPG, WebP o GIF." }]);
      } else if (f.size > MAX_MB * 1024 * 1024) {
        setSubidas((s) => [...s, { id: `${Date.now()}-${Math.random()}`, nombre: f.name, progreso: 0, error: `Supera los ${MAX_MB} MB.` }]);
      } else validos.push(f);
    }
    let alguna = false;
    for (const f of validos) {
      const id = `${Date.now()}-${Math.random()}`;
      const titulo = titulos?.[archivos.indexOf(f)];
      setSubidas((s) => [...s, { id, nombre: titulo || f.name || "Captura pegada", progreso: 0, error: null }]);
      try {
        const e = await guardado.con(() => subir(a.id, f, (p) => setSubidas((s) => s.map((x) => (x.id === id ? { ...x, progreso: p } : x))), titulo));
        setLista((l) => [...l, e]);
        setSubidas((s) => s.filter((x) => x.id !== id));
        alguna = true;
      } catch (err: any) {
        setSubidas((s) => s.map((x) => (x.id === id ? { ...x, error: err.message } : x)));
      }
    }
    if (alguna) onChange();
  }, [a.id, editable, onChange]);

  // Pegar una captura (Ctrl+V) mientras se ve la pestaña: va directo como figura.
  useEffect(() => {
    if (!editable) return;
    const f = (ev: ClipboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const archivos = Array.from(ev.clipboardData?.files ?? []).filter((x) => x.type.startsWith("image/"));
      if (!archivos.length) return;
      ev.preventDefault();
      const ahora = marcaDeTiempo();
      subirArchivos(archivos, archivos.map((x, i) => (x.name && x.name !== "image.png" ? "" : `Captura pegada el ${ahora}${archivos.length > 1 ? ` (${i + 1})` : ""}`)));
    };
    window.addEventListener("paste", f);
    return () => window.removeEventListener("paste", f);
  }, [editable, subirArchivos]);

  const ordenar = async (nueva: Evidencia[]) => {
    const previa = lista;
    setLista(nueva);
    try {
      setLista(await guardado.con(() => apiFetch<Evidencia[]>(`${AUD_API}/informes/${a.id}/evidencias/orden`, { method: "POST", body: JSON.stringify({ ids: nueva.map((e) => e.id) }) })));
      onChange();
    } catch (err: any) { setLista(previa); setError(err.message); }
  };
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= lista.length) return;
    const l = [...lista];
    [l[i], l[j]] = [l[j], l[i]];
    ordenar(l);
  };
  const soltar = (destino: string) => {
    if (!arrastrada || arrastrada === destino) return;
    const l = lista.filter((e) => e.id !== arrastrada);
    const movida = lista.find((e) => e.id === arrastrada)!;
    const idx = l.findIndex((e) => e.id === destino);
    const desde = lista.findIndex((e) => e.id === arrastrada);
    l.splice(desde < lista.findIndex((e) => e.id === destino) ? idx + 1 : idx, 0, movida);
    ordenar(l);
  };
  const guardar = async (e: Evidencia, cambios: { titulo: string; nota: string; hallazgo_id: string }) => {
    const r = await guardado.con(() => apiFetch<Evidencia>(`${AUD_API}/informes/${a.id}/evidencias/${e.id}`, {
      method: "PATCH", body: JSON.stringify({ titulo: cambios.titulo.trim(), nota: cambios.nota, hallazgo_id: cambios.hallazgo_id }),
    }));
    setLista((l) => l.map((x) => (x.id === e.id ? r : x)));
    onChange();
  };
  const confirmarQuitar = async () => {
    if (!quitar) return;
    setOcupado(true);
    try {
      await guardado.con(() => apiFetch(`${AUD_API}/informes/${a.id}/evidencias/${quitar.id}`, { method: "DELETE" }));
      olvidarImagen(quitar.id);
      setLista((l) => l.filter((x) => x.id !== quitar.id));
      setQuitar(null);
      onChange();
    } catch (err: any) { setError(err.message); setQuitar(null); } finally { setOcupado(false); }
  };

  const puedeVoi = !!voi?.habilitado && editable;
  const [puedeCapturar, setPuedeCapturar] = useState(false);
  const [capturando, setCapturando] = useState(false);
  useEffect(() => { setPuedeCapturar(!!(navigator.mediaDevices as any)?.getDisplayMedia && window.matchMedia("(min-width: 768px)").matches); }, []);
  const elegir = async () => {
    const archivos = await elegirImagenes(input.current);
    if (archivos?.length) subirArchivos(archivos);
  };
  const capturar = async () => {
    setCapturando(true);
    setError(null);
    try {
      const f = await capturarPantalla();
      if (f) await subirArchivos([f], [f.name.replace(/\.png$/, "")]);
    } catch (err: any) { setError(`No se pudo capturar la pantalla: ${err.message}`); } finally { setCapturando(false); }
  };

  return (
    <div className="space-y-5"
      onDragOver={(ev) => { if (editable && ev.dataTransfer.types.includes("Files")) { ev.preventDefault(); setSobreZona(true); } }}
      onDragLeave={(ev) => { if (ev.currentTarget === ev.target) setSobreZona(false); }}
      onDrop={(ev) => {
        if (!editable || !ev.dataTransfer.files.length) return;
        ev.preventDefault();
        setSobreZona(false);
        subirArchivos(Array.from(ev.dataTransfer.files));
      }}>
      {/* Cabecera */}
      <div className="card p-5">
      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl text-brand-ink uppercase leading-tight">Evidencia visual</h2>
          <p className="mt-1 text-sm text-brand-slate max-w-3xl leading-relaxed">
            Figuras numeradas del informe: gráficos sumados desde Voi y capturas o fotos que aporta el auditor. Salen en este
            orden en el informe ejecutivo, en el extenso y en el PDF, con su lectura y el hallazgo que respaldan.
          </p>
          <div className="mt-2 text-xs text-brand-slate">
            <span className="font-semibold text-brand-ink">{lista.length}</span> {lista.length === 1 ? "figura" : "figuras"}
            {" · "}<span className="font-semibold text-brand-ink">{graficos}</span> {graficos === 1 ? "gráfico de Voi" : "gráficos de Voi"}
            {" · "}<span className="font-semibold text-brand-ink">{imagenes}</span> {imagenes === 1 ? "imagen" : "imágenes"}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {puedeVoi && (
            <button type="button" onClick={() => voi!.investigarInforme(a.id).catch((err: any) => setError(err.message))} className="btn-secondary">
              <VoiIsotipo size={16} /> Investigar con Voi
            </button>
          )}
          {editable && puedeCapturar && (
            <button type="button" data-voi="capturar" onClick={capturar} disabled={capturando} className="btn-secondary" title="Captura una ventana (p. ej. el CRM) y la suma como figura, sin buscar archivos">
              {capturando ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />} Capturar pantalla
            </button>
          )}
          {editable && (
            <button type="button" data-voi="subir" onClick={elegir} className="btn-primary">
              <ImagePlus size={16} /> Subir imágenes
            </button>
          )}
        </div>
      </div>
          {/* Cómo funciona, en tres pasos. */}
          <ol className="mt-4 grid sm:grid-cols-3 gap-2.5">
            {[
              ["Investigá con Voi", "«Investigar con Voi» lo abre en modo auditor con este informe: busca alertas y arma gráficos."],
              ["Elegí las figuras", "Cada gráfico te lo ofrece como figura y marcás cuáles van. En el lienzo, con «Al informe»."],
              ["Sumá capturas y fotos", "Arrastralas, elegilas o pegalas con Ctrl + V. Salen numeradas en el informe y en el PDF."],
            ].map(([t, d], i) => (
              <li key={t} className="flex items-start gap-2.5 rounded-lg border border-brand-border bg-brand-bg-soft px-3 py-2.5">
                <span className="w-5 h-5 rounded-full bg-brand-ink text-white text-[11px] font-semibold grid place-items-center flex-shrink-0 mt-px">{i + 1}</span>
                <span className="text-xs text-brand-slate leading-snug"><span className="block text-sm font-semibold text-brand-ink">{t}</span>{d}</span>
              </li>
            ))}
          </ol>
      </div>
      <input ref={input} type="file" multiple accept={EXTENSIONES.join(",")} className="hidden"
        onChange={(ev) => { const f = Array.from(ev.target.files ?? []); ev.target.value = ""; subirArchivos(f); }} />

      {!editable && (
        <div className="card p-3 text-sm text-brand-slate flex items-center gap-2">
          <ShieldCheck size={16} className="text-brand-cyan" /> El informe está cerrado: su evidencia quedó fija. Reabrilo para sumar o cambiar figuras.
        </div>
      )}

      {/* Zona para soltar / pegar */}
      {editable && (
        <button type="button" onClick={elegir}
          className={`w-full rounded-lg border-2 border-dashed px-6 py-6 text-center transition-colors ${sobreZona ? "border-brand-cyan bg-brand-cyan/5" : "border-brand-border bg-white hover:border-brand-slate/50"}`}>
          <UploadCloud size={26} className={`mx-auto ${sobreZona ? "text-brand-cyan" : "text-brand-mist"}`} />
          <div className="mt-2 text-sm font-semibold text-brand-ink">{sobreZona ? "Soltá las imágenes para sumarlas" : "Arrastrá capturas o fotos, o hacé clic para elegirlas"}</div>
          <div className="mt-1 text-xs text-brand-slate">
            PNG, JPG, WebP o GIF de hasta {MAX_MB} MB. Se guardan sin metadatos (ubicación, dispositivo) en el almacenamiento persistente.
          </div>
          <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-brand-slate">
            <ClipboardPaste size={13} /> También podés pegar una captura con Ctrl + V{puedeCapturar ? " o usar «Capturar pantalla»" : ""}.
          </div>
        </button>
      )}

      {subidas.length > 0 && (
        <ul className="space-y-2">
          {subidas.map((s) => (
            <li key={s.id} className={`card p-3 flex items-center gap-3 ${s.error ? "border-brand-primary/40" : ""}`}>
              {s.error ? <X size={16} className="text-brand-primary" /> : <Loader2 size={16} className="animate-spin text-brand-cyan" />}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-brand-ink truncate">{s.nombre}</div>
                {s.error ? <div className="text-xs text-brand-primary">{s.error}</div> : (
                  <div className="mt-1.5 h-1.5 rounded-full bg-brand-bg overflow-hidden">
                    <div className="h-full rounded-full bg-brand-cyan transition-all" style={{ width: `${Math.max(4, s.progreso)}%` }} />
                  </div>
                )}
              </div>
              <span className="text-xs tabular-nums text-brand-slate">{s.error ? "" : s.progreso < 100 ? `${s.progreso}%` : "Procesando…"}</span>
              {s.error && (
                <button type="button" onClick={() => setSubidas((l) => l.filter((x) => x.id !== s.id))} className="btn-ghost px-2 py-1 text-xs">Descartar</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <div className="card p-3 text-sm text-brand-primary">{error}</div>}

      {lista.length === 0 && subidas.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-brand-bg text-brand-slate grid place-items-center"><ImagePlus size={22} /></div>
          <p className="mt-4 font-semibold text-brand-ink">Todavía no hay figuras</p>
          <p className="mt-1 text-sm text-brand-slate max-w-md mx-auto">
            Investigá con Voi en modo auditor: cada gráfico que te muestre te lo ofrece como figura. O subí capturas del CRM, fotos de legajos u otras pruebas.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {lista.map((e, i) => (
            <TarjetaFigura key={e.id} e={e} numero={i + 1} total={lista.length} editable={editable} hallazgos={a.hallazgos} nombre={nombre}
              onMover={(d) => mover(i, d)} onGuardar={(c) => guardar(e, c)} onQuitar={() => setQuitar(e)} onVer={() => setVisor(i)}
              arrastre={editable ? {
                draggable: true,
                "data-sobre": sobre === e.id && arrastrada !== e.id,
                onDragStart: (ev) => { setArrastrada(e.id); ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", e.id); },
                onDragOver: (ev) => { if (arrastrada) { ev.preventDefault(); ev.stopPropagation(); setSobre(e.id); } },
                onDrop: (ev) => { if (arrastrada) { ev.preventDefault(); ev.stopPropagation(); soltar(e.id); } setSobre(null); setArrastrada(null); },
                onDragEnd: () => { setSobre(null); setArrastrada(null); },
              } : {}} />
          ))}
        </div>
      )}

      {visor !== null && <Visor lista={lista} inicio={visor} onCerrar={() => setVisor(null)} nombre={nombre} hallazgos={a.hallazgos} />}
      <ConfirmDialog
        open={!!quitar}
        variant="danger"
        title="Quitar figura"
        confirmLabel="Quitar"
        loading={ocupado}
        onCancel={() => setQuitar(null)}
        onConfirm={confirmarQuitar}
        message={quitar && <>Se quita <b>«{quitar.titulo}»</b> del informe{quitar.tipo === "imagen" ? " y se borra la imagen del almacenamiento" : ""}. Las demás figuras se vuelven a numerar. Queda registrado en la bitácora.</>}
      />
    </div>
  );
}

/** Espera a que las imágenes de las figuras terminen de cargar (para imprimir o guardar el PDF completo). */
export async function esperarImagenes(maximoMs = 12000): Promise<void> {
  const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await pausa(400);
  const inicio = Date.now();
  while (Date.now() - inicio < maximoMs) {
    const cargando = document.querySelectorAll("[data-evidencia-cargando]").length;
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("img[data-evidencia]"));
    if (!cargando && imgs.every((i) => i.complete)) break;
    await pausa(150);
  }
  await pausa(250);
}

/** Índice de figuras (informe extenso). */
export function IndiceFiguras({ evidencias, hallazgos }: { evidencias: Evidencia[]; hallazgos: Hallazgo[] }) {
  const porId = useMemo(() => new Map(hallazgos.map((h) => [h.id, h])), [hallazgos]);
  return (
    <table className="w-full text-sm mb-4">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
          <th className="py-1.5 pr-3">Figura</th><th className="py-1.5 pr-3">Título</th><th className="py-1.5 pr-3">Tipo</th><th className="py-1.5">Respalda</th>
        </tr>
      </thead>
      <tbody>
        {evidencias.map((e, i) => (
          <tr key={e.id} className="border-b border-brand-border/60">
            <td className="py-1 pr-3 font-semibold whitespace-nowrap">{i + 1}</td>
            <td className="py-1 pr-3">{e.titulo}</td>
            <td className="py-1 pr-3 whitespace-nowrap">{e.tipo === "imagen" ? "Imagen" : NOMBRE_TIPO[e.spec?.tipo ?? ""] ?? "Gráfico"}</td>
            <td className="py-1">{(e.hallazgo_id && porId.get(e.hallazgo_id)?.codigo) || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
