"use client";

import {
  ArrowDown, ArrowUp, Brain, ChevronLeft, FileText, History, LayoutDashboard, Loader2, MapPin, MessageSquarePlus, Pencil, Pin, PinOff,
  Settings2, ShieldCheck, Sparkles, Square, Trash2, WifiOff, X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ConversacionVoi, MemoriaVoi, cuando, ddmm, esInformeDiario, etiquetaDestino, tieneDestino, voiApi } from "@/lib/voi";
import type { ArtefactoVoi } from "./lienzo/tipos";
import {
  ChipModoAuditor, ChipModoInforme, FranjaAuditor, InvitacionAuditor, InvitacionInforme, SUGERENCIAS_AUDITOR, SUGERENCIAS_INFORME,
} from "./VoiAuditor";
import { VoiIsotipo } from "./VoiIsotipo";
import { Trabajando, VoiMarkdown, VoiMensajes } from "./VoiMensajes";
import { useVoi } from "./VoiProvider";

const MODO_TEXTO = {
  superadmin: "Veo toda la plataforma: te abro pantallas, te guío paso a paso, explico los datos y preparo lo que necesites.",
  gestion: "Te abro las pantallas, te guío paso a paso, explico los datos de tus módulos y hago cosas por vos: vos aprobás con un botón.",
  auditor: "En tu perfil trabajo con auditoría de ventas y alertas: te abro las pantallas, te guío y busco lo que no cierra.",
} as const;

const COMANDOS = [
  { cmd: "/nueva", texto: "Empezar una conversación nueva" },
  { cmd: "/historial", texto: "Ver tus conversaciones" },
  { cmd: "/memoria", texto: "Lo que Voi recuerda de vos" },
  { cmd: "/lienzo", texto: "Abrir el lienzo (gráficos, tablas, tableros)" },
  { cmd: "/ayuda", texto: "Qué puede hacer Voi" },
];

function IconoBoton({ titulo, onClick, activo, children }: { titulo: string; onClick: () => void; activo?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      className={`w-9 h-9 inline-flex items-center justify-center rounded-lg transition-colors ${
        activo ? "bg-brand-ink text-white" : "text-brand-slate hover:bg-brand-bg hover:text-brand-ink"}`}
    >
      {children}
    </button>
  );
}

