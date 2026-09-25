/** Contratos y catálogos de Auditoría de Ventas (Televentas CLARO). */

import type { ReglasAuditoria } from "./guia/datos";

export const AUD_API = "/api/v1/televentas-claro/auditoria";
export const AUD_HREF = "/televentas-claro/auditoria";

export type EstadoAuditoria = "borrador" | "en_revision" | "cerrado" | "archivado";
export const ESTADO_AUD_LABEL: Record<EstadoAuditoria, string> = {
  borrador: "Borrador",
  en_revision: "En revisión",
  cerrado: "Cerrado",
  archivado: "Archivado",
};
/** Cómo se llama la acción que lleva a cada estado, según de dónde se parte. */
export const ACCION_ESTADO: Record<EstadoAuditoria, Record<string, string>> = {
  borrador: { en_revision: "Volver a borrador" },
  en_revision: { borrador: "Enviar a revisión", cerrado: "Reabrir" },
  cerrado: { en_revision: "Cerrar y emitir informe", archivado: "Desarchivar" },
  archivado: { cerrado: "Archivar" },
};

export type Severidad = "alta" | "media" | "baja" | "info";
export const SEVERIDAD_LABEL: Record<Severidad, string> = { alta: "Alta", media: "Media", baja: "Baja", info: "Info" };
export const SEVERIDAD_CLS: Record<Severidad, string> = {
  alta: "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30",
  media: "bg-brand-orange/10 text-brand-graphite border-brand-orange/40",
  baja: "bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30",
  info: "bg-brand-bg text-brand-slate border-brand-border",
};

export type HallazgoEstado = "abierto" | "en_seguimiento" | "resuelto" | "descartado";
export const HALLAZGO_ESTADO_LABEL: Record<HallazgoEstado, string> = {
  abierto: "Abierto",
  en_seguimiento: "En seguimiento",
  resuelto: "Resuelto",
  descartado: "Descartado",
};

export const CATEGORIA_LABEL: Record<string, string> = {
  vendedor: "Vendedor",
  sali_hablando: "Sali Hablando",
  sin_uso: "Líneas sin uso",
  activacion: "Activación",
  pendientes: "Pendientes",
  suspendidas: "Suspendidas",
  riesgo: "Riesgo de carga",
  zona: "Zona",
  otro: "Otro",
};

export type Nivel = "critico" | "atencion" | "normal";
export const NIVEL_LABEL: Record<Nivel, string> = { critico: "Crítico", atencion: "Atención", normal: "Normal" };

export interface Fuente {
  id: string;
  periodo: string;
  fecha_dato: string | null;
  status: "draft" | "published" | "replaced";
  netas: number;
  pospago: number;
  pospago_sin_uso: number;
  pct_sin_uso: number;
  pendientes: number;
  generated_at: string;
  /** Versión del análisis con la que se generó; si es anterior a la vigente, la auditoría lo actualiza al analizarlo. */
  analysis_version: number;
  actualizada: boolean;
}

export interface FuenteUsada {
  report_id: string;
  periodo: string;
  fecha_dato: string | null;
  status: string;
  netas: number;
  pospago: number;
  pct_sin_uso: number;
  pendientes: number;
  generated_at: string | null;
  version: number | null;
}

export interface Senal { gravedad: "alta" | "media" | "info"; texto: string }

export interface VendedorRanking {
  vendedor: string;
  subcanal: string | null;
  posicion: number;
  netas: number; pospago: number; con_uso: number; sin_uso: number; gpon: number; iptv: number; portadas: number; suspendidas: number;
  sali: number; sali_sin_uso: number; fuera_ddi: number;
  cargas: number; finalizadas: number; a_confirmar: number; rechazadas: number; riesgo_A: number; sin_uso_riesgo_A: number;
  sin_uso_antiguas: number;
  pct_uso: number; pct_sin_uso: number; pct_finalizacion: number; alerta: boolean;
  nivel: Nivel; puntaje: number; senales: Senal[];
  periodos: Record<string, { netas: number; sin_uso: number; sali_sin_uso: number }>;
}

