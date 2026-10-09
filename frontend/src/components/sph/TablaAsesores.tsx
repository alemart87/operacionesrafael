"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { MODO_LABEL, TURNO_LABEL, n } from "@/components/productividad/tipos";
import { descargarCsv } from "@/lib/csv";
import { BarraSph, NivelChip } from "./ui";
import { NIVEL, UNIDAD, estadoVenta, fmtEstados, fmtHoras, fmtProductos, vinculado, type AgenteSph, type BaseSph } from "./tipos";

export type FiltroAsesor = "todos" | "vinculados" | "probable" | "sin_vinculo" | "sesion_abierta";
type Dir = "asc" | "desc";
type Clave = "nombre" | "vendedor" | "dias" | "login" | "ventas" | "sph";

const FILTROS: { f: FiltroAsesor; label: string; ok: (a: AgenteSph) => boolean }[] = [
  { f: "todos", label: "Todos", ok: () => true },
  { f: "vinculados", label: "Vinculados", ok: (a) => vinculado(a.nivel) },
  { f: "probable", label: "Probables", ok: (a) => a.nivel === "probable" },
  { f: "sin_vinculo", label: "Sin vínculo", ok: (a) => !vinculado(a.nivel) },
  { f: "sesion_abierta", label: "Sesión abierta", ok: (a) => a.sesion_abierta },
];

/** Ventas que todavía no están finalizadas (a confirmar o procesadas): cuentan, pero pueden cambiar de estado. */
const pendientes = (a: AgenteSph) =>
  Object.entries(a.estados ?? {}).reduce((t, [e, v]) => t + (e !== "Vta_Finalizada" && estadoVenta(e).cuenta ? v : 0), 0);

function comparar(a: number | string | null, b: number | string | null, dir: Dir): number {
  const va = a === null || a === undefined, vb = b === null || b === undefined;
  if (va || vb) return va === vb ? 0 : va ? 1 : -1; // vacíos siempre al final
  const r = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "es");
  return dir === "asc" ? r : -r;
}