export function VoiPanel() {
  const voi = useVoi()!;
  const { chat, conv, estado, vista, setVista } = voi;
  const hablando = Object.keys(chat.parciales).length > 0;
  const estadoIso = chat.trabajando ? (hablando ? "hablando" : "pensando") : "quieto";

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !(e.target as HTMLElement).closest("[data-voi-menu]")) {
      e.stopPropagation();
      voi.cerrar();
    }
  };

  const inv = voi.investigacion;
  const diario = esInformeDiario(inv);
  const navegar = () => { if (!voi.acoplado && window.matchMedia("(max-width: 767px)").matches) voi.cerrar(); };

  return (
    <aside
      className={`voi-panel ${voi.cerrando ? "voi-panel-sale" : ""} no-print fixed z-40 inset-0 md:inset-auto md:top-0 md:right-0 md:bottom-0 md:w-[440px] bg-white md:border-l border-brand-border md:shadow-[-12px_0_32px_-12px_rgba(15,17,22,0.18)] flex flex-col ${inv ? (diario ? "voi-informe" : "voi-auditor") : ""}`}
      role="dialog"
      aria-label={inv ? (diario ? "Voi en modo informe diario" : "Voi en modo auditor") : "Voi, el asistente de la plataforma"}
      onKeyDown={onKeyDown}
      style={{ viewTransitionName: "voi-panel" }}
    >
      {/* Cabecera */}
      <div className="flex items-center gap-2.5 pl-4 pr-2 h-14 flex-shrink-0 border-b border-brand-border pt-[env(safe-area-inset-top)] box-content">
        {vista !== "chat" ? (
          <IconoBoton titulo="Volver a la conversación" onClick={() => setVista("chat")}><ChevronLeft size={18} /></IconoBoton>
        ) : (
          <VoiIsotipo size={26} estado={estadoIso} apagado={estado?.disponible === false} titulo="Voi" />
        )}
        <div className="leading-none min-w-0">
          <div className={`font-display text-brand-ink tracking-wide truncate whitespace-nowrap ${vista === "chat" ? "text-xl" : "text-base sm:text-lg"}`}>
            {vista === "historial" ? "Conversaciones" : vista === "memoria" ? "Lo que recuerdo" : "Voi"}
          </div>
          <div className="text-[9px] uppercase tracking-[0.06em] sm:tracking-[0.16em] text-brand-slate mt-1 font-semibold whitespace-nowrap">Powered by Claude</div>
        </div>
        <div className="ml-auto flex items-center">
          {/* En el celular, dentro del historial o la memoria se esconden «nueva» y «lienzo» para que entre el título. */}
          <span className={vista === "chat" ? "contents" : "hidden sm:contents"}>
            <IconoBoton titulo="Nueva conversación (/nueva)" onClick={voi.nueva}><MessageSquarePlus size={18} /></IconoBoton>
          </span>
          <IconoBoton titulo="Conversaciones (/historial)" activo={vista === "historial"} onClick={() => setVista(vista === "historial" ? "chat" : "historial")}>
            <History size={18} />
          </IconoBoton>
          <span className={vista === "chat" ? "contents" : "hidden sm:contents"}>
          <IconoBoton titulo="Lienzo: gráficos, tablas y tableros (/lienzo)" activo={voi.lienzo.abierto}
            onClick={() => (voi.lienzo.abierto ? voi.cerrarLienzo() : voi.abrirLienzo())}>
            <span className="relative">
              <LayoutDashboard size={18} />
              {voi.chat.artefactos.length > 0 && !voi.lienzo.abierto && (
                <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-0.5 rounded-full bg-brand-cyan text-white text-[9px] font-bold grid place-items-center ring-2 ring-white">
                  {voi.chat.artefactos.length}
                </span>
              )}
            </span>
          </IconoBoton>
          </span>
          <IconoBoton titulo="Lo que Voi recuerda (/memoria)" activo={vista === "memoria"} onClick={() => setVista(vista === "memoria" ? "chat" : "memoria")}>
            <Brain size={18} />
          </IconoBoton>
          {estado?.superadmin && (
            <Link href="/admin/asistente" title="Consola de Voi" aria-label="Consola de Voi"
              onClick={() => !voi.acoplado && voi.cerrar()}
              className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-brand-slate hover:bg-brand-bg hover:text-brand-ink">
              <Settings2 size={18} />
            </Link>
          )}
          <IconoBoton titulo="Cerrar (Esc · Ctrl+K)" onClick={voi.cerrar}><X size={18} /></IconoBoton>
        </div>
      </div>
      <div className={`h-0.5 flex-shrink-0 ${chat.trabajando ? "voi-linea" : ""}`} />
      {inv && vista === "chat" && (
        <FranjaAuditor inv={inv} onCambiar={() => voi.setSelectorAuditor(true)} onNavegar={navegar}
          onSalir={() => voi.desactivarModo().catch(() => undefined)} />
      )}

      {vista === "historial" ? <Historial /> : vista === "memoria" ? <Memoria /> : <Chat />}
    </aside>
  );
}

