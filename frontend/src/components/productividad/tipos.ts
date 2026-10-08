/** Contratos de la API de Productividad de llamadas (Televentas CLARO) y formatos. */

export const PROD_API = "/api/v1/televentas-claro/productividad";
export const PROD_HREF = "/televentas-claro/productividad";

export type Banda = "rojo" | "bajo" | "meta" | "sobre";
export type Modo = "auto" | "manual" | "sin_llamadas";
export type Turno = "manana" | "tarde";
export type EstadoInforme = "draft" | "published" | "replaced";

export interface Parametros {
  meta_min: number;
  meta_max: number;
  rojo: number;
  sesion_abierta_horas: number;
  cambio_turno: string;
  min_llamadas_ranking: number;
  contacto_desde_seg: number;
}

/** Sumas e indicadores: sirven igual para un agente, un modo, un turno, un día o un período. */
export interface Resumen {
  login: number; ready: number; not_ready: number; handle: number; conversacion: number; hold: number; acw: number;
  llamadas: number; cortas: number; atendidas: number; gestionadas: number;
  login_val: number; conv_val: number; llamadas_val: number;
  dias: number; dias_validos: number; dias_sesion_abierta: number; dias_sin_llamadas: number;
  pct_conversacion: number | null; banda: Banda | null; pct_contacto: number | null;
  prom_conversacion: number | null; aht: number | null; jornada_media: number | null; llamadas_hora: number | null;
  pct_disponible: number | null; pct_pausa: number | null; pct_gestion: number | null;
  pct_tipificacion: number | null; pct_espera: number | null; pct_otros: number | null;
  agentes?: number; agentes_validos?: number; agentes_por_dia?: number | null;
  bandas?: Record<Banda, number>;
}

export interface Agente extends Resumen {
  clave: string;
  nombre: string;
  modo: Modo | null;
  turno: Turno | null;
  alertas: ("sesion_abierta" | "sin_llamadas")[];
  /** Por tramo del día: [llamadas, contactos, conversación (s), login (s)]. */
  tramos: number[][];
  /** Acumulado: cuántos días estuvo en cada banda. */
  dias_banda?: Record<Banda, number>;
}

export interface Tramo {
  desde: string; hasta: string; inicio_dia: boolean; minutos: number; dias: number;
  llamadas: number; atendidas: number; conversacion: number; login_val: number; conv_val: number; llamadas_val: number;
  agentes_activos: number | null;
  pct_contacto: number | null; pct_conversacion: number | null; banda: Banda | null;
  prom_conversacion: number | null; llamadas_hora: number | null;
}

export interface TramoExtremo { desde: string; hasta: string; pct_contacto: number; llamadas: number }

export interface InfoContacto {
  umbral: number | null;
  umbrales: number[];
  regla: number;
  exacto: boolean;
  mensaje: string | null;
}

export interface Turnos {
  determinado: boolean;
  corte?: string | null;
  dias?: number;
  motivo: string | null;
  manana: Resumen | null;
  tarde: Resumen | null;
}

export interface Alerta {
  tipo: "sesion_abierta" | "sin_llamadas";
  clave: string;
  nombre: string;
  login: number;
  llamadas: number;
  pct_pausa: number | null;
}

export interface DatosDia {
  version: number;
  fecha: string;
  parametros: Parametros;
  cortes: { id: string; hora: string; archivo: string | null; umbral_cortas: number | null }[];
  corte_final: string;
  contacto: InfoContacto;
  kpis: Resumen & { interacciones_no_detalladas: number };
  modos: { auto: Resumen; manual: Resumen };
  turnos: Turnos;
  tramos: Tramo[];
  tramo_mejor: TramoExtremo | null;
  tramo_peor: TramoExtremo | null;
  agentes: Agente[];
  alertas: Alerta[];
  sin_conexion: string[];
  avisos: string[];
}

export interface Corte {
  id: string; fecha: string; hora: string; corte_at: string; hora_origen: "archivo" | "manual";
  archivo: string | null; agentes: number; llamadas: number; umbrales_cortas: number[];
  uploaded_by: string; uploaded_at: string;
}

