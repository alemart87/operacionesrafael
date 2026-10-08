"use client";

import { BarChart3, FileUp, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ParametrosModulo } from "@/components/productividad/Parametros";
import { usePublicar } from "@/components/productividad/PublicarDialog";
import { BandaChip } from "@/components/productividad/ui";
import {
  PROD_API, PROD_HREF, fechaHora, fechaLarga, horas, n, nombreMes, pct, type InformeResumen, type ListaInformes,
} from "@/components/productividad/tipos";
import { EstadoBadge } from "@/components/ventas-netas/ui";
import { apiFetch } from "@/lib/api";
import { PERM_PRODUCTIVIDAD_GESTION } from "@/lib/operativas";

export default function ProductividadPage() {
  return (
    <AppShell>
      <Informes />
    </AppShell>
  );
}

function Informes() {
  const { can } = useSession();
  const gestion = can(PERM_PRODUCTIVIDAD_GESTION);
  const [lista, setLista] = useState<ListaInformes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aEliminar, setAEliminar] = useState<InformeResumen | null>(null);
  const [aDespublicar, setADespublicar] = useState<InformeResumen | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const load = useCallback(async () => {
    try { setLista(await apiFetch<ListaInformes>(`${PROD_API}/informes`)); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { publicar, dialogo, error: errorPublicar } = usePublicar(load);
  const accion = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    try { await fn(); await load(); } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };

  // Agrupado por mes (ya viene ordenado: fecha desc, generado desc).
  const meses = useMemo(() => {
    const m = new Map<string, InformeResumen[]>();
    for (const r of lista?.items ?? []) m.set(r.fecha.slice(0, 7), [...(m.get(r.fecha.slice(0, 7)) ?? []), r]);
    return [...m.entries()].map(([mes, items]) => ({
      mes, items,
      publicados: new Set(items.filter((i) => i.status === "published").map((i) => i.fecha)).size,
      pendientes: new Set(items.filter((i) => i.status === "draft").map((i) => i.fecha)).size,
    }));
  }, [lista]);
  const nombre = (id: string | null) => (id && lista?.usuarios[id]) || "—";

  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Televentas CLARO</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Productividad de llamadas</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-3xl">
            Informe diario a partir del reporte <b>Tiempos Acumulados</b> de la plataforma: agentes conectados, llamadas,
            conversación contra la meta, efectividad de contacto, discador y turnos.{" "}
            {gestion ? "Cada corte actualiza el borrador de su día; publicás uno por día y los acumulados usan solo lo publicado."
              : "Se muestran los días publicados."}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`${PROD_HREF}/acumulado`} className="btn-secondary"><BarChart3 size={16} /> Semana y mes</Link>
          {gestion && <Link href={`${PROD_HREF}/subir`} className="btn-primary"><Upload size={16} /> Subir cortes</Link>}
        </div>
      </div>

      <div className="mb-6"><ParametrosModulo /></div>

      {(error || errorPublicar) && <div className="card p-4 text-brand-primary mb-4">{error || errorPublicar}</div>}

      {!lista ? (
        <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : meses.length === 0 ? (
        <div className="card p-12 text-center">
          <FileUp size={28} className="mx-auto text-brand-mist" />
          <p className="text-brand-slate mt-3">
            {gestion ? "Todavía no hay informes. Subí el primer reporte de Tiempos Acumulados para generarlo." : "Todavía no hay días publicados."}
          </p>
          {gestion && <Link href={`${PROD_HREF}/subir`} className="btn-primary mt-5 inline-flex"><Upload size={16} /> Subir cortes</Link>}
        </div>
      ) : (
        <div className="space-y-6">
          {meses.map((m) => (
            <section key={m.mes} className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-brand-border flex items-center justify-between gap-3 flex-wrap bg-brand-bg-soft">
                <div>
                  <h2 className="font-display text-2xl text-brand-ink uppercase leading-tight">{nombreMes(m.mes)}</h2>
                  <div className="text-xs text-brand-slate mt-0.5">
                    {n(m.publicados)} día(s) publicado(s){gestion && m.pendientes ? <> · <span className="text-brand-primary font-semibold">{n(m.pendientes)} con borrador sin publicar</span></> : null}
                  </div>
                </div>
                <Link href={`${PROD_HREF}/acumulado?mes=${m.mes}`} className="text-xs font-semibold text-brand-primary">Acumulado del mes →</Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[980px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
                      <th className="px-5 py-2.5">Fecha de gestión</th>
                      <th className="px-3 py-2.5">Estado</th>
                      <th className="px-3 py-2.5">Cortes</th>
                      <th className="px-3 py-2.5 text-right">Agentes</th>
                      <th className="px-3 py-2.5 text-right">Llamadas</th>
                      <th className="px-3 py-2.5 text-right">Contacto</th>
                      <th className="px-3 py-2.5">% Conversación</th>
                      <th className="px-3 py-2.5 text-right">Jornada media</th>
                      <th className="px-3 py-2.5 text-right">Alertas</th>
                      <th className="px-5 py-2.5 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.items.map((r) => (
                      <tr key={r.id} className={`border-b border-brand-border/60 ${r.status === "published" ? "bg-emerald-50/40" : r.status === "replaced" ? "text-brand-mist" : "hover:bg-brand-bg/50"}`}>
                        <td className="px-5 py-2.5">
                          <Link href={`${PROD_HREF}/informes/${r.id}`} className="font-semibold text-brand-ink hover:text-brand-primary capitalize">{fechaLarga(r.fecha)}</Link>
                          {r.status === "published" && <div className="text-[11px] text-brand-slate">{nombre(r.published_by)} · {fechaHora(r.published_at)}</div>}
                          {r.status === "replaced" && <div className="text-[11px]">Reemplazado el {fechaHora(r.replaced_at)}</div>}
                        </td>
                        <td className="px-3 py-2.5"><EstadoBadge estado={r.status} /></td>
                        <td className="px-3 py-2.5 text-xs tabular-nums">{n(r.cortes)} · hasta las {r.corte_final ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{n(r.agentes)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{n(r.llamadas)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.pct_contacto)}</td>
                        <td className="px-3 py-2.5"><BandaChip banda={r.banda} valor={r.pct_conversacion} compacto /></td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{horas(r.jornada_media)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.alertas ? <span className="font-semibold text-brand-primary-dark">{n(r.alertas)}</span> : "—"}</td>
                        <td className="px-5 py-2.5 text-right whitespace-nowrap text-xs font-semibold">
                          <Link href={`${PROD_HREF}/informes/${r.id}`} className="text-brand-primary mr-3">Ver</Link>
                          {gestion && r.status !== "published" && (
                            <button disabled={ocupado} onClick={() => publicar(r)} className="text-emerald-700 mr-3">{r.status === "replaced" ? "Volver a publicar" : "Publicar"}</button>
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
              </div>
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
        message={aEliminar && <>Se elimina el informe del <b>{fechaLarga(aEliminar.fecha)}</b>. Los cortes subidos quedan guardados: si subís otro, se vuelve a generar el borrador del día. Queda registrado en auditoría.</>}
        onCancel={() => setAEliminar(null)}
        onConfirm={() => aEliminar && accion(async () => { await apiFetch(`${PROD_API}/informes/${aEliminar.id}`, { method: "DELETE" }); setAEliminar(null); })}
      />
      <ConfirmDialog
        open={!!aDespublicar}
        title="Despublicar informe"
        confirmLabel="Despublicar"
        loading={ocupado}
        message={aDespublicar && <>El <b>{fechaLarga(aDespublicar.fecha)}</b> queda <b>sin informe válido</b> y sale de los acumulados hasta que publiques otro. Los demás perfiles dejan de verlo.</>}
        onCancel={() => setADespublicar(null)}
        onConfirm={() => aDespublicar && accion(async () => { await apiFetch(`${PROD_API}/informes/${aDespublicar.id}/despublicar`, { method: "POST" }); setADespublicar(null); })}
      />
    </>
  );
}
