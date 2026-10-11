"use client";

import { useEffect, useState } from "react";
import { VoiIsotipo } from "./VoiIsotipo";
import { useVoi } from "./VoiProvider";

/** Acceso a Voi en la cabecera (también con Ctrl/⌘ + K). Muestra si está trabajando o si espera algo de vos. */
export function VoiBoton() {
  const voi = useVoi();
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);
  if (!voi?.habilitado) return null;
  const { chat, abierto, esperaConfirmacion, noLeidos, investigacion } = voi;
  const aviso = !abierto && (esperaConfirmacion || noLeidos > 0);
  return (
    <button
      type="button"
      onClick={voi.alternar}
      aria-pressed={abierto}
      aria-label={investigacion ? "Voi, en modo auditor" : "Voi, el asistente de la plataforma"}
      title={investigacion ? `Voi · modo auditor${investigacion.codigo ? ` · ${investigacion.codigo}` : ""} (${mac ? "⌘" : "Ctrl"}+K)` : `Voi, el asistente (${mac ? "⌘" : "Ctrl"}+K)`}
      className={`no-print relative inline-flex items-center gap-2 h-10 pl-2.5 pr-2.5 sm:pr-3 rounded-full border transition-all ${
        abierto ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border bg-white hover:border-brand-primary/50 hover:shadow-soft"} ${
        investigacion ? "voi-boton-auditor" : ""}`}
    >
      <span className={`inline-flex items-center justify-center ${abierto ? "rounded-full bg-white p-[3px]" : ""}`}>
        <VoiIsotipo size={abierto ? 16 : 20} estado={chat.trabajando ? "pensando" : "quieto"} />
      </span>
      <span className={`font-display text-lg leading-none hidden sm:inline ${abierto ? "text-white" : "text-brand-ink"}`}>Voi</span>
      <kbd className={`hidden ${abierto ? "" : "lg:inline"} whitespace-nowrap font-sans text-[10px] rounded px-1 py-px border border-brand-border text-brand-mist`}>
        {mac ? "⌘K" : "Ctrl K"}
      </kbd>
      {aviso && (
        <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center ring-2 ring-white ${
          esperaConfirmacion ? "bg-brand-orange" : "bg-brand-primary"}`}>
          {esperaConfirmacion ? "!" : noLeidos}
        </span>
      )}
    </button>
  );
}
