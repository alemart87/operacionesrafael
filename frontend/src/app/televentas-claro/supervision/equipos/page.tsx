"use client";

import { ArrowRight, Copy, Search, UserCheck, Users, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { n } from "@/components/productividad/tipos";
import {
  CRUCE, SUP_API, SUP_HREF, dm, periodoDeUrl, periodoEnUrl, type Equipos, type MiembroEquipo,
} from "@/components/supervision/tipos";
import { CruceChip, Identidades, SelectorMes } from "@/components/supervision/ui";
import { apiFetch } from "@/lib/api";
import { PERM_SUPERVISION_GESTION } from "@/lib/operativas";

export default function EquiposPage() {
  return (
    <AppShell>
      <Tablero />
    </AppShell>
  );
}

const SIN = "__sin__";

function hoyAsuncion(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date());
}

function Tablero() {
  const { can } = useSession();
  const gestion = can(PERM_SUPERVISION_GESTION);
  const [periodo, setPeriodo] = useState(periodoDeUrl);
  const [data, setData] = useState<Equipos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [destino, setDestino] = useState<string>("");
  const [desde, setDesde] = useState<string>("");
  const [busqueda, setBusqueda] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const load = useCallback(async (p: string) => {
    setError(null);
    try {
      const d = await apiFetch<Equipos>(`${SUP_API}/equipos?periodo=${p}`);
      setData(d);
      // Fecha efectiva por defecto: el día 1 si el mes todavía no tiene equipos; si no, hoy (dentro del mes).
      const hoy = hoyAsuncion();
      setDesde(!d.tiene_equipos || hoy < d.primero || hoy > d.ultimo ? d.primero : hoy);
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { setData(null); setSel(new Set()); setOk(null); load(periodo); periodoEnUrl(periodo); }, [periodo, load]);

  const coincide = useCallback((m: MiembroEquipo) => {
    const q = busqueda.trim().toLowerCase();
    return !q || [m.nombre, m.vendedor, m.agente].some((x) => x?.toLowerCase().includes(q));
  }, [busqueda]);

  const supervisores = useMemo(() => (data?.supervisores ?? []).filter((s) => s.activo), [data]);
  const total = useMemo(() => (data ? data.supervisores.reduce((a, s) => a + s.asesores.length, 0) : 0), [data]);

  const alternar = (id: string) => setSel((s) => {
    const x = new Set(s);
    if (x.has(id)) x.delete(id); else x.add(id);
    return x;
  });
  const alternarTodos = (ids: string[]) => setSel((s) => {
    const x = new Set(s);
    const todos = ids.every((i) => x.has(i));
    ids.forEach((i) => (todos ? x.delete(i) : x.add(i)));
    return x;
  });

  const asignar = async () => {
    if (!data || !sel.size || !destino) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await apiFetch<{ asignados: number; desde: string }>(`${SUP_API}/equipos/asignar`, {
        method: "POST",
        body: JSON.stringify({ periodo, operador_ids: [...sel], supervisor_id: destino === SIN ? null : destino, desde }),
      });
      const quien = destino === SIN ? "sin supervisor" : `a ${supervisores.find((s) => s.id === destino)?.nombre}`;
      setOk(`${r.asignados} asesor(es) ${destino === SIN ? "quedaron" : "pasaron"} ${quien} desde el ${dm(r.desde)}.`);
      setSel(new Set());
      await load(periodo);
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };

  const copiar = async () => {
    if (!data) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await apiFetch<{ copiados: number; omitidos: number }>(`${SUP_API}/equipos/copiar`, { method: "POST", body: JSON.stringify({ periodo }) });
      setOk(`Se copiaron ${r.copiados} asesor(es) con su supervisor de ${data.nombre_anterior.toLowerCase()}.${r.omitidos ? ` ${r.omitidos} quedaron afuera (dados de baja o con un supervisor que ya no está).` : ""}`);
      await load(periodo);
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };

  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Supervisión</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Equipos del mes</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-3xl">
            Qué asesores tiene cada supervisor en el mes. Un cambio a mitad de mes va con su <b>fecha efectiva</b>: las ventas
            desde esa fecha cuentan para el nuevo supervisor. {gestion ? "Seleccioná asesores y elegí a quién pasan." : "Los arman los jefes."}
          </p>
        </div>
        <SelectorMes periodo={periodo} onChange={setPeriodo} />
      </div>

      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {ok && <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-md px-3 py-2.5">{ok}</div>}

      {!data ? (
        !error && <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : (
        <div className={`space-y-5 ${sel.size ? "pb-28" : ""}`}>
          <p className="text-xs text-brand-slate">
            Detectados en {data.nombre_mes.toLowerCase()}: <b className="text-brand-ink">{n(data.deteccion.agentes)}</b> en llamadas
            ({n(data.deteccion.dias_productividad)} día(s) de Productividad) y <b className="text-brand-ink">{n(data.deteccion.vendedores)}</b> en
            ventas{data.deteccion.ventas?.fecha_dato ? ` (corte del ${dm(data.deteccion.ventas.fecha_dato)})` : ""}.
            {!!data.deteccion.por_revisar && (
              <> {n(data.deteccion.por_revisar)} con el nombre por vincular:{" "}
                <Link href={`${SUP_HREF}/operadores?periodo=${periodo}`} className="font-semibold text-brand-primary hover:underline">revisar en Operadores</Link>.
              </>
            )}
          </p>

          {gestion && !data.tiene_equipos && (
            <div className="card p-5 border-l-[3px] border-l-brand-cyan flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="font-semibold text-brand-ink">{data.nombre_mes} todavía no tiene equipos</div>
                <p className="text-sm text-brand-slate mt-0.5">
                  {data.anterior_tiene_equipos
                    ? `Copiá los de ${data.nombre_anterior.toLowerCase()}: cada asesor arranca con el supervisor con que cerró el mes. Después ajustás los cambios.`
                    : "Seleccioná asesores de la lista «Sin supervisor» y asignalos."}
                </p>
              </div>
              {data.anterior_tiene_equipos && (
                <button type="button" className="btn-primary" onClick={copiar} disabled={ocupado}>
                  <Copy size={16} /> Copiar equipos de {data.nombre_anterior.split(" ")[0].toLowerCase()}
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <label className="relative flex-1 min-w-[220px] max-w-md">
              <span className="sr-only">Buscar asesor</span>
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mist" aria-hidden />
              <input className="input pl-9" placeholder="Buscar por nombre de llamadas o de vendedor" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </label>
            <span className="text-xs text-brand-slate">
              {n(total)} asesor(es) en {supervisores.length} equipo(s) · {n(data.sin_supervisor.length)} sin supervisor
            </span>
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5 items-start">
            {(data.sin_supervisor.length > 0 || !supervisores.length) && (
              <Columna titulo="Sin supervisor" subtitulo="Con actividad en el mes (o justo antes) y sin equipo"
                acento="border-t-brand-orange" miembros={data.sin_supervisor.filter(coincide)} gestion={gestion}
                sel={sel} alternar={alternar} alternarTodos={alternarTodos} primero={data.primero} vacio="Todos tienen equipo." />
            )}
            {supervisores.map((s) => (
              <Columna key={s.id} titulo={s.nombre} subtitulo={`${s.asesores.length} asesor(es)`} acento="border-t-brand-primary"
                href={`${SUP_HREF}/supervisores/${s.id}?periodo=${periodo}`} miembros={s.asesores.filter(coincide)} gestion={gestion}
                sel={sel} alternar={alternar} alternarTodos={alternarTodos} primero={data.primero} vacio="Sin asesores este mes." />
            ))}
          </div>

          {!supervisores.length && (
            <p className="text-sm text-brand-slate">
              No hay usuarios con perfil Supervisor en la operativa: crealos en Administración → Usuarios y asignales Televentas CLARO.
            </p>
          )}
        </div>
      )}

      {gestion && data && sel.size > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-brand-border bg-white/95 backdrop-blur shadow-elevated animate-fade">
          <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-brand-ink inline-flex items-center gap-2">
              <UserCheck size={16} className="text-brand-primary" /> {sel.size} seleccionado(s)
            </span>
            <label className="flex items-center gap-2 text-xs text-brand-slate">
              Pasan a
              <select className="input py-1.5 w-56" value={destino} onChange={(e) => setDestino(e.target.value)} aria-label="Supervisor de destino">
                <option value="">Elegí un supervisor…</option>
                {supervisores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                <option value={SIN}>Sin supervisor</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-brand-slate">
              desde
              <input type="date" className="input py-1.5 w-40" min={data.primero} max={data.ultimo} value={desde}
                onChange={(e) => setDesde(e.target.value)} aria-label="Fecha efectiva" />
            </label>
            <button type="button" className="btn-primary" onClick={asignar} disabled={!destino || !desde || ocupado}>
              {ocupado ? "Asignando…" : "Asignar"} <ArrowRight size={15} />
            </button>
            <button type="button" className="btn-ghost" onClick={() => setSel(new Set())}><X size={15} /> Quitar selección</button>
            <span className="text-[11px] text-brand-slate basis-full sm:basis-auto">
              Las ventas desde el {dm(desde)} cuentan para el nuevo supervisor; las anteriores quedan con quien estaba.
            </span>
          </div>
        </div>
      )}
    </>
  );
}

function Columna({ titulo, subtitulo, acento, href, miembros, gestion, sel, alternar, alternarTodos, primero, vacio }: {
  titulo: string; subtitulo: string; acento: string; href?: string; miembros: MiembroEquipo[]; gestion: boolean;
  sel: Set<string>; alternar: (id: string) => void; alternarTodos: (ids: string[]) => void; primero: string; vacio: string;
}) {
  const ids = miembros.map((m) => m.id);
  const todos = ids.length > 0 && ids.every((i) => sel.has(i));
  return (
    <section className={`card border-t-[3px] ${acento} min-w-0`}>
      <div className="p-4 pb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-xl uppercase text-brand-ink leading-tight truncate">{titulo}</h2>
          <p className="text-[11px] text-brand-slate">{subtitulo}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {gestion && ids.length > 0 && (
            <button type="button" onClick={() => alternarTodos(ids)} className="text-[11px] font-semibold text-brand-slate hover:text-brand-primary">
              {todos ? "Ninguno" : "Todos"}
            </button>
          )}
          {href && <Link href={href} className="text-[11px] font-semibold text-brand-primary hover:underline inline-flex items-center gap-0.5"><Users size={12} /> Ver</Link>}
        </div>
      </div>
      {!miembros.length ? (
        <p className="px-4 pb-4 text-xs text-brand-mist">{vacio}</p>
      ) : (
        <ul className="divide-y divide-brand-border border-t border-brand-border">
          {miembros.map((m) => (
            <li key={m.id}>
              <label className={`flex items-start gap-3 px-4 py-2.5 ${gestion ? "cursor-pointer hover:bg-brand-bg-soft" : ""} ${sel.has(m.id) ? "bg-brand-primary-light/60" : ""}`}>
                {gestion && (
                  <input type="checkbox" className="mt-1 w-4 h-4 accent-brand-primary" checked={sel.has(m.id)} onChange={() => alternar(m.id)}
                    aria-label={`Seleccionar ${m.nombre}`} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-brand-ink">{m.nombre}</span>
                    {CRUCE[m.cruce].pendiente && <CruceChip cruce={m.cruce} />}
                    {!m.activo && <span className="badge-neutral">De baja</span>}
                  </div>
                  <Identidades agente={m.agente} vendedor={m.vendedor} subcanal={m.subcanal} />
                  {(m.tramos.length > 1 || (m.tramos[0] && m.tramos[0].desde !== primero)) && (
                    <div className="text-[11px] text-[#1D5BA6] mt-0.5">
                      {m.tramos.map((t) => `${t.supervisor ?? "Sin supervisor"} ${dm(t.desde)}–${dm(t.hasta)}`).join(" · ")}
                    </div>
                  )}
                </div>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
