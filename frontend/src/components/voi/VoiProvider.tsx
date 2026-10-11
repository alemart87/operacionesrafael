"use client";

/**
 * Voi vive en la raíz de la app (no en cada página): el panel y la conversación siguen abiertos mientras el usuario
 * navega. La página (AppShell) le avisa quién es el usuario; si no tiene la utilidad «Asistente IA», Voi no aparece.
 *
 * La conversación activa se escucha en vivo (SSE): primero llega la transcripción completa y después cada novedad
 * (texto mientras se escribe, pasos, tarjetas de acción, estado y avisos).
 */
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ApiError, CurrentUserInfo, getToken } from "@/lib/api";
import { OPERATIVA_ROUTES, isNavActive, operativaFromPath, submoduloFromPath } from "@/lib/operativas";
import {
  AccionVoi, AjustesEvidencia, ConexionVoi, ConversacionVoi, EstadoVoi, EventoVoi, GuiaVoi, InvestigacionVoi, ItemVoi,
  OpcionVoi, Pantalla, PantallaVoi, avisarHash, escucharConversacion, pantallaDeRuta, voiApi,
} from "@/lib/voi";
import { SelectorAuditor } from "./VoiAuditor";
import { AvisoVoi, GuiaFlotante, Resalte } from "./VoiGuia";
import { VoiPanel } from "./VoiPanel";
import type { ArtefactoVoi } from "./lienzo/tipos";
import { VoiLienzo } from "./lienzo/VoiLienzo";

export type VistaVoi = "chat" | "historial" | "memoria";

export interface ChatVoi {
  items: ItemVoi[];
  /** Lo que Voi mostró en el lienzo en esta conversación (en orden). */
  artefactos: ArtefactoVoi[];
  parciales: Record<string, string>;
  trabajando: boolean;
  estado: string | null;
  costo: number | null;
  conexion: ConexionVoi;
  error: string | null;
}

type Accion =
  | { t: "reset" }
  | { t: "evento"; ev: EventoVoi }
  | { t: "optimista"; id: string; texto: string }
  | { t: "fallo"; id: string; error: string }
  | { t: "quitar"; id: string }
  | { t: "accion"; accion: AccionVoi }
  | { t: "trabajando"; valor: boolean }
  | { t: "conexion"; valor: ConexionVoi }
  | { t: "error"; valor: string | null };

const VACIO: ChatVoi = { items: [], artefactos: [], parciales: {}, trabajando: false, estado: null, costo: null, conexion: "cerrado", error: null };

function upsert(items: ItemVoi[], item: ItemVoi): ItemVoi[] {
  const i = items.findIndex((x) => x.id === item.id);
  if (i < 0) return [...items, item];
  const copia = items.slice();
  copia[i] = item.tipo === "paso" && copia[i].tipo === "paso" ? { ...copia[i], ...item, etiqueta: item.etiqueta ?? (copia[i] as any).etiqueta } : item;
  return copia;
}

function reducir(s: ChatVoi, a: Accion): ChatVoi {
  switch (a.t) {
    case "reset":
      return VACIO;
    case "optimista":
      return { ...s, error: null, trabajando: true, items: [...s.items, { tipo: "usuario", id: a.id, texto: a.texto, pendiente: true }] };
    case "fallo":
      return {
        ...s, trabajando: false,
        items: s.items.map((x) => (x.id === a.id && x.tipo === "usuario" ? { ...x, pendiente: false, error: a.error } : x)),
      };
    case "quitar":
      return { ...s, items: s.items.filter((x) => x.id !== a.id) };
    case "accion":
      return { ...s, items: upsert(s.items, { tipo: "accion", id: a.accion.evento_id, accion: a.accion }) };
    case "trabajando":
      return { ...s, trabajando: a.valor };
    case "conexion":
      return { ...s, conexion: a.valor };
    case "error":
      return { ...s, error: a.valor };
    case "evento":
      return aplicar(s, a.ev);
  }
}

