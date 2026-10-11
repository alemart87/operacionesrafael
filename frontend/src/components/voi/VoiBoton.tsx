"use client";

import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { esInformeDiario, etiquetaDestino, type PistaVoi } from "@/lib/voi";
import { VoiIsotipo } from "./VoiIsotipo";
import { useVoi } from "./VoiProvider";

const PISTA_GENERAL: PistaVoi = {
  texto: "Hola, soy Voi. Puedo abrir pantallas, guiarte paso a paso y hacer cosas por vos.",
  boton: "¿Qué podés hacer?",
  mensaje: "¿Qué puedo hacer con Voi?",
};

function leer(clave: string): boolean {
  try { return sessionStorage.getItem(clave) === "1"; } catch { return false; }
}
function marcar(clave: string) {
  try { sessionStorage.setItem(clave, "1"); } catch { /* sin almacenamiento */ }
}

/**
 * «AI VOI» en la cabecera (también con Ctrl/⌘ + K). Late suave mientras está cerrado, en naranja cuando espera una
 * aprobación, y debajo aparece una burbuja con la sugerencia de Voi para la pantalla en la que está el usuario (una
 * vez por pantalla y por sesión).
 */
export function VoiBoton() {
  const voi = useVoi();
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);
  if (!voi?.habilitado) return null;
  const { chat, abierto, esperaConfirmacion, noLeidos, investigacion } = voi;
  const aviso = !abierto && (esperaConfirmacion || noLeidos > 0);
  const diario = esInformeDiario(investigacion);
  const modo = investigacion ? (diario ? "modo informe diario" : "modo auditor") : null;
  const destino = etiquetaDestino(investigacion);
  const subtitulo = investigacion ? (diario ? "Informe diario" : "Modo auditor") : chat.trabajando ? "Trabajando…" : esperaConfirmacion ? "Esperá tu OK" : "Asistente";
  const latido = abierto || investigacion ? "" : esperaConfirmacion ? "voi-late-aprobar" : "voi-late";
  return (
    <div className="relative no-print">
      <button
        type="button"
        data-voi="voi"
        onClick={voi.alternar}
        aria-pressed={abierto}
        aria-label={modo ? `Voi, en ${modo}` : "AI VOI, el asistente de la plataforma"}
        title={modo ? `Voi · ${modo}${destino ? ` · ${destino}` : ""} (${mac ? "⌘" : "Ctrl"}+K)` : `Voi, el asistente (${mac ? "⌘" : "Ctrl"}+K)`}
        className={`relative inline-flex items-center gap-2 h-11 pl-1.5 pr-3 rounded-full border-2 transition-colors ${
          abierto ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border bg-white hover:border-brand-cyan"} ${
          investigacion ? (diario ? "voi-boton-informe" : "voi-boton-auditor") : latido}`}
      >
        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${abierto ? "bg-white" : "bg-brand-bg-soft border border-brand-border/70"}`}>
          <VoiIsotipo size={17} estado={chat.trabajando ? "pensando" : "quieto"} />
        </span>
        <span className="flex flex-col items-start leading-none">
          <span className={`font-display text-[17px] tracking-wide ${abierto ? "text-white" : "text-brand-ink"}`}>AI VOI</span>
          <span className={`hidden sm:block mt-0.5 text-[9px] uppercase tracking-[0.14em] font-semibold ${abierto ? "text-white/70" : esperaConfirmacion ? "text-brand-orange" : "text-brand-slate"}`}>
            {subtitulo}
          </span>
        </span>
        <kbd className={`hidden ${abierto ? "" : "lg:inline"} ml-0.5 whitespace-nowrap font-sans text-[10px] rounded px-1 py-px border border-brand-border text-brand-mist`}>
          {mac ? "⌘K" : "Ctrl K"}
        </kbd>
        {aviso && (
          <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center ring-2 ring-white ${
            esperaConfirmacion ? "bg-brand-orange" : "bg-brand-primary"}`}>
            {esperaConfirmacion ? "!" : noLeidos}
          </span>
        )}
      </button>
      <Burbuja />
    </div>
  );
}

/** La sugerencia de Voi para esta pantalla: aparece un momento después de llegar, una vez por pantalla y sesión. */
function Burbuja() {
  const voi = useVoi()!;
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const pantalla = voi.pantallaActual;
  const pista = pantalla?.pista ?? PISTA_GENERAL;
  const clave = `voi_pista:${pantalla?.pista ? pantalla.ruta : "general"}`;
  const ocultar = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ocupado = voi.abierto || !!voi.guia || !!voi.aviso || Date.now() - voi.navegadoAt < 25000;
  useEffect(() => {
    setVisible(false);
    if (ocupado || !pathname || pathname === "/login" || leer(clave)) return;
    const t = setTimeout(() => {
      if (leer(clave) || Date.now() - voi.navegadoAt < 25000) return;
      marcar(clave);
      setVisible(true);
      ocultar.current = setTimeout(() => setVisible(false), 16000);
    }, 1400);
    return () => { clearTimeout(t); if (ocultar.current) clearTimeout(ocultar.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, clave, ocupado]);

  if (!visible || voi.abierto || voi.guia) return null;
  const nombre = (voi.usuario?.full_name ?? "").split(" ")[0];
  return (
    <div
      role="status"
      className="voi-burbuja absolute right-0 top-[calc(100%+10px)] z-40 w-[min(320px,calc(100vw-2rem))] rounded-2xl border border-brand-border bg-white shadow-elevated p-3.5 text-left"
      onMouseEnter={() => { if (ocultar.current) clearTimeout(ocultar.current); }}
    >
      <span className="absolute -top-[7px] right-7 w-3 h-3 rotate-45 bg-white border-l border-t border-brand-border" aria-hidden />
      <div className="flex items-start gap-2.5">
        <span className="w-8 h-8 rounded-full bg-brand-bg-soft border border-brand-border/70 grid place-items-center flex-shrink-0"><VoiIsotipo size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wider2 text-brand-cyan">AI VOI{nombre ? ` · para ${nombre}` : ""}</div>
          <p className="mt-0.5 text-sm text-brand-graphite leading-snug">{pista.texto}</p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setVisible(false); voi.abrir(); voi.enviar(pista.mensaje); }}
              className="btn-primary px-3.5 py-1.5 text-xs"
            >
              {pista.boton}
            </button>
            <button type="button" onClick={() => { setVisible(false); voi.abrir(); }} className="btn-ghost px-2.5 py-1.5 text-xs">Escribirle</button>
          </div>
        </div>
        <button type="button" onClick={() => setVisible(false)} aria-label="Cerrar" className="p-1 -m-1 rounded text-brand-mist hover:text-brand-ink"><X size={14} /></button>
      </div>
    </div>
  );
}
