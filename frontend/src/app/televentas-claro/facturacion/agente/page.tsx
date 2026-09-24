"use client";

import { AgentChat } from "@/components/agent/AgentChat";
import { apiFetch } from "@/lib/api";

export default function AgenteFacturacionPage() {
  return (
    <AgentChat
      apiBase="/api/v1/televentas-claro/facturacion-agent"
      title="Agente de Facturación"
      emptyHeading="¿Qué querés analizar de la facturación?"
      emptyHint="Soy experto en la liquidación de comisiones de Televentas CLARO (criterios del Manual TLMK Fijo PGY). Seleccioná uno o más archivos para que enfoque el análisis."
      placeholder="Preguntá sobre la facturación, conceptos, drivers o comparativos…"
      deniedMessage="El Agente de Facturación es exclusivo del superadmin."
      focusLabel="Enfocar en liquidaciones"
      loadFocusOptions={async () => {
        const data = await apiFetch<{
          items: { id: string; periodo: string | null; nro_liquidacion: string | null; total: number; is_published: boolean }[];
        }>("/api/v1/televentas-claro/facturacion/reports");
        const gsM = (v: number) => {
          const a = Math.abs(v || 0);
          if (a >= 1e9) return "Gs " + (v / 1e9).toFixed(1).replace(".", ",") + " MM";
          if (a >= 1e6) return "Gs " + Math.round(v / 1e6) + " M";
          return "Gs " + Math.round(v).toLocaleString("es-PY");
        };
        return data.items.map((r) => ({
          id: r.id,
          label: r.periodo || "Sin período",
          sublabel: `Liquidación ${r.nro_liquidacion || "?"}`,
          badge: gsM(r.total),
          published: r.is_published,
        }));
      }}
      suggestions={[
        "Analizá a fondo la liquidación seleccionada y sus drivers",
        "Compará los meses seleccionados y descomponé el cambio",
        "¿Por qué cae la facturación? Mostrame los débitos en un gráfico",
        "Suspensiones por PFI y documentación faltante por cohorte de venta",
      ]}
    />
  );
}
