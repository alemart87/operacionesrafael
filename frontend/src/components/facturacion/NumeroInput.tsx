"use client";

import { useEffect, useState } from "react";

/** Input numérico con separador de miles (1.900.000) y coma decimal, como se lee en
 *  Paraguay. Mientras se escribe acepta dígitos, coma y signo; al salir se formatea.
 *  Emite siempre un number. */

export function formatearNumero(v: number | null | undefined, decimales?: number): string {
  if (v == null || Number.isNaN(v)) return "";
  const d = decimales ?? (Number.isInteger(v) ? 0 : Math.min(2, (String(v).split(".")[1] ?? "").length));
  return v.toLocaleString("es-PY", { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 2) });
}

export function parsearNumero(texto: string): number {
  const limpio = texto.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(limpio);
  return Number.isFinite(n) ? n : 0;
}

export function NumeroInput({ value, onChange, className = "", disabled, placeholder, step, min, title, onKeyDown }: {
  value: number; onChange: (v: number) => void; className?: string; disabled?: boolean; placeholder?: string;
  step?: number; min?: number; title?: string; onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [foco, setFoco] = useState(false);
  const [texto, setTexto] = useState(formatearNumero(value));

  useEffect(() => { if (!foco) setTexto(formatearNumero(value)); }, [value, foco]);

  const emitir = (t: string) => {
    setTexto(t);
    const n = parsearNumero(t);
    onChange(min != null && n < min ? min : n);
  };
  const flechas = (e: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (!step || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const n = parsearNumero(texto) + (e.key === "ArrowUp" ? step : -step);
    const v = min != null && n < min ? min : n;
    const redondeado = Math.round(v * 1000) / 1000;
    setTexto(formatearNumero(redondeado));
    onChange(redondeado);
  };

  return (
    <input type="text" inputMode="decimal" value={texto} disabled={disabled} placeholder={placeholder} title={title}
      onChange={(e) => emitir(e.target.value.replace(/[^\d.,-]/g, ""))}
      onFocus={() => { setFoco(true); setTexto(formatearNumero(value)); }}
      onBlur={() => { setFoco(false); setTexto(formatearNumero(parsearNumero(texto))); }}
      onKeyDown={flechas}
      className={className} />
  );
}
