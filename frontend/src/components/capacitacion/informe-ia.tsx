"use client";

/**
 * El informe de la IA sobre el postulante, para el capacitador y el mentor: lee el IPV con su baremo y los
 * entrenamientos evaluados (las prácticas guiadas no suman) y propone fortalezas, qué desarrollar y un plan. Se pide con
 * un botón, se arma en segundo plano (la tarjeta se actualiza sola) y queda guardado; si después hay datos nuevos, avisa
 * que está desactualizado. Es una sugerencia: la decisión es del equipo.
 */
import { ChevronDown, ChevronUp, RefreshCw, ShieldAlert, Sparkles, Target, Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Boton, Fallo, cx, hace } from "@/components/portal/ui";
import { apiFetch } from "@/lib/api";
import { CAP_API, SUGERENCIA_IA, type InformeIA, type VistaInformeIA } from "./tipos";

const RESPONSABLE = { capacitador: "Capacitador", mentor: "Mentor", postulante: "Postulante" } as const;

function Sugerencia({ inf }: { inf: InformeIA }) {
  const c = inf.contenido!;
  const s = SUGERENCIA_IA[c.sugerencia];
  return (
    <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold text-white" style={{ background: s.color }}>{s.nombre}</span>
      {inf.referencia !== c.sugerencia && (
        <span className="text-[12px] text-brand-slate">Según el baremo: {inf.referencia_nombre.toLowerCase()} (la IA explica por qué se aparta)</span>
      )}
    </div>
  );
}

