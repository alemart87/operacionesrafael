"use client";

import { Eraser, PenLine } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { exportar } from "@/components/informe-diario/firma";

const TINTA = "#0F1116";

export interface FirmaPadRef {
  /** La firma recortada como PNG (null si no se dibujó nada). */
  imagen: () => string | null;
  limpiar: () => void;
}

/** Lienzo para firmar con el dedo, grande y en la pantalla (sin diálogos encima). */
export const FirmaPad = forwardRef<FirmaPadRef, { etiqueta: string; onCambio?: (vacio: boolean) => void; alto?: string }>(
  function FirmaPad({ etiqueta, onCambio, alto = "h-52" }, ref) {
    const lienzo = useRef<HTMLCanvasElement>(null);
    const dibujando = useRef(false);
    const ultimo = useRef<{ x: number; y: number } | null>(null);
    const [vacio, setVacio] = useState(true);
    // El aviso al padre va por una referencia: si cambia en cada render, no tiene que volver a preparar (y borrar) el lienzo.
    const aviso = useRef(onCambio);
    aviso.current = onCambio;

    const marcar = useCallback((v: boolean) => { setVacio(v); aviso.current?.(v); }, []);
    const preparar = useCallback(() => {
      const c = lienzo.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = TINTA;
      ctx.lineWidth = 2.8;
      marcar(true);
    }, [marcar]);
    useEffect(() => {
      preparar();
      // Al girar el celular cambia el tamaño: se vuelve a preparar (y se firma de nuevo).
      const girar = () => preparar();
      window.addEventListener("orientationchange", girar);
      return () => window.removeEventListener("orientationchange", girar);
    }, [preparar]);
    useImperativeHandle(ref, () => ({
      imagen: () => (lienzo.current && !vacio ? exportar(lienzo.current) : null),
      limpiar: preparar,
    }), [preparar, vacio]);

    const punto = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const bajar = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dibujando.current = true;
      ultimo.current = punto(e);
      const ctx = e.currentTarget.getContext("2d")!;
      ctx.beginPath();
      ctx.arc(ultimo.current.x, ultimo.current.y, 1.3, 0, Math.PI * 2);
      ctx.fillStyle = TINTA;
      ctx.fill();
      if (vacio) marcar(false);
    };
    const mover = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!dibujando.current || !ultimo.current) return;
      const p = punto(e);
      const ctx = e.currentTarget.getContext("2d")!;
      const medio = { x: (ultimo.current.x + p.x) / 2, y: (ultimo.current.y + p.y) / 2 };
      ctx.beginPath();
      ctx.moveTo(ultimo.current.x, ultimo.current.y);
      ctx.quadraticCurveTo(ultimo.current.x, ultimo.current.y, medio.x, medio.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ultimo.current = p;
    };
    const soltar = () => { dibujando.current = false; ultimo.current = null; };

    return (
      <div>
        <div className="relative rounded-lg border-2 border-dashed border-brand-border bg-white">
          <canvas ref={lienzo} className={`block w-full ${alto} touch-none cursor-crosshair rounded-lg`} aria-label={etiqueta}
            onPointerDown={bajar} onPointerMove={mover} onPointerUp={soltar} onPointerLeave={soltar} onPointerCancel={soltar} />
          <div className="pointer-events-none absolute left-6 right-6 bottom-12 border-b border-brand-mist/60" aria-hidden />
          {vacio && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-brand-mist text-base gap-2" aria-hidden>
              <PenLine size={18} /> Firmá acá con el dedo
            </div>
          )}
        </div>
        <div className="flex justify-end mt-1.5">
          <button type="button" onClick={preparar} disabled={vacio}
            className="min-h-[44px] px-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-slate hover:text-brand-ink disabled:opacity-40">
            <Eraser size={16} aria-hidden /> Borrar y volver a firmar
          </button>
        </div>
      </div>
    );
  },
);
