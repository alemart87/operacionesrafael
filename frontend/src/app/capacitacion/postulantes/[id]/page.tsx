"use client";

import { ArrowLeft, ClipboardList, Flag, Link2, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CAP_API, CAP_HREF, ESTADOS, fecha, type Ficha } from "@/components/capacitacion/tipos";
import { PerfilIpv } from "@/components/capacitacion/perfil-ipv";
import { Dato, EstadoTag, HojaEnlace, HojaEstado, HojaPostulante, ListaComentarios, NuevoComentario } from "@/components/capacitacion/ui";
import { Boton, Cargando, Encabezado, Etiqueta, Fallo, Hoja, Seccion, hace, useAviso } from "@/components/portal/ui";
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
  ipv_inicio: "Empezó el IPV", ipv_terminado: "Terminó el IPV", pruebas: "Pruebas cargadas", datos: "Datos corregidos",
};

function FichaPostulante() {
  const { id } = useParams<{ id: string }>();
  const [f, setF] = useState<Ficha | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoja, setHoja] = useState<null | "estado" | "link" | "datos" | "pruebas">(null);
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

      <Seccion titulo="Test IPV" sub="Inventario de Personalidad para Vendedores · se corrige solo al terminar." className="mb-8">
        {r ? (
          <PerfilIpv r={r} descripciones={desc} pie={
            <p className="text-[11px] text-brand-mist">Terminado {hace(f.ipv.terminado_at)}{r.segundos ? ` · en ${Math.round(r.segundos / 60)} min` : ""}. Es una herramienta de orientación: se complementa con la entrevista y el desempeño en sala y piso.</p>} />
        ) : (
          <div className="card p-5 text-sm text-brand-slate">
            {f.ipv.estado === "en_curso" ? <>Lo está haciendo: lleva <b className="text-brand-ink">{f.ipv.respondidas} de {f.ipv.total}</b> respondidas (última vez {hace(f.ipv.iniciado_at)}).</>
              : f.ipv.estado === "pendiente" ? "Tiene el link pero todavía no empezó."
                : "Todavía no tiene link para el test. No es obligatorio, pero ayuda a conocerlo desde el día 1."}
            {f.puede.link && p.estado !== "abandono" && p.estado !== "baja" && <div className="mt-3"><Boton tipo="secundario" icono={Link2} onClick={() => setHoja("link")} className="sm:w-auto">{f.ipv.estado === "sin_link" ? "Generar link" : "Ver link y QR"}</Boton></div>}
          </div>
        )}
      </Seccion>

      {(f.pruebas || f.puede.pruebas) && (
        <Seccion titulo="Pruebas en papel" sub="Opcionales: se toman impresas en la sala." className="mb-8"
          accion={f.puede.pruebas && f.pruebas && <button type="button" className="btn-ghost text-sm" onClick={() => setHoja("pruebas")}><ClipboardList size={16} aria-hidden /> Corregir</button>}>
          <PruebasPapel f={f} onCargar={() => setHoja("pruebas")} />
        </Seccion>
      )}

      <Seccion titulo="Seguimiento" sub={`${f.conteo.total} comentarios: ${f.conteo.feedback} feedback, ${f.conteo.oportunidad} oportunidades y ${f.conteo.postulante} del postulante.`} className="mb-8">
        <div className="space-y-3">
          {f.puede.comentar && <NuevoComentario pid={p.id} onListo={() => { cargar(); avisar("Comentario guardado"); }} />}
          <ListaComentarios items={f.comentarios} />
        </div>
      </Seccion>

      <Seccion titulo="Historial">
        <ol className="card divide-y divide-brand-border">
          {f.historial.map((h, i) => (
            <li key={i} className="px-4 py-2.5 text-sm flex justify-between gap-3">
              <span className="text-brand-ink">{h.tipo === "estado" && h.a ? <>Pasó a <b>{ESTADOS[h.a as keyof typeof ESTADOS]?.nombre ?? h.a}</b></> : EVENTO[h.tipo] ?? h.tipo}
                {h.motivo && <span className="text-brand-slate"> · {h.motivo}</span>}</span>
              <span className="text-brand-slate text-xs shrink-0 text-right">{h.por ?? (h.tipo.startsWith("ipv") ? "El postulante" : "")} · {hace(h.at)}</span>
            </li>
          ))}
        </ol>
      </Seccion>

      {hoja === "estado" && <HojaEstado p={p} onClose={() => setHoja(null)} onListo={(x) => { setHoja(null); cargar(); avisar(`Ahora: ${ESTADOS[x.estado].nombre}`); }} />}
      {hoja === "link" && <HojaEnlace p={p} onClose={() => setHoja(null)} onCambio={cargar} />}
      {hoja === "datos" && <HojaPostulante grupoId={f.grupo.id} editar={p} onClose={() => setHoja(null)} onListo={() => { setHoja(null); cargar(); avisar("Datos corregidos"); }} />}
      {hoja === "pruebas" && <HojaPruebas f={f} onClose={() => setHoja(null)} onListo={(x) => { setF(x); setHoja(null); avisar("Pruebas cargadas"); }} />}
    </div>
  );
}

