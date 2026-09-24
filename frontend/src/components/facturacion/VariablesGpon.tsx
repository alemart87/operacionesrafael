"use client";

import { useState } from "react";
import { NumeroInput } from "./NumeroInput";

/** Variables del negocio GPON (fibra + TV): activaciones y objetivo, planes y mezcla, cuota 2 y
 *  legajos, bono fijo y recálculo, mora, costos. Misma función que VariablesNegocio para pospago. */

function Campo({ label, hint, value, onChange, step = 1, suffix }: { label: string; hint?: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return (
    <label className="flex items-center gap-3">
      <span className="flex-1"><span className="block text-sm text-brand-ink">{label}</span>{hint && <span className="block text-[10px] text-brand-slate">{hint}</span>}</span>
      <span className="flex items-center gap-1"><NumeroInput step={step} value={value} onChange={onChange} className="input max-w-[120px] !py-1 text-sm text-right" />{suffix && <span className="text-xs text-brand-slate w-4">{suffix}</span>}</span>
    </label>
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

export function VariablesGpon({ p, setP, defaults, titulo = "Variables GPON" }: { p: any; setP: (fn: any) => void; defaults: any; titulo?: string }) {
  const set = (k: string, v: any) => setP((prev: any) => ({ ...prev, [k]: v }));
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
      <Grupo titulo="Activaciones y objetivo" abierto>
        <Campo label="Activaciones del mes 1" hint="real ene–may 2026: 188 a 239" value={p.ventas} onChange={(v) => set("ventas", v)} step={5} />
        <Campo label="Objetivo de líneas (bono fijo)" hint="% cumplimiento = activaciones ÷ objetivo" value={p.objetivo} onChange={(v) => set("objetivo", v)} step={5} />
        <Campo label="Activaciones que cobran el bono" hint="real 91% (218 de 239)" value={p.pct_bono_cobrado} onChange={(v) => set("pct_bono_cobrado", v)} suffix="%" />
        <Campo label="Bono adicional (a mano)" hint="Gs del mes 1; no se devuelve" value={p.bono_adicional} onChange={(v) => set("bono_adicional", v)} step={1000000} />
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
        <p className="text-[10px] text-brand-slate">Real: Fibra 60 70% · Fibra 30 18% · TV 12%. Penalidad de mora por plan: lo que Claro descuenta y no revierte (Fibra 60: 630.000 / 350.000 / 315.000; Fibra 30: 475.000; TV: 190.000), ponderado.</p>
      </Grupo>
      <Grupo titulo="Cuota 2 y legajos">
        <Campo label="Mes de la cuota 2" hint="día 59–91, mediana 73 → liquidación del mes 2" value={p.cuota2_mes} onChange={(v) => set("cuota2_mes", v)} />
        <Campo label="Líneas que cobran cuota 2" hint="real 86–97% por cohorte" value={p.cuota2_pct_lineas} onChange={(v) => set("cuota2_pct_lineas", v)} suffix="%" />
        <Campo label="De esas, con importe completo" hint="el resto cobra la mitad (legajo incompleto)" value={p.cuota2_pct_completa} onChange={(v) => set("cuota2_pct_completa", v)} suffix="%" />
        <Campo label="Líneas con documentación faltante" hint="mes 1 · real 11%" value={p.legajo_pct} onChange={(v) => set("legajo_pct", v)} suffix="%" />
        <Campo label="Descuento por legajo (% de la cuota 1)" hint="real 200.000 sobre 400.000" value={p.legajo_pct_cuota1} onChange={(v) => set("legajo_pct_cuota1", v)} suffix="%" />
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
      <Grupo titulo="Mora (penalización por deuda neta)" hint="el riesgo principal de GPON">
        <Campo label="Líneas que quedan en mora" hint="deuda no revertida a los 6 meses · real 26% de la cohorte" value={p.mora_pct_lineas} onChange={(v) => set("mora_pct_lineas", v)} suffix="%" />
        <Campo label="% de la penalidad que se pierde" hint="100 = tabla completa por plan" value={p.mora_penalidad_pct} onChange={(v) => set("mora_penalidad_pct", v)} suffix="%" />
        <div className="text-[10px] text-brand-slate">Curva acumulada de la mora por mes (% del total final). Real: primera penalización p25 día 65, mediana 93, p75 132, máximo 180.</div>
        <div className="grid grid-cols-7 gap-1">
          {p.mora_curva_pct.map((x: number, i: number) => (
            <label key={i} className="text-[10px] text-brand-slate">M{i}<NumeroInput step={1} value={Number(x)} onChange={(n) => setCurva(i, n)} className="input !py-0.5 !px-1 text-[11px] text-right w-full" /></label>
          ))}
        </div>
        <Campo label="Chargeback (meses)" hint="180 días exactos" value={p.chargeback_meses} onChange={(v) => set("chargeback_meses", v)} />
        <Campo label="Otros reversos" hint="reversos de activación y cancelaciones · % de la cuota 1" value={p.otros_pct} onChange={(v) => set("otros_pct", v)} step={0.1} suffix="%" />
      </Grupo>
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
        <Campo label="Operativos por venta" value={p.costos.operativo_por_venta} onChange={(v) => setC("operativo_por_venta", v)} step={500} />
        <Campo label="Logística por venta (Central)" hint="GPON: la instalación la hace Claro · 0 por defecto" value={p.costos.logistica_central} onChange={(v) => setC("logistica_central", v)} step={5000} />
        <Campo label="Logística por venta (Interior)" value={p.costos.logistica_interior} onChange={(v) => setC("logistica_interior", v)} step={5000} />
        <Campo label="Entregas en Interior" value={p.costos.logistica_interior_pct} onChange={(v) => setC("logistica_interior_pct", v)} suffix="%" />
        <Campo label="Premios logística (fijo mensual)" value={p.costos.logistica_premios} onChange={(v) => setC("logistica_premios", v)} step={1000000} />
        <Campo label="IPS" hint="sobre todo el RRHH · aguinaldo = RRHH ÷ 12" value={p.costos.ips_pct} onChange={(v) => setC("ips_pct", v)} step={0.5} suffix="%" />
      </Grupo>
    </section>
  );
}
