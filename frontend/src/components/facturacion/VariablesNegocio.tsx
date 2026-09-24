"use client";

import { formatGs } from "@/lib/format";
import { ObservacionRecupero } from "./ConceptosLiquidacion";
import { NumeroInput } from "./NumeroInput";
import { Verificado } from "./ConceptosLiquidacion";

function Grupo({ titulo, hint, abierto = false, children }: { titulo: string; hint?: string; abierto?: boolean; children: React.ReactNode }) {
  return (
    <details open={abierto} className="border border-brand-border rounded-md bg-white">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-brand-ink flex items-baseline justify-between gap-2">
        {titulo}{hint && <span className="text-[10px] font-normal text-brand-slate">{hint}</span>}
      </summary>
      <div className="px-3 pb-3 space-y-2">{children}</div>
    </details>
  );
}

/** Regla de Claro: al día 180 se descuenta el 100% del bono de las líneas caídas → 100 − zafra[mes del recálculo]. */
export function recalcSegunZafra(p: any): number {
  const z: number[] = (p?.zafra_pct ?? []).map((x: any) => Number(x) || 0);
  const k = Math.min(Math.max(Number(p?.recalculo_productividad_mes ?? 6), 0), Math.max(z.length - 1, 0));
  return z.length ? Math.round((100 - z[k]) * 10) / 10 : 0;
}

