/** Contratos de la API de Ventas Netas (Televentas CLARO). */

export const VN_API = "/api/v1/televentas-claro/ventas-netas";
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

export interface InformeData {
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
