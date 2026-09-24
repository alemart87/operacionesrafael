"use client";

import { useEffect, useState } from "react";
import { formatInt } from "@/lib/format";
import { NumeroInput } from "./NumeroInput";
import { recalcSegunZafra } from "./VariablesNegocio";

/** Meses afectados del Simulador Anual: un mes puede comportarse distinto (menos porta,
 *  otra efectividad, otro mix, otro ajuste de comisiones, costos variables). Las
 *  variaciones se guardan como {clave: valor} y pisan la base solo en ese mes. */

export type Variaciones = Record<string, any>;
export type Afectados = Record<string, Variaciones>;   // {"7": {...}}

export type CampoDef = { key: string; label: string; suffix?: string; step?: number; grupo: string; costo?: boolean; bool?: boolean };

export const CAMPOS_AFECTABLES: CampoDef[] = [
  { key: "porta_pct", label: "Portabilidad", suffix: "%", step: 1, grupo: "Ventas del mes" },
  { key: "efectividad_pct", label: "Efectividad de entregas", suffix: "%", step: 0.5, grupo: "Ventas del mes" },
  { key: "pct_bono_efectividad_cobrado", label: "Activaciones que cobran bono efectividad", suffix: "%", step: 0.5, grupo: "Ventas del mes" },
  { key: "objetivo_co", label: "Objetivo CO", step: 10, grupo: "Ventas del mes" },
  { key: "pct_estado_a", label: "Líneas en estado A", suffix: "%", step: 0.5, grupo: "Ventas del mes" },
  { key: "ajuste_comisiones_pct", label: "Ajuste de comisiones", suffix: "%", step: 0.5, grupo: "Comisiones y bonos" },
  { key: "bonos_activos", label: "Bonos activos", grupo: "Comisiones y bonos", bool: true },
  { key: "legajo_incompleto_pct", label: "Legajos incompletos", suffix: "%", step: 0.5, grupo: "Calidad y caídas" },
  { key: "legajo_no_presentado_pct", label: "Legajos no presentados", suffix: "%", step: 0.5, grupo: "Calidad y caídas" },
  { key: "pct_caidas_penalizables", label: "Caídas penalizables", suffix: "%", step: 5, grupo: "Calidad y caídas" },
  { key: "recupero_pct", label: "Recupero por reconexión", suffix: "%", step: 5, grupo: "Calidad y caídas" },
  { key: "pct_recalculo_productividad", label: "Líneas castigadas en el recálculo", suffix: "%", step: 1, grupo: "Calidad y caídas" },
  { key: "migracion_negocio_pct", label: "Migración de negocio", suffix: "%", step: 0.1, grupo: "Calidad y caídas" },
  { key: "comision_por_venta", label: "Comisión al vendedor por venta", step: 1000, grupo: "Costos variables", costo: true },
  { key: "plus_por_venta", label: "Plus al vendedor por venta", step: 1000, grupo: "Costos variables", costo: true },
  { key: "logistica_interior_pct", label: "Entregas en Interior", suffix: "%", step: 5, grupo: "Costos variables", costo: true },
  { key: "operativo_por_venta", label: "Costo operativo por venta", step: 500, grupo: "Costos variables", costo: true },
];

/** Campos afectables del negocio GPON (fibra + TV). */
export const CAMPOS_AFECTABLES_GPON: CampoDef[] = [
  { key: "objetivo", label: "Objetivo de líneas", step: 5, grupo: "Activaciones del mes" },
  { key: "pct_bono_cobrado", label: "Activaciones que cobran el bono", suffix: "%", step: 1, grupo: "Activaciones del mes" },
  { key: "ajuste_comisiones_pct", label: "Ajuste de comisiones", suffix: "%", step: 0.5, grupo: "Comisiones y bonos" },
  { key: "bonos_activos", label: "Bonos activos", grupo: "Comisiones y bonos", bool: true },
  { key: "cuota2_pct_lineas", label: "Líneas que cobran cuota 2", suffix: "%", step: 1, grupo: "Calidad y mora" },
  { key: "cuota2_pct_completa", label: "Cuota 2 completa", suffix: "%", step: 1, grupo: "Calidad y mora" },
  { key: "legajo_pct", label: "Documentación faltante", suffix: "%", step: 0.5, grupo: "Calidad y mora" },
  { key: "mora_pct_lineas", label: "Líneas en mora", suffix: "%", step: 1, grupo: "Calidad y mora" },
  { key: "mora_penalidad_pct", label: "Penalidad de mora que se pierde", suffix: "%", step: 5, grupo: "Calidad y mora" },
  { key: "pct_recalculo", label: "Líneas castigadas en el recálculo", suffix: "%", step: 1, grupo: "Calidad y mora" },
  { key: "comision_por_venta", label: "Comisión al vendedor por venta", step: 1000, grupo: "Costos variables", costo: true },
  { key: "plus_por_venta", label: "Plus al vendedor por venta", step: 1000, grupo: "Costos variables", costo: true },
  { key: "operativo_por_venta", label: "Costo operativo por venta", step: 500, grupo: "Costos variables", costo: true },
];
const nombrePlan = (pl: any) => String(pl?.plan ?? pl?.nombre ?? "");

