"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { fechaCorta, fechaHora, n, pct } from "@/components/productividad/tipos";
import { ApiError, apiFetch } from "@/lib/api";
import { SPH_API, etiquetaPeriodo, fmtSph, type InformeSphResumen } from "./tipos";

type Existente = InformeSphResumen & { published_by: string | null };

/**
 * Publica el SPH de un período. Si el período ya tiene uno publicado, el backend responde 409 y acá se
 * muestran los dos; solo con la confirmación se reenvía con `confirm_replace`.
 */
export function usePublicarSph(onDone: () => Promise<void> | void) {
  const [pendiente, setPendiente] = useState<{ informe: InformeSphResumen; existente: Existente } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (informe: InformeSphResumen, confirm: boolean) => {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`${SPH_API}/informes/${informe.id}/publicar`, { method: "POST", body: JSON.stringify({ confirm_replace: confirm }) });
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

  const tarjeta = (titulo: string, r: InformeSphResumen, extra?: string | null, nuevo?: boolean) => (
    <div className={`rounded-md border p-3 ${nuevo ? "border-brand-primary/40 bg-brand-primary-light/40" : "border-brand-border"}`}>
      <div className={`text-[10px] uppercase tracking-wider2 mb-1 ${nuevo ? "text-brand-primary-dark" : "text-brand-slate"}`}>{titulo}</div>
      <div>SPH <b className="tabular-nums">{fmtSph(r.sph)}</b> · {n(r.netas)} netas{r.tipo !== "dia" && <> · {n(r.dias)} día(s)</>}</div>
      <div>Corte de ventas {r.ventas_corte ? fechaCorta(r.ventas_corte) : "—"}</div>
      <div>{pct(r.pct_cobertura)} de las netas con asesor</div>
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
            <b>{etiquetaPeriodo(pendiente.informe.desde, pendiente.informe.hasta, pendiente.informe.tipo)}</b> ya tiene un SPH publicado.
            Solo puede haber uno por período: si continuás, el nuevo lo reemplaza y el anterior queda en el historial como <b>Reemplazado</b>.
          </p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            {tarjeta("Publicado actual", pendiente.existente, `${pendiente.existente.published_by ?? "—"} · ${fechaHora(pendiente.existente.published_at)}`)}
            {tarjeta("Nuevo", pendiente.informe, null, true)}
          </div>
        </div>
      )}
    />
  );

  return { publicar: (informe: InformeSphResumen) => enviar(informe, false), dialogo, loading, error };
}
