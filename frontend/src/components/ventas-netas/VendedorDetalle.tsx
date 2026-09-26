"use client";

import { useEffect, useMemo, useState } from "react";
import { ESTADO_SDS_LABEL, fechaCorta, n, pct, type DetalleCarga, type DetalleNeta, type InformeData } from "./tipos";
import { BarraUso, PctUso, Senales, Tabla, UsoBadge } from "./ui";
import { estadoUso, patronVendedor, umbralCritico } from "./patrones";

const RIESGO_LABEL: Record<string, string> = { A: "Alto", M: "Medio", B: "Bajo" };

/**
 * Ficha del vendedor (panel lateral): calidad de sus ventas (uso), resumen, patrón,
 * detalle de líneas netas y ventas cargadas con las riesgosas (sin consumo) marcadas.
 * Se abre por nombre; `lista` define el orden para las flechas anterior/siguiente.
 */
export function VendedorDetalle({ d, nombre, lista, onClose, onCambiar }: {
  d: InformeData; nombre: string; lista?: string[]; onClose: () => void; onCambiar: (nombre: string) => void;
}) {
  const k = d.kpis;
  const vendedor = d.vendedores.find((v) => v.vendedor === nombre) ?? null;
  const prod = d.productividad?.por_vendedor.find((v) => v.vendedor === nombre) ?? null;
  const lineas = useMemo(() => d.detalle_netas.filter((r) => r.vendedor === nombre), [d.detalle_netas, nombre]);
  const pendientes = useMemo(() => d.pendientes.detalle.filter((r) => r.vendedor === nombre), [d.pendientes.detalle, nombre]);
  const fuera = useMemo(() => d.fuera_de_netas.detalle.filter((r) => r.vendedor === nombre), [d.fuera_de_netas.detalle, nombre]);
  const cargas = useMemo(
    () => (d.productividad?.detalle_cargas ?? []).filter((c) => c.vendedor === nombre)
      .sort((a, b) => Number(b.riesgosa) - Number(a.riesgosa) || (b.fecha_alta ?? "").localeCompare(a.fecha_alta ?? "")),
    [d.productividad, nombre],
  );
  const [soloRiesgosas, setSoloRiesgosas] = useState(false);

  const orden = lista ?? d.vendedores.map((v) => v.vendedor);
  const idx = orden.indexOf(nombre);
  const anterior = idx > 0 ? orden[idx - 1] : null;
  const siguiente = idx >= 0 && idx < orden.length - 1 ? orden[idx + 1] : null;
  const puesto = d.vendedores.findIndex((v) => v.vendedor === nombre);
  // Posición por % en uso entre los vendedores con líneas Pospago suficientes.
  const conPospago = d.vendedores.filter((v) => v.pospago >= k.min_lineas_alerta).sort((a, b) => b.pct_uso - a.pct_uso);
  const posUso = conPospago.findIndex((v) => v.vendedor === nombre);
  const difEquipo = vendedor?.pospago ? Math.round((vendedor.pct_uso - k.pct_uso) * 10) / 10 : null;

  const grupo = (key: (r: DetalleNeta) => string | null | undefined) => {
    const m = new Map<string, { label: string; total: number; sin_uso: number; pospago: number }>();
    for (const r of lineas) {
      const g = m.get(key(r) ?? "—") ?? { label: key(r) ?? "—", total: 0, sin_uso: 0, pospago: 0 };
      g.total += 1;
      if (r.producto === "Pospago") { g.pospago += 1; if (estadoUso(r, d.kpis.fecha_dato) === "NO") g.sin_uso += 1; }
      m.set(g.label, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };
  const porPlan = useMemo(() => grupo((r) => r.plan && `${r.producto} · ${r.plan}`), [lineas]);
  const porOrigen = useMemo(() => grupo((r) => (r.portacion === "SI" ? `Portación ${r.origen_portacion ?? ""}`.trim() : "Nativa")), [lineas]);
  const porDia = useMemo(() => grupo((r) => r.fecha_activacion).sort((a, b) => a.label.localeCompare(b.label)), [lineas]);
  const sinUso = lineas.filter((r) => estadoUso(r, d.kpis.fecha_dato) === "NO");
  const enEspera = lineas.filter((r) => estadoUso(r, d.kpis.fecha_dato) === "ESPERA").length;
  const patron = useMemo(() => (vendedor ? patronVendedor(d, vendedor, lineas) : null), [d, vendedor, lineas]);
  const riesgosas = cargas.filter((c) => c.riesgosa);
  const riesgosasAlto = riesgosas.filter((c) => c.riesgo === "A").length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Resumen en texto: lo que un supervisor necesita leer en diez segundos.
  const resumen: string[] = [];
  if (vendedor) {
    resumen.push(`${n(vendedor.total)} ventas netas en el mes: ${n(vendedor.pospago)} Pospago, ${n(vendedor.gpon)} GPON y ${n(vendedor.iptv)} IPTV. Puesto ${puesto + 1} de ${d.vendedores.length} por volumen.`);
    if (vendedor.pospago) {
      resumen.push(
        `${pct(vendedor.pct_uso)} de sus líneas Pospago están en uso (${n(vendedor.con_uso)} de ${n(vendedor.pospago)}), ${difEquipo! >= 0 ? `${pct(Math.abs(difEquipo!))} por encima` : `${pct(Math.abs(difEquipo!))} por debajo`} del promedio del equipo (${pct(k.pct_uso)}).` +
        (posUso >= 0 ? ` Puesto ${posUso + 1} de ${conPospago.length} en calidad de uso.` : ""),
      );
      if (vendedor.alerta) resumen.push(`Crítico: ${pct(vendedor.pct_sin_uso)} de sus líneas con 3+ días están sin uso (más del ${umbralCritico(d)}%). Revisar las ${n(vendedor.sin_uso)} sin uso.`);
      if (enEspera) resumen.push(`${n(enEspera)} línea${enEspera > 1 ? "s" : ""} en espera de uso: activada${enEspera > 1 ? "s" : ""} hace menos de 3 días al corte, no ${enEspera > 1 ? "son" : "es"} alerta todavía.`);
    }
    if (vendedor.portadas) resumen.push(`${pct(Math.round((vendedor.portadas / vendedor.total) * 1000) / 10)} de sus ventas son portaciones${porOrigen[0] ? ` (la mayoría ${porOrigen[0].label === "Nativa" ? "nativas" : "desde " + porOrigen[0].label.replace("Portación ", "")})` : ""}.`);
    if (vendedor.suspendidas) resumen.push(`${n(vendedor.suspendidas)} línea${vendedor.suspendidas > 1 ? "s" : ""} suspendida${vendedor.suspendidas > 1 ? "s" : ""} al cierre.`);
  } else {
    resumen.push("Sin ventas netas atribuidas en DDI este mes.");
  }
  if (prod) {
    resumen.push(`${n(prod.total)} ventas cargadas: ${n(prod.finalizadas)} finalizadas (${pct(prod.pct_finalizacion)}), ${n(Number(prod.Vta_A_Confirmar ?? 0))} a confirmar, ${n(Number(prod.Vta_Rechazada ?? 0))} rechazadas. ${n(prod.riesgo_A)} de riesgo alto.`);
    if (riesgosas.length) resumen.push(`${n(riesgosas.length)} ventas riesgosas (finalizadas Pospago sin consumo)${riesgosasAlto ? `, ${n(riesgosasAlto)} de ellas con riesgo alto en la carga` : ""}.`);
  }
  if (fuera.length) resumen.push(fuera.length > 1 ? `${n(fuera.length)} portaciones suyas no llegaron a DDI (fuera de netas).` : "1 portación suya no llegó a DDI (fuera de netas).");
  if (pendientes.length) resumen.push(`${n(pendientes.length)} carga${pendientes.length > 1 ? "s" : ""} pendiente${pendientes.length > 1 ? "s" : ""} de finalizar.`);

  const consumo = (r: DetalleNeta) => <UsoBadge estado={estadoUso(r, d.kpis.fecha_dato)} />;
  const subcanal = vendedor?.subcanal ?? (prod?.subcanal as string | null) ?? null;
  const alerta = vendedor?.alerta || (prod ? (prod.con_uso + prod.sin_uso >= 5 && prod.pct_sin_uso > 30) : false);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-brand-ink/40 backdrop-blur-[2px] animate-fade" onClick={onClose} />
      <aside role="dialog" aria-modal="true" className="relative w-full max-w-4xl h-full bg-brand-bg shadow-elevated overflow-y-auto animate-fade">
        <div className={`h-1.5 ${alerta ? "bg-brand-primary" : "bg-brand-cyan"}`} />
        <div className="p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Vendedor · {subcanal ?? "—"}{vendedor?.pos_id ? ` · POS ${vendedor.pos_id}` : ""}</div>
              <h2 className="font-display text-3xl text-brand-ink uppercase leading-tight">{nombre}</h2>
              <div className="text-xs text-brand-slate mt-1">Período {k.periodo} · corte al {fechaCorta(k.fecha_dato)}{lista ? ` · ${idx + 1} de ${orden.length}` : ""}</div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => anterior && onCambiar(anterior)} disabled={!anterior} className="btn-ghost" title="Vendedor anterior">←</button>
              <button onClick={() => siguiente && onCambiar(siguiente)} disabled={!siguiente} className="btn-ghost" title="Vendedor siguiente">→</button>
              <button onClick={onClose} className="btn-ghost" title="Cerrar (Esc)">✕</button>
            </div>
          </div>

          {/* Calidad de ventas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="Ventas netas" value={n(vendedor?.total ?? 0)} hint={vendedor ? `Puesto ${puesto + 1} de ${d.vendedores.length}` : "Sin netas en DDI"} />
            <Kpi label="% Pospago en uso" value={vendedor?.pospago ? <PctUso v={vendedor.pct_uso} umbral={k.umbral_uso_pct} /> : "—"}
                 hint={vendedor?.pospago ? `Equipo ${pct(k.pct_uso)} · ${difEquipo! >= 0 ? "+" : "−"}${pct(Math.abs(difEquipo!))}` : "Sin líneas Pospago"} alerta={!!vendedor?.alerta} />
            <Kpi label="Ventas riesgosas" value={n(riesgosas.length)} hint={`sin consumo · ${n(riesgosasAlto)} con riesgo alto`} alerta={riesgosas.length > 0} />
            <Kpi label="Cargadas · finalizadas" value={prod ? `${n(prod.total)} · ${n(prod.finalizadas)}` : "—"} hint={prod ? `${pct(prod.pct_finalizacion)} finalización · riesgo A ${n(prod.riesgo_A)}` : "Sin cargas"} />
          </div>
          {!!vendedor?.pospago && (
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
            {patron && patron.senales.length > 0 && (
              <div className="mt-4 pt-3 border-t border-brand-border">
                <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate mb-1.5">Patrón de comportamiento</div>
                <Senales senales={patron.senales} />
              </div>
            )}
          </section>

          {/* Ventas cargadas con las riesgosas marcadas */}
          {cargas.length > 0 && (
            <section className="card p-5">
              <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
                <div>
                  <h3 className="font-display text-lg text-brand-ink uppercase">Ventas cargadas</h3>
                  <p className="text-xs text-brand-slate">{n(cargas.length)} cargas del mes · <span className="text-brand-primary font-semibold">{n(riesgosas.length)} riesgosas</span> (finalizadas Pospago sin consumo), primero en la lista</p>
                </div>
                <label className="text-xs text-brand-graphite flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={soloRiesgosas} onChange={(e) => setSoloRiesgosas(e.target.checked)} /> Solo riesgosas
                </label>
              </div>
              <Tabla<DetalleCarga>
                cols={[
                  { key: "riesgosa", label: "", align: "center", render: (c) => (c.riesgosa ? <span className="text-brand-primary" title="Sin consumo">▲</span> : "") },
                  { key: "fecha_alta", label: "Alta", render: (c) => fechaCorta(c.fecha_alta) },
                  { key: "sds_number", label: "SDS", className: "tabular-nums" },
                  { key: "estado", label: "Estado", render: (c) => ESTADO_SDS_LABEL[c.estado] ?? c.estado },
                  { key: "producto", label: "Negocio", render: (c) => (c.producto === "Internet" ? "Internet (IF)" : c.producto) },
                  { key: "plan", label: "Plan" },
                  { key: "uso", label: "Uso", render: (c) => <UsoBadge estado={c.uso as any} /> },
                  { key: "riesgo", label: "Riesgo", align: "center", render: (c) => (c.riesgo ? <span className={c.riesgo === "A" ? "font-semibold text-brand-primary" : ""}>{c.riesgo} · {RIESGO_LABEL[c.riesgo] ?? ""}</span> : "—") },
                  { key: "portacion", label: "Port.", align: "center", render: (c) => (c.portacion === "SI" ? c.origen_portacion ?? "SI" : "Nativa") },
                  { key: "zona", label: "Zona", render: (c) => <>{c.zona === "Interior" ? "Interior" : "Cap./Central"} <span className="text-brand-mist text-xs">{c.ciudad}</span></> },
                  { key: "atribucion", label: "", render: (c) => (c.atribucion === "legajo" ? <span className="text-brand-mist text-[10px]" title="Atribuida por legajo">por legajo</span> : "") },
                ]}
                rows={soloRiesgosas ? riesgosas : cargas}
                alerta={(c) => c.riesgosa}
                maxAlto="max-h-[50vh]"
              />
            </section>
          )}

          {vendedor && (
            <div className="grid sm:grid-cols-3 gap-4">
              <Mini titulo="Por plan" rows={porPlan} umbral={k.umbral_uso_pct} />
              <Mini titulo="Portación" rows={porOrigen} umbral={k.umbral_uso_pct} />
              <Mini titulo="Por día" rows={porDia.map((r) => ({ ...r, label: fechaCorta(r.label).slice(0, 5) }))} umbral={k.umbral_uso_pct} />
            </div>
          )}

          {/* Detalle de líneas netas */}
          {lineas.length > 0 && (
            <section className="card p-5">
              <h3 className="font-display text-lg text-brand-ink uppercase mb-1">Detalle de líneas netas</h3>
              <p className="text-xs text-brand-slate mb-3">{n(lineas.length)} netas (DDI) · filas en rojo: Pospago sin uso</p>
              <Tabla<DetalleNeta>
                cols={[
                  { key: "fecha_activacion", label: "Activación", render: (r) => fechaCorta(r.fecha_activacion) },
                  { key: "sds_number", label: "SDS", className: "tabular-nums" },
                  { key: "linea", label: "Línea", className: "tabular-nums" },
                  { key: "producto", label: "Producto" },
                  { key: "plan", label: "Plan" },
                  { key: "portacion", label: "Port.", render: (r) => (r.portacion === "SI" ? r.origen_portacion ?? "SI" : "Nativa") },
                  { key: "consumo", label: "Consumo", render: (r) => consumo(r) },
                  { key: "estado_linea", label: "Estado", render: (r) => (r.estado_linea === "S" ? <span className="badge-primary">Susp.</span> : "Activa") },
                  { key: "ciudad", label: "Ciudad" },
                ]}
                rows={[...lineas].sort((a, b) => (estadoUso(a, d.kpis.fecha_dato) === "NO" ? 0 : 1) - (estadoUso(b, d.kpis.fecha_dato) === "NO" ? 0 : 1) || (b.fecha_activacion ?? "").localeCompare(a.fecha_activacion ?? ""))}
                alerta={(r) => estadoUso(r, d.kpis.fecha_dato) === "NO"}
                maxAlto="max-h-[50vh]"
              />
            </section>
          )}

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
                  { key: "consumo", label: "Consumo", render: (r) => consumo(r) },
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
                  { key: "estado", label: "Estado", render: (r) => ESTADO_SDS_LABEL[r.estado] ?? r.estado },
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
