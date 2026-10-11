/**
 * Captura de una pieza del lienzo como imagen PNG (para descargar o para el PDF de un informe): el gráfico ya dibujado
 * (SVG de Recharts) sobre fondo blanco al doble de resolución; los indicadores, las tablas y las donas se dibujan desde
 * la especificación; un tablero se compone con cada una de sus partes, una debajo de otra.
 */
import { formatear } from "@/lib/voiFormato";
import { PiezaVoi, SERIES, TINTA, nombreX } from "./tipos";

const FUENTE = "Manrope, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const GRIS = "#5B6275";
const BORDE = "#E3E6EC";
const ESCALA = 2;

function svgDe(contenedor: Element | null): { svg: SVGSVGElement; width: number; height: number } | null {
  const svg = contenedor?.querySelector("svg.recharts-surface") as SVGSVGElement | null;
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const width = Number(svg.getAttribute("width")) || rect.width;
  const height = Number(svg.getAttribute("height")) || rect.height;
  return width && height ? { svg, width, height } : null;
}

/** Dibuja un SVG en el canvas (clonado, con la tipografía fijada). */
async function dibujarSvg(g: CanvasRenderingContext2D, svg: SVGSVGElement, x: number, y: number, w: number, h: number) {
  const copia = svg.cloneNode(true) as SVGSVGElement;
  copia.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copia.setAttribute("width", String(w));
  copia.setAttribute("height", String(h));
  copia.setAttribute("font-family", FUENTE);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copia)], { type: "image/svg+xml" }));
  await new Promise<void>((ok) => {
    const img = new Image();
    img.onload = () => { g.drawImage(img, x, y, w, h); ok(); };
    img.onerror = () => ok();
    img.src = url;
  });
  URL.revokeObjectURL(url);
}

function texto(g: CanvasRenderingContext2D, t: string, x: number, y: number, max: number): void {
  let s = t;
  while (s.length > 1 && g.measureText(s).width > max) s = s.slice(0, -2) + "…";
  g.fillText(s, x, y);
}

/** Alto que ocupa una pieza (sin título) al ancho `w`; null si no se puede dibujar. */
function altoDe(spec: PiezaVoi, contenedor: Element | null, w: number): number | null {
  if (spec.tipo === "kpis") return Math.ceil(Math.min(spec.kpis?.length ?? 0, 8) / 4) * 92 || null;
  if (spec.tipo === "tabla") return 30 + Math.min(spec.datos?.length ?? 0, 10) * 26;
  if (spec.tipo === "dona") return 216;
  const s = svgDe(contenedor);
  return s ? Math.round(s.height * (w / s.width)) : null;
}

async function dibujarPieza(g: CanvasRenderingContext2D, spec: PiezaVoi, contenedor: Element | null, x: number, y: number, w: number): Promise<number> {
  if (spec.tipo === "kpis") {
    const kpis = (spec.kpis ?? []).slice(0, 8);
    const porFila = 4, gap = 12, ancho = (w - gap * (porFila - 1)) / porFila, alto = 80;
    kpis.forEach((k, i) => {
      const cx = x + (i % porFila) * (ancho + gap), cy = y + Math.floor(i / porFila) * (alto + gap);
      g.fillStyle = "#FFFFFF"; g.strokeStyle = BORDE; g.lineWidth = 1;
      g.beginPath(); g.roundRect(cx + 0.5, cy + 0.5, ancho - 1, alto - 1, 10); g.fill(); g.stroke();
      g.fillStyle = GRIS; g.font = `12px ${FUENTE}`; texto(g, k.titulo, cx + 14, cy + 24, ancho - 28);
      g.fillStyle = TINTA; g.font = `600 24px ${FUENTE}`; texto(g, formatear(k.valor, k.formato), cx + 14, cy + 52, ancho - 28);
      if (k.detalle) { g.fillStyle = GRIS; g.font = `11px ${FUENTE}`; texto(g, k.detalle, cx + 14, cy + 70, ancho - 28); }
    });
    return Math.ceil(kpis.length / porFila) * (alto + gap) - gap;
  }
  if (spec.tipo === "tabla") {
    const filas = (spec.datos ?? []).slice(0, 10);
    const cols = (spec.columnas ?? Object.keys(filas[0] ?? {}).map((c) => ({ campo: c, nombre: c, formato: "numero" as const }))).slice(0, 8);
    const ancho = w / Math.max(cols.length, 1);
    g.fillStyle = "#F4F5F8"; g.fillRect(x, y, w, 28);
    g.fillStyle = GRIS; g.font = `600 11px ${FUENTE}`;
    cols.forEach((c, i) => texto(g, c.nombre.toUpperCase(), x + i * ancho + 10, y + 18, ancho - 16));
    g.font = `12px ${FUENTE}`;
    filas.forEach((f, r) => {
      const fy = y + 28 + r * 26;
      g.strokeStyle = BORDE; g.beginPath(); g.moveTo(x, fy + 26); g.lineTo(x + w, fy + 26); g.stroke();
      cols.forEach((c, i) => {
        const v = f[c.campo];
        const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/\./g, "").replace(",", "."));
        const t = v === null || v === undefined ? "—" : (c as any).crudo || c.formato === "texto" || Number.isNaN(n) ? String(v) : formatear(n, c.formato);
        g.fillStyle = TINTA; texto(g, t, x + i * ancho + 10, fy + 18, ancho - 16);
      });
    });
    return 28 + filas.length * 26;
  }
  if (spec.tipo === "dona") {
    const datos = spec.datos ?? [];
    const campo = spec.series?.[0]?.campo ?? "", ejeX = spec.x ?? "";
    const total = datos.reduce((t, d) => t + (Number(d[campo]) || 0), 0);
    const s = svgDe(contenedor);
    if (s) await dibujarSvg(g, s.svg, x, y, 200, 200);
    g.fillStyle = TINTA; g.font = `600 18px ${FUENTE}`; g.textAlign = "center";
    g.fillText(formatear(total, spec.formato), x + 100, y + 104);
    g.fillStyle = GRIS; g.font = `10px ${FUENTE}`; g.fillText("TOTAL", x + 100, y + 120);
    g.textAlign = "left";
    datos.slice(0, 8).forEach((d, i) => {
      const ly = y + 24 + i * 22, v = Number(d[campo]) || 0;
      g.fillStyle = SERIES[i % SERIES.length]; g.fillRect(x + 224, ly - 10, 10, 10);
      g.fillStyle = "#2A2F3A"; g.font = `13px ${FUENTE}`; texto(g, String(d[ejeX]), x + 242, ly, w - 420);
      g.fillStyle = TINTA; g.font = `600 13px ${FUENTE}`; g.textAlign = "right";
      g.fillText(`${formatear(v, spec.formato)}   ${total ? formatear((v / total) * 100, "porcentaje") : "—"}`, x + w - 8, ly);
      g.textAlign = "left";
    });
    return 216;
  }
  const s = svgDe(contenedor);
  if (!s) return 0;
  const h = Math.round(s.height * (w / s.width));
  const series = (spec.series ?? []).length > 1 ? spec.series ?? [] : [];
  let ly = y;
  if (series.length) {
    let xl = x;
    g.font = `12px ${FUENTE}`;
    series.forEach((sr, i) => {
      g.fillStyle = SERIES[i % SERIES.length]; g.fillRect(xl, ly + 2, 10, 10);
      g.fillStyle = "#2A2F3A"; g.fillText(sr.nombre, xl + 14, ly + 11);
      xl += g.measureText(sr.nombre).width + 30;
    });
    ly += 24;
  }
  await dibujarSvg(g, s.svg, x, ly, w, h);
  return ly - y + h;
}