function aplicar(s: ChatVoi, ev: EventoVoi): ChatVoi {
  switch (ev.tipo) {
    case "transcripcion": {
      const textos = new Set(ev.items.filter((i) => i.tipo === "usuario").map((i) => (i as any).texto));
      const optimistas = s.items.filter((i) => i.tipo === "usuario" && i.pendiente && !textos.has(i.texto));
      const items = [...ev.items, ...optimistas];
      // Las acciones pendientes que el agente pidió van como tarjetas (si no estaban ya).
      let conAcciones = items;
      for (const p of ev.pendientes) conAcciones = upsert(conAcciones, { tipo: "accion", id: p.evento_id, accion: p });
      return {
        ...s, items: conAcciones, artefactos: ev.artefactos ?? [], parciales: {}, estado: ev.conversacion.estado,
        trabajando: ev.conversacion.estado === "running" || optimistas.length > 0, error: null,
      };
    }
    case "usuario": {
      if (s.items.some((i) => i.id === ev.id)) return s;
      const i = s.items.findIndex((x) => x.tipo === "usuario" && x.pendiente && x.texto.trim() === ev.texto.trim());
      if (i >= 0) {
        const items = s.items.slice();
        items[i] = { tipo: "usuario", id: ev.id, texto: ev.texto };
        return { ...s, items };
      }
      return { ...s, items: [...s.items, { tipo: "usuario", id: ev.id, texto: ev.texto }] };
    }
    case "mensaje": {
      const { [ev.id]: _, ...parciales } = s.parciales;
      return { ...s, parciales, items: upsert(s.items, { tipo: "voi", id: ev.id, texto: ev.texto }) };
    }
    case "escribiendo":
      if (s.items.some((i) => i.id === ev.id)) return s;
      return { ...s, trabajando: true, parciales: { ...s.parciales, [ev.id]: s.parciales[ev.id] ?? "" } };
    case "parcial":
      if (s.items.some((i) => i.id === ev.id)) return s;
      return { ...s, parciales: { ...s.parciales, [ev.id]: (s.parciales[ev.id] ?? "") + ev.texto } };
    case "fin_parcial":
      return { ...s, parciales: {} };
    case "pensando":
      return { ...s, trabajando: true };
    case "paso": {
      const previo = s.items.find((i) => i.id === ev.id);
      // Se muestran como tarjeta (acción, lienzo, botones, guía o pantalla abierta): el paso no las pisa.
      if (previo && previo.tipo !== "paso") return s;
      return {
        ...s,
        items: upsert(s.items, { tipo: "paso", id: ev.id, herramienta: ev.herramienta, etiqueta: ev.etiqueta, estado: ev.estado, detalle: ev.detalle }),
      };
    }
    case "accion":
      return { ...s, items: upsert(s.items, { tipo: "accion", id: ev.accion.evento_id, accion: ev.accion }) };
    case "lienzo": {
      const a = ev.artefacto;
      const artefactos = s.artefactos.some((x) => x.id === a.id) ? s.artefactos : [...s.artefactos, a];
      return { ...s, artefactos, items: upsert(s.items, { tipo: "lienzo", id: a.evento_id ?? a.id, artefacto: a }) };
    }
    case "estado": {
      const sigue = ev.estado === "running";
      const items = ev.aviso ? [...s.items, { tipo: "aviso" as const, id: `aviso-${Date.now()}`, texto: ev.aviso, nivel: "alerta" as const }] : s.items;
      return { ...s, estado: ev.estado, trabajando: sigue, items, parciales: sigue ? s.parciales : {} };
    }
    case "error":
      return ev.reintenta
        ? { ...s, error: ev.mensaje }
        : { ...s, error: null, trabajando: false, items: [...s.items, { tipo: "aviso", id: `err-${Date.now()}`, texto: ev.mensaje, nivel: "error" }] };
    case "aviso":
      return { ...s, items: [...s.items, { tipo: "aviso", id: `av-${Date.now()}`, texto: ev.texto, nivel: "info" }] };
    case "uso":
      return { ...s, costo: ev.costo_usd };
    case "opciones":
      return { ...s, items: upsert(s.items, { tipo: "opciones", id: ev.id ?? `op-${Date.now()}`, pregunta: ev.pregunta, opciones: ev.opciones }) };
    case "guia":
      return { ...s, items: upsert(s.items, { tipo: "guia", id: ev.id ?? `guia-${Date.now()}`, guia: ev.guia }) };
    case "navegar":
      return { ...s, items: upsert(s.items, { tipo: "pantalla", id: ev.id ?? `nav-${Date.now()}`, ruta: ev.ruta, titulo: ev.titulo ?? null }) };
    case "investigacion": {
      // Un separador en el chat cuando el modo se prende, cambia de informe o se apaga (en un chat vacío lo explica la
      // bienvenida).
      if (!s.items.length) return s;
      // Si lo activó la tarjeta «¿Activamos el modo auditor?», la propia tarjeta ya lo cuenta.
      const reciente = s.items.slice(-3).find((i) => i.tipo === "accion" && i.accion.herramienta === "proponer_modo_auditor");
      if (reciente && ev.investigacion) return s;
      const inv = ev.investigacion;
      const texto = inv ? `Modo auditor activado${inv.codigo ? ` · ${inv.codigo}` : " · sin informe destino"}` : "Saliste del modo auditor";
      return { ...s, items: [...s.items, { tipo: "modo", id: `modo-${Date.now()}`, activo: !!inv, texto }] };
    }
    default:
      return s;
  }
}

