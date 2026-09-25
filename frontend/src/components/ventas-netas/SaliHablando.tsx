"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fechaCorta, n, pct, type InformeData, type SaliHablando as SaliHablandoData } from "./tipos";
import { Seccion, Tabla } from "./ui";

// Mismo par validado que en el resto del informe: con uso (cyan) / sin uso (magenta).
const C_CON_USO = "#00B2BF";
const C_SIN_USO = "#D6336C";
const tooltipStyle = { fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb", boxShadow: "0 4px 12px rgba(0,0,0,.08)" };
const dd = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * SALI HABLANDO: portaciones SI-SaliHbl. La línea salió hablando de la otra operadora; casi
 * siempre se activaron el mes anterior y completaron la portación en el período, y en su gran
 * mayoría no tienen uso. Es una señal de riesgo fuerte: se revisa por día, por vendedor y línea por línea.
 */
export function SaliHablando({ d, onVendedor }: { d: InformeData; onVendedor: (nombre: string) => void }) {
  const s: SaliHablandoData | undefined = d.sali_hablando;
  const [eje, setEje] = useState<"portacion" | "activacion">("portacion");
  const [soloSinUso, setSoloSinUso] = useState(true);
  const [q, setQ] = useState("");

  const detalle = useMemo(() => {
    const base = s?.detalle ?? [];
    return base.filter((r) => (!soloSinUso || r.sin_uso) && (!q || [r.vendedor, r.sds_number, r.linea, r.plan, r.ciudad].some((x) => (x ?? "").toLowerCase().includes(q.toLowerCase()))));
  }, [s, soloSinUso, q]);

  if (!s) {
    return (
      <Seccion titulo="Sali Hablando" sub="Portaciones SI-SaliHbl">
        <div className="text-sm text-brand-slate">Esta sección no está en este informe. Actualizalo con el botón de arriba.</div>
      </Seccion>
    );
  }
  const k = s.kpis;
  const serie = (eje === "portacion" ? s.por_dia : s.por_dia_activacion).map((f) => ({ ...f, diaCorto: dd(f.dia) }));

  return (
    <Seccion
      titulo="Sali Hablando"
      sub={`Portaciones SI-SaliHbl: la línea salió hablando de la otra operadora · ${n(k.total)} en el período, ${n(k.sin_uso)} sin uso (${pct(k.pct_sin_uso)}) · ${n(k.activadas_mes_anterior)} activadas antes del mes de portación`}
      className="border-l-[4px] border-l-brand-primary"
      accion={
        <div className="flex gap-1 no-print">
          {([["portacion", "Por día de portación"], ["activacion", "Por día de activación"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setEje(v)} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${eje === v ? "bg-brand-ink text-white" : "text-brand-slate hover:bg-brand-bg"}`}>{l}</button>
          ))}
        </div>
      }
    >
      <div className="grid sm:grid-cols-4 gap-3 mb-5">
        <Kpi label="Sali Hablando" value={n(k.total)} hint={`${n(k.fuera_ddi)} fuera de DDI · ${n(k.en_ddi)} en DDI`} color="#0F1116" />
        <Kpi label="Sin uso" value={`${n(k.sin_uso)} · ${pct(k.pct_sin_uso)}`} hint="Alerta PFI" color={C_SIN_USO} />
        <Kpi label="Con uso" value={n(k.con_uso)} hint={k.total ? `${pct(100 - k.pct_sin_uso)} del total` : ""} color={C_CON_USO} />
        <Kpi label="Vendedores" value={n(k.vendedores)} hint={k.primer_dia ? `Portadas del ${fechaCorta(k.primer_dia)} al ${fechaCorta(k.ultimo_dia)}` : "—"} color="#7B3FA0" />
      </div>

      {serie.length > 0 && (
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={serie} margin={{ left: 0, right: 8, top: 16, bottom: 0 }} barCategoryGap={4}>
              <CartesianGrid vertical={false} stroke="#eef0f3" />
              <XAxis dataKey="diaCorto" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,.04)" }} labelFormatter={(l) => `${eje === "portacion" ? "Portadas" : "Activadas"} el ${l}`} />
              <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="con_uso" name="Con uso" stackId="a" fill={C_CON_USO} />
              <Bar dataKey="sin_uso" name="Sin uso" stackId="a" fill={C_SIN_USO} radius={[4, 4, 0, 0]}>
                <LabelList dataKey="total" position="top" style={{ fontSize: 10, fill: "#111827" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6 mt-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mb-1">{eje === "portacion" ? "Por día de portación" : "Por día de activación"}</div>
          <Tabla
            cols={[
              { key: "dia", label: "Día", render: (r: any) => fechaCorta(r.dia) },
              { key: "total", label: "Líneas", align: "right", render: (r: any) => <b>{n(r.total)}</b> },
              { key: "sin_uso", label: "Sin uso", align: "right", render: (r: any) => <b style={{ color: C_SIN_USO }}>{n(r.sin_uso)}</b> },
              { key: "con_uso", label: "Con uso", align: "right", render: (r: any) => n(r.con_uso) },
              { key: "pct_sin_uso", label: "% sin uso", align: "right", render: (r: any) => pct(r.pct_sin_uso) },
            ]}
            rows={serie}
            maxAlto="max-h-72"
          />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mb-1">Por vendedor · clic para abrir la ficha</div>
          <Tabla
            cols={[
              { key: "vendedor", label: "Vendedor", render: (r: any) => <><b>{r.vendedor}</b> <span className="text-brand-mist text-xs">{r.subcanal}</span></> },
              { key: "total", label: "Líneas", align: "right", render: (r: any) => n(r.total) },
              { key: "sin_uso", label: "Sin uso", align: "right", render: (r: any) => <b style={{ color: C_SIN_USO }}>{n(r.sin_uso)}</b> },
              { key: "pct_sin_uso", label: "%", align: "right", render: (r: any) => pct(r.pct_sin_uso) },
            ]}
            rows={s.por_vendedor}
            alerta={(r: any) => r.sin_uso >= 3}
            maxAlto="max-h-72"
            onRowClick={(r: any) => onVendedor(r.vendedor)}
          />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mb-1">Origen y plan</div>
          <Tabla
            cols={[
              { key: "origen", label: "Operadora" },
              { key: "total", label: "Líneas", align: "right", render: (r: any) => n(r.total) },
              { key: "sin_uso", label: "Sin uso", align: "right", render: (r: any) => <b style={{ color: C_SIN_USO }}>{n(r.sin_uso)}</b> },
            ]}
            rows={s.por_origen}
          />
          <div className="mt-3">
            <Tabla
              cols={[
                { key: "plan", label: "Plan" },
                { key: "total", label: "Líneas", align: "right", render: (r: any) => n(r.total) },
                { key: "sin_uso", label: "Sin uso", align: "right", render: (r: any) => <b style={{ color: C_SIN_USO }}>{n(r.sin_uso)}</b> },
              ]}
              rows={s.por_plan}
              maxAlto="max-h-40"
            />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <div>
            <h3 className="text-sm font-semibold text-brand-ink">Detalle línea por línea</h3>
            <p className="text-xs text-brand-slate">{n(detalle.length)} de {n(k.total)} · las sin uso van primero y en rojo</p>
          </div>
          <div className="flex items-center gap-3 no-print">
            <input className="input max-w-[220px]" placeholder="Buscar vendedor, SDS, línea…" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="text-xs text-brand-graphite flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={soloSinUso} onChange={(e) => setSoloSinUso(e.target.checked)} /> Solo sin uso
            </label>
          </div>
        </div>
        <Tabla
          cols={[
            { key: "sin_uso", label: "", align: "center", render: (r: any) => (r.sin_uso ? <span className="text-brand-primary" title="Sin uso">▲</span> : "") },
            { key: "fecha_portacion", label: "Portación", render: (r: any) => fechaCorta(r.fecha_portacion) },
            { key: "fecha_activacion", label: "Activación", render: (r: any) => <>{fechaCorta(r.fecha_activacion)} {r.dias_activacion_a_portacion ? <span className="text-brand-mist text-xs">(+{r.dias_activacion_a_portacion} d)</span> : null}</> },
            { key: "dias_desde_portacion", label: "Días portada", align: "right", render: (r: any) => (r.dias_desde_portacion ?? "—") },
            { key: "sds_number", label: "SDS", className: "tabular-nums" },
            { key: "linea", label: "Línea", className: "tabular-nums" },
            { key: "plan", label: "Plan" },
            { key: "origen_portacion", label: "Origen" },
            { key: "consumo", label: "Uso", render: (r: any) => (r.sin_uso ? <span className="text-brand-primary font-semibold">Sin uso</span> : <span className="text-emerald-700 font-semibold">Con uso</span>) },
            { key: "estado_linea", label: "Estado", render: (r: any) => <>{r.estado_linea === "S" ? <span className="badge-primary">Susp.</span> : "Activa"} <span className="text-brand-mist text-xs">{r.razon_cierre}</span></> },
            { key: "vendedor", label: "Vendedor", render: (r: any) => <button className="text-left hover:text-brand-primary" onClick={() => onVendedor(r.vendedor)}>{r.vendedor} <span className="text-brand-mist text-xs">{r.subcanal}</span></button> },
            { key: "ciudad", label: "Ciudad" },
            { key: "en_ddi", label: "DDI", align: "center", render: (r: any) => (r.en_ddi ? "Sí" : <span className="text-brand-mist">No</span>) },
          ]}
          rows={detalle}
          alerta={(r: any) => r.sin_uso}
          maxAlto="max-h-[60vh]"
        />
      </div>
    </Seccion>
  );
}

function Kpi({ label, value, hint, color }: { label: string; value: string; hint?: string; color: string }) {
  return (
    <div className="rounded-lg border border-brand-border p-3 border-l-[3px]" style={{ borderLeftColor: color }}>
      <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">{label}</div>
      <div className="font-display text-2xl text-brand-ink mt-0.5">{value}</div>
      {hint && <div className="text-[11px] text-brand-slate">{hint}</div>}
    </div>
  );
}
