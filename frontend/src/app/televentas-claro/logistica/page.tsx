"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { usePublicarLogistica } from "@/components/logistica/PublicarLogistica";
import { ESTADO_LABEL, LOG_API, LOG_HREF, dias, fechaCorta, fechaHora, n, nombrePeriodo, pct, type InformeResumen, type ListaInformes } from "@/components/logistica/tipos";
import { apiFetch } from "@/lib/api";
import { PERM_LOGISTICA_GESTION } from "@/lib/operativas";

export default function LogisticaPage() {
  return (
    <AppShell>
      <Informes />
    </AppShell>
  );
}

/** La demora de los pendientes, de un vistazo y por región: promedio, máximo y cuántos llevan 6 días hábiles o más (sin domingos). */
function DemoraPorRegion({ r }: { r: InformeResumen }) {
  const regiones = Object.entries(r.demora_regiones ?? {});
  if (!r.en_gestion) return <span className="text-xs text-brand-mist">Sin pendientes</span>;
  return (
    <div className="text-xs space-y-0.5 whitespace-nowrap">
      <div className="tabular-nums"><b className="text-brand-ink">{dias(r.demora_prom)}</b> <span className="text-brand-slate">prom. · máx {r.demora_max ?? "—"} · {n(r.en_gestion)} pendientes</span></div>
      {regiones.map(([region, d]) => (
        <div key={region} className="tabular-nums flex items-center gap-1.5">
          <span className="inline-block w-16 text-[10px] uppercase tracking-wider2 text-brand-slate font-semibold">{region}</span>
          <b className={`${(d.dias_prom ?? 0) >= 6 ? "text-brand-primary" : "text-brand-graphite"}`}>{dias(d.dias_prom)}</b>
          <span className="text-brand-slate">· máx {d.dias_max ?? "—"} · {n(d.n)} pend.</span>
          {d.vencidos_6 > 0 && <span className="rounded-full bg-brand-primary-light text-brand-primary-dark px-1.5 font-semibold">{n(d.vencidos_6)} de 6+ d</span>}
        </div>
      ))}
    </div>
  );
}

function Badge({ estado }: { estado: InformeResumen["status"] }) {
  const cls = estado === "published" ? "badge-success" : estado === "replaced" ? "badge-neutral line-through" : "badge-cyan";
  return <span className={cls}>{ESTADO_LABEL[estado]}</span>;
}

