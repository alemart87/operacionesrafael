"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { PrintButton, PrintCover } from "@/components/PrintButton";
import { Bloque } from "@/components/facturacion/Bloque";
import { HistoriaNegocio } from "@/components/facturacion/HistoriaNegocio";
import { ExplicacionCuadros, VeredictoCierre } from "@/components/facturacion/CierreNegocio";
import { ObservacionConceptosEERR, Verificado } from "@/components/facturacion/ConceptosLiquidacion";
import { Afectados, MesAfectadoEditor, ResumenAfectados, describirVariaciones } from "@/components/facturacion/MesAfectado";
import { PostitsLienzo } from "@/components/facturacion/PostitsLienzo";
import { Nota, NotasSimulacion } from "@/components/facturacion/NotasSimulacion";
import { NumeroInput } from "@/components/facturacion/NumeroInput";
import { Marca, Marcable, Pin, Postit, RegistroSimulaciones, Snapshot } from "@/components/facturacion/RegistroSimulaciones";
import { VariablesNegocio } from "@/components/facturacion/VariablesNegocio";
import { VariablesGpon } from "@/components/facturacion/VariablesGpon";
import { CAMPOS_AFECTABLES, CAMPOS_AFECTABLES_GPON, CampoDef } from "@/components/facturacion/MesAfectado";
import { Lectura } from "@/components/televentas/Lectura";
import { apiFetch } from "@/lib/api";
import { formatGs, formatInt } from "@/lib/format";
import { dominiosAlineados } from "@/components/facturacion/ejes";
import { EstructuraOperativa } from "@/components/facturacion/EstructuraOperativa";

const M = (v: number) => `${Math.round(v / 1e6)}M`;

export type Negocio = "movil" | "gpon";

type EerrRow = [string, string | null, string | null, string];
type Cfg = {
  nombre: string; titulo: string; intro: string; paramsPath: string; anualPath: string;
  Variables: (props: { p: any; setP: (fn: any) => void; defaults: any; titulo?: string }) => React.ReactElement | null;
  campos: CampoDef[]; objetivoKey: string; objetivoLabel: string; unidad: string;
  textoSinBonos: string; textoConBonos: string; ajusteTxt: string; ajusteHint: string; ajustesTxt: string; cobrosTxt: string; devTxt: string; olaTxt: string;
  eerrRows: EerrRow[]; bonosCols: Array<[string, string]>; verificado: boolean; observacion: boolean;
  pHist: (p: any) => any;
};

/** Configuración por negocio: móvil (pospago) y GPON usan el MISMO simulador anual con sus
 *  propias variables, motor y etiquetas. */
const NEGOCIOS: Record<Negocio, Cfg> = {
  movil: {
    nombre: "Televentas CLARO", titulo: "Simulador Anual",
    intro: "Balance a 12 o 18 meses. Seteás el mes 1 (objetivo, tarifas, zafra y estructura); los meses siguientes solo cambian las ventas. La estructura fija del mes 1 se mantiene todo el año: lo que varía con las ventas son los bonos, las comisiones y la logística. Cada mes liquida su facturación más los ajustes (chargeback, cuota 2, residual) de los meses anteriores.",
    paramsPath: "/api/v1/televentas-claro/facturacion/simulador/parametros", anualPath: "/api/v1/televentas-claro/facturacion/simulador/anual",
    Variables: VariablesNegocio, campos: CAMPOS_AFECTABLES, objetivoKey: "objetivo_co", objetivoLabel: "objetivo CO", unidad: "ventas",
    textoSinBonos: "sin bono productividad ni bono efectividad", textoConBonos: "cada mes liquida según las escalas de Claro",
    ajusteTxt: "cuota 1, cuota 2 y plus de portabilidad", ajusteHint: "Simula una renegociación con Claro. No afecta bonos ni residual; las devoluciones por chargeback siguen los montos ajustados. La comisión y el plus de los vendedores son montos fijos por venta y no cambian con el ajuste: la mejora es íntegramente margen de Voicenter.",
    ajustesTxt: "residual, cuota 2, caídas", cobrosTxt: "cuota 2 y residual", devTxt: "chargebacks, legajos y devolución de bonos", olaTxt: "caídas del chargeback, recálculo del bono, legajos",
    eerrRows: [
      ["Ventas", "ventas", "int", "head"], ["INGRESOS DEL MES", null, null, "sep"],
      ["Activaciones (cuota 1)", "activaciones_cuota1", "gs", "row"], ["Plus portabilidad", "portabilidad", "gs", "row"],
      ["Bono productividad", "bono_productividad", "gs", "row"], ["Bono efectividad", "bono_efectividad", "gs", "row"], ["Bono adicional (a mano)", "bono_adicional", "gs", "row"],
      ["Facturación bruta", "facturacion_bruta", "gs", "sub"], ["AJUSTES DE COHORTES ANTERIORES", null, null, "sep"],
      ["+ Residual", "residual", "gs", "row"], ["+ Cuota 2", "cuota2", "gs", "row"], ["− Legajos", "legajos", "gs", "row"],
      ["− Devoluciones por caídas", "clawbacks", "gs", "row"], ["− Devolución bono efectividad", "clawback_bonos", "gs", "row"], ["− Recálculo bono productividad", "recalculo_productividad", "gs", "row"],
      ["INGRESO NETO LIQUIDADO", "ingreso_neto", "gs", "total"], ["COSTOS", null, null, "sep"],
      ["Estructura fija (salarios, cargas, premios logística)", "_fijo", "gs", "row"], ["Comisiones de vendedores (con IPS y aguinaldo)", "_comisiones", "gs", "row"],
      ["Plus de vendedores (sin cargas)", "_plus", "gs", "row"], ["Logística de entregas", "_logistica", "gs", "row"], ["Operativos", "_operativos", "gs", "row"],
      ["TOTAL COSTOS", "costo_total", "gs", "sub"], ["RESULTADO", "resultado", "gs", "total"], ["Margen %", "margen_pct", "pct", "pct"], ["Acumulado", "acumulado", "gs", "pct"],
    ],
    bonosCols: [["Bono productividad", "bono_productividad"], ["Bono efectividad", "bono_efectividad"]], verificado: true, observacion: true,
    pHist: (p) => p,
  },
  gpon: {
    nombre: "Negocio GPON · fibra y TV", titulo: "Simulador Anual GPON",
    intro: "Balance a 12 o 18 meses del negocio GPON (fibra + TV), con motor propio calibrado con las liquidaciones GPON 385 a 389. Seteás el mes 1 (activaciones, objetivo, planes, mora y estructura); los meses siguientes solo cambian las activaciones. Cada mes liquida cuota 1 y bono fijo más los ajustes de las cohortes anteriores: cuota 2 al mes 2, legajos, mora neta de reversos y recálculo del bono al día 180. Sin residual ni portabilidad.",
    paramsPath: "/api/v1/televentas-claro/facturacion/gpon/parametros", anualPath: "/api/v1/televentas-claro/facturacion/gpon/anual",
    Variables: VariablesGpon, campos: CAMPOS_AFECTABLES_GPON, objetivoKey: "objetivo", objetivoLabel: "objetivo de líneas", unidad: "activaciones",
    textoSinBonos: "sin bono fijo", textoConBonos: "cada mes liquida el bono fijo según la escala de Claro",
    ajusteTxt: "cuota 1 y cuota 2", ajusteHint: "Simula una renegociación con Claro sobre las cuotas. No afecta el bono ni la penalidad de mora. La comisión y el plus de los vendedores son montos fijos por venta: la mejora es íntegramente margen de Voicenter.",
    ajustesTxt: "cuota 2, legajos, mora, recálculo", cobrosTxt: "cuota 2", devTxt: "mora, legajos y recálculo del bono", olaTxt: "mora neta de reversos, recálculo del bono fijo, legajos",
    eerrRows: [
      ["Activaciones", "ventas", "int", "head"], ["INGRESOS DEL MES", null, null, "sep"],
      ["Cuota 1", "activaciones_cuota1", "gs", "row"], ["Bono fijo", "bono_productividad", "gs", "row"], ["Bono adicional (a mano)", "bono_adicional", "gs", "row"],
      ["Facturación bruta", "facturacion_bruta", "gs", "sub"], ["AJUSTES DE COHORTES ANTERIORES", null, null, "sep"],
      ["+ Cuota 2", "cuota2", "gs", "row"], ["− Legajos", "legajos", "gs", "row"], ["− Mora neta (penalizaciones − reversos)", "mora", "gs", "row"],
      ["− Recálculo del bono fijo", "recalculo", "gs", "row"], ["− Otros reversos", "otros", "gs", "row"],
      ["INGRESO NETO LIQUIDADO", "ingreso_neto", "gs", "total"], ["COSTOS", null, null, "sep"],
      ["Estructura fija (salarios, cargas, premios logística)", "_fijo", "gs", "row"], ["Comisiones de vendedores (con IPS y aguinaldo)", "_comisiones", "gs", "row"],
      ["Plus de vendedores (sin cargas)", "_plus", "gs", "row"], ["Logística de entregas", "_logistica", "gs", "row"], ["Operativos", "_operativos", "gs", "row"],
      ["TOTAL COSTOS", "costo_total", "gs", "sub"], ["RESULTADO", "resultado", "gs", "total"], ["Margen %", "margen_pct", "pct", "pct"], ["Acumulado", "acumulado", "gs", "pct"],
    ],
    bonosCols: [["Bono fijo", "bono_productividad"]], verificado: false, observacion: false,
    // la Historia lee claves de pospago: se mapean las de GPON
    pHist: (p) => (p ? { ...p, objetivo_co: p.objetivo, escala_productividad: p.escala_bono, residual_meses: 0, porta_pct: 0, efectividad_pct: 100 } : p),
  },
};

