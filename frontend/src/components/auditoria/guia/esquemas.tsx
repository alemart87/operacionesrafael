"use client";

import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import { Fragment } from "react";
import type { Severidad } from "../tipos";
import { CASO_TESTIGO, DIAS_PFI, fmt, type ReglasAuditoria } from "./datos";
import { SevChip } from "./piezas";

const SIN_USO = "#D6336C";
const CON_USO = "#00B2BF";
const ACTIVACION = "#7B3FA0";

// ============================================================== Ventana de la PFI
/** Línea de tiempo de una venta hasta la PFI: dónde está la ventana de acción del auditor. */
export function VentanaPFI({ r }: { r: ReglasAuditoria }) {
  const d = r.dias_sin_uso_antigua;
  const eje = 75;
  const pos = (dia: number) => (dia / eje) * 100;
  const hitos: { dia: number; titulo: string; texto: string; color: string; arriba: boolean }[] = [
    { dia: 0, titulo: "Día 0 · Venta y activación", texto: "La venta entra en CARGAS y la línea se da de alta en DDI o PORTABILIDAD.", color: "#0F1116", arriba: true },
    { dia: d, titulo: `Día ${d} · Sin uso = alerta`, texto: `Sin consumo desde el día ${d}, la línea deja de ser reciente: pesa ${r.pesos.sin_uso_antigua}× en el puntaje del vendedor.`, color: "#E6332A", arriba: false },
    { dia: 30, titulo: "Mes 1 · Primera factura", texto: "Si la línea no se usa, lo más probable es que esa factura no se pague.", color: "#F39200", arriba: true },
    { dia: DIAS_PFI, titulo: `~Día ${DIAS_PFI} · Suspensión por PFI`, texto: "Claro suspende la línea por primera factura impaga y descuenta la comisión de esa venta en la liquidación.", color: "#B81F18", arriba: false },
  ];
  const alinear = (p: number) => (p < 12 ? "translate-x-0" : p > 88 ? "-translate-x-full" : "-translate-x-1/2");
  return (
    <div className="card p-5">
      {/* Escritorio: eje horizontal */}
      <div className="hidden lg:block relative h-[270px]" role="img" aria-label="Línea de tiempo de una venta hasta la suspensión por PFI">
        <div className="absolute left-0 right-0 top-[108px] h-9 rounded-md overflow-hidden flex text-[11px] font-bold uppercase tracking-wider2">
          <div className="h-full bg-[#D1D5DB] text-brand-graphite flex items-center justify-center" style={{ width: `${pos(d)}%` }} title="Uso esperable" />
          <div className="h-full text-white flex items-center justify-center px-3 whitespace-nowrap" style={{ width: `${pos(DIAS_PFI) - pos(d)}%`, background: "linear-gradient(90deg,#F39200,#E6332A 70%,#B81F18)" }}>
            Ventana del auditor · verificar, contactar, retener
          </div>
          <div className="h-full bg-brand-ink text-white flex items-center justify-center" style={{ width: `${100 - pos(DIAS_PFI)}%` }}>PFI</div>
        </div>
        {hitos.map((h) => {
          const p = pos(h.dia);
          return (
            <div key={h.dia} className="absolute" style={{ left: `${p}%`, top: 0, bottom: 0 }}>
              <div className="absolute w-0.5" style={{ background: h.color, left: -1, top: h.arriba ? 74 : 144, height: 34 }} />
              <div className="absolute w-3 h-3 rounded-full ring-2 ring-white" style={{ background: h.color, left: -6, top: h.arriba ? 68 : 172 }} />
              <div className={`absolute w-[230px] ${alinear(p)} ${h.arriba ? "top-0" : "top-[188px]"}`}>
                <div className="text-[12px] font-bold text-brand-ink leading-tight" style={{ color: h.color }}>{h.titulo}</div>
                <div className="text-[11.5px] text-brand-slate leading-snug mt-0.5">{h.texto}</div>
              </div>
            </div>
          );
        })}
      </div>
      {/* Móvil: lista vertical */}
      <ol className="lg:hidden relative border-l-2 border-brand-border ml-2 space-y-4">
        {hitos.map((h) => (
          <li key={h.dia} className="ml-4">
            <span className="absolute -left-[7px] w-3 h-3 rounded-full" style={{ background: h.color }} />
            <div className="text-sm font-bold" style={{ color: h.color }}>{h.titulo}</div>
            <div className="text-xs text-brand-slate">{h.texto}</div>
          </li>
        ))}
        <li className="ml-4 text-xs font-semibold text-brand-primary">Entre el día {d} y el día {DIAS_PFI}: ventana del auditor.</li>
      </ol>
    </div>
  );
}

