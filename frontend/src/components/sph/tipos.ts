/** Contratos de la API del SPH estimado (Televentas CLARO) y formatos. */
import { fechaCorta, fechaLarga, nombreMes, type EstadoInforme, type Modo, type Turno } from "@/components/productividad/tipos";

export const SPH_API = "/api/v1/televentas-claro/sph";
export const SPH_HREF = "/televentas-claro/sph";

/** Vinculados: manual, exacto, probable. Sin vínculo: el resto. */
export type Nivel = "manual" | "exacto" | "probable" | "ambiguo" | "sin_cruce" | "incompleto" | "descartado";
export const VINCULADOS: Nivel[] = ["exacto", "manual", "probable"];

/** Período del SPH: un día, una semana (lunes a domingo), un mes o un rango libre. */
export type TipoPeriodo = "dia" | "semana" | "mes" | "rango";

/** Qué ventas usa el SPH: desde la v4, las del día de la hoja de productividad; antes, las netas (líneas activadas). */
export type BaseSph = "ventas" | "netas";

export interface AgenteSph {
  clave: string;
  nombre: string;
  vendedor: string | null;
  subcanal: string | null;
  nivel: Nivel;
  candidatos: string[];
  /** Horas que cuentan (sin sesiones abiertas), en segundos: la base del SPH. */
  login: number;
  /** Tiempo de los días con sesión abierta (no cuenta). */
  login_abierta: number;
  dias: number;
  dias_sesion_abierta: number;
  sesion_abierta: boolean;
  llamadas: number;
  conversacion: number;
  modo: Modo | null;
  turno: Turno | null;
  /** Ventas que cuentan. null = sin vínculo (no se sabe cuántas vendió). */
  ventas: number | null;
  /** Ventas de los días con sesión abierta (no cuentan). */
  ventas_sesion_abierta: number;
  productos: Record<string, number>;
  /** Cargas del vendedor por estado (también las que no cuentan). Vacío en los SPH con netas. */
  estados: Record<string, number>;
  sph: number | null;
  en_ranking: boolean;
}

export interface VentaSinAgente { vendedor: string; subcanal: string | null; ventas: number; estados: Record<string, number> }
export interface VendedorPeriodo { vendedor: string; subcanal: string | null; ventas_mes: number }
/** Ventas cargadas sin POS por un legajo que carga para varios vendedores: no se sabe quién vendió. */
export interface SinVendedor { cargado_por: string; ventas: number }

export interface FuenteProd {
  id: string; status: EstadoInforme; fecha: string; corte_final: string | null; agentes: number; generated_at: string | null;
}
export interface FuenteVentas {
  id: string; status: EstadoInforme; periodo: string; fecha_dato: string | null;
  /** Ventas del mes que cuentan (hoja de productividad). `netas`: las de los SPH anteriores. */
  ventas?: number | null; netas?: number; generated_at: string | null;
}

export interface KpisSph {
  sph: number | null;
  ventas: number;
  ventas_operacion: number;
  ventas_sesion_abierta: number;
  ventas_vinculadas: number;
  ventas_sin_agente: number;
  ventas_sin_vendedor: number;
  horas: number;
  horas_vinculadas: number;
  sph_vinculados: number | null;
  /** Cargas por estado (también las rechazadas y canceladas, que no cuentan). */
  estados: Record<string, number>;
  finalizadas: number;
  pendientes: number;
  no_cuentan: number;
  pct_finalizadas: number | null;
  agentes: number;
  agentes_validos: number;
  sesiones_abiertas: number;
  vinculados: number;
  niveles: Partial<Record<Nivel, number>>;
  en_ranking: number;
  pct_cobertura: number | null;
  pct_cobertura_horas: number | null;
  productos: Record<string, number>;
  dias: number;
  dias_cubiertos: number;
  agentes_por_dia: number;
  /** Solo los SPH con netas: cargadas del día (sin rechazadas) y cuántas ya activaron. */
  cargadas?: number;
  pct_activadas?: number | null;
}

export interface SerieDia {
  fecha: string; ventas: number; ventas_operacion: number; horas: number; sph: number | null;
  estados: Record<string, number>; agentes: number;
  /** Solo los SPH con netas. */
  cargadas?: number;
}
export interface CoberturaDia { fecha: string; horas: boolean; ventas: boolean; productividad?: EstadoInforme | null }

