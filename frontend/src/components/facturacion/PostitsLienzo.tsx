"use client";

import { useRef, useState } from "react";
import Draggable from "react-draggable";
import { COLORES_POSTIT, Marca, Postit } from "./RegistroSimulaciones";

const fecha = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("es-PY") : "");

/** Un post-it flotante: se arrastra desde su franja superior y se pega donde se suelte. */
function Nota({ pi, i, marcas, onMove, onEdit, onRemove }: {
  pi: Postit; i: number; marcas: Marca[];
  onMove: (x: number, y: number) => void; onEdit: (texto: string) => void; onRemove: () => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(pi.texto);
  const c = COLORES_POSTIT[pi.color] ?? COLORES_POSTIT.amarillo;
  const item = pi.item ? marcas.find((m) => m.key === pi.item) : null;
  return (
    <Draggable nodeRef={nodeRef} handle=".postit-handle" bounds="parent" position={{ x: pi.x ?? 0, y: pi.y ?? 0 }}
      onStop={(_, d) => onMove(Math.round(d.x), Math.round(d.y))}>
      <div ref={nodeRef} className="absolute top-0 left-0 w-[220px] pointer-events-auto shadow-lg rounded-sm text-[13px] text-brand-ink leading-snug select-none"
        style={{ background: c.bg, zIndex: 40 + i, rotate: `${i % 2 ? 0.8 : -0.8}deg` }}>
        <div className="postit-handle cursor-grab active:cursor-grabbing flex items-center justify-between px-2 py-1 rounded-t-sm"
          style={{ background: c.border }}>
          <span className="text-[10px] font-bold text-white/90 truncate">📝 {pi.autor || "sin guardar"}{pi.fecha ? ` · ${fecha(pi.fecha)}` : ""}</span>
          <span className="no-print flex items-center gap-1">
            <button onClick={() => { setTexto(pi.texto); setEditando(!editando); }} title="Editar texto" className="w-5 h-5 rounded text-[11px] text-white/90 hover:bg-white/30">✎</button>
            <button onClick={onRemove} title="Quitar post-it" className="w-5 h-5 rounded text-[11px] text-white/90 hover:bg-white/30">✕</button>
          </span>
        </div>
        <div className="px-3 py-2">
          {item && <div className="text-[10px] font-bold text-brand-ink/60 mb-1">📌 {item.label}</div>}
          {editando ? (
            <div className="no-print">
              <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} autoFocus className="w-full text-[13px] bg-white/70 border border-brand-border rounded p-1.5 leading-snug" />
              <div className="flex gap-2 mt-1">
                <button onClick={() => { if (texto.trim()) onEdit(texto.trim()); setEditando(false); }} className="text-[11px] font-bold text-brand-ink hover:underline">Guardar</button>
                <button onClick={() => setEditando(false)} className="text-[11px] text-brand-slate hover:underline">Cancelar</button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-line select-text">{pi.texto}</p>
          )}
        </div>
      </div>
    </Draggable>
  );
}

/** Capa de post-its sobre el lienzo de trabajo. El contenedor padre debe ser `relative`;
 *  esta capa lo cubre entero y solo las notas reciben el mouse. */
export function PostitsLienzo({ postits, setPostits, marcas }: { postits: Postit[]; setPostits: (p: Postit[]) => void; marcas: Marca[] }) {
  if (!postits.length) return null;
  const upd = (i: number, patch: Partial<Postit>) => setPostits(postits.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="absolute inset-0 pointer-events-none z-30">
      {postits.map((pi, i) => (
        <Nota key={pi.id ?? `nuevo-${i}`} pi={pi} i={i} marcas={marcas}
          onMove={(x, y) => upd(i, { x, y })}
          onEdit={(texto) => upd(i, { texto })}
          onRemove={() => setPostits(postits.filter((_, j) => j !== i))} />
      ))}
    </div>
  );
}
