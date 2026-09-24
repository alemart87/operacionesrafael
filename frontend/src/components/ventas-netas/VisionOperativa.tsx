"use client";

import { useMemo, useState } from "react";
import { ESTADO_SDS_LABEL, fechaCorta, n, type DetalleNeta, type InformeData, type Pendiente, type Vendedor } from "./tipos";
import { PctUso, Seccion, Tabla } from "./ui";
import { VendedorDetalle } from "./VendedorDetalle";

type Hoja = "vendedores" | "netas" | "pendientes" | "fuera";

/** Visión Operativa: las planillas de trabajo (vendedores, detalle línea por línea, pendientes). */
export function VisionOperativa({ d, onDescargar, descargando }: { d: InformeData; onDescargar: () => void; descargando: boolean }) {
  const k = d.kpis;
  const [hoja, setHoja] = useState<Hoja>("vendedores");
  const [q, setQ] = useState("");
  const [soloSinUso, setSoloSinUso] = useState(false);
  const [soloAlerta, setSoloAlerta] = useState(false);
  const [vendedorAbierto, setVendedorAbierto] = useState<Vendedor | null>(null);

  const filtro = (s: (string | null | undefined)[]) => !q || s.some((x) => (x ?? "").toString().toLowerCase().includes(q.toLowerCase()));

  const vendedores = useMemo(
    () => d.vendedores.filter((v) => filtro([v.vendedor, v.subcanal]) && (!soloAlerta || v.alerta)),
    [d.vendedores, q, soloAlerta],
  );
  const netas = useMemo(
    () => d.detalle_netas.filter((r) => filtro([r.vendedor, r.sds_number, r.linea, r.plan, r.ciudad]) && (!soloSinUso || r.consumo === "NO")),
    [d.detalle_netas, q, soloSinUso],
  );
  const pendientes = useMemo(
    () => d.pendientes.detalle.filter((r) => filtro([r.legajo, r.cargado_por, r.sds_number, r.plan, r.ciudad])),
    [d.pendientes.detalle, q],
  );
  const fuera = useMemo(() => d.fuera_de_netas.detalle.filter((r) => filtro([r.vendedor, r.sds_number, r.linea])), [d.fuera_de_netas.detalle, q]);

  const hojas: { value: Hoja; label: string; total: number }[] = [
    { value: "vendedores", label: "Por vendedor", total: d.vendedores.length },
    { value: "netas", label: "Detalle de netas", total: d.detalle_netas.length },
    { value: "pendientes", label: "Pendientes", total: d.pendientes.total },
    { value: "fuera", label: "Fuera de netas", total: d.fuera_de_netas.total },
  ];

  const consumo = (c: DetalleNeta["consumo"]) =>
    c === null ? <span className="text-brand-mist">—</span> : c === "SI" ? <span className="text-emerald-700 font-semibold">Con uso</span> : <span className="text-brand-primary font-semibold">Sin uso</span>;

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center gap-3 flex-wrap no-print">
        <div className="flex gap-1">
          {hojas.map((h) => (
            <button
              key={h.value}
              onClick={() => setHoja(h.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${hoja === h.value ? "bg-brand-ink text-white" : "text-brand-slate hover:bg-brand-bg"}`}
            >
              {h.label} <span className={hoja === h.value ? "text-white/60" : "text-brand-mist"}>{n(h.total)}</span>
            </button>
          ))}
        </div>
        <input className="input max-w-xs" placeholder="Buscar vendedor, SDS, línea, plan…" value={q} onChange={(e) => setQ(e.target.value)} />
        {hoja === "netas" && (
          <label className="text-xs text-brand-graphite flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={soloSinUso} onChange={(e) => setSoloSinUso(e.target.checked)} /> Solo Pospago sin uso
          </label>
        )}
        {hoja === "vendedores" && (
          <label className="text-xs text-brand-graphite flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={soloAlerta} onChange={(e) => setSoloAlerta(e.target.checked)} /> Solo en alerta
          </label>
        )}
        <button onClick={onDescargar} disabled={descargando} className="btn-secondary ml-auto">
          {descargando ? "Generando…" : "Descargar planilla (.xlsx)"}
        </button>
      </div>

      {hoja === "vendedores" && (
        <Seccion titulo="Ventas netas por vendedor" sub={`${n(vendedores.length)} vendedores · clic en un vendedor para ver su ficha · filas en rojo: menos de ${k.umbral_uso_pct}% en uso`}>
          <Tabla<Vendedor>
            cols={[
              { key: "vendedor", label: "Vendedor", render: (r) => <><b>{r.vendedor}</b> <span className="text-brand-mist text-xs">{r.subcanal}</span></> },
              { key: "pospago", label: "Pospago total", align: "right", render: (r) => n(r.pospago) },
              { key: "sin_uso", label: "Pospago SIN uso", align: "right", render: (r) => (r.sin_uso ? <b className="text-brand-primary">{n(r.sin_uso)}</b> : "0") },
              { key: "con_uso", label: "Pospago con uso", align: "right", render: (r) => n(r.con_uso) },
              { key: "pct_uso", label: "% líneas en uso", align: "right", render: (r) => (r.pospago ? <PctUso v={r.pct_uso} umbral={k.umbral_uso_pct} /> : "—") },
              { key: "gpon", label: "Ventas GPON", align: "right", render: (r) => n(r.gpon) },
              { key: "iptv", label: "IPTV", align: "right", render: (r) => n(r.iptv) },
              { key: "total", label: "Total netas", align: "right", render: (r) => <b>{n(r.total)}</b> },
              { key: "suspendidas", label: "Susp.", align: "right", render: (r) => (r.suspendidas ? n(r.suspendidas) : "0") },
            ]}
            rows={vendedores}
            alerta={(r) => r.alerta}
            maxAlto="max-h-[70vh]"
            onRowClick={setVendedorAbierto}
          />
        </Seccion>
      )}

      {vendedorAbierto && (
        <VendedorDetalle d={d} vendedor={vendedorAbierto} onClose={() => setVendedorAbierto(null)} onCambiar={setVendedorAbierto} />
      )}

      {hoja === "netas" && (
        <Seccion titulo="Detalle de ventas netas" sub={`${n(netas.length)} líneas activadas en el mes (hoja DDI)`}>
          <Tabla<DetalleNeta>
            cols={[
              { key: "sds_number", label: "SDS", className: "tabular-nums" },
              { key: "linea", label: "Línea", className: "tabular-nums" },
              { key: "fecha_activacion", label: "Activación", render: (r) => fechaCorta(r.fecha_activacion) },
              { key: "producto", label: "Producto" },
              { key: "plan", label: "Plan" },
              { key: "portacion", label: "Port.", align: "center", render: (r) => (r.portacion === "SI" ? r.origen_portacion ?? "SI" : "Nativa") },
              { key: "consumo", label: "Consumo", render: (r) => consumo(r.consumo) },
              { key: "estado_linea", label: "Estado", align: "center", render: (r) => (r.estado_linea === "S" ? <span className="badge-primary">Susp.</span> : "Activa") },
              { key: "vendedor", label: "Vendedor", render: (r) => (
                <button className="text-left hover:text-brand-primary" onClick={() => { const v = d.vendedores.find((x) => x.vendedor === r.vendedor); if (v) setVendedorAbierto(v); }}>
                  {r.vendedor} <span className="text-brand-mist text-xs">{r.subcanal}</span>
                </button>
              ) },
              { key: "ciudad", label: "Ciudad" },
            ]}
            rows={netas}
            alerta={(r) => r.consumo === "NO"}
            maxAlto="max-h-[70vh]"
          />
        </Seccion>
      )}

      {hoja === "pendientes" && (
        <Seccion titulo="Cargas pendientes" sub={`${n(pendientes.length)} ventas cargadas sin finalizar al ${fechaCorta(k.fecha_dato)} · ordenadas por antigüedad`}>
          <Tabla<Pendiente>
            cols={[
              { key: "sds_number", label: "SDS", className: "tabular-nums" },
              { key: "fecha_alta", label: "Alta", render: (r) => fechaCorta(r.fecha_alta) },
              { key: "dias", label: "Días", align: "right", render: (r) => <b className={(r.dias ?? 0) > 7 ? "text-brand-primary" : ""}>{r.dias ?? "—"}</b> },
              { key: "estado", label: "Estado", render: (r) => ESTADO_SDS_LABEL[r.estado] ?? r.estado },
              { key: "producto", label: "Producto" },
              { key: "plan", label: "Plan" },
              { key: "portacion", label: "Port.", align: "center", render: (r) => (r.portacion === "SI" ? r.origen_portacion ?? "SI" : "Nativa") },
              { key: "riesgo", label: "Riesgo", align: "center" },
              { key: "legajo", label: "Cargado por", render: (r) => <>{r.legajo} <span className="text-brand-mist text-xs">{r.cargado_por}</span></> },
              { key: "ciudad", label: "Ciudad" },
              { key: "comentario", label: "Comentario", className: "max-w-[220px] truncate text-xs text-brand-slate" },
            ]}
            rows={pendientes}
            alerta={(r) => (r.dias ?? 0) > 7}
            maxAlto="max-h-[70vh]"
          />
          {d.finalizadas_sin_activar.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-brand-ink mb-1">Finalizadas sin activar ({n(d.finalizadas_sin_activar.length)})</h3>
              <p className="text-xs text-brand-slate mb-2">Cargas en estado finalizada que no aparecen en DDI ni en PORTABILIDAD. Se listan para revisar con Claro.</p>
              <Tabla
                cols={[
                  { key: "sds_number", label: "SDS", className: "tabular-nums" },
                  { key: "fecha_venta", label: "Venta", render: (r) => fechaCorta(r.fecha_venta) },
                  { key: "producto", label: "Producto" },
                  { key: "plan", label: "Plan" },
                  { key: "legajo", label: "Legajo" },
                  { key: "vendedor", label: "Vendedor" },
                ]}
                rows={d.finalizadas_sin_activar}
                maxAlto="max-h-80"
              />
            </div>
          )}
        </Seccion>
      )}

      {hoja === "fuera" && (
        <Seccion titulo="Portadas fuera de netas" sub={`${n(fuera.length)} líneas de PORTABILIDAD que no llegaron a DDI · no suman a la neta`}>
          <Tabla<DetalleNeta>
            cols={[
              { key: "sds_number", label: "SDS", className: "tabular-nums" },
              { key: "linea", label: "Línea", className: "tabular-nums" },
              { key: "fecha_activacion", label: "Activación", render: (r) => fechaCorta(r.fecha_activacion) },
              { key: "plan", label: "Plan" },
              { key: "tipo_port", label: "Tipo portación" },
              { key: "origen_portacion", label: "Origen" },
              { key: "consumo", label: "Consumo", render: (r) => consumo(r.consumo) },
              { key: "razon_cierre", label: "Razón" },
              { key: "vendedor", label: "Vendedor" },
              { key: "ciudad", label: "Ciudad" },
            ]}
            rows={fuera}
            maxAlto="max-h-[70vh]"
          />
        </Seccion>
      )}
    </div>
  );
}
