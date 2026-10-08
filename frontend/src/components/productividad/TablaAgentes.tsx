"use client";

import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Download, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { descargarCsv } from "@/lib/csv";
import { BandaChip, IconoBanda } from "./ui";
import {
  BANDA, BANDAS, MODO_CORTO, TURNO_LABEL, medida, n, pct, reloj, segundos,
  type Agente, type Banda, type InfoContacto, type Parametros,
} from "./tipos";

export type FiltroBanda = Banda | "alertas" | null;
type Dir = "asc" | "desc";
type Clave = "nombre" | "dias" | "jornada" | "llamadas" | "atendidas" | "pct_contacto" | "conversacion" | "pct_conversacion"
  | "prom_conversacion" | "aht" | "pct_pausa" | "llamadas_hora";

const valor = (a: Agente, k: Clave): number | string | null => {
  if (k === "nombre") return a.nombre;
  if (k === "jornada") return a.dias_sesion_abierta && !a.dias_validos ? a.login : a.jornada_media;
  return (a as any)[k] ?? null;
};

function comparar(a: number | string | null, b: number | string | null, dir: Dir): number {
  const va = a === null || a === undefined, vb = b === null || b === undefined;
  if (va || vb) return va === vb ? 0 : va ? 1 : -1; // vacíos siempre al final
  const r = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "es");
  return dir === "asc" ? r : -r;
}

/**
 * Agentes del día o del período: filtros por banda (clic desde el semáforo), modo y turno,
 * búsqueda, orden por cualquier columna y descarga en CSV.
 */
