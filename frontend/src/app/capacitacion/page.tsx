"use client";

import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Pestanas } from "@/components/capacitacion/pestanas";
import { CAP_API, CAP_HREF, diasTexto, fecha, pct, type EstadoGrupo, type Grupo, type Resumen } from "@/components/capacitacion/tipos";
import { Dato, GrupoTag, HojaGrupo } from "@/components/capacitacion/ui";
import { Boton, Cargando, Chips, Encabezado, Fallo } from "@/components/portal/ui";
import { apiFetch } from "@/lib/api";

export default function CapacitacionPage() {
  return (
    <AppShell>
      <Tablero />
    </AppShell>
  );
}

type Filtro = EstadoGrupo | "todas";
const FILTROS: { v: Filtro; label: string }[] = [
  { v: "en_curso", label: "En curso" }, { v: "finalizada", label: "Finalizadas" }, { v: "cancelada", label: "Canceladas" }, { v: "todas", label: "Todas" },
];

function Tablero() {
  const router = useRouter();
  const [r, setR] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("en_curso");
  const [nuevo, setNuevo] = useState(false);
  const cargar = useCallback(() => {
    apiFetch<Resumen>(`${CAP_API}/resumen`).then((x) => { setR(x); setError(null); }).catch((e) => setError(e.message));
  }, []);
  useEffect(cargar, [cargar]);
  const grupos = useMemo(() => (r?.grupos ?? []).filter((g) => filtro === "todas" || g.estado === filtro), [r, filtro]);
  const t = r?.totales;

  return (
    <div className="max-w-screen-xl mx-auto">
      <Encabezado sobre="Capacitación y Mentoría" titulo="Grupos"
        accion={r?.puede.crear && <div className="w-full sm:w-auto"><Boton icono={Plus} onClick={() => setNuevo(true)} className="sm:w-auto">Nuevo grupo</Boton></div>}>
        Capacitación ÁGIL: sala a la mañana con el capacitador y piso a la tarde con el mentor.
      </Encabezado>
      <Pestanas />
      {error && <Fallo onReintentar={cargar}>{error}</Fallo>}
      {!r && !error && <Cargando filas={4} />}
      {r && t && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-5">
            <Dato label="Grupos en curso" valor={t.en_curso} sub={`${t.finalizados} finalizados${t.duracion_promedio ? ` · ${t.duracion_promedio} días prom.` : ""}`} />
            <Dato label="Postulantes" valor={t.embudo.total} sub={`${t.embudo.activos} activos · ${t.embudo.en_piso} en piso`} />
            <Dato label="Efectividad" valor={pct(t.embudo.efectividad)} sub={`${t.embudo.altas} altas operativas`} tono="verde" />
            <Dato label="Hicieron el IPV" valor={pct(t.ipv.porcentaje)} sub={`${t.ipv.realizados} de ${t.ipv.total}`} />
            <Dato label="Feedback" valor={t.feedback.total} sub={`${t.feedback.oportunidad} oportunidades registradas`} />
          </div>
          <div className="mb-3"><Chips etiqueta="Estado del grupo" opciones={FILTROS} valor={[filtro]} onChange={(v) => v[0] && setFiltro(v[0])} /></div>
          {grupos.length === 0 ? (
            <div className="card p-10 text-center text-brand-slate text-sm">
              {r.grupos.length === 0 ? (r.puede.crear ? "Todavía no hay grupos. Creá el primero con «Nuevo grupo»." : "Todavía no te asignaron a ningún grupo.") : "No hay grupos con este estado."}
            </div>
          ) : (
            <>
              <ul className="md:hidden card divide-y divide-brand-border overflow-hidden">{grupos.map((g) => <TarjetaGrupo key={g.id} g={g} />)}</ul>
              <TablaGrupos grupos={grupos} />
            </>
          )}
        </>
      )}
      {nuevo && r && <HojaGrupo gestion={r.puede.gestion} onClose={() => setNuevo(false)} onListo={(id) => router.push(`${CAP_HREF}/grupos/${id}`)} />}
    </div>
  );
}