export interface DatosSph {
  version: number;
  base: BaseSph;
  fecha: string;
  desde: string;
  hasta: string;
  tipo: TipoPeriodo;
  fuentes: { productividad: FuenteProd[]; ventas: FuenteVentas[]; dias_despues?: number | null };
  parametros: { min_horas_ranking: number };
  kpis: KpisSph;
  serie: SerieDia[];
  cobertura: CoberturaDia[];
  agentes: AgenteSph[];
  ventas_sin_agente: VentaSinAgente[];
  sin_vendedor: SinVendedor[];
  por_subcanal: { subcanal: string; ventas: number }[];
  vendedores: VendedorPeriodo[];
  avisos: string[];
}

export interface InformeSphResumen {
  id: string;
  fecha: string;
  desde: string;
  hasta: string;
  tipo: TipoPeriodo;
  /** Días que cuentan (con horas y ventas al corte). */
  dias: number;
  status: EstadoInforme;
  generated_at: string | null;
  generated_by: string | null;
  published_at: string | null;
  published_by: string | null;
  replaced_at: string | null;
  replaced_by_report_id: string | null;
  /** Versión del cálculo (vacía: anterior a la v4, con netas). */
  version: number | null;
  base: BaseSph;
  /** Las ventas que usó el SPH: del día (v4) o netas (antes). */
  ventas: number;
  sph: number | null;
  horas: number;
  agentes: number;
  vinculados: number;
  pct_cobertura: number | null;
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
  desde: string;
  hasta: string;
  tipo: TipoPeriodo;
  productividad: FuenteProd[];
  ventas: FuenteVentas[];
  cobertura: (CoberturaDia & { productividad: EstadoInforme | null })[];
  dias: number;
  dias_cubiertos: number;
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

// ------------------------------------------------------------------ períodos
export const TIPO_LABEL: Record<TipoPeriodo, string> = { dia: "Día", semana: "Semana", mes: "Mes", rango: "Rango" };

/** "Martes 15/09/2026" · "Semana del 14/09 al 20/09/2026" · "Septiembre 2026" · "Del 15/09 al 21/09/2026". */
export function etiquetaPeriodo(desde: string, hasta: string, tipo: TipoPeriodo): string {
  const largo = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const corto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  if (tipo === "dia" || desde === hasta) return fechaLarga(desde).replace(/^./, (c) => c.toUpperCase());
  if (tipo === "mes") return nombreMes(desde.slice(0, 7));
  if (tipo === "semana") return `Semana del ${corto(desde)} al ${largo(hasta)}`;
  return `Del ${corto(desde)} al ${largo(hasta)}`;
}

/** Período abreviado para chips y tooltips: "mar 15/09", "14/09–20/09", "sep 2026". */
export function periodoCorto(desde: string, hasta: string, tipo: TipoPeriodo): string {
  if (tipo === "dia" || desde === hasta) return fechaCorta(desde);
  if (tipo === "mes") return nombreMes(desde.slice(0, 7));
  return `${desde.slice(8, 10)}/${desde.slice(5, 7)}–${hasta.slice(8, 10)}/${hasta.slice(5, 7)}`;
}

/**
 * Lleva los SPH anteriores a la forma actual para mostrarlos igual:
 * - v1 (antes de los períodos): las fuentes venían sueltas y el tiempo de las sesiones abiertas dentro de `login`.
 * - v1 a v3: se calcularon con las netas (líneas activadas); quedan con `base: "netas"` para nombrarlas así.
 */
export function normalizar(d: DatosSph): DatosSph {
  if ((d.version ?? 1) >= 4) return { ...d, base: d.base ?? "ventas", sin_vendedor: d.sin_vendedor ?? [] };
  const x = d as any;
  const lista = <T,>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);
  const v1 = (d.version ?? 1) < 2;
  const k = x.kpis;
  const agentes: AgenteSph[] = (x.agentes as any[]).map((a) => {
    const base = { ...a, ventas: a.netas, ventas_sesion_abierta: a.netas_sesion_abierta ?? 0, estados: {} };
    if (!v1) return base;
    return a.sesion_abierta
      ? { ...base, login_abierta: a.login, login: 0, dias: 1, dias_sesion_abierta: 1, ventas_sesion_abierta: a.netas ?? 0, ventas: a.vendedor ? 0 : null }
      : { ...base, login_abierta: 0, dias: 1, dias_sesion_abierta: 0, ventas_sesion_abierta: 0 };
  });
  return {
    ...d,
    base: "netas",
    ...(v1 ? { desde: d.fecha, hasta: d.fecha, tipo: "dia" as TipoPeriodo } : {}),
    fuentes: { ...x.fuentes, productividad: lista(x.fuentes.productividad), ventas: lista(x.fuentes.ventas) },
    kpis: {
      ...k,
      ventas: k.netas, ventas_operacion: k.netas_operacion ?? k.netas, ventas_sesion_abierta: k.netas_sesion_abierta ?? 0,
      ventas_vinculadas: k.netas_vinculadas ?? 0, ventas_sin_agente: k.netas_sin_agente ?? 0, ventas_sin_vendedor: 0,
      estados: {}, finalizadas: 0, pendientes: 0, no_cuentan: 0, pct_finalizadas: null,
      ...(v1 ? { dias: 1, dias_cubiertos: 1, agentes_por_dia: k.agentes } : {}),
    },
    serie: v1 ? [] : (x.serie as any[]).map((s) => ({ ...s, ventas: s.netas, ventas_operacion: s.netas_operacion ?? s.netas, estados: {} })),
    cobertura: v1 ? [] : d.cobertura,
    agentes,
    ventas_sin_agente: (x.ventas_sin_agente as any[]).map((v) => ({ ...v, ventas: v.netas, estados: {} })),
    sin_vendedor: [],
    por_subcanal: (x.por_subcanal ?? []).map((p: any) => ({ subcanal: p.subcanal, ventas: p.netas })),
    vendedores: (x.vendedores ?? []).map((v: any) => ({ ...v, ventas_mes: v.netas_mes ?? 0 })),
  };
}

