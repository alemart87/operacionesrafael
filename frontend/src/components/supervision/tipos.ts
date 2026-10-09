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

export interface ParametrosCompletos extends ParametrosSup {
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
