"use client";

/**
 * El lienzo de Voi: lo que Voi mostró en la conversación (gráficos, indicadores, tablas y tableros), en grande, al lado
 * del chat. En pantallas anchas ocupa el espacio de la página; en tablet y teléfono, la pantalla completa. Cada pieza se
 * puede ver como gráfico o como tabla de datos y descargar en CSV o PNG.
 */
import {
  AreaChart, ArrowLeft, BarChart3, BarChartHorizontal, Download, FileImage, Gauge, LayoutDashboard, LineChart,
  PieChart, Sparkles, Table2, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { descargarCsv } from "@/lib/csv";
import { aNumero } from "@/lib/voiFormato";
import { useVoi } from "../VoiProvider";
import { ArtefactoVoi, PiezaVoi, SERIES, TINTA, nombreX } from "./tipos";
import { CuerpoPieza } from "./VoiGrafico";

export const ICONO_TIPO: Record<string, any> = {
  kpis: Gauge, barras: BarChartHorizontal, columnas: BarChart3, apiladas: BarChart3, lineas: LineChart, area: AreaChart,
  dona: PieChart, tabla: Table2, tablero: LayoutDashboard,
};
export const NOMBRE_TIPO: Record<string, string> = {
  kpis: "Indicadores", barras: "Gráfico de barras", columnas: "Gráfico de columnas", apiladas: "Barras apiladas",
  lineas: "Gráfico de líneas", area: "Gráfico de área", dona: "Gráfico de dona", tabla: "Tabla", tablero: "Tablero",
};

function nombreArchivo(t: string) {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) || "voi";
}

function csvDe(spec: PiezaVoi) {
  if (spec.tipo === "kpis") {
    descargarCsv(`${nombreArchivo(spec.titulo)}.csv`, ["Indicador", "Valor", "Variación %", "Detalle"],
      (spec.kpis ?? []).map((k) => [k.titulo, k.valor, k.variacion ?? null, k.detalle ?? ""]));
    return;
  }
  const columnas = spec.columnas ?? (spec.x ? [{ campo: spec.x, nombre: nombreX(spec) }, ...(spec.series ?? []).map((s) => ({ campo: s.campo, nombre: s.nombre }))] : []);
  descargarCsv(`${nombreArchivo(spec.titulo)}.csv`, columnas.map((c) => c.nombre),
    (spec.datos ?? []).map((f) => columnas.map((c) => {
      const v = f[c.campo];
      if (typeof v === "number" || v === null || v === undefined) return v;
      const n = (c as any).crudo ? null : aNumero(v);
      return n ?? String(v);
    })));
}

/** PNG del gráfico: título, leyenda y el SVG dibujado sobre fondo blanco al doble de resolución. */
async function pngDe(contenedor: HTMLElement | null, spec: PiezaVoi) {
  const svg = contenedor?.querySelector("svg.recharts-surface") as SVGSVGElement | null;
  if (!svg) return;
  const { width, height } = svg.getBoundingClientRect();
  const series = (spec.series ?? []).length > 1 ? spec.series ?? [] : [];
  const arriba = 44 + (series.length ? 24 : 0);
  const escala = 2;
  const lienzo = document.createElement("canvas");
  lienzo.width = (width + 32) * escala;
  lienzo.height = (height + arriba + 28) * escala;
  const g = lienzo.getContext("2d")!;
  g.scale(escala, escala);
  g.fillStyle = "#FFFFFF";
  g.fillRect(0, 0, width + 32, height + arriba + 28);
  g.fillStyle = TINTA;
  g.font = "600 16px Manrope, system-ui, sans-serif";
  g.fillText(spec.titulo, 16, 28);
  let xl = 16;
  g.font = "12px Manrope, system-ui, sans-serif";
  series.forEach((s, i) => {
    g.fillStyle = SERIES[i % SERIES.length];
    g.fillRect(xl, 44, 10, 10);
    g.fillStyle = "#2A2F3A";
    g.fillText(s.nombre, xl + 14, 53);
    xl += g.measureText(s.nombre).width + 30;
  });
  const copia = svg.cloneNode(true) as SVGSVGElement;
  copia.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copia.setAttribute("width", String(width));
  copia.setAttribute("height", String(height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copia)], { type: "image/svg+xml" }));
  await new Promise<void>((ok) => {
    const img = new Image();
    img.onload = () => { g.drawImage(img, 16, arriba, width, height); ok(); };
    img.onerror = () => ok();
    img.src = url;
  });
  URL.revokeObjectURL(url);
  g.fillStyle = "#9CA3AF";
  g.font = "11px Manrope, system-ui, sans-serif";
  g.fillText(`Voi · Operaciones Voicenter${spec.nota ? ` · ${spec.nota}` : ""}`, 16, height + arriba + 18);
  const a = Object.assign(document.createElement("a"), { href: lienzo.toDataURL("image/png"), download: `${nombreArchivo(spec.titulo)}.png` });
  a.click();
}

