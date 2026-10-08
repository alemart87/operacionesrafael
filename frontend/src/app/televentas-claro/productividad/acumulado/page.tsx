"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Clock, MessageSquare, PhoneOutgoing, Users } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { PrintButton, PrintHeader } from "@/components/PrintButton";
import { CurvasDias, CurvasTramos } from "@/components/productividad/Graficos";
import { TablaAgentes, type FiltroBanda } from "@/components/productividad/TablaAgentes";
import {
  AvisoContacto, ComparacionModos, ContactoCard, DistribucionTiempo, Indicador, JornadaTurnos, MetaConversacion, RankingEfectividad,
} from "@/components/productividad/ui";
import {
  PROD_API, PROD_HREF, medida, fechaCorta, finDeMes, horas, isoDia, lunesDe, n, nombreMes, pct, segundos, sumarDias,
  type Banda, type RespuestaAcumulado,
} from "@/components/productividad/tipos";
import { Tabs } from "@/components/ventas-netas/ui";
import { apiFetch } from "@/lib/api";
import { PERM_PRODUCTIVIDAD_GESTION } from "@/lib/operativas";

type Modo = "semana" | "mes" | "rango";
type Vista = "resumen" | "dias" | "horario" | "agentes";

export default function AcumuladoPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="card p-10 text-brand-slate">Cargando…</div>}>
        <Acumulado />
      </Suspense>
    </AppShell>
  );
}

function rangoDe(modo: Modo, ancla: string, desde: string, hasta: string): [string, string] {
  if (modo === "semana") { const l = lunesDe(ancla); return [l, sumarDias(l, 6)]; }
  if (modo === "mes") return [`${ancla.slice(0, 7)}-01`, finDeMes(ancla)];
  return [desde, hasta];
}

