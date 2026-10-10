"use client";

import { Eraser, PenLine, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ErrorMsg, Modal } from "@/components/supervision/dialogos";
import { apiFetch } from "@/lib/api";
import { ID_API } from "./tipos";

const TINTA = "#0F1116";
const ANCHO_MAX = 600; // px de la imagen guardada (liviana para el PDF)

/** Recorta lo dibujado (sin márgenes transparentes) y lo devuelve como PNG de hasta 600 px de ancho. */
function exportar(lienzo: HTMLCanvasElement): string | null {
  const ctx = lienzo.getContext("2d");
  if (!ctx) return null;
  const { width: w, height: h } = lienzo;
  const px = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const escala = Math.min(1, ANCHO_MAX / cw);
  const out = document.createElement("canvas");
  out.width = Math.max(20, Math.round(cw * escala));
  out.height = Math.max(10, Math.round(ch * escala));
  out.getContext("2d")!.drawImage(lienzo, x0, y0, cw, ch, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

/** Dibujar la firma con el dedo, el lápiz o el mouse. Se guarda para usarla en cada informe. */
export function DialogoFirma({ actual, onClose, onGuardada }: {
  actual: string | null; onClose: () => void; onGuardada: (imagen: string | null) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const [vacio, setVacio] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preparar = useCallback(() => {
    const c = ref.current;
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
    ctx.lineWidth = 2.6;
    setVacio(true);
  }, []);
  useEffect(() => { preparar(); }, [preparar]);

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
    ctx.arc(ultimo.current.x, ultimo.current.y, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = TINTA;
    ctx.fill();
    setVacio(false);
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

  const guardar = async (imagen: string | null) => {
    setOcupado(true);
    setError(null);
    try {
      const r = imagen
        ? await apiFetch<{ imagen: string | null }>(`${ID_API}/firma`, { method: "PUT", body: JSON.stringify({ imagen }) })
        : await apiFetch<{ imagen: string | null }>(`${ID_API}/firma`, { method: "DELETE" });
      onGuardada(r.imagen);
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };

  return (
    <Modal onClose={onClose} sobre="Firma manuscrita" titulo="Dibujá tu firma" ancho="max-w-2xl"
      pie={<>
        {actual && <button type="button" className="btn-ghost text-brand-primary mr-auto" disabled={ocupado} onClick={() => guardar(null)}><Trash2 size={15} /> Borrar la guardada</button>}
        <button type="button" className="btn-secondary" onClick={preparar} disabled={vacio || ocupado}><Eraser size={15} /> Limpiar</button>
        <button type="button" className="btn-primary" disabled={vacio || ocupado}
          onClick={() => { const img = ref.current && exportar(ref.current); if (img) guardar(img); }}>
          <Save size={15} /> {ocupado ? "Guardando…" : "Guardar firma"}
        </button>
      </>}>
      <p className="text-xs text-brand-slate mb-3">Con el dedo en el celular, o con el mouse. Queda guardada para tus próximos informes; podés cambiarla cuando quieras.</p>
      <div className="relative rounded-md border-2 border-dashed border-brand-border bg-white">
        <canvas ref={ref} className="block w-full h-48 sm:h-56 touch-none cursor-crosshair rounded-md" aria-label="Lienzo para firmar"
          onPointerDown={bajar} onPointerMove={mover} onPointerUp={soltar} onPointerLeave={soltar} onPointerCancel={soltar} />
        <div className="pointer-events-none absolute left-6 right-6 bottom-10 border-b border-brand-mist/60" aria-hidden />
        {vacio && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-brand-mist text-sm gap-2" aria-hidden>
            <PenLine size={16} /> Firmá acá
          </div>
        )}
      </div>
      <ErrorMsg msg={error} />
    </Modal>
  );
}