function Contenido({ inf, completo }: { inf: InformeIA; completo: boolean }) {
  const c = inf.contenido!;
  return (
    <div className="space-y-3">
      <h3 className="text-[18px] leading-snug font-semibold text-brand-ink">{c.titular}</h3>
      <Sugerencia inf={inf} />
      <p className="text-[15px] text-brand-ink leading-snug">{c.resumen}</p>
      {completo && (
        <>
          <div className="grid md:grid-cols-3 gap-2.5">
            {([["Perfil IPV", c.perfil_ipv], ["En los entrenamientos", c.desempeno], ["IPV y entrenamientos", c.coherencia]] as const).map(([t, x]) => x && (
              <div key={t} className="rounded-lg bg-brand-bg-soft border border-brand-border px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate">{t}</div>
                <p className="text-[14px] text-brand-ink leading-snug mt-0.5">{x}</p>
              </div>
            ))}
          </div>
          {(c.fortalezas.length > 0 || c.a_desarrollar.length > 0) && (
            <div className="grid sm:grid-cols-2 gap-2.5">
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wider2 font-semibold text-emerald-800 flex items-center gap-1"><Sparkles size={13} aria-hidden /> Fortalezas</div>
                <ul className="mt-1 space-y-1">{c.fortalezas.map((x) => <li key={x} className="text-[14px] text-brand-ink flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-emerald-700" aria-hidden />{x}</li>)}</ul>
              </div>
              <div className="rounded-lg bg-brand-primary-light/60 border border-brand-primary/20 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-primary-dark flex items-center gap-1"><Target size={13} aria-hidden /> A desarrollar</div>
                <ul className="mt-1 space-y-1">{c.a_desarrollar.map((x) => <li key={x} className="text-[14px] text-brand-ink flex gap-2"><Target size={15} className="mt-0.5 shrink-0 text-brand-primary" aria-hidden />{x}</li>)}</ul>
              </div>
            </div>
          )}
          {c.plan.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate mb-1.5">Plan de las próximas dos semanas</div>
              <ol className="space-y-1.5">
                {c.plan.map((x, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[14px] text-brand-ink">
                    <span className="w-6 h-6 rounded-full bg-brand-ink text-white text-[12px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                    <span className="flex-1 leading-snug">{x.accion} <span className="text-[12px] font-semibold text-brand-slate whitespace-nowrap">· {RESPONSABLE[x.responsable]}</span></span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {c.justificacion && <p className="text-[14px] text-brand-ink leading-snug"><b className="font-semibold">Por qué:</b> {c.justificacion}</p>}
          {c.alertas.length > 0 && (
            <div className="rounded-lg border border-brand-orange/40 bg-brand-orange/10 px-3 py-2.5 text-[13px] text-[#8A5200] space-y-1">
              {c.alertas.map((x) => <p key={x} className="flex gap-2"><ShieldAlert size={15} className="shrink-0 mt-0.5" aria-hidden />{x}</p>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Base({ inf }: { inf: InformeIA }) {
  const b = inf.basado_en;
  const partes = [b.ipv ? "el IPV" : "sin IPV", b.conversaciones === 1 ? "1 conversación evaluada" : `${b.conversaciones} conversaciones evaluadas`,
    b.practicas ? `${b.practicas} práctica${b.practicas === 1 ? "" : "s"} guiada${b.practicas === 1 ? "" : "s"} (aparte)` : null,
    b.comentarios ? `${b.comentarios} comentario${b.comentarios === 1 ? "" : "s"} del equipo` : null].filter(Boolean);
  return (
    <p className="text-[11px] text-brand-mist leading-snug">
      Redactado por la IA {hace(inf.generado_at ?? inf.created_at)} a pedido de {inf.pedido_por}, con {partes.join(", ")}.
      Es una sugerencia: la decisión es del equipo.
    </p>
  );
}

export function InformeIAFicha({ pid }: { pid: string }) {
  const [v, setV] = useState<VistaInformeIA | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [completo, setCompleto] = useState(false);
  const url = `${CAP_API}/postulantes/${pid}/informe-ia`;
  const cargar = useCallback(() => apiFetch<VistaInformeIA>(url).then((x) => { setV(x); setError(null); }).catch((e) => setError(e.message)), [url]);
  useEffect(() => { cargar(); }, [cargar]);
  const generando = v?.informe?.estado === "generando";
  // Mientras la IA lo arma, la tarjeta se consulta sola.
  useEffect(() => {
    if (!generando) return;
    const t = setTimeout(cargar, 3000);
    return () => clearTimeout(t);
  }, [generando, v, cargar]);
  const pedir = async () => {
    setPidiendo(true); setError(null);
    try { setV(await apiFetch<VistaInformeIA>(url, { method: "POST" })); } catch (e: any) { setError(e.message); } finally { setPidiendo(false); }
  };

  if (!v) return error ? <Fallo onReintentar={cargar}>{error}</Fallo> : <div className="h-28 rounded-xl bg-brand-bg animate-pulse" />;
  const inf = v.informe;
  const listo = inf?.estado === "listo" ? inf : v.anterior?.estado === "listo" ? v.anterior : null;
  const boton = (texto: string, tipo: "primario" | "secundario" = "primario") => (
    <Boton tipo={tipo} icono={tipo === "primario" ? Sparkles : RefreshCw} onClick={pedir} ocupado={pidiendo} disabled={!v.disponible || generando}
      className="sm:!w-auto !min-h-[44px]">{texto}</Boton>
  );

  return (
    <div className="card p-4 space-y-3">
      {error && <Fallo>{error}</Fallo>}
      {!inf && (
        <div className="space-y-3">
          <p className="text-[14px] text-brand-ink leading-snug">
            La IA lee el IPV con su baremo y los resultados de los entrenamientos evaluados, y arma un informe con fortalezas, qué desarrollar,
            un plan y una sugerencia. La decisión es siempre del equipo.
          </p>
          {v.hay_datos ? boton("Generar informe") : <p className="text-[13px] text-brand-slate">Se puede generar cuando termine el IPV o tenga algún entrenamiento evaluado.</p>}
          {!v.disponible && <p className="text-[12px] text-brand-slate">La IA de capacitación no está activa ahora.</p>}
        </div>
      )}
      {generando && (
        <div role="status" className="rounded-lg border border-brand-border bg-brand-bg-soft px-3 py-3 flex items-center gap-3">
          <RefreshCw size={18} className="animate-spin text-brand-slate shrink-0" aria-hidden />
          <span className="text-[14px] text-brand-ink">La IA está leyendo el IPV y los entrenamientos… tarda unos segundos.</span>
        </div>
      )}
      {inf?.estado === "error" && (
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-[14px] text-brand-primary-dark flex-1">No se pudo generar el informe{inf.error ? ` (${inf.error})` : ""}.</p>
          {boton("Reintentar", "secundario")}
        </div>
      )}
      {listo && (
        <>
          {listo !== inf && !generando && <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate">Informe anterior</div>}
          {listo.desactualizado && !generando && (
            <div className="rounded-lg border border-[#2A78D6]/30 bg-[#2A78D6]/[0.07] px-3 py-2.5 flex items-center gap-3 flex-wrap">
              <span className="text-[13px] text-[#1D5BA6] flex-1 min-w-[180px]">Hay datos nuevos desde este informe (entrenamientos, IPV o comentarios).</span>
              {boton("Actualizar", "secundario")}
            </div>
          )}
          <Contenido inf={listo} completo={completo} />
          <button type="button" onClick={() => setCompleto(!completo)} aria-expanded={completo}
            className="w-full min-h-[44px] rounded-lg border border-brand-border text-[14px] font-semibold text-brand-ink inline-flex items-center justify-center gap-1.5 hover:border-brand-ink">
            {completo ? <>Ver menos <ChevronUp size={16} aria-hidden /></> : <>Ver el informe completo <ChevronDown size={16} aria-hidden /></>}
          </button>
          <Base inf={listo} />
        </>
      )}
      <p className={cx("text-[11px] text-brand-mist", listo && "hidden")}>Lo ven el capacitador, los mentores del grupo y la gestión. Sale también en el PDF de la ficha.</p>
    </div>
  );
}
