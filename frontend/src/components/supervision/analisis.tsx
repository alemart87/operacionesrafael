"use client";

/**
 * Analizador semántico de coaching (gerente, sub gerente y coordinador): los coachings firmados del rango con sus
 * números, la evaluación de cada supervisor, el tiempo estimado, el mapa de palabras del feedback y de los compromisos, y
 * los informes que escribe Claude (Haiku) leyendo los textos y las transcripciones (sin nombres).
 */
import {
  AlertTriangle, CircleCheck, Clock3, FileText, Lightbulb, LoaderCircle, MessageSquareText, Mic, RefreshCw, Search,
  Sparkles, Star, ThumbsUp, TrendingUp, Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { hoyPy } from "@/components/portal/coaching";
import { Boton, Cargando, Etiqueta, Fallo, cx, plural, useAviso } from "@/components/portal/ui";
import { fechaCorta } from "@/components/productividad/tipos";
import { apiFetch } from "@/lib/api";
import { VerCoachingDialog } from "./coaching";
import { BarrasH, BarrasV, LeyendaOrigen, MapaPalabras, Medidor } from "./graficos";
import {
  METRICA, NIVEL, SUP_API, TIPO_COACHING, dm, fechaHoraCorta, nombreMetricas, num, sumarDias,
  type AnalisisCoaching, type InformeAnalisis, type PalabraAnalisis, type ResultadoInforme, type SupervisorAnalisis,
} from "./tipos";

type Pestana = "resumen" | "supervisores" | "palabras" | "coachings" | "informe";
const PESTANAS: { k: Pestana; label: string }[] = [
  { k: "resumen", label: "Resumen" }, { k: "supervisores", label: "Supervisores" }, { k: "palabras", label: "Palabras" },
  { k: "coachings", label: "Coachings" }, { k: "informe", label: "Informe IA" },
];

type Preset = "mes" | "anterior" | "7d" | "30d" | "otro";
function rango(p: Preset, hoy: string, actual?: { desde: string; hasta: string }): { desde: string; hasta: string } {
  if (p === "7d") return { desde: sumarDias(hoy, -6), hasta: hoy };
  if (p === "30d") return { desde: sumarDias(hoy, -29), hasta: hoy };
  if (p === "anterior") {
    const fin = sumarDias(`${hoy.slice(0, 7)}-01`, -1);
    return { desde: `${fin.slice(0, 7)}-01`, hasta: fin };
  }
  if (p === "otro" && actual) return actual;
  return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${num(v, 0)}%`);

function Kpi({ titulo, valor, sub, icono: I }: { titulo: string; valor: ReactNode; sub?: ReactNode; icono: typeof Users }) {
  return (
    <div className="card p-3.5 min-w-0">
      <div className="flex items-start gap-1.5 text-[11px] leading-tight font-semibold uppercase tracking-wider2 text-brand-slate min-h-[2lh] sm:min-h-0">
        <I size={13} className="shrink-0 mt-px" aria-hidden /> <span className="min-w-0 break-words">{titulo}</span>
      </div>
      <div className="font-display text-[32px] leading-none tabular-nums text-brand-ink mt-1.5">{valor}</div>
      {sub && <div className="text-xs text-brand-slate mt-1 leading-snug">{sub}</div>}
    </div>
  );
}

function Panel({ titulo, sub, children, accion }: { titulo: string; sub?: ReactNode; children: ReactNode; accion?: ReactNode }) {
  return (
    <section className="card p-4 sm:p-5 min-w-0">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">{titulo}</h2>
          {sub && <p className="text-xs text-brand-slate mt-0.5 leading-snug">{sub}</p>}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ resumen
function Resumen({ a }: { a: AnalisisCoaching }) {
  const k = a.kpis;
  const muchos = a.por_dia.length > 14;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Kpi icono={CircleCheck} titulo="Coachings firmados" valor={k.coachings} sub={`${plural(k.asesores, "asesor", "asesores")} · ${k.en_curso} en curso · ${k.revisados} revisados`} />
        <Kpi icono={Clock3} titulo="Tiempo estimado" valor={k.minutos_prom === null ? "—" : `${num(k.minutos_prom)}′`}
          sub={k.minutos_mediana !== null ? `mediana ${num(k.minutos_mediana)} min · ${num(k.minutos_total / 60)} h en total` : "por coaching"} />
        <Kpi icono={MessageSquareText} titulo="Profundidad" valor={k.prom_items ?? "—"}
          sub={`monitoreos y feedback por coaching · ${k.prom_palabras_feedback ?? "—"} palabras`} />
        <Kpi icono={TrendingUp} titulo="Compromisos cumplidos" valor={pct(k.pct_cumplimiento)}
          sub={`${k.cumplimiento.cumplido} cumplidos · ${k.cumplimiento.parcial} parciales · ${k.cumplimiento.no_cumplido} no`} />
        <Kpi icono={Star} titulo="Compromisos medibles" valor={pct(k.pct_compromisos_con_fecha)} sub={`con fecha · ${pct(k.pct_compromisos_con_metrica)} con métrica`} />
        <Kpi icono={Mic} titulo="Voz del asesor" valor={pct(k.pct_compromiso_dicho)} sub={`dijo su compromiso · ${num(k.minutos_audio)} min de audio`} />
        <Kpi icono={CircleCheck} titulo="Devolución a tiempo" valor={pct(k.pct_firma_a_tiempo)}
          sub={k.horas_firma_mediana !== null ? `firma en ${num(k.horas_firma_mediana)} h (mediana)` : "dentro de 2 días hábiles"} />
        <Kpi icono={ThumbsUp} titulo="Seguimiento a tiempo" valor={pct(k.pct_seguimiento_a_tiempo)}
          sub={k.seguimientos.a_tiempo + k.seguimientos.tarde + k.seguimientos.vencido
            ? `${k.seguimientos.a_tiempo} en fecha · ${k.seguimientos.tarde} tarde · ${k.seguimientos.vencido} vencidos`
            : `ninguno venció todavía · ${k.seguimientos.hoy + k.seguimientos.proximo} por venir`} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel titulo="Coachings firmados por día">
          <BarrasV datos={a.por_dia.map((x) => ({ clave: x.dia, valor: x.coachings }))} etiqueta={(c) => dm(c)}
            detalle={(c, v) => `${fechaCorta(c)}: ${plural(v, "coaching", "coachings")}`} marcas={muchos ? 6 : 10} />
        </Panel>
        <Panel titulo="Tiempo estimado de cada coaching" sub={`Pasos seguidos con pausas de hasta ${a.reglas.pausa_sesion_min} min, más ${a.reglas.minuto_arranque} min de arranque.`}>
          <BarrasV datos={a.duraciones.map((x) => ({ clave: x.tramo, valor: x.coachings }))} etiqueta={(c) => c.replace(" min", "")}
            detalle={(c, v) => `${c}: ${plural(v, "coaching", "coachings")}`} />
        </Panel>
        <Panel titulo="Hora de la firma">
          <BarrasV datos={a.por_hora.map((x) => ({ clave: String(x.hora), valor: x.coachings }))} etiqueta={(c) => `${c}h`}
            detalle={(c, v) => `De ${c} a ${Number(c) + 1} h: ${plural(v, "coaching", "coachings")}`} marcas={9} />
        </Panel>
        <Panel titulo="Qué se trabajó" sub="Métricas de los coachings (uno puede tener varias) y tipo.">
          <BarrasH datos={a.por_metrica.map((x) => ({ etiqueta: METRICA[x.metrica]?.label ?? x.metrica, valor: x.coachings }))} />
          <div className="flex flex-wrap gap-2 mt-4">
            {a.por_tipo.map((t) => <Etiqueta key={t.tipo}>{TIPO_COACHING[t.tipo].label}: {t.coachings}</Etiqueta>)}
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ supervisores
function TarjetaSupervisor({ s, onSolo }: { s: SupervisorAnalisis; onSolo: () => void }) {
  const ev = s.evaluacion;
  const nv = ev.nivel ? NIVEL[ev.nivel] : null;
  return (
    <li className="card p-4 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-[16px] text-brand-ink truncate">{s.nombre}</h3>
          <p className="text-xs text-brand-slate">{plural(s.coachings, "coaching firmado", "coachings firmados")} · equipo de {s.equipo}{s.en_curso ? ` · ${s.en_curso} en curso` : ""}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="font-display text-4xl leading-none tabular-nums text-brand-ink">{ev.total === null ? "—" : num(ev.total, 0)}</div>
          {nv && <span className={`inline-flex mt-1 rounded border px-1.5 text-[10px] font-semibold ${nv.chip}`}>{nv.label}</span>}
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {ev.componentes.map((c) => (
          <li key={c.clave} title={c.ayuda}>
            <div className="flex justify-between gap-2 text-xs">
              <span className="text-brand-graphite truncate">{c.nombre} <span className="text-brand-mist">· {c.peso}</span></span>
              <span className="tabular-nums font-semibold text-brand-ink">{c.valor === null ? "sin datos" : `${num(c.valor, 0)}`}</span>
            </div>
            <Medidor valor={c.valor} color={c.valor === null ? undefined : c.valor >= 80 ? "#10b981" : c.valor >= 60 ? "#2A78D6" : c.valor >= 40 ? "#F39200" : "#E6332A"} alto="h-1.5" />
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
        <div className="rounded-md border border-brand-border py-1.5"><div className="font-display text-xl tabular-nums leading-none">{s.minutos_prom === null ? "—" : `${num(s.minutos_prom)}′`}</div><div className="text-[10px] text-brand-slate mt-0.5">por coaching</div></div>
        <div className="rounded-md border border-brand-border py-1.5"><div className="font-display text-xl tabular-nums leading-none">{s.prom_items ?? "—"}</div><div className="text-[10px] text-brand-slate mt-0.5">observaciones</div></div>
        <div className="rounded-md border border-brand-border py-1.5"><div className="font-display text-xl tabular-nums leading-none">{pct(s.pct_compromiso_dicho)}</div><div className="text-[10px] text-brand-slate mt-0.5">voz del asesor</div></div>
      </div>
      {ev.parcial && <p className="text-[11px] text-brand-slate mt-2">Parcial: algunos componentes todavía no tienen datos.</p>}
      <button type="button" onClick={onSolo} className="mt-3 w-full min-h-[44px] rounded-md border border-brand-border text-sm font-semibold text-brand-ink hover:border-brand-ink">
        Ver solo a {s.nombre.split(" ")[0]}
      </button>
    </li>
  );
}

// ------------------------------------------------------------------ palabras
function Palabras({ a, onPalabra }: { a: AnalisisCoaching; onPalabra: (p: string) => void }) {
  const [origen, setOrigen] = useState<"todo" | "feedback" | "compromiso">("todo");
  const lista: PalabraAnalisis[] = useMemo(() => {
    const xs = a.palabras.palabras.map((p) => (origen === "todo" ? p : { ...p, n: p[origen] })).filter((p) => p.n > 0);
    return xs.sort((x, y) => y.n - x.n);
  }, [a, origen]);
  return (
    <div className="space-y-4">
      <Panel titulo="Mapa de palabras" sub={`Las palabras que más se repiten (${a.palabras.total.toLocaleString("es-PY")} en total), sin palabras vacías ni nombres. Tocá una para ver sus coachings.`}
        accion={
          <div className="flex gap-1.5" role="group" aria-label="Origen">
            {(["todo", "feedback", "compromiso"] as const).map((o) => (
              <button key={o} type="button" onClick={() => setOrigen(o)} aria-pressed={origen === o}
                className={cx("min-h-[36px] px-3 rounded-full border text-xs font-semibold", origen === o ? "bg-brand-ink text-white border-brand-ink" : "bg-white border-brand-border text-brand-graphite")}>
                {o === "todo" ? "Todo" : o === "feedback" ? "Feedback" : "Compromisos"}
              </button>
            ))}
          </div>
        }>
        {lista.length ? <MapaPalabras palabras={lista} onElegir={onPalabra} /> : <p className="text-sm text-brand-slate py-8 text-center">Sin textos en el rango.</p>}
        <div className="mt-2"><LeyendaOrigen /></div>
      </Panel>
      <div className="grid md:grid-cols-2 gap-4">
        <Panel titulo="Las 15 más frecuentes">
          <BarrasH datos={lista.slice(0, 15).map((p) => ({ etiqueta: p.texto, valor: p.n }))} color="#2A2F3A" />
        </Panel>
        <Panel titulo="Frases que se repiten" sub="Pares de palabras seguidas.">
          {a.palabras.pares.length ? <BarrasH datos={a.palabras.pares.slice(0, 15).map((p) => ({ etiqueta: p.texto, valor: p.n }))} color="#662483" />
            : <p className="text-sm text-brand-slate">Todavía no hay frases repetidas.</p>}
        </Panel>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ coachings
function Coachings({ a, buscar, setBuscar, onVer }: { a: AnalisisCoaching; buscar: string; setBuscar: (v: string) => void; onVer: (id: string) => void }) {
  const t = buscar.trim().toLowerCase();
  const lista = t ? a.coachings.filter((c) => c.texto.toLowerCase().includes(t) || c.operador.toLowerCase().includes(t) || c.supervisor.toLowerCase().includes(t)) : a.coachings;
  return (
    <div className="space-y-3">
      <label className="relative block">
        <Search size={20} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-mist" aria-hidden />
        <input type="search" className="input !min-h-[52px] !pl-11" placeholder="Buscar en los textos, el asesor o el supervisor" value={buscar}
          onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar" />
      </label>
      <p className="text-xs text-brand-slate">{plural(lista.length, "coaching", "coachings")}{a.total_coachings > a.coachings.length ? ` (se listan los ${a.coachings.length} más recientes de ${a.total_coachings})` : ""}.</p>
      <ul className="grid md:grid-cols-2 gap-3">
        {lista.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onVer(c.id)} className="card p-4 w-full text-left hover:border-brand-ink min-w-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[11px] text-brand-slate tabular-nums">{fechaHoraCorta(c.firmado_at)} · ≈ {c.minutos} min</span>
                {c.revision && <Etiqueta tono={c.revision === "bien" ? "verde" : "naranja"}>{c.revision === "bien" ? "Bien hecho" : "A mejorar"}</Etiqueta>}
              </div>
              <div className="font-semibold text-brand-ink mt-1 truncate">{c.operador}</div>
              <div className="text-xs text-brand-slate truncate">{c.supervisor} · {TIPO_COACHING[c.tipo].label} · {nombreMetricas(c.metricas)}</div>
              <p className="text-sm text-brand-graphite mt-2 line-clamp-3 break-words">{c.texto || "—"}</p>
              <div className="text-[11px] text-brand-slate mt-2">
                {c.monitoreos} monitoreos · {c.feedback} feedback · {c.compromisos} compromisos{c.audios ? ` · ${c.audios} audios` : ""}{c.voz_asesor ? " · voz del asesor" : ""}
              </div>
            </button>
          </li>
        ))}
      </ul>
      {!lista.length && <p className="card p-6 text-center text-sm text-brand-slate">Ningún coaching coincide.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ informes de Claude
/** Un texto del informe con los códigos de coaching («C12») como enlaces para abrirlos. */
function ConCitas({ texto, mapa, onVer }: { texto: string; mapa: Record<string, string>; onVer: (id: string) => void }) {
  const partes = texto.split(/\b(C\d{1,4})\b/);
  return (
    <>
      {partes.map((p, i) => (mapa[p]
        ? <button key={i} type="button" onClick={() => onVer(mapa[p])} className="font-semibold text-brand-primary underline decoration-dotted">{p}</button>
        : <span key={i}>{p}</span>))}
    </>
  );
}

function VistaInforme({ inf, onVer }: { inf: InformeAnalisis; onVer: (id: string) => void }) {
  const r = inf.resultado as ResultadoInforme;
  const mapa = r.coachings ?? {};
  const T = (t: string) => <ConCitas texto={t} mapa={mapa} onVer={onVer} />;
  const tonoHallazgo = { fortaleza: "verde", riesgo: "rojo", oportunidad: "azul" } as const;
  const segs = [
    { k: "constructivo", label: "Constructivo", color: "#2A78D6", v: r.tono.constructivo },
    { k: "positivo", label: "Reconocimiento", color: "#10b981", v: r.tono.positivo },
    { k: "critico", label: "Crítico", color: "#F39200", v: r.tono.critico },
  ];
  return (
    <div className="space-y-4">
      <Panel titulo="Resumen" sub={`${inf.desde === inf.hasta ? fechaCorta(inf.desde) : `${dm(inf.desde)} al ${dm(inf.hasta)}`}${inf.supervisor ? ` · ${inf.supervisor}` : " · toda la operación"} · ${plural(inf.coachings, "coaching", "coachings")}`}>
        <p className="text-[15px] text-brand-ink leading-relaxed whitespace-pre-line">{T(r.resumen)}</p>
      </Panel>
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel titulo="Tono del feedback">
          <div className="flex h-4 rounded-full overflow-hidden gap-[2px]" role="img" aria-label={segs.map((s) => `${s.label} ${s.v}%`).join(", ")}>
            {segs.map((s) => s.v > 0 && <span key={s.k} style={{ width: `${s.v}%`, background: s.color }} />)}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-brand-graphite">
            {segs.map((s) => <span key={s.k} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />{s.label} <b className="tabular-nums">{s.v}%</b></span>)}
          </div>
          {r.tono.explicacion && <p className="text-sm text-brand-graphite mt-3">{T(r.tono.explicacion)}</p>}
        </Panel>
        <Panel titulo="Calidad de los compromisos">
          <ul className="space-y-2.5">
            {([["especificos", "Específicos"], ["medibles", "Medibles"], ["con_plazo", "Con plazo"]] as const).map(([k, l]) => (
              <li key={k}>
                <div className="flex justify-between text-sm"><span className="text-brand-ink">{l}</span><b className="tabular-nums">{r.calidad_compromisos[k]}%</b></div>
                <Medidor valor={r.calidad_compromisos[k]} color="#662483" />
              </li>
            ))}
          </ul>
          {r.calidad_compromisos.comentario && <p className="text-sm text-brand-graphite mt-3">{T(r.calidad_compromisos.comentario)}</p>}
        </Panel>
      </div>
      {r.hallazgos.length > 0 && (
        <Panel titulo="Hallazgos">
          <ul className="space-y-3">
            {r.hallazgos.map((h, i) => (
              <li key={i} className="rounded-lg border border-brand-border p-3">
                <div className="flex items-center gap-2 flex-wrap"><Etiqueta tono={tonoHallazgo[h.tipo] ?? "gris"}>{h.tipo}</Etiqueta><b className="text-brand-ink">{h.titulo}</b></div>
                <p className="text-sm text-brand-graphite mt-1">{T(h.detalle)}</p>
                {h.evidencia.length > 0 && <ul className="mt-1.5 text-xs text-brand-slate space-y-0.5">{h.evidencia.map((e, j) => <li key={j}>«{T(e)}»</li>)}</ul>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {r.temas.length > 0 && (
        <Panel titulo="Temas del feedback">
          <ul className="grid md:grid-cols-2 gap-3">
            {r.temas.map((t, i) => (
              <li key={i} className="rounded-lg border border-brand-border p-3 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <b className="text-brand-ink">{t.tema}</b>
                  <Etiqueta>{t.frecuencia}</Etiqueta>
                  <Etiqueta tono={t.sentimiento === "positivo" ? "verde" : t.sentimiento === "negativo" ? "rojo" : "gris"}>{t.sentimiento}</Etiqueta>
                </div>
                <p className="text-sm text-brand-graphite mt-1">{T(t.descripcion)}</p>
                {t.ejemplos.length > 0 && <p className="text-xs text-brand-slate mt-1">{t.ejemplos.map((e, j) => <span key={j}>{j > 0 && " · "}{T(e)}</span>)}</p>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {r.supervisores.length > 0 && (
        <Panel titulo="Evaluación por supervisor" sub="Calificación de 1 a 5 sobre la calidad del coaching, según los textos.">
          <ul className="grid md:grid-cols-2 gap-3">
            {r.supervisores.map((s) => (
              <li key={s.codigo} className="rounded-lg border border-brand-border p-3 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <b className="text-brand-ink truncate">{s.supervisor}</b>
                  <span className="flex shrink-0" aria-label={`${s.calificacion} de 5`}>
                    {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={16} className={n <= s.calificacion ? "text-brand-orange" : "text-brand-border"} fill="currentColor" aria-hidden />)}
                  </span>
                </div>
                {s.fortalezas.length > 0 && <div className="mt-2"><div className="text-[11px] uppercase tracking-wider2 text-emerald-700 font-semibold">Fortalezas</div><ul className="text-sm text-brand-graphite list-disc pl-4">{s.fortalezas.map((x, i) => <li key={i}>{T(x)}</li>)}</ul></div>}
                {s.a_mejorar.length > 0 && <div className="mt-2"><div className="text-[11px] uppercase tracking-wider2 text-[#8A5200] font-semibold">A mejorar</div><ul className="text-sm text-brand-graphite list-disc pl-4">{s.a_mejorar.map((x, i) => <li key={i}>{T(x)}</li>)}</ul></div>}
                {s.recomendacion && <p className="text-sm text-brand-ink mt-2"><Lightbulb size={14} className="inline -mt-0.5 text-brand-orange" aria-hidden /> {T(s.recomendacion)}</p>}
                {s.ejemplo && <p className="text-xs text-brand-slate mt-1">Ejemplo: {T(s.ejemplo)}</p>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {r.alertas.length > 0 && (
        <Panel titulo="Alertas">
          <ul className="space-y-2">{r.alertas.map((x, i) => <li key={i} className="text-sm text-brand-primary-dark flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden /><span>{T(x.coaching)}: {T(x.motivo)}</span></li>)}</ul>
        </Panel>
      )}
      {r.recomendaciones.length > 0 && (
        <Panel titulo="Recomendaciones">
          <ol className="list-decimal pl-5 space-y-1 text-sm text-brand-ink">{r.recomendaciones.map((x, i) => <li key={i}>{T(x)}</li>)}</ol>
        </Panel>
      )}
      <p className="text-[11px] text-brand-slate">
        Escrito por {inf.modelo} el {fechaHoraCorta(inf.terminado_at)} · pedido por {inf.pedido_por} · {inf.entrada_tokens.toLocaleString("es-PY")} + {inf.salida_tokens.toLocaleString("es-PY")} tokens
        {inf.costo_usd ? ` · US$ ${inf.costo_usd.toFixed(4)}` : ""}. Claude leyó los textos sin nombres (con códigos); revisá las citas antes de decidir.
      </p>
    </div>
  );
}

function Informes({ a, desde, hasta, supervisor, onVer }: { a: AnalisisCoaching; desde: string; hasta: string; supervisor: string | null; onVer: (id: string) => void }) {
  const [lista, setLista] = useState<InformeAnalisis[] | null>(null);
  const [abierto, setAbierto] = useState<InformeAnalisis | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, avisar] = useAviso();
  const cargar = useCallback(async () => {
    try { setLista((await apiFetch<{ items: InformeAnalisis[] }>(`${SUP_API}/analisis/informes`)).items); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const enCurso = (lista ?? []).some((x) => x.estado === "pendiente" || x.estado === "procesando");
  useEffect(() => {
    if (!enCurso) return;
    const t = setInterval(cargar, 3000);
    return () => clearInterval(t);
  }, [enCurso, cargar]);
  const abrir = async (id: string) => {
    try { setAbierto(await apiFetch<InformeAnalisis>(`${SUP_API}/analisis/informes/${id}`)); window.scrollTo({ top: 0, behavior: "smooth" }); }
    catch (e: any) { avisar(e.message, "error"); }
  };
  useEffect(() => {
    // Cuando termina el que se pidió recién, se abre solo.
    const listo = (lista ?? []).find((x) => x.estado === "listo" && x.id === sessionStorage.getItem("analisis_pedido"));
    if (listo) { sessionStorage.removeItem("analisis_pedido"); abrir(listo.id); }
  }, [lista]); // eslint-disable-line react-hooks/exhaustive-deps
  const pedir = async () => {
    setOcupado(true);
    setError(null);
    try {
      const x = await apiFetch<InformeAnalisis>(`${SUP_API}/analisis/informes`, { method: "POST", body: JSON.stringify({ desde, hasta, supervisor_id: supervisor }) });
      sessionStorage.setItem("analisis_pedido", x.id);
      avisar("Pedido: Claude lo arma en segundo plano (tarda entre 10 y 60 segundos).");
      await cargar();
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  const nombreSup = supervisor ? a.opciones.supervisores.find((s) => s.id === supervisor)?.nombre : null;
  return (
    <div className="space-y-4">
      <Panel titulo="Informe con IA" sub={`Claude (${a.servicio.modelo}) lee los textos y las transcripciones de los coachings firmados${a.servicio.simulador ? " · modo de prueba (simulado)" : ""}. No le llegan nombres, teléfonos ni correos.`}>
        <p className="text-sm text-brand-graphite">
          Del {dm(desde)} al {dm(hasta)} · {nombreSup ?? "toda la operación"} · {plural(a.kpis.coachings, "coaching firmado", "coachings firmados")}.
        </p>
        {!a.servicio.disponible && <p className="text-sm text-[#8A5200] mt-2">El análisis con IA no está configurado: falta ANTHROPIC_API_KEY en el servidor.</p>}
        {error && <div className="mt-3"><Fallo>{error}</Fallo></div>}
        <div className="mt-3 sm:max-w-xs">
          <Boton icono={Sparkles} onClick={pedir} ocupado={ocupado} disabled={!a.servicio.disponible || !a.kpis.coachings}>Generar informe</Boton>
        </div>
      </Panel>
      {abierto?.resultado && <VistaInforme inf={abierto} onVer={onVer} />}
      <Panel titulo="Informes pedidos" sub="Se comparten entre los jefes.">
        {!lista ? <Cargando filas={2} /> : !lista.length ? <p className="text-sm text-brand-slate">Todavía no se pidió ninguno.</p> : (
          <ul className="divide-y divide-brand-border -mx-4 sm:-mx-5">
            {lista.map((x) => (
              <li key={x.id}>
                <button type="button" disabled={x.estado !== "listo"} onClick={() => abrir(x.id)}
                  className={cx("w-full text-left px-4 sm:px-5 py-3 min-h-[60px] flex items-center gap-3", x.estado === "listo" && "hover:bg-brand-bg-soft", abierto?.id === x.id && "bg-brand-bg-soft")}>
                  <span className="w-9 h-9 rounded-lg bg-brand-bg flex items-center justify-center shrink-0">
                    {x.estado === "listo" ? <FileText size={18} className="text-brand-ink" aria-hidden />
                      : x.estado === "error" ? <AlertTriangle size={18} className="text-brand-primary" aria-hidden />
                        : <LoaderCircle size={18} className="animate-spin text-[#1D5BA6]" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-brand-ink truncate">{dm(x.desde)} al {dm(x.hasta)} · {x.supervisor ?? "Toda la operación"}</span>
                    <span className="block text-xs text-brand-slate truncate">
                      {x.estado === "listo" ? (x.resumen ?? "Listo") : x.estado === "error" ? x.error : "Claude lo está armando…"}
                    </span>
                    <span className="block text-[11px] text-brand-mist">{x.pedido_por} · {fechaHoraCorta(x.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {aviso}
    </div>
  );
}

// ------------------------------------------------------------------ la pantalla
export function AnalizadorVista() {
  const hoy = hoyPy();
  const [preset, setPreset] = useState<Preset>("mes");
  const [r, setR] = useState(() => rango("mes", hoy));
  const [sup, setSup] = useState<string | null>(null);
  const [a, setA] = useState<AnalisisCoaching | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [tab, setTab] = useState<Pestana>("resumen");
  const [buscar, setBuscar] = useState("");
  const [ver, setVer] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setA(await apiFetch<AnalisisCoaching>(`${SUP_API}/analisis?desde=${r.desde}&hasta=${r.hasta}${sup ? `&supervisor_id=${encodeURIComponent(sup)}` : ""}`));
    } catch (e: any) { setError(e.message); } finally { setCargando(false); }
  }, [r, sup]);
  useEffect(() => { cargar(); }, [cargar]);
  const elegirPreset = (p: Preset) => { setPreset(p); if (p !== "otro") setR(rango(p, hoy)); };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4 flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-1">Supervisión · coaching firmado</div>
          <h1 className="font-display text-[34px] sm:text-4xl uppercase text-brand-ink leading-tight">Analizador de coaching</h1>
          <p className="text-sm text-brand-slate mt-1 max-w-3xl">Cómo están los coachings y el feedback: números, tiempo estimado, evaluación de cada supervisor, las palabras que más usan y el informe que escribe Claude. Cuentan los coachings que firmó el asesor.</p>
        </div>
        <button type="button" onClick={cargar} disabled={cargando} className="btn-secondary !py-2 !px-4 min-h-[44px]">
          <RefreshCw size={15} className={cargando ? "animate-spin" : ""} aria-hidden /> Actualizar
        </button>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" role="group" aria-label="Rango">
          {([["mes", "Este mes"], ["anterior", "Mes anterior"], ["7d", "7 días"], ["30d", "30 días"], ["otro", "Elegir"]] as [Preset, string][]).map(([p, l]) => (
            <button key={p} type="button" onClick={() => elegirPreset(p)} aria-pressed={preset === p}
              className={cx("min-h-[44px] px-4 rounded-full border text-sm font-semibold whitespace-nowrap shrink-0",
                preset === p ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-graphite border-brand-border")}>{l}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {preset === "otro" && (
            <>
              <input type="date" className="input !w-auto !min-h-[44px]" value={r.desde} max={r.hasta} onChange={(e) => e.target.value && setR({ ...r, desde: e.target.value })} aria-label="Desde" />
              <input type="date" className="input !w-auto !min-h-[44px]" value={r.hasta} min={r.desde} max={hoy} onChange={(e) => e.target.value && setR({ ...r, hasta: e.target.value })} aria-label="Hasta" />
            </>
          )}
          <select className="input !w-auto !min-h-[44px] max-w-full" value={sup ?? ""} onChange={(e) => setSup(e.target.value || null)} aria-label="Supervisor">
            <option value="">Todos los supervisores</option>
            {(a?.opciones.supervisores ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}{s.activo ? "" : " (inactivo)"}</option>)}
          </select>
        </div>
      </div>

      <div className="sticky top-[64px] md:top-[100px] z-20 -mx-4 px-4 py-2 bg-brand-bg/95 backdrop-blur mb-3">
        <div className="flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Secciones">
          {PESTANAS.map((p) => (
            <button key={p.k} type="button" role="tab" aria-selected={tab === p.k} onClick={() => setTab(p.k)}
              className={cx("min-h-[40px] px-3.5 rounded-lg text-sm font-semibold whitespace-nowrap shrink-0",
                tab === p.k ? "bg-brand-primary text-white" : "bg-white border border-brand-border text-brand-graphite")}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && <Fallo onReintentar={cargar}>{error}</Fallo>}
      {!a ? (!error && <Cargando filas={5} />) : !a.kpis.coachings && tab !== "informe" ? (
        <div className="card p-8 text-center">
          <p className="text-[15px] text-brand-ink font-semibold">No hay coachings firmados en el rango.</p>
          <p className="text-sm text-brand-slate mt-1">{a.kpis.en_curso ? `${plural(a.kpis.en_curso, "coaching espera", "coachings esperan")} la firma del asesor.` : "Probá con otro rango o supervisor."}</p>
        </div>
      ) : (
        <>
          {tab === "resumen" && <Resumen a={a} />}
          {tab === "supervisores" && (
            <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
              {a.supervisores.filter((s) => s.coachings || s.en_curso).map((s) => <TarjetaSupervisor key={s.id} s={s} onSolo={() => { setSup(s.id); setTab("resumen"); }} />)}
            </ul>
          )}
          {tab === "palabras" && <Palabras a={a} onPalabra={(p) => { setBuscar(p); setTab("coachings"); }} />}
          {tab === "coachings" && <Coachings a={a} buscar={buscar} setBuscar={setBuscar} onVer={setVer} />}
          {tab === "informe" && <Informes a={a} desde={r.desde} hasta={r.hasta} supervisor={sup} onVer={setVer} />}
          {tab === "supervisores" && (
            <p className="text-xs text-brand-slate mt-3">
              La evaluación (0–100) suma: {a.componentes.map((c) => `${c.nombre.toLowerCase()} ${c.peso}`).join(", ")}. Los componentes sin datos no cuentan.
            </p>
          )}
        </>
      )}
      {ver && <VerCoachingDialog id={ver} onClose={() => setVer(null)} />}
    </div>
  );
}
