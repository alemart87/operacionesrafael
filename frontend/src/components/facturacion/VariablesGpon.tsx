"use client";

import { useState } from "react";
import { NumeroInput } from "./NumeroInput";
import { Campo } from "./Campo";

/** Variables del negocio GPON (fibra + TV): activaciones y objetivo, planes y mezcla, cuota 2 y
 *  legajos, bono fijo y recálculo, mora, costos. Misma función que VariablesNegocio para pospago. */

/** Cómo se arma el escenario GPON, en cinco pasos y con los números calibrados (liquidaciones GPON ene–jun 2026). */
export function ExplicacionGpon({ convergente = false, abierto = false }: { convergente?: boolean; abierto?: boolean }) {
  const [open, setOpen] = useState(abierto);
  const pasos: Array<[string, string]> = [
    ["Cuántas", convergente
      ? "Activaciones GPON del mes = vendedores × GPON por asesor (ideal 3). Son solo líneas de fibra (IF60 / IF30). IPTV no cuenta como GPON y no se simula: en las liquidaciones hay ~14 IPTV por cada 100 GPON, casi todas en la misma cuenta que una fibra, sin bono, y dejan ~3,6% del neto GPON."
      : "Activaciones GPON del mes: solo líneas de fibra (IF60 / IF30). IPTV no cuenta como GPON y no se simula (~14 por cada 100 GPON, ~3,6% del neto)."],
    ["Mes de la venta", "Claro paga la cuota 1 por plan: 400.000 (Fibra 60) o 325.000 (Fibra 30/40), mezcla real 74 / 26 → 380.000 por línea. Si el mes llega al objetivo de líneas IF, paga además el bono fijo por línea (escala vigente: 120.000 al 100%, 40.000 entre 95 y 100%, 0 por debajo). En 2026 liquidó con la escala anterior: 100.000, 50.000 y 0."],
    ["Mes 2", "Cuota 2: 280.000 (Fibra 60) o 200.000 (Fibra 30/40), a los 62–86 días. La cobran el 96% de las líneas con legajo presentado; de esas, el 92% completa y el resto a la mitad por legajo incompleto. Si la línea está inactiva al día 60, 0."],
    ["Lo que Claro descuenta", "Legajos (día 30–55): si el legajo NO se presenta, Claro descuenta el 100% de la cuota 1, la línea no cobra cuota 2 y no genera mora (real 2,8% de las líneas); si está incompleto u observado, descuenta el 50% y la cuota 2 se cobra a la mitad (real 7,7%). Mora: Claro penaliza cuando suspende por deuda (630.000 Fibra 60, 475.000 Fibra 30) y lo revierte si el cliente paga; lo que pesa es la neta: el 28% de las líneas queda con deuda a los 6 meses, unos 500.000 por línea, repartidos entre el mes 2 y el 6 (curva 3 · 22 · 52 · 78 · 95 · 100%). Recálculo: al mes 6, el 25% de las líneas devuelve el 100% del bono. Otros reversos (mala venta): 0,5%."],
    ["Costos por venta GPON", convergente
      ? "Comisión y plus del asesor, recupero de documentación 55.000 y operativos. Sin estructura propia: la dotación es la de pospago, por eso el resultado GPON es incremental."
      : "Comisión y plus del asesor, recupero de documentación 55.000 y operativos, más la estructura propia que se dimensiona con las activaciones del mes 1."],
  ];
  return (
    <div className="rounded-md border border-brand-cyan/60 bg-brand-cyan/5">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-2.5 text-left">
        <span className="text-[11px] uppercase tracking-wider2 font-bold text-brand-cyan">Cómo se arma el escenario GPON<span className="ml-2 normal-case tracking-normal font-normal text-brand-slate">· 5 pasos, con los números reales</span></span>
        <span className="text-brand-slate text-xs">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ol className="px-4 pb-4 space-y-2">
          {pasos.map(([t, d], i) => (
            <li key={t} className="flex gap-2 text-[11px] text-brand-graphite">
              <span className="shrink-0 w-5 h-5 rounded-full bg-brand-cyan text-white text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
              <span><b className="text-brand-ink">{t}.</b> {d}</span>
            </li>
          ))}
          <li className="text-[11px] text-brand-graphite pl-7">
            <b className="text-brand-ink">Resultado por línea:</b> ~535.000 netos a 12 meses con la escala vigente (1,4 × cuota 1). Real enero 2026 a 5 meses: 517.000 por línea (con bono 100.000 y sin el recálculo todavía).
          </li>
        </ol>
      )}
    </div>
  );
}

