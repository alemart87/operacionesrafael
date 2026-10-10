"use client";

import {
  CalendarClock, CircleCheck, Eye, EyeOff, FileDown, MessageSquareText, Send, Share2, ShieldAlert, ShieldCheck, TriangleAlert,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { ErrorMsg } from "@/components/supervision/dialogos";
import { apiFetch, downloadFile, getToken } from "@/lib/api";
import { Chip, Seccion } from "./campos";
import { TarjetaImportado } from "./importados";
import {
  CHIP, ESTADO_METRICA, ESTADO_SEG, ID_API, NIVEL, TONO_TEXTO, cumplimiento, diaCorto, diaLargo, fechaHoraPy, numero,
  type Comentario, type InformeDetalle, type Marca,
} from "./tipos";

// ------------------------------------------------------------------ palabras clave resaltadas
function Resaltado({ texto, marcas, activo }: { texto: string; marcas?: Marca[]; activo: boolean }) {
  if (!activo || !marcas?.length) return <>{texto}</>;
  const partes: ReactNode[] = [];
  let i = 0;
  [...marcas].sort((a, b) => a[0] - b[0]).forEach(([ini, fin, tema, critico, negada], k) => {
    if (ini < i) return;
    if (ini > i) partes.push(texto.slice(i, ini));
    const cls = negada ? "bg-transparent underline decoration-dotted decoration-brand-mist text-inherit"
      : critico ? "bg-brand-primary/15 text-brand-primary-dark font-semibold rounded-sm px-0.5" : "bg-[#F39200]/15 text-inherit rounded-sm px-0.5";
    partes.push(<mark key={k} className={cls} title={negada ? `${tema} (negada: no cuenta)` : tema}>{texto.slice(ini, fin)}</mark>);
    i = fin;
  });
  partes.push(texto.slice(i));
  return <>{partes}</>;
}

// ------------------------------------------------------------------ compartir / descargar
async function pdfComoArchivo(id: string, nombre: string): Promise<File> {
  const token = getToken();
  const r = await fetch(`${ID_API}/${id}/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!r.ok) throw new Error(`No se pudo generar el PDF (error ${r.status})`);
  const cd = r.headers.get("content-disposition") ?? "";
  const n = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? nombre;
  return new File([await r.blob()], n, { type: "application/pdf" });
}

function puedeCompartir(): boolean {
  if (typeof navigator === "undefined" || !navigator.canShare) return false;
  try { return navigator.canShare({ files: [new File([""], "x.pdf", { type: "application/pdf" })] }); } catch { return false; }
}

// ------------------------------------------------------------------ comentarios
function Comentarios({ d, onCambio }: { d: InformeDetalle; onCambio: (c: Comentario[], revisado_at?: string | null) => void }) {
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const puede = d.estado === "firmado";
  const enviar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const r = await apiFetch<{ comentarios: Comentario[]; revisado_at: string | null }>(`${ID_API}/${d.id}/comentarios`, {
        method: "POST", body: JSON.stringify({ texto }),
      });
      setTexto("");
      onCambio(r.comentarios, r.revisado_at);
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <Seccion titulo="Comentarios" sub={d.es_autor ? "Lo que comenta el superadmin sobre tu informe; podés responderle." : "Tu devolución al autor del informe: la ve en su informe."}>
      {!d.comentarios.length ? (
        <p className="text-sm text-brand-slate mb-3">Todavía no hay comentarios.</p>
      ) : (
        <ol className="space-y-3 mb-4">
          {d.comentarios.map((c) => (
            <li key={c.id} className={`flex gap-3 ${c.rol === "superadmin" ? "" : "sm:pl-10"}`}>
              <span className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold ${c.rol === "superadmin" ? "bg-brand-ink text-white" : "bg-brand-bg text-brand-graphite border border-brand-border"}`} aria-hidden>
                {c.autor.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
              </span>
              <div className={`min-w-0 flex-1 rounded-lg px-3.5 py-2.5 ${c.rol === "superadmin" ? "bg-brand-bg-soft border border-brand-border" : "bg-white border border-brand-border"}`}>
                <div className="text-[11px] text-brand-slate"><b className="text-brand-ink">{c.autor}</b> · {c.rol === "superadmin" ? "Superadmin" : "Autor"} · {fechaHoraPy(c.at)}</div>
                <p className="text-sm text-brand-graphite mt-0.5 whitespace-pre-line break-words">{c.texto}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {puede && (
        <div className="space-y-2">
          <textarea className="input text-sm resize-y" rows={3} maxLength={2000} aria-label="Escribir un comentario"
            placeholder={d.es_autor ? "Responder…" : "Comentario para el autor: qué destacar, qué revisar, qué pedir…"}
            value={texto} onChange={(e) => setTexto(e.target.value)} />
          <div className="flex justify-end">
            <button type="button" className="btn-primary !py-2" disabled={ocupado || texto.trim().length < 2} onClick={enviar}>
              <Send size={15} /> {ocupado ? "Enviando…" : d.es_autor ? "Responder" : "Comentar"}
            </button>
          </div>
        </div>
      )}
      <ErrorMsg msg={error} />
    </Seccion>
  );
}

// ------------------------------------------------------------------ el informe en lectura
export function VistaInforme({ inicial, superadmin, recienFirmado }: { inicial: InformeDetalle; superadmin: boolean; recienFirmado?: boolean }) {
  const [d, setD] = useState(inicial);
  const [resaltar, setResaltar] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const compartible = useMemo(puedeCompartir, []);
  const m = d.palabras?.marcas ?? {};
  const r = d.resultados;
  const ant = r.anterior;
  const firmado = d.estado === "firmado";

  const descargar = async () => {
    setOcupado("pdf");
    setError(null);
    try { await downloadFile(`${ID_API}/${d.id}/pdf`, `Informe-diario_${d.fecha}.pdf`); } catch (e: any) { setError(e.message); } finally { setOcupado(null); }
  };
  const compartir = async () => {
    setOcupado("compartir");
    setError(null);
    try {
      const f = await pdfComoArchivo(d.id, `Informe-diario_${d.fecha}.pdf`);
      await navigator.share({ files: [f], title: `Informe diario ${diaCorto(d.fecha)}`, text: `Informe diario del ${diaLargo(d.fecha)} · ${d.autor}` });
    } catch (e: any) { if (e?.name !== "AbortError") setError(e.message); } finally { setOcupado(null); }
  };
  const revisar = async (revisado: boolean) => {
    setOcupado("revisado");
    try {
      const x = await apiFetch<{ revisado_at: string | null }>(`${ID_API}/${d.id}/revisado`, { method: "POST", body: JSON.stringify({ revisado }) });
      setD((v) => ({ ...v, revisado_at: x.revisado_at }));
    } catch (e: any) { setError(e.message); } finally { setOcupado(null); }
  };

  const filasResultados = [
    { nombre: "Pospago", x: r.pospago, previo: ant?.pospago, clave: "resultados.pospago.comentario" },
    { nombre: "GPON", x: r.gpon, previo: ant?.gpon, clave: "resultados.gpon.comentario" },
    ...r.otros.map((o, i) => ({ nombre: o.nombre || "Otro", x: o, previo: undefined, clave: `resultados.otros.${i}.comentario` })),
  ];

  return (
    <div className="space-y-5">
      {recienFirmado && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900 flex items-start gap-3">
          <ShieldCheck size={22} className="shrink-0 mt-0.5 text-emerald-600" aria-hidden />
          <div>
            <div className="font-semibold">Informe firmado</div>
            <p className="text-sm">Código de verificación <b className="tabular-nums">{d.firma?.codigo}</b>. Descargá el PDF para enviarlo.</p>
          </div>
        </div>
      )}

      {/* ---- encabezado */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Informe diario · Televentas Claro</div>
          <h1 className="font-display text-3xl sm:text-5xl text-brand-ink uppercase leading-tight flex items-center gap-3 flex-wrap">
            {diaLargo(d.fecha)}
            {firmado ? <Chip chip={CHIP.VERDE} icono={<CircleCheck size={11} aria-hidden />}>Firmado</Chip> : <Chip chip={CHIP.NARANJA}>Borrador</Chip>}
          </h1>
          <p className="text-sm text-brand-slate mt-1">
            {d.autor} · {d.firma?.cargo ?? d.cargo}{firmado && d.firmado_at ? <> · firmado el {fechaHoraPy(d.firmado_at)}</> : null}
          </p>
          {superadmin && d.verificacion !== null && (
            <p className={`text-xs mt-1 inline-flex items-center gap-1 font-semibold ${d.verificacion ? "text-emerald-700" : "text-brand-primary-dark"}`}>
              {d.verificacion ? <><ShieldCheck size={13} aria-hidden /> El contenido coincide con su código {d.firma?.codigo}</>
                : <><ShieldAlert size={13} aria-hidden /> El contenido NO coincide con su código: fue modificado después de firmarse</>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap print:hidden w-full sm:w-auto">
          {superadmin && firmado && (
            <button type="button" disabled={!!ocupado} onClick={() => revisar(!d.revisado_at)}
              className={d.revisado_at ? "btn-secondary !py-2 !px-3 text-xs text-emerald-700" : "btn-secondary !py-2 !px-3 text-xs"}>
              <CircleCheck size={15} /> {d.revisado_at ? `Revisado ${diaCorto(d.revisado_at)}` : "Marcar revisado"}
            </button>
          )}
          {compartible && (
            <button type="button" className="btn-secondary !py-2.5 flex-1 sm:flex-none" disabled={!!ocupado} onClick={compartir}>
              <Share2 size={16} /> {ocupado === "compartir" ? "Preparando…" : "Compartir"}
            </button>
          )}
          <button type="button" className="btn-primary !py-2.5 flex-1 sm:flex-none" disabled={!!ocupado} onClick={descargar}>
            <FileDown size={16} /> {ocupado === "pdf" ? "Generando…" : "Descargar PDF"}
          </button>
        </div>
      </div>
      <ErrorMsg msg={error} />

      {/* ---- palabras clave (superadmin) */}
      {superadmin && d.palabras && (
        <section className="card p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Palabras clave</h2>
              <p className="text-xs text-brand-slate mt-0.5">{d.palabras.total} menciones · {d.palabras.criticas} de temas críticos{d.palabras.negadas ? ` · ${d.palabras.negadas} negadas (no cuentan)` : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              <Chip chip={NIVEL[d.palabras.nivel].chip} title={NIVEL[d.palabras.nivel].ayuda}
                icono={d.palabras.nivel !== "bajo" ? <TriangleAlert size={10} aria-hidden /> : undefined}>{NIVEL[d.palabras.nivel].label}</Chip>
              <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => setResaltar((x) => !x)}>
                {resaltar ? <><EyeOff size={14} /> Sin resaltar</> : <><Eye size={14} /> Resaltar</>}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {Object.entries(d.palabras.temas).sort((a, b) => b[1] - a[1]).map(([t, n]) => {
              const info = d.temas?.[t];
              return <Chip key={t} chip={info?.critico ? CHIP.ROJO : CHIP.GRIS} icono={info?.critico ? <TriangleAlert size={10} aria-hidden /> : undefined}>{info?.nombre ?? t} · {n}</Chip>;
            })}
          </div>
          {d.palabras.claves.length > 0 && (
            <p className="text-xs text-brand-slate mt-2">
              {d.palabras.claves.slice(0, 12).map((c) => `${c.forma ?? c.clave}${c.n > 1 ? ` ×${c.n}` : ""}`).join(" · ")}
            </p>
          )}
        </section>
      )}

      {/* ---- resultados */}
      <Seccion titulo="Resultados del día">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {filasResultados.map(({ nombre, x, previo, clave }) => {
            const c = cumplimiento(x.valor, x.meta);
            return (
              <div key={clave} className="rounded-lg border border-brand-border bg-white p-3 min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate truncate">{nombre}</div>
                <div className="font-display text-4xl text-brand-ink tabular-nums leading-none mt-1">{numero(x.valor)}</div>
                <div className="text-[11px] text-brand-slate mt-1.5 flex flex-wrap gap-x-2">
                  {x.meta ? <span>meta {numero(x.meta)} · <b className={TONO_TEXTO[c.tono]}>{numero(c.pct, 0)}%</b></span> : null}
                  {previo !== undefined && previo !== null && <span>ayer {numero(previo)}</span>}
                </div>
                {x.comentario && <p className="text-xs text-brand-graphite mt-1.5 break-words"><Resaltado texto={x.comentario} marcas={m[clave]} activo={resaltar} /></p>}
              </div>
            );
          })}
        </div>
        {r.fuente && <p className="text-[11px] text-brand-slate mt-2">Tomados de: {r.fuente}.</p>}
      </Seccion>

      {d.importados.length > 0 && (
        <Seccion titulo="Datos de la plataforma">
          <div className="space-y-3">{d.importados.map((x) => <TarjetaImportado key={x.id} x={x} />)}</div>
        </Seccion>
      )}

      <Seccion titulo="Resumen del día">
        <p className="text-[15px] leading-relaxed text-brand-graphite whitespace-pre-line break-words">
          {d.resumen ? <Resaltado texto={d.resumen} marcas={m.resumen} activo={resaltar} /> : <span className="text-brand-slate">Sin resumen.</span>}
        </p>
      </Seccion>

      {d.metricas.length > 0 && (
        <Seccion titulo="Métricas críticas">
          <ul className="space-y-3">
            {d.metricas.map((x, i) => {
              const e = ESTADO_METRICA[x.estado];
              return (
                <li key={x.id} className="relative rounded-lg border border-brand-border bg-white overflow-hidden">
                  <span className={`absolute left-0 top-0 bottom-0 w-1 ${e.barra}`} aria-hidden />
                  <div className="p-3 sm:p-4 pl-4 sm:pl-5 grid md:grid-cols-[minmax(0,220px)_1fr_1fr] gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-brand-ink"><Resaltado texto={x.nombre} marcas={m[`metricas.${i}.nombre`]} activo={resaltar} /></div>
                      <div className="font-display text-3xl text-brand-ink tabular-nums leading-tight">{x.indicador || "—"}</div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        <Chip chip={e.chip}>{e.label}</Chip>
                        {x.anterior && <span className="text-[11px] text-brand-slate">antes: {x.anterior}</span>}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">Comentario</div>
                      <p className="text-sm text-brand-graphite whitespace-pre-line break-words">
                        {x.comentario ? <Resaltado texto={x.comentario} marcas={m[`metricas.${i}.comentario`]} activo={resaltar} /> : "—"}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">Compromiso o anotación</div>
                      <p className="text-sm text-brand-graphite whitespace-pre-line break-words">
                        {x.compromiso ? <Resaltado texto={x.compromiso} marcas={m[`metricas.${i}.compromiso`]} activo={resaltar} /> : "—"}
                      </p>
                      {(x.responsable || x.fecha_compromiso) && (
                        <p className="text-[11px] text-brand-slate mt-1 inline-flex items-center gap-1 flex-wrap">
                          {x.responsable && <span>{x.responsable}</span>}
                          {x.fecha_compromiso && <span className="inline-flex items-center gap-1"><CalendarClock size={11} aria-hidden /> para el {diaCorto(x.fecha_compromiso)}</span>}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Seccion>
      )}

      {d.seguimiento.length > 0 && (
        <Seccion titulo="Seguimiento de compromisos anteriores">
          <ul className="divide-y divide-brand-border border border-brand-border rounded-md">
            {d.seguimiento.map((s, i) => (
              <li key={s.compromiso_id} className="px-3.5 py-2.5 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-brand-ink">{s.metrica} <span className="text-[11px] font-normal text-brand-slate">· del {diaCorto(s.desde)}</span></div>
                  <p className="text-sm text-brand-graphite break-words">{s.texto}</p>
                  {s.nota && <p className="text-xs text-brand-slate mt-0.5 break-words"><Resaltado texto={s.nota} marcas={m[`seguimiento.${i}.nota`]} activo={resaltar} /></p>}
                </div>
                <Chip chip={ESTADO_SEG[s.estado].chip}>{ESTADO_SEG[s.estado].label}</Chip>
              </li>
            ))}
          </ul>
        </Seccion>
      )}

      {firmado && d.firma && (
        <Seccion titulo="Firma">
          <div className="max-w-sm">
            {d.firma.imagen && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.firma.imagen} alt={`Firma de ${d.firma.nombre}`} className="max-h-24 max-w-full object-contain" />
            )}
            <div className="border-t border-brand-graphite mt-1 pt-1.5">
              <div className="font-semibold text-brand-ink">{d.firma.nombre}</div>
              <div className="text-sm text-brand-slate">{d.firma.cargo}</div>
              <div className="text-[11px] text-brand-slate mt-1.5">
                Firmado electrónicamente el {fechaHoraPy(d.firma.firmado_at)} · código <b className="text-brand-ink tabular-nums whitespace-nowrap">{d.firma.codigo}</b>
              </div>
            </div>
          </div>
        </Seccion>
      )}

      {firmado && <Comentarios d={d} onCambio={(comentarios, revisado_at) => setD((v) => ({ ...v, comentarios, revisado_at: revisado_at ?? v.revisado_at }))} />}
      {!firmado && superadmin && (
        <p className="text-xs text-brand-slate flex items-center gap-1.5"><MessageSquareText size={13} aria-hidden /> Es un borrador: se comenta cuando su autor lo firme.</p>
      )}
    </div>
  );
}
