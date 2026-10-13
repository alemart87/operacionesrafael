export const INT_API = "/api/v1/televentas-claro/integraciones";

export interface DatasetInfo {
  nombre: string;
  modulo: string;
  titulo: string;
  descripcion: string;
  fecha: string;
}

export interface Clave {
  id: string;
  nombre: string;
  prefijo: string;
  owner_id: string;
  owner: string;
  created_at: string | null;
  expira_at: string | null;
  vencida: boolean;
  estado: "activa" | "bloqueada";
  bloqueada_at: string | null;
  motivo_bloqueo: string | null;
  limite_minuto: number;
  limite_dia: number;
  datasets: string[];
  ultimo_uso_at: string | null;
  ultimo_ip: string | null;
  usos: number;
  usos_hoy: number;
  rechazos_hoy: number;
}

export interface Uso {
  id: string;
  clave_id: string;
  clave: string;
  prefijo: string;
  at: string | null;
  dataset: string | null;
  ruta: string;
  ip: string | null;
  user_agent: string | null;
  status: number;
  resultado: "ok" | "limite" | "denegada" | "error";
  filas: number;
  ms: number;
  detalle: string | null;
}

export interface ListaClaves {
  items: Clave[];
  superadmin: boolean;
  datasets: DatasetInfo[];
  limites_max: { minuto: number; dia: number; vigencia_dias: number };
}

export const RESULTADO: Record<Uso["resultado"], { label: string; clase: string }> = {
  ok: { label: "OK", clase: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  limite: { label: "Límite", clase: "bg-brand-orange/10 text-brand-orange border-brand-orange/40" },
  denegada: { label: "Denegada", clase: "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30" },
  error: { label: "Error", clase: "bg-brand-bg text-brand-graphite border-brand-border" },
};

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** La URL completa de un dataset, como se pega en KNIME. */
export function urlDataset(nombre: string, extra = ""): string {
  const origen = typeof window === "undefined" ? "" : window.location.origin;
  return `${origen}${INT_API}/datasets/${nombre}${extra}`;
}
