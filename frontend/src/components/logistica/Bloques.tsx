"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { irASeccion } from "@/components/KpiCard";
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  DatosLogistica, Desglose, EN_GESTION, ENTREGADO, Filtro, Motivo, Pedido, PuntoSerie, TRAMOS, colorEstado, diaMes, dias,
  etiquetaEstado, fechaCorta, n, pct,
} from "./tipos";

const EJE = { fontSize: 11, fill: "#5B6275" };

/** Qué pedidos mirar en detalle: una zona (región → departamento → ciudad) y, opcionalmente, un tramo de días. */
export interface Foco { region?: string; departamento?: string; ciudad?: string; tramo?: string; minimo?: number }

function enFoco(p: Pedido, f: Foco | null): boolean {
  if (!f) return true;
  if (f.region && p.region !== f.region) return false;
  if (f.departamento && (p.departamento ?? "—") !== f.departamento) return false;
  if (f.ciudad && (p.ciudad ?? "—") !== f.ciudad) return false;
  if (f.tramo && p.tramo !== f.tramo) return false;
  if (f.minimo !== undefined && p.dias < f.minimo) return false;
  return true;
}

function etiquetaFoco(f: Foco | null): string {
  if (!f) return "";
  const zona = [f.region, f.departamento, f.ciudad].filter(Boolean).join(" · ");
  const dias = f.tramo ? `${f.tramo} días` : f.minimo !== undefined ? `${f.minimo} días o más` : "";
  return [zona, dias].filter(Boolean).join(" · ");
}

/** La zona o el tramo elegido, con el botón para volver a ver todo. */
function ChipsFoco({ foco, onChange, total, filtrados, nombre, verTodos }: { foco: Foco | null; onChange: (f: Foco | null) => void; total: number; filtrados: number; nombre: string; verTodos: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
      {foco ? (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-ink text-white px-3 py-1 font-semibold">{etiquetaFoco(foco)} <span className="text-white/70 tabular-nums">{n(filtrados)} de {n(total)}</span></span>
          <button type="button" className="rounded-full border border-brand-border bg-white px-3 py-1 font-semibold text-brand-graphite hover:border-brand-slate" onClick={() => onChange(null)}>{verTodos}</button>
        </>
      ) : (
        <span className="text-brand-slate">{n(total)} {nombre} · hacé clic en una zona, un departamento o un tramo para ver solo esos pedidos.</span>
      )}
    </div>
  );
}