function Informes() {
  const { can } = useSession();
  const gestion = can(PERM_LOGISTICA_GESTION);
  const [lista, setLista] = useState<ListaInformes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aEliminar, setAEliminar] = useState<InformeResumen | null>(null);
  const [aDespublicar, setADespublicar] = useState<InformeResumen | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const load = useCallback(async () => {
    try { setLista(await apiFetch<ListaInformes>(`${LOG_API}/informes`)); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const { publicar, dialogo, error: errorPublicar } = usePublicarLogistica(load);
  const accion = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    try { await fn(); await load(); } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };

  const meses = useMemo(() => {
    const m = new Map<string, InformeResumen[]>();
    for (const r of lista?.items ?? []) m.set(r.periodo, [...(m.get(r.periodo) ?? []), r]);
    return [...m.entries()].map(([periodo, items]) => {
      const publicado = items.find((i) => i.status === "published") ?? null;
      const masNuevo = publicado && items.some((i) => i.status === "draft" && i.fecha_corte > publicado.fecha_corte);
      return { periodo, publicado, items, masNuevo };
    });
  }, [lista]);
  const nombre = (id: string | null) => (id && lista?.usuarios[id]) || "—";

  return (
    <>
      <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Televentas CLARO</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Logística de entregas</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-2xl">
            Los pedidos del mes a partir del corte de logística: entregados, en gestión y devueltos por región, motivos, línea de tiempo,
            pendientes y demora por zona. {gestion ? "Cada corte genera un borrador; solo un informe publicado vale por mes." : "Se muestran los informes publicados de cada mes."}
          </p>
        </div>
        {gestion && <Link href={`${LOG_HREF}/upload`} className="btn-primary" data-voi="subir">Subir corte</Link>}
      </div>
      {(error || errorPublicar) && <div className="card p-4 text-brand-primary mb-4">{error || errorPublicar}</div>}

      {!lista ? <div className="card p-10 text-brand-slate">Cargando…</div> : meses.length === 0 ? (
        <div className="card p-12 text-center text-brand-slate">{gestion ? "Aún no hay informes. Subí el primer corte de pedidos para generarlo." : "Todavía no hay informes publicados."}</div>
      ) : (
        <div className="space-y-6">
          {meses.map((m) => (
            <section key={m.periodo} className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-brand-border flex items-center justify-between gap-3 flex-wrap bg-brand-bg-soft">
                <div>
                  <h2 className="font-display text-2xl text-brand-ink uppercase leading-tight">{nombrePeriodo(m.periodo)}</h2>
                  <div className="text-xs text-brand-slate mt-0.5">
                    {m.publicado ? <>Publicado el corte del <b>{fechaCorta(m.publicado.fecha_corte)}</b> · {n(m.publicado.pedidos)} pedidos · {pct(m.publicado.pct_entregados)} entregados · {n(m.publicado.en_gestion)} en gestión</>
                      : <span className="text-brand-primary font-semibold">Sin publicación este mes</span>}
                  </div>
                </div>
                {m.masNuevo && <span className="badge-primary">Hay un corte más reciente sin publicar</span>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[860px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
                      <th className="px-5 py-2.5">Corte</th><th className="px-3 py-2.5">Estado</th>
                      <th className="px-3 py-2.5 text-right">Pedidos</th><th className="px-3 py-2.5 text-right">Entregados</th>
                      <th className="px-3 py-2.5 text-right">En gestión</th><th className="px-3 py-2.5 text-right">Devueltos</th>
                      <th className="px-3 py-2.5">Demora de pendientes</th><th className="px-3 py-2.5 text-right">Proyección fin de mes</th><th className="px-3 py-2.5">Generado</th>
                      <th className="px-5 py-2.5 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.items.map((r) => (
                      <tr key={r.id} className={`border-b border-brand-border/60 ${r.status === "published" ? "bg-emerald-50/40" : r.status === "replaced" ? "text-brand-mist" : "hover:bg-brand-bg/50"}`}>
                        <td className="px-5 py-2.5">
                          <Link href={`${LOG_HREF}/informes/${r.id}`} className="font-semibold text-brand-ink hover:text-brand-primary">Corte del {fechaCorta(r.fecha_corte)}</Link>
                          <div className="text-[11px] text-brand-slate">ventas hasta el {fechaCorta(r.fecha_dato)}{r.title ? ` · ${r.title}` : ""}</div>
                          {r.status === "published" && <div className="text-[11px] text-brand-slate">{nombre(r.published_by)} · {fechaHora(r.published_at)}</div>}
                          {r.status === "replaced" && <div className="text-[11px]">Reemplazado el {fechaHora(r.replaced_at)}</div>}
                        </td>
                        <td className="px-3 py-2.5"><Badge estado={r.status} /></td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{n(r.pedidos)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{n(r.entregados)} <span className="text-brand-slate">({pct(r.pct_entregados)})</span></td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{n(r.en_gestion)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{n(r.devueltos)}</td>
                        <td className="px-3 py-2.5"><DemoraPorRegion r={r} /></td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.proyeccion ? <><b className="text-brand-ink">{n(r.proyeccion)}</b><div className="text-[11px] text-brand-slate">pedidos al cierre</div></> : <span className="text-brand-mist text-xs">—</span>}</td>
                        <td className="px-3 py-2.5 text-xs text-brand-slate">{nombre(r.generated_by)}<br />{fechaHora(r.generated_at)}</td>
                        <td className="px-5 py-2.5 text-right whitespace-nowrap text-xs font-semibold">
                          <Link href={`${LOG_HREF}/informes/${r.id}`} className="text-brand-primary mr-3">Ver</Link>
                          {gestion && r.status !== "published" && <button data-voi="publicar" disabled={ocupado} onClick={() => publicar(r)} className="text-emerald-700 mr-3">{r.status === "replaced" ? "Volver a publicar" : "Publicar"}</button>}
                          {gestion && r.status === "published" && <button disabled={ocupado} onClick={() => setADespublicar(r)} className="text-brand-slate hover:text-brand-ink mr-3">Despublicar</button>}
                          {gestion && r.status !== "published" && <button disabled={ocupado} onClick={() => setAEliminar(r)} className="text-brand-slate hover:text-brand-primary">Eliminar</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
      {dialogo}
      <ConfirmDialog open={!!aEliminar} variant="danger" title="Eliminar informe" confirmLabel="Eliminar" loading={ocupado}
        message={aEliminar && <>Se elimina el corte del <b>{fechaCorta(aEliminar.fecha_corte)}</b> de {nombrePeriodo(aEliminar.periodo)}. Queda registrado en auditoría.</>}
        onCancel={() => setAEliminar(null)}
        onConfirm={() => aEliminar && accion(async () => { await apiFetch(`${LOG_API}/informes/${aEliminar.id}`, { method: "DELETE" }); setAEliminar(null); })} />
      <ConfirmDialog open={!!aDespublicar} title="Despublicar informe" confirmLabel="Despublicar" loading={ocupado}
        message={aDespublicar && <>{nombrePeriodo(aDespublicar.periodo)} queda <b>sin informe válido</b> hasta que publiques otro. Los demás perfiles dejan de verlo.</>}
        onCancel={() => setADespublicar(null)}
        onConfirm={() => aDespublicar && accion(async () => { await apiFetch(`${LOG_API}/informes/${aDespublicar.id}/despublicar`, { method: "POST" }); setADespublicar(null); })} />
    </>
  );
}
