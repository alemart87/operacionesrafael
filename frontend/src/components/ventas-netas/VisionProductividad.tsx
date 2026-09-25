"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiCard } from "@/components/KpiCard";
import { ESTADO_SDS_LABEL, fechaCorta, n, pct, type InformeData, type Productividad } from "./tipos";
import { Seccion, Tabla } from "./ui";

// Paletas validadas (ΔE CVD ≥ 15 en pares adyacentes); el contraste bajo se cubre con etiquetas y tablas.
const C_ESTADO: Record<string, string> = { Vta_Finalizada: "#00B2BF", Vta_A_Confirmar: "#F39200", Vta_Procesado: "#7B3FA0", Vta_Rechazada: "#E6332A" };
const C_PRODUCTO: Record<string, string> = { Pospago: "#7B3FA0", Internet: "#00B2BF", IPTV: "#F39200" };
const C_ZONA = { capital_central: "#7B3FA0", interior: "#00B2BF" };
const PROD_LABEL: Record<string, string> = { Pospago: "Pospago", Internet: "Internet (IF)", IPTV: "IPTV" };

const tooltipStyle = { fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb", boxShadow: "0 4px 12px rgba(0,0,0,.08)" };
const dd = (iso: string) => iso.slice(8, 10);
const estadoLabel = (e: string) => ESTADO_SDS_LABEL[e] ?? e;

type Serie = "estados" | "productos" | "zonas";

/** Productividad diaria (hoja CARGAS): evolutivo de ventas, estados, Pospago vs Internet y zonas. */
export function VisionProductividad({ d }: { d: InformeData }) {
  const p: Productividad = d.productividad!;
  const k = p.kpis;
  const [serie, setSerie] = useState<Serie>("estados");
  const [zonaVend, setZonaVend] = useState<"todas" | "capital_central" | "interior">("todas");
  const [q, setQ] = useState("");

  const porDia = useMemo(() => p.por_dia.map((f) => ({ ...f, diaCorto: dd(f.dia) })), [p.por_dia]);
  const vendedores = useMemo(
    () => p.por_vendedor.filter((v) => (!q || v.vendedor.toLowerCase().includes(q.toLowerCase())) && (zonaVend === "todas" || (v[zonaVend] as number) > 0)),
    [p.por_vendedor, q, zonaVend],
  );
  const topVend = useMemo(() => vendedores.slice(0, 15).map((v) => ({ ...v, nombre: v.vendedor.length > 26 ? v.vendedor.slice(0, 25) + "…" : v.vendedor })), [vendedores]);
  const interior = p.por_departamento.filter((x) => x.zona === "Interior");
  const zonaCC = p.por_zona.find((z) => z.zona === "Capital y Central");
  const zonaInt = p.por_zona.find((z) => z.zona === "Interior");

  const colsProd = (extra: { key: string; label: string }[] = []) => [
    ...extra,
    { key: "total", label: "Cargas", align: "right" as const, render: (r: any) => <b>{n(r.total)}</b> },
    ...p.estados.map((e) => ({ key: e, label: estadoLabel(e), align: "right" as const, render: (r: any) => n(r[e]) })),
    { key: "pct_finalizacion", label: "% final.", align: "right" as const, render: (r: any) => pct(r.pct_finalizacion) },
    { key: "pospago", label: "Pospago", align: "right" as const, render: (r: any) => n(r.pospago) },
    { key: "internet", label: "Internet (IF)", align: "right" as const, render: (r: any) => n(r.internet) },
    { key: "iptv", label: "IPTV", align: "right" as const, render: (r: any) => n(r.iptv) },
  ];
  const colsZona = [
    { key: "capital_central", label: "Cap. y Central", align: "right" as const, render: (r: any) => n(r.capital_central) },
    { key: "interior", label: "Interior", align: "right" as const, render: (r: any) => n(r.interior) },
  ];

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Ventas cargadas" value={n(k.cargas)} hint={`${n(k.pospago)} Pospago · ${n(k.internet)} Internet (IF) · ${n(k.iptv)} IPTV`} accent="secondary" />
        <KpiCard label="Finalizadas" value={pct(k.pct_finalizacion)} hint={`${n(k.finalizadas)} finalizadas · ${n(k.a_confirmar)} a confirmar · ${n(k.rechazadas)} rechazadas`} accent="cyan" />
        <KpiCard label="Promedio diario" value={n(k.promedio_diario)} hint={`${n(k.dias_con_cargas)} días con cargas · mejor día ${fechaCorta(k.mejor_dia)} (${n(k.mejor_dia_total)})`} accent="purple" />
        <KpiCard label="Interior" value={pct(k.pct_interior)} hint={`${n(k.interior)} Interior · ${n(k.capital_central)} Capital y Central`} accent="orange" />
      </div>

      {/* Evolutivo diario */}
      <Seccion
        titulo="Evolutivo de ventas"
        sub={`Cargas por día de alta de la venta · corte al ${fechaCorta(k.fecha_dato)}`}
        accion={
          <div className="flex gap-1 no-print">
            {([["estados", "Estados"], ["productos", "Pospago / Internet"], ["zonas", "Zonas"]] as [Serie, string][]).map(([v, l]) => (
              <button key={v} onClick={() => setSerie(v)} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${serie === v ? "bg-brand-ink text-white" : "text-brand-slate hover:bg-brand-bg"}`}>{l}</button>
            ))}
          </div>
        }
      >
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={porDia} margin={{ left: 0, right: 8, top: 16, bottom: 0 }} barCategoryGap={3}>
              <CartesianGrid vertical={false} stroke="#eef0f3" />
              <XAxis dataKey="diaCorto" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} width={32} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,.04)" }} labelFormatter={(l) => `Día ${l}`} />
              <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              {serie === "estados" && p.estados.map((e, i) => (
                <Bar key={e} dataKey={e} name={estadoLabel(e)} stackId="a" fill={C_ESTADO[e] ?? "#9ca3af"} radius={i === p.estados.length - 1 ? [4, 4, 0, 0] : 0}>
                  {i === p.estados.length - 1 && <LabelList dataKey="total" position="top" style={{ fontSize: 10, fill: "#111827" }} />}
                </Bar>
              ))}
              {serie === "productos" && p.productos.map((pr, i) => (
                <Bar key={pr} dataKey={pr.toLowerCase()} name={PROD_LABEL[pr] ?? pr} stackId="a" fill={C_PRODUCTO[pr]} radius={i === p.productos.length - 1 ? [4, 4, 0, 0] : 0}>
                  {i === p.productos.length - 1 && <LabelList dataKey="total" position="top" style={{ fontSize: 10, fill: "#111827" }} />}
                </Bar>
              ))}
              {serie === "zonas" && (
                <>
                  <Bar dataKey="capital_central" name="Capital y Central" stackId="a" fill={C_ZONA.capital_central} />
                  <Bar dataKey="interior" name="Interior" stackId="a" fill={C_ZONA.interior} radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="total" position="top" style={{ fontSize: 10, fill: "#111827" }} />
                  </Bar>
                </>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="h-40 mt-2">
          <ResponsiveContainer>
            <LineChart data={porDia} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#eef0f3" />
              <XAxis dataKey="diaCorto" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} width={40} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => `Día ${l}`} formatter={(v: number) => [n(v), "Acumulado"]} />
              <Line type="monotone" dataKey="acumulado" name="Acumulado del mes" stroke="#0F1116" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4">
          <Tabla
            cols={[{ key: "dia", label: "Día", render: (r: any) => fechaCorta(r.dia) }, ...colsProd(), ...colsZona, { key: "acumulado", label: "Acum.", align: "right", render: (r: any) => n(r.acumulado) }]}
            rows={porDia}
            maxAlto="max-h-80"
          />
        </div>
      </Seccion>

      {/* Estados en general + productos */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Seccion titulo="Estados de las ventas" sub="Todas las cargas del mes">
          <div className="h-40">
            <ResponsiveContainer>
              <BarChart data={p.por_estado.map((e) => ({ ...e, label: estadoLabel(e.estado) }))} layout="vertical" margin={{ left: 8, right: 56, top: 4, bottom: 4 }} barCategoryGap={6}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="label" width={84} tick={{ fontSize: 12, fill: "#4b5563" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, _n, item: any) => [`${n(v)} (${pct(item.payload.pct)})`, "Cargas"]} cursor={{ fill: "rgba(0,0,0,.04)" }} />
                <Bar dataKey="total" radius={[0, 4, 4, 0]} maxBarSize={20} fill="#0F1116">
                  <LabelList dataKey="total" position="right" formatter={(v: number) => n(v)} style={{ fontSize: 12, fill: "#111827" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Tabla
            cols={[
              { key: "label", label: "Estado", render: (r: any) => <span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: C_ESTADO[r.estado] ?? "#9ca3af" }} />{estadoLabel(r.estado)}</span> },
              { key: "total", label: "Cargas", align: "right", render: (r: any) => n(r.total) },
              { key: "pct", label: "%", align: "right", render: (r: any) => pct(r.pct) },
            ]}
            rows={p.por_estado}
          />
        </Seccion>

        <Seccion titulo="Pospago vs. Internet (IF)" sub="Estados y zonas por tipo de negocio">
          <Tabla
            cols={[
              { key: "producto", label: "Negocio", render: (r: any) => <span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: C_PRODUCTO[r.producto] }} /><b>{PROD_LABEL[r.producto] ?? r.producto}</b></span> },
              { key: "total", label: "Cargas", align: "right", render: (r: any) => <b>{n(r.total)}</b> },
              ...p.estados.map((e) => ({ key: e, label: estadoLabel(e), align: "right" as const, render: (r: any) => n(r[e]) })),
              { key: "pct_finalizacion", label: "% final.", align: "right", render: (r: any) => pct(r.pct_finalizacion) },
              ...colsZona,
            ]}
            rows={p.por_producto}
          />
        </Seccion>
      </div>

      {/* Zonas */}
      <Seccion titulo="Zonas de venta" sub="Capital y Central por un lado, Interior por el otro (departamento de facturación del cliente)">
        <div className="grid sm:grid-cols-2 gap-4 mb-5">
          {[zonaCC, zonaInt].map((z, i) => z && (
            <div key={z.zona} className="rounded-lg border border-brand-border p-4 border-l-[3px]" style={{ borderLeftColor: i === 0 ? C_ZONA.capital_central : C_ZONA.interior }}>
              <div className="flex items-baseline justify-between">
                <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">{z.zona}</div>
                <div className="text-xs text-brand-slate">{pct(Math.round((z.total / Math.max(k.cargas, 1)) * 1000) / 10)} del total</div>
              </div>
              <div className="font-display text-3xl text-brand-ink mt-1">{n(z.total)}</div>
              <div className="text-xs text-brand-slate mt-1">
                {n(z.finalizadas)} finalizadas ({pct(z.pct_finalizacion)}) · {n(z.pospago)} Pospago · {n(z.internet)} Internet · {n(z.iptv)} IPTV
              </div>
            </div>
          ))}
        </div>
        <div className="grid lg:grid-cols-2 gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mb-1">Departamentos</div>
            <Tabla
              cols={[
                { key: "departamento", label: "Departamento", render: (r: any) => <>{r.departamento} <span className="text-brand-mist text-xs">{r.zona === "Interior" ? "Interior" : "Cap./Central"}</span></> },
                ...colsProd().filter((c) => !["iptv"].includes(c.key)),
              ]}
              rows={p.por_departamento}
              maxAlto="max-h-96"
            />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mb-1">Interior por departamento</div>
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={interior.slice(0, 12)} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }} barCategoryGap={4}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="departamento" width={100} tick={{ fontSize: 11, fill: "#4b5563" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,.04)" }} />
                  <Bar dataKey="pospago" name="Pospago" stackId="a" fill={C_PRODUCTO.Pospago} />
                  <Bar dataKey="internet" name="Internet (IF)" stackId="a" fill={C_PRODUCTO.Internet} />
                  <Bar dataKey="iptv" name="IPTV" stackId="a" fill={C_PRODUCTO.IPTV} radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="total" position="right" formatter={(v: number) => n(v)} style={{ fontSize: 11, fill: "#111827" }} />
                  </Bar>
                  <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mt-4 mb-1">Ciudades con más cargas</div>
            <Tabla
              cols={[
                { key: "ciudad", label: "Ciudad", render: (r: any) => <>{r.ciudad} <span className="text-brand-mist text-xs">{r.zona === "Interior" ? "Interior" : "Cap./Central"}</span></> },
                { key: "total", label: "Cargas", align: "right", render: (r: any) => n(r.total) },
                { key: "pct_finalizacion", label: "% final.", align: "right", render: (r: any) => pct(r.pct_finalizacion) },
              ]}
              rows={p.por_ciudad.slice(0, 10)}
            />
          </div>
        </div>
      </Seccion>

      {/* Estados por vendedor */}
      <Seccion
        titulo="Estados de ventas por vendedor"
        sub={`${n(k.vendedores)} vendedores · las cargas sin POS se atribuyen por el legajo que las cargó cuando siempre carga para el mismo vendedor (${n(k.sin_atribuir)} quedan como "cargado por")`}
        accion={
          <div className="flex items-center gap-2 no-print">
            <input className="input max-w-[200px]" placeholder="Buscar vendedor…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input max-w-[170px]" value={zonaVend} onChange={(e) => setZonaVend(e.target.value as any)}>
              <option value="todas">Todas las zonas</option>
              <option value="capital_central">Con ventas en Cap./Central</option>
              <option value="interior">Con ventas en Interior</option>
            </select>
          </div>
        }
      >
        <div style={{ height: Math.max(220, topVend.length * 26 + 40) }}>
          <ResponsiveContainer>
            <BarChart data={topVend} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }} barCategoryGap={4}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="nombre" width={190} tick={{ fontSize: 11, fill: "#4b5563" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,.04)" }} labelFormatter={(_, pl: any) => pl?.[0]?.payload?.vendedor ?? ""} />
              <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              {p.estados.map((e, i) => (
                <Bar key={e} dataKey={e} name={estadoLabel(e)} stackId="a" fill={C_ESTADO[e] ?? "#9ca3af"} radius={i === p.estados.length - 1 ? [0, 4, 4, 0] : 0}>
                  {i === p.estados.length - 1 && <LabelList dataKey="total" position="right" formatter={(v: number) => n(v)} style={{ fontSize: 11, fill: "#111827" }} />}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-brand-mist mb-3">Gráfico: los 15 primeros del filtro. La tabla trae todos.</p>
        <Tabla
          cols={[
            { key: "vendedor", label: "Vendedor", render: (r: any) => <><b className={r.vendedor.startsWith("CARGADO POR") ? "text-brand-slate font-normal" : ""}>{r.vendedor}</b> <span className="text-brand-mist text-xs">{r.subcanal}</span>{r.por_legajo > 0 && <span className="text-brand-mist text-[10px] ml-1" title="Cargas atribuidas por legajo">({r.por_legajo} por legajo)</span>}</> },
            ...colsProd(),
            ...colsZona,
          ]}
          rows={vendedores}
          alerta={(r: any) => r.total >= 5 && r.pct_finalizacion < 70}
          maxAlto="max-h-[70vh]"
        />
      </Seccion>
    </div>
  );
}
