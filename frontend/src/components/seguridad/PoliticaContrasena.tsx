"use client";

import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export interface Politica {
  min_largo: number; mayus_minus: boolean; numero: boolean; simbolo: boolean; vencimiento_dias: number; historial: number;
}

/** Reglas vigentes con un tilde en vivo a medida que se escribe la contraseña nueva. */
export function PoliticaContrasena({ valor }: { valor: string }) {
  const [p, setP] = useState<Politica | null>(null);
  useEffect(() => { apiFetch<Politica>("/api/v1/auth/politica").then(setP).catch(() => setP(null)); }, []);
  if (!p) return null;
  const reglas: [string, boolean][] = [[`Al menos ${p.min_largo} caracteres`, valor.length >= p.min_largo]];
  if (p.mayus_minus) reglas.push(["Mayúsculas y minúsculas", /[a-záéíóúñ]/.test(valor) && /[A-ZÁÉÍÓÚÑ]/.test(valor)]);
  if (p.numero) reglas.push(["Al menos un número", /\d/.test(valor)]);
  if (p.simbolo) reglas.push(["Al menos un símbolo", /[^\w\s]/.test(valor)]);
  return (
    <div className="rounded-md bg-brand-bg px-3 py-2 text-xs">
      <ul className="space-y-0.5">
        {reglas.map(([t, ok]) => (
          <li key={t} className={`flex items-center gap-1.5 ${ok ? "text-emerald-700" : "text-brand-slate"}`}>
            {ok ? <Check size={13} /> : <X size={13} className="text-brand-mist" />}{t}
          </li>
        ))}
      </ul>
      <p className="text-brand-mist mt-1">
        {p.historial ? `No podés repetir las últimas ${p.historial}.` : ""} {p.vencimiento_dias ? `Vence cada ${p.vencimiento_dias} días.` : ""}
      </p>
    </div>
  );
}
