"use client";

import { CircleCheck, CircleDashed, ListX, MessageSquareText, PenLine, Search, TriangleAlert, UserPlus, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { diaCorto } from "@/components/portal/coaching";
import { PortalShell } from "@/components/portal/nav";
import { Boton, Cargando, Encabezado, Etiqueta, Fallo, Fila, Hoja, Lista, PORTAL, cx, plural } from "@/components/portal/ui";
import { hrefNuevoCoaching } from "@/components/supervision/hacer-coaching";
import {
  SUP_API, TIPO_COACHING, dm, nombreMetricas, num, type LineaSinUso, type MiembroCoaching, type Uso, type VistaCoachingData,
} from "@/components/supervision/tipos";
import { apiFetch } from "@/lib/api";

type Filtro = "todos" | "alerta" | "sin_coaching" | "sin_firmar";

export default function EquipoPage() {
  return <PortalShell><Equipo /></PortalShell>;
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function Equipo() {
  const [d, setD] = useState<VistaCoachingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");
  const [filtro, setFiltro] = useState<Filtro>(() => {
    const f = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("filtro");
    return (["alerta", "sin_coaching", "sin_firmar"].includes(f ?? "") ? f : "todos") as Filtro;
  });
  const [ficha, setFicha] = useState<MiembroCoaching | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try { setD(await apiFetch<VistaCoachingData>(`${SUP_API}/portal/coaching`)); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const actuales = useMemo(() => (d?.equipo ?? []).filter((m) => m.actual), [d]);
  const anteriores = useMemo(() => (d?.equipo ?? []).filter((m) => !m.actual), [d]);
  const cumple: Record<Filtro, (m: MiembroCoaching) => boolean> = {
    todos: () => true, alerta: (m) => !!m.uso?.alerta, sin_coaching: (m) => !m.coachings, sin_firmar: (m) => (m.sin_firmar ?? 0) > 0,
  };
  const t = sinAcentos(buscar.trim());
  const lista = actuales.filter((m) => cumple[filtro](m) && (!t || sinAcentos(m.nombre).includes(t)));
  const conteo = (f: Filtro) => actuales.filter(cumple[f]).length;
  const filtros: { f: Filtro; label: string }[] = [
    { f: "todos", label: "Todos" }, { f: "alerta", label: "En alerta" }, { f: "sin_coaching", label: "Sin coaching" }, { f: "sin_firmar", label: "Sin firmar" },
  ];

  return (
    <div className="max-w-xl mx-auto">
      <Encabezado sobre="Mi portal" titulo="Mi equipo">
        {d ? `${plural(actuales.length, "asesor", "asesores")} en ${d.nombre_mes.toLowerCase()}.` : "Tu equipo del mes."}
      </Encabezado>
      {error && <Fallo onReintentar={cargar}>{error}</Fallo>}
      {!d ? (!error && <Cargando filas={6} />) : (
        <div className="space-y-4">
          <label className="relative block">
            <Search size={20} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-mist" aria-hidden />
            <input type="search" className="input !min-h-[52px] !text-base !pl-11" placeholder="Buscar asesor" value={buscar}
              onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar asesor" />
          </label>
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" role="tablist" aria-label="Filtrar">
            {filtros.map(({ f, label }) => (
              <button key={f} type="button" role="tab" aria-selected={filtro === f} onClick={() => setFiltro(f)}
                className={cx("min-h-[44px] px-4 rounded-full border text-sm font-semibold whitespace-nowrap shrink-0",
                  filtro === f ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-graphite border-brand-border")}>
                {label}{f !== "todos" && <span className={cx("ml-1.5 tabular-nums", filtro === f ? "text-white/70" : "text-brand-slate")}>{conteo(f)}</span>}
              </button>
            ))}
          </div>
          {!lista.length ? (
            <p className="card p-5 text-sm text-brand-slate">
              {t ? "Nadie de tu equipo se llama así." : filtro === "todos" ? "Todavía no tenés asesores asignados este mes." : "Nadie en este grupo."}
            </p>
          ) : (
            <Lista>
              {lista.map((m) => (
                <Fila key={m.id} onClick={() => setFicha(m)} titulo={m.nombre}
                  icono={(m.sin_firmar ?? 0) > 0 ? PenLine : m.uso?.alerta ? TriangleAlert : !m.coachings ? CircleDashed : UserRound}
                  tono={(m.sin_firmar ?? 0) > 0 ? "naranja" : m.uso?.alerta ? "rojo" : !m.coachings ? "naranja" : "gris"}
                  marcada={!!m.uso?.alerta}
                  sub={[
                    m.uso?.alerta && `En alerta · ${num(m.uso.pct_sin_uso)}% sin uso`,
                    (m.sin_firmar ?? 0) > 0 && "devolución sin firmar",
                    !m.coachings ? "sin coaching este mes" : `${plural(m.coachings, "coaching", "coachings")} · último el ${dm(m.ultimo_coaching)}`,
                  ].filter(Boolean).join(" · ")}
                  derecha={m.score !== null ? <span className="font-display text-2xl tabular-nums text-brand-ink" title="Score del mes">{num(m.score, 0)}</span> : undefined} />
              ))}
            </Lista>
          )}
          <Boton tipo="secundario" icono={UserPlus} href={`${PORTAL}/equipo/nuevo${buscar.trim() ? `?nombre=${encodeURIComponent(buscar.trim())}` : ""}`}>
            Agregar asesor nuevo
          </Boton>
          {anteriores.length > 0 && (
            <details className="card">
              <summary className="px-4 min-h-[56px] flex items-center cursor-pointer text-sm font-semibold text-brand-slate">
                Estuvieron en tu equipo este mes ({anteriores.length})
              </summary>
              <ul className="px-4 pb-3 space-y-1.5 text-sm text-brand-graphite">
                {anteriores.map((m) => (
                  <li key={m.id}>{m.nombre}{m.tramos.length > 0 && <span className="text-brand-slate"> · hasta el {dm(m.tramos[m.tramos.length - 1].hasta)}</span>}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {ficha && d && <Ficha m={ficha} d={d} onClose={() => setFicha(null)} />}
    </div>
  );
}

function Ficha({ m, d, onClose }: { m: MiembroCoaching; d: VistaCoachingData; onClose: () => void }) {
  const [lineas, setLineas] = useState<{ uso: Uso | null; lineas: LineaSinUso[] } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sinFirmar = d.sin_firmar?.find((c) => c.operador_id === m.id);
  const coachings = d.items.filter((c) => c.operador_id === m.id && c.estado !== "anulado" && c.estado !== "pendiente");
  const verLineas = async () => {
    setCargando(true);
    setError(null);
    try { setLineas(await apiFetch(`${SUP_API}/portal/lineas?operador_id=${m.id}`)); } catch (e: any) { setError(e.message); } finally { setCargando(false); }
  };
  return (
    <Hoja sobre="Asesor" titulo={m.nombre} onClose={onClose}
      pie={sinFirmar
        ? <Boton icono={PenLine} href={`${PORTAL}/coaching/${sinFirmar.id}`}>Continuar la devolución</Boton>
        : <Boton icono={MessageSquareText} href={hrefNuevoCoaching(m.id, m.uso?.alerta ? { metrica: "uso" } : undefined)}>Hacer coaching</Boton>}>
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-2">
          <Dato titulo="Score" valor={m.score === null ? "—" : num(m.score, 0)} sub={m.parcial ? "parcial" : undefined} />
          <Dato titulo="Coachings" valor={String(m.coachings)} sub={m.ultimo_coaching ? `último ${dm(m.ultimo_coaching)}` : "este mes"} />
          <Dato titulo="Sin uso" valor={m.uso?.pct_sin_uso === null || m.uso?.pct_sin_uso === undefined ? "—" : `${num(m.uso.pct_sin_uso)}%`}
            sub={m.uso ? `${m.uso.sin_uso} de ${m.uso.evaluables}` : undefined} alerta={!!m.uso?.alerta} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {m.uso?.alerta && <Etiqueta tono="rojo" icono={TriangleAlert}>En alerta por líneas sin uso</Etiqueta>}
          {m.conversacion?.roja && <Etiqueta tono="rojo">Conversación en rojo · {num(m.conversacion.valor)}%</Etiqueta>}
          {m.conversacion?.sobre_meta && <Etiqueta tono="naranja">Conversación sobre la meta</Etiqueta>}
          {!m.coachings && <Etiqueta tono="naranja" icono={CircleDashed}>Sin coaching este mes</Etiqueta>}
        </div>
        {sinFirmar && (
          <p className="rounded-lg border border-brand-orange/40 bg-brand-orange/10 px-3 py-2.5 text-sm text-[#8A5200]">
            Tiene una devolución sin firmar del {dm(sinFirmar.fecha)}{sinFirmar.devolucion_vencida ? ": ya venció." : ` (vence ${diaCorto(sinFirmar.vence_devolucion)}).`}
          </p>
        )}
        {coachings.length > 0 && (
          <div>
            <div className="label">Coachings de {d.nombre_mes.toLowerCase().split(" ")[0]}</div>
            <Lista>
              {coachings.map((c) => (
                <Fila key={c.id} href={`${PORTAL}/coaching/${c.id}`} icono={CircleCheck} tono={c.estado === "cerrado" ? "verde" : "azul"}
                  titulo={`${dm(c.fecha)} · ${TIPO_COACHING[c.tipo].label}`} sub={`${nombreMetricas(c)}${c.estado === "abierto" ? ` · seguimiento ${diaCorto(c.seguimiento_fecha)}` : " · cerrado"}`} />
              ))}
            </Lista>
          </div>
        )}
        {(m.uso?.sin_uso ?? 0) > 0 && (
          !lineas ? (
            <Boton tipo="secundario" icono={ListX} onClick={verLineas} ocupado={cargando}>Ver líneas sin uso ({m.uso!.sin_uso})</Boton>
          ) : (
            <div>
              <div className="label">Líneas sin uso</div>
              <ul className="card divide-y divide-brand-border">
                {lineas.lineas.map((l) => (
                  <li key={l.sds} className="px-4 py-3 text-sm">
                    <div className="font-semibold text-brand-ink tabular-nums">{l.linea ?? l.sds}</div>
                    <div className="text-xs text-brand-slate">{l.plan ?? "—"} · activada el {dm(l.fecha_activacion)}{l.dias !== null ? ` · ${l.dias} días` : ""}{l.estado === "en_espera" ? " · en espera" : ""}</div>
                  </li>
                ))}
                {!lineas.lineas.length && <li className="px-4 py-3 text-sm text-brand-slate">Sin líneas para mostrar.</li>}
              </ul>
            </div>
          )
        )}
        {error && <Fallo>{error}</Fallo>}
      </div>
    </Hoja>
  );
}

function Dato({ titulo, valor, sub, alerta }: { titulo: string; valor: string; sub?: string; alerta?: boolean }) {
  return (
    <div className={cx("rounded-lg border px-3 py-2.5", alerta ? "border-brand-primary/40 bg-brand-primary-light/50" : "border-brand-border")}>
      <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">{titulo}</div>
      <div className="font-display text-2xl text-brand-ink tabular-nums leading-tight">{valor}</div>
      {sub && <div className="text-[11px] text-brand-slate leading-tight">{sub}</div>}
    </div>
  );
}
