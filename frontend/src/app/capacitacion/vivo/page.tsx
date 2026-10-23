"use client";

/**
 * En vivo: el tablero del mentor y del capacitador con los entrenamientos que están pasando ahora (como el Pulse de un
 * contact center). Indicadores del día, cada conversación con su estado y el tiempo en ese estado, los postulantes y lo
 * que terminó hoy. Se actualiza solo cada 3 segundos (se frena si la pestaña no está a la vista) y se puede poner en
 * pantalla completa para un televisor.
 */
import { Maximize2, MessagesSquare, Minimize2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MetaEntrenamientos, VerConversacion } from "@/components/capacitacion/entrenamientos";
import { Pestanas } from "@/components/capacitacion/pestanas";
import { CAP_API, CAP_HREF, CRITERIOS, conIntento, type EnVivo, type PostulanteVivo, type SesionVivo } from "@/components/capacitacion/tipos";
import { EstadoVivoChip, Monitor, PuntoVivo, mmss, segDesde, tonoEspera, useAhora } from "@/components/capacitacion/vivo";
import { Cargando, Encabezado, Fallo, Seccion, cx } from "@/components/portal/ui";
import { apiFetch } from "@/lib/api";

const CADA = 3000;

export default function EnVivoPage() {
  return (
    <AppShell>
      <Suspense fallback={<Cargando filas={4} />}>
        <Tablero />
      </Suspense>
    </AppShell>
  );
}

const hace = (seg: number | null) => (seg === null ? "—" : seg < 60 ? "recién" : seg < 3600 ? `hace ${Math.floor(seg / 60)} min` : `hace ${Math.floor(seg / 3600)} h`);

