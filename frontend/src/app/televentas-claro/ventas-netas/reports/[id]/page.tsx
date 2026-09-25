"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { PrintButton, PrintHeader } from "@/components/PrintButton";
import { usePublicar } from "@/components/ventas-netas/PublicarDialog";
import { VisionNegocio } from "@/components/ventas-netas/VisionNegocio";
import { VisionOperativa } from "@/components/ventas-netas/VisionOperativa";
import { VisionProductividad } from "@/components/ventas-netas/VisionProductividad";
import { EstadoBadge, Tabs } from "@/components/ventas-netas/ui";
import { VERSION_ANALISIS, VN_API, VN_HREF, fechaCorta, fechaHora, nombrePeriodo, type InformeDetalle } from "@/components/ventas-netas/tipos";
import { apiFetch, downloadFile } from "@/lib/api";
import { PERM_VENTAS_NETAS_GESTION } from "@/lib/operativas";

type Vista = "negocio" | "productividad" | "operativa";

export default function VentasNetasReportPage() {
  return (
    <AppShell>
      <Informe />
    </AppShell>
  );
}

function Informe() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const gestion = can(PERM_VENTAS_NETAS_GESTION);
  const [r, setR] = useState<InformeDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("negocio");
  const [descargando, setDescargando] = useState(false);

  const load = useCallback(async () => {
    try {
      setR(await apiFetch<InformeDetalle>(`${VN_API}/reports/${id}`));
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const { publicar, dialogo, loading: publicando, error: errorPublicar } = usePublicar(load);
  const [actualizando, setActualizando] = useState(false);

  // Informe generado por una versión anterior del análisis: le faltan bloques nuevos.
  const desactualizado = !!r && (!r.data?.productividad || (r.data.version ?? 1) < VERSION_ANALISIS);
  const actualizar = async () => {
    setActualizando(true);
    try { await apiFetch(`${VN_API}/reports/${id}/reprocess`, { method: "POST" }); await load(); }
    catch (e: any) { setError(e.message); }
    finally { setActualizando(false); }
  };

  const descargar = async () => {
    setDescargando(true);
    try { await downloadFile(`${VN_API}/reports/${id}/export.xlsx`, `ventas-netas_${r?.periodo}.xlsx`); }
    catch (e: any) { setError(e.message); }
    finally { setDescargando(false); }
  };

  if (error) return <div className="card p-8 text-brand-primary">{error}</div>;
  if (!r) return <div className="card p-10 text-brand-slate">Cargando…</div>;

  const titulo = `Ventas Netas · ${nombrePeriodo(r.periodo)}`;
  const sub = `Corte al ${fechaCorta(r.fecha_dato)} · ${r.status === "published" ? `publicado el ${fechaHora(r.published_at)}` : "borrador"}`;

  return (
    <>
      <PrintHeader titulo={titulo} subtitulo={sub} />
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap print:hidden">
        <div>
          <Link href={VN_HREF} className="text-xs text-brand-slate hover:text-brand-primary">← Informes</Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="font-display text-3xl text-brand-ink uppercase leading-tight">{titulo}</h1>
            <EstadoBadge estado={r.status} />
          </div>
          <p className="text-sm text-brand-slate mt-1">
            Corte al <b>{fechaCorta(r.fecha_dato)}</b>
            {r.status === "published" && <> · publicado el {fechaHora(r.published_at)}</>}
            {r.status === "replaced" && <> · reemplazado el {fechaHora(r.replaced_at)}: <span className="text-brand-primary">este informe ya no vale</span></>}
            {r.status === "draft" && <> · borrador: <span className="text-brand-cyan">solo lo ve gestión hasta que se publique</span></>}
          </p>
        </div>
        <div className="flex gap-2">
          <PrintButton label="Imprimir" />
          <button onClick={descargar} disabled={descargando} className="btn-secondary">
            {descargando ? "Generando…" : "Planilla .xlsx"}
          </button>
          {gestion && r.status !== "published" && (
            <button onClick={() => publicar(r)} disabled={publicando} className="btn-primary">
              {publicando ? "Publicando…" : r.status === "replaced" ? "Volver a publicar" : "Publicar"}
            </button>
          )}
        </div>
      </div>

      {errorPublicar && <div className="card p-4 text-brand-primary mb-4">{errorPublicar}</div>}
      {desactualizado && (
        <div className="rounded-md border border-brand-orange/40 bg-brand-orange/10 text-sm text-brand-graphite p-3 mb-4 flex items-center justify-between gap-3 flex-wrap print:hidden">
          <span>
            Este informe se generó con una <b>versión anterior</b> del análisis y le faltan secciones nuevas (por ejemplo, Productividad).
            {gestion ? " Se puede recalcular a partir del archivo ya subido, sin volver a cargarlo." : " Pedile a gestión que lo actualice."}
          </span>
          {gestion && (
            <button onClick={actualizar} disabled={actualizando} className="btn-primary">
              {actualizando ? "Recalculando…" : "Actualizar informe"}
            </button>
          )}
        </div>
      )}

      <Tabs<Vista>
        value={vista}
        onChange={setVista}
        items={[
          { value: "negocio", label: "Visión Negocio", hint: "Netas · gerencial" },
          { value: "productividad", label: "Productividad", hint: "Evolutivo de cargas · zonas" },
          { value: "operativa", label: "Visión Operativa", hint: "Planillas · descargable" },
        ]}
      />

      {vista === "negocio" && <VisionNegocio d={r.data} />}
      {vista === "productividad" && (r.data?.productividad
        ? <VisionProductividad d={r.data} />
        : <div className="card p-10 text-center text-brand-slate">La sección Productividad no está en este informe. Actualizalo con el botón de arriba.</div>)}
      {vista === "operativa" && <VisionOperativa d={r.data} onDescargar={descargar} descargando={descargando} />}

      {dialogo}
    </>
  );
}
