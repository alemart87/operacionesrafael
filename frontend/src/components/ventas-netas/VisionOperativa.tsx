"use client";

import { useMemo, useState } from "react";
import { ESTADO_SDS_LABEL, fechaCorta, n, type DetalleNeta, type InformeData, type Pendiente, type Vendedor } from "./tipos";
import { PctUso, Seccion, Senales, Tabla, UsoBadge } from "./ui";
import { VendedorDetalle } from "./VendedorDetalle";
import { DIAS_SIN_USO_ANTIGUA, estadoUso, umbralCritico, vendedoresCriticos } from "./patrones";

type Hoja = "vendedores" | "criticos" | "netas" | "pendientes" | "fuera";

/** Visión Operativa: las planillas de trabajo (vendedores, detalle línea por línea, pendientes). */
export function VisionOperativa({ d, onDescargar, descargando }: { d: InformeData; onDescargar: () => void; descargando: boolean }) {
  const k = d.kpis;
  const [hoja, setHoja] = useState<Hoja>("vendedores");
  const [q, setQ] = useState("");
  const [soloSinUso, setSoloSinUso] = useState(false);
  const [soloAlerta, setSoloAlerta] = useState(false);
  const [vendedorAbierto, setVendedorAbierto] = useState<string | null>(null);

  const filtro = (s: (string | null | undefined)[]) => !q || s.some((x) => (x ?? "").toString().toLowerCase().includes(q.toLowerCase()));

  const criticos = useMemo(() => vendedoresCriticos(d), [d]);
  const criticosFiltrados = useMemo(() => criticos.filter((c) => filtro([c.v.vendedor, c.v.subcanal])), [criticos, q]);

  const vendedores = useMemo(
    () => d.vendedores.filter((v) => filtro([v.vendedor, v.subcanal]) && (!soloAlerta || v.alerta)),
    [d.vendedores, q, soloAlerta],
  );
  const netas = useMemo(
    () => d.detalle_netas.filter((r) => filtro([r.vendedor, r.sds_number, r.linea, r.plan, r.ciudad]) && (!soloSinUso || estadoUso(r, d.kpis.fecha_dato) === "NO")),
    [d.detalle_netas, q, soloSinUso],
  );
  const pendientes = useMemo(
    () => d.pendientes.detalle.filter((r) => filtro([r.legajo, r.cargado_por, r.sds_number, r.plan, r.ciudad])),
    [d.pendientes.detalle, q],
  );
  const fuera = useMemo(() => d.fuera_de_netas.detalle.filter((r) => filtro([r.vendedor, r.sds_number, r.linea])), [d.fuera_de_netas.detalle, q]);

  const hojas: { value: Hoja; label: string; total: number }[] = [
    { value: "vendedores", label: "Por vendedor", total: d.vendedores.length },
    { value: "criticos", label: "Ver críticos", total: criticos.length },
    { value: "netas", label: "Detalle de netas", total: d.detalle_netas.length },
    { value: "pendientes", label: "Pendientes", total: d.pendientes.total },
    { value: "fuera", label: "Fuera de netas", total: d.fuera_de_netas.total },
  ];

  const consumo = (r: DetalleNeta) => <UsoBadge estado={estadoUso(r, d.kpis.fecha_dato)} />;

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center gap-3 flex-wrap no-print">
        <div className="flex gap-1">
          {hojas.map((h) => (
            <button
              key={h.value}
              onClick={() => setHoja(h.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                hoja === h.value ? (h.value === "criticos" ? "bg-brand-primary text-white" : "bg-brand-ink text-white")
                : h.value === "criticos" ? "text-brand-primary hover:bg-brand-primary-light" : "text-brand-slate hover:bg-brand-bg"
              }`}
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
            <input type="checkbox" checked={soloAlerta} onChange={(e) => setSoloAlerta(e.target.checked)} /> Solo críticos
          </label>
        )}
        <button onClick={onDescargar} disabled={descargando} className="btn-secondary ml-auto">
          {descargando ? "Generando…" : "Descargar planilla (.xlsx)"}
        </button>
      </div>

      {hoja === "vendedores" && (
        <Seccion titulo="Ventas netas por vendedor" sub={`${n(vendedores.length)} vendedores · clic en un vendedor para ver su ficha · filas en rojo: críticos, más de ${umbralCritico(d)}% sin uso`}>
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
            onRowClick={(r) => setVendedorAbierto(r.vendedor)}
          />
        </Seccion>
      )}

      {vendedorAbierto && (
        <VendedorDetalle
          d={d}
          nombre={vendedorAbierto}
          lista={(hoja === "criticos" ? criticosFiltrados.map((c) => c.v) : vendedores).map((v) => v.vendedor)}
          onClose={() => setVendedorAbierto(null)}
          onCambiar={setVendedorAbierto}
        />
      )}

      {hoja === "criticos" && (
        <Seccion
          titulo="Operadores críticos"
          sub={`${n(criticosFiltrados.length)} vendedores críticos: más de ${umbralCritico(d)}% de sus líneas sin uso con ${DIAS_SIN_USO_ANTIGUA}+ días (con ${k.min_lineas_alerta} o más evaluables; las en espera no cuentan) · el resto de los riesgos son alertas medias · clic para abrir la ficha`}
        >
          <Tabla<(typeof criticos)[number]>
            cols={[
              { key: "vendedor", label: "Vendedor", render: (r) => <><b>{r.v.vendedor}</b> <span className="text-brand-mist text-xs">{r.v.subcanal}</span></> },
              { key: "pospago", label: "Pospago", align: "right", render: (r) => n(r.v.pospago) },
              { key: "sin_uso", label: "Sin uso", align: "right", render: (r) => <b className="text-brand-primary">{n(r.v.sin_uso)}</b> },
              { key: "antiguas", label: `Sin uso ${DIAS_SIN_USO_ANTIGUA}+ días`, align: "right", render: (r) => (r.patron.sinUsoAntiguas ? <b className="text-brand-primary">{n(r.patron.sinUsoAntiguas)}</b> : "0") },
              { key: "pct_uso", label: "% en uso", align: "right", render: (r) => (r.v.pospago ? <PctUso v={r.v.pct_uso} umbral={k.umbral_uso_pct} /> : "—") },
              { key: "susp", label: "Susp.", align: "right", render: (r) => (r.v.suspendidas ? <b className="text-brand-primary">{n(r.v.suspendidas)}</b> : "0") },
              { key: "patron", label: "Patrón de comportamiento", render: (r) => <Senales senales={r.patron.senales} /> },
            ]}
            rows={criticosFiltrados}
            alerta={(r) => r.v.alerta}
            vacio="Ningún vendedor crítico en este corte."
            maxAlto="max-h-[70vh]"
            onRowClick={(r) => setVendedorAbierto(r.v.vendedor)}
          />
        </Seccion>
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
              { key: "consumo", label: "Consumo", render: (r) => consumo(r) },
              { key: "estado_linea", label: "Estado", align: "center", render: (r) => (r.estado_linea === "S" ? <span className="badge-primary">Susp.</span> : "Activa") },
              { key: "vendedor", label: "Vendedor", render: (r) => (
                <button className="text-left hover:text-brand-primary" onClick={() => setVendedorAbierto(r.vendedor)}>
                  {r.vendedor} <span className="text-brand-mist text-xs">{r.subcanal}</span>
                </button>
              ) },
              { key: "ciudad", label: "Ciudad" },
            ]}
            rows={netas}
            alerta={(r) => estadoUso(r, d.kpis.fecha_dato) === "NO"}
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
              { key: "consumo", label: "Consumo", render: (r) => consumo(r) },
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

