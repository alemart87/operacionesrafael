"use client";

import { CalendarClock, CircleCheck, CircleDashed, ClipboardCheck, PenLine, Ticket, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSession } from "@/components/AppShell";
import { diaCorto, hoyPy } from "@/components/portal/coaching";
import { PortalShell } from "@/components/portal/nav";
import { Cargando, Encabezado, Fallo, Fila, Lista, PORTAL, Seccion, plural, useAviso } from "@/components/portal/ui";
import { BotonCoaching, hrefNuevoCoaching } from "@/components/supervision/hacer-coaching";
import {
  SUP_API, mesActual, num, type DetalleSupervisor, type Proyeccion, type VistaCoachingData,
} from "@/components/supervision/tipos";
import { BarraAvance, CriticoBadge, SelectorMes, VistaSupervisor } from "@/components/supervision/ui";
import { apiFetch } from "@/lib/api";

/** Portal del supervisor · Hoy: lo que tiene que atender, su mes de un vistazo y el detalle del equipo. Pensado para el celular. */
export default function PortalPage() {
  return <PortalShell><Hoy /></PortalShell>;
}

const AVISOS: Record<string, string> = {
  guardado: "Coaching guardado sin firmar: queda en «Para hoy» hasta la devolución.",
  anulado: "Coaching anulado.",
};

function Hoy() {
  const { user } = useSession();
  const [d, setD] = useState<DetalleSupervisor | null>(null);
  const [v, setV] = useState<VistaCoachingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, avisar] = useAviso();

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [a, b] = await Promise.all([
        apiFetch<DetalleSupervisor>(`${SUP_API}/portal`),
        apiFetch<VistaCoachingData>(`${SUP_API}/portal/coaching`),
      ]);
      setD(a);
      setV(b);
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const a = q.get("aviso");
    if (a && AVISOS[a]) {
      avisar(AVISOS[a]);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [avisar]);

  const nombre = user.full_name.split(" ")[0];
  const fecha = new Date().toLocaleDateString("es-PY", { timeZone: "America/Asuncion", weekday: "long", day: "numeric", month: "long" });
  return (
    <div className="max-w-xl md:max-w-none mx-auto">
      <Encabezado sobre={fecha} titulo={<>Hola, <span className="text-brand-primary">{nombre}</span></>}
        accion={d && <CriticoBadge critico={d.critico} enAlerta={d.asesores_en_alerta} />} />
      <div className="md:max-w-md">
        <BotonCoaching href={hrefNuevoCoaching()} className="w-full !py-4 !text-xl rounded-xl" />
      </div>
      {error && <div className="mt-4"><Fallo onReintentar={cargar}>{error}</Fallo></div>}
      {!d || !v ? (!error && <div className="mt-6"><Cargando filas={4} /></div>) : (
        <div className="mt-6 grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-start">
          <ParaHoy d={d} v={v} />
          <TuMes d={d} />
        </div>
      )}
      {d && <Detalle inicial={d} />}
      {aviso}
    </div>
  );
}