function Grupo({ titulo, hint, abierto = false, children }: { titulo: string; hint?: string; abierto?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(abierto);
  return (
    <div className="rounded-md border border-brand-border bg-white">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-2.5 text-left">
        <span className="text-[11px] uppercase tracking-wider2 font-bold text-brand-ink">{titulo}{hint && <span className="ml-2 normal-case tracking-normal font-normal text-brand-slate">· {hint}</span>}</span>
        <span className="text-brand-slate text-xs">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="px-4 pb-4 space-y-2">{children}</div>}
    </div>
  );
}

export function VariablesGpon({ p, setP, defaults, titulo = "Variables GPON", convergente = false, vendedores = 0, porAsesor = 0, objetivoAuto = false, setObjetivoAuto }: {
  p: any; setP: (fn: any) => void; defaults: any; titulo?: string;
  /** Simulador convergente: GPON lo vende la estructura de pospago (sin dotación propia). */
  convergente?: boolean; vendedores?: number; porAsesor?: number; objetivoAuto?: boolean; setObjetivoAuto?: (v: boolean) => void;
}) {
  const set = (k: string, v: any) => setP((prev: any) => ({ ...prev, [k]: v }));
  const activacionesMes1 = Math.round(vendedores * porAsesor);
  const objetivoIdeal = Math.max(Math.round(vendedores * 3), 1);
  const setC = (k: string, v: any) => setP((prev: any) => ({ ...prev, costos: { ...prev.costos, [k]: v } }));
  const setPlan = (i: number, k: string, v: any) => setP((prev: any) => ({ ...prev, planes: prev.planes.map((pl: any, j: number) => (j === i ? { ...pl, [k]: v } : pl)) }));
  const setEscala = (i: number, k: string, v: number) => setP((prev: any) => ({ ...prev, escala_bono: prev.escala_bono.map((e: any, j: number) => (j === i ? { ...e, [k]: v } : e)) }));
  const setCurva = (i: number, v: number) => setP((prev: any) => ({ ...prev, mora_curva_pct: prev.mora_curva_pct.map((x: number, j: number) => (j === i ? v : x)) }));
  if (!p) return null;
  const mixTotal = p.planes.reduce((s: number, x: any) => s + Number(x.mix_pct || 0), 0);
  return (
    <section className="space-y-2 no-print">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="font-display text-xl text-brand-ink uppercase">{titulo}</h2>
        {defaults && <button onClick={() => setP(defaults)} className="text-[11px] text-brand-primary font-semibold hover:underline">Restaurar valores reales</button>}
      </div>
      <ExplicacionGpon convergente={convergente} abierto={convergente} />
      <Grupo titulo="Activaciones y objetivo" abierto>
        {convergente ? (
          <>
            <div className="flex items-center gap-3 rounded-md border border-brand-cyan/50 bg-brand-cyan/5 px-2 py-1.5">
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-brand-ink">Activaciones GPON del mes 1</span>
                <span className="block text-[10px] text-brand-slate">se calculan desde pospago: {vendedores} vendedores × {porAsesor} GPON por asesor</span>
              </span>
              <span className="font-display text-xl text-brand-cyan w-[120px] text-right">{activacionesMes1.toLocaleString("es-PY")}</span>
              <span className="w-5" />
            </div>
            <Campo label="Objetivo de líneas (bono fijo)" hint={objetivoAuto ? `automático: vendedores × 3 = ${objetivoIdeal} (el ideal rinde 100%)` : "% cumplimiento = activaciones ÷ objetivo"}
              value={objetivoAuto ? objetivoIdeal : p.objetivo} onChange={(v) => { setObjetivoAuto?.(false); set("objetivo", v); }} step={5} />
            {setObjetivoAuto && (
              <label className="flex items-center gap-2 text-[11px] text-brand-graphite">
                <input type="checkbox" checked={objetivoAuto} onChange={(e) => { setObjetivoAuto(e.target.checked); if (e.target.checked) set("objetivo", objetivoIdeal); }} className="accent-brand-cyan" />
                Objetivo automático = vendedores × 3 (ideal por asesor)
              </label>
            )}
          </>
        ) : (
          <>
            <Campo label="Activaciones GPON del mes 1" hint="solo fibra; real ene–jun 2026: 166 a 218 (IPTV no cuenta)" value={p.ventas} onChange={(v) => set("ventas", v)} step={5} />
            <Campo label="Objetivo de líneas IF (bono fijo)" hint="% cumplimiento = activaciones ÷ objetivo · Claro usa 200" value={p.objetivo} onChange={(v) => set("objetivo", v)} step={5} />
          </>
        )}
        <Campo label="Activaciones que cobran el bono" hint="real 100%: todas las líneas IF en estado A cuando se llega al objetivo" value={p.pct_bono_cobrado} onChange={(v) => set("pct_bono_cobrado", v)} suffix="%" />
        <Campo destacado="orange" label="Bono adicional (a mano)" hint="Gs del mes 1; no se devuelve" value={p.bono_adicional} onChange={(v) => set("bono_adicional", v)} step={1000000} min={0} />
      </Grupo>
      <Grupo titulo="Planes, cuotas y mezcla" hint={`mix ${Math.round(mixTotal)}%`}>
        {p.planes.map((pl: any, i: number) => (
          <div key={i} className="rounded-md border border-brand-border p-2 space-y-1">
            <input value={pl.nombre} onChange={(e) => setPlan(i, "nombre", e.target.value)} className="input !py-0.5 text-sm w-full" />
            <div className="grid grid-cols-4 gap-1 text-[10px] text-brand-slate">
              <label>Cuota 1<NumeroInput step={5000} value={Number(pl.cuota1)} onChange={(n) => setPlan(i, "cuota1", n)} className="input !py-0.5 !px-1 text-[11px] text-right w-full" /></label>
              <label>Cuota 2<NumeroInput step={5000} value={Number(pl.cuota2)} onChange={(n) => setPlan(i, "cuota2", n)} className="input !py-0.5 !px-1 text-[11px] text-right w-full" /></label>
              <label>Penalidad mora<NumeroInput step={5000} value={Number(pl.penalidad_mora)} onChange={(n) => setPlan(i, "penalidad_mora", n)} className="input !py-0.5 !px-1 text-[11px] text-right w-full" /></label>
              <label>Mix %<NumeroInput step={1} value={Number(pl.mix_pct)} onChange={(n) => setPlan(i, "mix_pct", n)} className="input !py-0.5 !px-1 text-[11px] text-right w-full" /></label>
            </div>
          </div>
        ))}
        <p className="text-[10px] text-brand-slate">Solo fibra: IPTV no cuenta como GPON. Mezcla real ene–jun 2026: Fibra 60 (IF60 / BAF7) 74% · Fibra 30/40 (IF30 / IF40 / BAF3) 26%. Penalidad de mora: lo que Claro descuenta y no revierte por línea en mora (Fibra 60: 630.000 completa, promedio con pagos parciales ~520.000; Fibra 30: 475.000, promedio ~430.000).</p>
      </Grupo>
      <Grupo titulo="Cuota 2 y legajos">
        <Campo label="Mes de la cuota 2" hint="día 59–91, mediana 73 → liquidación del mes 2" value={p.cuota2_mes} onChange={(v) => set("cuota2_mes", v)} />
        <Campo label="Líneas que cobran cuota 2" hint="de las que presentaron legajo · real 96% (0 = línea inactiva al día 60)" value={p.cuota2_pct_lineas} onChange={(v) => set("cuota2_pct_lineas", v)} suffix="%" />
        <Campo label="De esas, con importe completo" hint="el resto cobra la mitad (legajo incompleto) · real 92%" value={p.cuota2_pct_completa} onChange={(v) => set("cuota2_pct_completa", v)} suffix="%" />
        <Campo label="Legajos NO presentados" hint="Claro descuenta el 100% de la cuota 1, la línea no cobra cuota 2 y no genera mora · real 2,8% (feb 6,6%)" value={Number(p.legajo_no_presentado_pct ?? 3)} onChange={(v) => set("legajo_no_presentado_pct", v)} step={0.5} suffix="%" />
        <Campo label="Legajos incompletos u observados" hint="descuenta el 50% de la cuota 1 y la cuota 2 se cobra a la mitad · real 7,7% (enero 21%)" value={p.legajo_pct} onChange={(v) => set("legajo_pct", v)} step={0.5} suffix="%" />
        <Campo label="Descuento del legajo incompleto (% de la cuota 1)" hint="real 200.000 sobre 400.000" value={p.legajo_pct_cuota1} onChange={(v) => set("legajo_pct_cuota1", v)} suffix="%" />
      </Grupo>
      <Grupo titulo="Bono fijo y recálculo" hint="escala vigente">
        {p.escala_bono.map((e: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="text-brand-slate w-8">≥</span>
            <NumeroInput value={Number(e.desde_pct)} onChange={(n) => setEscala(i, "desde_pct", n)} className="input !py-0.5 text-sm text-right w-20" /><span className="text-xs">%</span>
            <span className="text-brand-slate">→</span>
            <NumeroInput step={1000} value={Number(e.monto)} onChange={(n) => setEscala(i, "monto", n)} className="input !py-0.5 text-sm text-right w-28" /><span className="text-xs">Gs/línea</span>
          </div>
        ))}
        <p className="text-[10px] text-brand-slate">Historial ene–may 2026 con la tabla anterior: 100.000 (ene, mar), 50.000 (abr), 0 (feb, may).</p>
        <Campo label="Mes del recálculo" hint="día 150–180" value={p.recalculo_mes} onChange={(v) => set("recalculo_mes", v)} />
        <Campo label="Líneas castigadas en el recálculo" hint="devuelven el 100% del bono · real 23–26%" value={p.pct_recalculo} onChange={(v) => set("pct_recalculo", v)} suffix="%" />
      </Grupo>
      <Grupo titulo="Mora · qué descuenta Claro cuando el cliente no paga" hint="el riesgo principal de GPON" abierto={convergente}>
        <p className="text-[11px] text-brand-graphite">
          Cuando el cliente deja de pagar, Claro suspende la línea y nos <b>descuenta una penalidad por deuda</b> según el plan
          (630.000 en Fibra 60, 475.000 en Fibra 30). Si el cliente después paga, Claro <b>devuelve</b> esa penalidad.
          Lo que pesa es la neta: las líneas que a los 6 meses siguen sin pagar. Entre penalizar y devolver pasan
          muchas filas por la liquidación, pero el modelo solo cuenta lo que queda.
        </p>
        <Campo label="Líneas que terminan sin pagar" hint="de cada 100 vendidas, a los 6 meses · real: 27% de enero a 5 meses, 24% febrero, 18% marzo a 3 meses" value={p.mora_pct_lineas} onChange={(v) => set("mora_pct_lineas", v)} suffix="%" />
        <Campo label="Parte de la penalidad que se pierde" hint="100 = el promedio real por línea en mora (520.000 Fibra 60 · 430.000 Fibra 30, con pagos parciales)" value={p.mora_penalidad_pct} onChange={(v) => set("mora_penalidad_pct", v)} suffix="%" />
        {(() => {
          const act = convergente ? activacionesMes1 : Number(p.ventas) || 0;
          const planes: any[] = p.planes ?? [];
          const mixTot = planes.reduce((s: number, x: any) => s + Number(x.mix_pct || 0), 0) || 100;
          const penW = planes.reduce((s: number, x: any) => s + Number(x.penalidad_mora || 0) * Number(x.mix_pct || 0), 0) / mixTot;
          const cuota1W = planes.reduce((s: number, x: any) => s + Number(x.cuota1 || 0) * Number(x.mix_pct || 0), 0) / mixTot;
          const sinLegajo = 1 - Math.min(Math.max(Number(p.legajo_no_presentado_pct ?? 0), 0), 100) / 100;
          const lineasMora = act * sinLegajo * Number(p.mora_pct_lineas || 0) / 100;
          const porLinea = penW * Number(p.mora_penalidad_pct ?? 100) / 100;
          const total = lineasMora * porLinea;
          const curva: number[] = (p.mora_curva_pct ?? []).map(Number);
          const gs = (v: number) => `${(v / 1e6).toFixed(1).replace(".", ",")} M`;
          return (
            <>
              <div className="rounded-md border border-brand-primary/40 bg-brand-primary/5 px-3 py-2 text-[11px] text-brand-graphite">
                <b className="text-brand-ink">Con {act.toLocaleString("es-PY")} activaciones:</b> {Math.round(lineasMora)} líneas sin pagar × {Math.round(porLinea).toLocaleString("es-PY")} = <b className="text-brand-primary">{gs(total)}</b> por cohorte
                {" "}→ <b>{act ? Math.round(total / act).toLocaleString("es-PY") : 0}</b> por línea vendida ({cuota1W ? Math.round(100 * (act ? total / act : 0) / cuota1W) : 0}% de la cuota 1).
              </div>
              <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-bold border-t border-brand-border pt-2">Cuándo aparece el descuento · % del total de mora ya descontado, por mes de antigüedad</div>
              <p className="text-[11px] text-brand-graphite">
                <b className="text-brand-ink">No es una zafra.</b> El total de mora de la cohorte son las <b>{Math.round(lineasMora)} líneas sin pagar (el {Number(p.mora_pct_lineas || 0)}%)</b>.
                La curva dice qué parte de esas {Math.round(lineasMora)} ya fue penalizada a cada mes: <b>100% en M6 = las {Math.round(lineasMora)} líneas, el {Number(p.mora_pct_lineas || 0)}% de las ventas</b>, y después no se descuenta nada más.
                Claro penaliza al suspender, entre el día 55 y el 160 de la venta: a los 3 meses ya cayó la mitad. Editá el acumulado si cambia el ritmo.
              </p>
              <div className="grid grid-cols-7 gap-1">
                {curva.map((x: number, i: number) => {
                  const prev = i > 0 ? curva[i - 1] : 0;
                  const delMes = total * Math.max(0, x - prev) / 100;
                  const acumLineas = lineasMora * x / 100;
                  const acumPct = Number(p.mora_pct_lineas || 0) * x / 100;
                  return (
                    <label key={i} className="text-[10px] text-brand-slate">M{i}
                      <NumeroInput step={1} value={x} onChange={(n) => setCurva(i, n)} className="input !py-0.5 !px-1 text-[11px] text-right w-full" />
                      <span className="block text-right text-[9px] text-brand-graphite leading-tight mt-0.5">{Math.round(acumLineas)} sin pagar</span>
                      <span className="block text-right text-[9px] text-brand-slate leading-tight">{acumPct.toFixed(1).replace(".", ",")}% de las ventas</span>
                      <span className={`block text-right font-mono text-[10px] leading-tight ${delMes > 0 ? "text-brand-primary" : "text-brand-slate"}`}>{i === 0 ? "—" : `−${gs(delMes)}`}</span>
                    </label>
                  );
                })}
              </div>
              <p className="text-[10px] text-brand-slate">Lectura por columna: acumulado de la curva · líneas de la cohorte que ya quedaron sin pagar · ese acumulado como % de las ventas (llega al {Number(p.mora_pct_lineas || 0)}%) · descuento de ese mes. Las que siguen pagando son el resto: al M6, el {(100 - Number(p.mora_pct_lineas || 0)).toFixed(0)}% de las líneas con legajo.</p>
            </>
          );
        })()}
        <Campo label="Chargeback (meses)" hint="180 días exactos: después del mes 6 Claro no descuenta más" value={p.chargeback_meses} onChange={(v) => set("chargeback_meses", v)} />
        <Campo label="Otros reversos" hint="mala venta y cancelaciones en el mes 1 · % de la cuota 1 · real 0,5%" value={p.otros_pct} onChange={(v) => set("otros_pct", v)} step={0.1} suffix="%" />
      </Grupo>
      {convergente ? (
        <Grupo titulo="Costos variables GPON" hint="la estructura es la de pospago">
          <p className="text-[10px] text-brand-slate">GPON no agrega vendedores, supervisores ni backoffice: lo vende la misma dotación. Solo paga estos costos por venta GPON; IPS y aguinaldo son los de pospago.</p>
          <Campo label="Comisión por venta GPON" hint="Gs por activación · paga IPS y aguinaldo" value={p.costos.comision_por_venta} onChange={(v) => setC("comision_por_venta", v)} step={1000} />
          <Campo label="Plus por venta GPON" hint="Gs por activación · sin cargas" value={p.costos.plus_por_venta} onChange={(v) => setC("plus_por_venta", v)} step={1000} />
          <Campo label="Recupero de documentación por venta GPON" hint="55.000 por cada venta · sin cargas" value={Number(p.costos.documentacion_por_venta ?? 0)} onChange={(v) => setC("documentacion_por_venta", v)} step={5000} />
          <Campo label="Operativos por venta GPON" value={p.costos.operativo_por_venta} onChange={(v) => setC("operativo_por_venta", v)} step={500} />
          <Campo label="Logística por venta (Central)" hint="GPON: la instalación la hace Claro · 0 por defecto" value={p.costos.logistica_central} onChange={(v) => setC("logistica_central", v)} step={5000} />
          <Campo label="Logística por venta (Interior)" value={p.costos.logistica_interior} onChange={(v) => setC("logistica_interior", v)} step={5000} />
          <Campo label="Entregas en Interior" value={p.costos.logistica_interior_pct} onChange={(v) => setC("logistica_interior_pct", v)} suffix="%" />
        </Grupo>
      ) : (
      <Grupo titulo="Costos de estructura" hint="mismas reglas que pospago">
        <Campo label="Ventas por vendedor" value={p.costos.ventas_por_vendedor} onChange={(v) => setC("ventas_por_vendedor", v)} />
        <Campo label="Supervisor cada N vendedores" value={p.costos.supervisor_cada_vendedores} onChange={(v) => setC("supervisor_cada_vendedores", v)} />
        <Campo label="Backoffice cada N ventas" value={p.costos.backoffice_cada_ventas} onChange={(v) => setC("backoffice_cada_ventas", v)} />
        <Campo label="Coordinadores" value={p.costos.coordinadores} onChange={(v) => setC("coordinadores", v)} />
        <Campo label="Controllers" value={p.costos.controllers} onChange={(v) => setC("controllers", v)} />
        <Campo label="Comisión por venta (con IPS y aguinaldo)" value={p.costos.comision_por_venta} onChange={(v) => setC("comision_por_venta", v)} step={1000} />
        <Campo label="Plus por venta (sin cargas)" value={p.costos.plus_por_venta} onChange={(v) => setC("plus_por_venta", v)} step={1000} />
        <Campo label="Salario por hora" hint={`× ${p.costos.horas_dia} h × ${p.costos.dias_mes} días`} value={p.costos.salario_hora} onChange={(v) => setC("salario_hora", v)} step={100} />
        <Campo label="Horas por día" value={p.costos.horas_dia} onChange={(v) => setC("horas_dia", v)} />
        <Campo label="Días por mes" value={p.costos.dias_mes} onChange={(v) => setC("dias_mes", v)} />
        <Campo label="Supervisor salario" value={p.costos.supervisor_salario} onChange={(v) => setC("supervisor_salario", v)} step={100000} />
        <Campo label="Supervisor premio" value={p.costos.supervisor_premio} onChange={(v) => setC("supervisor_premio", v)} step={100000} />
        <Campo label="Coordinador salario" value={p.costos.coordinador_salario} onChange={(v) => setC("coordinador_salario", v)} step={100000} />
        <Campo label="Backoffice salario" value={p.costos.backoffice_salario} onChange={(v) => setC("backoffice_salario", v)} step={100000} />
        <Campo label="Controller salario" value={p.costos.controller_salario} onChange={(v) => setC("controller_salario", v)} step={100000} />
        <Campo label="Controller premio" value={p.costos.controller_premio} onChange={(v) => setC("controller_premio", v)} step={100000} />
        <Campo label="SubGerencia Comercial (salario)" hint="0 = no incorporada · paga IPS y aguinaldo" value={p.costos.subgerencia_salario} onChange={(v) => setC("subgerencia_salario", v)} step={500000} />
        <Campo label="Recupero de documentación por venta" hint="55.000 por cada venta GPON · sin cargas" value={Number(p.costos.documentacion_por_venta ?? 0)} onChange={(v) => setC("documentacion_por_venta", v)} step={5000} />
        <Campo label="Operativos por venta" value={p.costos.operativo_por_venta} onChange={(v) => setC("operativo_por_venta", v)} step={500} />
        <Campo label="Logística por venta (Central)" hint="GPON: la instalación la hace Claro · 0 por defecto" value={p.costos.logistica_central} onChange={(v) => setC("logistica_central", v)} step={5000} />
        <Campo label="Logística por venta (Interior)" value={p.costos.logistica_interior} onChange={(v) => setC("logistica_interior", v)} step={5000} />
        <Campo label="Entregas en Interior" value={p.costos.logistica_interior_pct} onChange={(v) => setC("logistica_interior_pct", v)} suffix="%" />
        <Campo label="Cobertura adicional interior (fijo mensual)" value={p.costos.logistica_premios} onChange={(v) => setC("logistica_premios", v)} step={1000000} />
        <Campo label="IPS" hint="sobre todo el RRHH · aguinaldo = RRHH ÷ 12" value={p.costos.ips_pct} onChange={(v) => setC("ips_pct", v)} step={0.5} suffix="%" />
      </Grupo>
      )}
    </section>
  );
}
