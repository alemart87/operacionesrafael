"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CATALOGO_GRAFICOS, n, pct, type Snapshot } from "./tipos";

// Paleta validada en el resto del informe (ΔE CVD ≥ 12 en pares adyacentes; contraste cubierto con etiquetas).
const C = { con_uso: "#00B2BF", sin_uso: "#D6336C", otros: "#9ca3af", pospago: "#7B3FA0", internet: "#00B2BF", iptv: "#F39200", mag: "#0F1116" };
const C_ESTADO: Record<string, string> = { Vta_Finalizada: "#00B2BF", Vta_A_Confirmar: "#F39200", Vta_Procesado: "#4C6EF5", Vta_Rechazada: "#E6332A" };
const ESTADO_LABEL: Record<string, string> = { Vta_Finalizada: "Finalizada", Vta_A_Confirmar: "A confirmar", Vta_Procesado: "Procesado", Vta_Rechazada: "Rechazada" };
const tip = { fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb", boxShadow: "0 4px 12px rgba(0,0,0,.08)" };
const dd = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const corto = (s: string) => (s.length > 24 ? s.slice(0, 23) + "…" : s);

export function tituloGrafico(key: string): string {
  return CATALOGO_GRAFICOS.find((c) => c.key === key)?.titulo ?? key;
}

/**
 * Gráfico del informe de auditoría a partir de las series congeladas del snapshot.
 * `fijo` fuerza un ancho fijo (para la impresión, donde el contenedor no se mide).
 */
export function GraficoAuditoria({ s, clave, alto = 260, fijo = false }: { s: Snapshot; clave: string; alto?: number; fijo?: boolean }) {
  const ser = s.series;
  const um = s.parametros?.umbral_uso_pct ?? 50;
  const wrap = (chart: React.ReactElement) =>
    fijo ? <div style={{ width: 960, maxWidth: "100%" }}>{chart}</div> : <div style={{ height: alto }}><ResponsiveContainer>{chart}</ResponsiveContainer></div>;
  const size = fijo ? { width: 960, height: alto } : {};
  const ejeY = { tick: { fontSize: 11, fill: "#6b7280" }, axisLine: false, tickLine: false };

  switch (clave) {
    case "netas_por_dia":
      return wrap(
        <BarChart {...size} data={ser.netas_por_dia.map((x) => ({ ...x, d: dd(x.dia) }))} margin={{ left: 0, right: 8, top: 16, bottom: 0 }} barCategoryGap={3}>
          <CartesianGrid vertical={false} stroke="#eef0f3" />
          <XAxis dataKey="d" {...ejeY} />
          <YAxis {...ejeY} width={32} />
          <Tooltip contentStyle={tip} labelFormatter={(l) => `Día ${l}`} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="con_uso" name="Pospago con uso" stackId="a" fill={C.con_uso} />
          <Bar dataKey="sin_uso" name="Pospago sin uso" stackId="a" fill={C.sin_uso} />
          {ser.netas_por_dia.some((x) => x.en_espera) && <Bar dataKey="en_espera" name="En espera de uso (no es alerta)" stackId="a" fill="#CBD5E1" />}
          <Bar dataKey="otros" name="GPON + IPTV" stackId="a" fill={C.otros} radius={[4, 4, 0, 0]}>
            <LabelList dataKey="total" position="top" style={{ fontSize: 10, fill: "#111827" }} />
          </Bar>
        </BarChart>,
      );
    case "sali_por_dia":
      return wrap(
        <BarChart {...size} data={ser.sali_por_dia.map((x) => ({ ...x, d: dd(x.dia) }))} margin={{ left: 0, right: 8, top: 16, bottom: 0 }} barCategoryGap={4}>
          <CartesianGrid vertical={false} stroke="#eef0f3" />
          <XAxis dataKey="d" {...ejeY} />
          <YAxis {...ejeY} width={32} allowDecimals={false} />
          <Tooltip contentStyle={tip} labelFormatter={(l) => `Portadas el ${l}`} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="con_uso" name="Con uso" stackId="a" fill={C.con_uso} />
          <Bar dataKey="sin_uso" name="Sin uso" stackId="a" fill={C.sin_uso} radius={[4, 4, 0, 0]}>
            <LabelList dataKey="total" position="top" style={{ fontSize: 10, fill: "#111827" }} />
          </Bar>
        </BarChart>,
      );
    case "sin_uso_por_vendedor": {
      const data = ser.sin_uso_por_vendedor.slice(0, 15).map((x) => ({ ...x, nombre: corto(x.vendedor), total: x.sin_uso + x.con_uso }));
      return wrap(
        <BarChart {...size} data={data} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }} barCategoryGap={4}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="nombre" width={180} {...ejeY} />
          <Tooltip contentStyle={tip} labelFormatter={(_, pl: any) => pl?.[0]?.payload?.vendedor ?? ""} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="sin_uso" name="Sin uso" stackId="a" fill={C.sin_uso} />
          <Bar dataKey="con_uso" name="Con uso" stackId="a" fill={C.con_uso} radius={[0, 4, 4, 0]}>
            <LabelList dataKey="pct_sin_uso" position="right" formatter={(v: number) => `${pct(v)} s/uso`} style={{ fontSize: 11, fill: "#111827" }} />
          </Bar>
        </BarChart>,
      );
    }
    case "uso_por_vendedor": {
      const data = ser.uso_por_vendedor.slice(0, 15).map((x) => ({ ...x, nombre: corto(x.vendedor) }));
      return wrap(
        <BarChart {...size} data={data} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }} barCategoryGap={4}>
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis type="category" dataKey="nombre" width={180} {...ejeY} />
          <Tooltip contentStyle={tip} formatter={(v: number, _n, item: any) => [`${pct(v)} en uso · ${n(item.payload.pospago)} Pospago`, ""]} labelFormatter={(_, pl: any) => pl?.[0]?.payload?.vendedor ?? ""} />
          <ReferenceLine x={um} stroke="#E6332A" strokeDasharray="4 3" label={{ value: `umbral ${um}%`, position: "top", fontSize: 10, fill: "#E6332A" }} />
          <Bar dataKey="pct_uso" name="% en uso" fill={C.con_uso} radius={[0, 4, 4, 0]} maxBarSize={18}>
            {data.map((x) => <Cell key={x.vendedor} fill={x.nivel === "critico" ? C.sin_uso : x.nivel === "atencion" ? C.iptv : C.con_uso} />)}
            <LabelList dataKey="pct_uso" position="right" formatter={(v: number) => pct(v)} style={{ fontSize: 11, fill: "#111827" }} />
          </Bar>
        </BarChart>,
      );
    }
    case "sali_por_vendedor": {
      const data = ser.sali_por_vendedor.slice(0, 15).map((x) => ({ ...x, nombre: corto(x.vendedor), con_uso: x.sali - x.sali_sin_uso }));
      return wrap(
        <BarChart {...size} data={data} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }} barCategoryGap={4}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="nombre" width={180} {...ejeY} />
          <Tooltip contentStyle={tip} labelFormatter={(_, pl: any) => pl?.[0]?.payload?.vendedor ?? ""} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="sali_sin_uso" name="Sin uso" stackId="a" fill={C.sin_uso} />
          <Bar dataKey="con_uso" name="Con uso" stackId="a" fill={C.con_uso} radius={[0, 4, 4, 0]}>
            <LabelList dataKey="sali" position="right" style={{ fontSize: 11, fill: "#111827" }} />
          </Bar>
        </BarChart>,
      );
    }
    case "riesgo_uso": {
      const lbl: Record<string, string> = { A: "A · alto", M: "M · medio", B: "B · bajo" };
      const data = ser.riesgo_uso.map((x) => ({ ...x, nombre: lbl[x.riesgo] ?? x.riesgo }));
      return wrap(
        <BarChart {...size} data={data} margin={{ left: 0, right: 8, top: 16, bottom: 0 }} barCategoryGap={24}>
          <CartesianGrid vertical={false} stroke="#eef0f3" />
          <XAxis dataKey="nombre" {...ejeY} />
          <YAxis {...ejeY} width={36} />
          <Tooltip contentStyle={tip} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="con_uso" name="Con uso" fill={C.con_uso} radius={[4, 4, 0, 0]}>
            <LabelList dataKey="con_uso" position="top" style={{ fontSize: 10, fill: "#111827" }} />
          </Bar>
          <Bar dataKey="sin_uso" name="Sin uso" fill={C.sin_uso} radius={[4, 4, 0, 0]}>
            <LabelList dataKey="pct_sin_uso" position="top" formatter={(v: number) => pct(v)} style={{ fontSize: 10, fill: "#111827" }} />
          </Bar>
        </BarChart>,
      );
    }
    case "estados": {
      const data = ser.estados.map((x) => ({ ...x, nombre: ESTADO_LABEL[x.estado] ?? x.estado }));
      return wrap(
        <BarChart {...size} data={data} layout="vertical" margin={{ left: 8, right: 56, top: 4, bottom: 4 }} barCategoryGap={8}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="nombre" width={100} {...ejeY} />
          <Tooltip contentStyle={tip} />
          <Bar dataKey="total" name="Cargas" fill={C.mag} radius={[0, 4, 4, 0]} maxBarSize={22}>
            <LabelList dataKey="total" position="right" formatter={(v: number) => n(v)} style={{ fontSize: 12, fill: "#111827" }} />
          </Bar>
        </BarChart>,
      );
    }
    case "zonas":
      return wrap(
        <BarChart {...size} data={ser.zonas} margin={{ left: 0, right: 8, top: 16, bottom: 0 }} barCategoryGap={40}>
          <CartesianGrid vertical={false} stroke="#eef0f3" />
          <XAxis dataKey="zona" {...ejeY} />
          <YAxis {...ejeY} width={40} />
          <Tooltip contentStyle={tip} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="pospago" name="Pospago" stackId="a" fill={C.pospago} />
          <Bar dataKey="internet" name="Internet (IF)" stackId="a" fill={C.internet} />
          <Bar dataKey="iptv" name="IPTV" stackId="a" fill={C.iptv} radius={[4, 4, 0, 0]}>
            <LabelList dataKey="total" position="top" formatter={(v: number) => n(v)} style={{ fontSize: 11, fill: "#111827" }} />
          </Bar>
        </BarChart>,
      );
    case "netas_por_vendedor": {
      const data = ser.netas_por_vendedor.slice(0, 15).map((x) => ({ ...x, nombre: corto(x.vendedor) }));
      return wrap(
        <BarChart {...size} data={data} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }} barCategoryGap={4}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="nombre" width={180} {...ejeY} />
          <Tooltip contentStyle={tip} labelFormatter={(_, pl: any) => pl?.[0]?.payload?.vendedor ?? ""} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="pospago" name="Pospago" stackId="a" fill={C.pospago} />
          <Bar dataKey="gpon" name="GPON" stackId="a" fill={C.internet} />
          <Bar dataKey="iptv" name="IPTV" stackId="a" fill={C.iptv} radius={[0, 4, 4, 0]}>
            <LabelList dataKey="netas" position="right" style={{ fontSize: 11, fill: "#111827" }} />
          </Bar>
        </BarChart>,
      );
    }
    case "pendientes_antiguedad":
      return wrap(
        <BarChart {...size} data={ser.pendientes_antiguedad} margin={{ left: 0, right: 8, top: 16, bottom: 0 }} barCategoryGap={30}>
          <CartesianGrid vertical={false} stroke="#eef0f3" />
          <XAxis dataKey="rango" {...ejeY} />
          <YAxis {...ejeY} width={32} allowDecimals={false} />
          <Tooltip contentStyle={tip} />
          <Bar dataKey="total" name="Pendientes" fill={C.iptv} radius={[4, 4, 0, 0]}>
            <LabelList dataKey="total" position="top" style={{ fontSize: 11, fill: "#111827" }} />
          </Bar>
        </BarChart>,
      );
    default:
      return <div className="text-sm text-brand-mist">Gráfico no disponible: {clave}</div>;
  }
}
