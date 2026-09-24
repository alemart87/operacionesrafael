"use client";

import { useEffect, useMemo } from "react";
import { fechaCorta, n, pct, type DetalleNeta, type InformeData, type Vendedor } from "./tipos";
import { BarraUso, PctUso, Tabla } from "./ui";

/** Ficha del vendedor: calidad de sus ventas (uso), resumen y detalle línea por línea. Panel lateral. */
export function VendedorDetalle({ d, vendedor, onClose, onCambiar }: {
  d: InformeData; vendedor: Vendedor; onClose: () => void; onCambiar: (v: Vendedor) => void;
}) {
  const k = d.kpis;
  const lineas = useMemo(() => d.detalle_netas.filter((r) => r.vendedor === vendedor.vendedor), [d.detalle_netas, vendedor.vendedor]);
  const pendientes = useMemo(() => d.pendientes.detalle.filter((r) => r.vendedor === vendedor.vendedor), [d.pendientes.detalle, vendedor.vendedor]);
  const fuera = useMemo(() => d.fuera_de_netas.detalle.filter((r) => r.vendedor === vendedor.vendedor), [d.fuera_de_netas.detalle, vendedor.vendedor]);

  const idx = d.vendedores.findIndex((v) => v.vendedor === vendedor.vendedor);
  const anterior = idx > 0 ? d.vendedores[idx - 1] : null;
  const siguiente = idx >= 0 && idx < d.vendedores.length - 1 ? d.vendedores[idx + 1] : null;
  // Posición por % en uso entre los vendedores con líneas Pospago suficientes.
  const conPospago = d.vendedores.filter((v) => v.pospago >= k.min_lineas_alerta).sort((a, b) => b.pct_uso - a.pct_uso);
  const posUso = conPospago.findIndex((v) => v.vendedor === vendedor.vendedor);
  const difEquipo = vendedor.pospago ? Math.round((vendedor.pct_uso - k.pct_uso) * 10) / 10 : null;

  const grupo = (key: (r: DetalleNeta) => string | null | undefined) => {
    const m = new Map<string, { label: string; total: number; sin_uso: number; pospago: number }>();
    for (const r of lineas) {
      const g = m.get(key(r) ?? "—") ?? { label: key(r) ?? "—", total: 0, sin_uso: 0, pospago: 0 };
      g.total += 1;
      if (r.producto === "Pospago") { g.pospago += 1; if (r.consumo !== "SI") g.sin_uso += 1; }
      m.set(g.label, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };
  const porPlan = useMemo(() => grupo((r) => r.plan && `${r.producto} · ${r.plan}`), [lineas]);
  const porOrigen = useMemo(() => grupo((r) => (r.portacion === "SI" ? `Portación ${r.origen_portacion ?? ""}`.trim() : "Nativa")), [lineas]);
  const porDia = useMemo(() => grupo((r) => r.fecha_activacion).sort((a, b) => a.label.localeCompare(b.label)), [lineas]);
  const sinUso = lineas.filter((r) => r.consumo === "NO");
  const ultimoDia = porDia.length ? porDia[porDia.length - 1].label : null;
  const sinUsoRecientes = sinUso.filter((r) => r.fecha_activacion === ultimoDia).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Resumen en texto: lo que un supervisor necesita leer en diez segundos.
  const resumen: string[] = [];
  resumen.push(`${n(vendedor.total)} ventas netas en el mes: ${n(vendedor.pospago)} Pospago, ${n(vendedor.gpon)} GPON y ${n(vendedor.iptv)} IPTV. Puesto ${idx + 1} de ${d.vendedores.length} por volumen.`);
  if (vendedor.pospago) {
    resumen.push(
      `${pct(vendedor.pct_uso)} de sus líneas Pospago están en uso (${n(vendedor.con_uso)} de ${n(vendedor.pospago)}), ${difEquipo! >= 0 ? `${pct(Math.abs(difEquipo!))} por encima` : `${pct(Math.abs(difEquipo!))} por debajo`} del promedio del equipo (${pct(k.pct_uso)}).` +
      (posUso >= 0 ? ` Puesto ${posUso + 1} de ${conPospago.length} en calidad de uso.` : ""),
    );
    if (vendedor.alerta) resumen.push(`En alerta PFI: menos de ${k.umbral_uso_pct}% en uso con ${n(vendedor.pospago)} líneas. Revisar las ${n(vendedor.sin_uso)} sin uso.`);
    if (sinUsoRecientes) resumen.push(`${n(sinUsoRecientes)} de las ${n(vendedor.sin_uso)} sin uso se activaron el ${fechaCorta(ultimoDia)}: todavía pueden empezar a consumir.`);
  }
  if (vendedor.portadas) resumen.push(`${pct(Math.round((vendedor.portadas / vendedor.total) * 1000) / 10)} de sus ventas son portaciones${porOrigen[0] ? ` (la mayoría ${porOrigen[0].label === "Nativa" ? "nativas" : "desde " + porOrigen[0].label.replace("Portación ", "")})` : ""}.`);
  if (vendedor.suspendidas) resumen.push(`${n(vendedor.suspendidas)} línea${vendedor.suspendidas > 1 ? "s" : ""} suspendida${vendedor.suspendidas > 1 ? "s" : ""} al cierre.`);
  if (fuera.length) resumen.push(`${n(fuera.length)} portación${fuera.length > 1 ? "es" : ""} suya${fuera.length > 1 ? "s" : ""} no llegaron a DDI (fuera de netas).`);
  if (pendientes.length) resumen.push(`${n(pendientes.length)} carga${pendientes.length > 1 ? "s" : ""} pendiente${pendientes.length > 1 ? "s" : ""} de finalizar.`);

  const consumo = (c: DetalleNeta["consumo"]) =>
    c === null ? <span className="text-brand-mist">—</span> : c === "SI" ? <span className="text-emerald-700 font-semibold">Con uso</span> : <span className="text-brand-primary font-semibold">Sin uso</span>;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-brand-ink/40 backdrop-blur-[2px] animate-fade" onClick={onClose} />
      <aside role="dialog" aria-modal="true" className="relative w-full max-w-4xl h-full bg-brand-bg shadow-elevated overflow-y-auto animate-fade">
        <div className={`h-1.5 ${vendedor.alerta ? "bg-brand-primary" : "bg-brand-cyan"}`} />
        <div className="p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Vendedor · {vendedor.subcanal ?? "—"}{vendedor.pos_id ? ` · POS ${vendedor.pos_id}` : ""}</div>
              <h2 className="font-display text-3xl text-brand-ink uppercase leading-tight">{vendedor.vendedor}</h2>
              <div className="text-xs text-brand-slate mt-1">Ventas netas de {k.periodo} · corte al {fechaCorta(k.fecha_dato)}</div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => anterior && onCambiar(anterior)} disabled={!anterior} className="btn-ghost" title="Vendedor anterior">←</button>
              <button onClick={() => siguiente && onCambiar(siguiente)} disabled={!siguiente} className="btn-ghost" title="Vendedor siguiente">→</button>
              <button onClick={onClose} className="btn-ghost" title="Cerrar (Esc)">✕</button>
            </div>
          </div>

          {/* Calidad de ventas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="Ventas netas" value={n(vendedor.total)} hint={`Puesto ${idx + 1} de ${d.vendedores.length}`} />
            <Kpi label="% Pospago en uso" value={vendedor.pospago ? <PctUso v={vendedor.pct_uso} umbral={k.umbral_uso_pct} /> : "—"}
                 hint={vendedor.pospago ? `Equipo ${pct(k.pct_uso)} · ${difEquipo! >= 0 ? "+" : "−"}${pct(Math.abs(difEquipo!))}` : "Sin líneas Pospago"} alerta={vendedor.alerta} />
            <Kpi label="Pospago sin uso" value={n(vendedor.sin_uso)} hint={`de ${n(vendedor.pospago)} Pospago · alerta PFI`} alerta={vendedor.sin_uso > 0 && vendedor.alerta} />
            <Kpi label="GPON · IPTV" value={`${n(vendedor.gpon)} · ${n(vendedor.iptv)}`} hint={`${n(vendedor.portadas)} portadas · ${n(vendedor.suspendidas)} susp.`} />
          </div>
          {vendedor.pospago > 0 && (
            <div className="card p-4">
              <div className="flex items-center justify-between text-xs text-brand-slate mb-2">
                <span><b className="text-brand-cyan">{n(vendedor.con_uso)}</b> con uso</span>
                <span><b className="text-brand-primary">{n(vendedor.sin_uso)}</b> sin uso</span>
              </div>
              <BarraUso conUso={vendedor.con_uso} sinUso={vendedor.sin_uso} />
            </div>
          )}

          {/* Resumen */}
          <section className="card p-5">
            <h3 className="font-display text-lg text-brand-ink uppercase mb-2">Resumen</h3>
            <ul className="text-sm text-brand-graphite space-y-1.5 list-disc pl-5">
              {resumen.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </section>

          <div className="grid sm:grid-cols-3 gap-4">
            <Mini titulo="Por plan" rows={porPlan} umbral={k.umbral_uso_pct} />
            <Mini titulo="Portación" rows={porOrigen} umbral={k.umbral_uso_pct} />
            <Mini titulo="Por día" rows={porDia.map((r) => ({ ...r, label: fechaCorta(r.label).slice(0, 5) }))} umbral={k.umbral_uso_pct} />
          </div>

          {/* Detalle de líneas */}
          <section className="card p-5">
            <h3 className="font-display text-lg text-brand-ink uppercase mb-1">Detalle de líneas</h3>
            <p className="text-xs text-brand-slate mb-3">{n(lineas.length)} netas · filas en rojo: Pospago sin uso</p>
            <Tabla<DetalleNeta>
              cols={[
                { key: "fecha_activacion", label: "Activación", render: (r) => fechaCorta(r.fecha_activacion) },
                { key: "sds_number", label: "SDS", className: "tabular-nums" },
                { key: "linea", label: "Línea", className: "tabular-nums" },
                { key: "producto", label: "Producto" },
                { key: "plan", label: "Plan" },
                { key: "portacion", label: "Port.", render: (r) => (r.portacion === "SI" ? r.origen_portacion ?? "SI" : "Nativa") },
                { key: "consumo", label: "Consumo", render: (r) => consumo(r.consumo) },
                { key: "estado_linea", label: "Estado", render: (r) => (r.estado_linea === "S" ? <span className="badge-primary">Susp.</span> : "Activa") },
                { key: "ciudad", label: "Ciudad" },
              ]}
              rows={[...lineas].sort((a, b) => (a.consumo === "NO" ? 0 : 1) - (b.consumo === "NO" ? 0 : 1) || (b.fecha_activacion ?? "").localeCompare(a.fecha_activacion ?? ""))}
              alerta={(r) => r.consumo === "NO"}
              maxAlto="max-h-[50vh]"
            />
          </section>

          {fuera.length > 0 && (
            <section className="card p-5">
              <h3 className="font-display text-lg text-brand-ink uppercase mb-1">Portaciones fuera de netas</h3>
              <p className="text-xs text-brand-slate mb-3">{n(fuera.length)} líneas en PORTABILIDAD que no llegaron a DDI. No suman.</p>
              <Tabla<DetalleNeta>
                cols={[
                  { key: "fecha_activacion", label: "Activación", render: (r) => fechaCorta(r.fecha_activacion) },
                  { key: "sds_number", label: "SDS", className: "tabular-nums" },
                  { key: "linea", label: "Línea", className: "tabular-nums" },
                  { key: "plan", label: "Plan" },
                  { key: "tipo_port", label: "Tipo" },
                  { key: "consumo", label: "Consumo", render: (r) => consumo(r.consumo) },
                ]}
                rows={fuera}
              />
            </section>
          )}

          {pendientes.length > 0 && (
            <section className="card p-5">
              <h3 className="font-display text-lg text-brand-ink uppercase mb-1">Cargas pendientes</h3>
              <Tabla
                cols={[
                  { key: "fecha_alta", label: "Alta", render: (r) => fechaCorta(r.fecha_alta) },
                  { key: "dias", label: "Días", align: "right" },
                  { key: "estado", label: "Estado" },
                  { key: "plan", label: "Plan" },
                  { key: "legajo", label: "Cargado por", render: (r) => `${r.legajo ?? ""} ${r.cargado_por ?? ""}` },
                ]}
                rows={pendientes}
              />
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

function Kpi({ label, value, hint, alerta }: { label: string; value: React.ReactNode; hint?: string; alerta?: boolean }) {
  return (
    <div className={`card p-4 border-l-[3px] ${alerta ? "border-l-brand-primary" : "border-l-brand-ink"}`}>
      <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">{label}</div>
      <div className="mt-1 font-display text-2xl text-brand-ink">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-brand-slate">{hint}</div>}
    </div>
  );
}

function Mini({ titulo, rows, umbral }: { titulo: string; rows: { label: string; total: number; sin_uso: number; pospago: number }[]; umbral: number }) {
  return (
    <div className="card p-4">
      <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate mb-2">{titulo}</div>
      <Tabla
        cols={[
          { key: "label", label: "" },
          { key: "total", label: "Netas", align: "right", render: (r) => n(r.total) },
          { key: "uso", label: "% uso", align: "right", render: (r) => (r.pospago ? <PctUso v={Math.round(((r.pospago - r.sin_uso) / r.pospago) * 1000) / 10} umbral={umbral} /> : "—") },
        ]}
        rows={rows}
        maxAlto="max-h-56"
      />
    </div>
  );
}
