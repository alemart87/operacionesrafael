"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Pestanas } from "@/components/capacitacion/pestanas";
import { CAP_API, CAP_HREF, NIVEL_IPV, diasTexto, pct, type Resumen } from "@/components/capacitacion/tipos";
import { Barra, Dato, EmbudoVista, GrupoTag, TablaDemo } from "@/components/capacitacion/ui";
import { Cargando, Chips, Encabezado, Etiqueta, Fallo, Seccion, cx } from "@/components/portal/ui";
import { apiFetch } from "@/lib/api";

export default function EstadisticasPage() {
  return (
    <AppShell>
      <Estadisticas />
    </AppShell>
  );
}

type Periodo = "todo" | "mes" | "trimestre" | "anio";
const PERIODOS: { v: Periodo; label: string }[] = [
  { v: "mes", label: "Este mes" }, { v: "trimestre", label: "Últimos 3 meses" }, { v: "anio", label: "Este año" }, { v: "todo", label: "Todo" },
];

function desdeDe(p: Periodo): string | null {
  const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Asuncion" }));
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (p === "mes") return iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  if (p === "trimestre") return iso(new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1));
  if (p === "anio") return iso(new Date(hoy.getFullYear(), 0, 1));
  return null;
}

function Estadisticas() {
  const [periodo, setPeriodo] = useState<Periodo>("todo");
  const [r, setR] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(() => {
    const d = desdeDe(periodo);
    setR(null);
    apiFetch<Resumen>(`${CAP_API}/resumen${d ? `?desde=${d}` : ""}`).then((x) => { setR(x); setError(null); }).catch((e) => setError(e.message));
  }, [periodo]);
  useEffect(cargar, [cargar]);
  const t = r?.totales;

  return (
    <div className="max-w-screen-xl mx-auto">
      <Encabezado sobre="Capacitación y Mentoría" titulo="Estadísticas">
        Estados de los postulantes, efectividad y duración de los grupos, IPV y feedback, por sexo y por edad.
      </Encabezado>
      <Pestanas />
      <div className="mb-4"><Chips etiqueta="Período (por inicio del grupo)" opciones={PERIODOS} valor={[periodo]} onChange={(v) => v[0] && setPeriodo(v[0])} /></div>
      {error && <Fallo onReintentar={cargar}>{error}</Fallo>}
      {!r && !error && <Cargando filas={4} />}
      {r && t && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-6">
            <Dato label="Grupos" valor={t.grupos} sub={`${t.en_curso} en curso · ${t.cancelados} cancelados`} />
            <Dato label="Duración promedio" valor={t.duracion_promedio ? diasTexto(Math.round(t.duracion_promedio)) : "—"} sub="de los finalizados" />
            <Dato label="Efectividad" valor={pct(t.embudo.efectividad)} sub={`${t.embudo.altas} altas de ${t.embudo.total}`} tono="verde" />
            <Dato label="Deserción" valor={pct(t.embudo.desercion)} sub={`${t.embudo.estados.abandono} abandonos · ${t.embudo.estados.baja} bajas`} tono="rojo" />
            <Dato label="Feedback por postulante" valor={t.feedback.promedio ?? "—"} sub={`${t.feedback.total} en total · ${t.feedback.postulante} de ellos`} />
          </div>
          <div className="grid lg:grid-cols-2 gap-6">
            <Seccion titulo="Embudo general"><EmbudoVista e={t.embudo} /></Seccion>
            <Seccion titulo="IPV" sub={`${t.ipv.realizados} de ${t.ipv.total} postulantes lo hicieron (${pct(t.ipv.porcentaje)}).`}>
              <div className="card p-4 space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {(["superior", "termino_medio", "inferior"] as const).map((n) => <Etiqueta key={n}>{t.ipv.dgv[n]} DGV {NIVEL_IPV[n].nombre.toLowerCase()}</Etiqueta>)}
                </div>
                {t.ipv.realizados === 0 ? <p className="text-sm text-brand-slate">Sin resultados todavía.</p> : t.ipv.promedios.map((x) => (
                  <div key={x.clave} className={cx(!x.romano && "font-semibold")}>
                    <div className="flex justify-between text-[13px]"><span>{x.romano && <span className="text-brand-mist mr-1">{x.romano}</span>}{x.nombre}</span><span className="tabular-nums text-brand-slate">{x.decatipo ?? "—"}</span></div>
                    <div className="mt-0.5"><Barra valor={x.decatipo} max={10} color="#5B6573" /></div>
                  </div>
                ))}
              </div>
            </Seccion>
            <Seccion titulo="Por sexo"><TablaDemo titulo="Sexo" filas={r.estadisticas.sexo} /></Seccion>
            <Seccion titulo="Por edad" sub={r.estadisticas.edad_promedio ? `Edad promedio: ${r.estadisticas.edad_promedio} años` : undefined}>
              <TablaDemo titulo="Franja de edad" filas={r.estadisticas.edad} />
            </Seccion>
          </div>
          <Seccion titulo="Comparativa por grupo" sub="Ordenados por efectividad." className="mt-8">
            {r.grupos.length === 0 ? <div className="card p-6 text-sm text-brand-slate text-center">No hay grupos en el período.</div> : (
              <ol className="card divide-y divide-brand-border overflow-hidden">
                {[...r.grupos].sort((a, b) => (b.efectividad ?? -1) - (a.efectividad ?? -1)).map((g) => (
                  <li key={g.id}>
                    <Link href={`${CAP_HREF}/grupos/${g.id}`} className="block px-4 py-3 hover:bg-brand-bg-soft">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-semibold text-brand-ink">{g.nombre} <GrupoTag estado={g.estado} /></span>
                        <span className="font-display text-xl tabular-nums">{pct(g.efectividad)}</span>
                      </div>
                      <div className="mt-1"><Barra valor={g.efectividad} color="#15803D" /></div>
                      <div className="mt-1 text-[12px] text-brand-slate tabular-nums flex flex-wrap gap-x-3">
                        <span>{g.embudo.total} postulantes</span><span>{g.embudo.altas} altas</span><span>{g.embudo.salidas} salidas</span>
                        <span>{diasTexto(g.duracion_dias)}</span><span>IPV {pct(g.ipv.porcentaje)}</span><span>{g.feedback} feedback</span><span>{g.capacitador.nombre}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Seccion>
        </>
      )}
    </div>
  );
}