function BotonChico({ onClick, titulo, children, activo }: { onClick: () => void; titulo: string; children: React.ReactNode; activo?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={titulo}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        activo ? "bg-brand-ink text-white" : "text-brand-slate hover:bg-brand-bg hover:text-brand-ink"}`}>
      {children}
    </button>
  );
}

/** Una pieza con su título, su lectura, el cambio a tabla de datos y las descargas. */
export function PiezaLienzo({ spec, compacto = false }: { spec: PiezaVoi; compacto?: boolean }) {
  const [verDatos, setVerDatos] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const grafico = !["kpis", "tabla", "tablero"].includes(spec.tipo);
  return (
    <div className={`rounded-2xl border border-brand-border bg-white ${compacto ? "p-4" : "p-5"}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className={`font-semibold text-brand-ink leading-snug ${compacto ? "text-sm" : "text-base"}`}>{spec.titulo}</h3>
          {spec.descripcion && <p className="mt-0.5 text-sm text-brand-slate leading-snug">{spec.descripcion}</p>}
        </div>
        <div className="flex items-center gap-0.5 no-print">
          {grafico && (
            <BotonChico titulo={verDatos ? "Ver el gráfico" : "Ver los datos en una tabla"} onClick={() => setVerDatos(!verDatos)} activo={verDatos}>
              <Table2 size={13} /> Datos
            </BotonChico>
          )}
          {spec.tipo !== "tablero" && <BotonChico titulo="Descargar CSV (Excel)" onClick={() => csvDe(spec)}><Download size={13} /> CSV</BotonChico>}
          {grafico && !verDatos && spec.tipo !== "dona" && (
            <BotonChico titulo="Descargar imagen PNG" onClick={() => pngDe(caja.current, spec)}><FileImage size={13} /> PNG</BotonChico>
          )}
        </div>
      </div>
      <div ref={caja} className="mt-4">
        {spec.tipo === "tablero" ? <Tablero spec={spec} /> : <CuerpoPieza spec={spec} verDatos={verDatos} compacto={compacto} />}
      </div>
      {spec.nota && <p className="mt-3 text-[11px] text-brand-mist">{spec.nota}</p>}
    </div>
  );
}

function Tablero({ spec }: { spec: PiezaVoi }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {(spec.widgets ?? []).map((w, i) => (
        <div key={i} className={w.tipo === "kpis" || w.tipo === "tabla" || (spec.widgets ?? []).length === 1 ? "xl:col-span-2" : ""}>
          <PiezaLienzo spec={w} compacto />
        </div>
      ))}
    </div>
  );
}

