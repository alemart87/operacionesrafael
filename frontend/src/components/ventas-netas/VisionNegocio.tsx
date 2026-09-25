"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiCard } from "@/components/KpiCard";
import { ESTADO_SDS_LABEL, fechaCorta, n, pct, type InformeData } from "./tipos";
import { BarraUso, PctUso, Seccion, Tabla } from "./ui";
import { VendedorDetalle } from "./VendedorDetalle";

// Con uso / sin uso: par validado (ΔE CVD 18.8). Un solo color para magnitudes por producto.
const C_USO = "#00B2BF";
const C_SIN_USO = "#E6332A";
const C_MAG = "#0F1116";

const tooltipStyle = { fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb", boxShadow: "0 4px 12px rgba(0,0,0,.08)" };

/** Visión Negocio (gerencial): qué se vendió, cuánto está en uso, alertas y pendientes. */
export function VisionNegocio({ d }: { d: InformeData }) {
  const k = d.kpis;
  const [vendedorAbierto, setVendedorAbierto] = useState<string | null>(null);
  const porDia = d.por_dia.map((x) => ({ dia: x.dia?.slice(8, 10) ?? "", conUso: x.con_uso, sinUso: x.sin_uso, otros: x.total - x.pospago }));
  const porProducto = d.por_producto.map((x) => ({ producto: x.producto, total: x.total }));

  return (
    <div className="space-y-6">
      {/* Cabecera de indicadores */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Ventas netas" value={n(k.netas)} hint={`${n(k.pospago)} Pospago · ${n(k.gpon)} GPON · ${n(k.iptv)} IPTV`} accent="secondary" />
        <KpiCard label="Portación" value={pct(k.pct_portacion)} hint={`${n(k.portadas)} portadas · ${n(k.nativas)} nativas`} accent="purple" />
        <KpiCard label="Pospago sin uso · alerta PFI" value={pct(k.pct_sin_uso)} hint={`${n(k.pospago_sin_uso)} de ${n(k.pospago)} líneas Pospago`} accent="danger" />
        <KpiCard label="Pendientes de carga" value={n(k.pendientes)} hint={`${n(k.pendientes_portacion)} de portación · ${n(k.pendientes_mas_de_7_dias)} con más de 7 días`} accent="orange" />
      </div>

      {k.fuera_periodo > 0 && (
        <div className="rounded-md border border-brand-orange/40 bg-brand-orange/10 text-sm text-brand-graphite p-3">
          El archivo trae <b>{n(k.fuera_periodo)}</b> filas de otro mes. No entran en este informe.
        </div>
      )}

      {/* Uso por producto + evolución diaria */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Seccion titulo="Netas por producto" className="lg:col-span-2">
          <div className="h-44">
            <ResponsiveContainer>
              <BarChart data={porProducto} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }} barCategoryGap={8}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="producto" width={64} tick={{ fontSize: 12, fill: "#4b5563" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [n(v), "Netas"]} cursor={{ fill: "rgba(0,0,0,.04)" }} />
                <Bar dataKey="total" fill={C_MAG} radius={[0, 4, 4, 0]} maxBarSize={22}>
                  <LabelList dataKey="total" position="right" formatter={(v: number) => n(v)} style={{ fontSize: 12, fill: "#111827" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Tabla
            cols={[
              { key: "producto", label: "Producto" },
              { key: "total", label: "Netas", align: "right", render: (r) => n(r.total) },
              { key: "sin_uso", label: "Sin uso", align: "right", render: (r) => (r.pospago ? n(r.sin_uso) : "—") },
              { key: "pct_uso", label: "% en uso", align: "right", render: (r) => (r.pospago ? <PctUso v={r.pct_uso} umbral={k.umbral_uso_pct} /> : "—") },
            ]}
            rows={d.por_producto}
          />
        </Seccion>

        <Seccion titulo="Activaciones por día" sub="Pospago con uso y sin uso; GPON e IPTV aparte" className="lg:col-span-3">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={porDia} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} barCategoryGap={3}>
                <CartesianGrid vertical={false} stroke="#eef0f3" />
                <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} width={32} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,.04)" }} labelFormatter={(l) => `Día ${l}`} />
                <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="conUso" name="Pospago con uso" stackId="a" fill={C_USO} />
                <Bar dataKey="sinUso" name="Pospago sin uso" stackId="a" fill={C_SIN_USO} />
                <Bar dataKey="otros" name="GPON + IPTV" stackId="a" fill="#9ca3af" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Seccion>
      </div>

      {/* Portación y planes */}
      <div className="grid lg:grid-cols-3 gap-6">
        <Seccion titulo="Portación vs. nativa" sub="Solo Pospago tiene consumo">
          <Tabla
            cols={[
              { key: "tipo", label: "Tipo" },
              { key: "total", label: "Netas", align: "right", render: (r) => n(r.total) },
              { key: "uso", label: "Uso", render: (r) => (r.pospago ? <BarraUso conUso={r.con_uso} sinUso={r.sin_uso} /> : "—") },
            ]}
            rows={d.portacion.por_tipo}
          />
          <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mt-4 mb-1">Origen de la portación</div>
          <Tabla
            cols={[
              { key: "origen", label: "Operadora" },
              { key: "total", label: "Portadas", align: "right", render: (r) => n(r.total) },
              { key: "uso", label: "Uso", render: (r) => <BarraUso conUso={r.con_uso} sinUso={r.sin_uso} /> },
            ]}
            rows={d.portacion.por_origen}
          />
        </Seccion>

        <Seccion titulo="Planes" sub="Ordenados por cantidad">
          <Tabla
            cols={[
              { key: "plan", label: "Plan", render: (r) => <><span className="text-brand-mist text-xs">{r.producto} · </span>{r.plan}</> },
              { key: "total", label: "Netas", align: "right", render: (r) => n(r.total) },
              { key: "pct_uso", label: "% uso", align: "right", render: (r) => (r.pospago ? <PctUso v={r.pct_uso} umbral={k.umbral_uso_pct} /> : "—") },
            ]}
            rows={d.por_plan}
            maxAlto="max-h-72"
          />
        </Seccion>

        <Seccion titulo="Subcanal y segmento">
          <Tabla
            cols={[
              { key: "subcanal", label: "Subcanal" },
              { key: "total", label: "Netas", align: "right", render: (r) => n(r.total) },
              { key: "uso", label: "Uso", render: (r) => (r.pospago ? <BarraUso conUso={r.con_uso} sinUso={r.sin_uso} /> : "—") },
            ]}
            rows={d.por_subcanal}
          />
          <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mt-4 mb-1">Segmento</div>
          <Tabla
            cols={[
              { key: "segmento", label: "Segmento" },
              { key: "total", label: "Netas", align: "right", render: (r) => n(r.total) },
              { key: "pct_uso", label: "% uso", align: "right", render: (r) => (r.pospago ? <PctUso v={r.pct_uso} umbral={k.umbral_uso_pct} /> : "—") },
            ]}
            rows={d.por_segmento}
          />
        </Seccion>
      </div>

      {/* Alertas de vendedores + líneas a revisar */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Seccion
          titulo="Vendedores en alerta"
          sub={`Menos de ${k.umbral_uso_pct}% de líneas Pospago en uso con al menos ${k.min_lineas_alerta} líneas · clic para ver la ficha`}
        >
          <Tabla
            cols={[
              { key: "vendedor", label: "Vendedor", render: (r) => <><b>{r.vendedor}</b> <span className="text-brand-mist text-xs">{r.subcanal}</span></> },
              { key: "pospago", label: "Pospago", align: "right", render: (r) => n(r.pospago) },
              { key: "sin_uso", label: "Sin uso", align: "right", render: (r) => <b className="text-brand-primary">{n(r.sin_uso)}</b> },
              { key: "pct_uso", label: "% en uso", align: "right", render: (r) => <PctUso v={r.pct_uso} umbral={k.umbral_uso_pct} /> },
            ]}
            rows={d.alertas}
            vacio="Ningún vendedor por debajo del umbral."
            onRowClick={(r) => setVendedorAbierto(r.vendedor)}
          />
        </Seccion>

        <Seccion titulo="Líneas a revisar" sub="Cuentan en la neta, pero requieren seguimiento">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-md border border-brand-border p-4">
              <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">Suspendidas al cierre</div>
              <div className="font-display text-3xl text-brand-ink mt-1">{n(k.suspendidas)}</div>
              <ul className="text-xs text-brand-slate mt-2 space-y-0.5">
                {d.suspendidas.por_razon.map((x) => <li key={x.razon}>{x.razon}: {n(x.total)}</li>)}
              </ul>
            </div>
            <div className="rounded-md border border-brand-border p-4">
              <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">Portadas fuera de netas</div>
              <div className="font-display text-3xl text-brand-ink mt-1">{n(k.fuera_de_netas)}</div>
              <div className="text-xs text-brand-slate mt-2">
                {n(d.fuera_de_netas.sin_uso)} sin uso · {d.fuera_de_netas.por_tipo.map((x) => `${x.tipo} ${n(x.total)}`).join(" · ")}
              </div>
              <div className="text-[11px] text-brand-mist mt-1">Están en PORTABILIDAD pero no en DDI. No suman a la neta.</div>
            </div>
            <div className="rounded-md border border-brand-border p-4 col-span-2">
              <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">Finalizadas sin activar</div>
              <div className="flex items-baseline gap-3">
                <div className="font-display text-3xl text-brand-ink mt-1">{n(k.finalizadas_sin_activar)}</div>
                <div className="text-xs text-brand-slate">cargas finalizadas del mes que no figuran en DDI ni en PORTABILIDAD (detalle en la visión operativa)</div>
              </div>
            </div>
          </div>
        </Seccion>
      </div>

      {/* Pendientes */}
      <Seccion titulo="Cargas pendientes" sub={`Ventas cargadas que no finalizaron al corte del ${fechaCorta(k.fecha_dato)} · antigüedad desde la fecha de alta`}>
        <div className="grid lg:grid-cols-3 gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mb-1">Por estado</div>
            <Tabla
              cols={[
                { key: "estado", label: "Estado", render: (r) => ESTADO_SDS_LABEL[r.estado] ?? r.estado },
                { key: "total", label: "Cargas", align: "right", render: (r) => n(r.total) },
              ]}
              rows={d.pendientes.por_estado}
            />
            <div className="text-xs text-brand-slate mt-3">{n(k.pendientes_portacion)} de {n(k.pendientes)} son portaciones pendientes.</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mb-1">Por antigüedad</div>
            <Tabla
              cols={[
                { key: "rango", label: "Antigüedad" },
                ...d.pendientes.estados.map((e) => ({ key: e, label: ESTADO_SDS_LABEL[e] ?? e, align: "right" as const, render: (r: any) => n(r[e]) })),
                { key: "total", label: "Total", align: "right", render: (r) => <b>{n(r.total)}</b> },
              ]}
              rows={d.pendientes.por_antiguedad}
              alerta={(r) => r.rango.startsWith("más") && r.total > 0}
            />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mb-1">Quién las cargó</div>
            <Tabla
              cols={[
                { key: "cargado_por", label: "Legajo", render: (r) => <><b>{r.legajo}</b> <span className="text-brand-mist text-xs">{r.cargado_por}</span></> },
                { key: "total", label: "Pend.", align: "right", render: (r) => n(r.total) },
                { key: "mas_de_7_dias", label: "> 7 días", align: "right", render: (r) => (r.mas_de_7_dias ? <b className="text-brand-primary">{n(r.mas_de_7_dias)}</b> : "0") },
              ]}
              rows={d.pendientes.por_legajo}
              maxAlto="max-h-64"
            />
          </div>
        </div>
      </Seccion>

      {vendedorAbierto && (
        <VendedorDetalle d={d} nombre={vendedorAbierto} lista={d.alertas.map((v) => v.vendedor)} onClose={() => setVendedorAbierto(null)} onCambiar={setVendedorAbierto} />
      )}
    </div>
  );
}
