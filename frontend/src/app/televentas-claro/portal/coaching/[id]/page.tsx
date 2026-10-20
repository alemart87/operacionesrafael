"use client";

import {
  ArrowLeft, ArrowRight, Ban, CircleCheck, ClipboardCheck, CloudUpload, Fingerprint, History, Keyboard, MessageSquarePlus,
  MessageSquareText, MessageSquareWarning, Mic, PenLine, Save, ThumbsUp, TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  CompromisoCard, DIAS_MAX, ChipsFecha, HojaCompromiso, HojaItem, HojaSeguimiento, HojaTexto, ItemCard, diaCorto, hoyPy, useConstancia,
} from "@/components/portal/coaching";
import { borrarLocal, localesDe, subirAudio, type AudioLocal, type Hablante } from "@/components/portal/grabadora";
import { PortalShell } from "@/components/portal/nav";
import { BarraAccion, Boton, Cargando, Etiqueta, Fallo, Lista, PORTAL, Pasos, Seccion, plural, useAviso } from "@/components/portal/ui";
import { hrefNuevoCoaching } from "@/components/supervision/hacer-coaching";
import { ImpactoVista, ResultadoChip } from "@/components/supervision/impacto";
import {
  SEGUIMIENTO, SUP_API, TIPO_COACHING, fechaHoraCorta, fechaHoraPy, metricasDe, nombreMetricas, sumarDias,
  type CoachingDetalle, type CompromisoCoaching, type ItemCoaching,
} from "@/components/supervision/tipos";
import { apiFetch } from "@/lib/api";

const PASOS = ["Asesor", "Lo que observaste", "Compromisos", "Devolución"];

type HojaAbierta =
  | { t: "item"; item?: ItemCoaching; dictar?: boolean }
  | { t: "compromiso"; comp?: CompromisoCoaching; hablante?: Hablante }
  | { t: "seguimiento" } | { t: "anular" } | { t: "aclaracion" }
  | null;

export default function CoachingPage() {
  return <PortalShell><Coaching /></PortalShell>;
}

