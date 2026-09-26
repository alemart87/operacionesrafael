/** Contratos de la API de Ventas Netas (Televentas CLARO). */

export const VN_API = "/api/v1/televentas-claro/ventas-netas";
/** Debe coincidir con ANALYSIS_VERSION del backend (jobs.py). */
export const VERSION_ANALISIS = 5;
export const VN_HREF = "/televentas-claro/ventas-netas";

export type EstadoInforme = "draft" | "published" | "replaced";

export interface InformeResumen {
  id: string;
  upload_id: string;
  periodo: string; // 'YYYY-MM'
  period_month: string;
  fecha_dato: string | null;
  generated_at: string;
  generated_by: string | null;
  status: EstadoInforme;
  published_at: string | null;
  published_by: string | null;
  replaced_at: string | null;
  replaced_by_report_id: string | null;
  title: string | null;
  netas: number;
  pospago: number;
  gpon: number;
  iptv: number;
  pospago_sin_uso: number;
  pct_sin_uso: number;
  pendientes: number;
}

export interface ListaInformes {
  items: InformeResumen[];
  total: number;
  usuarios: Record<string, string>;
}

export interface UsoStats {
  total: number;
  pospago: number;
  sin_uso: number;
  con_uso: number;
  pct_uso: number;
  pct_sin_uso: number;
}

export interface Vendedor {
  vendedor: string;
  subcanal: string | null;
  pos_id: string | null;
  pospago: number;
  sin_uso: number;
  con_uso: number;
  gpon: number;
  iptv: number;
  otros: number;
  total: number;
  portadas: number;
  suspendidas: number;
  pct_uso: number;
  pct_sin_uso: number;
  alerta: boolean;
}

export interface Pendiente {
  sds_number: string;
  fecha_alta: string | null;
  dias: number | null;
  antiguedad: string;
  estado: string;
  cancelacion_adm: string | null;
  producto: string | null;
  plan: string | null;
  campania: string | null;
  portacion: "SI" | "NO";
  tipo_port: string | null;
  origen_portacion: string | null;
  riesgo: string | null;
  legajo: string | null;
  cargado_por: string | null;
  vendedor: string | null;
  ciudad: string | null;
  comentario: string | null;
}

export interface DetalleNeta {
  sds_number: string;
  linea: string | null;
  fecha_activacion: string | null;
  producto: string | null;
  plan: string | null;
  campania: string | null;
  portacion: string;
  tipo_port: string | null;
  origen_portacion: string | null;
  consumo: "SI" | "NO" | null;
  /** Pospago sin consumo activada hace menos de 3 días al corte: en espera de uso, no es alerta. */
  en_espera?: boolean;
  /** Días desde la activación hasta el corte. */
  dias?: number | null;
  estado_linea: string | null;
  razon_cierre: string | null;
  vendedor: string;
  subcanal: string | null;
  pos_id: string | null;
  ciudad: string | null;
  segmento: string | null;
  total_neto: number | null;
  hoja: string;
}

export interface Kpis {
  periodo: string;
  fecha_dato: string | null;
  netas: number;
  pospago: number;
  gpon: number;
  iptv: number;
  portadas: number;
  nativas: number;
  pct_portacion: number;
  pospago_sin_uso: number;
  pospago_con_uso: number;
  /** Pospago sin consumo activadas hace menos de 3 días al corte: no cuentan como sin uso. */
  pospago_en_espera?: number;
  pct_sin_uso: number;
  pct_uso: number;
  suspendidas: number;
  fuera_de_netas: number;
  vendedores: number;
  vendedores_alerta: number;
  cargas: number;
  cargas_finalizadas: number;
  finalizadas_sin_activar: number;
  pendientes: number;
  pendientes_portacion: number;
  pendientes_mas_de_7_dias: number;
  fuera_periodo: number;
  umbral_uso_pct: number;
  min_lineas_alerta: number;
}

/** Fila de productividad (CARGAS): totales, estados, productos y zonas. */
export type FilaProd = {
  total: number;
  finalizadas: number;
  pct_finalizacion: number;
  pospago: number;
  internet: number;
  iptv: number;
  capital_central: number;
  interior: number;
  con_uso: number;
  sin_uso: number;
  sin_dato_uso: number;
  fin_fija: number;
  pct_sin_uso: number;
  riesgo_A: number;
  riesgo_M: number;
  riesgo_B: number;
  sin_uso_riesgo_A: number;
} & Record<string, number | string | null>;

export interface Productividad {
  estados: string[];
  productos: string[];
  zonas: string[];
  kpis: {
    cargas: number; finalizadas: number; pct_finalizacion: number; a_confirmar: number; rechazadas: number; procesadas: number;
    pospago: number; internet: number; iptv: number; capital_central: number; interior: number; pct_interior: number;
    dias_con_cargas: number; promedio_diario: number; mejor_dia: string | null; mejor_dia_total: number;
    ultimo_dia: string | null; ultimo_dia_total: number; vendedores: number; sin_atribuir: number; fecha_dato: string | null;
    con_uso: number; sin_uso: number; sin_dato_uso: number; en_espera?: number; pct_sin_uso: number; riesgo_alto: number; sin_uso_riesgo_alto: number;
  };
  por_dia: (FilaProd & { dia: string; acumulado: number })[];
  por_estado: { estado: string; total: number; pct: number }[];
  por_producto: (FilaProd & { producto: string })[];
  por_zona: (FilaProd & { zona: string })[];
  por_departamento: (FilaProd & { departamento: string; zona: string })[];
  por_ciudad: (FilaProd & { ciudad: string; zona: string })[];
  por_vendedor: (FilaProd & { vendedor: string; subcanal: string | null; por_legajo: number })[];
  riesgo_uso?: { riesgo: string; cargas: number; con_uso: number; sin_uso: number; pct_sin_uso: number }[];
  detalle_cargas?: DetalleCarga[];
}