function ParaHoy({ d, v }: { d: DetalleSupervisor; v: VistaCoachingData }) {
  const hoy = hoyPy();
  const x = d.coaching;
  const filas: ReactNode[] = [];
  for (const c of [...(v.sin_firmar ?? [])].sort((a, b) => Number(b.devolucion_vencida) - Number(a.devolucion_vencida))) {
    filas.push(
      <Fila key={`sf-${c.id}`} href={`${PORTAL}/coaching/${c.id}`} icono={PenLine} tono={c.devolucion_vencida ? "rojo" : "naranja"} marcada={c.devolucion_vencida}
        titulo={`Devolución de ${c.operador}`}
        sub={c.devolucion_vencida ? `Sin firmar · venció ${diaCorto(c.vence_devolucion, hoy)}` : `Sin firmar · hasta ${diaCorto(c.vence_devolucion, hoy)}`} />,
    );
  }
  for (const c of v.pendientes.filter((c) => c.seguimiento === "vencido" || c.seguimiento === "hoy")) {
    filas.push(
      <Fila key={`sg-${c.id}`} href={`${PORTAL}/coaching/${c.id}`} icono={ClipboardCheck} tono={c.seguimiento === "vencido" ? "rojo" : "azul"}
        marcada={c.seguimiento === "vencido"} titulo={`Seguimiento de ${c.operador}`}
        sub={c.seguimiento === "vencido" ? `Venció · era ${diaCorto(c.seguimiento_fecha, hoy)}` : c.seguimiento_fecha < hoy ? "Último día: era ayer" : "Acordado para hoy"} />,
    );
  }
  for (const a of v.alertas.filter((a) => a.estado === "vencida" || a.estado === "en_plazo")) {
    filas.push(
      <Fila key={`al-${a.id}`} href={hrefNuevoCoaching(a.operador_id, { metrica: "uso" })} icono={TriangleAlert}
        tono={a.estado === "vencida" ? "rojo" : "naranja"} marcada={a.estado === "vencida"}
        titulo={`${a.operador}: líneas sin uso`}
        sub={`${a.datos.pct_sin_uso !== null && a.datos.pct_sin_uso !== undefined ? `${num(a.datos.pct_sin_uso)}% sin uso · ` : ""}${a.estado === "vencida" ? `el plazo venció ${diaCorto(a.vence, hoy)}` : `coaching sobre uso hasta ${diaCorto(a.vence, hoy)}`}`} />,
    );
  }
  const tk = { vencidos: x?.tickets_vencidos ?? 0, por_vencer: x?.tickets_por_vencer ?? 0, nuevos: x?.tickets_nuevos ?? 0 };
  if (tk.vencidos + tk.por_vencer + tk.nuevos > 0) {
    filas.push(
      <Fila key="tk" href={`${PORTAL}/tickets`} icono={Ticket} tono={tk.vencidos ? "rojo" : tk.por_vencer ? "naranja" : "azul"} marcada={!!tk.vencidos}
        titulo={plural(tk.vencidos + tk.por_vencer + tk.nuevos, "ticket para atender", "tickets para atender")}
        sub={[tk.vencidos && plural(tk.vencidos, "vencido", "vencidos"), tk.por_vencer && plural(tk.por_vencer, "por vencer", "por vencer"),
          tk.nuevos && plural(tk.nuevos, "sin responder", "sin responder")].filter(Boolean).join(" · ")} />,
    );
  }
  if (x?.sin_coaching) {
    filas.push(
      <Fila key="sc" href={`${PORTAL}/equipo?filtro=sin_coaching`} icono={CircleDashed} tono="naranja"
        titulo={plural(x.sin_coaching, "asesor sin coaching este mes", "asesores sin coaching este mes")} sub="Cada asesor necesita al menos uno en el mes." />,
    );
  }
  if (x?.seguimientos_proximos) {
    filas.push(
      <Fila key="px" href={`${PORTAL}/coaching`} icono={CalendarClock} tono="azul"
        titulo={plural(x.seguimientos_proximos, "seguimiento próximo", "seguimientos próximos")}
        sub={x.proximos_hasta ? `Hasta ${diaCorto(x.proximos_hasta, hoy)}: preparalos antes.` : undefined} />,
    );
  }
  return (
    <Seccion titulo="Para hoy">
      {filas.length ? <Lista>{filas}</Lista> : (
        <div className="card px-4 py-5 flex items-center gap-3">
          <span className="w-11 h-11 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"><CircleCheck size={22} aria-hidden /></span>
          <div><div className="font-semibold text-brand-ink">Todo al día</div><div className="text-[13px] text-brand-slate">Sin devoluciones, seguimientos, alertas ni tickets pendientes.</div></div>
        </div>
      )}
    </Seccion>
  );
}