function Coaching() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<CoachingDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoja, setHoja] = useState<HojaAbierta>(null);
  const [paso, setPaso] = useState<number | null>(null);
  const [locales, setLocales] = useState<AudioLocal[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [aviso, avisar] = useAviso();

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setError(null);
    try { setC(await apiFetch<CoachingDetalle>(`${SUP_API}/portal/coaching/${id}`)); } catch (e: any) { if (!silencioso) setError(e.message); }
  }, [id]);
  useEffect(() => { cargar(); localesDe(id).then(setLocales); }, [cargar, id]);
  useEffect(() => {
    if (c && paso === null && c.estado === "pendiente") setPaso(!c.items?.length ? 2 : !c.compromisos?.length ? 3 : 4);
  }, [c, paso]);
  // Un audio que quedó en el celular sin subir ya no se puede sumar a un coaching firmado o anulado: no se guarda más.
  useEffect(() => {
    if (!c || c.estado === "pendiente" || !locales.length) return;
    Promise.all(locales.map((l) => borrarLocal(l.id))).then(() => setLocales([]));
  }, [c, locales]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [paso]);

  // Mientras un audio se transcribe, el texto llega solo: se vuelve a pedir el coaching cada 3 s.
  const esperando = c ? [...(c.items ?? []), ...(c.compromisos ?? [])].filter((x) => !x.texto).length : 0;
  useEffect(() => {
    if (!esperando) return;
    const t = setInterval(() => cargar(true), 3000);
    return () => clearInterval(t);
  }, [esperando, cargar]);

  const guardado = (d: CoachingDetalle, msg: string) => { setC(d); setHoja(null); avisar(msg); };
  const quitar = async (url: string, msg: string) => {
    if (!window.confirm("¿Lo quitás? Queda en el historial del coaching.")) return;
    try { guardado(await apiFetch<CoachingDetalle>(url, { method: "DELETE" }), msg); } catch (e: any) { avisar(e.message, "error"); }
  };
  const subirLocales = async () => {
    if (!c) return;
    setSubiendo(true);
    try {
      for (const l of locales) {
        const a = await subirAudio(c.id, l, l.hablante, l.destino);
        const metricas = metricasDe(c).filter((m) => m !== "otra");
        if (l.destino === "item") {
          await apiFetch(`${SUP_API}/portal/coaching/${c.id}/items`, { method: "POST", body: JSON.stringify({ tipo: "feedback", metricas: metricas.length ? metricas : ["otra"], audio_id: a.id }) });
        } else if (l.destino === "compromiso") {
          await apiFetch(`${SUP_API}/portal/coaching/${c.id}/compromisos`, { method: "POST", body: JSON.stringify({ audio_id: a.id, origen: l.hablante }) });
        }
        await borrarLocal(l.id);
      }
      setLocales([]);
      await cargar(true);
      avisar("Grabaciones subidas: el texto llega cuando termine la transcripción.");
    } catch (e: any) { avisar(e.message ?? "No se pudieron subir", "error"); } finally { setSubiendo(false); }
  };

  if (error) return <div className="max-w-xl mx-auto"><Fallo onReintentar={() => cargar()}>{error}</Fallo></div>;
  if (!c) return <div className="max-w-xl mx-auto"><Cargando filas={4} /></div>;

  const url = `${SUP_API}/portal/coaching/${c.id}`;
  const hojas = (
    <>
      {hoja?.t === "item" && <HojaItem c={c} item={hoja.item} dictar={hoja.dictar} onClose={() => setHoja(null)} onGuardado={guardado} />}
      {hoja?.t === "compromiso" && <HojaCompromiso c={c} comp={hoja.comp} hablante={hoja.hablante} onClose={() => setHoja(null)} onGuardado={guardado} />}
      {hoja?.t === "seguimiento" && <HojaSeguimiento c={c} onClose={() => setHoja(null)} onGuardado={(d) => guardado(d, "Seguimiento registrado.")} />}
      {hoja?.t === "anular" && (
        <HojaTexto titulo="Anular el coaching" sobre={c.operador} ayuda="Solo si se cargó por error. No se borra: queda tachado y en el historial."
          url={`${url}/anular`} campo="motivo" min={5} max={500} accion="Anular coaching" peligro onClose={() => setHoja(null)}
          onGuardado={() => { setHoja(null); router.push(`${PORTAL}?aviso=anulado`); }} />
      )}
      {hoja?.t === "aclaracion" && (
        <HojaTexto titulo="Aclaración" sobre={c.operador} ayuda="No cambia lo firmado: se agrega al historial con la fecha y hora de hoy."
          url={`${url}/aclaracion`} campo="texto" min={5} max={1000} accion="Agregar aclaración" onClose={() => setHoja(null)}
          onGuardado={(d) => guardado(d, "Aclaración agregada.")} />
      )}
      {aviso}
    </>
  );

  const pendientesLocales = locales.length > 0 && c.estado === "pendiente" && (
    <div className="rounded-lg border border-brand-orange/40 bg-brand-orange/10 px-4 py-3 mb-4 text-sm text-[#8A5200]">
      <div className="flex items-start gap-2"><CloudUpload size={18} className="shrink-0 mt-0.5" aria-hidden />
        <span>{plural(locales.length, "grabación quedó", "grabaciones quedaron")} guardadas en este celular sin subir (no había señal).</span></div>
      <div className="mt-2"><Boton tipo="secundario" icono={CloudUpload} onClick={subirLocales} ocupado={subiendo}>Subir ahora</Boton></div>
    </div>
  );

  const cabecera = (
    <div className="flex items-start gap-1 mb-4">
      <Link href={PORTAL} aria-label="Volver a Hoy" className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-brand-ink hover:bg-white shrink-0">
        <ArrowLeft size={22} aria-hidden />
      </Link>
      <div className="min-w-0 pt-0.5">
        <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">{TIPO_COACHING[c.tipo].label} · {nombreMetricas(c)}</div>
        <h1 className="font-display text-[30px] sm:text-4xl uppercase text-brand-ink leading-tight break-words">{c.operador}</h1>
      </div>
    </div>
  );

  // ---------------------------------------------------------------- sin firmar: los pasos
  if (c.estado === "pendiente") {
    const items = c.items ?? [];
    const comps = c.compromisos ?? [];
    const audio = (aid: string | null) => (aid ? c.audios?.find((a) => a.id === aid) : undefined);
    const p = paso ?? 2;
    const hoy = hoyPy();
    return (
      <div className="max-w-xl mx-auto">
        {cabecera}
        <Pasos actual={p} nombres={PASOS} />
        <p className={`text-[13px] mt-2 mb-5 flex items-center gap-1.5 ${c.devolucion_vencida ? "text-brand-primary-dark font-semibold" : "text-brand-slate"}`}>
          {c.devolucion_vencida ? <TriangleAlert size={15} aria-hidden /> : <PenLine size={15} aria-hidden />}
          {c.devolucion_vencida
            ? `La devolución venció el ${diaCorto(c.vence_devolucion)}: hacela hoy.`
            : `Sin firmar · devolución hasta ${diaCorto(c.vence_devolucion)}.`}
        </p>
        {pendientesLocales}

        {p === 2 && (
          <>
            <Seccion titulo="Lo que observaste" sub="Monitoreos de llamadas y feedback: podés sumar varios antes de la devolución.">
              <div className="space-y-3">
                {items.map((it) => (
                  <ItemCard key={it.id} it={it} audio={audio(it.audio_id)} editable
                    onEditar={() => setHoja({ t: "item", item: it })} onQuitar={() => quitar(`${url}/items/${it.id}`, "Quitado.")} />
                ))}
                {!items.length && (
                  <div className="rounded-lg border-2 border-dashed border-brand-border px-4 py-6 text-center text-sm text-brand-slate">
                    Todavía no sumaste nada. Dictá lo que viste en la llamada o escribilo.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Boton icono={Mic} onClick={() => setHoja({ t: "item", dictar: true })}>Dictar</Boton>
                  <Boton tipo="secundario" icono={Keyboard} onClick={() => setHoja({ t: "item" })}>Escribir</Boton>
                </div>
              </div>
            </Seccion>
            <BarraAccion>
              <Boton onClick={() => setPaso(3)} disabled={!items.length}>Siguiente: compromisos <ArrowRight size={20} aria-hidden /></Boton>
            </BarraAccion>
          </>
        )}

        {p === 3 && (
          <>
            <Seccion titulo="Compromisos del asesor" sub="Qué se compromete a hacer, mejor con sus palabras: que lo diga él y queda grabado.">
              <div className="space-y-3">
                {comps.map((x, i) => (
                  <CompromisoCard key={x.id} x={x} n={i + 1} audio={audio(x.audio_id)} editable
                    onEditar={() => setHoja({ t: "compromiso", comp: x })} onQuitar={() => quitar(`${url}/compromisos/${x.id}`, "Compromiso quitado.")} />
                ))}
                {!comps.length && (
                  <div className="rounded-lg border-2 border-dashed border-brand-border px-4 py-6 text-center text-sm text-brand-slate">
                    Sumá al menos un compromiso: es lo que el asesor va a firmar.
                  </div>
                )}
                <Boton icono={Mic} onClick={() => setHoja({ t: "compromiso", hablante: "asesor" })}>Que lo diga el asesor</Boton>
                <Boton tipo="secundario" icono={Keyboard} onClick={() => setHoja({ t: "compromiso" })}>Escribirlo</Boton>
              </div>
            </Seccion>
            <Seccion titulo="Seguimiento" sub="Cuándo revisan juntos si se cumplió." className="mt-6">
              <ChipsFecha valor={c.seguimiento_fecha} desde={sumarDias(hoy, 1)} hasta={sumarDias(c.fecha, DIAS_MAX)}
                opciones={[{ dias: 1, label: "Mañana" }, { dias: 3, label: "3 días" }, { dias: 7, label: "1 semana" }, { dias: 14, label: "2 semanas" }, { dias: 30, label: "1 mes" }]}
                onChange={async (v) => {
                  if (!v || v === c.seguimiento_fecha) return;
                  try { guardado(await apiFetch<CoachingDetalle>(url, { method: "PATCH", body: JSON.stringify({ seguimiento_fecha: v }) }), `Seguimiento ${diaCorto(v)}.`); }
                  catch (e: any) { avisar(e.message, "error"); }
                }} />
            </Seccion>
            <BarraAccion>
              <Boton tipo="secundario" onClick={() => setPaso(2)} className="!w-auto shrink-0" icono={ArrowLeft}><span className="sr-only">Atrás</span></Boton>
              <Boton onClick={() => setPaso(4)} disabled={!comps.length}>Siguiente: devolución <ArrowRight size={20} aria-hidden /></Boton>
            </BarraAccion>
          </>
        )}

        {p === 4 && (
          <>
            <Seccion titulo="La devolución" sub="Le pasás el celular al asesor: lee sus compromisos, acepta y firma con el dedo. Después firmás vos.">
              <Lista>
                <button type="button" onClick={() => setPaso(2)} className="w-full text-left px-4 py-3 min-h-[60px] flex items-center gap-3 hover:bg-brand-bg-soft">
                  <MessageSquareText size={20} className="text-brand-slate shrink-0" aria-hidden />
                  <span className="flex-1 text-[15px] text-brand-ink"><b>{plural(items.length, "monitoreo o feedback", "monitoreos y feedback")}</b></span>
                  <span className="text-sm font-semibold text-brand-primary">Ver</span>
                </button>
                <div className="px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Compromisos que va a firmar</div>
                  <ol className="space-y-2">
                    {comps.map((x, i) => (
                      <li key={x.id} className="flex gap-2 text-[15px] text-brand-ink leading-snug">
                        <b className="text-brand-slate">{i + 1}.</b>
                        <span className="min-w-0 break-words">{x.texto || <i className="text-[#1D5BA6]">transcribiendo…</i>}{x.para && <span className="text-brand-slate"> · para {diaCorto(x.para)}</span>}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <button type="button" onClick={() => setPaso(3)} className="w-full text-left px-4 py-3 min-h-[60px] flex items-center gap-3 hover:bg-brand-bg-soft">
                  <ClipboardCheck size={20} className="text-brand-slate shrink-0" aria-hidden />
                  <span className="flex-1 text-[15px] text-brand-ink">Seguimiento <b>{diaCorto(c.seguimiento_fecha)}</b></span>
                  <span className="text-sm font-semibold text-brand-primary">Cambiar</span>
                </button>
              </Lista>
              {esperando > 0 && (
                <p className="mt-3 text-[13px] rounded-lg border border-[#2A78D6]/30 bg-[#2A78D6]/10 text-[#1D5BA6] px-3 py-2.5" role="status">
                  <span className="shimmer-text font-semibold">Transcribiendo {plural(esperando, "audio", "audios")}…</span> Se habilita la firma en cuanto llegue el texto.
                </p>
              )}
              <div className="mt-5 space-y-2">
                <Boton href={esperando ? undefined : `${PORTAL}/coaching/${c.id}/firma`} disabled={!!esperando} icono={PenLine} data-voi="coaching">
                  Hacer la devolución ahora
                </Boton>
                <Boton tipo="secundario" icono={Save} onClick={() => router.push(`${PORTAL}?aviso=guardado`)}>Guardar sin firmar</Boton>
                <p className="text-xs text-brand-slate text-center px-4">
                  Sin firmar no cuenta como coaching hecho. Tenés hasta {diaCorto(c.vence_devolucion)} para la devolución.
                </p>
                <div className="flex justify-between pt-2">
                  <button type="button" onClick={() => setPaso(3)} className="min-h-[44px] px-2 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-slate"><ArrowLeft size={16} aria-hidden /> Atrás</button>
                  <button type="button" onClick={() => setHoja({ t: "anular" })} className="min-h-[44px] px-2 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-primary"><Ban size={16} aria-hidden /> Anular</button>
                </div>
              </div>
            </Seccion>
          </>
        )}
        {hojas}
      </div>
    );
  }

  // ---------------------------------------------------------------- firmado, anterior a la firma o anulado
  return (
    <div className="max-w-xl mx-auto">
      {cabecera}
      <Terminado c={c} onHoja={setHoja} />
      {hojas}
    </div>
  );
}

function Terminado({ c, onHoja }: { c: CoachingDetalle; onHoja: (h: HojaAbierta) => void }) {
  const { boton: constancia, error: errConstancia } = useConstancia(c.firmado_at ? c : null);
  const asesor = c.firmas?.find((f) => f.firmante === "asesor");
  const supervisor = c.firmas?.find((f) => f.firmante === "supervisor");
  const audio = (aid: string | null) => (aid ? c.audios?.find((a) => a.id === aid) : undefined);
  const hoy = hoyPy();
  const s = c.seguimiento ? SEGUIMIENTO[c.seguimiento] : null;
  const sinMejora = c.estado === "cerrado" && (c.resultado === "igual" || c.resultado === "empeoro");
  const revision = [...c.eventos].reverse().find((e) => e.tipo === "revision");
  return (
    <div className="space-y-6">
      {c.estado === "anulado" ? (
        <Fallo>Este coaching está anulado: no cuenta. Queda en el historial.</Fallo>
      ) : c.firmado_at ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <div className="flex items-center gap-2 text-emerald-800 font-semibold text-[15px]"><CircleCheck size={20} aria-hidden /> Coaching terminado</div>
          <p className="text-sm text-emerald-900 mt-1">Firmado por {asesor?.nombre ?? c.operador} y {supervisor?.nombre ?? c.supervisor} · {fechaHoraCorta(c.firmado_at)}</p>
          {c.huella && (
            <p className="text-[11px] text-emerald-900/80 mt-2 flex items-center gap-1.5 break-all">
              <Fingerprint size={13} className="shrink-0" aria-hidden /> Huella <code className="font-mono">{c.huella.slice(0, 16)}…</code>
            </p>
          )}
          <div className="mt-3">{constancia}</div>
          {errConstancia && <p className="text-xs text-brand-primary-dark mt-2">{errConstancia}</p>}
        </div>
      ) : (
        <p className="text-xs text-brand-slate">Registrado el {fechaHoraPy(c.created_at)}, antes de la firma: vale igual.</p>
      )}

      {revision && (
        <div className={`rounded-xl border px-4 py-4 ${revision.datos.valoracion === "mejorar" ? "border-brand-orange/40 bg-brand-orange/5" : "border-brand-border bg-white"}`}>
          <div className="flex items-center gap-2 font-semibold text-[15px] text-brand-ink">
            {revision.datos.valoracion === "mejorar"
              ? <><MessageSquareWarning size={19} className="text-[#8A5200]" aria-hidden /> Tu jefe: a mejorar</>
              : <><ThumbsUp size={19} className="text-emerald-700" aria-hidden /> Tu jefe: bien hecho</>}
          </div>
          {revision.datos.comentario && <p className="text-[15px] text-brand-graphite mt-1.5 whitespace-pre-line break-words">{revision.datos.comentario}</p>}
          <p className="text-xs text-brand-slate mt-2">{revision.por} · {fechaHoraCorta(revision.at)}</p>
        </div>
      )}

      {c.estado !== "anulado" && (
        <Seccion titulo="Seguimiento">
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[15px] text-brand-ink">Acordado para <b>{diaCorto(c.seguimiento_fecha, hoy)}</b></span>
              {s && <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${s.chip}`}>{s.corto}</span>}
            </div>
            {c.estado === "abierto" && (hoy > c.fecha
              ? <Boton icono={ClipboardCheck} onClick={() => onHoja({ t: "seguimiento" })}>Registrar seguimiento</Boton>
              : <p className="text-sm text-brand-slate">El seguimiento se registra desde mañana.</p>)}
            {c.estado === "cerrado" && (
              <>
                {c.resultado && <ResultadoChip r={c.resultado} delta={c.impacto?.delta} metrica={c.metrica} />}
                {c.seguimiento_comentario && <p className="text-[15px] text-brand-graphite whitespace-pre-line break-words">{c.seguimiento_comentario}</p>}
                <ImpactoVista i={c.impacto} compacto />
                {sinMejora && (
                  <Boton tipo="secundario" icono={MessageSquareText} href={hrefNuevoCoaching(c.operador_id, { anterior: c.id, metrica: c.metrica })}>
                    Hacer otro coaching (continúa este)
                  </Boton>
                )}
              </>
            )}
          </div>
        </Seccion>
      )}

      {(c.compromisos?.length ?? 0) > 0 ? (
        <Seccion titulo="Compromisos">
          <div className="space-y-3">{c.compromisos!.map((x, i) => <CompromisoCard key={x.id} x={x} n={i + 1} audio={audio(x.audio_id)} />)}</div>
        </Seccion>
      ) : c.compromiso && (
        <Seccion titulo="Compromiso"><p className="card p-4 text-[15px] text-brand-ink whitespace-pre-line break-words">{c.compromiso}</p></Seccion>
      )}

      {(c.items?.length ?? 0) > 0 ? (
        <Seccion titulo="Lo que se observó">
          <div className="space-y-3">{c.items!.map((it) => <ItemCard key={it.id} it={it} audio={audio(it.audio_id)} />)}</div>
        </Seccion>
      ) : c.diagnostico && (
        <Seccion titulo="Diagnóstico"><p className="card p-4 text-[15px] text-brand-ink whitespace-pre-line break-words">{c.diagnostico}</p></Seccion>
      )}

      {asesor && (
        <Seccion titulo="Firmas">
          {asesor.comentario && (
            <div className="card p-4 mb-3">
              <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Comentario del asesor</div>
              <p className="text-[15px] text-brand-ink mt-1 whitespace-pre-line break-words">{asesor.comentario}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {[asesor, supervisor].filter(Boolean).map((f) => (
              <figure key={f!.id} className="card p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f!.imagen} alt={`Firma de ${f!.nombre}`} className="h-20 w-full object-contain" />
                <figcaption className="border-t border-brand-border mt-2 pt-2 text-xs text-brand-slate">
                  <b className="block text-brand-ink truncate">{f!.nombre}</b>{f!.firmante === "asesor" ? "Asesor" : "Supervisor"}
                </figcaption>
              </figure>
            ))}
          </div>
          {asesor.consentimiento_audio && <p className="text-xs text-brand-slate mt-2">El asesor aceptó que su voz quede grabada.</p>}
        </Seccion>
      )}

      {c.estado !== "anulado" && (
        <Boton tipo="secundario" icono={MessageSquarePlus} onClick={() => onHoja({ t: "aclaracion" })}>Agregar una aclaración</Boton>
      )}

      <details className="card">
        <summary className="px-4 min-h-[56px] flex items-center gap-2 cursor-pointer font-semibold text-brand-ink"><History size={18} aria-hidden /> Historial</summary>
        <ol className="px-4 pb-4 space-y-2.5">
          {c.eventos.filter((e) => e.tipo !== "transcripcion").map((e) => (
            <li key={e.id} className="text-sm text-brand-graphite">
              <span className="text-brand-slate text-xs tabular-nums">{fechaHoraPy(e.at)}</span> · <b className="text-brand-ink">{e.por}</b> · {EVENTO[e.tipo] ?? e.tipo}
              {e.tipo === "aclaracion" && e.datos.texto && <div className="text-xs mt-0.5">{e.datos.texto}</div>}
              {e.tipo === "anulado" && e.datos.motivo && <div className="text-xs mt-0.5">{e.datos.motivo}</div>}
              {e.tipo === "revision" && (
                <div className="text-xs mt-0.5">{e.datos.valoracion === "mejorar" ? "A mejorar" : "Bien hecho"}{e.datos.comentario ? ` · ${e.datos.comentario}` : ""}</div>
              )}
            </li>
          ))}
        </ol>
      </details>
      {c.estado === "cerrado" && <div className="flex justify-center"><Etiqueta tono="verde" icono={CircleCheck}>Cerrado</Etiqueta></div>}
    </div>
  );
}

const EVENTO: Record<string, string> = {
  creado: "abrió el coaching", editado: "corrigió", anulado: "anuló el coaching", seguimiento: "registró el seguimiento",
  aclaracion: "agregó una aclaración", item: "sumó un monitoreo o feedback", item_editado: "corrigió un monitoreo o feedback",
  item_quitado: "quitó un monitoreo o feedback", compromiso: "sumó un compromiso", compromiso_editado: "corrigió un compromiso",
  compromiso_quitado: "quitó un compromiso", audio: "grabó un audio", transcripcion: "transcripción lista", firmado: "firmaron la devolución",
  revision: "revisó el coaching",
};
