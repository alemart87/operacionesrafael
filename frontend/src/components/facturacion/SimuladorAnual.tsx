"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { PrintButton, PrintCover } from "@/components/PrintButton";
import { Bloque } from "@/components/facturacion/Bloque";
import { HistoriaNegocio } from "@/components/facturacion/HistoriaNegocio";
import { ExplicacionCuadros, VeredictoCierre } from "@/components/facturacion/CierreNegocio";
import { ObservacionConceptosEERR, Verificado } from "@/components/facturacion/ConceptosLiquidacion";
import { Afectados, CAMPOS_AFECTABLES_CONVERGENTE, MesAfectadoEditor, ResumenAfectados, describirVariaciones, separarAfectados } from "@/components/facturacion/MesAfectado";
import { PostitsLienzo } from "@/components/facturacion/PostitsLienzo";
import { Nota, NotasSimulacion } from "@/components/facturacion/NotasSimulacion";
import { NumeroInput } from "@/components/facturacion/NumeroInput";
import { Marca, Marcable, Pin, Postit, RegistroSimulaciones, Snapshot } from "@/components/facturacion/RegistroSimulaciones";
import { VariablesNegocio } from "@/components/facturacion/VariablesNegocio";
import { VariablesGpon } from "@/components/facturacion/VariablesGpon";
import { AJUSTE_OPTIMIZAR_PCT, aplicarBonoUnico, aplicarPreset, BONO_UNICO_ESCALA, PRESET_INICIAL_MOVIL, quitarBonoUnico, ZAFRA_IDEAL } from "@/components/facturacion/presets";
import { CAMPOS_AFECTABLES, CAMPOS_AFECTABLES_GPON, CampoDef } from "@/components/facturacion/MesAfectado";
import { Lectura } from "@/components/televentas/Lectura";
import { apiFetch } from "@/lib/api";
import { formatGs, formatInt } from "@/lib/format";
import { dominiosAlineados } from "@/components/facturacion/ejes";
import { EstructuraOperativa } from "@/components/facturacion/EstructuraOperativa";
import { FichaSimulacion } from "@/components/facturacion/FichaSimulacion";

const M = (v: number) => `${Math.round(v / 1e6)}M`;

export type Negocio = "movil" | "gpon";

type EerrRow = [string, string | null, string | null, string];
type Cfg = {
  nombre: string; titulo: string; intro: string; paramsPath: string; anualPath: string;
  Variables: (props: { p: any; setP: (fn: any) => void; defaults: any; titulo?: string }) => React.ReactElement | null;
  campos: CampoDef[]; objetivoKey: string; objetivoLabel: string; unidad: string;
  textoSinBonos: string; textoConBonos: string; ajusteTxt: string; ajusteHint: string; ajustesTxt: string; cobrosTxt: string; devTxt: string; olaTxt: string;
  eerrRows: EerrRow[]; bonosCols: Array<[string, string]>; verificado: boolean; observacion: boolean;
  pHist: (p: any) => any;
  /** Convergente (móvil + GPON por la misma estructura): EERR con las dos secciones y los costos variables GPON. */
  eerrRowsConvergente?: EerrRow[];
};

/** Ideal convergente: 3 GPON por asesor y mes, además del pospago. */
const GPON_POR_ASESOR_IDEAL = 3;

/** Configuración por negocio: móvil (pospago) y GPON usan el MISMO simulador anual con sus
 *  propias variables, motor y etiquetas. */
const NEGOCIOS: Record<Negocio, Cfg> = {
  movil: {
    nombre: "Televentas Claro · pospago + GPON", titulo: "Simulador Convergente",
    intro: "Balance a 12 o 18 meses del negocio convergente: la misma estructura vende pospago y GPON. Seteás el mes 1 (objetivo, tarifas, zafra y estructura, dimensionada con el pospago); los meses siguientes cambian las ventas de pospago y los GPON por asesor (ideal 3). GPON entra con su modelo de facturación completo (cuota 1, bono fijo, cuota 2, legajos, mora, recálculo) sin agregar dotación: solo comisión, plus y operativos por venta GPON. Cada mes liquida la facturación de los dos negocios más los ajustes de los meses anteriores.",
    paramsPath: "/api/v1/televentas-claro/facturacion/convergente/parametros", anualPath: "/api/v1/televentas-claro/facturacion/convergente/anual",
    Variables: VariablesNegocio, campos: CAMPOS_AFECTABLES, objetivoKey: "objetivo_co", objetivoLabel: "objetivo CO", unidad: "ventas",
    textoSinBonos: "sin bono productividad ni bono efectividad", textoConBonos: "cada mes liquida según las escalas de Claro",
    ajusteTxt: "cuota 1, cuota 2 y plus de portabilidad", ajusteHint: "Simula una renegociación con Claro. No afecta bonos ni residual; las devoluciones por chargeback siguen los montos ajustados. La comisión y el plus de los vendedores son montos fijos por venta y no cambian con el ajuste: la mejora es íntegramente margen de Voicenter.",
    ajustesTxt: "residual, cuota 2, caídas", cobrosTxt: "cuota 2 y residual", devTxt: "chargebacks, legajos y devolución de bonos", olaTxt: "caídas del chargeback, recálculo del bono, legajos",
    eerrRows: [
      ["Ventas", "ventas", "int", "head"], ["INGRESOS DEL MES", null, null, "sep"],
      ["Activaciones (cuota 1)", "activaciones_cuota1", "gs", "row"], ["Plus portabilidad", "portabilidad", "gs", "row"],
      ["Bono productividad", "bono_productividad", "gs", "row"], ["Bono efectividad", "bono_efectividad", "gs", "row"], ["Bono adicional (a mano)", "bono_adicional", "gs", "row"],
      ["Facturación bruta", "facturacion_bruta", "gs", "sub"], ["AJUSTES DE COHORTES ANTERIORES", null, null, "sep"],
      ["+ Residual", "residual", "gs", "row"], ["+ Cuota 2", "cuota2", "gs", "row"], ["− Legajos", "legajos", "gs", "row"],
      ["− Devoluciones por caídas", "clawbacks", "gs", "row"], ["− Devolución bono efectividad", "clawback_bonos", "gs", "row"], ["− Recálculo bono productividad", "recalculo_productividad", "gs", "row"],
      ["INGRESO NETO LIQUIDADO", "ingreso_neto", "gs", "total"], ["COSTOS", null, null, "sep"],
      ["Estructura fija (salarios, cargas, cobertura adicional interior)", "_fijo", "gs", "row"], ["Comisiones de vendedores (con IPS y aguinaldo)", "_comisiones", "gs", "row"],
      ["Plus de vendedores (sin cargas)", "_plus", "gs", "row"], ["Logística de entregas", "_logistica", "gs", "row"], ["Operativos", "_operativos", "gs", "row"],
      ["TOTAL COSTOS", "costo_total", "gs", "sub"], ["RESULTADO", "resultado", "gs", "total"], ["Margen %", "margen_pct", "pct", "pct"], ["Acumulado", "acumulado", "gs", "pct"],
    ],
    bonosCols: [["Bono productividad", "bono_productividad"], ["Bono efectividad", "bono_efectividad"]], verificado: true, observacion: true,
    pHist: (p) => p,
    eerrRowsConvergente: [
      ["Ventas pospago", "ventas", "int", "head"], ["Activaciones GPON", "ventas_gpon", "int", "head"],
      ["POSPAGO · INGRESOS DEL MES", null, null, "sep"],
      ["Activaciones (cuota 1)", "activaciones_cuota1", "gs", "row"], ["Plus portabilidad", "portabilidad", "gs", "row"],
      ["Bono productividad", "bono_productividad", "gs", "row"], ["Bono efectividad", "bono_efectividad", "gs", "row"], ["Bono adicional (a mano)", "bono_adicional", "gs", "row"],
      ["POSPAGO · AJUSTES DE COHORTES ANTERIORES", null, null, "sep"],
      ["+ Residual", "residual", "gs", "row"], ["+ Cuota 2", "cuota2", "gs", "row"], ["− Legajos", "legajos", "gs", "row"],
      ["− Devoluciones por caídas", "clawbacks", "gs", "row"], ["− Devolución bono efectividad", "clawback_bonos", "gs", "row"], ["− Recálculo bono productividad", "recalculo_productividad", "gs", "row"],
      ["Ingreso neto pospago", "ingreso_neto_movil", "gs", "sub"],
      ["GPON · INGRESOS DEL MES", null, null, "sep"],
      ["Cuota 1 GPON", "gpon_activaciones_cuota1", "gs", "row"], ["Bono fijo GPON", "gpon_bono_fijo", "gs", "row"], ["Bono adicional GPON", "gpon_bono_adicional", "gs", "row"],
      ["GPON · AJUSTES DE COHORTES ANTERIORES", null, null, "sep"],
      ["+ Cuota 2 GPON", "gpon_cuota2", "gs", "row"], ["− Legajos GPON", "gpon_legajos", "gs", "row"], ["− Mora neta GPON (penalizaciones − reversos)", "gpon_mora", "gs", "row"],
      ["− Recálculo bono fijo GPON", "gpon_recalculo", "gs", "row"], ["− Otros reversos GPON", "gpon_otros", "gs", "row"],
      ["Ingreso neto GPON", "ingreso_neto_gpon", "gs", "sub"],
      ["INGRESO NETO CONVERGENTE", "ingreso_neto", "gs", "total"], ["COSTOS", null, null, "sep"],
      ["Estructura fija (salarios, cargas, cobertura adicional interior)", "_fijo", "gs", "row"], ["Comisiones pospago (con IPS y aguinaldo)", "_comisiones", "gs", "row"],
      ["Plus pospago (sin cargas)", "_plus", "gs", "row"], ["Logística de entregas pospago", "_logistica", "gs", "row"], ["Operativos pospago", "_operativos", "gs", "row"],
      ["Comisiones GPON (con IPS y aguinaldo)", "_gpon_comisiones", "gs", "row"], ["Plus GPON (sin cargas)", "_gpon_plus", "gs", "row"],
      ["Recupero de documentación GPON (55.000 por venta)", "_gpon_documentacion", "gs", "row"],
      ["Logística GPON", "_gpon_logistica", "gs", "row"], ["Operativos GPON", "_gpon_operativos", "gs", "row"],
      ["TOTAL COSTOS", "costo_total", "gs", "sub"], ["RESULTADO CONVERGENTE", "resultado", "gs", "total"],
      ["Resultado pospago", "resultado_movil", "gs", "pct"], ["Resultado GPON", "resultado_gpon", "gs", "pct"],
      ["Margen %", "margen_pct", "pct", "pct"], ["Acumulado", "acumulado", "gs", "pct"],
    ],
  },
  gpon: {
    nombre: "Negocio GPON · fibra y TV", titulo: "Simulador Anual GPON",
    intro: "Balance a 12 o 18 meses del negocio GPON (fibra + TV), con motor propio calibrado con las liquidaciones GPON 385 a 389. Seteás el mes 1 (activaciones, objetivo, planes, mora y estructura); los meses siguientes solo cambian las activaciones. Cada mes liquida cuota 1 y bono fijo más los ajustes de las cohortes anteriores: cuota 2 al mes 2, legajos, mora neta de reversos y recálculo del bono al día 180. Sin residual ni portabilidad.",
    paramsPath: "/api/v1/televentas-claro/facturacion/gpon/parametros", anualPath: "/api/v1/televentas-claro/facturacion/gpon/anual",
    Variables: VariablesGpon, campos: CAMPOS_AFECTABLES_GPON, objetivoKey: "objetivo", objetivoLabel: "objetivo de líneas", unidad: "activaciones",
    textoSinBonos: "sin bono fijo", textoConBonos: "cada mes liquida el bono fijo según la escala de Claro",
    ajusteTxt: "cuota 1 y cuota 2", ajusteHint: "Simula una renegociación con Claro sobre las cuotas. No afecta el bono ni la penalidad de mora. La comisión y el plus de los vendedores son montos fijos por venta: la mejora es íntegramente margen de Voicenter.",
    ajustesTxt: "cuota 2, legajos, mora, recálculo", cobrosTxt: "cuota 2", devTxt: "mora, legajos y recálculo del bono", olaTxt: "mora neta de reversos, recálculo del bono fijo, legajos",
    eerrRows: [
      ["Activaciones", "ventas", "int", "head"], ["INGRESOS DEL MES", null, null, "sep"],
      ["Cuota 1", "activaciones_cuota1", "gs", "row"], ["Bono fijo", "bono_productividad", "gs", "row"], ["Bono adicional (a mano)", "bono_adicional", "gs", "row"],
      ["Facturación bruta", "facturacion_bruta", "gs", "sub"], ["AJUSTES DE COHORTES ANTERIORES", null, null, "sep"],
      ["+ Cuota 2", "cuota2", "gs", "row"], ["− Legajos", "legajos", "gs", "row"], ["− Mora neta (penalizaciones − reversos)", "mora", "gs", "row"],
      ["− Recálculo del bono fijo", "recalculo", "gs", "row"], ["− Otros reversos", "otros", "gs", "row"],
      ["INGRESO NETO LIQUIDADO", "ingreso_neto", "gs", "total"], ["COSTOS", null, null, "sep"],
      ["Estructura fija (salarios, cargas, cobertura adicional interior)", "_fijo", "gs", "row"], ["Comisiones de vendedores (con IPS y aguinaldo)", "_comisiones", "gs", "row"],
      ["Plus de vendedores (sin cargas)", "_plus", "gs", "row"], ["Logística de entregas", "_logistica", "gs", "row"], ["Operativos", "_operativos", "gs", "row"],
      ["TOTAL COSTOS", "costo_total", "gs", "sub"], ["RESULTADO", "resultado", "gs", "total"], ["Margen %", "margen_pct", "pct", "pct"], ["Acumulado", "acumulado", "gs", "pct"],
    ],
    bonosCols: [["Bono fijo", "bono_productividad"]], verificado: false, observacion: false,
    // la Historia lee claves de pospago: se mapean las de GPON
    pHist: (p) => (p ? { ...p, objetivo_co: p.objetivo, escala_productividad: p.escala_bono, residual_meses: 0, porta_pct: 0, efectividad_pct: 100 } : p),
  },
};