const valorBase = (base: any, c: CampoDef) => {
  if (c.key === "pct_recalculo_productividad" && base?.pct_recalculo_productividad == null) return recalcSegunZafra(base);
  return c.costo ? base?.costos?.[c.key] : base?.[c.key];
};
const valorOv = (ov: Variaciones | undefined, c: CampoDef) => (c.costo ? ov?.costos?.[c.key] : ov?.[c.key]);
const fmtV = (v: any, c?: CampoDef) => (typeof v === "boolean" ? (v ? "sí" : "no") : v == null ? "—" : `${typeof v === "number" ? formatInt(v) : v}${c?.suffix ?? ""}`);

/** Texto corto de las variaciones de un mes: "porta 45% → 30% · efectividad 89% → 85%". */
export function describirVariaciones(ov: Variaciones, base: any, campos: CampoDef[] = CAMPOS_AFECTABLES): string[] {
  const out: string[] = [];
  for (const c of campos) {
    const v = valorOv(ov, c);
    if (v === undefined || v === null) continue;
    out.push(`${c.label} ${fmtV(valorBase(base, c), c)} → ${fmtV(v, c)}`);
  }
  if (Array.isArray(ov.planes)) {
    const mix = ov.planes.filter((p: any) => p.mix_pct != null).map((p: any) => `${nombrePlan(p)} ${p.mix_pct}%`).join(" / ");
    if (mix) out.push(`Mix de planes → ${mix}`);
  }
  return out;
}

