"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ApiError, apiFetch } from "@/lib/api";
import { BandaChip } from "./ui";
import { PROD_API, fechaHora, fechaLarga, n, pct, type InformeResumen } from "./tipos";

type Existente = InformeResumen & { published_by: string | null };

/**
 * Publica el informe de un día. Si el día ya tiene uno publicado, el backend responde 409
 * y acá se muestra la comparación; solo con la confirmación se reenvía con `confirm_replace`.
 */
export function usePublicar(onDone: () => Promise<void> | void) {
  const [pendiente, setPendiente] = useState<{ informe: InformeResumen; existente: Existente } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (informe: InformeResumen, confirm: boolean) => {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`${PROD_API}/informes/${informe.id}/publicar`, { method: "POST", body: JSON.stringify({ confirm_replace: confirm }) });
      setPendiente(null);
      await onDone();
    } catch (e: any) {
      const d = e instanceof ApiError && e.status === 409 ? (e.detail as any) : null;
      if (d?.code === "replace_required") setPendiente({ informe, existente: d.existing });
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const tarjeta = (titulo: string, r: InformeResumen, extra?: string | null, nuevo?: boolean) => (
    <div className={`rounded-md border p-3 ${nuevo ? "border-brand-primary/40 bg-brand-primary-light/40" : "border-brand-border"}`}>
      <div className={`text-[10px] uppercase tracking-wider2 mb-1 ${nuevo ? "text-brand-primary-dark" : "text-brand-slate"}`}>{titulo}</div>
      <div>Corte final <b>{r.corte_final ?? "—"}</b> · {n(r.cortes)} corte(s)</div>
      <div>{n(r.llamadas)} llamadas{r.pct_contacto !== null ? <> · contacto {pct(r.pct_contacto)}</> : null}</div>
      <div className="mt-1"><BandaChip banda={r.banda} valor={r.pct_conversacion} compacto /></div>
      {extra && <div className="text-brand-mist mt-1">{extra}</div>}
    </div>
  );

  const dialogo = (
    <ConfirmDialog
      open={!!pendiente}
      variant="danger"
      title="Reemplazar la publicación"
      confirmLabel="Sí, reemplazar"
      loading={loading}
      onCancel={() => setPendiente(null)}
      onConfirm={() => pendiente && enviar(pendiente.informe, true)}
      message={pendiente && (
        <div className="space-y-3">
          <p>
            El <b>{fechaLarga(pendiente.informe.fecha)}</b> ya tiene un informe publicado. Solo puede haber uno por día:
            si continuás, el nuevo lo reemplaza (también en los acumulados) y el anterior queda en el historial como <b>Reemplazado</b>.
          </p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            {tarjeta("Publicado actual", pendiente.existente, `${pendiente.existente.published_by ?? "—"} · ${fechaHora(pendiente.existente.published_at)}`)}
            {tarjeta("Nuevo", pendiente.informe, null, true)}
          </div>
        </div>
      )}
    />
  );

  return { publicar: (informe: InformeResumen) => enviar(informe, false), dialogo, loading, error };
}
