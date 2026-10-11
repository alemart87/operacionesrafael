"use client";

/**
 * Las figuras del informe diario: los gráficos que Voi, el agente, suma desde su lienzo (gráficos, indicadores, tablas o
 * tableros) y las imágenes que sube el autor (capturas, fotos), como la evidencia del informe de auditoría. En el editor
 * se retocan (título y lectura), se quitan, se suben imágenes y cada gráfico se captura como imagen para el PDF; en la
 * lectura se ven como salen en el informe.
 */
import { Camera, ClipboardPaste, ImageIcon, ImageOff, ImagePlus, Loader2, Sparkles, Trash2, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { pngPiezaDe } from "@/components/voi/lienzo/captura";
import { NOMBRE_TIPO } from "@/components/voi/lienzo/iconos";
import { CuerpoPieza } from "@/components/voi/lienzo/VoiGrafico";
import { VoiIsotipo } from "@/components/voi/VoiIsotipo";
import { useVoi } from "@/components/voi/VoiProvider";
import { apiFetch, getToken, refreshSession } from "@/lib/api";
import { EXTENSIONES_IMAGEN, capturarPantalla, elegirImagenes, esImagen, marcaDeTiempo, puedeCapturarPantalla } from "@/lib/imagenes";
import { Seccion } from "./campos";
import { ID_API, MAX_FIGURAS, MAX_IMAGEN_MB, type FiguraInforme } from "./tipos";

/** Ancho con el que se dibuja cada gráfico (como en el informe de auditoría): la captura para el PDF sale siempre igual. */
const ANCHO = 960;
const EXTENSIONES = EXTENSIONES_IMAGEN;

const nombreTipo = (f: FiguraInforme) => (f.tipo === "imagen" ? "Imagen" : NOMBRE_TIPO[f.spec?.tipo ?? ""] ?? "Figura");
const origen = (f: FiguraInforme) =>
  f.tipo === "imagen" ? "la subió el autor" : f.origen === "voi" ? "la propuso Voi, el agente" : "elegida en el lienzo de Voi";

function Etiqueta({ f }: { f: FiguraInforme }) {
  return (
    <>
      <span className="inline-flex items-center rounded bg-brand-ink px-2 py-0.5 text-xs font-semibold text-white">Figura {f.figura}</span>
      <span className="text-xs text-brand-slate">{nombreTipo(f)} · {origen(f)}</span>
    </>
  );
}

// ------------------------------------------------------------------ imágenes con la sesión
// El <img> no manda el token: la imagen se pide con fetch y queda como URL local (una vez por figura).
const cache = new Map<string, Promise<string>>();
async function pedir(url: string, reintento = false): Promise<string> {
  const token = getToken();
  const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (r.status === 401 && !reintento && (await refreshSession())) return pedir(url, true);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return URL.createObjectURL(await r.blob());
}
function imagenDe(informeId: string, figuraId: string): Promise<string> {
  const clave = `${informeId}:${figuraId}`;
  let p = cache.get(clave);
  if (!p) {
    p = pedir(`${ID_API}/${informeId}/figuras/${figuraId}/imagen`);
    p.catch(() => cache.delete(clave));
    cache.set(clave, p);
  }
  return p;
}
function olvidar(informeId: string, figuraId: string) {
  const clave = `${informeId}:${figuraId}`;
  const p = cache.get(clave);
  cache.delete(clave);
  p?.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
}

/** La imagen que subió el autor (pedida con la sesión). */
function ImagenFigura({ informeId, figuraId, titulo }: { informeId: string; figuraId: string; titulo: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let vivo = true;
    setError(false);
    imagenDe(informeId, figuraId).then((u) => vivo && setSrc(u)).catch(() => vivo && setError(true));
    return () => { vivo = false; };
  }, [informeId, figuraId]);
  if (error) {
    return (
      <div className="mt-3 grid place-items-center rounded-lg border border-brand-border bg-brand-bg p-6 text-xs text-brand-mist">
        <span className="flex flex-col items-center gap-1.5"><ImageOff size={22} /> No se pudo cargar la imagen</span>
      </div>
    );
  }
  if (!src) return <div className="mt-3 shimmer-bar h-40 rounded-lg" aria-label="Cargando la imagen" />;
  return (
    <div className="mt-3 rounded-lg border border-brand-border bg-brand-bg-soft p-2 flex justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={titulo ?? "Imagen"} className="max-h-[420px] max-w-full object-contain rounded" draggable={false} />
    </div>
  );
}

