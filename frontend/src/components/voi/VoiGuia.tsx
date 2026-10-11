"use client";

/**
 * Voi como guía de la plataforma, fuera del panel:
 * - `GuiaFlotante`: la guía paso a paso (Anterior · Siguiente · Listo) que acompaña al usuario en la pantalla y resalta
 *   el botón o la zona de cada paso (los elementos marcados con data-voi="…").
 * - `Resalte`: el resaltado de un elemento cuando Voi abre una pantalla y señala dónde actuar.
 * - `AvisoVoi`: el aviso breve de que Voi abrió una pantalla, con «Volver».
 */
import { ArrowLeft, ArrowRight, Check, ListChecks, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { VoiIsotipo } from "./VoiIsotipo";
import { useVoi } from "./VoiProvider";

const CLASE = "voi-resaltado";

/** Busca el elemento del ancla (con reintentos: la pantalla puede estar cargando), lo resalta y lo trae a la vista. */
function useResalte(ancla: string | null | undefined, activo: boolean): boolean | null {
  const [encontrado, setEncontrado] = useState<boolean | null>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (!ancla || !activo) { setEncontrado(null); return; }
    let el: Element | null = null;
    let intentos = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setEncontrado(null);
    const buscar = () => {
      el = Array.from(document.querySelectorAll(`[data-voi="${ancla}"]`)).find((e) => (e as HTMLElement).offsetParent !== null) ?? null;
      if (el) {
        el.classList.add(CLASE);
        (el as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
        setEncontrado(true);
      } else if (++intentos < 12) {
        timer = setTimeout(buscar, 300);
      } else {
        setEncontrado(false);
      }
    };
    buscar();
    return () => { if (timer) clearTimeout(timer); el?.classList.remove(CLASE); };
  }, [ancla, activo, pathname]);
  return encontrado;
}

/** El resaltado que pide `abrir_pantalla` (dura unos segundos). */
export function Resalte() {
  const voi = useVoi()!;
  const r = voi.resalte;
  const [vigente, setVigente] = useState(false);
  useEffect(() => {
    if (!r) { setVigente(false); return; }
    setVigente(true);
    const t = setTimeout(() => setVigente(false), Math.max(0, r.hasta - Date.now()));
    return () => clearTimeout(t);
  }, [r]);
  useResalte(r?.ancla, vigente && !voi.guia);
  return null;
}

