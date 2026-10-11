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
  /** Tiene Auditoría de ventas: puede trabajar en modo auditor (investigación con informe destino). */
  modo_auditor?: boolean;
  /** Prepara el informe diario: puede armarlo con Voi (modo informe diario, con figuras del lienzo). */
  modo_informe_diario?: boolean;
}

/** Los modos de una conversación: investigación de auditoría (con un informe destino) o armado del informe diario. */
export type TipoModo = "auditor" | "informe_diario";

/** El modo activo de una conversación: el modo auditor (con su informe destino) o el modo informe diario (con el
 * borrador del día). */
export interface InvestigacionVoi {
  activo: boolean;
  /** «auditor» (por defecto) o «informe_diario». */
  tipo?: TipoModo | null;
  auditoria_id?: string | null;
  codigo?: string | null;
  titulo?: string | null;
  estado?: string | null;
  /** Modo informe diario: el borrador destino y su fecha (AAAA-MM-DD). */
  informe_id?: string | null;
  fecha?: string | null;
  desde?: string | null;
  /** Quién lo activó: el usuario (desde el panel) o Voi (con su herramienta). */
  por?: string | null;
}

export const esInformeDiario = (inv: InvestigacionVoi | null | undefined): boolean => inv?.tipo === "informe_diario";
/** '2026-10-11' → '11/10'. */
export const ddmm = (iso: string | null | undefined): string => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
/** Cómo se nombra el destino de las figuras: «AUD-2026-003» o «Informe diario · 11/10». */
export function etiquetaDestino(inv: InvestigacionVoi | null | undefined): string | null {
  if (!inv) return null;
  if (esInformeDiario(inv)) return `Informe diario · ${ddmm(inv.fecha)}`;
  return inv.codigo ?? null;
}
/** La pantalla del destino: la pestaña Evidencia del informe de auditoría o la sección Figuras del informe diario. */
export function pantallaDestino(inv: InvestigacionVoi | null | undefined): string | null {
  if (!inv) return null;
  if (esInformeDiario(inv)) return inv.informe_id ? `/televentas-claro/informe-diario/${inv.informe_id}#figuras` : null;
  return inv.auditoria_id ? `/televentas-claro/auditoria/informes/${inv.auditoria_id}#evidencia` : null;
}
/** Si el modo ya tiene a dónde sumar las figuras. */
export const tieneDestino = (inv: InvestigacionVoi | null | undefined): boolean => !!pantallaDestino(inv);

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
  investigacion?: InvestigacionVoi | null;
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
  /** Lo que la tarjeta necesita (las piezas que Voi propone sumar a un informe, o por qué sugiere el modo auditor). */
  detalle?: DetalleEvidencia | DetalleModoAuditor | null;
}

/** Una pieza del lienzo que Voi propone sumar al informe (`clave`: id del artefacto, o «id#n» para una parte de un tablero). */
export interface PiezaPropuesta {
  clave: string;
  artefacto_id: string;
  widget: number | null;
  titulo: string | null;
  nota: string | null;
}
export interface DetalleEvidencia {
  tipo: "evidencia";
  piezas: PiezaPropuesta[];
  hallazgo?: string | null;
}
/** Voi sugiere activar el modo auditor (la persona está investigando). */
export interface DetalleModoAuditor {
  tipo: "modo_auditor";
  motivo?: string | null;
  auditoria?: string | null;
}
/** Lo que el usuario eligió en la tarjeta de evidencia. */
export interface AjustesEvidencia {
  seleccion: string[];
  ediciones?: Record<string, { titulo?: string; nota?: string }>;
}

/** Pieza que el usuario suma al informe desde el lienzo (de Voi por su id, o armada en el navegador con `spec`). */
export interface PiezaParaInforme {
  artefacto_id?: string;
  widget?: number;
  spec?: unknown;
  titulo?: string;
  nota?: string;
  hallazgo_id?: string;
}
export interface FiguraSumada { id: string; figura: number | null; titulo: string }
export interface ResultadoEvidencia {
  informe: { id: string; codigo: string; titulo: string; tipo?: TipoModo; pantalla?: string | null };
  agregadas: FiguraSumada[];
  repetidas: FiguraSumada[];
}
/** A dónde van las piezas del lienzo: un informe de auditoría o el informe diario. */
export type DestinoEvidencia = { auditoria_id: string } | { informe_diario_id: string };
/** Con qué se activa un modo: el informe de auditoría destino, o el informe diario (por id o por fecha; hoy si no). */
export interface DestinoModo { tipo?: TipoModo; auditoria_id?: string | null; informe_id?: string | null; fecha?: string | null }

/** Un botón que Voi ofrece en el chat: al tocarlo se manda `mensaje` (y, si trae `ruta`, se abre esa pantalla). */
export interface OpcionVoi { texto: string; mensaje: string; ruta?: string; titulo?: string }
export interface PasoGuia { n: number; texto: string; ancla?: string | null }
/** Una guía paso a paso de la plataforma: la pantalla donde se hace y los pasos, cada uno con el elemento que resalta. */
export interface GuiaVoi {
  clave: string;
  titulo: string;
  ruta: string;
  nota?: string | null;
  voi?: string | null;
  pasos: PasoGuia[];
}
export interface PistaVoi { texto: string; boton: string; mensaje: string }
/** Una pantalla del catálogo que el usuario puede abrir, con la pista de la burbuja y las sugerencias de bienvenida. */
export interface PantallaVoi {
  ruta: string;
  titulo: string;
  modulo: string;
  que_hace: string;
  pista: PistaVoi | null;
  sugerencias: string[];
  guias: { clave: string; titulo: string }[];
  anclas: string[];
}

