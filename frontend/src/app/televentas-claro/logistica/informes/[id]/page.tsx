"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { DataCompleta, DemoraPorRegion, EstadoPorZona, FiltroEstado, LineaTiempo, Motivos, Pendientes, ProyeccionFinDeMes, TiempoDeEntrega, Vendedores } from "@/components/logistica/Bloques";
import { usePublicarLogistica } from "@/components/logistica/PublicarLogistica";
import {
  EN_GESTION, ESTADO_LABEL, LOG_API, LOG_HREF, VERSION_ANALISIS, dias, fechaCorta, fechaHora, n, nombrePeriodo, pct,
  type Filtro, type InformeDetalle,
} from "@/components/logistica/tipos";
import { apiFetch } from "@/lib/api";
import { PERM_LOGISTICA_GESTION } from "@/lib/operativas";

export default function LogisticaInformePage() {
  return (
    <AppShell>
      <Informe />
    </AppShell>
  );
}

function Informe() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const gestion = can(PERM_LOGISTICA_GESTION);
  const [r, setR] = useState<InformeDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [recalculando, setRecalculando] = useState(false);

  const load = useCallback(async () => {
    try { setR(await apiFetch<InformeDetalle>(`${LOG_API}/informes/${id}`)); } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const { publicar, dialogo, loading: publicando, error: errorPublicar } = usePublicarLogistica(load);
  const recalcular = async () => {
    setRecalculando(true);
    try { await apiFetch(`${LOG_API}/informes/${id}/recalcular`, { method: "POST" }); await load(); } catch (e: any) { setError(e.message); } finally { setRecalculando(false); }
  };

  if (error) return <div className="card p-4 text-brand-primary">{error}</div>;
  if (!r) return <div className="card p-10 text-brand-slate">Cargando…</div>;
  const d = r.data;
  const k = d.kpis;
  const desactualizado = (r.version ?? 0) < VERSION_ANALISIS;
  const nombre = (uid: string | null) => (uid && r.usuarios[uid]) || "—";
  const r2 = (region: string) => r.demora_regiones?.[region]?.dias_prom ?? null;
  const e = d.entregas;
  const entregaRegion = (region: string) => r.entrega_regiones?.[region]?.dias_prom ?? null;
  const regionesCortas = d.regiones.map((rg) => rg.charAt(0) + rg.slice(1).toLowerCase()).join(" · ");
  const estadoCls = r.status === "published" ? "badge-success" : r.status === "replaced" ? "badge-neutral line-through" : "badge-cyan";

  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Link href={LOG_HREF} className="text-xs text-brand-slate hover:text-brand-primary">← Informes</Link>
          <div className="flex items-center gap-3 flex-wrap mt-1">
            <h1 className="font-display text-3xl text-brand-ink uppercase leading-tight">Logística · {nombrePeriodo(r.periodo)}</h1>
            <span className={estadoCls}>{ESTADO_LABEL[r.status]}</span>
          </div>
          <p className="text-sm text-brand-slate mt-1">
            Corte del <b>{fechaCorta(r.fecha_corte)}</b> · ventas del {fechaCorta(k.desde)} al {fechaCorta(k.hasta)} ({n(k.dias)} días) · generado por {nombre(r.generated_by)} el {fechaHora(r.generated_at)}
            {r.status === "published" && <> · publicado por {nombre(r.published_by)} el {fechaHora(r.published_at)}</>}
            {r.title && <> · {r.title}</>}
          </p>
        </div>
        {gestion && (
          <div className="flex items-center gap-2 flex-wrap">
            {desactualizado && <button type="button" className="btn-secondary" disabled={recalculando} onClick={recalcular}>{recalculando ? "Recalculando…" : "Actualizar análisis"}</button>}
            {r.status !== "published" && <button type="button" className="btn-primary" data-voi="publicar" disabled={publicando} onClick={() => publicar(r)}>{r.status === "replaced" ? "Volver a publicar" : "Publicar"}</button>}
          </div>
        )}
      </div>
      {errorPublicar && <div className="card p-4 text-brand-primary mb-4">{errorPublicar}</div>}
      {d.avisos.length > 0 && (
        <details className="mb-4 rounded-md border border-brand-border bg-white p-3 text-xs text-brand-slate">
          <summary className="font-semibold text-brand-graphite cursor-pointer">{d.avisos.length} nota(s) sobre los datos del archivo</summary>
          <ul className="mt-2 space-y-1 list-disc pl-5">{d.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </details>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">
        <KpiCard label="Pedidos" value={n(k.pedidos)} hint={`${n(k.vendedores)} vendedores · ${n(k.regiones)} regiones`} accent="secondary" />
        <KpiCard label="Proyección fin de mes" value={d.proyeccion?.disponible ? n(d.proyeccion.proyeccion) : "—"} hint={d.proyeccion?.disponible ? `ritmo ${n(d.proyeccion.ritmo)} /día · ${n(d.proyeccion.dias_restantes)} días laborables` : "sin proyección"} accent="primary" href="#proyeccion" cta="Ver proyección" />
        <KpiCard label="Entregados" value={pct(k.pct_entregados)} hint={`${n(k.entregados)} pedidos`} accent="cyan" />
        <KpiCard label="Tiempo de entrega" value={e?.disponible ? d.regiones.map((rg) => dias(entregaRegion(rg))).join(" · ") : "—"}
          hint={e?.disponible ? `${regionesCortas} · ${pct(e.pct_hasta_2)} en 2 días o menos · máx ${dias(e.dias_max)}` : "el archivo no trae fecha de entrega"}
          accent={e?.disponible && (e.en_6_o_mas ?? 0) > 0 ? "orange" : "cyan"} href="#entregas" cta="Ver tiempos de entrega" />
        <KpiCard label="En gestión" value={n(k.en_gestion)} hint={`${pct(k.pct_en_gestion)} · demora prom. ${dias(k.demora.dias_prom)}`} accent="orange" />
        <KpiCard label="Demora de pendientes" value={d.regiones.map((rg) => dias(r2(rg))).join(" · ")} hint={`${regionesCortas} · máx ${dias(k.demora.dias_max)} · ${n(d.pendientes.vencidos_6)} con 6 días o más`} accent={d.pendientes.vencidos_6 ? "danger" : "neutral"} href="#demora" cta="Ver por región" />
        <KpiCard label="Devueltos" value={n(k.devueltos)} hint={pct(k.pct_devueltos)} accent="danger" />
      </div>

      <div className="mb-5"><ProyeccionFinDeMes d={d} /></div>
      <div className="mb-5"><TiempoDeEntrega d={d} /></div>
      <div className="mb-5"><DemoraPorRegion d={d} /></div>

      <div className="card p-3 mb-5 sticky top-[64px] z-20">
        <FiltroEstado estados={d.estados} valor={filtro} onChange={setFiltro} kpis={k} />
      </div>

      <div className="space-y-5">
        <EstadoPorZona d={d} filtro={filtro} />
        <LineaTiempo d={d} filtro={filtro} />
        <Motivos d={d} filtro={filtro} />
        {(filtro === "todos" || filtro === EN_GESTION) && <Pendientes d={d} />}
        <Vendedores d={d} filtro={filtro} />
        <DataCompleta d={d} filtro={filtro} />
      </div>
      {dialogo}
    </>
  );
}
