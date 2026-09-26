"use client";

import type { ReactNode } from "react";

// ------------------------------------------------------------------ tipos de la API /seguridad
export interface Franjas { [dia: string]: [string, string][] }
export interface PerfilHorario { activo: boolean; dias: Franjas }

export interface ConfigSeguridad {
  sesion: { access_minutos: number; inactividad_minutos: number; duracion_max_horas: number };
  bloqueo: { max_intentos: number; ventana_minutos: number; bloqueo_minutos: number };
  contrasenas: {
    min_largo: number; mayus_minus: boolean; numero: boolean; simbolo: boolean;
    vencimiento_dias: number; historial: number; cambio_primer_ingreso: boolean;
  };
  dos_factores: { recomendado: boolean };
  horarios: {
    modo: "desactivado" | "registrar" | "bloquear"; zona: string; aviso_minutos: number;
    feriados: string[]; perfiles: Record<string, PerfilHorario>;
  };
}

export interface RespuestaConfig {
  config: ConfigSeguridad;
  perfiles: string[];
  dias: string[];
  modos: string[];
  ahora: Record<string, { permitido: boolean; hasta: string | null; motivo: string | null }>;
  superadmin_2fa: boolean;
  actualizado: { en: string | null; por: string | null };
}

export interface Sesion {
  id: string; user_id: string; email: string; nombre: string; role: string;
  ip: string | null; user_agent: string | null; segundo_factor: boolean;
  inicio: string | null; ultima_actividad: string | null; vence: string | null;
  inactiva_minutos: number; fin: string | null; motivo_fin: string | null; es_la_mia: boolean;
}

export interface EstadoUsuario {
  id: string; email: string; nombre: string; role: string; activo: boolean;
  ultimo_ingreso: string | null; sesiones_activas: number;
  bloqueado_hasta: string | null; bloqueo_manual: boolean; intentos_fallidos: number;
  dos_factores: boolean; contrasena_cambiada: string | null; contrasena_vence: string | null;
  contrasena_vencida: boolean; cambio_pendiente: boolean;
  excepcion_hasta: string | null; excepcion_nota: string | null; horario_ahora: boolean;
}

// ------------------------------------------------------------------ formato
export function fechaCorta(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString("es-PY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function fechaDia(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function hace(s: string | null | undefined): string {
  if (!s) return "—";
  const min = Math.max(0, Math.round((Date.now() - Date.parse(s)) / 60000));
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h ${min % 60 ? `${min % 60} min` : ""}`.trim();
  return `hace ${Math.floor(h / 24)} d`;
}

/** Navegador y sistema a partir del user-agent (solo para mostrar). */
export function dispositivo(ua: string | null): string {
  if (!ua) return "Desconocido";
  const nav = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const so = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return so ? `${nav} · ${so}` : nav;
}

export const MOTIVOS_FIN: Record<string, string> = {
  logout: "Salió",
  cerrada: "Cerrada por el superadmin",
  inactividad: "Inactividad",
  vencida: "Venció",
  horario: "Fuera de horario",
  usuario_inactivo: "Usuario desactivado",
};

// ------------------------------------------------------------------ piezas de UI
export function Seccion({ icono, titulo, descripcion, children, accion }: {
  icono: ReactNode; titulo: string; descripcion?: ReactNode; children: ReactNode; accion?: ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-brand-border bg-brand-bg-soft">
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-0.5 grid place-items-center w-9 h-9 rounded-md bg-brand-primary-light text-brand-primary shrink-0">{icono}</span>
          <div className="min-w-0">
            <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">{titulo}</h2>
            {descripcion && <p className="text-xs text-brand-slate mt-0.5">{descripcion}</p>}
          </div>
        </div>
        {accion}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function CampoNumero({ label, ayuda, valor, onChange, min, max, sufijo }: {
  label: string; ayuda?: ReactNode; valor: number; onChange: (v: number) => void; min: number; max: number; sufijo?: string;
}) {
  const fuera = !Number.isInteger(valor) || valor < min || valor > max;
  return (
    <div>
      <label className="label">{label}</label>
      <div className={`flex items-stretch rounded-md border bg-white focus-within:border-brand-primary focus-within:shadow-focus ${fuera ? "border-brand-primary" : "border-brand-border"}`}>
        <input
          type="number" inputMode="numeric" min={min} max={max}
          className="w-full min-w-0 px-3.5 py-2.5 text-sm bg-transparent focus:outline-none"
          value={Number.isNaN(valor) ? "" : valor}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        />
        {sufijo && <span className="px-3 grid place-items-center text-xs text-brand-slate border-l border-brand-border bg-brand-bg-soft rounded-r-md whitespace-nowrap">{sufijo}</span>}
      </div>
      <p className={`text-[11px] mt-1 ${fuera ? "text-brand-primary-dark" : "text-brand-mist"}`}>
        {fuera ? `Entre ${min} y ${max}.` : ayuda}
      </p>
    </div>
  );
}

export function Interruptor({ label, ayuda, valor, onChange }: {
  label: string; ayuda?: ReactNode; valor: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none py-1">
      <button
        type="button" role="switch" aria-checked={valor} onClick={() => onChange(!valor)}
        className={`mt-0.5 relative w-10 h-6 rounded-full transition-colors shrink-0 ${valor ? "bg-brand-primary" : "bg-brand-border"}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${valor ? "translate-x-4" : ""}`} />
      </button>
      <span>
        <span className="block text-sm font-semibold text-brand-ink">{label}</span>
        {ayuda && <span className="block text-[11px] text-brand-slate">{ayuda}</span>}
      </span>
    </label>
  );
}

export function Aviso({ tipo, children }: { tipo: "ok" | "error" | "info"; children: ReactNode }) {
  const cls = tipo === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : tipo === "error" ? "border-brand-primary/30 bg-brand-primary-light text-brand-primary-dark"
    : "border-brand-cyan/30 bg-brand-cyan/5 text-brand-graphite";
  return <div className={`rounded-md border px-4 py-2.5 text-sm ${cls}`}>{children}</div>;
}

export function BotonIcono({ titulo, onClick, children, peligro, disabled }: {
  titulo: string; onClick: () => void; children: ReactNode; peligro?: boolean; disabled?: boolean;
}) {
  return (
    <button
      type="button" title={titulo} aria-label={titulo} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        peligro
          ? "border-brand-primary/40 text-brand-primary hover:bg-brand-primary hover:text-white"
          : "border-brand-border text-brand-graphite hover:border-brand-primary hover:text-brand-primary"
      }`}
    >
      {children}
    </button>
  );
}