export interface InformeResumen {
  id: string;
  fecha: string;
  status: EstadoInforme;
  generated_at: string | null;
  generated_by: string | null;
  published_at: string | null;
  published_by: string | null;
  replaced_at: string | null;
  replaced_by_report_id: string | null;
  cortes: number;
  corte_final: string | null;
  agentes: number;
  llamadas: number;
  atendidas: number;
  pct_contacto: number | null;
  pct_conversacion: number | null;
  banda: Banda | null;
  jornada_media: number | null;
  alertas: number;
}

export interface InformeDetalle extends InformeResumen {
  data: DatosDia;
  parametros_vigentes: Parametros;
  parametros_distintos: boolean;
  version_actual: number;
  cortes_del_dia?: Corte[];
  cortes_nuevos?: number;
  usuarios: Record<string, string>;
}

export interface ListaInformes {
  items: InformeResumen[];
  total: number;
  usuarios: Record<string, string>;
}

export interface DiaSerie {
  fecha: string; informe_id: string; cortes: number; corte_final: string;
  agentes: number; agentes_validos: number; sesiones_abiertas: number;
  llamadas: number; atendidas: number; cortas: number; conversacion: number;
  pct_contacto: number | null; pct_conversacion: number | null; banda: Banda | null;
  prom_conversacion: number | null; aht: number | null; jornada_media: number | null; llamadas_hora: number | null;
}

export interface Acumulado {
  parametros: Parametros;
  contacto: InfoContacto;
  dias: DiaSerie[];
  kpis: Resumen & { agentes_por_dia: number | null; llamadas_por_dia: number | null; dias_publicados: number };
  modos: { auto: Resumen; manual: Resumen };
  turnos: Turnos;
  tramos: Tramo[];
  tramo_mejor: TramoExtremo | null;
  tramo_peor: TramoExtremo | null;
  agentes: Agente[];
}

export interface RespuestaAcumulado {
  desde: string;
  hasta: string;
  acumulado: Acumulado | null;
  pendientes_publicar: string[];
  ultimo_publicado: string | null;
}

export interface RespuestaParametros {
  parametros: Parametros;
  defecto: Parametros;
  puede_editar: boolean;
  actualizado: { en: string | null; por: string | null };
}

// ------------------------------------------------------------------ bandas, modos y turnos
export const BANDAS: Banda[] = ["rojo", "bajo", "meta", "sobre"];

/** Colores de estado validados (incluso para daltonismo); siempre van con ícono y texto. */
export const BANDA: Record<Banda, { nombre: string; color: string; chip: string; suave: string }> = {
  rojo: { nombre: "Rojo", color: "#E6332A", chip: "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30", suave: "bg-brand-primary-light/60" },
  bajo: { nombre: "Bajo la meta", color: "#F39200", chip: "bg-brand-orange/10 text-[#8A5200] border-brand-orange/40", suave: "bg-brand-orange/5" },
  meta: { nombre: "En meta", color: "#059669", chip: "bg-emerald-50 text-emerald-800 border-emerald-200", suave: "bg-emerald-50/60" },
  sobre: { nombre: "Sobre la meta", color: "#2A78D6", chip: "bg-[#2A78D6]/10 text-[#1D5BA6] border-[#2A78D6]/30", suave: "bg-[#2A78D6]/5" },
};

export function rangoBanda(b: Banda, p: Parametros): string {
  if (b === "rojo") return `menos de ${p.rojo}%`;
  if (b === "bajo") return `${p.rojo}% a ${p.meta_min}%`;
  if (b === "meta") return `${p.meta_min}% a ${p.meta_max}%`;
  return `más de ${p.meta_max}%`;
}

export const MODO_LABEL: Record<Modo, string> = { auto: "Discador automático", manual: "Discado manual", sin_llamadas: "Sin llamadas" };
export const MODO_CORTO: Record<Modo, string> = { auto: "Automático", manual: "Manual", sin_llamadas: "Sin llamadas" };
export const TURNO_LABEL: Record<Turno, string> = { manana: "Turno mañana", tarde: "Turno tarde" };

