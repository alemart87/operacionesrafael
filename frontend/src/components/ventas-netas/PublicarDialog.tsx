"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ApiError, apiFetch } from "@/lib/api";
import { VN_API, fechaCorta, fechaHora, n, nombrePeriodo, type InformeResumen } from "./tipos";

interface Existente {
  id: string;
  fecha_dato: string | null;
  published_at: string | null;
  published_by: string | null;
  netas: number;
}

/**
 * Publica un informe. Si el período ya tiene uno publicado, el backend responde 409
 * y acá se muestra la alerta de reemplazo; solo con la confirmación se reenvía con
 * `confirm_replace`. Uso: const { publicar, dialogo } = usePublicar(onDone).
 */
export function usePublicar(onDone: () => Promise<void> | void) {
  const [pendiente, setPendiente] = useState<{ informe: InformeResumen; existente: Existente } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (informe: InformeResumen, confirm: boolean) => {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`${VN_API}/reports/${informe.id}/publish`, {
        method: "POST",
        body: JSON.stringify({ confirm_replace: confirm }),
      });
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
            <b>{nombrePeriodo(pendiente.informe.periodo)}</b> ya tiene un informe publicado. Solo puede haber uno por mes:
            si continuás, el nuevo lo reemplaza y el anterior queda en el historial como <b>Reemplazado</b>.
          </p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-md border border-brand-border p-3">
              <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mb-1">Publicado actual</div>
              <div>Corte al <b>{fechaCorta(pendiente.existente.fecha_dato)}</b></div>
              <div>{n(pendiente.existente.netas)} netas</div>
              <div className="text-brand-mist mt-1">
                {pendiente.existente.published_by ?? "—"} · {fechaHora(pendiente.existente.published_at)}
              </div>
            </div>
            <div className="rounded-md border border-brand-primary/40 bg-brand-primary-light/40 p-3">
              <div className="text-[10px] uppercase tracking-wider2 text-brand-primary-dark mb-1">Nuevo</div>
              <div>Corte al <b>{fechaCorta(pendiente.informe.fecha_dato)}</b></div>
              <div>{n(pendiente.informe.netas)} netas</div>
            </div>
          </div>
        </div>
      )}
    />
  );

  return { publicar: (informe: InformeResumen) => enviar(informe, false), dialogo, loading, error };
}
