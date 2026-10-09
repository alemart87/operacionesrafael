"use client";

import { CalendarDays, Clock, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { fechaHora, fechaLarga, nombreMes } from "@/components/productividad/tipos";
import {
  SUP_API, duracionHabil, mesActual, num, sumarMeses, type HorarioAtencion, type ParametrosCompletos,
} from "@/components/supervision/tipos";
import { apiFetch } from "@/lib/api";
import { PERM_SUPERVISION_GESTION } from "@/lib/operativas";

export default function CalendarioPage() {
  return (
    <AppShell>
      <Calendario />
    </AppShell>
  );
}

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const PESOS: { v: number; label: string }[] = [{ v: 0, label: "No" }, { v: 0.5, label: "Medio" }, { v: 1, label: "Completo" }];

const FRANJA_DEFECTO: [string, string][] = [
  ["07:00", "19:00"], ["07:00", "19:00"], ["07:00", "19:00"], ["07:00", "19:00"], ["07:00", "19:00"], ["08:00", "12:00"], ["08:00", "12:00"],
];
const minutos = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };
const franjaValida = (f: [string, string] | null) => !f || (!!f[0] && !!f[1] && minutos(f[0]) < minutos(f[1]));

/** Minutos de un día hábil de plazo: la jornada más larga de lunes a viernes (como el servidor). */
function diaCompleto(h: HorarioAtencion): number {
  const largos = (dias: number[]) => dias.map((i) => h[String(i)]).filter(franjaValida).filter(Boolean).map((f) => minutos(f![1]) - minutos(f![0]));
  const semana = largos([0, 1, 2, 3, 4]);
  return Math.max(...(semana.length ? semana : largos([0, 1, 2, 3, 4, 5, 6])), 60);
}

/** Días hábiles de un mes con esos pesos y feriados (lo mismo que calcula el servidor). */
function habiles(periodo: string, pesos: number[], feriados: Set<string>): number {
  const [y, m] = periodo.split("-").map(Number);
  let total = 0;
  for (let d = new Date(y, m - 1, 1, 12); d.getMonth() === m - 1; d.setDate(d.getDate() + 1)) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    total += feriados.has(iso) ? 0 : pesos[(d.getDay() + 6) % 7];
  }
  return total;
}