export interface Llamativo { gravedad: Severidad; categoria: string; titulo: string; detalle: string; cifra: string }

export interface LineaEvidencia {
  periodo?: string; sds_number: string; linea?: string | null; fecha_activacion?: string | null; fecha_portacion?: string | null;
  plan?: string | null; origen_portacion?: string | null; portacion?: string | null; consumo?: string | null;
  estado_linea?: string | null; razon_cierre?: string | null; vendedor?: string | null; ciudad?: string | null;
  dias?: number | null; riesgo?: string | null; sin_uso?: boolean; subcanal?: string | null;
  [k: string]: unknown;
}

export interface Snapshot {
  generado_en: string;
  /** Reglas con las que se evaluó (los informes viejos solo tienen los umbrales básicos). */
  parametros: Partial<ReglasAuditoria>;
  /** Fuentes que no se pudieron recalcular a la versión vigente del análisis. */
  advertencias?: string[];
  fuentes: FuenteUsada[];
  periodos: string[];
  kpis: Record<string, number | string[] | number[]> & {
    netas: number; pospago: number; gpon: number; iptv: number; pospago_sin_uso: number; pct_sin_uso: number; sin_uso_antiguas: number;
    sali_total: number; sali_sin_uso: number; sali_pct_sin_uso: number; suspendidas: number; finalizadas_sin_activar: number;
    pendientes: number; pendientes_mas_7: number; cargas: number; cargas_finalizadas: number; pct_finalizacion: number;
    riesgo_alto: number; sin_uso_riesgo_alto: number; vendedores: number; vendedores_criticos: number; vendedores_atencion: number;
    total_sin_uso: number; fuentes: number; capital_central: number; interior: number;
  };
  llamativos: Llamativo[];
  ranking: VendedorRanking[];
  riesgosos: VendedorRanking[];
  series: {
    netas_por_dia: { dia: string; total: number; con_uso: number; sin_uso: number; otros: number }[];
    sali_por_dia: { dia: string; total: number; sin_uso: number; con_uso: number }[];
    riesgo_uso: { riesgo: string; cargas: number; con_uso: number; sin_uso: number; pct_sin_uso: number }[];
    estados: { estado: string; total: number }[];
    zonas: { zona: string; total: number; finalizadas: number; pospago: number; internet: number; iptv: number; con_uso: number; sin_uso: number; pct_finalizacion: number; pct_sin_uso: number }[];
    productos: { producto: string; total: number; sin_uso: number; con_uso: number }[];
    pendientes_antiguedad: { rango: string; total: number }[];
    sin_uso_por_vendedor: { vendedor: string; sin_uso: number; con_uso: number; pct_sin_uso: number; nivel: Nivel }[];
    netas_por_vendedor: { vendedor: string; pospago: number; gpon: number; iptv: number; netas: number }[];
    uso_por_vendedor: { vendedor: string; pct_uso: number; pospago: number; nivel: Nivel }[];
    sali_por_vendedor: { vendedor: string; sali: number; sali_sin_uso: number }[];
  };
  lineas_sin_uso: LineaEvidencia[];
  sali_lineas: LineaEvidencia[];
  finalizadas_sin_activar: Record<string, unknown>[];
  pendientes_viejas: Record<string, unknown>[];
  pendientes_por_legajo: { legajo: string; cargado_por: string | null; total: number; mas_de_7_dias: number }[];
  cargas_riesgo_alto_sin_uso: Record<string, unknown>[];
}

export interface Hallazgo {
  id: string;
  auditoria_id: string;
  orden: number;
  codigo: string;
  titulo: string;
  descripcion: string | null;
  severidad: Severidad;
  categoria: string;
  vendedor: string | null;
  estado: HallazgoEstado;
  recomendacion: string | null;
  responsable: string | null;
  fecha_compromiso: string | null;
  evidencia: { lineas?: LineaEvidencia[]; sali?: LineaEvidencia[]; total?: number; senales?: Senal[]; resumen?: Record<string, number | string>; por_vendedor?: { vendedor: string; total: number }[] };
  origen: "auto" | "manual";
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}

