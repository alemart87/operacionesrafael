"use client";

import { PrintCover, PrintHeader } from "@/components/PrintButton";
import { GraficoAuditoria, tituloGrafico } from "./GraficoAuditoria";
import {
  ESTADO_AUD_LABEL, HALLAZGO_ESTADO_LABEL, SEVERIDAD_CLS, SEVERIDAD_LABEL, fechaCorta, fechaHora, n, pct, rangoPeriodos,
  type AuditoriaDetalle, type Severidad,
} from "./tipos";

const ORDEN_SEV: Record<Severidad, number> = { alta: 0, media: 1, baja: 2, info: 3 };
const BORDE_SEV: Record<Severidad, string> = { alta: "border-l-brand-primary", media: "border-l-brand-orange", baja: "border-l-brand-cyan", info: "border-l-brand-mist" };

function Bloque({ num, titulo, children }: { num: string; titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-9 ejecutivo-bloque">
      <div className="flex items-baseline gap-3 border-b-2 border-brand-ink pb-1.5 mb-4">
        <span className="font-display text-3xl text-brand-primary leading-none">{num}</span>
        <h2 className="font-display text-2xl text-brand-ink uppercase leading-none">{titulo}</h2>
      </div>
      {children}
    </section>
  );
}

function Texto({ texto, vacio }: { texto: string | null; vacio: string }) {
  if (!texto?.trim()) return <p className="text-sm text-brand-mist italic">{vacio}</p>;
  return <div className="text-[15px] text-brand-graphite leading-relaxed whitespace-pre-line">{texto}</div>;
}

/**
 * Informe ejecutivo: lo que necesita la Gerencia para decidir. Lectura del auditor, indicadores,
 * hallazgos (sin tablas de evidencia), gráficos con sus comentarios, vendedores críticos,
 * conclusiones y recomendaciones. La evidencia completa va en el informe extenso.
 */