function MiniEmbudo({ g }: { g: Grupo }) {
  const e = g.embudo;
  return (
    <span className="text-[12px] text-brand-slate tabular-nums">
      {e.en_sala} sala · {e.en_piso} piso · <b className="text-emerald-700">{e.altas} altas</b>{e.salidas > 0 && <> · <span className="text-brand-primary-dark">{e.salidas} salidas</span></>}
    </span>
  );
}

function TarjetaGrupo({ g }: { g: Grupo }) {
  return (
    <li>
      <Link href={`${CAP_HREF}/grupos/${g.id}`} className="flex items-center gap-3 px-4 py-3 min-h-[72px] active:bg-brand-bg">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[15px] text-brand-ink">{g.nombre}</span><GrupoTag estado={g.estado} />
          </div>
          <div className="text-[13px] text-brand-slate mt-0.5">Día {g.duracion_dias} · {g.capacitador.nombre}{g.mentores.length > 0 && ` · ${g.mentores.length} mentor${g.mentores.length > 1 ? "es" : ""}`}</div>
          <div className="mt-0.5"><MiniEmbudo g={g} /></div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-display text-2xl text-brand-ink tabular-nums leading-none">{pct(g.efectividad)}</div>
          <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">efectividad</div>
        </div>
        <ChevronRight size={18} className="text-brand-mist shrink-0" aria-hidden />
      </Link>
    </li>
  );
}

function TablaGrupos({ grupos }: { grupos: Grupo[] }) {
  const router = useRouter();
  return (
    <div className="hidden md:block card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
            <th className="px-4 py-2.5 font-semibold">Grupo</th><th className="px-3 py-2.5 font-semibold">Estado</th>
            <th className="px-3 py-2.5 font-semibold">Duración</th><th className="px-3 py-2.5 font-semibold">Capacitador · mentores</th>
            <th className="px-3 py-2.5 font-semibold">Postulantes</th><th className="px-3 py-2.5 font-semibold text-right">IPV</th>
            <th className="px-3 py-2.5 font-semibold text-right">Feedback</th><th className="px-4 py-2.5 font-semibold text-right">Efectividad</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-border">
          {grupos.map((g) => (
            <tr key={g.id} className="hover:bg-brand-bg-soft cursor-pointer" onClick={() => router.push(`${CAP_HREF}/grupos/${g.id}`)}>
              <td className="px-4 py-3"><Link href={`${CAP_HREF}/grupos/${g.id}`} className="font-semibold text-brand-ink hover:text-brand-primary">{g.nombre}</Link>
                {g.operacion && <div className="text-xs text-brand-slate">{g.operacion}</div>}</td>
              <td className="px-3 py-3"><GrupoTag estado={g.estado} /></td>
              <td className="px-3 py-3 tabular-nums whitespace-nowrap">{diasTexto(g.duracion_dias)}<div className="text-xs text-brand-slate">desde {fecha(g.fecha_inicio)}</div></td>
              <td className="px-3 py-3">{g.capacitador.nombre}<div className="text-xs text-brand-slate">{g.mentores.map((m) => m.nombre).join(", ") || "Sin mentor"}</div></td>
              <td className="px-3 py-3"><b className="tabular-nums">{g.embudo.total}</b><div><MiniEmbudo g={g} /></div></td>
              <td className="px-3 py-3 text-right tabular-nums">{g.ipv.realizados}/{g.ipv.total}<div className="text-xs text-brand-slate">{pct(g.ipv.porcentaje)}</div></td>
              <td className="px-3 py-3 text-right tabular-nums">{g.feedback}</td>
              <td className="px-4 py-3 text-right"><span className="font-display text-2xl tabular-nums">{pct(g.efectividad)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
