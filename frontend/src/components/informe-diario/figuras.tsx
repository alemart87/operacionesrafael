"use client";

/**
 * Las figuras del informe diario: lo que el autor sumó desde el lienzo de Voi (gráficos, indicadores, tablas o
 * tableros). En el editor se retocan (título y lectura), se quitan y cada gráfico se captura como imagen para el PDF;
 * en la lectura se ven como salen en el informe.
 */
import { ImageIcon, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { NOMBRE_TIPO } from "@/components/voi/lienzo/iconos";
import { CuerpoPieza } from "@/components/voi/lienzo/VoiGrafico";
import { pngBlobDe } from "@/components/voi/lienzo/VoiLienzo";
import { useVoi } from "@/components/voi/VoiProvider";
import { apiFetch } from "@/lib/api";
import { Seccion } from "./campos";
import { ID_API, MAX_FIGURAS, type FiguraInforme } from "./tipos";

/** Ancho con el que se dibuja cada figura (como en el informe de auditoría): la captura para el PDF sale siempre igual. */
const ANCHO = 960;
/** Los tipos que se capturan como imagen; el resto (indicadores, tablas, tableros, dona) va al PDF con sus datos. */
const CAPTURABLES = new Set(["barras", "columnas", "lineas", "area", "apiladas"]);

const origen = (f: FiguraInforme) => (f.origen === "voi" ? "la propuso Voi" : "elegida en el lienzo de Voi");

function Etiqueta({ f }: { f: FiguraInforme }) {
  return (
    <>
      <span className="inline-flex items-center rounded bg-brand-ink px-2 py-0.5 text-xs font-semibold text-white">Figura {f.figura}</span>
      <span className="text-xs text-brand-slate">{NOMBRE_TIPO[f.spec?.tipo] ?? "Figura"} · {origen(f)}</span>
    </>
  );
}

/** El cuerpo de una figura como va en el informe (ancho fijo, sin interacción). */
function CuerpoFigura({ f, caja }: { f: FiguraInforme; caja?: RefObject<HTMLDivElement> }) {
  return <div ref={caja} className="mt-3"><CuerpoPieza spec={f.spec} fijo={ANCHO} compacto /></div>;
}

/** «Armar con Voi»: abre a Voi en modo informe diario con este informe (o el de hoy) como destino. */
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
    <button type="button" data-voi="armar-con-voi" className={className} onClick={armar} disabled={ocupado} title="Voi mira los datos del día, propone el contenido y te ofrece gráficos como figuras">
      {ocupado ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Sparkles size={15} aria-hidden />} Armar con Voi
    </button>
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
  const capturable = CAPTURABLES.has(f.spec?.tipo);
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
      if (intentada.current) return;
      intentada.current = true;
      try {
        const blob = await pngBlobDe(caja.current, spec.current, { titulo: false, pie: false });   // el PDF imprime el título y la fuente
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
      <CuerpoFigura f={f} caja={caja} />
      <textarea className="input text-sm resize-y mt-2" rows={2} maxLength={4000} value={nota} aria-label={`Lectura de la figura ${f.figura}`}
        placeholder="Lectura para quien recibe el informe: qué muestra y por qué importa (opcional)" onChange={(e) => setNota(e.target.value)}
        onBlur={() => { if (nota.trim() !== (f.nota ?? "")) onEditar(f, { nota: nota.trim() }); }} />
    </li>
  );
}

/** La sección Figuras del editor: las figuras del lienzo de Voi, editables mientras el informe es borrador. */
export function SeccionFiguras({ n, informeId, figuras, setFiguras, onError, onAviso }: {
  n: number;
  informeId: string;
  figuras: FiguraInforme[];
  setFiguras: (f: FiguraInforme[] | ((l: FiguraInforme[]) => FiguraInforme[])) => void;
  onError: (msg: string) => void;
  onAviso?: (msg: string) => void;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
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
      setFiguras(r.figuras);
      onAviso?.(`Se quitó la figura «${f.titulo ?? ""}» del informe.`);
    } catch (e: any) { onError(e.message); } finally { setOcupado(null); }
  };
  const capturada = useCallback((id: string) => setFiguras((l) => l.map((x) => (x.id === id ? { ...x, imagen: true } : x))), [setFiguras]);

  return (
    <Seccion n={n} titulo="Figuras" id="figuras"
      sub="Gráficos, indicadores y tablas del lienzo de Voi que van en el informe y en el PDF. Pedile a Voi un gráfico del día y sumalo con un toque; acá retocás el título y la lectura."
      accion={<BotonArmarConVoi informeId={informeId} onError={onError} />}>
      {!figuras.length ? (
        <div className="rounded-md border-2 border-dashed border-brand-border px-4 py-6 text-center">
          <p className="text-sm text-brand-slate">
            Todavía no hay figuras. Decile a Voi, por ejemplo, «Mostrame en un gráfico la productividad de hoy» y elegí sumarla al informe.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {figuras.map((f) => (
            <TarjetaFigura key={f.id} f={f} informeId={informeId} ocupado={ocupado === f.id} onEditar={editar} onQuitar={quitar}
              onCapturada={capturada} onError={onError} />
          ))}
        </ul>
      )}
      {figuras.length >= MAX_FIGURAS && <p className="mt-2 text-[11px] text-brand-slate">El informe admite hasta {MAX_FIGURAS} figuras.</p>}
    </Seccion>
  );
}

// ------------------------------------------------------------------ lectura
/** Las figuras como salen en el informe firmado (o en el borrador que lee el superadmin). */
export function FigurasVista({ figuras }: { figuras: FiguraInforme[] }) {
  if (!figuras.length) return null;
  return (
    <Seccion titulo="Figuras" id="figuras" sub="Del lienzo de Voi: en el PDF van con su imagen.">
      <ul className="space-y-4">
        {figuras.map((f) => (
          <li key={f.id} className="rounded-lg border border-brand-border bg-white p-3 sm:p-4 break-inside-avoid">
            <div className="flex items-center gap-2 flex-wrap"><Etiqueta f={f} /></div>
            <h3 className="font-semibold text-brand-ink mt-2 break-words">{f.titulo}</h3>
            <CuerpoFigura f={f} />
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
