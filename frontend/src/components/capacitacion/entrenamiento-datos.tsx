"use client";

import { useState } from "react";
import { GraduationCap, ListChecks } from "lucide-react";
import { Boton, Chips, Fallo, Hoja, cx } from "@/components/portal/ui";
import { apiFetch } from "@/lib/api";
import { CAP_API, type Canal, type Entrenamiento, type ModoEnt } from "./tipos";

const MODOS: { v: ModoEnt; icono: typeof ListChecks; nombre: string; ayuda: string }[] = [
  { v: "evaluado", icono: ListChecks, nombre: "Evaluado", ayuda: "Cuenta para el baremo: la IA lo evalúa y dice si se recomienda." },
  { v: "guiado", icono: GraduationCap, nombre: "Guiado · práctica", ayuda: "Un entrenador IA le va dando consejos en burbujas mientras chatea. No suma al baremo." },
];

/** Crear o editar los datos de un entrenamiento: evaluado o guiado (práctica con el entrenador IA y su guía), nombre,
 * para quién trabaja el asesor, lo que lee el postulante, la información oficial (la usa solo la IA) y las reglas. */
export function HojaDatosEntrenamiento({ ent, onClose, onListo }: { ent?: Entrenamiento; onClose: () => void; onListo: (id: string) => void }) {
  const [f, setF] = useState({
    nombre: ent?.nombre ?? "", empresa: ent?.empresa ?? "Claro", canal: (ent?.canal ?? "whatsapp") as Canal,
    instrucciones: ent?.instrucciones ?? "", producto: ent?.producto ?? "", umbral_info: ent?.umbral_info ?? 90, umbral_nivel: ent?.umbral_nivel ?? 8,
    modo: (ent?.modo ?? "evaluado") as ModoEnt, guia: ent?.guia ?? "",
  });
  // Ya enviado, no cambia de modo: las prácticas no se mezclan con las evaluaciones.
  const modoFijo = !!ent && ent.asignaciones.length > 0;
  const guiado = f.modo === "guiado";
  const [avanzado, setAvanzado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardar = async () => {
    setOcupado(true); setError(null);
    try {
      const r = await apiFetch<Entrenamiento>(ent ? `${CAP_API}/entrenamientos/${ent.id}` : `${CAP_API}/entrenamientos`,
        { method: ent ? "PATCH" : "POST", body: JSON.stringify({ ...f, instrucciones: f.instrucciones || null, guia: f.guia.trim(),
          ...(modoFijo ? { modo: undefined } : {}) }) });
      onListo(r.id);
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <Hoja titulo={ent ? "Datos del entrenamiento" : "Nuevo entrenamiento"} onClose={onClose} ocupada={ocupado}
      pie={<Boton onClick={guardar} ocupado={ocupado} disabled={f.nombre.trim().length < 2}>{ent ? "Guardar" : "Crear y cargar casos"}</Boton>}>
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Tipo de entrenamiento" className="grid sm:grid-cols-2 gap-2">
          {MODOS.map((m) => {
            const on = f.modo === m.v;
            return (
              <button key={m.v} type="button" role="radio" aria-checked={on} disabled={modoFijo && !on} onClick={() => setF({ ...f, modo: m.v })}
                className={cx("text-left rounded-xl border px-3.5 py-3 flex gap-3 transition-colors disabled:opacity-40",
                  on ? "border-brand-ink bg-white shadow-sm" : "border-brand-border bg-brand-bg-soft hover:border-brand-ink/40")}>
                <span className={cx("w-9 h-9 rounded-full flex items-center justify-center shrink-0", on ? "bg-brand-ink text-white" : "bg-white text-brand-slate border border-brand-border")}>
                  <m.icono size={18} aria-hidden /></span>
                <span className="min-w-0"><span className="block font-semibold text-[15px] text-brand-ink">{m.nombre}</span>
                  <span className="block text-[12px] text-brand-slate leading-snug">{m.ayuda}</span></span>
              </button>
            );
          })}
        </div>
        {modoFijo && <p className="text-[12px] text-brand-slate -mt-2">Ya se envió: no se puede cambiar entre evaluado y guiado (creá otro).</p>}
        <div><label className="label" htmlFor="en">Nombre</label>
          <input id="en" className="input" value={f.nombre} maxLength={120} placeholder="Ej.: Portabilidad Pospago" onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="ee">El asesor atiende para</label>
            <input id="ee" className="input" value={f.empresa} maxLength={80} onChange={(e) => setF({ ...f, empresa: e.target.value })} /></div>
          <div><span className="label">Canal</span>
            <Chips etiqueta="Canal" opciones={[{ v: "whatsapp", label: "WhatsApp" }, { v: "chat", label: "Chat web" }, { v: "llamada", label: "Llamada" }]}
              valor={[f.canal]} onChange={(v) => v[0] && setF({ ...f, canal: v[0] as Canal })} /></div>
        </div>
        <div><label className="label" htmlFor="ei">Instrucciones para el postulante</label>
          <textarea id="ei" className="input min-h-[72px]" value={f.instrucciones} maxLength={2000}
            placeholder="Ej.: Sos asesor de Claro. Atendé a cada cliente, averiguá qué necesita y ofrecé el plan que le sirva." onChange={(e) => setF({ ...f, instrucciones: e.target.value })} /></div>
        {guiado && (
          <div><label className="label" htmlFor="eg">Guía del entrenador</label>
            <p className="text-[12px] text-brand-slate -mt-1 mb-2">Lo que querés que practique, un paso por línea. El entrenador IA lo sigue en orden y le marca, en burbujas, qué hacer en su próximo mensaje, lo que hizo bien y los errores. No le escribe la respuesta.</p>
            <textarea id="eg" className="input min-h-[120px]" value={f.guia} maxLength={4000}
              placeholder={"Ej.:\nSaludá por el nombre y presentate\nPreguntá qué plan tiene hoy y cuánto paga\nOfrecé el plan que le sirve, con el precio exacto\nRespondé la objeción sin presionar\nProponé el cierre"} onChange={(e) => setF({ ...f, guia: e.target.value })} /></div>
        )}
        <div><label className="label" htmlFor="ep">Información oficial del producto (la IA corrige con esto)</label>
          <p className="text-[12px] text-brand-slate -mt-1 mb-2">Precios, planes, condiciones y promociones vigentes. Es la respuesta correcta para todos los casos: la IA revisa que el postulante dé la información así y, si se equivoca, le dice el dato correcto en su devolución. El cliente simulado no la ve.</p>
          <textarea id="ep" className="input min-h-[140px]" value={f.producto} maxLength={20000}
            placeholder={"Ej.:\nPlan Pospago 30 GB: 99.000 Gs por mes, llamadas ilimitadas.\nPortabilidad: conserva su número, demora 48 h hábiles…"} onChange={(e) => setF({ ...f, producto: e.target.value })} /></div>
        {guiado ? <p className="text-[13px] text-brand-slate">Es práctica: al terminar recibe su devolución, pero no se aprueba ni suma a la media, al mínimo ni a los recomendados.</p> : <>
        <button type="button" className="text-sm font-semibold text-brand-primary" onClick={() => setAvanzado(!avanzado)}>{avanzado ? "Ocultar" : "Ver"} las reglas para aprobar</button>
        {avanzado ? (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="ui">Información correcta en (%) de los casos</label>
              <input id="ui" className="input" inputMode="numeric" value={f.umbral_info} onChange={(e) => setF({ ...f, umbral_info: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div>
            <div><label className="label" htmlFor="un">Nivel comercial mínimo (1–10)</label>
              <input id="un" className="input" inputMode="numeric" value={f.umbral_nivel} onChange={(e) => setF({ ...f, umbral_nivel: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div>
          </div>
        ) : <p className="text-[13px] text-brand-slate -mt-2">Se aprueba con información correcta en el {f.umbral_info}% de los casos y nivel comercial de {f.umbral_nivel} o más.</p>}
        </>}
        {error && <Fallo>{error}</Fallo>}
      </div>
    </Hoja>
  );
}