function Calendario() {
  const { can } = useSession();
  const gestion = can(PERM_SUPERVISION_GESTION);
  const [p, setP] = useState<ParametrosCompletos | null>(null);
  const [pesos, setPesos] = useState<number[]>([]);
  const [dias, setDias] = useState<{ fecha: string; motivo: string }[]>([]);
  const [horario, setHorario] = useState<HorarioAtencion>({});
  const [nuevo, setNuevo] = useState({ fecha: "", motivo: "" });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const aplicar = (d: ParametrosCompletos) => { setP(d); setPesos(d.pesos_dia); setDias(d.no_laborables ?? []); setHorario(d.horario ?? {}); };
  useEffect(() => { apiFetch<ParametrosCompletos>(`${SUP_API}/parametros`).then(aplicar).catch((e) => setError(e.message)); }, []);

  const cambiado = !!p && (JSON.stringify(pesos) !== JSON.stringify(p.pesos_dia) || JSON.stringify(dias) !== JSON.stringify(p.no_laborables ?? [])
    || JSON.stringify(horario) !== JSON.stringify(p.horario ?? {}));
  const horarioOk = Object.values(horario).every(franjaValida) && Object.values(horario).some(Boolean);
  const franja = (i: number, f: [string, string] | null) => setHorario((h) => ({ ...h, [String(i)]: f }));
  const feriados = useMemo(() => new Set([...(p?.feriados_seguridad ?? []), ...dias.map((d) => d.fecha)]), [p, dias]);
  const meses = [mesActual(), sumarMeses(mesActual(), 1)];

  const agregar = () => {
    if (!nuevo.fecha || dias.some((d) => d.fecha === nuevo.fecha)) return;
    setDias((x) => [...x, { fecha: nuevo.fecha, motivo: nuevo.motivo.trim() }].sort((a, b) => a.fecha.localeCompare(b.fecha)));
    setNuevo({ fecha: "", motivo: "" });
  };
  const guardar = async () => {
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      aplicar(await apiFetch<ParametrosCompletos>(`${SUP_API}/parametros`, { method: "PUT", body: JSON.stringify({ pesos_dia: pesos, no_laborables: dias, horario }) }));
      setOk("Calendario guardado: las proyecciones y los plazos de los tickets ya lo usan.");
    } catch (e: any) { setError(e.message); } finally { setGuardando(false); }
  };

  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Supervisión</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Calendario</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-3xl">
            Días hábiles de la operación: con ellos se calcula la proyección al cierre y el ritmo necesario de cada supervisor. El horario
            de atención da las horas hábiles de los plazos de los tickets.
          </p>
        </div>
        {gestion && (
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={!cambiado || guardando} onClick={() => p && aplicar(p)}>Descartar</button>
            <button type="button" className="btn-primary" disabled={!cambiado || guardando || !horarioOk} onClick={guardar}>{guardando ? "Guardando…" : cambiado ? "Guardar calendario" : "Sin cambios"}</button>
          </div>
        )}
      </div>
      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {ok && <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-md px-3 py-2.5">{ok}</div>}

      {!p ? (
        !error && <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 items-start">
          <section className="card p-5">
            <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Días de la semana</h2>
            <p className="text-xs text-brand-slate mt-0.5">Cuánto vale cada día para la proyección. En septiembre el sábado vendió cerca de la mitad de un día de semana.</p>
            <ul className="mt-4 divide-y divide-brand-border">
              {DIAS.map((dia, i) => (
                <li key={dia} className="py-2.5 flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-brand-ink">{dia}</span>
                  <div className="inline-flex rounded-md border border-brand-border overflow-hidden" role="radiogroup" aria-label={dia}>
                    {PESOS.map((x) => (
                      <button key={x.v} type="button" role="radio" aria-checked={pesos[i] === x.v} disabled={!gestion}
                        onClick={() => setPesos((ps) => ps.map((v, j) => (j === i ? x.v : v)))}
                        className={`px-3 py-1.5 text-xs font-semibold border-l first:border-l-0 border-brand-border transition-colors disabled:cursor-default ${pesos[i] === x.v ? "bg-brand-ink text-white" : "bg-white text-brand-slate enabled:hover:bg-brand-bg"}`}>
                        {x.label}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 pt-4 border-t border-brand-border grid grid-cols-2 gap-3">
              {meses.map((m) => (
                <div key={m} className="rounded-md bg-brand-bg px-3 py-2.5">
                  <div className="text-[11px] text-brand-slate">{nombreMes(m)}</div>
                  <div className="font-display text-2xl text-brand-ink tabular-nums">{num(habiles(m, pesos, feriados))} <span className="text-xs font-sans text-brand-slate">días hábiles</span></div>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-display text-xl uppercase text-brand-ink leading-tight flex items-center gap-2"><CalendarDays size={18} className="text-brand-slate" /> Feriados y días no laborables</h2>
            <p className="text-xs text-brand-slate mt-0.5">No cuentan como días hábiles. Los feriados los carga el superadmin en Seguridad; acá se suman los de la operación.</p>
            <ul className="mt-4 divide-y divide-brand-border border-y border-brand-border">
              {[...p.feriados_seguridad.map((f) => ({ fecha: f, motivo: "Feriado", seguridad: true })), ...dias.map((d) => ({ ...d, seguridad: false }))]
                .sort((a, b) => a.fecha.localeCompare(b.fecha))
                .map((d) => (
                  <li key={`${d.fecha}-${d.seguridad}`} className="py-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-brand-ink">{fechaLarga(d.fecha)}</div>
                      <div className="text-[11px] text-brand-slate">{d.motivo || "No laborable"}</div>
                    </div>
                    {d.seguridad ? (
                      <span className="badge-neutral" title="Se edita en Administración → Seguridad">Seguridad</span>
                    ) : gestion ? (
                      <button type="button" className="btn-ghost" aria-label={`Quitar ${d.fecha}`} onClick={() => setDias((x) => x.filter((y) => y.fecha !== d.fecha))}><Trash2 size={15} /></button>
                    ) : null}
                  </li>
                ))}
              {!p.feriados_seguridad.length && !dias.length && <li className="py-3 text-sm text-brand-slate">Sin feriados ni días no laborables cargados.</li>}
            </ul>
            {gestion && (
              <div className="mt-4 flex items-end gap-2 flex-wrap">
                <label className="flex-1 min-w-[150px]">
                  <span className="label">Fecha</span>
                  <input type="date" className="input" value={nuevo.fecha} onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })} />
                </label>
                <label className="flex-[2] min-w-[180px]">
                  <span className="label">Motivo</span>
                  <input className="input" maxLength={120} placeholder="Ej.: inventario, capacitación" value={nuevo.motivo} onChange={(e) => setNuevo({ ...nuevo, motivo: e.target.value })} />
                </label>
                <button type="button" className="btn-secondary" disabled={!nuevo.fecha} onClick={agregar}><Plus size={15} /> Agregar</button>
              </div>
            )}
            {p.updated_at && <p className="text-[11px] text-brand-mist mt-4">Último cambio: {p.updated_by ?? "—"}, {fechaHora(p.updated_at)}.</p>}
          </section>

          <section className="card p-5 lg:col-span-2">
            <h2 className="font-display text-xl uppercase text-brand-ink leading-tight flex items-center gap-2"><Clock size={18} className="text-brand-slate" /> Horario de atención</h2>
            <p className="text-xs text-brand-slate mt-0.5 max-w-3xl">
              Las horas hábiles con que se miden los plazos de los tickets de revisión (los feriados y los días no laborables no cuentan).
              Un día hábil de plazo es la jornada más larga de lunes a viernes: hoy, <b className="text-brand-ink">{duracionHabil(diaCompleto(horario), diaCompleto(horario) + 1)}</b>.
            </p>
            <ul className="mt-4 grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {DIAS.map((dia, i) => {
                const f = horario[String(i)] ?? null;
                const mala = !franjaValida(f);
                return (
                  <li key={dia} className={`rounded-md border px-3 py-2.5 ${mala ? "border-brand-primary/50 bg-brand-primary-light/40" : "border-brand-border"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-brand-ink">{dia}</span>
                      <label className="inline-flex items-center gap-1.5 text-xs text-brand-slate cursor-pointer">
                        <input type="checkbox" className="accent-[#E6332A]" checked={!!f} disabled={!gestion}
                          onChange={(e) => franja(i, e.target.checked ? FRANJA_DEFECTO[i] : null)} /> Atiende
                      </label>
                    </div>
                    {f ? (
                      <div className="flex items-center gap-2 mt-2">
                        <input type="time" className="input !py-1.5 !px-2 text-sm tabular-nums" value={f[0]} disabled={!gestion} aria-label={`${dia}: desde`}
                          onChange={(e) => franja(i, [e.target.value, f[1]])} />
                        <span className="text-xs text-brand-slate">a</span>
                        <input type="time" className="input !py-1.5 !px-2 text-sm tabular-nums" value={f[1]} disabled={!gestion} aria-label={`${dia}: hasta`}
                          onChange={(e) => franja(i, [f[0], e.target.value])} />
                      </div>
                    ) : (
                      <div className="text-xs text-brand-mist mt-2">No se atiende</div>
                    )}
                    {mala && <div className="text-[11px] text-brand-primary-dark mt-1">La hora de fin tiene que ser posterior a la de inicio.</div>}
                  </li>
                );
              })}
            </ul>
            {!Object.values(horario).some(Boolean) && <p className="text-xs text-brand-primary-dark mt-3">Al menos un día tiene que tener horario de atención.</p>}
          </section>
        </div>
      )}
    </>
  );
}