function Tablero() {
  const params = useSearchParams();
  const router = useRouter();
  const [grupo, setGrupo] = useState(params.get("grupo") ?? "");
  const [d, setD] = useState<EnVivo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [recibido, setRecibido] = useState(0);
  const [mirar, setMirar] = useState<{ sid: string; postulante: string } | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [pantalla, setPantalla] = useState(false);
  const [puedePantalla, setPuedePantalla] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const ahora = useAhora(offset);

  // Una consulta a la vez: la próxima sale 3 s después de que llega la anterior; con la pestaña oculta no consulta.
  useEffect(() => {
    let vivo = true;
    let cargando = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const cargar = async () => {
      if (cargando) return;
      clearTimeout(t);
      if (!document.hidden) {
        cargando = true;
        const t0 = Date.now();
        try {
          const x = await apiFetch<EnVivo>(`${CAP_API}/en-vivo${grupo ? `?grupo=${encodeURIComponent(grupo)}` : ""}`);
          if (vivo) {
            const t1 = Date.now();
            setOffset(new Date(x.ahora).getTime() - (t0 + t1) / 2);
            setD(x); setError(null); setRecibido(t1);
          }
        } catch (e: any) { if (vivo) setError(e.message); } finally { cargando = false; }
      }
      if (vivo) t = setTimeout(cargar, CADA);
    };
    cargar();
    const alVolver = () => { if (!document.hidden) cargar(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { vivo = false; clearTimeout(t); document.removeEventListener("visibilitychange", alVolver); };
  }, [grupo]);

  useEffect(() => {
    setPuedePantalla(!!document.fullscreenEnabled);
    const f = () => setPantalla(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);
  const alternarPantalla = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await raiz.current?.requestFullscreen(); } catch { /* el navegador no lo permite */ }
  };
  const elegirGrupo = (g: string) => {
    setGrupo(g); setD(null);
    router.replace(g ? `${CAP_HREF}/vivo?grupo=${encodeURIComponent(g)}` : `${CAP_HREF}/vivo`, { scroll: false });
  };

  const atraso = recibido ? Math.max(0, Math.round((Date.now() - recibido) / 1000)) : 0;
  const k = d?.kpis;
  const activas = d?.sesiones.filter((s) => s.estado !== "en_pausa") ?? [];
  const pausadas = d?.sesiones.filter((s) => s.estado === "en_pausa") ?? [];

  return (
    <div ref={raiz} className={cx("max-w-screen-2xl mx-auto", pantalla && "bg-brand-bg overflow-y-auto h-full p-6")}>
      {!pantalla && (
        <>
          <Encabezado sobre="Capacitación y Mentoría" titulo="En vivo"
            accion={puedePantalla && (
              <button type="button" onClick={alternarPantalla} className="hidden md:inline-flex btn-ghost text-sm"><Maximize2 size={15} aria-hidden /> Pantalla completa</button>
            )}>
            Los entrenamientos que están pasando ahora. Tocá una conversación para mirarla mientras pasa.
          </Encabezado>
          <Pestanas />
        </>
      )}

      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider2 text-brand-ink">
          <PuntoVivo apagado={!d || atraso > 15} /> En vivo
        </span>
        <span className={cx("text-[12px] tabular-nums", atraso > 15 ? "text-brand-primary-dark font-semibold" : "text-brand-slate")} aria-live="off">
          {!d ? "Conectando…" : atraso > 15 ? `Sin actualizar hace ${atraso} s` : "Se actualiza cada 3 s"}
        </span>
        {pantalla && (
          <button type="button" onClick={alternarPantalla} className="ml-auto btn-ghost text-sm"><Minimize2 size={15} aria-hidden /> Salir de pantalla completa</button>
        )}
      </div>
      {d && d.grupos.length > 1 && (
        // Una sola fila que se desliza en el celular (no ocupa media pantalla con muchos grupos).
        <div role="radiogroup" aria-label="Grupo" className="mb-4 -mx-4 px-4 md:mx-0 md:px-0 flex gap-2 overflow-x-auto whitespace-nowrap pb-1">
          {[{ id: "", nombre: "Todos los grupos" }, ...d.grupos].map((g) => {
            const on = grupo === g.id;
            return (
              <button key={g.id || "todos"} type="button" role="radio" aria-checked={on} onClick={() => elegirGrupo(g.id)}
                className={cx("min-h-[40px] px-4 rounded-full border text-sm font-semibold shrink-0 transition-colors",
                  on ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-graphite border-brand-border hover:border-brand-ink")}>
                {g.nombre}
              </button>
            );
          })}
        </div>
      )}
      {error && !d && <Fallo>{error}</Fallo>}
      {!d && !error && <Cargando filas={4} />}

      {d && k && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2.5">
            <Kpi label="En chat ahora" valor={k.en_chat} sub={k.esperando ? `${k.esperando} esperando respuesta` : "nadie esperando"} tono={k.esperando ? "alerta" : undefined} vivo={k.en_chat > 0} />
            <Kpi label="En pausa" valor={k.en_pausa} sub={`sin actividad hace ${d.umbrales.pausa_min} min o más`} />
            <Kpi label="Postulantes hoy" valor={`${k.postulantes_hoy}/${k.postulantes}`} sub="con actividad hoy" />
            <Kpi label="Casos hoy" valor={k.casos_hoy} sub={`${k.entrenamientos_hoy} entrenamiento${k.entrenamientos_hoy === 1 ? "" : "s"} terminado${k.entrenamientos_hoy === 1 ? "" : "s"}`} />
            <Kpi label="Nivel comercial" valor={k.nivel_hoy === null ? "—" : `${k.nivel_hoy}/10`} sub={k.evaluadas_hoy ? `promedio de ${k.evaluadas_hoy} caso${k.evaluadas_hoy === 1 ? "" : "s"} de hoy` : "todavía sin evaluar hoy"}
              tono={k.nivel_hoy === null ? undefined : k.nivel_hoy >= 8 ? "bien" : "mal"} />
            <Kpi label="Info correcta" valor={k.info_hoy === null ? "—" : `${k.info_hoy}%`} sub="de los casos de hoy" tono={k.info_hoy === null ? undefined : k.info_hoy >= 90 ? "bien" : "mal"} />
            <Kpi label="Tiempo por caso" valor={mmss(k.tiempo_caso)} sub="promedio de hoy" />
            <Kpi label="Respuesta media" valor={k.resp_media === null ? "—" : `${k.resp_media} s`} sub="del postulante al cliente" tono={k.resp_media !== null && k.resp_media >= d.umbrales.amarillo ? "alerta" : undefined} />
          </div>
          {k.recomendados_hoy > 0 && <p className="text-[13px] text-emerald-800 -mt-3">{k.recomendados_hoy} entrenamiento{k.recomendados_hoy === 1 ? "" : "s"} recomendado{k.recomendados_hoy === 1 ? "" : "s"} hoy.</p>}

          <Seccion titulo={`Conversaciones en curso · ${activas.length}`}
            sub={`Ordenadas por quién lleva más tiempo sin contestar. Amarillo desde ${d.umbrales.amarillo} s, rojo desde ${Math.round(d.umbrales.rojo / 60)} min.`}>
            {activas.length === 0 ? (
              <div className="card p-8 text-center text-sm text-brand-slate">
                <MessagesSquare size={28} className="mx-auto mb-2 text-brand-mist" aria-hidden />
                Nadie está chateando ahora. Cuando un postulante empiece un caso, aparece acá.
              </div>
            ) : (
              <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {activas.map((s) => <TarjetaSesion key={s.id} s={s} d={d} ahora={ahora} onMirar={() => setMirar({ sid: s.id, postulante: `${s.postulante.nombre} ${s.postulante.apellido}` })} />)}
              </ul>
            )}
            {pausadas.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-[13px] font-semibold text-brand-slate min-h-[40px] flex items-center">En pausa · {pausadas.length}</summary>
                <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-2.5 mt-2">
                  {pausadas.map((s) => <TarjetaSesion key={s.id} s={s} d={d} ahora={ahora} onMirar={() => setMirar({ sid: s.id, postulante: `${s.postulante.nombre} ${s.postulante.apellido}` })} />)}
                </ul>
              </details>
            )}
          </Seccion>

          <div className="grid xl:grid-cols-[1.6fr_1fr] gap-6">
            <Seccion titulo="Postulantes" sub={`Hoy y en total. Mínimo de ${d.minimo} entrenamientos por postulante: pueden hacer más.`}>
              <Postulantes filas={d.postulantes} ahora={ahora} minimo={d.minimo} variosGrupos={!grupo && d.grupos.length > 1} />
            </Seccion>
            <Seccion titulo="Terminadas hoy" sub="Los últimos casos cerrados, con la evaluación de la IA.">
              {d.recientes.length === 0 ? <div className="card p-6 text-center text-sm text-brand-slate">Todavía no terminó ningún caso hoy.</div> : (
                <ul className="card divide-y divide-brand-border overflow-hidden">
                  {d.recientes.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => setVer(r.id)} className="w-full text-left px-4 py-2.5 flex items-center gap-3 min-h-[56px] hover:bg-brand-bg-soft">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-semibold text-brand-ink truncate">{r.postulante.nombre} {r.postulante.apellido}</span>
                          <span className="block text-[12px] text-brand-slate truncate">{r.cliente} · {conIntento(r.entrenamiento ?? "", r.intento)}{r.guiado && " · guiado"} · {mmss(r.segundos)} · {hace(segDesde(r.terminado_at, ahora))}</span>
                        </span>
                        {r.estado === "evaluando" ? <span className="text-[12px] text-brand-slate shrink-0">Evaluando…</span>
                          : r.nivel !== null ? (
                            <span className="text-right shrink-0">
                              <span className={cx("block text-[15px] font-bold tabular-nums", r.nivel >= 8 ? "text-emerald-700" : "text-brand-ink")}>{r.nivel}/10</span>
                              <span className={cx("block text-[11px]", r.info_correcta ? "text-emerald-700" : "text-brand-primary-dark")}>{r.info_correcta ? "info correcta" : "info con errores"}</span>
                            </span>
                          ) : <span className="text-[12px] text-brand-slate shrink-0">Sin evaluar</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Seccion>
          </div>
        </div>
      )}

      {mirar && d && <Monitor sid={mirar.sid} postulante={mirar.postulante} offset={offset} umbrales={d.umbrales} criterios={CRITERIOS} onClose={() => setMirar(null)} />}
      {ver && <VerConversacion sid={ver} criterios={CRITERIOS} onClose={() => setVer(null)} />}
    </div>
  );
}

function Kpi({ label, valor, sub, tono, vivo }: { label: string; valor: React.ReactNode; sub?: string; tono?: "alerta" | "bien" | "mal"; vivo?: boolean }) {
  return (
    <div className={cx("card px-3.5 py-3 min-w-0 border-l-4",
      tono === "alerta" ? "border-l-amber-400" : tono === "bien" ? "border-l-emerald-600" : tono === "mal" ? "border-l-brand-primary" : "border-l-transparent")}>
      <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate truncate flex items-center gap-1.5">{vivo && <PuntoVivo />}{label}</div>
      <div className={cx("font-display text-[30px] leading-tight tabular-nums",
        tono === "bien" ? "text-emerald-700" : tono === "mal" ? "text-brand-primary" : tono === "alerta" ? "text-amber-700" : "text-brand-ink")}>{valor}</div>
      {sub && <div className="text-[11px] text-brand-slate leading-snug">{sub}</div>}
    </div>
  );
}

function TarjetaSesion({ s, d, ahora, onMirar }: { s: SesionVivo; d: EnVivo; ahora: number; onMirar: () => void }) {
  const seg = segDesde(s.desde, ahora);
  const tono = tonoEspera(s.estado, seg, d.umbrales);
  const quien = s.ultimo?.r === "asesor" ? s.postulante.nombre : (s.cliente ?? "Cliente").split(" ")[0];
  return (
    <li>
      <button type="button" onClick={onMirar}
        className={cx("w-full text-left card p-3.5 border-l-4 hover:shadow-elevated active:scale-[0.995] transition",
          tono === "rojo" ? "border-l-red-500" : tono === "amarillo" ? "border-l-amber-400" : s.estado === "responde_cliente" ? "border-l-sky-400" : s.estado === "en_pausa" ? "border-l-brand-border" : "border-l-emerald-500")}
        aria-label={`Mirar la conversación de ${s.postulante.nombre} ${s.postulante.apellido}`}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <EstadoVivoChip estado={s.estado} seg={seg} umbrales={d.umbrales} />
          <span className="text-[11px] text-brand-slate tabular-nums">en curso {mmss(segDesde(s.iniciado_at, ahora))}</span>
        </div>
        <div className="mt-2 font-semibold text-[16px] text-brand-ink truncate">{s.postulante.nombre} {s.postulante.apellido}</div>
        <div className="text-[12px] text-brand-slate truncate">
          {conIntento(s.entrenamiento ?? "Entrenamiento", s.intento)}{s.guiado && " · guiado"} · caso {Math.min(s.progreso.hechos + 1, s.progreso.casos || 1)} de {s.progreso.casos || "?"}
          {d.grupos.length > 1 && ` · ${s.grupo.nombre}`}
        </div>
        <div className="text-[12px] text-brand-slate truncate">Cliente: <b className="text-brand-ink font-semibold">{s.cliente}</b>{s.caso && ` · ${s.caso}`}</div>
        {s.ultimo && (
          <p className="mt-2 text-[13px] text-brand-graphite leading-snug line-clamp-2 bg-brand-bg-soft rounded-lg px-2.5 py-1.5">
            <b className="font-semibold">{quien}:</b> {s.ultimo.t}
          </p>
        )}
        <div className="mt-2 text-[11px] text-brand-slate tabular-nums">
          {s.turnos}{s.max_turnos ? ` de ${s.max_turnos}` : ""} respuestas · {s.mensajes} mensajes{s.resp_media !== null && ` · responde en ${s.resp_media} s`}
        </div>
      </button>
    </li>
  );
}

const ESTADO_PERSONA: Record<PostulanteVivo["vivo"], { label: string; punto: string }> = {
  en_chat: { label: "En chat", punto: "bg-emerald-500" },
  en_pausa: { label: "En pausa", punto: "bg-brand-mist" },
  activo_hoy: { label: "Activo hoy", punto: "bg-brand-ink" },
  sin_actividad: { label: "Sin actividad hoy", punto: "border border-brand-mist bg-white" },
};

function Postulantes({ filas, ahora, minimo, variosGrupos }: { filas: PostulanteVivo[]; ahora: number; minimo: number; variosGrupos: boolean }) {
  if (!filas.length) return <div className="card p-6 text-center text-sm text-brand-slate">No hay postulantes activos en los grupos en curso.</div>;
  const nivel = (p: PostulanteVivo) => (p.nivel_hoy === null ? "—" : <span className={p.nivel_hoy >= 8 ? "text-emerald-700 font-semibold" : ""}>{p.nivel_hoy}/10</span>);
  const info = (p: PostulanteVivo) => (p.info_hoy.de ? `${p.info_hoy.ok} de ${p.info_hoy.de}` : "—");
  return (
    <>
      <ul className="md:hidden card divide-y divide-brand-border overflow-hidden">
        {filas.map((p) => (
          <li key={p.id}>
            <Link href={`${CAP_HREF}/postulantes/${p.id}`} className="px-4 py-3 flex items-center gap-3 min-h-[60px]">
              <span className={cx("w-2.5 h-2.5 rounded-full shrink-0", ESTADO_PERSONA[p.vivo].punto)} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-brand-ink truncate">{p.nombre} {p.apellido}</span>
                <span className="block text-[12px] text-brand-slate">{ESTADO_PERSONA[p.vivo].label}{p.ultima && p.vivo !== "en_chat" ? ` · ${hace(segDesde(p.ultima, ahora))}` : ""} · {p.casos_hoy} caso{p.casos_hoy === 1 ? "" : "s"} hoy</span>
              </span>
              <span className="text-right shrink-0">
                <span className="block text-[13px] tabular-nums">{nivel(p)}</span>
                <MetaEntrenamientos hechos={p.terminados} meta={minimo} compacta />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden md:block card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider2 text-brand-slate text-left">
            <tr className="border-b border-brand-border">
              <th className="px-3 py-2.5 font-semibold">Estado</th><th className="px-3 py-2.5 font-semibold">Postulante</th>
              {variosGrupos && <th className="px-3 py-2.5 font-semibold">Grupo</th>}
              <th className="px-3 py-2.5 font-semibold text-right">Casos hoy</th><th className="px-3 py-2.5 font-semibold text-right">Nivel hoy</th>
              <th className="px-3 py-2.5 font-semibold text-right">Info correcta</th><th className="px-3 py-2.5 font-semibold">Entrenamientos</th>
              <th className="px-3 py-2.5 font-semibold">Última actividad</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {filas.map((p) => (
              <tr key={p.id} className="hover:bg-brand-bg-soft">
                <td className="px-3 py-2.5 whitespace-nowrap"><span className="inline-flex items-center gap-2 text-[12px] font-semibold text-brand-ink">
                  <span className={cx("w-2.5 h-2.5 rounded-full", ESTADO_PERSONA[p.vivo].punto)} aria-hidden />{ESTADO_PERSONA[p.vivo].label}</span></td>
                <td className="px-3 py-2.5"><Link href={`${CAP_HREF}/postulantes/${p.id}`} className="font-semibold text-brand-ink hover:text-brand-primary">{p.apellido}, {p.nombre}</Link></td>
                {variosGrupos && <td className="px-3 py-2.5 text-brand-slate">{p.grupo.nombre}</td>}
                <td className="px-3 py-2.5 text-right tabular-nums">{p.casos_hoy}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{nivel(p)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{info(p)}</td>
                <td className="px-3 py-2.5"><MetaEntrenamientos hechos={p.terminados} meta={minimo} compacta />{p.pendientes > 0 && <span className="text-[11px] text-brand-slate"> · {p.pendientes} pend.</span>}</td>
                <td className="px-3 py-2.5 text-brand-slate whitespace-nowrap">{p.vivo === "en_chat" ? "Ahora" : hace(segDesde(p.ultima, ahora))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
