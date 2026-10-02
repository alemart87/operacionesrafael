"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, CalendarDays, Download, ListFilter, Search, Trophy, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fechaCorta, n, pct, type DetalleNeta, type InformeData } from "./tipos";
import { DIAS_SIN_USO_ANTIGUA, estadoUso, umbralCritico } from "./patrones";
import { Seccion, Tabs, UsoBadge } from "./ui";
import { VendedorDetalle } from "./VendedorDetalle";

// Mismo par validado que el resto del informe (con uso / sin uso, ΔE CVD 18.8).
const C_USO = "#00B2BF";
const C_SIN_USO = "#E6332A";
const tooltipStyle = { fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb", boxShadow: "0 4px 12px rgba(0,0,0,.08)" };

type Vista = "ranking" | "lineas" | "fechas";
type Dir = "asc" | "desc";

/** Fecha con la que se agrupa y filtra: la de venta (CARGAS); si la venta no está en el corte, la de activación. */
const fechaRef = (r: DetalleNeta) => (r.fecha_venta ?? r.fecha_activacion ?? "").slice(0, 10);

function comparar(a: unknown, b: unknown, dir: Dir): number {
  const vacioA = a === null || a === undefined || a === "", vacioB = b === null || b === undefined || b === "";
  if (vacioA || vacioB) return vacioA === vacioB ? 0 : vacioA ? 1 : -1; // los vacíos siempre al final
  const r = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "es", { numeric: true });
  return dir === "asc" ? r : -r;
}

function useOrden<K extends string>(inicial: K, dir0: Dir = "desc") {
  const [orden, setOrden] = useState<{ k: K; dir: Dir }>({ k: inicial, dir: dir0 });
  const alternar = (k: K, dirNueva: Dir = "desc") =>
    setOrden((o) => (o.k === k ? { k, dir: o.dir === "desc" ? "asc" : "desc" } : { k, dir: dirNueva }));
  return { orden, alternar, setOrden };
}

