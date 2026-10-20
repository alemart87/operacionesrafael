"use client";

import { AppShell } from "@/components/AppShell";
import { AnalizadorVista } from "@/components/supervision/analisis";

/** Analizador de coaching: estadísticas, evaluación de cada supervisor, mapa de palabras e informes de Claude. */
export default function AnalisisPage() {
  return (
    <AppShell>
      <AnalizadorVista />
    </AppShell>
  );
}
