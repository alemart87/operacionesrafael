export const LOG_API = "/api/v1/televentas-claro/logistica";
export const LOG_HREF = "/televentas-claro/logistica";
/** Debe coincidir con VERSION_ANALISIS del backend (analyzer.py). */
export const VERSION_ANALISIS = 4;

export type EstadoInforme = "draft" | "published" | "replaced";
export const ESTADO_LABEL: Record<EstadoInforme, string> = { draft: "Borrador", published: "Publicado", replaced: "Reemplazado" };

/** Los tres estados del modelo, en su orden; otros estados del archivo se suman al final. */
export const ENTREGADO = "ENTREGADO";
export const EN_GESTION = "EN GESTION";
export const DEVUELTO = "DEVUELTO";
export type Filtro = "todos" | string;

/** Colores de estado (semánticos: entregado = bien, en gestión = atención, devuelto = serio). */
export const COLOR_ESTADO: Record<string, string> = { [ENTREGADO]: "#00B2BF", [EN_GESTION]: "#F39200", [DEVUELTO]: "#E6332A" };
export const OTROS_COLORES = ["#662483", "#5B6275", "#0F1116"];
export const colorEstado = (e: string, estados: string[]): string =>
  COLOR_ESTADO[e] ?? OTROS_COLORES[Math.max(0, estados.filter((x) => !COLOR_ESTADO[x]).indexOf(e)) % OTROS_COLORES.length];
export const etiquetaEstado = (e: string): string => (e === EN_GESTION ? "En gestión" : e.charAt(0) + e.slice(1).toLowerCase());

export interface InformeResumen {
  id: string;
  upload_id: string;
  periodo: string;
  fecha_dato: string | null;
  fecha_corte: string;
  version: number | null;
  generated_at: string | null;
  generated_by: string | null;
  status: EstadoInforme;
  published_at: string | null;
  published_by: string | null;
  replaced_at: string | null;
  replaced_by_report_id: string | null;
  title: string | null;
  pedidos: number;
  entregados: number;
  en_gestion: number;
  devueltos: number;
  pct_entregados: number;
  demora_prom: number | null;
  demora_max: number | null;
  /** Demora de los pendientes por región: {CENTRAL: {n, dias_prom, dias_max, vencidos_6}, …} */
  demora_regiones: Record<string, DemoraRegion>;
  /** Pedidos proyectados a fin de mes con el ritmo actual (null si no se puede proyectar). */
  proyeccion: number | null;
  version_actual: number;
  /** Tiempo de entrega de los entregados (fecha de entrega − venta, días hábiles): null si el archivo no trae la fecha. */
  entrega_prom?: number | null;
  entrega_max?: number | null;
  entrega_regiones?: Record<string, EntregaRegion> | null;
}
export interface DemoraRegion { n: number; dias_prom: number | null; dias_max: number | null; vencidos_6: number }
export interface EntregaRegion { n: number; dias_prom: number | null; dias_max: number | null; pct_hasta_2: number | null; en_6_o_mas: number }

export interface ListaInformes { items: InformeResumen[]; total: number; usuarios: Record<string, string>; gestion: boolean }

