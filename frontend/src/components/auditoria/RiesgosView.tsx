"use client";

import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/KpiCard";
import { Seccion, Senales, Tabla } from "@/components/ventas-netas/ui";
import { GraficoAuditoria } from "./GraficoAuditoria";
import { CATEGORIA_LABEL, NIVEL_LABEL, SEVERIDAD_CLS, fechaCorta, n, nombrePeriodo, pct, type LineaEvidencia, type Nivel, type Snapshot, type VendedorRanking } from "./tipos";

const NIVEL_CLS: Record<Nivel, string> = {
  critico: "bg-brand-primary-light text-brand-primary-dark border-brand-primary/30",
  atencion: "bg-brand-orange/10 text-brand-graphite border-brand-orange/40",
  normal: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export function NivelBadge({ nivel }: { nivel: Nivel }) {
  return <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold ${NIVEL_CLS[nivel]}`}>{nivel === "critico" ? "▲" : nivel === "atencion" ? "●" : "○"} {NIVEL_LABEL[nivel]}</span>;
}

/** Tabla de evidencia: líneas (netas sin uso, Sali Hablando, cargas) con el mismo formato en todo el módulo. */
export function TablaEvidencia({ lineas, maxAlto = "max-h-72" }: { lineas: LineaEvidencia[]; maxAlto?: string }) {
  return (
    <Tabla<LineaEvidencia>
      cols={[
        { key: "periodo", label: "Período", render: (r) => nombrePeriodo(r.periodo ?? null).slice(0, 3) + (r.periodo ? ` ${r.periodo.slice(0, 4)}` : "") },
        { key: "fecha_activacion", label: "Activación", render: (r) => fechaCorta(r.fecha_activacion) },
        { key: "fecha_portacion", label: "Portación", render: (r) => (r.fecha_portacion ? fechaCorta(r.fecha_portacion) : "—") },
        { key: "dias", label: "Días", align: "right", render: (r) => (r.dias ?? "—") as any },
        { key: "sds_number", label: "SDS", className: "tabular-nums" },
        { key: "linea", label: "Línea", className: "tabular-nums", render: (r) => r.linea ?? "—" },
        { key: "plan", label: "Plan" },
        { key: "origen_portacion", label: "Origen", render: (r) => (r.portacion === "SI" ? r.origen_portacion ?? "SI" : r.portacion === "NO" ? "Nativa" : r.origen_portacion ?? "—") },
        { key: "consumo", label: "Uso", render: (r) => (r.consumo === "NO" || r.sin_uso ? <span className="text-brand-primary font-semibold">Sin uso</span> : r.consumo === "SI" ? <span className="text-emerald-700 font-semibold">Con uso</span> : "—") },
        { key: "riesgo", label: "Riesgo", align: "center", render: (r) => (r.riesgo ? <span className={r.riesgo === "A" ? "font-semibold text-brand-primary" : ""}>{r.riesgo}</span> : "—") },
        { key: "estado_linea", label: "Estado", render: (r) => (r.estado_linea === "S" ? <span className="badge-primary">Susp.</span> : r.estado_linea === "A" ? "Activa" : "—") },
        { key: "vendedor", label: "Vendedor" },
        { key: "ciudad", label: "Ciudad" },
      ]}
      rows={lineas}
      alerta={(r) => r.consumo === "NO" || !!r.sin_uso}
      maxAlto={maxAlto}
      vacio="Sin líneas."
    />
  );
}

/** Ficha del vendedor dentro de la auditoría: datos congelados del snapshot. */
export function VendedorAuditoria({ s, v, onClose }: { s: Snapshot; v: VendedorRanking; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const sinUso = s.lineas_sin_uso.filter((x) => x.vendedor === v.vendedor);
  const sali = s.sali_lineas.filter((x) => x.vendedor === v.vendedor);
  return (
    <div className="fixed inset-0 z-40 flex justify-end no-print">
      <div className="absolute inset-0 bg-brand-ink/40 backdrop-blur-[2px] animate-fade" onClick={onClose} />
      <aside role="dialog" aria-modal="true" className="relative w-full max-w-4xl h-full bg-brand-bg shadow-elevated overflow-y-auto animate-fade">
        <div className={`h-1.5 ${v.nivel === "critico" ? "bg-brand-primary" : v.nivel === "atencion" ? "bg-brand-orange" : "bg-brand-cyan"}`} />
        <div className="p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Vendedor · {v.subcanal ?? "—"} · puesto {v.posicion} de {s.kpis.vendedores}</div>
              <h2 className="font-display text-3xl text-brand-ink uppercase leading-tight">{v.vendedor}</h2>
              <div className="mt-1"><NivelBadge nivel={v.nivel} /> <span className="text-xs text-brand-slate ml-2">puntaje de riesgo {v.puntaje}</span></div>
            </div>
            <button onClick={onClose} className="btn-ghost" title="Cerrar">✕</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label="Netas" value={n(v.netas)} hint={`${n(v.pospago)} Pospago · ${n(v.gpon)} GPON · ${n(v.iptv)} IPTV`} accent="secondary" />
            <KpiCard label="% Pospago en uso" value={v.pospago ? pct(v.pct_uso) : "—"} hint={`${n(v.sin_uso)} sin uso · ${n(v.sin_uso_antiguas)} con 3+ días`} accent={v.alerta ? "danger" : "cyan"} />
            <KpiCard label="Sali Hablando" value={n(v.sali)} hint={`${n(v.sali_sin_uso)} sin uso`} accent={v.sali_sin_uso ? "danger" : "neutral"} />
            <KpiCard label="Cargas" value={n(v.cargas)} hint={`${pct(v.pct_finalizacion)} finalizadas · riesgo A ${n(v.riesgo_A)} (${n(v.sin_uso_riesgo_A)} s/uso) · susp. ${n(v.suspendidas)}`} accent="purple" />
          </div>
          {v.senales.length > 0 && (
            <section className="card p-5">
              <h3 className="font-display text-lg text-brand-ink uppercase mb-2">Patrón de comportamiento</h3>
              <Senales senales={v.senales} />
            </section>
          )}
          {Object.keys(v.periodos).length > 1 && (
            <section className="card p-5">
              <h3 className="font-display text-lg text-brand-ink uppercase mb-2">Por período</h3>
              <Tabla cols={[
                { key: "periodo", label: "Período", render: (r: any) => nombrePeriodo(r.periodo) },
                { key: "netas", label: "Netas", align: "right", render: (r: any) => n(r.netas) },
                { key: "sin_uso", label: "Sin uso", align: "right", render: (r: any) => n(r.sin_uso) },
                { key: "sali_sin_uso", label: "Sali s/uso", align: "right", render: (r: any) => n(r.sali_sin_uso) },
              ]} rows={Object.entries(v.periodos).map(([periodo, x]) => ({ periodo, ...x }))} />
            </section>
          )}
          <section className="card p-5">
            <h3 className="font-display text-lg text-brand-ink uppercase mb-1">Líneas sin uso</h3>
            <p className="text-xs text-brand-slate mb-3">{n(sinUso.length)} líneas Pospago netas sin consumo (evidencia congelada)</p>
            <TablaEvidencia lineas={sinUso} maxAlto="max-h-80" />
          </section>
          {sali.length > 0 && (
            <section className="card p-5">
              <h3 className="font-display text-lg text-brand-ink uppercase mb-1">Sali Hablando</h3>
              <p className="text-xs text-brand-slate mb-3">{n(sali.length)} portaciones SI-SaliHbl · {n(sali.filter((x) => x.sin_uso).length)} sin uso</p>
              <TablaEvidencia lineas={sali} maxAlto="max-h-80" />
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * Riesgos de un snapshot (en vivo o congelado en un informe): indicadores, datos llamativos,
 * vendedores riesgosos, ranking, Sali Hablando y evidencia. Compartido por la vista Riesgos y
 * la pestaña Resumen del informe.
 */
export function RiesgosView({ s, titulo }: { s: Snapshot; titulo?: string }) {
  const k = s.kpis;
  const [abierto, setAbierto] = useState<VendedorRanking | null>(null);
  const [filtroNivel, setFiltroNivel] = useState<"todos" | Nivel>("todos");
  const [q, setQ] = useState("");
  const ranking = useMemo(
    () => s.ranking.filter((v) => (filtroNivel === "todos" || v.nivel === filtroNivel) && (!q || v.vendedor.toLowerCase().includes(q.toLowerCase()))),
    [s.ranking, filtroNivel, q],
  );

  return (
    <div className="space-y-6">
      {titulo && <h2 className="font-display text-2xl text-brand-ink uppercase">{titulo}</h2>}
      {(s.advertencias?.length ?? 0) > 0 && (
        <div className="rounded-md border border-brand-orange/50 bg-brand-orange/10 p-3 text-sm text-brand-graphite">
          <b className="text-brand-orange">Atención:</b> {s.advertencias!.join(" ")} Pedí a quien gestiona Ventas Netas que reprocese ese corte (o subilo de nuevo) y volvé a analizar.
        </div>
      )}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Ventas netas" value={n(k.netas)} hint={`${s.periodos.map(nombrePeriodo).join(" · ")} · ${n(k.pospago)} Pospago · ${n(k.gpon)} GPON · ${n(k.iptv)} IPTV`} accent="secondary" />
        <KpiCard label="Pospago sin uso" value={pct(k.pct_sin_uso)} hint={`${n(k.pospago_sin_uso)} líneas · ${n(k.sin_uso_antiguas)} con 3+ días`} accent="danger" />
        <KpiCard label="Sali Hablando sin uso" value={`${n(k.sali_sin_uso)} · ${pct(k.sali_pct_sin_uso)}`} hint={`${n(k.sali_total)} portaciones Sali Hablando`} accent="danger" />
        <KpiCard label="Vendedores con riesgo" value={`${n(k.vendedores_criticos)} · ${n(k.vendedores_atencion)}`} hint={`críticos · atención, de ${n(k.vendedores)} con actividad`} accent="orange" />
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total líneas sin uso" value={n(k.total_sin_uso)} hint="Pospago netas + Sali Hablando" accent="danger" />
        <KpiCard label="Riesgo alto sin uso" value={n(k.sin_uso_riesgo_alto)} hint={`de ${n(k.riesgo_alto)} cargas con riesgo A`} accent="purple" />
        <KpiCard label="Finalizadas sin activar" value={n(k.finalizadas_sin_activar)} hint="No figuran en DDI ni PORTABILIDAD" accent="orange" />
        <KpiCard label="Pendientes > 7 días" value={n(k.pendientes_mas_7)} hint={`de ${n(k.pendientes)} pendientes · ${n(k.suspendidas)} suspendidas`} accent="neutral" />
      </div>

      <Seccion titulo="Datos llamativos" sub="Observaciones automáticas sobre los datos analizados, de mayor a menor gravedad">
        <ul className="grid md:grid-cols-2 gap-3">
          {s.llamativos.map((x, i) => (
            <li key={i} className={`rounded-md border p-3 ${SEVERIDAD_CLS[x.gravedad]}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-semibold">{x.titulo}</div>
                <div className="font-display text-xl whitespace-nowrap">{x.cifra}</div>
              </div>
              <p className="text-xs mt-1 leading-relaxed opacity-90">{x.detalle}</p>
              <div className="text-[10px] uppercase tracking-wider2 mt-1 opacity-70">{CATEGORIA_LABEL[x.categoria] ?? x.categoria}</div>
            </li>
          ))}
        </ul>
      </Seccion>

      <Seccion titulo="Vendedores riesgosos" sub={`${n(s.riesgosos.length)} vendedores en nivel crítico o atención, ordenados por puntaje de riesgo · clic para ver la evidencia`}>
        <Tabla<VendedorRanking>
          cols={[
            { key: "nivel", label: "Nivel", render: (v) => <NivelBadge nivel={v.nivel} /> },
            { key: "vendedor", label: "Vendedor", render: (v) => <><b>{v.vendedor}</b> <span className="text-brand-mist text-xs">{v.subcanal}</span></> },
            { key: "puntaje", label: "Puntaje", align: "right", render: (v) => <b>{v.puntaje}</b> },
            { key: "netas", label: "Netas", align: "right", render: (v) => n(v.netas) },
            { key: "sin_uso", label: "Sin uso", align: "right", render: (v) => <b className="text-brand-primary">{n(v.sin_uso)}</b> },
            { key: "pct_uso", label: "% uso", align: "right", render: (v) => (v.pospago ? pct(v.pct_uso) : "—") },
            { key: "sali_sin_uso", label: "Sali s/uso", align: "right", render: (v) => (v.sali_sin_uso ? <b className="text-brand-primary">{n(v.sali_sin_uso)}</b> : "0") },
            { key: "suspendidas", label: "Susp.", align: "right", render: (v) => n(v.suspendidas) },
            { key: "sin_uso_riesgo_A", label: "Riesgo A s/uso", align: "right", render: (v) => n(v.sin_uso_riesgo_A) },
            { key: "senales", label: "Patrón", render: (v) => <Senales senales={v.senales} /> },
          ]}
          rows={s.riesgosos}
          alerta={(v) => v.nivel === "critico"}
          maxAlto="max-h-[70vh]"
          onRowClick={setAbierto}
          vacio="Ningún vendedor con riesgo en las fuentes analizadas."
        />
      </Seccion>

      <div className="grid lg:grid-cols-2 gap-6">
        <Seccion titulo="Líneas sin uso por vendedor"><GraficoAuditoria s={s} clave="sin_uso_por_vendedor" alto={380} /></Seccion>
        <Seccion titulo="Sali Hablando por día de portación"><GraficoAuditoria s={s} clave="sali_por_dia" alto={380} /></Seccion>
      </div>

      <Seccion
        titulo="Ranking de vendedores"
        sub={`${n(ranking.length)} de ${n(s.ranking.length)} · por ventas netas · clic para ver la ficha`}
        accion={
          <div className="flex items-center gap-2 no-print">
            <input className="input max-w-[200px]" placeholder="Buscar vendedor…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input max-w-[150px]" value={filtroNivel} onChange={(e) => setFiltroNivel(e.target.value as any)}>
              <option value="todos">Todos los niveles</option>
              <option value="critico">Críticos</option>
              <option value="atencion">Atención</option>
              <option value="normal">Normales</option>
            </select>
          </div>
        }
      >
        <Tabla<VendedorRanking>
          cols={[
            { key: "posicion", label: "#", align: "right", render: (v) => n(v.posicion) },
            { key: "vendedor", label: "Vendedor", render: (v) => <><b>{v.vendedor}</b> <span className="text-brand-mist text-xs">{v.subcanal}</span></> },
            { key: "nivel", label: "Nivel", render: (v) => <NivelBadge nivel={v.nivel} /> },
            { key: "netas", label: "Netas", align: "right", render: (v) => <b>{n(v.netas)}</b> },
            { key: "pospago", label: "Pospago", align: "right", render: (v) => n(v.pospago) },
            { key: "con_uso", label: "Con uso", align: "right", render: (v) => n(v.con_uso) },
            { key: "sin_uso", label: "Sin uso", align: "right", render: (v) => (v.sin_uso ? <b className="text-brand-primary">{n(v.sin_uso)}</b> : "0") },
            { key: "pct_uso", label: "% uso", align: "right", render: (v) => (v.pospago ? pct(v.pct_uso) : "—") },
            { key: "gpon", label: "GPON", align: "right", render: (v) => n(v.gpon) },
            { key: "iptv", label: "IPTV", align: "right", render: (v) => n(v.iptv) },
            { key: "sali_sin_uso", label: "Sali s/uso", align: "right", render: (v) => n(v.sali_sin_uso) },
            { key: "cargas", label: "Cargas", align: "right", render: (v) => n(v.cargas) },
            { key: "pct_finalizacion", label: "% final.", align: "right", render: (v) => (v.cargas ? pct(v.pct_finalizacion) : "—") },
            { key: "puntaje", label: "Puntaje", align: "right", render: (v) => n(v.puntaje) },
          ]}
          rows={ranking}
          alerta={(v) => v.nivel === "critico"}
          maxAlto="max-h-[70vh]"
          onRowClick={setAbierto}
        />
      </Seccion>

      {abierto && <VendedorAuditoria s={s} v={abierto} onClose={() => setAbierto(null)} />}
    </div>
  );
}