/** Simulador ANUAL (móvil o GPON): el mes 1 fija estructura y objetivo; los meses
 *  2..12 solo cambian las ventas. Balance de 12 meses con todas las cohortes. */
export function SimuladorAnual({ negocio }: { negocio: Negocio }) {
  const cfg = NEGOCIOS[negocio];
  const [p, setP] = useState<any>(null);
  const [defaults, setDefaults] = useState<any>(null);
  const [seteado, setSeteado] = useState(false);
  const [horizonte, setHorizonte] = useState<12 | 18>(12);
  const [ventas, setVentas] = useState<number[]>([]);
  const [nombres, setNombres] = useState<string[]>([]);       // nombres editables de los meses ("Octubre 2026")
  const [bonosAd, setBonosAd] = useState<number[]>([]);       // bono adicional a mano (Gs) por mes
  const [mostrarBonosAd, setMostrarBonosAd] = useState(false);
  const nombreMes = (i: number) => (nombres[i] || "").trim() || `Mes ${i + 1}`;
  const nombreCorto = (i: number) => { const n = nombreMes(i); return n.length > 12 ? n.slice(0, 11) + "…" : n; };
  const [res, setRes] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<any>(null);
  // Registro del trabajo: simulación guardada abierta, ítems marcados y post-its.
  const [actual, setActual] = useState<any | null>(null);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [postits, setPostits] = useState<Postit[]>([]);
  const [notas, setNotas] = useState<Nota[]>([]);      // notas y comentarios sobre la simulación (zona de trabajo)
  const [barra, setBarra] = useState(false);          // barra lateral de registro (se abre en pantallas anchas)
  // Meses afectados: variaciones propias de un mes (porta, efectividad, mix, costos variables…).
  const [afectados, setAfectados] = useState<Afectados>({});
  const [editandoMes, setEditandoMes] = useState<number | null>(null);
  const esAfectado = (mes: number) => !!afectados[String(mes)];
  const aplicarAfectado = (meses: number[], ov: any) =>
    setAfectados((prev) => { const n = { ...prev }; for (const m of meses) n[String(m)] = JSON.parse(JSON.stringify(ov)); return n; });
  const quitarAfectado = (mes: number) => setAfectados((prev) => { const n = { ...prev }; delete n[String(mes)]; return n; });
  useEffect(() => { setBarra(window.innerWidth >= 1280); }, []);
  const esMarcado = (key: string) => marcas.some((m) => m.key === key);
  const toggleMarca = (key: string, label: string) =>
    setMarcas((prev) => (prev.some((m) => m.key === key) ? prev.filter((m) => m.key !== key) : [...prev, { key, label }]));

  useEffect(() => {
    apiFetch<any>(cfg.paramsPath).then((d) => {
      setP(d.parametros); setDefaults(d.parametros);
    }).catch((e) => setError(e.message));
  }, [cfg.paramsPath]);

  const simular = useCallback((params: any, vpm: number[], h: number, af: Afectados, bad: number[], nm: string[]) => {
    apiFetch<any>(cfg.anualPath, {
      method: "POST", body: JSON.stringify({ parametros: params, ventas_por_mes: vpm, horizonte: h, meses_afectados: af, bonos_adicionales_por_mes: bad, nombres_meses: nm }),
    }).then((d) => { setRes(d); setError(null); }).catch((e) => setError(e.message));
  }, [cfg.anualPath]);

  useEffect(() => {
    if (!seteado || !p || ventas.length !== horizonte) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => simular(p, ventas, horizonte, afectados, bonosAd, nombres), 250);
    return () => clearTimeout(timer.current);
  }, [seteado, p, ventas, horizonte, afectados, bonosAd, nombres, simular]);

  const setear = () => {
    const v1 = Number(p.ventas) || 0;
    setVentas([v1, ...Array(horizonte - 1).fill(v1)]);
    setBonosAd((prev) => Array.from({ length: horizonte }, (_, i) => prev[i] ?? 0));
    setNombres((prev) => Array.from({ length: horizonte }, (_, i) => prev[i] ?? ""));
    setSeteado(true);
  };
  const cambiarHorizonte = (h: 12 | 18) => {
    setHorizonte(h);
    setVentas((prev) => {
      if (!prev.length) return prev;
      const base = prev[prev.length - 1] ?? prev[0];
      return h > prev.length ? [...prev, ...Array(h - prev.length).fill(base)] : prev.slice(0, h);
    });
    setBonosAd((prev) => Array.from({ length: h }, (_, i) => prev[i] ?? 0));
    setNombres((prev) => Array.from({ length: h }, (_, i) => prev[i] ?? ""));
  };
  const setNombre = (i: number, v: string) => setNombres((prev) => prev.map((x, j) => (j === i ? v.slice(0, 40) : x)));
  const setBonoAd = (i: number, v: number) => setBonosAd((prev) => prev.map((x, j) => (j === i ? Math.max(v, 0) : x)));
  const HorizonteToggle = () => (
    <div className="inline-flex rounded-md border border-brand-border overflow-hidden no-print">
      {([12, 18] as const).map((h) => (
        <button key={h} onClick={() => cambiarHorizonte(h)}
          className={`px-3 py-1.5 text-xs font-bold ${horizonte === h ? "bg-brand-primary text-white" : "text-brand-graphite hover:bg-brand-bg"}`}>
          {h} meses
        </button>
      ))}
    </div>
  );
  const editarMes1 = () => { setSeteado(false); setRes(null); };
  const setVenta = (i: number, v: number) => setVentas((prev) => prev.map((x, j) => (j === i ? v : x)));

  const meses: any[] = res?.meses ?? [];

  const ejesResultado = dominiosAlineados(
    meses.flatMap((x: any) => [x.ingreso_neto, x.costo_total, x.resultado, x.ola_devoluciones]),
    meses.map((x: any) => x.margen_pct),
  );
  const a = res?.anual;
  const hc = res?.headcount;

  const getSnapshot = (): Snapshot => ({
    parametros: p, ventas_por_mes: ventas, horizonte, meses_afectados: afectados, bonos_adicionales_por_mes: bonosAd, nombres_meses: nombres,
    resumen: a ? {
      ventas: a.ventas, facturacion_bruta: a.facturacion_bruta, ingreso_neto: a.ingreso_neto, costos: a.costos,
      resultado: a.resultado, margen_pct: a.margen_pct, resultado_con_cola: a.resultado_con_cola,
      bonos_activos: p?.bonos_activos !== false, ajuste_comisiones_pct: Number(p?.ajuste_comisiones_pct || 0),
    } : {},
  });
  const abrirSimulacion = (s: any) => {
    const h = (s.horizonte === 18 ? 18 : 12) as 12 | 18;
    setP(s.parametros);
    setHorizonte(h);
    const v = (s.ventas_por_mes || []).map(Number);
    while (v.length < h) v.push(v[v.length - 1] ?? Number(s.parametros?.ventas) ?? 0);
    setVentas(v.slice(0, h));
    setAfectados(s.meses_afectados ?? {});
    setBonosAd(Array.from({ length: h }, (_, i) => Number(s.bonos_adicionales_por_mes?.[i] ?? 0)));
    setNombres(Array.from({ length: h }, (_, i) => String(s.nombres_meses?.[i] ?? "")));
    setMostrarBonosAd((s.bonos_adicionales_por_mes ?? []).some((x: number) => Number(x) > 0));
    setMarcas(s.marcas ?? []);
    setPostits(s.postits ?? []);
    setNotas(s.notas ?? []);
    setSeteado(true);
  };

  return (
    <AppShell>
      <PrintCover titulo={`${cfg.titulo} · ${horizonte} meses`}
        periodo={a ? `${formatInt(a.ventas)} ${cfg.unidad} en ${horizonte} meses · ingreso neto ${formatGs(a.ingreso_neto)} · resultado ${formatGs(a.resultado)} (${a.margen_pct}%)${p?.bonos_activos === false ? " · SIN BONOS" : ""} · ${cfg.nombre}` : undefined} />

      <div className="mb-2 text-xs text-brand-slate no-print">
        <Link href="/televentas-claro/facturacion" className="hover:text-brand-primary">Facturación</Link>
        <span className="mx-2">/</span><span className="text-brand-ink font-semibold">{cfg.titulo}</span>
      </div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl text-brand-ink uppercase">{cfg.titulo}</h1>
          <p className="text-sm text-brand-slate mt-1 max-w-3xl">{cfg.intro}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate no-print">Horizonte</span>
          <HorizonteToggle />
          <button onClick={() => setBarra(!barra)} className={`no-print px-3 py-1.5 rounded-md text-xs font-bold border ${barra ? "bg-brand-ink text-white border-brand-ink" : "border-brand-border text-brand-graphite hover:border-brand-ink"}`}>
            {barra ? "Ocultar registro ›" : "‹ Registro del trabajo"}
          </button>
          <PrintButton label="Imprimir / Guardar PDF" />
        </div>
      </div>

      {error && <p className="text-sm text-brand-primary mb-4">{error}</p>}
      {!p && !error && <div className="text-brand-slate">Cargando variables de negocio…</div>}

      {/* ===== Barra lateral de registro (se muestra / oculta) ===== */}
      {p && (
        <RegistroSimulaciones abierta={barra} setAbierta={setBarra} listo={seteado && !!res} getSnapshot={getSnapshot} onAbrir={abrirSimulacion}
          actual={actual} setActual={setActual} marcas={marcas} setMarcas={setMarcas} postits={postits} setPostits={setPostits} notas={notas} setNotas={setNotas} nombresMeses={ventas.map((_, i) => nombreMes(i))} negocio={negocio} />
      )}
      {actual && (
        <div className="print-only card p-4 mb-4">
          <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate">Simulación guardada</div>
          <div className="font-display text-xl text-brand-ink uppercase">{actual.nombre}</div>
          {actual.comentario && <p className="text-sm text-brand-ink mt-1 whitespace-pre-line">{actual.comentario}</p>}
          <div className="text-[11px] text-brand-slate mt-1">Guardada por {actual.created_by_nombre || "—"} el {new Date(actual.created_at).toLocaleDateString("es-PY")}{marcas.length ? ` · marcados: ${marcas.map((m) => m.label).join(", ")}` : ""}</div>
        </div>
      )}

      {/* ===== Lienzo de trabajo: los post-its flotan sobre él; deja lugar a la barra cuando está abierta ===== */}
      <div className={`relative transition-[padding] ${barra ? "xl:pr-[384px]" : ""}`}>
      <PostitsLienzo postits={postits} setPostits={setPostits} marcas={marcas} />

      {/* ===== Paso 1: setear el mes 1 ===== */}
      {p && !seteado && (
        <div className="grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2">
            <cfg.Variables p={p} setP={setP} defaults={defaults} titulo="Mes 1 — variables y estructura" />
          </div>
          <div className="lg:col-span-3">
            <section className="card p-6 border-2 border-brand-primary">
              <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate mb-1">Paso 1 de 2</div>
              <h2 className="font-display text-2xl text-brand-ink uppercase mb-2">Setear el mes 1</h2>
              <p className="text-sm text-brand-graphite leading-relaxed mb-4">
                Con las ventas del mes 1 (<b>{formatInt(Number(p.ventas) || 0)}</b>) se dimensiona la estructura:
                {" "}<b>{Math.ceil((Number(p.ventas) || 0) / Math.max(Number(p.costos.ventas_por_vendedor) || 1, 1))} vendedores</b>,
                {" "}{Math.ceil(Math.ceil((Number(p.ventas) || 0) / Math.max(Number(p.costos.ventas_por_vendedor) || 1, 1)) / Math.max(Number(p.costos.supervisor_cada_vendedores) || 1, 1))} supervisores,
                {" "}{Math.ceil((Number(p.ventas) || 0) / Math.max(Number(p.costos.backoffice_cada_ventas) || 1, 1))} backoffice, {p.costos.coordinadores} coordinador y {p.costos.controllers} controllers{Number(p.costos.subgerencia_salario) > 0 ? <> y <b className="text-brand-primary">1 SubGerencia Comercial</b> ({formatGs(Number(p.costos.subgerencia_salario))}/mes, en análisis)</> : null}.
                Esa estructura y el {cfg.objetivoLabel} de <b>{formatInt(Number(p[cfg.objetivoKey]) || 0)}</b> quedan fijos para los {horizonte} meses.
              </p>
              <button onClick={setear} disabled={!(Number(p.ventas) > 0)} className="btn-primary !px-6 !py-3 text-base shadow-lg disabled:opacity-50">
                Setear mes 1 y fijar la estructura →
              </button>
              <p className="text-[11px] text-brand-slate mt-3">Después vas a cargar solo las {cfg.unidad} de los meses 2 a {horizonte}. Podés volver a editar el mes 1 cuando quieras.</p>
            </section>
          </div>
        </div>
      )}

      {/* ===== Paso 2: ventas por mes + resultados ===== */}
      {p && seteado && (
        <div className="space-y-6">
          <section className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate">Mes 1 seteado · estructura fija</div>
                <div className="text-sm text-brand-ink mt-1">
                  {hc ? <><b>{hc.vendedores}</b> vendedores · <b>{hc.supervisores}</b> supervisores · <b>{hc.backoffice}</b> backoffice · {hc.coordinadores} coordinador · {hc.controllers} controllers{hc.subgerencia ? <> · <b className="text-brand-primary">1 SubGerencia Comercial</b></> : null}</> : "calculando…"}
                  {" "}· {cfg.objetivoLabel} <b>{formatInt(Number(p[cfg.objetivoKey]))}</b> · {p.costos.ventas_por_vendedor} ventas/vendedor
                  {a ? <> · costo fijo <b>{formatGs(a.costos_fijos_mes)}</b>/mes</> : null}
                  {p.bonos_activos === false ? <span className="ml-2 px-1.5 py-0.5 rounded bg-brand-ink text-white text-[10px] font-bold">SIN BONOS</span> : null}
                </div>
              </div>
              <button onClick={editarMes1} className="no-print text-sm text-brand-graphite border border-brand-border rounded px-3 py-2 hover:border-brand-primary">Editar mes 1</button>
            </div>
            <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate mb-2">{negocio === "gpon" ? "Activaciones por mes" : "Ventas efectivas por mes"}</div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-12 gap-2">
              {ventas.map((v, i) => (
                <label key={i} className={`text-[10px] ${i === 0 ? "text-brand-primary font-bold" : "text-brand-slate"} ${esMarcado(`mes:${i + 1}`) ? "rounded ring-2 ring-amber-400 ring-offset-1 bg-amber-50" : ""} ${esAfectado(i + 1) ? "rounded ring-2 ring-brand-purple ring-offset-1 bg-brand-purple/5" : ""}`}
                  title={esAfectado(i + 1) ? describirVariaciones(afectados[String(i + 1)], p, cfg.campos).join(" · ") : undefined}>
                  <span className="flex items-center justify-between gap-1">
                    <span className="flex items-center gap-1 min-w-0">
                      <input value={nombres[i] ?? ""} placeholder={`Mes ${i + 1}`} onChange={(e) => setNombre(i, e.target.value)} title="Nombre del mes (editable)"
                        className="no-print min-w-0 w-full bg-transparent border-b border-dashed border-brand-border focus:border-brand-primary outline-none text-[10px] font-semibold text-inherit placeholder:text-brand-slate/70" />
                      <span className="print-only">{nombreMes(i)}</span>
                      {i === 0 && <span className="shrink-0">(seteado)</span>}
                    </span>
                    <span className="flex items-center gap-0.5">
                      {i > 0 && (
                        <button type="button" onClick={() => setEditandoMes(i + 1)} title="Editar este mes: variaciones propias (porta, efectividad, mix…)"
                          className={`no-print inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] leading-none ${esAfectado(i + 1) ? "bg-brand-purple text-white" : "border border-brand-border text-brand-slate opacity-40 hover:opacity-100 hover:border-brand-purple hover:text-brand-purple"}`}>✎</button>
                      )}
                      <Pin marcado={esMarcado(`mes:${i + 1}`)} onClick={() => toggleMarca(`mes:${i + 1}`, `${nombreMes(i)} (${formatInt(v)} ventas)`)} className="!w-5 !h-5 !text-[10px]" />
                    </span>
                  </span>
                  <NumeroInput step={10} min={0} value={v} disabled={i === 0} onChange={(n) => setVenta(i, n)}
                    className={`input !py-1 !px-1.5 text-sm text-right w-full ${i === 0 ? "bg-brand-bg-soft" : ""}`} />
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mt-2 no-print">
              <button onClick={() => setVentas((prev) => prev.map((x, i) => (i === 0 ? x : prev[0])))} className="text-[11px] text-brand-primary font-semibold hover:underline">Igualar todos al mes 1</button>
              <button onClick={() => setVentas((prev) => prev.map((x, i) => (i === 0 ? x : Math.round(prev[0] * Math.pow(1.02, i)))))} className="text-[11px] text-brand-primary font-semibold hover:underline">Crecer 2% mensual</button>
              <button onClick={() => setVentas((prev) => prev.map((x, i) => (i === 0 ? x : Math.round(prev[0] * Math.pow(0.98, i)))))} className="text-[11px] text-brand-primary font-semibold hover:underline">Caer 2% mensual</button>
              <span className="text-[11px] text-brand-slate ml-auto">✎ sobre un mes = variaciones propias de ese mes (menos porta, otra efectividad, otro mix…)</span>
            </div>

            {/* ===== Bono adicional a mano, por mes ===== */}
            <div className="mt-4 rounded-md border-2 border-brand-orange bg-brand-orange/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-orange">Bono adicional (a mano)</div>
                  <div className="text-[11px] text-brand-graphite">Gs por mes: campañas, premios o acuerdos puntuales con Claro. Se factura en el mes, no se devuelve. Por defecto 0.
                    {bonosAd.some((x) => x > 0) && <b className="ml-1 text-brand-orange">Total {formatGs(bonosAd.reduce((s, x) => s + x, 0))}</b>}</div>
                </div>
                <div className="no-print flex items-center gap-2">
                  {bonosAd.some((x) => x > 0) && <button onClick={() => setBonosAd(bonosAd.map(() => 0))} className="text-[11px] text-brand-slate hover:text-brand-primary">Poner todo en 0</button>}
                  <button onClick={() => setMostrarBonosAd(!mostrarBonosAd)} className="px-3 py-1 rounded text-[11px] font-bold bg-brand-orange text-white hover:bg-brand-orange/90">
                    {mostrarBonosAd ? "Ocultar" : "Cargar bono por mes"}
                  </button>
                </div>
              </div>
              {(mostrarBonosAd || bonosAd.some((x) => x > 0)) && (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-12 gap-2 mt-3">
                  {bonosAd.map((b, i) => (
                    <label key={i} className={`text-[10px] ${b > 0 ? "text-brand-orange font-bold" : "text-brand-slate"}`}>
                      <span className="block truncate" title={nombreMes(i)}>{nombreCorto(i)}</span>
                      <NumeroInput step={1000000} min={0} value={b} onChange={(n) => setBonoAd(i, n)} placeholder="0"
                        className={`input !py-1 !px-1.5 text-sm text-right w-full ${b > 0 ? "border-brand-orange" : ""}`} />
                    </label>
                  ))}
                  <div className="no-print col-span-full flex gap-3 text-[11px]">
                    <button onClick={() => setBonosAd(bonosAd.map((x, i) => (i === 0 ? x : bonosAd[0])))} className="text-brand-orange font-semibold hover:underline">Igualar todos al mes 1</button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <NotasSimulacion notas={notas} setNotas={setNotas} nombres={ventas.map((_, i) => nombreMes(i))} guardaSola={!!actual} soloImpresion />
          {editandoMes != null && (
            <MesAfectadoEditor mes={editandoMes} nombre={nombreMes(editandoMes - 1)} nombres={nombres.map((_, i) => nombreMes(i))} horizonte={horizonte} base={p} ventas={ventas[editandoMes - 1] ?? 0}
              actual={afectados[String(editandoMes)]}
              onAplicar={(meses, ov) => { aplicarAfectado(meses, ov); setEditandoMes(null); }}
              onQuitar={(m) => { quitarAfectado(m); setEditandoMes(null); }}
              onCerrar={() => setEditandoMes(null)} campos={cfg.campos} />
          )}

          <div className={`flex flex-wrap items-center justify-between gap-3 rounded-md border-2 px-4 py-3 ${p.bonos_activos === false ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border bg-white"}`}>
            <div>
              <div className={`text-[10px] uppercase tracking-wider2 font-bold ${p.bonos_activos === false ? "text-white/70" : "text-brand-slate"}`}>Escenario de bonos</div>
              <div className="text-sm font-semibold">
                {p.bonos_activos === false
                  ? `Bonos DESACTIVADOS — los ${horizonte} meses se calculan ${cfg.textoSinBonos}`
                  : `Bonos activos — ${cfg.textoConBonos}`}
              </div>
            </div>
            <button onClick={() => setP((prev: any) => ({ ...prev, bonos_activos: prev.bonos_activos === false }))}
              className={`no-print px-4 py-2 rounded-md text-sm font-bold transition-colors ${p.bonos_activos === false ? "bg-white text-brand-ink hover:bg-brand-bg" : "bg-brand-primary text-white hover:bg-brand-primary/90"}`}>
              {p.bonos_activos === false ? "Reactivar bonos" : "Simular sin bonos"}
            </button>
          </div>


          <div className="rounded-md border-2 border-brand-primary bg-brand-primary/5 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-primary">Ajuste de comisiones</div>
              <div className="text-sm font-semibold text-brand-ink">
                {Number(p.ajuste_comisiones_pct || 0) === 0
                  ? `Sin ajuste — ${cfg.ajusteTxt} según tarifa vigente`
                  : `${cfg.ajusteTxt.charAt(0).toUpperCase() + cfg.ajusteTxt.slice(1)} ${Number(p.ajuste_comisiones_pct) > 0 ? "mejoran" : "bajan"} ${Math.abs(Number(p.ajuste_comisiones_pct))}%`}
              </div>
              <div className="text-[11px] text-brand-slate">{cfg.ajusteHint}</div>
            </div>
            <label className="flex items-center gap-2 text-sm no-print">
              <span className="text-brand-graphite">Ajuste</span>
              <input type="number" step={0.5} value={p.ajuste_comisiones_pct ?? 0}
                onChange={(e) => setP((prev: any) => ({ ...prev, ajuste_comisiones_pct: Number(e.target.value) }))}
                className="input max-w-[90px] !py-1.5 text-right font-bold text-brand-primary" />
              <span className="text-brand-graphite">%</span>
            </label>
          </div>

          <Bloque titulo="Detalle de meses y variables" accent="purple" abierto={Object.keys(afectados).length > 0}
            hint={Object.keys(afectados).length ? `${Object.keys(afectados).length} mes(es) con variaciones propias` : "ningún mes con variaciones"}>
            <ResumenAfectados afectados={afectados} base={p} ventas={ventas} nombres={nombres.map((_, i) => nombreMes(i))} onEditar={(m) => setEditandoMes(m)} onQuitar={quitarAfectado} sinCard campos={cfg.campos} />
          </Bloque>

          {res && a && (
            <>
              <Bloque titulo="Estructura operativa necesaria" hint={hc ? `${hc.vendedores} vendedores · ${hc.supervisores} supervisores · ${hc.backoffice} backoffice · ${hc.total} personas · fija los ${horizonte} meses` : "estructura fija del mes 1"}>
                <EstructuraOperativa costos={meses[0]?.costos} p={p} ventas={ventas[0] ?? 0} sinCard
                  intro={`Estructura del mes 1, fija para los ${horizonte} meses. Dimensionada para ${formatInt(ventas[0] ?? 0)} ventas efectivas`} />
              </Bloque>

              <Bloque titulo="Datos generales operativos y financieros" hint={`${horizonte} meses · ${formatInt(a.ventas)} ventas`}>
              <div className="rounded-md border-l-4 border-brand-ink bg-brand-bg-soft px-4 py-3 mb-4">
                <h3 className="text-[11px] uppercase tracking-wider2 text-brand-slate font-bold mb-1">Conclusión del período ({horizonte} meses)</h3>
                <p className="text-[15px] text-brand-ink leading-relaxed font-medium">{res.conclusion}</p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {([
                  ["kpi:ventas", `Ventas en ${horizonte} meses`, <KpiCard key="k1" label={`Ventas en ${horizonte} meses`} value={formatInt(a.ventas)} hint={`${formatInt(Math.round(a.ventas / horizonte))} por mes`} accent="neutral" />],
                  ["kpi:bruta", "Facturación bruta", <KpiCard key="k2" label="Facturación bruta" value={formatGs(a.facturacion_bruta)} hint={`suma de los ${horizonte} meses`} accent="primary" />],
                  ["kpi:neto", "Ingreso neto liquidado", <KpiCard key="k3" label="Ingreso neto liquidado" value={formatGs(a.ingreso_neto)} hint={`ajustes ${formatGs(a.ajustes)}`} accent="cyan" />],
                  ["kpi:costos", "Costos del período", <KpiCard key="k4" label="Costos del período" value={formatGs(a.costos)} hint={`fijos ${formatGs(a.costos_fijos_mes)}/mes`} accent="orange" />],
                  ["kpi:resultado", `Resultado a ${horizonte} meses`, <KpiCard key="k5" label={`Resultado a ${horizonte} meses`} value={formatGs(a.resultado)} hint={`${a.margen_pct}% sobre ingreso neto`} accent={a.resultado >= 0 ? "cyan" : "primary"} />],
                  ["kpi:cola", `Con cola post-${horizonte}`, <KpiCard key="k6" label={`Con cola post-${horizonte}`} value={formatGs(a.resultado_con_cola)} hint={`pendiente ${formatGs(a.cola_post_12.total)}`} accent={a.resultado_con_cola >= 0 ? "cyan" : "primary"} />],
                ] as Array<[string, string, React.ReactNode]>).map(([key, label, card]) => (
                  <Marcable key={key} marcado={esMarcado(key)} onToggle={() => toggleMarca(key, label)}>{card}</Marcable>
                ))}
              </div>
              </Bloque>

              <Bloque titulo="Historia del negocio · línea de tiempo animada" abierto accent="primary" hint="dale play: el gráfico se construye mes a mes con sus hitos y alertas">
                <HistoriaNegocio res={res} p={cfg.pHist(p)} nombre={nombreMes} />
              </Bloque>

              {a.veredicto && (() => {
                const cola = a.cola_post_12;
                const v = a.veredicto;
                const gana = v.gana;
                const respuesta = gana
                  ? `Sí. Los ${horizonte} meses facturan ${formatGs(a.facturacion_bruta)}; con las devoluciones y cobros que llegan dentro del período quedan ${formatGs(a.ingreso_neto)} liquidados contra ${formatGs(a.costos)} de costos. Sumando lo que las cohortes todavía tienen pendiente después del mes ${horizonte}, el negocio cierra ganando ${formatGs(v.resultado_final)} (${v.pct_sobre_ingreso}% del ingreso).`
                  : `No. Los ${horizonte} meses facturan ${formatGs(a.facturacion_bruta)}; con las devoluciones y cobros que llegan dentro del período quedan ${formatGs(a.ingreso_neto)} liquidados contra ${formatGs(a.costos)} de costos. Sumando lo que las cohortes todavía tienen pendiente después del mes ${horizonte}, el negocio cierra perdiendo ${formatGs(Math.abs(v.resultado_final))} (${v.pct_sobre_ingreso}% del ingreso).`;
                const notas = [
                  `Sin la cola, el período ${v.periodo_gana ? "gana" : "pierde"} ${formatGs(Math.abs(a.resultado))}. La cola ${cola.total >= 0 ? "suma" : "resta"} ${formatGs(Math.abs(cola.total))}: ${formatGs(cola.cobros)} por cobrar (${cfg.cobrosTxt}, hasta el mes ${cola.ultimo_mes_residual}) contra ${formatGs(Math.abs(cola.devoluciones))} por devolver (${cfg.devTxt} hasta el mes ${cola.ultimo_mes_caidas}).`,
                  v.la_cola_lo_da_vuelta
                    ? (gana ? "La cola da vuelta el resultado: el período cerraba en pérdida y lo pendiente por cobrar lo lleva a ganancia. Depende de que las líneas sigan activas según la zafra."
                            : "La cola da vuelta el resultado: el período cerraba en ganancia pero las devoluciones pendientes de las últimas cohortes la consumen.")
                    : `El signo no cambia con la cola: lo que el período muestra es lo que el negocio ${gana ? "gana" : "pierde"} de verdad.`,
                  `La cola es solo lo que las ${horizonte} cohortes ya vendidas tienen por liquidar; no incluye ventas nuevas. Si el negocio sigue, el mes ${horizonte + 1} arranca con esa cola ${cola.total >= 0 ? "a favor" : "en contra"}.`,
                ];
                return (
                  <>
                    <Bloque titulo="Qué significa cada cuadro" hint="uno por uno, con el valor de esta simulación">
                    <ExplicacionCuadros sinCard
                      intro={`Los seis cuadros de "Datos generales", uno por uno, con el valor de esta simulación de ${horizonte} meses.`}
                      items={[
                        { label: `Ventas en ${horizonte} meses`, valor: formatInt(a.ventas), accent: "neutral",
                          queEs: `La suma de las ventas cargadas mes a mes (${formatInt(Math.round(a.ventas / horizonte))} por mes en promedio).`,
                          comoLeerlo: `Cada mes es una cohorte: factura en su mes y después ajusta durante los meses siguientes (${cfg.ajustesTxt}).` },
                        { label: "Facturación bruta", valor: formatGs(a.facturacion_bruta), accent: "primary",
                          queEs: "Lo que cada mes factura en el momento de la venta: cuota 1, plus de portabilidad y bonos, sumado en el período.",
                          comoLeerlo: "No es ingreso: una parte se devuelve cuando las líneas caen. Es el punto de partida del puente de la derecha." },
                        { label: "Ingreso neto liquidado", valor: formatGs(a.ingreso_neto), accent: "cyan",
                          queEs: `Facturación bruta menos las devoluciones (${formatGs(Math.abs(a.devoluciones_periodo))}) más los cobros (${formatGs(a.cobros_periodo)}) que llegaron dentro del período.`,
                          comoLeerlo: `Es lo que Claro efectivamente liquidó en estos ${horizonte} meses. Los ajustes de las últimas cohortes todavía no llegaron: están en la cola.` },
                        { label: "Costos del período", valor: formatGs(a.costos), accent: "orange",
                          queEs: `Estructura fija del mes 1 (${formatGs(a.costos_fijos_mes)} por mes) más comisiones, logística y operativos de cada mes.`,
                          comoLeerlo: "Los fijos se pagan aunque un mes venda menos; los variables siguen a las ventas. Se pagan en el mes, sin espera." },
                        { label: `Resultado a ${horizonte} meses`, valor: formatGs(a.resultado), accent: a.resultado >= 0 ? "cyan" : "primary",
                          queEs: "Ingreso neto liquidado menos costos del período: lo que el período dejó en caja.",
                          comoLeerlo: "Está incompleto: las últimas cohortes todavía tienen caídas por devolver y residual por cobrar. Es caja, no resultado final." },
                        { label: `Con cola post-${horizonte}`, valor: formatGs(a.resultado_con_cola), accent: a.resultado_con_cola >= 0 ? "cyan" : "primary",
                          queEs: `Resultado más lo pendiente de las cohortes después del mes ${horizonte}: ${formatGs(cola.cobros)} por cobrar y ${formatGs(Math.abs(cola.devoluciones))} por devolver.`,
                          comoLeerlo: "Es la respuesta a “ganamos o perdemos”: cuando ya no queda nada por caer ni por cobrar, este es el número." },
                      ]}
                    />
                    </Bloque>
                    <Bloque titulo={`¿Ganamos o perdemos al final, cuando cayeron todas las caídas de los ${horizonte} meses?`} accent={gana ? "ink" : "primary"}
                      hint={<span className={`font-bold ${gana ? "text-emerald-700" : "text-brand-primary"}`}>{gana ? "Ganamos" : "Perdemos"} {formatGs(Math.abs(v.resultado_final))}</span>}>
                    <VeredictoCierre sinCard
                      gana={gana}
                      monto={v.resultado_final}
                      titulo={`¿Ganamos o perdemos al final, cuando cayeron todas las caídas de los ${horizonte} meses?`}
                      respuesta={respuesta}
                      pasos={[
                        { label: "Facturación bruta", valor: a.facturacion_bruta, tipo: "base", nota: `${horizonte} meses de ventas` },
                        { label: "Devoluciones dentro del período", valor: a.devoluciones_periodo, tipo: "menos", nota: `${cfg.devTxt} de las cohortes ya liquidadas` },
                        { label: "Cobros dentro del período", valor: a.cobros_periodo, tipo: "mas", nota: `${cfg.cobrosTxt} de las cohortes anteriores` },
                        { label: "Ingreso neto liquidado", valor: a.ingreso_neto, tipo: "sub" },
                        { label: "Costos del período", valor: a.costos, tipo: "menos", nota: `fijos ${formatGs(a.costos_fijos_mes)}/mes + variables` },
                        { label: `Resultado a ${horizonte} meses`, valor: a.resultado, tipo: "sub" },
                        { label: `Devoluciones pendientes después del mes ${horizonte}`, valor: cola.devoluciones, tipo: "menos", nota: `caídas de las últimas cohortes, hasta el mes ${cola.ultimo_mes_caidas}` },
                        { label: `Cobros pendientes después del mes ${horizonte}`, valor: cola.cobros, tipo: "mas", nota: `${cfg.cobrosTxt}, hasta el mes ${cola.ultimo_mes_residual}` },
                        { label: "Resultado final con todas las caídas", valor: v.resultado_final, tipo: "final", nota: `${v.pct_sobre_ingreso}% del ingreso total` },
                      ]}
                      notas={notas}
                    />
                    </Bloque>
                  </>
                );
              })()}

              {(a.meses_en_riesgo?.length > 0) && (
                <section className="card p-5 border-2 border-brand-primary bg-brand-primary/5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[260px] flex-1">
                      <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-primary">Riesgo potencial por bajar productividad · la ola de la zafra</div>
                      <div className="font-display text-2xl text-brand-ink uppercase mt-0.5">{a.meses_en_riesgo.length} de {horizonte} meses no cubren la ola heredada</div>
                      <p className="text-[13px] text-brand-graphite leading-relaxed mt-2">
                        Cada mes de ventas deja comprometidas devoluciones para los meses siguientes ({cfg.olaTxt}).
                        Con ventas estables esa ola crece hasta estabilizarse alrededor del mes {a.ola_maxima_mes} ({formatGs(Math.abs(a.ola_maxima))} por mes). Si después las ventas bajan,
                        la ola sigue pegando sobre una facturación menor y el mes pierde, aunque la estructura no cambie. El área roja de los gráficos muestra esa ola y las ventas mínimas que exige.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {a.meses_en_riesgo.map((mm: number) => {
                          const f = meses[mm - 1];
                          return <span key={mm} className="px-2 py-0.5 rounded-full bg-brand-primary text-white text-[11px] font-bold">{nombreMes(mm - 1)}: {formatInt(f.ventas)} vs {f.ventas_equilibrio == null ? "ni triplicando" : `${formatInt(f.ventas_equilibrio)} necesarias`}</span>;
                        })}
                      </div>
                    </div>
                    <div className="rounded-md border border-brand-border bg-white px-4 py-3 text-right">
                      <div className="text-[9px] uppercase tracking-wider2 text-brand-slate">Ola máxima</div>
                      <div className="font-mono text-lg font-bold text-brand-primary">{formatGs(Math.abs(a.ola_maxima))}</div>
                      <div className="text-[10px] text-brand-slate">devoluciones heredadas en {nombreMes(a.ola_maxima_mes - 1)}</div>
                      <div className="text-[9px] uppercase tracking-wider2 text-brand-slate mt-2">Ventas mínimas para no perder</div>
                      <div className="font-mono text-lg font-bold text-brand-ink">hasta {formatInt(a.ventas_equilibrio_max)} / mes</div>
                    </div>
                  </div>
                </section>
              )}

              <Bloque titulo="Gráficos del período" abierto envuelto={false} hint="resultado mes a mes · ventas vs estructura · ola de la zafra en rojo">
              <div className="grid xl:grid-cols-2 gap-6 print:block">
                <section className="card p-5 print:mb-5">
                  <h2 className="font-display text-lg text-brand-ink uppercase mb-1">Resultado mes a mes</h2>
                  <p className="text-xs text-brand-slate mb-3">Ingreso neto liquidado (con ajustes de cohortes anteriores) vs costos; barras de resultado y línea de margen del mes (%, eje derecho). El área roja es la ola: las devoluciones que las cohortes anteriores ya dejaron comprometidas para ese mes, venda lo que venda.</p>
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={meses} margin={{ top: 8, right: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="mes" fontSize={10} tickFormatter={(v: number) => nombreCorto(v - 1)} />
                      <YAxis yAxisId="l" fontSize={10} tickFormatter={M} domain={ejesResultado.izq} allowDataOverflow />
                      <YAxis yAxisId="r" orientation="right" fontSize={10} tickFormatter={(v: number) => `${Math.round(v)}%`} domain={ejesResultado.der} ticks={ejesResultado.ticksDer} allowDataOverflow />
                      <Tooltip
                        formatter={(v: any, name: any) => (name === "Margen del mes" ? `${Number(v).toFixed(1)}%` : formatGs(Number(v)))}
                        labelFormatter={(l) => nombreMes(Number(l) - 1)}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine yAxisId="l" y={0} stroke="#0F1116" />
                      <Bar yAxisId="l" dataKey="ingreso_neto" name="Ingreso neto" fill="#0EA5E9" fillOpacity={0.6} />
                      <Bar yAxisId="l" dataKey="costo_total" name="Costos" fill="#F39200" fillOpacity={0.6} />
                      <Area yAxisId="l" dataKey="ola_devoluciones" name="Ola de devoluciones heredadas" stroke="#E6332A" fill="#E6332A" fillOpacity={0.28} strokeWidth={1.5} type="monotone" />
                      <Bar yAxisId="l" dataKey="resultado" name="Resultado">
                        {meses.map((m: any) => <Cell key={m.mes} fill={m.resultado >= 0 ? "#10B981" : "#E6332A"} />)}
                      </Bar>
                      <Line yAxisId="r" dataKey="margen_pct" name="Margen del mes" stroke="#0F1116" strokeWidth={2.5} dot={{ r: 2.5 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <Lectura>
                    Cada mes liquida la facturación de sus ventas más lo que devuelven o suman las cohortes anteriores. El mes 1
                    no tiene ajustes (todavía no cayó nada); desde el mes 2 llegan los chargebacks y desde el 3 la cuota 2. Por
                    eso el mes 1 suele verse mejor que el resto. La línea negra es el margen de cada mes (resultado sobre
                    ingreso neto, eje derecho): cuando se estabiliza, ese es el margen real del negocio en régimen. El
                    acumulado del período está en la tabla de abajo y en el cierre.
                  </Lectura>
                </section>

                <section className="card p-5">
                  <h2 className="font-display text-lg text-brand-ink uppercase mb-1">Ventas vs estructura fija</h2>
                  <p className="text-xs text-brand-slate mb-3">{negocio === "gpon" ? "Activaciones" : "Ventas"} de cada mes contra el {cfg.objetivoLabel} y la capacidad de la estructura ({hc?.vendedores} vendedores × {p.costos.ventas_por_vendedor}).</p>
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={meses.map((m: any) => ({ ...m, capacidad: (hc?.vendedores ?? 0) * Number(p.costos.ventas_por_vendedor) }))} margin={{ top: 8, right: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="mes" fontSize={10} tickFormatter={(v: number) => nombreCorto(v - 1)} />
                      <YAxis yAxisId="l" fontSize={10} />
                      <YAxis yAxisId="r" orientation="right" fontSize={10} tickFormatter={(v: number) => `${v}`} />
                      <Tooltip labelFormatter={(l) => nombreMes(Number(l) - 1)} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="l" dataKey="ventas" name="Ventas">
                        {meses.map((m: any) => <Cell key={m.mes} fill={m.en_riesgo ? "#E6332A" : m.monto_bono_productividad > 0 ? "#0EA5E9" : "#F39200"} />)}
                      </Bar>
                      <Area yAxisId="l" dataKey="ventas_equilibrio" name="Ventas mínimas para no perder (ola + estructura)" stroke="#E6332A" fill="#E6332A" fillOpacity={0.18} strokeWidth={2} strokeDasharray="5 3" type="monotone" connectNulls={false} />
                      <ReferenceLine yAxisId="l" y={Number(p[cfg.objetivoKey])} stroke="#E6332A" strokeDasharray="6 3" label={{ value: `Objetivo ${formatInt(Number(p[cfg.objetivoKey]))}`, position: "insideTopRight", fill: "#E6332A", fontSize: 10, fontWeight: 700 }} />
                      <Line yAxisId="l" dataKey="capacidad" name="Capacidad de la estructura" stroke="#0F1116" strokeDasharray="4 3" dot={false} />
                      <Line yAxisId="r" dataKey="ventas_por_vendedor" name="Ventas por vendedor" stroke="#662483" strokeWidth={2} dot={{ r: 2.5 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <Lectura>
                    Barras: ventas del mes (rojas cuando quedan por debajo del área roja, naranjas cuando pierden el bono productividad). El área roja
                    es el riesgo potencial por bajar productividad: las ventas mínimas que cada mes necesita para cubrir la ola de devoluciones
                    heredadas de los meses anteriores más la estructura fija. Crece con meses de ventas estables y no baja cuando bajan las ventas:
                    por eso una caída de productividad después de una racha alta pierde plata aunque la estructura sea la misma. La línea punteada
                    negra es lo que la estructura fija puede vender; la violeta, las ventas reales por vendedor.
                  </Lectura>
                </section>
              </div>

              </Bloque>

              <Bloque titulo={`Estado de resultados a ${horizonte} meses (EERR)`} abierto envuelto={false} hint="liquidación mes a mes · estructura fija del mes 1">
              {/* ===== EERR anual ===== */}
              <section className="card overflow-x-auto">
                <div className="px-4 pt-4">
                  <h2 className="font-display text-xl text-brand-ink uppercase">Estado de resultados a {horizonte} meses (EERR)</h2>
                  <p className="text-xs text-brand-slate mb-2">Liquidación mes a mes con estructura fija del mes 1. Cada columna es un mes calendario; la última, el total del período.</p>
                </div>
                <table className="w-full text-[11px]" style={{ minWidth: `${300 + meses.length * 74}px` }}>
                  <thead className="border-b border-brand-border">
                    <tr className="text-[9px] uppercase tracking-wider2 text-brand-slate">
                      <th className="px-3 py-2 text-left sticky left-0 bg-white">Concepto</th>
                      {meses.map((m: any) => (
                        <th key={m.mes} className={`px-2 py-2 text-right ${esMarcado(`mes:${m.mes}`) ? "bg-amber-100 text-brand-ink" : ""} ${m.afectado ? "text-brand-purple" : ""}`}
                          title={m.afectado ? `Mes afectado: ${describirVariaciones(m.variaciones, p, cfg.campos).join(" · ")}` : undefined}>
                          <span className="inline-flex items-center gap-1 justify-end">
                            {m.afectado && <span className="w-1.5 h-1.5 rounded-full bg-brand-purple" />}
                            <Pin marcado={esMarcado(`mes:${m.mes}`)} onClick={() => toggleMarca(`mes:${m.mes}`, `${nombreMes(m.mes - 1)} (${formatInt(m.ventas)} ventas)`)} className="!w-4 !h-4 !text-[9px]" />
                            <span title={nombreMes(m.mes - 1)}>{nombreCorto(m.mes - 1)}</span>
                          </span>
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right bg-brand-primary/5 text-brand-primary">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cfg.eerrRows.map(([label, key, fmt, tipo]) => {
                      const val = (m: any): number => {
                        if (!key) return 0;
                        if (key === "_fijo") return m.costo_total - m.costos.rrhh.operadores_comisiones * (1 + Number(p.costos.ips_pct) / 100 + (p.costos.aguinaldo ? 1 / 12 : 0)) - (m.costos.plus_vendedores ?? 0) - m.costos.logistica_entregas - m.costos.operativos;
                        if (key === "_comisiones") return m.costos.rrhh.operadores_comisiones * (1 + Number(p.costos.ips_pct) / 100 + (p.costos.aguinaldo ? 1 / 12 : 0));
                        if (key === "_plus") return m.costos.plus_vendedores ?? 0;
                        if (key === "_logistica") return m.costos.logistica_entregas;
                        if (key === "_operativos") return m.costos.operativos;
                        return Number(m[key] ?? 0);
                      };
                      const anualVal = key === "margen_pct" ? a.margen_pct : key === "acumulado" ? a.resultado : meses.reduce((s: number, m: any) => s + val(m), 0);
                      const cls = tipo === "sep" ? "bg-brand-bg text-[9px] uppercase tracking-wider2 text-brand-slate font-bold"
                        : tipo === "sub" ? "bg-brand-bg-soft font-semibold border-t border-brand-border"
                        : tipo === "total" ? "bg-brand-ink text-white font-bold"
                        : tipo === "pct" ? "text-brand-graphite italic" : tipo === "head" ? "font-semibold" : "";
                      const f = (v: number) => fmt === "int" ? formatInt(v) : fmt === "pct" ? `${Math.round(v * 10) / 10}%` : formatGs(v);
                      return (
                        <tr key={label} className={cls}>
                          <td className={`px-3 py-1 sticky left-0 ${tipo === "total" ? "bg-brand-ink" : tipo === "sub" ? "bg-brand-bg-soft" : tipo === "sep" ? "bg-brand-bg" : "bg-white"} ${tipo === "row" ? "pl-6" : ""} ${key && esMarcado(`eerr:${key}`) ? "!bg-amber-100 !text-brand-ink" : ""}`}>
                            <span className="flex items-center justify-between gap-2">
                              <span className="flex flex-wrap items-center gap-2">{label}{cfg.verificado && (key === "clawback_bonos" || key === "recalculo_productividad") && <Verificado k={key} />}</span>
                              {key && tipo !== "sep" && <Pin marcado={esMarcado(`eerr:${key}`)} onClick={() => toggleMarca(`eerr:${key}`, `EERR · ${label}`)} className="!w-5 !h-5 !text-[10px]" />}
                            </span>
                          </td>
                          {meses.map((m: any) => (
                            <td key={m.mes} className={`px-2 py-1 text-right font-mono whitespace-nowrap ${tipo !== "total" && tipo !== "sep" && val(m) < 0 ? "text-brand-primary" : ""} ${esMarcado(`mes:${m.mes}`) && tipo !== "total" ? "bg-amber-50" : ""}`}>
                              {tipo === "sep" ? "" : f(key === "margen_pct" ? m.margen_pct : val(m))}
                            </td>
                          ))}
                          <td className={`px-3 py-1 text-right font-mono whitespace-nowrap ${tipo !== "total" ? "bg-brand-primary/5" : ""} ${tipo !== "total" && tipo !== "sep" && anualVal < 0 ? "text-brand-primary" : ""}`}>
                            {tipo === "sep" ? "" : f(anualVal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="px-4 py-3">
                  <Lectura>
                    Leé cada columna como la liquidación de ese mes: lo que facturan las ventas del mes, más lo que las cohortes
                    anteriores devuelven (chargeback) o suman (cuota 2, residual), menos los costos — los fijos no cambian, los
                    variables siguen a las ventas. La columna "Total" es el balance del período; la cola posterior (residual por
                    cobrar y devoluciones pendientes de las últimas cohortes) se informa aparte en los KPIs.
                  </Lectura>
                  {cfg.observacion && <ObservacionConceptosEERR />}
                </div>
              </section>

              </Bloque>

              <Bloque titulo="Bonos mes a mes" envuelto={false} hint={`bonos del período ${formatGs(a.bonos)}`}>
              {/* Bonos por mes */}
              <section className="card overflow-x-auto">
                <div className="px-4 pt-4">
                  <h2 className="font-display text-lg text-brand-ink uppercase">Bonos mes a mes</h2>
                  <p className="text-xs text-brand-slate mb-2">Cumplimiento del {cfg.objetivoLabel} ({formatInt(Number(p[cfg.objetivoKey]))}) y escalón alcanzado cada mes. Bonos del período: {formatGs(a.bonos)} · devueltos {formatGs(Math.abs(a.devolucion_bonos))}.</p>
                </div>
                <table className="w-full text-xs min-w-[720px]">
                  <thead className="bg-brand-bg text-[10px] uppercase tracking-wider2 text-brand-slate">
                    <tr><th className="px-3 py-1.5 text-left">Mes</th><th className="px-3 py-1.5 text-right">{negocio === "gpon" ? "Activaciones" : "Ventas"}</th><th className="px-3 py-1.5 text-right">Cumplimiento</th><th className="px-3 py-1.5 text-center">Escalón</th><th className="px-3 py-1.5 text-right">Bono/línea</th>{cfg.bonosCols.map(([l]) => <th key={l} className="px-3 py-1.5 text-right">{l}</th>)}</tr>
                  </thead>
                  <tbody>
                    {meses.map((m: any) => (
                      <tr key={m.mes} className={`border-t border-brand-border ${esMarcado(`mes:${m.mes}`) ? "bg-amber-50" : ""}`}>
                        <td className="px-3 py-1 font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <Pin marcado={esMarcado(`mes:${m.mes}`)} onClick={() => toggleMarca(`mes:${m.mes}`, `${nombreMes(m.mes - 1)} (${formatInt(m.ventas)} ventas)`)} className="!w-4 !h-4 !text-[9px]" />
                            {nombreMes(m.mes - 1)}
                          </span>
                        </td>
                        <td className="px-3 py-1 text-right">{formatInt(m.ventas)}</td>
                        <td className="px-3 py-1 text-right font-mono">{m.cumplimiento_pct}%</td>
                        <td className="px-3 py-1 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${m.escalon_productividad ? "bg-emerald-100 text-emerald-700" : "bg-brand-primary/10 text-brand-primary"}`}>
                            {m.escalon_productividad ? `≥ ${m.escalon_productividad}%` : "sin bono"}
                          </span>
                        </td>
                        <td className="px-3 py-1 text-right font-mono">{formatGs(m.monto_bono_productividad)}</td>
                        {cfg.bonosCols.map(([l, k]) => <td key={l} className="px-3 py-1 text-right font-mono">{formatGs(m[k])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              </Bloque>
            </>
          )}
        </div>
      )}
      </div>
    </AppShell>
  );
}
