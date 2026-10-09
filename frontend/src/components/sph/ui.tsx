"use client";

import { Link2, ListChecks, UserX } from "lucide-react";
import { fechaCorta, n, pct, sumarDias } from "@/components/productividad/tipos";
import {
  NIVEL, UNIDAD, estadoVenta, fmtEstados, fmtSph,
  type BaseSph, type CoberturaDia, type KpisSph, type Nivel, type SinVendedor, type VentaSinAgente,
} from "./tipos";

export function NivelChip({ nivel, compacto }: { nivel: Nivel; compacto?: boolean }) {
  const x = NIVEL[nivel];
  return (
    <span title={x.ayuda} className={`inline-flex items-center rounded border font-semibold whitespace-nowrap ${compacto ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]"} ${x.chip}`}>
      {x.label}
    </span>
  );
}

/** Cómo se calcula: lo mismo en la lista y en el informe. */
export function MetodoSph({ minHoras = 2 }: { minHoras?: number }) {
  return (
    <section className="card p-5">
      <h2 className="font-display text-lg uppercase text-brand-ink leading-tight">Cómo se calcula</h2>
      <div className="grid md:grid-cols-3 gap-5 mt-3 text-sm text-brand-graphite">
        <div>
          <div className="font-semibold text-brand-ink">SPH de la operación</div>
          <p className="text-xs text-brand-slate mt-1 leading-relaxed">
            Ventas del día ÷ horas conectadas del equipo. Ventas = las <b>cargadas ese día</b> en la hoja de productividad de la
            planilla de Ventas Netas, finalizadas o pendientes (a confirmar, procesadas); las rechazadas y las canceladas no
            cuentan. No se usan las netas: se activan días después y pueden llegar en la planilla de otro mes. Las sesiones
            abiertas quedan fuera: ni sus horas ni sus ventas.
          </p>
        </div>
        <div>
          <div className="font-semibold text-brand-ink">SPH por asesor (estimado)</div>
          <p className="text-xs text-brand-slate mt-1 leading-relaxed">
            Ventas del vendedor vinculado ÷ horas conectadas del agente. Una venta pendiente sin POS es del vendedor de su línea
            ya activada o de su legajo; si no se sabe, cuenta solo para la operación. Entra al ranking con {minHoras} h conectadas
            o más. En una semana, un mes o un rango se suma día por día. Cada planilla trae el último estado de las ventas: con
            una posterior, recalculalo.
          </p>
        </div>
        <div>
          <div className="font-semibold text-brand-ink">Cruce de nombres</div>
          <p className="text-xs text-brand-slate mt-1 leading-relaxed">
            No hay un ID común: el agente («Apellido, Nombre») se vincula con el vendedor del POS por su nombre y un apellido.{" "}
            <b>Exacto</b>: están todas sus palabras. <b>Probable</b>: falta alguna o cambia la escritura. Con empate no se adivina.
            Gestión puede corregir o confirmar cada vínculo y queda para los próximos cálculos.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Calidad del cruce: barra de partes (agentes por nivel) con leyenda y cantidades. */
export function CruceNombres({ k, base = "ventas", onVer }: { k: KpisSph; base?: BaseSph; onVer?: (nivel: Nivel | "sin_vinculo") => void }) {
  const sinVinculo = k.agentes - k.vinculados;
  const partes: { clave: Nivel | "sin_vinculo"; label: string; valor: number; color: string }[] = [
    { clave: "exacto", label: "Exacto", valor: k.niveles.exacto ?? 0, color: NIVEL.exacto.color },
    { clave: "manual", label: "Manual", valor: k.niveles.manual ?? 0, color: NIVEL.manual.color },
    { clave: "probable", label: "Probable", valor: k.niveles.probable ?? 0, color: NIVEL.probable.color },
    { clave: "sin_vinculo", label: "Sin vínculo", valor: sinVinculo, color: "#C9CDD6" },
  ];
  const total = Math.max(k.agentes, 1);
  return (
    <section className="card p-5 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base uppercase text-brand-ink leading-tight flex items-center gap-2"><Link2 size={15} className="text-brand-slate" /> Cruce de nombres</h3>
          <p className="text-xs text-brand-slate mt-0.5">Agentes conectados vinculados con un vendedor de Ventas Netas.</p>
        </div>
        <div className="text-right">
          <div className="font-display text-3xl text-brand-ink tabular-nums leading-none">{n(k.vinculados)}<span className="text-base text-brand-slate"> / {n(k.agentes)}</span></div>
          <div className="text-[11px] text-brand-slate mt-1">agentes vinculados</div>
        </div>
      </div>
      <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-brand-bg gap-[2px]" role="img"
        aria-label={partes.map((p) => `${p.label}: ${p.valor}`).join(", ")}>
        {partes.filter((p) => p.valor > 0).map((p) => (
          <div key={p.clave} style={{ width: `${(p.valor / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.valor}`} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {partes.map((p) => (
          <li key={p.clave}>
            <button type="button" disabled={!onVer || !p.valor} onClick={() => onVer?.(p.clave)}
              className="w-full flex items-center justify-between gap-2 rounded px-1 -mx-1 enabled:hover:bg-brand-bg">
              <span className="flex items-center gap-1.5 text-brand-graphite"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />{p.label}</span>
              <b className="tabular-nums text-brand-ink">{n(p.valor)}</b>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 pt-3 border-t border-brand-border grid grid-cols-2 gap-3 text-xs">
        <div><div className="text-brand-slate">{UNIDAD[base].Varias} con asesor</div><div className="font-semibold text-brand-ink tabular-nums">{pct(k.pct_cobertura)} <span className="font-normal text-brand-slate">({n(k.ventas_vinculadas)} de {n(k.ventas_operacion)})</span></div></div>
        <div><div className="text-brand-slate">Horas con vendedor</div><div className="font-semibold text-brand-ink tabular-nums">{pct(k.pct_cobertura_horas)}</div></div>
      </div>
    </section>
  );
}

/** Días del período: cuáles cuentan (horas y ventas al corte) y por qué no cuentan los demás. */
export function FranjaDias({ desde, hasta, cobertura }: { desde: string; hasta: string; cobertura: CoberturaDia[] }) {
  const porFecha = new Map(cobertura.map((c) => [c.fecha, c]));
  const todos: string[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) todos.push(d);
  const cuentan = cobertura.filter((c) => c.horas && c.ventas).length;
  const estilo = (d: string) => {
    const c = porFecha.get(d);
    if (!c) return { cls: "bg-brand-bg border border-dashed border-brand-border", t: "todavía no pasó" };
    if (c.horas && c.ventas) return { cls: "bg-emerald-500", t: "cuenta" };
    if (c.horas) return { cls: "bg-brand-orange", t: "tiene horas, faltan las ventas al corte" };
    return { cls: "bg-brand-border", t: "sin informe de Productividad" };
  };
  return (
    <div>
      <div className="flex flex-wrap gap-[3px]" role="img" aria-label={`${cuentan} de ${todos.length} días cuentan`}>
        {todos.map((d) => {
          const e = estilo(d);
          return <span key={d} title={`${fechaCorta(d)}: ${e.t}`} className={`w-3.5 h-3.5 rounded-sm ${e.cls}`} />;
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-brand-slate">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />Cuenta</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-brand-orange" />Faltan ventas al corte</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-brand-border" />Sin Productividad</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-brand-bg border border-dashed border-brand-border" />Todavía no pasó</span>
      </div>
    </div>
  );
}

/**
 * Ventas por estado: cuentan las finalizadas y las pendientes (a confirmar, procesadas); las rechazadas y las
 * canceladas se muestran aparte porque no cuentan. Barra de partes con leyenda y cantidades (nunca solo color).
 */
export function EstadosVentas({ k, periodo }: { k: KpisSph; periodo?: boolean }) {
  const cuentan = Object.entries(k.estados).filter(([e, v]) => v > 0 && estadoVenta(e).cuenta);
  const noCuentan = Object.entries(k.estados).filter(([e, v]) => v > 0 && !estadoVenta(e).cuenta);
  const total = Math.max(k.ventas, 1);
  return (
    <section className="card p-5 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base uppercase text-brand-ink leading-tight flex items-center gap-2"><ListChecks size={15} className="text-brand-slate" /> Ventas por estado</h3>
          <p className="text-xs text-brand-slate mt-0.5">Hoja de productividad: cuentan las finalizadas y las pendientes.</p>
        </div>
        <div className="text-right">
          <div className="font-display text-3xl text-brand-ink tabular-nums leading-none">{pct(k.pct_finalizadas)}</div>
          <div className="text-[11px] text-brand-slate mt-1">ya finalizadas</div>
        </div>
      </div>
      <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-brand-bg gap-[2px]" role="img"
        aria-label={cuentan.map(([e, v]) => `${estadoVenta(e).label}: ${v}`).join(", ") || "Sin ventas"}>
        {cuentan.map(([e, v]) => (
          <div key={e} style={{ width: `${(v / total) * 100}%`, background: estadoVenta(e).color }} title={`${estadoVenta(e).label}: ${v}`} />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-xs">
        {cuentan.map(([e, v]) => (
          <li key={e} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-brand-graphite"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: estadoVenta(e).color }} />{estadoVenta(e).label}</span>
            <b className="tabular-nums text-brand-ink">{n(v)}</b>
          </li>
        ))}
        {!cuentan.length && <li className="text-brand-mist">Sin ventas {periodo ? "en el período" : "ese día"}.</li>}
      </ul>
      {noCuentan.length > 0 && (
        <div className="mt-3 pt-3 border-t border-brand-border text-xs">
          <div className="text-brand-slate mb-1.5">No cuentan como venta</div>
          <ul className="space-y-1.5">
            {noCuentan.map(([e, v]) => (
              <li key={e} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-brand-graphite"><span className="w-2.5 h-2.5 rounded-sm border" style={{ borderColor: estadoVenta(e).color }} />{estadoVenta(e).label}</span>
                <span className="tabular-nums text-brand-slate">{n(v)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Ventas de vendedores que no se vincularon con un agente conectado (ese día o en el período) y las sin vendedor. */
export function VentasSinAsesor({ ventas, sinVendedor = [], base = "ventas", onVincular, periodo }: {
  ventas: VentaSinAgente[]; sinVendedor?: SinVendedor[]; base?: BaseSph; onVincular?: (v: VentaSinAgente) => void; periodo?: boolean;
}) {
  const u = UNIDAD[base];
  const cuando = periodo ? "en el período" : "ese día";
  const sinVend = sinVendedor.reduce((a, x) => a + x.ventas, 0);
  return (
    <section className="card p-5 min-w-0">
      <h3 className="font-display text-base uppercase text-brand-ink leading-tight flex items-center gap-2"><UserX size={15} className="text-brand-slate" /> {u.Varias} sin asesor</h3>
      <p className="text-xs text-brand-slate mt-0.5">
        Vendedores con {u.varias} {cuando} que no se vincularon con un agente conectado. Cuentan en el SPH de la operación; si es un nombre distinto, vinculalo.
      </p>
      {!ventas.length ? (
        <p className="text-sm text-emerald-700 mt-4">Todas las {u.varias} {periodo ? "del período" : "del día"} con vendedor tienen asesor.</p>
      ) : (
        <ul className="mt-3 divide-y divide-brand-border border-t border-brand-border">
          {ventas.map((v) => (
            <li key={v.vendedor} className="py-2.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-brand-ink">{v.vendedor}</div>
                <div className="text-[11px] text-brand-slate">
                  {[v.subcanal, fmtEstados(v.estados), fmtEstados(v.estados, false) && `${fmtEstados(v.estados, false)} (no cuentan)`].filter(Boolean).join(" · ")}
                  {onVincular && v.vendedor !== "SIN VENDEDOR" && <> · <button type="button" onClick={() => onVincular(v)} className="font-semibold text-brand-primary hover:underline">Vincular</button></>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-display text-xl text-brand-ink tabular-nums leading-none">{n(v.ventas)}</div>
                <div className="text-[10px] text-brand-slate">{u.una}(s)</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {sinVend > 0 && (
        <div className="mt-3 pt-3 border-t border-brand-border text-xs text-brand-slate">
          <b className="text-brand-graphite">{n(sinVend)} venta(s) sin vendedor identificado</b>: se cargaron sin POS desde un legajo que carga para más
          de un vendedor y todavía no se activaron ({sinVendedor.slice(0, 4).map((x) => `${x.cargado_por} ${x.ventas}`).join(" · ")}
          {sinVendedor.length > 4 ? " y más" : ""}). Cuentan solo en el SPH de la operación.
        </div>
      )}
    </section>
  );
}

/** SPH en una celda: número y una barra fina proporcional al máximo del día. */
export function BarraSph({ valor, max }: { valor: number | null; max: number }) {
  if (valor === null) return <span className="text-brand-mist">—</span>;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="w-16 h-1.5 rounded-full bg-brand-bg overflow-hidden hidden sm:block" aria-hidden>
        <div className="h-full rounded-full bg-brand-cyan" style={{ width: `${max ? Math.min(100, (valor / max) * 100) : 0}%` }} />
      </div>
      <span className="tabular-nums font-semibold text-brand-ink w-10 text-right">{fmtSph(valor)}</span>
    </div>
  );
}
