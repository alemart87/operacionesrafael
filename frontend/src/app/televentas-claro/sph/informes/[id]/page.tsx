"use client";

import { CheckCircle2, Clock, Gauge, Info, Receipt, RefreshCw, Users, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { PrintButton, PrintHeader } from "@/components/PrintButton";
import { Procesando } from "@/components/Procesando";
import { ESTADO_LABEL, fechaCorta, fechaHora, n, nombreMes, pct } from "@/components/productividad/tipos";
import { Indicador } from "@/components/productividad/ui";
import { usePublicarSph } from "@/components/sph/PublicarSph";
import { RankingSph } from "@/components/sph/RankingSph";
import { SerieSph } from "@/components/sph/SerieSph";
import { TablaAsesores, type FiltroAsesor } from "@/components/sph/TablaAsesores";
import {
  SPH_API, SPH_HREF, TIPO_LABEL, etiquetaPeriodo, fmtHoras, fmtProductos, fmtSph, normalizar, type InformeSphDetalle,
} from "@/components/sph/tipos";
import { CruceNombres, MetodoSph, VentasSinAsesor } from "@/components/sph/ui";
import { VincularDialog, type Objetivo } from "@/components/sph/VincularDialog";
import { EstadoBadge, Tabs } from "@/components/ventas-netas/ui";
import { apiFetch } from "@/lib/api";
import { PERM_SPH_GESTION } from "@/lib/operativas";

type Vista = "resumen" | "asesores";

export default function InformeSphPage() {
  return (
    <AppShell>
      <Informe />
    </AppShell>
  );
}

function Informe() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const gestion = can(PERM_SPH_GESTION);
  const [r, setR] = useState<InformeSphDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("resumen");
  const [filtro, setFiltro] = useState<FiltroAsesor>("todos");
  const [objetivo, setObjetivo] = useState<Objetivo | null>(null);
  const [proceso, setProceso] = useState<string | null>(null); // texto de la pantalla «Procesando»
  const [listo, setListo] = useState(false);
  const [calculado, setCalculado] = useState(false); // llegó desde «Calcular SPH»

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("calculado") !== "1") return;
    setCalculado(true);
    window.history.replaceState(null, "", window.location.pathname); // al recargar no vuelve a aparecer
  }, []);

  const load = useCallback(async () => {
    try { setR(await apiFetch<InformeSphDetalle>(`${SPH_API}/informes/${id}`)); } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const { publicar, dialogo, loading: publicando, error: errorPublicar } = usePublicarSph(load);

  /** Rehace el SPH del día. Un publicado no cambia: se abre el borrador nuevo. */
  const recalcular = async (texto = "Recalculando el SPH con los datos actuales…") => {
    setError(null);
    setListo(false);
    setProceso(texto);
    try {
      const res = await apiFetch<{ informe: { id: string }; nuevo_borrador: boolean }>(`${SPH_API}/informes/${id}/recalcular`, { method: "POST" });
      if (res.informe.id !== id) {
        setListo(true);
        router.push(`${SPH_HREF}/informes/${res.informe.id}?calculado=1`);
        return;
      }
      await load();
    } catch (e: any) {
      setError(e.message);
    }
    setProceso(null);
  };

  const verAsesores = (f: FiltroAsesor) => { setFiltro(f); setVista("asesores"); window.scrollTo({ top: 0, behavior: "smooth" }); };

  if (error && !r) return <div className="card p-8 text-brand-primary">{error}</div>;
  if (!r) return <div className="card p-10 text-brand-slate">Cargando…</div>;

  const d = normalizar(r.data);
  const k = d.kpis;
  const f = d.fuentes;
  const periodo = r.tipo !== "dia";
  const prod = f.productividad[0];
  // La planilla del mes del último día; las del mes siguiente traen lo vendido a fin de mes que se activó después.
  const mesHasta = r.hasta.slice(0, 7);
  const ventas = [...f.ventas].reverse().find((v) => v.periodo <= mesHasta) ?? f.ventas[f.ventas.length - 1];
  const siguientes = f.ventas.filter((v) => v.periodo > mesHasta);
  const nombre = (uid: string | null) => (uid && r.usuarios[uid]) || "—";
  const etiqueta = etiquetaPeriodo(r.desde, r.hasta, r.tipo);
  const titulo = `SPH estimado · ${etiqueta}`;
  const borradores = f.productividad.filter((x) => x.status !== "published").length;

  return (
    <>
      <PrintHeader titulo={titulo} subtitulo={periodo
        ? `${k.dias_cubiertos} de ${k.dias} días cuentan · ventas al corte del ${fechaCorta(ventas?.fecha_dato)}`
        : `Ventas al corte del ${fechaCorta(ventas?.fecha_dato)} · horas hasta las ${prod?.corte_final ?? "—"}`} />
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap print:hidden">
        <div>
          <Link href={SPH_HREF} className="text-xs text-brand-slate hover:text-brand-primary">← SPH estimado</Link>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <h1 className="font-display text-3xl text-brand-ink uppercase leading-tight">{etiqueta}</h1>
            {periodo && <span className="badge-neutral">{TIPO_LABEL[r.tipo]}</span>}
            <EstadoBadge estado={r.status} />
          </div>
          <p className="text-sm text-brand-slate mt-1">
            {periodo ? (
              <>SPH estimado · <b>{n(k.dias_cubiertos)} de {n(k.dias)} días</b> cuentan ({n(f.productividad.length)} informe(s) de Productividad{borradores ? `, ${borradores} en borrador` : ""})</>
            ) : (
              <>SPH estimado · horas de Productividad hasta las <b>{prod?.corte_final ?? "—"}</b> ({prod ? ESTADO_LABEL[prod.status].toLowerCase() : "—"})</>
            )}
            {ventas && <>{" "}· ventas al corte del <b className="capitalize">{fechaCorta(ventas.fecha_dato)}</b> ({ESTADO_LABEL[ventas.status].toLowerCase()})</>}
            {siguientes.map((v) => (
              <span key={v.id}>{" "}· más lo activado en {nombreMes(v.periodo).toLowerCase()} (corte del {fechaCorta(v.fecha_dato)})</span>
            ))}
            {r.status === "published" && <> · publicado por {nombre(r.published_by)} el {fechaHora(r.published_at)}</>}
            {r.status === "draft" && <> · borrador: <span className="text-brand-cyan">solo lo ve gestión hasta que se publique</span></>}
            {r.status === "replaced" && <> · reemplazado el {fechaHora(r.replaced_at)}: <span className="text-brand-primary">ya no vale</span></>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <PrintButton label="Imprimir" />
          {gestion && (
            <button onClick={() => recalcular()} disabled={!!proceso} className="btn-ghost text-xs" title="Rehacerlo con los informes y los vínculos vigentes">
              <RefreshCw size={14} /> Recalcular
            </button>
          )}
          {gestion && r.status !== "published" && (
            <button onClick={() => publicar(r)} disabled={publicando} className="btn-primary">
              {publicando ? "Publicando…" : r.status === "replaced" ? "Volver a publicar" : "Publicar"}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 mb-5 print:hidden">
        {calculado && (
          <div role="status" className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-brand-graphite flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
              <span>
                SPH calculado.{r.status === "draft" && " Es un borrador: revisá los vínculos probables y los asesores sin vínculo, y publicalo."}
              </span>
            </div>
            <button type="button" aria-label="Cerrar aviso" onClick={() => setCalculado(false)} className="text-brand-slate hover:text-brand-ink shrink-0"><X size={16} /></button>
          </div>
        )}
        {(error || errorPublicar) && <div className="card p-4 text-brand-primary">{error || errorPublicar}</div>}
        {gestion && !!r.fuentes_nuevas?.length && (
          <div className="rounded-md border border-brand-orange/40 bg-brand-orange/10 p-3 text-sm text-brand-graphite flex items-center justify-between gap-3 flex-wrap">
            <span>Hay datos más nuevos de <b>{r.fuentes_nuevas.join(" y ")}</b> que los usados en este cálculo.
              {r.status === "draft" ? " Recalculalo para usarlos." : " Al recalcular se genera un borrador nuevo con esos datos."}</span>
            <button onClick={() => recalcular()} disabled={!!proceso} className="btn-secondary text-xs px-3 py-2"><RefreshCw size={14} /> Recalcular</button>
          </div>
        )}
        {d.avisos.length > 0 && (
          <div className="rounded-md border border-brand-border bg-white p-3 text-xs text-brand-slate">
            <div className="flex items-center gap-2 font-semibold text-brand-graphite"><Info size={14} /> Notas del cálculo</div>
            <ul className="mt-1.5 space-y-1 list-disc pl-6">{d.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </div>
        )}
      </div>

      <Tabs<Vista>
        value={vista}
        onChange={setVista}
        items={[
          { value: "resumen", label: "Resumen gerencial", hint: "SPH · ranking · cruce" },
          { value: "asesores", label: "Asesores", hint: `${n(k.agentes)} ${periodo ? "en el período" : "conectados"} · vínculos` },
        ]}
      />

      {vista === "resumen" && (
        <div className="space-y-5">
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Indicador titulo="SPH de la operación" valor={fmtSph(k.sph)} icono={<Gauge size={16} />} borde="border-l-brand-cyan"
              detalle={<>{n(k.netas_operacion)} netas ÷ {fmtHoras(k.horas)} conectadas{k.sph_vinculados !== null && <> · asesores vinculados: <b>{fmtSph(k.sph_vinculados)}</b></>}</>} />
            <Indicador titulo={periodo ? "Netas del período" : "Netas del día"} valor={n(k.netas)} icono={<Receipt size={16} />} borde="border-l-brand-ink"
              detalle={<>{fmtProductos(k.productos) || "Sin netas"}{k.pct_activadas !== null && <> · {pct(k.pct_activadas)} de las {n(k.cargadas)} cargadas ya activó</>}</>} />
            <Indicador titulo="Horas conectadas" valor={fmtHoras(k.horas)} icono={<Clock size={16} />} borde="border-l-brand-purple"
              detalle={<>{periodo ? <>{n(k.agentes)} agentes · {k.agentes_por_dia.toLocaleString("es-PY")} por día</> : <>{n(k.agentes_validos)} agentes con jornada válida</>}
                {k.sesiones_abiertas ? <> · <b className="text-brand-primary-dark">{n(k.sesiones_abiertas)} {periodo ? "jornada(s)" : "sesión(es)"} con sesión abierta fuera</b></> : null}</>} />
            <Indicador titulo="Asesores vinculados" valor={<>{n(k.vinculados)}<span className="text-lg text-brand-slate"> / {n(k.agentes)}</span></>} icono={<Users size={16} />}
              borde="border-l-brand-orange" onClick={() => verAsesores("vinculados")} cta="Ver asesores"
              detalle={<>{pct(k.pct_cobertura)} de las netas con asesor · {n(k.niveles.probable ?? 0)} vínculo(s) probable(s)</>} />
          </div>

          {periodo && <SerieSph serie={d.serie} sph={k.sph} desde={r.desde} hasta={r.hasta} cobertura={d.cobertura} />}

          <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
            <RankingSph agentes={d.agentes} promedio={k.sph_vinculados} minHoras={d.parametros.min_horas_ranking} />
            <div className="space-y-5 min-w-0">
              <CruceNombres k={k} onVer={(nivel) => verAsesores(nivel === "sin_vinculo" ? "sin_vinculo" : nivel === "probable" ? "probable" : "vinculados")} />
              <VentasSinAsesor ventas={d.ventas_sin_agente} periodo={periodo} onVincular={gestion ? (v) => setObjetivo({ tipo: "vendedor", venta: v }) : undefined} />
            </div>
          </div>

          <MetodoSph minHoras={d.parametros.min_horas_ranking} />
        </div>
      )}

      {vista === "asesores" && (
        <section className="card p-5">
          <TablaAsesores agentes={d.agentes} filtro={filtro} onFiltro={setFiltro} periodo={periodo}
            archivo={periodo ? `sph_${r.desde}_${r.hasta}.csv` : `sph_${r.desde}.csv`}
            minHoras={d.parametros.min_horas_ranking} onVincular={gestion ? (a) => setObjetivo({ tipo: "agente", agente: a }) : undefined} />
        </section>
      )}

      {dialogo}
      <VincularDialog objetivo={objetivo} agentes={d.agentes} vendedores={d.vendedores} manual={r.vinculos ?? {}}
        onCerrar={() => setObjetivo(null)}
        onGuardado={async () => { setObjetivo(null); await recalcular("Guardando el vínculo y recalculando el SPH…"); }} />
      <Procesando abierto={!!proceso} titulo="Procesando" listo={listo} detalle={listo ? "Abriendo el borrador nuevo…" : proceso} />
    </>
  );
}