function Campo({ label, hint, value, onChange, step = 1, suffix }: { label: string; hint?: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return (
    <label className="flex items-center gap-3">
      <span className="flex-1">
        <span className="block text-sm text-brand-ink">{label}</span>
        {hint && <span className="block text-[10px] text-brand-slate">{hint}</span>}
      </span>
      <span className="flex items-center gap-1">
        <NumeroInput step={step} value={value} onChange={onChange} className="input max-w-[120px] !py-1 text-sm text-right" />
        {suffix && <span className="text-xs text-brand-slate w-4">{suffix}</span>}
      </span>
    </label>
  );
}

/** Panel "Variables de negocio": TODAS las variables editables del simulador de
 *  facturación (ventas, tarifas, cuota 2, residual, bonos, zafra, chargeback, costos).
 *  Compartido por el simulador mensual y el anual. */
export function VariablesNegocio({ p, setP, defaults, titulo = "Variables de negocio", extra }: {
  p: any; setP: (fn: any) => void; defaults: any; titulo?: string; extra?: React.ReactNode;
}) {
  const set = (k: string, v: any) => setP((prev: any) => ({ ...prev, [k]: v }));
  const setPlan = (i: number, k: string, v: any) => setP((prev: any) => ({ ...prev, planes: prev.planes.map((pl: any, j: number) => (j === i ? { ...pl, [k]: v } : pl)) }));
  const setEscala = (key: string, i: number, k: string, v: number) => setP((prev: any) => ({ ...prev, [key]: prev[key].map((e: any, j: number) => (j === i ? { ...e, [k]: v } : e)) }));
  const setC = (k: string, v: any) => setP((prev: any) => ({ ...prev, costos: { ...prev.costos, [k]: v } }));
  const setZafra = (i: number, v: number) => setP((prev: any) => ({ ...prev, zafra_pct: prev.zafra_pct.map((z: number, j: number) => (j === i ? v : z)) }));
  const setCurvaRes = (i: number, v: number) => setP((prev: any) => ({ ...prev, residual_curva_pct: (prev.residual_curva_pct ?? []).map((z: number, j: number) => (j === i ? v : z)) }));
  const mixTotal = p ? p.planes.reduce((s: number, pl: any) => s + Number(pl.mix_pct || 0), 0) : 0;
  const escalaDistinta = !!(p && defaults?.escala_productividad
    && JSON.stringify((p.escala_productividad ?? []).map((e: any) => [Number(e.desde_pct), Number(e.monto)]))
      !== JSON.stringify(defaults.escala_productividad.map((e: any) => [Number(e.desde_pct), Number(e.monto)])));
  if (!p) return null;
  return (
    <section className="space-y-2 no-print">
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="font-display text-xl text-brand-ink uppercase">{titulo}</h2>
              {defaults && <button onClick={() => setP(defaults)} className="text-[11px] text-brand-primary font-semibold hover:underline">Restaurar valores reales</button>}
            </div>

            <Grupo titulo="Ventas y objetivo" abierto>
              <Campo label="Ventas efectivas del mes" hint="ya son las activaciones (cuota 1): no se descuentan" value={p.ventas} onChange={(v) => set("ventas", v)} step={10} />
              <Campo label="Efectividad de entregas" hint="solo define el escalón del bono efectividad" value={p.efectividad_pct} onChange={(v) => set("efectividad_pct", v)} step={0.5} suffix="%" />
              <Campo label="Activaciones que cobran bono efectividad" hint="Claro lo paga en una parte de las activaciones (real 7 liq: 82–91%, 87,5% ponderado)" value={Number(p.pct_bono_efectividad_cobrado ?? 100)} onChange={(v) => set("pct_bono_efectividad_cobrado", v)} step={0.5} suffix="%" />
              <Campo label="Objetivo CO (Claro)" hint="objetivo mensual de líneas para el bono productividad" value={p.objetivo_co} onChange={(v) => set("objetivo_co", v)} step={10} />
              <Campo label="Líneas en estado A" hint="activaciones que suman para el bono" value={p.pct_estado_a} onChange={(v) => set("pct_estado_a", v)} step={0.5} suffix="%" />
              <Campo label="Portabilidad" hint="% de activaciones con portación" value={p.porta_pct} onChange={(v) => set("porta_pct", v)} step={1} suffix="%" />
              <label className="flex items-center gap-3 rounded-md border-2 border-brand-orange bg-brand-orange/5 px-2 py-1.5">
                <span className="flex-1">
                  <span className="block text-sm font-bold text-brand-orange">Bono adicional (a mano)</span>
                  <span className="block text-[10px] text-brand-orange/80">Gs totales del mes: campañas, premios o acuerdos puntuales · 0 = sin bono · se factura en el mes y no se devuelve</span>
                </span>
                <NumeroInput step={1000000} min={0} value={Number(p.bono_adicional ?? 0)} onChange={(v) => set("bono_adicional", v)}
                  className="input max-w-[130px] !py-1 text-sm text-right font-bold text-brand-orange border-brand-orange" />
              </label>
            </Grupo>

            <Grupo titulo="Tarifas por plan y mix" hint={`mix ${mixTotal.toFixed(1)}%`}>
              <table className="w-full text-[11px]">
                <thead><tr className="text-brand-slate uppercase tracking-wider2 text-[9px]">
                  <th className="text-left">Plan</th><th>Mix %</th><th>Cuota 1</th><th>Cuota 2</th><th>Porta plus</th><th>Abono</th>
                </tr></thead>
                <tbody>
                  {p.planes.map((pl: any, i: number) => (
                    <tr key={pl.plan}>
                      <td className="font-semibold text-brand-ink py-0.5">{pl.plan}</td>
                      {(["mix_pct", "cuota1", "cuota2", "porta_plus", "abono"] as const).map((k) => (
                        <td key={k}><NumeroInput value={Number(pl[k] ?? 0)} onChange={(n) => setPlan(i, k, n)} className="input !py-0.5 !px-1 text-[11px] text-right w-full" /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Grupo>

            <Grupo titulo="Cuota 2 y legajos">
              <Campo label="Mes de cobro de la cuota 2" hint="línea activa al día 90" value={p.cuota2_mes} onChange={(v) => set("cuota2_mes", v)} />
              <Campo label="Legajo incompleto" hint="cobra cuota 2 al 50% y descuenta media cuota 1" value={p.legajo_incompleto_pct} onChange={(v) => set("legajo_incompleto_pct", v)} step={0.5} suffix="%" />
              <Campo label="Legajo no presentado" hint="descuenta la cuota 1 completa" value={p.legajo_no_presentado_pct} onChange={(v) => set("legajo_no_presentado_pct", v)} step={0.5} suffix="%" />
            </Grupo>

            <Grupo titulo="Residual">
              <Campo label="Residual" hint="% sobre el abono acreditado" value={p.residual_pct} onChange={(v) => set("residual_pct", v)} step={0.5} suffix="%" />
              <Campo label="Abono acreditado" hint="% del abono del plan que Claro acredita" value={p.pct_abono_acreditado} onChange={(v) => set("pct_abono_acreditado", v)} step={1} suffix="%" />
              <Campo label="Meses de residual" value={p.residual_meses} onChange={(v) => set("residual_meses", v)} />
              <div className="border-t border-brand-border pt-2 text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">Líneas que pagan residual (% por mes de antigüedad)</div>
              <p className="text-[10px] text-brand-slate">El residual no lo cobra toda línea activa sino la que tiene monto acreditado. Curva real medida en 7 liquidaciones (146.000 filas RESIDUAL). Manda solo el residual; las caídas siguen la zafra.</p>
              <div className="grid grid-cols-4 gap-1.5">
                {(p.residual_curva_pct ?? []).map((z: number, i: number) => (
                  <label key={i} className="text-[10px] text-brand-slate">M{i + 1}
                    <NumeroInput step={0.5} value={Number(z)} onChange={(n) => setCurvaRes(i, n)} className="input !py-0.5 !px-1 text-[11px] text-right w-full" />
                  </label>
                ))}
              </div>
              {defaults?.residual_curva_pct && <button onClick={() => set("residual_curva_pct", defaults.residual_curva_pct)} className="text-[11px] text-brand-primary font-semibold hover:underline">Restaurar curva real</button>}
            </Grupo>

            <Grupo titulo="Bono productividad (concepto 1771)" hint="escala editable">
              <p className="text-[10px] text-brand-slate">Por línea en estado A. % cumplimiento = activaciones netas ÷ objetivo CO. Bajo la escala mínima liquida 0. Al 6º mes se descuenta el de las líneas castigadas (1871).</p>
              <Campo label="Líneas castigadas en el recálculo"
                hint={`Claro descuenta el 100% del bono de cada línea caída, una sola vez, al día 180 (real 7 liq: 41–52% de las líneas por cohorte, promedio 48,5%; nada después). Según la zafra cargada caen ${recalcSegunZafra(p)}%${p.pct_recalculo_productividad == null ? " · automático según zafra" : ""}`}
                value={Number(p.pct_recalculo_productividad ?? recalcSegunZafra(p))} onChange={(v) => set("pct_recalculo_productividad", v)} step={1} suffix="%" />
              <div className="flex flex-wrap items-center gap-2">
                <Verificado k="recalculo_productividad" />
                {p.pct_recalculo_productividad != null && (
                  <button onClick={() => set("pct_recalculo_productividad", null)} className="text-[11px] text-brand-primary font-semibold hover:underline">100% de las caídas (según zafra)</button>
                )}
              </div>
              {escalaDistinta && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 flex flex-wrap items-center justify-between gap-2">
                  <span><b>Escala distinta a la vigente de Claro</b> (≥110% 120.000 · ≥105% 115.000 · ≥100% 105.000 · ≥95% 40.000). Esta simulación se guardó con una escala anterior.</span>
                  <button onClick={() => set("escala_productividad", defaults.escala_productividad)} className="px-2 py-1 rounded bg-amber-600 text-white font-semibold">Usar escala vigente</button>
                </div>
              )}
              {p.escala_productividad.map((e: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-brand-slate w-8">≥</span>
                  <NumeroInput value={Number(e.desde_pct)} onChange={(n) => setEscala("escala_productividad", i, "desde_pct", n)} className="input !py-0.5 text-sm text-right w-20" /><span className="text-xs">%</span>
                  <span className="text-brand-slate">→</span>
                  <NumeroInput step={1000} value={Number(e.monto)} onChange={(n) => setEscala("escala_productividad", i, "monto", n)} className="input !py-0.5 text-sm text-right w-28" /><span className="text-xs">Gs/línea</span>
                </div>
              ))}
              <Campo label="Mes del recálculo" hint="líneas no activas al día 180" value={p.recalculo_productividad_mes} onChange={(v) => set("recalculo_productividad_mes", v)} />
            </Grupo>

            <Grupo titulo="Bono efectividad distribución (concepto 1891)" hint="escala editable">
              <p className="text-[10px] text-brand-slate">Por venta entregada (activación cuota 1), según efectividad = activaciones ÷ ventas. Bajo la escala mínima liquida 0; se descuenta en las líneas penalizadas.</p>
              {p.escala_efectividad.map((e: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-brand-slate w-8">≥</span>
                  <NumeroInput value={Number(e.desde_pct)} onChange={(n) => setEscala("escala_efectividad", i, "desde_pct", n)} className="input !py-0.5 text-sm text-right w-20" /><span className="text-xs">%</span>
                  <span className="text-brand-slate">→</span>
                  <NumeroInput step={1000} value={Number(e.monto)} onChange={(n) => setEscala("escala_efectividad", i, "monto", n)} className="input !py-0.5 text-sm text-right w-28" /><span className="text-xs">Gs/venta</span>
                </div>
              ))}
            </Grupo>

            <Grupo titulo="Zafra (líneas activas por mes)" hint="curva editable">
              <p className="text-[10px] text-brand-slate">% de líneas nuevas activas en cada mes de antigüedad. Sembrada con la zafra tipo del negocio (cohortes jul-25 a ene-26).</p>
              <div className="grid grid-cols-4 gap-1.5">
                {p.zafra_pct.map((z: number, i: number) => {
                  const pfi = i === 2;   // la suspensión por PFI llega a los ~60 días: es la caída del mes 1 al mes 2
                  return (
                    <label key={i} className={`text-[10px] ${pfi ? "text-brand-primary font-bold rounded-md ring-2 ring-brand-primary ring-offset-1 bg-brand-primary/5 px-0.5" : "text-brand-slate"}`}
                      title={pfi ? `PFI (primera factura impaga): la caída del mes 1 al mes 2 (${Number(p.zafra_pct[1])}% → ${z}%) es la suspensión penalizable a los ~60 días. Real por cohorte: 28,7% de las ventas.` : undefined}>
                      <span className="flex items-center justify-between">M{i}{pfi && <span className="px-1 rounded bg-brand-primary text-white text-[8px] font-bold leading-4">PFI</span>}</span>
                      <NumeroInput step={0.5} value={Number(z)} onChange={(n) => setZafra(i, n)} className={`input !py-0.5 !px-1 text-[11px] text-right w-full ${pfi ? "border-brand-primary text-brand-primary font-bold" : ""}`} />
                    </label>
                  );
                })}
              </div>
              {defaults && <button onClick={() => set("zafra_pct", defaults.zafra_pct)} className="text-[11px] text-brand-primary font-semibold hover:underline">Restaurar zafra tipo</button>}
              <div className="rounded-md border border-brand-border bg-brand-bg-soft p-2 text-[10px] text-brand-graphite space-y-1">
                <div><b className="text-brand-ink">Observación · PFI (primera factura impaga, razón P9-735).</b> No es un parámetro aparte: vive dentro de la zafra. La suspensión penalizable por PFI llega a los ~60 días (p50 61 días), así que es la caída del mes 1 al mes 2 de la curva ({Number(p.zafra_pct?.[1] ?? 0)}% → {Number(p.zafra_pct?.[2] ?? 0)}%), sumada a lo que ya cayó en el mes 1. Cada línea PFI devuelve cuota 1 + un residual (SUSPENSIONES) y el plus porta; el 16% se reconecta después.</div>
                <div><b>PFI real por cohorte de venta</b> (suspensiones por PFI ÷ activaciones del mismo mes, 7 liquidaciones): nov-25 26,9% · dic-25 27,3% · ene-26 26,9% · feb-26 28,5% · mar-26 34,1% → <b>28,7%</b> de las ventas. Abril y mayo todavía no cumplieron los 60 días. Las caídas acumuladas de la zafra al mes 2 ({(100 - Number(p.zafra_pct?.[2] ?? 0)).toFixed(1)}%) incluyen la PFI más reversos, port out y otras suspensiones.</div>
              </div>
            </Grupo>

            <Grupo titulo="Chargeback y recuperos">
              <Campo label="Meses de chargeback" hint="ventana de devolución (180 días)" value={p.chargeback_meses} onChange={(v) => set("chargeback_meses", v)} />
              <Campo label="Caídas que pierden la cuota 1" hint="suspensión penalizable, deuda y reverso (real: 46% de las activaciones contra 51% de caídas → 85%). El plus porta y el bono efectividad se devuelven en el 100% de las caídas" value={p.pct_caidas_penalizables} onChange={(v) => set("pct_caidas_penalizables", v)} step={5} suffix="%" />
              <Campo label="Migración de negocio" hint="% de activaciones que pierden la cuota 1 completa por migrar de negocio (real 7 liq: 2,2–4,3%)" value={Number(p.migracion_negocio_pct ?? 0)} onChange={(v) => set("migracion_negocio_pct", v)} step={0.1} suffix="%" />
              <Campo label="Recupero por reconexión" hint="% de los descuentos que Claro devuelve después (real 7 liq: 12,1%)" value={p.recupero_pct} onChange={(v) => set("recupero_pct", v)} step={0.5} suffix="%" />
              <ObservacionRecupero />
              <label className="flex items-center gap-2 text-sm text-brand-ink">
                <input type="checkbox" checked={!!p.clawback_incluye_residual} onChange={(e) => set("clawback_incluye_residual", e.target.checked)} className="accent-brand-primary" />
                La suspensión penalizable descuenta cuota 1 + un residual (214.431)
              </label>
            </Grupo>

            <Grupo titulo="Costos de la estructura" hint="indicador principal: ventas por vendedor" abierto>
              <Campo label="Ventas por vendedor" hint="define la dotación (1.900 ventas ÷ 20 = 95 vendedores)" value={p.costos.ventas_por_vendedor} onChange={(v) => setC("ventas_por_vendedor", v)} />
              <Campo label="Vendedores por supervisor" hint="1 supervisor cada N vendedores" value={p.costos.supervisor_cada_vendedores} onChange={(v) => setC("supervisor_cada_vendedores", v)} />
              <Campo label="Ventas por backoffice" hint="1 backoffice cada N ventas" value={p.costos.backoffice_cada_ventas} onChange={(v) => setC("backoffice_cada_ventas", v)} step={10} />
              <Campo label="Coordinadores" value={p.costos.coordinadores} onChange={(v) => setC("coordinadores", v)} />
              <Campo label="Controllers" value={p.costos.controllers} onChange={(v) => setC("controllers", v)} />
              <div className="border-t border-brand-border pt-2 text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">Operador (por hora)</div>
              <Campo label="Salario por hora" value={p.costos.salario_hora} onChange={(v) => setC("salario_hora", v)} step={100} />
              <Campo label="Horas por día" value={p.costos.horas_dia} onChange={(v) => setC("horas_dia", v)} step={0.5} />
              <Campo label="Días por mes" value={p.costos.dias_mes} onChange={(v) => setC("dias_mes", v)} />
              <div className="border-t border-brand-border pt-2 text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">Variable del vendedor (monto por venta)</div>
              <Campo label="Comisión por venta" hint="Gs por venta · paga IPS y aguinaldo (promedio real 102.000)" value={Number(p.costos.comision_por_venta ?? 0)} onChange={(v) => setC("comision_por_venta", v)} step={1000} />
              <Campo label="Plus por venta" hint="Gs por venta · NO paga IPS ni aguinaldo (32.000)" value={Number(p.costos.plus_por_venta ?? 0)} onChange={(v) => setC("plus_por_venta", v)} step={1000} />
              <p className="text-[10px] text-brand-slate">Se cargan como montos, no como % de la facturación. El peso de comisión + plus sobre lo facturado se muestra en los resultados solo como referencia.</p>
              <div className="border-t border-brand-border pt-2 text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">Salarios mensuales</div>
              <Campo label="Supervisor" hint="salario" value={p.costos.supervisor_salario} onChange={(v) => setC("supervisor_salario", v)} step={10000} />
              <Campo label="Supervisor — premio" value={p.costos.supervisor_premio} onChange={(v) => setC("supervisor_premio", v)} step={10000} />
              <Campo label="Coordinador" hint="salario" value={p.costos.coordinador_salario} onChange={(v) => setC("coordinador_salario", v)} step={10000} />
              <Campo label="Coordinador — premio" value={p.costos.coordinador_premio} onChange={(v) => setC("coordinador_premio", v)} step={10000} />
              <Campo label="Backoffice" value={p.costos.backoffice_salario} onChange={(v) => setC("backoffice_salario", v)} step={10000} />
              <Campo label="Controller" hint="salario" value={p.costos.controller_salario} onChange={(v) => setC("controller_salario", v)} step={10000} />
              <Campo label="Controller — premio" value={p.costos.controller_premio} onChange={(v) => setC("controller_premio", v)} step={10000} />
              <label className="flex items-center gap-3 rounded-md border-2 border-brand-primary bg-brand-primary/5 px-2 py-1.5">
                <span className="flex-1">
                  <span className="block text-sm font-bold text-brand-primary">SubGerencia Comercial</span>
                  <span className="block text-[10px] text-brand-primary/80">en análisis · salario mensual, 0 = no incorporada · suma IPS y aguinaldo</span>
                </span>
                <NumeroInput step={100000} min={0} value={Number(p.costos.subgerencia_salario ?? 0)} onChange={(v) => setC("subgerencia_salario", v)}
                  className="input max-w-[120px] !py-1 text-sm text-right font-bold text-brand-primary border-brand-primary" />
              </label>
              <Campo label="IPS" hint="sobre todos los costos de RRHH" value={p.costos.ips_pct} onChange={(v) => setC("ips_pct", v)} step={0.5} suffix="%" />
              <label className="flex items-center gap-2 text-sm text-brand-ink">
                <input type="checkbox" checked={!!p.costos.aguinaldo} onChange={(e) => setC("aguinaldo", e.target.checked)} className="accent-brand-primary" />
                Previsión de aguinaldo: RRHH ÷ 12 por mes (sin IPS)
              </label>
              <div className="border-t border-brand-border pt-2 text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">Logística y operativos</div>
              <Campo label="Entrega en Central" hint="Gs por venta" value={p.costos.logistica_central} onChange={(v) => setC("logistica_central", v)} step={1000} />
              <Campo label="Entrega en Interior" hint="Gs por venta" value={p.costos.logistica_interior} onChange={(v) => setC("logistica_interior", v)} step={1000} />
              <Campo label="Entregas en Interior" hint="el resto es Central" value={p.costos.logistica_interior_pct} onChange={(v) => setC("logistica_interior_pct", v)} step={5} suffix="%" />
              <Campo label="Premios a logística" hint="fijo mensual" value={p.costos.logistica_premios} onChange={(v) => setC("logistica_premios", v)} step={1000000} />
              <Campo label="Costo operativo por venta" value={p.costos.operativo_por_venta} onChange={(v) => setC("operativo_por_venta", v)} step={500} />
            </Grupo>
                {extra}
    </section>
  );
}
