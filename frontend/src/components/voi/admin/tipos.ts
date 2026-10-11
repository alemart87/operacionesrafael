export interface ConfigVoi {
  habilitado: boolean;
  topes: { mensual_usd: number; alerta_pct: number; conversacion_usd: number; usuario_dia_usd: number; mensajes_minuto: number };
  retencion: { sesion_dias: number; copia_meses: number };
  autonomia: { borradores_sin_confirmar: boolean };
  modelo?: { esfuerzo: EsfuerzoVoi };
}

export type EsfuerzoVoi = "low" | "medium" | "high";
export const ESFUERZOS: { k: EsfuerzoVoi; nombre: string; detalle: string }[] = [
  { k: "low", nombre: "Rápido", detalle: "Respuestas ágiles para consultas simples. El más económico." },
  { k: "medium", nombre: "Equilibrado", detalle: "Piensa lo necesario para analizar y explicar. Recomendado." },
  { k: "high", nombre: "Profundo", detalle: "Análisis más cuidadosos (facturación, auditorías). Más lento y más costoso." },
];

export interface EstadoAdminVoi {
  clave: boolean;
  simulador: boolean;
  conectado: boolean;
  webhook: boolean;
  modelo: { id: string; effort?: string };
  publicado: boolean;
  desactualizado: boolean;
  agente: { id: string; version: number | null; modelo?: string; publicado_at?: string; publicado_por?: string } | null;
  entorno: { id: string } | null;
  habilidades: { nombre: string; titulo: string; descripcion: string; version: string | number | null; al_dia: boolean; permisos: string[]; auditor: boolean }[];
  herramientas: { nombre: string; etiqueta: string; nivel: number; permisos: string[]; modos: string[] }[];
  config: ConfigVoi;
  gasto_mes_usd: number;
  tope_mes_usd: number;
  alerta_consumo: boolean;
  consumidores_activos: number;
}

export interface ConsumoVoi {
  desde: string;
  hasta: string;
  conversaciones: number;
  totales: {
    mensajes?: number; herramientas?: number; acciones?: number; input_tokens?: number; output_tokens?: number;
    cache_lectura?: number; cache_escritura?: number; costo_usd: number; usuarios: number;
  };
  por_dia: { fecha: string; costo_usd: number; mensajes: number; herramientas: number; acciones: number; usuarios: number }[];
  por_usuario: { user_id: string; nombre: string; perfil: string; perfil_nombre: string; costo_usd: number; mensajes: number; herramientas: number; acciones: number; dias: number }[];
  por_perfil: { perfil: string; perfil_nombre: string; costo_usd: number; mensajes: number; usuarios: number }[];
  por_herramienta: { nombre: string; etiqueta: string; nivel: number | null; usos: number; errores: number; canceladas: number }[];
}

export interface ConversacionAdminVoi {
  id: string;
  titulo: string;
  estado: string;
  mensajes: number;
  user_id: string;
  user_nombre: string;
  perfil: string;
  perfil_nombre: string;
  oculta: boolean;
  costo_usd: number;
  tope_usd: number | null;
  modo: string | null;
  consultas: number;
  acciones: number;
  created_at: string | null;
  ultima_actividad: string | null;
  agente_version: number | null;
  error: string | null;
}

export const usd = (v: number | null | undefined, dec = 2) =>
  `US$ ${(v ?? 0).toLocaleString("es-PY", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
export const num = (v: number | null | undefined) => (v ?? 0).toLocaleString("es-PY");
export const NIVEL = { 1: "Consulta", 2: "Lo propio", 3: "Con confirmación" } as Record<number, string>;
export const ESTADO_CONV: Record<string, string> = {
  idle: "Libre", running: "Trabajando", requires_action: "Espera confirmación", budget_reached: "Llegó al tope",
  terminated: "Terminada", creando: "Creando", error: "Error", borrada: "Borrada",
};
