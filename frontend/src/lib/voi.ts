"use client";

/**
 * Voi, el agente de la plataforma: tipos, pedidos a la API y la escucha en vivo de una conversación.
 * El backend (app/asistente) corre el agente en Claude Managed Agents con los permisos del usuario.
 */
import { apiFetch, getToken, refreshSession } from "./api";
import type { ArtefactoVoi } from "@/components/voi/lienzo/tipos";

export const VOI_API = "/api/v1/asistente";

export type ModoVoi = "superadmin" | "gestion" | "auditor";

export interface EstadoVoi {
  nombre: string;
  disponible: boolean;
  motivo: string | null;
  modo: ModoVoi;
  simulador: boolean;
  superadmin: boolean;
  herramientas: { nombre: string; etiqueta: string; nivel: number }[];
  sugerencias: string[];
  privacidad: string;
  confirma_borradores: boolean;
}

export interface ConversacionVoi {
  id: string;
  titulo: string;
  tipo: string;
  fijada: boolean;
  estado: string;
  stop_reason: string | null;
  mensajes: number;
  created_at: string | null;
  ultima_actividad: string | null;
  disponible: boolean;
}

export interface AccionVoi {
  id: string;
  evento_id: string;
  herramienta: string;
  etiqueta: string;
  nivel: number;
  resumen: string;
  estado: "pendiente" | "ejecutando" | "ejecutada" | "cancelada" | "fallida";
  pantalla: string | null;
  mensaje: string | null;
  created_at: string | null;
  resuelta_at: string | null;
}

export type ItemVoi =
  | { tipo: "usuario"; id: string; texto: string; at?: string | null; pendiente?: boolean; error?: string | null }
  | { tipo: "voi"; id: string; texto: string; at?: string | null }
  | { tipo: "paso"; id: string; herramienta?: string | null; etiqueta?: string | null; estado: "corriendo" | "ok" | "error"; detalle?: string | null; at?: string | null; entrada?: unknown; resultado?: string }
  | { tipo: "accion"; id: string; accion: AccionVoi; at?: string | null }
  | { tipo: "aviso"; id: string; texto: string; nivel?: "info" | "alerta" | "error"; at?: string | null }
  | { tipo: "lienzo"; id: string; artefacto: ArtefactoVoi; at?: string | null; entrada?: unknown; resultado?: string }
  | { tipo: "contexto"; id: string; texto: string; at?: string | null }
  | { tipo: "pensando"; id: string; at?: string | null };

export interface TranscripcionVoi {
  conversacion: ConversacionVoi;
  items: ItemVoi[];
  pendientes: AccionVoi[];
  artefactos?: ArtefactoVoi[];
}

/** Lo que llega en vivo por la conversación (ver app/asistente/consumidor.py). */
export type EventoVoi =
  | ({ tipo: "transcripcion" } & TranscripcionVoi)
  | { tipo: "usuario"; id: string; texto: string }
  | { tipo: "mensaje"; id: string; texto: string }
  | { tipo: "escribiendo"; id: string }
  | { tipo: "parcial"; id: string; texto: string }
  | { tipo: "fin_parcial" }
  | { tipo: "pensando" }
  | { tipo: "paso"; id: string; herramienta?: string; etiqueta?: string; estado: "corriendo" | "ok" | "error"; detalle?: string | null }
  | { tipo: "accion"; accion: AccionVoi }
  | { tipo: "lienzo"; artefacto: ArtefactoVoi }
  | { tipo: "estado"; estado: string; motivo?: string; aviso?: string | null }
  | { tipo: "error"; mensaje: string; reintenta?: boolean }
  | { tipo: "aviso"; texto: string }
  | { tipo: "uso"; costo_usd: number; input_tokens: number; output_tokens: number }
  | { tipo: "reconectar" };

export interface MemoriaVoi {
  id: string;
  ruta: string;
  contenido: string;
  actualizada: string | null;
}

export interface Pantalla {
  ruta: string;
  titulo?: string | null;
}

