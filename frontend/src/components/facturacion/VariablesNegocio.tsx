"use client";

import { formatGs } from "@/lib/format";
import { ObservacionRecupero } from "./ConceptosLiquidacion";
import { NumeroInput } from "./NumeroInput";
import { Verificado } from "./ConceptosLiquidacion";
import { Campo } from "./Campo";
import { PFI_DIAS, PFI_REAL_COHORTES } from "./pfiReal";
import { aplicarPreset, coincidePreset, PRESET_IDEAL_MOVIL, ZAFRA_IDEAL } from "./presets";

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

const pct = (v: number, d = 1) => `${v.toFixed(d).replace(".", ",")}%`;
const num = (v: number) => Math.round(v).toLocaleString("es-PY");

/** Zona PFI dentro de la zafra: dónde vive el PFI en la curva y cuánto fue en la realidad. */
function ZonaPFI({ p }: { p: any }) {
  const z: number[] = (p?.zafra_pct ?? []).map((x: any) => Number(x) || 0);
  const z0 = z[0] ?? 100, z1 = z[1] ?? 0, z2 = z[2] ?? 0;
  const caidaM1 = z0 - z1, caidaM2 = z1 - z2, acum2 = 100 - z2;
  const ventas = Number(p?.ventas ?? 0);
  const maduras = PFI_REAL_COHORTES.filter((c) => c.liq >= 3);
  const peor = maduras.reduce((a, c) => (c.pct > a.pct ? c : a), maduras[0]);
  const mejor = maduras.reduce((a, c) => (c.pct < a.pct ? c : a), maduras[0]);
  const maxPct = Math.max(...PFI_REAL_COHORTES.map((c) => c.pct), acum2);
  return (
    <div className="rounded-md border-2 border-brand-primary/40 bg-brand-primary/5 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider2 font-bold text-brand-primary">PFI · primera factura impaga (razón P9-735)</div>
        <span className="text-[10px] text-brand-slate">llega a los {PFI_DIAS.mediana} días (p10 {PFI_DIAS.p10} · p90 {PFI_DIAS.p90})</span>
      </div>
      <p className="text-[11px] text-brand-graphite">No es un parámetro aparte: <b>vive dentro de la zafra</b>. Claro suspende la línea cuando el cliente no paga la primera factura, a los ~60 días, así que el PFI es la caída del mes 1 al mes 2 de la curva (más la parte que ya cae en el mes 1). Cada línea PFI devuelve la cuota 1, el plus porta y el bono efectividad.</p>
      <div className="grid grid-cols-3 gap-2">
        {[
          { t: "Caída M0 → M1", v: caidaM1, s: `${num(ventas * caidaM1 / 100)} líneas`, nota: "reversos, legajos y PFI temprano" },
          { t: "Caída M1 → M2 · PFI", v: caidaM2, s: `${num(ventas * caidaM2 / 100)} líneas`, nota: "la suspensión a los ~60 días", pfi: true },
          { t: "Caídas acumuladas al M2", v: acum2, s: `${num(ventas * acum2 / 100)} líneas`, nota: "PFI + reversos + port out" },
        ].map((k) => (
          <div key={k.t} className={`rounded-md border bg-white px-2 py-1.5 ${k.pfi ? "border-brand-primary ring-1 ring-brand-primary" : "border-brand-border"}`}>
            <div className="text-[9px] uppercase tracking-wider2 text-brand-slate font-bold">{k.t}</div>
            <div className={`font-display text-xl leading-tight ${k.pfi ? "text-brand-primary" : "text-brand-ink"}`}>{pct(k.v)}</div>
            <div className="text-[10px] text-brand-graphite">{k.s}</div>
            <div className="text-[9px] text-brand-slate">{k.nota}</div>
          </div>
        ))}
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate">PFI real por mes de venta · 8 liquidaciones 2026</div>
          <div className="text-[10px] text-brand-slate">% de las ventas del mes que cayeron por PFI</div>
        </div>
        <div className="mt-1 space-y-0.5">
          {PFI_REAL_COHORTES.map((c) => {
            const inmadura = c.liq < 3;
            return (
              <div key={c.mes} className="flex items-center gap-2 text-[10px]">
                <span className="w-12 text-brand-ink font-semibold">{c.mes}</span>
                <div className="flex-1 h-3 rounded bg-white border border-brand-border overflow-hidden">
                  <div className={`h-full ${inmadura ? "bg-brand-slate/40" : c.mes === peor.mes ? "bg-brand-primary" : c.mes === mejor.mes ? "bg-emerald-500" : "bg-brand-slate"}`}
                    style={{ width: `${(c.pct / maxPct) * 100}%` }} />
                </div>
                <span className={`w-11 text-right font-bold ${inmadura ? "text-brand-slate" : "text-brand-ink"}`}>{pct(c.pct)}</span>
                <span className="w-24 text-brand-slate">{c.lineas} de {num(c.activaciones)}{inmadura ? " · incompleta" : ""}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-brand-slate">
          <span><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500 mr-1" />mejor: {mejor.mes} {pct(mejor.pct)}</span>
          <span><span className="inline-block w-2 h-2 rounded-sm bg-brand-primary mr-1" />peor: {peor.mes} {pct(peor.pct)}</span>
          <span><span className="inline-block w-2 h-2 rounded-sm bg-brand-slate/40 mr-1" />incompleta: menos de 3 liquidaciones después de la venta</span>
          <span>zafra cargada al M2: {pct(acum2)} de caídas (incluye lo que no es PFI)</span>
        </div>
      </div>
    </div>
  );
}

/** Explica con los números cargados qué hace "caídas que devuelven la cuota 1". */
function ExplicacionCaidas({ p }: { p: any }) {
  const z: number[] = (p?.zafra_pct ?? []).map((x: any) => Number(x) || 0);
  const chb = Math.min(Math.max(Number(p?.chargeback_meses ?? 6), 1), Math.max(z.length - 1, 1));
  const ventas = Number(p?.ventas ?? 0);
  const caidasPct = Math.max(0, (z[0] ?? 100) - (z[chb] ?? 0));
  const caidas = ventas * caidasPct / 100;
  const pen = Math.min(Math.max(Number(p?.pct_caidas_penalizables ?? 0), 0), 100) / 100;
  const porta = Math.min(Math.max(Number(p?.porta_pct ?? 0), 0), 100) / 100;
  const pbef = Math.min(Math.max(Number(p?.pct_bono_efectividad_cobrado ?? 100), 0), 100) / 100;
  const recupero = Math.min(Math.max(Number(p?.recupero_pct ?? 0), 0), 100) / 100;
  const planes: any[] = p?.planes ?? [];
  const mixTot = planes.reduce((s, pl) => s + Number(pl.mix_pct || 0), 0) || 100;
  const w = (k: string) => planes.reduce((s, pl) => s + Number(pl[k] || 0) * Number(pl.mix_pct || 0), 0) / mixTot;
  const cuota1 = w("cuota1"), portaPlus = w("porta_plus"), abono = w("abono");
  const residualLinea = p?.clawback_incluye_residual ? Number(p.residual_pct ?? 0) / 100 * Number(p.pct_abono_acreditado ?? 0) / 100 * abono : 0;
  const efect = Number(p?.efectividad_pct ?? 0);
  const escalon = [...(p?.escala_efectividad ?? [])].sort((a, b) => Number(b.desde_pct) - Number(a.desde_pct)).find((e) => efect >= Number(e.desde_pct));
  const bonoEf = escalon ? Number(escalon.monto) : 0;
  const devCuota1 = caidas * pen * (cuota1 + residualLinea);
  const devPorta = caidas * porta * portaPlus;
  const devBono = caidas * pbef * bonoEf;
  const bruto = devCuota1 + devPorta + devBono;
  const neto = bruto * (1 - recupero);
  const M = (v: number) => `${(v / 1e6).toFixed(1).replace(".", ",")} M`;
  return (
    <div className="rounded-md border border-brand-border bg-brand-bg-soft p-3 text-[11px] text-brand-graphite space-y-2">
      <div className="font-bold text-brand-ink text-[11px] uppercase tracking-wider2">Cómo se calcula · con los valores cargados</div>
      <p>La zafra dice cuántas líneas caen: de <b>{num(ventas)}</b> ventas, a los {chb} meses quedan activas {pct(z[chb] ?? 0)} → <b>caen {num(caidas)} líneas</b> ({pct(caidasPct)}).</p>
      <p>No todas las caídas devuelven lo mismo. Claro descuenta la <b>cuota 1</b> solo cuando la línea se suspende por falta de pago (PFI, deuda) o se reversa la activación. Si el cliente se va por port out o se cancela fuera del chargeback, la cuota 1 no se descuenta. En las liquidaciones reales, de cada 100 ventas 46 devolvieron la cuota 1 contra 51 caídas de la zafra → <b>85%</b>. En cambio el plus porta y el bono efectividad se descuentan en <b>todas</b> las caídas.</p>
      <table className="w-full text-[11px]">
        <thead><tr className="text-brand-slate uppercase tracking-wider2 text-[9px]"><th className="text-left">Qué devuelve</th><th className="text-right">Líneas</th><th className="text-right">Por línea</th><th className="text-right">Total</th></tr></thead>
        <tbody>
          <tr><td>Cuota 1{residualLinea > 0 ? " + 1 residual" : ""} · <b>{pct(pen * 100, 0)}</b> de las caídas</td><td className="text-right">{num(caidas * pen)}</td><td className="text-right">{formatGs(cuota1 + residualLinea)}</td><td className="text-right font-semibold">{M(devCuota1)}</td></tr>
          <tr><td>Plus porta · 100% de las caídas portadas ({pct(porta * 100, 0)})</td><td className="text-right">{num(caidas * porta)}</td><td className="text-right">{formatGs(portaPlus)}</td><td className="text-right font-semibold">{M(devPorta)}</td></tr>
          <tr><td>Bono efectividad · 100% de las que lo cobraron ({pct(pbef * 100, 1)})</td><td className="text-right">{num(caidas * pbef)}</td><td className="text-right">{formatGs(bonoEf)}</td><td className="text-right font-semibold">{M(devBono)}</td></tr>
          <tr className="border-t border-brand-border"><td className="font-bold text-brand-ink">Devolución bruta en {chb} meses</td><td /><td /><td className="text-right font-bold text-brand-ink">{M(bruto)}</td></tr>
          <tr><td>menos recupero por reconexión ({pct(recupero * 100, 0)})</td><td /><td /><td className="text-right">+{M(bruto * recupero)}</td></tr>
          <tr className="border-t border-brand-border"><td className="font-bold text-brand-primary">Devolución neta de la cohorte</td><td /><td /><td className="text-right font-bold text-brand-primary">{M(neto)}</td></tr>
        </tbody>
      </table>
      <p className="text-[10px] text-brand-slate">El recálculo del bono productividad al mes 6 y la migración de negocio van aparte (ver bono productividad y el campo de migración). Subir "caídas que devuelven la cuota 1" al 100% supone que toda caída pierde la cuota 1, algo que Claro no hace.</p>
    </div>
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
  const escalaDistinta = !!(p && !p.bono_unico && defaults?.escala_productividad
    && JSON.stringify((p.escala_productividad ?? []).map((e: any) => [Number(e.desde_pct), Number(e.monto)]))
      !== JSON.stringify(defaults.escala_productividad.map((e: any) => [Number(e.desde_pct), Number(e.monto)])));
  if (!p) return null;
  const esIdeal = coincidePreset(p, PRESET_IDEAL_MOVIL);
  const zafraIdeal = JSON.stringify((p.zafra_pct ?? []).map(Number)) === JSON.stringify(ZAFRA_IDEAL);
  const vendedores = Number(p.costos?.ventas_por_vendedor) > 0 ? Math.ceil(Number(p.ventas) / Number(p.costos.ventas_por_vendedor)) : 0;
  return (
    <section className="space-y-2 no-print">
            <div className="flex items-center justify-between gap-3 mb-1">
              <h2 className="font-display text-xl text-brand-ink uppercase">{titulo}</h2>
              <div className="flex items-center gap-3">
                <button onClick={() => setP((prev: any) => aplicarPreset(prev, PRESET_IDEAL_MOVIL))}
                  title="Escenario ideal: 1.700 ventas y objetivo 1.700, efectividad 85%, estado A 100%, zafra ideal (M2 75% … M12 49%), 17 ventas por vendedor, comisión 95.000 y plus 12.500"
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider2 border ${esIdeal ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-emerald-700 border-emerald-600 hover:bg-emerald-50"}`}>
                  {esIdeal ? "✓ Ideal" : "Ideal"}
                </button>
                {defaults && <button onClick={() => setP(defaults)} className="text-[11px] text-brand-primary font-semibold hover:underline">Restaurar valores reales</button>}
              </div>
            </div>

            <Grupo titulo="Ventas y objetivo" abierto>
              <Campo label="Ventas efectivas del mes" hint="ya son las activaciones (cuota 1): no se descuentan" value={p.ventas} onChange={(v) => set("ventas", v)} step={10} />
              <Campo label="Efectividad de entregas" hint="solo define el escalón del bono efectividad" value={p.efectividad_pct} onChange={(v) => set("efectividad_pct", v)} step={0.5} suffix="%" />
              <Campo label="Activaciones que cobran bono efectividad" hint="Claro lo paga en una parte de las activaciones (real 7 liq: 82–91%, 87,5% ponderado)" value={Number(p.pct_bono_efectividad_cobrado ?? 100)} onChange={(v) => set("pct_bono_efectividad_cobrado", v)} step={0.5} suffix="%" />
              <Campo label="Objetivo CO (Claro)" hint="objetivo mensual de líneas para el bono productividad" value={p.objetivo_co} onChange={(v) => set("objetivo_co", v)} step={10} />
              <Campo label="Líneas en estado A" hint="activaciones que suman para el bono" value={p.pct_estado_a} onChange={(v) => set("pct_estado_a", v)} step={0.5} suffix="%" />
              <Campo label="Portabilidad" hint="% de activaciones con portación" value={p.porta_pct} onChange={(v) => set("porta_pct", v)} step={1} suffix="%" />
              <Campo destacado="orange" label="Bono adicional (a mano)" hint="Gs totales del mes: campañas, premios o acuerdos puntuales · 0 = sin bono · se factura en el mes y no se devuelve"
                step={1000000} min={0} value={Number(p.bono_adicional ?? 0)} onChange={(v) => set("bono_adicional", v)} />
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
              <label className="flex items-center gap-2 text-sm text-brand-ink">
                <input type="checkbox" checked={p.residual_segun_zafra !== false} onChange={(e) => set("residual_segun_zafra", e.target.checked)} className="accent-brand-primary" />
                El residual sigue a la zafra <span className="text-[10px] text-brand-slate">(recomendado: si la zafra mejora, el residual sube)</span>
              </label>
              {p.residual_segun_zafra !== false ? (() => {
                const z: number[] = (p.zafra_pct ?? []).map(Number);
                const cob: number[] = (p.residual_cobrabilidad_pct ?? defaults?.residual_cobrabilidad_pct ?? []).map(Number);
                const zPrev = (i: number) => z[i] ?? z[z.length - 1] ?? 0;                     // activas al cierre del mes anterior (mes i) para el residual del mes i+1
                const curva = Array.from({ length: 12 }, (_, i) => Math.min(100, zPrev(i) * (cob[i] ?? cob[cob.length - 1] ?? 100) / 100));
                const f1 = (v: number) => v.toFixed(1).replace(".", ",");
                return (
                  <>
                    <div className="rounded-md border border-brand-border bg-brand-bg-soft px-3 py-2 text-[11px] text-brand-graphite space-y-1">
                      <div className="font-bold text-brand-ink">Por qué no coincide con la zafra: el residual de un mes lo genera la factura del mes anterior.</div>
                      <div>Lo cobran las líneas que estaban <b>activas al cierre del mes anterior</b> (la zafra) <b>y pagaron esa factura</b> (la cobrabilidad).</div>
                      <ul className="list-disc pl-4 space-y-0.5">
                        <li><b>Mes 1:</b> cobran {f1(curva[0])}%. Son las {f1(zPrev(0))}% activas al inicio, de las que paga el {f1(cob[0] ?? 100)}%.</li>
                        <li><b>Mes 2:</b> cobran {f1(curva[1])}%, menos que el {f1(zPrev(1))}% activo al cierre del mes 1, porque las líneas que caen por PFI no pagaron su primera factura (cobrabilidad {f1(cob[1] ?? 100)}%).</li>
                        <li><b>Mes 3 en adelante:</b> cobran el {f1(cob[2] ?? 100)} a 100% de las activas al cierre del mes anterior (mes 3: {f1(zPrev(2))}% × {f1(cob[2] ?? 100)}% = {f1(curva[2])}%). En los meses 11 y 12 baja a {f1(cob[10] ?? 100)} y {f1(cob[11] ?? 100)}% porque parte de las activas ya no tiene abono acreditado.</li>
                      </ul>
                      <div>Con la zafra real esta cuenta reproduce la curva medida en las liquidaciones. <b>Si mejorás la zafra, el residual sube solo</b> desde el mes 3, porque la zafra Ideal arranca igual que la real en el mes 1.</div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="text-[10px] w-full">
                        <thead><tr className="text-brand-slate"><th className="text-left font-normal pr-2">Mes del residual</th>{curva.map((_, i) => <th key={i} className="font-semibold text-brand-ink px-1 text-right">M{i + 1}</th>)}</tr></thead>
                        <tbody>
                          <tr className="text-brand-slate"><td className="pr-2 whitespace-nowrap">Activas al cierre del mes anterior (zafra)</td>{curva.map((_, i) => <td key={i} className="px-1 text-right font-mono">{f1(zPrev(i))}%</td>)}</tr>
                          <tr className="text-brand-slate"><td className="pr-2 whitespace-nowrap">× pagan su factura (cobrabilidad)</td>{curva.map((_, i) => <td key={i} className="px-1 text-right font-mono">{f1(cob[i] ?? 100)}%</td>)}</tr>
                          <tr className="text-brand-ink font-semibold border-t border-brand-border"><td className="pr-2 whitespace-nowrap">= Cobran residual</td>{curva.map((v, i) => <td key={i} className="px-1 text-right font-mono">{f1(v)}%</td>)}</tr>
                        </tbody>
                      </table>
                    </div>
                    <details className="text-[10px] text-brand-slate">
                      <summary className="cursor-pointer select-none">Cobrabilidad por mes (% de las activas al cierre del mes anterior que pagan) · editable · real: 91 · 77 · 92 · 96 · 96 · 100 · 91 · 95 · 100 · 97 · 89 · 80</summary>
                      <div className="grid grid-cols-6 gap-1 mt-1">
                        {Array.from({ length: 12 }, (_, i) => (
                          <label key={i} className="text-[10px] text-brand-slate">M{i + 1}
                            <NumeroInput step={0.5} value={Number(cob[i] ?? 100)} onChange={(n) => set("residual_cobrabilidad_pct", Array.from({ length: 12 }, (_, k) => (k === i ? n : Number(cob[k] ?? 100))))} className="input !py-0.5 !px-1 text-[11px] text-right w-full" />
                          </label>
                        ))}
                      </div>
                      {defaults?.residual_cobrabilidad_pct && <button onClick={() => set("residual_cobrabilidad_pct", defaults.residual_cobrabilidad_pct)} className="mt-1 text-[11px] text-brand-primary font-semibold hover:underline">Restaurar cobrabilidad real</button>}
                    </details>
                  </>
                );
              })() : (
                <>
                  <p className="text-[10px] text-brand-slate">Curva fija: no cambia aunque cambies la zafra. Curva real medida en 7 liquidaciones (146.000 filas RESIDUAL).</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(p.residual_curva_pct ?? []).map((z: number, i: number) => (
                      <label key={i} className="text-[10px] text-brand-slate">M{i + 1}
                        <NumeroInput step={0.5} value={Number(z)} onChange={(n) => setCurvaRes(i, n)} className="input !py-0.5 !px-1 text-[11px] text-right w-full" />
                      </label>
                    ))}
                  </div>
                  {defaults?.residual_curva_pct && <button onClick={() => set("residual_curva_pct", defaults.residual_curva_pct)} className="text-[11px] text-brand-primary font-semibold hover:underline">Restaurar curva real</button>}
                </>
              )}
            </Grupo>

            <Grupo titulo={p.bono_unico ? "Bono único propuesto (reemplaza a productividad + efectividad)" : "Bono productividad (concepto 1771)"} hint="escala editable" abierto={!!p.bono_unico}>
              {p.bono_unico && (
                <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900">
                  <b>Bono único propuesto activo.</b> Esta escala es el único bono por línea, según cumplimiento del objetivo CO, y no se descuenta en las caídas (los descuentos 1871 y 471 están apagados). El bono efectividad queda en 0. Se puede editar acá; el botón del simulador vuelve a los bonos vigentes.
                </div>
              )}
              <p className="text-[10px] text-brand-slate">Por línea en estado A. % cumplimiento = activaciones netas ÷ objetivo CO. Bajo la escala mínima liquida 0.{!p.bono_unico && " Al 6º mes se descuenta el de las líneas castigadas (1871)."}</p>
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

            <Grupo titulo="Bono efectividad distribución (concepto 1891)" hint={p.bono_unico ? "en 0 · incluido en el bono único" : "escala editable"}>
              {p.bono_unico && <p className="text-[11px] text-emerald-900 bg-emerald-50 border border-emerald-300 rounded-md px-3 py-2">Con el bono único propuesto este bono desaparece: su valor está dentro de la escala única.</p>}
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
              <p className="text-[10px] text-brand-slate">% de líneas nuevas activas en cada mes de antigüedad. Sembrada con la zafra tipo del negocio (cohortes jul-25 a ene-26). M2 es el mes en que pega el PFI.</p>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                {p.zafra_pct.map((z: number, i: number) => {
                  const pfi = i === 2;   // la suspensión por PFI llega a los ~60 días: es la caída del mes 1 al mes 2
                  return (
                    <label key={i} className={`text-[10px] rounded-md px-1 py-0.5 ${pfi ? "text-brand-primary font-bold ring-2 ring-brand-primary bg-brand-primary/5" : "text-brand-slate"}`}
                      title={pfi ? `PFI (primera factura impaga): la caída del mes 1 al mes 2 (${Number(p.zafra_pct[1])}% → ${z}%) es la suspensión a los ~60 días.` : undefined}>
                      <span className="flex items-center justify-between h-4">M{i}{pfi && <span className="px-1 rounded bg-brand-primary text-white text-[8px] font-bold leading-4">PFI</span>}</span>
                      <NumeroInput step={0.5} value={Number(z)} onChange={(n) => setZafra(i, n)} className={`input !py-0.5 !px-1 text-[11px] text-right w-full ${pfi ? "border-brand-primary text-brand-primary font-bold" : ""}`} />
                    </label>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {defaults && <button onClick={() => set("zafra_pct", defaults.zafra_pct)} className="text-[11px] text-brand-primary font-semibold hover:underline">Restaurar zafra tipo</button>}
                <button onClick={() => set("zafra_pct", [...ZAFRA_IDEAL])} className={`text-[11px] font-semibold hover:underline ${zafraIdeal ? "text-emerald-700" : "text-emerald-600"}`}>
                  {zafraIdeal ? "✓ Zafra ideal" : "Zafra ideal"}
                </button>
              </div>
              <ZonaPFI p={p} />
            </Grupo>

            <Grupo titulo="Chargeback y recuperos">
              <Campo label="Meses de chargeback" hint="ventana de devolución (180 días)" value={p.chargeback_meses} onChange={(v) => set("chargeback_meses", v)} />
              <Campo label="Caídas que devuelven la cuota 1" hint="de cada 100 líneas que caen según la zafra, cuántas pierden la cuota 1 (suspensión por PFI o deuda, reverso). Las demás caídas devuelven solo porta y bono. Real: 85%" value={p.pct_caidas_penalizables} onChange={(v) => set("pct_caidas_penalizables", v)} step={5} suffix="%" />
              <ExplicacionCaidas p={p} />
              <Campo label="Migración de negocio" hint="% de activaciones que pierden la cuota 1 completa por migrar de negocio (real 7 liq: 2,2–4,3%)" value={Number(p.migracion_negocio_pct ?? 0)} onChange={(v) => set("migracion_negocio_pct", v)} step={0.1} suffix="%" />
              <Campo label="Recupero por reconexión" hint="% de los descuentos que Claro devuelve después (real 7 liq: 12,1%)" value={p.recupero_pct} onChange={(v) => set("recupero_pct", v)} step={0.5} suffix="%" />
              <Campo label="Caídas que terminan en baja (Gross Claro)" hint="de cada 100 líneas que caen según la zafra, cuántas Claro registra como baja por su razón (PFI, deuda, fraude) sin port out, un mes después. Alimenta los gráficos Gross y Netas. Real 2026: 60–75%" value={Number(p.pct_bajas_gross ?? 60)} onChange={(v) => set("pct_bajas_gross", v)} step={5} suffix="%" />
              <ObservacionRecupero />
              <label className="flex items-center gap-2 text-sm text-brand-ink">
                <input type="checkbox" checked={!!p.clawback_incluye_residual} onChange={(e) => set("clawback_incluye_residual", e.target.checked)} className="accent-brand-primary" />
                La suspensión penalizable descuenta cuota 1 + un residual (214.431)
              </label>
            </Grupo>

            <Grupo titulo="Costos de la estructura" hint="indicador principal: ventas por vendedor" abierto>
              <Campo label="Ventas por vendedor" hint={`define la dotación (${num(Number(p.ventas))} ventas ÷ ${num(Number(p.costos.ventas_por_vendedor))} = ${num(vendedores)} vendedores)`} value={p.costos.ventas_por_vendedor} onChange={(v) => setC("ventas_por_vendedor", v)} />
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
              <Campo destacado="primary" label="SubGerencia Comercial" hint="en análisis · salario mensual, 0 = no incorporada · suma IPS y aguinaldo"
                step={100000} min={0} value={Number(p.costos.subgerencia_salario ?? 0)} onChange={(v) => setC("subgerencia_salario", v)} />
              <Campo label="IPS" hint="sobre todos los costos de RRHH" value={p.costos.ips_pct} onChange={(v) => setC("ips_pct", v)} step={0.5} suffix="%" />
              <label className="flex items-center gap-2 text-sm text-brand-ink">
                <input type="checkbox" checked={!!p.costos.aguinaldo} onChange={(e) => setC("aguinaldo", e.target.checked)} className="accent-brand-primary" />
                Previsión de aguinaldo: RRHH ÷ 12 por mes (sin IPS)
              </label>
              <div className="border-t border-brand-border pt-2 text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">Logística y operativos</div>
              <Campo label="Entrega en Central" hint="Gs por venta" value={p.costos.logistica_central} onChange={(v) => setC("logistica_central", v)} step={1000} />
              <Campo label="Entrega en Interior" hint="Gs por venta" value={p.costos.logistica_interior} onChange={(v) => setC("logistica_interior", v)} step={1000} />
              <Campo label="Entregas en Interior" hint="el resto es Central" value={p.costos.logistica_interior_pct} onChange={(v) => setC("logistica_interior_pct", v)} step={5} suffix="%" />
              <Campo label="Cobertura adicional interior" hint="fijo mensual · logística de cobertura del interior" value={p.costos.logistica_premios} onChange={(v) => setC("logistica_premios", v)} step={1000000} />
              <Campo label="Costo operativo por venta" value={p.costos.operativo_por_venta} onChange={(v) => setC("operativo_por_venta", v)} step={500} />
            </Grupo>
                {extra}
    </section>
  );
}
