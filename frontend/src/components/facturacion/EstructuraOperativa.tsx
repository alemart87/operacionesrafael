"use client";

import { useState } from "react";
import { formatGs, formatInt } from "@/lib/format";

/** Factores que determinan el SPH/VPH neto (ventas por hora), con peso recomendado y responsable. */
const FACTORES_SPH: Array<{ factor: string; corto: string; peso: number; responsable: string; quien: "claro" | "bpo" | "mixto"; mueve: string }> = [
  { factor: "Calidad de la base de datos", corto: "Base de datos", peso: 35, responsable: "Claro", quien: "claro", mueve: "Contactabilidad, datos correctos, elegibilidad, saturación, perfil del cliente" },
  { factor: "Coaching, control y ejecución comercial", corto: "Coaching / gestión BPO", peso: 25, responsable: "BPO / Voicenter", quien: "bpo", mueve: "Speech, manejo de objeciones, cierre, disciplina, productividad" },
  { factor: "Condiciones / oferta comercial", corto: "Oferta comercial", peso: 25, responsable: "Claro", quien: "claro", mueve: "Precio, GB, beneficios, promociones, diferencial vs. operador actual" },
  { factor: "Políticas de aprobación y netificación", corto: "Aprobación / netificación", peso: 15, responsable: "Claro / proceso Telco", quien: "mixto", mueve: "Rechazos, validaciones, titularidad, reglas de portabilidad, caída bruto→neto" },
];
const COLOR_QUIEN = { claro: "#E6332A", bpo: "#0EA5E9", mixto: "#F39200" };
/** Niveles realistas de mejora del factor coaching (tope 60%: más allá es terreno muy optimista). */
const NIVELES_MEJORA: Array<{ nivel: number; pct: number; nombre: string; interpretacion: string; color: string; banda: "baja" | "media" | "alta" }> = [
  { nivel: 0, pct: 0, nombre: "Sin mejora", interpretacion: "Se mantiene la gestión actual", color: "#9CA3AF", banda: "baja" },
  { nivel: 1, pct: 10, nombre: "Ajuste básico", interpretacion: "Controles mínimos y seguimiento de speech", color: "#7DD3FC", banda: "baja" },
  { nivel: 2, pct: 20, nombre: "Mejora moderada", interpretacion: "Coaching regular y manejo de objeciones", color: "#0EA5E9", banda: "baja" },
  { nivel: 3, pct: 30, nombre: "Buena mejora", interpretacion: "Disciplina comercial sostenida", color: "#34D399", banda: "media" },
  { nivel: 4, pct: 40, nombre: "Mejora fuerte", interpretacion: "Gestión de cierre y productividad por vendedor", color: "#059669", banda: "media" },
  { nivel: 5, pct: 50, nombre: "Muy buen nivel", interpretacion: "Equipo de alto rendimiento con control diario", color: "#F59E0B", banda: "alta" },
  { nivel: 6, pct: 60, nombre: "Escenario exigente / casi óptimo", interpretacion: "Excelencia en coaching; más de esto es muy optimista", color: "#EA580C", banda: "alta" },
];
const BANDAS = { baja: "0–20% · mejora baja", media: "30–40% · mejora media", alta: "50–60% · mejora alta" };
const MEJORA_MAXIMA_PCT = NIVELES_MEJORA[NIVELES_MEJORA.length - 1].pct;   // 60%, SOLO sobre el factor de coaching / gestión BPO
const PESO_BPO = FACTORES_SPH.filter((x) => x.quien === "bpo").reduce((s, x) => s + x.peso, 0);   // 25
const MEJORA_MAXIMA_VPH_PCT = Math.round(MEJORA_MAXIMA_PCT * PESO_BPO) / 100;                     // 15% sobre el VPH total