export function MesAfectadoEditor({ mes, nombre, nombres, horizonte, base, ventas, actual, onAplicar, onQuitar, onCerrar, campos = CAMPOS_AFECTABLES }: {
  mes: number;                              // 1-based (≥ 2)
  campos?: CampoDef[];
  nombre?: string; nombres?: string[];      // nombres editables de los meses
  horizonte: number;
  base: any;                                // parámetros del mes 1
  ventas: number;
  actual?: Variaciones;
  onAplicar: (meses: number[], ov: Variaciones) => void;
  onQuitar: (mes: number) => void;
  onCerrar: () => void;
}) {
  const [ov, setOv] = useState<Variaciones>({});
  const [mixOn, setMixOn] = useState(false);
  const [mix, setMix] = useState<Record<string, number>>({});
  const [otros, setOtros] = useState<number[]>([]);

  useEffect(() => {
    const init = JSON.parse(JSON.stringify(actual ?? {}));
    const planes = Array.isArray(init.planes) ? init.planes : null;
    delete init.planes;
    setOv(init);
    setMixOn(!!planes);
    const m: Record<string, number> = {};
    for (const pl of base?.planes ?? []) m[nombrePlan(pl)] = Number(planes?.find((x: any) => nombrePlan(x) === nombrePlan(pl))?.mix_pct ?? pl.mix_pct);
    setMix(m);
    setOtros([]);
  }, [mes, actual, base]);

  const setCampo = (c: CampoDef, v: any) => setOv((prev) => {
    const next = { ...prev };
    if (c.costo) {
      const costos = { ...(next.costos ?? {}) };
      if (v === undefined) delete costos[c.key]; else costos[c.key] = v;
      if (Object.keys(costos).length) next.costos = costos; else delete next.costos;
    } else if (v === undefined) delete next[c.key]; else next[c.key] = v;
    return next;
  });

  const mixTotal = Object.values(mix).reduce((s, v) => s + Number(v || 0), 0);
  const armar = (): Variaciones => {
    const out: Variaciones = { ...ov };
    if (mixOn) out.planes = Object.entries(mix).map(([plan, mix_pct]) => ({ plan, mix_pct: Number(mix_pct) }));
    return out;
  };
  const cantidad = Object.keys(ov).filter((k) => k !== "costos").length + Object.keys(ov.costos ?? {}).length + (mixOn ? 1 : 0);
  const grupos = Array.from(new Set(campos.map((c) => c.grupo)));

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-brand-ink/40 sm:p-4 no-print" onClick={onCerrar}>
      <div className="w-full max-w-3xl max-h-[94dvh] sm:max-h-[92vh] overflow-y-auto rounded-t-xl sm:rounded-lg bg-white shadow-2xl border-t-8 border-brand-purple" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-3 flex flex-wrap items-start justify-between gap-3 border-b border-brand-border">
          <div>
            <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-purple">Mes afectado</div>
            <h2 className="font-display text-2xl text-brand-ink uppercase">{nombre || `Mes ${mes}`} · {formatInt(ventas)} ventas</h2>
            <p className="text-xs text-brand-slate mt-1 max-w-xl">
              Este mes se comporta distinto. Lo que cargues acá pisa la base solo para las ventas de este mes: su facturación,
              sus bonos y sus ajustes posteriores (cuota 2, residual, caídas) se calculan con estas variaciones. La estructura
              fija y las ventas del mes no cambian desde acá.
            </p>
          </div>
          <button onClick={onCerrar} className="text-brand-slate hover:text-brand-ink text-xl leading-none">✕</button>
        </div>

        <div className="px-6 py-4 grid md:grid-cols-2 gap-x-8 gap-y-3">
          {grupos.map((g) => (
            <div key={g}>
              <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate border-b border-brand-border pb-1 mb-2">{g}</div>
              {campos.filter((c) => c.grupo === g).map((c) => {
                const v = valorOv(ov, c);
                const activo = v !== undefined && v !== null;
                const b = valorBase(base, c);
                return (
                  <label key={c.key} className={`flex items-center gap-2 py-1 rounded px-1 ${activo ? "bg-brand-purple/5" : ""}`}>
                    <input type="checkbox" checked={activo} className="accent-brand-purple"
                      onChange={(e) => setCampo(c, e.target.checked ? (c.bool ? !b : b) : undefined)} />
                    <span className="flex-1 text-sm text-brand-ink">{c.label}<span className="block text-[10px] text-brand-slate">base {fmtV(b, c)}</span></span>
                    {c.bool ? (
                      <button disabled={!activo} onClick={() => setCampo(c, !v)} className={`px-2 py-0.5 rounded text-[11px] font-bold ${!activo ? "opacity-30" : v ? "bg-emerald-100 text-emerald-700" : "bg-brand-primary/10 text-brand-primary"}`}>
                        {activo ? (v ? "sí" : "no") : fmtV(b)}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1">
                        <NumeroInput step={c.step ?? 1} disabled={!activo} value={Number(activo ? v : b ?? 0)}
                          onChange={(n) => setCampo(c, n)}
                          className={`input max-w-[96px] !py-1 text-sm text-right ${activo ? "border-brand-purple font-bold text-brand-purple" : "opacity-50"}`} />
                        {c.suffix && <span className="text-xs text-brand-slate w-3">{c.suffix}</span>}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          ))}

          <div className="md:col-span-2">
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-wider2 font-bold text-brand-slate border-b border-brand-border pb-1 mb-2">
              <input type="checkbox" checked={mixOn} onChange={(e) => setMixOn(e.target.checked)} className="accent-brand-purple" />
              Mix de planes propio de este mes <span className={`normal-case font-normal ${Math.abs(mixTotal - 100) > 0.01 && mixOn ? "text-brand-primary" : ""}`}>· suma {mixTotal.toFixed(1)}%</span>
            </label>
            <div className={`grid grid-cols-2 sm:grid-cols-5 gap-2 ${mixOn ? "" : "opacity-40 pointer-events-none"}`}>
              {(base?.planes ?? []).map((pl: any) => (
                <label key={nombrePlan(pl)} className="text-[11px] text-brand-slate">
                  {nombrePlan(pl)} <span className="text-[10px]">(base {pl.mix_pct}%)</span>
                  <input type="number" step={0.5} value={mix[nombrePlan(pl)] ?? 0} onChange={(e) => setMix({ ...mix, [nombrePlan(pl)]: Number(e.target.value) })}
                    className="input w-full !py-1 text-sm text-right" />
                </label>
              ))}
            </div>
          </div>

          <div className="md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate border-b border-brand-border pb-1 mb-2">Aplicar también a otros meses</div>
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: horizonte - 1 }, (_, i) => i + 2).filter((m) => m !== mes).map((m) => (
                <button key={m} onClick={() => setOtros((o) => (o.includes(m) ? o.filter((x) => x !== m) : [...o, m]))}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold border ${otros.includes(m) ? "bg-brand-purple text-white border-brand-purple" : "border-brand-border text-brand-graphite hover:border-brand-purple"}`}>
                  {nombres?.[m - 1] || `M${m}`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-brand-border flex flex-wrap items-center justify-between gap-2 bg-brand-bg-soft">
          <div className="text-xs text-brand-slate">{cantidad} variación(es){otros.length ? ` · se aplican a ${nombre || `M${mes}`} y ${otros.map((m) => nombres?.[m - 1] || `M${m}`).join(", ")}` : ""}</div>
          <div className="flex gap-2">
            {actual && <button onClick={() => onQuitar(mes)} className="px-3 py-1.5 rounded text-xs font-bold text-brand-primary hover:bg-brand-primary/10">Quitar variaciones de {nombre || `M${mes}`}</button>}
            <button onClick={onCerrar} className="px-3 py-1.5 rounded text-xs text-brand-slate hover:text-brand-ink">Cancelar</button>
            <button onClick={() => onAplicar([mes, ...otros], armar())} disabled={cantidad === 0 || (mixOn && Math.abs(mixTotal - 100) > 0.01)}
              className="btn-primary !bg-brand-purple !py-1.5 !px-4 text-sm disabled:opacity-50">
              Aplicar al mes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Resumen visible (e imprimible) de los meses afectados y sus variaciones. */
export function ResumenAfectados({ afectados, base, ventas, nombres, onEditar, onQuitar, sinCard, campos = CAMPOS_AFECTABLES }: {
  afectados: Afectados; base: any; ventas: number[]; nombres?: string[];
  onEditar: (mes: number) => void; onQuitar: (mes: number) => void; sinCard?: boolean; campos?: CampoDef[];
}) {
  const meses = Object.keys(afectados).map(Number).sort((a, b) => a - b);
  if (!meses.length && !sinCard) return null;
  const Wrapper = sinCard ? "div" : "section";
  return (
    <Wrapper className={sinCard ? "" : "card p-4 border-l-4 border-brand-purple"}>
      {!sinCard && (
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h2 className="text-[11px] uppercase tracking-wider2 text-brand-purple font-bold">Meses afectados · {meses.length}</h2>
          <span className="text-[11px] text-brand-slate">cada uno se liquida con sus propias variaciones; el resto del año sigue la base</span>
        </div>
      )}
      {!meses.length && (
        <p className="text-sm text-brand-slate">Ningún mes con variaciones propias. Usá el ✎ sobre un mes de la grilla para cargarle otra portabilidad, efectividad, mix, ajuste de comisiones o costos variables; acá queda el detalle de cada uno.</p>
      )}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
        {meses.map((m) => (
          <div key={m} className="rounded-md border border-brand-purple/30 bg-brand-purple/5 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-sm font-bold text-brand-ink">{nombres?.[m - 1] || `Mes ${m}`} <span className="font-normal text-brand-slate text-xs">· {formatInt(ventas[m - 1] ?? 0)} ventas</span></div>
              <div className="no-print flex gap-2 text-[11px] font-semibold">
                <button onClick={() => onEditar(m)} className="text-brand-ink hover:text-brand-purple hover:underline">Editar</button>
                <button onClick={() => onQuitar(m)} className="text-brand-primary hover:underline">Quitar</button>
              </div>
            </div>
            <ul className="mt-1 text-[12px] text-brand-graphite leading-snug">
              {describirVariaciones(afectados[String(m)], base, campos).map((t, i) => <li key={i}>· {t}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </Wrapper>
  );
}
