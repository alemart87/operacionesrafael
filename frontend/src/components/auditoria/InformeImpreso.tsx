"use client";

import { PrintCover, PrintHeader } from "@/components/PrintButton";
import { Senales } from "@/components/ventas-netas/ui";
import { GraficoAuditoria, tituloGrafico } from "./GraficoAuditoria";
import { NivelBadge, TablaEvidencia } from "./RiesgosView";
import {
  CATEGORIA_LABEL, ESTADO_AUD_LABEL, HALLAZGO_ESTADO_LABEL, SEVERIDAD_LABEL, fechaCorta, fechaHora, n, nombrePeriodo, pct, rangoPeriodos,
  type AuditoriaDetalle,
} from "./tipos";

const MAX_LINEAS_ANEXO = 40;

function Parrafo({ texto, vacio }: { texto: string | null; vacio: string }) {
  if (!texto?.trim()) return <p className="text-sm text-brand-mist italic">{vacio}</p>;
  return <div className="text-sm text-brand-graphite leading-relaxed whitespace-pre-line">{texto}</div>;
}

/** Líneas de evidencia congeladas en el hallazgo (netas sin uso + Sali Hablando). */
function lineasEvidencia(h: AuditoriaDetalle["hallazgos"][number]): number {
  return (h.evidencia?.total ?? h.evidencia?.lineas?.length ?? 0) + (h.evidencia?.sali?.length ?? 0);
}

function Titulo({ num, children }: { num: string; children: React.ReactNode }) {
  return <h2 className="font-display text-2xl text-brand-ink uppercase mt-8 mb-3 flex items-baseline gap-3"><span className="text-brand-primary">{num}</span>{children}</h2>;
}

/**
 * Documento del informe de auditoría, listo para imprimir o guardar como PDF: portada,
 * datos del informe, alcance, resumen ejecutivo, indicadores, datos llamativos,
 * hallazgos (con su evidencia resumida), gráficos elegidos, vendedores riesgosos,
 * conclusiones, recomendaciones y bitácora; con `conEvidencia`, un anexo con las
 * líneas de cada hallazgo. Los gráficos van con ancho fijo para la impresión.
 */
