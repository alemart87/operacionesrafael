/** Contratos de la API del SPH estimado (Televentas CLARO) y formatos. */
import type { EstadoInforme, Modo, Turno } from "@/components/productividad/tipos";

export const SPH_API = "/api/v1/televentas-claro/sph";
export const SPH_HREF = "/televentas-claro/sph";

/** Vinculados: manual, exacto, probable. Sin vínculo: el resto. */
export type Nivel = "manual" | "exacto" | "probable" | "ambiguo" | "sin_cruce" | "incompleto" | "descartado";
export const VINCULADOS: Nivel[] = ["exacto", "manual", "probable"];

export interface AgenteSph {
  clave: string;
  nombre: string;
  vendedor: string | null;
  subcanal: string | null;
  nivel: Nivel;
  candidatos: string[];
  login: number;
  sesion_abierta: boolean;
  llamadas: number;
  conversacion: number;
  modo: Modo | null;
  turno: Turno | null;
  /** null = sin vínculo (no se sabe cuántas vendió). */
  netas: number | null;
  productos: Record<string, number>;
  cargadas: number | null;
  sph: number | null;
  sph_cargadas: number | null;
  en_ranking: boolean;
}

export interface VentaSinAgente { vendedor: string; subcanal: string | null; netas: number; cargadas: number }
export interface VendedorPeriodo { vendedor: string; subcanal: string | null; netas_mes: number }

export interface FuenteProd {
  id: string; status: EstadoInforme; fecha: string; corte_final: string | null; agentes: number; generated_at: string | null;
}
export interface FuenteVentas {
  id: string; status: EstadoInforme; periodo: string; fecha_dato: string | null; netas: number; generated_at: string | null;
}

export interface KpisSph {
  sph: number | null;
  netas: number;
  netas_operacion: number;
  netas_sesion_abierta: number;
  netas_vinculadas: number;
  netas_sin_agente: number;
  horas: number;
  horas_vinculadas: number;
  sph_vinculados: number | null;
  cargadas: number;
  sph_cargadas: number | null;
  pct_activadas: number | null;
  agentes: number;
  agentes_validos: number;
  sesiones_abiertas: number;
  vinculados: number;
  niveles: Partial<Record<Nivel, number>>;
  en_ranking: number;
  pct_cobertura: number | null;
  pct_cobertura_horas: number | null;
  productos: Record<string, number>;
  netas_sin_fecha_mes: number;
}

export interface DatosSph {
  version: number;
  fecha: string;
  fuentes: { productividad: FuenteProd; ventas: FuenteVentas; dias_despues: number | null };
  parametros: { min_horas_ranking: number; dias_maduracion: number };
  kpis: KpisSph;
  agentes: AgenteSph[];
  ventas_sin_agente: VentaSinAgente[];
  por_subcanal: { subcanal: string; netas: number }[];
  vendedores: VendedorPeriodo[];
  avisos: string[];
}

export interface InformeSphResumen {
  id: string;
  fecha: string;
  status: EstadoInforme;
  generated_at: string | null;
  generated_by: string | null;
  published_at: string | null;
  published_by: string | null;
  replaced_at: string | null;
  replaced_by_report_id: string | null;
  sph: number | null;
  netas: number;
  horas: number;
  agentes: number;
  vinculados: number;
  pct_cobertura: number | null;
  pct_activadas: number | null;
  ventas_corte: string | null;
}

export interface InformeSphDetalle extends InformeSphResumen {
  data: DatosSph;
  version_actual: number;
  fuentes_nuevas?: string[];
  vinculos?: Record<string, string | null>;
  usuarios: Record<string, string>;
}

export interface ListaSph { items: InformeSphResumen[]; total: number; usuarios: Record<string, string> }

export interface DiaDisponible {
  fecha: string;
  productividad: EstadoInforme;
  ventas: EstadoInforme | null;
  ventas_corte: string | null;
  cubre: boolean;
  sph: Partial<Record<EstadoInforme, string>>;
}
export interface RespuestaDias { dias: DiaDisponible[]; sugerida: string | null }

export interface RespuestaFuentes {
  fecha: string;
  productividad: FuenteProd | null;
  ventas: FuenteVentas | null;
  puede_calcular: boolean;
  motivo: string | null;
  sph: Partial<Record<EstadoInforme, string>>;
}

export interface Vinculo { clave: string; nombre: string; vendedor: string | null; updated_at: string | null; updated_by: string | null }

// ------------------------------------------------------------------ niveles del cruce
/** Calidad del vínculo agente → vendedor. Siempre con texto; el color acompaña. */
export const NIVEL: Record<Nivel, { label: string; chip: string; color: string; ayuda: string }> = {
  exacto: {
    label: "Exacto", color: "#059669", chip: "bg-emerald-50 text-emerald-800 border-emerald-200",
    ayuda: "Todas las palabras del nombre del agente están en el del vendedor.",
  },
  manual: {
    label: "Manual", color: "#2A78D6", chip: "bg-[#2A78D6]/10 text-[#1D5BA6] border-[#2A78D6]/30",
    ayuda: "Lo vinculó gestión a mano.",
  },
  probable: {
    label: "Probable", color: "#F39200", chip: "bg-brand-orange/10 text-[#8A5200] border-brand-orange/40",
    ayuda: "Coinciden el nombre y un apellido, pero falta alguna palabra, cambia la escritura o el apellido puede ser el segundo. Conviene confirmarlo.",
  },
  ambiguo: {
    label: "Ambiguo", color: "#E6332A", chip: "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30",
    ayuda: "Hay más de un vendedor igual de parecido: elegí el correcto.",
  },
  sin_cruce: {
    label: "Sin cruce", color: "#C9CDD6", chip: "bg-brand-bg text-brand-slate border-brand-border",
    ayuda: "No figura como vendedor en el mes: no tuvo ventas cargadas o figura con otro nombre.",
  },
  incompleto: {
    label: "Nombre incompleto", color: "#C9CDD6", chip: "bg-brand-bg text-brand-slate border-brand-border",
    ayuda: "La plataforma no trae el nombre del agente (solo el apellido): vinculalo a mano.",
  },
  descartado: {
    label: "No vincular", color: "#C9CDD6", chip: "bg-brand-bg text-brand-slate border-brand-border",
    ayuda: "Gestión indicó que no es ninguno de los vendedores del mes.",
  },
};

export const vinculado = (nivel: Nivel) => VINCULADOS.includes(nivel);

// ------------------------------------------------------------------ formatos
/** SPH con dos decimales: "0,31". */
export const fmtSph = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Horas con un decimal: "333,3 h". */
export const fmtHoras = (seg: number | null | undefined) =>
  seg === null || seg === undefined ? "—" : `${(seg / 3600).toLocaleString("es-PY", { maximumFractionDigits: 1 })} h`;

/** "Pospago 2 · GPON 1". */
export const fmtProductos = (p: Record<string, number>) =>
  Object.entries(p).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ");
