"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { n } from "@/components/productividad/tipos";
import { num, type Componente, type ParametrosScoring, type ScoringSupervisor } from "./tipos";

const CYAN = "#00B2BF";

/** Medidor 0–100: el puntaje lleno sobre una pista del mismo tono, más clara. */
export function MedidorScore({ total, alto = "h-2.5" }: { total: number | null; alto?: string }) {
  return (
    <div className={`relative ${alto} w-full rounded-full overflow-hidden`} style={{ background: "rgba(0,178,191,0.15)" }}
      role="img" aria-label={total === null ? "Sin puntaje" : `Puntaje ${num(total)} de 100`}>
      {total !== null && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(0, Math.min(100, total))}%`, background: CYAN }} />}
    </div>
  );
}

/** Diferencia contra el mes anterior: flecha y signo (no solo color). */
export function Tendencia({ actual, anterior, mes }: { actual: number | null; anterior: number | null | undefined; mes?: string }) {
  if (actual === null || anterior === null || anterior === undefined) {
    return <span className="text-[11px] text-brand-mist">{mes ? `Sin puntaje en ${mes.toLowerCase()}` : "Sin mes anterior"}</span>;
  }
  const d = Math.round((actual - anterior) * 10) / 10;
  const Icono = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : Minus;
  const color = d > 0 ? "text-emerald-700" : d < 0 ? "text-brand-primary-dark" : "text-brand-slate";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${color}`}
      title={`${mes ? `${mes}: ` : "Mes anterior: "}${num(anterior)}`}>
      <Icono size={13} aria-hidden />
      {d > 0 ? "+" : ""}{num(d)}<span className="font-normal text-brand-slate ml-1">{mes ? `vs ${mes.toLowerCase().split(" ")[0]}` : ""}</span>
    </span>
  );
}

/** Puntaje compacto para tablas: número y una barra fina. Parcial = se evaluó poco peso (no comparable). */
export function ScoreCelda({ total, parcial }: { total: number | null; parcial?: boolean }) {
  if (total === null) return <span className="text-brand-mist">—</span>;
  return (
    <div className="flex items-center justify-end gap-2" title={parcial ? "Parcial: se pudo evaluar menos del 60% del puntaje (faltan datos de ventas, uso o conversación)" : undefined}>
      {parcial && <span className="text-[10px] font-semibold uppercase tracking-wider2 text-brand-mist">Parcial</span>}
      <div className="w-14 hidden sm:block"><MedidorScore total={parcial ? null : total} alto="h-1.5" /></div>
      <span className={`tabular-nums font-semibold w-9 text-right ${parcial ? "text-brand-slate" : "text-brand-ink"}`}>{num(total, 0)}</span>
    </div>
  );
}

/** Qué se midió en cada componente, en una línea. */
export function detalleComponente(c: Componente, pr?: { min_evaluables?: number; min_horas?: number }): string {
  if (c.pendiente) {
    return c.clave === "tickets" ? "Se suma con los tickets de revisión" : "Se suma con el registro de coaching";
  }
  if (c.detalle) return c.detalle;
  switch (c.clave) {
    case "pospago":
    case "gpon":
      if (c.rel === null) return c.esperado ? "Sin ventas al corte" : c.netas === null || c.netas === undefined ? "Sin nombre de vendedor o sin ventas" : "Sin objetivo cargado";
      return `${n(c.netas)} de ${num(c.esperado)} esperadas al corte (${num(c.valor, 0)}%)`;
    case "uso":
      if (c.rel === null) return `${n(c.evaluables)} línea(s) evaluable(s): hacen falta ${pr?.min_evaluables ?? 5}`;
      return `${num(c.valor)}% sin uso (${n(c.sin_uso)} de ${n(c.evaluables)})`;
    case "conversacion":
      if (c.rel === null) return `${num(c.horas)} h conectadas: hacen falta ${num(pr?.min_horas ?? 2)}`;
      return `${num(c.valor)}% en ${num(c.horas)} h conectadas${c.sobre_meta ? " · sobre la meta: revisar" : ""}`;
    case "resultado":
      return c.valor === null ? "Sin datos del equipo" : `${num(c.valor)} de 100 en ventas, uso y conversación`;
    default:
      return c.valor === null ? "Sin datos" : `${num(c.valor)}%`;
  }
}