/** Una venta cargada (hoja CARGAS) con su riesgo y, si finalizó en Pospago, su uso. */
export interface DetalleCarga {
  sds_number: string;
  fecha_alta: string | null;
  estado: string;
  producto: string;
  plan: string | null;
  campania: string | null;
  portacion: "SI" | "NO";
  origen_portacion: string | null;
  riesgo: string | null;
  zona: string;
  departamento: string | null;
  ciudad: string | null;
  vendedor: string;
  atribucion: "pos" | "legajo" | "sin_atribuir";
  legajo: string | null;
  /** ESPERA: activada hace menos de 3 días al corte, todavía no se evalúa (no es alerta). */
  uso: "SI" | "NO" | "ESPERA" | null;
  /** Finalizada Pospago sin consumo: alerta PFI. */
  riesgosa: boolean;
}

/** Portaciones "Sali Hablando" (SI-SaliHbl): la línea salió hablando de la otra operadora. */
export interface SaliHablando {
  kpis: { total: number; sin_uso: number; con_uso: number; pct_sin_uso: number; en_ddi: number; fuera_ddi: number; vendedores: number; primer_dia: string | null; ultimo_dia: string | null; activadas_mes_anterior: number };
  por_dia: { dia: string; total: number; sin_uso: number; con_uso: number; pct_sin_uso: number }[];
  por_dia_activacion: { dia: string; total: number; sin_uso: number; con_uso: number; pct_sin_uso: number }[];
  por_vendedor: { vendedor: string; subcanal: string | null; total: number; sin_uso: number; con_uso: number; pct_sin_uso: number }[];
  por_origen: { origen: string; total: number; sin_uso: number; con_uso: number; pct_sin_uso: number }[];
  por_plan: { plan: string; total: number; sin_uso: number; con_uso: number; pct_sin_uso: number }[];
  detalle: (DetalleNeta & { fecha_portacion: string | null; dias_activacion_a_portacion: number | null; dias_desde_portacion: number | null; en_ddi: boolean; riesgo: string | null; sin_uso: boolean })[];
}

export interface InformeData {
  /** Ausente en informes anteriores a la versión 5. */
  sali_hablando?: SaliHablando;
  /** Versión del análisis con que se generó. Sin ella o menor a la actual: informe de una versión anterior. */
  version?: number;
  /** Ausente en informes generados antes de la pestaña Productividad. */
  productividad?: Productividad;
  kpis: Kpis;
  por_producto: ({ producto: string } & UsoStats)[];
  por_plan: ({ producto: string; plan: string } & UsoStats)[];
  por_dia: ({ dia: string } & UsoStats)[];
  portacion: { por_tipo: ({ tipo: string } & UsoStats)[]; por_origen: ({ origen: string } & UsoStats)[] };
  por_segmento: ({ segmento: string } & UsoStats)[];
  por_subcanal: ({ subcanal: string } & UsoStats)[];
  por_ciudad: ({ ciudad: string } & UsoStats)[];
  vendedores: Vendedor[];
  alertas: Vendedor[];
  suspendidas: { total: number; por_razon: { razon: string; total: number }[] };
  fuera_de_netas: { total: number; sin_uso: number; por_tipo: { tipo: string; total: number }[]; detalle: DetalleNeta[] };
  pendientes: {
    total: number;
    portacion: number;
    estados: string[];
    por_estado: { estado: string; total: number }[];
    por_antiguedad: ({ rango: string; total: number } & Record<string, number | string>)[];
    por_legajo: { legajo: string; cargado_por: string | null; total: number; mas_de_7_dias: number }[];
    mas_de_7_dias: number;
    detalle: Pendiente[];
  };
  finalizadas_sin_activar: { sds_number: string; fecha_venta: string | null; producto: string | null; plan: string | null; legajo: string | null; vendedor: string | null }[];
  detalle_netas: DetalleNeta[];
}

export interface InformeDetalle extends InformeResumen {
  data: InformeData;
}

export const ESTADO_LABEL: Record<EstadoInforme, string> = {
  draft: "Borrador",
  published: "Publicado",
  replaced: "Reemplazado",
};

export const ESTADO_SDS_LABEL: Record<string, string> = {
  Vta_A_Confirmar: "A confirmar",
  Vta_Procesado: "Procesado",
  Vta_Rechazada: "Rechazada",
  Vta_Finalizada: "Finalizada",
};

/** '2026-09' → 'Septiembre 2026'. */
export function nombrePeriodo(periodo: string): string {
  const [y, m] = periodo.split("-").map(Number);
  const s = new Date(y, (m || 1) - 1, 1).toLocaleDateString("es-PY", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** '2026-09-22' → '22/09/2026' (sin zona horaria). */
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
