"use client";

import { Calculator, Gauge, Link2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { fechaCorta, fechaHora, n, nombreMes, pct } from "@/components/productividad/tipos";
import { CalcularSph } from "@/components/sph/CalcularSph";
import { usePublicarSph } from "@/components/sph/PublicarSph";
import {
  SPH_API, SPH_HREF, TIPO_LABEL, etiquetaPeriodo, fmtSph, type InformeSphResumen, type ListaSph, type TipoPeriodo,
} from "@/components/sph/tipos";
import { MetodoSph } from "@/components/sph/ui";
import { EstadoBadge } from "@/components/ventas-netas/ui";
import { apiFetch } from "@/lib/api";
import { PERM_SPH_GESTION } from "@/lib/operativas";

export default function SphPage() {
  return (
    <AppShell>
      <Informes />
    </AppShell>
  );
}

function Informes() {
  const { can } = useSession();
  const gestion = can(PERM_SPH_GESTION);
  const [lista, setLista] = useState<ListaSph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calcular, setCalcular] = useState<TipoPeriodo | null>(null);
  const [tipo, setTipo] = useState<TipoPeriodo | "todos">("todos");
  const [aEliminar, setAEliminar] = useState<InformeSphResumen | null>(null);
  const [aDespublicar, setADespublicar] = useState<InformeSphResumen | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const load = useCallback(async () => {
    try { setLista(await apiFetch<ListaSph>(`${SPH_API}/informes`)); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { publicar, dialogo, error: errorPublicar } = usePublicarSph(load);
  const accion = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    try { await fn(); await load(); } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };

  const conteo = useMemo(() => {
    const c: Record<string, number> = { todos: lista?.items.length ?? 0 };
    for (const r of lista?.items ?? []) c[r.tipo] = (c[r.tipo] ?? 0) + 1;
    return c;
  }, [lista]);

  const meses = useMemo(() => {
    const m = new Map<string, InformeSphResumen[]>();
    for (const r of (lista?.items ?? []).filter((x) => tipo === "todos" || x.tipo === tipo)) {
      m.set(r.desde.slice(0, 7), [...(m.get(r.desde.slice(0, 7)) ?? []), r]);
    }
    return [...m.entries()].map(([mes, items]) => ({
      mes, items,
      publicados: new Set(items.filter((i) => i.status === "published").map((i) => `${i.desde}|${i.hasta}`)).size,
      pendientes: new Set(items.filter((i) => i.status === "draft").map((i) => `${i.desde}|${i.hasta}`)).size,
    }));
  }, [lista, tipo]);
  const nombre = (id: string | null) => (id && lista?.usuarios[id]) || "—";

  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Televentas CLARO</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">SPH estimado</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-3xl">
            Ventas netas por hora conectada: cruza las horas del informe de <b>Productividad</b> con las netas del informe de{" "}
            <b>Ventas Netas</b>, por fecha de venta. El SPH de la operación sale de los totales; el de cada asesor es estimado
            porque el cruce es por nombre.{" "}
            {gestion ? "Calculás un día, una semana, un mes o un rango; lo revisás y publicás uno por período." : "Se muestran los períodos publicados."}
          </p>
        </div>
        {gestion && (
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <Link href={`${SPH_HREF}/vinculos`} className="btn-secondary"><Link2 size={16} /> Vínculos</Link>
            <div className="flex w-full sm:w-auto items-stretch rounded-md overflow-hidden shadow-soft" role="group" aria-label="Calcular SPH">
              <span className="flex items-center gap-1.5 bg-brand-primary text-white text-xs font-semibold uppercase tracking-wider2 px-3">
                <Calculator size={15} /><span className="hidden sm:inline">Calcular SPH</span>
              </span>
              {(["dia", "semana", "mes", "rango"] as TipoPeriodo[]).map((t) => (
                <button key={t} type="button" onClick={() => setCalcular(t)} aria-label={`Calcular SPH: ${TIPO_LABEL[t]}`}
                  className="flex-1 sm:flex-none bg-white border-y border-r border-brand-primary/40 px-2.5 sm:px-3.5 py-2 text-sm font-semibold text-brand-primary hover:bg-brand-primary hover:text-white transition-colors">
                  {TIPO_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {(error || errorPublicar) && <div className="card p-4 text-brand-primary mb-4">{error || errorPublicar}</div>}

      {!lista ? (
        <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : meses.length === 0 ? (
        <div className="card p-12 text-center">
          <Gauge size={28} className="mx-auto text-brand-mist" />
          <p className="text-brand-slate mt-3 max-w-xl mx-auto">
            {gestion
              ? "Todavía no hay SPH calculados. Necesitás el informe de Productividad del día y el de Ventas Netas de ese mes: con los dos cargados, calculalo."
              : "Todavía no hay días publicados."}
          </p>
          {gestion && <button type="button" onClick={() => setCalcular("dia")} className="btn-primary mt-5 inline-flex"><Calculator size={16} /> Calcular SPH</button>}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por período">
            {(["todos", "dia", "semana", "mes", "rango"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTipo(t)} aria-pressed={tipo === t}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${tipo === t ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-slate border-brand-border hover:border-brand-ink"}`}>
                {t === "todos" ? "Todos" : { dia: "Días", semana: "Semanas", mes: "Meses", rango: "Rangos" }[t]}
                <span className={`ml-1.5 tabular-nums ${tipo === t ? "text-white/70" : "opacity-70"}`}>{conteo[t] ?? 0}</span>
              </button>
            ))}
          </div>
          {!meses.length && <div className="card p-8 text-center text-sm text-brand-slate">No hay SPH de ese tipo todavía.</div>}
          {meses.map((m) => (
            <section key={m.mes} className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-brand-border bg-brand-bg-soft">
                <h2 className="font-display text-2xl text-brand-ink uppercase leading-tight">{nombreMes(m.mes)}</h2>
                <div className="text-xs text-brand-slate mt-0.5">
                  {n(m.publicados)} publicado(s){gestion && m.pendientes ? <> · <span className="text-brand-primary font-semibold">{n(m.pendientes)} con borrador sin publicar</span></> : null}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[920px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
                      <th className="px-5 py-2.5">Período</th>
                      <th className="px-3 py-2.5">Estado</th>
                      <th className="px-3 py-2.5 text-right">SPH</th>
                      <th className="px-3 py-2.5 text-right">Netas</th>
                      <th className="px-3 py-2.5 text-right" title="Días que cuentan: con horas y ventas al corte">Días</th>
                      <th className="px-3 py-2.5 text-right">Horas</th>
                      <th className="px-3 py-2.5 text-right">Asesores vinculados</th>
                      <th className="px-3 py-2.5 text-right">Netas con asesor</th>
                      <th className="px-3 py-2.5">Corte de ventas</th>
                      <th className="px-5 py-2.5 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.items.map((r) => (
                      <tr key={r.id} className={`border-b border-brand-border/60 ${r.status === "published" ? "bg-emerald-50/40" : r.status === "replaced" ? "text-brand-mist" : "hover:bg-brand-bg/50"}`}>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link href={`${SPH_HREF}/informes/${r.id}`} className="font-semibold text-brand-ink hover:text-brand-primary">{etiquetaPeriodo(r.desde, r.hasta, r.tipo)}</Link>
                            {r.tipo !== "dia" && <span className="badge-neutral">{TIPO_LABEL[r.tipo]}</span>}
                          </div>
                          {r.status === "published" && <div className="text-[11px] text-brand-slate">{nombre(r.published_by)} · {fechaHora(r.published_at)}</div>}
                          {r.status === "replaced" && <div className="text-[11px]">Reemplazado el {fechaHora(r.replaced_at)}</div>}
                        </td>
                        <td className="px-3 py-2.5"><EstadoBadge estado={r.status} /></td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-display text-lg text-brand-ink">{fmtSph(r.sph)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{n(r.netas)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{n(r.dias)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.horas.toLocaleString("es-PY", { maximumFractionDigits: 1 })} h</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{n(r.vinculados)} de {n(r.agentes)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.pct_cobertura)}</td>
                        <td className="px-3 py-2.5 text-xs capitalize">{r.ventas_corte ? fechaCorta(r.ventas_corte) : "—"}</td>
                        <td className="px-5 py-2.5 text-right whitespace-nowrap text-xs font-semibold">
                          <Link href={`${SPH_HREF}/informes/${r.id}`} className="text-brand-primary mr-3">Ver</Link>
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

      <div className="mt-6"><MetodoSph /></div>

      {dialogo}
      <CalcularSph abierto={!!calcular} tipo={calcular ?? "dia"} onCerrar={() => setCalcular(null)} />
      <ConfirmDialog
        open={!!aEliminar}
        variant="danger"
        title="Eliminar SPH"
        confirmLabel="Eliminar"
        loading={ocupado}
        message={aEliminar && <>Se elimina el SPH de <b>{etiquetaPeriodo(aEliminar.desde, aEliminar.hasta, aEliminar.tipo)}</b>. Los informes de Productividad y Ventas Netas no cambian: podés volver a calcularlo. Queda registrado en auditoría.</>}
        onCancel={() => setAEliminar(null)}
        onConfirm={() => aEliminar && accion(async () => { await apiFetch(`${SPH_API}/informes/${aEliminar.id}`, { method: "DELETE" }); setAEliminar(null); })}
      />
      <ConfirmDialog
        open={!!aDespublicar}
        title="Despublicar SPH"
        confirmLabel="Despublicar"
        loading={ocupado}
        message={aDespublicar && <><b>{etiquetaPeriodo(aDespublicar.desde, aDespublicar.hasta, aDespublicar.tipo)}</b> queda <b>sin SPH publicado</b> hasta que publiques otro. Los demás perfiles dejan de verlo.</>}
        onCancel={() => setADespublicar(null)}
        onConfirm={() => aDespublicar && accion(async () => { await apiFetch(`${SPH_API}/informes/${aDespublicar.id}/despublicar`, { method: "POST" }); setADespublicar(null); })}
      />
    </>
  );
}