// ------------------------------------------------------------------ ventas y estados
/** Cómo se nombra lo que cuenta el SPH: ventas del día (v4) o netas (los anteriores). */
export const UNIDAD: Record<BaseSph, { una: string; varias: string; Varias: string }> = {
  ventas: { una: "venta", varias: "ventas", Varias: "Ventas" },
  netas: { una: "neta", varias: "netas", Varias: "Netas" },
};

/** Estados de la hoja de productividad, en orden. Las rechazadas y las canceladas no cuentan como venta. */
type EstadoVenta = { key: string; label: string; una: string; plural: string; color: string; cuenta: boolean };
export const ESTADOS_VENTA: EstadoVenta[] = [
  { key: "Vta_Finalizada", label: "Finalizada", una: "finalizada", plural: "finalizadas", color: "#00B2BF", cuenta: true },
  { key: "Vta_A_Confirmar", label: "A confirmar", una: "a confirmar", plural: "a confirmar", color: "#F39200", cuenta: true },
  { key: "Vta_Procesado", label: "Procesado", una: "procesada", plural: "procesadas", color: "#7B3FA0", cuenta: true },
  { key: "Vta_Rechazada", label: "Rechazada", una: "rechazada", plural: "rechazadas", color: "#E6332A", cuenta: false },
  { key: "Vta_Cancelada_Adm", label: "Cancelada (adm.)", una: "cancelada", plural: "canceladas", color: "#5B6275", cuenta: false },
];
const ESTADO_POR_KEY = new Map(ESTADOS_VENTA.map((e) => [e.key, e]));
/** Un estado que la hoja trae y el SPH no conoce cuenta como venta (el cálculo lo avisa). */
export const estadoVenta = (key: string): EstadoVenta => {
  const conocido = ESTADO_POR_KEY.get(key);
  if (conocido) return conocido;
  const texto = key.replace(/^Vta_/, "").replace(/_/g, " ");
  return { key, label: texto, una: texto.toLowerCase(), plural: texto.toLowerCase(), color: "#9ca3af", cuenta: true };
};

/** "3 finalizadas · 1 a confirmar" (solo las que cuentan, o solo las que no con `cuentan = false`). */
export function fmtEstados(estados: Record<string, number> | undefined, cuentan = true): string {
  return Object.entries(estados ?? {})
    .filter(([e, v]) => v > 0 && estadoVenta(e).cuenta === cuentan)
    .map(([e, v]) => `${v.toLocaleString("es-PY")} ${v === 1 ? estadoVenta(e).una : estadoVenta(e).plural}`)
    .join(" · ");
}

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
