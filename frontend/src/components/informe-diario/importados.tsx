"use client";

import { Headset, Lock, MessageSquareText, RefreshCw, ShoppingBag, TrendingUp, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ErrorMsg, Modal } from "@/components/supervision/dialogos";
import { apiFetch } from "@/lib/api";
import { Chip } from "./campos";
import { CHIP, ID_API, TONO_TEXTO, diaCorto, type Fuente, type Importado, type TipoFuente } from "./tipos";

export const ICONO_FUENTE: Record<TipoFuente, typeof Headset> = {
  llamadas: Headset, cargas: ShoppingBag, proyeccion: TrendingUp, coaching: MessageSquareText,
};

/** Un dato importado de la plataforma, como quedó congelado en el informe. */
export function TarjetaImportado({ x, onQuitar, onActualizar, actualizando }: {
  x: Importado; onQuitar?: () => void; onActualizar?: () => void; actualizando?: boolean;
}) {
  const I = ICONO_FUENTE[x.tipo] ?? Headset;
  return (
    <article className="rounded-md border border-brand-border bg-brand-bg-soft/60 min-w-0">
      <header className="px-3.5 pt-3 pb-2 flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <span className="w-8 h-8 rounded-md bg-white border border-brand-border flex items-center justify-center shrink-0 text-brand-slate"><I size={16} aria-hidden /></span>
          <div className="min-w-0">
            <div className="font-semibold text-sm text-brand-ink leading-tight">{x.titulo}</div>
            <div className="text-[11px] text-brand-slate">
              {x.subtitulo}
              {x.url && <> · <Link href={x.url} className="text-brand-primary hover:underline">ver</Link></>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {x.estado === "borrador" && <Chip chip={CHIP.NARANJA}>Borrador</Chip>}
          {onActualizar && (
            <button type="button" onClick={onActualizar} disabled={actualizando} title="Volver a importar (con los datos de ahora)"
              className="btn-ghost !p-1.5" aria-label={`Actualizar ${x.titulo}`}><RefreshCw size={14} className={actualizando ? "animate-spin" : ""} /></button>
          )}
          {onQuitar && (
            <button type="button" onClick={onQuitar} className="btn-ghost !p-1.5 hover:text-brand-primary" aria-label={`Quitar ${x.titulo}`}><X size={15} /></button>
          )}
        </div>
      </header>
      {x.aviso && (
        <p className="mx-3.5 mb-2 text-[11px] text-[#8A5200] flex items-start gap-1"><TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />{x.aviso}</p>
      )}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-brand-border border-t border-brand-border">
        {/* Celdas vacías hasta completar la fila (múltiplo de 4: sirve para 2 y 4 columnas). */}
        {Array.from({ length: (4 - (x.kpis.length % 4)) % 4 }, (_, k) => <div key={`vacio-${k}`} className="bg-white order-last" aria-hidden />)}
        {x.kpis.map((k) => (
          <div key={k.label} className="bg-white px-3 py-2 min-w-0">
            <dt className="text-[10px] uppercase tracking-wider2 text-brand-slate truncate" title={k.label}>{k.label}</dt>
            <dd className={`font-display text-xl leading-tight tabular-nums ${TONO_TEXTO[k.tono] ?? "text-brand-ink"}`}>{k.valor}</dd>
            {k.detalle && <dd className="text-[10px] text-brand-slate leading-snug">{k.detalle}</dd>}
          </div>
        ))}
      </dl>
      {x.filas?.filas?.length ? (
        <div className="overflow-x-auto border-t border-brand-border">
          <table className="w-full text-xs min-w-[420px]">
            <thead>
              <tr className="bg-brand-bg text-[10px] uppercase tracking-wider2 text-brand-slate">
                {x.filas.columnas.map((c, i) => <th key={c} className={`px-3 py-1.5 font-semibold ${i ? "text-right" : "text-left"}`}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {x.filas.filas.map((f, j) => (
                <tr key={j} className="border-t border-brand-border bg-white">
                  {f.map((v, i) => <td key={i} className={`px-3 py-1.5 tabular-nums ${i ? "text-right" : "text-left font-semibold text-brand-ink"}`}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  );
}

/** Elegir qué traer de la plataforma (según los permisos de cada uno) y de qué día. */
export function DialogoImportar({ informeId, fecha, fuentes, importados, onClose, onImportados }: {
  informeId: string; fecha: string; fuentes: Fuente[] | null; importados: Importado[]; onClose: () => void;
  onImportados: (lista: Importado[], mensaje: string) => void;
}) {
  const [elegida, setElegida] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importar = async (f: Fuente) => {
    const ref = elegida[f.tipo] ?? f.opciones[0]?.ref;
    if (!ref) return;
    setOcupado(f.tipo);
    setError(null);
    try {
      const r = await apiFetch<{ importado: Importado; reemplazo: boolean; importados: Importado[] }>(`${ID_API}/${informeId}/importar`, {
        method: "POST", body: JSON.stringify({ tipo: f.tipo, ref }),
      });
      onImportados(r.importados, `${r.importado.titulo} ${r.reemplazo ? "actualizado" : "importado"}.`);
    } catch (e: any) { setError(e.message); } finally { setOcupado(null); }
  };

  return (
    <Modal onClose={onClose} sobre={`Informe del ${diaCorto(fecha)}`} titulo="Importar datos" ancho="max-w-2xl">
      <p className="text-xs text-brand-slate mb-4">
        Datos ya cargados en la plataforma. Quedan fijos en el informe tal como están ahora (si cambian, usá «Actualizar»).
      </p>
      {!fuentes ? <p className="text-sm text-brand-slate">Cargando…</p> : (
        <ul className="space-y-3">
          {fuentes.map((f) => {
            const I = ICONO_FUENTE[f.tipo];
            const ref = elegida[f.tipo] ?? f.opciones[0]?.ref;
            const opcion = f.opciones.find((o) => o.ref === ref);
            const ya = importados.some((x) => x.tipo === f.tipo && (x.fecha === ref || (f.tipo === "proyeccion" && x.fecha === ref)));
            return (
              <li key={f.tipo} className={`rounded-md border px-3.5 py-3 ${f.permiso && f.opciones.length ? "border-brand-border bg-white" : "border-dashed border-brand-border bg-brand-bg-soft"}`}>
                <div className="flex items-start gap-3">
                  <span className="w-9 h-9 rounded-md bg-brand-bg border border-brand-border flex items-center justify-center shrink-0 text-brand-slate"><I size={17} aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm text-brand-ink">{f.titulo}</div>
                    <p className="text-[11px] text-brand-slate leading-snug">{f.descripcion}</p>
                    {!f.permiso ? (
                      <p className="text-[11px] text-brand-slate mt-2 inline-flex items-center gap-1"><Lock size={12} aria-hidden /> No tenés acceso a este módulo.</p>
                    ) : !f.opciones.length ? (
                      <p className="text-[11px] text-[#8A5200] mt-2">No hay datos cargados para estos días.</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {f.opciones.length > 1 ? (
                          <select className="input !py-1.5 !w-auto text-sm" value={ref} aria-label={`Día de ${f.titulo}`}
                            onChange={(e) => setElegida((x) => ({ ...x, [f.tipo]: e.target.value }))}>
                            {f.opciones.map((o) => <option key={o.ref} value={o.ref}>{o.label}{o.estado === "borrador" ? " · borrador" : ""}</option>)}
                          </select>
                        ) : (
                          <span className="text-xs font-semibold text-brand-graphite">{f.opciones[0].label}</span>
                        )}
                        <button type="button" className={ya ? "btn-secondary !py-1.5 !px-3 text-xs" : "btn-primary !py-1.5 !px-3 text-xs"}
                          disabled={!!ocupado} onClick={() => importar(f)}>
                          {ocupado === f.tipo ? "Importando…" : ya ? <><RefreshCw size={13} /> Actualizar</> : "Importar"}
                        </button>
                        {opcion?.detalle && <span className="text-[11px] text-brand-slate basis-full">{opcion.detalle}</span>}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ErrorMsg msg={error} />
    </Modal>
  );
}