export const voiApi = {
  estado: () => apiFetch<EstadoVoi>(`${VOI_API}/estado`),
  conversaciones: () => apiFetch<{ items: ConversacionVoi[] }>(`${VOI_API}/conversaciones`),
  nueva: (texto: string, pantalla: Pantalla | null) =>
    apiFetch<ConversacionVoi>(`${VOI_API}/conversaciones`, { method: "POST", body: JSON.stringify({ texto, pantalla }) }),
  enviar: (id: string, texto: string, pantalla: Pantalla | null) =>
    apiFetch<{ ok: boolean; conversacion: ConversacionVoi }>(`${VOI_API}/conversaciones/${id}/mensajes`, {
      method: "POST", body: JSON.stringify({ texto, pantalla }),
    }),
  ver: (id: string) => apiFetch<TranscripcionVoi>(`${VOI_API}/conversaciones/${id}`),
  editar: (id: string, cambios: { titulo?: string; fijada?: boolean }) =>
    apiFetch<ConversacionVoi>(`${VOI_API}/conversaciones/${id}`, { method: "PATCH", body: JSON.stringify(cambios) }),
  quitar: (id: string) => apiFetch(`${VOI_API}/conversaciones/${id}`, { method: "DELETE" }),
  detener: (id: string) => apiFetch(`${VOI_API}/conversaciones/${id}/detener`, { method: "POST" }),
  confirmar: (id: string) => apiFetch<AccionVoi>(`${VOI_API}/acciones/${id}/confirmar`, { method: "POST" }),
  cancelar: (id: string) => apiFetch<AccionVoi>(`${VOI_API}/acciones/${id}/cancelar`, { method: "POST" }),
  memoria: () => apiFetch<{ items: MemoriaVoi[] }>(`${VOI_API}/memoria`),
  borrarMemoria: (id: string) => apiFetch(`${VOI_API}/memoria/${id}`, { method: "DELETE" }),
};

export type ConexionVoi = "conectando" | "conectado" | "reconectando" | "cerrado";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Escucha una conversación en vivo (SSE sobre fetch, para poder mandar el token). Se reconecta sola con espera
 * creciente; el servidor corta cada pocos minutos a propósito (vuelve a validar la sesión) y avisa con «reconectar».
 * Devuelve la función para dejar de escuchar.
 */
export function escucharConversacion(
  id: string,
  onEvento: (ev: EventoVoi) => void,
  onConexion?: (c: ConexionVoi) => void,
): () => void {
  let cancelado = false;
  let ctrl: AbortController | null = null;

  const correr = async () => {
    let intentos = 0;
    while (!cancelado) {
      ctrl = new AbortController();
      onConexion?.(intentos ? "reconectando" : "conectando");
      try {
        const token = getToken();
        if (!token) {
          onConexion?.("cerrado");
          return;
        }
        const res = await fetch(`${VOI_API}/conversaciones/${id}/eventos`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (res.status === 401) {
          if (await refreshSession()) continue;
          onConexion?.("cerrado");
          return;
        }
        if (res.status === 403 || res.status === 404) {
          onConexion?.("cerrado");
          return;
        }
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        intentos = 0;
        onConexion?.("conectado");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let reconectar = false;
        while (!cancelado && !reconectar) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let corte: number;
          while ((corte = buf.indexOf("\n\n")) >= 0) {
            const bloque = buf.slice(0, corte);
            buf = buf.slice(corte + 2);
            const datos = bloque
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart())
              .join("\n");
            if (!datos) continue;           // comentario «: ping»
            let ev: EventoVoi;
            try {
              ev = JSON.parse(datos);
            } catch {
              continue;
            }
            if (ev.tipo === "reconectar") {
              reconectar = true;
              break;
            }
            onEvento(ev);
          }
        }
        try { await reader.cancel(); } catch { /* ya cerrado */ }
        if (reconectar) continue;
      } catch {
        if (cancelado) return;
      }
      if (cancelado) return;
      intentos += 1;
      onConexion?.("reconectando");
      await esperar(Math.min(1000 * 2 ** Math.min(intentos, 4), 15000));
    }
  };
  correr();
  return () => {
    cancelado = true;
    ctrl?.abort();
  };
}

/** «hace 5 min», «ayer 18:20», «12/10». */
export function cuando(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "recién";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  const hoy = new Date();
  const hh = d.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === hoy.toDateString()) return hh;
  const ayer = new Date(hoy.getTime() - 86400000);
  if (d.toDateString() === ayer.toDateString()) return `ayer ${hh}`;
  return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit" });
}