// ============================================================== Recorrido de una venta
type RiesgoChip = { texto: string; s: Severidad; ancla: string };

export function RecorridoVenta({ r }: { r: ReglasAuditoria }) {
  const d = r.dias_sin_uso_antigua;
  const pd = r.llamativos.pendientes_dias;
  const etapas: { titulo: string; fuente: string; texto: string; riesgos: RiesgoChip[] }[] = [
    {
      titulo: "Carga", fuente: "Hoja CARGAS",
      texto: "El vendedor carga la venta y Claro le asigna un riesgo: A alto, M medio o B bajo. Pasa por a confirmar, procesado y finalizada, o se rechaza.",
      riesgos: [{ texto: `Pendiente más de ${pd} días`, s: "baja", ancla: "alertas" }, { texto: "Riesgo A", s: "media", ancla: "riesgo-carga" }],
    },
    {
      titulo: "Activación", fuente: "Hojas DDI y PORTABILIDAD",
      texto: "La línea se da de alta. DDI trae las altas del período; PORTABILIDAD, las líneas que vienen de otra operadora (TIGO, PERS).",
      riesgos: [{ texto: "Finalizada sin activar", s: "media", ancla: "alertas" }, { texto: "Entrega en ráfaga", s: "media", ancla: "patrones" }],
    },
    {
      titulo: "Portación", fuente: "Campo PORTACION_TIPO",
      texto: "En Sali Hablando el cliente sale con la línea activa y la portación se completa después, muchas veces en el mes siguiente.",
      riesgos: [{ texto: "Sali Hablando sin uso", s: "alta", ancla: "sali-hablando" }],
    },
    {
      titulo: "Uso", fuente: "Campo CONSUMO_DATOS",
      texto: `¿La línea consume datos? Con menos de ${d} días queda en espera de uso y no es alerta; sin uso con ${d} días o más es la señal más directa de una PFI.`,
      riesgos: [{ texto: `Sin uso ${d}+ días`, s: "alta", ancla: "sin-uso" }, { texto: "Lote sin uso", s: "media", ancla: "patrones" }],
    },
    {
      titulo: "Neta y comisión", fuente: "Corte publicado",
      texto: "Las ventas netas del corte publicado del mes son la base de la comisión. Vale un corte por mes: el publicado.",
      riesgos: [{ texto: "Suspendida al cierre", s: "baja", ancla: "alertas" }, { texto: "Comisión sobre sin uso", s: "alta", ancla: "alertas" }],
    },
  ];
  return (
    <ol className="grid sm:grid-cols-2 lg:grid-cols-5 print:grid-cols-5 gap-3">
      {etapas.map((e, i) => (
        <li key={e.titulo} className="relative card p-4 flex flex-col border-t-[3px] border-t-brand-ink">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 shrink-0 rounded-full bg-brand-ink text-white font-display text-base grid place-items-center">{i + 1}</span>
            <span className="text-[10px] uppercase tracking-wider2 text-brand-slate leading-tight">{e.fuente}</span>
          </div>
          <h4 className="font-display text-2xl uppercase text-brand-ink mt-2 leading-none">{e.titulo}</h4>
          <p className="text-[13px] text-brand-graphite leading-snug mt-1.5">{e.texto}</p>
          <div className="mt-auto pt-3 flex flex-wrap gap-1">
            {e.riesgos.map((x) => <a key={x.texto} href={`#${x.ancla}`} className="hover:opacity-80"><SevChip s={x.s}>{x.texto}</SevChip></a>)}
          </div>
          {i < etapas.length - 1 && (
            <span className="hidden lg:grid print:grid absolute -right-[14px] top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-brand-primary text-white place-items-center shadow-soft" aria-hidden>
              <ChevronRight size={16} />
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

// ============================================================== Mapa de riesgos
const NIVELES_Y = ["Alto", "Medio", "Bajo"] as const;
const NIVELES_X = ["Baja", "Media", "Alta"] as const;
const FONDO = ["#F6F7FB", "#EEF8F9", "#FFF3E0", "#FDE4E1", "#F9CFCB"];

export function MatrizRiesgos({ r }: { r: ReglasAuditoria }) {
  const d = r.dias_sin_uso_antigua;
  const pd = r.llamativos.pendientes_dias;
  // [impacto 0=alto..2=bajo][probabilidad 0=baja..2=alta]
  const celdas: [string, string][][][] = [
    [[], [["Vendedor en nivel crítico", "semaforo"]], [["Sali Hablando sin uso", "sali-hablando"], [`Sin uso con ${d}+ días`, "sin-uso"]]],
    [[["Finalizadas sin activar", "alertas"]], [["Sin uso concentradas en pocos vendedores", "alertas"], ["Entrega en ráfaga", "patrones"]], [["Sin uso con riesgo A en la carga", "riesgo-carga"]]],
    [[], [[`Pendientes de más de ${pd} días`, "alertas"], ["Interior con más sin uso", "sin-uso"]], [["Suspendidas al cierre", "alertas"]]],
  ];
  return (
    <div className="card p-5 overflow-x-auto">
      <div className="grid grid-cols-[28px_64px_repeat(3,minmax(0,1fr))] gap-1.5 min-w-[620px]">
        <div className="row-span-3 flex items-center justify-center">
          <span className="text-[10px] font-bold uppercase tracking-wider2 text-brand-slate whitespace-nowrap -rotate-90">Impacto en la comisión</span>
        </div>
        {celdas.map((fila, yi) => (
          <FilaMatriz key={yi} etiqueta={NIVELES_Y[yi]} fila={fila} yi={yi} />
        ))}
        <div />
        <div />
        {NIVELES_X.map((x) => <div key={x} className="text-center text-[11px] font-semibold text-brand-slate pt-1">{x}</div>)}
        <div />
        <div />
        <div className="col-span-3 text-center text-[10px] font-bold uppercase tracking-wider2 text-brand-slate">Probabilidad de pérdida (PFI o comisión no cobrada)</div>
      </div>
    </div>
  );
}

function FilaMatriz({ etiqueta, fila, yi }: { etiqueta: string; fila: [string, string][][]; yi: number }) {
  return (
    <>
      <div className="flex items-center justify-end pr-2 text-[11px] font-semibold text-brand-slate">{etiqueta}</div>
      {fila.map((items, xi) => {
        const score = (2 - yi) + xi;
        return (
          <div key={xi} className="rounded-md min-h-[92px] p-2 flex flex-wrap content-start gap-1.5 border border-black/5" style={{ background: FONDO[score] }}>
            {items.map(([t, ancla]) => (
              <a key={t} href={`#${ancla}`} className={`rounded px-2 py-1 text-[12px] font-semibold leading-tight shadow-sm hover:underline ${score >= 4 ? "bg-brand-primary text-white" : score === 3 ? "bg-white text-brand-primary-dark" : "bg-white text-brand-graphite"}`}>{t}</a>
            ))}
          </div>
        );
      })}
    </>
  );
}

// ============================================================== Sali Hablando: línea de tiempo (caso testigo)
export function LineaTiempoSH() {
  const act = CASO_TESTIGO.sali.activacion;
  const por = CASO_TESTIGO.sali.portacion;
  const dias = [...act.map(([dia, v]) => ({ dia, act: v, su: 0, cu: 0 })), ...por.map(([dia, su, cu]) => ({ dia, act: 0, su, cu }))];
  const x0 = 56, fin = 984, w = (fin - x0) / dias.length, base = 290, alto = 150, max = 68;
  const h = (v: number) => (v / max) * alto;
  const xCorte = x0 + act.length * w;
  const centro = (i: number) => x0 + i * w + w / 2;
  const iPico = act.findIndex(([, v]) => v === Math.max(...act.map(([, x]) => x)));
  const iPorta = act.length; // 1/9
  return (
    <div className="card p-4 overflow-x-auto">
      <svg viewBox="0 0 1000 334" className="w-full min-w-[680px] h-auto" role="img" aria-label="Sali Hablando: activación en agosto y portación en septiembre (caso testigo)">
        <rect x={x0} y={8} width={xCorte - x0} height={base - 8} fill={ACTIVACION} opacity="0.05" />
        <rect x={xCorte} y={8} width={fin - xCorte} height={base - 8} fill={SIN_USO} opacity="0.04" />
        <text x={x0 + 8} y={26} fontSize="12" fontWeight="700" fill={ACTIVACION} letterSpacing="1">AGOSTO · ACTIVACIÓN</text>
        <text x={x0 + 8} y={41} fontSize="11" fill="#5B6275">mes anterior</text>
        <text x={xCorte + 10} y={26} fontSize="12" fontWeight="700" fill="#B81F18" letterSpacing="1">SEPTIEMBRE · PORTACIÓN EFECTIVA</text>
        <text x={xCorte + 10} y={41} fontSize="11" fill="#5B6275">mes auditado: el sistema la cuenta por la fecha de portación</text>
        <line x1={xCorte} y1={8} x2={xCorte} y2={base + 22} stroke="#0F1116" strokeWidth="1.5" strokeDasharray="5 4" />
        {[0, 20, 40, 60].map((v) => (
          <g key={v}>
            <line x1={x0} x2={fin} y1={base - h(v)} y2={base - h(v)} stroke="#E5E7EB" />
            <text x={x0 - 8} y={base - h(v) + 4} fontSize="10" textAnchor="end" fill="#9CA3AF">{v}</text>
          </g>
        ))}
        {dias.map((dd, i) => {
          const bw = w * 0.64, x = x0 + i * w + (w - bw) / 2;
          const dia = Number(dd.dia.slice(8, 10));
          const total = dd.act + dd.su + dd.cu;
          return (
            <g key={dd.dia}>
              {dd.act > 0 && <rect x={x} y={base - h(dd.act)} width={bw} height={h(dd.act)} rx="2" fill={ACTIVACION} />}
              {dd.su > 0 && <rect x={x} y={base - h(dd.su)} width={bw} height={h(dd.su)} rx="2" fill={SIN_USO} />}
              {dd.cu > 0 && <rect x={x} y={base - h(dd.su) - Math.max(h(dd.cu), 3)} width={bw} height={Math.max(h(dd.cu), 3)} rx="1" fill={CON_USO} />}
              {total > 0 && <text x={x + bw / 2} y={base - Math.max(h(total), 3) - 5} fontSize="11" fontWeight="700" textAnchor="middle" fill="#0F1116">{total}</text>}
              <text x={x + bw / 2} y={base + 15} fontSize="10" textAnchor="middle" fill={dia === 1 || i === 0 ? "#0F1116" : "#9CA3AF"} fontWeight={dia === 1 ? 700 : 400}>{dia}</text>
            </g>
          );
        })}
        {/* Anotaciones en su propia franja, con guía hasta la barra */}
        <line x1={centro(iPico)} y1={98} x2={centro(iPico)} y2={base - h(68) - 18} stroke={ACTIVACION} strokeWidth="1.2" />
        <text x={centro(iPico) + 6} y={76} fontSize="12" fontWeight="700" fill={ACTIVACION} textAnchor="end">68 activadas el sábado 29/08</text>
        <text x={centro(iPico) + 6} y={91} fontSize="11" fill="#5B6275" textAnchor="end">60% del total en un solo día</text>
        <line x1={centro(iPorta)} y1={98} x2={centro(iPorta)} y2={base - h(62) - 18} stroke="#B81F18" strokeWidth="1.2" />
        <text x={centro(iPorta) - 6} y={76} fontSize="12" fontWeight="700" fill="#B81F18">62 portadas el 1/9: ninguna con uso</text>
        <text x={centro(iPorta) - 6} y={91} fontSize="11" fill="#5B6275">109 de las 113 del mes sin consumo (96,5%)</text>
        <g transform={`translate(${x0}, 326)`}>
          {[[ACTIVACION, "Activación (agosto)"], [SIN_USO, "Portada sin uso"], [CON_USO, "Portada con uso"]].map(([c, t], i) => (
            <g key={t} transform={`translate(${i * 180}, 0)`}>
              <rect width="12" height="12" y="-10" rx="2" fill={c} />
              <text x="18" fontSize="12" fill="#2A2F3A">{t}</text>
            </g>
          ))}
          <text x={fin - x0} fontSize="11" fill="#5B6275" textAnchor="end">Caso testigo · corte al {CASO_TESTIGO.corte}</text>
        </g>
      </svg>
    </div>
  );
}

// ============================================================== Días desde la activación: en espera vs sin uso
export function RelojUso({ r }: { r: ReglasAuditoria }) {
  const d = r.dias_sin_uso_antigua;
  const cajas = Array.from({ length: d + 5 }, (_, i) => i);
  return (
    <div className="card p-5">
      <div className="text-[11px] font-bold uppercase tracking-wider2 text-brand-slate mb-2">Días desde la activación de una línea sin uso</div>
      <div className="flex gap-1">
        {cajas.map((i) => (
          <div key={i} className="flex-1 min-w-0">
            <div className={`h-12 rounded-md grid place-items-center font-display text-xl ${i < d ? "bg-[#E5E7EB] text-brand-graphite" : "text-white"}`}
              style={i >= d ? { background: `rgba(214,51,108,${Math.min(0.55 + (i - d) * 0.1, 1)})` } : undefined}>
              {i === cajas.length - 1 ? `${i}+` : i}
            </div>
          </div>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-3 mt-3 text-sm">
        <div className="rounded-md bg-brand-bg p-3">
          <div className="font-bold text-brand-ink">◷ En espera de uso · 0 a {d - 1} días</div>
          <p className="text-brand-slate text-[13px] leading-snug mt-0.5">Todavía no tuvieron tiempo de usarse. <b>No son alerta</b>: no cuentan como sin uso, no suman puntos ni cambian el nivel del vendedor. Se marcan “En espera” y se evalúan en el corte siguiente.</p>
        </div>
        <div className="rounded-md p-3" style={{ background: "rgba(214,51,108,0.08)" }}>
          <div className="font-bold" style={{ color: "#B0204F" }}>Sin uso · {d} días o más</div>
          <p className="text-brand-graphite text-[13px] leading-snug mt-0.5">Alerta PFI. Suman {r.pesos.sin_uso_antigua} puntos por línea. Con {r.nivel_atencion.sin_uso_antiguas} el vendedor pasa a alerta media; es crítico si superan el {fmt(r.umbral_sin_uso_critico)}% de sus líneas.</p>
        </div>
      </div>
    </div>
  );
}

// ============================================================== Riesgo de la carga × uso
export function RiesgoCargaUso() {
  const lectura: Record<string, [string, string]> = {
    A: ["Riesgo mitigado: la validación funcionó.", "La alerta se cumplió. Prioridad de verificación y retención de comisión."],
    M: ["Lo esperable.", "Revisar si se concentra en pocos vendedores o en una zona."],
    B: ["Lo esperable.", "Atípico: revisar la carga, el plan y el cliente."],
  };
  const color: Record<string, string> = { A: "#E6332A", M: "#F39200", B: "#00B2BF" };
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[88px_1fr_1fr_minmax(150px,0.8fr)] text-[10px] font-bold uppercase tracking-wider2 text-brand-slate bg-brand-bg border-b border-brand-border">
        <div className="p-2.5">Riesgo</div><div className="p-2.5">Con uso</div><div className="p-2.5">Sin uso</div><div className="p-2.5">Caso testigo · % sin uso</div>
      </div>
      {CASO_TESTIGO.riesgo.map((x) => (
        <div key={x.r} className="grid grid-cols-[88px_1fr_1fr_minmax(150px,0.8fr)] border-b border-brand-border last:border-0 text-sm">
          <div className="p-3 flex items-center gap-2">
            <span className="w-8 h-8 rounded-md grid place-items-center font-display text-xl text-white" style={{ background: color[x.r] }}>{x.r}</span>
            <span className="text-[11px] text-brand-slate">{x.label}</span>
          </div>
          <div className="p-3 text-brand-graphite leading-snug border-l border-brand-border">{lectura[x.r][0]}</div>
          <div className={`p-3 leading-snug border-l border-brand-border ${x.r === "A" ? "bg-brand-primary-light/60 font-semibold text-brand-primary-dark" : "text-brand-graphite"}`}>{lectura[x.r][1]}</div>
          <div className="p-3 border-l border-brand-border">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2.5 rounded-full bg-brand-bg overflow-hidden"><div className="h-full rounded-full" style={{ width: `${x.pct * 2.5}%`, background: SIN_USO }} /></div>
              <b className="tabular-nums text-brand-ink">{fmt(x.pct)}%</b>
            </div>
            <div className="text-[11px] text-brand-slate mt-0.5">{x.sin_uso} de {x.sin_uso + x.con_uso} finalizadas Pospago</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================== Semáforo del vendedor
export function SemaforoVendedor({ r }: { r: ReglasAuditoria }) {
  const d = r.dias_sin_uso_antigua, m = r.min_lineas_alerta, a = r.nivel_atencion;
  const plural = (n: number, s: string, p: string) => (n === 1 ? s : p);
  const niveles: { nombre: string; color: string; fondo: string; lema: string; reglas: string[] }[] = [
    {
      nombre: "Crítico", color: "#E6332A", fondo: "bg-brand-primary-light/50", lema: "Una sola regla:",
      reglas: [
        `Más de ${fmt(r.umbral_sin_uso_critico)}% de sus líneas Pospago sin uso con ${d}+ días de activadas`,
        `Con ${m} o más líneas evaluables; las en espera de uso no cuentan`,
      ],
    },
    {
      nombre: "Alerta media", color: "#F39200", fondo: "bg-brand-orange/10", lema: "Sin ser crítico, alcanza con una:",
      reglas: [
        `${a.sin_uso_antiguas} o más sin uso con ${d}+ días`,
        `${a.sali_sin_uso} o más Sali Hablando sin uso`,
        `${a.suspendidas} o más ${plural(a.suspendidas, "suspendida", "suspendidas")} al cierre`,
        `${a.sin_uso_riesgo_A} o más sin uso con riesgo A en la carga`,
        `Más de ${fmt(r.umbral_sin_uso_atencion)}% sin uso, con ${m} o más líneas`,
      ],
    },
    {
      nombre: "Normal", color: "#00B2BF", fondo: "bg-brand-cyan/5", lema: "Ninguna de las anteriores.",
      reglas: ["Puede tener señales informativas en su ficha: miralas igual si vende mucho."],
    },
  ];
  return (
    <div className="grid md:grid-cols-3 gap-3">
      {niveles.map((nv) => (
        <div key={nv.nombre} className={`card p-4 ${nv.fondo}`}>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full shadow-inner ring-4 ring-white" style={{ background: nv.color, boxShadow: `0 0 18px ${nv.color}66` }} />
            <div className="font-display text-2xl uppercase text-brand-ink leading-none">{nv.nombre}</div>
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wider2 text-brand-slate mt-3 mb-1">{nv.lema}</div>
          <ul className="space-y-1">
            {nv.reglas.map((t) => <li key={t} className="text-[13px] text-brand-graphite leading-snug flex gap-1.5"><span style={{ color: nv.color }} aria-hidden>■</span>{t}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ============================================================== Puntaje de riesgo
export function Puntaje({ r }: { r: ReglasAuditoria }) {
  const p = r.pesos, d = r.dias_sin_uso_antigua;
  const terminos: [string, string][] = [
    [`Sin uso con ${d}+ días`, `× ${p.sin_uso_antigua}`],
    ["Sali Hablando sin uso", `× ${p.sali_sin_uso}`],
    ["Suspendida al cierre", `× ${p.suspendida}`],
    ["Sin uso con riesgo A", `× ${p.sin_uso_riesgo_A}`],
    ["Uso bajo el umbral", `+ ${p.alerta_uso}`],
  ];
  const ej = { antiguas: 10, sali: 6, riesgoA: 3 };
  const partes = [ej.antiguas * p.sin_uso_antigua, ej.sali * p.sali_sin_uso, ej.riesgoA * p.sin_uso_riesgo_A, p.alerta_uso];
  const total = partes.reduce((s, x) => s + x, 0);
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-stretch gap-2">
        {terminos.map(([t, w], i) => (
          <div key={t} className="flex items-center gap-2">
            {i > 0 && <span className="font-display text-2xl text-brand-mist" aria-hidden>+</span>}
            <div className="rounded-md border border-brand-border bg-brand-bg px-3 py-2 text-center">
              <div className="text-[12px] text-brand-graphite leading-tight">{t}</div>
              <div className="font-display text-2xl text-brand-primary leading-none mt-0.5">{w}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-md bg-brand-ink text-white p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[11px] font-bold uppercase tracking-wider2 text-white/60">Ejemplo</span>
        <span className="text-sm text-white/90">{ej.antiguas} sin uso con {d}+ días, {ej.sali} Sali Hablando sin uso, {ej.riesgoA} sin uso con riesgo A y uso bajo el umbral</span>
        <span className="font-display text-2xl whitespace-nowrap">{partes.join(" + ")} = <span className="text-brand-primary">{total} puntos</span></span>
      </div>
    </div>
  );
}

// ============================================================== Circuito del informe
export function CircuitoInforme() {
  const estados: { nombre: string; cls: string; texto: string }[] = [
    { nombre: "Borrador", cls: "border-t-brand-cyan", texto: "El auditor arma el informe: hallazgos, gráficos y redacción. Se puede eliminar." },
    { nombre: "En revisión", cls: "border-t-brand-primary", texto: "La coordinación lo revisa. Se edita todo y puede volver a borrador." },
    { nombre: "Cerrado", cls: "border-t-emerald-600", texto: "Emitido. Redacción y hallazgos quedan fijos; el seguimiento sigue." },
    { nombre: "Archivado", cls: "border-t-brand-mist", texto: "Seguimiento terminado. Solo lectura; se puede desarchivar." },
  ];
  const ida = ["Enviar a revisión", "Cerrar y emitir", "Archivar"];
  const vuelta = ["Volver a borrador", "Reabrir", "Desarchivar"];
  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] print:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2">
        {estados.map((e, i) => (
          <Fragment key={e.nombre}>
            <div className={`card p-4 border-t-4 ${e.cls}`}>
              <div className="font-display text-2xl uppercase text-brand-ink leading-none">{e.nombre}</div>
              <p className="text-[13px] text-brand-graphite leading-snug mt-1.5">{e.texto}</p>
            </div>
            {i < estados.length - 1 && (
              <div className="flex lg:flex-col print:flex-col items-center justify-center gap-x-4 gap-y-1 text-[10.5px] font-semibold text-center px-1">
                <span className="inline-flex items-center gap-1 text-brand-primary">{ida[i]}<ArrowRight size={13} /></span>
                <span className="inline-flex items-center gap-1 text-brand-slate"><ArrowLeft size={13} />{vuelta[i]}</span>
              </div>
            )}
          </Fragment>
        ))}
      </div>
      <div className="card p-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-[11px] font-bold uppercase tracking-wider2 text-brand-slate mr-2">Cada hallazgo</span>
        <SevChip s="alta">Abierto</SevChip><ArrowRight size={14} className="text-brand-mist" />
        <SevChip s="media">En seguimiento</SevChip><ArrowRight size={14} className="text-brand-mist" />
        <span className="inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border-emerald-200">Resuelto</span>
        <span className="text-brand-mist">o</span>
        <SevChip s="info">Descartado (con nota, nunca se borra)</SevChip>
      </div>
    </div>
  );
}