/** Descomposición del VPH por factor + simulador aislado de mejora (no toca el simulador principal). */
function FactoresVPH({ vph, ventasVend, ventas, vendedores, horasMes }: { vph: number; ventasVend: number; ventas: number; vendedores: number; horasMes: number }) {
  const [mejora, setMejora] = useState(20);
  const nivelActual = NIVELES_MEJORA.reduce((a, n) => (Math.min(mejora, MEJORA_MAXIMA_PCT) >= n.pct ? n : a), NIVELES_MEJORA[0]);
  const f2 = (x: number) => x.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f3 = (x: number) => x.toLocaleString("es-PY", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const f1 = (x: number) => x.toLocaleString("es-PY", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const mejoraFactor = Math.min(Math.max(mejora, 0), MEJORA_MAXIMA_PCT) / 100;   // sobre el factor coaching (25% del VPH)
  const m = mejoraFactor * PESO_BPO / 100;                                         // efecto sobre el VPH total (máx. 15%)
  const vphBpo = vph * PESO_BPO / 100;
  const vphBpoNuevo = vphBpo * (1 + mejoraFactor);
  const vphNuevo = vph * (1 + m);
  const ventasVendNuevo = ventasVend * (1 + m);
  const ventasMesNuevo = ventas * (1 + m);
  const fp = (x: number) => x.toLocaleString("es-PY", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const vendedoresNecesarios = ventasVendNuevo > 0 ? Math.ceil(ventas / ventasVendNuevo) : vendedores;
  return (
    <div className="mt-4 space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">Qué determina el VPH neto</div>
        <div className="text-[11px] text-brand-slate mb-2">Peso recomendado de cada factor y quién lo mueve. El equivalente es la parte del VPH actual ({f2(vph)}) que explica cada uno.</div>
        {/* barra apilada por factor */}
        <div className="flex h-9 w-full rounded-md overflow-hidden border border-brand-border">
          {FACTORES_SPH.map((x) => (
            <div key={x.corto} title={`${x.factor} · ${x.peso}% · ${x.responsable}`} style={{ width: `${x.peso}%`, background: COLOR_QUIEN[x.quien] }}
              className="flex items-center justify-center text-white text-[11px] font-bold px-1 truncate">
              {x.peso}%
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[10px] text-brand-graphite">
          <span className="inline-flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COLOR_QUIEN.claro }} /> Claro</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COLOR_QUIEN.bpo }} /> BPO / Voicenter</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COLOR_QUIEN.mixto }} /> Claro / proceso Telco</span>
        </div>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[11px] min-w-[640px]">
            <thead className="bg-brand-bg text-[9px] uppercase tracking-wider2 text-brand-slate">
              <tr>
                <th className="px-2 py-1.5 text-left">Factor que determina el SPH neto</th>
                <th className="px-2 py-1.5 text-right">Peso</th>
                <th className="px-2 py-1.5 text-left">Responsable principal</th>
                <th className="px-2 py-1.5 text-left">Qué mueve</th>
                <th className="px-2 py-1.5 text-right">Equivalente sobre VPH {f2(vph)}</th>
              </tr>
            </thead>
            <tbody>
              {FACTORES_SPH.map((x) => (
                <tr key={x.corto} className="border-t border-brand-border">
                  <td className="px-2 py-1.5 text-brand-ink font-semibold"><span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle" style={{ background: COLOR_QUIEN[x.quien] }} />{x.factor}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{x.peso}%</td>
                  <td className="px-2 py-1.5">{x.responsable}</td>
                  <td className="px-2 py-1.5 text-brand-graphite">{x.mueve}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{f3(vph * x.peso / 100)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-brand-ink bg-brand-bg-soft font-bold">
                <td className="px-2 py-1.5">Total</td>
                <td className="px-2 py-1.5 text-right font-mono">100%</td>
                <td className="px-2 py-1.5">—</td>
                <td className="px-2 py-1.5">SPH neto</td>
                <td className="px-2 py-1.5 text-right font-mono">{f3(vph)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-2 rounded-md border-l-4 border-brand-primary bg-brand-primary/5 px-3 py-2 text-[12px] text-brand-ink">
          <b>Leyenda.</b> Voicenter solo maneja el factor de coaching, control y ejecución comercial, que pesa el <b>{PESO_BPO}%</b> del VPH. Con controles y coaching efectivos ese factor puede mejorar hasta un <b>{MEJORA_MAXIMA_PCT}%</b> (escenario exigente; más allá es muy optimista), lo que equivale a una mejora máxima de <b>{fp(MEJORA_MAXIMA_VPH_PCT)}%</b> sobre el VPH total ({f3(vph)} → {f3(vph * (1 + MEJORA_MAXIMA_VPH_PCT / 100))}). El <b>{100 - PESO_BPO}%</b> restante del VPH corresponde a bases de datos, oferta comercial, políticas de aprobación y otras políticas de Claro.
        </div>
      </div>

      {/* simulador aislado */}
      <div className="rounded-md border-2 border-dashed border-sky-300 bg-sky-50/60 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[10px] uppercase tracking-wider2 text-sky-800 font-bold">Simulador aislado · ¿cómo quedarían las ventas por operador?</div>
          <div className="text-[10px] text-sky-800">no afecta al simulador: solo se calcula acá</div>
        </div>
        <div className="mt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-[11px] text-brand-graphite">Mejora del factor coaching y control ({PESO_BPO}% del VPH)</label>
            <span className="inline-flex items-center gap-2 px-2 py-1 rounded-md text-white text-[11px] font-bold" style={{ background: nivelActual.color }}>
              Nivel {nivelActual.nivel} · {nivelActual.nombre} · +{nivelActual.pct}%
            </span>
          </div>
          <input type="range" min={0} max={MEJORA_MAXIMA_PCT} step={10} value={Math.min(mejora, MEJORA_MAXIMA_PCT)} onChange={(e) => setMejora(Number(e.target.value))}
            className="w-full mt-2" style={{ accentColor: nivelActual.color }} aria-label="Nivel de mejora del factor coaching" />
          <div className="grid grid-cols-7 gap-1 mt-1">
            {NIVELES_MEJORA.map((n) => (
              <button key={n.nivel} type="button" onClick={() => setMejora(n.pct)} title={`${n.nombre}: ${n.interpretacion}`}
                className={`rounded-md border px-1 py-1 text-center transition-all ${n.pct === nivelActual.pct ? "text-white border-transparent shadow" : "bg-white text-brand-graphite border-brand-border hover:border-brand-ink"}`}
                style={n.pct === nivelActual.pct ? { background: n.color } : { borderTopColor: n.color, borderTopWidth: 3 }}>
                <div className="text-[11px] font-bold font-mono">{n.pct}%</div>
                <div className="text-[9px] leading-tight hidden sm:block">{n.nombre}</div>
              </button>
            ))}
          </div>
          <div className="mt-1.5 text-[11px] text-brand-ink"><b>{nivelActual.nombre}:</b> {nivelActual.interpretacion}.</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[10px] text-brand-graphite">
            {(["baja", "media", "alta"] as const).map((b) => (
              <span key={b} className={`inline-flex items-center gap-1 ${nivelActual.banda === b ? "font-bold text-brand-ink" : ""}`}>
                <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: b === "baja" ? "#0EA5E9" : b === "media" ? "#059669" : "#EA580C" }} /> {BANDAS[b]}
              </span>
            ))}
            <span className="text-brand-slate">tope {MEJORA_MAXIMA_PCT}% = {fp(MEJORA_MAXIMA_VPH_PCT)}% sobre el VPH total</span>
          </div>
        </div>
        <div className="mt-2 rounded-md border border-sky-200 bg-white px-3 py-2 text-[11px] text-brand-graphite">
          Componente coaching del VPH: <b className="font-mono">{f3(vphBpo)}</b> → <b className="font-mono text-sky-700">{f3(vphBpoNuevo)}</b> (+{Math.min(mejora, MEJORA_MAXIMA_PCT)}%).
          {" "}Los otros {100 - PESO_BPO}% del VPH ({f3(vph - vphBpo)}) no cambian. Efecto sobre el VPH total: <b className="font-mono text-sky-700">+{fp(Math.round(m * 10000) / 100)}%</b>.
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <div className="rounded-md border border-sky-200 bg-white p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">VPH</div>
            <div className="font-display text-2xl text-brand-ink leading-tight mt-1">{f3(vph)} → <span className="text-sky-700">{f3(vphNuevo)}</span></div>
            <div className="text-[10px] text-brand-slate mt-1">ventas por hora por vendedor</div>
          </div>
          <div className="rounded-md border border-sky-200 bg-white p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">Ventas por vendedor / mes</div>
            <div className="font-display text-2xl text-brand-ink leading-tight mt-1">{f1(ventasVend)} → <span className="text-sky-700">{f1(ventasVendNuevo)}</span></div>
            <div className="text-[10px] text-brand-slate mt-1">{f3(vphNuevo)} × {formatInt(horasMes)} h</div>
          </div>
          <div className="rounded-md border border-sky-200 bg-white p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">Ventas del mes, mismos {formatInt(vendedores)} vendedores</div>
            <div className="font-display text-2xl text-brand-ink leading-tight mt-1">{formatInt(ventas)} → <span className="text-sky-700">{formatInt(Math.round(ventasMesNuevo))}</span></div>
            <div className="text-[10px] text-brand-slate mt-1">+{formatInt(Math.round(ventasMesNuevo - ventas))} ventas</div>
          </div>
          <div className="rounded-md border border-sky-200 bg-white p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">Vendedores para las mismas {formatInt(ventas)} ventas</div>
            <div className="font-display text-2xl text-brand-ink leading-tight mt-1">{formatInt(vendedores)} → <span className="text-sky-700">{formatInt(vendedoresNecesarios)}</span></div>
            <div className="text-[10px] text-brand-slate mt-1">{vendedores - vendedoresNecesarios > 0 ? `${formatInt(vendedores - vendedoresNecesarios)} vendedores menos` : "misma estructura"}</div>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-brand-graphite">
          <b className="text-brand-ink">Para volver a simular con este dato:</b> cargá <b className="font-mono text-sky-800">{f1(ventasVendNuevo)}</b> ventas por vendedor en Costos (misma venta, menos estructura) o{" "}
          <b className="font-mono text-sky-800">{formatInt(Math.round(ventasMesNuevo))}</b> ventas efectivas en el mes 1 (misma estructura, más venta).
        </div>
      </div>
    </div>
  );
}

/** Estructura operativa necesaria: cuadros de headcount (vendedores, supervisores, backoffice…),
 *  remuneración promedio del vendedor y costo total de la estructura. Compartido por el simulador
 *  mensual (sección propia) y el anual (bloque colapsable, estructura fija del mes 1). */
export function EstructuraOperativa({ costos, p, ventas, sinCard = false, titulo = "Estructura operativa necesaria", intro }: {
  costos: any; p: any; ventas: number; sinCard?: boolean; titulo?: string; intro?: string;
}) {
  if (!costos?.headcount) return null;
  const hc = costos.headcount;
  const cuadros: Array<[string, number, string, string]> = [
    ["Vendedores", hc.vendedores, "#E6332A", `salarios fijos ${formatGs(costos.rrhh.operadores_salario)}/mes`],
    ["Supervisores", hc.supervisores, "#F39200", `salarios ${formatGs(costos.rrhh.supervisores)}/mes`],
    ["Backoffice", hc.backoffice, "#0EA5E9", `salarios ${formatGs(costos.rrhh.backoffice)}/mes`],
    ["Coordinador", hc.coordinadores, "#662483", `salario ${formatGs(costos.rrhh.coordinadores)}/mes`],
    ["Controllers", hc.controllers, "#00B2BF", `salarios ${formatGs(costos.rrhh.controllers)}/mes`],
    ["SubGerencia Comercial", hc.subgerencia ?? 0, "#E6332A", costos.rrhh.subgerencia > 0 ? `salario ${formatGs(costos.rrhh.subgerencia)}/mes` : "no incorporada (costo 0)"],
    ["Total personas", hc.total, "#0F1116", `RRHH con IPS y aguinaldo ${formatGs(costos.rrhh_total)}/mes`],
  ];
  const v = costos.vendedor;
  // Velocidad de ventas: VPH = ventas por vendedor por mes ÷ horas trabajadas en el mes.
  const horasDia = Number(p.costos.horas_dia) || 0, diasMes = Number(p.costos.dias_mes) || 0;
  const horasMes = horasDia * diasMes;
  const ventasVend = hc.vendedores > 0 ? ventas / hc.vendedores : 0;
  const vph = horasMes > 0 ? ventasVend / horasMes : 0;
  const vpd = diasMes > 0 ? ventasVend / diasMes : 0;
  const f2 = (x: number) => x.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f1 = (x: number) => x.toLocaleString("es-PY", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const cuerpo = (
    <>
      {!sinCard && <h2 className="font-display text-xl text-brand-ink uppercase mb-1">{titulo}</h2>}
      <p className="text-xs text-brand-slate mb-4">
        {intro ?? `Para ${formatInt(ventas)} ventas efectivas`}, con {p.costos.ventas_por_vendedor} ventas por vendedor, 1 supervisor cada {p.costos.supervisor_cada_vendedores} vendedores y 1 backoffice cada {p.costos.backoffice_cada_ventas} ventas.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {cuadros.map(([label, n, color, hint]) => (
          <div key={label} className="rounded-md border border-brand-border bg-white p-4 text-center" style={{ borderTop: `4px solid ${color}` }}>
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">{label}</div>
            <div className="font-display text-4xl text-brand-ink leading-tight mt-1">{formatInt(n)}</div>
            <div className="text-[10px] text-brand-slate mt-1">{hint}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-md border border-brand-border bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">Velocidad de ventas · VPH</div>
          <div className="text-[10px] text-brand-slate">{formatInt(ventas)} ventas del mes ÷ {formatInt(hc.vendedores)} vendedores = {f1(ventasVend)} ventas por vendedor</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-md border border-brand-primary/40 bg-brand-primary/5 p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider2 text-brand-primary font-bold">VPH · ventas por hora</div>
            <div className="font-display text-3xl text-brand-primary leading-tight mt-1">{f2(vph)}</div>
            <div className="text-[10px] text-brand-slate mt-1">por vendedor · {f1(ventasVend)} ÷ {formatInt(horasMes)} h</div>
          </div>
          <div className="rounded-md border border-brand-border p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">Ventas por día</div>
            <div className="font-display text-3xl text-brand-ink leading-tight mt-1">{f2(vpd)}</div>
            <div className="text-[10px] text-brand-slate mt-1">por vendedor · {f1(ventasVend)} ÷ {formatInt(diasMes)} días</div>
          </div>
          <div className="rounded-md border border-brand-border p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">Horas por venta</div>
            <div className="font-display text-3xl text-brand-ink leading-tight mt-1">{vph > 0 ? f1(1 / vph) : "—"}</div>
            <div className="text-[10px] text-brand-slate mt-1">tiempo de vendedor que cuesta una venta</div>
          </div>
          <div className="rounded-md border border-brand-border p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">Jornada</div>
            <div className="font-display text-3xl text-brand-ink leading-tight mt-1">{formatInt(horasMes)} h</div>
            <div className="text-[10px] text-brand-slate mt-1">{horasDia} h × {diasMes} días al mes</div>
          </div>
        </div>
        <FactoresVPH vph={vph} ventasVend={ventasVend} ventas={ventas} vendedores={hc.vendedores} horasMes={horasMes} />
      </div>
      {v && (
        <div className="mt-4 rounded-md border border-brand-border bg-brand-bg-soft p-4">
          <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-bold mb-2">Cuánto gana un vendedor promedio por mes</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <div className="text-[10px] text-brand-slate">Salario fijo</div>
              <div className="font-display text-xl text-brand-ink">{formatGs(v.salario_fijo)}</div>
              <div className="text-[10px] text-brand-slate">{formatGs(p.costos.salario_hora)} la hora × {formatInt(horasMes)} h</div>
            </div>
            <div>
              <div className="text-[10px] text-brand-slate">Por cada venta</div>
              <div className="font-display text-xl text-brand-primary">{formatGs(v.variable_por_venta)}</div>
              <div className="text-[10px] text-brand-slate">{formatGs(v.comision_por_venta)} de comisión{v.plus_por_venta > 0 ? ` + ${formatGs(v.plus_por_venta)} de plus` : ""}</div>
            </div>
            <div>
              <div className="text-[10px] text-brand-slate">Variable del mes</div>
              <div className="font-display text-xl text-brand-ink">{formatGs(v.comision_promedio + v.plus_promedio)}</div>
              <div className="text-[10px] text-brand-slate">{v.ventas_promedio} ventas × {formatGs(v.variable_por_venta)}</div>
            </div>
            <div>
              <div className="text-[10px] text-brand-slate">Ingreso total</div>
              <div className="font-display text-xl text-brand-ink">{formatGs(v.ingreso_promedio)}</div>
              <div className="text-[10px] text-brand-slate">fijo + variable · el variable es el {v.pct_variable_sobre_ingreso}% del total</div>
            </div>
          </div>
          <div className="mt-3 grid md:grid-cols-2 gap-2 text-[11px] text-brand-graphite">
            <div className="rounded-md border border-brand-border bg-white px-3 py-2">
              <b className="text-brand-ink">Lo que le cuesta a Voicenter cada venta en remuneración variable:</b>{" "}
              <span className="font-mono font-bold text-brand-primary">{formatGs(v.comision_con_cargas_por_venta)}</span>.
              {" "}La comisión paga IPS ({p.costos.ips_pct}%) y aguinaldo; el plus no paga cargas.
            </div>
            <div className="rounded-md border border-brand-border bg-white px-3 py-2">
              <b className="text-brand-ink">Comparado con lo que factura Claro:</b> la comisión + plus de todos los vendedores equivale al{" "}
              <span className="font-mono font-bold text-brand-primary">{v.peso_sobre_facturacion_pct}%</span> de la facturación bruta del mes
              {" "}y al <span className="font-mono font-bold">{v.peso_sobre_neto_12_pct}%</span> de lo que queda neto a 12 meses. Solo para comparar: la remuneración se carga como monto por venta, no como porcentaje.
            </div>
          </div>
        </div>
      )}
      <div className="mt-3 rounded-md border border-brand-border bg-brand-bg-soft px-3 py-2 text-[11px] text-brand-graphite grid grid-cols-2 md:grid-cols-4 gap-2">
        <div><span className="block text-[10px] text-brand-slate">Costo total de la estructura</span><b className="text-brand-ink">{formatGs(costos.total)}</b> por mes</div>
        <div><span className="block text-[10px] text-brand-slate">Por venta</span><b className="text-brand-ink">{formatGs(costos.costo_por_venta)}</b> ({formatGs(costos.total)} ÷ {formatInt(ventas)})</div>
        <div><span className="block text-[10px] text-brand-slate">Por persona</span><b className="text-brand-ink">{formatGs(Math.round(costos.total / Math.max(hc.total, 1)))}</b> ({formatInt(hc.total)} personas)</div>
        <div><span className="block text-[10px] text-brand-slate">Incluye</span>salarios, comisiones, IPS, aguinaldo, plus, logística y operativos</div>
      </div>
    </>
  );
  return sinCard ? <div>{cuerpo}</div> : <section className="card p-5">{cuerpo}</section>;
}
