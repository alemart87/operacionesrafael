"use client";

/** Observación: qué conceptos de la liquidación de Claro (con su nombre exacto) alimentan
 *  cada fila del simulador. Se muestra bajo los EERR y bajo el recupero por reconexión. */

export const CONCEPTOS_RECUPERO = {
  devuelto: ["RECONEXIONES", "REVERSO DESCUENTO PORTABILIDAD NUMERICA", "RECUPERO INCENTIVOS REVERSO PENALIDAD", "REVERSO PENALIZACION POR DEUDA", "RECUPERO ACTIVACION"],
  descontado: ["SUSPENSIONES", "DESCUENTO PORTABILIDAD NUMERICA", "DESCUENTO INCENTIVOS POR PENALIDAD", "PENALIZACION POR DEUDA"],
};

/** Verificación fila por fila en las 7 liquidaciones (383–389), exclusivamente sobre los conceptos de bonos.
 *  Cohortes observadas hasta 12 meses (may/jun/jul-25 en la liq. 389): NO hay descuentos de bonos después del día 184. */
export const VERIFICADO_BONOS: Record<string, { corto: string; detalle: string }> = {
  clawback_bonos: {
    corto: "✓ verificado · dentro de 180 días",
    detalle: "Concepto 471: devuelve los 50.000 completos en cada caída dentro de los 180 días (máximo observado: 180). Se concentra en los meses 1 y 2 (PFI). En 6 meses devolvió el 45,8% (cohorte nov-25) y 47,4% (dic-25) de las líneas que cobraron el bono; el 472 re-acredita ~8–11% al reconectar. Nada después del día 180. Motor: clawback_bonos = caídas del mes × % que cobró el bono × monto × (1 − recupero), meses 1 a 6.",
  },
  recalculo_productividad: {
    corto: "✓ verificado · una vez, día 152–184",
    detalle: "Concepto 1871: una sola fila por línea de la cohorte, entre el día 152 y 184 (mediana 163) = liquidación del mes 6. Las caídas devuelven el 100% del bono que cobraron y las activas 0. Líneas castigadas por cohorte: jul-25 41%, ago 45%, sep 52%, oct 51%, nov 52% (promedio 48,5% = zafra al mes 6). Ningún descuento después del día 184, ni a 9 ni a 12 meses. Motor: recalculo = activaciones estado A × bono por línea × (100 − zafra[6]), solo en el mes 6.",
  },
};

/** Chip verde con el detalle de la verificación al pasar el mouse. */
export function Verificado({ k, className = "" }: { k: keyof typeof VERIFICADO_BONOS; className?: string }) {
  const v = VERIFICADO_BONOS[k];
  if (!v) return null;
  return (
    <span title={v.detalle} className={`inline-flex items-center px-1.5 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-800 text-[9px] font-semibold whitespace-nowrap cursor-help ${className}`}>
      {v.corto}
    </span>
  );
}

const FILAS: Array<{ fila: string; conceptos: string[]; nota?: string; verificado?: { corto: string; detalle: string } }> = [
  { fila: "Activaciones (cuota 1)", conceptos: ["ACTIVACIONES · cuota 1"] },
  { fila: "Plus portabilidad", conceptos: ["ACTIVACION PORTABILIDAD NUMERICA"] },
  { fila: "Bono productividad", conceptos: ["INCENTIVO PRODUCTIVIDAD"] },
  { fila: "Bono efectividad", conceptos: ["INCENTIVO EFECTIVIDAD DISTRIBUCION"] },
  { fila: "Residual", conceptos: ["RESIDUAL"] },
  { fila: "Cuota 2", conceptos: ["ACTIVACIONES · cuota 2"] },
  { fila: "Legajos", conceptos: ["LINEA CON DOCUMENTACION FALTANTE", "AJUSTE LEGAJO"], nota: "neto de DEVOLUCION DESCUENTO DOCUMENTACION ACTIVACION" },
  { fila: "Devoluciones por caídas", conceptos: ["SUSPENSIONES", "DESCUENTO PORTABILIDAD NUMERICA", "PENALIZACION POR DEUDA", "REVERSO ACTIVACION", "CANCELACIONES", "PENALIZACIÓN POR MIGRACIÓN DE NEGOCIO"], nota: "netas del recupero por reconexión (ver conceptos devueltos); la migración de negocio va en el mes 3 sin recupero" },
  { fila: "Devolución bono efectividad", conceptos: ["DESCUENTO INCENTIVOS POR PENALIDAD"], nota: "neto de RECUPERO INCENTIVOS REVERSO PENALIDAD", verificado: VERIFICADO_BONOS.clawback_bonos },
  { fila: "Recálculo bono productividad", conceptos: ["RECALCULO INCENTIVO PRODUCTIVIDAD"], verificado: VERIFICADO_BONOS.recalculo_productividad },
];