export function VoiLienzo() {
  const voi = useVoi()!;
  const artefactos: ArtefactoVoi[] = useMemo(() => [...voi.chat.artefactos, ...voi.lienzo.locales], [voi.chat.artefactos, voi.lienzo.locales]);
  const sel = artefactos.find((a) => a.id === voi.lienzo.foco) ?? artefactos[artefactos.length - 1];
  const chips = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") voi.cerrarLienzo(); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [voi]);
  useEffect(() => {
    chips.current?.querySelector("[aria-current=true]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [sel?.id]);

  return (
    <section
      className="voi-panel no-print fixed z-[45] inset-0 lg:right-[440px] bg-brand-bg flex flex-col lg:border-r border-brand-border"
      role="dialog"
      aria-label="Lienzo de Voi"
    >
      <div className="flex items-center gap-3 px-4 h-14 flex-shrink-0 bg-white border-b border-brand-border pt-[env(safe-area-inset-top)] box-content">
        <button type="button" onClick={voi.cerrarLienzo} className="lg:hidden w-9 h-9 grid place-items-center rounded-lg text-brand-slate hover:bg-brand-bg" aria-label="Volver al chat">
          <ArrowLeft size={18} />
        </button>
        <LayoutDashboard size={20} className="text-brand-primary hidden lg:block" />
        <div className="leading-none min-w-0">
          <div className="font-display text-xl text-brand-ink tracking-wide">Lienzo</div>
          <div className="text-[9px] uppercase tracking-[0.16em] text-brand-slate mt-1 font-semibold truncate">
            {voi.conv?.titulo ? `Lo que Voi mostró · ${voi.conv.titulo}` : "Lo que Voi mostró en esta conversación"}
          </div>
        </div>
        <button type="button" onClick={voi.cerrarLienzo} className="ml-auto w-9 h-9 grid place-items-center rounded-lg text-brand-slate hover:bg-brand-bg hover:text-brand-ink" aria-label="Cerrar el lienzo (Esc)" title="Cerrar el lienzo (Esc)">
          <X size={18} />
        </button>
      </div>
      {artefactos.length > 1 && (
        <div ref={chips} className="flex gap-2 overflow-x-auto px-4 py-2.5 bg-white border-b border-brand-border flex-shrink-0">
          {artefactos.map((a) => {
            const Icono = ICONO_TIPO[a.tipo] ?? BarChart3;
            const activo = a.id === sel?.id;
            return (
              <button key={a.id} type="button" aria-current={activo} onClick={() => voi.abrirLienzo(a.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs whitespace-nowrap max-w-[260px] transition-colors ${
                  activo ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border bg-white text-brand-graphite hover:border-brand-ink/40"}`}>
                <Icono size={13} className="flex-shrink-0" />
                <span className="truncate">{a.titulo}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex-1 overflow-y-auto overscroll-contain p-4 lg:p-6">
        <div className="max-w-5xl mx-auto">
          {sel ? <PiezaLienzo key={sel.id} spec={sel.spec} /> : <Vacio />}
        </div>
      </div>
    </section>
  );
}

function Vacio() {
  const voi = useVoi()!;
  const ejemplos = ["Mostrame las ventas netas por día de este mes en un gráfico", "Armame un tablero con los indicadores de hoy"];
  return (
    <div className="rounded-2xl border border-dashed border-brand-border bg-white p-10 text-center">
      <LayoutDashboard size={32} className="mx-auto text-brand-mist" />
      <p className="mt-3 text-sm text-brand-graphite font-semibold">Todavía no hay nada en el lienzo</p>
      <p className="mt-1 text-sm text-brand-slate max-w-md mx-auto">
        Cuando Voi arma un gráfico, una tabla o un tablero, aparece acá, al lado del chat. Pedíselo con tus palabras:
      </p>
      <div className="mt-4 flex flex-col items-center gap-2">
        {ejemplos.map((e) => (
          <button key={e} type="button" onClick={() => { voi.enviar(e); }} className="inline-flex items-center gap-2 rounded-xl border border-brand-border px-3.5 py-2 text-sm text-brand-graphite hover:border-brand-primary/50">
            <Sparkles size={14} className="text-brand-primary" /> {e}
          </button>
        ))}
      </div>
    </div>
  );
}