const PRUEBAS_INFO = [
  { nombre: "Dominó", que: "Razonamiento lógico: 48 problemas con fichas de dominó." },
  { nombre: "Atención concentrada", que: "Marcar figuras iguales a un modelo en una hoja: mide foco y precisión." },
  { nombre: "Atención distribuida", que: "Atender a varias cosas a la vez: mide la capacidad de repartir la atención." },
];

/** Las pruebas que vienen en las planillas pero no se pueden hacer en el celular: se cargan los aciertos y se corrigen solas. */
function PruebasPapel({ f, onCargar }: { f: Ficha; onCargar: () => void }) {
  if (!f.pruebas) {
    return (
      <div className="card p-4 space-y-3">
        <p className="text-sm text-brand-graphite">El IPV es el único test online. Las planillas traen además tres pruebas que se toman <b>impresas</b> en la sala;
          si las tomás, cargá los aciertos y el sistema las califica solo.</p>
        <ul className="space-y-1.5">
          {PRUEBAS_INFO.map((x) => <li key={x.nombre} className="text-[13px] text-brand-slate"><b className="text-brand-ink">{x.nombre}:</b> {x.que}</li>)}
        </ul>
        <Boton tipo="secundario" icono={ClipboardList} onClick={onCargar} className="sm:w-auto">Cargar resultados</Boton>
      </div>
    );
  }
  return (
    <div className="grid sm:grid-cols-3 gap-2.5">
      {Object.entries(f.pruebas.resultado).map(([k, x]) => {
        const valor = x.percentil ?? x.puntaje;
        const color = ["superior", "superior_tm"].includes(x.nivel) ? "#15803D" : x.nivel === "termino_medio" ? "#2A78D6" : "#E6332A";
        return (
          <div key={k} className="card px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate">{x.nombre}</div>
            <div className="flex items-baseline justify-between gap-2 mt-0.5">
              <span className="font-display text-2xl tabular-nums text-brand-ink">{x.percentil !== undefined ? `P${x.percentil}` : `${x.puntaje}%`}</span>
              <span className="text-[12px] font-semibold" style={{ color }}>{f.niveles_prueba[x.nivel] ?? x.nivel}</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-brand-bg overflow-hidden" aria-hidden><div className="h-full rounded-full" style={{ width: `${Math.max(3, valor)}%`, background: color }} /></div>
            <div className="text-[12px] text-brand-slate mt-1.5">{x.aciertos} de {x.de} aciertos{x.omisiones !== undefined && ` · ${x.omisiones} omisiones · ${x.errores} errores`}</div>
          </div>
        );
      })}
    </div>
  );
}

const CAMPOS = [
  { k: "domino_aciertos", label: "Dominó · aciertos", max: 48 },
  { k: "concentrada_aciertos", label: "Atención concentrada · aciertos", max: 230 },
  { k: "concentrada_omisiones", label: "Atención concentrada · omisiones", max: 230 },
  { k: "concentrada_errores", label: "Atención concentrada · errores", max: 230 },
  { k: "distribuida_aciertos", label: "Atención distribuida · aciertos", max: 51 },
] as const;

function HojaPruebas({ f, onClose, onListo }: { f: Ficha; onClose: () => void; onListo: (f: Ficha) => void }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(CAMPOS.map((c) => [c.k, f.pruebas?.datos?.[c.k]?.toString() ?? ""])));
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardar = async () => {
    setOcupado(true); setError(null);
    const body = Object.fromEntries(CAMPOS.map((c) => [c.k, v[c.k] === "" ? null : Number(v[c.k])]));
    try { onListo(await apiFetch<Ficha>(`${CAP_API}/postulantes/${f.postulante.id}/pruebas`, { method: "PUT", body: JSON.stringify(body) })); }
    catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <Hoja titulo="Otras pruebas" sobre={`${f.postulante.nombre} ${f.postulante.apellido}`} onClose={onClose} ocupada={ocupado}
      pie={<Boton onClick={guardar} ocupado={ocupado}>Guardar</Boton>}>
      <div className="space-y-3">
        <p className="text-sm text-brand-slate">Dejá vacío lo que no tomaste. Atención concentrada: 230 figuras para marcar; el puntaje es aciertos menos omisiones y errores.</p>
        {CAMPOS.map((c) => (
          <div key={c.k} className="flex items-center justify-between gap-3">
            <label htmlFor={c.k} className="text-sm text-brand-ink">{c.label} <span className="text-brand-mist">(0–{c.max})</span></label>
            <input id={c.k} className="input w-24 text-right tabular-nums" inputMode="numeric" value={v[c.k]} maxLength={3}
              onChange={(e) => setV({ ...v, [c.k]: e.target.value.replace(/\D/g, "") })} />
          </div>
        ))}
        {error && <Fallo>{error}</Fallo>}
        <Etiqueta>Se guarda quién y cuándo las cargó</Etiqueta>
      </div>
    </Hoja>
  );
}
