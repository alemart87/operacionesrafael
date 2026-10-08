"use client";

import { Clock, MessageSquare, PhoneOutgoing, RefreshCw, Trash2, Upload, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PrintButton, PrintHeader } from "@/components/PrintButton";
import { CurvasTramos, MapaContacto, SinTramos } from "@/components/productividad/Graficos";
import { usePublicar } from "@/components/productividad/PublicarDialog";
import { TablaAgentes, type FiltroBanda } from "@/components/productividad/TablaAgentes";
import {
  AlertasLista, AvisoContacto, Avisos, ComparacionModos, ContactoCard, DistribucionTiempo, Indicador, JornadaTurnos,
  MetaConversacion, RankingEfectividad,
} from "@/components/productividad/ui";
import {
  PROD_API, PROD_HREF, medida, fechaHora, fechaLarga, horas, n, pct, segundos, type Banda, type Corte, type InformeDetalle,
} from "@/components/productividad/tipos";
import { EstadoBadge, Tabs } from "@/components/ventas-netas/ui";
import { apiFetch } from "@/lib/api";
import { PERM_PRODUCTIVIDAD_GESTION } from "@/lib/operativas";

type Vista = "resumen" | "agentes" | "horario" | "cortes";

export default function InformeProductividadPage() {
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
  const gestion = can(PERM_PRODUCTIVIDAD_GESTION);
  const [r, setR] = useState<InformeDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("resumen");
  const [filtro, setFiltro] = useState<FiltroBanda>(null);
  const [orden, setOrden] = useState<{ k: "pct_contacto"; dir: "desc" } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aBorrar, setABorrar] = useState<Corte | null>(null);

  const load = useCallback(async () => {
    try { setR(await apiFetch<InformeDetalle>(`${PROD_API}/informes/${id}`)); } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const { publicar, dialogo, loading: publicando, error: errorPublicar } = usePublicar(load);

  const verBanda = (b: Banda) => { setFiltro(b); setOrden(null); setVista("agentes"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const verRanking = () => { setFiltro(null); setOrden({ k: "pct_contacto", dir: "desc" }); setVista("agentes"); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const recalcular = async () => {
    setOcupado(true);
    try {
      const res = await apiFetch<{ informe: { id: string }; nuevo_borrador: boolean }>(`${PROD_API}/informes/${id}/recalcular`, { method: "POST" });
      if (res.informe.id !== id) router.push(`${PROD_HREF}/informes/${res.informe.id}`);
      else await load();
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };

  const borrarCorte = async () => {
    if (!aBorrar) return;
    setOcupado(true);
    try {
      const res = await apiFetch<{ informe: { id: string } | null }>(`${PROD_API}/cortes/${aBorrar.id}`, { method: "DELETE" });
      setABorrar(null);
      if (res.informe && res.informe.id !== id) router.push(`${PROD_HREF}/informes/${res.informe.id}`);
      else if (!res.informe && r?.status === "draft") router.push(PROD_HREF);
      else await load();
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };

  if (error) return <div className="card p-8 text-brand-primary">{error}</div>;
  if (!r) return <div className="card p-10 text-brand-slate">Cargando…</div>;

  const d = r.data;
  const k = d.kpis;
  const p = d.parametros;
  const titulo = `Productividad de llamadas · ${fechaLarga(r.fecha)}`;
  const nombre = (uid: string | null) => (uid && r.usuarios[uid]) || "—";
  const med = medida(d.contacto);

  return (
    <>
      <PrintHeader titulo={titulo} subtitulo={`Corte final ${d.corte_final} · ${n(d.cortes.length)} corte(s)`} />
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap print:hidden">
        <div>
          <Link href={PROD_HREF} className="text-xs text-brand-slate hover:text-brand-primary">← Informes diarios</Link>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <h1 className="font-display text-3xl text-brand-ink uppercase leading-tight">{fechaLarga(r.fecha)}</h1>
            <EstadoBadge estado={r.status} />
          </div>
          <p className="text-sm text-brand-slate mt-1">
            Productividad de llamadas · datos hasta las <b>{d.corte_final}</b> ({n(d.cortes.length)} corte{d.cortes.length === 1 ? "" : "s"})
            {r.status === "published" && <> · publicado por {nombre(r.published_by)} el {fechaHora(r.published_at)}</>}
            {r.status === "draft" && <> · borrador: <span className="text-brand-cyan">solo lo ve gestión hasta que se publique</span></>}
            {r.status === "replaced" && <> · reemplazado el {fechaHora(r.replaced_at)}: <span className="text-brand-primary">este informe ya no vale</span></>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <PrintButton label="Imprimir" />
          {gestion && (
            <button onClick={recalcular} disabled={ocupado} className="btn-ghost text-xs" title="Rehacer el día con sus cortes y las metas vigentes">
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
        {(errorPublicar) && <div className="card p-4 text-brand-primary">{errorPublicar}</div>}
        {gestion && r.parametros_distintos && (
          <div className="rounded-md border border-brand-cyan/40 bg-brand-cyan/5 p-3 text-sm text-brand-graphite flex items-center justify-between gap-3 flex-wrap">
            <span>Este informe se generó con metas distintas a las vigentes (meta {p.meta_min}–{p.meta_max}%, contacto desde {p.contacto_desde_seg} s).
              {r.status === "draft" ? " Recalculalo para aplicarlas." : " Al recalcular se genera un borrador del día con las metas vigentes."}</span>
            <button onClick={recalcular} disabled={ocupado} className="btn-secondary text-xs px-3 py-2"><RefreshCw size={14} /> Recalcular</button>
          </div>
        )}
        {gestion && !!r.cortes_nuevos && r.status !== "draft" && (
          <div className="rounded-md border border-brand-orange/40 bg-brand-orange/10 p-3 text-sm text-brand-graphite flex items-center justify-between gap-3 flex-wrap">
            <span>El día tiene <b>{n(r.cortes_nuevos)} corte(s)</b> que este informe no incluye. Están en el borrador del día: revisalo y publicalo.</span>
            <button onClick={recalcular} disabled={ocupado} className="btn-secondary text-xs px-3 py-2">Ir al borrador del día</button>
          </div>
        )}
        <AvisoContacto contacto={d.contacto} />
        <Avisos avisos={d.avisos} excluir={d.contacto.mensaje} />
      </div>

      <Tabs<Vista>
        value={vista}
        onChange={(v) => { setVista(v); if (v !== "agentes") setOrden(null); }}
        items={[
          { value: "resumen", label: "Resumen gerencial", hint: "Meta · contacto · jornada" },
          { value: "agentes", label: "Agentes", hint: `${n(d.agentes.length)} conectados · ranking` },
          { value: "horario", label: "Por horario", hint: d.tramos.length ? `${n(d.tramos.length)} tramos · curvas` : "Necesita varios cortes" },
          ...(gestion ? [{ value: "cortes" as Vista, label: "Cortes del día", hint: `${n(r.cortes_del_dia?.length ?? d.cortes.length)} archivo(s)` }] : []),
        ]}
      />

      {vista === "resumen" && (
        <div className="space-y-5">
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Indicador titulo="Agentes conectados" valor={n(k.agentes)} icono={<Users size={16} />} borde="border-l-brand-ink"
              detalle={<>{n(k.agentes_validos)} con jornada válida{k.dias_sesion_abierta ? <> · <b className="text-brand-primary-dark">{n(k.dias_sesion_abierta)} sesión(es) abierta(s)</b></> : null}</>} />
            <Indicador titulo="Llamadas del día" valor={n(k.llamadas)} icono={<PhoneOutgoing size={16} />} borde="border-l-brand-cyan"
              detalle={med.exacto ? <>{n(k.atendidas)} contactos (≥ {med.regla} s) · {pct(k.pct_contacto)}</>
                : <>{(k.llamadas_hora ?? 0).toLocaleString("es-PY")} por hora conectada</>} />
            <Indicador titulo="Tiempo de conversación" valor={horas(k.conversacion)} icono={<MessageSquare size={16} />} borde="border-l-brand-purple"
              detalle={<>Total del equipo en el día</>} />
            <Indicador titulo="Promedio de conversación" valor={segundos(k.prom_conversacion)} icono={<Clock size={16} />} borde="border-l-brand-orange"
              detalle={<>Por llamada · AHT {segundos(k.aht)}</>} />
          </div>

          <div className="grid lg:grid-cols-3 gap-5">
            <MetaConversacion r={k} agentes={d.agentes} p={p} onVerBanda={verBanda} />
            <ContactoCard r={k} contacto={d.contacto} mejor={d.tramo_mejor} peor={d.tramo_peor} onVerHorario={d.tramos.length ? () => setVista("horario") : undefined} />
          </div>

          <div className="grid lg:grid-cols-3 gap-5">
            <JornadaTurnos r={k} turnos={d.turnos} />
            <div className="lg:col-span-2 min-w-0"><DistribucionTiempo r={k} /></div>
          </div>

          <div className="grid xl:grid-cols-2 gap-5">
            <ComparacionModos modos={d.modos} contacto={d.contacto} />
            <RankingEfectividad agentes={d.agentes} p={p} contacto={d.contacto} onVerTodo={verRanking} onAgente={() => verRanking()} />
          </div>

          <AlertasLista alertas={d.alertas} p={p} />
          {d.sin_conexion.length > 0 && (
            <p className="text-[11px] text-brand-mist">{n(d.sin_conexion.length)} usuario(s) de la plataforma no se conectaron este día.</p>
          )}
        </div>
      )}

      {vista === "agentes" && (
        <section className="card p-5">
          <TablaAgentes agentes={d.agentes} p={p} contacto={d.contacto} filtro={filtro} onFiltro={setFiltro}
            archivo={`productividad_${r.fecha}.csv`} ordenInicial={orden} />
        </section>
      )}

      {vista === "horario" && (d.tramos.length ? (
        <div className="space-y-5">
          <CurvasTramos tramos={d.tramos} p={p} contacto={d.contacto} promedioContacto={k.pct_contacto} mejor={d.tramo_mejor} peor={d.tramo_peor} />
          <MapaContacto agentes={d.agentes} tramos={d.tramos} p={p} contacto={d.contacto} />
        </div>
      ) : <SinTramos cortes={d.cortes.length} />)}

      {vista === "cortes" && gestion && (
        <section className="card p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
            <div>
              <h2 className="font-display text-lg uppercase text-brand-ink leading-tight">Cortes del día</h2>
              <p className="text-xs text-brand-slate mt-0.5">Cada archivo es un corte acumulado desde las 00:00. Eliminar uno rehace el borrador del día.</p>
            </div>
            <Link href={`${PROD_HREF}/subir`} className="btn-secondary text-xs px-3 py-2"><Upload size={14} /> Subir más cortes</Link>
          </div>
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
                  <th className="py-2 pr-3">Hora</th>
                  <th className="py-2 px-3">Archivo</th>
                  <th className="py-2 px-3 text-right">Agentes</th>
                  <th className="py-2 px-3 text-right">Llamadas acumuladas</th>
                  <th className="py-2 px-3">Cortas</th>
                  <th className="py-2 px-3">Subido</th>
                  <th className="py-2 pl-3 text-right" />
                </tr>
              </thead>
              <tbody>
                {(r.cortes_del_dia ?? []).map((c) => {
                  const enEste = d.cortes.some((x) => x.id === c.id);
                  return (
                    <tr key={c.id} className="border-b border-brand-border/60 last:border-0">
                      <td className="py-2 pr-3 font-semibold text-brand-ink tabular-nums">{c.hora}{c.hora_origen === "manual" && <span className="ml-1.5 text-[10px] font-normal text-brand-slate">(manual)</span>}</td>
                      <td className="py-2 px-3 text-xs text-brand-slate break-all">{c.archivo ?? "—"}{!enEste && <span className="ml-1.5 badge-orange">no incluido</span>}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{n(c.agentes)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{n(c.llamadas)}</td>
                      <td className="py-2 px-3 text-xs">{c.umbrales_cortas.length ? `menos de ${c.umbrales_cortas.join(" / ")} s` : "—"}</td>
                      <td className="py-2 px-3 text-xs text-brand-slate">{nombre(c.uploaded_by)}<br />{fechaHora(c.uploaded_at)}</td>
                      <td className="py-2 pl-3 text-right">
                        <button onClick={() => setABorrar(c)} disabled={ocupado} className="text-brand-slate hover:text-brand-primary" aria-label="Eliminar corte"><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {dialogo}
      <ConfirmDialog
        open={!!aBorrar}
        variant="danger"
        title="Eliminar corte"
        confirmLabel="Eliminar"
        loading={ocupado}
        message={aBorrar && <>Se elimina el corte de las <b>{aBorrar.hora}</b> del {fechaLarga(aBorrar.fecha)} y se rehace el borrador del día con los cortes que quedan. Un informe ya publicado no cambia hasta que publiques el borrador.</>}
        onCancel={() => setABorrar(null)}
        onConfirm={borrarCorte}
      />
    </>
  );
}