/** El cuerpo de una figura como va en el informe: el gráfico (ancho fijo, sin interacción), el tablero con sus partes
 * o la imagen. Cada parte de un tablero va en un `[data-widget]`: así se compone la captura para el PDF. */
function CuerpoFigura({ informeId, f, caja }: { informeId: string; f: FiguraInforme; caja?: RefObject<HTMLDivElement> }) {
  if (f.tipo === "imagen" || !f.spec) return <ImagenFigura informeId={informeId} figuraId={f.id} titulo={f.titulo} />;
  if (f.spec.tipo === "tablero") {
    return (
      <div ref={caja} className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
        {(f.spec.widgets ?? []).map((w, i) => (
          <div key={i} data-widget={i} className={`rounded-lg border border-brand-border bg-white p-3 ${w.tipo === "kpis" || w.tipo === "tabla" || (f.spec!.widgets ?? []).length === 1 ? "xl:col-span-2" : ""}`}>
            <h4 className="text-sm font-semibold text-brand-ink mb-2">{w.titulo}</h4>
            <CuerpoPieza spec={w} fijo={ANCHO} compacto />
          </div>
        ))}
      </div>
    );
  }
  return <div ref={caja} className="mt-3"><CuerpoPieza spec={f.spec} fijo={ANCHO} compacto /></div>;
}

async function subirImagen(informeId: string, archivo: File): Promise<FiguraInforme> {
  const fd = new FormData();
  fd.append("archivo", archivo, archivo.name || "imagen.png");
  return apiFetch<FiguraInforme>(`${ID_API}/${informeId}/figuras/imagen`, { method: "POST", body: fd });
}

/** «Armar con Voi»: abre a Voi, el agente, en modo informe diario con este informe (o el de hoy) como destino. */
export function BotonArmarConVoi({ informeId, className = "btn-secondary !py-2 !px-3 text-xs", onError }: {
  informeId?: string; className?: string; onError?: (msg: string) => void;
}) {
  const voi = useVoi();
  const [ocupado, setOcupado] = useState(false);
  if (!voi?.habilitado) return null;
  const armar = async () => {
    setOcupado(true);
    try { await voi.armarInformeDiario(informeId); } catch (e: any) { onError?.(e.message); } finally { setOcupado(false); }
  };
  return (
    <button type="button" data-voi="armar-con-voi" className={className} onClick={armar} disabled={ocupado}
      title="Voi, el agente, mira los datos del día, propone el contenido y te ofrece gráficos como figuras">
      {ocupado ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Sparkles size={15} aria-hidden />} Armar con Voi
    </button>
  );
}