/** Nombre legible de la pantalla actual (contexto para Voi). */
export function etiquetaPantalla(pathname: string | null): string {
  if (!pathname) return "";
  const op = operativaFromPath(pathname);
  if (op) {
    const sub = submoduloFromPath(op, pathname);
    if (!sub) return op.name;
    const item = sub.nav.find((i) => isNavActive(i, pathname));
    return item && item.label !== sub.label ? `${sub.label} · ${item.label}` : sub.label;
  }
  if (pathname.startsWith("/admin/asistente")) return "Administración · Asistente IA";
  if (pathname.startsWith("/admin")) return "Administración";
  if (pathname.startsWith("/perfil")) return "Mi perfil";
  if (pathname.startsWith("/inicio")) return "Inicio";
  return OPERATIVA_ROUTES.length ? "Plataforma" : "";
}

/** La guía paso a paso en curso: la guía y en qué paso va. */
export interface GuiaActiva extends GuiaVoi { paso: number }
/** El aviso breve de que Voi abrió una pantalla. */
export interface AvisoNav { texto: string; volver?: boolean }

interface VoiCtx {
  usuario: CurrentUserInfo | null;
  habilitado: boolean;
  setUsuario: (u: CurrentUserInfo | null) => void;
  abierto: boolean;
  acoplado: boolean;
  abrir: () => void;
  cerrar: () => void;
  alternar: () => void;
  vista: VistaVoi;
  setVista: (v: VistaVoi) => void;
  estado: EstadoVoi | null;
  errorEstado: string | null;
  conv: ConversacionVoi | null;
  chat: ChatVoi;
  conversaciones: ConversacionVoi[];
  recargarConversaciones: () => Promise<void>;
  enviar: (texto: string) => Promise<void>;
  reintentar: (id: string, texto: string) => Promise<void>;
  nueva: () => void;
  abrirConversacion: (id: string) => Promise<void>;
  quitarConversacion: (id: string) => Promise<void>;
  editarConversacion: (id: string, cambios: { titulo?: string; fijada?: boolean }) => Promise<void>;
  detener: () => Promise<void>;
  confirmar: (a: AccionVoi) => Promise<void>;
  cancelar: (a: AccionVoi) => Promise<void>;
  pantalla: Pantalla | null;
  usarPantalla: boolean;
  setUsarPantalla: (v: boolean) => void;
  noLeidos: number;
  esperaConfirmacion: boolean;
  lienzo: { abierto: boolean; foco: string | null; locales: ArtefactoVoi[] };
  /** Texto para dejar escrito en el compositor (sin mandar). */
  borrador: string;
  setBorrador: (t: string) => void;
  abrirLienzo: (id?: string) => void;
  cerrarLienzo: () => void;
  /** Muestra en el lienzo algo armado en el navegador (p. ej. una tabla de una respuesta). */
  mostrarEnLienzo: (a: ArtefactoVoi) => void;
  /** Confirma una tarjeta con lo que el usuario eligió en ella (p. ej. qué piezas suma al informe). */
  confirmarCon: (a: AccionVoi, ajustes: AjustesEvidencia) => Promise<void>;
  /** Modo auditor de la conversación actual (null si no está activo). */
  investigacion: InvestigacionVoi | null;
  /** Entra en modo auditor (o cambia el informe destino). `nueva`: empieza una conversación para la investigación. */
  activarAuditor: (auditoriaId?: string | null, opciones?: { nueva?: boolean }) => Promise<void>;
  desactivarAuditor: () => Promise<void>;
  /** Abre Voi en modo auditor con ese informe como destino (desde la pantalla del informe). */
  investigarInforme: (auditoriaId: string) => Promise<void>;
  /** El selector del informe destino (se abre desde el panel, el lienzo o la bienvenida). */
  selectorAuditor: boolean;
  setSelectorAuditor: (v: boolean) => void;
  /** Las pantallas que el usuario puede abrir (el catálogo de Voi) y la que está viendo. */
  pantallas: PantallaVoi[];
  pantallaActual: PantallaVoi | null;
  /** Abre una pantalla por el usuario (como lo hace Voi), avisa con «Volver» y resalta un elemento si se pide. */
  navegarA: (ruta: string, titulo?: string | null, resaltar?: string | null) => void;
  /** La guía paso a paso en curso. */
  guia: GuiaActiva | null;
  abrirGuia: (g: GuiaVoi) => void;
  cerrarGuia: () => void;
  irAPaso: (n: number) => void;
  /** El resaltado pedido al abrir una pantalla (dura unos segundos). */
  resalte: { ancla: string; hasta: number } | null;
  aviso: AvisoNav | null;
  setAviso: (a: AvisoNav | null) => void;
  /** Cuándo Voi llevó al usuario a una pantalla por última vez (ms); la burbuja espera un rato después. */
  navegadoAt: number;
  /** Elegir una de las opciones que Voi ofreció: manda su mensaje (y abre su pantalla, si trae). */
  elegirOpcion: (op: OpcionVoi) => Promise<void>;
}

