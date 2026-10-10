"use client";

import { CircleCheck, Info, ListChecks, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrintButton } from "@/components/PrintButton";
import { fechaLarga, n } from "@/components/productividad/tipos";
import { MetodoCoaching } from "@/components/supervision/coaching";
import { MedidorScore } from "@/components/supervision/scoring";
import {
  SUP_API, SUP_HREF, num, periodoDeUrl, periodoEnUrl, type Componente, type FilaGestion, type GestionCoaching,
} from "@/components/supervision/tipos";
import { SelectorMes } from "@/components/supervision/ui";
import { apiFetch } from "@/lib/api";

/** Gestión de coaching de todos los supervisores: qué registró cada uno y qué tiene vencido (jefes). */
export default function GestionCoachingPage() {
  return (
    <AppShell>
      <Gestion />
    </AppShell>
  );
}

const pl = (k: number, uno: string, varios: string) => `${n(k)} ${k === 1 ? uno : varios}`;
const ROJO = "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30";
const NARANJA = "bg-brand-orange/10 text-[#8A5200] border-brand-orange/40";

function Kpi({ titulo, valor, sub, alerta, barra }: { titulo: string; valor: string; sub?: string; alerta?: boolean; barra?: number | null }) {
  return (
    <div className={`card p-4 flex flex-col gap-2 min-w-0 ${alerta ? "border-brand-primary/40" : ""}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate">{titulo}</div>
      <div className={`font-display text-4xl leading-none tabular-nums ${alerta ? "text-brand-primary-dark" : "text-brand-ink"}`}>{valor}</div>
      {barra !== undefined && <MedidorScore total={barra ?? null} alto="h-1.5" />}
      {sub && <p className="text-xs text-brand-slate leading-snug">{sub}</p>}
    </div>
  );
}

function CeldaParte({ p }: { p: Componente | undefined }) {
  if (!p) return <span className="text-brand-mist">—</span>;
  if (p.rel === null) {
    return <span className="text-[11px] text-brand-mist" title={p.detalle}>{p.pendiente ? "Pendiente" : "Sin casos"}</span>;
  }
  return (
    <div className="min-w-[96px]" title={p.detalle}>
      <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
        <b className="text-brand-ink text-sm">{num(p.valor, 0)}%</b>
        <span className="text-brand-slate">{n(p.con)}/{n(p.de)}</span>
      </div>
      <div className="mt-1"><MedidorScore total={p.valor} alto="h-1" /></div>
    </div>
  );
}

function Actividad({ f }: { f: FilaGestion }) {
  if (f.dias_sin_actividad === null) return <span className="text-[11px] text-brand-mist">Sin registros</span>;
  const d = f.dias_sin_actividad;
  const texto = d === 0 ? "Hoy" : d === 1 ? "Ayer" : `Hace ${d} días`;
  return <span className={`text-xs font-semibold ${d >= 3 ? "text-[#8A5200]" : "text-brand-ink"}`} title={fechaLarga(f.ultima_actividad)}>{texto}</span>;
}

function Gestion() {
  const [periodo, setPeriodo] = useState(periodoDeUrl);
  const [d, setD] = useState<GestionCoaching | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (p: string) => {
    setError(null);
    try { setD(await apiFetch<GestionCoaching>(`${SUP_API}/gestion?periodo=${p}`)); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { setD(null); load(periodo); periodoEnUrl(periodo); }, [periodo, load]);

  const op = d?.operacion;
  const cobertura = op && op.asesores ? (op.con_coaching / op.asesores) * 100 : null;
  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Supervisión · {d?.nombre_mes ?? "…"}</div>
          <h1 className="font-display text-4xl sm:text-5xl text-brand-ink uppercase leading-tight">Gestión de coaching</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-2xl">
            Qué registró cada supervisor en su portal: coachings, seguimientos y alertas de uso. Primero, quien tiene algo vencido.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap print:hidden">
          <Link href={`${SUP_HREF}/coaching/registro`} className="btn-secondary !py-2 !px-4 text-xs">
            <ListChecks size={15} /> Registro por fechas
          </Link>
          <SelectorMes periodo={periodo} onChange={setPeriodo} />
          <PrintButton />
        </div>
      </div>
      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {!d || !op ? (
        !error && <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : (
        <div className="space-y-6">
          {d.gestion_desde && d.gestion_desde.slice(0, 7) >= d.periodo && (
            <p className="text-xs text-[#1D5BA6] bg-[#2A78D6]/10 border border-[#2A78D6]/30 rounded-md px-3 py-2 flex items-start gap-2">
              <Info size={14} className="shrink-0 mt-0.5" aria-hidden />
              {d.gestion_desde.slice(0, 7) > d.periodo
                ? `La gestión se mide desde el ${fechaLarga(d.gestion_desde)}: este mes no suma al scoring.`
                : `La gestión se mide desde el ${fechaLarga(d.gestion_desde)}, el día en que empezó el registro de coaching.`}
            </p>
          )}
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Kpi titulo="Cobertura de la operación" valor={cobertura === null ? "—" : `${num(cobertura, 0)}%`} barra={cobertura}
              sub={`${n(op.con_coaching)} de los ${pl(op.asesores, "asesor", "asesores")} con supervisor ${op.con_coaching === 1 ? "tuvo" : "tuvieron"} coaching en el mes.`} />
            <Kpi titulo="Coachings del mes" valor={n(op.coachings)} sub="Registrados por los supervisores (sin los anulados)." />
            <Kpi titulo="Seguimientos vencidos" valor={n(op.seguimientos_vencidos)} alerta={op.seguimientos_vencidos > 0}
              sub="Compromisos que pasaron su fecha (y el día siguiente) sin seguimiento." />
            <Kpi titulo="Alertas sin coaching a tiempo" valor={n(op.alertas_vencidas)} alerta={op.alertas_vencidas > 0}
              sub={`Alertas de uso sin coaching en ${d.reglas.dias_foco} días hábiles${op.alertas_en_plazo ? ` · ${pl(op.alertas_en_plazo, "en plazo", "en plazo")}` : ""}.`} />
          </div>

          <section className="card min-w-0">
            <div className="px-5 pt-5 pb-3">
              <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Supervisores</h2>
              <p className="text-xs text-brand-slate mt-0.5">
                Cobertura, foco y seguimientos son la gestión que suma al scoring. Abrí cada uno para ver sus coachings y su bitácora, o
                mirá todos los coachings con su devolución en el{" "}
                <Link href={`${SUP_HREF}/coaching/registro`} className="font-semibold text-brand-primary hover:underline">registro por fechas</Link>.
              </p>
            </div>
            {!d.supervisores.length ? (
              <p className="px-5 py-8 text-center text-sm text-brand-slate border-t border-brand-border">No hay supervisores con equipo este mes.</p>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm min-w-[920px]">
                  <thead>
                    <tr className="bg-brand-bg text-[10px] uppercase tracking-wider2 text-brand-slate">
                      <th className="text-left px-5 py-2.5">Supervisor</th>
                      <th className="text-left px-3 py-2.5" title="% del equipo actual con al menos un coaching en el mes">Cobertura</th>
                      <th className="text-left px-3 py-2.5" title={`Alertas de uso con coaching dentro de ${d.reglas.dias_foco} días hábiles`}>Foco</th>
                      <th className="text-left px-3 py-2.5" title="Compromisos seguidos en la fecha acordada (o al día siguiente)">Seguimientos</th>
                      <th className="text-right px-3 py-2.5">Coachings</th>
                      <th className="text-left px-3 py-2.5">Pendiente</th>
                      <th className="text-right px-5 py-2.5" title="Último coaching, seguimiento o nota registrado">Última actividad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.supervisores.map((f) => {
                      const partes = Object.fromEntries(f.partes.map((p) => [p.clave, p]));
                      const vencido = f.seguimientos_vencidos + f.alertas.vencida > 0;
                      return (
                        <tr key={f.id} className={`border-t border-brand-border align-top ${vencido ? "shadow-[inset_3px_0_0_#E6332A]" : ""}`}>
                          <td className="px-5 py-3 min-w-[200px]">
                            <Link href={`${SUP_HREF}/supervisores/${f.id}/coaching?periodo=${d.periodo}`} className="font-semibold text-brand-ink hover:text-brand-primary">
                              {f.nombre}
                            </Link>
                            <div className="text-[11px] text-brand-slate">{pl(f.asesores, "asesor", "asesores")}{!f.activo && " · inactivo"}</div>
                          </td>
                          <td className="px-3 py-3"><CeldaParte p={partes.cobertura} /></td>
                          <td className="px-3 py-3"><CeldaParte p={partes.foco} /></td>
                          <td className="px-3 py-3"><CeldaParte p={partes.seguimiento} /></td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            <b className="text-brand-ink">{n(f.coachings)}</b>
                            {f.fuera_de_termino > 0 && <div className="text-[10px] text-[#8A5200]">{n(f.fuera_de_termino)} fuera de término</div>}
                            {f.sin_mejora > 0 && <div className="text-[10px] text-brand-slate">{pl(f.sin_mejora, "sin mejora", "sin mejora")}</div>}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1 max-w-[260px]">
                              {f.seguimientos_vencidos > 0 && <span className={`inline-flex items-center gap-1 rounded border px-1.5 text-[10px] font-semibold ${ROJO}`}><TriangleAlert size={10} aria-hidden />{pl(f.seguimientos_vencidos, "seguimiento vencido", "seguimientos vencidos")}</span>}
                              {f.alertas.vencida > 0 && <span className={`inline-flex items-center gap-1 rounded border px-1.5 text-[10px] font-semibold ${ROJO}`}><TriangleAlert size={10} aria-hidden />{pl(f.alertas.vencida, "alerta sin coaching", "alertas sin coaching")}</span>}
                              {f.alertas.en_plazo > 0 && <span className={`inline-flex items-center rounded border px-1.5 text-[10px] font-semibold ${NARANJA}`}>{pl(f.alertas.en_plazo, "alerta en plazo", "alertas en plazo")}</span>}
                              {f.seguimientos_abiertos - f.seguimientos_vencidos > 0 && <span className="text-[10px] text-brand-slate self-center">{pl(f.seguimientos_abiertos - f.seguimientos_vencidos, "seguimiento por venir", "seguimientos por venir")}</span>}
                              {!vencido && !f.alertas.en_plazo && f.seguimientos_abiertos === 0 && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><CircleCheck size={12} aria-hidden /> Al día</span>}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-right"><Actividad f={f} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <MetodoCoaching r={d.reglas} />
        </div>
      )}
    </>
  );
}
