"use client";

/**
 * Gráficos livianos del analizador y del coaching del día (sin librerías): barras verticales y horizontales con el
 * detalle al pasar o tocar, medidores y el mapa de palabras. Una sola serie por gráfico (el título la nombra), colores
 * de la marca y el texto siempre en los tonos de texto.
 */
import { useEffect, useMemo, useRef, useState } from "react";

const CYAN = "#00B2BF";
const TINTA = "#0F1116";
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ------------------------------------------------------------------ barras verticales
export function BarrasV({ datos, alto = 150, etiqueta, detalle, marcas }: {
  datos: { clave: string; valor: number }[]; alto?: number;
  /** Lo que se lee debajo de cada barra (se muestran algunas si son muchas). */
  etiqueta: (clave: string, i: number) => string;
  detalle: (clave: string, valor: number) => string;
  marcas?: number;
}) {
  const [sobre, setSobre] = useState<number | null>(null);
  const max = Math.max(1, ...datos.map((d) => d.valor));
  const cada = Math.max(1, Math.ceil(datos.length / (marcas ?? 8)));
  // La última etiqueta se muestra si no queda pegada a la anterior.
  const resto = (datos.length - 1) % cada;
  const conEtiqueta = (i: number) => i % cada === 0 || (i === datos.length - 1 && resto >= Math.ceil(cada * 0.75));
  return (
    <div>
      <div className="relative flex items-end gap-[3px]" style={{ height: alto }} onMouseLeave={() => setSobre(null)}>
        {datos.map((d, i) => (
          <button key={d.clave} type="button" className="relative flex-1 h-full flex items-end focus:outline-none min-w-0"
            aria-label={detalle(d.clave, d.valor)} onMouseEnter={() => setSobre(i)} onFocus={() => setSobre(i)}
            onClick={() => setSobre((s) => (s === i ? null : i))} onBlur={() => setSobre(null)}>
            <span className="w-full rounded-t-[4px] transition-colors" style={{
              height: `${d.valor ? Math.max(3, (d.valor / max) * 100) : 0}%`, background: sobre === i ? TINTA : CYAN,
            }} />
            {!d.valor && <span className="absolute bottom-0 inset-x-0 h-px bg-brand-border" aria-hidden />}
          </button>
        ))}
        {sobre !== null && (() => {
          const izq = (sobre + 0.5) / datos.length;
          return (
            <div className="absolute -top-1 z-10 pointer-events-none" style={{ left: `${izq * 100}%`, transform: `translate(${izq > 0.7 ? "-100%" : izq < 0.3 ? "0" : "-50%"}, -100%)` }}>
              <div className="rounded-md bg-brand-ink text-white text-xs px-2.5 py-1.5 shadow-elevated whitespace-nowrap font-semibold">
                {detalle(datos[sobre].clave, datos[sobre].valor)}
              </div>
            </div>
          );
        })()}
      </div>
      <div className="relative h-5 mt-1.5">
        {datos.map((d, i) => conEtiqueta(i) && (
          <span key={d.clave} className="absolute text-[10px] text-brand-slate tabular-nums -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${((i + 0.5) / datos.length) * 100}%` }}>{etiqueta(d.clave, i)}</span>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ barras horizontales (con el valor escrito)
export function BarrasH({ datos, formato = (v) => String(v), color = CYAN }: {
  datos: { etiqueta: string; valor: number; sub?: string }[]; formato?: (v: number) => string; color?: string;
}) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  return (
    <ul className="space-y-2.5">
      {datos.map((d) => (
        <li key={d.etiqueta} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-brand-ink truncate">{d.etiqueta}{d.sub && <span className="text-brand-slate text-xs"> · {d.sub}</span>}</span>
            <span className="tabular-nums font-semibold text-brand-ink shrink-0">{formato(d.valor)}</span>
          </div>
          <div className="h-2 rounded-full bg-brand-bg mt-1 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(d.valor / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ medidor 0–100
export function Medidor({ valor, color = TINTA, alto = "h-2" }: { valor: number | null; color?: string; alto?: string }) {
  return (
    <div className={cx("w-full rounded-full bg-brand-bg overflow-hidden", alto)} role="img" aria-label={valor === null ? "Sin datos" : `${Math.round(valor)} de 100`}>
      {valor !== null && <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, valor))}%`, background: color }} />}
    </div>
  );
}

// ------------------------------------------------------------------ mapa de palabras
export const COLOR_ORIGEN = { feedback: "#2A2F3A", compromiso: "#662483", ambos: "#00808A" };
export type OrigenPalabra = keyof typeof COLOR_ORIGEN;

export interface PalabraMapa { texto: string; n: number; feedback: number; compromiso: number }

export function origenDe(p: PalabraMapa): OrigenPalabra {
  if (p.compromiso >= p.n * 0.65) return "compromiso";
  if (p.feedback >= p.n * 0.65) return "feedback";
  return "ambos";
}

interface Ubicada { p: PalabraMapa; x: number; y: number; w: number; h: number; tam: number }

/** Ubica las palabras en espiral desde el centro (la más frecuente al medio), sin que se pisen. */
function ubicar(palabras: PalabraMapa[], ancho: number, alto: number): Ubicada[] {
  if (!palabras.length || ancho < 50) return [];
  const lienzo = document.createElement("canvas").getContext("2d");
  const max = Math.max(...palabras.map((p) => p.n));
  const min = Math.min(...palabras.map((p) => p.n));
  const chico = ancho < 480 ? 13 : 14;
  const grande = ancho < 480 ? 34 : 50;
  const puestas: Ubicada[] = [];
  const choca = (a: { x: number; y: number; w: number; h: number }) =>
    a.x < 2 || a.y < 2 || a.x + a.w > ancho - 2 || a.y + a.h > alto - 2 ||
    puestas.some((b) => a.x < b.x + b.w + 4 && a.x + a.w + 4 > b.x && a.y < b.y + b.h + 2 && a.y + a.h + 2 > b.y);
  for (const p of palabras) {
    const t = max === min ? 0.6 : Math.sqrt((p.n - min) / (max - min));
    const tam = Math.round(chico + (grande - chico) * t);
    if (lienzo) lienzo.font = `700 ${tam}px Manrope, system-ui, sans-serif`;
    const w = Math.ceil(lienzo ? lienzo.measureText(p.texto).width : p.texto.length * tam * 0.6);
    const h = Math.ceil(tam * 1.1);
    for (let k = 0; k < 2200; k++) {
      const ang = k * 0.32;
      const r = 3.2 * ang;
      const x = ancho / 2 + r * Math.cos(ang) * (ancho / alto) * 0.9 - w / 2;
      const y = alto / 2 + r * Math.sin(ang) - h / 2;
      if (!choca({ x, y, w, h })) {
        puestas.push({ p, x, y, w, h, tam });
        break;
      }
    }
  }
  return puestas;
}

export function MapaPalabras({ palabras, onElegir, elegida }: {
  palabras: PalabraMapa[]; onElegir?: (texto: string) => void; elegida?: string | null;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAncho(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const alto = Math.round(Math.min(440, Math.max(300, ancho * 0.62)));
  const puestas = useMemo(() => (ancho ? ubicar(palabras.slice(0, ancho < 480 ? 45 : 70), ancho, alto) : []), [palabras, ancho, alto]);
  return (
    <div ref={caja} className="w-full">
      {ancho > 0 && (
        <svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img"
          aria-label={`Mapa de palabras: ${palabras.slice(0, 10).map((p) => `${p.texto} (${p.n})`).join(", ")}`}>
          {puestas.map(({ p, x, y, h, tam }) => {
            const on = elegida === p.texto;
            return (
              <text key={p.texto} x={x} y={y + h * 0.82} fontSize={tam} fontWeight={700} fontFamily="Manrope, system-ui, sans-serif"
                fill={COLOR_ORIGEN[origenDe(p)]} opacity={elegida && !on ? 0.35 : 1}
                className={onElegir ? "cursor-pointer" : undefined} onClick={() => onElegir?.(p.texto)}
                style={{ textDecoration: on ? "underline" : undefined }}>
                <title>{`${p.texto}: ${p.n} veces (${p.feedback} en el feedback, ${p.compromiso} en los compromisos)`}</title>
                {p.texto}
              </text>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export function LeyendaOrigen() {
  const items: [OrigenPalabra, string][] = [["feedback", "Más en el feedback"], ["compromiso", "Más en los compromisos"], ["ambos", "En los dos"]];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-brand-slate">
      {items.map(([k, t]) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLOR_ORIGEN[k] }} aria-hidden /> {t}
        </span>
      ))}
    </div>
  );
}
