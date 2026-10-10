/** Informe diario de la operación: tipos y utilidades compartidas (el backend vive en `informe_diario/`). */

export const ID_API = "/api/v1/televentas-claro/informe-diario";
export const ID_HREF = "/televentas-claro/informe-diario";

export type EstadoInforme = "borrador" | "firmado";
export type EstadoMetrica = "critico" | "atencion" | "ok";
export type EstadoSeg = "cumplido" | "en_curso" | "no_cumplido";
export type Tono = "malo" | "atencion" | "bueno" | "neutro";
export type Nivel = "alto" | "medio" | "bajo";
export type TipoFuente = "llamadas" | "cargas" | "proyeccion" | "coaching";

export interface Resultado { valor: number | null; meta: number | null; comentario: string }
export interface OtroResultado extends Resultado { id: string; nombre: string }
export interface Resultados {
  pospago: Resultado;
  gpon: Resultado;
  otros: OtroResultado[];
  fuente?: string | null;
  anterior?: { fecha: string; pospago: number | null; gpon: number | null };
}

export interface MetricaCritica {
  id: string;
  nombre: string;
  indicador: string;
  anterior?: string | null;
  estado: EstadoMetrica;
  comentario: string;
  compromiso: string;
  responsable: string;
  fecha_compromiso: string | null;
}

export interface KpiImportado { label: string; valor: string; detalle?: string | null; tono: Tono }
export interface Importado {
  id: string;
  tipo: TipoFuente;
  titulo: string;
  subtitulo: string;
  fecha: string;
  estado?: "publicado" | "borrador" | null;
  aviso?: string | null;
  kpis: KpiImportado[];
  filas?: { columnas: string[]; filas: string[][] } | null;
  url?: string | null;
  valores?: Record<string, number>;
  importado_at: string;
}

export interface SeguimientoItem {
  compromiso_id: string;
  estado: EstadoSeg;
  nota: string;
  metrica?: string;
  texto?: string;
  desde?: string;
  fecha_limite?: string | null;
}

export interface Compromiso {
  id: string;
  informe_id: string;
  fecha: string;
  metrica: string;
  texto: string;
  responsable: string | null;
  fecha_limite: string | null;
  estado: "abierto" | "cumplido" | "no_cumplido";
  vencido: boolean;
  ultimo: { fecha: string; informe_id: string; estado: EstadoSeg; nota: string } | null;
  cerrado_fecha: string | null;
  autor?: string;
  autor_id?: string;
}

export interface Comentario { id: string; autor: string; autor_id: string; rol: "superadmin" | "autor"; texto: string; at: string | null }
export interface Firma { nombre: string; cargo: string; imagen: string | null; firmado_at: string; codigo: string }
export type Marca = [number, number, string, boolean, boolean]; // inicio, fin, tema, crítico, negada

export interface AnalisisPalabras {
  total: number;
  criticas: number;
  negadas: number;
  nivel: Nivel;
  temas: Record<string, number>;
  claves: { clave: string; forma?: string; tema: string; n: number }[];
  marcas: Record<string, Marca[]>;
}

export interface InformeDetalle {
  id: string;
  fecha: string;
  estado: EstadoInforme;
  autor_id: string;
  autor: string;
  cargo: string;
  resultados: Resultados;
  resumen: string;
  metricas: MetricaCritica[];
  importados: Importado[];
  seguimiento: SeguimientoItem[];
  firma: Firma | null;
  firmado_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  revisado_at: string | null;
  es_autor: boolean;
  puede_editar: boolean;
  comentarios: Comentario[];
  nuevos: number;
  verificacion: boolean | null;
  hoy: string;
  dias_atras_max: number;
  min_resumen: number;
  max_importados: number;
  compromisos_abiertos?: Compromiso[];
  anterior?: { id: string; fecha: string; pospago: number | null; gpon: number | null;
    metricas: { nombre: string; indicador: string; estado: EstadoMetrica }[] } | null;
  firma_guardada?: { imagen: string | null; cargo: string | null };
  palabras?: AnalisisPalabras;
  temas?: Record<string, { nombre: string; critico: boolean }>;
}

