"use client";

import { useEffect, useState } from "react";

// Mensajes que se intercalan mientras el agente "piensa", para acompañar la espera.
const PHRASES = [
  "Analizando la base de datos…",
  "Aplicando herramientas de consulta…",
  "Enviando a mis agentes a analizar…",
  "Revisando los registros de atención…",
  "Cruzando motivos y estados…",
  "Calculando métricas y tendencias…",
  "Buscando patrones en las gestiones…",
  "Filtrando la información relevante…",
  "Consultando los períodos disponibles…",
  "Interpretando la voz del cliente…",
  "Preparando los hallazgos…",
  "Armando la respuesta…",
];

export function ThinkingTicker() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % PHRASES.length), 2500);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-2 text-sm mt-1">
      <span className="w-1.5 h-1.5 rounded-full bg-brand-cyan animate-pulse flex-shrink-0" />
      <span key={i} className="shimmer-text font-medium animate-fade">{PHRASES[i]}</span>
    </div>
  );
}
