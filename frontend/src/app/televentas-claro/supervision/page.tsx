"use client";

import { ArrowRight, Target, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { n } from "@/components/productividad/tipos";
import { SUP_API, SUP_HREF, num, periodoDeUrl, periodoEnUrl, type FilaSupervisor, type ResumenSupervision } from "@/components/supervision/tipos";
import { AvanceCelda, AvanceObjetivo, CriticoBadge, EstadoChip, FuenteDatos, MetodoSupervision, SelectorMes } from "@/components/supervision/ui";
import { apiFetch } from "@/lib/api";
import { PERM_SUPERVISION_GESTION } from "@/lib/operativas";

export default function SupervisionPage() {
  return (
    <AppShell>
      <Resumen />
    </AppShell>
  );
}

type Borrador = Record<string, { pospago: string; gpon: string }>;

const aTexto = (v: number | null) => (v === null ? "" : String(v));
const aNumero = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.round(Number(v))));

function Resumen() {
  const { can } = useSession();
  const gestion = can(PERM_SUPERVISION_GESTION);
  const [periodo, setPeriodo] = useState(periodoDeUrl);
  const [data, setData] = useState<ResumenSupervision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState<Borrador>({});
  const [guardando, setGuardando] = useState(false);

  const load = useCallback(async (p: string) => {
    setError(null);
    try { setData(await apiFetch<ResumenSupervision>(`${SUP_API}/resumen?periodo=${p}`)); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { setData(null); setEditando(false); setOk(null); load(periodo); periodoEnUrl(periodo); }, [periodo, load]);

  const filas = useMemo(() => (data?.supervisores ?? []).filter((f) => f.activo || f.asesores || f.objetivo.pospago !== null || f.pospago.vendido), [data]);
  const cambios = useMemo(() => filas.filter((f) => {
    const b = borrador[f.id];
    return b && (aNumero(b.pospago) !== f.objetivo.pospago || aNumero(b.gpon) !== f.objetivo.gpon);
  }), [filas, borrador]);

  const editar = () => {
    setOk(null);
    setBorrador(Object.fromEntries(filas.map((f) => [f.id, { pospago: aTexto(f.objetivo.pospago), gpon: aTexto(f.objetivo.gpon) }])));
    setEditando(true);
  };
  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      for (const f of cambios) {
        const b = borrador[f.id];
        await apiFetch(`${SUP_API}/objetivos`, {
          method: "PUT",
          body: JSON.stringify({ periodo, supervisor_id: f.id, pospago: aNumero(b.pospago), gpon: aNumero(b.gpon) }),
        });
      }
      setOk(`Objetivos guardados: ${cambios.map((f) => f.nombre).join(", ")}.`);
      setEditando(false);
      await load(periodo);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  const op = data?.operacion;
  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Televentas CLARO · Modelo Líder Coach Comercial</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Supervisión</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-3xl">
            Objetivos de cada supervisor, lo vendido por su equipo y cómo cerraría el mes al ritmo actual. Un supervisor está en{" "}
            <b>crítico</b> cuando un asesor de su equipo supera el {num(data?.parametros.umbral_sin_uso ?? 10)}% de líneas sin uso.
          </p>
        </div>
        <SelectorMes periodo={periodo} onChange={setPeriodo} />
      </div>

      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {ok && <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-md px-3 py-2.5">{ok}</div>}

      {!data ? (
        <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : (
        <div className="space-y-6">
          <FuenteDatos ventas={data.ventas} cal={data.calendario} />

          {!data.equipos_cargados && (
            <div className="card p-5 border-l-[3px] border-l-brand-orange flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="font-semibold text-brand-ink">{data.nombre_mes} todavía no tiene equipos</div>
                <p className="text-sm text-brand-slate mt-0.5">
                  Sin equipos, las ventas no se pueden atribuir a ningún supervisor.{" "}
                  {gestion ? "Armalos (o copialos del mes anterior) en Equipos del mes." : "Los arman los jefes en Equipos del mes."}
                </p>
              </div>
              <Link href={`${SUP_HREF}/equipos?periodo=${periodo}`} className="btn-primary"><Users size={16} /> Equipos del mes</Link>
            </div>
          )}

          {op && (
            <div className="grid lg:grid-cols-[1fr_1fr_minmax(260px,0.8fr)] gap-5">
              <AvanceObjetivo titulo="Pospago · operación" p={op.pospago} cal={data.calendario} />
              <AvanceObjetivo titulo="GPON · operación" p={op.gpon} cal={data.calendario} />
              <section className={`card p-5 flex flex-col gap-4 ${op.supervisores_criticos ? "border-brand-primary/40" : ""}`}>
                <h3 className="font-display text-lg uppercase text-brand-ink leading-tight">Uso de líneas</h3>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-4 text-xs">
                  <div>
                    <dt className="text-brand-slate">Supervisores en crítico</dt>
                    <dd className={`font-display text-3xl tabular-nums leading-none mt-1 ${op.supervisores_criticos ? "text-brand-primary-dark" : "text-brand-ink"}`}>
                      {n(op.supervisores_criticos)}<span className="text-base text-brand-slate"> / {n(op.supervisores)}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-brand-slate">Asesores en alerta</dt>
                    <dd className="font-display text-3xl tabular-nums leading-none mt-1 text-brand-ink">{n(op.asesores_en_alerta)}</dd>
                  </div>
                  <div>
                    <dt className="text-brand-slate">Líneas a recuperar</dt>
                    <dd className="font-display text-3xl tabular-nums leading-none mt-1 text-brand-ink">{n(op.a_recuperar)}</dd>
                  </div>
                  <div>
                    <dt className="text-brand-slate">Netas sin supervisor</dt>
                    <dd className="font-display text-3xl tabular-nums leading-none mt-1 text-brand-ink">{n(data.sin_supervisor.pospago + data.sin_supervisor.gpon)}</dd>
                  </div>
                </dl>
                {!!op.asesores_en_alerta_sin_supervisor && (
                  <p className="text-[11px] text-brand-primary-dark">
                    {op.asesores_en_alerta_sin_supervisor} asesor(es) en alerta no tienen supervisor: asignalos para que alguien los gestione.
                  </p>
                )}
              </section>
            </div>
          )}

          <section className="card min-w-0">
            <div className="p-5 pb-3 flex items-end justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Supervisores</h2>
                <p className="text-xs text-brand-slate mt-0.5">
                  Barra: lo vendido (lleno), hasta dónde llegaría al cierre (claro) y el objetivo (marca). El % es la proyección contra el objetivo.
                </p>
              </div>
              {gestion && filas.length > 0 && (
                editando ? (
                  <div className="flex gap-2">
                    <button type="button" className="btn-secondary" onClick={() => setEditando(false)} disabled={guardando}>Cancelar</button>
                    <button type="button" className="btn-primary" onClick={guardar} disabled={!cambios.length || guardando}>
                      {guardando ? "Guardando…" : cambios.length ? `Guardar objetivos (${cambios.length})` : "Sin cambios"}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn-secondary" onClick={editar}><Target size={16} /> Cargar objetivos</button>
                )
              )}
            </div>
            {!filas.length ? (
              <p className="px-5 pb-6 text-sm text-brand-slate">
                No hay supervisores: creá usuarios con perfil Supervisor en la operativa y asignales asesores en Equipos del mes.
              </p>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm min-w-[860px]">
                  <thead>
                    <tr className="bg-brand-bg text-[10px] uppercase tracking-wider2 text-brand-slate">
                      <th className="text-left px-5 py-2.5">Supervisor</th>
                      <th className="text-left px-3 py-2.5">{editando ? "Objetivo Pospago" : "Pospago"}</th>
                      <th className="text-left px-3 py-2.5">{editando ? "Objetivo GPON" : "GPON"}</th>
                      <th className="text-left px-3 py-2.5">Estado Pospago</th>
                      <th className="text-left px-3 py-2.5">Uso de líneas</th>
                      <th className="px-5 py-2.5"><span className="sr-only">Detalle</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f) => (
                      <Fila key={f.id} f={f} periodo={periodo} editando={editando} borrador={borrador[f.id]}
                        onBorrador={(campo, v) => setBorrador((b) => ({ ...b, [f.id]: { ...b[f.id], [campo]: v } }))} />
                    ))}
                    {(data.sin_supervisor.pospago > 0 || data.sin_supervisor.gpon > 0) && (
                      <tr className="border-t border-brand-border bg-brand-bg-soft">
                        <td className="px-5 py-3">
                          <div className="font-semibold text-brand-slate">Sin supervisor</div>
                          <div className="text-[11px] text-brand-slate">
                            Netas de asesores sin equipo{data.sin_supervisor.netas_sin_vendedor ? ` y ${data.sin_supervisor.netas_sin_vendedor} sin vendedor (SIN VENDEDOR)` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-3 tabular-nums text-brand-slate">{n(data.sin_supervisor.pospago)}</td>
                        <td className="px-3 py-3 tabular-nums text-brand-slate">{n(data.sin_supervisor.gpon)}</td>
                        <td className="px-3 py-3" colSpan={2}>
                          {gestion && <Link href={`${SUP_HREF}/equipos?periodo=${periodo}`} className="text-xs font-semibold text-brand-primary hover:underline">Asignar en Equipos del mes</Link>}
                        </td>
                        <td />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <MetodoSupervision p={data.parametros} />
        </div>
      )}
    </>
  );
}

function Fila({ f, periodo, editando, borrador, onBorrador }: {
  f: FilaSupervisor; periodo: string; editando: boolean;
  borrador?: { pospago: string; gpon: string };
  onBorrador: (campo: "pospago" | "gpon", v: string) => void;
}) {
  const href = `${SUP_HREF}/supervisores/${f.id}?periodo=${periodo}`;
  const input = (campo: "pospago" | "gpon") => (
    <input type="number" min={0} max={100000} inputMode="numeric" className="input w-28 py-1.5 tabular-nums"
      aria-label={`Objetivo ${campo === "pospago" ? "Pospago" : "GPON"} de ${f.nombre}`} placeholder="Sin objetivo"
      value={borrador?.[campo] ?? ""} onChange={(e) => onBorrador(campo, e.target.value)} />
  );
  return (
    <tr className={`border-t border-brand-border ${f.critico ? "shadow-[inset_3px_0_0_#E6332A]" : ""}`}>
      <td className="px-5 py-3 min-w-[200px]">
        <Link href={href} className="font-semibold text-brand-ink hover:text-brand-primary">{f.nombre}</Link>
        <div className="text-[11px] text-brand-slate">
          {f.asesores ? `${f.asesores} asesor(es)` : "Sin equipo este mes"}{!f.activo && " · ya no es supervisor"}
        </div>
      </td>
      <td className="px-3 py-3">{editando ? input("pospago") : <AvanceCelda p={f.pospago} titulo={`Pospago de ${f.nombre}`} />}</td>
      <td className="px-3 py-3">{editando ? input("gpon") : <AvanceCelda p={f.gpon} titulo={`GPON de ${f.nombre}`} />}</td>
      <td className="px-3 py-3">
        <EstadoChip estado={f.pospago.estado} provisoria={f.pospago.provisoria} compacto />
        {f.pospago.ritmo_necesario !== null && f.pospago.ritmo_necesario > 0 && (
          <div className="text-[11px] text-brand-slate mt-1 tabular-nums">Necesita {num(f.pospago.ritmo_necesario)}/día hábil</div>
        )}
      </td>
      <td className="px-3 py-3">
        <CriticoBadge critico={f.critico} enAlerta={f.asesores_en_alerta} />
        {f.a_recuperar > 0 && <div className="text-[11px] text-brand-slate mt-1 tabular-nums">{f.a_recuperar} línea(s) a recuperar</div>}
      </td>
      <td className="px-5 py-3 text-right">
        <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline whitespace-nowrap">
          Ver equipo <ArrowRight size={13} />
        </Link>
      </td>
    </tr>
  );
}