function Acumulado() {
  const params = useSearchParams();
  const { can } = useSession();
  const gestion = can(PERM_PRODUCTIVIDAD_GESTION);
  const mesInicial = params.get("mes");
  const hoy = isoDia(new Date());
  const [modo, setModo] = useState<Modo>(mesInicial ? "mes" : "semana");
  const [ancla, setAncla] = useState<string>(mesInicial ? `${mesInicial}-01` : hoy);
  const [desde, setDesde] = useState(sumarDias(hoy, -13));
  const [hasta, setHasta] = useState(hoy);
  const [res, setRes] = useState<RespuestaAcumulado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("resumen");
  const [filtro, setFiltro] = useState<FiltroBanda>(null);
  const [orden, setOrden] = useState<{ k: "pct_contacto"; dir: "desc" } | null>(null);
  const primera = useRef(true);

  const [ini, fin] = rangoDe(modo, ancla, desde, hasta);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await apiFetch<RespuestaAcumulado>(`${PROD_API}/acumulado?desde=${ini}&hasta=${fin}`);
      // Primera vez: si la semana actual no tiene nada publicado, ir a la del último día publicado.
      if (primera.current && !mesInicial && !r.acumulado && r.ultimo_publicado && r.ultimo_publicado < ini) {
        primera.current = false;
        setAncla(r.ultimo_publicado);
        return;
      }
      primera.current = false;
      setRes(r);
    } catch (e: any) { setError(e.message); } finally { setCargando(false); }
  }, [ini, fin, mesInicial]);
  useEffect(() => { cargar(); }, [cargar]);

  const mover = (dir: 1 | -1) => {
    if (modo === "semana") setAncla(sumarDias(ancla, 7 * dir));
    else if (modo === "mes") { const d = new Date(`${ancla.slice(0, 7)}-01T12:00:00`); d.setMonth(d.getMonth() + dir); setAncla(isoDia(d)); }
  };

  const rango = modo === "mes" ? nombreMes(ini.slice(0, 7)) : `${fechaCorta(ini)} al ${fechaCorta(fin)}`;
  const titulo = rango.charAt(0).toUpperCase() + rango.slice(1);
  const a = res?.acumulado ?? null;
  const verBanda = (b: Banda) => { setFiltro(b); setOrden(null); setVista("agentes"); };
  const verRanking = () => { setFiltro(null); setOrden({ k: "pct_contacto", dir: "desc" }); setVista("agentes"); };

  // Días del rango: publicado / borrador sin publicar / sin datos.
  const calendario = useMemo(() => {
    if (!res) return [];
    const publicados = new Map((a?.dias ?? []).map((d) => [d.fecha, d]));
    const pendientes = new Set(res.pendientes_publicar);
    const out = [];
    for (let f = res.desde; f <= res.hasta && out.length < 93; f = sumarDias(f, 1)) {
      out.push({ fecha: f, publicado: publicados.get(f) ?? null, pendiente: pendientes.has(f), futuro: f > hoy });
    }
    return out;
  }, [res, a, hoy]);

  return (
    <>
      <PrintHeader titulo={`Productividad de llamadas · ${titulo}`} subtitulo="Acumulado de los días publicados" />
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap print:hidden">
        <div>
          <Link href={PROD_HREF} className="text-xs text-brand-slate hover:text-brand-primary">← Informes diarios</Link>
          <h1 className="font-display text-3xl text-brand-ink uppercase leading-tight mt-1">Acumulado · {titulo}</h1>
          <p className="text-sm text-brand-slate mt-1">Suma de los días <b>publicados</b>: los porcentajes se recalculan con los totales (no se promedian), con las metas vigentes.</p>
        </div>
        <PrintButton label="Imprimir" />
      </div>

      <div className="card p-4 mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <div className="flex rounded-md border border-brand-border overflow-hidden text-sm">
          {(["semana", "mes", "rango"] as Modo[]).map((m) => (
            <button key={m} type="button" onClick={() => { setModo(m); if (m === "rango") { setDesde(ini); setHasta(fin); } }}
              className={`px-4 py-2 font-semibold capitalize ${modo === m ? "bg-brand-ink text-white" : "bg-white text-brand-slate hover:text-brand-ink"}`}>
              {m === "rango" ? "Rango" : m === "semana" ? "Semana" : "Mes"}
            </button>
          ))}
        </div>
        {modo !== "rango" ? (
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" onClick={() => mover(-1)} className="btn-ghost px-2" aria-label="Anterior"><ChevronLeft size={18} /></button>
            <span className="text-sm font-semibold text-brand-ink sm:min-w-[190px] text-center">{titulo}</span>
            <button type="button" onClick={() => mover(1)} className="btn-ghost px-2" aria-label="Siguiente"><ChevronRight size={18} /></button>
            <button type="button" onClick={() => setAncla(hoy)} className="btn-ghost text-xs">Actual</button>
            {res?.ultimo_publicado && <button type="button" onClick={() => setAncla(res.ultimo_publicado!)} className="btn-ghost text-xs">Último publicado</button>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input type="date" className="input py-2 w-auto" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
            <span className="text-brand-slate">al</span>
            <input type="date" className="input py-2 w-auto" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
            <span className="text-[11px] text-brand-mist">hasta 93 días</span>
          </div>
        )}
        {cargando && <span className="text-xs text-brand-slate ml-auto">Calculando…</span>}
      </div>

      {error && <div className="card p-4 text-brand-primary mb-4">{error}</div>}

      {res && (
        <div className="card p-4 mb-5">
          <div className="flex items-center gap-2 text-xs text-brand-slate mb-2"><CalendarDays size={14} /> {n(a?.dias.length ?? 0)} día(s) publicado(s) en el período{gestion && res.pendientes_publicar.length ? <> · <b className="text-brand-orange">{n(res.pendientes_publicar.length)} con borrador sin publicar</b> (no entran)</> : null}</div>
          <div className="flex flex-wrap gap-1.5">
            {calendario.map((c) => {
              const base = "rounded-md px-2 py-1 text-[11px] font-semibold tabular-nums border";
              if (c.publicado) {
                return (
                  <Link key={c.fecha} href={`${PROD_HREF}/informes/${c.publicado.informe_id}`} title={`${n(c.publicado.llamadas)} llamadas · ${pct(c.publicado.pct_conversacion)} de conversación`}
                    className={`${base} bg-emerald-50 border-emerald-200 text-emerald-800 hover:border-emerald-500`}>{fechaCorta(c.fecha)}</Link>
                );
              }
              return (
                <span key={c.fecha} title={c.pendiente ? "Borrador sin publicar" : c.futuro ? "" : "Sin informe publicado"}
                  className={`${base} ${c.pendiente ? "bg-brand-orange/10 border-brand-orange/40 text-[#8A5200]" : "bg-white border-brand-border text-brand-mist"}`}>{fechaCorta(c.fecha)}</span>
              );
            })}
          </div>
        </div>
      )}

      {res && !a && (
        <div className="card p-12 text-center text-brand-slate">No hay días publicados en este período.</div>
      )}

      {a && (
        <>
          <div className="mb-5 print:hidden"><AvisoContacto contacto={a.contacto} /></div>
          <Tabs<Vista>
            value={vista}
            onChange={(v) => { setVista(v); if (v !== "agentes") setOrden(null); }}
            items={[
              { value: "resumen", label: "Resumen", hint: "Meta · contacto · jornada" },
              { value: "dias", label: "Curvas por día", hint: `${n(a.dias.length)} días` },
              { value: "horario", label: "Por horario", hint: a.tramos.length ? `${n(a.tramos.length)} tramos` : "Sin cortes intradía" },
              { value: "agentes", label: "Agentes", hint: `${n(a.agentes.length)} · ranking del período` },
            ]}
          />

          {vista === "resumen" && (
            <div className="space-y-5">
              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <Indicador titulo="Agentes por día" valor={(a.kpis.agentes_por_dia ?? 0).toLocaleString("es-PY")} icono={<Users size={16} />}
                  detalle={<>{n(a.kpis.agentes)} agentes distintos en el período</>} />
                <Indicador titulo="Llamadas" valor={n(a.kpis.llamadas)} icono={<PhoneOutgoing size={16} />} borde="border-l-brand-cyan"
                  detalle={medida(a.contacto).exacto
                    ? <>{n(a.kpis.llamadas_por_dia)} por día · {n(a.kpis.atendidas)} contactos · {pct(a.kpis.pct_contacto)}</>
                    : <>{n(a.kpis.llamadas_por_dia)} por día · {(a.kpis.llamadas_hora ?? 0).toLocaleString("es-PY")} por hora conectada</>} />
                <Indicador titulo="Tiempo de conversación" valor={horas(a.kpis.conversacion)} icono={<MessageSquare size={16} />} borde="border-l-brand-purple"
                  detalle={<>{horas(a.kpis.conversacion / Math.max(a.dias.length, 1))} por día</>} />
                <Indicador titulo="Promedio de conversación" valor={segundos(a.kpis.prom_conversacion)} icono={<Clock size={16} />} borde="border-l-brand-orange"
                  detalle={<>Por llamada · AHT {segundos(a.kpis.aht)}</>} />
              </div>
              <div className="grid lg:grid-cols-3 gap-5">
                <MetaConversacion r={a.kpis} agentes={a.agentes} p={a.parametros} onVerBanda={verBanda} titulo="Meta de conversación del período" />
                <ContactoCard r={a.kpis} contacto={a.contacto} mejor={a.tramo_mejor} peor={a.tramo_peor} onVerHorario={a.tramos.length ? () => setVista("horario") : undefined} />
              </div>
              <div className="grid lg:grid-cols-3 gap-5">
                <JornadaTurnos r={a.kpis} turnos={a.turnos} />
                <div className="lg:col-span-2 min-w-0"><DistribucionTiempo r={a.kpis} /></div>
              </div>
              <div className="grid xl:grid-cols-2 gap-5">
                <ComparacionModos modos={a.modos} contacto={a.contacto} periodo />
                <RankingEfectividad agentes={a.agentes} p={a.parametros} contacto={a.contacto} onVerTodo={verRanking} onAgente={() => verRanking()} />
              </div>
            </div>
          )}

          {vista === "dias" && <CurvasDias dias={a.dias} p={a.parametros} contacto={a.contacto} />}

          {vista === "horario" && (a.tramos.length ? (
            <CurvasTramos tramos={a.tramos} p={a.parametros} contacto={a.contacto} promedioContacto={a.kpis.pct_contacto}
              mejor={a.tramo_mejor} peor={a.tramo_peor} acumulado />
          ) : (
            <div className="card p-10 text-center text-sm text-brand-slate max-w-3xl mx-auto">
              Ningún día publicado del período tiene cortes durante el día. Para ver la efectividad por horario, subí el reporte varias veces por día (lo ideal, cada hora).
            </div>
          ))}

          {vista === "agentes" && (
            <section className="card p-5">
              <TablaAgentes agentes={a.agentes} p={a.parametros} contacto={a.contacto} filtro={filtro} onFiltro={setFiltro}
                periodo archivo={`productividad_${ini}_${fin}.csv`} ordenInicial={orden} />
            </section>
          )}
        </>
      )}
    </>
  );
}