// ------------------------------------------------------------------ chat
function Chat() {
  const voi = useVoi()!;
  const { chat, conv, estado } = voi;
  const caja = useRef<HTMLDivElement>(null);
  const [alFinal, setAlFinal] = useState(true);
  const vacio = chat.items.length === 0 && Object.keys(chat.parciales).length === 0;
  const navegar = () => { if (!voi.acoplado && window.matchMedia("(max-width: 767px)").matches) voi.cerrar(); };

  // Sigue el final de la conversación, salvo que el usuario haya subido a leer.
  useLayoutEffect(() => {
    const el = caja.current;
    if (el && alFinal) el.scrollTop = el.scrollHeight;
  }, [chat.items, chat.parciales, chat.trabajando, alFinal]);

  const onScroll = () => {
    const el = caja.current;
    if (el) setAlFinal(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  /** Una pieza del lienzo al informe destino con un toque (tarjeta del chat). */
  const agregarAlInforme = async (a: ArtefactoVoi) => {
    const inv = voi.investigacion;
    const destino = esInformeDiario(inv) ? (inv?.informe_id ? { informe_diario_id: inv.informe_id } : null)
      : (inv?.auditoria_id ? { auditoria_id: inv.auditoria_id } : null);
    if (!destino) throw new Error("Elegí primero el informe destino.");
    const r = await voiApi.sumarEvidencia(destino, conv?.id ?? null, [{ artefacto_id: a.id }]);
    window.dispatchEvent(new CustomEvent("voi:figuras"));
    const f = r.agregadas[0] ?? r.repetidas[0];
    return { figura: f?.figura ?? null, repetida: r.agregadas.length === 0 };
  };
  const ultimo = chat.items[chat.items.length - 1];
  const mostrarTrabajando = chat.trabajando && !Object.keys(chat.parciales).length &&
    !(ultimo && ultimo.tipo === "paso" && ultimo.estado === "corriendo") && !voi.esperaConfirmacion;

  if (estado && !estado.disponible) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-4">
        <VoiIsotipo size={64} apagado />
        <p className="text-sm text-brand-graphite max-w-xs">{estado.motivo}</p>
        {estado.superadmin && (
          <Link href="/admin/asistente" className="btn-secondary text-xs">Ir a la consola de Voi</Link>
        )}
      </div>
    );
  }

  return (
    <>
      {conv?.titulo && !vacio && (
        <div className="px-4 py-1.5 border-b border-brand-border/70 bg-brand-bg-soft flex items-center gap-2 text-[11px] text-brand-slate">
          <span className="truncate font-medium">{conv.titulo}</span>
          {chat.conexion === "reconectando" && (
            <span className="ml-auto inline-flex items-center gap-1 text-brand-orange"><WifiOff size={11} /> Reconectando…</span>
          )}
          {estado?.superadmin && chat.costo !== null && chat.conexion !== "reconectando" && (
            <span className="ml-auto tabular-nums whitespace-nowrap shrink-0" title="Costo de esta conversación (precio de lista)">
              US$ {chat.costo.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
        </div>
      )}
      <div ref={caja} onScroll={onScroll} className="relative flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-4 bg-white">
        {vacio ? <Bienvenida /> : (
          <VoiMensajes
            items={chat.items}
            parciales={chat.parciales}
            onConfirmar={voi.confirmar}
            onConfirmarCon={voi.confirmarCon}
            onCancelar={voi.cancelar}
            onReintentar={voi.reintentar}
            onAbrirLienzo={voi.abrirLienzo}
            onAmpliar={voi.mostrarEnLienzo}
            onNavegar={navegar}
            artefactos={chat.artefactos}
            codigoInforme={etiquetaDestino(voi.investigacion)}
            diario={esInformeDiario(voi.investigacion)}
            onAgregarAlInforme={tieneDestino(voi.investigacion) ? agregarAlInforme : undefined}
            onElegir={voi.elegirOpcion}
            onVerGuia={voi.abrirGuia}
            onAbrirRuta={voi.navegarA}
          />
        )}
        {mostrarTrabajando && <Trabajando />}
        {chat.error && (
          <div className="flex justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-orange/10 text-brand-orange px-3 py-1 text-xs">
              <Loader2 size={12} className="animate-spin" /> {chat.error}
            </span>
          </div>
        )}
      </div>
      {!alFinal && (
        <button
          type="button"
          onClick={() => { setAlFinal(true); caja.current?.scrollTo({ top: caja.current.scrollHeight, behavior: "smooth" }); }}
          className="absolute left-1/2 -translate-x-1/2 bottom-36 z-10 inline-flex items-center gap-1 rounded-full bg-brand-ink text-white text-xs font-semibold px-3 py-1.5 shadow-elevated"
        >
          <ArrowDown size={13} /> Ir al final
        </button>
      )}
      <Compositor />
    </>
  );
}

function Bienvenida() {
  const voi = useVoi()!;
  const { estado, usuario, investigacion: inv } = voi;
  const nombre = (usuario?.full_name ?? "").split(" ")[0];
  const diario = esInformeDiario(inv);
  // Primero lo que conviene en la pantalla en la que está; después las sugerencias generales de su perfil.
  const sugerencias = inv ? (diario ? SUGERENCIAS_INFORME : SUGERENCIAS_AUDITOR)
    : Array.from(new Set([...(voi.pantallaActual?.sugerencias ?? []), ...(estado?.sugerencias ?? [])])).slice(0, 4);
  return (
    <div className="h-full flex flex-col items-center text-center pt-6 pb-2">
      <div className="voi-flota"><VoiIsotipo size={68} /></div>
      <h2 className="mt-5 font-display text-3xl text-brand-ink">Hola{nombre ? `, ${nombre}` : ""}</h2>
      <p className="mt-1.5 text-sm text-brand-slate max-w-[320px] leading-snug">
        {inv
          ? diario
            ? `Estoy en modo informe diario con tu informe del ${ddmm(inv.fecha)}. Miro los datos del día, te propongo el contenido y cada gráfico te lo ofrezco como figura; vos revisás y firmás.`
            : `Estoy en modo auditor${inv.codigo ? ` con el informe ${inv.codigo}` : ""}. Cada gráfico que te muestre en el lienzo te lo ofrezco como figura; vos elegís cuáles van.`
          : estado ? MODO_TEXTO[estado.modo] : "Soy Voi, el asistente de la plataforma."}
      </p>
      {estado?.modo_informe_diario && !inv && <InvitacionInforme />}
      {estado?.modo_auditor && !inv && <InvitacionAuditor />}
      {estado && sugerencias.length > 0 && (
        <div className="mt-6 w-full grid gap-2">
          {sugerencias.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => voi.enviar(s)}
              className="group w-full text-left rounded-xl border border-brand-border bg-white hover:border-brand-primary/50 hover:bg-brand-primary-light/30 px-3.5 py-2.5 text-sm text-brand-graphite transition-colors flex items-center gap-2.5"
            >
              <Sparkles size={15} className="text-brand-mist group-hover:text-brand-primary flex-shrink-0" />
              <span>{s}</span>
            </button>
          ))}
        </div>
      )}
      {estado && (
        <p className="mt-auto pt-6 text-[11px] text-brand-mist max-w-[340px] leading-snug flex items-start gap-1.5 text-left">
          <ShieldCheck size={13} className="flex-shrink-0 mt-px" />
          <span>{estado.privacidad}{estado.simulador ? " · Modo simulador (pruebas)." : ""}</span>
        </p>
      )}
    </div>
  );
}