/** Encabezado ordenable: clic alterna mayor→menor / menor→mayor. */
function Th<K extends string>({ k, label, orden, alternar, align = "left", dirInicial = "desc", title }: {
  k: K; label: string; orden: { k: K; dir: Dir }; alternar: (k: K, d?: Dir) => void; align?: "left" | "right"; dirInicial?: Dir; title?: string;
}) {
  const activo = orden.k === k;
  const Icono = !activo ? ArrowUpDown : orden.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <th className={`px-3 py-2 font-semibold ${align === "right" ? "text-right" : "text-left"}`}
      aria-sort={activo ? (orden.dir === "desc" ? "descending" : "ascending") : "none"}>
      <button type="button" title={title ?? "Ordenar"} onClick={() => alternar(k, dirInicial)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider2 whitespace-nowrap hover:text-brand-ink ${align === "right" ? "flex-row-reverse" : ""} ${activo ? "text-brand-ink" : ""}`}>
        {label}
        <Icono size={11} className={activo ? "text-brand-primary" : "text-brand-mist"} />
      </button>
    </th>
  );
}

function csv(nombre: string, cab: string[], filas: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const texto = "﻿" + [cab, ...filas].map((f) => f.map(esc).join(";")).join("\r\n"); // BOM + ";" para Excel en español
  const url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  a.click();
  URL.revokeObjectURL(url);
}

interface FilaRanking {
  vendedor: string;
  subcanal: string | null;
  evaluables: number;
  sin_uso: number;
  con_uso: number;
  en_espera: number;
  pct_sin_uso: number;
  primera: string | null;
  ultima: string | null;
  critico: boolean;
}
type KRanking = "sin_uso" | "pct_sin_uso" | "evaluables" | "con_uso" | "en_espera" | "vendedor" | "ultima";
type KLinea = "fecha" | "fecha_activacion" | "dias" | "vendedor" | "sds_number" | "linea" | "plan" | "origen" | "ciudad" | "riesgo" | "legajo";

function Indicador({ titulo, valor, detalle, borde }: { titulo: string; valor: ReactNode; detalle?: ReactNode; borde: string }) {
  return (
    <div className={`card p-4 border-l-[3px] ${borde}`}>
      <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">{titulo}</div>
      <div className="mt-1 font-display text-3xl text-brand-ink leading-none">{valor}</div>
      {detalle && <div className="mt-1.5 text-xs text-brand-slate">{detalle}</div>}
    </div>
  );
}

/** Pospago sin uso (alerta PFI): ranking por vendedor, detalle de líneas y fechas de venta. */
export function SinUsoDetalle({ d, periodo }: { d: InformeData; periodo: string }) {
  const k = d.kpis;
  const corte = k.fecha_dato;
  const umbral = umbralCritico(d);
  const [vista, setVista] = useState<Vista>("ranking");
  const [ficha, setFicha] = useState<string | null>(null);

  // ------------------------------------------------------------ base: Pospago con su estado de uso
  const pospago = useMemo(
    () => d.detalle_netas.filter((r) => r.producto === "Pospago").map((r) => ({ r, uso: estadoUso(r, corte) })),
    [d.detalle_netas, corte],
  );
  const sinUso = useMemo(() => pospago.filter((x) => x.uso === "NO").map((x) => x.r), [pospago]);
  const enEspera = useMemo(() => pospago.filter((x) => x.uso === "ESPERA").map((x) => x.r), [pospago]);
  const tieneFechaVenta = useMemo(() => d.detalle_netas.some((r) => r.fecha_venta), [d.detalle_netas]);

  // ------------------------------------------------------------ ranking por vendedor
  const ranking = useMemo<FilaRanking[]>(() => {
    const alerta = new Map(d.vendedores.map((v) => [v.vendedor, v]));
    const m = new Map<string, FilaRanking>();
    for (const { r, uso } of pospago) {
      const f = m.get(r.vendedor) ?? {
        vendedor: r.vendedor, subcanal: r.subcanal, evaluables: 0, sin_uso: 0, con_uso: 0, en_espera: 0,
        pct_sin_uso: 0, primera: null, ultima: null, critico: !!alerta.get(r.vendedor)?.alerta,
      };
      if (uso === "ESPERA") f.en_espera++;
      else if (uso === "SI" || uso === "NO") {
        f.evaluables++;
        if (uso === "SI") f.con_uso++;
        else {
          f.sin_uso++;
          const fr = fechaRef(r);
          if (fr && (!f.primera || fr < f.primera)) f.primera = fr;
          if (fr && (!f.ultima || fr > f.ultima)) f.ultima = fr;
        }
      }
      m.set(r.vendedor, f);
    }
    return [...m.values()].map((f) => ({ ...f, pct_sin_uso: f.evaluables ? Math.round((f.sin_uso / f.evaluables) * 1000) / 10 : 0 }));
  }, [pospago, d.vendedores]);

  const [soloConSinUso, setSoloConSinUso] = useState(true);
  const [qRank, setQRank] = useState("");
  const ordRank = useOrden<KRanking>("sin_uso");
  const rankingVisible = useMemo(() => {
    const t = qRank.trim().toLowerCase();
    return ranking
      .filter((f) => (!soloConSinUso || f.sin_uso > 0) && (!t || f.vendedor.toLowerCase().includes(t) || (f.subcanal ?? "").toLowerCase().includes(t)))
      .sort((a, b) => comparar(a[ordRank.orden.k], b[ordRank.orden.k], ordRank.orden.dir)
        || b.sin_uso - a.sin_uso || b.pct_sin_uso - a.pct_sin_uso || a.vendedor.localeCompare(b.vendedor));
  }, [ranking, soloConSinUso, qRank, ordRank.orden]);
  const maxSinUso = Math.max(1, ...ranking.map((f) => f.sin_uso));
  const conSinUso = ranking.filter((f) => f.sin_uso > 0).length;
  const criticos = ranking.filter((f) => f.critico).length;

  // ------------------------------------------------------------ líneas sin uso
  const [fVendedor, setFVendedor] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [qLinea, setQLinea] = useState("");
  const [conEspera, setConEspera] = useState(false);
  const ordLinea = useOrden<KLinea>("fecha");
  const valorLinea = (r: DetalleNeta, key: KLinea): string | number | null | undefined =>
    key === "fecha" ? fechaRef(r) : key === "origen" ? (r.portacion === "SI" ? `Portación ${r.origen_portacion ?? ""}` : "Nativa") : (r as any)[key];
  const lineas = useMemo(() => {
    const t = qLinea.trim().toLowerCase();
    return (conEspera ? [...sinUso, ...enEspera] : sinUso)
      .filter((r) => (!fVendedor || r.vendedor === fVendedor)
        && (!desde || fechaRef(r) >= desde) && (!hasta || fechaRef(r) <= hasta)
        && (!t || [r.sds_number, r.linea, r.plan, r.ciudad, r.vendedor, r.legajo].some((x) => (x ?? "").toString().toLowerCase().includes(t))))
      .sort((a, b) => comparar(valorLinea(a, ordLinea.orden.k), valorLinea(b, ordLinea.orden.k), ordLinea.orden.dir)
        || String(a.sds_number).localeCompare(String(b.sds_number)));
  }, [sinUso, enEspera, conEspera, fVendedor, desde, hasta, qLinea, ordLinea.orden]);
  const hayFiltros = !!(fVendedor || desde || hasta || qLinea || conEspera);
  const limpiar = () => { setFVendedor(""); setDesde(""); setHasta(""); setQLinea(""); setConEspera(false); };
  const verLineasDe = (vendedor: string) => { limpiar(); setFVendedor(vendedor); setVista("lineas"); };
  const verLineasDel = (dia: string) => { limpiar(); setDesde(dia); setHasta(dia); setVista("lineas"); };

  // ------------------------------------------------------------ por fecha de venta
  const porFecha = useMemo(() => {
    const m = new Map<string, { dia: string; pospago: number; con_uso: number; sin_uso: number; en_espera: number; vendedores: Set<string> }>();
    for (const { r, uso } of pospago) {
      const dia = fechaRef(r);
      if (!dia) continue;
      const f = m.get(dia) ?? { dia, pospago: 0, con_uso: 0, sin_uso: 0, en_espera: 0, vendedores: new Set<string>() };
      f.pospago++;
      if (uso === "SI") f.con_uso++;
      else if (uso === "NO") { f.sin_uso++; f.vendedores.add(r.vendedor); }
      else if (uso === "ESPERA") f.en_espera++;
      m.set(dia, f);
    }
    return [...m.values()].map((f) => {
      const ev = f.con_uso + f.sin_uso;
      return { ...f, vendedores: f.vendedores.size, pct_sin_uso: ev ? Math.round((f.sin_uso / ev) * 1000) / 10 : 0 };
    });
  }, [pospago]);
  const grafico = useMemo(() => [...porFecha].sort((a, b) => a.dia.localeCompare(b.dia))
    .map((f) => ({ dia: f.dia, etiqueta: `${f.dia.slice(8, 10)}/${f.dia.slice(5, 7)}`, conUso: f.con_uso, sinUso: f.sin_uso, enEspera: f.en_espera })), [porFecha]);
  type KFecha = "dia" | "pospago" | "sin_uso" | "pct_sin_uso" | "vendedores";
  const ordFecha = useOrden<KFecha>("dia", "asc");
  const fechasOrdenadas = useMemo(() => [...porFecha].sort((a, b) => comparar(a[ordFecha.orden.k], b[ordFecha.orden.k], ordFecha.orden.dir)), [porFecha, ordFecha.orden]);
  const peorDia = porFecha.reduce<(typeof porFecha)[number] | null>((m, f) => (!m || f.sin_uso > m.sin_uso ? f : m), null);

  // ------------------------------------------------------------ exportar
  const exportarRanking = () => csv(`sin-uso-ranking_${periodo}.csv`,
    ["Puesto", "Vendedor", "Subcanal", "Pospago evaluables", "Sin uso", "% sin uso", "Con uso", "En espera", "Primera venta sin uso", "Última venta sin uso", "Crítico"],
    rankingVisible.map((f, i) => [i + 1, f.vendedor, f.subcanal, f.evaluables, f.sin_uso, f.pct_sin_uso.toLocaleString("es-PY"), f.con_uso, f.en_espera, fechaCorta(f.primera), fechaCorta(f.ultima), f.critico ? "Sí" : "No"]));
  const exportarLineas = () => csv(`sin-uso-lineas_${periodo}.csv`,
    ["Fecha venta", "Fecha activación", "Días desde activación", "Estado", "Vendedor", "Subcanal", "Legajo", "SDS", "Línea", "Plan", "Portación", "Origen", "Ciudad", "Riesgo"],
    lineas.map((r) => [fechaCorta(r.fecha_venta), fechaCorta(r.fecha_activacion), r.dias ?? "", estadoUso(r, corte) === "ESPERA" ? "En espera" : "Sin uso",
      r.vendedor, r.subcanal, r.legajo, r.sds_number, r.linea, r.plan, r.portacion, r.origen_portacion, r.ciudad, r.riesgo]));

  const vendedoresConLineas = useMemo(() => [...new Set(sinUso.map((r) => r.vendedor))].sort((a, b) => a.localeCompare(b)), [sinUso]);

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Indicador titulo="Líneas sin uso · alerta PFI" borde="border-l-brand-primary"
          valor={n(k.pospago_sin_uso)} detalle={<>{pct(k.pct_sin_uso)} de {n(k.pospago - (k.pospago_en_espera ?? 0))} Pospago evaluables</>} />
        <Indicador titulo="Vendedores con líneas sin uso" borde="border-l-brand-ink"
          valor={<>{n(conSinUso)}<span className="text-lg text-brand-mist"> / {n(ranking.length)}</span></>}
          detalle={ranking[0] ? `Top: ${[...ranking].sort((a, b) => b.sin_uso - a.sin_uso)[0].vendedor}` : undefined} />
        <Indicador titulo="Críticos" borde="border-l-brand-primary"
          valor={n(criticos)} detalle={`Más de ${umbral}% sin uso (con ${k.min_lineas_alerta}+ líneas evaluables)`} />
        <Indicador titulo="En espera de uso" borde="border-l-brand-mist"
          valor={n(enEspera.length)} detalle={`Activadas hace menos de ${DIAS_SIN_USO_ANTIGUA} días: no son alerta`} />
      </div>

      <Tabs<Vista>
        value={vista}
        onChange={setVista}
        items={[
          { value: "ranking", label: "Ranking de vendedores", hint: `${n(conSinUso)} con líneas sin uso` },
          { value: "lineas", label: "Líneas sin uso", hint: `${n(sinUso.length)} líneas · detalle` },
          { value: "fechas", label: "Fechas de venta", hint: "Evolución día por día" },
        ]}
      />

      {vista === "ranking" && (
        <Seccion
          titulo="Ranking de vendedores por líneas sin uso"
          sub="Clic en un encabezado para ordenar de mayor a menor (otro clic: de menor a mayor). Clic en un vendedor para ver sus líneas."
          accion={<button onClick={exportarRanking} className="btn-secondary text-xs px-3 py-2 shrink-0"><Download size={14} /> CSV</button>}
        >
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative w-full sm:w-72">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mist" />
              <input className="input pl-9 py-2" placeholder="Buscar vendedor o subcanal" value={qRank} onChange={(e) => setQRank(e.target.value)} />
            </div>
            <label className="text-xs text-brand-graphite flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" className="accent-brand-primary" checked={soloConSinUso} onChange={(e) => setSoloConSinUso(e.target.checked)} />
              Solo vendedores con líneas sin uso
            </label>
            <div className="flex gap-1.5 sm:ml-auto text-xs">
              {([["sin_uso", "Más líneas sin uso"], ["pct_sin_uso", "Mayor % sin uso"], ["evaluables", "Más ventas Pospago"]] as [KRanking, string][]).map(([key, label]) => (
                <button key={key} onClick={() => ordRank.setOrden({ k: key, dir: "desc" })}
                  className={`px-2.5 py-1 rounded-full border font-semibold transition-colors ${ordRank.orden.k === key && ordRank.orden.dir === "desc" ? "bg-brand-ink text-white border-brand-ink" : "border-brand-border text-brand-slate hover:border-brand-ink"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {!rankingVisible.length ? (
            <div className="text-sm text-brand-mist py-6 text-center">No hay vendedores con ese criterio.</div>
          ) : (
            <div className="overflow-auto max-h-[70vh] -mx-5 px-5">
              <table className="w-full text-sm min-w-[860px]">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
                    <th className="px-3 py-2 text-left w-12">#</th>
                    <Th k="vendedor" label="Vendedor" orden={ordRank.orden} alternar={ordRank.alternar} dirInicial="asc" />
                    <Th k="sin_uso" label="Sin uso" align="right" orden={ordRank.orden} alternar={ordRank.alternar} />
                    <Th k="pct_sin_uso" label="% sin uso" align="right" orden={ordRank.orden} alternar={ordRank.alternar} title={`Sobre sus Pospago evaluables. Crítico: más de ${umbral}%`} />
                    <Th k="evaluables" label="Pospago evaluables" align="right" orden={ordRank.orden} alternar={ordRank.alternar} />
                    <Th k="con_uso" label="Con uso" align="right" orden={ordRank.orden} alternar={ordRank.alternar} />
                    <Th k="en_espera" label="En espera" align="right" orden={ordRank.orden} alternar={ordRank.alternar} />
                    <Th k="ultima" label="Ventas sin uso" orden={ordRank.orden} alternar={ordRank.alternar} title="Primera y última fecha de venta de sus líneas sin uso" />
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rankingVisible.map((f, i) => (
                    <tr key={f.vendedor} onClick={() => f.sin_uso && verLineasDe(f.vendedor)}
                      className={`border-b border-brand-border/60 ${f.sin_uso ? "cursor-pointer" : ""} ${f.critico ? "bg-brand-primary-light/50 hover:bg-brand-primary-light" : "hover:bg-brand-bg/60"}`}>
                      <td className="px-3 py-2">
                        <span className={`inline-grid place-items-center w-7 h-7 rounded-full text-xs font-bold tabular-nums ${
                          i === 0 ? "bg-brand-primary text-white" : i < 3 ? "bg-brand-primary-light text-brand-primary-dark" : "bg-brand-bg text-brand-slate"}`}>
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-brand-ink flex items-center gap-2">
                          {f.vendedor}
                          {f.critico && <span className="badge-primary">▲ Crítico</span>}
                        </div>
                        <div className="text-[11px] text-brand-mist">{f.subcanal ?? "—"}</div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-24 h-2 rounded-full bg-brand-bg overflow-hidden hidden md:block" aria-hidden>
                            <div className="h-full rounded-full" style={{ width: `${(f.sin_uso / maxSinUso) * 100}%`, background: C_SIN_USO }} />
                          </div>
                          <b className={`tabular-nums ${f.sin_uso ? "text-brand-primary" : "text-brand-mist"}`}>{n(f.sin_uso)}</b>
                        </div>
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${f.pct_sin_uso > umbral ? "text-brand-primary" : "text-brand-graphite"}`}>
                        {f.evaluables ? pct(f.pct_sin_uso) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{n(f.evaluables)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{n(f.con_uso)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-brand-slate">{f.en_espera ? n(f.en_espera) : "—"}</td>
                      <td className="px-3 py-2 text-xs text-brand-graphite whitespace-nowrap">
                        {f.primera ? (f.primera === f.ultima ? fechaCorta(f.primera) : <>{fechaCorta(f.primera)} <span className="text-brand-mist">→</span> {fechaCorta(f.ultima)}</>) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button className="text-xs font-semibold text-brand-slate hover:text-brand-primary whitespace-nowrap"
                          onClick={(e) => { e.stopPropagation(); setFicha(f.vendedor); }}>Ficha</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Seccion>
      )}

      {vista === "lineas" && (
        <Seccion
          titulo={fVendedor ? `Líneas sin uso de ${fVendedor}` : "Líneas Pospago sin uso"}
          sub={`${n(lineas.length)} línea(s) · sin consumo con ${DIAS_SIN_USO_ANTIGUA}+ días de activadas${tieneFechaVenta ? "" : " · este informe no trae la fecha de venta: se muestra la de activación (se completa al actualizarlo)"}`}
          accion={<button onClick={exportarLineas} disabled={!lineas.length} className="btn-secondary text-xs px-3 py-2 shrink-0"><Download size={14} /> CSV</button>}
        >
          <div className="grid sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto_auto_auto] gap-3 items-end mb-4">
            <div>
              <label className="label">Vendedor</label>
              <select className="input py-2" value={fVendedor} onChange={(e) => setFVendedor(e.target.value)}>
                <option value="">Todos ({n(vendedoresConLineas.length)})</option>
                {vendedoresConLineas.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Buscar</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mist" />
                <input className="input pl-9 py-2" placeholder="SDS, línea, plan, ciudad, legajo" value={qLinea} onChange={(e) => setQLinea(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label">Venta desde</label>
              <input type="date" className="input py-2" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div>
              <label className="label">Hasta</label>
              <input type="date" className="input py-2" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
            </div>
            <div className="flex items-center gap-3 pb-2">
              <label className="text-xs text-brand-graphite flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                <input type="checkbox" className="accent-brand-primary" checked={conEspera} onChange={(e) => setConEspera(e.target.checked)} /> Incluir en espera
              </label>
              {hayFiltros && <button onClick={limpiar} className="text-xs font-semibold text-brand-primary inline-flex items-center gap-1"><X size={12} /> Limpiar</button>}
            </div>
          </div>
          {!lineas.length ? (
            <div className="text-sm text-brand-mist py-6 text-center flex flex-col items-center gap-2"><ListFilter size={18} /> No hay líneas con esos filtros.</div>
          ) : (
            <div className="overflow-auto max-h-[70vh] -mx-5 px-5">
              <table className="w-full text-sm min-w-[1100px]">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
                    <Th k="fecha" label="Fecha venta" orden={ordLinea.orden} alternar={ordLinea.alternar} />
                    <Th k="fecha_activacion" label="Activación" orden={ordLinea.orden} alternar={ordLinea.alternar} />
                    <Th k="dias" label="Días" align="right" orden={ordLinea.orden} alternar={ordLinea.alternar} title="Días desde la activación hasta el corte" />
                    <Th k="vendedor" label="Vendedor" orden={ordLinea.orden} alternar={ordLinea.alternar} dirInicial="asc" />
                    <Th k="sds_number" label="SDS" orden={ordLinea.orden} alternar={ordLinea.alternar} />
                    <Th k="linea" label="Línea" orden={ordLinea.orden} alternar={ordLinea.alternar} />
                    <Th k="plan" label="Plan" orden={ordLinea.orden} alternar={ordLinea.alternar} dirInicial="asc" />
                    <Th k="origen" label="Origen" orden={ordLinea.orden} alternar={ordLinea.alternar} dirInicial="asc" />
                    <Th k="ciudad" label="Ciudad" orden={ordLinea.orden} alternar={ordLinea.alternar} dirInicial="asc" />
                    <Th k="riesgo" label="Riesgo" orden={ordLinea.orden} alternar={ordLinea.alternar} dirInicial="asc" />
                    <Th k="legajo" label="Legajo" orden={ordLinea.orden} alternar={ordLinea.alternar} dirInicial="asc" />
                    <th className="px-3 py-2 text-left font-semibold">Uso</th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((r) => (
                    <tr key={`${r.sds_number}-${r.linea}`} className="border-b border-brand-border/60 hover:bg-brand-bg/60">
                      <td className="px-3 py-1.5 whitespace-nowrap font-semibold text-brand-ink">
                        {r.fecha_venta ? fechaCorta(r.fecha_venta) : <span className="text-brand-mist font-normal" title="La venta no está en la hoja CARGAS de este corte">—</span>}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{fechaCorta(r.fecha_activacion)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.dias ?? "—"}</td>
                      <td className="px-3 py-1.5">
                        <button className="font-semibold text-brand-ink hover:text-brand-primary text-left whitespace-nowrap" onClick={() => setFicha(r.vendedor)}>{r.vendedor}</button>
                        <div className="text-[11px] text-brand-mist">{r.subcanal}</div>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">{r.sds_number}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{r.linea ?? "—"}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{r.plan ?? "—"}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{r.portacion === "SI" ? <>Portación <span className="text-brand-slate">{r.origen_portacion}</span></> : "Nativa"}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-xs">{r.ciudad ?? "—"}</td>
                      <td className="px-3 py-1.5">{r.riesgo ? <span className={r.riesgo === "A" ? "badge-primary" : r.riesgo === "M" ? "badge-orange" : "badge-neutral"}>{{ A: "Alto", M: "Medio", B: "Bajo" }[r.riesgo] ?? r.riesgo}</span> : "—"}</td>
                      <td className="px-3 py-1.5 text-xs">{r.legajo ?? "—"}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap"><UsoBadge estado={estadoUso(r, corte)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Seccion>
      )}

      {vista === "fechas" && (
        <div className="space-y-5">
          <Seccion
            titulo={`Pospago por fecha de ${tieneFechaVenta ? "venta" : "activación"}`}
            sub={`Con uso y sin uso por día${peorDia?.sin_uso ? ` · día con más líneas sin uso: ${fechaCorta(peorDia.dia)} (${n(peorDia.sin_uso)})` : ""} · clic en una barra para ver las líneas de ese día`}
          >
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={grafico} margin={{ left: -12, right: 8, top: 8, bottom: 0 }} barCategoryGap={3}
                  onClick={(e: any) => e?.activePayload?.[0] && verLineasDel(e.activePayload[0].payload.dia)}>
                  <CartesianGrid vertical={false} stroke="#eef0f4" />
                  <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: "#5B6275" }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5B6275" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,.04)" }}
                    labelFormatter={(_, p: any) => (p?.[0] ? fechaCorta(p[0].payload.dia) : "")} formatter={(v: number, name: string) => [n(v), name]} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => <span style={{ color: "#2A2F3A" }}>{v}</span>} />
                  <Bar isAnimationActive={false} dataKey="sinUso" name="Sin uso" stackId="a" fill={C_SIN_USO} stroke="#fff" strokeWidth={1} className="cursor-pointer" />
                  <Bar isAnimationActive={false} dataKey="conUso" name="Con uso" stackId="a" fill={C_USO} stroke="#fff" strokeWidth={1} className="cursor-pointer" />
                  <Bar isAnimationActive={false} dataKey="enEspera" name="En espera" stackId="a" fill="#C9CDD6" stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} className="cursor-pointer" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Seccion>
          <Seccion titulo="Detalle por día" sub="Ordenable. Clic en un día para ver sus líneas sin uso.">
            <div className="overflow-auto max-h-[60vh] -mx-5 px-5">
              <table className="w-full text-sm min-w-[620px]">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
                    <Th k="dia" label={tieneFechaVenta ? "Fecha venta" : "Fecha activación"} orden={ordFecha.orden} alternar={ordFecha.alternar} dirInicial="asc" />
                    <Th k="pospago" label="Pospago" align="right" orden={ordFecha.orden} alternar={ordFecha.alternar} />
                    <Th k="sin_uso" label="Sin uso" align="right" orden={ordFecha.orden} alternar={ordFecha.alternar} />
                    <Th k="pct_sin_uso" label="% sin uso" align="right" orden={ordFecha.orden} alternar={ordFecha.alternar} />
                    <Th k="vendedores" label="Vendedores con sin uso" align="right" orden={ordFecha.orden} alternar={ordFecha.alternar} />
                  </tr>
                </thead>
                <tbody>
                  {fechasOrdenadas.map((f) => (
                    <tr key={f.dia} onClick={() => f.sin_uso && verLineasDel(f.dia)}
                      className={`border-b border-brand-border/60 hover:bg-brand-bg/60 ${f.sin_uso ? "cursor-pointer" : ""}`}>
                      <td className="px-3 py-1.5 font-semibold text-brand-ink whitespace-nowrap">
                        <CalendarDays size={13} className="inline mr-1.5 text-brand-mist -mt-0.5" />
                        {new Date(`${f.dia}T12:00:00`).toLocaleDateString("es-PY", { weekday: "short", day: "2-digit", month: "2-digit" })}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{n(f.pospago)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-brand-primary">{f.sin_uso ? n(f.sin_uso) : <span className="text-brand-mist font-normal">0</span>}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${f.pct_sin_uso > umbral ? "text-brand-primary font-semibold" : ""}`}>{pct(f.pct_sin_uso)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{n(f.vendedores)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Seccion>
        </div>
      )}

      {ficha && (
        <VendedorDetalle
          d={d}
          nombre={ficha}
          lista={rankingVisible.map((f) => f.vendedor)}
          onClose={() => setFicha(null)}
          onCambiar={setFicha}
        />
      )}

      <p className="text-[11px] text-brand-mist flex items-center gap-1.5">
        <Trophy size={12} /> El ranking cuenta solo líneas Pospago evaluables (con {DIAS_SIN_USO_ANTIGUA}+ días de activadas al corte del {fechaCorta(corte)}). Las en espera se muestran aparte y no suman.
      </p>
    </div>
  );
}