/**
 * PNG de una pieza (Blob): un gráfico, los indicadores, una tabla, una dona o un tablero completo. `contenedor` es el
 * nodo donde está dibujada (para un tablero, cada parte dentro de un `[data-widget]`). `titulo` y `pie` en false para el
 * PDF, que ya imprime el título y la fuente. Null si no hay nada que dibujar.
 */
export async function pngPiezaDe(contenedor: HTMLElement | null, spec: PiezaVoi, { titulo = true, pie = true, ancho }: { titulo?: boolean; pie?: boolean; ancho?: number } = {}): Promise<Blob | null> {
  const w = ancho ?? (svgDe(contenedor)?.width || 960);
  const partes: { spec: PiezaVoi; nodo: Element | null; titulo: string | null }[] = spec.tipo === "tablero"
    ? (spec.widgets ?? []).map((wd, i) => ({ spec: wd, nodo: contenedor?.querySelector(`[data-widget="${i}"]`) ?? null, titulo: wd.titulo }))
    : [{ spec, nodo: contenedor, titulo: null }];
  const altos = partes.map((p) => altoDe(p.spec, p.nodo, w));
  if (!partes.length || altos.every((a) => !a)) return null;
  const arriba = titulo ? 44 : 12, abajo = pie ? 28 : 12;
  const total = partes.reduce((t, p, i) => t + (altos[i] ? altos[i]! + (p.titulo ? 26 : 0) + ((p.spec.series ?? []).length > 1 ? 24 : 0) + 16 : 0), 0);
  const lienzo = document.createElement("canvas");
  lienzo.width = (w + 32) * ESCALA;
  lienzo.height = (arriba + total + abajo) * ESCALA;
  const g = lienzo.getContext("2d")!;
  g.scale(ESCALA, ESCALA);
  g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, w + 32, arriba + total + abajo);
  if (titulo) { g.fillStyle = TINTA; g.font = `600 16px ${FUENTE}`; texto(g, spec.titulo, 16, 28, w); }
  let y = arriba;
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i];
    if (!altos[i]) continue;
    if (p.titulo) { g.fillStyle = "#2A2F3A"; g.font = `600 13px ${FUENTE}`; texto(g, p.titulo, 16, y + 14, w); y += 26; }
    y += await dibujarPieza(g, p.spec, p.nodo, 16, y, w) + 16;
  }
  if (pie) {
    g.fillStyle = "#9CA3AF"; g.font = `11px ${FUENTE}`;
    g.fillText(`Voi · Operaciones Voicenter${spec.nota ? ` · ${spec.nota}` : ""}`, 16, arriba + total + 18);
  }
  return new Promise<Blob | null>((ok) => lienzo.toBlob(ok, "image/png"));
}

/** Compatibilidad: el PNG de un gráfico (el SVG de Recharts) tal como lo descarga el lienzo. */
export const pngBlobDe = (contenedor: HTMLElement | null, spec: PiezaVoi, opciones: { titulo?: boolean; pie?: boolean } = {}) =>
  pngPiezaDe(contenedor, spec, opciones);

export { nombreX };