export function GuiaFlotante() {
  const voi = useVoi()!;
  const pathname = usePathname();
  const g = voi.guia;
  const paso = g ? g.pasos[g.paso] : null;
  const enSuPantalla = !!g && pathname === g.ruta.split("#")[0];
  const encontrado = useResalte(paso?.ancla, !!g && enSuPantalla);
  if (!g || !paso) return null;
  const ultimo = g.paso >= g.pasos.length - 1;
  return (
    <section
      role="dialog"
      aria-label={`Guía de Voi: ${g.titulo}`}
      className="voi-burbuja no-print fixed z-[39] left-4 bottom-4 w-[min(400px,calc(100vw-2rem))] rounded-2xl border border-brand-border bg-white shadow-elevated overflow-hidden"
    >
      <div className="h-1 bg-brand-cyan" />
      <div className="px-4 pt-3 pb-3.5">
        <div className="flex items-center gap-2">
          <VoiIsotipo size={16} />
          <span className="text-[10px] font-bold uppercase tracking-wider2 text-brand-cyan">Guía de Voi</span>
          <span className="ml-auto text-[11px] text-brand-slate tabular-nums">Paso {g.paso + 1} de {g.pasos.length}</span>
          <button type="button" onClick={voi.cerrarGuia} aria-label="Cerrar la guía" className="p-1 rounded text-brand-mist hover:text-brand-ink hover:bg-brand-bg">
            <X size={15} />
          </button>
        </div>
        <h3 className="mt-1.5 text-sm font-semibold text-brand-ink leading-snug">{g.titulo}</h3>
        <div className="mt-2 flex gap-1" aria-hidden>
          {g.pasos.map((p, i) => (
            <span key={p.n} className={`h-1 flex-1 rounded-full ${i <= g.paso ? "bg-brand-cyan" : "bg-brand-border"}`} />
          ))}
        </div>
        <p className="mt-3 text-sm text-brand-graphite leading-relaxed">
          <span className="font-display text-lg text-brand-ink mr-2 align-middle">{paso.n}</span>{paso.texto}
        </p>
        {paso.ancla && enSuPantalla && encontrado === false && (
          <p className="mt-1.5 text-[11px] text-brand-slate">No veo ese botón en esta pantalla: puede que haga falta un permiso o que todavía no cargue.</p>
        )}
        {!enSuPantalla && (
          <button type="button" onClick={() => voi.navegarA(g.ruta, g.titulo)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline">
            Volver a la pantalla de la guía <ArrowRight size={12} />
          </button>
        )}
        {ultimo && g.nota && <p className="mt-2 text-xs text-brand-slate leading-snug border-l-2 border-brand-border pl-2">{g.nota}</p>}
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={() => voi.irAPaso(g.paso - 1)} disabled={g.paso === 0} className="btn-ghost px-2.5 py-1.5 text-xs disabled:opacity-40">
            <ArrowLeft size={14} /> Anterior
          </button>
          {ultimo ? (
            <button type="button" onClick={voi.cerrarGuia} className="btn-primary px-4 py-1.5 text-xs ml-auto"><Check size={14} /> Listo</button>
          ) : (
            <button type="button" onClick={() => voi.irAPaso(g.paso + 1)} className="btn-primary px-4 py-1.5 text-xs ml-auto">Siguiente <ArrowRight size={14} /></button>
          )}
        </div>
      </div>
    </section>
  );
}

/** «Voi abrió Ventas Netas · Subir corte» con «Volver», abajo al centro, unos segundos. */
export function AvisoVoi() {
  const voi = useVoi()!;
  const router = useRouter();
  const a = voi.aviso;
  useEffect(() => {
    if (!a) return;
    const t = setTimeout(() => voi.setAviso(null), 6500);
    return () => clearTimeout(t);
  }, [a, voi]);
  if (!a) return null;
  // Con una guía abierta (abajo), el aviso va arriba, bajo la cabecera.
  const posicion = voi.guia ? "top-[112px]" : "bottom-5";
  return (
    <div role="status" className={`voi-burbuja no-print fixed z-[45] ${posicion} left-1/2 -translate-x-1/2 max-w-[calc(100vw-2rem)]`}>
      <div className="inline-flex items-center gap-2.5 rounded-full bg-brand-ink text-white pl-2 pr-1.5 py-1.5 shadow-elevated text-sm">
        <span className="w-6 h-6 rounded-full bg-white grid place-items-center"><VoiIsotipo size={13} /></span>
        <span className="truncate">{a.texto}</span>
        {a.volver && (
          <button type="button" onClick={() => { voi.setAviso(null); router.back(); }} className="text-xs font-semibold text-white/85 hover:text-white underline underline-offset-2 whitespace-nowrap">
            Volver
          </button>
        )}
        <button type="button" onClick={() => voi.setAviso(null)} aria-label="Cerrar" className="w-6 h-6 rounded-full grid place-items-center text-white/70 hover:text-white hover:bg-white/10"><X size={13} /></button>
      </div>
    </div>
  );
}

/** Tarjeta del chat: la guía que Voi mostró, para volver a abrirla. */
export function TarjetaGuia({ guia, onVer, onNavegar }: { guia: { titulo: string; ruta: string; pasos: { n: number }[] }; onVer: () => void; onNavegar?: () => void }) {
  return (
    <div className="rounded-xl border border-brand-border bg-white p-3 flex items-center gap-3 animate-pop">
      <span className="w-10 h-10 rounded-lg bg-brand-cyan/10 text-brand-cyan grid place-items-center flex-shrink-0"><ListChecks size={18} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-brand-ink truncate">{guia.titulo}</span>
        <span className="block text-xs text-brand-slate">Guía paso a paso · {guia.pasos.length} pasos</span>
      </span>
      <button type="button" onClick={() => { onVer(); onNavegar?.(); }} className="btn-secondary px-3 py-1.5 text-xs whitespace-nowrap">Ver la guía</button>
    </div>
  );
}
