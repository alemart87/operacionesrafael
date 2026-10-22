"use client";

import { ArrowLeft, Flag, Link2, Pencil, ShieldAlert, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CAP_API, CAP_HREF, CRITERIOS, ESTADOS, fecha, type Evento, type Ficha } from "@/components/capacitacion/tipos";
import { EntrenamientosFicha } from "@/components/capacitacion/entrenamientos";
import { BarrasIpv, Dato, EstadoTag, HojaEnlace, HojaEstado, HojaPostulante, ListaComentarios, NuevoComentario } from "@/components/capacitacion/ui";
import { Boton, Cargando, Encabezado, Fallo, Seccion, hace, useAviso } from "@/components/portal/ui";
import { apiFetch } from "@/lib/api";

export default function FichaPage() {
  return (
    <AppShell>
      <FichaPostulante />
    </AppShell>
  );
}

const SEXO = { F: "Femenino", M: "Masculino", X: "Otro" };
const EVENTO: Record<string, string> = {
  alta: "Ingresó al grupo", estado: "Cambio de estado", link: "Link del test generado", link_anulado: "Link anulado",
  ipv_inicio: "Empezó el IPV", ipv_terminado: "Terminó el IPV", datos: "Datos corregidos",
  entrenamiento_enviado: "Entrenamiento enviado", entrenamiento_reiniciado: "Entrenamiento reiniciado",
};
/** El texto de un evento del historial; los tipos nuevos que no estén acá se muestran legibles igual. */
function textoEvento(h: Evento) {
  if (h.tipo === "estado" && h.a) return <>Pasó a <b>{ESTADOS[h.a as keyof typeof ESTADOS]?.nombre ?? h.a}</b></>;
  if (h.tipo === "entrenamiento") return <>Entrenamiento evaluado: <b>{h.a === "aprobado" ? "recomendado" : "no recomendado"}</b></>;
  const t = EVENTO[h.tipo] ?? h.tipo.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function FichaPostulante() {
  const { id } = useParams<{ id: string }>();
  const [f, setF] = useState<Ficha | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoja, setHoja] = useState<null | "estado" | "link" | "datos">(null);
  const [aviso, avisar] = useAviso();
  const cargar = useCallback(() => {
    apiFetch<Ficha>(`${CAP_API}/postulantes/${id}`).then((x) => { setF(x); setError(null); }).catch((e) => setError(e.message));
  }, [id]);
  useEffect(cargar, [cargar]);
  // Mientras haya dictados transcribiéndose, se refresca solo.
  useEffect(() => {
    if (!f?.comentarios.some((c) => !c.texto && c.audio && !["error", "sin_servicio"].includes(c.audio.estado))) return;
    const t = setTimeout(cargar, 4000);
    return () => clearTimeout(t);
  }, [f, cargar]);

  if (error) return <Fallo onReintentar={cargar}>{error}</Fallo>;
  if (!f) return <Cargando filas={5} />;
  const p = f.postulante;
  const r = f.ipv.resultado;
  const desc = Object.fromEntries(f.escalas.map((e) => [e.clave, e.descripcion]));

  return (
    <div className="max-w-screen-lg mx-auto">
      {aviso}
      <Link href={`${CAP_HREF}/grupos/${f.grupo.id}`} className="inline-flex items-center gap-1 text-sm text-brand-slate hover:text-brand-ink mb-2"><ArrowLeft size={16} aria-hidden /> {f.grupo.nombre}</Link>
      <Encabezado sobre="Ficha del postulante" titulo={`${p.nombre} ${p.apellido}`}>
        CI {p.ci} · {p.edad} años · {SEXO[p.sexo]} · ingresó el {fecha(f.grupo.fecha_inicio)}
      </Encabezado>

      <div className="card p-4 mb-5 flex flex-wrap items-center gap-3 justify-between">
        <div className="min-w-0">
          <EstadoTag estado={p.estado} />
          <div className="text-[13px] text-brand-slate mt-1">{p.estado_at ? `Desde ${hace(p.estado_at)}` : ""}{p.motivo && ` · ${p.motivo}`}</div>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          {p.puede.length > 0 && <Boton icono={Flag} onClick={() => setHoja("estado")} className="sm:w-auto flex-1">Cambiar estado</Boton>}
          {f.puede.link && p.estado !== "abandono" && p.estado !== "baja" && <Boton tipo="secundario" icono={Link2} onClick={() => setHoja("link")} className="sm:w-auto flex-1">Link IPV</Boton>}
          {f.puede.datos && <Boton tipo="fantasma" icono={Pencil} onClick={() => setHoja("datos")} className="sm:w-auto !min-h-[56px]" aria-label="Corregir datos">Datos</Boton>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2.5 mb-6">
        <Dato label="Feedback" valor={p.comentarios.feedback} />
        <Dato label="A mejorar" valor={p.comentarios.oportunidad} />
        <Dato label="Su feedback" valor={p.comentarios.postulante} />
      </div>

      <Seccion titulo="Entrenamientos" sub="Chats de práctica con clientes simulados: la IA evalúa el perfil comercial y si da la información correcta." className="mb-8">
        <EntrenamientosFicha pid={p.id} nombre={`${p.nombre} ${p.apellido}`} meta={p.avance?.meta ?? 15} criterios={CRITERIOS}
          puedeEnviar={f.grupo.estado !== "cancelada" && p.estado !== "abandono" && p.estado !== "baja"} />
      </Seccion>

      <Seccion titulo="Test IPV" sub="Independiente de los entrenamientos · Inventario de Personalidad para Vendedores, se corrige solo al terminar." className="mb-8">
        {r ? (
          <div className="card p-4 space-y-4">
            <p className="text-[15px] text-brand-ink leading-snug">{r.resumen}</p>
            {r.senales.length > 0 && (
              <div className="rounded-lg border border-brand-orange/40 bg-brand-orange/10 px-3 py-2.5 text-sm text-[#8A5200] space-y-1">
                {r.senales.map((s) => <p key={s} className="flex gap-2"><ShieldAlert size={16} className="shrink-0 mt-0.5" aria-hidden />{s}</p>)}
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wider2 font-semibold text-emerald-800 flex items-center gap-1"><Sparkles size={13} aria-hidden /> Fortalezas</div>
                <p className="text-sm text-brand-ink mt-1">{r.fortalezas.join(" · ") || "Ninguna escala en nivel superior."}</p>
              </div>
              <div className="rounded-lg bg-brand-primary-light/60 border border-brand-primary/20 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-primary-dark flex items-center gap-1"><Target size={13} aria-hidden /> A trabajar</div>
                <p className="text-sm text-brand-ink mt-1">{r.a_trabajar.join(" · ") || "Ninguna escala en nivel inferior."}</p>
              </div>
            </div>
            <BarrasIpv escalas={r.escalas} descripciones={desc} />
            <p className="text-[11px] text-brand-mist">Terminado {hace(f.ipv.terminado_at)}{r.segundos ? ` · en ${Math.round(r.segundos / 60)} min` : ""}. Es una herramienta de orientación: se complementa con la entrevista y el desempeño en sala y piso.</p>
          </div>
        ) : (
          <div className="card p-5 text-sm text-brand-slate">
            {f.ipv.estado === "en_curso" ? <>Lo está haciendo: lleva <b className="text-brand-ink">{f.ipv.respondidas} de {f.ipv.total}</b> respondidas (última vez {hace(f.ipv.iniciado_at)}).</>
              : f.ipv.estado === "pendiente" ? "Tiene el link pero todavía no empezó."
                : "Todavía no tiene link para el test. No es obligatorio, pero ayuda a conocerlo desde el día 1."}
            {f.puede.link && p.estado !== "abandono" && p.estado !== "baja" && <div className="mt-3"><Boton tipo="secundario" icono={Link2} onClick={() => setHoja("link")} className="sm:w-auto">{f.ipv.estado === "sin_link" ? "Generar link" : "Ver link y QR"}</Boton></div>}
          </div>
        )}
      </Seccion>

      <Seccion titulo="Seguimiento" sub={`${f.conteo.total} comentarios: ${f.conteo.feedback} feedback, ${f.conteo.oportunidad} oportunidades y ${f.conteo.postulante} del postulante.`} className="mb-8">
        <div className="space-y-3">
          {f.puede.comentar && <NuevoComentario pid={p.id} onListo={() => { cargar(); avisar("Comentario guardado"); }} />}
          <ListaComentarios items={f.comentarios} />
        </div>
      </Seccion>

      <Seccion titulo="Historial">
        <ol className="card divide-y divide-brand-border">
          {f.historial.map((h, i) => (
            <li key={i} className="px-4 py-2.5 text-sm flex flex-col sm:flex-row sm:justify-between gap-0.5 sm:gap-3">
              <span className="text-brand-ink">{textoEvento(h)}
                {h.detalle && <span className="text-brand-slate"> · {h.detalle}</span>}
                {h.motivo && <span className="text-brand-slate"> · {h.motivo}</span>}</span>
              <span className="text-brand-slate text-xs shrink-0 sm:text-right">{[h.por ?? (h.tipo.startsWith("ipv") ? "El postulante" : h.tipo === "entrenamiento" ? "La IA" : ""), hace(h.at)].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ol>
      </Seccion>

      {hoja === "estado" && <HojaEstado p={p} onClose={() => setHoja(null)} onListo={(x) => { setHoja(null); cargar(); avisar(`Ahora: ${ESTADOS[x.estado].nombre}`); }} />}
      {hoja === "link" && <HojaEnlace p={p} onClose={() => setHoja(null)} onCambio={cargar} />}
      {hoja === "datos" && <HojaPostulante grupoId={f.grupo.id} editar={p} onClose={() => setHoja(null)} onListo={() => { setHoja(null); cargar(); avisar("Datos corregidos"); }} />}
    </div>
  );
}