function Avance({ titulo, p }: { titulo: string; p: Proyeccion }) {
  const pct = p.pct_proyeccion;
  const tono = pct === null ? "text-brand-ink" : pct >= 100 ? "text-emerald-700" : pct >= 90 ? "text-[#8A5200]" : "text-brand-primary-dark";
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold">{titulo}</span>
        <span className="text-xs text-brand-slate tabular-nums">{p.vendido ?? 0}{p.objetivo ? ` de ${p.objetivo}` : ""}</span>
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className={`font-display text-4xl tabular-nums leading-none ${tono}`}>{pct === null ? "—" : `${num(pct, 0)}%`}</span>
        <span className="text-xs text-brand-slate">al cierre, al ritmo de hoy</span>
      </div>
      <div className="mt-3"><BarraAvance p={p} alto="h-2.5" etiqueta={`${titulo}: ${p.vendido ?? 0} vendidas`} /></div>
      {p.faltan !== null && p.faltan > 0 && p.ritmo_necesario !== null && (
        <p className="text-xs text-brand-slate mt-2">Faltan <b className="text-brand-ink">{p.faltan}</b>: {num(p.ritmo_necesario)} por día hábil.</p>
      )}
    </div>
  );
}

function TuMes({ d }: { d: DetalleSupervisor }) {
  return (
    <Seccion titulo={`Tu ${d.nombre_mes.toLowerCase().split(" ")[0]}`} sub="Lo vendido contra el objetivo y cómo cerrarías el mes.">
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2 gap-3">
          <Avance titulo="Pospago" p={d.pospago} />
          <Avance titulo="GPON" p={d.gpon} />
        </div>
        {d.scoring && (
          <div className="card p-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold">Tu score</div>
              <div className="text-xs text-brand-slate">{d.scoring.parcial ? "Parcial: faltan datos del mes" : "Resultados y gestión del mes"}</div>
            </div>
            <span className="font-display text-4xl tabular-nums text-brand-ink">{d.scoring.total === null ? "—" : num(d.scoring.total, 0)}</span>
          </div>
        )}
      </div>
    </Seccion>
  );
}

/** El detalle completo del equipo (objetivos, scoring, tabla por asesor), plegado en el celular. */
function Detalle({ inicial }: { inicial: DetalleSupervisor }) {
  const [abierto, setAbierto] = useState(false);
  const [periodo, setPeriodo] = useState(inicial.periodo);
  const [d, setD] = useState<DetalleSupervisor>(inicial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (window.matchMedia("(min-width: 768px)").matches) setAbierto(true); }, []);
  useEffect(() => {
    if (periodo === inicial.periodo) { setD(inicial); return; }
    setError(null);
    apiFetch<DetalleSupervisor>(`${SUP_API}/portal?periodo=${periodo}`).then(setD).catch((e) => setError(e.message));
  }, [periodo, inicial]);
  return (
    <details className="mt-8 group" open={abierto} onToggle={(e) => setAbierto((e.target as HTMLDetailsElement).open)}>
      <summary className="card px-4 min-h-[56px] flex items-center justify-between cursor-pointer list-none">
        <span className="font-display text-xl uppercase text-brand-ink">Detalle del equipo y proyección</span>
        <span className="text-sm font-semibold text-brand-primary group-open:hidden">Ver</span>
        <span className="text-sm font-semibold text-brand-slate hidden group-open:inline">Ocultar</span>
      </summary>
      {abierto && (
        <div className="mt-4 space-y-4">
          <div className="flex justify-end"><SelectorMes periodo={periodo} onChange={setPeriodo} max={mesActual()} /></div>
          {error ? <Fallo>{error}</Fallo> : d.periodo !== periodo ? <Cargando /> : (
            <VistaSupervisor d={d} lineasUrl={(op) => `${SUP_API}/portal/lineas?periodo=${periodo}&operador_id=${op}`}
              coachingHref={periodo === mesActual() ? (op) => hrefNuevoCoaching(op) : undefined} />
          )}
        </div>
      )}
    </details>
  );
}
