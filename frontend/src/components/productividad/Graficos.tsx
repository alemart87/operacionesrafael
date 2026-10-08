"use client";

import { useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  BANDA, etiquetaTramo, fechaCorta, horas, medida, n, pct,
  type Agente, type DiaSerie, type InfoContacto, type Parametros, type Tramo, type TramoExtremo,
} from "./tipos";

// Contactos (lo importante) en cian; el resto de las llamadas, gris de contexto.
const C_CONTACTO = "#00B2BF";
const C_RESTO = "#C9CDD6";
const C_INK = "#0F1116";
const EJE = { fontSize: 11, fill: "#5B6275" };
const tooltipStyle = { fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb", boxShadow: "0 4px 12px rgba(0,0,0,.08)" };
const leyenda = (v: string) => <span style={{ color: "#2A2F3A" }}>{v}</span>;

function Panel({ titulo, sub, children, alto = "h-64" }: { titulo: string; sub?: string; children: React.ReactNode; alto?: string }) {
  return (
    <section className="card p-5 min-w-0">
      <h3 className="font-display text-base uppercase text-brand-ink leading-tight">{titulo}</h3>
      {sub && <p className="text-xs text-brand-slate mt-0.5">{sub}</p>}
      <div className={`${alto} mt-3`}>{children}</div>
    </section>
  );
}

/** Barras del % de conversación coloreadas por banda, con la franja de la meta y la línea del rojo. */
function BarrasMeta({ datos, p, x }: { datos: { etiqueta: string; pct: number | null; banda: string | null }[]; p: Parametros; x: string }) {
  const tope = Math.max(60, Math.ceil((Math.max(...datos.map((d) => d.pct ?? 0)) + 5) / 10) * 10);
  return (
    <ResponsiveContainer>
      <BarChart data={datos} margin={{ left: -14, right: 64, top: 16, bottom: 0 }} barCategoryGap="18%">
        <CartesianGrid vertical={false} stroke="#eef0f4" />
        <ReferenceArea y1={p.meta_min} y2={p.meta_max} fill={BANDA.meta.color} fillOpacity={0.08} stroke="none" ifOverflow="extendDomain" />
        <ReferenceLine y={p.rojo} stroke={BANDA.rojo.color} strokeWidth={1} label={{ value: `Rojo ${p.rojo}%`, position: "right", fontSize: 10, fill: BANDA.rojo.color }} />
        <ReferenceLine y={p.meta_min} stroke={BANDA.meta.color} strokeWidth={1} label={{ value: `Meta ${p.meta_min}%`, position: "right", fontSize: 10, fill: "#047857" }} />
        <ReferenceLine y={p.meta_max} stroke={BANDA.meta.color} strokeWidth={1} strokeOpacity={0.5} label={{ value: `${p.meta_max}%`, position: "right", fontSize: 10, fill: "#047857" }} />
        <XAxis dataKey={x} tick={EJE} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
        <YAxis domain={[0, tope]} tickFormatter={(v) => `${v}%`} tick={EJE} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,.04)" }} formatter={(v: number) => [pct(v), "% de conversación"]} />
        <Bar dataKey="pct" name="% de conversación" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
          {datos.map((d, i) => <Cell key={i} fill={d.banda ? BANDA[d.banda as keyof typeof BANDA].color : "#C9CDD6"} />)}
          <LabelList dataKey="pct" position="top" formatter={(v: number) => (v === null || v === undefined ? "" : `${Math.round(v)}%`)} style={{ fontSize: 10, fill: C_INK }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ------------------------------------------------------------------ intradía (tramos entre cortes)
export function CurvasTramos({ tramos, p, contacto, promedioContacto, mejor, peor, acumulado }: {
  tramos: Tramo[]; p: Parametros; contacto: InfoContacto; promedioContacto: number | null;
  mejor: TramoExtremo | null; peor: TramoExtremo | null; acumulado?: boolean;
}) {
  const datos = tramos.map((t) => ({
    etiqueta: etiquetaTramo(t), contactos: t.atendidas, resto: Math.max(t.llamadas - t.atendidas, 0), llamadas: t.llamadas,
    contacto: t.pct_contacto, pct: t.pct_conversacion, banda: t.banda, mejor: mejor?.desde === t.desde && mejor?.hasta === t.hasta,
    porHora: t.llamadas_hora,
  }));
  const m = medida(contacto);
  return (
    <div className="space-y-5">
      <div className="grid xl:grid-cols-2 gap-5">
        {m.exacto ? (
          <Panel titulo="Llamadas por horario" sub={`${m.rotulo} y el resto de las llamadas de cada tramo${acumulado ? ", sumando los días del período" : ""}.`}>
            <ResponsiveContainer>
              <BarChart data={datos} margin={{ left: -10, right: 8, top: 8, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid vertical={false} stroke="#eef0f4" />
                <XAxis dataKey="etiqueta" tick={EJE} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
                <YAxis allowDecimals={false} tick={EJE} axisLine={false} tickLine={false} tickFormatter={(v) => n(v)} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,.04)" }} formatter={(v: number, name: string) => [n(v), name]} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={leyenda} />
                <Bar dataKey="contactos" name={m.rotulo} stackId="a" fill={C_CONTACTO} stroke="#fff" strokeWidth={1} isAnimationActive={false} />
                <Bar dataKey="resto" name={m.resto} stackId="a" fill={C_RESTO} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        ) : (
          <Panel titulo="Llamadas por horario" sub={`Llamadas de cada tramo${acumulado ? ", sumando los días del período" : ""}.`}>
            <ResponsiveContainer>
              <BarChart data={datos} margin={{ left: -10, right: 8, top: 16, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid vertical={false} stroke="#eef0f4" />
                <XAxis dataKey="etiqueta" tick={EJE} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
                <YAxis allowDecimals={false} tick={EJE} axisLine={false} tickLine={false} tickFormatter={(v) => n(v)} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,.04)" }} formatter={(v: number) => [n(v), "Llamadas"]} />
                <Bar dataKey="llamadas" name="Llamadas" fill={C_CONTACTO} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                  <LabelList dataKey="llamadas" position="top" formatter={(v: number) => n(v)} style={{ fontSize: 10, fill: C_INK }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        )}
        {m.exacto ? (
          <Panel titulo="Efectividad de contacto por horario" sub={`% de ${m.explicacion}. La línea es el promedio${acumulado ? " del período" : " del día"}.`}>
            <ResponsiveContainer>
              <BarChart data={datos} margin={{ left: -14, right: 76, top: 16, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid vertical={false} stroke="#eef0f4" />
                <XAxis dataKey="etiqueta" tick={EJE} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={EJE} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,.04)" }} formatter={(v: number) => [pct(v), m.pct]} />
                {promedioContacto !== null && (
                  <ReferenceLine y={promedioContacto} stroke={C_INK} strokeWidth={1} label={{ value: `Prom. ${pct(promedioContacto)}`, position: "right", fontSize: 10, fill: C_INK }} />
                )}
                <Bar dataKey="contacto" name={m.pct} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                  {datos.map((d, i) => <Cell key={i} fill={d.mejor ? "#007A83" : C_CONTACTO} />)}
                  <LabelList dataKey="contacto" position="top" formatter={(v: number) => (v === null || v === undefined ? "" : `${Math.round(v)}%`)} style={{ fontSize: 10, fill: C_INK }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        ) : (
          <Panel titulo="Llamadas por hora conectada" sub="Ritmo de discado de cada tramo: llamadas ÷ horas conectadas de los agentes activos. El contacto por horario aparece cuando el reporte lo permita.">
            <ResponsiveContainer>
              <BarChart data={datos} margin={{ left: -14, right: 8, top: 16, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid vertical={false} stroke="#eef0f4" />
                <XAxis dataKey="etiqueta" tick={EJE} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
                <YAxis allowDecimals={false} tick={EJE} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,.04)" }} formatter={(v: number) => [v?.toLocaleString("es-PY"), "Llamadas por hora conectada"]} />
                <Bar dataKey="porHora" name="Llamadas por hora conectada" fill={C_INK} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                  <LabelList dataKey="porHora" position="top" formatter={(v: number) => (v === null || v === undefined ? "" : Math.round(v))} style={{ fontSize: 10, fill: C_INK }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        )}
      </div>
      <Panel titulo="% de conversación por horario" sub={`Conversación ÷ tiempo conectado en cada tramo. Meta ${p.meta_min}–${p.meta_max}%; debajo de ${p.rojo}%, rojo.`}>
        <BarrasMeta datos={datos} p={p} x="etiqueta" />
      </Panel>

      <section className="card p-5 min-w-0">
        <h3 className="font-display text-base uppercase text-brand-ink leading-tight">Detalle por tramo</h3>
        <p className="text-xs text-brand-slate mt-0.5">
          Cada tramo es lo que pasó entre un corte y el siguiente{acumulado ? " (sumando los días del período que tienen ese tramo)" : ""}.
          {m.exacto && mejor && <> Mayor efectividad: <b className="text-emerald-700">{mejor.desde}–{mejor.hasta} ({pct(mejor.pct_contacto)})</b>.</>}
          {m.exacto && peor && <> Menor: <b className="text-brand-primary-dark">{peor.desde}–{peor.hasta} ({pct(peor.pct_contacto)})</b>.</>}
        </p>
        <div className="overflow-x-auto -mx-5 px-5 mt-3">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border text-right">
                <th className="text-left py-2 font-semibold">Tramo</th>
                {acumulado && <th className="py-2 px-3 font-semibold">Días</th>}
                <th className="py-2 px-3 font-semibold">Agentes activos</th>
                <th className="py-2 px-3 font-semibold">Llamadas</th>
                {m.exacto && <th className="py-2 px-3 font-semibold">{m.corto}</th>}
                {m.exacto && <th className="py-2 px-3 font-semibold">{m.pctCorto}</th>}
                <th className="py-2 px-3 font-semibold">Conversación</th>
                <th className="py-2 px-3 font-semibold">% Conversación</th>
                <th className="py-2 pl-3 font-semibold">Llamadas por hora</th>
              </tr>
            </thead>
            <tbody>
              {tramos.map((t) => (
                <tr key={`${t.desde}-${t.hasta}`} className="border-b border-brand-border/60 last:border-0 text-right tabular-nums">
                  <td className="text-left py-2 font-semibold text-brand-ink whitespace-nowrap">{etiquetaTramo(t)}</td>
                  {acumulado && <td className="py-2 px-3">{n(t.dias)}</td>}
                  <td className="py-2 px-3">{t.agentes_activos === null ? "—" : t.agentes_activos.toLocaleString("es-PY")}</td>
                  <td className="py-2 px-3 font-semibold">{n(t.llamadas)}</td>
                  {m.exacto && <td className="py-2 px-3">{n(t.atendidas)}</td>}
                  {m.exacto && <td className="py-2 px-3">{pct(t.pct_contacto)}</td>}
                  <td className="py-2 px-3">{horas(t.conversacion)}</td>
                  <td className="py-2 px-3">{pct(t.pct_conversacion)}</td>
                  <td className="py-2 pl-3">{t.llamadas_hora === null ? "—" : t.llamadas_hora.toLocaleString("es-PY")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/**
 * Asesor × tramo. Con contacto válido: % de contacto (más intenso = más efectivo). Sin él: % de
 * conversación de cada asesor en cada horario, con el color de su banda frente a la meta.
 */
export function MapaContacto({ agentes, tramos, p, contacto }: { agentes: Agente[]; tramos: Tramo[]; p: Parametros; contacto: InfoContacto }) {
  const m = medida(contacto);
  const filas = useMemo(() => agentes
    .filter((a) => a.tramos.length === tramos.length && a.llamadas > 0 && !a.alertas.includes("sesion_abierta"))
    .sort((a, b) => ((m.exacto ? b.pct_contacto : b.pct_conversacion) ?? 0) - ((m.exacto ? a.pct_contacto : a.pct_conversacion) ?? 0)),
  [agentes, tramos.length, m.exacto]);
  if (!filas.length) return null;
  const minimo = 5;          // llamadas mínimas en el tramo para mostrar el % de contacto
  const minimoLogin = 600;   // 10 minutos conectado en el tramo para mostrar el % de conversación
  return (
    <section className="card p-5 min-w-0">
      <h3 className="font-display text-base uppercase text-brand-ink leading-tight">{m.exacto ? "Efectividad por asesor y horario" : "Conversación por asesor y horario"}</h3>
      <p className="text-xs text-brand-slate mt-0.5">
        {m.exacto
          ? <>% de contacto (≥ {m.regla} s) de cada asesor en cada tramo. Más intenso = más efectivo. Celdas con menos de {minimo} llamadas, en gris.</>
          : <>% de conversación de cada asesor en cada tramo (conversación ÷ tiempo conectado), con el color de la meta. Celdas con menos de 10 minutos conectado, en gris.</>}
      </p>
      <div className="overflow-auto max-h-[70vh] -mx-5 px-5 mt-3">
        <table className="text-xs border-separate border-spacing-[2px]">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="text-[10px] uppercase tracking-wider2 text-brand-slate">
              <th className="text-left font-semibold pr-3 py-1 sticky left-0 bg-white">Asesor</th>
              {tramos.map((t) => <th key={`${t.desde}-${t.hasta}`} className="font-semibold px-1 py-1 whitespace-nowrap min-w-[64px]">{etiquetaTramo(t)}</th>)}
              <th className="font-semibold px-2 py-1 text-right">Día</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((a) => (
              <tr key={a.clave}>
                <td className="pr-3 py-0.5 font-semibold text-brand-ink whitespace-nowrap sticky left-0 bg-white">{a.nombre}</td>
                {a.tramos.map(([llamadas, contactos, conversacion, login], i) => {
                  if (m.exacto) {
                    const v = llamadas ? (contactos / llamadas) * 100 : null;
                    const poco = !llamadas || llamadas < minimo;
                    return (
                      <td key={i} title={llamadas ? `${a.nombre} · ${etiquetaTramo(tramos[i])}: ${n(contactos)} contactos de ${n(llamadas)} llamadas` : "Sin llamadas"}
                        className="text-center tabular-nums rounded px-1 py-1"
                        style={poco ? { background: "#F6F7FB", color: "#9CA3AF" } : { background: `rgba(0,178,191,${0.12 + 0.75 * ((v ?? 0) / 100)})`, color: (v ?? 0) > 60 ? "#fff" : C_INK }}>
                        {llamadas ? `${Math.round(v ?? 0)}%` : "·"}
                      </td>
                    );
                  }
                  const v = login ? (conversacion / login) * 100 : null;
                  const b = login >= minimoLogin ? bandaDe(v, p) : null;
                  return (
                    <td key={i} title={login ? `${a.nombre} · ${etiquetaTramo(tramos[i])}: ${Math.round(v ?? 0)}% de conversación · ${n(llamadas)} llamadas` : "No estuvo conectado"}
                      className="text-center tabular-nums rounded px-1 py-1"
                      style={b ? { background: `${BANDA[b].color}26`, color: C_INK } : { background: "#F6F7FB", color: "#9CA3AF" }}>
                      {login ? `${Math.round(v ?? 0)}%` : "·"}
                    </td>
                  );
                })}
                <td className="px-2 py-0.5 text-right tabular-nums font-semibold">{pct(m.exacto ? a.pct_contacto : a.pct_conversacion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {m.exacto ? (
        <div className="flex items-center gap-2 mt-3 text-[10px] text-brand-slate">
          0%
          <span className="h-2 w-40 rounded-full" style={{ background: "linear-gradient(90deg, rgba(0,178,191,.12), rgba(0,178,191,.87))" }} />
          100% de contacto
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 mt-3 text-[10px] text-brand-slate">
          {(["rojo", "bajo", "meta", "sobre"] as const).map((b) => (
            <span key={b} className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded" style={{ background: `${BANDA[b].color}26`, border: `1px solid ${BANDA[b].color}` }} />
              {BANDA[b].nombre}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function bandaDe(v: number | null, p: Parametros): "rojo" | "bajo" | "meta" | "sobre" | null {
  if (v === null) return null;
  if (v < p.rojo) return "rojo";
  if (v < p.meta_min) return "bajo";
  if (v <= p.meta_max) return "meta";
  return "sobre";
}

// ------------------------------------------------------------------ acumulado: curvas por día
export function CurvasDias({ dias, p, contacto }: { dias: DiaSerie[]; p: Parametros; contacto: InfoContacto }) {
  const datos = dias.map((d) => ({
    etiqueta: fechaCorta(d.fecha), contactos: d.atendidas, resto: Math.max(d.llamadas - d.atendidas, 0), llamadas: d.llamadas,
    contacto: d.pct_contacto, pct: d.pct_conversacion, banda: d.banda, agentes: d.agentes, jornada: d.jornada_media,
  }));
  const m = medida(contacto);
  return (
    <div className="space-y-5">
      <div className="grid xl:grid-cols-2 gap-5">
        {m.exacto ? (
          <Panel titulo="Llamadas por día" sub={`${m.rotulo} y el resto de las llamadas de cada día publicado.`}>
            <ResponsiveContainer>
              <BarChart data={datos} margin={{ left: -6, right: 8, top: 8, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid vertical={false} stroke="#eef0f4" />
                <XAxis dataKey="etiqueta" tick={EJE} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
                <YAxis allowDecimals={false} tick={EJE} axisLine={false} tickLine={false} tickFormatter={(v) => n(v)} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,.04)" }} formatter={(v: number, name: string) => [n(v), name]} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={leyenda} />
                <Bar dataKey="contactos" name={m.rotulo} stackId="a" fill={C_CONTACTO} stroke="#fff" strokeWidth={1} isAnimationActive={false} />
                <Bar dataKey="resto" name={m.resto} stackId="a" fill={C_RESTO} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        ) : (
          <Panel titulo="Llamadas por día" sub="Llamadas de cada día publicado.">
            <ResponsiveContainer>
              <BarChart data={datos} margin={{ left: -6, right: 8, top: 16, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid vertical={false} stroke="#eef0f4" />
                <XAxis dataKey="etiqueta" tick={EJE} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
                <YAxis allowDecimals={false} tick={EJE} axisLine={false} tickLine={false} tickFormatter={(v) => n(v)} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,.04)" }} formatter={(v: number) => [n(v), "Llamadas"]} />
                <Bar dataKey="llamadas" name="Llamadas" fill={C_CONTACTO} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
                  <LabelList dataKey="llamadas" position="top" formatter={(v: number) => n(v)} style={{ fontSize: 10, fill: C_INK }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        )}
        {m.exacto ? (
          <Panel titulo="Efectividad de contacto por día" sub={`% de ${m.explicacion}.`}>
            <ResponsiveContainer>
              <LineChart data={datos} margin={{ left: -14, right: 12, top: 16, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#eef0f4" />
                <XAxis dataKey="etiqueta" tick={EJE} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={EJE} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [pct(v), m.pct]} />
                <Line dataKey="contacto" name={m.pct} stroke={C_CONTACTO} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#fff", fill: C_CONTACTO }} isAnimationActive={false}>
                  <LabelList dataKey="contacto" position="top" formatter={(v: number) => (v === null || v === undefined ? "" : `${Math.round(v)}%`)} style={{ fontSize: 10, fill: C_INK }} />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </Panel>
        ) : (
          <Panel titulo="Agentes conectados por día" sub="Cantidad de agentes con login en cada día publicado.">
            <ResponsiveContainer>
              <BarChart data={datos} margin={{ left: -14, right: 8, top: 16, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid vertical={false} stroke="#eef0f4" />
                <XAxis dataKey="etiqueta" tick={EJE} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
                <YAxis allowDecimals={false} tick={EJE} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,.04)" }} formatter={(v: number) => [n(v), "Agentes"]} />
                <Bar dataKey="agentes" name="Agentes conectados" fill={C_INK} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
                  <LabelList dataKey="agentes" position="top" formatter={(v: number) => n(v)} style={{ fontSize: 10, fill: C_INK }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        )}
      </div>
      <Panel titulo="% de conversación por día" sub={`Conversación ÷ tiempo conectado del equipo. Meta ${p.meta_min}–${p.meta_max}%; debajo de ${p.rojo}%, rojo.`}>
        <BarrasMeta datos={datos} p={p} x="etiqueta" />
      </Panel>
    </div>
  );
}

/** Texto de ayuda cuando no hay tramos: cómo conseguir la curva por horario. */
export function SinTramos({ cortes }: { cortes: number }) {
  return (
    <section className="card p-8 text-center max-w-3xl mx-auto">
      <h3 className="font-display text-xl uppercase text-brand-ink">Curva por horario</h3>
      <p className="text-sm text-brand-slate mt-2 leading-relaxed">
        {cortes <= 1 ? "Este día tiene un solo corte" : "Todavía no hay tramos"}: con un único archivo se ve el total del día, pero no cómo se repartió por hora.
        Subí el mismo reporte <b>Tiempos Acumulados</b> varias veces en el día (lo ideal, <b>cada hora</b>; como mínimo a las 13:00 y al cierre).
        Cada archivo es un corte y el sistema calcula lo que pasó entre uno y el siguiente: llamadas, contacto y conversación por horario, y los turnos.
      </p>
      <p className="text-xs text-brand-mist mt-3">La fecha y la hora de cada corte se toman del nombre del archivo.</p>
    </section>
  );
}