/** Mientras Voi está en modo informe diario con este informe, la sección lo dice: lo que sume aparece acá. */
function AvisoVoiActivo({ informeId }: { informeId: string }) {
  const voi = useVoi();
  if (!voi?.habilitado) return null;
  const inv = voi.investigacion;
  if (!inv || inv.tipo !== "informe_diario" || inv.informe_id !== informeId) return null;
  return (
    <div role="status" className="mb-3 flex items-center gap-3 rounded-lg border border-brand-purple/30 bg-brand-purple/[0.05] px-3 py-2.5">
      <span className="w-8 h-8 rounded-full bg-white border border-brand-border grid place-items-center flex-shrink-0">
        <VoiIsotipo size={16} estado={voi.chat.trabajando ? "pensando" : "quieto"} />
      </span>
      <div className="min-w-0 flex-1 leading-snug">
        <span className="block text-sm font-semibold text-brand-ink">Voi, el agente, está en modo informe diario con este informe.</span>
        <span className="block text-xs text-brand-slate">Lo que sume desde el chat o el lienzo aparece acá; vos revisás y firmás.</span>
      </div>
      {!voi.abierto && (
        <button type="button" onClick={voi.abrir} className="btn-secondary !py-1.5 !px-3 text-xs whitespace-nowrap">Abrir a Voi</button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ editor
function TarjetaFigura({ f, informeId, ocupado, onEditar, onQuitar, onCapturada, onError }: {
  f: FiguraInforme;
  informeId: string;
  ocupado: boolean;
  onEditar: (f: FiguraInforme, cambios: { titulo?: string; nota?: string }) => Promise<void>;
  onQuitar: (f: FiguraInforme) => void;
  onCapturada: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const [titulo, setTitulo] = useState(f.titulo ?? "");
  const [nota, setNota] = useState(f.nota ?? "");
  const caja = useRef<HTMLDivElement>(null);
  const capturable = f.tipo !== "imagen" && !!f.spec;
  const [captura, setCaptura] = useState<"no" | "preparando" | "lista" | "error">(f.imagen ? "lista" : capturable ? "preparando" : "no");
  useEffect(() => { setTitulo(f.titulo ?? ""); setNota(f.nota ?? ""); }, [f.titulo, f.nota]);
  useEffect(() => { if (f.imagen) setCaptura("lista"); }, [f.imagen]);

  // La captura para el PDF: el gráfico ya dibujado se convierte en PNG y se guarda en el informe, una sola vez.
  const spec = useRef(f.spec);
  spec.current = f.spec;
  const intentada = useRef(false);
  useEffect(() => {
    if (f.imagen || !capturable) return;
    let cancelado = false;
    const t = setTimeout(async () => {
      if (intentada.current || !spec.current) return;
      intentada.current = true;
      try {
        const blob = await pngPiezaDe(caja.current, spec.current, { titulo: false, pie: false, ancho: ANCHO });   // el PDF imprime el título y la fuente
        if (!blob) { setCaptura("no"); return; }
        const fd = new FormData();
        fd.append("archivo", blob, "figura.png");
        await apiFetch(`${ID_API}/${informeId}/figuras/${f.id}/imagen`, { method: "POST", body: fd });
        if (!cancelado) setCaptura("lista");
        onCapturada(f.id);
      } catch (e: any) {
        if (!cancelado) { setCaptura("error"); onError(`No se pudo guardar la imagen de la figura ${f.figura}: ${e.message}`); }
      }
    }, 700);
    return () => { cancelado = true; clearTimeout(t); };
  }, [f.id, f.figura, f.imagen, capturable, informeId, onCapturada, onError]);

  const estadoCaptura = {
    lista: { texto: "Imagen lista para el PDF", cls: "text-emerald-700", Icono: ImageIcon, girar: false },
    preparando: { texto: "Preparando la imagen para el PDF…", cls: "text-brand-slate", Icono: Loader2, girar: true },
    error: { texto: "En el PDF va con sus datos", cls: "text-brand-slate", Icono: ImageIcon, girar: false },
    no: { texto: "En el PDF va con sus datos", cls: "text-brand-slate", Icono: ImageIcon, girar: false },
  }[captura];

  return (
    <li className="rounded-lg border border-brand-border bg-white p-3 sm:p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Etiqueta f={f} />
        <span className={`ml-auto inline-flex items-center gap-1 text-[11px] ${estadoCaptura.cls}`} role="status">
          <estadoCaptura.Icono size={12} className={estadoCaptura.girar ? "animate-spin" : ""} aria-hidden /> {estadoCaptura.texto}
        </span>
        <button type="button" onClick={() => onQuitar(f)} disabled={ocupado} className="btn-ghost !p-1.5 hover:text-brand-primary" aria-label={`Quitar la figura ${f.figura}`} title="Quitar del informe">
          {ocupado ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
        </button>
      </div>
      <input className="input font-semibold mt-2" maxLength={255} value={titulo} aria-label={`Título de la figura ${f.figura}`}
        placeholder="Título: la conclusión que muestra" onChange={(e) => setTitulo(e.target.value)}
        onBlur={() => {
          const t = titulo.trim();
          if (!t) setTitulo(f.titulo ?? "");
          else if (t !== (f.titulo ?? "")) onEditar(f, { titulo: t });
        }} />
      <CuerpoFigura informeId={informeId} f={f} caja={caja} />
      <textarea className="input text-sm resize-y mt-2" rows={2} maxLength={4000} value={nota} aria-label={`Lectura de la figura ${f.figura}`}
        placeholder="Lectura para quien recibe el informe: qué muestra y por qué importa (opcional)" onChange={(e) => setNota(e.target.value)}
        onBlur={() => { if (nota.trim() !== (f.nota ?? "")) onEditar(f, { nota: nota.trim() }); }} />
    </li>
  );
}

/** La sección Figuras del editor: los gráficos de Voi y las imágenes del autor, editables mientras el informe es borrador. */
export function SeccionFiguras({ n, informeId, figuras, setFiguras, onError, onAviso }: {
  n: number;
  informeId: string;
  figuras: FiguraInforme[];
  setFiguras: (f: FiguraInforme[] | ((l: FiguraInforme[]) => FiguraInforme[])) => void;
  onError: (msg: string) => void;
  onAviso?: (msg: string) => void;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState<{ n: number; total: number } | null>(null);
  const [sobreZona, setSobreZona] = useState(false);
  const [capturando, setCapturando] = useState(false);
  const [puedeCapturar, setPuedeCapturar] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const lleno = figuras.length >= MAX_FIGURAS;
  useEffect(() => { setPuedeCapturar(puedeCapturarPantalla()); }, []);

  const recargar = useCallback(async () => {
    try {
      const d = await apiFetch<{ figuras?: FiguraInforme[] }>(`${ID_API}/${informeId}`);
      setFiguras(d.figuras ?? []);
    } catch { /* se reintenta con la próxima novedad */ }
  }, [informeId, setFiguras]);
  // Voi sumó figuras (desde el chat o desde el lienzo): la sección se actualiza sola.
  useEffect(() => {
    const f = () => { recargar(); };
    window.addEventListener("voi:figuras", f);
    return () => window.removeEventListener("voi:figuras", f);
  }, [recargar]);

  const editar = useCallback(async (f: FiguraInforme, cambios: { titulo?: string; nota?: string }) => {
    try {
      const r = await apiFetch<FiguraInforme>(`${ID_API}/${informeId}/figuras/${f.id}`, { method: "PATCH", body: JSON.stringify(cambios) });
      setFiguras((l) => l.map((x) => (x.id === f.id ? { ...x, ...r } : x)));
    } catch (e: any) { onError(e.message); }
  }, [informeId, setFiguras, onError]);
  const quitar = async (f: FiguraInforme) => {
    setOcupado(f.id);
    try {
      const r = await apiFetch<{ figuras: FiguraInforme[] }>(`${ID_API}/${informeId}/figuras/${f.id}`, { method: "DELETE" });
      olvidar(informeId, f.id);
      setFiguras(r.figuras);
      onAviso?.(`Se quitó la figura «${f.titulo ?? ""}» del informe.`);
    } catch (e: any) { onError(e.message); } finally { setOcupado(null); }
  };
  const capturada = useCallback((id: string) => setFiguras((l) => l.map((x) => (x.id === id ? { ...x, imagen: true } : x))), [setFiguras]);

  /** Capturas o fotos del autor: cada una queda como una figura más (procesada sin metadatos en el servidor). */
  const subirArchivos = useCallback(async (archivos: File[]) => {
    if (!archivos.length) return;
    const lista = archivos.filter((a) => a.size > 0 && esImagen(a)).slice(0, Math.max(0, MAX_FIGURAS - figuras.length));
    if (!lista.length) { onError(`El informe admite hasta ${MAX_FIGURAS} figuras: quitá alguna para sumar otra.`); return; }
    let ok = 0;
    for (let i = 0; i < lista.length; i++) {
      const a = lista[i];
      setSubiendo({ n: i + 1, total: lista.length });
      if (a.size > MAX_IMAGEN_MB * 1024 * 1024) { onError(`«${a.name}» supera ${MAX_IMAGEN_MB} MB.`); continue; }
      try {
        const f = await subirImagen(informeId, a);
        setFiguras((l) => [...l.filter((x) => x.id !== f.id), f]);
        ok += 1;
      } catch (e: any) { onError(`No se pudo subir «${a.name}»: ${e.message}`); }
    }
    setSubiendo(null);
    if (ok) onAviso?.(ok === 1 ? "Imagen agregada como figura del informe." : `${ok} imágenes agregadas como figuras del informe.`);
  }, [figuras.length, informeId, setFiguras, onError, onAviso]);
  /** El selector rápido del navegador (abre en el Escritorio y recuerda la carpeta); si no existe, el clásico. */
  const elegir = async () => {
    const archivos = await elegirImagenes(input.current, "figuras-informe-diario");
    if (archivos?.length) subirArchivos(archivos);
  };
  const capturar = async () => {
    setCapturando(true);
    try {
      const f = await capturarPantalla();
      if (f) await subirArchivos([f]);
    } catch (e: any) { onError(`No se pudo capturar la pantalla: ${e.message}`); } finally { setCapturando(false); }
  };
  // Pegar una captura con Ctrl + V (fuera de un campo de texto): va directo como figura.
  useEffect(() => {
    const f = (ev: ClipboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const archivos = Array.from(ev.clipboardData?.files ?? []).filter((x) => x.type.startsWith("image/"));
      if (!archivos.length) return;
      ev.preventDefault();
      const ahora = marcaDeTiempo();
      subirArchivos(archivos.map((x, i) => (x.name && x.name !== "image.png" ? x
        : new File([x], `Captura pegada el ${ahora}${archivos.length > 1 ? ` (${i + 1})` : ""}.png`, { type: x.type || "image/png" }))));
    };
    window.addEventListener("paste", f);
    return () => window.removeEventListener("paste", f);
  }, [subirArchivos]);

  return (
    <Seccion n={n} titulo="Figuras" id="figuras"
      sub="Gráficos que suma Voi, el agente, desde su lienzo, y capturas o fotos que subís vos. Van en el informe y en el PDF; acá retocás el título y la lectura."
      accion={(
        <div className="flex items-center gap-2 flex-wrap">
          <BotonArmarConVoi informeId={informeId} onError={onError} />
          {puedeCapturar && (
            <button type="button" data-voi="capturar-figura" className="btn-secondary !py-2 !px-3 text-xs" onClick={capturar} disabled={capturando || !!subiendo || lleno}
              title="Captura una ventana (p. ej. el CRM) y la agrega como figura, sin buscar archivos">
              {capturando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Camera size={15} aria-hidden />} Capturar pantalla
            </button>
          )}
          <button type="button" data-voi="subir-figura" className="btn-primary !py-2 !px-3.5 text-xs" onClick={elegir}
            disabled={!!subiendo || lleno} title={lleno ? `El informe admite hasta ${MAX_FIGURAS} figuras` : "Elegí una captura o una foto de tu computadora: queda como figura del informe"}>
            {subiendo ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ImagePlus size={15} aria-hidden />}
            {subiendo ? ` Subiendo ${subiendo.n} de ${subiendo.total}…` : " Agregar imagen al informe"}
          </button>
        </div>
      )}>
      <input ref={input} type="file" multiple accept={EXTENSIONES.join(",")} className="hidden"
        onChange={(ev) => { const f = Array.from(ev.target.files ?? []); ev.target.value = ""; subirArchivos(f); }} />
      <AvisoVoiActivo informeId={informeId} />
      <div
        onDragOver={(ev) => { if (!lleno && ev.dataTransfer.types.includes("Files")) { ev.preventDefault(); setSobreZona(true); } }}
        onDragLeave={(ev) => { if (ev.currentTarget === ev.target) setSobreZona(false); }}
        onDrop={(ev) => { if (!ev.dataTransfer.files.length) return; ev.preventDefault(); setSobreZona(false); subirArchivos(Array.from(ev.dataTransfer.files)); }}
        className={sobreZona ? "rounded-lg ring-2 ring-brand-cyan/60" : ""}>
        {!figuras.length ? (
          <button type="button" onClick={elegir}
            className="w-full rounded-md border-2 border-dashed border-brand-border px-5 py-6 text-center hover:border-brand-primary transition-colors">
            <UploadCloud size={24} className="mx-auto text-brand-mist" aria-hidden />
            <span className="mt-2 block text-sm font-semibold text-brand-ink">Todavía no hay figuras</span>
            <span className="mt-1 block text-sm text-brand-slate">
              Pedile a Voi un gráfico del día («Mostrame en un gráfico la productividad de hoy») y tocá «Agregar al informe diario», o agregá una
              captura o una foto: hacé clic acá para elegirla, arrastrala o pegala con Ctrl + V.
            </span>
          </button>
        ) : (
          <ul className="space-y-4">
            {figuras.map((f) => (
              <TarjetaFigura key={f.id} f={f} informeId={informeId} ocupado={ocupado === f.id} onEditar={editar} onQuitar={quitar}
                onCapturada={capturada} onError={onError} />
            ))}
          </ul>
        )}
      </div>
      <p className="mt-2 text-[11px] text-brand-slate inline-flex items-start gap-1.5">
        <ClipboardPaste size={13} className="shrink-0 mt-px" aria-hidden />
        <span>
          {lleno ? `El informe admite hasta ${MAX_FIGURAS} figuras: quitá alguna para sumar otra.`
            : `También podés pegar una captura con Ctrl + V o arrastrarla acá. Hasta ${MAX_FIGURAS} figuras por informe · PNG, JPG, WebP o GIF de hasta ${MAX_IMAGEN_MB} MB, guardados sin metadatos.`}
        </span>
      </p>
    </Seccion>
  );
}

// ------------------------------------------------------------------ lectura
/** Las figuras como salen en el informe firmado (o en el borrador que lee el superadmin). */
export function FigurasVista({ informeId, figuras }: { informeId: string; figuras: FiguraInforme[] }) {
  if (!figuras.length) return null;
  return (
    <Seccion titulo="Figuras" id="figuras" sub="Gráficos del lienzo de Voi e imágenes del autor: en el PDF van con su imagen.">
      <ul className="space-y-4">
        {figuras.map((f) => (
          <li key={f.id} className="rounded-lg border border-brand-border bg-white p-3 sm:p-4 break-inside-avoid">
            <div className="flex items-center gap-2 flex-wrap"><Etiqueta f={f} /></div>
            <h3 className="font-semibold text-brand-ink mt-2 break-words">{f.titulo}</h3>
            <CuerpoFigura informeId={informeId} f={f} />
            {f.nota && (
              <p className="mt-3 rounded-md border-l-4 border-l-brand-purple/60 bg-brand-purple/[0.04] px-3 py-2 text-sm text-brand-graphite whitespace-pre-line break-words">
                {f.nota}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Seccion>
  );
}
