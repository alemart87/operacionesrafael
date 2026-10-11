import type { FormatoVoi } from "@/lib/voiFormato";

export type TipoPieza = "kpis" | "barras" | "columnas" | "lineas" | "area" | "apiladas" | "dona" | "tabla" | "tablero";

export interface SerieVoi { campo: string; nombre: string }
export interface KpiVoi {
  titulo: string;
  valor: number | null;
  formato: FormatoVoi;
  detalle?: string | null;
  variacion?: number | null;
  bueno_si: "sube" | "baja";
}
export interface ColumnaVoi {
  campo: string;
  nombre: string;
  formato: FormatoVoi;
  /** Mostrar el texto tal cual vino (tablas del chat): solo se usa el formato para alinear y ordenar. */
  crudo?: boolean;
}

export interface PiezaVoi {
  tipo: TipoPieza;
  titulo: string;
  descripcion?: string | null;
  nota?: string | null;
  formato: FormatoVoi;
  x?: string;
  /** Cómo se llama el eje x en la tabla de datos («Día», «Supervisor»); si no viene, el campo con mayúscula. */
  x_nombre?: string | null;
  series?: SerieVoi[];
  datos?: Record<string, any>[];
  destacar?: string;
  meta?: number;
  meta_nombre?: string;
  columnas?: ColumnaVoi[];
  kpis?: KpiVoi[];
  widgets?: PiezaVoi[];
}

export interface ArtefactoVoi {
  id: string;
  tipo: TipoPieza | string;
  titulo: string;
  spec: PiezaVoi;
  evento_id?: string | null;
  created_at?: string | null;
  /** Armado en el navegador (p. ej. una tabla del chat ampliada): no se guarda. */
  local?: boolean;
}

/**
 * Paleta categórica de marca validada con el método de visualización (banda de luminosidad, croma, separación con
 * daltonismo y piso de visión normal sobre fondo blanco): cyan · púrpura (un paso más claro que el de marca) ·
 * naranja · azul · rojo · verde. Cyan y naranja quedan bajo 3:1 de contraste: por eso cada gráfico trae su tabla de
 * datos y etiquetas de valor. Nunca se generan más colores: más de 6 series → tabla o varios gráficos.
 */
export const SERIES = ["#00B2BF", "#763594", "#F39200", "#2A78D6", "#E6332A", "#008300"];
export const GRIS = "#C9CCD3";       // lo que no se destaca
export const GRILLA = "#EEF0F4";
export const EJE = "#5B6275";
export const TINTA = "#0F1116";
export const BUENO = "#006300";      // texto de variación favorable (estado «bueno»)
export const MALO = "#D03B3B";       // texto de variación desfavorable (estado «crítico»)

/** El nombre visible del eje x: el que mandó Voi o el campo legible («fecha_venta» → «Fecha venta»). */
export function nombreX(spec: PiezaVoi): string {
  if (spec.x_nombre) return spec.x_nombre;
  const t = (spec.x ?? "").replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}