export type ItemVoi =
  | { tipo: "usuario"; id: string; texto: string; at?: string | null; pendiente?: boolean; error?: string | null }
  /** Una pregunta con botones para elegir con un toque. */
  | { tipo: "opciones"; id: string; pregunta: string; opciones: OpcionVoi[]; at?: string | null }
  /** La guía paso a paso que Voi mostró. */
  | { tipo: "guia"; id: string; guia: GuiaVoi; at?: string | null }
  /** La pantalla que Voi abrió. */
  | { tipo: "pantalla"; id: string; ruta: string; titulo?: string | null; at?: string | null }
  | { tipo: "voi"; id: string; texto: string; at?: string | null }
  | { tipo: "paso"; id: string; herramienta?: string | null; etiqueta?: string | null; estado: "corriendo" | "ok" | "error"; detalle?: string | null; ms?: number | null; at?: string | null; entrada?: unknown; resultado?: string }
  | { tipo: "accion"; id: string; accion: AccionVoi; at?: string | null }
  | { tipo: "aviso"; id: string; texto: string; nivel?: "info" | "alerta" | "error"; at?: string | null }
  | { tipo: "lienzo"; id: string; artefacto: ArtefactoVoi; at?: string | null; entrada?: unknown; resultado?: string }
  | { tipo: "contexto"; id: string; texto: string; at?: string | null }
  /** Un modo (auditor o informe diario) se prendió o se apagó en esta conversación (separador en el chat). */
  | { tipo: "modo"; id: string; activo: boolean; texto: string; modo?: TipoModo; at?: string | null }
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
  | { tipo: "paso"; id: string; herramienta?: string; etiqueta?: string; estado: "corriendo" | "ok" | "error"; detalle?: string | null; ms?: number | null }
  | { tipo: "accion"; accion: AccionVoi }
  | { tipo: "lienzo"; artefacto: ArtefactoVoi }
  | { tipo: "investigacion"; investigacion: InvestigacionVoi | null }
  | { tipo: "navegar"; id?: string | null; ruta: string; titulo?: string | null; resaltar?: string | null; motivo?: string | null }
  | { tipo: "guia"; id?: string | null; guia: GuiaVoi }
  | { tipo: "opciones"; id?: string | null; pregunta: string; opciones: OpcionVoi[] }
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
  confirmar: (id: string, ajustes?: AjustesEvidencia) =>
    apiFetch<AccionVoi>(`${VOI_API}/acciones/${id}/confirmar`, { method: "POST", body: JSON.stringify(ajustes ? { ajustes } : {}) }),
  cancelar: (id: string) => apiFetch<AccionVoi>(`${VOI_API}/acciones/${id}/cancelar`, { method: "POST" }),
  /** Entra en un modo (auditor con su informe destino, o informe diario con el borrador del día) o sale del activo. */
  investigacion: (id: string, activo: boolean, destino: DestinoModo = {}) =>
    apiFetch<ConversacionVoi>(`${VOI_API}/conversaciones/${id}/investigacion`, {
      method: "POST",
      body: JSON.stringify({ activo, tipo: destino.tipo ?? "auditor", auditoria_id: destino.auditoria_id ?? null,
                             informe_id: destino.informe_id ?? null, fecha: destino.fecha ?? null }),
    }),
  /** Suma piezas del lienzo (elegidas por el usuario) como figuras de un informe de auditoría o del informe diario. */
  sumarEvidencia: (destino: DestinoEvidencia, conversacion_id: string | null, piezas: PiezaParaInforme[]) =>
    apiFetch<ResultadoEvidencia>(`${VOI_API}/evidencias`, {
      method: "POST", body: JSON.stringify({ ...destino, conversacion_id, piezas }),
    }),
  /** Las pantallas que esta persona puede abrir, con la pista de Voi y las guías de cada una. */
  pantallas: () => apiFetch<{ items: PantallaVoi[] }>(`${VOI_API}/pantallas`),
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

/** Un enlace interno con «#pestaña» hacia la misma pantalla no dispara «hashchange» (la navegación usa pushState):
 * se avisa a mano para que la pantalla abra la pestaña (p. ej. …/informes/<id>#evidencia). */
export function avisarHash(href: string) {
  if (typeof window === "undefined" || !href.includes("#")) return;
  setTimeout(() => window.dispatchEvent(new HashChangeEvent("hashchange")), 80);
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

/** Voi ejecutó una acción sobre un informe diario (la ruta de su resultado lo nombra): se avisa con «voi:informe» y el id
 * para que la pantalla del informe, si está abierta, se traiga lo nuevo sin recargar. */
export function avisarInformeCambiado(ruta: string | null | undefined, herramienta?: string): void {
  const m = /\/televentas-claro\/informe-diario\/([0-9a-f-]{36})/.exec(ruta ?? "");
  if (m) window.dispatchEvent(new CustomEvent("voi:informe", { detail: { id: m[1], herramienta: herramienta ?? null } }));
}

/** La pantalla del catálogo a la que pertenece una ruta (la de prefijo más largo), como lo resuelve el backend. */
export function pantallaDeRuta(items: PantallaVoi[], pathname: string | null): PantallaVoi | null {
  if (!pathname) return null;
  const camino = pathname.split("#")[0].split("?")[0].replace(/\/+$/, "") || "/";
  let mejor: PantallaVoi | null = null;
  for (const p of items) {
    if ((camino === p.ruta || camino.startsWith(`${p.ruta}/`)) && (!mejor || p.ruta.length > mejor.ruta.length)) mejor = p;
  }
  return mejor;
}
