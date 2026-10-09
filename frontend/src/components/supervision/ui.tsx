"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, Headset, ShoppingBag, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { fechaLarga, n, nombreMes } from "@/components/productividad/tipos";
import { apiFetch } from "@/lib/api";
import {
  CRUCE, ESTADO, dm, mesActual, num, sumarMeses,
  type Calendario, type Cruce, type DetalleSupervisor, type EstadoObjetivo, type FuenteVentas,
  type LineasAsesor, type ParametrosSup, type Proyeccion, type Uso,
} from "./tipos";

const CYAN = "#00B2BF";

// ------------------------------------------------------------------ mes
/** Mes con flechas: del más viejo con datos al siguiente (para armar equipos con anticipación). */
export function SelectorMes({ periodo, onChange, max }: { periodo: string; onChange: (p: string) => void; max?: string }) {
  const actual = mesActual();
  const tope = max ?? sumarMeses(actual, 1);
  return (
    <div className="inline-flex items-stretch rounded-md border border-brand-border bg-white shadow-soft overflow-hidden" role="group" aria-label="Mes">
      <button type="button" onClick={() => onChange(sumarMeses(periodo, -1))} aria-label="Mes anterior"
        className="px-2.5 text-brand-slate hover:bg-brand-bg hover:text-brand-ink">
        <ChevronLeft size={16} />
      </button>
      <div className="px-3 py-2 text-sm font-semibold text-brand-ink min-w-[136px] text-center tabular-nums" aria-live="polite">
        {nombreMes(periodo)}
      </div>
      <button type="button" onClick={() => onChange(sumarMeses(periodo, 1))} disabled={periodo >= tope} aria-label="Mes siguiente"
        className="px-2.5 text-brand-slate hover:bg-brand-bg hover:text-brand-ink disabled:opacity-30 disabled:hover:bg-white">
        <ChevronRight size={16} />
      </button>
      {periodo !== actual && (
        <button type="button" onClick={() => onChange(actual)}
          className="border-l border-brand-border px-3 text-xs font-semibold text-brand-primary hover:bg-brand-primary-light">
          Este mes
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ chips
export function EstadoChip({ estado, provisoria, compacto }: { estado: EstadoObjetivo; provisoria?: boolean; compacto?: boolean }) {
  const e = ESTADO[estado];
  return (
    <span title={provisoria ? `${e.ayuda} Provisoria: todavía hay muy pocos días hábiles.` : e.ayuda}
      className={`inline-flex items-center gap-1.5 rounded border font-semibold whitespace-nowrap ${compacto ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]"} ${e.chip}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: e.color }} aria-hidden />
      {e.label}{provisoria && <span className="font-normal opacity-80">· provisoria</span>}
    </span>
  );
}

export function CruceChip({ cruce }: { cruce: Cruce }) {
  const c = CRUCE[cruce];
  return (
    <span title={c.ayuda} className={`inline-flex items-center rounded border px-1.5 py-0 text-[10px] font-semibold whitespace-nowrap ${c.chip}`}>
      {c.label}
    </span>
  );
}

export function CriticoBadge({ critico, enAlerta }: { critico: boolean; enAlerta?: number }) {
  if (!critico) return <span className="badge-success">Sin alertas</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded bg-brand-primary text-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider2"
      title="Al menos un asesor del equipo con más del 10% de sus líneas Pospago sin uso">
      <AlertTriangle size={11} aria-hidden /> Crítico{enAlerta ? ` · ${enAlerta}` : ""}
    </span>
  );
}

/** Nombre del operador con sus dos nombres de origen (llamadas y ventas). */
export function Identidades({ agente, vendedor, subcanal }: { agente: string | null; vendedor: string | null; subcanal?: string | null }) {
  return (
    <div className="text-[11px] text-brand-slate flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
      <span className="inline-flex items-center gap-1" title="Nombre en la plataforma de llamadas (Productividad)">
        <Headset size={11} aria-hidden className={agente ? "text-brand-slate" : "text-brand-mist"} />
        {agente ?? <span className="text-brand-mist">sin llamadas</span>}
      </span>
      <span className="inline-flex items-center gap-1" title="Vendedor en Ventas Netas (POS)">
        <ShoppingBag size={11} aria-hidden className={vendedor ? "text-brand-slate" : "text-brand-mist"} />
        {vendedor ?? <span className="text-brand-mist">sin ventas</span>}
        {vendedor && subcanal && <span className="text-brand-mist">· {subcanal}</span>}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ fuente
export function FuenteDatos({ ventas, cal }: { ventas: FuenteVentas | null; cal: Calendario }) {
  if (!ventas) {
    return (
      <p className="text-xs text-brand-slate">
        Todavía no hay informe de Ventas Netas de este mes: sin ventas no hay avance ni proyección.
      </p>
    );
  }
  return (
    <p className="text-xs text-brand-slate flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>
        Ventas Netas al corte del <b className="text-brand-ink">{dm(ventas.fecha_dato)}</b>
        {cal.cerrado ? " · mes cerrado" : ` · ${num(cal.transcurridos)} de ${num(cal.total)} días hábiles`}
      </span>
      {ventas.provisorio
        ? <span className="badge-orange" title="El informe del mes todavía no está publicado: se usa el borrador más nuevo">Borrador · provisorio</span>
        : <span className="badge-success">Publicado</span>}
    </p>
  );
}

// ------------------------------------------------------------------ avance contra el objetivo
function escala(p: Proyeccion): number {
  return Math.max(p.objetivo ?? 0, p.proyeccion ?? 0, p.vendido ?? 0, 1);
}

/** Barra: lo vendido (lleno), hasta dónde llega al cierre (claro) y la marca del objetivo. */
function BarraAvance({ p, alto = "h-3", etiqueta }: { p: Proyeccion; alto?: string; etiqueta: string }) {
  const max = escala(p);
  const w = (v: number | null) => `${Math.min(100, ((v ?? 0) / max) * 100)}%`;
  return (
    <div className={`relative ${alto} w-full rounded-full bg-brand-bg overflow-hidden`} role="img" aria-label={etiqueta}>
      {p.proyeccion !== null && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: w(p.proyeccion), background: CYAN, opacity: 0.22 }} />}
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: w(p.vendido), background: CYAN }} />
      {p.objetivo !== null && (
        <div className="absolute inset-y-0 w-[2px] bg-brand-ink" style={{ left: `calc(${w(p.objetivo)} - 2px)` }} aria-hidden />
      )}
    </div>
  );
}

function etiquetaBarra(titulo: string, p: Proyeccion) {
  return `${titulo}: ${p.vendido ?? 0} vendidas${p.objetivo ? ` de un objetivo de ${p.objetivo}` : ""}${p.proyeccion !== null ? `; proyección al cierre ${Math.round(p.proyeccion)}` : ""}`;
}

export function AvanceObjetivo({ titulo, p, cal, unidad = "netas" }: { titulo: string; p: Proyeccion; cal: Calendario; unidad?: string }) {
  const sinDatos = p.vendido === null;
  return (
    <section className="card p-5 min-w-0 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg uppercase text-brand-ink leading-tight">{titulo}</h3>
        <EstadoChip estado={p.estado} provisoria={p.provisoria} />
      </div>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="font-display text-4xl text-brand-ink tabular-nums leading-none">
          {sinDatos ? "—" : n(p.vendido)}
          {p.objetivo !== null && <span className="text-xl text-brand-slate"> / {n(p.objetivo)}</span>}
          <span className="ml-1.5 text-xs font-sans font-normal normal-case text-brand-slate">{unidad}</span>
        </div>
        {p.pct_logro !== null && <div className="text-sm text-brand-slate tabular-nums"><b className="text-brand-ink">{num(p.pct_logro, 0)}%</b> del objetivo</div>}
      </div>
      {!sinDatos && <BarraAvance p={p} etiqueta={etiquetaBarra(titulo, p)} />}
      <dl className="grid grid-cols-3 gap-3 pt-3 border-t border-brand-border text-xs">
        <div>
          <dt className="text-brand-slate">Proyección al cierre</dt>
          <dd className="font-semibold text-brand-ink tabular-nums text-sm mt-0.5">
            {p.proyeccion === null ? "—" : n(Math.round(p.proyeccion))}
            {p.pct_proyeccion !== null && <span className="font-normal text-brand-slate"> · {num(p.pct_proyeccion, 0)}%</span>}
          </dd>
        </div>
        <div>
          <dt className="text-brand-slate">{cal.cerrado ? "Faltaron" : "Faltan"}</dt>
          <dd className="font-semibold text-brand-ink tabular-nums text-sm mt-0.5">{p.faltan === null ? "—" : n(p.faltan)}</dd>
        </div>
        <div>
          <dt className="text-brand-slate">Ritmo necesario</dt>
          <dd className="font-semibold text-brand-ink tabular-nums text-sm mt-0.5">
            {p.ritmo_necesario === null ? "—" : num(p.ritmo_necesario)}
            {p.ritmo_necesario !== null && <span className="font-normal text-brand-slate"> por día hábil</span>}
          </dd>
        </div>
      </dl>
      {p.objetivo === null && <p className="text-[11px] text-brand-slate">Sin objetivo cargado: se muestra lo vendido y la proyección.</p>}
      {p.esperado_al_corte !== null && !cal.cerrado && (
        <p className="text-[11px] text-brand-slate">
          Al ritmo del objetivo, al corte tendría que llevar <b className="text-brand-ink tabular-nums">{num(p.esperado_al_corte, 0)}</b>.
        </p>
      )}
    </section>
  );
}

/** Avance en una celda de tabla: «vendido / objetivo», barra y % proyectado. */
export function AvanceCelda({ p, titulo }: { p: Proyeccion; titulo: string }) {
  if (p.vendido === null) return <span className="text-brand-mist">—</span>;
  return (
    <div className="min-w-[132px]">
      <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
        <span><b className="text-brand-ink text-sm">{n(p.vendido)}</b>{p.objetivo !== null && <span className="text-brand-slate"> / {n(p.objetivo)}</span>}</span>
        <span className="text-brand-slate" title="Proyección al cierre contra el objetivo">
          {p.pct_proyeccion !== null ? `${num(p.pct_proyeccion, 0)}%` : p.proyeccion !== null ? `→ ${Math.round(p.proyeccion)}` : ""}
        </span>
      </div>
      <div className="mt-1"><BarraAvance p={p} alto="h-1.5" etiqueta={etiquetaBarra(titulo, p)} /></div>
    </div>
  );
}

// ------------------------------------------------------------------ uso de líneas
export function UsoCelda({ uso, p }: { uso: Uso | null; p: ParametrosSup }) {
  if (!uso || !uso.evaluables) return <span className="text-brand-mist">—</span>;
  const pocas = uso.evaluables < p.min_evaluables;
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums font-semibold ${uso.alerta ? "text-brand-primary-dark" : pocas ? "text-brand-slate" : "text-brand-ink"}`}
      title={pocas ? `Con menos de ${p.min_evaluables} líneas evaluables no se evalúa la alerta` : undefined}>
      {uso.alerta && <AlertTriangle size={12} aria-label="En alerta" />}
      {num(uso.pct_sin_uso)}%
    </span>
  );
}

// ------------------------------------------------------------------ líneas sin uso de un asesor
export function LineasDialog({ url, onClose }: { url: string | null; onClose: () => void }) {
  const [data, setData] = useState<LineasAsesor | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    setError(null);
    if (!url) return;
    apiFetch<LineasAsesor>(url).then(setData).catch((e) => setError(e.message));
  }, [url]);
  useEffect(() => {
    if (!url) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [url, onClose]);
  if (!url) return null;
  const sinUso = data?.lineas.filter((l) => l.estado === "sin_uso") ?? [];
  const espera = data?.lineas.filter((l) => l.estado === "en_espera") ?? [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-[2px] animate-fade" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Líneas sin uso" className="relative w-full max-w-2xl card shadow-elevated max-h-[88vh] flex flex-col animate-pop">
        <div className="h-1.5 bg-brand-cyan rounded-t-lg" />
        <div className="p-5 border-b border-brand-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Líneas Pospago sin uso</div>
            <h2 className="font-display text-2xl text-brand-ink uppercase leading-tight truncate">{data?.nombre ?? "…"}</h2>
            {data?.uso && (
              <p className="text-xs text-brand-slate mt-1">
                {n(data.uso.sin_uso)} sin uso de {n(data.uso.evaluables)} evaluables ({num(data.uso.pct_sin_uso)}%)
                {data.uso.alerta && <> · <b className="text-brand-primary-dark">recuperar {n(data.uso.a_recuperar)}</b> para volver al umbral</>}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="btn-ghost" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-5">
          {error && <p className="text-sm text-brand-primary">{error}</p>}
          {!data && !error && <p className="text-sm text-brand-slate">Cargando…</p>}
          {data && !data.lineas.length && <p className="text-sm text-emerald-700">No tiene líneas sin uso ni en espera.</p>}
          {data && !!data.lineas.length && (
            <div className="space-y-5">
              <TablaLineas titulo="Sin uso" lineas={sinUso} />
              {!!espera.length && <TablaLineas titulo="En espera (activadas hace menos de 3 días: todavía no cuentan)" lineas={espera} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TablaLineas({ titulo, lineas }: { titulo: string; lineas: LineasAsesor["lineas"] }) {
  if (!lineas.length) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider2 text-brand-slate mb-2">{titulo} · {lineas.length}</h3>
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
              <th className="text-left py-2 pr-3">Línea</th>
              <th className="text-left py-2 pr-3">Plan</th>
              <th className="text-left py-2 pr-3">Activación</th>
              <th className="text-right py-2">Días</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={l.sds} className="border-b border-brand-border last:border-0">
                <td className="py-2 pr-3 font-semibold text-brand-ink tabular-nums whitespace-nowrap">{l.linea ?? "—"}<div className="text-[10px] font-normal text-brand-mist">SDS {l.sds}</div></td>
                <td className="py-2 pr-3 text-brand-graphite">{l.plan ?? "—"}</td>
                <td className="py-2 pr-3 text-brand-slate whitespace-nowrap">{l.fecha_activacion ? fechaLarga(l.fecha_activacion) : "—"}</td>
                <td className="py-2 text-right tabular-nums">{l.dias ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ equipo de un supervisor
export function TablaEquipo({ d, lineasUrl }: { d: DetalleSupervisor; lineasUrl: (operadorId: string) => string }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const p = d.parametros;
  if (!d.asesores.length) {
    return (
      <section className="card p-8 text-center text-sm text-brand-slate">
        Sin asesores asignados en {d.nombre_mes.toLowerCase()}. Los equipos los arman los jefes en Supervisión → Equipos del mes.
      </section>
    );
  }
  return (
    <section className="card min-w-0">
      <div className="p-5 pb-3 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Equipo</h2>
          <p className="text-xs text-brand-slate mt-0.5">
            Netas del mes que vendió cada asesor estando en este equipo; uso de líneas de todo el mes. En alerta: más del{" "}
            {num(p.umbral_sin_uso)}% de sus Pospago evaluables sin uso, con {p.min_evaluables} o más.
          </p>
        </div>
      </div>
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="bg-brand-bg text-[10px] uppercase tracking-wider2 text-brand-slate">
              <th className="text-left px-5 py-2.5">Asesor</th>
              <th className="text-right px-3 py-2.5">Pospago</th>
              <th className="text-right px-3 py-2.5">GPON</th>
              <th className="text-right px-3 py-2.5" title="Pospago con 3 días o más desde la activación">Evaluables</th>
              <th className="text-right px-3 py-2.5">Sin uso</th>
              <th className="text-right px-3 py-2.5">% sin uso</th>
              <th className="text-right px-3 py-2.5" title="Líneas sin uso que tienen que empezar a usarse para volver al umbral">A recuperar</th>
              <th className="px-5 py-2.5"><span className="sr-only">Líneas</span></th>
            </tr>
          </thead>
          <tbody>
            {d.asesores.map((a) => (
              <tr key={a.id} className={`border-t border-brand-border ${a.actual ? "" : "bg-brand-bg-soft text-brand-slate"} ${a.uso?.alerta && a.actual ? "shadow-[inset_3px_0_0_#E6332A]" : ""}`}>
                <td className="px-5 py-2.5 min-w-[220px]">
                  <div className={`font-semibold ${a.actual ? "text-brand-ink" : "text-brand-slate"}`}>{a.nombre}</div>
                  <div className="text-[11px] text-brand-slate">
                    {a.vendedor ?? "Sin nombre de vendedor: sus netas no se pueden atribuir"}
                    {a.desde && <span className="text-[#1D5BA6]"> · en el equipo desde el {dm(a.desde)}</span>}
                    {a.hasta && <span className="text-[#1D5BA6]"> · estuvo hasta el {dm(a.hasta)}</span>}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{a.pospago === null ? "—" : n(a.pospago)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{a.gpon === null ? "—" : n(a.gpon)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{a.uso ? n(a.uso.evaluables) : "—"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{a.uso ? n(a.uso.sin_uso) : "—"}</td>
                <td className="px-3 py-2.5 text-right"><UsoCelda uso={a.uso} p={p} /></td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-brand-primary-dark">{a.uso?.a_recuperar ? n(a.uso.a_recuperar) : ""}</td>
                <td className="px-5 py-2.5 text-right whitespace-nowrap">
                  {!!(a.uso && (a.uso.sin_uso || a.uso.en_espera)) && (
                    <button type="button" onClick={() => setAbierta(a.id)} className="text-xs font-semibold text-brand-primary hover:underline">
                      Ver líneas
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LineasDialog url={abierta ? lineasUrl(abierta) : null} onClose={() => setAbierta(null)} />
    </section>
  );
}

/** Lo que ve un supervisor de su mes (y los jefes en el detalle de cada supervisor). */
export function VistaSupervisor({ d, lineasUrl, extra }: { d: DetalleSupervisor; lineasUrl: (id: string) => string; extra?: ReactNode }) {
  return (
    <div className="space-y-6">
      <FuenteDatos ventas={d.ventas} cal={d.calendario} />
      <div className="grid lg:grid-cols-[1fr_1fr_minmax(240px,0.8fr)] gap-5">
        <AvanceObjetivo titulo="Pospago" p={d.pospago} cal={d.calendario} />
        <AvanceObjetivo titulo="GPON" p={d.gpon} cal={d.calendario} />
        <section className={`card p-5 flex flex-col gap-3 ${d.critico ? "border-brand-primary/40" : ""}`}>
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-display text-lg uppercase text-brand-ink leading-tight">Uso de líneas</h3>
            <CriticoBadge critico={d.critico} />
          </div>
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div><dt className="text-brand-slate">Asesores en alerta</dt><dd className={`font-display text-3xl tabular-nums leading-none mt-1 ${d.asesores_en_alerta ? "text-brand-primary-dark" : "text-brand-ink"}`}>{n(d.asesores_en_alerta)}</dd></div>
            <div><dt className="text-brand-slate">Líneas a recuperar</dt><dd className={`font-display text-3xl tabular-nums leading-none mt-1 ${d.a_recuperar ? "text-brand-primary-dark" : "text-brand-ink"}`}>{n(d.a_recuperar)}</dd></div>
          </dl>
          <p className="text-[11px] text-brand-slate leading-relaxed mt-auto">
            {d.critico
              ? "Revisá con cada asesor en alerta sus líneas sin uso y registrá el coaching dentro de los 5 días hábiles."
              : `Ningún asesor del equipo supera el ${num(d.parametros.umbral_sin_uso)}% de líneas sin uso.`}
            {" "}Equipo actual: <b className="text-brand-ink">{n(d.asesores_actuales)}</b> asesor(es).
          </p>
        </section>
      </div>
      {extra}
      <TablaEquipo d={d} lineasUrl={lineasUrl} />
      <MetodoSupervision p={d.parametros} />
    </div>
  );
}

/** Cómo se calcula: lo mismo en el tablero de los jefes y en el portal. */
export function MetodoSupervision({ p }: { p: ParametrosSup }) {
  const sabado = p.pesos_dia[5] === 0.5 ? "el sábado cuenta como medio día" : p.pesos_dia[5] ? "el sábado cuenta como un día" : "el sábado no cuenta";
  return (
    <section className="card p-5">
      <h2 className="font-display text-lg uppercase text-brand-ink leading-tight">Cómo se calcula</h2>
      <div className="grid md:grid-cols-3 gap-5 mt-3">
        <div>
          <div className="font-semibold text-brand-ink text-sm">Proyección al cierre</div>
          <p className="text-xs text-brand-slate mt-1 leading-relaxed">
            Lo vendido al corte de Ventas Netas, extendido al mes al mismo ritmo por día hábil (de lunes a viernes, un día;
            {" "}{sabado}; los feriados no cuentan). Ritmo necesario = lo que falta ÷ días hábiles restantes. Con menos de{" "}
            {num(p.min_dias_proyeccion)} días hábiles es provisoria. En camino: llega al {num(p.semaforo_en_camino, 0)}% del objetivo; en
            riesgo: desde el {num(p.semaforo_en_riesgo, 0)}%.
          </p>
        </div>
        <div>
          <div className="font-semibold text-brand-ink text-sm">Netas de cada supervisor</div>
          <p className="text-xs text-brand-slate mt-1 leading-relaxed">
            Las del informe de Ventas Netas del mes (mes de activación: la cifra oficial, la que cuadra con Claro). Cada neta cuenta
            para el supervisor que tenía al asesor el día de la venta; si se vendió antes del mes, para el que lo tenía el día 1.
          </p>
        </div>
        <div>
          <div className="font-semibold text-brand-ink text-sm">Supervisor crítico</div>
          <p className="text-xs text-brand-slate mt-1 leading-relaxed">
            Al menos un asesor de su equipo actual con más del {num(p.umbral_sin_uso)}% de sus Pospago evaluables sin uso, con{" "}
            {p.min_evaluables} o más evaluables (no cuentan las activadas hace menos de 3 días). Líneas a recuperar: las que tienen que
            empezar a usarse para volver al {num(p.umbral_sin_uso)}%.
          </p>
        </div>
      </div>
    </section>
  );
}
