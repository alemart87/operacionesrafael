"use client";

/**
 * Clima del equipo (gerente, sub gerente y coordinador), arriba del Control de supervisores: la moral de un vistazo.
 * Dos tarjetas en palabras (equipos y líderes: cómo están, ánimo y compromiso en una escala de 5), cómo fluctuó el día (o el rango), cómo se sintió cada líder, el mapa de moral
 * (ánimo × compromiso) y las alertas con su evidencia. Los asesores se ven siempre agregados por equipo.
 */
import { AlertTriangle, Annoyed, Bot, ChevronDown, ChevronRight, Frown, HeartPulse, Laugh, Meh, Smile, ThumbsDown, ThumbsUp, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Boton, Hoja, cx, plural, useAviso } from "@/components/portal/ui";
import {
  ESTADO_CLIMA, SUP_API, TONO, type AlertaClima, type ClimaAgregado, type ClimaEquipo, type ClimaFila, type EstadoClima,
} from "./tipos";

const CYAN = "#00B2BF";
const TINTA = "#2A2F3A";
const DIA = ["D", "L", "M", "M", "J", "V", "S"];
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60) % 60).padStart(2, "0")}`;
const diaCorto = (iso: string) => { const d = new Date(`${iso}T12:00:00`); return `${DIA[d.getDay()]} ${d.getDate()}`; };

// El cálculo es numérico; en pantalla se lee en palabras y en una escala de 5 puntos.
interface Nivel { label: string; puntos: number; color: string; icono: LucideIcon }
export function nivelAnimo(v: number | null | undefined): Nivel | null {
  if (v === null || v === undefined) return null;
  if (v >= 40) return { label: "Muy bien", puntos: 5, color: "#0E8F5E", icono: Laugh };
  if (v >= 15) return { label: "Bien", puntos: 4, color: "#0E8F5E", icono: Smile };
  if (v > -15) return { label: "Normal", puntos: 3, color: "#8A93A3", icono: Meh };
  if (v > -40) return { label: "Bajo", puntos: 2, color: "#C27A00", icono: Frown };
  return { label: "Muy bajo", puntos: 1, color: "#C8231B", icono: Annoyed };
}
export function nivelCompromiso(v: number | null | undefined): Nivel | null {
  if (v === null || v === undefined) return null;
  if (v >= 80) return { label: "Muy alto", puntos: 5, color: "#00808A", icono: Smile };
  if (v >= 60) return { label: "Alto", puntos: 4, color: "#00808A", icono: Smile };
  if (v >= 40) return { label: "Medio", puntos: 3, color: "#8A93A3", icono: Meh };
  if (v >= 20) return { label: "Bajo", puntos: 2, color: "#C27A00", icono: Frown };
  return { label: "Muy bajo", puntos: 1, color: "#C8231B", icono: Annoyed };
}
const palabra = (v: number | null | undefined) => nivelAnimo(v)?.label ?? "sin datos";
const CARA: Record<EstadoClima, LucideIcon> = { animado: Laugh, comprometido: Smile, neutro: Meh, cansado: Frown, desanimado: Annoyed, sin_datos: Meh };

/** «Ánimo ●●●●○ Bien»: cinco puntos y la palabra. */
function Escala({ titulo, n }: { titulo: string; n: Nivel | null }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-brand-slate w-[92px] shrink-0">{titulo}</span>
      <span className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4, 5].map((k) => (
          <span key={k} className="w-3.5 h-3.5 rounded-full" style={{ background: n && k <= n.puntos ? n.color : "#E4E7EC" }} />
        ))}
      </span>
      <span className="text-sm font-semibold" style={{ color: n?.color ?? "#8A93A3" }}>{n?.label ?? "Sin datos"}</span>
    </div>
  );
}

function useAncho<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const o = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    o.observe(ref.current);
    return () => o.disconnect();
  }, []);
  return [ref, w];
}

// ------------------------------------------------------------------ el vistazo: equipo y líderes
const PEOR: EstadoClima[] = ["desanimado", "cansado", "neutro", "comprometido", "animado"];

/** El estado que más se repite (a igualdad, el más preocupante); sin reparto, el del promedio. */
function predominante(a: ClimaAgregado, estados: Partial<Record<EstadoClima, number>>): EstadoClima {
  const max = Math.max(0, ...Object.values(estados).map((n) => n ?? 0));
  return max ? PEOR.find((e) => (estados[e] ?? 0) === max)! : a.estado;
}

const corto = (n: string) => n.split(" ")[0];

function Vistazo({ titulo, a, estados, filas, sub, onVer }: {
  titulo: string; a: ClimaAgregado; estados: Partial<Record<EstadoClima, number>>; filas: ClimaFila[]; sub: string;
  onVer: (e: EstadoClima | null) => void;
}) {
  const reparto = PEOR.filter((e) => estados[e]);
  const equipos = titulo === "Equipos";
  return (
    <div className="card p-4 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold">{titulo}</span>
      </div>
      {(() => {
        const e = predominante(a, estados);
        const I = CARA[e];
        const plural_ = e === "cansado" ? "cansados" : `${ESTADO_CLIMA[e].label.toLowerCase()}s`;
        return (
          <div className="mt-2 flex items-center gap-3">
            <I size={40} strokeWidth={1.75} style={{ color: ESTADO_CLIMA[e].color }} aria-hidden />
            <div className="text-xl font-semibold text-brand-ink leading-tight">
              {e === "sin_datos" ? "Todavía sin señales" : <>{titulo === "Equipos" ? "Los equipos están" : "Los líderes están"} <span style={{ color: ESTADO_CLIMA[e].color }}>{plural_}</span></>}
            </div>
          </div>
        );
      })()}
      <div className="mt-3 space-y-1.5">
        <Escala titulo="Ánimo" n={nivelAnimo(a.animo)} />
        <Escala titulo="Compromiso" n={nivelCompromiso(a.compromiso)} />
      </div>
      {reparto.length > 0 && (
        <ul className="mt-3 space-y-1" aria-label="Quiénes están en cada estado">
          {reparto.map((e) => {
            const quienes = filas.filter((f) => f.estado === e);
            const nombres = quienes.slice(0, 3).map((f) => (equipos ? `equipo de ${corto(f.nombre)}` : f.nombre)).join(", ")
              + (quienes.length > 3 ? ` y ${quienes.length - 3} más` : "");
            return (
              <li key={e}>
                <button type="button" onClick={() => onVer(e)}
                  className="w-full text-left flex items-center gap-2 rounded-lg px-2 py-1.5 -mx-2 hover:bg-brand-bg active:bg-brand-bg text-sm min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ESTADO_CLIMA[e].color }} aria-hidden />
                  <span className="font-semibold text-brand-ink shrink-0">{estados[e]} {e === "cansado" ? "cansado" : ESTADO_CLIMA[e].label.toLowerCase()}{(estados[e] ?? 0) > 1 ? "s" : ""}</span>
                  <span className="text-brand-slate truncate min-w-0">· {nombres}</span>
                  <ChevronRight size={16} className="text-brand-mist shrink-0 ml-auto" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {reparto.length > 0 && (
        <button type="button" onClick={() => onVer(null)} className="mt-2 text-sm font-semibold text-brand-primary">Ver quiénes y por qué</button>
      )}
      <p className="text-[11px] text-brand-slate mt-2">{sub}</p>
    </div>
  );
}

/** Quiénes están en cada estado y por qué (del peor al mejor). Los equipos, por su supervisor. */
function Quienes({ tipo, filas, estado, onClose }: { tipo: "lideres" | "equipos"; filas: ClimaFila[]; estado: EstadoClima | null; onClose: () => void }) {
  const lista = filas.filter((f) => f.estado !== "sin_datos" && (!estado || f.estado === estado))
    .sort((a, b) => PEOR.indexOf(a.estado) - PEOR.indexOf(b.estado) || a.nombre.localeCompare(b.nombre));
  const equipos = tipo === "equipos";
  return (
    <Hoja titulo={estado ? (estado === "cansado" ? "Cansados" : `${ESTADO_CLIMA[estado].label}s`) : equipos ? "Cómo está cada equipo" : "Cómo está cada líder"}
      sobre={equipos ? "Equipos · los asesores siempre agregados" : "Líderes"} onClose={onClose}>
      <ul className="space-y-3">
        {lista.map((f) => {
          const I = CARA[f.estado];
          return (
            <li key={f.id} className="rounded-xl border border-brand-border p-3.5">
              <div className="flex items-center gap-3">
                <I size={30} strokeWidth={1.75} style={{ color: ESTADO_CLIMA[f.estado].color }} aria-hidden />
                <div className="min-w-0">
                  <div className="font-semibold text-brand-ink truncate">{equipos ? `Equipo de ${f.nombre}` : f.nombre}</div>
                  <div className="text-xs font-semibold" style={{ color: ESTADO_CLIMA[f.estado].color }}>{ESTADO_CLIMA[f.estado].label}</div>
                </div>
              </div>
              <div className="mt-2 text-xs text-brand-slate">
                Ánimo <b className="text-brand-ink">{nivelAnimo(f.animo)?.label.toLowerCase() ?? "sin datos"}</b>
                {" · "}Compromiso <b className="text-brand-ink">{nivelCompromiso(f.compromiso)?.label.toLowerCase() ?? "sin datos"}</b>
              </div>
              {f.motivos.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-brand-graphite">
                  {f.motivos.map((m) => <li key={m} className="flex gap-2"><span className="text-brand-mist" aria-hidden>•</span><span className="break-words min-w-0">{m}</span></li>)}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {!lista.length && <p className="text-sm text-brand-slate">Nadie en este estado.</p>}
    </Hoja>
  );
}

// ------------------------------------------------------------------ cómo fluctuó: líneas del equipo y de los líderes
function Lineas({ d }: { d: ClimaEquipo }) {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [sobre, setSobre] = useState<number | null>(null);
  const dia = d.modo === "dia";
  const filas = dia
    ? d.curva.map((c) => ({ x: String(c.hora), etiqueta: `${c.hora} h`, equipo: c.equipo, lideres: c.lideres, extra: c.feedback }))
    : d.dias.map((c) => ({ x: c.fecha, etiqueta: diaCorto(c.fecha), equipo: c.equipo, lideres: c.lideres, extra: null as number | null }));
  const alto = 190, izq = 46, der = 14, arriba = 10, abajo = dia ? 46 : 26;
  const w = Math.max(0, ancho - izq - der), h = alto - arriba - abajo;
  const X = (i: number) => izq + (filas.length <= 1 ? w / 2 : (i / (filas.length - 1)) * w);
  const Xh = (hora: number) => izq + ((hora - 8) / 12) * w;
  const Y = (v: number) => arriba + ((100 - v) / 200) * h;
  const trazo = (k: "equipo" | "lideres") => {
    let p = "", abierto = false;
    filas.forEach((f, i) => {
      const v = f[k];
      if (v === null) { abierto = false; return; }
      p += `${abierto ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)} `;
      abierto = true;
    });
    return p;
  };
  const cada = Math.max(1, Math.ceil(filas.length / Math.max(3, Math.floor(w / 46))));
  // Los puntos de feedback en la franja de abajo, apilados si caen a la misma hora.
  const apilados = useMemo(() => {
    const usados: Record<string, number> = {};
    return d.puntos.map((p) => {
      const k = String(Math.round(p.h * 4));
      usados[k] = (usados[k] ?? 0) + 1;
      return { ...p, fila: usados[k] - 1 };
    });
  }, [d.puntos]);
  const s = sobre !== null ? filas[sobre] : null;
  return (
    <div className="card p-4 min-w-0">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-brand-ink">{dia ? "Cómo estuvo el día" : "Cómo fue cambiando"}</h3>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-brand-slate">
          <span className="inline-flex items-center gap-1"><span className="w-4 h-0.5 rounded" style={{ background: CYAN }} /> Equipo</span>
          <span className="inline-flex items-center gap-1"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: TINTA }} /> Líderes</span>
          {dia && (Object.keys(TONO) as (keyof typeof TONO)[]).map((t) => (
            <span key={t} className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: TONO[t].color }} /> {TONO[t].label}</span>
          ))}
        </div>
      </div>
      <div ref={ref} className="relative mt-2" style={{ height: alto }} onMouseLeave={() => setSobre(null)}>
        {ancho > 0 && (
          <svg width={ancho} height={alto} role="img" aria-label={dia ? "Ánimo del equipo y de los líderes hora por hora" : "Ánimo del equipo y de los líderes por día"}>
            {[100, 50, 0, -50, -100].map((v) => (
              <g key={v}>
                <line x1={izq} x2={izq + w} y1={Y(v)} y2={Y(v)} stroke={v === 0 ? "#AEB5C2" : "#EEF0F4"} strokeDasharray={v === 0 ? "3 3" : undefined} />
                {v % 100 === 0 && <text x={izq - 6} y={Y(v) + 3} textAnchor="end" fontSize="10" fill="#6B7280">{v > 0 ? "Bien" : v < 0 ? "Bajo" : "Normal"}</text>}
              </g>
            ))}
            {s && <line x1={X(sobre!)} x2={X(sobre!)} y1={arriba} y2={arriba + h} stroke="#C9CED8" />}
            <path d={trazo("lideres")} fill="none" stroke={TINTA} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />
            <path d={trazo("equipo")} fill="none" stroke={CYAN} strokeWidth={2} strokeLinejoin="round" />
            {filas.map((f, i) => (
              <g key={f.x}>
                {f.lideres !== null && <circle cx={X(i)} cy={Y(f.lideres)} r={sobre === i ? 4.5 : 3} fill={TINTA} stroke="#fff" strokeWidth={1.5} />}
                {f.equipo !== null && <circle cx={X(i)} cy={Y(f.equipo)} r={sobre === i ? 4.5 : 3.5} fill={CYAN} stroke="#fff" strokeWidth={1.5} />}
                {(i % cada === 0 || i === filas.length - 1) && (
                  <text x={X(i)} y={alto - (dia ? 4 : 6)} textAnchor={i === filas.length - 1 && filas.length > 1 ? "end" : i === 0 && filas.length > 1 ? "start" : "middle"}
                    fontSize="10" fill="#6B7280">{f.etiqueta}</text>
                )}
                <rect x={X(i) - Math.max(8, w / filas.length / 2)} y={0} width={Math.max(16, w / filas.length)} height={alto} fill="transparent"
                  onMouseEnter={() => setSobre(i)} onClick={() => setSobre((x) => (x === i ? null : i))} />
              </g>
            ))}
            {dia && apilados.map((p, i) => (
              <circle key={i} cx={Xh(Math.min(20, Math.max(8, p.h)))} cy={arriba + h + 10 + Math.min(p.fila, 2) * 7} r={3.5}
                fill={p.tono ? TONO[p.tono].color : "#C9CED8"} stroke="#fff" strokeWidth={1}>
                <title>{`${hhmm(p.h)} · ${p.supervisor} · ${p.tono ? TONO[p.tono].label : "sin texto"}`}</title>
              </circle>
            ))}
          </svg>
        )}
        {s && (
          <div className="absolute top-0 z-10 pointer-events-none" style={{ left: X(sobre!), transform: `translateX(${X(sobre!) > ancho * 0.6 ? "-105%" : "8px"})` }}>
            <div className="rounded-md bg-brand-ink text-white text-xs px-2.5 py-1.5 shadow-elevated whitespace-nowrap">
              <div className="font-semibold">{dia ? `Hasta las ${Number(s.x) + 1} h` : s.etiqueta}</div>
              <div>Equipo: {palabra(s.equipo)} · Líderes: {palabra(s.lideres)}</div>
              {dia && <div className="text-white/70">{plural(s.extra ?? 0, "devolución", "devoluciones")} en esa hora</div>}
            </div>
          </div>
        )}
      </div>
      {dia && <p className="text-[11px] text-brand-slate">Cada punto de abajo es una devolución, con el tono con que la recibió el asesor.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ cómo se sintió cada líder
function Lideres({ filas, onVer }: { filas: ClimaFila[]; onVer: () => void }) {
  const con = filas.filter((f) => f.estado !== "sin_datos");
  const sin = filas.length - con.length;
  const pos = (v: number) => `${50 + Math.max(-100, Math.min(100, v)) / 2}%`;
  return (
    <div className="card p-4 min-w-0">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-brand-ink">Cómo se sintió cada líder</h3>
        <span className="text-[11px] text-brand-slate">← bajo · bien →</span>
      </div>
      {con.length ? (
        <ul className="mt-3 space-y-3">
          {con.map((f) => (
            <li key={f.id} className="min-w-0">
              <button type="button" onClick={onVer} className="w-full text-left block rounded-lg -mx-2 px-2 py-1 hover:bg-brand-bg active:bg-brand-bg">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-brand-ink">{f.nombre}</span>
                {(() => {
                  const n = nivelAnimo(f.animo);
                  const I = n?.icono ?? Meh;
                  return (
                    <span className="shrink-0 inline-flex items-center gap-1 font-semibold text-sm" style={{ color: n?.color ?? "#8A93A3" }}>
                      <I size={16} aria-hidden /> {n?.label ?? "Sin datos"}
                    </span>
                  );
                })()}
              </div>
              <div className="relative h-3 mt-1 rounded-full bg-brand-bg" role="img"
                aria-label={`${f.nombre}: ánimo ${palabra(f.animo)}, ${ESTADO_CLIMA[f.estado].label}`}>
                <span className="absolute inset-y-0 left-1/2 w-px bg-[#AEB5C2]" aria-hidden />
                {f.animo !== null && (
                  <span className="absolute inset-y-0 rounded-full" style={{
                    left: f.animo >= 0 ? "50%" : pos(f.animo), width: `${Math.abs(f.animo) / 2}%`, background: nivelAnimo(f.animo)!.color,
                  }} />
                )}
              </div>
              {f.motivos[0] && <div className="text-xs text-brand-slate mt-1 truncate">{f.motivos[0]}</div>}
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-brand-slate mt-3">Todavía no hay señales de los líderes.</p>}
      {sin > 0 && <p className="text-[11px] text-brand-slate mt-3">{plural(sin, "supervisor sin señales", "supervisores sin señales")} todavía (sin devoluciones, termómetro ni cierre).</p>}
    </div>
  );
}

// ------------------------------------------------------------------ mapa de moral: ánimo × compromiso
function Mapa({ lideres, equipos }: { lideres: ClimaFila[]; equipos: ClimaFila[] }) {
  const [ver, setVer] = useState<"lideres" | "equipos">("lideres");
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [sel, setSel] = useState<string | null>(null);
  const filas = (ver === "lideres" ? lideres : equipos).filter((f) => f.animo !== null && f.compromiso !== null);
  const alto = 230, m = 22;
  const w = Math.max(0, ancho - 2 * m), h = alto - 2 * m;
  const X = (a: number) => m + ((a + 100) / 200) * w;
  const Y = (c: number) => m + ((100 - c) / 100) * h;
  const zona = (x1: number, x2: number, y1: number, y2: number, e: EstadoClima) => (
    <rect x={X(x1)} y={Y(y2)} width={X(x2) - X(x1)} height={Y(y1) - Y(y2)} fill={ESTADO_CLIMA[e].color} opacity={0.07} />
  );
  const elegido = filas.find((f) => f.id === sel);
  return (
    <div className="card p-4 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-brand-ink">Mapa de moral</h3>
        <div className="inline-flex rounded-lg border border-brand-border p-0.5 text-xs" role="tablist">
          {(["lideres", "equipos"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={ver === k} onClick={() => { setVer(k); setSel(null); }}
              className={cx("px-2.5 py-1 rounded-md font-semibold", ver === k ? "bg-brand-ink text-white" : "text-brand-slate")}>
              {k === "lideres" ? "Líderes" : "Equipos"}
            </button>
          ))}
        </div>
      </div>
      <div ref={ref} className="relative mt-2" style={{ height: alto }}>
        {ancho > 0 && (
          <svg width={ancho} height={alto} role="img" aria-label={`Mapa de moral de los ${ver}: ánimo contra compromiso`}>
            {zona(20, 100, 60, 100, "animado")}
            {zona(-100, -20, 60, 100, "cansado")}
            {zona(-100, -20, 0, 60, "desanimado")}
            {zona(-20, 20, 60, 100, "comprometido")}
            <rect x={m} y={m} width={w} height={h} fill="none" stroke="#EEF0F4" />
            {[-20, 20].map((a) => <line key={a} x1={X(a)} x2={X(a)} y1={m} y2={m + h} stroke="#DDE1E8" strokeDasharray="3 3" />)}
            {[40, 60].map((c) => <line key={c} x1={m} x2={m + w} y1={Y(c)} y2={Y(c)} stroke="#DDE1E8" strokeDasharray="3 3" />)}
            <text x={X(100) - 4} y={m + 12} textAnchor="end" fontSize="10" fill={ESTADO_CLIMA.animado.color} fontWeight={700}>Animado</text>
            <text x={X(-100) + 4} y={m + 12} fontSize="10" fill={ESTADO_CLIMA.cansado.color} fontWeight={700}>Cansado</text>
            <text x={X(-100) + 4} y={m + h - 5} fontSize="10" fill={ESTADO_CLIMA.desanimado.color} fontWeight={700}>Desanimado</text>
            <text x={X(0)} y={m + 12} textAnchor="middle" fontSize="10" fill={ESTADO_CLIMA.comprometido.color} fontWeight={700}>Comprometido</text>
            <text x={m + w / 2} y={alto - 4} textAnchor="middle" fontSize="10" fill="#6B7280">← ánimo →</text>
            <text x={10} y={m + h / 2} textAnchor="middle" fontSize="10" fill="#6B7280" transform={`rotate(-90 10 ${m + h / 2})`}>compromiso</text>
            {filas.map((f) => (
              <g key={f.id} onClick={() => setSel((s) => (s === f.id ? null : f.id))} onMouseEnter={() => setSel(f.id)} style={{ cursor: "pointer" }}>
                <circle cx={X(f.animo!)} cy={Y(f.compromiso!)} r={sel === f.id ? 9 : 7} fill={ESTADO_CLIMA[f.estado].color} stroke="#fff" strokeWidth={2} />
                {filas.length <= 12 && (
                  <text x={X(f.animo!) + (f.animo! > 60 ? -11 : 11)} y={Y(f.compromiso!) + 3.5} textAnchor={f.animo! > 60 ? "end" : "start"}
                    fontSize="10" fill="#2A2F3A">{f.nombre.split(" ")[0]}</text>
                )}
              </g>
            ))}
          </svg>
        )}
        {!filas.length && ancho > 0 && <p className="absolute inset-0 grid place-items-center text-sm text-brand-slate">Sin datos para ubicar todavía.</p>}
      </div>
      <p className="text-xs text-brand-slate min-h-[18px]">
        {elegido ? <><b className="text-brand-ink">{elegido.nombre}</b>{ver === "equipos" ? " (su equipo)" : ""}: ánimo {palabra(elegido.animo).toLowerCase()} · compromiso {nivelCompromiso(elegido.compromiso)?.label.toLowerCase()} · {ESTADO_CLIMA[elegido.estado].label}</>
          : ver === "equipos" ? "Cada punto es un equipo entero: los asesores nunca se ven uno por uno." : "Tocá un punto para ver el detalle."}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ alertas con evidencia
const SEV = [
  { label: "Alta", barra: "bg-brand-primary" },
  { label: "Media", barra: "bg-[#C27A00]" },
  { label: "Para mirar", barra: "bg-[#8A93A3]" },
];
const ESTADO_ALERTA: Record<AlertaClima["estado"], string> = {
  abierta: "Abierta", tomada: "Tomada", derivada: "Derivada", descartada: "Descartada", cerrada: "Cerrada",
};

function Alertas({ d, onCambio }: { d: ClimaEquipo; onCambio: () => void }) {
  const [todas, setTodas] = useState(false);
  const [anotar, setAnotar] = useState<AlertaClima | null>(null);
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, avisar] = useAviso();
  const lista = todas ? d.alertas : d.alertas.slice(0, 4);
  const calibrar = async (a: AlertaClima, util: boolean) => {
    setOcupado(a.id);
    try {
      await apiFetch(`${SUP_API}/control/clima/alertas/${a.id}/calibrar`, { method: "POST", body: JSON.stringify({ util }) });
      avisar(util ? "Gracias: marcada como útil." : "Marcada como falsa alarma (y descartada).");
      onCambio();
    } catch (e: any) { avisar(e.message, "error"); } finally { setOcupado(null); }
  };
  const guardar = async () => {
    if (!anotar) return;
    setOcupado(anotar.id);
    try {
      await apiFetch(`${SUP_API}/comando/alertas/${anotar.id}/tomar`, { method: "POST", body: JSON.stringify({ nota: nota.trim() || null }) });
      avisar("Alerta tomada.");
      setAnotar(null);
      onCambio();
    } catch (e: any) { avisar(e.message, "error"); } finally { setOcupado(null); }
  };
  const c = d.calibracion;
  return (
    <div className="card p-4 min-w-0" id="alertas-clima">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-brand-ink flex items-center gap-1.5"><AlertTriangle size={16} aria-hidden /> Lo que llama la atención</h3>
        <span className="text-[11px] text-brand-slate">
          {c.nivel === "alta" ? "Calibrando: solo alertas altas" : c.nivel === "media" ? "Alertas altas y medias" : "Todas las alertas"}
          {c.pct_util !== null && ` · ${c.pct_util}% útiles (${c.marcadas})`}
        </span>
      </div>
      {!d.alertas.length ? <p className="text-sm text-brand-slate mt-3">Nada para charlar en este período.</p> : (
        <ul className="mt-3 space-y-2.5">
          {lista.map((a) => {
            const sev = SEV[Math.min(2, a.severidad)];
            const viva = a.estado === "abierta" || a.estado === "tomada";
            return (
              <li key={a.id} className={cx("relative rounded-lg border border-brand-border pl-4 pr-3 py-3 overflow-hidden", !viva && "opacity-70")}>
                <span className={cx("absolute left-0 inset-y-0 w-1", sev.barra)} aria-hidden />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">{sev.label} · {ESTADO_ALERTA[a.estado]}{a.tomada_por ? ` por ${a.tomada_por}` : ""}</div>
                    <div className="font-semibold text-brand-ink text-sm break-words">{a.titulo}</div>
                  </div>
                </div>
                <p className="text-xs text-brand-graphite mt-1 break-words">{a.detalle}</p>
                {a.nota && <p className="text-xs text-brand-slate mt-1 break-words">Qué se hizo: {a.nota}</p>}
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {d.puede_actuar && viva && (
                    <button type="button" className="btn-secondary !py-1 !px-3 !text-xs" onClick={() => { setAnotar(a); setNota(a.nota ?? ""); }}>
                      {a.estado === "abierta" ? "Tomar" : "Anotar"}
                    </button>
                  )}
                  {a.util === null ? (
                    <>
                      <button type="button" disabled={ocupado === a.id} onClick={() => calibrar(a, true)}
                        className="inline-flex items-center gap-1 text-xs text-brand-slate hover:text-emerald-700 px-1.5 py-1" aria-label="Fue útil">
                        <ThumbsUp size={14} aria-hidden /> Útil
                      </button>
                      <button type="button" disabled={ocupado === a.id} onClick={() => calibrar(a, false)}
                        className="inline-flex items-center gap-1 text-xs text-brand-slate hover:text-brand-primary-dark px-1.5 py-1" aria-label="Falsa alarma">
                        <ThumbsDown size={14} aria-hidden /> Falsa alarma
                      </button>
                    </>
                  ) : <span className="text-[11px] text-brand-slate">{a.util ? "Marcada útil" : "Falsa alarma"}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {d.alertas.length > 4 && (
        <button type="button" className="mt-2 text-xs font-semibold text-brand-primary inline-flex items-center gap-1" onClick={() => setTodas((t) => !t)}>
          <ChevronDown size={14} className={todas ? "rotate-180" : ""} aria-hidden /> {todas ? "Ver menos" : `Ver las ${d.alertas.length}`}
        </button>
      )}
      {anotar && (
        <Hoja titulo={anotar.estado === "abierta" ? "Tomar la alerta" : "Anotar qué se hizo"} sobre={anotar.titulo} onClose={() => setAnotar(null)}
          ocupada={ocupado === anotar.id}
          pie={<Boton onClick={guardar} ocupado={ocupado === anotar.id}>{anotar.estado === "abierta" ? "Tomarla" : "Guardar"}</Boton>}>
          <label className="block text-sm text-brand-slate mb-1.5" htmlFor="nota-clima">Qué se hizo (opcional)</label>
          <textarea id="nota-clima" className="input min-h-[110px]" maxLength={1000} value={nota} onChange={(e) => setNota(e.target.value)}
            placeholder="Ej.: charlamos en privado y acordamos…" />
        </Hoja>
      )}
      {aviso}
    </div>
  );
}

// ------------------------------------------------------------------ la sección
export function ClimaDelEquipo({ desde, hasta, refresco }: { desde: string; hasta: string; refresco?: number }) {
  const [d, setD] = useState<ClimaEquipo | null>(null);
  const [ver, setVer] = useState<{ tipo: "lideres" | "equipos"; estado: EstadoClima | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const primera = useRef(true);
  const cargar = useCallback(async (auto: boolean) => {
    try {
      setD(await apiFetch<ClimaEquipo>(`${SUP_API}/control/clima?desde=${desde}&hasta=${hasta}${auto ? "&auto=true" : ""}`));
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, [desde, hasta]);
  useEffect(() => { primera.current = true; cargar(false); }, [cargar]);
  useEffect(() => {
    if (primera.current) { primera.current = false; return; }
    cargar(true);
  }, [refresco, cargar]);
  if (error) return <p className="card p-4 text-sm text-brand-primary">{error}</p>;
  if (!d) return <div className="card p-6 text-sm text-brand-slate">Midiendo el clima…</div>;
  const r = d.resumen;
  const cuando = d.modo === "dia" ? (d.desde === d.hoy ? "hoy" : `el ${diaCorto(d.desde)}`) : `del ${diaCorto(d.desde)} al ${diaCorto(d.hasta)}`;
  const abiertas = d.alertas.filter((a) => a.estado === "abierta").length;
  const ia = d.ia.estado === "activa" || d.ia.estado === "simulador"
    ? `IA de noche (${d.ia.hora} h)${r.con_ia ? " · afinado" : ""}` : "Medido con reglas";
  return (
    <section className="space-y-3" id="clima" aria-label="Clima del equipo">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-display text-2xl uppercase text-brand-ink leading-tight flex items-center gap-2"><HeartPulse size={20} aria-hidden /> Clima del equipo</h2>
          <p className="text-sm text-brand-slate">Ánimo y compromiso de los líderes y de sus equipos, {cuando}.</p>
        </div>
        <span className="text-[11px] text-brand-slate inline-flex items-center gap-1"><Bot size={12} aria-hidden /> {ia}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto] gap-3">
        <Vistazo titulo="Equipos" a={r.equipo} estados={r.estados_equipos} filas={d.equipos} onVer={(e) => setVer({ tipo: "equipos", estado: e })} sub="La voz de los asesores (al firmar y en sus compromisos) y el tono del feedback que recibieron." />
        <Vistazo titulo="Líderes" a={r.lideres} estados={r.estados_lideres} filas={d.lideres} onVer={(e) => setVer({ tipo: "lideres", estado: e })} sub={`${r.con_datos} de ${r.supervisores} supervisores con señales: termómetro, cierre del día, devoluciones y compromisos.`} />
        <a href="#alertas-clima" className={cx("card p-4 flex flex-col justify-between min-w-[150px] sm:col-span-2 xl:col-span-1", abiertas > 0 && "border-brand-orange/50")}>
          <span className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold">Para charlar</span>
          <span className="font-display text-4xl leading-none tabular-nums text-brand-ink mt-2">{abiertas}</span>
          <span className="text-[11px] text-brand-slate mt-1">{plural(abiertas, "alerta abierta", "alertas abiertas")}</span>
        </a>
      </div>
      <div className="grid lg:grid-cols-2 gap-3">
        <Lineas d={d} />
        <Lideres filas={d.lideres} onVer={() => setVer({ tipo: "lideres", estado: null })} />
      </div>
      <div className="grid lg:grid-cols-2 gap-3 items-start">
        <Mapa lideres={d.lideres} equipos={d.equipos} />
        <Alertas d={d} onCambio={() => cargar(true)} />
      </div>
      {d.cambios.length > 0 && (
        <div className="card p-4">
          <h3 className="font-semibold text-brand-ink">Quién mejoró y quién bajó</h3>
          <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {d.cambios.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-brand-ink">{c.nombre}</span>
                <span className={cx("tabular-nums font-semibold shrink-0", c.delta > 0 ? "text-emerald-700" : "text-brand-primary-dark")}>
                  {palabra(c.antes)} → {palabra(c.despues)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11px] text-brand-slate">
        Los asesores se ven siempre agregados por equipo. Cada consulta queda registrada. Los supervisores saben que su termómetro y su cierre los ven sus jefes.
      </p>
      {ver && <Quienes tipo={ver.tipo} filas={ver.tipo === "lideres" ? d.lideres : d.equipos} estado={ver.estado} onClose={() => setVer(null)} />}
    </section>
  );
}
