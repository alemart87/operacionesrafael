"use client";

import { ArrowRight, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { n } from "@/components/productividad/tipos";
import { Desglose, MedidorScore, MetodoScoring, ScoreCelda, Tendencia } from "@/components/supervision/scoring";
import { SUP_API, SUP_HREF, dm, num, periodoDeUrl, periodoEnUrl, type Componente, type Tablero } from "@/components/supervision/tipos";
import { CriticoBadge, FuenteDatos, SelectorMes } from "@/components/supervision/ui";
import { apiFetch } from "@/lib/api";
import { PERM_SUPERVISION_PARAMETROS } from "@/lib/operativas";

export default function TableroPage() {
  return (
    <AppShell>
      <Vista />
    </AppShell>
  );
}

const comp = (cs: Componente[], clave: string) => cs.find((c) => c.clave === clave);

/** Valor corto de un componente para la tabla (el detalle completo va en el título). */
function Valor({ c, sufijo = "%" }: { c?: Componente; sufijo?: string }) {
  if (!c || c.valor === null) return <span className="text-brand-mist">—</span>;
  const malo = c.rel !== null && c.rel < 0.5;
  return (
    <span className={`tabular-nums ${c.rel === null ? "text-brand-slate" : malo ? "text-brand-primary-dark font-semibold" : "text-brand-ink"}`}
      title={c.rel === null ? "No se evalúa (datos insuficientes)" : `${num(c.puntos)} de ${num(c.peso_efectivo)} puntos`}>
      {num(c.valor, 0)}{sufijo}{c.sobre_meta ? " ↑" : ""}
    </span>
  );
}

function Vista() {
  const { can } = useSession();
  const [periodo, setPeriodo] = useState(periodoDeUrl);
  const [t, setT] = useState<Tablero | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sup, setSup] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async (p: string) => {
    setError(null);
    try { setT(await apiFetch<Tablero>(`${SUP_API}/tablero?periodo=${p}`)); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { setT(null); load(periodo); periodoEnUrl(periodo); }, [periodo, load]);

  const asesores = useMemo(() => {
    const b = q.trim().toLowerCase();
    return (t?.asesores ?? []).filter((a) => (!sup || (sup === "__sin__" ? !a.supervisor_id : a.supervisor_id === sup))
      && (!b || [a.nombre, a.vendedor, a.agente].some((x) => x?.toLowerCase().includes(b))));
  }, [t, sup, q]);

  const mesAnt = t?.anterior.nombre_mes;
  const pr = t ? { min_evaluables: t.parametros.min_evaluables, min_horas: t.scoring.min_horas_conversacion } : undefined;
  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Supervisión</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Tablero y scoring</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-3xl">
            Puntaje de 0 a 100 de la operación, de cada supervisor y de cada asesor: ventas contra objetivo, uso de las líneas y
            conversación. La flecha compara con el mes anterior.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SelectorMes periodo={periodo} onChange={setPeriodo} />
          {can(PERM_SUPERVISION_PARAMETROS) && (
            <Link href={`${SUP_HREF}/parametros`} className="btn-secondary"><SlidersHorizontal size={15} /> Parámetros</Link>
          )}
        </div>
      </div>
      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {!t ? (
        !error && <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <FuenteDatos ventas={t.ventas} cal={t.calendario} />
            <span className="text-xs text-brand-slate">
              Productividad: {n(t.scoring.productividad?.dias ?? 0)} día(s){t.scoring.productividad?.ultimo_dia ? `, hasta el ${dm(t.scoring.productividad.ultimo_dia)}` : ""}
              {!!t.scoring.productividad?.borradores && ` (${t.scoring.productividad.borradores} en borrador)`}
            </span>
          </div>

          <section className="card p-5 grid lg:grid-cols-[minmax(240px,0.6fr)_minmax(0,1.4fr)] gap-6">
            <div className="flex flex-col justify-between gap-4">
              <div>
                <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Operación</h2>
                <p className="text-xs text-brand-slate mt-0.5">{t.nombre_mes} · contra la suma de los objetivos</p>
              </div>
              <div>
                <div className="font-display text-6xl text-brand-ink leading-none">{t.operacion.total === null ? "—" : num(t.operacion.total, 0)}<span className="text-xl text-brand-slate"> / 100</span></div>
                <div className="mt-2"><Tendencia actual={t.operacion.total} anterior={t.operacion.anterior} mes={mesAnt} /></div>
              </div>
              <MedidorScore total={t.operacion.total} />
            </div>
            <Desglose comps={t.operacion.componentes} pr={pr} />
          </section>

          <section className="card min-w-0">
            <div className="p-5 pb-3">
              <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Supervisores</h2>
              <p className="text-xs text-brand-slate mt-0.5">
                Ordenados por puntaje. {t.scoring.supervisor.resultado} puntos por el resultado del equipo y {100 - t.scoring.supervisor.resultado} por la
                gestión (se suma con los registros de coaching y de tickets).
              </p>
            </div>
            {!t.supervisores.length ? (
              <p className="px-5 pb-6 text-sm text-brand-slate">No hay supervisores con equipo este mes.</p>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm min-w-[880px]">
                  <thead>
                    <tr className="bg-brand-bg text-[10px] uppercase tracking-wider2 text-brand-slate">
                      <th className="text-left px-5 py-2.5 w-10">#</th>
                      <th className="text-left px-3 py-2.5">Supervisor</th>
                      <th className="text-right px-3 py-2.5">Score</th>
                      <th className="text-left px-3 py-2.5">Tendencia</th>
                      <th className="text-right px-3 py-2.5" title="Lo vendido contra lo esperado al corte">Pospago</th>
                      <th className="text-right px-3 py-2.5">GPON</th>
                      <th className="text-right px-3 py-2.5" title="% de líneas Pospago evaluables sin uso">Sin uso</th>
                      <th className="text-right px-3 py-2.5">Conv.</th>
                      <th className="text-left px-3 py-2.5">Alertas</th>
                      <th className="px-5 py-2.5"><span className="sr-only">Detalle</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.supervisores.map((s, i) => (
                      <tr key={s.id} className="border-t border-brand-border">
                        <td className="px-5 py-3 text-brand-slate tabular-nums">{s.total === null ? "—" : i + 1}</td>
                        <td className="px-3 py-3 min-w-[180px]">
                          <div className="font-semibold text-brand-ink">{s.nombre}</div>
                          <div className="text-[11px] text-brand-slate">{s.asesores} asesor(es){!s.activo && " · ya no es supervisor"}</div>
                        </td>
                        <td className="px-3 py-3"><ScoreCelda total={s.total} parcial={s.parcial} /></td>
                        <td className="px-3 py-3"><Tendencia actual={s.total} anterior={s.anterior} /></td>
                        <td className="px-3 py-3 text-right"><Valor c={comp(s.componentes, "pospago")} /></td>
                        <td className="px-3 py-3 text-right"><Valor c={comp(s.componentes, "gpon")} /></td>
                        <td className="px-3 py-3 text-right"><Valor c={comp(s.componentes, "uso")} /></td>
                        <td className="px-3 py-3 text-right"><Valor c={comp(s.componentes, "conversacion")} /></td>
                        <td className="px-3 py-3"><CriticoBadge critico={s.critico} enAlerta={s.asesores_en_alerta} /></td>
                        <td className="px-5 py-3 text-right">
                          <Link href={`${SUP_HREF}/supervisores/${s.id}?periodo=${periodo}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline whitespace-nowrap">
                            Detalle <ArrowRight size={13} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card min-w-0">
            <div className="p-5 pb-3 flex items-end justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Asesores</h2>
                <p className="text-xs text-brand-slate mt-0.5">
                  Pospago y GPON contra su objetivo de referencia (la parte del objetivo del equipo según los días que trabajó). ↑ = conversación sobre la meta.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select className="input py-1.5 w-52" value={sup} onChange={(e) => setSup(e.target.value)} aria-label="Filtrar por supervisor">
                  <option value="">Todos los supervisores</option>
                  {t.supervisores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  <option value="__sin__">Sin supervisor</option>
                </select>
                <label className="relative">
                  <span className="sr-only">Buscar asesor</span>
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mist" aria-hidden />
                  <input className="input pl-9 py-1.5 w-56" placeholder="Buscar asesor" value={q} onChange={(e) => setQ(e.target.value)} />
                </label>
              </div>
            </div>
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm min-w-[880px]">
                <thead>
                  <tr className="bg-brand-bg text-[10px] uppercase tracking-wider2 text-brand-slate">
                    <th className="text-left px-5 py-2.5">Asesor</th>
                    <th className="text-left px-3 py-2.5">Supervisor</th>
                    <th className="text-right px-3 py-2.5">Score</th>
                    <th className="text-left px-3 py-2.5">Tendencia</th>
                    <th className="text-right px-3 py-2.5">Pospago</th>
                    <th className="text-right px-3 py-2.5">GPON</th>
                    <th className="text-right px-3 py-2.5">Sin uso</th>
                    <th className="text-right px-3 py-2.5">Conv.</th>
                    <th className="text-right px-5 py-2.5" title="Días trabajados en el equipo hasta el corte de ventas">Días</th>
                  </tr>
                </thead>
                <tbody>
                  {asesores.map((a) => (
                    <tr key={a.id} className={`border-t border-brand-border ${a.alerta ? "shadow-[inset_3px_0_0_#E6332A]" : ""}`}>
                      <td className="px-5 py-2.5 min-w-[200px]">
                        <div className="font-semibold text-brand-ink">{a.nombre}</div>
                        <div className="text-[11px] text-brand-slate">{a.vendedor ?? "Sin nombre de vendedor"}</div>
                      </td>
                      <td className="px-3 py-2.5 text-brand-slate">{a.supervisor ?? <span className="text-brand-mist">Sin supervisor</span>}</td>
                      <td className="px-3 py-2.5"><ScoreCelda total={a.total} parcial={a.parcial} /></td>
                      <td className="px-3 py-2.5"><Tendencia actual={a.total} anterior={a.anterior} /></td>
                      <td className="px-3 py-2.5 text-right"><Valor c={comp(a.componentes, "pospago")} /></td>
                      <td className="px-3 py-2.5 text-right"><Valor c={comp(a.componentes, "gpon")} /></td>
                      <td className="px-3 py-2.5 text-right"><Valor c={comp(a.componentes, "uso")} /></td>
                      <td className="px-3 py-2.5 text-right"><Valor c={comp(a.componentes, "conversacion")} /></td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-brand-slate">{a.dias === null ? "—" : num(a.dias)}</td>
                    </tr>
                  ))}
                  {!asesores.length && <tr><td colSpan={9} className="px-5 py-6 text-center text-sm text-brand-slate">Sin asesores con ese filtro.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <MetodoScoring p={t.scoring} umbral={t.parametros.umbral_sin_uso} minEvaluables={t.parametros.min_evaluables} />
        </div>
      )}
    </>
  );
}
