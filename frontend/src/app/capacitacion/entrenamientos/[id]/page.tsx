"use client";

import { Archive, ArrowDown, ArrowLeft, ArrowUp, MessageSquare, Pencil, Play, Plus, RotateCcw, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { HojaDatosEntrenamiento } from "@/components/capacitacion/entrenamiento-datos";
import { EditorCaso, HojaEnviar, ProbarCaso, ResultadoVista } from "@/components/capacitacion/entrenamientos";
import { CAP_API, CAP_HREF, ESTADO_ENT, type Asignacion, type Caso, type Catalogo, type Entrenamiento } from "@/components/capacitacion/tipos";
import { Barra } from "@/components/capacitacion/ui";
import { Boton, Cargando, Encabezado, Etiqueta, Fallo, Hoja, Seccion, Segmentos, useAviso } from "@/components/portal/ui";
import { apiFetch } from "@/lib/api";

export default function EntrenamientoPage() {
  return (
    <AppShell>
      <Detalle />
    </AppShell>
  );
}

type Vista = "casos" | "info" | "enviados";

function Detalle() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [e, setE] = useState<Entrenamiento | null>(null);
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("casos");
  const [hoja, setHoja] = useState<null | { t: "caso"; c?: Caso } | { t: "probar"; c: Caso } | { t: "datos" } | { t: "enviar" } | { t: "resultado"; a: Asignacion }>(null);
  const [aviso, avisar] = useAviso();
  const cargar = useCallback(() => {
    apiFetch<Entrenamiento>(`${CAP_API}/entrenamientos/${id}`).then((x) => { setE(x); setError(null); }).catch((x) => setError(x.message));
  }, [id]);
  useEffect(() => { cargar(); apiFetch<Catalogo>(`${CAP_API}/entrenamientos`).then(setCat).catch(() => undefined); }, [cargar]);

  if (error) return <Fallo onReintentar={cargar}>{error}</Fallo>;
  if (!e || !cat) return <Cargando filas={4} />;
  const editable = e.puede_editar && e.estado !== "archivado";

  const mover = async (k: number, d: -1 | 1) => {
    const ids = e.casos.map((c) => c.id);
    [ids[k], ids[k + d]] = [ids[k + d], ids[k]];
    await apiFetch(`${CAP_API}/entrenamientos/${e.id}/orden`, { method: "POST", body: JSON.stringify({ ids }) });
    cargar();
  };
  const borrarCaso = async (c: Caso) => {
    if (!window.confirm(`¿Borrar el caso «${c.titulo}»?`)) return;
    try { await apiFetch(`${CAP_API}/casos/${c.id}`, { method: "DELETE" }); cargar(); avisar("Caso borrado"); } catch (x: any) { avisar(x.message, "error"); }
  };
  const archivar = async () => {
    if (!window.confirm(e.asignaciones.length ? "¿Archivarlo? Deja de verse en los links; los resultados quedan en las fichas." : "¿Borrar este entrenamiento?")) return;
    const r = await apiFetch<{ archivado: boolean }>(`${CAP_API}/entrenamientos/${e.id}`, { method: "DELETE" });
    if (r.archivado) { cargar(); avisar("Entrenamiento archivado"); } else router.replace(`${CAP_HREF}/entrenamientos`);
  };
  const activar = async () => {
    try { await apiFetch(`${CAP_API}/entrenamientos/${e.id}`, { method: "PATCH", body: JSON.stringify({ estado: "activo" }) }); cargar(); avisar("Entrenamiento activo"); }
    catch (x: any) { avisar(x.message, "error"); }
  };
  const reiniciar = async (a: Asignacion) => {
    if (!window.confirm(`¿Reiniciar el entrenamiento de ${a.postulante.nombre}? Se borran sus conversaciones y lo vuelve a hacer.`)) return;
    try { await apiFetch(`${CAP_API}/asignaciones/${a.id}/reiniciar`, { method: "POST" }); setHoja(null); cargar(); avisar("Reiniciado"); }
    catch (x: any) { avisar(x.message, "error"); }
  };

  return (
    <div className="max-w-screen-lg mx-auto">
      {aviso}
      <Link href={`${CAP_HREF}/entrenamientos`} className="inline-flex items-center gap-1 text-sm text-brand-slate hover:text-brand-ink mb-2"><ArrowLeft size={16} aria-hidden /> Entrenamientos</Link>
      <Encabezado sobre={<span className="inline-flex items-center gap-2">Entrenamiento <Etiqueta tono={ESTADO_ENT[e.estado].tono}>{ESTADO_ENT[e.estado].nombre}</Etiqueta></span>} titulo={e.nombre}>
        {e.casos.length} caso{e.casos.length === 1 ? "" : "s"} · {e.empresa} · creado por {e.creado_por}
      </Encabezado>

      <div className="flex flex-wrap gap-2 mb-5">
        {e.estado !== "archivado" && <Boton icono={Send} onClick={() => setHoja({ t: "enviar" })} disabled={!e.casos.length} className="md:!w-auto">Enviar a postulantes</Boton>}
        {editable && <Boton tipo="secundario" icono={Pencil} onClick={() => setHoja({ t: "datos" })} className="!w-auto">Datos</Boton>}
        {e.puede_editar && e.estado === "borrador" && e.casos.length > 0 && <Boton tipo="fantasma" onClick={activar} className="!w-auto">Activar</Boton>}
        {e.puede_editar && e.estado !== "archivado" && <Boton tipo="fantasma" icono={Archive} onClick={archivar} className="!w-auto">{e.asignaciones.length ? "Archivar" : "Borrar"}</Boton>}
      </div>

      <div className="mb-4"><Segmentos etiqueta="Vista" valor={vista} onChange={setVista} opciones={[
        { v: "casos", label: "Casos", n: e.casos.length }, { v: "info", label: "Información" }, { v: "enviados", label: "Enviados", n: e.asignaciones.length }]} /></div>

      {vista === "casos" && (
        <Seccion titulo="Casos" sub="Cada caso es un cliente distinto. Sugerido: de 3 a 5 por entrenamiento. Probalos antes de enviar.">
          <ol className="space-y-2.5">
            {e.casos.map((c, k) => (
              <li key={c.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-full bg-brand-bg text-brand-ink font-bold text-sm flex items-center justify-center shrink-0">{k + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[15px] text-brand-ink">{c.titulo}</div>
                    <div className="text-[13px] text-brand-slate">{c.cliente_nombre}{c.cliente_edad ? `, ${c.cliente_edad} años` : ""} · {c.objeciones.length} objeciones · {c.info_correcta.length} datos a verificar · hasta {c.max_turnos} respuestas</div>
                    {c.actitud.rasgos.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{c.actitud.rasgos.map((r) => <Etiqueta key={r}>{r}</Etiqueta>)}</div>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setHoja({ t: "probar", c })} className="btn min-h-[40px] px-3 text-sm bg-brand-ink text-white"><Play size={15} aria-hidden /> Probar</button>
                  {editable && <button type="button" onClick={() => setHoja({ t: "caso", c })} className="btn min-h-[40px] px-3 text-sm bg-white border border-brand-border"><Pencil size={15} aria-hidden /> Editar</button>}
                  {editable && k > 0 && <button type="button" aria-label="Subir" onClick={() => mover(k, -1)} className="btn min-h-[40px] px-2.5 bg-white border border-brand-border"><ArrowUp size={15} /></button>}
                  {editable && k < e.casos.length - 1 && <button type="button" aria-label="Bajar" onClick={() => mover(k, 1)} className="btn min-h-[40px] px-2.5 bg-white border border-brand-border"><ArrowDown size={15} /></button>}
                  {editable && <button type="button" aria-label="Borrar caso" onClick={() => borrarCaso(c)} className="btn min-h-[40px] px-2.5 bg-white border border-brand-border text-brand-primary ml-auto"><Trash2 size={15} /></button>}
                </div>
              </li>
            ))}
          </ol>
          {editable && (
            <button type="button" onClick={() => setHoja({ t: "caso" })}
              className="mt-3 w-full min-h-[64px] rounded-xl border-2 border-dashed border-brand-border text-brand-ink font-semibold inline-flex items-center justify-center gap-2 hover:border-brand-ink">
              <Plus size={18} aria-hidden /> Agregar caso
            </button>
          )}
        </Seccion>
      )}

      {vista === "info" && (
        <Seccion titulo="Información" accion={editable && <button type="button" className="btn-ghost text-sm" onClick={() => setHoja({ t: "datos" })}><Pencil size={15} aria-hidden /> Editar</button>}>
          <div className="card p-4 space-y-4 text-[14px]">
            <div><div className="label">Lo que lee el postulante</div><p className="text-brand-ink whitespace-pre-wrap">{e.instrucciones || "—"}</p></div>
            <div><div className="label">Información oficial (la usa la IA para evaluar)</div><p className="text-brand-ink whitespace-pre-wrap">{e.producto || "Sin cargar: sin esta información, la IA no puede verificar los datos que da el postulante."}</p></div>
            <div><div className="label">Para aprobar</div><p className="text-brand-ink">Perfil comercial: nivel {e.umbral_nivel} o más · Información correcta en el {e.umbral_info}% de los casos</p></div>
          </div>
        </Seccion>
      )}

      {vista === "enviados" && (
        <Seccion titulo="Enviados" sub="Avance y resultado de cada postulante.">
          {e.asignaciones.length === 0 ? <div className="card p-8 text-center text-sm text-brand-slate">Todavía no se envió a nadie.</div> : (
            <ul className="card divide-y divide-brand-border overflow-hidden">
              {e.asignaciones.map((a) => (
                <li key={a.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`${CAP_HREF}/postulantes/${a.postulante.id}`} className="font-semibold text-[15px] text-brand-ink hover:text-brand-primary">{a.postulante.apellido}, {a.postulante.nombre}</Link>
                      <div className="text-[12px] text-brand-slate">{a.grupo.nombre} · {a.hechos} de {a.casos} casos{a.en_chat && " · chateando ahora"}</div>
                    </div>
                    {a.estado === "terminado" && a.resultado ? (
                      <button type="button" onClick={() => setHoja({ t: "resultado", a })}>
                        <Etiqueta tono={a.resultado.aprobado ? "verde" : "rojo"}>{a.resultado.aprobado ? "Recomendado" : "No recomendado"}</Etiqueta>
                      </button>
                    ) : <Etiqueta tono={a.estado === "evaluando" ? "azul" : "gris"}>{a.estado === "evaluando" ? "Evaluando" : a.estado === "en_curso" ? "En curso" : "Sin empezar"}</Etiqueta>}
                  </div>
                  <div className="mt-2"><Barra valor={a.pct} color={a.estado === "terminado" ? "#15803D" : "#0F1116"} /></div>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      )}


      {hoja?.t === "caso" && <EditorCaso eid={e.id} caso={hoja.c} catalogo={cat} onClose={() => setHoja(null)} onListo={() => { setHoja(null); cargar(); avisar("Caso guardado"); }} />}
      {hoja?.t === "probar" && <ProbarCaso caso={hoja.c} criterios={cat.criterios} onClose={() => setHoja(null)} />}
      {hoja?.t === "datos" && <HojaDatosEntrenamiento ent={e} onClose={() => setHoja(null)} onListo={() => { setHoja(null); cargar(); avisar("Guardado"); }} />}
      {hoja?.t === "enviar" && <HojaEnviar eid={e.id} nombre={e.nombre} meta={cat.meta} onClose={() => { setHoja(null); cargar(); }} />}
      {hoja?.t === "resultado" && hoja.a.resultado && (
        <Hoja titulo={`${hoja.a.postulante.nombre} ${hoja.a.postulante.apellido}`} sobre={e.nombre} onClose={() => setHoja(null)}
          pie={<>
            <Boton tipo="secundario" icono={RotateCcw} onClick={() => reiniciar(hoja.a)}>Reiniciar</Boton>
            <Boton icono={MessageSquare} href={`${CAP_HREF}/postulantes/${hoja.a.postulante.id}`}>Ver conversaciones</Boton>
          </>}>
          <ResultadoVista r={hoja.a.resultado} />
        </Hoja>
      )}
    </div>
  );
}