export function TablaAgentes({ agentes, p, contacto, filtro, onFiltro, periodo, archivo, ordenInicial }: {
  agentes: Agente[]; p: Parametros; contacto: InfoContacto; filtro: FiltroBanda; onFiltro: (f: FiltroBanda) => void;
  periodo?: boolean; archivo: string; ordenInicial?: { k: Clave; dir: Dir } | null;
}) {
  const [q, setQ] = useState("");
  const [modo, setModo] = useState<"" | "auto" | "manual">("");
  const [turno, setTurno] = useState<"" | "manana" | "tarde">("");
  const [orden, setOrden] = useState<{ k: Clave; dir: Dir }>(ordenInicial ?? { k: "pct_conversacion", dir: "asc" });
  useEffect(() => { if (ordenInicial) setOrden(ordenInicial); }, [ordenInicial]);
  const hayTurnos = agentes.some((a) => a.turno);
  const m = medida(contacto);

  const conteo = useMemo(() => {
    const c: Record<string, number> = { alertas: agentes.filter((a) => a.alertas.length).length };
    for (const b of BANDAS) c[b] = agentes.filter((a) => a.banda === b).length;
    return c;
  }, [agentes]);

  const filas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return agentes
      .filter((a) => (filtro === null || (filtro === "alertas" ? a.alertas.length > 0 : a.banda === filtro))
        && (!modo || a.modo === modo) && (!turno || a.turno === turno)
        && (!t || a.nombre.toLowerCase().includes(t)))
      .sort((a, b) => comparar(valor(a, orden.k), valor(b, orden.k), orden.dir) || a.nombre.localeCompare(b.nombre, "es"));
  }, [agentes, filtro, modo, turno, q, orden]);

  const ordenar = (k: Clave, dirInicial: Dir = "desc") =>
    setOrden((o) => (o.k === k ? { k, dir: o.dir === "desc" ? "asc" : "desc" } : { k, dir: dirInicial }));

  const th = (k: Clave, label: string, { right, dirInicial, title }: { right?: boolean; dirInicial?: Dir; title?: string } = {}) => {
    const activo = orden.k === k;
    const I = !activo ? ArrowUpDown : orden.dir === "desc" ? ArrowDown : ArrowUp;
    return (
      <th key={k} className={`px-3 py-2 font-semibold ${right ? "text-right" : "text-left"}`} aria-sort={activo ? (orden.dir === "desc" ? "descending" : "ascending") : "none"}>
        <button type="button" title={title ?? "Ordenar"} onClick={() => ordenar(k, dirInicial)}
          className={`inline-flex items-center gap-1 uppercase tracking-wider2 whitespace-nowrap hover:text-brand-ink ${right ? "flex-row-reverse" : ""} ${activo ? "text-brand-ink" : ""}`}>
          {label} <I size={11} className={activo ? "text-brand-primary" : "text-brand-mist"} />
        </button>
      </th>
    );
  };

  const exportar = () => descargarCsv(archivo, [
    "Agente", ...(periodo ? ["Días"] : []), "Modo", "Turno", periodo ? "Jornada media (h:mm)" : "Jornada (h:mm)", "Llamadas",
    ...(m.exacto ? [m.rotulo, m.pct] : []), "Conversación (h:mm)", "% conversación", "Estado meta",
    "Promedio conversación (s)", "AHT (s)", "% pausa", "Llamadas por hora", "Alertas",
  ], filas.map((a) => [
    a.nombre, ...(periodo ? [a.dias] : []), a.modo ? MODO_CORTO[a.modo] : "", a.turno ? TURNO_LABEL[a.turno] : "",
    reloj(valor(a, "jornada") as number | null), a.llamadas, ...(m.exacto ? [a.atendidas, a.pct_contacto] : []),
    reloj(a.conversacion), a.pct_conversacion,
    a.banda ? BANDA[a.banda].nombre : "", a.prom_conversacion, a.aht, a.pct_pausa, a.llamadas_hora,
    a.alertas.map((x) => (x === "sesion_abierta" ? "Sesión abierta" : "Sin llamadas")).join(" · "),
  ]));

  const chips: { f: FiltroBanda; label: React.ReactNode; n: number | null }[] = [
    { f: null, label: "Todos", n: agentes.length },
    ...BANDAS.map((b) => ({ f: b as FiltroBanda, label: <span className="inline-flex items-center gap-1"><IconoBanda banda={b} size={11} />{BANDA[b].nombre}</span>, n: conteo[b] })),
    { f: "alertas", label: <span className="inline-flex items-center gap-1"><AlertTriangle size={11} />Alertas</span>, n: conteo.alertas },
  ];

  return (
    <div>
      <div className="flex flex-col xl:flex-row xl:items-center gap-3 mb-4">
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const activo = filtro === c.f;
            const b = c.f && c.f !== "alertas" ? BANDA[c.f] : null;
            return (
              <button key={String(c.f)} type="button" onClick={() => onFiltro(c.f)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  activo ? (b ? `${b.chip} ring-2 ring-offset-1 ring-current` : "bg-brand-ink text-white border-brand-ink") : "bg-white text-brand-slate border-brand-border hover:border-brand-ink"}`}>
                {c.label}<span className={`ml-1.5 tabular-nums ${activo && !b ? "text-white/70" : "opacity-70"}`}>{c.n}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2 xl:ml-auto items-center">
          <select className="input py-2 w-auto text-xs" value={modo} onChange={(e) => setModo(e.target.value as any)} aria-label="Modo de discado">
            <option value="">Todos los modos</option>
            <option value="auto">Discador automático</option>
            <option value="manual">Discado manual</option>
          </select>
          {hayTurnos && (
            <select className="input py-2 w-auto text-xs" value={turno} onChange={(e) => setTurno(e.target.value as any)} aria-label="Turno">
              <option value="">Ambos turnos</option>
              <option value="manana">Turno mañana</option>
              <option value="tarde">Turno tarde</option>
            </select>
          )}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mist" />
            <input className="input pl-9 py-2 w-56" placeholder="Buscar agente" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button type="button" onClick={exportar} disabled={!filas.length} className="btn-secondary text-xs px-3 py-2"><Download size={14} /> CSV</button>
        </div>
      </div>

      {filtro && (
        <div className="mb-3 text-xs text-brand-slate flex items-center gap-2">
          Mostrando {filtro === "alertas" ? "agentes con alertas" : <>agentes <b>{BANDA[filtro].nombre.toLowerCase()}</b> ({filtro === "rojo" ? `menos de ${p.rojo}%` : filtro === "bajo" ? `${p.rojo}% a ${p.meta_min}%` : filtro === "meta" ? `${p.meta_min}% a ${p.meta_max}%` : `más de ${p.meta_max}%`} de conversación)</>}.
          <button type="button" onClick={() => onFiltro(null)} className="inline-flex items-center gap-1 font-semibold text-brand-primary"><X size={12} /> Quitar filtro</button>
        </div>
      )}

      {!filas.length ? (
        <div className="text-sm text-brand-mist py-8 text-center">No hay agentes con esos filtros.</div>
      ) : (
        <div className="overflow-auto max-h-[72vh] -mx-5 px-5">
          <table className="w-full text-sm min-w-[1080px]">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
                {th("nombre", "Agente", { dirInicial: "asc" })}
                {periodo && th("dias", "Días", { right: true })}
                {th("jornada", periodo ? "Jornada media" : "Jornada", { right: true, title: "Tiempo conectado (h:mm)" })}
                {th("llamadas", "Llamadas", { right: true })}
                {m.exacto && th("atendidas", m.corto, { right: true, title: m.explicacion })}
                {m.exacto && th("pct_contacto", m.pctCorto, { right: true, title: m.explicacion })}
                {!m.exacto && th("llamadas_hora", "Llamadas / hora", { right: true, title: "Llamadas por hora conectada" })}
                {th("conversacion", "Conversación", { right: true, title: "Tiempo total de conversación (h:mm)" })}
                {th("pct_conversacion", "% Conversación", { right: true, dirInicial: "asc", title: `Meta ${p.meta_min}–${p.meta_max}%` })}
                {th("prom_conversacion", "Prom. conv.", { right: true })}
                {th("aht", "AHT", { right: true })}
                {th("pct_pausa", "% Pausa", { right: true })}
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => (
                <tr key={a.clave} className={`border-b border-brand-border/60 ${a.banda === "rojo" ? "bg-brand-primary-light/35 hover:bg-brand-primary-light/60" : "hover:bg-brand-bg/60"}`}>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-brand-ink whitespace-nowrap">{a.nombre}</div>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {a.modo && a.modo !== "sin_llamadas" && <span className="text-[10px] text-brand-slate">{MODO_CORTO[a.modo]}</span>}
                      {a.turno && <span className="text-[10px] text-brand-slate">· {TURNO_LABEL[a.turno].replace("Turno ", "")}</span>}
                      {a.alertas.includes("sesion_abierta") && <span className="text-[10px] font-semibold text-brand-primary-dark">· Sesión abierta{periodo && a.dias_sesion_abierta > 1 ? ` (${a.dias_sesion_abierta} días)` : ""}</span>}
                      {a.alertas.includes("sin_llamadas") && <span className="text-[10px] font-semibold text-brand-primary-dark">· Sin llamadas{periodo && a.dias_sin_llamadas > 1 ? ` (${a.dias_sin_llamadas} días)` : ""}</span>}
                    </div>
                  </td>
                  {periodo && <td className="px-3 py-2 text-right tabular-nums">{n(a.dias)}</td>}
                  <td className="px-3 py-2 text-right tabular-nums">{reloj(valor(a, "jornada") as number | null)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{n(a.llamadas)}</td>
                  {m.exacto && <td className="px-3 py-2 text-right tabular-nums">{n(a.atendidas)}</td>}
                  {m.exacto && <td className="px-3 py-2 text-right tabular-nums">{pct(a.pct_contacto)}</td>}
                  {!m.exacto && <td className="px-3 py-2 text-right tabular-nums">{a.llamadas_hora === null ? "—" : a.llamadas_hora.toLocaleString("es-PY")}</td>}
                  <td className="px-3 py-2 text-right tabular-nums">{reloj(a.conversacion)}</td>
                  <td className="px-3 py-2 text-right">{a.banda ? <BandaChip banda={a.banda} valor={a.pct_conversacion} compacto /> : <span className="text-[11px] text-brand-mist">no se evalúa</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{segundos(a.prom_conversacion)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{segundos(a.aht)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(a.pct_pausa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-brand-mist mt-3">
        {n(filas.length)} agente(s). Jornada y conversación en horas:minutos. Las sesiones abiertas ({p.sesion_abierta_horas} h o más) no se evalúan contra la meta.
      </p>
    </div>
  );
}
