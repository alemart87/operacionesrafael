/** Contratos de la API de Supervisión (Televentas CLARO, modelo Líder Coach Comercial) y formatos. */

export const SUP_API = "/api/v1/televentas-claro/supervision";
export const SUP_HREF = "/televentas-claro/supervision";

export type EstadoObjetivo = "en_camino" | "en_riesgo" | "bajo_objetivo" | "sin_objetivo" | "sin_datos";
export type Cruce =
  | "exacto" | "probable" | "manual"
  | "descartado" | "ambiguo" | "sin_cruce" | "incompleto"
  | "sin_agente" | "solo_ventas";

export interface Proyeccion {
  vendido: number | null;
  objetivo: number | null;
  esperado_al_corte: number | null;
  proyeccion: number | null;
  pct_logro: number | null;
  pct_proyeccion: number | null;
  faltan: number | null;
  ritmo_necesario: number | null;
  estado: EstadoObjetivo;
  provisoria: boolean;
}

export interface Calendario { total: number; transcurridos: number; restantes: number; corte: string | null; cerrado: boolean }
export interface FuenteVentas { id: string; status: string; provisorio: boolean; fecha_dato: string | null; netas: number }
export interface ParametrosSup {
  umbral_sin_uso: number;
  min_evaluables: number;
  semaforo_en_camino: number;
  semaforo_en_riesgo: number;
  min_dias_proyeccion: number;
  pesos_dia: number[];
}

/** Lo que trae toda respuesta de un mes. */
export interface Comun {
  periodo: string;
  nombre_mes: string;
  referencia: string;
  ventas: FuenteVentas | null;
  calendario: Calendario;
  parametros: ParametrosSup;
}

export interface Objetivo { pospago: number | null; gpon: number | null; updated_at: string | null; updated_by: string | null }
export interface Uso { evaluables: number; sin_uso: number; en_espera: number; pct_sin_uso: number | null; alerta: boolean; a_recuperar: number }
export interface SupervisorRef { id: string; nombre: string; activo: boolean }

export interface OperadorCorto {
  id: string;
  nombre: string;
  agente: string | null;
  vendedor: string | null;
  subcanal: string | null;
  cruce: Cruce;
  activo: boolean;
}

export interface AsesorEquipo extends OperadorCorto {
  score: number | null;
  parcial: boolean;
  componentes: Componente[];
  actual: boolean;
  desde: string | null;
  hasta: string | null;
  pospago: number | null;
  gpon: number | null;
  uso: Uso | null;
}

export interface DetalleSupervisor extends Comun {
  supervisor: SupervisorRef;
  objetivo: Objetivo;
  pospago: Proyeccion;
  gpon: Proyeccion;
  asesores_actuales: number;
  critico: boolean;
  asesores_en_alerta: number;
  a_recuperar: number;
  asesores: AsesorEquipo[];
  scoring: ScoringSupervisor | null;
  coaching?: ParaHoy;
}

/** Lo que el supervisor tiene que atender de su gestión (portal). */
export interface ParaHoy {
  seguimientos_vencidos: number;
  seguimientos_hoy: number;
  /** Seguimientos de los próximos días hábiles (hasta `proximos_hasta`): para prepararlos antes de que lleguen. */
  seguimientos_proximos?: number;
  proximos_hasta?: string;
  alertas_vencidas: number;
  alertas_en_plazo: number;
  sin_coaching: number;
  tickets_nuevos?: number;
  tickets_por_vencer?: number;
  tickets_vencidos?: number;
}

export interface FilaSupervisor extends SupervisorRef {
  asesores: number;
  objetivo: Objetivo;
  pospago: Proyeccion;
  gpon: Proyeccion;
  critico: boolean;
  asesores_en_alerta: number;
  a_recuperar: number;
}

export interface ResumenSupervision extends Comun {
  operacion: {
    netas: number | null;
    pospago: Proyeccion;
    gpon: Proyeccion;
    asesores_en_alerta: number;
    asesores_en_alerta_sin_supervisor: number;
    a_recuperar: number;
    supervisores_criticos: number;
    supervisores: number;
  };
  supervisores: FilaSupervisor[];
  sin_supervisor: { pospago: number; gpon: number; asesores: number; vendedores_sin_operador: string[]; netas_sin_vendedor: number };
  equipos_cargados: boolean;
  puede_gestionar: boolean;
}

export interface LineaSinUso { sds: string; linea: string | null; plan: string | null; fecha_activacion: string | null; dias: number | null; estado: "sin_uso" | "en_espera" }
export interface LineasAsesor extends OperadorCorto { uso: Uso | null; lineas: LineaSinUso[] }

// ------------------------------------------------------------------ equipos
export interface TramoEquipo { desde: string; hasta: string; supervisor_id: string | null; supervisor: string | null }
export interface MiembroEquipo extends OperadorCorto { ultima_vez: string | null; tramos: TramoEquipo[] }
export interface Deteccion {
  periodo: string;
  agentes: number;
  vendedores: number;
  nuevos: number;
  unidos: number;
  sugeridos: number;
  operadores_del_mes: number;
  vinculados: number;
  por_revisar: number;
  dias_productividad: number;
  ventas: { id: string; status: string; fecha_dato: string | null } | null;
  detectado_at: string;
  sin_cambios?: boolean;
}
export interface Equipos {
  periodo: string;
  nombre_mes: string;
  referencia: string;
  primero: string;
  ultimo: string;
  anterior: string;
  nombre_anterior: string;
  anterior_tiene_equipos: boolean;
  tiene_equipos: boolean;
  supervisores: (SupervisorRef & { asesores: MiembroEquipo[] })[];
  sin_supervisor: MiembroEquipo[];
  deteccion: Deteccion;
  puede_gestionar: boolean;
}

