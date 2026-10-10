"use client";

import {
  CalendarClock, CircleCheck, CircleDashed, CloudOff, Download, FileDown, History, Loader2, PenLine, Plus, ShieldCheck, Signature,
  Trash2, TriangleAlert, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AreaTexto, ErrorMsg, Modal } from "@/components/supervision/dialogos";
import { apiFetch, downloadFile } from "@/lib/api";
import { CampoNumero, Chip, Seccion, Segmentado } from "./campos";
import { DialogoFirma } from "./firma";
import { DialogoImportar, TarjetaImportado } from "./importados";
import {
  CHIP, ESTADO_METRICA, ESTADO_SEG, ID_API, ID_HREF, SUGERENCIAS_METRICA, TONO_TEXTO, cumplimiento, diaCorto, diaLargo, faltantes, horaPy,
  metricaVacia, nuevoId, numero,
  type EstadoMetrica, type EstadoSeg, type Fuente, type Importado, type InformeDetalle, type MetricaCritica, type Resultado,
  type Resultados,
} from "./tipos";

type EstadoGuardado = "guardado" | "pendiente" | "guardando" | "error";
const ESPERA_GUARDADO = 1200;

const OPC_METRICA = (["critico", "atencion", "ok"] as EstadoMetrica[]).map((v) => ({ v, label: ESTADO_METRICA[v].label, activo: ESTADO_METRICA[v].activo }));
const OPC_SEG = (["cumplido", "en_curso", "no_cumplido"] as EstadoSeg[]).map((v) => ({ v, label: ESTADO_SEG[v].label, activo: ESTADO_SEG[v].activo }));

