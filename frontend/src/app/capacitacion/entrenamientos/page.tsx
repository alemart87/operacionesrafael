"use client";

import { Bot, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Pestanas } from "@/components/capacitacion/pestanas";
import { CAP_API, CAP_HREF, ESTADO_ENT, type Catalogo, type EntrenamientoFila } from "@/components/capacitacion/tipos";
import { HojaDatosEntrenamiento } from "@/components/capacitacion/entrenamiento-datos";
import { Boton, Cargando, Encabezado, Etiqueta, Fallo, Segmentos } from "@/components/portal/ui";
import { apiFetch } from "@/lib/api";

export default function EntrenamientosPage() {
  return (
    <AppShell>
      <Biblioteca />
    </AppShell>
  );
}

type Filtro = "activo" | "borrador" | "archivado";

function Biblioteca() {
  const router = useRouter();
  const [d, setD] = useState<({ entrenamientos: EntrenamientoFila[] } & Catalogo) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("activo");
  const [nuevo, setNuevo] = useState(false);
  const cargar = useCallback(() => {
    apiFetch<{ entrenamientos: EntrenamientoFila[] } & Catalogo>(`${CAP_API}/entrenamientos`).then((x) => { setD(x); setError(null); }).catch((e) => setError(e.message));
  }, []);
  useEffect(cargar, [cargar]);
  const lista = useMemo(() => (d?.entrenamientos ?? []).filter((e) => e.estado === filtro), [d, filtro]);
  const cuenta = (f: Filtro) => (d?.entrenamientos ?? []).filter((e) => e.estado === f).length;

  return (
    <div className="max-w-screen-xl mx-auto">
      <Encabezado sobre="Capacitación y Mentoría" titulo="Entrenamientos"
        accion={d && <div className="w-full sm:w-auto"><Boton icono={Plus} onClick={() => setNuevo(true)} className="sm:w-auto">Nuevo entrenamiento</Boton></div>}>
        Chats de práctica con clientes simulados por IA. Guía: <b className="text-brand-ink">al menos {d?.meta ?? 15} entrenamientos por postulante</b>.
      </Encabezado>
      <Pestanas />
      {error && <Fallo onReintentar={cargar}>{error}</Fallo>}
      {!d && !error && <Cargando filas={4} />}
      {d && (
        <>
          {!d.ia.disponible && (
            <div className="mb-4"><Fallo>La IA no está configurada en el servidor (falta la clave de OpenAI): podés armar los entrenamientos, pero los postulantes todavía no pueden chatear.</Fallo></div>
          )}
          {d.ia.simulador && <p className="mb-3 text-[12px] text-brand-slate">Modo demostración: el cliente y la evaluación son simulados.</p>}
          <div className="mb-3"><Segmentos etiqueta="Estado" valor={filtro} onChange={setFiltro}
            opciones={(["activo", "borrador", "archivado"] as Filtro[]).map((f) => ({ v: f, label: `${ESTADO_ENT[f].nombre}s`, n: cuenta(f) }))} /></div>
          {lista.length === 0 ? (
            <div className="card p-10 text-center text-sm text-brand-slate">
              {d.entrenamientos.length === 0 ? <>Todavía no hay entrenamientos. Creá el primero con <b>Nuevo entrenamiento</b>: le cargás los casos (clientes) y lo enviás a los postulantes.</> : "No hay entrenamientos con este estado."}
            </div>
          ) : (
            <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
              {lista.map((e) => (
                <li key={e.id}>
                  <Link href={`${CAP_HREF}/entrenamientos/${e.id}`} className="card p-4 flex items-start gap-3 hover:shadow-elevated active:bg-brand-bg-soft h-full">
                    <span className="w-11 h-11 rounded-xl bg-brand-ink text-white flex items-center justify-center shrink-0"><Bot size={22} aria-hidden /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-[15px] text-brand-ink">{e.nombre}</span><Etiqueta tono={ESTADO_ENT[e.estado].tono}>{ESTADO_ENT[e.estado].nombre}</Etiqueta></span>
                      <span className="block text-[13px] text-brand-slate mt-0.5">{e.casos} caso{e.casos === 1 ? "" : "s"} · {e.empresa} · {e.creado_por}</span>
                      <span className="block text-[13px] text-brand-slate mt-1 tabular-nums">
                        Enviado a <b className="text-brand-ink">{e.enviados}</b> · terminaron <b className="text-brand-ink">{e.terminados}</b> · recomendados <b className="text-emerald-700">{e.aprobados}</b>
                      </span>
                    </span>
                    <ChevronRight size={18} className="text-brand-mist shrink-0 mt-1" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {nuevo && <HojaDatosEntrenamiento onClose={() => setNuevo(false)} onListo={(id) => router.push(`${CAP_HREF}/entrenamientos/${id}`)} />}
    </div>
  );
}