const Ctx = createContext<VoiCtx | null>(null);

export function useVoi(): VoiCtx | null {
  return useContext(Ctx);
}

const tieneVoi = (u: CurrentUserInfo | null) =>
  !!u && (u.role === "superadmin" || (u.permissions ?? []).some((p) => p.endsWith(".asistente")));

function leerSesion(clave: string): string | null {
  try { return sessionStorage.getItem(clave); } catch { return null; }
}
function guardarSesion(clave: string, valor: string | null) {
  try { valor === null ? sessionStorage.removeItem(clave) : sessionStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}

export function VoiProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [usuario, setUsuarioState] = useState<CurrentUserInfo | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [acoplado, setAcoplado] = useState(false);
  const [vista, setVista] = useState<VistaVoi>("chat");
  const [estado, setEstado] = useState<EstadoVoi | null>(null);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);
  const [conv, setConv] = useState<ConversacionVoi | null>(null);
  const [conversaciones, setConversaciones] = useState<ConversacionVoi[]>([]);
  const [chat, despachar] = useReducer(reducir, VACIO);
  const [usarPantalla, setUsarPantalla] = useState(true);
  const [noLeidos, setNoLeidos] = useState(0);
  const [borrador, setBorrador] = useState("");
  const [lienzo, setLienzo] = useState<{ abierto: boolean; foco: string | null; locales: ArtefactoVoi[] }>({ abierto: false, foco: null, locales: [] });
  const [selectorAuditor, setSelectorAuditor] = useState(false);
  const [pantallas, setPantallas] = useState<PantallaVoi[]>([]);
  const [guia, setGuia] = useState<GuiaActiva | null>(null);
  const [resalte, setResalte] = useState<{ ancla: string; hasta: number } | null>(null);
  const [aviso, setAviso] = useState<AvisoNav | null>(null);
  const [navegadoAt, setNavegadoAt] = useState(0);
  // Lo que la escucha en vivo necesita llamar (se definen más abajo; la escucha no se vuelve a crear).
  const navegarRef = useRef<(ruta: string, titulo?: string | null, resaltar?: string | null) => void>(() => undefined);
  const abrirGuiaRef = useRef<(g: GuiaVoi) => void>(() => undefined);
  const dejarDeEscuchar = useRef<(() => void) | null>(null);
  const abiertoRef = useRef(abierto);
  const tmp = useRef(0);
  abiertoRef.current = abierto;
  // La conversación actual sin esperar al próximo dibujo (p. ej. entrar en modo auditor y enseguida mandar un pedido).
  const convRef = useRef<ConversacionVoi | null>(conv);
  convRef.current = conv;

  const habilitado = tieneVoi(usuario);

  const setUsuario = useCallback((u: CurrentUserInfo | null) => {
    setUsuarioState((prev) => (prev && u && prev.email === u.email && prev.role === u.role &&
      (prev.permissions ?? []).join() === (u.permissions ?? []).join() ? prev : u));
  }, []);

  // Escritorio ancho: el panel se acopla y empuja la pantalla. Más angosto: se superpone.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const f = () => setAcoplado(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);

  /** Escucha en vivo la conversación `id` (deja la anterior). `limpiar`: empieza la vista de cero. */
  const escuchar = useCallback((id: string | null, limpiar = true) => {
    dejarDeEscuchar.current?.();
    dejarDeEscuchar.current = null;
    if (limpiar) despachar({ t: "reset" });
    if (!id) return;
    dejarDeEscuchar.current = escucharConversacion(
      id,
      (ev) => {
        despachar({ t: "evento", ev });
        if (ev.tipo === "transcripcion") setConv(ev.conversacion);
        if (ev.tipo === "estado") setConv((c) => (c ? { ...c, estado: ev.estado } : c));
        // Voi (o el usuario desde otra pestaña) entró o salió del modo auditor: el panel se enciende o se apaga.
        if (ev.tipo === "investigacion") setConv((c) => (c && c.id === id ? { ...c, investigacion: ev.investigacion } : c));
        if (ev.tipo === "mensaje" && !abiertoRef.current) setNoLeidos((n) => n + 1);
        // Lo nuevo del lienzo se abre solo en pantallas anchas (al lado del chat); en el teléfono queda la tarjeta.
        if (ev.tipo === "lienzo" && window.matchMedia("(min-width: 1024px)").matches) {
          setLienzo((l) => ({ ...l, abierto: true, foco: ev.artefacto.id }));
        }
        // Voi abre una pantalla o arranca una guía: el navegador lo sigue.
        if (ev.tipo === "navegar") navegarRef.current(ev.ruta, ev.titulo, ev.resaltar);
        if (ev.tipo === "guia") abrirGuiaRef.current(ev.guia);
      },
      (c) => despachar({ t: "conexion", valor: c }),
    );
    if (limpiar) setLienzo({ abierto: false, foco: null, locales: [] });
  }, []);

  // Fuera de la app (login) o sin sesión: Voi se apaga y olvida todo.
  useEffect(() => {
    if (pathname === "/login" || !getToken()) {
      dejarDeEscuchar.current?.();
      dejarDeEscuchar.current = null;
      despachar({ t: "reset" });
      setConv(null);
      setUsuarioState(null);
      setEstado(null);
      setAbierto(false);
      setConversaciones([]);
      setLienzo({ abierto: false, foco: null, locales: [] });
    }
  }, [pathname]);

  const cargarEstado = useCallback(async () => {
    try {
      setEstado(await voiApi.estado());
      setErrorEstado(null);
    } catch (e: any) {
      setErrorEstado(e?.message ?? "No se pudo consultar a Voi");
    }
  }, []);

  const recargarConversaciones = useCallback(async () => {
    try { setConversaciones((await voiApi.conversaciones()).items); } catch { /* se reintenta al abrir */ }
  }, []);

  // Al habilitarse (usuario con Voi): recuerda si estaba abierto y en qué conversación (por pestaña).
  useEffect(() => {
    if (!habilitado) return;
    if (leerSesion("voi_abierto") === "1") setAbierto(true);
  }, [habilitado]);

  useEffect(() => {
    if (!habilitado || !abierto) return;
    cargarEstado();
    recargarConversaciones();
    setNoLeidos(0);
    if (!conv && !dejarDeEscuchar.current) {
      const previa = leerSesion("voi_conv");
      if (previa) {
        setConv({ id: previa } as ConversacionVoi);
        escuchar(previa);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habilitado, abierto]);

  // El catálogo de pantallas de esta persona (pistas de la burbuja, sugerencias y guías); cambia con sus permisos.
  const permisosClave = (usuario?.permissions ?? []).join();
  useEffect(() => {
    if (!habilitado) { setPantallas([]); return; }
    voiApi.pantallas().then((r) => setPantallas(r.items)).catch(() => undefined);
  }, [habilitado, usuario?.email, permisosClave]);
  const pantallaActual = useMemo(() => pantallaDeRuta(pantallas, pathname), [pantallas, pathname]);

  useEffect(() => guardarSesion("voi_abierto", abierto ? "1" : null), [abierto]);
  useEffect(() => guardarSesion("voi_conv", conv?.id ?? null), [conv?.id]);
  useEffect(() => () => dejarDeEscuchar.current?.(), []);

  // En el teléfono el panel ocupa toda la pantalla: no se desplaza lo de atrás.
  useEffect(() => {
    if (!abierto || window.matchMedia("(min-width: 768px)").matches) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previo; };
  }, [abierto]);

  const abrir = useCallback(() => { setAbierto(true); setNoLeidos(0); }, []);
  const cerrar = useCallback(() => setAbierto(false), []);
  const alternar = useCallback(() => setAbierto((a) => !a), []);

  // Ctrl/⌘ + K abre y cierra a Voi desde cualquier pantalla.
  useEffect(() => {
    if (!habilitado) return;
    const f = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAbierto((a) => !a);
        setNoLeidos(0);
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [habilitado]);

  const pantalla = useMemo<Pantalla | null>(() => {
    if (!pathname) return null;
    return { ruta: pathname, titulo: etiquetaPantalla(pathname) || null };
  }, [pathname]);

  const enviar = useCallback(async (texto: string) => {
    const limpio = texto.trim();
    if (!limpio) return;
    const id = `tmp-${++tmp.current}`;
    setVista("chat");
    despachar({ t: "optimista", id, texto: limpio });
    const ctx = usarPantalla ? pantalla : null;
    const actual = convRef.current;
    try {
      // Sin conversación, o la actual ya no acepta mensajes (terminó o llegó a su tope): se empieza una nueva.
      if (!actual || actual.disponible === false) {
        const c = await voiApi.nueva(limpio, ctx);
        convRef.current = c;
        setConv(c);
        escuchar(c.id, false);   // la transcripción trae el mensaje y reemplaza al optimista
        recargarConversaciones();
      } else {
        const r = await voiApi.enviar(actual.id, limpio, ctx);
        setConv((x) => (x && x.id === r.conversacion.id ? { ...x, ...r.conversacion } : r.conversacion));
      }
    } catch (e: any) {
      const msg = e instanceof ApiError || e instanceof Error ? e.message : "No se pudo enviar";
      despachar({ t: "fallo", id, error: msg });
    }
  }, [pantalla, usarPantalla, recargarConversaciones, escuchar]);

  /** Vuelve a mandar un mensaje que no salió (el fallido se reemplaza por el nuevo). */
  const reintentar = useCallback(async (id: string, texto: string) => {
    despachar({ t: "quitar", id });
    await enviar(texto);
  }, [enviar]);

  const nueva = useCallback(() => {
    escuchar(null);
    setConv(null);
    setVista("chat");
  }, [escuchar]);

  const abrirConversacion = useCallback(async (id: string) => {
    setVista("chat");
    setConv((c) => (c?.id === id ? c : ({ id } as ConversacionVoi)));
    escuchar(id);
  }, [escuchar]);

  const quitarConversacion = useCallback(async (id: string) => {
    await voiApi.quitar(id);
    if (conv?.id === id) nueva();
    await recargarConversaciones();
  }, [conv?.id, nueva, recargarConversaciones]);

  const editarConversacion = useCallback(async (id: string, cambios: { titulo?: string; fijada?: boolean }) => {
    const c = await voiApi.editar(id, cambios);
    if (conv?.id === id) setConv((x) => (x ? { ...x, ...c } : x));
    await recargarConversaciones();
  }, [conv?.id, recargarConversaciones]);

  const detener = useCallback(async () => {
    if (!conv) return;
    try { await voiApi.detener(conv.id); } catch (e: any) { despachar({ t: "error", valor: e.message }); }
  }, [conv]);

  const resolver = useCallback(async (a: AccionVoi, confirmar: boolean, ajustes?: AjustesEvidencia) => {
    despachar({ t: "accion", accion: { ...a, estado: confirmar ? "ejecutando" : "cancelada" } });
    try {
      const r = confirmar ? await voiApi.confirmar(a.id, ajustes) : await voiApi.cancelar(a.id);
      despachar({ t: "accion", accion: r });
      despachar({ t: "trabajando", valor: true });
    } catch (e: any) {
      despachar({ t: "accion", accion: a });
      despachar({ t: "error", valor: e.message });
    }
  }, []);

  // ---------------------------------------------------------------- Voi como guía: abrir pantallas, guiar, elegir
  const navegarA = useCallback((ruta: string, titulo?: string | null, resaltar?: string | null) => {
    const camino = ruta.split("#")[0].split("?")[0];
    if (window.location.pathname !== camino) router.push(ruta);
    else if (ruta.includes("#")) window.location.hash = ruta.split("#")[1];
    avisarHash(ruta);
    // En el teléfono el panel tapa la pantalla: se cierra para que se vea adónde lo llevó.
    if (!acoplado && window.matchMedia("(max-width: 767px)").matches) setAbierto(false);
    setAviso({ texto: `Voi abrió ${titulo ?? ruta}`, volver: true });
    setNavegadoAt(Date.now());
    setResalte(resaltar ? { ancla: resaltar, hasta: Date.now() + 9000 } : null);
  }, [router, acoplado]);
  navegarRef.current = navegarA;

  const abrirGuia = useCallback((g: GuiaVoi) => {
    setGuia({ ...g, paso: 0 });
    // El aviso nombra la pantalla (la guía tiene su propio título en la tarjeta flotante).
    if (window.location.pathname !== g.ruta.split("#")[0]) navegarA(g.ruta, pantallaDeRuta(pantallas, g.ruta)?.titulo ?? g.titulo);
    else if (!acoplado && window.matchMedia("(max-width: 767px)").matches) setAbierto(false);
  }, [navegarA, acoplado, pantallas]);
  abrirGuiaRef.current = abrirGuia;
  const cerrarGuia = useCallback(() => setGuia(null), []);
  const irAPaso = useCallback((n: number) => setGuia((g) => (g ? { ...g, paso: Math.max(0, Math.min(g.pasos.length - 1, n)) } : g)), []);

  const elegirOpcion = useCallback(async (op: OpcionVoi) => {
    if (op.ruta) navegarA(op.ruta, op.titulo);
    await enviar(op.mensaje || op.texto);
  }, [navegarA, enviar]);

  const esperaConfirmacion = chat.items.some((i) => i.tipo === "accion" && i.accion.estado === "pendiente");
  const abrirLienzo = useCallback((id?: string) => setLienzo((l) => ({ ...l, abierto: true, foco: id ?? l.foco })), []);
  const cerrarLienzo = useCallback(() => setLienzo((l) => ({ ...l, abierto: false })), []);
  const mostrarEnLienzo = useCallback((a: ArtefactoVoi) => {
    setLienzo((l) => ({ abierto: true, foco: a.id, locales: [...l.locales.filter((x) => x.id !== a.id), a] }));
  }, []);

  // ---------------------------------------------------------------- modo auditor
  const investigacion = conv?.investigacion?.activo ? conv.investigacion : null;

  const activarAuditor = useCallback(async (auditoriaId?: string | null, opciones?: { nueva?: boolean }) => {
    let c = convRef.current;
    // Sin conversación (o una que ya no acepta mensajes, o se pide una aparte): la investigación empieza en una nueva.
    if (!c || c.disponible === false || opciones?.nueva) {
      c = await voiApi.nueva("", null);
      convRef.current = c;
      setConv(c);
      escuchar(c.id);
      setVista("chat");
    }
    const r = await voiApi.investigacion(c.id, true, auditoriaId ?? null);
    convRef.current = { ...c, ...r };
    setConv((x) => (x && x.id === r.id ? { ...x, ...r } : r));
    recargarConversaciones();
  }, [escuchar, recargarConversaciones]);

  const desactivarAuditor = useCallback(async () => {
    const c = convRef.current;
    if (!c) return;
    const r = await voiApi.investigacion(c.id, false);
    convRef.current = { ...c, ...r };
    setConv((x) => (x && x.id === r.id ? { ...x, ...r } : r));
    recargarConversaciones();
  }, [recargarConversaciones]);

  const investigarInforme = useCallback(async (auditoriaId: string) => {
    setAbierto(true);
    setNoLeidos(0);
    setVista("chat");
    if (investigacion?.auditoria_id === auditoriaId) return;
    // Una conversación con mensajes sigue siendo lo que era: la investigación arranca en una nueva.
    const conMensajes = chat.items.some((i) => i.tipo === "usuario" || i.tipo === "voi");
    await activarAuditor(auditoriaId, { nueva: conMensajes });
  }, [investigacion?.auditoria_id, chat.items, activarAuditor]);

  const valor: VoiCtx = {
    usuario, habilitado, setUsuario, abierto, acoplado, abrir, cerrar, alternar, vista, setVista, estado, errorEstado,
    conv, chat, conversaciones, recargarConversaciones, enviar, reintentar, nueva, abrirConversacion, quitarConversacion,
    editarConversacion, detener, confirmar: (a) => resolver(a, true), cancelar: (a) => resolver(a, false),
    pantalla, usarPantalla, setUsarPantalla, noLeidos, esperaConfirmacion, lienzo, abrirLienzo, cerrarLienzo,
    mostrarEnLienzo, borrador, setBorrador, confirmarCon: (a, ajustes) => resolver(a, true, ajustes),
    investigacion, activarAuditor, desactivarAuditor, investigarInforme, selectorAuditor, setSelectorAuditor,
    pantallas, pantallaActual, navegarA, guia, abrirGuia, cerrarGuia, irAPaso, resalte, aviso, setAviso, navegadoAt,
    elegirOpcion,
  };

  return (
    <Ctx.Provider value={valor}>
      {children}
      {habilitado && abierto && <VoiPanel />}
      {habilitado && abierto && lienzo.abierto && <VoiLienzo />}
      {habilitado && selectorAuditor && <SelectorAuditor />}
      {habilitado && <GuiaFlotante />}
      {habilitado && <Resalte />}
      {habilitado && <AvisoVoi />}
    </Ctx.Provider>
  );
}