// ------------------------------------------------------------------ operadores
export interface Sugerido { id: string | null; nombre: string; identidad: string }
export interface Operador extends OperadorCorto {
  agente_clave: string | null;
  legajo: string | null;
  candidatos: string[];
  sugeridos: Sugerido[];
  primera_vez: string | null;
  ultima_vez: string | null;
  nombre_manual: boolean;
  updated_at: string | null;
  updated_by: string | null;
  del_mes: boolean;
}
export interface ListaOperadores {
  periodo: string;
  nombre_mes: string;
  deteccion: Deteccion;
  resumen: { total: number; vinculados: number; por_revisar: number; solo_llamadas: number; solo_ventas: number; inactivos: number };
  items: Operador[];
  puede_gestionar: boolean;
}

/** Horario de atención: por día de la semana (0 = lunes) [inicio, fin] o null si no se atiende. */
export type HorarioAtencion = Record<string, [string, string] | null>;

export interface ParametrosCompletos extends ParametrosSup {
  horario: HorarioAtencion;
  no_laborables: { fecha: string; motivo: string }[];
  feriados_seguridad: string[];
  feriados: string[];
  updated_at: string | null;
  updated_by: string | null;
}

// ------------------------------------------------------------------ etiquetas
export const ESTADO: Record<EstadoObjetivo, { label: string; chip: string; color: string; ayuda: string }> = {
  en_camino: {
    label: "En camino", color: "#059669", chip: "bg-emerald-50 text-emerald-800 border-emerald-200",
    ayuda: "La proyección al cierre llega al objetivo.",
  },
  en_riesgo: {
    label: "En riesgo", color: "#F39200", chip: "bg-brand-orange/10 text-[#8A5200] border-brand-orange/40",
    ayuda: "La proyección al cierre queda entre el 90% y el 99% del objetivo.",
  },
  bajo_objetivo: {
    label: "Bajo objetivo", color: "#E6332A", chip: "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30",
    ayuda: "La proyección al cierre queda por debajo del 90% del objetivo.",
  },
  sin_objetivo: {
    label: "Sin objetivo", color: "#C9CDD6", chip: "bg-brand-bg text-brand-slate border-brand-border",
    ayuda: "Todavía no hay objetivo cargado para el mes.",
  },
  sin_datos: {
    label: "Sin datos", color: "#C9CDD6", chip: "bg-brand-bg text-brand-slate border-brand-border",
    ayuda: "Todavía no hay ventas del mes para proyectar.",
  },
};

export const CRUCE: Record<Cruce, { label: string; chip: string; ayuda: string; pendiente?: boolean }> = {
  exacto: { label: "Exacto", chip: "bg-emerald-50 text-emerald-800 border-emerald-200", ayuda: "Todas las palabras del nombre de llamadas están en el del vendedor." },
  probable: { label: "Probable", chip: "bg-brand-orange/10 text-[#8A5200] border-brand-orange/40", ayuda: "Coinciden el nombre y un apellido, pero falta alguna palabra o cambia la escritura. Conviene confirmarlo." },
  manual: { label: "Manual", chip: "bg-[#2A78D6]/10 text-[#1D5BA6] border-[#2A78D6]/30", ayuda: "Lo vinculó una persona." },
  descartado: { label: "No vende", chip: "bg-brand-bg text-brand-slate border-brand-border", ayuda: "Confirmado: el nombre de llamadas no es ningún vendedor." },
  solo_ventas: { label: "Solo ventas", chip: "bg-brand-bg text-brand-slate border-brand-border", ayuda: "Confirmado: vende, pero no figura en la plataforma de llamadas." },
  ambiguo: { label: "Ambiguo", chip: "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30", ayuda: "Se parece a más de un vendedor: elegí a mano.", pendiente: true },
  sin_cruce: { label: "Sin vendedor", chip: "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30", ayuda: "No se encontró un vendedor con ese nombre: vinculalo o confirmá que no vende.", pendiente: true },
  incompleto: { label: "Nombre incompleto", chip: "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30", ayuda: "El nombre de llamadas no trae nombre y apellido: vinculalo a mano.", pendiente: true },
  sin_agente: { label: "Sin llamadas", chip: "bg-brand-orange/10 text-[#8A5200] border-brand-orange/40", ayuda: "El vendedor no tiene nombre en la plataforma de llamadas: vinculalo o confirmá que solo vende.", pendiente: true },
};

