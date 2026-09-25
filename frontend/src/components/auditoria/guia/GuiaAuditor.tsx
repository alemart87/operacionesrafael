"use client";

import { ClipboardCheck, Clock, Flame, Lock, Printer, Radar, Scale, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { PrintCover, PrintHeader } from "@/components/PrintButton";
import { AUD_HREF } from "../tipos";
import { DIAS_PFI, fmt, type ReglasAuditoria } from "./datos";
import {
  Alertas, Checklist, Circuito, Glosario, Mapa, Patrones, PorQue, Recomendaciones, Recorrido, RiesgoCarga, SaliHablando, Semaforo, SinUso,
} from "./secciones";

const INDICE: [string, string][] = [
  ["por-que", "Por qué auditamos"],
  ["recorrido", "El recorrido de una venta"],
  ["mapa", "Mapa de riesgos"],
  ["sali-hablando", "Sali Hablando"],
  ["sin-uso", "Líneas sin uso"],
  ["riesgo-carga", "Riesgo de la carga"],
  ["patrones", "Patrones de venta y entrega"],
  ["semaforo", "Semáforo del vendedor"],
  ["alertas", "Alertas de negocio"],
  ["checklist", "Checklist del auditor"],
  ["recomendaciones", "Recomendaciones tipo"],
  ["circuito", "Circuito del informe"],
  ["glosario", "Glosario"],
];
const num = (id: string) => String(INDICE.findIndex(([x]) => x === id) + 1).padStart(2, "0");

/**
 * Guía del auditor de ventas: esquemas de riesgo, qué verificar, recomendaciones y alertas
 * de negocio. Los umbrales llegan del motor de análisis (`r`), así que la guía siempre dice
 * lo mismo que el sistema aplica.
 */
export function GuiaAuditor({ r, delSistema }: { r: ReglasAuditoria; delSistema: boolean }) {
  const activo = useSeccionActiva();
  return (
    <div className="guia-auditor">
      <PrintCover titulo="Guía del auditor · Auditoría de Ventas" periodo="Televentas CLARO · riesgos, verificaciones, alertas y recomendaciones" leyenda="Guía generada el" />
      <PrintHeader titulo="Guía del auditor" subtitulo="Auditoría de Ventas · Televentas CLARO · umbrales vigentes del sistema" />
      <IndiceImpreso />

      <Portada r={r} delSistema={delSistema} />
      <ReglasDeOro r={r} />

      <div className="xl:grid xl:grid-cols-[230px_minmax(0,1fr)] xl:gap-8 mt-10">
        <Indice activo={activo} />
        <div className="space-y-16 min-w-0">
          <PorQue r={r} num={num("por-que")} />
          <Recorrido r={r} num={num("recorrido")} />
          <Mapa r={r} num={num("mapa")} />
          <SaliHablando r={r} num={num("sali-hablando")} />
          <SinUso r={r} num={num("sin-uso")} />
          <RiesgoCarga r={r} num={num("riesgo-carga")} />
          <Patrones r={r} num={num("patrones")} />
          <Semaforo r={r} num={num("semaforo")} />
          <Alertas r={r} num={num("alertas")} />
          <Checklist num={num("checklist")} />
          <Recomendaciones num={num("recomendaciones")} />
          <Circuito num={num("circuito")} />
          <Glosario r={r} num={num("glosario")} />
          <footer className="border-t-2 border-brand-ink pt-3 flex flex-wrap justify-between gap-2 text-[11px] text-brand-slate">
            <span>Operaciones Voicenter · Auditoría de Ventas · Televentas CLARO</span>
            <span>{delSistema ? "Umbrales leídos del motor de análisis vigente" : "Umbrales de referencia (no se pudo leer el sistema)"} · {new Date().toLocaleDateString("es-PY", { day: "2-digit", month: "long", year: "numeric" })}</span>
          </footer>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ portada en pantalla
function Portada({ r, delSistema }: { r: ReglasAuditoria; delSistema: boolean }) {
  return (
    <header className="no-print relative overflow-hidden rounded-2xl bg-brand-ink text-white shadow-elevated">
      <div className="h-1.5 bg-brand-primary" />
      <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "radial-gradient(#ffffff 1px, transparent 1px)", backgroundSize: "18px 18px" }} aria-hidden />
      <div className="absolute -right-24 -top-24 w-80 h-80 rounded-full bg-brand-primary/20 blur-3xl" aria-hidden />
      <div className="relative grid lg:grid-cols-[minmax(0,1fr)_340px] gap-8 p-7 sm:p-10">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider2 text-white/60">
            <Radar size={14} className="text-brand-primary" /> Auditoría de Ventas · Televentas CLARO
          </div>
          <h1 className="font-display text-5xl sm:text-6xl uppercase leading-[0.95] mt-3">Guía del<br /><span className="text-brand-primary">auditor</span></h1>
          <p className="text-white/80 mt-4 max-w-2xl leading-relaxed">
            Cómo leer los riesgos que marca el sistema, qué verificar antes de concluir y qué recomendar: Sali Hablando, líneas sin uso, riesgo de la carga y patrones de venta y de entrega. Los umbrales de esta guía se leen del motor de análisis: son los mismos que aplica la plataforma.
          </p>
          <div className="flex flex-wrap gap-2 mt-5">
            {["Esquemas de riesgo", "Qué verificar", "Alertas de negocio", "Recomendaciones", "Checklist imprimible"].map((t) => (
              <span key={t} className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs text-white/85">{t}</span>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-7">
            <button type="button" onClick={() => window.print()} className="btn-primary inline-flex items-center gap-2"><Printer size={16} />Imprimir guía</button>
            <Link href={`${AUD_HREF}/riesgos`} className="inline-flex items-center gap-2 rounded-md border border-white/30 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">Ir a Riesgos</Link>
          </div>
        </div>
        <div className="grid sm:grid-cols-3 lg:grid-cols-1 gap-3 content-center">
          <Dato cifra={`${fmt(r.umbral_uso_pct)}%`} texto="umbral de uso por vendedor" />
          <Dato cifra={`${r.dias_sin_uso_antigua} días`} texto="sin uso: pasa a ser alerta PFI" />
          <Dato cifra={`~${DIAS_PFI} días`} texto="de la venta a la suspensión por PFI" />
          <div className={`sm:col-span-3 lg:col-span-1 text-[11px] flex items-center gap-1.5 ${delSistema ? "text-white/60" : "text-brand-orange"}`}>
            <span className={`w-2 h-2 rounded-full ${delSistema ? "bg-emerald-400" : "bg-brand-orange"}`} />
            {delSistema ? "Umbrales leídos del sistema en vivo" : "No se pudieron leer las reglas del sistema: se muestran las de referencia"}
          </div>
        </div>
      </div>
    </header>
  );
}

function Dato({ cifra, texto }: { cifra: string; texto: string }) {
  return (
    <div className="rounded-xl bg-white/[0.07] border border-white/10 px-4 py-3">
      <div className="font-display text-3xl sm:text-4xl leading-none">{cifra}</div>
      <div className="text-[11px] uppercase tracking-wider2 text-white/60 mt-1">{texto}</div>
    </div>
  );
}

// ------------------------------------------------------------------ reglas de oro
function ReglasDeOro({ r }: { r: ReglasAuditoria }) {
  const reglas: { icono: ReactNode; titulo: string; texto: string }[] = [
    { icono: <Scale size={20} />, titulo: "Una señal no es una prueba", texto: "El sistema marca patrones; la conclusión sale de la verificación y la evidencia." },
    { icono: <Flame size={20} />, titulo: "Primero lo que más pesa", texto: `Sali Hablando sin uso y líneas sin uso con ${r.dias_sin_uso_antigua}+ días: son las que terminan en PFI.` },
    { icono: <Clock size={20} />, titulo: "Actuá dentro de la ventana", texto: `La suspensión por PFI llega unos ${DIAS_PFI} días después de la venta. Antes, todavía se corrige.` },
    { icono: <ClipboardCheck size={20} />, titulo: "Hallazgo con dueño y fecha", texto: "Evidencia, responsable y compromiso. Lo que no se confirma se descarta con nota, no se borra." },
    { icono: <Lock size={20} />, titulo: "Cuidá los datos", texto: "Líneas y datos de clientes solo para destinatarios autorizados, también en el PDF." },
  ];
  return (
    <section className="mt-8">
      <div className="flex items-center gap-2 mb-3">
        <ShieldAlert size={18} className="text-brand-primary" />
        <h2 className="font-display text-2xl uppercase text-brand-ink">Cinco reglas de oro</h2>
      </div>
      <ol className="grid sm:grid-cols-2 lg:grid-cols-5 print:grid-cols-5 gap-3">
        {reglas.map((x, i) => (
          <li key={x.titulo} className="card p-4 border-t-[3px] border-t-brand-primary relative overflow-hidden">
            <span className="absolute -right-1 -top-3 font-display text-7xl text-brand-bg select-none" aria-hidden>{i + 1}</span>
            <span className="relative w-9 h-9 rounded-lg bg-brand-primary-light text-brand-primary grid place-items-center">{x.icono}</span>
            <div className="relative font-display text-xl uppercase text-brand-ink leading-none mt-3">{x.titulo}</div>
            <p className="relative text-[13px] text-brand-graphite leading-snug mt-1.5">{x.texto}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ------------------------------------------------------------------ índice
function Indice({ activo }: { activo: string }) {
  return (
    <>
      {/* Escritorio: índice fijo al costado */}
      <nav className="no-print hidden xl:block" aria-label="Contenido de la guía">
        <div className="sticky top-32 card p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider2 text-brand-slate px-2 mb-1.5">Contenido</div>
          <ol className="space-y-0.5">
            {INDICE.map(([id, t], i) => (
              <li key={id}>
                <a href={`#${id}`} className={`flex gap-2 rounded-md px-2 py-1.5 text-[13px] leading-tight transition-colors ${activo === id ? "bg-brand-ink text-white" : "text-brand-graphite hover:bg-brand-bg"}`}>
                  <span className={`font-display tabular-nums ${activo === id ? "text-brand-primary" : "text-brand-mist"}`}>{String(i + 1).padStart(2, "0")}</span>{t}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </nav>
      {/* Móvil y tablet: chips desplazables */}
      <nav className="no-print xl:hidden -mx-1 mb-8 overflow-x-auto" aria-label="Contenido de la guía">
        <ol className="flex gap-1.5 px-1 pb-1 w-max">
          {INDICE.map(([id, t], i) => (
            <li key={id}><a href={`#${id}`} className="block whitespace-nowrap rounded-full border border-brand-border bg-white px-3 py-1 text-xs text-brand-graphite hover:border-brand-primary"><b className="text-brand-primary mr-1">{String(i + 1).padStart(2, "0")}</b>{t}</a></li>
          ))}
        </ol>
      </nav>
    </>
  );
}

function IndiceImpreso() {
  return (
    <div className="print-only mb-6">
      <div className="font-display text-2xl uppercase text-brand-ink mb-2">Contenido</div>
      <ol className="columns-2 text-sm">
        {INDICE.map(([id, t], i) => <li key={id} className="py-0.5"><b className="text-brand-primary mr-2">{String(i + 1).padStart(2, "0")}</b>{t}</li>)}
      </ol>
    </div>
  );
}

/** Sección visible más arriba en pantalla, para marcarla en el índice. */
function useSeccionActiva(): string {
  const [activo, setActivo] = useState(INDICE[0][0]);
  useEffect(() => {
    const secciones = INDICE.map(([id]) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (!secciones.length || typeof IntersectionObserver === "undefined") return;
    const visibles = new Map<string, boolean>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visibles.set(e.target.id, e.isIntersecting);
        const primera = INDICE.find(([id]) => visibles.get(id));
        if (primera) setActivo(primera[0]);
      },
      { rootMargin: "-140px 0px -55% 0px" },
    );
    secciones.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, []);
  return activo;
}
