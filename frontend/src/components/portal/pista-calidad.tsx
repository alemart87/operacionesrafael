"use client";

/** La calidad de un feedback mientras se escribe: puntaje, si le falta profundidad o concisión y qué hacer. */
import { Check, Lightbulb } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { NIVEL_CALIDAD, SUP_API, type CalidadUno } from "@/components/supervision/tipos";
import { Etiqueta, cx } from "./ui";

export function PistaCalidad({ texto }: { texto: string }) {
  const [c, setC] = useState<CalidadUno | null>(null);
  useEffect(() => {
    const t = texto.trim();
    if (t.length < 3) { setC(null); return; }
    const id = setTimeout(() => {
      apiFetch<CalidadUno>(`${SUP_API}/portal/calidad`, { method: "POST", body: JSON.stringify({ texto: t }) }).then(setC).catch(() => {});
    }, 600);
    return () => clearTimeout(id);
  }, [texto]);
  if (!c) return <p className="text-[11px] text-brand-slate">Un buen feedback: qué viste, algo que hizo bien y qué tiene que hacer en la próxima llamada.</p>;
  const n = NIVEL_CALIDAD[c.nivel];
  return (
    <div className={cx("rounded-lg border p-3", c.nivel === "a_mejorar" ? "border-brand-orange/40 bg-brand-orange/5" : "border-brand-border bg-brand-bg-soft")} aria-live="polite">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-brand-ink">Calidad</span>
        <Etiqueta tono={n.tono}>{n.label} · {c.puntaje}</Etiqueta>
        {c.problema === "corto" && <Etiqueta tono="naranja">Le falta profundidad</Etiqueta>}
        {c.problema === "largo" && <Etiqueta tono="naranja">Muy largo</Etiqueta>}
        <span className="text-[11px] text-brand-slate tabular-nums ml-auto">{c.palabras} palabras</span>
      </div>
      {c.consejos?.[0] ? (
        <p className="text-sm text-brand-graphite mt-1.5 flex gap-1.5"><Lightbulb size={15} className="shrink-0 mt-0.5 text-[#C27A00]" aria-hidden />{c.consejos[0]}</p>
      ) : <p className="text-sm text-emerald-800 mt-1.5 flex gap-1.5"><Check size={15} className="shrink-0 mt-0.5" aria-hidden /> Completo: evidencia, acción, métrica y reconocimiento.</p>}
    </div>
  );
}