/** Desglose: cada componente con sus puntos sobre su peso (el de los no evaluados se reparte). */
export function Desglose({ comps, pr }: { comps: Componente[]; pr?: { min_evaluables?: number; min_horas?: number } }) {
  return (
    <ul className="divide-y divide-brand-border">
      {comps.map((c) => {
        const evaluado = c.rel !== null;
        return (
          <li key={c.clave} className="py-2.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-center">
            <div className="min-w-0">
              <div className={`text-sm font-semibold ${evaluado ? "text-brand-ink" : "text-brand-slate"}`}>{c.nombre}</div>
              <div className="text-[11px] text-brand-slate truncate" title={detalleComponente(c, pr)}>{detalleComponente(c, pr)}</div>
            </div>
            <div className="text-right tabular-nums text-sm">
              {evaluado ? <><b className="text-brand-ink">{num(c.puntos)}</b><span className="text-brand-slate"> / {num(c.peso_efectivo)}</span></>
                : <span className="text-[11px] text-brand-mist">{c.pendiente ? "Pendiente" : "No se evalúa"}</span>}
            </div>
            <div className="col-span-2">
              <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: "rgba(0,178,191,0.15)" }} aria-hidden>
                {evaluado && <div className="h-full rounded-full" style={{ width: `${(c.rel ?? 0) * 100}%`, background: CYAN }} />}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Tarjeta del scoring de un supervisor (detalle de los jefes y portal). */
export function ScoringCard({ s, mesAnterior, minEvaluables }: { s: ScoringSupervisor; mesAnterior?: string; minEvaluables: number }) {
  const pr = { min_evaluables: minEvaluables, min_horas: s.parametros.min_horas_conversacion };
  const gestionPendiente = s.partes.slice(1).every((p) => p.pendiente);
  return (
    <section className="card p-5 min-w-0">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Scoring del mes</h2>
          <p className="text-xs text-brand-slate mt-0.5">
            {s.parametros.supervisor.resultado} puntos por el resultado del equipo y {100 - s.parametros.supervisor.resultado} por la gestión.
            {gestionPendiente && " Mientras no haya registros de gestión, el puntaje es el del resultado."}
          </p>
        </div>
        <div className="text-right">
          <div className="font-display text-5xl text-brand-ink leading-none">{s.total === null ? "—" : num(s.total, 0)}<span className="text-lg text-brand-slate"> / 100</span></div>
          <div className="mt-1"><Tendencia actual={s.total} anterior={s.anterior} mes={mesAnterior} /></div>
        </div>
      </div>
      <div className="mt-3"><MedidorScore total={s.total} /></div>
      <div className="grid md:grid-cols-2 gap-x-8 gap-y-2 mt-4">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate">Resultado del equipo</h3>
          <Desglose comps={s.componentes} pr={pr} />
        </div>
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate">Cómo se arma el puntaje</h3>
          <Desglose comps={s.partes} pr={pr} />
        </div>
      </div>
      <p className="text-[10px] text-brand-mist mt-3">Parámetros versión {s.parametros.version}.</p>
    </section>
  );
}

/** Cómo se calcula el scoring (lo mismo para jefes y supervisores). */
export function MetodoScoring({ p, umbral, minEvaluables }: { p: ParametrosScoring; umbral: number; minEvaluables: number }) {
  const a = p.asesor;
  return (
    <section className="card p-5">
      <h2 className="font-display text-lg uppercase text-brand-ink leading-tight">Cómo se calcula el scoring</h2>
      <div className="grid md:grid-cols-3 gap-5 mt-3 text-xs text-brand-slate leading-relaxed">
        <div>
          <div className="font-semibold text-brand-ink text-sm">Asesor</div>
          <p className="mt-1">
            Pospago {a.pospago}, uso de líneas {a.uso}, conversación {a.conversacion} y GPON {a.gpon} puntos. Pospago y GPON se comparan con
            su objetivo de referencia al corte: la parte del objetivo del equipo que le toca por los días que trabajó.
          </p>
        </div>
        <div>
          <div className="font-semibold text-brand-ink text-sm">Umbrales</div>
          <p className="mt-1">
            Uso: puntaje completo con {num(umbral)}% sin uso o menos y cero con {num(p.uso_cero)}% o más ({minEvaluables} evaluables como mínimo).
            Conversación: completo desde {num(p.conversacion.meta_min)}% y cero con {num(p.conversacion.rojo)}% o menos; más de{" "}
            {num(p.conversacion.meta_max)}% no resta, pero se marca. Lo que no tiene datos suficientes no se evalúa y su peso se reparte.
          </p>
        </div>
        <div>
          <div className="font-semibold text-brand-ink text-sm">Supervisor y operación</div>
          <p className="mt-1">
            Supervisor: {p.supervisor.resultado} puntos por el resultado del equipo (los mismos componentes contra sus objetivos) y{" "}
            {100 - p.supervisor.resultado} por su gestión: cobertura de coaching {p.supervisor.cobertura}, foco {p.supervisor.foco}, seguimientos{" "}
            {p.supervisor.seguimiento} y tickets {p.supervisor.tickets}. Operación: los componentes sobre todo el equipo. Versión {p.version}.
          </p>
        </div>
      </div>
    </section>
  );
}