/** Simulador ANUAL (móvil o GPON): el mes 1 fija estructura y objetivo; los meses
 *  2..12 solo cambian las ventas. Balance de 12 meses con todas las cohortes. */
/** Los tres gráficos de Claro ("Ventas Móv", "Netas Móv", "%Gross/Vta") con los números de la simulación.
 *  Desc Gross = bajas del mes de cualquier cohorte (caídas de la zafra un mes antes × % que termina en baja),
 *  Netas = ventas − Desc Gross, %Gross/Vta = Desc Gross ÷ ventas. Banda de referencia 22–27%. */
const GROSS_BANDA = { desde: 22, hasta: 27 };
function GrossClaro({ meses, anual, nombreMes, nombreCorto, pctBajas }: {
  meses: any[]; anual: any; nombreMes: (i: number) => string; nombreCorto: (i: number) => string; pctBajas: number;
}) {
  const data = meses.map((m: any) => ({ mes: m.mes, ventas: m.ventas, netas: m.netas_gross, bajas: m.bajas_gross, pct: m.pct_gross }));
  const maxPct = Math.max(GROSS_BANDA.hasta + 5, ...data.map((d) => d.pct));
  const topPct = Math.ceil((maxPct + 3) / 5) * 5;
  const sobre: number[] = anual?.meses_gross_sobre_banda ?? [];
  const enBanda = data.filter((d) => d.pct >= GROSS_BANDA.desde && d.pct <= GROSS_BANDA.hasta).length;
  const bajo = data.filter((d) => d.pct < GROSS_BANDA.desde).length;
  const estado = sobre.length === 0 ? (bajo === data.length ? "Todo el período por debajo de la banda: mejor que la referencia." : "Todo el período dentro o por debajo de la banda 22–27%.")
    : `${sobre.length} de ${data.length} meses por encima del 27%.`;
  const ultimo = data[data.length - 1];
  return (
    <section className="card p-5 print:mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="font-display text-lg text-brand-ink uppercase">Gross y netas · criterio Claro</h2>
          <p className="text-xs text-brand-slate">Los mismos gráficos que presenta Claro, con la simulación. Desc Gross = bajas del mes (de cualquier cohorte, sin port out); Netas = ventas − Desc Gross; %Gross/Vta = Desc Gross ÷ ventas. Referencia: banda 22–27% (otros calls 12–27%).</p>
        </div>
        <div className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${sobre.length ? "border-brand-primary text-brand-primary bg-brand-primary/5" : "border-emerald-500 text-emerald-700 bg-emerald-50"}`}>{estado}</div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { t: "Ventas del período", v: formatInt(anual?.ventas ?? 0), s: `${formatInt(ultimo?.ventas ?? 0)} en ${nombreCorto(data.length - 1)}` },
          { t: "Desc Gross del período", v: formatInt(anual?.bajas_gross ?? 0), s: `${pctBajas}% de las caídas de la zafra terminan en baja`, rojo: true },
          { t: "Netas del período", v: formatInt(anual?.netas_gross ?? 0), s: `${formatInt(ultimo?.netas ?? 0)} en ${nombreCorto(data.length - 1)}`, verde: true },
          { t: "%Gross / Vta", v: `${String(anual?.pct_gross ?? 0).replace(".", ",")}%`, s: `máximo ${String(anual?.pct_gross_max ?? 0).replace(".", ",")}% en ${nombreCorto((anual?.pct_gross_max_mes ?? 1) - 1)}`, accent: true },
        ].map((k) => (
          <div key={k.t} className={`rounded-md border border-brand-border bg-white px-3 py-2 ${k.accent ? "border-l-4 border-l-brand-ink" : ""}`}>
            <div className="text-[9px] uppercase tracking-wider2 text-brand-slate font-bold">{k.t}</div>
            <div className={`font-display text-2xl leading-tight ${k.rojo ? "text-brand-primary" : k.verde ? "text-emerald-700" : "text-brand-ink"}`}>{k.v}</div>
            <div className="text-[10px] text-brand-slate">{k.s}</div>
          </div>
        ))}
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate text-center mb-1">Ventas</div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={data} margin={{ top: 8, right: 12, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="mes" fontSize={9} tickFormatter={(v: number) => nombreCorto(v - 1)} interval={0} angle={-35} textAnchor="end" height={44} />
              <YAxis fontSize={9} domain={[0, "auto"]} allowDecimals={false} />
              <Tooltip labelFormatter={(l) => nombreMes(Number(l) - 1)} formatter={(v: any) => [formatInt(Number(v)), "Ventas"]} />
              <Line dataKey="ventas" name="Ventas" stroke="#0F1116" strokeWidth={2.5} dot={{ r: 3, fill: "#0F1116" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate text-center mb-1">Netas</div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={data} margin={{ top: 8, right: 12, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="mes" fontSize={9} tickFormatter={(v: number) => nombreCorto(v - 1)} interval={0} angle={-35} textAnchor="end" height={44} />
              <YAxis fontSize={9} domain={[0, "auto"]} allowDecimals={false} />
              <Tooltip labelFormatter={(l) => nombreMes(Number(l) - 1)} formatter={(v: any, name: any) => [formatInt(Number(v)), name]} />
              <Line dataKey="ventas" name="Ventas" stroke="#9CA3AF" strokeWidth={1} strokeDasharray="4 3" dot={false} />
              <Line dataKey="netas" name="Netas" stroke="#E6332A" strokeWidth={2.5} dot={{ r: 3, fill: "#E6332A" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate text-center mb-1">%Gross / Vta</div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={data} margin={{ top: 8, right: 12, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="mes" fontSize={9} tickFormatter={(v: number) => nombreCorto(v - 1)} interval={0} angle={-35} textAnchor="end" height={44} />
              <YAxis fontSize={9} domain={[0, topPct]} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip labelFormatter={(l) => nombreMes(Number(l) - 1)} formatter={(v: any) => [`${String(v).replace(".", ",")}%`, "%Gross/Vta"]} />
              <ReferenceArea y1={GROSS_BANDA.hasta} y2={topPct} fill="#E6332A" fillOpacity={0.07} />
              <ReferenceArea y1={GROSS_BANDA.desde} y2={GROSS_BANDA.hasta} fill="#10B981" fillOpacity={0.18}
                label={{ value: "banda 22–27%", position: "insideTopRight", fontSize: 9, fill: "#047857", fontWeight: 700 }} />
              <ReferenceLine y={GROSS_BANDA.desde} stroke="#10B981" strokeDasharray="4 3" />
              <ReferenceLine y={GROSS_BANDA.hasta} stroke="#E6332A" strokeDasharray="4 3" />
              <Line dataKey="pct" name="%Gross/Vta" stroke="#0F1116" strokeWidth={2.5} dot={{ r: 3, fill: "#0F1116" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <Lectura>
        Las bajas de un mes son ventas de 1 a 3 meses antes (el PFI suspende a los 60 días y Claro cancela un mes después),
        así que el Gross no juzga las ventas de ese mes: si un mes vende menos, las bajas de los meses anteriores llegan igual y el
        porcentaje salta. Con ventas estables el %Gross queda en {String(data[0]?.pct ?? 0).replace(".", ",")}% con la zafra cargada; para entrar
        en la banda hay que bajar la caída de la zafra en los meses 1 y 2 (PFI). El mes 1 arranca en régimen: se asume que los meses
        anteriores vendieron lo mismo que el mes 1.
      </Lectura>
    </section>
  );
}

/** Evolución de la zafra cargada (% de líneas activas por mes de antigüedad) contra la banda del IDEAL
 *  (la zafra ideal ± ZAFRA_TOLERANCIA puntos) y la zafra real de referencia. */
const ZAFRA_TOLERANCIA = 3.5;
function ZafraEvolucion({ zafra, zafraReal, ventas }: { zafra: number[]; zafraReal?: number[]; ventas: number }) {
  const n = Math.max(zafra.length, ZAFRA_IDEAL.length);
  const data = Array.from({ length: n }, (_, i) => {
    const ideal = ZAFRA_IDEAL[Math.min(i, ZAFRA_IDEAL.length - 1)];
    const lo = Math.max(0, ideal - ZAFRA_TOLERANCIA), hi = Math.min(100, ideal + ZAFRA_TOLERANCIA);
    const z = Number(zafra[Math.min(i, zafra.length - 1)] ?? 0);
    const real = zafraReal ? Number(zafraReal[Math.min(i, zafraReal.length - 1)] ?? 0) : null;
    return { mes: i, etiqueta: `M${i}`, zafra: z, ideal, banda: [lo, hi], real, fuera: z < lo ? "abajo" : z > hi ? "arriba" : "" };
  });
  const fueraAbajo = data.filter((d) => d.fuera === "abajo");
  const fueraArriba = data.filter((d) => d.fuera === "arriba");
  const peor = fueraAbajo.length ? fueraAbajo.reduce((a, d) => ((d.ideal - d.zafra) > (a.ideal - a.zafra) ? d : a), fueraAbajo[0]) : null;
  const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;
  const dif = (i: number) => data[i] ? data[i].zafra - data[i].ideal : 0;
  const lineas = (v: number) => formatInt(Math.round(ventas * v / 100));
  const estado = fueraAbajo.length === 0
    ? (fueraArriba.length ? `Dentro o por encima de la banda del Ideal en los ${n} meses.` : `Dentro de la banda del Ideal (±${String(ZAFRA_TOLERANCIA).replace(".", ",")} puntos) en los ${n} meses.`)
    : `${fueraAbajo.length} de ${n} meses por debajo de la banda del Ideal; el peor es M${peor!.mes} (${pct(peor!.zafra)} contra ${pct(peor!.ideal)} ideal).`;
  return (
    <section className="card p-5 print:mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="font-display text-lg text-brand-ink uppercase">Evolución de la zafra · contra el Ideal</h2>
          <p className="text-xs text-brand-slate">% de líneas de una cohorte que siguen activas en cada mes de antigüedad. La banda verde es la zafra Ideal ±{String(ZAFRA_TOLERANCIA).replace(".", ",")} puntos (la marca); la línea punteada gris es la zafra real medida en las liquidaciones.</p>
        </div>
        <div className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${fueraAbajo.length ? "border-brand-primary text-brand-primary bg-brand-primary/5" : "border-emerald-500 text-emerald-700 bg-emerald-50"}`}>{estado}</div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="etiqueta" fontSize={10} interval={0} />
          <YAxis fontSize={10} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip
            labelFormatter={(l) => `Mes ${String(l).replace("M", "")} de antigüedad`}
            formatter={(v: any, name: any) => {
              if (name === "Banda del Ideal") return [`${pct(Number(v[0]))} a ${pct(Number(v[1]))}`, name];
              return [pct(Number(v)), name];
            }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area dataKey="banda" name="Banda del Ideal" stroke="none" fill="#10B981" fillOpacity={0.2} type="monotone" />
          <Line dataKey="ideal" name="Zafra Ideal" stroke="#047857" strokeWidth={1.5} strokeDasharray="5 3" dot={false} type="monotone" />
          {zafraReal && <Line dataKey="real" name="Zafra real (liquidaciones)" stroke="#9CA3AF" strokeWidth={1.5} strokeDasharray="3 3" dot={false} type="monotone" />}
          <Line dataKey="zafra" name="Zafra cargada" stroke="#0F1116" strokeWidth={2.5} type="monotone"
            dot={(props: any) => {
              const { cx, cy, payload, index } = props;
              const fill = payload.fuera === "abajo" ? "#E6332A" : payload.fuera === "arriba" ? "#10B981" : "#0F1116";
              return <circle key={index} cx={cx} cy={cy} r={payload.fuera ? 4.5 : 3} fill={fill} stroke="#fff" strokeWidth={1} />;
            }} />
          <ReferenceLine x="M2" stroke="#E6332A" strokeDasharray="4 3" label={{ value: "PFI", position: "insideTopLeft", fill: "#E6332A", fontSize: 10, fontWeight: 700 }} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
        {[
          { t: "Activas al M2 (después del PFI)", i: 2 },
          { t: "Activas al M3", i: 3 },
          { t: "Activas al M6 (fin del chargeback)", i: 6 },
          { t: "Activas al M12", i: 12 },
        ].filter((k) => data[k.i]).map((k) => {
          const d = data[k.i]; const df = dif(k.i);
          return (
            <div key={k.t} className={`rounded-md border bg-white px-3 py-2 ${d.fuera === "abajo" ? "border-brand-primary" : "border-brand-border"}`}>
              <div className="text-[9px] uppercase tracking-wider2 text-brand-slate font-bold">{k.t}</div>
              <div className={`font-display text-2xl leading-tight ${d.fuera === "abajo" ? "text-brand-primary" : "text-brand-ink"}`}>{pct(d.zafra)}</div>
              <div className="text-[10px] text-brand-slate">{lineas(d.zafra)} líneas de {formatInt(ventas)} · ideal {pct(d.ideal)} ({df >= 0 ? "+" : ""}{df.toFixed(1).replace(".", ",")} pts)</div>
            </div>
          );
        })}
      </div>
      <Lectura>
        La curva negra es la zafra con la que se está simulando: de cada 100 líneas vendidas, cuántas siguen activas al mes 1, 2, 3… La
        banda verde es la marca: la zafra Ideal con una tolerancia de {String(ZAFRA_TOLERANCIA).replace(".", ",")} puntos hacia arriba y hacia abajo.
        Un punto rojo es un mes por debajo de la banda (más caídas que lo admitido); un punto verde, por encima (mejor que el Ideal).
        El escalón entre M1 y M2 es el PFI: ahí se decide casi todo, porque cada línea que cae antes del M2 devuelve cuota 1, plus porta y
        bono efectividad. La línea gris punteada es lo que hoy pasa en las liquidaciones: la distancia entre la gris y la banda es lo que hay
        que corregir en calidad de venta y cobranza de la primera factura para que el Gross entre en su banda de 22–27%.
      </Lectura>
    </section>
  );
}