export interface InformeResumen {
  id: string;
  fecha: string;
  estado: EstadoInforme;
  autor_id: string;
  autor: string;
  cargo: string;
  resumen: string;
  pospago: number | null;
  gpon: number | null;
  metricas: number;
  criticas: number;
  importados: number;
  comentarios: number;
  nuevos: number;
  firmado_at: string | null;
  updated_at: string | null;
  revisado_at: string | null;
  codigo: string | null;
  nivel?: Nivel | null;
  temas?: Record<string, number>;
  hora?: string | null;
  tarde?: boolean;
}

export interface DiaRacha { fecha: string; id: string | null; estado: "firmado" | "borrador" | "falta" | "hoy" | "libre" }

export interface MisInformes {
  hoy: string;
  desde: string;
  hasta: string;
  de_hoy: InformeResumen | null;
  racha: DiaRacha[];
  items: InformeResumen[];
  compromisos: { abiertos: number; vencidos: number; items: Compromiso[] };
  nuevos: number;
  dias_atras_max: number;
  es_superadmin: boolean;
}

export interface OpcionFuente { ref: string; label: string; estado: "publicado" | "borrador" | null; detalle: string | null; pospago?: number; gpon?: number }
export interface Fuente { tipo: TipoFuente; titulo: string; descripcion: string; permiso: boolean; opciones: OpcionFuente[] }

export interface CeldaDia { fecha: string; estado: "firmado" | "borrador" | "falta" | "libre" | "futuro"; id?: string; hora?: string | null; tarde?: boolean; nivel?: Nivel | null }
export interface FilaAutor { id: string; nombre: string; cargo: string; dias: CeldaDia[]; esperados: number; firmados: number; pct: number | null }
export interface TemaPalabras { clave: string; nombre: string; critico: boolean; n: number; informes: number }
export interface PanelSeguimiento {
  desde: string;
  hasta: string;
  hoy: string;
  /** Desde cuándo se espera el informe (el día en que se instaló). */
  inicio?: string | null;
  dias: { fecha: string; esperado: boolean; feriado: boolean }[];
  kpis: {
    firmados: number; borradores: number; esperados: number; pct_cumplimiento: number | null; faltan: number; sin_revisar: number;
    alertas: number; compromisos_abiertos: number; compromisos_vencidos: number; cumplidos: number; no_cumplidos: number; comentarios: number;
  };
  autores: FilaAutor[];
  informes: InformeResumen[];
  compromisos: Compromiso[];
  palabras: {
    temas: TemaPalabras[];
    claves: { clave: string; forma?: string; tema: string; n: number; informes: number }[];
    por_dia: { fecha: string; total: number; criticas: number; informes: number }[];
    alertas: { id: string; fecha: string; autor: string; autor_id: string; nivel: Nivel; criticas: number; claves: string[] }[];
  };
  opciones: { autores: { id: string; nombre: string }[] };
}

export interface TemaDiccionario { clave: string; nombre: string; critico: boolean; palabras: string[] }
export interface Diccionario {
  temas: TemaDiccionario[];
  por_defecto: boolean;
  updated_at: string | null;
  updated_by: string | null;
  reglas: { alto: number; medio: number; ventana_negacion: number };
}

// ------------------------------------------------------------------ rótulos y colores
const VERDE = "bg-emerald-50 text-emerald-800 border-emerald-200";
const NARANJA = "bg-brand-orange/10 text-[#8A5200] border-brand-orange/40";
const ROJO = "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30";
const GRIS = "bg-brand-bg text-brand-slate border-brand-border";
const AZUL = "bg-[#2A78D6]/10 text-[#1D5BA6] border-[#2A78D6]/30";

export const CHIP = { VERDE, NARANJA, ROJO, GRIS, AZUL };