const NO_MODELADOS = ["CAMBIO DE PLAN", "CONCEPTO INICIO DE PRESUSPENSION POR DEUDA", "DEVOLUCION DESCUENTO DOCUMENTACION ACTIVACION al día 365 (menor al 1% de la facturación)"];

function Chip({ c }: { c: string }) {
  return <span className="inline-block px-1.5 py-0.5 rounded bg-white border border-brand-border font-mono text-[10px] text-brand-ink whitespace-nowrap">{c}</span>;
}

/** Observación corta para el campo "Recupero por reconexión". */
export function ObservacionRecupero() {
  return (
    <div className="rounded-md border border-brand-border bg-brand-bg-soft p-2 text-[10px] text-brand-graphite space-y-1">
      <div><b className="text-brand-ink">Observación · cómo se calcula el recupero.</b> Es lo que Claro devuelve en liquidaciones posteriores sobre lo que descontó por caídas, medido con estos conceptos de la liquidación:</div>
      <div><span className="font-semibold text-emerald-700">Devuelto:</span> <span className="inline-flex flex-wrap gap-1 align-middle">{CONCEPTOS_RECUPERO.devuelto.map((c) => <Chip key={c} c={c} />)}</span></div>
      <div><span className="font-semibold text-brand-primary">Descontado:</span> <span className="inline-flex flex-wrap gap-1 align-middle">{CONCEPTOS_RECUPERO.descontado.map((c) => <Chip key={c} c={c} />)}</span></div>
      <div>Recupero = devuelto ÷ descontado, ponderado sobre 7 liquidaciones reales, 383 a 389 (21,0 · 14,4 · 3,0 · 9,2 · 6,5 · 9,9 · 21,2%) = <b>12,1%</b>. Cada liquidación por separado salta porque los reversos corresponden a descuentos de meses anteriores; el valor de conjunto es el que vale.</div>
    </div>
  );
}

/** Observación completa para los EERR: cada fila y los conceptos de la liquidación que la alimentan. */
export function ObservacionConceptosEERR() {
  return (
    <div className="rounded-md border border-brand-border bg-brand-bg-soft p-3 mt-3">
      <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate mb-1.5">Observación · indicadores de la liquidación de Claro que alimentan cada fila</div>
      <div className="grid md:grid-cols-2 gap-x-6 gap-y-1.5">
        {FILAS.map((f) => (
          <div key={f.fila} className="text-[11px] text-brand-graphite">
            <span className="font-semibold text-brand-ink">{f.fila}:</span>{" "}
            <span className="inline-flex flex-wrap gap-1 align-middle">{f.conceptos.map((c) => <Chip key={c} c={c} />)}</span>
            {f.nota && <span className="block text-[10px] text-brand-slate">{f.nota}</span>}
            {f.verificado && <span className="block text-[10px] text-emerald-800 mt-0.5"><b>{f.verificado.corto}</b> — {f.verificado.detalle}</span>}
          </div>
        ))}
      </div>
      <div className="text-[10px] text-brand-slate mt-2 pt-2 border-t border-brand-border">
        <b>Recupero por reconexión</b> (neto de las devoluciones): devuelto = {CONCEPTOS_RECUPERO.devuelto.join(" + ")} ÷ descontado = {CONCEPTOS_RECUPERO.descontado.join(" + ")}. Ponderado de 7 liquidaciones: 12,1%.
        {" "}<b>Calibración con 7 liquidaciones (nov-25 a may-26)</b>: plus porta en el 90% de las activaciones; bono efectividad cobrado en el 87,5%; cuota 2 cobrada por el 53% (zafra al día 90); la cuota 1 se pierde en el 46% de las activaciones (85% de las caídas de la zafra); recálculo del bono al 100% de las líneas caídas al día 180 (48,9% según zafra; real por cohorte 41–52%); migración de negocio 3,2%; residual 14,5% del acreditado (48% del abono) sobre la curva real de líneas que pagan.
        {" "}<b>No modelados</b> (no aparecen en el EERR): {NO_MODELADOS.join(", ")}.
      </div>
    </div>
  );
}