export function InformeEjecutivo({ a }: { a: AuditoriaDetalle }) {
  const s = a.snapshot;
  const k = s.kpis;
  const periodo = rangoPeriodos(a);
  const nombre = (id: string | null) => (id && a.usuarios[id]) || "—";
  const hallazgos = a.hallazgos
    .filter((h) => h.estado !== "descartado")
    .sort((x, y) => ORDEN_SEV[x.severidad] - ORDEN_SEV[y.severidad] || x.orden - y.orden);
  const porSev = (sv: Severidad) => hallazgos.filter((h) => h.severidad === sv).length;
  // En el ejecutivo se detallan los generales, los críticos y los que cargó el auditor;
  // las alertas medias por vendedor van en una tabla de una línea cada una.
  const esMediaVendedor = (h: (typeof hallazgos)[number]) => h.origen === "auto" && h.categoria === "vendedor" && h.severidad !== "alta";
  const detallados = hallazgos.filter((h) => !esMediaVendedor(h));
  const medias = hallazgos.filter(esMediaVendedor);
  const rk = new Map(s.ranking.map((v) => [v.vendedor, v]));
  const criticos = s.ranking.filter((v) => v.nivel === "critico").sort((x, y) => y.pct_sin_uso - x.pct_sin_uso);
  const umbral = s.parametros?.umbral_sin_uso_critico;

  const kpis: [string, string, string, string][] = [
    ["Ventas netas", n(k.netas), `${n(k.pospago)} Pospago · ${n(k.gpon)} GPON · ${n(k.iptv)} IPTV`, "border-l-brand-ink"],
    ["Pospago sin uso", pct(k.pct_sin_uso), `${n(k.pospago_sin_uso)} líneas con 3+ días${k.en_espera ? ` · ${n(k.en_espera)} en espera` : ""}`, "border-l-brand-primary"],
    ["Sali Hablando sin uso", `${n(k.sali_sin_uso)} · ${pct(k.sali_pct_sin_uso)}`, `de ${n(k.sali_total)} portaciones SH`, "border-l-brand-primary"],
    ["Vendedores críticos", n(k.vendedores_criticos), `${n(k.vendedores_atencion)} en alerta media · de ${n(k.vendedores)}`, "border-l-brand-orange"],
  ];

  return (
    <div className="informe-impreso informe-ejecutivo bg-white text-brand-ink">
      <PrintCover titulo={`Informe ejecutivo de auditoría · ${a.codigo}`} periodo={a.titulo.toLowerCase().includes(periodo.toLowerCase()) ? a.titulo : `${a.titulo} · ${periodo}`} />
      <PrintHeader titulo={`${a.codigo} · ${a.titulo}`} subtitulo={`Informe ejecutivo · Auditoría de Ventas · Televentas CLARO · ${periodo} · ${ESTADO_AUD_LABEL[a.status]}`} />

      {/* Cabecera en pantalla */}
      <div className="print:hidden rounded-xl bg-brand-ink text-white p-6 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-1 bg-brand-primary" />
        <div className="text-[11px] uppercase tracking-wider2 text-white/60">Informe ejecutivo · {a.codigo}</div>
        <h1 className="font-display text-3xl uppercase leading-tight mt-1">{a.titulo}</h1>
        <div className="text-sm text-white/70 mt-1">{periodo} · {ESTADO_AUD_LABEL[a.status]} · auditor {nombre(a.created_by)}</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 text-sm">
        {[
          ["Período", periodo],
          ["Fuente", a.fuentes.map((f) => `corte ${fechaCorta(f.fecha_dato)}`).join(" · ")],
          ["Auditor", nombre(a.created_by)],
          ["Estado", a.closed_at ? `${ESTADO_AUD_LABEL[a.status]} · ${fechaCorta(a.closed_at)}` : ESTADO_AUD_LABEL[a.status]],
        ].map(([l, v]) => (
          <div key={l} className="rounded-md bg-brand-bg px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">{l}</div>
            <div className="font-semibold text-brand-ink">{v}</div>
          </div>
        ))}
      </div>

      <Bloque num="1" titulo="Resumen del auditor">
        <div className="rounded-lg border-l-4 border-l-brand-primary bg-brand-primary-light/40 p-5">
          <Texto texto={a.resumen} vacio="Sin resumen redactado." />
        </div>
      </Bloque>

      <Bloque num="2" titulo="Indicadores clave">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpis.map(([l, v, h, c]) => (
            <div key={l} className={`card p-4 border-l-[3px] ${c}`}>
              <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">{l}</div>
              <div className="font-display text-3xl text-brand-ink leading-tight">{v}</div>
              <div className="text-[11px] text-brand-slate">{h}</div>
            </div>
          ))}
        </div>
        {umbral !== undefined && (
          <p className="text-[11px] text-brand-slate mt-2">
            Crítico: vendedor con más de {pct(umbral)} de sus líneas sin uso con 3 o más días de activadas. Las activadas hace menos de 3 días al corte están en espera de uso y no cuentan.
          </p>
        )}
      </Bloque>

      <Bloque num="3" titulo={`Hallazgos (${n(hallazgos.length)})`}>
        <div className="flex flex-wrap gap-2 mb-4">
          {(["alta", "media", "baja"] as Severidad[]).map((sv) => (
            <span key={sv} className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold ${SEVERIDAD_CLS[sv]}`}>
              <span className="font-display text-xl leading-none">{porSev(sv)}</span> severidad {SEVERIDAD_LABEL[sv].toLowerCase()}
            </span>
          ))}
        </div>
        <div className="space-y-3">
          {detallados.map((h) => (
            <article key={h.id} className={`card p-4 border-l-4 ${BORDE_SEV[h.severidad]}`}>
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                <b className="text-brand-slate">{h.codigo}</b>
                <span className={`rounded border px-1.5 py-0.5 font-semibold ${SEVERIDAD_CLS[h.severidad]}`}>{SEVERIDAD_LABEL[h.severidad]}</span>
                <span className="text-brand-slate">{HALLAZGO_ESTADO_LABEL[h.estado]}</span>
                {h.vendedor && <span className="text-brand-slate">· {h.vendedor}</span>}
              </div>
              <h3 className="font-display text-lg uppercase text-brand-ink leading-tight mt-1">{h.titulo}</h3>
              {h.descripcion && <p className="text-sm text-brand-graphite leading-relaxed mt-1">{h.descripcion}</p>}
              {h.recomendacion && <p className="text-sm mt-1.5"><b>Recomendación:</b> {h.recomendacion}</p>}
              {(h.responsable || h.fecha_compromiso) && (
                <p className="text-xs text-brand-slate mt-1">Responsable: {h.responsable ?? "—"} · Compromiso: {fechaCorta(h.fecha_compromiso)}</p>
              )}
            </article>
          ))}
          {hallazgos.length === 0 && <p className="text-sm text-brand-mist italic">Sin hallazgos vigentes.</p>}
        </div>
        {medias.length > 0 && (
          <div className="mt-5 break-inside-avoid">
            <h3 className="font-display text-lg uppercase text-brand-ink mb-1">Vendedores en alerta media ({n(medias.length)})</h3>
            <p className="text-xs text-brand-slate mb-2">Una línea por vendedor. La descripción, el patrón y la evidencia de cada uno están en el informe extenso.</p>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b-2 border-brand-ink">
                  <th className="py-1.5 pr-2">Cód.</th><th className="py-1.5 pr-2">Vendedor</th><th className="py-1.5 pr-2 text-right">% sin uso</th>
                  <th className="py-1.5 pr-2 text-right">Sin uso</th><th className="py-1.5 pr-2 text-right">SH s/uso</th><th className="py-1.5 pr-2 text-right">Susp.</th>
                  <th className="py-1.5 pr-2">Estado</th><th className="py-1.5">Responsable</th>
                </tr>
              </thead>
              <tbody>
                {medias.map((h) => {
                  const v = h.vendedor ? rk.get(h.vendedor) : undefined;
                  return (
                    <tr key={h.id} className="border-b border-brand-border/70 even:bg-brand-bg/50">
                      <td className="py-1 pr-2 font-semibold text-brand-slate">{h.codigo}</td>
                      <td className="py-1 pr-2 font-semibold">{h.vendedor}</td>
                      <td className="py-1 pr-2 text-right">{v ? pct(v.pct_sin_uso) : "—"}</td>
                      <td className="py-1 pr-2 text-right">{v ? n(v.sin_uso) : "—"}</td>
                      <td className="py-1 pr-2 text-right">{v ? n(v.sali_sin_uso) : "—"}</td>
                      <td className="py-1 pr-2 text-right">{v ? n(v.suspendidas) : "—"}</td>
                      <td className="py-1 pr-2">{HALLAZGO_ESTADO_LABEL[h.estado]}</td>
                      <td className="py-1">{h.responsable ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Bloque>

      {a.graficos.length > 0 && (
        <Bloque num="4" titulo="Gráficos y comentarios del auditor">
          <div className="space-y-4">
            {a.graficos.map((g, i) => (
              <figure key={`${g.key}-${i}`} className="card p-4">
                <figcaption className="font-display text-lg text-brand-ink uppercase mb-2">{g.titulo || tituloGrafico(g.key)}</figcaption>
                <GraficoAuditoria s={s} clave={g.key} alto={260} fijo />
                {g.nota && (
                  <div className="mt-3 rounded-md border-l-4 border-l-brand-cyan bg-brand-cyan/5 px-3 py-2 text-sm text-brand-graphite">
                    <b className="text-[11px] uppercase tracking-wider2 text-brand-cyan">Comentario del auditor · </b>{g.nota}
                  </div>
                )}
              </figure>
            ))}
          </div>
        </Bloque>
      )}

      <Bloque num={a.graficos.length ? "5" : "4"} titulo={`Vendedores críticos (${n(criticos.length)})`}>
        {criticos.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider2 text-white bg-brand-ink">
                <th className="px-3 py-2">Vendedor</th><th className="px-3 py-2 text-right">Netas</th><th className="px-3 py-2 text-right">% sin uso</th>
                <th className="px-3 py-2 text-right">Sin uso</th><th className="px-3 py-2 text-right">En espera</th><th className="px-3 py-2 text-right">Sali Hablando s/uso</th>
              </tr>
            </thead>
            <tbody>
              {criticos.map((v) => (
                <tr key={v.vendedor} className="border-b border-brand-border even:bg-brand-bg/50">
                  <td className="px-3 py-1.5 font-semibold">{v.vendedor}</td><td className="px-3 py-1.5 text-right">{n(v.netas)}</td>
                  <td className="px-3 py-1.5 text-right font-bold text-brand-primary">{pct(v.pct_sin_uso)}</td><td className="px-3 py-1.5 text-right">{n(v.sin_uso)}</td>
                  <td className="px-3 py-1.5 text-right text-brand-slate">{n(v.en_espera ?? 0)}</td><td className="px-3 py-1.5 text-right">{n(v.sali_sin_uso)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm text-brand-slate">Ningún vendedor supera el umbral de crítico.</p>}
        <p className="text-[11px] text-brand-slate mt-2">{n(k.vendedores_atencion)} vendedores más quedan en alerta media: el detalle está en el informe extenso.</p>
      </Bloque>

      <Bloque num={a.graficos.length ? "6" : "5"} titulo="Conclusiones">
        <Texto texto={a.conclusiones} vacio="Sin conclusiones redactadas." />
      </Bloque>
      <Bloque num={a.graficos.length ? "7" : "6"} titulo="Recomendaciones">
        <Texto texto={a.recomendaciones} vacio="Sin recomendaciones redactadas." />
      </Bloque>

      <div className="mt-12 grid grid-cols-2 gap-10 text-sm break-inside-avoid">
        <div className="border-t border-brand-ink pt-2">Auditor: {nombre(a.created_by)}</div>
        <div className="border-t border-brand-ink pt-2">Revisó / aprobó: {a.closed_at ? nombre(a.closed_by) : "______________________"}</div>
      </div>
      <p className="mt-6 text-[10px] text-brand-mist">
        Versión ejecutiva de {a.codigo}. El informe extenso, con todas las detecciones y su evidencia, está disponible en Operaciones Voicenter · Auditoría de Ventas. Datos congelados el {fechaHora(s.generado_en)}.
      </p>
    </div>
  );
}