export function Seccion({ titulo, sub, accion, children, id }: { titulo: string; sub?: ReactNode; accion?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="card p-5 min-w-0">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div><h2 className="font-display text-lg text-brand-ink uppercase leading-tight">{titulo}</h2>{sub && <p className="text-xs text-brand-slate mt-0.5 max-w-3xl">{sub}</p>}</div>
        {accion}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ filtro dinámico por estado
export function FiltroEstado({ estados, valor, onChange, kpis }: { estados: string[]; valor: Filtro; onChange: (f: Filtro) => void; kpis: DatosLogistica["kpis"] }) {
  const boton = (f: Filtro, label: string, cant: number, color?: string) => (
    <button key={f} type="button" onClick={() => onChange(f)} aria-pressed={valor === f}
      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${valor === f ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border bg-white text-brand-graphite hover:border-brand-slate"}`}>
      {color && <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} aria-hidden />}
      {label} <span className={`tabular-nums text-xs ${valor === f ? "text-white/80" : "text-brand-slate"}`}>{n(cant)}</span>
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por estado">
      <span className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mr-1">Estado</span>
      {boton("todos", "Todos", kpis.pedidos)}
      {estados.map((e) => boton(e, etiquetaEstado(e), kpis.por_estado[e]?.n ?? 0, colorEstado(e, estados)))}
    </div>
  );
}

// ------------------------------------------------------------------ demora por región, de un vistazo
const COLOR_TRAMO: Record<string, string> = { "0-2": "#00B2BF", "3-5": "#F39200", "6-10": "#E6332A", "11+": "#662483" };

export function DemoraPorRegion({ d, onVerPedidos }: { d: DatosLogistica; onVerPedidos?: (foco: Foco) => void }) {
  const zonas = d.regiones.map((r) => d.pendientes.por_zona.find((z) => z.region === r) ?? { region: r, n: 0, dias_prom: null, dias_max: null, tramos: {}, departamentos: [] });
  const entregados = (r: string) => d.por_region.find((x) => x.region === r);
  return (
    <Seccion titulo="Demora de pendientes por región" id="demora"
      sub={<>Pedidos <b>en gestión</b> y los <b>días hábiles</b> que llevan desde la venta hasta el corte del {fechaCorta(d.fecha_corte)} (los domingos no cuentan), por región. {d.entregas?.disponible ? <>El tiempo de los ya entregados está arriba, en «Tiempo de entrega por región».</> : <>Los entregados no traen fecha de entrega en el archivo: su tiempo no se puede medir.</>}</>}>
      <div className={`grid gap-3 ${zonas.length > 2 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {zonas.map((z) => {
          const e = entregados(z.region);
          const vencidos = (z.tramos["6-10"] ?? 0) + (z.tramos["11+"] ?? 0);
          const alerta = (z.dias_prom ?? 0) >= 6 || vencidos > 0;
          return (
            <div key={z.region} className={`rounded-lg border p-4 ${alerta ? "border-brand-primary/40 bg-brand-primary-light/20" : "border-brand-border bg-white"}`}>
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-display text-xl uppercase text-brand-ink">{z.region}</div>
                <div className="text-xs text-brand-slate">{e ? <>{n(e.total)} pedidos · <b className="text-brand-graphite">{pct(e.pct[ENTREGADO])}</b> entregados</> : null}</div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div><div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-semibold">Pendientes</div><div className="font-display text-2xl text-brand-ink tabular-nums">{n(z.n)}</div></div>
                <div><div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-semibold">Demora prom.</div><div className={`font-display text-2xl tabular-nums ${(z.dias_prom ?? 0) >= 6 ? "text-brand-primary" : "text-brand-ink"}`}>{dias(z.dias_prom)}</div></div>
                <div><div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-semibold">Máximo</div><div className="font-display text-2xl text-brand-ink tabular-nums">{dias(z.dias_max)}</div></div>
              </div>
              {z.n > 0 && (
                <>
                  <div className="mt-3 h-2 rounded-full bg-brand-bg overflow-hidden flex">{TRAMOS.map((t) => <div key={t} style={{ width: `${((z.tramos[t] ?? 0) / z.n) * 100}%`, background: COLOR_TRAMO[t] }} />)}</div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-brand-slate">
                    {TRAMOS.map((t) => <span key={t} className="inline-flex items-center gap-1 tabular-nums"><span className="w-2 h-2 rounded-full" style={{ background: COLOR_TRAMO[t] }} />{t} d: <b className="text-brand-graphite">{n(z.tramos[t] ?? 0)}</b></span>)}
                    {vencidos > 0 && <span className="ml-auto rounded-full bg-brand-primary-light text-brand-primary-dark px-2 font-semibold">{n(vencidos)} con 6 días o más</span>}
                  </div>
                  {onVerPedidos && (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold print:hidden">
                      <button type="button" className="text-brand-primary hover:underline" onClick={() => onVerPedidos({ region: z.region })}>Ver los {n(z.n)} pedidos pendientes ↓</button>
                      {vencidos > 0 && <button type="button" className="text-brand-primary-dark hover:underline" onClick={() => onVerPedidos({ region: z.region, minimo: 6 })}>Solo los de 6 días o más ↓</button>}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </Seccion>
  );
}

// ------------------------------------------------------------------ tiempo de entrega (entregados: fecha de entrega − venta)
export function TiempoDeEntrega({ d }: { d: DatosLogistica }) {
  const e = d.entregas;
  const [abierto, setAbierto] = useState<string | null>(null);
  const [foco, setFoco] = useState<Foco | null>(null);
  const listaE = useMemo(() => (e?.lista ?? []).filter((p) => enFoco(p, foco)), [e, foco]);
  if (!e) return null;
  if (!e.disponible) {
    return (
      <Seccion titulo="Tiempo de entrega por región" id="entregas" sub="Días hábiles desde la venta hasta la entrega de cada pedido entregado (sin contar los domingos).">
        <div className="text-sm text-brand-slate">El archivo no trae <b>FECHA DE ENTREGA</b>: no se puede medir cuánto tardó cada entrega. Solo se mide la demora de los pedidos en gestión hasta el corte (abajo).</div>
      </Seccion>
    );
  }
  const Barra = ({ tramos, total }: { tramos: Record<string, number>; total: number }) => (
    <div className="h-2 rounded-full bg-brand-bg overflow-hidden flex" title={TRAMOS.map((t) => `${t} días: ${tramos[t] ?? 0}`).join(" · ")}>
      {TRAMOS.map((t) => <div key={t} style={{ width: `${total ? ((tramos[t] ?? 0) / total) * 100 : 0}%`, background: COLOR_TRAMO[t] }} />)}
    </div>
  );
  const zonas = e.por_zona ?? [];
  const serie = (e.por_dia ?? []).map((x) => ({ ...x, etiqueta: diaMes(x.fecha) }));
  const colorRegion = (i: number) => ["#00B2BF", "#662483", "#5B6275"][i % 3];
  return (
    <Seccion titulo="Tiempo de entrega por región" id="entregas"
      sub={<>Pedidos <b>entregados</b> y los <b>días hábiles</b> que tardó cada entrega: de la fecha de venta a la <b>fecha de entrega</b> del archivo, sin contar los domingos (vendido el sábado y entregado el lunes: 1 día). {e.sin_fecha > 0 && <>{n(e.sin_fecha)} entregado(s) sin fecha de entrega no entran.</>} Tramos: {TRAMOS.map((t) => <span key={t} className="inline-flex items-center gap-1 ml-2"><span className="w-2 h-2 rounded-full" style={{ background: COLOR_TRAMO[t] }} />{t} días</span>)}</>}>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs mb-4">
        <div className="rounded-md bg-brand-bg px-3 py-2"><div className="text-brand-slate">Entregas medidas</div><div className="font-display text-2xl text-brand-ink tabular-nums">{n(e.n)}</div></div>
        <div className="rounded-md bg-brand-bg px-3 py-2"><div className="text-brand-slate">Tiempo promedio</div><div className={`font-display text-2xl tabular-nums ${(e.dias_prom ?? 0) >= 3 ? "text-brand-orange" : "text-brand-ink"}`}>{dias(e.dias_prom)}</div></div>
        <div className="rounded-md bg-brand-bg px-3 py-2"><div className="text-brand-slate">Entrega más lenta</div><div className="font-display text-2xl text-brand-ink tabular-nums">{dias(e.dias_max)}</div></div>
        <div className="rounded-md bg-brand-bg px-3 py-2"><div className="text-brand-slate">Mismo día</div><div className="font-display text-2xl text-brand-ink tabular-nums">{n(e.mismo_dia)} <span className="text-xs font-sans text-brand-slate">({pct(e.n ? Math.round(((e.mismo_dia ?? 0) * 1000) / e.n) / 10 : null)})</span></div></div>
        <div className="rounded-md bg-brand-bg px-3 py-2"><div className="text-brand-slate">En 2 días o menos</div><div className="font-display text-2xl text-brand-cyan tabular-nums">{pct(e.pct_hasta_2)}</div>{(e.en_6_o_mas ?? 0) > 0 && <div className="text-brand-primary font-semibold">{n(e.en_6_o_mas)} tardaron 6 días o más</div>}</div>
      </div>
      <div className={`grid gap-3 mb-4 ${zonas.length > 2 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {zonas.map((z) => {
          const lento = (z.dias_prom ?? 0) >= 3 || z.en_6_o_mas > 0;
          return (
            <div key={z.region} className={`rounded-lg border p-4 ${lento ? "border-brand-orange/50 bg-brand-orange/5" : "border-brand-border bg-white"}`}>
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-display text-xl uppercase text-brand-ink">{z.region}</div>
                <div className="text-xs text-brand-slate">{n(z.n)} entregas · <b className="text-brand-graphite">{pct(z.pct_hasta_2)}</b> en 2 días o menos</div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div><div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-semibold">Entregas</div><div className="font-display text-2xl text-brand-ink tabular-nums">{n(z.n)}</div></div>
                <div><div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-semibold">Tiempo prom.</div><div className={`font-display text-2xl tabular-nums ${(z.dias_prom ?? 0) >= 3 ? "text-brand-orange" : "text-brand-ink"}`}>{dias(z.dias_prom)}</div></div>
                <div><div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-semibold">Máximo</div><div className="font-display text-2xl text-brand-ink tabular-nums">{dias(z.dias_max)}</div></div>
              </div>
              {z.n > 0 && (
                <>
                  <div className="mt-3"><Barra tramos={z.tramos} total={z.n} /></div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-brand-slate">
                    {TRAMOS.map((t) => <span key={t} className="inline-flex items-center gap-1 tabular-nums"><span className="w-2 h-2 rounded-full" style={{ background: COLOR_TRAMO[t] }} />{t} d: <b className="text-brand-graphite">{n(z.tramos[t] ?? 0)}</b></span>)}
                    {z.en_6_o_mas > 0 && <span className="ml-auto rounded-full bg-brand-primary-light text-brand-primary-dark px-2 font-semibold">{n(z.en_6_o_mas)} de 6 días o más</span>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="overflow-x-auto -mx-5 px-5 mb-4">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
            <th className="py-2 pr-3">Zona</th><th className="py-2 px-3 text-right">Entregas</th><th className="py-2 px-3 text-right">Prom.</th><th className="py-2 px-3 text-right">Máx.</th>
            {TRAMOS.map((t) => <th key={t} className="py-2 px-3 text-right">{t} d</th>)}<th className="py-2 pl-3 w-44">Tiempo</th>
          </tr></thead>
          <tbody>
            {zonas.map((z) => (
              <Fragmento key={z.region}>
                <tr className={`border-b border-brand-border/60 cursor-pointer ${foco?.region === z.region && !foco.departamento ? "bg-brand-cyan/10" : "bg-brand-bg-soft"}`} title="Ver las entregas de esta región">
                  <td className="py-2 pr-3 font-semibold text-brand-ink"><button type="button" className="mr-1 text-brand-slate" aria-label="Desplegar departamentos" onClick={() => setAbierto(abierto === z.region ? null : z.region)}>{abierto === z.region ? "▾" : "▸"}</button><span onClick={() => { setAbierto(z.region); setFoco({ region: z.region }); }}>{z.region}</span></td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold" onClick={() => setFoco({ region: z.region })}>{n(z.n)}</td><td className="py-2 px-3 text-right tabular-nums" onClick={() => setFoco({ region: z.region })}>{dias(z.dias_prom)}</td><td className="py-2 px-3 text-right tabular-nums" onClick={() => setFoco({ region: z.region })}>{dias(z.dias_max)}</td>
                  {TRAMOS.map((t) => <td key={t} className="py-2 px-3 text-right tabular-nums hover:text-brand-primary" title={`Ver las entregas de ${t} días`} onClick={() => setFoco({ region: z.region, tramo: t })}>{n(z.tramos[t])}</td>)}
                  <td className="py-2 pl-3" onClick={() => setFoco({ region: z.region })}><Barra tramos={z.tramos} total={z.n} /></td>
                </tr>
                {abierto === z.region && z.departamentos.map((dep) => (
                  <tr key={dep.departamento} className={`border-b border-brand-border/40 cursor-pointer ${foco?.departamento === dep.departamento ? "bg-brand-cyan/10" : ""}`} title="Ver las entregas de este departamento">
                    <td className="py-1.5 pr-3 pl-6 text-brand-graphite" onClick={() => setFoco({ region: z.region, departamento: dep.departamento })}>{dep.departamento} <span className="text-xs text-brand-slate">· {dep.ciudades.map((c) => <button key={c.ciudad} type="button" className="hover:text-brand-primary hover:underline mr-1" onClick={(ev) => { ev.stopPropagation(); setFoco({ region: z.region, departamento: dep.departamento, ciudad: c.ciudad }); }}>{c.ciudad} ({c.n}, {dias(c.dias_prom)})</button>)}</span></td>
                    <td className="py-1.5 px-3 text-right tabular-nums" onClick={() => setFoco({ region: z.region, departamento: dep.departamento })}>{n(dep.n)}</td><td className="py-1.5 px-3 text-right tabular-nums" onClick={() => setFoco({ region: z.region, departamento: dep.departamento })}>{dias(dep.dias_prom)}</td><td className="py-1.5 px-3 text-right tabular-nums" onClick={() => setFoco({ region: z.region, departamento: dep.departamento })}>{dias(dep.dias_max)}</td>
                    {TRAMOS.map((t) => <td key={t} className="py-1.5 px-3 text-right tabular-nums hover:text-brand-primary" onClick={() => setFoco({ region: z.region, departamento: dep.departamento, tramo: t })}>{n(dep.tramos[t])}</td>)}
                    <td className="py-1.5 pl-3" onClick={() => setFoco({ region: z.region, departamento: dep.departamento })}><Barra tramos={dep.tramos} total={dep.n} /></td>
                  </tr>
                ))}
              </Fragmento>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mb-1.5">Entregas por día de entrega</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={serie} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="etiqueta" tick={EJE} tickLine={false} axisLine={{ stroke: "#E5E7EB" }} />
                <YAxis tick={EJE} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={({ active, payload }) => (active && payload?.length ? (
                  <div className="rounded-md border border-brand-border bg-white shadow-elevated px-3 py-2 text-xs">
                    <div className="font-semibold text-brand-ink mb-1">{fechaCorta(payload[0].payload.fecha)} · {n(payload[0].payload.n)} entregas · {dias(payload[0].payload.dias_prom)} prom.</div>
                    {d.regiones.map((r) => <div key={r} className="flex justify-between gap-4"><span>{r}</span><b className="tabular-nums">{n(payload[0].payload.regiones?.[r])}</b></div>)}
                  </div>
                ) : null)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {d.regiones.map((r, i) => <Bar key={r} dataKey={`regiones.${r}`} name={r} stackId="e" fill={colorRegion(i)} radius={i === d.regiones.length - 1 ? [4, 4, 0, 0] : undefined} maxBarSize={28} />)}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="min-w-0" id="entregas-lista">
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mb-1.5">Las entregas más lentas{foco ? ` · ${etiquetaFoco(foco)}` : ""}</div>
          <ChipsFoco foco={foco} onChange={setFoco} total={(e.lista ?? []).length} filtrados={listaE.length} nombre="entregas medidas" verTodos="Ver todas las entregas" />
          <TablaPedidos pedidos={listaE} conDias compacta />
        </div>
      </div>
    </Seccion>
  );
}

// ------------------------------------------------------------------ proyección a fin de mes
export function ProyeccionFinDeMes({ d }: { d: DatosLogistica }) {
  const p = d.proyeccion;
  if (!p) return null;
  if (!p.disponible) {
    return (
      <Seccion titulo="Proyección a fin de mes" id="proyeccion" sub="Cuántos pedidos se cerrarían en el mes con el ritmo actual.">
        <div className="text-sm text-brand-slate">Sin proyección: {p.motivo}</div>
      </Seccion>
    );
  }
  const serie = (p.serie ?? []).map((x) => ({ ...x, etiqueta: diaMes(x.fecha) }));
  const regiones = Object.entries(p.por_region ?? {});
  const pctAvance = p.proyeccion ? Math.round((p.acumulado / p.proyeccion) * 100) : 0;
  return (
    <Seccion titulo="Proyección a fin de mes" id="proyeccion"
      sub={<>Con el <b>ritmo actual</b> (promedio de los días con ventas en la media o por encima: el arranque lento no cuenta) y los {n(p.dias_restantes)} días laborables que faltan hasta el {fechaCorta(p.fin_mes)}. Intervalo del 95 % con el desvío de esos días.</>}>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <div className="rounded-lg border-l-[3px] border-l-brand-ink card p-4"><div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">Proyección al cierre</div><div className="font-display text-3xl text-brand-ink tabular-nums">{n(p.proyeccion)}</div><div className="text-xs text-brand-slate mt-1">entre {n(p.intervalo_95?.bajo)} y {n(p.intervalo_95?.alto)} (95 %)</div></div>
        <div className="rounded-lg border-l-[3px] border-l-brand-cyan card p-4"><div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">Acumulado</div><div className="font-display text-3xl text-brand-ink tabular-nums">{n(p.acumulado)}</div><div className="text-xs text-brand-slate mt-1">{pctAvance}% de la proyección · {n(p.dias_transcurridos)} días con ventas</div></div>
        <div className="rounded-lg border-l-[3px] border-l-brand-orange card p-4"><div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">Ritmo actual</div><div className="font-display text-3xl text-brand-ink tabular-nums">{n(p.ritmo)}<span className="text-base font-sans text-brand-slate"> /día</span></div><div className="text-xs text-brand-slate mt-1">media de todos los días: {n(p.media_diaria)} /día</div></div>
        <div className="rounded-lg border-l-[3px] border-l-brand-mist card p-4"><div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">Rango de referencia</div><div className="font-display text-xl text-brand-ink tabular-nums">{n(p.rango?.conservador)} – {n(p.rango?.tendencia)}</div><div className="text-xs text-brand-slate mt-1">con la media de todos los días · si sigue la tendencia</div></div>
        <div className="rounded-lg border-l-[3px] border-l-brand-cyan card p-4"><div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">Entregas esperadas</div><div className="font-display text-3xl text-brand-ink tabular-nums">{p.entregas_esperadas != null ? n(p.entregas_esperadas) : "—"}</div><div className="text-xs text-brand-slate mt-1">aplicando el {pct(d.kpis.pct_entregados)} de entregados</div></div>
      </div>
      <div className="h-72">
        <ResponsiveContainer>
          <ComposedChart data={serie} margin={{ left: -6, right: 12, top: 10, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#eef0f4" />
            <XAxis dataKey="etiqueta" tick={EJE} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={14} />
            <YAxis tick={EJE} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<DetalleProyeccion />} cursor={{ stroke: "#9CA3AF", strokeDasharray: "3 3" }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="alto" name="Intervalo 95 %" stroke="none" fill="#0F1116" fillOpacity={0.06} isAnimationActive={false} legendType="none" />
            <Area type="monotone" dataKey="bajo" name="bajo" stroke="none" fill="#ffffff" fillOpacity={1} isAnimationActive={false} legendType="none" />
            <Line type="monotone" dataKey="acumulado" name="Acumulado real" stroke="#0F1116" strokeWidth={2} dot={{ r: 2.5, strokeWidth: 2, fill: "#fff" }} isAnimationActive={false} />
            <Line type="monotone" dataKey="proyectado" name="Proyección" stroke="#E6332A" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {regiones.length > 0 && (
        <div className="mt-4 overflow-x-auto -mx-5 px-5">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
              <th className="py-2 pr-3">Región</th><th className="py-2 px-3 text-right">Acumulado</th><th className="py-2 px-3 text-right">Media /día</th><th className="py-2 px-3 text-right">Ritmo /día</th><th className="py-2 px-3 text-right">Días en ritmo</th><th className="py-2 px-3 text-right">Proyección</th><th className="py-2 pl-3 text-right">Intervalo 95 %</th>
            </tr></thead>
            <tbody>
              {regiones.map(([r, x]) => (
                <tr key={r} className="border-b border-brand-border/60">
                  <td className="py-1.5 pr-3 font-semibold text-brand-ink">{r}</td><td className="py-1.5 px-3 text-right tabular-nums">{n(x.acumulado)}</td><td className="py-1.5 px-3 text-right tabular-nums">{n(x.media_diaria)}</td><td className="py-1.5 px-3 text-right tabular-nums font-semibold">{n(x.ritmo)}</td><td className="py-1.5 px-3 text-right tabular-nums">{n(x.dias_en_ritmo.length)} de {n(x.dias_con_ventas)}</td><td className="py-1.5 px-3 text-right tabular-nums font-semibold text-brand-ink">{n(x.proyeccion)}</td><td className="py-1.5 pl-3 text-right tabular-nums text-brand-slate">{n(x.intervalo_95.bajo)} – {n(x.intervalo_95.alto)}</td>
                </tr>
              ))}
              <tr className="bg-brand-ink text-white font-semibold"><td className="py-2 pr-3 rounded-l-md">Total</td><td className="py-2 px-3 text-right tabular-nums">{n(p.acumulado)}</td><td className="py-2 px-3 text-right tabular-nums">{n(p.media_diaria)}</td><td className="py-2 px-3 text-right tabular-nums">{n(p.ritmo)}</td><td className="py-2 px-3 text-right tabular-nums">{n(p.dias_en_ritmo?.length)} de {n(p.dias_con_ventas)}</td><td className="py-2 px-3 text-right tabular-nums">{n(p.proyeccion)}</td><td className="py-2 pl-3 text-right tabular-nums rounded-r-md">{n(p.intervalo_95?.bajo)} – {n(p.intervalo_95?.alto)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      <details className="mt-3 text-xs text-brand-slate"><summary className="cursor-pointer font-semibold text-brand-graphite">Cómo se calcula</summary><p className="mt-1">{p.metodo} Días en ritmo: {(p.dias_en_ritmo ?? []).map(fechaCorta).join(", ")}. Días laborables detectados en el archivo: {(p.dias_laborables ?? []).map((w) => ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"][w]).join(", ")}. La proyección cuenta desde el {fechaCorta(p.ultimo_dia)} (último día con ventas) hasta el {fechaCorta(p.fecha_fin_proyeccion)}.</p></details>
    </Seccion>
  );
}

function DetalleProyeccion({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null;
  const x = payload[0].payload;
  return (
    <div className="rounded-md border border-brand-border bg-white shadow-elevated px-3 py-2 text-xs">
      <div className="font-semibold text-brand-ink mb-1">{fechaCorta(x.fecha)}</div>
      {x.acumulado != null ? <><div>Del día: <b className="tabular-nums">{n(x.real)}</b></div><div>Acumulado: <b className="tabular-nums">{n(x.acumulado)}</b></div></>
        : <><div>Proyección: <b className="tabular-nums">{n(x.proyectado)}</b></div><div className="text-brand-slate">entre {n(x.bajo)} y {n(x.alto)}</div></>}
    </div>
  );
}

// ------------------------------------------------------------------ tabla estado × zona (cantidad y %)
function TablaDesglose({ filas, clave, estados, filtro, titulo, extra }: {
  filas: Desglose[]; clave: string; estados: string[]; filtro: Filtro; titulo: string; extra?: (f: Desglose) => ReactNode;
}) {
  const cols = filtro === "todos" ? estados : [filtro];
  const total = filas.reduce((t, f) => t + f.total, 0);
  const sum = (e: string) => filas.reduce((t, f) => t + (f.estados[e] ?? 0), 0);
  const [modo, setModo] = useState<"cantidad" | "pct">("cantidad");
  if (!filas.length) return <div className="text-sm text-brand-mist py-3">Sin datos</div>;
  const celda = (f: Desglose, e: string) => modo === "cantidad" ? n(f.estados[e] ?? 0) : pct(f.pct[e]);
  return (
    <div className="overflow-x-auto -mx-5 px-5">
      <div className="flex justify-end gap-1 mb-2">
        {(["cantidad", "pct"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setModo(m)} className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${modo === m ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border text-brand-graphite"}`}>{m === "cantidad" ? "Cantidad" : "%"}</button>
        ))}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
            <th className="py-2 pr-3">{titulo}</th>{extra && <th className="py-2 pr-3">Región</th>}
            {cols.map((e) => <th key={e} className="py-2 px-3 text-right"><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: colorEstado(e, estados) }} />{etiquetaEstado(e)}</span></th>)}
            <th className="py-2 pl-3 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={String(f[clave])} className="border-b border-brand-border/60">
              <td className="py-1.5 pr-3 font-semibold text-brand-ink">{String(f[clave])}</td>{extra && <td className="py-1.5 pr-3 text-xs text-brand-slate">{extra(f)}</td>}
              {cols.map((e) => <td key={e} className="py-1.5 px-3 text-right tabular-nums">{celda(f, e)}</td>)}
              <td className="py-1.5 pl-3 text-right tabular-nums font-semibold">{modo === "cantidad" ? n(filtro === "todos" ? f.total : f.estados[filtro] ?? 0) : pct(filtro === "todos" ? 100 : f.pct[filtro])}</td>
            </tr>
          ))}
          <tr className="bg-brand-ink text-white font-semibold">
            <td className="py-2 pr-3 rounded-l-md">Total</td>{extra && <td />}
            {cols.map((e) => <td key={e} className="py-2 px-3 text-right tabular-nums">{modo === "cantidad" ? n(sum(e)) : pct(total ? (sum(e) * 100) / total : null)}</td>)}
            <td className="py-2 pl-3 text-right tabular-nums rounded-r-md">{modo === "cantidad" ? n(filtro === "todos" ? total : sum(filtro)) : pct(filtro === "todos" ? 100 : total ? (sum(filtro) * 100) / total : null)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function EstadoPorZona({ d, filtro }: { d: DatosLogistica; filtro: Filtro }) {
  const [zona, setZona] = useState<"region" | "departamento" | "ciudad">("region");
  const filas = zona === "region" ? d.por_region : zona === "departamento" ? d.por_departamento : d.por_ciudad;
  return (
    <Seccion titulo="Estado por zona" sub="Cantidad y porcentaje de pedidos en cada estado, por región, departamento o ciudad (las 20 con más pedidos)."
      accion={<div className="flex gap-1">{(["region", "departamento", "ciudad"] as const).map((z) => (
        <button key={z} type="button" onClick={() => setZona(z)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${zona === z ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border text-brand-graphite"}`}>{z.charAt(0).toUpperCase() + z.slice(1)}</button>
      ))}</div>}>
      <TablaDesglose filas={filas} clave={zona} estados={d.estados} filtro={filtro} titulo={zona.charAt(0).toUpperCase() + zona.slice(1)}
        extra={zona === "region" ? undefined : (f) => f.region ?? "—"} />
    </Seccion>
  );
}

// ------------------------------------------------------------------ motivos × región (según el filtro)
export function Motivos({ d, filtro }: { d: DatosLogistica; filtro: Filtro }) {
  const lista: Motivo[] = d.motivos[filtro === "todos" ? "todos" : filtro] ?? [];
  const max = Math.max(1, ...lista.map((m) => m.total));
  return (
    <Seccion titulo="Motivos" sub={filtro === "todos" ? "Todos los pedidos: el motivo informado por región." : `Pedidos ${etiquetaEstado(filtro).toLowerCase()}: por qué, y en qué región.`}>
      {lista.length === 0 ? <div className="text-sm text-brand-mist py-3">Sin pedidos en este estado.</div> : (
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
              <th className="py-2 pr-3">Motivo</th>{d.regiones.map((r) => <th key={r} className="py-2 px-3 text-right">{r}</th>)}<th className="py-2 px-3 text-right">Total</th><th className="py-2 pl-3 w-40" />
            </tr></thead>
            <tbody>
              {lista.map((m) => (
                <tr key={m.motivo} className="border-b border-brand-border/60">
                  <td className="py-1.5 pr-3 font-semibold text-brand-ink">{m.motivo}</td>
                  {d.regiones.map((r) => <td key={r} className={`py-1.5 px-3 text-right tabular-nums ${m.regiones[r] ? "" : "text-brand-mist"}`}>{m.regiones[r] ? n(m.regiones[r]) : "—"}</td>)}
                  <td className="py-1.5 px-3 text-right tabular-nums font-semibold">{n(m.total)} <span className="text-brand-slate text-xs">({pct(m.pct)})</span></td>
                  <td className="py-1.5 pl-3"><div className="h-1.5 rounded-full bg-brand-bg overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(m.total / max) * 100}%`, background: filtro === "todos" ? "#0F1116" : colorEstado(filtro, d.estados) }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Seccion>
  );
}

// ------------------------------------------------------------------ línea de tiempo por estado
export function LineaTiempo({ d, filtro }: { d: DatosLogistica; filtro: Filtro }) {
  const [modo, setModo] = useState<"dia" | "acumulado">("dia");
  const estados = filtro === "todos" ? d.estados : [filtro];
  const datos = useMemo(() => d.serie.map((p: PuntoSerie) => {
    const o: Record<string, unknown> = { fecha: p.fecha, etiqueta: diaMes(p.fecha), total: modo === "dia" ? p.total : p.acumulado_total };
    for (const e of d.estados) o[e] = modo === "dia" ? p.estados[e] ?? 0 : p.acumulado[e] ?? 0;
    return o;
  }), [d, modo]);
  return (
    <Seccion titulo="Línea de tiempo por estado" sub="Pedidos por fecha de venta y el estado en que están al corte; «Acumulado» suma desde el primer día."
      accion={<div className="flex gap-1">{(["dia", "acumulado"] as const).map((m) => (
        <button key={m} type="button" onClick={() => setModo(m)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${modo === m ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border text-brand-graphite"}`}>{m === "dia" ? "Por día" : "Acumulado"}</button>
      ))}</div>}>
      <div className="h-72">
        <ResponsiveContainer>
          <ComposedChart data={datos} margin={{ left: -14, right: 12, top: 10, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#eef0f4" />
            <XAxis dataKey="etiqueta" tick={EJE} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={14} />
            <YAxis tick={EJE} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<DetalleSerie estados={d.estados} />} cursor={{ stroke: "#9CA3AF", strokeDasharray: "3 3" }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} formatter={(v) => etiquetaEstado(String(v))} />
            {filtro === "todos" && <Area type="monotone" dataKey="total" name="Total" stroke="#0F1116" fill="#0F1116" fillOpacity={0.05} strokeWidth={1} dot={false} isAnimationActive={false} legendType="none" />}
            {estados.map((e) => (
              <Line key={e} type="monotone" dataKey={e} name={e} stroke={colorEstado(e, d.estados)} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: "#fff" }} activeDot={{ r: 5 }} isAnimationActive={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Seccion>
  );
}

function DetalleSerie({ active, payload, estados }: { active?: boolean; payload?: any[]; estados: string[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-brand-border bg-white shadow-elevated px-3 py-2 text-xs">
      <div className="font-semibold text-brand-ink mb-1">{fechaCorta(p.fecha)} · {n(p.total)} pedidos</div>
      {estados.map((e) => <div key={e} className="flex justify-between gap-4"><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: colorEstado(e, estados) }} />{etiquetaEstado(e)}</span><b className="tabular-nums">{n(p[e])}</b></div>)}
    </div>
  );
}

// ------------------------------------------------------------------ pendientes y demora por zona
export function Pendientes({ d, foco: focoExterno, onFoco }: { d: DatosLogistica; foco?: Foco | null; onFoco?: (f: Foco | null) => void }) {
  const p = d.pendientes;
  const [abierto, setAbierto] = useState<string | null>(null);
  const [focoLocal, setFocoLocal] = useState<Foco | null>(null);
  const foco = focoExterno !== undefined ? focoExterno : focoLocal;
  const setFoco = (f: Foco | null) => { setFocoLocal(f); onFoco?.(f); };
  useEffect(() => { if (focoExterno?.region) setAbierto(focoExterno.region); }, [focoExterno]);
  const lista = useMemo(() => p.lista.filter((x) => enFoco(x, foco)), [p.lista, foco]);
  const colorTramo = COLOR_TRAMO;
  const Barra = ({ tramos, total }: { tramos: Record<string, number>; total: number }) => (
    <div className="h-2 rounded-full bg-brand-bg overflow-hidden flex" title={TRAMOS.map((t) => `${t} días: ${tramos[t] ?? 0}`).join(" · ")}>
      {TRAMOS.map((t) => <div key={t} style={{ width: `${total ? ((tramos[t] ?? 0) / total) * 100 : 0}%`, background: colorTramo[t] }} />)}
    </div>
  );
  return (
    <Seccion titulo="Pendientes y demora por zona" id="pendientes"
      sub={<>Pedidos <b>en gestión</b> y los <b>días hábiles</b> que llevan desde la venta hasta el corte del {fechaCorta(d.fecha_corte)}: se cuentan los días posteriores a la venta hasta el corte, sin los domingos. Tramos: {TRAMOS.map((t) => <span key={t} className="inline-flex items-center gap-1 ml-2"><span className="w-2 h-2 rounded-full" style={{ background: colorTramo[t] }} />{t} días</span>)}</>}>
      {p.n === 0 ? <div className="text-sm text-brand-mist py-3">No hay pedidos en gestión.</div> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-4">
            <div className="rounded-md bg-brand-bg px-3 py-2"><div className="text-brand-slate">En gestión</div><div className="font-display text-2xl text-brand-ink tabular-nums">{n(p.n)}</div></div>
            <div className="rounded-md bg-brand-bg px-3 py-2"><div className="text-brand-slate">Demora promedio</div><div className="font-display text-2xl text-brand-ink tabular-nums">{dias(p.dias_prom)}</div></div>
            <div className="rounded-md bg-brand-bg px-3 py-2"><div className="text-brand-slate">Más demorado</div><div className="font-display text-2xl text-brand-ink tabular-nums">{dias(p.dias_max)}</div></div>
            <div className="rounded-md bg-brand-bg px-3 py-2"><div className="text-brand-slate">6 días o más</div><div className={`font-display text-2xl tabular-nums ${p.vencidos_6 ? "text-brand-primary" : "text-brand-ink"}`}>{n(p.vencidos_6)} <span className="text-xs font-sans text-brand-slate">({n(p.vencidos_11)} de 11+)</span></div></div>
          </div>
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
                <th className="py-2 pr-3">Zona</th><th className="py-2 px-3 text-right">Pendientes</th><th className="py-2 px-3 text-right">Prom.</th><th className="py-2 px-3 text-right">Máx.</th>
                {TRAMOS.map((t) => <th key={t} className="py-2 px-3 text-right">{t} d</th>)}<th className="py-2 pl-3 w-44">Demora</th>
              </tr></thead>
              <tbody>
                {p.por_zona.map((z) => (
                  <Fragmento key={z.region}>
                    <tr className={`border-b border-brand-border/60 cursor-pointer ${foco?.region === z.region && !foco.departamento ? "bg-brand-orange/10" : "bg-brand-bg-soft"}`} title="Ver los pendientes de esta región">
                      <td className="py-2 pr-3 font-semibold text-brand-ink"><button type="button" className="mr-1 text-brand-slate" aria-label="Desplegar departamentos" onClick={() => setAbierto(abierto === z.region ? null : z.region)}>{abierto === z.region ? "▾" : "▸"}</button><span onClick={() => { setAbierto(z.region); setFoco({ region: z.region }); }}>{z.region}</span></td>
                      <td className="py-2 px-3 text-right tabular-nums font-semibold" onClick={() => setFoco({ region: z.region })}>{n(z.n)}</td><td className="py-2 px-3 text-right tabular-nums" onClick={() => setFoco({ region: z.region })}>{dias(z.dias_prom)}</td><td className="py-2 px-3 text-right tabular-nums" onClick={() => setFoco({ region: z.region })}>{dias(z.dias_max)}</td>
                      {TRAMOS.map((t) => <td key={t} className="py-2 px-3 text-right tabular-nums hover:text-brand-primary" title={`Ver los pendientes de ${t} días`} onClick={() => setFoco({ region: z.region, tramo: t })}>{n(z.tramos[t])}</td>)}
                      <td className="py-2 pl-3" onClick={() => setFoco({ region: z.region })}><Barra tramos={z.tramos} total={z.n} /></td>
                    </tr>
                    {abierto === z.region && z.departamentos.map((dep) => (
                      <tr key={dep.departamento} className={`border-b border-brand-border/40 cursor-pointer ${foco?.departamento === dep.departamento ? "bg-brand-orange/10" : ""}`} title="Ver los pendientes de este departamento">
                        <td className="py-1.5 pr-3 pl-6 text-brand-graphite" onClick={() => setFoco({ region: z.region, departamento: dep.departamento })}>{dep.departamento} <span className="text-xs text-brand-slate">· {dep.ciudades.map((c) => <button key={c.ciudad} type="button" className="hover:text-brand-primary hover:underline mr-1" onClick={(ev) => { ev.stopPropagation(); setFoco({ region: z.region, departamento: dep.departamento, ciudad: c.ciudad }); }}>{c.ciudad} ({c.n})</button>)}</span></td>
                        <td className="py-1.5 px-3 text-right tabular-nums" onClick={() => setFoco({ region: z.region, departamento: dep.departamento })}>{n(dep.n)}</td><td className="py-1.5 px-3 text-right tabular-nums" onClick={() => setFoco({ region: z.region, departamento: dep.departamento })}>{dias(dep.dias_prom)}</td><td className="py-1.5 px-3 text-right tabular-nums" onClick={() => setFoco({ region: z.region, departamento: dep.departamento })}>{dias(dep.dias_max)}</td>
                        {TRAMOS.map((t) => <td key={t} className="py-1.5 px-3 text-right tabular-nums hover:text-brand-primary" onClick={() => setFoco({ region: z.region, departamento: dep.departamento, tramo: t })}>{n(dep.tramos[t])}</td>)}
                        <td className="py-1.5 pl-3" onClick={() => setFoco({ region: z.region, departamento: dep.departamento })}><Barra tramos={dep.tramos} total={dep.n} /></td>
                      </tr>
                    ))}
                  </Fragmento>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid lg:grid-cols-[280px_minmax(0,1fr)] gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mb-1.5">Por motivo</div>
              <ul className="text-sm space-y-1">{p.por_motivo.map((m) => <li key={m.motivo} className="flex justify-between gap-2 border-b border-brand-border/50 py-1"><span className="text-brand-graphite">{m.motivo}</span><span className="tabular-nums whitespace-nowrap"><b>{n(m.n)}</b> <span className="text-brand-slate text-xs">· {dias(m.dias_prom)}</span></span></li>)}</ul>
            </div>
            <div className="min-w-0" id="pendientes-lista">
              <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mb-1.5">Los pedidos pendientes{foco ? ` · ${etiquetaFoco(foco)}` : ""}, del más demorado al más nuevo</div>
              <div className="flex flex-wrap gap-1.5 mb-2 text-xs print:hidden">
                {[{ etiqueta: "6 días o más", minimo: 6 }, { etiqueta: "11 o más", minimo: 11 }].map((q) => (
                  <button key={q.minimo} type="button" aria-pressed={foco?.minimo === q.minimo} className={`rounded-full border px-2.5 py-0.5 font-semibold ${foco?.minimo === q.minimo ? "border-brand-primary bg-brand-primary text-white" : "border-brand-border bg-white text-brand-graphite hover:border-brand-slate"}`}
                    onClick={() => setFoco(foco?.minimo === q.minimo ? { ...foco, minimo: undefined } : { ...(foco ?? {}), tramo: undefined, minimo: q.minimo })}>{q.etiqueta}</button>
                ))}
              </div>
              <ChipsFoco foco={foco} onChange={setFoco} total={p.lista.length} filtrados={lista.length} nombre="pendientes" verTodos="Ver todos los pendientes" />
              <TablaPedidos pedidos={lista} conDias compacta />
            </div>
          </div>
        </>
      )}
    </Seccion>
  );
}

function Fragmento({ children }: { children: ReactNode }) { return <>{children}</>; }

// ------------------------------------------------------------------ tabla de pedidos (detalle completo)
export function TablaPedidos({ pedidos, conDias = true, compacta = false, estados }: { pedidos: Pedido[]; conDias?: boolean; compacta?: boolean; estados?: string[] }) {
  const [ver, setVer] = useState(compacta ? 15 : 50);
  if (!pedidos.length) return <div className="text-sm text-brand-mist py-3">Sin pedidos.</div>;
  const lista = pedidos.slice(0, ver);
  const conEntrega = pedidos.some((p) => p.fecha_entrega);
  return (
    <div className="overflow-x-auto -mx-5 px-5">
      <table className="w-full text-xs min-w-[760px]">
        <thead><tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
          <th className="py-1.5 pr-2">Formulario</th><th className="py-1.5 pr-2">Cliente</th><th className="py-1.5 pr-2">Ciudad</th><th className="py-1.5 pr-2">Región</th>
          <th className="py-1.5 pr-2">Venta</th>{conEntrega && <th className="py-1.5 pr-2">Entrega</th>}{conDias && <th className="py-1.5 pr-2 text-right" title="Días hábiles sin domingos: entregados, de la venta a la entrega; en gestión, de la venta al corte">Días háb.</th>}{estados && <th className="py-1.5 pr-2">Estado</th>}<th className="py-1.5 pr-2">Motivo</th><th className="py-1.5 pr-2">Vendedor</th><th className="py-1.5">Promoción</th>
        </tr></thead>
        <tbody>
          {lista.map((p, i) => (
            <tr key={`${p.formulario}-${i}`} className="border-b border-brand-border/60 align-top">
              <td className="py-1.5 pr-2 font-mono text-[11px] text-brand-graphite">{p.formulario ?? "—"}{p.linea && p.linea !== p.formulario ? <div className="text-brand-mist">{p.linea}</div> : null}</td>
              <td className="py-1.5 pr-2 font-semibold text-brand-ink">{p.cliente ?? "—"}{p.documento && <div className="font-normal text-brand-slate">{p.documento}</div>}</td>
              <td className="py-1.5 pr-2">{p.ciudad ?? "—"}<div className="text-brand-slate">{p.departamento ?? ""}</div></td>
              <td className="py-1.5 pr-2">{p.region}</td>
              <td className="py-1.5 pr-2 tabular-nums whitespace-nowrap">{fechaCorta(p.fecha)}</td>
              {conEntrega && <td className="py-1.5 pr-2 tabular-nums whitespace-nowrap">{p.fecha_entrega ? fechaCorta(p.fecha_entrega) : <span className="text-brand-mist">—</span>}</td>}
              {conDias && <td className={`py-1.5 pr-2 text-right tabular-nums font-semibold ${p.dias >= 11 ? "text-brand-purple" : p.dias >= 6 ? "text-brand-primary" : p.dias >= 3 ? "text-brand-orange" : ""}`}><span title={`${p.hasta === "entrega" ? "de la venta a la entrega" : "de la venta al corte"}${p.dias_corridos !== undefined ? ` · ${n(p.dias_corridos)} días corridos` : ""}`}>{p.estado === EN_GESTION || p.hasta === "entrega" ? n(p.dias) : <span className="text-brand-mist font-normal">{n(p.dias)}</span>}</span></td>}
              {estados && <td className="py-1.5 pr-2"><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="w-2 h-2 rounded-full" style={{ background: colorEstado(p.estado, estados) }} />{etiquetaEstado(p.estado)}</span></td>}
              <td className="py-1.5 pr-2">{p.motivo}</td>
              <td className="py-1.5 pr-2">{p.vendedor ?? "—"}</td>
              <td className="py-1.5">{p.promocion ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pedidos.length > ver && <button type="button" className="mt-2 text-xs font-semibold text-brand-primary" onClick={() => setVer((v) => v + (compacta ? 30 : 100))}>Ver más ({n(pedidos.length - ver)} restantes)</button>}
    </div>
  );
}

export function DataCompleta({ d, filtro }: { d: DatosLogistica; filtro: Filtro }) {
  const [q, setQ] = useState("");
  const [region, setRegion] = useState<string>("todas");
  const filas = useMemo(() => {
    const t = q.trim().toUpperCase();
    return d.pedidos.filter((p) => (filtro === "todos" || p.estado === filtro) && (region === "todas" || p.region === region) &&
      (!t || [p.formulario, p.cliente, p.documento, p.ciudad, p.departamento, p.vendedor, p.motivo, p.promocion, p.linea].some((v) => (v ?? "").toUpperCase().includes(t))));
  }, [d.pedidos, filtro, region, q]);
  const descargar = () => {
    const cols = ["formulario", "linea", "documento", "cliente", "ciudad", "departamento", "region", "fecha", "fecha_entrega", "vendedor", "promocion", "estado", "motivo", "dias", "dias_corridos"] as const;
    const esc = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = "﻿" + [cols.join(";"), ...filas.map((p) => cols.map((c) => esc(p[c])).join(";"))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `logistica_${d.periodo}_${filtro === "todos" ? "todos" : filtro.toLowerCase().replace(" ", "_")}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <Seccion titulo="Data completa" id="pedidos" sub={`Todos los pedidos del corte${filtro === "todos" ? "" : ` en estado ${etiquetaEstado(filtro).toLowerCase()}`}, con búsqueda por formulario, cliente, documento, ciudad, vendedor o motivo.`}
      accion={<div className="flex flex-wrap items-center gap-2">
        <select className="input !py-1.5 text-xs w-auto" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Región"><option value="todas">Todas las regiones</option>{d.regiones.map((r) => <option key={r} value={r}>{r}</option>)}</select>
        <input className="input !py-1.5 text-xs w-56" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar pedidos" />
        <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={descargar}>Descargar CSV</button>
      </div>}>
      <div className="text-xs text-brand-slate mb-2">{n(filas.length)} pedido(s)</div>
      <TablaPedidos pedidos={filas} estados={d.estados} />
    </Seccion>
  );
}

// ------------------------------------------------------------------ vendedores y promociones
export function Vendedores({ d, filtro }: { d: DatosLogistica; filtro: Filtro }) {
  const [ver, setVer] = useState(12);
  const filas = [...d.vendedores].sort((a, b) => (filtro === "todos" ? b.total - a.total : (b.estados[filtro] ?? 0) - (a.estados[filtro] ?? 0)));
  const cols = filtro === "todos" ? d.estados : [filtro];
  return (
    <Seccion titulo="Vendedores" sub={filtro === "todos" ? "Pedidos de cada vendedor y en qué estado están." : `Vendedores con más pedidos ${etiquetaEstado(filtro).toLowerCase()}.`}>
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
            <th className="py-2 pr-3">Vendedor</th>{cols.map((e) => <th key={e} className="py-2 px-3 text-right">{etiquetaEstado(e)}</th>)}<th className="py-2 px-3 text-right">Total</th><th className="py-2 pl-3 text-right">% entregado</th>
          </tr></thead>
          <tbody>
            {filas.slice(0, ver).map((v) => (
              <tr key={v.vendedor} className="border-b border-brand-border/60">
                <td className="py-1.5 pr-3 font-semibold text-brand-ink">{v.vendedor}</td>
                {cols.map((e) => <td key={e} className="py-1.5 px-3 text-right tabular-nums">{n(v.estados[e] ?? 0)}</td>)}
                <td className="py-1.5 px-3 text-right tabular-nums font-semibold">{n(v.total)}</td>
                <td className={`py-1.5 pl-3 text-right tabular-nums ${(v.pct[ENTREGADO] ?? 100) < 70 ? "text-brand-primary font-semibold" : ""}`}>{pct(v.pct[ENTREGADO])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filas.length > ver && <button type="button" className="mt-2 text-xs font-semibold text-brand-primary" onClick={() => setVer(filas.length)}>Ver los {n(filas.length)} vendedores</button>}
      </div>
    </Seccion>
  );
}