export function InformeImpreso({ a, conEvidencia = false }: { a: AuditoriaDetalle; conEvidencia?: boolean }) {
  const s = a.snapshot;
  const k = s.kpis;
  const nombre = (id: string | null) => (id && a.usuarios[id]) || "—";
  const hallazgos = [...a.hallazgos].sort((x, y) => (x.estado === "descartado" ? 1 : 0) - (y.estado === "descartado" ? 1 : 0) || x.orden - y.orden);
  const periodo = rangoPeriodos(a);

  return (
    <div className="informe-impreso bg-white text-brand-ink">
      <PrintCover titulo={`Informe de auditoría de ventas · ${a.codigo}`} periodo={a.titulo.toLowerCase().includes(periodo.toLowerCase()) ? a.titulo : `${a.titulo} · ${periodo}`} />
      <PrintHeader titulo={`${a.codigo} · ${a.titulo}`} subtitulo={`Auditoría de Ventas · Televentas CLARO · ${periodo} · ${ESTADO_AUD_LABEL[a.status]}`} />

      {/* Encabezado en pantalla (la portada solo sale al imprimir) */}
      <div className="print:hidden border-b border-brand-border pb-4 mb-2">
        <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Informe de auditoría de ventas · {a.codigo}</div>
        <h1 className="font-display text-3xl text-brand-ink uppercase leading-tight">{a.titulo}</h1>
        <div className="text-sm text-brand-slate">{periodo} · {ESTADO_AUD_LABEL[a.status]}</div>
      </div>

      <table className="text-sm mt-4">
        <tbody>
          {[
            ["Código", a.codigo], ["Estado", ESTADO_AUD_LABEL[a.status]], ["Período auditado", periodo],
            ["Fuentes", a.fuentes.map((f) => `${nombrePeriodo(f.periodo)} · corte ${fechaCorta(f.fecha_dato)} · ${f.status === "published" ? "publicado" : f.status === "draft" ? "borrador" : "reemplazado"} · ${n(f.netas)} netas`).join("  |  ")],
            ["Elaborado por", `${nombre(a.created_by)} · ${fechaHora(a.created_at)}`],
            ["Cerrado por", a.closed_at ? `${nombre(a.closed_by)} · ${fechaHora(a.closed_at)}` : "—"],
            ["Datos congelados el", fechaHora(s.generado_en)],
            ...(s.advertencias?.length ? [["Advertencias", s.advertencias.join(" ")]] : []),
          ].map(([l, v]) => (
            <tr key={l as string}><td className="pr-4 py-0.5 text-[11px] uppercase tracking-wider2 text-brand-slate whitespace-nowrap align-top">{l}</td><td className="py-0.5 text-brand-graphite">{v}</td></tr>
          ))}
        </tbody>
      </table>

      <Titulo num="1">Alcance</Titulo>
      <Parrafo texto={a.alcance} vacio="Sin alcance redactado." />

      <Titulo num="2">Resumen ejecutivo</Titulo>
      <Parrafo texto={a.resumen} vacio="Sin resumen redactado." />

      <Titulo num="3">Indicadores clave</Titulo>
      <div className="grid md:grid-cols-4 gap-3">
        {[
          ["Ventas netas", n(k.netas), `${n(k.pospago)} Pospago · ${n(k.gpon)} GPON · ${n(k.iptv)} IPTV`],
          ["Pospago sin uso", pct(k.pct_sin_uso), `${n(k.pospago_sin_uso)} líneas · ${n(k.sin_uso_antiguas)} con 3+ días`],
          ["Sali Hablando sin uso", `${n(k.sali_sin_uso)} · ${pct(k.sali_pct_sin_uso)}`, `${n(k.sali_total)} portaciones`],
          ["Vendedores con riesgo", `${n(k.vendedores_criticos)} · ${n(k.vendedores_atencion)}`, `críticos · atención, de ${n(k.vendedores)}`],
          ["Cargas", n(k.cargas), `${pct(k.pct_finalizacion)} finalizadas · ${n(k.pendientes)} pendientes`],
          ["Riesgo alto sin uso", n(k.sin_uso_riesgo_alto), `de ${n(k.riesgo_alto)} cargas con riesgo A`],
          ["Finalizadas sin activar", n(k.finalizadas_sin_activar), "no figuran en DDI ni PORTABILIDAD"],
          ["Total líneas sin uso", n(k.total_sin_uso), "Pospago netas + Sali Hablando"],
        ].map(([l, v, h]) => (
          <div key={l} className="card p-3">
            <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">{l}</div>
            <div className="font-display text-2xl text-brand-ink">{v}</div>
            <div className="text-[11px] text-brand-slate">{h}</div>
          </div>
        ))}
      </div>

      <Titulo num="4">Datos llamativos</Titulo>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border"><th className="py-1.5 pr-3">Gravedad</th><th className="py-1.5 pr-3">Observación</th><th className="py-1.5 text-right">Cifra</th></tr></thead>
        <tbody>
          {s.llamativos.map((x, i) => (
            <tr key={i} className="border-b border-brand-border/60 align-top">
              <td className="py-1.5 pr-3 font-semibold whitespace-nowrap">{SEVERIDAD_LABEL[x.gravedad]}</td>
              <td className="py-1.5 pr-3"><b>{x.titulo}.</b> {x.detalle}</td>
              <td className="py-1.5 text-right font-display text-lg whitespace-nowrap">{x.cifra}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Titulo num="5">Hallazgos ({n(hallazgos.length)})</Titulo>
      <table className="w-full text-sm mb-4">
        <thead><tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border"><th className="py-1.5 pr-3">Cód.</th><th className="py-1.5 pr-3">Hallazgo</th><th className="py-1.5 pr-3">Severidad</th><th className="py-1.5 pr-3">Estado</th><th className="py-1.5 pr-3">Responsable</th><th className="py-1.5">Compromiso</th></tr></thead>
        <tbody>
          {hallazgos.map((h) => (
            <tr key={h.id} className={`border-b border-brand-border/60 ${h.estado === "descartado" ? "text-brand-mist" : ""}`}>
              <td className="py-1 pr-3 font-semibold">{h.codigo}</td><td className="py-1 pr-3">{h.titulo}</td><td className="py-1 pr-3">{SEVERIDAD_LABEL[h.severidad]}</td>
              <td className="py-1 pr-3">{HALLAZGO_ESTADO_LABEL[h.estado]}</td><td className="py-1 pr-3">{h.responsable ?? "—"}</td><td className="py-1">{fechaCorta(h.fecha_compromiso)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hallazgos.filter((h) => h.estado !== "descartado").map((h) => (
        <section key={h.id} className="card p-4 mb-3">
          <div className="text-[11px] text-brand-slate">{h.codigo} · {SEVERIDAD_LABEL[h.severidad]} · {HALLAZGO_ESTADO_LABEL[h.estado]} · {CATEGORIA_LABEL[h.categoria] ?? h.categoria}{h.vendedor ? ` · ${h.vendedor}` : ""}</div>
          <h3 className="font-display text-lg text-brand-ink uppercase leading-tight">{h.titulo}</h3>
          {h.descripcion && <p className="text-sm text-brand-graphite mt-1 leading-relaxed">{h.descripcion}</p>}
          {h.recomendacion && <p className="text-sm mt-1"><b>Recomendación:</b> {h.recomendacion}</p>}
          <div className="text-xs text-brand-slate mt-1">Responsable: {h.responsable ?? "—"} · Compromiso: {fechaCorta(h.fecha_compromiso)}</div>
          {h.evidencia?.senales && h.evidencia.senales.length > 0 && <div className="mt-1"><Senales senales={h.evidencia.senales} /></div>}
          {lineasEvidencia(h) > 0 && (
            <div className="text-xs text-brand-slate mt-1">
              Evidencia: {n(lineasEvidencia(h))} líneas{h.evidencia.por_vendedor?.length ? ` · por vendedor: ${h.evidencia.por_vendedor.slice(0, 8).map((x) => `${x.vendedor} (${x.total})`).join(", ")}${h.evidencia.por_vendedor.length > 8 ? "…" : ""}` : ""}
              {conEvidencia ? " · detalle en el anexo" : " · detalle disponible en el sistema"}
            </div>
          )}
        </section>
      ))}

      {a.graficos.length > 0 && (
        <>
          <Titulo num="6">Gráficos</Titulo>
          {a.graficos.map((g, i) => (
            <div key={`${g.key}-${i}`} className="card p-4 mb-4">
              <h3 className="font-display text-lg text-brand-ink uppercase mb-2">{g.titulo || tituloGrafico(g.key)}</h3>
              <GraficoAuditoria s={s} clave={g.key} alto={280} fijo />
              {g.nota && <p className="text-sm text-brand-graphite mt-2">{g.nota}</p>}
            </div>
          ))}
        </>
      )}

      <Titulo num={a.graficos.length ? "7" : "6"}>Vendedores riesgosos ({n(s.riesgosos.length)})</Titulo>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
          <th className="py-1.5 pr-2">Nivel</th><th className="py-1.5 pr-2">Vendedor</th><th className="py-1.5 pr-2 text-right">Puntaje</th><th className="py-1.5 pr-2 text-right">Netas</th><th className="py-1.5 pr-2 text-right">Sin uso</th><th className="py-1.5 pr-2 text-right">% uso</th><th className="py-1.5 pr-2 text-right">Sali s/uso</th><th className="py-1.5 pr-2 text-right">Susp.</th><th className="py-1.5">Patrón</th>
        </tr></thead>
        <tbody>
          {s.riesgosos.map((v) => (
            <tr key={v.vendedor} className="border-b border-brand-border/60 align-top">
              <td className="py-1 pr-2"><NivelBadge nivel={v.nivel} /></td><td className="py-1 pr-2 font-semibold">{v.vendedor}</td><td className="py-1 pr-2 text-right">{v.puntaje}</td>
              <td className="py-1 pr-2 text-right">{n(v.netas)}</td><td className="py-1 pr-2 text-right font-semibold">{n(v.sin_uso)}</td><td className="py-1 pr-2 text-right">{v.pospago ? pct(v.pct_uso) : "—"}</td>
              <td className="py-1 pr-2 text-right">{n(v.sali_sin_uso)}</td><td className="py-1 pr-2 text-right">{n(v.suspendidas)}</td><td className="py-1 text-xs">{v.senales.map((x) => x.texto).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Titulo num={a.graficos.length ? "8" : "7"}>Conclusiones</Titulo>
      <Parrafo texto={a.conclusiones} vacio="Sin conclusiones redactadas." />
      <Titulo num={a.graficos.length ? "9" : "8"}>Recomendaciones</Titulo>
      <Parrafo texto={a.recomendaciones} vacio="Sin recomendaciones redactadas." />

      <Titulo num={a.graficos.length ? "10" : "9"}>Seguimiento</Titulo>
      <ul className="text-sm space-y-1">
        {[...a.seguimientos].reverse().map((sg) => (
          <li key={sg.id} className="border-b border-brand-border/60 py-1"><span className="text-[11px] text-brand-slate">{fechaHora(sg.created_at)} · {nombre(sg.created_by)}</span> — {sg.texto}</li>
        ))}
        {a.seguimientos.length === 0 && <li className="text-brand-mist italic">Sin movimientos.</li>}
      </ul>

      <div className="mt-10 grid grid-cols-2 gap-10 text-sm">
        <div className="border-t border-brand-ink pt-2">Auditor: {nombre(a.created_by)}</div>
        <div className="border-t border-brand-ink pt-2">Revisó / aprobó: {a.closed_at ? nombre(a.closed_by) : "______________________"}</div>
      </div>
      {conEvidencia && hallazgos.some((h) => h.estado !== "descartado" && ((h.evidencia?.lineas?.length ?? 0) > 0 || (h.evidencia?.sali?.length ?? 0) > 0)) && (
        <div className="informe-anexo mt-10">
          <Titulo num="A">Anexo · Evidencia por hallazgo</Titulo>
          <p className="text-xs text-brand-slate mb-3">Líneas congeladas al crear el informe. Se listan hasta {MAX_LINEAS_ANEXO} por hallazgo; el resto queda disponible en el sistema.</p>
          {hallazgos.filter((h) => h.estado !== "descartado" && ((h.evidencia?.lineas?.length ?? 0) > 0 || (h.evidencia?.sali?.length ?? 0) > 0)).map((h) => (
            <section key={`anexo-${h.id}`} className="mb-5 tabla-evidencia">
              <h3 className="font-display text-base text-brand-ink uppercase leading-tight mb-1">{h.codigo} · {h.titulo}</h3>
              {h.evidencia?.lineas && h.evidencia.lineas.length > 0 && (
                <>
                  <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mb-1">Líneas sin uso ({n(h.evidencia.total ?? h.evidencia.lineas.length)}{(h.evidencia.total ?? 0) > h.evidencia.lineas.length ? `, se listan ${Math.min(h.evidencia.lineas.length, MAX_LINEAS_ANEXO)}` : h.evidencia.lineas.length > MAX_LINEAS_ANEXO ? `, se listan ${MAX_LINEAS_ANEXO}` : ""})</div>
                  <TablaEvidencia lineas={h.evidencia.lineas.slice(0, MAX_LINEAS_ANEXO)} maxAlto="" />
                </>
              )}
              {h.evidencia?.sali && h.evidencia.sali.length > 0 && (
                <>
                  <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mb-1 mt-2">Sali Hablando ({n(h.evidencia.sali.length)}{h.evidencia.sali.length > MAX_LINEAS_ANEXO ? `, se listan ${MAX_LINEAS_ANEXO}` : ""})</div>
                  <TablaEvidencia lineas={h.evidencia.sali.slice(0, MAX_LINEAS_ANEXO)} maxAlto="" />
                </>
              )}
            </section>
          ))}
        </div>
      )}
      <div className="mt-6 text-[10px] text-brand-mist">Informe generado por Operaciones Voicenter · Auditoría de Ventas · Televentas CLARO · Datos congelados el {fechaHora(s.generado_en)}. Parámetros: umbral de uso {s.parametros?.umbral_uso_pct}% con mínimo {s.parametros?.min_lineas_alerta} líneas; sin uso antigua a partir de {s.parametros?.dias_sin_uso_antigua} días.</div>
    </div>
  );
}