// ------------------------------------------------------------------ meses y formatos
/** Mes en curso en Asunción ('2026-10'). */
export function mesActual(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

export function sumarMeses(periodo: string, n: number): string {
  const [y, m] = periodo.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1, 12);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Número con decimales solo si hacen falta: 5 → "5", 4,5 → "4,5". */
export const num = (v: number | null | undefined, dec = 1) =>
  v === null || v === undefined ? "—" : v.toLocaleString("es-PY", { maximumFractionDigits: dec });

/** '2026-10-08' → '08/10'. */
export const dm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");

/** Período de la URL (?periodo=AAAA-MM) o el mes en curso. */
export function periodoDeUrl(): string {
  if (typeof window === "undefined") return mesActual();
  const p = new URLSearchParams(window.location.search).get("periodo");
  return p && /^\d{4}-(0[1-9]|1[0-2])$/.test(p) ? p : mesActual();
}

/** Deja el período en la URL sin recargar (para compartir el enlace o volver). */
export function periodoEnUrl(periodo: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (periodo === mesActual()) url.searchParams.delete("periodo");
  else url.searchParams.set("periodo", periodo);
  window.history.replaceState(null, "", url.toString());
}

// ------------------------------------------------------------------ scoring
export type ClaveComponente =
  | "pospago" | "gpon" | "uso" | "conversacion"
  | "resultado" | "cobertura" | "foco" | "tickets" | "seguimiento";

export interface Componente {
  clave: ClaveComponente;
  nombre: string;
  peso: number;
  peso_efectivo: number;
  rel: number | null;
  puntos: number | null;
  valor: number | null;
  netas?: number | null;
  esperado?: number | null;
  evaluables?: number;
  sin_uso?: number;
  horas?: number;
  sobre_meta?: boolean;
  pendiente?: boolean;
  detalle?: string;
  con?: number;
  de?: number;
  en_plazo?: number;
  proximos?: number;
}

export interface ParametrosScoring {
  version: number;
  asesor: { pospago: number; uso: number; conversacion: number; gpon: number };
  supervisor: { resultado: number; cobertura: number; foco: number; tickets: number; seguimiento: number };
  uso_cero: number;
  min_horas_conversacion: number;
  conversacion: { rojo: number; meta_min: number; meta_max: number };
  min_cobertura?: number;
  productividad?: { dias: number; ultimo_dia: string | null; borradores: number };
  gestion_desde?: string | null;
  dias_foco?: number;
}

export interface ScoringSupervisor {
  total: number | null;
  parcial: boolean;
  resultado: number | null;
  partes: Componente[];
  componentes: Componente[];
  parametros: ParametrosScoring;
  anterior?: number | null;
}

export interface FilaTableroSupervisor extends SupervisorRef {
  asesores: number;
  total: number | null;
  parcial: boolean;
  resultado: number | null;
  partes: Componente[];
  componentes: Componente[];
  anterior: number | null;
  critico: boolean;
  asesores_en_alerta: number;
  a_recuperar: number;
}

export interface FilaTableroAsesor extends OperadorCorto {
  supervisor_id: string | null;
  supervisor: string | null;
  total: number | null;
  parcial: boolean;
  cobertura: number;
  componentes: Componente[];
  dias: number | null;
  anterior: number | null;
  alerta: boolean;
}

export interface Tablero extends Comun {
  scoring: ParametrosScoring;
  operacion: { total: number | null; componentes: Componente[]; anterior: number | null };
  supervisores: FilaTableroSupervisor[];
  asesores: FilaTableroAsesor[];
  anterior: { periodo: string; nombre_mes: string };
}

export interface ParametrosScoringCompletos extends ParametrosScoring {
  umbral_sin_uso: number;
  min_evaluables: number;
  historial: { version: number; fecha: string; por: string | null; antes: Partial<ParametrosScoring> }[];
  puede_editar: boolean;
}

// ------------------------------------------------------------------ coaching y bitácora
export type TipoCoaching = "diario" | "semanal" | "mensual";
export type MetricaCoaching = "pospago" | "gpon" | "uso" | "conversacion" | "otra";
export type ResultadoImpacto = "mejoro" | "igual" | "empeoro" | "mixto" | "sin_datos";
export type EstadoSeguimiento = "a_tiempo" | "tarde" | "vencido" | "hoy" | "proximo";
export type EstadoAlerta = "vencida" | "en_plazo" | "cubierta" | "resuelta";
export type TipoNota = "novedad" | "ausencia" | "incidencia" | "reconocimiento" | "otro";

export interface LadoImpacto {
  valor: number | null;
  desde?: string | null;
  hasta?: string | null;
  dias?: number;
  horas?: number;
  netas?: number;
  lineas?: number;
  sin_uso?: number;
  corte?: string | null;
}

export interface Impacto {
  metrica: MetricaCoaching;
  unidad?: string;
  antes?: LadoImpacto;
  despues?: LadoImpacto;
  delta: number | null;
  resultado: ResultadoImpacto;
  banda?: number;
  completo: boolean;
  detalle: string;
  edades?: [number, number] | null;
  maduras_hasta?: string | null;
  /** El impacto de cada métrica trabajada (con una sola, es la misma de arriba). */
  metricas?: Impacto[];
}

export interface Coaching {
  id: string;
  supervisor_id: string;
  supervisor: string;
  operador_id: string;
  operador: string;
  agente: string | null;
  vendedor: string | null;
  fecha: string;
  tipo: TipoCoaching;
  /** La principal: la primera de `metricas`. */
  metrica: MetricaCoaching;
  /** Las que se trabajaron (una o varias). */
  metricas: MetricaCoaching[];
  diagnostico: string;
  compromiso: string;
  seguimiento_fecha: string;
  estado: "abierto" | "cerrado" | "anulado";
  seguimiento: EstadoSeguimiento | null;
  seguimiento_at: string | null;
  seguimiento_comentario: string | null;
  resultado: ResultadoImpacto | null;
  impacto: Impacto | null;
  impacto_guardado: boolean;
  base: { score?: number | null; registrado?: string; componentes?: Partial<Componente>[] };
  fuera_de_termino: boolean;
  anterior_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  editable: boolean;
}

export interface EventoCoaching {
  id: string;
  tipo: "creado" | "editado" | "anulado" | "seguimiento" | "aclaracion";
  at: string | null;
  por: string;
  datos: Record<string, any>;
}

export interface CoachingDetalle extends Coaching {
  eventos: EventoCoaching[];
  siguientes: { id: string; fecha: string }[];
}

export interface MiembroCoaching extends OperadorCorto {
  actual: boolean;
  tramos: { desde: string; hasta: string }[];
  coachings: number;
  ultimo_coaching: string | null;
  uso: Uso | null;
  conversacion: { valor: number | null; roja: boolean; sobre_meta: boolean } | null;
  score: number | null;
  parcial: boolean;
}

export interface AlertaFoco {
  id: string;
  operador_id: string;
  operador: string;
  desde: string;
  hasta: string | null;
  vence: string;
  estado: EstadoAlerta;
  datos: { pct_sin_uso?: number | null; evaluables?: number; sin_uso?: number; a_recuperar?: number };
  coaching_id: string | null;
  coaching_fecha: string | null;
}

export interface NotaBitacora {
  id: string;
  fecha: string;
  tipo: TipoNota;
  texto: string;
  operador_id: string | null;
  operador: string | null;
  fuera_de_termino: boolean;
  created_at: string | null;
}

export interface ReglasCoaching {
  horas_edicion: number;
  dias_termino: number;
  dias_seguimiento_max: number;
  seguimiento_sugerido: Record<TipoCoaching, number>;
  min_texto: number;
  max_texto: number;
  dias_foco: number;
}

export interface VistaCoachingData extends Comun {
  hoy: string;
  /** Hasta qué día un seguimiento es «próximo» (los próximos 2 días hábiles), como en «Para hoy». */
  proximos_hasta?: string;
  supervisor: SupervisorRef;
  gestion_desde: string | null;
  scoring: ScoringSupervisor | null;
  equipo: MiembroCoaching[];
  alertas: AlertaFoco[];
  items: Coaching[];
  pendientes: Coaching[];
  notas: NotaBitacora[];
  reglas: ReglasCoaching;
  puede_registrar: boolean;
}

export interface FilaGestion extends SupervisorRef {
  asesores: number;
  total: number | null;
  partes: Componente[];
  coachings: number;
  por_metrica: Partial<Record<MetricaCoaching, number>>;
  fuera_de_termino: number;
  sin_mejora: number;
  seguimientos_abiertos: number;
  seguimientos_vencidos: number;
  alertas: Record<EstadoAlerta, number>;
  notas: number;
  ultima_actividad: string | null;
  dias_sin_actividad: number | null;
}

export interface GestionCoaching extends Comun {
  hoy: string;
  gestion_desde: string | null;
  operacion: {
    asesores: number;
    con_coaching: number;
    coachings: number;
    seguimientos_vencidos: number;
    alertas_vencidas: number;
    alertas_en_plazo: number;
  };
  supervisores: FilaGestion[];
  reglas: ReglasCoaching;
}

// ------------------------------------------------------------------ registro de coaching por rango de fechas
export interface ResultadoMetrica { metrica: MetricaCoaching; resultado: ResultadoImpacto; delta: number | null }

/** Un coaching en el registro: lo que se trabajó, la devolución y el resultado por métrica (el detalle se abre aparte). */
export interface CoachingRegistro extends Omit<Coaching, "base" | "impacto"> {
  resultados: ResultadoMetrica[];
}

export type FiltroSeguimiento = "pendientes" | "proximos" | "vencidos" | "a_tiempo" | "tarde";
export type FiltroResultado = "mejoro" | "igual" | "empeoro" | "mixto" | "sin_datos" | "sin_mejora";

export interface KpisRegistro {
  coachings: number;
  anulados: number;
  asesores: number;
  supervisores: number;
  fuera_de_termino: number;
  por_tipo: Partial<Record<TipoCoaching, number>>;
  seguimientos: Record<EstadoSeguimiento, number>;
  pct_a_tiempo: number | null;
  proximos: number;
  cerrados: number;
  resultados: Record<ResultadoImpacto, number>;
  pct_mejora: number | null;
}

export interface MetricaRegistro {
  metrica: MetricaCoaching;
  coachings: number;
  cerrados: number;
  mejoro: number;
  igual: number;
  empeoro: number;
  sin_datos: number;
  pct_mejora: number | null;
}

export interface SupervisorRegistro {
  id: string;
  nombre: string;
  coachings: number;
  asesores: number;
  a_tiempo: number;
  tarde: number;
  vencido: number;
  pendientes: number;
  proximos: number;
  cerrados: number;
  mejoro: number;
  con_datos: number;
  pct_a_tiempo: number | null;
  pct_mejora: number | null;
  ultimo: string;
}

export interface AsesorRegistro {
  id: string;
  nombre: string;
  supervisores: string[];
  coachings: number;
  metricas: Partial<Record<MetricaCoaching, number>>;
  pendientes: number;
  vencido: number;
  cerrados: number;
  mejoro: number;
  sin_mejora: number;
  ultimo: string;
}

export interface RegistroCoaching {
  desde: string;
  hasta: string;
  hoy: string;
  proximos_hasta: string;
  kpis: KpisRegistro;
  por_metrica: MetricaRegistro[];
  por_supervisor: SupervisorRegistro[];
  por_asesor: AsesorRegistro[];
  items: CoachingRegistro[];
  total_items: number;
  truncado: boolean;
  opciones: { supervisores: { id: string; nombre: string }[]; asesores: { id: string; nombre: string }[] };
}

const VERDE = "bg-emerald-50 text-emerald-800 border-emerald-200";
const NARANJA = "bg-brand-orange/10 text-[#8A5200] border-brand-orange/40";
const ROJO = "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30";
const GRIS = "bg-brand-bg text-brand-slate border-brand-border";
const AZUL = "bg-[#2A78D6]/10 text-[#1D5BA6] border-[#2A78D6]/30";

export const METRICA: Record<MetricaCoaching, { label: string; ayuda: string }> = {
  pospago: { label: "Pospago", ayuda: "Netas Pospago por hora conectada, 5 días antes y 5 después" },
  gpon: { label: "GPON", ayuda: "Netas GPON por hora conectada, 5 días antes y 5 después" },
  uso: { label: "Uso de líneas", ayuda: "% sin uso de las vendidas después contra las de antes, con la misma antigüedad" },
  conversacion: { label: "Conversación", ayuda: "% de conversación de 5 días con conexión antes y 5 después" },
  otra: { label: "Otra", ayuda: "Sin medición automática: vale el comentario del seguimiento" },
};

/** En el orden en que se guardan (la primera es la principal). */
export const METRICAS_ORDEN: MetricaCoaching[] = ["pospago", "gpon", "uso", "conversacion", "otra"];

/** «Pospago + GPON»: las métricas de un coaching (los anteriores a poder elegir varias tienen solo `metrica`). */
export function nombreMetricas(c: { metrica: MetricaCoaching; metricas?: MetricaCoaching[] | null } | MetricaCoaching[]): string {
  const ms = Array.isArray(c) ? c : c.metricas?.length ? c.metricas : [c.metrica];
  return ms.map((m) => METRICA[m]?.label ?? m).join(" + ");
}

/** Las métricas de un coaching (con los anteriores, la única que tenían). */
export const metricasDe = (c: { metrica: MetricaCoaching; metricas?: MetricaCoaching[] | null }): MetricaCoaching[] =>
  c.metricas?.length ? c.metricas : [c.metrica];

export const TIPO_COACHING: Record<TipoCoaching, { label: string; ayuda: string }> = {
  diario: { label: "Diario en puesto", ayuda: "Corregir en el momento una práctica observada en una llamada · 5 a 10 min" },
  semanal: { label: "Semanal uno a uno", ayuda: "Revisar los datos de la semana y acordar un compromiso · 20 a 30 min" },
  mensual: { label: "Mensual de resultados", ayuda: "Cerrar el mes contra el objetivo y planear el siguiente · 30 a 45 min" },
};

export const RESULTADO: Record<ResultadoImpacto, { label: string; chip: string }> = {
  mejoro: { label: "Mejoró", chip: VERDE },
  igual: { label: "Igual", chip: GRIS },
  empeoro: { label: "Empeoró", chip: ROJO },
  mixto: { label: "Mixto", chip: NARANJA },
  sin_datos: { label: "Sin datos", chip: GRIS },
};

export const SEGUIMIENTO: Record<EstadoSeguimiento, { label: string; corto: string; chip: string; ayuda: string }> = {
  a_tiempo: { label: "Seguimiento a tiempo", corto: "A tiempo", chip: VERDE, ayuda: "Registrado en la fecha acordada o al día siguiente" },
  tarde: { label: "Seguimiento tarde", corto: "Tarde", chip: NARANJA, ayuda: "Registrado después del día siguiente a la fecha acordada" },
  vencido: { label: "Seguimiento vencido", corto: "Vencido", chip: ROJO, ayuda: "Pasó la fecha acordada (y el día siguiente) sin seguimiento" },
  hoy: { label: "Seguimiento hoy", corto: "Hoy", chip: AZUL, ayuda: "La fecha acordada es hoy (o fue ayer): todavía está a tiempo" },
  proximo: { label: "Seguimiento pendiente", corto: "Pendiente", chip: GRIS, ayuda: "Todavía no llegó la fecha acordada" },
};

export const ALERTA: Record<EstadoAlerta, { label: string; chip: string; ayuda: string }> = {
  vencida: { label: "Sin coaching a tiempo", chip: ROJO, ayuda: "Pasaron los 5 días hábiles sin coaching sobre uso de líneas" },
  en_plazo: { label: "En plazo", chip: NARANJA, ayuda: "Todavía hay tiempo para el coaching sobre uso de líneas" },
  cubierta: { label: "Con coaching", chip: VERDE, ayuda: "Tuvo coaching sobre uso de líneas dentro del plazo" },
  resuelta: { label: "Se resolvió", chip: GRIS, ayuda: "Dejó de estar en alerta antes del plazo: no cuenta para el foco" },
};

export const TIPO_NOTA: Record<TipoNota, { label: string; chip: string }> = {
  novedad: { label: "Novedad", chip: AZUL },
  ausencia: { label: "Ausencia", chip: NARANJA },
  incidencia: { label: "Incidencia", chip: ROJO },
  reconocimiento: { label: "Reconocimiento", chip: VERDE },
  otro: { label: "Otro", chip: GRIS },
};

/** Fecha y hora de un registro en la hora de la operación (Asunción), como la usa el servidor para sus reglas. */
export function fechaHoraPy(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-PY", {
    timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Fecha y hora corta, 24 h, en la hora de la operación: «vie 09/10 19:00». */
export function fechaHoraCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const partes = new Intl.DateTimeFormat("es-PY", {
    timeZone: "America/Asuncion", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const v = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  return `${v("weekday").replace(".", "")} ${v("day")}/${v("month")} ${v("hour")}:${v("minute")}`;
}

/** Fecha 'AAAA-MM-DD' más n días (sin zona horaria). */
export function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Días entre dos fechas 'AAAA-MM-DD' (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000);
}

// ------------------------------------------------------------------ tickets de revisión
export type EstadoTicket = "nuevo" | "en_gestion" | "esperando" | "resuelto" | "cerrado";
export type SituacionSla = "en_plazo" | "por_vencer" | "vencido" | "pausado" | "cumplido" | "fuera_de_plazo" | "cerrado";
export type PrioridadTicket = "alta" | "media" | "baja";
export type TipoTicket = "venta_observada" | "linea_sin_uso" | "calidad" | "reclamo" | "conducta" | "otro";
export type AccionTicket = "responder" | "pedir_datos" | "resolver" | "comentar" | "reabrir" | "cancelar" | "reasignar";

export interface PlazoSla { min: number; plazo: number; pct: number; cumplio: boolean | null; vence: string | null; corre?: boolean }
export interface SlaTicket { situacion: SituacionSla; cumple: boolean | null; respuesta: PlazoSla; resolucion: PlazoSla }

export interface Ticket {
  id: string;
  numero: number;
  tipo: TipoTicket;
  tipo_nombre: string;
  prioridad: PrioridadTicket;
  estado: EstadoTicket;
  supervisor_id: string;
  supervisor: string;
  operador_id: string | null;
  operador: string | null;
  fecha_caso: string | null;
  referencia: string | null;
  descripcion: string;
  creado_por: string;
  creado_por_nombre: string;
  created_at: string | null;
  respuesta_at: string | null;
  resuelto_at: string | null;
  cerrado_at: string | null;
  motivo_cierre: "cancelado" | "sin_respuesta" | null;
  reaperturas: number;
  sla: SlaTicket;
  edad_min: number | null;
}

export interface EventoTicket {
  id: string;
  tipo: "creado" | "respuesta" | "comentario" | "pedido_datos" | "datos" | "resuelto" | "reabierto" | "reasignado" | "cancelado" | "cerrado_auto";
  at: string | null;
  por: string;
  texto: string | null;
  datos: Record<string, any>;
}

export interface InfoTickets {
  dia_completo: number;
  plazos: Record<PrioridadTicket, { respuesta: number; resolucion: number }>;
  plazos_texto: Record<PrioridadTicket, { respuesta: string; resolucion: string }>;
  por_vencer: number;
  dias_espera: number;
  dias_reabrir: number;
  tipos: Record<TipoTicket, string>;
  horario: HorarioAtencion | null;
}

export interface TicketDetalle extends Ticket {
  eventos: EventoTicket[];
  acciones: AccionTicket[];
  info: InfoTickets;
}

export interface MetricasTickets {
  total: number;
  abiertos: number;
  nuevos: number;
  esperando: number;
  por_vencer: number;
  vencidos: number;
  resueltos: number;
  cerrados: number;
  en_plazo: number;
  evaluados: number;
  cumplimiento: number | null;
  respuesta: { mediana: number | null; p90: number | null; n: number };
  resolucion: { mediana: number | null; p90: number | null; n: number };
  reaperturas: number;
  reabiertos: number;
  mas_antiguo_min: number | null;
}

export interface FilaTicketsSupervisor extends SupervisorRef {
  mes: MetricasTickets;
  bandeja: Pick<MetricasTickets, "abiertos" | "nuevos" | "esperando" | "por_vencer" | "vencidos" | "mas_antiguo_min">;
}

export interface BandejaTickets {
  periodo: string;
  nombre_mes: string;
  hoy: string;
  vista: "abiertos" | "mes";
  items: Ticket[];
  mes: MetricasTickets;
  bandeja: MetricasTickets;
  supervisores: FilaTicketsSupervisor[];
  info: InfoTickets;
  puede_enviar: boolean;
}

export interface PortalTickets {
  periodo: string;
  nombre_mes: string;
  hoy: string;
  items: Ticket[];
  mes: MetricasTickets;
  bandeja: MetricasTickets;
  info: InfoTickets;
}

export interface OpcionesTicket {
  asesores: { id: string; nombre: string; agente: string | null; vendedor: string | null; supervisor_id: string | null; supervisor: string | null }[];
  supervisores: SupervisorRef[];
  hoy: string;
}

export const ESTADO_TICKET: Record<EstadoTicket, { label: string; chip: string }> = {
  nuevo: { label: "Nuevo", chip: AZUL },
  en_gestion: { label: "En gestión", chip: "bg-brand-cyan/10 text-[#00727A] border-brand-cyan/30" },
  esperando: { label: "Esperando datos", chip: GRIS },
  resuelto: { label: "Resuelto", chip: VERDE },
  cerrado: { label: "Cerrado", chip: GRIS },
};

export const SITUACION: Record<SituacionSla, { label: string; chip: string; ayuda: string }> = {
  en_plazo: { label: "En plazo", chip: GRIS, ayuda: "Todavía dentro de sus plazos" },
  por_vencer: { label: "Por vencer", chip: NARANJA, ayuda: "Ya usó el 75% o más de su plazo" },
  vencido: { label: "Vencido", chip: ROJO, ayuda: "Se pasó del plazo de primera respuesta o de resolución" },
  pausado: { label: "Pausado", chip: AZUL, ayuda: "Espera datos de quien lo envió: el reloj está detenido" },
  cumplido: { label: "Resuelto en plazo", chip: VERDE, ayuda: "Respondido y resuelto dentro de sus plazos" },
  fuera_de_plazo: { label: "Resuelto fuera de plazo", chip: NARANJA, ayuda: "Se resolvió, pero pasado algún plazo" },
  cerrado: { label: "Sin medir", chip: GRIS, ayuda: "Cancelado o cerrado sin los datos pedidos: no cuenta para el plazo" },
};

export const PRIORIDAD: Record<PrioridadTicket, { label: string; chip: string }> = {
  alta: { label: "Alta", chip: "bg-brand-ink text-white border-brand-ink" },
  media: { label: "Media", chip: "bg-white text-brand-ink border-brand-slate/60" },
  baja: { label: "Baja", chip: GRIS },
};

/** Minutos hábiles en palabras: «45 min», «2 h 30 min», «1 día hábil y 3 h» (un día = la jornada completa). */
export function duracionHabil(min: number | null | undefined, diaCompleto: number): string {
  if (min === null || min === undefined) return "—";
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  if (m < diaCompleto) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }
  const d = Math.floor(m / diaCompleto);
  const h = Math.round((m - d * diaCompleto) / 60);
  return `${d} ${d === 1 ? "día hábil" : "días hábiles"}${h ? ` y ${h} h` : ""}`;
}

/** Plazo de la guía en palabras: '2h' → «2 h», '1d' → «1 día hábil». */
export function plazoTexto(p: string): string {
  const n = Number(p.slice(0, -1));
  return p.endsWith("d") ? `${n} ${n === 1 ? "día hábil" : "días hábiles"}` : `${n} ${n === 1 ? "hora hábil" : "horas hábiles"}`;
}

// ------------------------------------------------------------------ centro de comandos
export type EstadoSemaforo = "atencion" | "revisar" | "al_dia";
export type TipoAlertaComando =
  | "ticket_vencido" | "supervisor_critico" | "proyeccion_bajo" | "seguimiento_vencido" | "asesor_alerta" | "sin_actividad"
  | "sin_supervisor" | "sin_vincular";
export type EstadoAlertaComando = "abierta" | "tomada" | "derivada" | "descartada" | "cerrada";

export interface FilaSemaforo extends SupervisorRef {
  estado: EstadoSemaforo;
  motivos: string[];
  motivos_rojo: number;
  score: number | null;
  parcial: boolean;
  anterior: number | null;
  pospago: Proyeccion;
  gpon: Proyeccion;
  asesores: number;
  asesores_en_alerta: number;
  a_recuperar: number;
  cobertura: Componente | null;
  tickets: { abiertos: number; vencidos: number; por_vencer: number };
  seguimientos_vencidos: number;
  ultima_gestion: string | null;
  dias_sin_gestion: number | null;
}

export interface AlertaComando {
  id: string;
  tipo: TipoAlertaComando;
  tipo_nombre: string;
  severidad: 0 | 1 | 2;
  estado: EstadoAlertaComando;
  titulo: string;
  detalle: string;
  datos: { ticket_id?: string; numero?: number; coaching_id?: string; producto?: string; cantidad?: number; [k: string]: any };
  supervisor_id: string | null;
  supervisor: string | null;
  operador_id: string | null;
  operador: string | null;
  desde: string;
  /** Empieza con el día (una alerta de uso, un seguimiento vencido), no a una hora. */
  desde_dia: boolean;
  nueva: boolean;
  hasta: string | null;
  tomada_por: string | null;
  tomada_at: string | null;
  nota: string | null;
  nota_at: string | null;
  nota_por: string | null;
  ticket_id: string | null;
  ticket_numero: number | null;
  descartada_por: string | null;
  descartada_motivo: string | null;
  puede_revision: boolean;
}

export interface CabeceraComando {
  score: number | null;
  score_parcial: boolean;
  score_anterior: number | null;
  pospago: Proyeccion;
  gpon: Proyeccion;
  uso: { pct_sin_uso: number | null; evaluables: number; sin_uso: number; umbral: number };
  supervisores_criticos: number;
  supervisores: number;
  asesores_en_alerta: number;
  a_recuperar: number;
  tickets: { abiertos: number; vencidos: number; por_vencer: number };
  cobertura: { con: number; de: number };
}

export interface CentroComandos extends Comun {
  hoy: string;
  actualizado: string;
  cabecera: CabeceraComando;
  supervisores: FilaSemaforo[];
  alertas: AlertaComando[];
  resumen_alertas: { abiertas: number; tomadas: number; derivadas: number; descartadas: number; cerradas: number; nuevas: number };
  reglas: { dias_sin_gestion: number; dias_foco: number; umbral_sin_uso: number; semaforo_en_riesgo: number; semaforo_en_camino: number };
  gestion_desde: string | null;
  pendientes_vincular: number;
  puede_actuar: boolean;
  puede_derivar: boolean;
  tipos_ticket: Record<TipoTicket, string>;
  tipo_revision: Record<TipoAlertaComando, TipoTicket | null>;
  plazos: Record<PrioridadTicket, { respuesta: string; resolucion: string }>;
}

export type GrupoEvento = "coaching" | "seguimiento" | "nota" | "ticket" | "equipo" | "objetivo" | "alerta";

export interface EventoLinea {
  at: string | null;
  grupo: GrupoEvento;
  titulo: string;
  detalle: string | null;
  por: string | null;
  coaching_id?: string;
  ticket_id?: string;
  operador_id?: string;
  /** Empieza con el día, sin hora. */
  dia?: boolean;
}

export interface LineaTiempo {
  periodo: string;
  nombre_mes: string;
  hoy: string;
  supervisor: SupervisorRef;
  eventos: EventoLinea[];
  grupos: Partial<Record<GrupoEvento, number>>;
}

export interface AlertaUsoAsesor {
  id: string;
  desde: string;
  hasta: string | null;
  vence: string;
  estado: EstadoAlerta;
  datos: AlertaFoco["datos"];
  coaching_id: string | null;
}

export interface FichaAsesor extends Comun {
  hoy: string;
  asesor: OperadorCorto & { legajo: string | null; ultima_vez: string | null };
  supervisor: { id: string; nombre: string } | null;
  tramos: TramoEquipo[];
  scoring: {
    total: number | null; parcial: boolean; componentes: Componente[]; dias: number | null; cobertura: number;
    anterior: number | null; parametros: ParametrosScoring;
  } | null;
  netas: { pospago: number; gpon: number } | null;
  uso: Uso | null;
  coachings: Coaching[];
  tickets: Ticket[];
  alertas_uso: AlertaUsoAsesor[];
  notas: (NotaBitacora & { supervisor: string })[];
  dia_completo: number;
  puede_enviar: boolean;
}

export const SEMAFORO: Record<EstadoSemaforo, { label: string; color: string; chip: string; ayuda: string }> = {
  atencion: {
    label: "Atención", color: "#E6332A", chip: ROJO,
    ayuda: "Algo vencido o fuera de objetivo, o sin registrar gestión hace 3 días hábiles o más",
  },
  revisar: { label: "Revisar", color: "#F39200", chip: NARANJA, ayuda: "En crítico, en riesgo o con plazos por vencer: todavía a tiempo" },
  al_dia: { label: "Al día", color: "#059669", chip: VERDE, ayuda: "Sin vencidos, sin crítico y con gestión reciente" },
};

export const ESTADO_ALERTA_COMANDO: Record<EstadoAlertaComando, { label: string; chip: string; ayuda: string }> = {
  abierta: { label: "Sin tomar", chip: "bg-white text-brand-ink border-brand-slate/50", ayuda: "Nadie la tomó todavía" },
  tomada: { label: "Tomada", chip: AZUL, ayuda: "Alguien la está atendiendo" },
  derivada: { label: "Revisión pedida", chip: "bg-brand-cyan/10 text-[#00727A] border-brand-cyan/30", ayuda: "Se pidió una revisión: se sigue en el ticket" },
  descartada: { label: "Descartada", chip: GRIS, ayuda: "No requiere acción: quedó el motivo" },
  cerrada: { label: "Resuelta", chip: VERDE, ayuda: "La condición dejó de cumplirse" },
};

export const GRUPO_EVENTO: Record<GrupoEvento, { label: string; color: string }> = {
  coaching: { label: "Coaching", color: "#00B2BF" },
  seguimiento: { label: "Seguimientos", color: "#059669" },
  ticket: { label: "Tickets", color: "#2A78D6" },
  nota: { label: "Notas", color: "#662483" },
  equipo: { label: "Equipo", color: "#5B6275" },
  objetivo: { label: "Objetivos", color: "#0F1116" },
  alerta: { label: "Alertas", color: "#E6332A" },
};

/** «hace 3,5 días hábiles», «hoy» (desde la última gestión registrada). */
export function haceDiasHabiles(d: number | null | undefined): string {
  if (d === null || d === undefined) return "sin registros";
  if (d === 0) return "hoy";
  return `hace ${num(d)} ${d === 1 ? "día hábil" : "días hábiles"}`;
}