// ------------------------------------------------------------------ resultados del día (zona manual)
function TarjetaResultado({ id, titulo, r, anterior, onChange }: {
  id: string; titulo: string; r: Resultado; anterior?: number | null; onChange: (r: Resultado) => void;
}) {
  const [conComentario, setConComentario] = useState(!!r.comentario);
  const c = cumplimiento(r.valor, r.meta);
  return (
    <div className="rounded-lg border border-brand-border bg-white p-3 sm:p-4 min-w-0 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={`${id}-v`} className="font-display text-lg uppercase text-brand-ink leading-none">{titulo}</label>
        {anterior !== undefined && anterior !== null && <span className="text-[11px] text-brand-slate">ayer: <b className="text-brand-graphite">{numero(anterior)}</b></span>}
      </div>
      <CampoNumero id={`${id}-v`} valor={r.valor} grande placeholder="0" label={`${titulo}: resultado del día`}
        onChange={(valor) => onChange({ ...r, valor })} />
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-m`} className="text-[11px] text-brand-slate shrink-0">Meta</label>
        <CampoNumero id={`${id}-m`} valor={r.meta} placeholder="opcional" className="!py-1.5 text-sm" label={`${titulo}: meta del día`}
          onChange={(meta) => onChange({ ...r, meta })} />
        {c.pct !== null && <span className={`text-sm font-bold tabular-nums shrink-0 ${TONO_TEXTO[c.tono]}`}>{numero(c.pct, 0)}%</span>}
      </div>
      {conComentario ? (
        <textarea className="input text-sm resize-y" rows={2} maxLength={500} placeholder="Comentario (opcional)" aria-label={`${titulo}: comentario`}
          value={r.comentario} onChange={(e) => onChange({ ...r, comentario: e.target.value })} />
      ) : (
        <button type="button" className="text-[11px] font-semibold text-brand-primary hover:underline self-start" onClick={() => setConComentario(true)}>
          + Comentario
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ una métrica crítica
function TarjetaMetrica({ m, i, onChange, onQuitar }: { m: MetricaCritica; i: number; onChange: (m: MetricaCritica) => void; onQuitar: () => void }) {
  const e = ESTADO_METRICA[m.estado];
  return (
    <li className="relative rounded-lg border border-brand-border bg-white overflow-hidden">
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${e.barra}`} aria-hidden />
      <div className="p-3 sm:p-4 pl-4 sm:pl-5 space-y-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <label className="label" htmlFor={`m-${m.id}-n`}>Métrica {i + 1}</label>
            <input id={`m-${m.id}-n`} className="input font-semibold" list="sugerencias-metricas" maxLength={120} placeholder="Ej.: % sin uso Pospago"
              value={m.nombre} onChange={(ev) => onChange({ ...m, nombre: ev.target.value })} />
          </div>
          <button type="button" onClick={onQuitar} className="btn-ghost !p-2 mt-5 hover:text-brand-primary" aria-label={`Quitar la métrica ${m.nombre || i + 1}`}>
            <Trash2 size={16} />
          </button>
        </div>
        <div className="grid sm:grid-cols-[minmax(0,180px)_1fr] gap-3 items-start">
          <div>
            <label className="label" htmlFor={`m-${m.id}-i`}>Indicador</label>
            <input id={`m-${m.id}-i`} className="input font-display text-2xl !py-1.5 tabular-nums" maxLength={60} placeholder="Ej.: 12,4%"
              value={m.indicador} onChange={(ev) => onChange({ ...m, indicador: ev.target.value })} />
            {m.anterior && <div className="text-[11px] text-brand-slate mt-1">antes: <b className="text-brand-graphite">{m.anterior}</b></div>}
          </div>
          <div>
            <div className="label">Estado</div>
            <Segmentado etiqueta={`Estado de ${m.nombre || "la métrica"}`} valor={m.estado} opciones={OPC_METRICA} onChange={(estado) => onChange({ ...m, estado })} />
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor={`m-${m.id}-c`}>Comentario</label>
            <textarea id={`m-${m.id}-c`} className="input text-sm resize-y leading-relaxed" rows={3} maxLength={1500}
              placeholder="Qué pasó y por qué." value={m.comentario} onChange={(ev) => onChange({ ...m, comentario: ev.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor={`m-${m.id}-k`}>Compromiso o anotación</label>
            <textarea id={`m-${m.id}-k`} className="input text-sm resize-y leading-relaxed" rows={3} maxLength={1000}
              placeholder="Qué se va a hacer. Si escribís un compromiso, lo seguís en los próximos informes." value={m.compromiso}
              onChange={(ev) => onChange({ ...m, compromiso: ev.target.value })} />
          </div>
        </div>
        {m.compromiso.trim() && (
          <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_180px] gap-3">
            <div>
              <label className="label" htmlFor={`m-${m.id}-r`}>Responsable</label>
              <input id={`m-${m.id}-r`} className="input !py-1.5 text-sm" maxLength={120} placeholder="Opcional" value={m.responsable}
                onChange={(ev) => onChange({ ...m, responsable: ev.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor={`m-${m.id}-f`}>Para cuándo</label>
              <input id={`m-${m.id}-f`} type="date" className="input !py-1.5 text-sm tabular-nums" value={m.fecha_compromiso ?? ""}
                onChange={(ev) => onChange({ ...m, fecha_compromiso: ev.target.value || null })} />
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ el editor
export function EditorInforme({ inicial, onFirmado }: { inicial: InformeDetalle; onFirmado: (d: InformeDetalle) => void }) {
  const router = useRouter();
  const d = inicial;
  const [resultados, setResultados] = useState<Resultados>(() => ({
    pospago: { ...d.resultados.pospago, comentario: d.resultados.pospago?.comentario ?? "" },
    gpon: { ...d.resultados.gpon, comentario: d.resultados.gpon?.comentario ?? "" },
    otros: d.resultados.otros ?? [], fuente: d.resultados.fuente ?? null,
  }));
  const [resumen, setResumen] = useState(d.resumen);
  const [metricas, setMetricas] = useState<MetricaCritica[]>(d.metricas);
  const [seg, setSeg] = useState<Record<string, { estado: EstadoSeg; nota: string }>>(
    () => Object.fromEntries(d.seguimiento.map((s) => [s.compromiso_id, { estado: s.estado, nota: s.nota }])));
  const [importados, setImportados] = useState<Importado[]>(d.importados);
  const [cargo, setCargo] = useState(d.cargo);
  const [firmaImg, setFirmaImg] = useState<string | null>(d.firma_guardada?.imagen ?? null);
  const [usarFirma, setUsarFirma] = useState(!!d.firma_guardada?.imagen);
  const [fuentes, setFuentes] = useState<Fuente[] | null>(null);
  const [dialogo, setDialogo] = useState<"importar" | "firma" | "firmar" | "descartar" | null>(null);
  const [estado, setEstado] = useState<EstadoGuardado>("guardado");
  const [guardadoAt, setGuardadoAt] = useState<string | null>(d.updated_at);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  // ---- guardado automático (con lo último siempre a mano)
  const ultimo = useRef<any>(null);
  ultimo.current = {
    resultados, resumen, metricas, importados: importados.map((x) => x.id), cargo,
    seguimiento: Object.entries(seg).map(([compromiso_id, s]) => ({ compromiso_id, ...s })),
  };
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const enVuelo = useRef<Promise<void> | null>(null);
  const otraVez = useRef(false);
  const primera = useRef(true);

  const guardar = useCallback(async (): Promise<void> => {
    if (enVuelo.current) { otraVez.current = true; return enVuelo.current; }
    const p = (async () => {
      setEstado("guardando");
      try {
        const r = await apiFetch<{ updated_at: string }>(`${ID_API}/${d.id}`, { method: "PUT", body: JSON.stringify(ultimo.current) });
        setGuardadoAt(r.updated_at);
        setEstado("guardado");
      } catch (e: any) {
        setEstado("error");
        throw e;
      } finally {
        enVuelo.current = null;
      }
      if (otraVez.current) { otraVez.current = false; await guardar(); }
    })();
    enVuelo.current = p;
    return p;
  }, [d.id]);

  useEffect(() => {
    if (primera.current) { primera.current = false; return; }
    setEstado("pendiente");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { guardar().catch(() => undefined); }, ESPERA_GUARDADO);
    return () => clearTimeout(timer.current);
  }, [resultados, resumen, metricas, seg, importados, cargo, guardar]);

  /** Antes de firmar, descargar o salir: lo pendiente queda guardado. */
  const asegurar = useCallback(async () => {
    clearTimeout(timer.current);
    if (enVuelo.current) await enVuelo.current;
    await guardar();
  }, [guardar]);

  useEffect(() => {
    const salir = (e: BeforeUnloadEvent) => { if (estado !== "guardado") { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", salir);
    return () => window.removeEventListener("beforeunload", salir);
  }, [estado]);

  useEffect(() => {
    apiFetch<{ fuentes: Fuente[] }>(`${ID_API}/fuentes?fecha=${d.fecha}`).then((r) => setFuentes(r.fuentes)).catch(() => setFuentes([]));
  }, [d.fecha]);

  // ---- ayudas
  const planilla = fuentes?.find((f) => f.tipo === "cargas")?.opciones.find((o) => o.ref === d.fecha);
  const yaPlanilla = planilla && resultados.pospago.valor === planilla.pospago && resultados.gpon.valor === planilla.gpon;
  const usarPlanilla = () => {
    if (!planilla) return;
    setResultados((r) => ({
      ...r, pospago: { ...r.pospago, valor: planilla.pospago ?? 0 }, gpon: { ...r.gpon, valor: planilla.gpon ?? 0 },
      fuente: `Cargas del ${planilla.label}${planilla.detalle?.includes("planilla al") ? ` (${planilla.detalle.split("· ").pop()})` : ""}`,
    }));
    setAviso("Resultados completados con las cargas del día. Podés ajustarlos.");
  };
  const anteriores = d.anterior?.metricas ?? [];
  const traerMetricas = () => setMetricas(anteriores.map((m) => ({ ...metricaVacia(), nombre: m.nombre, estado: m.estado, anterior: m.indicador || null })));
  const falta = useMemo(() => faltantes({ resultados, resumen, metricas }, d.min_resumen), [resultados, resumen, metricas, d.min_resumen]);
  const compromisos = d.compromisos_abiertos ?? [];
  const actualizarImportado = async (x: Importado) => {
    setOcupado(x.id);
    setError(null);
    try {
      const r = await apiFetch<{ importados: Importado[] }>(`${ID_API}/${d.id}/importar`, { method: "POST", body: JSON.stringify({ tipo: x.tipo, ref: x.fecha }) });
      setImportados(r.importados);
      setAviso(`${x.titulo} actualizado.`);
    } catch (e: any) { setError(e.message); } finally { setOcupado(null); }
  };

  const pdf = async () => {
    setOcupado("pdf");
    setError(null);
    try { await asegurar(); await downloadFile(`${ID_API}/${d.id}/pdf`, `Informe-diario_${d.fecha}.pdf`); }
    catch (e: any) { setError(e.message); } finally { setOcupado(null); }
  };
  const firmar = async () => {
    setOcupado("firmar");
    setError(null);
    try {
      await asegurar();
      const r = await apiFetch<InformeDetalle>(`${ID_API}/${d.id}/firmar`, { method: "POST", body: JSON.stringify({ cargo, con_firma: usarFirma && !!firmaImg }) });
      setEstado("guardado");
      onFirmado(r);
    } catch (e: any) { setError(e.message); setDialogo(null); } finally { setOcupado(null); }
  };
  const descartar = async () => {
    setOcupado("descartar");
    try {
      clearTimeout(timer.current);
      await apiFetch(`${ID_API}/${d.id}`, { method: "DELETE" });
      setEstado("guardado");
      router.push(ID_HREF);
    } catch (e: any) { setError(e.message); setOcupado(null); }
  };

  const textoGuardado = {
    guardado: <><CircleCheck size={13} className="text-emerald-600" aria-hidden /> Guardado {guardadoAt ? horaPy(guardadoAt) : ""}</>,
    pendiente: <><CircleDashed size={13} aria-hidden /> Cambios sin guardar</>,
    guardando: <><Loader2 size={13} className="animate-spin" aria-hidden /> Guardando…</>,
    error: <><CloudOff size={13} className="text-brand-primary" aria-hidden /> No se pudo guardar · <button type="button" className="underline" onClick={() => guardar().catch(() => undefined)}>reintentar</button></>,
  }[estado];

  return (
    <div className="space-y-5 pb-28">
      <datalist id="sugerencias-metricas">{SUGERENCIAS_METRICA.map((s) => <option key={s} value={s} />)}</datalist>

      {/* ---- encabezado */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Informe diario · Televentas Claro</div>
          <h1 className="font-display text-3xl sm:text-5xl text-brand-ink uppercase leading-tight flex items-center gap-3 flex-wrap">
            {diaLargo(d.fecha)} <Chip chip={CHIP.NARANJA}>Borrador</Chip>
          </h1>
          <p className="text-sm text-brand-slate mt-1">{d.autor} · {cargo}</p>
        </div>
        <p className="text-xs text-brand-slate inline-flex items-center gap-1.5" role="status" aria-live="polite">{textoGuardado}</p>
      </div>

      {aviso && (
        <div role="status" className="flex items-start justify-between gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-md px-3 py-2.5">
          <span className="inline-flex items-center gap-2"><CircleCheck size={16} aria-hidden /> {aviso}</span>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setAviso(null)}><X size={15} /></button>
        </div>
      )}

      {/* ---- 1. resultados del día */}
      <Seccion n={1} titulo="Resultados del día" id="resultados"
        sub="Lo vendido hoy. Pospago y GPON son obligatorios (pueden ser 0); agregá otros resultados si querés.">
        {planilla && !yaPlanilla && (
          <div className="mb-3 rounded-md border border-[#2A78D6]/30 bg-[#2A78D6]/5 px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-[#1D5BA6]">
              La planilla de netas tiene las cargas del {planilla.label}: <b>{numero(planilla.pospago ?? 0)} Pospago</b> · <b>{numero(planilla.gpon ?? 0)} GPON</b>.
            </p>
            <button type="button" className="btn-secondary !py-1.5 !px-3 text-xs" onClick={usarPlanilla}><Download size={13} /> Usar estos valores</button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <TarjetaResultado id="r-pospago" titulo="Pospago" r={resultados.pospago} anterior={d.anterior?.pospago}
            onChange={(pospago) => setResultados((r) => ({ ...r, pospago }))} />
          <TarjetaResultado id="r-gpon" titulo="GPON" r={resultados.gpon} anterior={d.anterior?.gpon}
            onChange={(gpon) => setResultados((r) => ({ ...r, gpon }))} />
        </div>
        {resultados.otros.length > 0 && (
          <ul className="mt-3 space-y-2">
            {resultados.otros.map((o, i) => {
              const set = (x: Partial<typeof o>) => setResultados((r) => ({ ...r, otros: r.otros.map((y) => (y.id === o.id ? { ...y, ...x } : y)) }));
              const c = cumplimiento(o.valor, o.meta);
              return (
                <li key={o.id} className="rounded-md border border-brand-border bg-white p-2.5 grid grid-cols-[1fr_88px_auto] sm:grid-cols-[1fr_110px_110px_minmax(0,1.2fr)_auto] gap-2 items-center">
                  <input className="input !py-1.5 text-sm font-semibold" maxLength={60} placeholder={`Otro resultado ${i + 1} (ej.: IPTV)`} aria-label="Nombre del resultado"
                    value={o.nombre} onChange={(e) => set({ nombre: e.target.value })} />
                  <CampoNumero id={`o-${o.id}-v`} valor={o.valor} placeholder="Valor" className="!py-1.5 text-sm font-semibold" label={`${o.nombre || "Otro"}: valor`}
                    onChange={(valor) => set({ valor })} />
                  <button type="button" className="btn-ghost !p-1.5 sm:order-last hover:text-brand-primary" aria-label={`Quitar ${o.nombre || "el resultado"}`}
                    onClick={() => setResultados((r) => ({ ...r, otros: r.otros.filter((y) => y.id !== o.id) }))}><X size={15} /></button>
                  <div className="col-span-3 sm:col-span-1 flex items-center gap-2">
                    <CampoNumero id={`o-${o.id}-m`} valor={o.meta} placeholder="Meta" className="!py-1.5 text-sm" label={`${o.nombre || "Otro"}: meta`}
                      onChange={(meta) => set({ meta })} />
                    {c.pct !== null && <span className={`text-xs font-bold tabular-nums ${TONO_TEXTO[c.tono]}`}>{numero(c.pct, 0)}%</span>}
                  </div>
                  <input className="input !py-1.5 text-sm col-span-3 sm:col-span-1" maxLength={500} placeholder="Comentario (opcional)" aria-label="Comentario"
                    value={o.comentario} onChange={(e) => set({ comentario: e.target.value })} />
                </li>
              );
            })}
          </ul>
        )}
        {resultados.otros.length < 10 && (
          <button type="button" className="mt-3 w-full rounded-md border-2 border-dashed border-brand-border py-2.5 text-sm font-semibold text-brand-slate hover:border-brand-primary hover:text-brand-primary transition-colors inline-flex items-center justify-center gap-1.5"
            onClick={() => setResultados((r) => ({ ...r, otros: [...r.otros, { id: nuevoId(), nombre: "", valor: null, meta: null, comentario: "" }] }))}>
            <Plus size={16} /> Otro resultado
          </button>
        )}
        {resultados.fuente && <p className="text-[11px] text-brand-slate mt-2">Tomados de: {resultados.fuente}.</p>}
      </Seccion>

      {/* ---- 2. datos importados */}
      <Seccion n={2} titulo="Datos de la plataforma" id="importados"
        sub="Importá datos ya cargados (llamadas, ventas del día, proyección, coaching): quedan fijos en el informe."
        accion={importados.length < d.max_importados ? (
          <button type="button" className="btn-secondary !py-2 !px-3 text-xs" onClick={() => setDialogo("importar")}><Plus size={14} /> Importar datos</button>
        ) : undefined}>
        {!importados.length ? (
          <button type="button" onClick={() => setDialogo("importar")}
            className="w-full rounded-md border-2 border-dashed border-brand-border py-6 text-sm text-brand-slate hover:border-brand-primary hover:text-brand-primary transition-colors">
            <Plus size={18} className="inline -mt-0.5" /> Importar los datos de llamadas del día u otro reporte
          </button>
        ) : (
          <div className="space-y-3">
            {importados.map((x) => (
              <TarjetaImportado key={x.id} x={x} actualizando={ocupado === x.id} onActualizar={() => actualizarImportado(x)}
                onQuitar={() => setImportados((l) => l.filter((y) => y.id !== x.id))} />
            ))}
          </div>
        )}
      </Seccion>

      {/* ---- 3. resumen */}
      <Seccion n={3} titulo="Resumen del día" id="resumen" sub="Lo más importante de hoy: qué salió bien, qué preocupa y qué se hizo.">
        <AreaTexto id="i-resumen" valor={resumen} onChange={setResumen} min={d.min_resumen} max={5000} filas={6}
          placeholder="Ej.: buen arranque en la mañana con 33% de conversación; a las 15 h hubo una caída del CRM de 30 minutos que afectó al turno tarde…" />
      </Seccion>

      {/* ---- 4. métricas críticas */}
      <Seccion n={4} titulo="Métricas críticas" id="metricas"
        sub="Las que necesitan atención: su indicador, qué pasó y qué te comprometés a hacer."
        accion={!metricas.length && anteriores.length ? (
          <button type="button" className="btn-ghost text-xs" onClick={traerMetricas}><History size={14} /> Traer las del {diaCorto(d.anterior!.fecha)}</button>
        ) : undefined}>
        {metricas.length > 0 && (
          <ul className="space-y-3 mb-3">
            {metricas.map((m, i) => (
              <TarjetaMetrica key={m.id} m={m} i={i} onChange={(x) => setMetricas((l) => l.map((y) => (y.id === m.id ? x : y)))}
                onQuitar={() => setMetricas((l) => l.filter((y) => y.id !== m.id))} />
            ))}
          </ul>
        )}
        {metricas.length < 20 && (
          <button type="button" onClick={() => setMetricas((l) => [...l, metricaVacia()])}
            className="w-full rounded-md border-2 border-dashed border-brand-border py-3 text-sm font-semibold text-brand-slate hover:border-brand-primary hover:text-brand-primary transition-colors inline-flex items-center justify-center gap-1.5">
            <Plus size={18} /> Agregar métrica crítica
          </button>
        )}
      </Seccion>

      {/* ---- 5. seguimiento de compromisos */}
      {compromisos.length > 0 && (
        <Seccion n={5} titulo="Seguimiento de compromisos" id="seguimiento"
          sub="Los compromisos de informes anteriores. Cumplido y no cumplido los cierran; en curso los deja para el próximo informe.">
          <ul className="space-y-2.5">
            {compromisos.map((c) => {
              const s = seg[c.id];
              return (
                <li key={c.id} className={`rounded-md border px-3.5 py-3 ${c.vencido ? "border-brand-primary/40 bg-brand-primary-light/30" : "border-brand-border bg-white"}`}>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-brand-ink">{c.metrica}</div>
                      <p className="text-sm text-brand-graphite whitespace-pre-line break-words">{c.texto}</p>
                      <div className="text-[11px] text-brand-slate mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span>Del {diaCorto(c.fecha)}</span>
                        {c.responsable && <span>· {c.responsable}</span>}
                        {c.fecha_limite && <span className="inline-flex items-center gap-1">· <CalendarClock size={11} aria-hidden /> para el {diaCorto(c.fecha_limite)}</span>}
                        {c.vencido && <Chip chip={CHIP.ROJO} icono={<TriangleAlert size={10} aria-hidden />}>Vencido</Chip>}
                        {c.ultimo && <span>· último: {ESTADO_SEG[c.ultimo.estado].label.toLowerCase()} el {diaCorto(c.ultimo.fecha)}</span>}
                      </div>
                    </div>
                    <Segmentado chico etiqueta={`Seguimiento de ${c.metrica}`} valor={s?.estado ?? null} opciones={OPC_SEG}
                      onChange={(estado) => setSeg((x) => ({ ...x, [c.id]: { estado, nota: x[c.id]?.nota ?? "" } }))} />
                  </div>
                  {s && (
                    <input className="input !py-1.5 text-sm mt-2" maxLength={1000} placeholder="Nota (qué se hizo, qué falta)" aria-label={`Nota del seguimiento de ${c.metrica}`}
                      value={s.nota} onChange={(e) => setSeg((x) => ({ ...x, [c.id]: { ...x[c.id], nota: e.target.value } }))} />
                  )}
                </li>
              );
            })}
          </ul>
        </Seccion>
      )}

      {/* ---- 6. firma */}
      <Seccion n={compromisos.length ? 6 : 5} titulo="Firma" id="firma" sub="Va al pie del informe y del PDF, con tu nombre y tu cargo.">
        <div className="grid sm:grid-cols-2 gap-4 items-start">
          <div className="space-y-3">
            <div>
              <div className="label">Nombre</div>
              <div className="input bg-brand-bg-soft text-brand-graphite">{d.autor}</div>
            </div>
            <div>
              <label className="label" htmlFor="i-cargo">Cargo</label>
              <input id="i-cargo" className="input" maxLength={120} value={cargo} onChange={(e) => setCargo(e.target.value)} />
            </div>
          </div>
          <div>
            <div className="label">Firma manuscrita (opcional)</div>
            {firmaImg ? (
              <div className="rounded-md border border-brand-border bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={firmaImg} alt="Tu firma guardada" className="max-h-20 max-w-full object-contain" />
                <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                  <label className="inline-flex items-center gap-2 text-xs text-brand-graphite cursor-pointer">
                    <input type="checkbox" className="accent-brand-primary" checked={usarFirma} onChange={(e) => setUsarFirma(e.target.checked)} />
                    Usarla en este informe
                  </label>
                  <button type="button" className="text-xs font-semibold text-brand-primary hover:underline" onClick={() => setDialogo("firma")}>Cambiar</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setDialogo("firma")}
                className="w-full rounded-md border-2 border-dashed border-brand-border py-6 text-sm font-semibold text-brand-slate hover:border-brand-primary hover:text-brand-primary transition-colors inline-flex items-center justify-center gap-1.5">
                <PenLine size={16} /> Dibujar mi firma
              </button>
            )}
          </div>
        </div>
        <p className="text-[11px] text-brand-slate mt-3 flex items-start gap-1.5">
          <ShieldCheck size={13} className="shrink-0 mt-0.5" aria-hidden />
          Al firmar, el informe queda cerrado con un código de verificación: si alguien lo cambiara, el código deja de coincidir. Después solo se agregan comentarios.
        </p>
      </Seccion>

      <div className="flex justify-center">
        <button type="button" className="btn-ghost text-xs text-brand-slate hover:text-brand-primary" onClick={() => setDialogo("descartar")}>
          <Trash2 size={14} /> Descartar este borrador
        </button>
      </div>
      <ErrorMsg msg={error} />

      {/* ---- barra de acciones (fija abajo) */}
      <div className="fixed inset-x-0 bottom-0 z-30 print:hidden">
        <div className="mx-auto max-w-5xl px-3 sm:px-6 pb-[max(env(safe-area-inset-bottom),12px)]">
          <div className="card shadow-elevated px-3 sm:px-4 py-2.5 flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex flex-1 min-w-0 text-xs text-brand-slate items-center gap-1.5 truncate">
              {falta.length ? <><TriangleAlert size={14} className="text-[#8A5200] shrink-0" aria-hidden /> Para firmar falta {falta.join(", ")}.</>
                : <><CircleCheck size={14} className="text-emerald-600 shrink-0" aria-hidden /> Listo para firmar.</>}
            </div>
            <button type="button" className="btn-secondary !px-3 sm:!px-4 flex-1 sm:flex-none" disabled={!!ocupado} onClick={pdf}>
              <FileDown size={16} /> {ocupado === "pdf" ? "Generando…" : <><span className="sm:hidden">PDF</span><span className="hidden sm:inline">Vista previa PDF</span></>}
            </button>
            <button type="button" className="btn-primary !px-3 sm:!px-5 flex-[2] sm:flex-none" disabled={!!ocupado} onClick={() => setDialogo("firmar")}>
              <Signature size={16} /> Firmar y cerrar
            </button>
          </div>
        </div>
      </div>

      {dialogo === "importar" && (
        <DialogoImportar informeId={d.id} fecha={d.fecha} fuentes={fuentes} importados={importados} onClose={() => setDialogo(null)}
          onImportados={(lista, msg) => { setImportados(lista); setAviso(msg); setDialogo(null); }} />
      )}
      {dialogo === "firma" && (
        <DialogoFirma actual={firmaImg} onClose={() => setDialogo(null)}
          onGuardada={(img) => { setFirmaImg(img); setUsarFirma(!!img); setDialogo(null); setAviso(img ? "Firma guardada." : "Firma borrada."); }} />
      )}
      {dialogo === "firmar" && (
        <Modal onClose={() => setDialogo(null)} sobre={diaLargo(d.fecha)} titulo="Firmar el informe" acento={falta.length ? "bg-brand-orange" : "bg-brand-primary"}
          pie={<>
            <button type="button" className="btn-secondary" onClick={() => setDialogo(null)}>Volver</button>
            <button type="button" className="btn-primary" disabled={!!falta.length || ocupado === "firmar"} onClick={firmar}>
              <Signature size={15} /> {ocupado === "firmar" ? "Firmando…" : "Firmar y cerrar"}
            </button>
          </>}>
          {falta.length ? (
            <p className="text-sm text-[#8A5200] flex items-start gap-2"><TriangleAlert size={16} className="shrink-0 mt-0.5" aria-hidden /> Para firmar falta {falta.join(", ")}.</p>
          ) : (
            <div className="space-y-3 text-sm text-brand-graphite">
              <ul className="space-y-1.5">
                <li className="flex items-center gap-2"><CircleCheck size={15} className="text-emerald-600" aria-hidden /> Pospago {numero(resultados.pospago.valor)} · GPON {numero(resultados.gpon.valor)}{resultados.otros.length ? ` · ${resultados.otros.length} otro(s)` : ""}</li>
                <li className="flex items-center gap-2"><CircleCheck size={15} className="text-emerald-600" aria-hidden /> Resumen del día</li>
                <li className="flex items-center gap-2">{metricas.length ? <CircleCheck size={15} className="text-emerald-600" aria-hidden /> : <CircleDashed size={15} aria-hidden />} {metricas.length} métrica(s) crítica(s), {metricas.filter((m) => m.compromiso.trim()).length} con compromiso</li>
                <li className="flex items-center gap-2">{importados.length ? <CircleCheck size={15} className="text-emerald-600" aria-hidden /> : <CircleDashed size={15} aria-hidden />} {importados.length} dato(s) importado(s)</li>
                {compromisos.length > 0 && <li className="flex items-center gap-2"><CircleCheck size={15} className="text-emerald-600" aria-hidden /> Seguimiento de {Object.keys(seg).length} de {compromisos.length} compromiso(s)</li>}
              </ul>
              <div className="rounded-md bg-brand-bg-soft border border-brand-border px-3.5 py-3">
                Firmás como <b className="text-brand-ink">{d.autor}</b> · {cargo}{usarFirma && firmaImg ? ", con tu firma manuscrita" : ""}.
                <span className="block text-xs text-brand-slate mt-1">Después no se puede cambiar: queda cerrado con su código de verificación.</span>
              </div>
            </div>
          )}
        </Modal>
      )}
      {dialogo === "descartar" && (
        <Modal onClose={() => setDialogo(null)} sobre={diaLargo(d.fecha)} titulo="Descartar el borrador" acento="bg-brand-primary"
          pie={<>
            <button type="button" className="btn-secondary" onClick={() => setDialogo(null)}>Volver</button>
            <button type="button" className="btn-danger" disabled={ocupado === "descartar"} onClick={descartar}><Trash2 size={15} /> Descartar</button>
          </>}>
          <p className="text-sm text-brand-graphite">Se borra todo lo cargado en este borrador. Los compromisos anteriores no cambian.</p>
        </Modal>
      )}
    </div>
  );
}