export const ESTADO_METRICA: Record<EstadoMetrica, { label: string; chip: string; barra: string; activo: string }> = {
  critico: { label: "Crítica", chip: ROJO, barra: "bg-brand-primary", activo: "border-brand-primary bg-brand-primary text-white" },
  atencion: { label: "Atención", chip: NARANJA, barra: "bg-brand-orange", activo: "border-brand-orange bg-brand-orange text-white" },
  ok: { label: "En orden", chip: VERDE, barra: "bg-emerald-500", activo: "border-emerald-600 bg-emerald-600 text-white" },
};

export const ESTADO_SEG: Record<EstadoSeg, { label: string; chip: string; activo: string }> = {
  cumplido: { label: "Cumplido", chip: VERDE, activo: "border-emerald-600 bg-emerald-600 text-white" },
  en_curso: { label: "En curso", chip: NARANJA, activo: "border-brand-orange bg-brand-orange text-white" },
  no_cumplido: { label: "No cumplido", chip: ROJO, activo: "border-brand-primary bg-brand-primary text-white" },
};

export const NIVEL: Record<Nivel, { label: string; chip: string; ayuda: string }> = {
  alto: { label: "Alerta alta", chip: ROJO, ayuda: "3 o más menciones de temas críticos (riesgo, urgencia)" },
  medio: { label: "Alerta media", chip: NARANJA, ayuda: "1 o 2 menciones de temas críticos" },
  bajo: { label: "Sin alertas", chip: GRIS, ayuda: "Sin menciones de temas críticos" },
};

export const TONO_TEXTO: Record<Tono, string> = {
  malo: "text-brand-primary-dark", atencion: "text-[#8A5200]", bueno: "text-emerald-700", neutro: "text-brand-ink",
};

export const SUGERENCIAS_METRICA = [
  "% sin uso Pospago", "Conversación", "Netas Pospago", "Netas GPON", "SPH", "Contacto", "AHT", "Asesores conectados",
  "Ausentismo", "Seguimientos vencidos", "Tickets vencidos", "Líneas a recuperar", "Proyección Pospago", "Proyección GPON",
];

// ------------------------------------------------------------------ utilidades
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DIAS_LARGOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const aFecha = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);

/** '2026-10-14' → 'mié 14/10'. */
export function diaCorto(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = aFecha(iso);
  return `${DIAS[d.getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** '2026-10-14' → 'Miércoles 14/10/2026'. */
export function diaLargo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = aFecha(iso);
  const s = `${DIAS_LARGOS[d.getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const inicialDia = (iso: string) => DIAS[aFecha(iso).getDay()].charAt(0).toUpperCase();

/** Hora local de Asunción: '18:42'. */
export function horaPy(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-PY", { timeZone: "America/Asuncion", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function fechaHoraPy(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-PY", {
    timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
}

export function numero(v: number | null | undefined, nd?: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const d = nd ?? (Number.isInteger(v) ? 0 : 2);
  return v.toLocaleString("es-PY", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** % de cumplimiento contra la meta, con su tono. */
export function cumplimiento(valor: number | null | undefined, meta: number | null | undefined): { pct: number | null; tono: Tono } {
  if (valor === null || valor === undefined || !meta) return { pct: null, tono: "neutro" };
  const pct = (valor / meta) * 100;
  return { pct, tono: pct >= 100 ? "bueno" : pct >= 80 ? "atencion" : "malo" };
}

export const nuevoId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
  .replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);

export const metricaVacia = (): MetricaCritica => ({
  id: nuevoId(), nombre: "", indicador: "", anterior: null, estado: "critico", comentario: "", compromiso: "", responsable: "", fecha_compromiso: null,
});

/** Lo que falta para poder firmar. */
export function faltantes(d: { resultados: Resultados; resumen: string; metricas: MetricaCritica[] }, minResumen: number): string[] {
  const out: string[] = [];
  if (d.resultados.pospago.valor === null || d.resultados.gpon.valor === null) out.push("los resultados de Pospago y GPON");
  if (d.resumen.trim().length < minResumen) out.push("el resumen del día");
  if (d.metricas.some((m) => !m.nombre.trim())) out.push("el nombre de cada métrica");
  return out;
}
