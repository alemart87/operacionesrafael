"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight, CircleCheck, CircleDashed, Minus, TriangleAlert } from "lucide-react";
import { n } from "@/components/productividad/tipos";
import { RESULTADO, dm, num, type Impacto, type LadoImpacto, type ResultadoImpacto } from "./tipos";

const ICONO: Record<ResultadoImpacto, typeof CircleCheck> = { mejoro: CircleCheck, igual: Minus, empeoro: TriangleAlert, sin_datos: CircleDashed };

/** Resultado del impacto (lo calcula el sistema): ícono y texto, nunca solo color. */
export function ResultadoChip({ r, delta, metrica, compacto }: { r: ResultadoImpacto; delta?: number | null; metrica?: string; compacto?: boolean }) {
  const x = RESULTADO[r];
  const I = ICONO[r];
  return (
    <span className={`inline-flex items-center gap-1 rounded border font-semibold whitespace-nowrap ${compacto ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]"} ${x.chip}`}>
      <I size={compacto ? 11 : 12} aria-hidden />
      {x.label}
      {delta !== null && delta !== undefined && r !== "sin_datos" && <span className="font-normal opacity-80 tabular-nums">· {formatoDelta(delta, metrica)}</span>}
    </span>
  );
}

function formatoDelta(delta: number, metrica?: string): string {
  const signo = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  const v = Math.abs(delta);
  return metrica === "pospago" || metrica === "gpon" ? `${signo}${num(v, 0)}%` : `${signo}${num(v)} pp`;
}

function valor(i: Impacto, l: LadoImpacto | undefined): string {
  if (!l || l.valor === null || l.valor === undefined) return "—";
  if (i.metrica === "pospago" || i.metrica === "gpon") return num(l.valor, 2);
  return `${num(l.valor)}%`;
}

function unidad(i: Impacto): string {
  if (i.metrica === "pospago" || i.metrica === "gpon") return "netas por hora";
  if (i.metrica === "uso") return "sin uso";
  return "de conversación";
}

function detalleLado(i: Impacto, l: LadoImpacto | undefined): string {
  if (!l) return "";
  if (i.metrica === "uso") return l.lineas ? `${n(l.sin_uso)} sin uso de ${n(l.lineas)} línea(s)` : "Sin líneas para comparar";
  const rango = l.desde ? (l.desde === l.hasta ? dm(l.desde) : `${dm(l.desde)} al ${dm(l.hasta)}`) : "sin días con datos";
  const dias = `${l.dias ?? 0} día(s)`;
  if (i.metrica === "pospago" || i.metrica === "gpon") return `${n(l.netas)} netas en ${num(l.horas)} h · ${dias} · ${rango}`;
  return `${num(l.horas)} h conectadas · ${dias} · ${rango}`;
}

function Lado({ titulo, i, l }: { titulo: string; i: Impacto; l: LadoImpacto | undefined }) {
  return (
    <div className="rounded-md border border-brand-border bg-white px-3.5 py-3 min-w-0">
      <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">{titulo}</div>
      <div className="flex items-baseline gap-1.5 mt-1 flex-wrap">
        <span className="font-display text-3xl text-brand-ink tabular-nums leading-none">{valor(i, l)}</span>
        <span className="text-[11px] text-brand-slate">{unidad(i)}</span>
      </div>
      <div className="text-[11px] text-brand-slate mt-1.5 leading-snug">{detalleLado(i, l)}</div>
    </div>
  );
}

/** Antes contra después de un coaching, con el resultado que calcula el sistema. */
export function ImpactoVista({ i, compacto }: { i: Impacto | null; compacto?: boolean }) {
  if (!i) return <p className="text-sm text-brand-slate">Todavía sin medición.</p>;
  if (!i.antes || i.metrica === "otra") {
    return (
      <div className="flex items-start gap-2 text-sm text-brand-slate">
        <ResultadoChip r={i.resultado} compacto={compacto} />
        <span className="text-xs leading-relaxed">{i.detalle}</span>
      </div>
    );
  }
  const subio = (i.delta ?? 0) > 0;
  const Flecha = i.delta === null ? ArrowRight : subio ? ArrowUpRight : i.delta < 0 ? ArrowDownRight : ArrowRight;
  const color = i.resultado === "mejoro" ? "text-emerald-700" : i.resultado === "empeoro" ? "text-brand-primary-dark" : "text-brand-slate";
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <Lado titulo="Antes" i={i} l={i.antes} />
        <Flecha size={18} className={color} aria-hidden />
        <Lado titulo="Después" i={i} l={i.despues} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <ResultadoChip r={i.resultado} delta={i.delta} metrica={i.metrica} />
        <span className={`text-[11px] font-semibold ${i.completo ? "text-brand-slate" : "text-[#1D5BA6]"}`}>
          {i.completo ? "Medición completa" : "En curso: el después suma días a medida que llegan los datos"}
        </span>
      </div>
      {!compacto && (
        <p className="text-[11px] text-brand-slate leading-relaxed">
          {i.detalle}
          {i.banda ? ` Igual si la diferencia es menor a ${num(i.banda)}${i.metrica === "pospago" || i.metrica === "gpon" ? "%" : " puntos"}.` : ""}
        </p>
      )}
    </div>
  );
}