export function SimuladorAnual({ negocio }: { negocio: Negocio }) {
  const cfg = NEGOCIOS[negocio];
  const [p, setP] = useState<any>(null);
  const [defaults, setDefaults] = useState<any>(null);
  // ---- Convergente (solo móvil): GPON vendido por la MISMA estructura de pospago ----
  const esConvergente = negocio === "movil";
  const [pg, setPg] = useState<any>(null);                       // variables GPON (planes, cuota 2, mora, bono fijo, costos variables)
  const [pgDefaults, setPgDefaults] = useState<any>(null);
  const [gponActivo, setGponActivo] = useState(true);             // incluir GPON en el balance
  const [gponAsesor, setGponAsesor] = useState<number[]>([]);     // GPON por asesor, por mes (ideal 3)
  const [gponObjetivoAuto, setGponObjetivoAuto] = useState(true); // objetivo del bono fijo = vendedores × 3
  const [seteado, setSeteado] = useState(false);
  const [horizonte, setHorizonte] = useState<12 | 18>(12);
  const [ventas, setVentas] = useState<number[]>([]);
  const [nombres, setNombres] = useState<string[]>([]);       // nombres editables de los meses ("Octubre 2026")
  const [bonosAd, setBonosAd] = useState<number[]>([]);       // bono adicional a mano (Gs) por mes
  const [mostrarBonosAd, setMostrarBonosAd] = useState(false);
  const nombreMes = (i: number) => (nombres[i] || "").trim() || `Mes ${i + 1}`;
  const nombreCorto = (i: number) => { const n = nombreMes(i); return n.length > 12 ? n.slice(0, 11) + "…" : n; };
  const [res, setRes] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<any>(null);
  // Registro del trabajo: simulación guardada abierta, ítems marcados y post-its.
  const [actual, setActual] = useState<any | null>(null);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [postits, setPostits] = useState<Postit[]>([]);
  const [notas, setNotas] = useState<Nota[]>([]);      // notas y comentarios sobre la simulación (zona de trabajo)
  const [barra, setBarra] = useState(false);          // barra lateral de registro (se abre en pantallas anchas)
  // Meses afectados: variaciones propias de un mes (porta, efectividad, mix, costos variables…).
  const [afectados, setAfectados] = useState<Afectados>({});
  const [editandoMes, setEditandoMes] = useState<number | null>(null);
  const esAfectado = (mes: number) => !!afectados[String(mes)];
  const aplicarAfectado = (meses: number[], ov: any) =>
    setAfectados((prev) => { const n = { ...prev }; for (const m of meses) n[String(m)] = JSON.parse(JSON.stringify(ov)); return n; });
  const quitarAfectado = (mes: number) => setAfectados((prev) => { const n = { ...prev }; delete n[String(mes)]; return n; });
  useEffect(() => { setBarra(window.innerWidth >= 1280); }, []);
  // ?abrir=<id>: abre una simulación guardada al entrar (Voi guarda y abre la pantalla con esta ruta; también sirve como enlace).
  const [abrirId] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("abrir")));
  const abierta = useRef(false);
  const esMarcado = (key: string) => marcas.some((m) => m.key === key);
  const toggleMarca = (key: string, label: string) =>
    setMarcas((prev) => (prev.some((m) => m.key === key) ? prev.filter((m) => m.key !== key) : [...prev, { key, label }]));

  useEffect(() => {
    apiFetch<any>(cfg.paramsPath).then((d) => {
      // Móvil abre con los valores iniciales definidos por la dirección (ventas/objetivo y estructura del
      // escenario IDEAL); "Restaurar valores reales" vuelve a los calibrados del backend.
      setP(negocio === "movil" ? aplicarPreset(d.parametros, PRESET_INICIAL_MOVIL) : d.parametros);
      setDefaults(d.parametros);
      if (d.parametros_gpon) { setPg(d.parametros_gpon); setPgDefaults(d.parametros_gpon); }
    }).catch((e) => setError(e.message));
  }, [cfg.paramsPath, negocio]);

  // Escenario de negociación: Claro no descuenta el bono productividad (1871) y/o el bono efectividad (471).
  const bonoUnico = negocio === "movil" && p?.bono_unico === true;
  const sinDescProd = negocio === "movil" && p?.devolver_bono_productividad === false;
  const sinDescEfec = negocio === "movil" && p?.devolver_bono_efectividad === false;
  const [resConDesc, setResConDesc] = useState<any>(null);   // misma simulación CON los descuentos, para comparar

  // ---- Convergente: derivados ----
  const gponOn = esConvergente && gponActivo && !!pg;
  const vendedoresMes1 = p && Number(p.costos?.ventas_por_vendedor) > 0 ? Math.ceil((Number(p.ventas) || 0) / Number(p.costos.ventas_por_vendedor)) : 0;
  const vendedoresRef = res?.headcount?.vendedores ?? vendedoresMes1;
  const asesorMes1 = gponAsesor[0] ?? GPON_POR_ASESOR_IDEAL;
  const setAsesorMes1 = (v: number) => setGponAsesor((prev) => (prev.length ? prev.map((x, i) => (i === 0 ? Math.max(v, 0) : x)) : [Math.max(v, 0)]));
  const setGponAsesorMes = (i: number, v: number) => setGponAsesor((prev) => prev.map((x, j) => (j === i ? Math.max(v, 0) : x)));
  const gponReq = useMemo(() => (esConvergente && pg ? {
    activo: gponActivo,
    parametros: { ...pg, objetivo: gponObjetivoAuto ? Math.max(Math.round(vendedoresMes1 * GPON_POR_ASESOR_IDEAL), 1) : pg.objetivo },
    por_asesor_por_mes: gponAsesor.length ? gponAsesor : [GPON_POR_ASESOR_IDEAL],
  } : null), [esConvergente, pg, gponActivo, gponObjetivoAuto, vendedoresMes1, gponAsesor]);
  // Textos de cobros / devoluciones según haya GPON en el balance.
  const txt = gponOn ? {
    ajustesTxt: "residual, cuota 2 y caídas de pospago; cuota 2, mora y recálculo GPON",
    cobrosTxt: "cuota 2 y residual de pospago, cuota 2 GPON",
    devTxt: "chargebacks, legajos y devolución de bonos de pospago; mora, legajos y recálculo GPON",
    olaTxt: "caídas del chargeback, recálculo del bono y legajos de pospago; mora y recálculo GPON",
  } : { ajustesTxt: cfg.ajustesTxt, cobrosTxt: cfg.cobrosTxt, devTxt: cfg.devTxt, olaTxt: cfg.olaTxt };
  const eerrRows = gponOn && cfg.eerrRowsConvergente ? cfg.eerrRowsConvergente : cfg.eerrRows;
  // Meses afectados del convergente: campos de pospago + GPON; la base GPON es la que viaja al motor.
  const camposMes = gponOn ? CAMPOS_AFECTABLES_CONVERGENTE : cfg.campos;
  const baseMes = gponOn ? { ...p, gpon: gponReq?.parametros ?? pg } : p;

  const simular = useCallback((params: any, vpm: number[], h: number, af: Afectados, bad: number[], nm: string[], gq: any) => {
    // Convergente: las variaciones de un mes pueden ser de pospago y de GPON (ov.gpon); cada motor recibe las suyas.
    const sep = separarAfectados(af);
    const body = (pp: any) => JSON.stringify({ parametros: pp, ventas_por_mes: vpm, horizonte: h, meses_afectados: gq ? sep.movil : af, bonos_adicionales_por_mes: bad, nombres_meses: nm,
      ...(gq ? { gpon: { ...gq, meses_afectados: sep.gpon } } : {}) });
    apiFetch<any>(cfg.anualPath, { method: "POST", body: body(params) })
      .then((d) => { setRes(d); setError(null); }).catch((e) => setError(e.message));
    if (params?.devolver_bono_productividad === false || params?.devolver_bono_efectividad === false) {
      apiFetch<any>(cfg.anualPath, { method: "POST", body: body({ ...params, devolver_bono_productividad: true, devolver_bono_efectividad: true }) })
        .then((d) => setResConDesc(d)).catch(() => setResConDesc(null));
    } else {
      setResConDesc(null);
    }
  }, [cfg.anualPath]);

  useEffect(() => {
    if (!seteado || !p || ventas.length !== horizonte) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => simular(p, ventas, horizonte, afectados, bonosAd, nombres, gponReq), 250);
    return () => clearTimeout(timer.current);
  }, [seteado, p, ventas, horizonte, afectados, bonosAd, nombres, simular, gponReq]);

  const setear = () => {
    const v1 = Number(p.ventas) || 0;
    setVentas([v1, ...Array(horizonte - 1).fill(v1)]);
    setBonosAd((prev) => Array.from({ length: horizonte }, (_, i) => prev[i] ?? 0));
    setNombres((prev) => Array.from({ length: horizonte }, (_, i) => prev[i] ?? ""));
    setGponAsesor((prev) => Array.from({ length: horizonte }, (_, i) => prev[i] ?? prev[0] ?? GPON_POR_ASESOR_IDEAL));
    setSeteado(true);
  };
  const cambiarHorizonte = (h: 12 | 18) => {
    setHorizonte(h);
    setVentas((prev) => {
      if (!prev.length) return prev;
      const base = prev[prev.length - 1] ?? prev[0];
      return h > prev.length ? [...prev, ...Array(h - prev.length).fill(base)] : prev.slice(0, h);
    });
    setBonosAd((prev) => Array.from({ length: h }, (_, i) => prev[i] ?? 0));
    setNombres((prev) => Array.from({ length: h }, (_, i) => prev[i] ?? ""));
    setGponAsesor((prev) => Array.from({ length: h }, (_, i) => prev[i] ?? prev[prev.length - 1] ?? GPON_POR_ASESOR_IDEAL));
  };
  const setNombre = (i: number, v: string) => setNombres((prev) => prev.map((x, j) => (j === i ? v.slice(0, 40) : x)));
  const setBonoAd = (i: number, v: number) => setBonosAd((prev) => prev.map((x, j) => (j === i ? Math.max(v, 0) : x)));
  const HorizonteToggle = () => (
    <div className="inline-flex rounded-md border border-brand-border overflow-hidden no-print">
      {([12, 18] as const).map((h) => (
        <button key={h} onClick={() => cambiarHorizonte(h)}
          className={`px-3 py-1.5 text-xs font-bold ${horizonte === h ? "bg-brand-primary text-white" : "text-brand-graphite hover:bg-brand-bg"}`}>
          {h} meses
        </button>
      ))}
    </div>
  );
  const editarMes1 = () => { setSeteado(false); setRes(null); };
  const setVenta = (i: number, v: number) => setVentas((prev) => prev.map((x, j) => (j === i ? v : x)));

  const meses: any[] = res?.meses ?? [];

  const ejesResultado = dominiosAlineados(
    meses.flatMap((x: any) => [x.ingreso_neto, x.costo_total, x.resultado, x.ola_devoluciones]),
    meses.map((x: any) => x.margen_pct),
  );
  const a = res?.anual;
  const hc = res?.headcount;


  const getSnapshot = (): Snapshot => ({
    // Convergente: la configuración GPON viaja dentro de parámetros (el motor de pospago la ignora) y se guarda con la simulación.
    parametros: esConvergente ? { ...p, convergente: { activo: gponActivo, por_asesor_por_mes: gponAsesor, parametros_gpon: pg, objetivo_auto: gponObjetivoAuto } } : p,
    ventas_por_mes: ventas, horizonte, meses_afectados: afectados, bonos_adicionales_por_mes: bonosAd, nombres_meses: nombres,
    resumen: a ? {
      ventas: a.ventas, facturacion_bruta: a.facturacion_bruta, ingreso_neto: a.ingreso_neto, costos: a.costos,
      resultado: a.resultado, margen_pct: a.margen_pct, resultado_con_cola: a.resultado_con_cola,
      bonos_activos: p?.bonos_activos !== false, ajuste_comisiones_pct: Number(p?.ajuste_comisiones_pct || 0),
      sin_descuento_bono_productividad: sinDescProd, sin_descuento_bono_efectividad: sinDescEfec, bono_unico: bonoUnico,
      convergente: gponOn, ventas_gpon: a.ventas_gpon ?? 0, resultado_gpon: a.resultado_gpon ?? 0, gpon_por_asesor: a.gpon_por_asesor ?? 0,
    } : {},
  });
  const abrirSimulacion = (s: any) => {
    const h = (s.horizonte === 18 ? 18 : 12) as 12 | 18;
    const { convergente: cv, ...paramsBase } = (s.parametros || {}) as any;
    setP(paramsBase);
    if (esConvergente) {
      // Simulaciones anteriores al convergente no tienen GPON: se abren como pospago puro para reproducir lo guardado.
      setGponActivo(!!cv && cv.activo !== false);
      setGponAsesor(Array.from({ length: h }, (_, i) => Number(cv?.por_asesor_por_mes?.[i] ?? cv?.por_asesor_por_mes?.[0] ?? GPON_POR_ASESOR_IDEAL)));
      if (cv?.parametros_gpon) setPg(cv.parametros_gpon);
      setGponObjetivoAuto(cv ? cv.objetivo_auto !== false : true);
    }
    setHorizonte(h);
    const v = (s.ventas_por_mes || []).map(Number);
    while (v.length < h) v.push(v[v.length - 1] ?? Number(s.parametros?.ventas) ?? 0);
    setVentas(v.slice(0, h));
    setAfectados(s.meses_afectados ?? {});
    setBonosAd(Array.from({ length: h }, (_, i) => Number(s.bonos_adicionales_por_mes?.[i] ?? 0)));
    setNombres(Array.from({ length: h }, (_, i) => String(s.nombres_meses?.[i] ?? "")));
    setMostrarBonosAd((s.bonos_adicionales_por_mes ?? []).some((x: number) => Number(x) > 0));
    setMarcas(s.marcas ?? []);
    setPostits(s.postits ?? []);
    setNotas(s.notas ?? []);
    setSeteado(true);
  };

  useEffect(() => {
    if (!abrirId || !p || abierta.current) return;
    abierta.current = true;
    apiFetch<any>(`/api/v1/televentas-claro/facturacion/simulaciones/${abrirId}`).then((s) => {
      if (((s?.negocio === "GPON") ? "gpon" : "movil") !== negocio) return;
      abrirSimulacion(s); setActual(s); setBarra(window.innerWidth >= 1280);
      window.history.replaceState(null, "", window.location.pathname);
    }).catch((e) => setError(`No se pudo abrir la simulación guardada: ${e.message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirId, p]);

  return (
    <AppShell>
      {/* Al imprimir, la tabla envolvente repite su <thead> en cada hoja: un encabezado corrido sin pisar el contenido. */}
      <table className="print-shell"><thead className="print-shell-head"><tr><td>
        <div className="print-running">
          <span>{cfg.titulo}{actual ? ` · ${actual.nombre}` : ""}</span>
          <span>{horizonte} meses · Operaciones Voicenter · {new Date().toLocaleDateString("es-PY")}</span>
        </div>
      </td></tr></thead><tbody><tr><td>
      <PrintCover titulo={`${cfg.titulo} · ${horizonte} meses`}
        periodo={a ? `${formatInt(a.ventas)} ${cfg.unidad}${gponOn ? ` + ${formatInt(a.ventas_gpon ?? 0)} GPON (${a.gpon_por_asesor ?? 0} por asesor)` : ""} en ${horizonte} meses · ingreso neto ${formatGs(a.ingreso_neto)} · resultado ${formatGs(a.resultado)} (${a.margen_pct}%)${p?.bonos_activos === false ? " · SIN BONOS" : ""}${bonoUnico ? " · BONO ÚNICO PROPUESTO" : sinDescProd || sinDescEfec ? ` · SIN DESCUENTO SOBRE BONO ${[sinDescProd && "PRODUCTIVIDAD", sinDescEfec && "LOGÍSTICA"].filter(Boolean).join(" Y ")}` : ""}${Number(p?.ajuste_comisiones_pct || 0) ? ` · COMISIONES ${Number(p.ajuste_comisiones_pct) > 0 ? "+" : ""}${Number(p.ajuste_comisiones_pct)}%` : ""} · ${cfg.nombre}` : undefined} />

      <div className="mb-2 text-xs text-brand-slate no-print">
        <Link href="/televentas-claro/facturacion" className="hover:text-brand-primary">Facturación</Link>
        <span className="mx-2">/</span><span className="text-brand-ink font-semibold">{cfg.titulo}</span>
      </div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl text-brand-ink uppercase">{cfg.titulo}</h1>
          <p className="text-sm text-brand-slate mt-1 max-w-3xl">{cfg.intro}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate no-print">Horizonte</span>
          <HorizonteToggle />
          <button onClick={() => setBarra(!barra)} className={`no-print px-3 py-1.5 rounded-md text-xs font-bold border ${barra ? "bg-brand-ink text-white border-brand-ink" : "border-brand-border text-brand-graphite hover:border-brand-ink"}`}>
            {barra ? "Ocultar registro ›" : "‹ Registro del trabajo"}
          </button>
          <PrintButton label="Imprimir / Guardar PDF" />
        </div>
      </div>

      {error && <p className="text-sm text-brand-primary mb-4">{error}</p>}
      {!p && !error && <div className="text-brand-slate">Cargando variables de negocio…</div>}

      {/* ===== Barra lateral de registro (se muestra / oculta) ===== */}
      {p && (
        <RegistroSimulaciones abierta={barra} setAbierta={setBarra} listo={seteado && !!res} getSnapshot={getSnapshot} onAbrir={abrirSimulacion}
          actual={actual} setActual={setActual} marcas={marcas} setMarcas={setMarcas} postits={postits} setPostits={setPostits} notas={notas} setNotas={setNotas} nombresMeses={ventas.map((_, i) => nombreMes(i))} negocio={negocio} />
      )}
      <FichaSimulacion negocio={negocio} p={p} defaults={defaults} pg={pg} pgDefaults={pgDefaults} gponOn={gponOn} gponAsesor={gponAsesor}
        gponObjetivoAuto={gponObjetivoAuto} horizonte={horizonte} ventas={ventas} nombres={nombres} bonosAd={bonosAd} afectados={afectados}
        actual={actual} notas={notas} res={res} />

      {/* ===== Lienzo de trabajo: los post-its flotan sobre él; deja lugar a la barra cuando está abierta ===== */}
      <div className={`relative transition-[padding] sim-print ${barra ? "xl:pr-[384px]" : ""}`}>
      <PostitsLienzo postits={postits} setPostits={setPostits} marcas={marcas} />

      {/* ===== Paso 1: setear el mes 1 ===== */}
      {p && !seteado && (
        <div className="grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <cfg.Variables p={p} setP={setP} defaults={defaults} titulo="Mes 1 — variables y estructura" />
            {esConvergente && (
              <section className={`rounded-md border-2 p-3 space-y-3 ${gponActivo ? "border-brand-cyan bg-brand-cyan/5" : "border-brand-border bg-white"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-cyan">Convergente · GPON por la misma estructura</div>
                    <div className="text-[11px] text-brand-graphite">Los <b>{formatInt(vendedoresMes1)}</b> vendedores del pospago venden además GPON (solo fibra: IPTV no cuenta). Activaciones GPON = vendedores × GPON por asesor. Ideal: 3 por asesor.</div>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-brand-ink">
                    <input type="checkbox" checked={gponActivo} onChange={(e) => setGponActivo(e.target.checked)} className="accent-brand-cyan w-4 h-4" />
                    Incluir GPON
                  </label>
                </div>
                {gponActivo && (
                  <>
                    <div className="flex items-center gap-3 rounded-md border border-brand-cyan/50 bg-white px-2 py-1.5">
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold text-brand-cyan">GPON por asesor (mes 1)</span>
                        <span className="block text-[10px] text-brand-slate">{formatInt(vendedoresMes1)} vendedores × {asesorMes1} = <b>{formatInt(Math.round(vendedoresMes1 * asesorMes1))}</b> activaciones GPON en el mes 1 · los meses siguientes se cargan en el paso 2</span>
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        <NumeroInput step={0.5} min={0} value={asesorMes1} onChange={setAsesorMes1} className="input w-[120px] !py-1 text-sm text-right font-bold text-brand-cyan border-brand-cyan" />
                        <button onClick={() => setAsesorMes1(GPON_POR_ASESOR_IDEAL)} className="text-[10px] font-bold text-brand-cyan hover:underline w-5" title="Ideal: 3 por asesor">3</button>
                      </span>
                    </div>
                    {pg && (
                      <VariablesGpon p={pg} setP={setPg} defaults={pgDefaults} titulo="Variables GPON" convergente
                        vendedores={vendedoresMes1} porAsesor={asesorMes1} objetivoAuto={gponObjetivoAuto} setObjetivoAuto={setGponObjetivoAuto} />
                    )}
                  </>
                )}
              </section>
            )}
          </div>
          <div className="lg:col-span-3">
            <section className="card p-6 border-2 border-brand-primary">
              <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate mb-1">Paso 1 de 2</div>
              <h2 className="font-display text-2xl text-brand-ink uppercase mb-2">Setear el mes 1</h2>
              <p className="text-sm text-brand-graphite leading-relaxed mb-4">
                Con las ventas del mes 1 (<b>{formatInt(Number(p.ventas) || 0)}</b>) se dimensiona la estructura:
                {" "}<b>{Math.ceil((Number(p.ventas) || 0) / Math.max(Number(p.costos.ventas_por_vendedor) || 1, 1))} vendedores</b>,
                {" "}{Math.ceil(Math.ceil((Number(p.ventas) || 0) / Math.max(Number(p.costos.ventas_por_vendedor) || 1, 1)) / Math.max(Number(p.costos.supervisor_cada_vendedores) || 1, 1))} supervisores,
                {" "}{Math.ceil((Number(p.ventas) || 0) / Math.max(Number(p.costos.backoffice_cada_ventas) || 1, 1))} backoffice, {p.costos.coordinadores} coordinador y {p.costos.controllers} controllers{Number(p.costos.subgerencia_salario) > 0 ? <> y <b className="text-brand-primary">1 SubGerencia Comercial</b> ({formatGs(Number(p.costos.subgerencia_salario))}/mes, en análisis)</> : null}.
                Esa estructura y el {cfg.objetivoLabel} de <b>{formatInt(Number(p[cfg.objetivoKey]) || 0)}</b> quedan fijos para los {horizonte} meses.
                {esConvergente && gponActivo && <> Con GPON incluido, esos mismos vendedores venden <b>{asesorMes1} GPON por asesor</b>: <b>{formatInt(Math.round(vendedoresMes1 * asesorMes1))} activaciones GPON</b> por mes con la misma dotación, con su propia facturación, cuota 2, mora y recálculo.</>}
                {esConvergente && !gponActivo && <> GPON está excluido: el balance es solo pospago.</>}
              </p>
              <button onClick={setear} disabled={!(Number(p.ventas) > 0)} className="btn-primary !px-6 !py-3 text-base shadow-lg disabled:opacity-50">
                Setear mes 1 y fijar la estructura →
              </button>
              <p className="text-[11px] text-brand-slate mt-3">Después vas a cargar solo las {cfg.unidad} de los meses 2 a {horizonte}. Podés volver a editar el mes 1 cuando quieras.</p>
            </section>
          </div>
        </div>
      )}

      {/* ===== Paso 2: ventas por mes + resultados ===== */}
      {p && seteado && (
        <div className="space-y-6">
          <section className="card p-5 no-print">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate">Mes 1 seteado · estructura fija</div>
                <div className="text-sm text-brand-ink mt-1">
                  {hc ? <><b>{hc.vendedores}</b> vendedores · <b>{hc.supervisores}</b> supervisores · <b>{hc.backoffice}</b> backoffice · {hc.coordinadores} coordinador · {hc.controllers} controllers{hc.subgerencia ? <> · <b className="text-brand-primary">1 SubGerencia Comercial</b></> : null}</> : "calculando…"}
                  {" "}· {cfg.objetivoLabel} <b>{formatInt(Number(p[cfg.objetivoKey]))}</b> · {p.costos.ventas_por_vendedor} ventas/vendedor
                  {a ? <> · costo fijo <b>{formatGs(a.costos_fijos_mes)}</b>/mes</> : null}
                  {gponOn && hc ? <> · <span className="text-brand-cyan">GPON <b>{asesorMes1}</b> por asesor = <b>{formatInt(hc.ventas_gpon_mes1?? Math.round(vendedoresRef * asesorMes1))}</b> activaciones/mes</span></> : null}
                  {esConvergente && !gponActivo ? <span className="ml-2 px-1.5 py-0.5 rounded bg-brand-border text-brand-graphite text-[10px] font-bold">SIN GPON</span> : null}
                  {p.bonos_activos === false ? <span className="ml-2 px-1.5 py-0.5 rounded bg-brand-ink text-white text-[10px] font-bold">SIN BONOS</span> : null}
                </div>
              </div>
              <button onClick={editarMes1} className="no-print text-sm text-brand-graphite border border-brand-border rounded px-3 py-2 hover:border-brand-primary">Editar mes 1</button>
            </div>
            <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate mb-2">{negocio === "gpon" ? "Activaciones por mes" : "Ventas efectivas por mes"}</div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-12 gap-2">
              {ventas.map((v, i) => (
                <label key={i} className={`text-[10px] ${i === 0 ? "text-brand-primary font-bold" : "text-brand-slate"} ${esMarcado(`mes:${i + 1}`) ? "rounded ring-2 ring-amber-400 ring-offset-1 bg-amber-50" : ""} ${esAfectado(i + 1) ? "rounded ring-2 ring-brand-purple ring-offset-1 bg-brand-purple/5" : ""}`}
                  title={esAfectado(i + 1) ? describirVariaciones(afectados[String(i + 1)], baseMes, camposMes).join(" · ") : undefined}>
                  <span className="flex items-center justify-between gap-1">
                    <span className="flex items-center gap-1 min-w-0">
                      <input value={nombres[i] ?? ""} placeholder={`Mes ${i + 1}`} onChange={(e) => setNombre(i, e.target.value)} title="Nombre del mes (editable)"
                        className="no-print min-w-0 w-full bg-transparent border-b border-dashed border-brand-border focus:border-brand-primary outline-none text-[10px] font-semibold text-inherit placeholder:text-brand-slate/70" />
                      <span className="print-only">{nombreMes(i)}</span>
                      {i === 0 && <span className="shrink-0">(seteado)</span>}
                    </span>
                    <span className="flex items-center gap-0.5">
                      {i > 0 && (
                        <button type="button" onClick={() => setEditandoMes(i + 1)} title="Editar este mes: variaciones propias (porta, efectividad, mix…)"
                          className={`no-print inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] leading-none ${esAfectado(i + 1) ? "bg-brand-purple text-white" : "border border-brand-border text-brand-slate opacity-40 hover:opacity-100 hover:border-brand-purple hover:text-brand-purple"}`}>✎</button>
                      )}
                      <Pin marcado={esMarcado(`mes:${i + 1}`)} onClick={() => toggleMarca(`mes:${i + 1}`, `${nombreMes(i)} (${formatInt(v)} ventas)`)} className="!w-5 !h-5 !text-[10px]" />
                    </span>
                  </span>
                  <NumeroInput step={10} min={0} value={v} disabled={i === 0} onChange={(n) => setVenta(i, n)}
                    className={`input !py-1 !px-1.5 text-sm text-right w-full ${i === 0 ? "bg-brand-bg-soft" : ""}`} />
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mt-2 no-print">
              <button onClick={() => setVentas((prev) => prev.map((x, i) => (i === 0 ? x : prev[0])))} className="text-[11px] text-brand-primary font-semibold hover:underline">Igualar todos al mes 1</button>
              <button onClick={() => setVentas((prev) => prev.map((x, i) => (i === 0 ? x : Math.round(prev[0] * Math.pow(1.02, i)))))} className="text-[11px] text-brand-primary font-semibold hover:underline">Crecer 2% mensual</button>
              <button onClick={() => setVentas((prev) => prev.map((x, i) => (i === 0 ? x : Math.round(prev[0] * Math.pow(0.98, i)))))} className="text-[11px] text-brand-primary font-semibold hover:underline">Caer 2% mensual</button>
              <span className="text-[11px] text-brand-slate ml-auto">✎ sobre un mes = variaciones propias de ese mes (menos porta, otra efectividad, otro mix…)</span>
            </div>

            {/* ===== Convergente: GPON por asesor, por mes ===== */}
            {esConvergente && (
              <div className={`mt-4 rounded-md border-2 p-3 ${gponOn ? "border-brand-cyan bg-brand-cyan/5" : "border-brand-border bg-white"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-cyan">GPON por asesor · convergente</div>
                    <div className="text-[11px] text-brand-graphite">
                      Los mismos <b>{formatInt(vendedoresRef)}</b> vendedores venden GPON: activaciones GPON del mes = vendedores × GPON por asesor. Ideal <b>3</b> por asesor.
                      {gponOn && a ? <> En esta simulación: <b className="text-brand-cyan">{formatInt(a.ventas_gpon ?? 0)}</b> activaciones GPON en {horizonte} meses, ingreso neto GPON <b>{formatGs(a.ingreso_neto_gpon ?? 0)}</b>.</> : null}
                      {!gponActivo ? " GPON excluido: el balance es solo pospago." : null}
                    </div>
                  </div>
                  <div className="no-print flex flex-wrap items-center gap-3">
                    {gponOn && (
                      <>
                        <button onClick={() => setGponAsesor((prev) => prev.map(() => GPON_POR_ASESOR_IDEAL))} className="text-[11px] text-brand-cyan font-semibold hover:underline">Ideal: 3 por asesor</button>
                        <button onClick={() => setGponAsesor((prev) => prev.map((x, i) => (i === 0 ? x : prev[0])))} className="text-[11px] text-brand-cyan font-semibold hover:underline">Igualar todos al mes 1</button>
                      </>
                    )}
                    <label className="flex items-center gap-2 text-xs font-semibold text-brand-ink">
                      <input type="checkbox" checked={gponActivo} onChange={(e) => setGponActivo(e.target.checked)} className="accent-brand-cyan w-4 h-4" />
                      Incluir GPON
                    </label>
                  </div>
                </div>
                {gponOn && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-12 gap-2 mt-3">
                    {gponAsesor.map((k, i) => (
                      <label key={i} className={`text-[10px] ${k >= GPON_POR_ASESOR_IDEAL ? "text-brand-cyan font-bold" : "text-brand-slate"} ${afectados[String(i + 1)]?.gpon ? "rounded ring-2 ring-brand-purple ring-offset-1 bg-brand-purple/5" : ""}`}
                        title={afectados[String(i + 1)]?.gpon ? describirVariaciones(afectados[String(i + 1)], baseMes, camposMes).filter((t) => t.startsWith("GPON")).join(" · ") : undefined}>
                        <span className="flex items-center justify-between gap-1">
                          <span className="truncate" title={nombreMes(i)}>{nombreCorto(i)}</span>
                          {i > 0 && (
                            <button type="button" onClick={() => setEditandoMes(i + 1)} title="Editar este mes: variaciones propias de GPON (legajos no presentados, mora, objetivo…)"
                              className={`no-print inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] leading-none ${afectados[String(i + 1)]?.gpon ? "bg-brand-purple text-white" : "border border-brand-border text-brand-slate opacity-40 hover:opacity-100 hover:border-brand-purple hover:text-brand-purple"}`}>✎</button>
                          )}
                        </span>
                        <NumeroInput step={0.5} min={0} value={k} onChange={(n) => setGponAsesorMes(i, n)}
                          className={`input !py-1 !px-1.5 text-sm text-right w-full ${k >= GPON_POR_ASESOR_IDEAL ? "border-brand-cyan" : ""}`} />
                        <span className="block text-right text-[10px] text-brand-graphite font-mono">{formatInt(Math.round(vendedoresRef * k))} GPON</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ===== Bono adicional a mano, por mes ===== */}
            <div className="mt-4 rounded-md border-2 border-brand-orange bg-brand-orange/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-orange">Bono adicional (a mano)</div>
                  <div className="text-[11px] text-brand-graphite">Gs por mes: campañas, premios o acuerdos puntuales con Claro. Se factura en el mes, no se devuelve. Por defecto 0.
                    {bonosAd.some((x) => x > 0) && <b className="ml-1 text-brand-orange">Total {formatGs(bonosAd.reduce((s, x) => s + x, 0))}</b>}</div>
                </div>
                <div className="no-print flex items-center gap-2">
                  {bonosAd.some((x) => x > 0) && <button onClick={() => setBonosAd(bonosAd.map(() => 0))} className="text-[11px] text-brand-slate hover:text-brand-primary">Poner todo en 0</button>}
                  <button onClick={() => setMostrarBonosAd(!mostrarBonosAd)} className="px-3 py-1 rounded text-[11px] font-bold bg-brand-orange text-white hover:bg-brand-orange/90">
                    {mostrarBonosAd ? "Ocultar" : "Cargar bono por mes"}
                  </button>
                </div>
              </div>
              {(mostrarBonosAd || bonosAd.some((x) => x > 0)) && (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-12 gap-2 mt-3">
                  {bonosAd.map((b, i) => (
                    <label key={i} className={`text-[10px] ${b > 0 ? "text-brand-orange font-bold" : "text-brand-slate"}`}>
                      <span className="block truncate" title={nombreMes(i)}>{nombreCorto(i)}</span>
                      <NumeroInput step={1000000} min={0} value={b} onChange={(n) => setBonoAd(i, n)} placeholder="0"
                        className={`input !py-1 !px-1.5 text-sm text-right w-full ${b > 0 ? "border-brand-orange" : ""}`} />
                    </label>
                  ))}
                  <div className="no-print col-span-full flex gap-3 text-[11px]">
                    <button onClick={() => setBonosAd(bonosAd.map((x, i) => (i === 0 ? x : bonosAd[0])))} className="text-brand-orange font-semibold hover:underline">Igualar todos al mes 1</button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {meses.length > 0 && meses[0].pct_gross != null && (
            <>
              <GrossClaro meses={meses} anual={a} nombreMes={nombreMes} nombreCorto={nombreCorto} pctBajas={Number(p.pct_bajas_gross ?? 60)} />
              {Array.isArray(p.zafra_pct) && p.zafra_pct.length > 0 && (
                <ZafraEvolucion zafra={p.zafra_pct.map(Number)} zafraReal={defaults?.zafra_pct?.map(Number)} ventas={Number(ventas[0] ?? p.ventas ?? 0)} />
              )}
            </>
          )}
          {res && a && (
            <div>
            <Bloque titulo="Gráficos del período" abierto envuelto={false} hint="resultado mes a mes · ventas vs estructura · ola de la zafra en rojo" sinImprimir>
            <div className="grid xl:grid-cols-2 gap-6 print:block">
              <section className="card p-5 print:mb-5 sim-impreso-inicio">
                <h2 className="font-display text-lg text-brand-ink uppercase mb-1">Resultado mes a mes</h2>
                <p className="text-xs text-brand-slate mb-3">Ingreso neto liquidado (con ajustes de cohortes anteriores) vs costos; barras de resultado y línea de margen del mes (%, eje derecho). El área roja es la ola: las devoluciones que las cohortes anteriores ya dejaron comprometidas para ese mes, venda lo que venda.</p>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={meses} margin={{ top: 8, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="mes" fontSize={10} tickFormatter={(v: number) => nombreCorto(v - 1)} />
                    <YAxis yAxisId="l" fontSize={10} tickFormatter={M} domain={ejesResultado.izq} allowDataOverflow />
                    <YAxis yAxisId="r" orientation="right" fontSize={10} tickFormatter={(v: number) => `${Math.round(v)}%`} domain={ejesResultado.der} ticks={ejesResultado.ticksDer} allowDataOverflow />
                    <Tooltip
                      formatter={(v: any, name: any) => (name === "Margen del mes" ? `${Number(v).toFixed(1)}%` : formatGs(Number(v)))}
                      labelFormatter={(l) => nombreMes(Number(l) - 1)}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine yAxisId="l" y={0} stroke="#0F1116" />
                    <Bar yAxisId="l" dataKey="ingreso_neto" name="Ingreso neto" fill="#0EA5E9" fillOpacity={0.6} />
                    <Bar yAxisId="l" dataKey="costo_total" name="Costos" fill="#F39200" fillOpacity={0.6} />
                    <Area yAxisId="l" dataKey="ola_devoluciones" name="Ola de devoluciones heredadas" stroke="#E6332A" fill="#E6332A" fillOpacity={0.28} strokeWidth={1.5} type="monotone" />
                    <Bar yAxisId="l" dataKey="resultado" name="Resultado">
                      {meses.map((m: any) => <Cell key={m.mes} fill={m.resultado >= 0 ? "#10B981" : "#E6332A"} />)}
                    </Bar>
                    <Line yAxisId="r" dataKey="margen_pct" name="Margen del mes" stroke="#0F1116" strokeWidth={2.5} dot={{ r: 2.5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
                <Lectura>
                  Cada mes liquida la facturación de sus ventas más lo que devuelven o suman las cohortes anteriores. El mes 1
                  no tiene ajustes (todavía no cayó nada); desde el mes 2 llegan los chargebacks y desde el 3 la cuota 2. Por
                  eso el mes 1 suele verse mejor que el resto. La línea negra es el margen de cada mes (resultado sobre
                  ingreso neto, eje derecho): cuando se estabiliza, ese es el margen real del negocio en régimen. El
                  acumulado del período está en la tabla de abajo y en el cierre.
                </Lectura>
              </section>
  
              <section className="card p-5">
                <h2 className="font-display text-lg text-brand-ink uppercase mb-1">Ventas vs estructura fija</h2>
                <p className="text-xs text-brand-slate mb-3">{negocio === "gpon" ? "Activaciones" : "Ventas"} de cada mes contra el {cfg.objetivoLabel} y la capacidad de la estructura ({hc?.vendedores} vendedores × {p.costos.ventas_por_vendedor}).</p>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={meses.map((m: any) => ({ ...m, capacidad: (hc?.vendedores ?? 0) * Number(p.costos.ventas_por_vendedor) }))} margin={{ top: 8, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="mes" fontSize={10} tickFormatter={(v: number) => nombreCorto(v - 1)} />
                    <YAxis yAxisId="l" fontSize={10} />
                    <YAxis yAxisId="r" orientation="right" fontSize={10} tickFormatter={(v: number) => `${v}`} />
                    <Tooltip labelFormatter={(l) => nombreMes(Number(l) - 1)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="l" dataKey="ventas" name="Ventas">
                      {meses.map((m: any) => <Cell key={m.mes} fill={m.en_riesgo ? "#E6332A" : m.monto_bono_productividad > 0 ? "#0EA5E9" : "#F39200"} />)}
                    </Bar>
                    <Area yAxisId="l" dataKey="ventas_equilibrio" name="Ventas mínimas para no perder (ola + estructura)" stroke="#E6332A" fill="#E6332A" fillOpacity={0.18} strokeWidth={2} strokeDasharray="5 3" type="monotone" connectNulls={false} />
                    <ReferenceLine yAxisId="l" y={Number(p[cfg.objetivoKey])} stroke="#E6332A" strokeDasharray="6 3" label={{ value: `Objetivo ${formatInt(Number(p[cfg.objetivoKey]))}`, position: "insideTopRight", fill: "#E6332A", fontSize: 10, fontWeight: 700 }} />
                    <Line yAxisId="l" dataKey="capacidad" name="Capacidad de la estructura" stroke="#0F1116" strokeDasharray="4 3" dot={false} />
                    <Line yAxisId="r" dataKey="ventas_por_vendedor" name="Ventas por vendedor" stroke="#662483" strokeWidth={2} dot={{ r: 2.5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
                <Lectura>
                  Barras: ventas del mes (rojas cuando quedan por debajo del área roja, naranjas cuando pierden el bono productividad). El área roja
                  es el riesgo potencial por bajar productividad: las ventas mínimas que cada mes necesita para cubrir la ola de devoluciones
                  heredadas de los meses anteriores más la estructura fija. Crece con meses de ventas estables y no baja cuando bajan las ventas:
                  por eso una caída de productividad después de una racha alta pierde plata aunque la estructura sea la misma. La línea punteada
                  negra es lo que la estructura fija puede vender; la violeta, las ventas reales por vendedor.
                </Lectura>
              </section>
            </div>
  
            </Bloque>
            </div>
          )}

          {editandoMes != null && (
            <MesAfectadoEditor mes={editandoMes} nombre={nombreMes(editandoMes - 1)} nombres={nombres.map((_, i) => nombreMes(i))} horizonte={horizonte} base={baseMes} ventas={ventas[editandoMes - 1] ?? 0}
              actual={afectados[String(editandoMes)]}
              onAplicar={(meses, ov) => { aplicarAfectado(meses, ov); setEditandoMes(null); }}
              onQuitar={(m) => { quitarAfectado(m); setEditandoMes(null); }}
              onCerrar={() => setEditandoMes(null)} campos={camposMes} />
          )}

          <div className={`flex flex-wrap items-center justify-between gap-3 rounded-md border-2 px-4 py-3 ${p.bonos_activos === false ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border bg-white"}`}>
            <div>
              <div className={`text-[10px] uppercase tracking-wider2 font-bold ${p.bonos_activos === false ? "text-white/70" : "text-brand-slate"}`}>Escenario de bonos</div>
              <div className="text-sm font-semibold">
                {p.bonos_activos === false
                  ? `Bonos DESACTIVADOS — los ${horizonte} meses se calculan ${cfg.textoSinBonos}`
                  : `Bonos activos — ${cfg.textoConBonos}`}
              </div>
            </div>
            <div className="no-print flex flex-wrap gap-2">
              {negocio === "movil" && p.bonos_activos !== false && (
                <button onClick={() => setP((prev: any) => (prev.bono_unico ? quitarBonoUnico(prev, defaults) : aplicarBonoUnico(prev)))}
                  title="Propuesta 2027: un solo bono por línea que reemplaza a productividad + efectividad, sin descuento en las caídas. Escala: ≥110% 55.000 · ≥100% 50.000 · ≥95% 35.000 · ≥90% 25.000"
                  className={`px-4 py-2 rounded-md text-sm font-bold border transition-colors ${bonoUnico ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-emerald-700 border-emerald-600 hover:bg-emerald-50"}`}>
                  {bonoUnico ? "✓ Bono único propuesto" : "Bono único propuesto"}
                </button>
              )}
              <button onClick={() => setP((prev: any) => ({ ...prev, bonos_activos: prev.bonos_activos === false }))}
                className={`px-4 py-2 rounded-md text-sm font-bold transition-colors ${p.bonos_activos === false ? "bg-white text-brand-ink hover:bg-brand-bg" : "bg-brand-primary text-white hover:bg-brand-primary/90"}`}>
                {p.bonos_activos === false ? "Reactivar bonos" : "Simular sin bonos"}
              </button>
            </div>
          </div>

          {bonoUnico && p.bonos_activos !== false && (
            <div className="rounded-md border-2 border-emerald-600 bg-emerald-50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider2 font-bold text-emerald-700">Bono único propuesto · propuesta 2027</div>
                  <div className="text-sm font-semibold text-brand-ink">Un solo bono por línea, según cumplimiento del objetivo CO, que reemplaza a productividad y efectividad. No se descuenta en las caídas.</div>
                  <div className="text-[11px] text-brand-slate">Por debajo del 90% liquida 0. La escala se puede editar en "Bono productividad" de las variables del mes 1.</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {BONO_UNICO_ESCALA.map((e) => {
                    const actual = (p.escala_productividad ?? []).find((x: any) => Number(x.desde_pct) === e.desde_pct);
                    return (
                      <div key={e.desde_pct} className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-center">
                        <div className="text-[9px] uppercase tracking-wider2 text-brand-slate font-bold">≥ {e.desde_pct}%</div>
                        <div className="font-display text-lg leading-tight text-emerald-700">{formatGs(Number(actual?.monto ?? e.monto))}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {a && meses.length > 0 && (
                <div className="mt-2 text-[11px] text-brand-graphite">
                  En esta simulación el bono único liquida <b>{formatGs(a.bonos)}</b> en {horizonte} meses ({formatGs(a.bonos / Math.max(a.ventas, 1))} por venta) y no devuelve nada; hoy los dos bonos devolverían cerca de la mitad.
                </div>
              )}
            </div>
          )}

          {negocio === "movil" && p.bonos_activos !== false && !bonoUnico && (
            <div className={`rounded-md border-2 px-4 py-3 ${sinDescProd || sinDescEfec ? "border-emerald-600 bg-emerald-50" : "border-brand-border bg-white"}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className={`text-[10px] uppercase tracking-wider2 font-bold ${sinDescProd || sinDescEfec ? "text-emerald-700" : "text-brand-slate"}`}>Descuentos de Claro sobre los bonos · escenario de negociación</div>
                  <div className="text-sm font-semibold text-brand-ink">
                    {!sinDescProd && !sinDescEfec && "Claro descuenta los dos bonos en las caídas (así liquida hoy)"}
                    {sinDescProd && !sinDescEfec && "Claro NO descuenta el bono productividad (sin recálculo al mes 6)"}
                    {!sinDescProd && sinDescEfec && "Claro NO descuenta el bono efectividad / logística en las caídas"}
                    {sinDescProd && sinDescEfec && "Claro NO descuenta ningún bono en las caídas"}
                  </div>
                  <div className="text-[11px] text-brand-slate">Los bonos se cobran igual en el mes; lo que cambia es que las líneas caídas no lo devuelven. Se guarda con la simulación.</div>
                </div>
                <div className="no-print flex flex-wrap gap-2">
                  <button onClick={() => setP((prev: any) => ({ ...prev, devolver_bono_productividad: prev.devolver_bono_productividad === false }))}
                    className={`px-3 py-2 rounded-md text-xs font-bold border transition-colors ${sinDescProd ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-brand-ink border-brand-border hover:bg-brand-bg"}`}>
                    {sinDescProd ? "✓ Sin descuento sobre bono productividad" : "No aplicar descuento sobre bono productividad"}
                  </button>
                  <button onClick={() => setP((prev: any) => ({ ...prev, devolver_bono_efectividad: prev.devolver_bono_efectividad === false }))}
                    className={`px-3 py-2 rounded-md text-xs font-bold border transition-colors ${sinDescEfec ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-brand-ink border-brand-border hover:bg-brand-bg"}`}>
                    {sinDescEfec ? "✓ Sin descuento sobre bono logística" : "No aplicar descuento sobre bono logística"}
                  </button>
                </div>
              </div>
              {(sinDescProd || sinDescEfec) && a && resConDesc?.anual && (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { t: "Devolución de bonos evitada", v: formatGs((a.devolucion_bonos ?? 0) - (resConDesc.anual.devolucion_bonos ?? 0)), s: `en ${horizonte} meses · con descuentos era ${formatGs(resConDesc.anual.devolucion_bonos ?? 0)}` },
                    { t: "Resultado del período", v: formatGs(a.resultado), s: `con descuentos ${formatGs(resConDesc.anual.resultado)}`, delta: a.resultado - resConDesc.anual.resultado },
                    { t: "Margen del período", v: `${String(a.margen_pct).replace(".", ",")}%`, s: `con descuentos ${String(resConDesc.anual.margen_pct).replace(".", ",")}%` },
                    { t: "Resultado con cola", v: formatGs(a.resultado_con_cola), s: `con descuentos ${formatGs(resConDesc.anual.resultado_con_cola)}`, delta: a.resultado_con_cola - resConDesc.anual.resultado_con_cola },
                  ].map((k) => (
                    <div key={k.t} className="rounded-md border border-emerald-200 bg-white px-3 py-2">
                      <div className="text-[9px] uppercase tracking-wider2 text-brand-slate font-bold">{k.t}</div>
                      <div className="font-display text-xl leading-tight text-brand-ink">{k.v}</div>
                      <div className="text-[10px] text-brand-slate">{k.s}{k.delta != null && <b className="ml-1 text-emerald-700">({k.delta >= 0 ? "+" : ""}{formatGs(k.delta)})</b>}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}


          <div className="rounded-md border-2 border-brand-primary bg-brand-primary/5 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-primary">Ajuste de comisiones</div>
              <div className="text-sm font-semibold text-brand-ink">
                {Number(p.ajuste_comisiones_pct || 0) === 0
                  ? `Sin ajuste — ${cfg.ajusteTxt} según tarifa vigente`
                  : `${cfg.ajusteTxt.charAt(0).toUpperCase() + cfg.ajusteTxt.slice(1)} ${Number(p.ajuste_comisiones_pct) > 0 ? "mejoran" : "bajan"} ${Math.abs(Number(p.ajuste_comisiones_pct))}%`}
              </div>
              <div className="text-[11px] text-brand-slate">{cfg.ajusteHint}</div>
            </div>
            <div className="flex flex-wrap items-center gap-3 no-print">
              {negocio === "movil" && (
                <button onClick={() => setP((prev: any) => ({ ...prev, ajuste_comisiones_pct: Number(prev.ajuste_comisiones_pct || 0) !== 0 ? 0 : AJUSTE_OPTIMIZAR_PCT }))}
                  title={Number(p.ajuste_comisiones_pct || 0) !== 0
                    ? "Destildar: vuelve el ajuste a 0% (tarifa vigente)."
                    : `Propuesta 2027: carga +${AJUSTE_OPTIMIZAR_PCT}% sobre cuota 1, cuota 2 y porta en todos los planes. Después se puede corregir el porcentaje antes de simular.`}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider2 border transition-colors ${Number(p.ajuste_comisiones_pct || 0) !== 0 ? "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700" : "bg-white text-emerald-700 border-emerald-600 hover:bg-emerald-50"}`}>
                  {Number(p.ajuste_comisiones_pct || 0) !== 0 ? `✓ Optimizado ${Number(p.ajuste_comisiones_pct) > 0 ? "+" : ""}${Number(p.ajuste_comisiones_pct)}% · destildar` : `Optimizar (+${AJUSTE_OPTIMIZAR_PCT}%)`}
                </button>
              )}
              <label className="flex items-center gap-2 text-sm">
                <span className="text-brand-graphite">Ajuste</span>
                <input type="number" step={0.5} value={p.ajuste_comisiones_pct ?? 0}
                  onChange={(e) => setP((prev: any) => ({ ...prev, ajuste_comisiones_pct: Number(e.target.value) }))}
                  className="input max-w-[90px] !py-1.5 text-right font-bold text-brand-primary" />
                <span className="text-brand-graphite">%</span>
              </label>
            </div>
          </div>
          {negocio === "movil" && Number(p.ajuste_comisiones_pct || 0) !== 0 && (
            <div className="rounded-md border border-brand-border bg-white px-4 py-2 overflow-x-auto">
              <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate mb-1">Tarifa resultante por plan · cuota 1 / cuota 2 / porta plus (hoy → con {Number(p.ajuste_comisiones_pct) > 0 ? "+" : ""}{Number(p.ajuste_comisiones_pct)}%)</div>
              <table className="text-xs w-full">
                <tbody>
                  {(p.planes ?? []).map((pl: any) => {
                    const f = 1 + Number(p.ajuste_comisiones_pct) / 100;
                    return (
                      <tr key={pl.plan} className="border-t border-brand-border/50">
                        <td className="py-1 font-semibold text-brand-ink w-20">{pl.plan}</td>
                        <td className="py-1 text-brand-slate">mix {Number(pl.mix_pct)}% · abono {formatGs(Number(pl.abono))}</td>
                        <td className="py-1 text-right">{formatGs(Number(pl.cuota1))} → <b className="text-brand-primary">{formatGs(Number(pl.cuota1) * f)}</b></td>
                        <td className="py-1 text-right">{formatGs(Number(pl.cuota2))} → <b className="text-brand-primary">{formatGs(Number(pl.cuota2) * f)}</b></td>
                        <td className="py-1 text-right">{formatGs(Number(pl.porta_plus))} → <b className="text-brand-primary">{formatGs(Number(pl.porta_plus) * f)}</b></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <Bloque titulo="Detalle de meses y variables" accent="purple" abierto={Object.keys(afectados).length > 0}
            hint={Object.keys(afectados).length ? `${Object.keys(afectados).length} mes(es) con variaciones propias` : "ningún mes con variaciones"}>
            <ResumenAfectados afectados={afectados} base={baseMes} ventas={ventas} nombres={nombres.map((_, i) => nombreMes(i))} onEditar={(m) => setEditandoMes(m)} onQuitar={quitarAfectado} sinCard campos={camposMes} />
          </Bloque>

          {res && a && (
            <>
              <Bloque titulo="Estructura operativa necesaria" hint={hc ? `${hc.vendedores} vendedores · ${hc.supervisores} supervisores · ${hc.backoffice} backoffice · ${hc.total} personas · fija los ${horizonte} meses` : "estructura fija del mes 1"}>
                <EstructuraOperativa costos={meses[0]?.costos} p={p} ventas={ventas[0] ?? 0} ventasGpon={gponOn ? Number(hc?.ventas_gpon_mes1 ?? 0) : 0} sinCard
                  intro={`Estructura del mes 1, fija para los ${horizonte} meses. Dimensionada para ${formatInt(ventas[0] ?? 0)} ventas efectivas de pospago${gponOn ? `; la misma dotación vende además ${asesorMes1} GPON por asesor (${formatInt(hc?.ventas_gpon_mes1 ?? 0)} activaciones GPON en el mes 1) sin personas adicionales` : ""}`} />
              </Bloque>

              <Bloque titulo="Datos generales operativos y financieros" hint={`${horizonte} meses · ${formatInt(a.ventas)} ventas${gponOn ? ` + ${formatInt(a.ventas_gpon ?? 0)} GPON` : ""}`}>
              <div className="rounded-md border-l-4 border-brand-ink bg-brand-bg-soft px-4 py-3 mb-4">
                <h3 className="text-[11px] uppercase tracking-wider2 text-brand-slate font-bold mb-1">Conclusión del período ({horizonte} meses)</h3>
                <p className="text-[15px] text-brand-ink leading-relaxed font-medium">{res.conclusion}</p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {([
                  ["kpi:ventas", `Ventas en ${horizonte} meses`, <KpiCard key="k1" label={`Ventas en ${horizonte} meses`} value={formatInt(a.ventas)} hint={`${formatInt(Math.round(a.ventas / horizonte))} por mes`} accent="neutral" />],
                  ["kpi:bruta", "Facturación bruta", <KpiCard key="k2" label="Facturación bruta" value={formatGs(a.facturacion_bruta)} hint={`suma de los ${horizonte} meses`} accent="primary" />],
                  ["kpi:neto", "Ingreso neto liquidado", <KpiCard key="k3" label="Ingreso neto liquidado" value={formatGs(a.ingreso_neto)} hint={`ajustes ${formatGs(a.ajustes)}`} accent="cyan" />],
                  ["kpi:costos", "Costos del período", <KpiCard key="k4" label="Costos del período" value={formatGs(a.costos)} hint={`fijos ${formatGs(a.costos_fijos_mes)}/mes`} accent="orange" />],
                  ["kpi:resultado", `Resultado a ${horizonte} meses`, <KpiCard key="k5" label={`Resultado a ${horizonte} meses`} value={formatGs(a.resultado)} hint={`${a.margen_pct}% sobre ingreso neto`} accent={a.resultado >= 0 ? "cyan" : "primary"} />],
                  ["kpi:cola", `Con cola post-${horizonte}`, <KpiCard key="k6" label={`Con cola post-${horizonte}`} value={formatGs(a.resultado_con_cola)} hint={`pendiente ${formatGs(a.cola_post_12.total)}`} accent={a.resultado_con_cola >= 0 ? "cyan" : "primary"} />],
                ] as Array<[string, string, React.ReactNode]>).map(([key, label, card]) => (
                  <Marcable key={key} marcado={esMarcado(key)} onToggle={() => toggleMarca(key, label)}>{card}</Marcable>
                ))}
              </div>
              {gponOn && a.ventas_gpon != null && (
                <>
                  <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-cyan mt-4 mb-2">Convergente · pospago y GPON por la misma estructura</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                    {([
                      ["kpi:gpon_ventas", "Activaciones GPON", <KpiCard key="g1" label={`Activaciones GPON en ${horizonte} meses`} value={formatInt(a.ventas_gpon)} hint={`${a.gpon_por_asesor} por asesor · ${formatInt(hc?.vendedores ?? 0)} vendedores`} accent="neutral" />],
                      ["kpi:gpon_bruta", "Facturación bruta GPON", <KpiCard key="g2" label="Facturación bruta GPON" value={formatGs(a.facturacion_bruta_gpon ?? 0)} hint="cuota 1 y bono fijo" accent="primary" />],
                      ["kpi:gpon_neto", "Ingreso neto GPON", <KpiCard key="g3" label="Ingreso neto GPON" value={formatGs(a.ingreso_neto_gpon ?? 0)} hint={`${a.aporte_gpon_ingreso_pct ?? 0}% del convergente · mora ${formatGs(Math.abs(a.gpon_mora ?? 0))}`} accent="cyan" />],
                      ["kpi:gpon_costos", "Costos variables GPON", <KpiCard key="g4" label="Costos variables GPON" value={formatGs(a.costos_gpon ?? 0)} hint="comisión, plus, documentación 55.000 y operativos · sin estructura" accent="orange" />],
                      ["kpi:gpon_resultado", "Resultado GPON", <KpiCard key="g5" label="Resultado GPON" value={formatGs(a.resultado_gpon ?? 0)} hint={`${a.margen_pct_gpon ?? 0}% · incremental`} accent={(a.resultado_gpon ?? 0) >= 0 ? "cyan" : "primary"} />],
                      ["kpi:movil_resultado", "Resultado pospago", <KpiCard key="g6" label="Resultado pospago" value={formatGs(a.resultado_movil ?? 0)} hint={`${a.margen_pct_movil ?? 0}% · con toda la estructura`} accent={(a.resultado_movil ?? 0) >= 0 ? "cyan" : "primary"} />],
                    ] as Array<[string, string, React.ReactNode]>).map(([key, label, card]) => (
                      <Marcable key={key} marcado={esMarcado(key)} onToggle={() => toggleMarca(key, label)}>{card}</Marcable>
                    ))}
                  </div>
                  <p className="text-[11px] text-brand-slate mt-2">La estructura fija se carga entera al pospago; GPON solo paga comisión, plus y operativos por venta. Por eso su resultado es incremental: lo que agrega vender GPON con la misma gente.</p>
                </>
              )}
              </Bloque>

              <Bloque titulo="Historia del negocio · línea de tiempo animada" abierto accent="primary" hint="dale play: el gráfico se construye mes a mes con sus hitos y alertas">
                <HistoriaNegocio res={res} p={cfg.pHist(p)} nombre={nombreMes} />
              </Bloque>

              {a.veredicto && (() => {
                const cola = a.cola_post_12;
                const v = a.veredicto;
                const gana = v.gana;
                const respuesta = gana
                  ? `Sí. Los ${horizonte} meses facturan ${formatGs(a.facturacion_bruta)}; con las devoluciones y cobros que llegan dentro del período quedan ${formatGs(a.ingreso_neto)} liquidados contra ${formatGs(a.costos)} de costos. Sumando lo que las cohortes todavía tienen pendiente después del mes ${horizonte}, el negocio cierra ganando ${formatGs(v.resultado_final)} (${v.pct_sobre_ingreso}% del ingreso).`
                  : `No. Los ${horizonte} meses facturan ${formatGs(a.facturacion_bruta)}; con las devoluciones y cobros que llegan dentro del período quedan ${formatGs(a.ingreso_neto)} liquidados contra ${formatGs(a.costos)} de costos. Sumando lo que las cohortes todavía tienen pendiente después del mes ${horizonte}, el negocio cierra perdiendo ${formatGs(Math.abs(v.resultado_final))} (${v.pct_sobre_ingreso}% del ingreso).`;
                const notas = [
                  `Sin la cola, el período ${v.periodo_gana ? "gana" : "pierde"} ${formatGs(Math.abs(a.resultado))}. La cola ${cola.total >= 0 ? "suma" : "resta"} ${formatGs(Math.abs(cola.total))}: ${formatGs(cola.cobros)} por cobrar (${txt.cobrosTxt}, hasta el mes ${cola.ultimo_mes_residual}) contra ${formatGs(Math.abs(cola.devoluciones))} por devolver (${txt.devTxt} hasta el mes ${cola.ultimo_mes_caidas}).`,
                  v.la_cola_lo_da_vuelta
                    ? (gana ? "La cola da vuelta el resultado: el período cerraba en pérdida y lo pendiente por cobrar lo lleva a ganancia. Depende de que las líneas sigan activas según la zafra."
                            : "La cola da vuelta el resultado: el período cerraba en ganancia pero las devoluciones pendientes de las últimas cohortes la consumen.")
                    : `El signo no cambia con la cola: lo que el período muestra es lo que el negocio ${gana ? "gana" : "pierde"} de verdad.`,
                  `La cola es solo lo que las ${horizonte} cohortes ya vendidas tienen por liquidar; no incluye ventas nuevas. Si el negocio sigue, el mes ${horizonte + 1} arranca con esa cola ${cola.total >= 0 ? "a favor" : "en contra"}.`,
                ];
                return (
                  <>
                    <Bloque titulo="Qué significa cada cuadro" hint="uno por uno, con el valor de esta simulación">
                    <ExplicacionCuadros sinCard
                      intro={`Los seis cuadros de "Datos generales", uno por uno, con el valor de esta simulación de ${horizonte} meses.`}
                      items={[
                        { label: `Ventas en ${horizonte} meses`, valor: formatInt(a.ventas), accent: "neutral",
                          queEs: `La suma de las ventas cargadas mes a mes (${formatInt(Math.round(a.ventas / horizonte))} por mes en promedio).`,
                          comoLeerlo: `Cada mes es una cohorte: factura en su mes y después ajusta durante los meses siguientes (${txt.ajustesTxt}).` },
                        { label: "Facturación bruta", valor: formatGs(a.facturacion_bruta), accent: "primary",
                          queEs: "Lo que cada mes factura en el momento de la venta: cuota 1, plus de portabilidad y bonos, sumado en el período.",
                          comoLeerlo: "No es ingreso: una parte se devuelve cuando las líneas caen. Es el punto de partida del puente de la derecha." },
                        { label: "Ingreso neto liquidado", valor: formatGs(a.ingreso_neto), accent: "cyan",
                          queEs: `Facturación bruta menos las devoluciones (${formatGs(Math.abs(a.devoluciones_periodo))}) más los cobros (${formatGs(a.cobros_periodo)}) que llegaron dentro del período.`,
                          comoLeerlo: `Es lo que Claro efectivamente liquidó en estos ${horizonte} meses. Los ajustes de las últimas cohortes todavía no llegaron: están en la cola.` },
                        { label: "Costos del período", valor: formatGs(a.costos), accent: "orange",
                          queEs: `Estructura fija del mes 1 (${formatGs(a.costos_fijos_mes)} por mes) más comisiones, logística y operativos de cada mes.`,
                          comoLeerlo: "Los fijos se pagan aunque un mes venda menos; los variables siguen a las ventas. Se pagan en el mes, sin espera." },
                        { label: `Resultado a ${horizonte} meses`, valor: formatGs(a.resultado), accent: a.resultado >= 0 ? "cyan" : "primary",
                          queEs: "Ingreso neto liquidado menos costos del período: lo que el período dejó en caja.",
                          comoLeerlo: "Está incompleto: las últimas cohortes todavía tienen caídas por devolver y residual por cobrar. Es caja, no resultado final." },
                        { label: `Con cola post-${horizonte}`, valor: formatGs(a.resultado_con_cola), accent: a.resultado_con_cola >= 0 ? "cyan" : "primary",
                          queEs: `Resultado más lo pendiente de las cohortes después del mes ${horizonte}: ${formatGs(cola.cobros)} por cobrar y ${formatGs(Math.abs(cola.devoluciones))} por devolver.`,
                          comoLeerlo: "Es la respuesta a “ganamos o perdemos”: cuando ya no queda nada por caer ni por cobrar, este es el número." },
                      ]}
                    />
                    </Bloque>
                    <Bloque titulo={`¿Ganamos o perdemos al final, cuando cayeron todas las caídas de los ${horizonte} meses?`} accent={gana ? "ink" : "primary"}
                      hint={<span className={`font-bold ${gana ? "text-emerald-700" : "text-brand-primary"}`}>{gana ? "Ganamos" : "Perdemos"} {formatGs(Math.abs(v.resultado_final))}</span>}>
                    <VeredictoCierre sinCard
                      gana={gana}
                      monto={v.resultado_final}
                      titulo={`¿Ganamos o perdemos al final, cuando cayeron todas las caídas de los ${horizonte} meses?`}
                      respuesta={respuesta}
                      pasos={[
                        { label: "Facturación bruta", valor: a.facturacion_bruta, tipo: "base", nota: `${horizonte} meses de ventas` },
                        { label: "Devoluciones dentro del período", valor: a.devoluciones_periodo, tipo: "menos", nota: `${txt.devTxt} de las cohortes ya liquidadas` },
                        { label: "Cobros dentro del período", valor: a.cobros_periodo, tipo: "mas", nota: `${txt.cobrosTxt} de las cohortes anteriores` },
                        { label: "Ingreso neto liquidado", valor: a.ingreso_neto, tipo: "sub" },
                        { label: "Costos del período", valor: a.costos, tipo: "menos", nota: `fijos ${formatGs(a.costos_fijos_mes)}/mes + variables` },
                        { label: `Resultado a ${horizonte} meses`, valor: a.resultado, tipo: "sub" },
                        { label: `Devoluciones pendientes después del mes ${horizonte}`, valor: cola.devoluciones, tipo: "menos", nota: `caídas de las últimas cohortes, hasta el mes ${cola.ultimo_mes_caidas}` },
                        { label: `Cobros pendientes después del mes ${horizonte}`, valor: cola.cobros, tipo: "mas", nota: `${txt.cobrosTxt}, hasta el mes ${cola.ultimo_mes_residual}` },
                        { label: "Resultado final con todas las caídas", valor: v.resultado_final, tipo: "final", nota: `${v.pct_sobre_ingreso}% del ingreso total` },
                      ]}
                      notas={notas}
                    />
                    </Bloque>
                  </>
                );
              })()}

              {(a.meses_en_riesgo?.length > 0) && (
                <section className="card p-5 border-2 border-brand-primary bg-brand-primary/5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[260px] flex-1">
                      <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-primary">Riesgo potencial por bajar productividad · la ola de la zafra</div>
                      <div className="font-display text-2xl text-brand-ink uppercase mt-0.5">{a.meses_en_riesgo.length} de {horizonte} meses no cubren la ola heredada</div>
                      <p className="text-[13px] text-brand-graphite leading-relaxed mt-2">
                        Cada mes de ventas deja comprometidas devoluciones para los meses siguientes ({txt.olaTxt}).
                        Con ventas estables esa ola crece hasta estabilizarse alrededor del mes {a.ola_maxima_mes} ({formatGs(Math.abs(a.ola_maxima))} por mes). Si después las ventas bajan,
                        la ola sigue pegando sobre una facturación menor y el mes pierde, aunque la estructura no cambie. El área roja de los gráficos muestra esa ola y las ventas mínimas que exige.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {a.meses_en_riesgo.map((mm: number) => {
                          const f = meses[mm - 1];
                          return <span key={mm} className="px-2 py-0.5 rounded-full bg-brand-primary text-white text-[11px] font-bold">{nombreMes(mm - 1)}: {formatInt(f.ventas)} vs {f.ventas_equilibrio == null ? "ni triplicando" : `${formatInt(f.ventas_equilibrio)} necesarias`}</span>;
                        })}
                      </div>
                    </div>
                    <div className="rounded-md border border-brand-border bg-white px-4 py-3 text-right">
                      <div className="text-[9px] uppercase tracking-wider2 text-brand-slate">Ola máxima</div>
                      <div className="font-mono text-lg font-bold text-brand-primary">{formatGs(Math.abs(a.ola_maxima))}</div>
                      <div className="text-[10px] text-brand-slate">devoluciones heredadas en {nombreMes(a.ola_maxima_mes - 1)}</div>
                      <div className="text-[9px] uppercase tracking-wider2 text-brand-slate mt-2">Ventas mínimas para no perder</div>
                      <div className="font-mono text-lg font-bold text-brand-ink">hasta {formatInt(a.ventas_equilibrio_max)} / mes</div>
                    </div>
                  </div>
                </section>
              )}


              <Bloque titulo={`Estado de resultados a ${horizonte} meses (EERR)`} abierto envuelto={false} hint="liquidación mes a mes · estructura fija del mes 1">
              {/* ===== EERR anual ===== */}
              <section className="card overflow-x-auto sim-impreso-inicio">
                <div className="px-4 pt-4">
                  <h2 className="font-display text-xl text-brand-ink uppercase">Estado de resultados a {horizonte} meses (EERR)</h2>
                  <p className="text-xs text-brand-slate mb-2">Liquidación mes a mes con estructura fija del mes 1. Cada columna es un mes calendario; la última, el total del período.</p>
                </div>
                <table className="w-full text-[11px]" style={{ minWidth: `${300 + meses.length * 74}px` }}>
                  <thead className="border-b border-brand-border">
                    <tr className="text-[9px] uppercase tracking-wider2 text-brand-slate">
                      <th className="px-3 py-2 text-left sticky left-0 bg-white">Concepto</th>
                      {meses.map((m: any) => (
                        <th key={m.mes} className={`px-2 py-2 text-right ${esMarcado(`mes:${m.mes}`) ? "bg-amber-100 text-brand-ink" : ""} ${m.afectado ? "text-brand-purple" : ""}`}
                          title={m.afectado || m.gpon_afectado ? `Mes afectado: ${describirVariaciones(afectados[String(m.mes)] ?? {}, baseMes, camposMes).join(" · ")}` : undefined}>
                          <span className="inline-flex items-center gap-1 justify-end">
                            {m.afectado && <span className="w-1.5 h-1.5 rounded-full bg-brand-purple" />}
                            <Pin marcado={esMarcado(`mes:${m.mes}`)} onClick={() => toggleMarca(`mes:${m.mes}`, `${nombreMes(m.mes - 1)} (${formatInt(m.ventas)} ventas)`)} className="!w-4 !h-4 !text-[9px]" />
                            <span title={nombreMes(m.mes - 1)}>{nombreCorto(m.mes - 1)}</span>
                          </span>
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right bg-brand-primary/5 text-brand-primary">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eerrRows.map(([label, key, fmt, tipo]) => {
                      const val = (m: any): number => {
                        if (!key) return 0;
                        const ctMovil = m.costo_total_movil ?? m.costo_total;   // convergente: la estructura va entera al pospago
                        if (key === "_fijo") return ctMovil - m.costos.rrhh.operadores_comisiones * (1 + Number(p.costos.ips_pct) / 100 + (p.costos.aguinaldo ? 1 / 12 : 0)) - (m.costos.plus_vendedores ?? 0) - m.costos.logistica_entregas - m.costos.operativos - (m.costos.documentacion ?? 0);
                        if (key === "_comisiones") return m.costos.rrhh.operadores_comisiones * (1 + Number(p.costos.ips_pct) / 100 + (p.costos.aguinaldo ? 1 / 12 : 0));
                        if (key === "_plus") return m.costos.plus_vendedores ?? 0;
                        if (key === "_logistica") return m.costos.logistica_entregas;
                        if (key === "_operativos") return m.costos.operativos;
                        if (key === "_gpon_comisiones") return m.gpon_costos?.rrhh_total ?? 0;      // comisión GPON con IPS y aguinaldo (sin estructura)
                        if (key === "_gpon_plus") return m.gpon_costos?.plus_vendedores ?? 0;
                        if (key === "_gpon_logistica") return m.gpon_costos?.logistica_entregas ?? 0;
                        if (key === "_gpon_documentacion") return m.gpon_costos?.documentacion ?? 0;
                        if (key === "_gpon_operativos") return m.gpon_costos?.operativos ?? 0;
                        return Number(m[key] ?? 0);
                      };
                      const anualVal = key === "margen_pct" ? a.margen_pct : key === "acumulado" ? a.resultado : meses.reduce((s: number, m: any) => s + val(m), 0);
                      const cls = tipo === "sep" ? "bg-brand-bg text-[9px] uppercase tracking-wider2 text-brand-slate font-bold"
                        : tipo === "sub" ? "bg-brand-bg-soft font-semibold border-t border-brand-border"
                        : tipo === "total" ? "bg-brand-ink text-white font-bold"
                        : tipo === "pct" ? "text-brand-graphite italic" : tipo === "head" ? "font-semibold" : "";
                      const f = (v: number) => fmt === "int" ? formatInt(v) : fmt === "pct" ? `${Math.round(v * 10) / 10}%` : formatGs(v);
                      return (
                        <tr key={label} className={cls}>
                          <td className={`px-3 py-1 sticky left-0 ${tipo === "total" ? "bg-brand-ink" : tipo === "sub" ? "bg-brand-bg-soft" : tipo === "sep" ? "bg-brand-bg" : "bg-white"} ${tipo === "row" ? "pl-6" : ""} ${key && esMarcado(`eerr:${key}`) ? "!bg-amber-100 !text-brand-ink" : ""}`}>
                            <span className="flex items-center justify-between gap-2">
                              <span className="flex flex-wrap items-center gap-2">{label}{cfg.verificado && (key === "clawback_bonos" || key === "recalculo_productividad") && <Verificado k={key} />}</span>
                              {key && tipo !== "sep" && <Pin marcado={esMarcado(`eerr:${key}`)} onClick={() => toggleMarca(`eerr:${key}`, `EERR · ${label}`)} className="!w-5 !h-5 !text-[10px]" />}
                            </span>
                          </td>
                          {meses.map((m: any) => (
                            <td key={m.mes} className={`px-2 py-1 text-right font-mono whitespace-nowrap ${tipo !== "total" && tipo !== "sep" && val(m) < 0 ? "text-brand-primary" : ""} ${esMarcado(`mes:${m.mes}`) && tipo !== "total" ? "bg-amber-50" : ""}`}>
                              {tipo === "sep" ? "" : f(key === "margen_pct" ? m.margen_pct : val(m))}
                            </td>
                          ))}
                          <td className={`px-3 py-1 text-right font-mono whitespace-nowrap ${tipo !== "total" ? "bg-brand-primary/5" : ""} ${tipo !== "total" && tipo !== "sep" && anualVal < 0 ? "text-brand-primary" : ""}`}>
                            {tipo === "sep" ? "" : f(anualVal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="px-4 py-3">
                  <Lectura>
                    Leé cada columna como la liquidación de ese mes: lo que facturan las ventas del mes, más lo que las cohortes
                    anteriores devuelven (chargeback) o suman (cuota 2, residual), menos los costos — los fijos no cambian, los
                    variables siguen a las ventas. La columna "Total" es el balance del período; la cola posterior (residual por
                    cobrar y devoluciones pendientes de las últimas cohortes) se informa aparte en los KPIs.
                  </Lectura>
                  {cfg.observacion && <ObservacionConceptosEERR />}
                </div>
              </section>

              </Bloque>

              <Bloque titulo="Bonos mes a mes" envuelto={false} hint={`bonos del período ${formatGs(a.bonos)}`}>
              {/* Bonos por mes */}
              <section className="card overflow-x-auto">
                <div className="px-4 pt-4">
                  <h2 className="font-display text-lg text-brand-ink uppercase">Bonos mes a mes</h2>
                  <p className="text-xs text-brand-slate mb-2">Cumplimiento del {cfg.objetivoLabel} ({formatInt(Number(p[cfg.objetivoKey]))}) y escalón alcanzado cada mes. Bonos del período: {formatGs(a.bonos)} · devueltos {formatGs(Math.abs(a.devolucion_bonos))}.</p>
                </div>
                <table className="w-full text-xs min-w-[720px]">
                  <thead className="bg-brand-bg text-[10px] uppercase tracking-wider2 text-brand-slate">
                    <tr><th className="px-3 py-1.5 text-left">Mes</th><th className="px-3 py-1.5 text-right">{negocio === "gpon" ? "Activaciones" : "Ventas"}</th><th className="px-3 py-1.5 text-right">Cumplimiento</th><th className="px-3 py-1.5 text-center">Escalón</th><th className="px-3 py-1.5 text-right">Bono/línea</th>{cfg.bonosCols.map(([l]) => <th key={l} className="px-3 py-1.5 text-right">{l}</th>)}</tr>
                  </thead>
                  <tbody>
                    {meses.map((m: any) => (
                      <tr key={m.mes} className={`border-t border-brand-border ${esMarcado(`mes:${m.mes}`) ? "bg-amber-50" : ""}`}>
                        <td className="px-3 py-1 font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <Pin marcado={esMarcado(`mes:${m.mes}`)} onClick={() => toggleMarca(`mes:${m.mes}`, `${nombreMes(m.mes - 1)} (${formatInt(m.ventas)} ventas)`)} className="!w-4 !h-4 !text-[9px]" />
                            {nombreMes(m.mes - 1)}
                          </span>
                        </td>
                        <td className="px-3 py-1 text-right">{formatInt(m.ventas)}</td>
                        <td className="px-3 py-1 text-right font-mono">{m.cumplimiento_pct}%</td>
                        <td className="px-3 py-1 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${m.escalon_productividad ? "bg-emerald-100 text-emerald-700" : "bg-brand-primary/10 text-brand-primary"}`}>
                            {m.escalon_productividad ? `≥ ${m.escalon_productividad}%` : "sin bono"}
                          </span>
                        </td>
                        <td className="px-3 py-1 text-right font-mono">{formatGs(m.monto_bono_productividad)}</td>
                        {cfg.bonosCols.map(([l, k]) => <td key={l} className="px-3 py-1 text-right font-mono">{formatGs(m[k])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              {gponOn && (
                <section className="card overflow-x-auto mt-4">
                  <div className="px-4 pt-4">
                    <h2 className="font-display text-lg text-brand-ink uppercase">Bono fijo GPON mes a mes</h2>
                    <p className="text-xs text-brand-slate mb-2">Cumplimiento del objetivo GPON ({formatInt(Number(gponReq?.parametros?.objetivo ?? 0))} líneas{gponObjetivoAuto ? " = vendedores × 3" : ""}) y escalón del bono fijo. Bono GPON del período: {formatGs(a.bonos_gpon ?? 0)} · recálculo al mes 6 {formatGs(Math.abs(a.gpon_recalculo ?? 0))} · líneas en mora al cierre {formatInt(a.gpon_lineas_en_mora_final ?? 0)}.</p>
                  </div>
                  <table className="w-full text-xs min-w-[720px]">
                    <thead className="bg-brand-bg text-[10px] uppercase tracking-wider2 text-brand-slate">
                      <tr><th className="px-3 py-1.5 text-left">Mes</th><th className="px-3 py-1.5 text-right">Por asesor</th><th className="px-3 py-1.5 text-right">Activaciones GPON</th><th className="px-3 py-1.5 text-right">Cumplimiento</th><th className="px-3 py-1.5 text-center">Escalón</th><th className="px-3 py-1.5 text-right">Bono/línea</th><th className="px-3 py-1.5 text-right">Bono fijo</th><th className="px-3 py-1.5 text-right">Mora neta</th><th className="px-3 py-1.5 text-right">Recálculo</th><th className="px-3 py-1.5 text-right">Líneas en mora</th></tr>
                    </thead>
                    <tbody>
                      {meses.map((m: any) => (
                        <tr key={m.mes} className={`border-t border-brand-border ${esMarcado(`mes:${m.mes}`) ? "bg-amber-50" : ""}`}>
                          <td className="px-3 py-1 font-medium">{nombreMes(m.mes - 1)}</td>
                          <td className="px-3 py-1 text-right font-mono">{m.gpon_por_asesor}</td>
                          <td className="px-3 py-1 text-right">{formatInt(m.ventas_gpon)}</td>
                          <td className="px-3 py-1 text-right font-mono">{m.gpon_cumplimiento_pct}%</td>
                          <td className="px-3 py-1 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${m.gpon_escalon ? "bg-emerald-100 text-emerald-700" : "bg-brand-primary/10 text-brand-primary"}`}>{m.gpon_escalon ? `≥ ${m.gpon_escalon}%` : "sin bono"}</span>
                          </td>
                          <td className="px-3 py-1 text-right font-mono">{formatGs(m.gpon_monto_bono)}</td>
                          <td className="px-3 py-1 text-right font-mono">{formatGs(m.gpon_bono_fijo)}</td>
                          <td className="px-3 py-1 text-right font-mono text-brand-primary">{formatGs(m.gpon_mora)}</td>
                          <td className="px-3 py-1 text-right font-mono text-brand-primary">{formatGs(m.gpon_recalculo)}</td>
                          <td className="px-3 py-1 text-right">{formatInt(m.gpon_lineas_en_mora)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
              </Bloque>
            </>
          )}
        </div>
      )}
      </div>
      </td></tr></tbody></table>
    </AppShell>
  );
}
