"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { usePublicar } from "@/components/ventas-netas/PublicarDialog";
import { EstadoBadge } from "@/components/ventas-netas/ui";
import { VN_API, VN_HREF, fechaCorta, fechaHora, n, nombrePeriodo, pct, type InformeResumen, type ListaInformes } from "@/components/ventas-netas/tipos";
import { apiFetch } from "@/lib/api";
import { PERM_VENTAS_NETAS_GESTION } from "@/lib/operativas";

export default function VentasNetasPage() {
  return (
    <AppShell>
      <Informes />
    </AppShell>
  );
}

function Informes() {
  const { can } = useSession();
  const gestion = can(PERM_VENTAS_NETAS_GESTION);
  const [lista, setLista] = useState<ListaInformes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aEliminar, setAEliminar] = useState<InformeResumen | null>(null);
  const [aDespublicar, setADespublicar] = useState<InformeResumen | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const load = useCallback(async () => {
    try {
      setLista(await apiFetch<ListaInformes>(`${VN_API}/reports`));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { publicar, dialogo, error: errorPublicar } = usePublicar(load);

  const accion = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    try { await fn(); await load(); } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };

  // Agrupado por período (ya viene ordenado: período desc, corte desc).
  const meses = useMemo(() => {
    const m = new Map<string, InformeResumen[]>();
    for (const r of lista?.items ?? []) m.set(r.periodo, [...(m.get(r.periodo) ?? []), r]);
    return [...m.entries()].map(([periodo, items]) => {
      const publicado = items.find((i) => i.status === "published") ?? null;
      const masNuevoSinPublicar = publicado && items.some((i) => i.status === "draft" && (i.fecha_dato ?? "") > (publicado.fecha_dato ?? ""));
      return { periodo, publicado, items, masNuevoSinPublicar };
    });
  }, [lista]);

  const nombre = (id: string | null) => (id && lista?.usuarios[id]) || "—";

  return (
    <>
      <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Televentas CLARO</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Ventas Netas</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-2xl">
            Ventas cerradas del mes a partir del corte diario de Claro. {gestion
              ? "Cada corte genera un borrador; solo un informe publicado vale por mes."
              : "Se muestran los informes publicados de cada mes."}
          </p>
        </div>
        {gestion && (
          <Link href={`${VN_HREF}/upload`} className="btn-primary">
            Subir corte
          </Link>
        )}
      </div>

      {(error || errorPublicar) && <div className="card p-4 text-brand-primary mb-4">{error || errorPublicar}</div>}

      {!lista ? (
        <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : meses.length === 0 ? (
        <div className="card p-12 text-center text-brand-slate">
          {gestion ? "Aún no hay informes. Subí el primer corte de Claro para generarlo." : "Todavía no hay informes publicados."}
        </div>
      ) : (
        <div className="space-y-6">
          {meses.map((m) => (
            <section key={m.periodo} className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-brand-border flex items-center justify-between gap-3 flex-wrap bg-brand-bg-soft">
                <div>
                  <h2 className="font-display text-2xl text-brand-ink uppercase leading-tight">{nombrePeriodo(m.periodo)}</h2>
                  <div className="text-xs text-brand-slate mt-0.5">
                    {m.publicado
                      ? <>Publicado el corte al <b>{fechaCorta(m.publicado.fecha_dato)}</b> · {n(m.publicado.netas)} netas · {pct(m.publicado.pct_sin_uso)} sin uso</>
                      : <span className="text-brand-primary font-semibold">Sin publicación este mes</span>}
                  </div>
                </div>
                {m.masNuevoSinPublicar && (
                  <span className="badge-primary">Hay un corte más reciente sin publicar</span>
                )}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
                    <th className="px-5 py-2.5">Corte</th>
                    <th className="px-3 py-2.5">Estado</th>
                    <th className="px-3 py-2.5 text-right">Netas</th>
                    <th className="px-3 py-2.5 text-right">Pospago</th>
                    <th className="px-3 py-2.5 text-right">GPON</th>
                    <th className="px-3 py-2.5 text-right">IPTV</th>
                    <th className="px-3 py-2.5 text-right">Sin uso</th>
                    <th className="px-3 py-2.5 text-right">Pendientes</th>
                    <th className="px-3 py-2.5">Generado</th>
                    <th className="px-5 py-2.5 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {m.items.map((r) => (
                    <tr key={r.id} className={`border-b border-brand-border/60 ${r.status === "published" ? "bg-emerald-50/40" : r.status === "replaced" ? "text-brand-mist" : "hover:bg-brand-bg/50"}`}>
                      <td className="px-5 py-2.5">
                        <Link href={`${VN_HREF}/reports/${r.id}`} className="font-semibold text-brand-ink hover:text-brand-primary">
                          Corte al {fechaCorta(r.fecha_dato)}
                        </Link>
                        {r.status === "published" && (
                          <div className="text-[11px] text-brand-slate">{nombre(r.published_by)} · {fechaHora(r.published_at)}</div>
                        )}
                        {r.status === "replaced" && <div className="text-[11px]">Reemplazado el {fechaHora(r.replaced_at)}</div>}
                      </td>
                      <td className="px-3 py-2.5"><EstadoBadge estado={r.status} /></td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{n(r.netas)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{n(r.pospago)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{n(r.gpon)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{n(r.iptv)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{n(r.pospago_sin_uso)} <span className="text-brand-slate">({pct(r.pct_sin_uso)})</span></td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{n(r.pendientes)}</td>
                      <td className="px-3 py-2.5 text-xs text-brand-slate">{nombre(r.generated_by)}<br />{fechaHora(r.generated_at)}</td>
                      <td className="px-5 py-2.5 text-right whitespace-nowrap text-xs font-semibold">
                        <Link href={`${VN_HREF}/reports/${r.id}`} className="text-brand-primary mr-3">Ver</Link>
                        {gestion && r.status !== "published" && (
                          <button disabled={ocupado} onClick={() => publicar(r)} className="text-emerald-700 mr-3">
                            {r.status === "replaced" ? "Volver a publicar" : "Publicar"}
                          </button>
                        )}
                        {gestion && r.status === "published" && (
                          <button disabled={ocupado} onClick={() => setADespublicar(r)} className="text-brand-slate hover:text-brand-ink mr-3">Despublicar</button>
                        )}
                        {gestion && r.status !== "published" && (
                          <button disabled={ocupado} onClick={() => setAEliminar(r)} className="text-brand-slate hover:text-brand-primary">Eliminar</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      {dialogo}
      <ConfirmDialog
        open={!!aEliminar}
        variant="danger"
        title="Eliminar informe"
        confirmLabel="Eliminar"
        loading={ocupado}
        message={aEliminar && <>Se elimina el corte al <b>{fechaCorta(aEliminar.fecha_dato)}</b> de {nombrePeriodo(aEliminar.periodo)}. Queda registrado en auditoría.</>}
        onCancel={() => setAEliminar(null)}
        onConfirm={() => aEliminar && accion(async () => { await apiFetch(`${VN_API}/reports/${aEliminar.id}`, { method: "DELETE" }); setAEliminar(null); })}
      />
      <ConfirmDialog
        open={!!aDespublicar}
        title="Despublicar informe"
        confirmLabel="Despublicar"
        loading={ocupado}
        message={aDespublicar && <>{nombrePeriodo(aDespublicar.periodo)} queda <b>sin informe válido</b> hasta que publiques otro. Los demás perfiles dejan de verlo.</>}
        onCancel={() => setADespublicar(null)}
        onConfirm={() => aDespublicar && accion(async () => { await apiFetch(`${VN_API}/reports/${aDespublicar.id}/unpublish`, { method: "POST" }); setADespublicar(null); })}
      />
    </>
  );
}