export const ESTADO_LABEL: Record<EstadoInforme, string> = { draft: "Borrador", published: "Publicado", replaced: "Reemplazado" };

/**
 * Contacto = llamada con N s o más de conversación (regla del negocio, 30 s por defecto). Solo es válido
 * si el archivo trae ese umbral («Short Talk < 30s»); si no (p. ej. solo «< 10s»), la pantalla no
 * muestra contacto: indica qué falta y usa indicadores que sí son válidos.
 */
export function medida(c: InfoContacto | null | undefined) {
  const regla = c?.regla ?? 30;
  const umbral = c?.umbral ?? regla;
  const exacto = !!c?.exacto;
  return {
    exacto, regla, umbral,
    rotulo: exacto ? `Contactos (≥ ${regla} s)` : `Respondidas (≥ ${umbral} s)`,
    corto: exacto ? `Contactos ≥ ${regla} s` : `Resp. ≥ ${umbral} s`,
    pct: exacto ? "% contacto" : `% respondidas ≥ ${umbral} s`,
    pctCorto: exacto ? "% Contacto" : `% ≥ ${umbral} s`,
    resto: exacto ? "Sin contacto" : `Menos de ${umbral} s`,
    explicacion: exacto
      ? `llamadas con ${regla} s o más de conversación`
      : `llamadas de ${umbral} s o más: es un techo, el contacto desde ${regla} s es igual o menor`,
  };
}

// ------------------------------------------------------------------ formatos
export const n = (v: number | null | undefined) => (v ?? 0).toLocaleString("es-PY");
export const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v.toLocaleString("es-PY", { maximumFractionDigits: 1 })}%`;

/** Duración larga: "74 h 46 min", "46 min", "32 s". */
export function horas(seg: number | null | undefined): string {
  if (seg === null || seg === undefined) return "—";
  const s = Math.round(seg);
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

/** Duración corta (promedios): "33 s", "1 min 26 s". */
export function segundos(seg: number | null | undefined): string {
  if (seg === null || seg === undefined) return "—";
  const s = Math.round(seg);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

/** Reloj para tablas: "5:33" (h:mm). */
export function reloj(seg: number | null | undefined): string {
  if (seg === null || seg === undefined) return "—";
  const m = Math.round(seg / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

const aFecha = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);

/** '2026-10-07' → 'miércoles 07/10/2026'. */
export function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = aFecha(iso);
  const dia = d.toLocaleDateString("es-PY", { weekday: "long" });
  return `${dia} ${d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" })}`;
}

/** '2026-10-07' → 'mié 07/10'. */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = aFecha(iso);
  return `${d.toLocaleDateString("es-PY", { weekday: "short" }).replace(".", "")} ${d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit" })}`;
}

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** '2026-10' → 'Octubre 2026'. */
export function nombreMes(periodo: string): string {
  const [y, m] = periodo.split("-").map(Number);
  const s = new Date(y, (m || 1) - 1, 1).toLocaleDateString("es-PY", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Etiqueta de un tramo: "Hasta 08:00" para el primero (desde la medianoche), "08:00–09:00" el resto. */
export const etiquetaTramo = (t: { desde: string; hasta: string; inicio_dia: boolean }) =>
  t.inicio_dia ? `Hasta ${t.hasta}` : `${t.desde}–${t.hasta}`;

// ------------------------------------------------------------------ fechas de períodos (sin zona horaria)
export function isoDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function sumarDias(iso: string, dias: number): string {
  const d = aFecha(iso);
  d.setDate(d.getDate() + dias);
  return isoDia(d);
}

/** Lunes de la semana del día. */
export function lunesDe(iso: string): string {
  const d = aFecha(iso);
  return sumarDias(iso, -((d.getDay() + 6) % 7));
}

export function finDeMes(iso: string): string {
  const d = aFecha(iso);
  return isoDia(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
}