export interface Desglose {
  total: number;
  estados: Record<string, number>;
  pct: Record<string, number | null>;
  region?: string | null;
  departamento?: string | null;
  [k: string]: unknown;
}
export interface Motivo { motivo: string; total: number; regiones: Record<string, number>; pct: number | null }
export interface PuntoSerie {
  fecha: string; total: number; estados: Record<string, number>; acumulado: Record<string, number>; acumulado_total: number;
  pendientes_dias_prom: number | null;
}
export interface Demora { n: number; dias_prom: number | null; dias_max: number | null; tramos: Record<string, number> }
export interface ZonaPendiente extends Demora {
  region: string;
  departamentos: (Demora & { departamento: string; ciudades: (Demora & { ciudad: string })[] })[];
}
export interface Pedido {
  formulario: string | null; linea: string | null; documento: string | null; cliente: string | null; ciudad: string | null;
  departamento: string | null; region: string; fecha: string; vendedor: string | null; promocion: string | null; estado: string;
  motivo: string;
  /** Días hábiles sin domingos: entregados, de la venta a la entrega; los demás, de la venta al corte. `dias_corridos`: calendario. */
  dias: number; dias_corridos?: number; tramo: string;
  fecha_entrega?: string | null; hasta?: "entrega" | "corte";
}
export interface ZonaEntrega extends ZonaPendiente { pct_hasta_2: number | null; en_6_o_mas: number }
export interface Entregas extends Partial<Demora> {
  disponible: boolean; metodo: string | null; n: number; sin_fecha: number;
  por_zona?: ZonaEntrega[]; por_dia?: { fecha: string; n: number; dias_prom: number; regiones: Record<string, number> }[];
  pct_hasta_2?: number | null; en_6_o_mas?: number; mismo_dia?: number; por_vendedor?: (Demora & { vendedor: string })[]; lista?: Pedido[];
}
export interface DatosLogistica {
  version: number; periodo: string; fecha_corte: string; estados: string[]; regiones: string[];
  kpis: {
    pedidos: number; fecha_corte: string; desde: string; hasta: string; dias: number; metodo_demora?: string;
    por_estado: Record<string, { n: number; pct: number | null }>;
    entregados: number; en_gestion: number; devueltos: number;
    pct_entregados: number | null; pct_en_gestion: number | null; pct_devueltos: number | null;
    demora: Demora; vendedores: number; regiones: number; fuera_de_periodo: number;
    entrega?: (Demora & { sin_fecha: number; pct_hasta_2: number | null; en_6_o_mas: number }) | null; metodo_entrega?: string | null;
  };
  por_region: (Desglose & { region: string })[];
  por_departamento: (Desglose & { departamento: string })[];
  por_ciudad: (Desglose & { ciudad: string })[];
  motivos: Record<string, Motivo[]>;
  serie: PuntoSerie[];
  pendientes: Demora & { por_zona: ZonaPendiente[]; por_motivo: { motivo: string; n: number; dias_prom: number }[]; lista: Pedido[]; vencidos_6: number; vencidos_11: number };
  vendedores: (Desglose & { vendedor: string })[];
  promociones: (Desglose & { promocion: string })[];
  pedidos: Pedido[];
  avisos: string[];
  proyeccion?: Proyeccion;
  entregas?: Entregas;
}
export interface ProyeccionSerie { acumulado: number; dias_con_ventas: number; media_diaria: number; ritmo: number; desvio: number; dias_en_ritmo: string[]; dias_restantes: number; proyeccion: number; intervalo_95: { bajo: number; alto: number }; rango: { conservador: number; tendencia: number }; pendiente_diaria: number }
export interface Proyeccion extends Partial<ProyeccionSerie> {
  disponible: boolean; mes: string; fin_mes: string; dias_con_ventas: number; acumulado: number; motivo: string | null;
  ultimo_dia?: string; dias_laborables?: number[]; dias_transcurridos?: number; fecha_fin_proyeccion?: string;
  entregas_esperadas?: number | null; por_region?: Record<string, ProyeccionSerie>;
  serie?: { fecha: string; real?: number; acumulado?: number; proyectado?: number; bajo?: number; alto?: number }[]; metodo?: string;
}
export interface InformeDetalle extends InformeResumen { data: DatosLogistica; usuarios: Record<string, string> }

export const TRAMOS = ["0-2", "3-5", "6-10", "11+"];
export const n = (v: number | null | undefined) => (v ?? 0).toLocaleString("es-PY");
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toLocaleString("es-PY", { maximumFractionDigits: 1 })}%`);
export const dias = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toLocaleString("es-PY", { maximumFractionDigits: 1 })} d`);
export function nombrePeriodo(periodo: string): string {
  const [y, m] = periodo.split("-").map(Number);
  const s = new Date(y, (m || 1) - 1, 1).toLocaleDateString("es-PY", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
export const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