export interface Seguimiento {
  id: string;
  auditoria_id: string;
  hallazgo_id: string | null;
  tipo: "nota" | "estado" | "hallazgo";
  texto: string;
  created_by: string;
  created_at: string;
}

export interface GraficoElegido { key: string; titulo?: string; nota?: string }

export interface AuditoriaResumen {
  id: string;
  codigo: string;
  titulo: string;
  status: EstadoAuditoria;
  periodo_desde: string | null;
  periodo_hasta: string | null;
  fuentes: FuenteUsada[];
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
  closed_by: string | null;
  closed_at: string | null;
  hallazgos_total: number;
  hallazgos_abiertos: number;
  hallazgos_alta: number;
}

export interface AuditoriaDetalle extends AuditoriaResumen {
  alcance: string | null;
  resumen: string | null;
  conclusiones: string | null;
  recomendaciones: string | null;
  snapshot: Snapshot;
  graficos: GraficoElegido[];
  historial: { fecha: string; usuario: string; accion: string; detalle: string | null }[];
  hallazgos: Hallazgo[];
  seguimientos: Seguimiento[];
  usuarios: Record<string, string>;
  editable: boolean;
  con_seguimiento: boolean;
  transiciones: EstadoAuditoria[];
  /** Solo en Borrador y solo para quien lo creó (o el superadmin). */
  puede_eliminar: boolean;
}

/** Catálogo de gráficos que el auditor puede incluir en el informe. */
export const CATALOGO_GRAFICOS: { key: string; titulo: string; descripcion: string }[] = [
  { key: "netas_por_dia", titulo: "Activaciones por día: con uso y sin uso", descripcion: "Netas Pospago por día de activación, con y sin consumo; GPON e IPTV aparte." },
  { key: "sin_uso_por_vendedor", titulo: "Líneas sin uso por vendedor", descripcion: "Los 15 vendedores con más líneas Pospago sin uso." },
  { key: "uso_por_vendedor", titulo: "% de uso por vendedor (peores)", descripcion: "Vendedores con al menos 5 líneas Pospago, ordenados de menor a mayor uso." },
  { key: "sali_por_dia", titulo: "Sali Hablando por día de portación", descripcion: "Portaciones SI-SaliHbl con y sin uso." },
  { key: "sali_por_vendedor", titulo: "Sali Hablando por vendedor", descripcion: "Vendedores con más portaciones Sali Hablando sin uso." },
  { key: "riesgo_uso", titulo: "Riesgo de la carga × uso de la línea", descripcion: "Finalizadas Pospago con y sin uso según el riesgo A/M/B asignado por Claro." },
  { key: "estados", titulo: "Estados de las cargas", descripcion: "Finalizadas, a confirmar, procesadas y rechazadas." },
  { key: "zonas", titulo: "Cargas por zona", descripcion: "Capital y Central frente a Interior, por negocio." },
  { key: "netas_por_vendedor", titulo: "Ranking de ventas netas", descripcion: "Los 15 vendedores con más netas, por negocio." },
  { key: "pendientes_antiguedad", titulo: "Pendientes por antigüedad", descripcion: "Cargas sin finalizar según los días desde el alta." },
];

/** '2026-09' → 'Septiembre 2026'. */
export function nombrePeriodo(periodo: string | null | undefined): string {
  if (!periodo) return "—";
  const [y, m] = periodo.split("-").map(Number);
  const s = new Date(y, (m || 1) - 1, 1).toLocaleDateString("es-PY", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function rangoPeriodos(a: AuditoriaResumen): string {
  if (!a.periodo_desde) return "—";
  return a.periodo_desde === a.periodo_hasta || !a.periodo_hasta ? nombrePeriodo(a.periodo_desde) : `${nombrePeriodo(a.periodo_desde)} – ${nombrePeriodo(a.periodo_hasta)}`;
}
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
export const n = (v: number | null | undefined) => (v ?? 0).toLocaleString("es-PY");
export const pct = (v: number | null | undefined) => `${(v ?? 0).toLocaleString("es-PY", { maximumFractionDigits: 1 })}%`;
