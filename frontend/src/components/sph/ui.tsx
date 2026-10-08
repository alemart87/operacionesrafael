"use client";

import { Link2, UserX } from "lucide-react";
import { fechaCorta, n, pct, sumarDias } from "@/components/productividad/tipos";
import { NIVEL, fmtSph, type CoberturaDia, type KpisSph, type Nivel, type VentaSinAgente } from "./tipos";

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
            Netas del día ÷ horas conectadas del equipo. Netas = líneas activadas (DDI) cuya <b>fecha de venta</b> es ese día. Las
            sesiones abiertas quedan fuera: ni sus horas ni sus netas. No depende del cruce de nombres.
          </p>
        </div>
        <div>
          <div className="font-semibold text-brand-ink">SPH por asesor (estimado)</div>
          <p className="text-xs text-brand-slate mt-1 leading-relaxed">
            Netas del vendedor vinculado ÷ horas conectadas del agente. Entra al ranking con {minHoras} h conectadas o más. En una
            semana, un mes o un rango se suma día por día los días que cuentan (con horas y ventas al corte). Las netas de un día se
            siguen activando hasta dos semanas después: con un corte de ventas posterior, recalculalo.
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
export function CruceNombres({ k, onVer }: { k: KpisSph; onVer?: (nivel: Nivel | "sin_vinculo") => void }) {
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
        <div><div className="text-brand-slate">Netas con asesor</div><div className="font-semibold text-brand-ink tabular-nums">{pct(k.pct_cobertura)} <span className="font-normal text-brand-slate">({n(k.netas_vinculadas)} de {n(k.netas_operacion)})</span></div></div>
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

/** Netas de vendedores que no se vincularon con un agente conectado (ese día o en el período). */
export function VentasSinAsesor({ ventas, onVincular, periodo }: { ventas: VentaSinAgente[]; onVincular?: (v: VentaSinAgente) => void; periodo?: boolean }) {
  return (
    <section className="card p-5 min-w-0">
      <h3 className="font-display text-base uppercase text-brand-ink leading-tight flex items-center gap-2"><UserX size={15} className="text-brand-slate" /> Netas sin asesor</h3>
      <p className="text-xs text-brand-slate mt-0.5">
        Vendedores con netas {periodo ? "en el período" : "ese día"} que no se vincularon con un agente conectado. Cuentan en el SPH de la operación; si es un nombre distinto, vinculalo.
      </p>
      {!ventas.length ? (
        <p className="text-sm text-emerald-700 mt-4">Todas las netas {periodo ? "del período" : "del día"} tienen asesor.</p>
      ) : (
        <ul className="mt-3 divide-y divide-brand-border border-t border-brand-border">
          {ventas.map((v) => (
            <li key={v.vendedor} className="py-2.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-brand-ink">{v.vendedor}</div>
                <div className="text-[11px] text-brand-slate">
                  {[v.subcanal, `${n(v.cargadas)} cargada(s) ${periodo ? "en el período" : "ese día"}`].filter(Boolean).join(" · ")}
                  {onVincular && v.vendedor !== "SIN VENDEDOR" && <> · <button type="button" onClick={() => onVincular(v)} className="font-semibold text-brand-primary hover:underline">Vincular</button></>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-display text-xl text-brand-ink tabular-nums leading-none">{n(v.netas)}</div>
                <div className="text-[10px] text-brand-slate">neta(s)</div>
              </div>
            </li>
          ))}
        </ul>
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