function Compositor() {
  const voi = useVoi()!;
  const { chat, pantalla, usarPantalla, setUsarPantalla } = voi;
  const [texto, setTexto] = useState("");
  const [sel, setSel] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);

  // En la compu el cursor queda listo para escribir; en el teléfono no (el teclado taparía las sugerencias).
  useEffect(() => { if (window.matchMedia("(min-width: 768px)").matches) area.current?.focus(); }, []);
  // Un borrador que viene de otra vista (p. ej. «Enseñarle algo a Voi»): se carga y queda el cursor al final.
  useEffect(() => {
    if (!voi.borrador) return;
    setTexto(voi.borrador);
    voi.setBorrador("");
    requestAnimationFrame(() => { const el = area.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  }, [voi.borrador, voi]);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [texto]);

  const comandos = useMemo(
    () => (texto.startsWith("/") && !texto.includes(" ") ? COMANDOS.filter((c) => c.cmd.startsWith(texto.toLowerCase())) : []),
    [texto],
  );
  useEffect(() => setSel(0), [comandos.length]);

  const ejecutar = useCallback((cmd: string) => {
    setTexto("");
    if (cmd === "/nueva") voi.nueva();
    else if (cmd === "/historial") voi.setVista("historial");
    else if (cmd === "/memoria") voi.setVista("memoria");
    else if (cmd === "/lienzo") voi.abrirLienzo();
    else if (cmd === "/ayuda") voi.enviar("¿Qué podés hacer por mí en la plataforma?");
  }, [voi]);

  const mandar = () => {
    const t = texto.trim();
    if (!t) return;
    if (t.startsWith("/") && COMANDOS.some((c) => c.cmd === t.toLowerCase())) return ejecutar(t.toLowerCase());
    setTexto("");
    voi.enviar(t);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (comandos.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((x) => (x + 1) % comandos.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((x) => (x - 1 + comandos.length) % comandos.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); ejecutar(comandos[sel].cmd); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setTexto(""); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!chat.trabajando) mandar();
    }
  };

  return (
    <div className="flex-shrink-0 border-t border-brand-border bg-white px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="flex flex-wrap items-center gap-x-2">
      {pantalla?.titulo && (
        <button
          type="button"
          onClick={() => setUsarPantalla(!usarPantalla)}
          title={usarPantalla ? "Voi sabe en qué pantalla estás. Tocá para no compartirla." : "Tocá para que Voi sepa en qué pantalla estás."}
          className={`mb-2 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
            usarPantalla ? "border-brand-cyan/40 bg-brand-cyan/5 text-brand-cyan" : "border-dashed border-brand-border text-brand-mist line-through"}`}
        >
          <MapPin size={11} className="flex-shrink-0" />
          <span className="truncate">{pantalla.titulo}</span>
        </button>
      )}
      {voi.estado?.modo_informe_diario && !voi.investigacion && <ChipModoInforme />}
      {voi.estado?.modo_auditor && !voi.investigacion && <ChipModoAuditor />}
      </div>
      <div className="relative" data-voi-menu={comandos.length ? "" : undefined}>
        {comandos.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-brand-border bg-white shadow-elevated overflow-hidden animate-pop" role="listbox">
            {comandos.map((c, i) => (
              <button
                key={c.cmd}
                type="button"
                role="option"
                aria-selected={i === sel}
                onMouseEnter={() => setSel(i)}
                onClick={() => ejecutar(c.cmd)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-3 ${i === sel ? "bg-brand-bg" : ""}`}
              >
                <span className="font-mono text-xs font-semibold text-brand-primary w-20">{c.cmd}</span>
                <span className="text-brand-graphite">{c.texto}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-brand-border bg-white px-3 py-2 focus-within:border-brand-primary focus-within:shadow-focus transition-shadow">
          <textarea
            ref={area}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={8000}
            placeholder="Preguntale a Voi…  (/ para comandos)"
            aria-label="Mensaje para Voi"
            className="flex-1 resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-brand-mist max-h-[168px]"
          />
          {chat.trabajando ? (
            <button type="button" onClick={voi.detener} title="Detener la respuesta" aria-label="Detener la respuesta"
              className="w-8 h-8 rounded-full bg-brand-ink text-white inline-flex items-center justify-center flex-shrink-0 hover:bg-brand-graphite">
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button type="button" onClick={mandar} disabled={!texto.trim()} title="Enviar (Enter)" aria-label="Enviar"
              className="w-8 h-8 rounded-full bg-brand-primary text-white inline-flex items-center justify-center flex-shrink-0 hover:bg-brand-primary-dark disabled:bg-brand-border disabled:text-brand-mist transition-colors">
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-brand-mist">
        Voi puede equivocarse: revisá los datos importantes
        <span className="hidden md:inline"> · <kbd className="font-sans">Ctrl</kbd>+<kbd className="font-sans">K</kbd> abre y cierra</span>
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ historial
function FilaConversacion({ c }: { c: ConversacionVoi }) {
  const voi = useVoi()!;
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(c.titulo);
  const [quitar, setQuitar] = useState(false);
  const activa = voi.conv?.id === c.id;
  const badge = c.estado === "running" ? { t: "Trabajando", k: "badge-cyan" } :
    c.estado === "requires_action" ? { t: "Espera tu confirmación", k: "badge-orange" } :
    c.estado === "budget_reached" ? { t: "Llegó al tope", k: "badge-neutral" } :
    c.estado === "terminated" ? { t: "Terminada", k: "badge-neutral" } : null;

  if (editando) {
    return (
      <form
        className="px-3 py-2 flex items-center gap-2"
        onSubmit={async (e) => { e.preventDefault(); await voi.editarConversacion(c.id, { titulo }); setEditando(false); }}
      >
        <input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} className="input py-1.5 text-sm" />
        <button className="btn-primary px-3 py-1.5 text-xs">Guardar</button>
      </form>
    );
  }
  return (
    <div className={`group relative flex items-center gap-2 px-3 py-2.5 rounded-lg mx-1.5 ${activa ? "bg-brand-primary-light/50" : "hover:bg-brand-bg"}`}>
      <button type="button" onClick={() => voi.abrirConversacion(c.id)} className="flex-1 min-w-0 text-left">
        <div className="text-sm font-medium text-brand-ink truncate">{c.titulo}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-brand-mist">
          <span>{cuando(c.ultima_actividad)}</span>
          {badge && <span className={badge.k}>{badge.t}</span>}
          {c.investigacion?.activo && (
            <span className="rounded border border-brand-border bg-brand-bg px-1.5 py-px text-[10px] font-semibold text-brand-graphite whitespace-nowrap">
              {esInformeDiario(c.investigacion) ? `Informe diario · ${ddmm(c.investigacion.fecha)}` : `Modo auditor${c.investigacion.codigo ? ` · ${c.investigacion.codigo}` : ""}`}
            </span>
          )}
        </div>
      </button>
      {quitar ? (
        <div className="flex items-center gap-1 text-xs">
          <button type="button" onClick={() => voi.quitarConversacion(c.id)} className="btn-danger px-2 py-1 text-xs">Quitar</button>
          <button type="button" onClick={() => setQuitar(false)} className="btn-ghost px-2 py-1 text-xs">No</button>
        </div>
      ) : (
        <div className="flex items-center opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button type="button" title={c.fijada ? "Desfijar" : "Fijar arriba"} onClick={() => voi.editarConversacion(c.id, { fijada: !c.fijada })}
            className="p-1.5 rounded text-brand-mist hover:text-brand-ink">{c.fijada ? <PinOff size={14} /> : <Pin size={14} />}</button>
          <button type="button" title="Renombrar" onClick={() => setEditando(true)} className="p-1.5 rounded text-brand-mist hover:text-brand-ink"><Pencil size={14} /></button>
          <button type="button" title="Quitar de la lista" onClick={() => setQuitar(true)} className="p-1.5 rounded text-brand-mist hover:text-brand-primary"><Trash2 size={14} /></button>
        </div>
      )}
    </div>
  );
}

function Historial() {
  const voi = useVoi()!;
  const [cargando, setCargando] = useState(true);
  useEffect(() => { voi.recargarConversaciones().finally(() => setCargando(false)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const fijadas = voi.conversaciones.filter((c) => c.fijada);
  const resto = voi.conversaciones.filter((c) => !c.fijada);
  return (
    <div className="flex-1 overflow-y-auto py-2">
      <div className="px-4 py-2">
        <button type="button" onClick={voi.nueva} className="btn-secondary w-full text-sm py-2"><MessageSquarePlus size={16} /> Nueva conversación</button>
      </div>
      {cargando && !voi.conversaciones.length && <div className="px-4 py-6 text-sm text-brand-mist flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Cargando…</div>}
      {!cargando && !voi.conversaciones.length && (
        <p className="px-6 py-8 text-sm text-brand-slate text-center">Todavía no hay conversaciones. Escribile a Voi y quedan guardadas acá.</p>
      )}
      {fijadas.length > 0 && <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider2 font-semibold text-brand-mist">Fijadas</div>}
      {fijadas.map((c) => <FilaConversacion key={c.id} c={c} />)}
      {resto.length > 0 && <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider2 font-semibold text-brand-mist">Recientes</div>}
      {resto.map((c) => <FilaConversacion key={c.id} c={c} />)}
      <p className="px-5 pt-4 pb-2 text-[11px] text-brand-mist leading-snug">
        Quitar una conversación la saca de tu lista. Queda una copia para el control del administrador hasta que vence la retención.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ memoria
function Memoria() {
  const voi = useVoi()!;
  const [items, setItems] = useState<MemoriaVoi[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    try { setItems((await voiApi.memoria()).items); setError(null); } catch (e: any) { setError(e.message); setItems([]); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const ensenar = () => { voi.setBorrador("Recordá que "); voi.setVista("chat"); };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      <div className="rounded-2xl border border-brand-border bg-gradient-to-br from-brand-purple/[0.06] to-brand-cyan/[0.06] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-brand-ink"><Brain size={16} className="text-brand-purple" /> Cómo funciona la memoria de Voi</div>
        <p className="mt-1.5 text-sm text-brand-graphite leading-snug">
          Cada conversación empieza de cero. Lo que ves acá es <b>lo único que Voi se lleva de una conversación a otra</b>.
        </p>
        <ul className="mt-3 space-y-2.5 text-[13px] text-brand-graphite leading-snug">
          <li className="flex gap-2"><Sparkles size={15} className="text-brand-cyan flex-shrink-0 mt-0.5" />
            <span><b>Qué guarda:</b> tus preferencias (cómo te gusta ver los datos, qué métricas seguís), tu equipo y tus objetivos, y en qué quedó un trabajo.</span></li>
          <li className="flex gap-2"><MessageSquarePlus size={15} className="text-brand-cyan flex-shrink-0 mt-0.5" />
            <span><b>Cómo se llena:</b> decile «Recordá que…», o Voi lo anota solo cuando algo te va a servir después (y te avisa).</span></li>
          <li className="flex gap-2"><ShieldCheck size={15} className="text-brand-cyan flex-shrink-0 mt-0.5" />
            <span><b>Es privada:</b> solo vos y Voi la usan. Podés borrar cualquier recuerdo cuando quieras.</span></li>
        </ul>
        <button type="button" onClick={ensenar} className="btn-primary mt-4 px-4 py-2 text-xs">
          <Sparkles size={14} /> Enseñarle algo a Voi
        </button>
      </div>
      {error && <p className="text-sm text-brand-primary">{error}</p>}
      {items === null && <div className="text-sm text-brand-mist flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Cargando…</div>}
      {items && items.length === 0 && !error && (
        <p className="text-center text-sm text-brand-slate py-2">Todavía no hay recuerdos guardados.</p>
      )}
      {items && items.length > 0 && (
        <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-mist">Lo que Voi recuerda de vos</div>
      )}
      {items?.map((m) => (
        <div key={m.id} className="rounded-xl border border-brand-border bg-white p-3">
          <div className="flex items-center gap-2 text-xs text-brand-slate">
            <FileText size={13} className="text-brand-cyan" />
            <span className="font-medium truncate">{m.ruta.split("/").pop()?.replace(/\.md$/, "").replace(/[-_]/g, " ")}</span>
            <span className="text-brand-mist">{cuando(m.actualizada)}</span>
            <button
              type="button"
              disabled={borrando === m.id}
              onClick={async () => { setBorrando(m.id); try { await voiApi.borrarMemoria(m.id); await cargar(); } finally { setBorrando(null); } }}
              className="ml-auto p-1 rounded text-brand-mist hover:text-brand-primary disabled:opacity-50"
              title="Borrar este recuerdo"
            >
              {borrando === m.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          </div>
          <div className="mt-2"><VoiMarkdown texto={m.contenido} /></div>
        </div>
      ))}
    </div>
  );
}