/** Asesores del día: vínculo con su vendedor, horas, ventas y SPH; filtros, orden, CSV y corrección del vínculo. */
export function TablaAsesores({ agentes, filtro, onFiltro, archivo, minHoras, onVincular, periodo, base = "ventas" }: {
  agentes: AgenteSph[]; filtro: FiltroAsesor; onFiltro: (f: FiltroAsesor) => void; archivo: string; minHoras: number;
  onVincular?: (a: AgenteSph) => void;
  /** Semana, mes o rango: muestra los días conectados. */
  periodo?: boolean;
  /** Ventas del día (v4) o netas (los SPH anteriores). */
  base?: BaseSph;
}) {
  const u = UNIDAD[base];
  const [q, setQ] = useState("");
  const [orden, setOrden] = useState<{ k: Clave; dir: Dir }>({ k: "sph", dir: "desc" });
  const max = Math.max(0, ...agentes.map((a) => a.sph ?? 0));

  const filas = useMemo(() => {
    const t = q.trim().toLowerCase();
    const ok = FILTROS.find((x) => x.f === filtro)!.ok;
    return agentes
      .filter((a) => ok(a) && (!t || a.nombre.toLowerCase().includes(t) || (a.vendedor ?? "").toLowerCase().includes(t)))
      .sort((a, b) => comparar((a as any)[orden.k] ?? null, (b as any)[orden.k] ?? null, orden.dir) || a.nombre.localeCompare(b.nombre, "es"));
  }, [agentes, filtro, q, orden]);

  const th = (k: Clave, label: string, { right, dirInicial = "desc", title }: { right?: boolean; dirInicial?: Dir; title?: string } = {}) => {
    const activo = orden.k === k;
    const I = !activo ? ArrowUpDown : orden.dir === "desc" ? ArrowDown : ArrowUp;
    return (
      <th className={`px-3 py-2 font-semibold ${right ? "text-right" : "text-left"}`} aria-sort={activo ? (orden.dir === "desc" ? "descending" : "ascending") : "none"}>
        <button type="button" title={title ?? "Ordenar"}
          onClick={() => setOrden((o) => (o.k === k ? { k, dir: o.dir === "desc" ? "asc" : "desc" } : { k, dir: dirInicial }))}
          className={`inline-flex items-center gap-1 uppercase tracking-wider2 whitespace-nowrap hover:text-brand-ink ${right ? "flex-row-reverse" : ""} ${activo ? "text-brand-ink" : ""}`}>
          {label} <I size={11} className={activo ? "text-brand-primary" : "text-brand-mist"} />
        </button>
      </th>
    );
  };

  const exportar = () => descargarCsv(archivo, [
    "Asesor", "Modo", "Turno", "Días conectado", "Días con sesión abierta", "Vendedor vinculado", "Subcanal", "Vínculo",
    "Horas que cuentan", "Horas con sesión abierta", u.Varias, `${u.Varias} con sesión abierta`, "Productos",
    ...(base === "ventas" ? ["Por estado", "No cuentan (rechazadas o canceladas)"] : []), "SPH", "En ranking",
  ], filas.map((a) => [
    a.nombre, a.modo ? MODO_LABEL[a.modo] : "", a.turno ? TURNO_LABEL[a.turno] : "", a.dias, a.dias_sesion_abierta,
    a.vendedor ?? "", a.subcanal ?? "", NIVEL[a.nivel].label, Math.round((a.login / 3600) * 100) / 100,
    Math.round((a.login_abierta / 3600) * 100) / 100, a.ventas, a.ventas_sesion_abierta, fmtProductos(a.productos),
    ...(base === "ventas" ? [fmtEstados(a.estados), fmtEstados(a.estados, false)] : []),
    a.sph, a.en_ranking ? "Sí" : "",
  ]));

  return (
    <div>
      <div className="flex flex-col xl:flex-row xl:items-center gap-3 mb-4">
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map((x) => {
            const activo = filtro === x.f;
            return (
              <button key={x.f} type="button" onClick={() => onFiltro(x.f)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${activo ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-slate border-brand-border hover:border-brand-ink"}`}>
                {x.label}<span className={`ml-1.5 tabular-nums ${activo ? "text-white/70" : "opacity-70"}`}>{agentes.filter(x.ok).length}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2 xl:ml-auto items-center">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mist" />
            <input className="input pl-9 py-2 w-60" placeholder="Buscar asesor o vendedor" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button type="button" onClick={exportar} disabled={!filas.length} className="btn-secondary text-xs px-3 py-2"><Download size={14} /> CSV</button>
        </div>
      </div>

      {!filas.length ? (
        <div className="text-sm text-brand-mist py-8 text-center">No hay asesores con esos filtros.</div>
      ) : (
        <div className="overflow-auto max-h-[72vh] -mx-5 px-5">
          <table className="w-full text-sm min-w-[880px]">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
                {th("nombre", "Asesor", { dirInicial: "asc" })}
                {th("vendedor", "Vendedor vinculado", { dirInicial: "asc", title: "Vendedor del POS en Ventas Netas" })}
                {periodo && th("dias", "Días", { right: true, title: "Días que se conectó en el período" })}
                {th("login", "Horas", { right: true, title: "Tiempo conectado que cuenta (sin sesiones abiertas)" })}
                {th("ventas", u.Varias, { right: true, title: base === "ventas" ? "Ventas del día del vendedor vinculado (hoja de productividad)" : "Netas del día del vendedor vinculado" })}
                {th("sph", "SPH", { right: true, title: `${u.Varias} ÷ horas conectadas` })}
                {onVincular && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => (
                <tr key={a.clave} className={`border-b border-brand-border/60 ${a.sesion_abierta ? "bg-brand-bg/50" : "hover:bg-brand-bg/60"}`}>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-brand-ink whitespace-nowrap">{a.nombre}</div>
                    <div className="flex flex-wrap gap-1 mt-0.5 text-[10px] text-brand-slate">
                      {a.modo && a.modo !== "sin_llamadas" && <span>{MODO_LABEL[a.modo]}</span>}
                      {a.turno && <span>· {TURNO_LABEL[a.turno].replace("Turno ", "")}</span>}
                      {a.sesion_abierta && (
                        <span className="font-semibold text-brand-primary-dark">
                          · {periodo ? `Sesión abierta ${a.dias_sesion_abierta} día(s)` : "Sesión abierta"} ({fmtHoras(a.login_abierta)}{a.ventas_sesion_abierta ? `, ${a.ventas_sesion_abierta} ${u.una}(s)` : ""}): no cuenta
                        </span>
                      )}
                      {a.login > 0 && vinculado(a.nivel) && !a.en_ranking && <span>· menos de {minHoras} h: fuera del ranking</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <NivelChip nivel={a.nivel} compacto />
                      {a.vendedor && <span className="text-xs text-brand-graphite">{a.vendedor}</span>}
                      {a.subcanal && <span className="text-[10px] text-brand-slate">{a.subcanal}</span>}
                    </div>
                    {!a.vendedor && a.candidatos.length > 0 && (
                      <div className="text-[10px] text-brand-slate mt-0.5">Parecidos: {a.candidatos.slice(0, 2).join(" · ")}</div>
                    )}
                  </td>
                  {periodo && <td className="px-3 py-2 text-right tabular-nums">{n(a.dias)}</td>}
                  <td className="px-3 py-2 text-right tabular-nums">{a.login ? fmtHoras(a.login) : <span className="text-brand-mist">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold"
                    title={[a.ventas ? fmtProductos(a.productos) : "", fmtEstados(a.estados), fmtEstados(a.estados, false) && `no cuentan: ${fmtEstados(a.estados, false)}`].filter(Boolean).join("\n") || undefined}>
                    {a.ventas === null ? <span className="text-brand-mist font-normal">—</span> : n(a.ventas)}
                    {a.ventas !== null && pendientes(a) > 0 && (
                      <div className="text-[10px] font-normal text-brand-slate whitespace-nowrap">{n(pendientes(a))} pendiente(s)</div>
                    )}
                  </td>
                  <td className="px-3 py-2"><BarraSph valor={a.sph} max={max} /></td>
                  {onVincular && (
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => onVincular(a)}
                        className={`text-xs font-semibold whitespace-nowrap ${a.nivel === "exacto" || a.nivel === "manual" ? "text-brand-slate hover:text-brand-ink" : "text-brand-primary"}`}>
                        {a.nivel === "probable" ? "Revisar" : vinculado(a.nivel) ? "Corregir" : "Vincular"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-brand-mist mt-3">
        {n(filas.length)} asesor(es). {u.Varias} «—» = sin vendedor vinculado: no se sabe cuántas tuvo. Los días con sesión abierta no cuentan (ni horas ni {u.varias}) porque sus horas no son reales.
        {base === "ventas" && " Pendientes = a confirmar o procesadas: ya cuentan como venta."}
      </p>
    </div>
  );
}
