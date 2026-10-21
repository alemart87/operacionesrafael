"use client";

/**
 * Piezas de Capacitación y Mentoría: estados, embudo, estadísticas por sexo y edad, el gráfico del IPV y las hojas
 * (grupo, postulante, estado, link del test) y el seguimiento con dictado. Pensadas primero para el celular.
 */
import { Copy, Link2, MessageCircle, Mic, RefreshCcw, Send, Share2, ShieldOff, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Dictado } from "@/components/portal/grabadora";
import { Boton, Chips, Etiqueta, Fallo, Hoja, cx, hace, plural } from "@/components/portal/ui";
import type { AudioCoaching } from "@/components/supervision/tipos";
import { apiFetch } from "@/lib/api";
import {
  CAP_API, ESTADOS, ESTADOS_GRUPO, MOTIVOS_SALIDA, SEXOS, fecha, hoyIso, pct, subirDictado,
  type Comentario, type Embudo, type Enlace, type EstadoGrupo, type EstadoPostulante, type FilaDemo, type Ficha,
  type Grupo, type Persona, type Postulante, type Sexo,
} from "./tipos";

// ------------------------------------------------------------------ datos sueltos
export function Dato({ label, valor, sub, tono }: { label: string; valor: ReactNode; sub?: ReactNode; tono?: "verde" | "rojo" }) {
  return (
    <div className="card px-4 py-3 min-w-0">
      <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate truncate">{label}</div>
      <div className={cx("font-display text-[28px] leading-tight tabular-nums", tono === "verde" ? "text-emerald-700" : tono === "rojo" ? "text-brand-primary" : "text-brand-ink")}>{valor}</div>
      {sub && <div className="text-[12px] text-brand-slate leading-snug">{sub}</div>}
    </div>
  );
}

export function EstadoTag({ estado }: { estado: EstadoPostulante }) {
  const e = ESTADOS[estado];
  return <Etiqueta tono={e.tono}>{e.nombre}</Etiqueta>;
}

export function GrupoTag({ estado }: { estado: EstadoGrupo }) {
  const e = ESTADOS_GRUPO[estado];
  return <Etiqueta tono={e.tono}>{e.nombre}</Etiqueta>;
}

/** Barra fina con su valor al lado (magnitud en un solo tono). */
export function Barra({ valor, max = 100, color = "#0F1116" }: { valor: number | null; max?: number; color?: string }) {
  const w = valor === null ? 0 : Math.max(0, Math.min(100, (valor / max) * 100));
  return (
    <div className="h-2 rounded-full bg-brand-bg overflow-hidden" aria-hidden>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

/** El embudo del grupo (o de todos): de los que ingresaron, cuántos aprobaron la escrita, la mentoría y llegaron al alta. */
export function EmbudoVista({ e }: { e: Embudo }) {
  return (
    <div className="card p-4 space-y-3">
      {e.etapas.map((x, i) => (
        <div key={x.clave}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold text-brand-ink">{x.nombre}</span>
            <span className="tabular-nums text-brand-slate"><b className="text-brand-ink">{x.n}</b> · {pct(x.pct)}</span>
          </div>
          <div className="mt-1"><Barra valor={x.pct} color={i === 3 ? "#15803D" : "#0F1116"} /></div>
        </div>
      ))}
      <div className="pt-1 flex flex-wrap gap-1.5 text-xs">
        <Etiqueta>{e.en_sala} en sala</Etiqueta>
        <Etiqueta tono="azul">{e.en_piso} en piso</Etiqueta>
        <Etiqueta tono="verde">{e.altas} altas</Etiqueta>
        <Etiqueta tono="rojo">{e.estados.abandono} abandonos · {e.estados.baja} bajas</Etiqueta>
      </div>
    </div>
  );
}

/** Estadísticas por sexo o por franja de edad: una fila por categoría, legible en el celular. */
export function TablaDemo({ titulo, filas }: { titulo: string; filas: FilaDemo[] }) {
  const max = Math.max(1, ...filas.map((f) => f.total));
  return (
    <div className="card overflow-hidden">
      <div className="px-4 pt-3 pb-2 text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate">{titulo}</div>
      <div className="divide-y divide-brand-border">
        {filas.map((f) => (
          <div key={f.clave} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-brand-ink text-[15px]">{f.nombre}</span>
              <span className="text-sm tabular-nums text-brand-slate"><b className="text-brand-ink">{f.total}</b> postulante{f.total === 1 ? "" : "s"}</span>
            </div>
            <div className="mt-1.5"><Barra valor={f.total} max={max} color="#5B6573" /></div>
            <div className="mt-1.5 text-[12px] text-brand-slate tabular-nums flex flex-wrap gap-x-3 gap-y-0.5">
              <span>Efectividad <b className="text-brand-ink">{pct(f.efectividad)}</b></span>
              <span>{plural(f.altas, "alta", "altas")}</span><span>{plural(f.salidas, "salida", "salidas")}</span>
              <span>IPV {f.ipv}{f.dgv_promedio !== null && <> · DGV <b className="text-brand-ink">{f.dgv_promedio}</b></>}</span>
              {f.edad_promedio !== null && <span>{f.edad_promedio} años prom.</span>}
            </div>
          </div>
        ))}
        {filas.every((f) => !f.total) && <div className="px-4 py-6 text-sm text-brand-slate text-center">Todavía no hay postulantes.</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ hojas
export function HojaEstado({ p, onClose, onListo }: { p: Postulante; onClose: () => void; onListo: (p: Postulante) => void }) {
  const [estado, setEstado] = useState<EstadoPostulante | null>(p.puede.length === 1 ? p.puede[0] : null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const salida = estado === "abandono" || estado === "baja";
  const guardar = async () => {
    setOcupado(true); setError(null);
    try {
      onListo(await apiFetch<Postulante>(`${CAP_API}/postulantes/${p.id}/estado`, { method: "POST", body: JSON.stringify({ estado, motivo: motivo || null }) }));
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <Hoja titulo="Cambiar estado" sobre={`${p.nombre} ${p.apellido}`} onClose={onClose} ocupada={ocupado}
      pie={<Boton onClick={guardar} ocupado={ocupado} disabled={!estado || (salida && motivo.trim().length < 3)}>Guardar</Boton>}>
      <div className="space-y-4">
        <p className="text-sm text-brand-slate">Ahora: <b className="text-brand-ink">{ESTADOS[p.estado].nombre}</b></p>
        {p.puede.length === 0 ? <p className="text-sm text-brand-slate">No hay cambios que puedas cargar ahora.</p> : (
          <Chips etiqueta="Nuevo estado" opciones={p.puede.map((v) => ({ v, label: ESTADOS[v].nombre }))} valor={estado ? [estado] : []}
            onChange={(v) => setEstado(v[0] ?? null)} />
        )}
        {salida && (
          <div className="space-y-2">
            <label className="label" htmlFor="motivo">Motivo</label>
            <div className="flex flex-wrap gap-1.5">
              {MOTIVOS_SALIDA.map((m) => (
                <button key={m} type="button" onClick={() => setMotivo(m)}
                  className={cx("min-h-[36px] px-3 rounded-full border text-[13px]", motivo === m ? "bg-brand-ink text-white border-brand-ink" : "border-brand-border text-brand-graphite")}>{m}</button>
              ))}
            </div>
            <input id="motivo" className="input" value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} placeholder="O escribilo" />
          </div>
        )}
        {error && <Fallo>{error}</Fallo>}
      </div>
    </Hoja>
  );
}

export function HojaGrupo({ grupo, gestion, onClose, onListo }: { grupo?: Grupo; gestion: boolean; onClose: () => void; onListo: (id: string) => void }) {
  const [gente, setGente] = useState<{ capacitadores: Persona[]; mentores: Persona[] } | null>(null);
  const [f, setF] = useState({
    nombre: grupo?.nombre ?? "", operacion: grupo?.operacion ?? "", fecha_inicio: grupo?.fecha_inicio ?? hoyIso(),
    fin_previsto: grupo?.fin_previsto ?? "", capacitador_id: grupo?.capacitador.id ?? "", mentores: grupo?.mentores.map((m) => m.id) ?? [] as string[],
  });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiFetch<{ capacitadores: Persona[]; mentores: Persona[] }>(`${CAP_API}/personas`).then(setGente).catch((e) => setError(e.message)); }, []);
  const guardar = async () => {
    setOcupado(true); setError(null);
    const body = { nombre: f.nombre, operacion: f.operacion || null, fecha_inicio: f.fecha_inicio, fin_previsto: f.fin_previsto || null,
      mentores: f.mentores, ...(gestion && f.capacitador_id ? { capacitador_id: f.capacitador_id } : {}) };
    try {
      const g = await apiFetch<Grupo>(grupo ? `${CAP_API}/grupos/${grupo.id}` : `${CAP_API}/grupos`,
        { method: grupo ? "PATCH" : "POST", body: JSON.stringify(body) });
      onListo(g.id);
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <Hoja titulo={grupo ? "Editar grupo" : "Nuevo grupo"} sobre="Capacitación ÁGIL" onClose={onClose} ocupada={ocupado}
      pie={<Boton onClick={guardar} ocupado={ocupado} disabled={f.nombre.trim().length < 2 || !f.fecha_inicio || (gestion && !grupo && !f.capacitador_id && !gente?.capacitadores.length)}>{grupo ? "Guardar" : "Crear grupo"}</Boton>}>
      <div className="space-y-4">
        <div><label className="label" htmlFor="gn">Nombre del grupo</label>
          <input id="gn" className="input" value={f.nombre} maxLength={120} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej.: Pospago · Octubre 2" /></div>
        <div><label className="label" htmlFor="go">Operación (opcional)</label>
          <input id="go" className="input" value={f.operacion} maxLength={120} onChange={(e) => setF({ ...f, operacion: e.target.value })} placeholder="Ej.: Claro Televentas" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="gi">Inicio</label>
            <input id="gi" type="date" className="input" value={f.fecha_inicio} onChange={(e) => setF({ ...f, fecha_inicio: e.target.value })} /></div>
          <div><label className="label" htmlFor="gf">Fin previsto</label>
            <input id="gf" type="date" className="input" value={f.fin_previsto} min={f.fecha_inicio} onChange={(e) => setF({ ...f, fin_previsto: e.target.value })} /></div>
        </div>
        {gestion && gente && (
          <div><span className="label">Capacitador</span>
            {gente.capacitadores.length ? (
              <Chips etiqueta="Capacitador" opciones={gente.capacitadores.map((c) => ({ v: c.id, label: c.nombre }))}
                valor={f.capacitador_id ? [f.capacitador_id] : []} onChange={(v) => setF({ ...f, capacitador_id: v[0] ?? "" })} />
            ) : <p className="text-sm text-brand-slate">No hay capacitadores habilitados: crealos en Usuarios con el perfil Capacitador.</p>}
            {!f.capacitador_id && <p className="text-[11px] text-brand-mist mt-1">Sin elegir: quedás vos como capacitador (si tenés esa utilidad).</p>}
          </div>
        )}
        {gente && (
          <div><span className="label">Mentores (la tarde, en piso)</span>
            {gente.mentores.length ? (
              <Chips multiple etiqueta="Mentores" opciones={gente.mentores.map((c) => ({ v: c.id, label: c.nombre }))} valor={f.mentores}
                onChange={(v) => setF({ ...f, mentores: v })} />
            ) : <p className="text-sm text-brand-slate">Todavía no hay mentores habilitados. Podés sumarlos después.</p>}
          </div>
        )}
        {error && <Fallo>{error}</Fallo>}
      </div>
    </Hoja>
  );
}

const VACIO = { nombre: "", apellido: "", ci: "", edad: "", sexo: "" as Sexo | "" };

/** Alta rápida: al guardar queda lista para el siguiente (la cédula no se repite en el grupo). */
export function HojaPostulante({ grupoId, editar, onClose, onListo }: {
  grupoId: string; editar?: Postulante; onClose: () => void; onListo: (p: Postulante, otro: boolean) => void;
}) {
  const [f, setF] = useState(editar ? { nombre: editar.nombre, apellido: editar.apellido, ci: editar.ci, edad: String(editar.edad), sexo: editar.sexo } : VACIO);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargados, setCargados] = useState(0);
  const edad = Number(f.edad);
  const listo = f.nombre.trim().length >= 2 && f.apellido.trim().length >= 2 && f.ci.trim().length >= 3 && edad >= 15 && edad <= 80 && !!f.sexo;
  const guardar = async (otro: boolean) => {
    setOcupado(true); setError(null);
    try {
      const p = await apiFetch<Postulante>(editar ? `${CAP_API}/postulantes/${editar.id}` : `${CAP_API}/grupos/${grupoId}/postulantes`,
        { method: editar ? "PATCH" : "POST", body: JSON.stringify({ ...f, edad }) });
      onListo(p, otro);
      if (otro) { setF(VACIO); setCargados((n) => n + 1); document.getElementById("pn")?.focus(); }
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <Hoja titulo={editar ? "Corregir datos" : "Agregar postulante"} sobre={cargados ? `${cargados} cargado${cargados > 1 ? "s" : ""} recién` : undefined}
      onClose={onClose} ocupada={ocupado}
      pie={<>
        {!editar && <Boton tipo="secundario" onClick={() => guardar(false)} disabled={!listo} ocupado={ocupado}>Guardar y cerrar</Boton>}
        <Boton icono={editar ? undefined : UserPlus} onClick={() => guardar(!editar)} disabled={!listo} ocupado={ocupado}>{editar ? "Guardar" : "Guardar y cargar otro"}</Boton>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="pn">Nombre</label>
            <input id="pn" className="input" autoComplete="off" value={f.nombre} maxLength={80} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
          <div><label className="label" htmlFor="pa">Apellido</label>
            <input id="pa" className="input" autoComplete="off" value={f.apellido} maxLength={80} onChange={(e) => setF({ ...f, apellido: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="pc">Cédula (CI)</label>
            <input id="pc" className="input" inputMode="numeric" autoComplete="off" value={f.ci} maxLength={20} onChange={(e) => setF({ ...f, ci: e.target.value })} /></div>
          <div><label className="label" htmlFor="pe">Edad</label>
            <input id="pe" className="input" inputMode="numeric" value={f.edad} maxLength={2} onChange={(e) => setF({ ...f, edad: e.target.value.replace(/\D/g, "") })} /></div>
        </div>
        <div><span className="label">Sexo</span>
          <Chips etiqueta="Sexo" opciones={SEXOS} valor={f.sexo ? [f.sexo] : []} onChange={(v) => setF({ ...f, sexo: v[0] ?? "" })} /></div>
        {error && <Fallo>{error}</Fallo>}
      </div>
    </Hoja>
  );
}

/**
 * Abre WhatsApp con el mensaje listo para elegir el chat. En el celular va directo a la aplicación (`whatsapp://`); si
 * no está instalada (la página sigue a la vista), cae a la web. En la computadora, WhatsApp Web / Desktop en otra pestaña.
 */
export function abrirWhatsapp(mensaje: string) {
  const t = encodeURIComponent(mensaje);
  const web = `https://wa.me/?text=${t}`;
  if (!/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) { window.open(web, "_blank", "noopener"); return; }
  const respaldo = window.setTimeout(() => { if (!document.hidden) window.location.href = web; }, 1500);
  document.addEventListener("visibilitychange", () => window.clearTimeout(respaldo), { once: true });
  window.location.href = `whatsapp://send?text=${t}`;
}

/** El link seguro del test IPV del postulante: QR para escanear en la sala, copiar o mandar por WhatsApp. */
export function HojaEnlace({ p, onClose, onCambio }: { p: Pick<Postulante, "id" | "nombre" | "apellido">; onClose: () => void; onCambio?: () => void }) {
  const [e, setE] = useState<Enlace | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => { apiFetch<Enlace>(`${CAP_API}/postulantes/${p.id}/enlace`).then(setE).catch((x) => setError(x.message)); }, [p.id]);
  const generar = async () => {
    setOcupado(true); setError(null);
    try { setE(await apiFetch<Enlace>(`${CAP_API}/postulantes/${p.id}/enlace`, { method: "POST", body: JSON.stringify({ origen: window.location.origin }) })); onCambio?.(); }
    catch (x: any) { setError(x.message); } finally { setOcupado(false); }
  };
  const anular = async () => {
    setOcupado(true);
    try { setE(await apiFetch<Enlace>(`${CAP_API}/postulantes/${p.id}/enlace`, { method: "DELETE" })); onCambio?.(); }
    catch (x: any) { setError(x.message); } finally { setOcupado(false); }
  };
  const texto = `Hola ${p.nombre}, este es tu link para el test de Voicenter (es personal, no lo compartas):`;
  const copiar = async () => { if (!e?.url) return; try { await navigator.clipboard.writeText(e.url); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sin portapapeles */ } };
  const compartir = async () => { if (e?.url && navigator.share) { try { await navigator.share({ title: "Test Voicenter", text: texto, url: e.url }); } catch { /* cancelado */ } } };
  return (
    <Hoja titulo="Link del test IPV" sobre={`${p.nombre} ${p.apellido}`} onClose={onClose} ocupada={ocupado}>
      <div className="space-y-4">
        {!e && !error && <div className="h-40 rounded-lg bg-brand-bg animate-pulse" />}
        {e?.ipv_estado === "terminado" && <p className="text-sm rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2">Ya terminó el test. El link sigue sirviendo para que deje su feedback.</p>}
        {e && e.url && (
          <>
            <div className="mx-auto w-56 h-56 bg-white p-2 rounded-lg border border-brand-border [&_svg]:w-full [&_svg]:h-full" dangerouslySetInnerHTML={{ __html: e.qr_svg ?? "" }} aria-label="Código QR del link" />
            <p className="text-center text-xs text-brand-slate">Que lo escanee con la cámara del celular. Vale hasta el {fecha(e.vence_at)}.
              {e.ipv_estado === "en_curso" && <> Lleva {e.respondidas} de {e.total} respondidas.</>}</p>
            <div className="grid grid-cols-2 gap-2">
              <Boton tipo="secundario" icono={Copy} onClick={copiar}>{copiado ? "¡Copiado!" : "Copiar"}</Boton>
              <Boton tipo="secundario" icono={MessageCircle} onClick={() => abrirWhatsapp(`${texto} ${e.url}`)}>WhatsApp</Boton>
            </div>
            {typeof navigator !== "undefined" && "share" in navigator && <Boton tipo="fantasma" icono={Share2} onClick={compartir}>Compartir…</Boton>}
            <div className="flex gap-2 pt-1">
              <Boton tipo="fantasma" icono={RefreshCcw} onClick={generar} ocupado={ocupado} className="!min-h-[44px] text-sm">Nuevo link</Boton>
              <Boton tipo="fantasma" icono={ShieldOff} onClick={anular} className="!min-h-[44px] text-sm">Anular</Boton>
            </div>
          </>
        )}
        {e && !e.url && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-brand-slate">{e.ipv_estado ? "El link está anulado o venció. Generá uno nuevo: lo que ya respondió se conserva." :
              "Generá su link personal: con él hace el test en su celular (no es obligatorio, pero ayuda mucho) y deja su feedback."}</p>
            <Boton icono={Link2} onClick={generar} ocupado={ocupado}>Generar link</Boton>
          </div>
        )}
        {error && <Fallo>{error}</Fallo>}
      </div>
    </Hoja>
  );
}

// ------------------------------------------------------------------ seguimiento
const ROL: Record<string, string> = { capacitador: "Capacitador", mentor: "Mentor", gestion: "Gestión", postulante: "El postulante" };
const TIPO: Record<Comentario["tipo"], { nombre: string; tono: "azul" | "naranja" | "gris" }> = {
  feedback: { nombre: "Feedback", tono: "azul" }, oportunidad: { nombre: "Oportunidad de mejora", tono: "naranja" }, postulante: { nombre: "Su feedback", tono: "gris" },
};

export function NuevoComentario({ pid, onListo }: { pid: string; onListo: () => void }) {
  const [tipo, setTipo] = useState<"feedback" | "oportunidad">("feedback");
  const [texto, setTexto] = useState("");
  const [audio, setAudio] = useState<AudioCoaching | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clave, setClave] = useState(0);
  const subir = useCallback((g: Parameters<typeof subirDictado>[1]) => subirDictado(`${CAP_API}/postulantes/${pid}/audios`, g), [pid]);
  const consultar = useCallback((id: string) => apiFetch<AudioCoaching>(`${CAP_API}/audios/${id}`), []);
  const guardar = async () => {
    setOcupado(true); setError(null);
    try {
      await apiFetch(`${CAP_API}/postulantes/${pid}/comentarios`, { method: "POST", body: JSON.stringify({ tipo, texto, audio_id: audio?.id ?? null }) });
      setTexto(""); setAudio(null); setClave((k) => k + 1); onListo();
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <div className="card p-4 space-y-3">
      <Chips etiqueta="Tipo" opciones={[{ v: "feedback", label: "Feedback" }, { v: "oportunidad", label: "Oportunidad de mejora" }]}
        valor={[tipo]} onChange={(v) => v[0] && setTipo(v[0] as typeof tipo)} />
      <Dictado key={clave} etiqueta="Dictar" ayuda="Tocá, hablá y tocá «Terminé»: el texto aparece solo." subir={subir} consultar={consultar}
        onSubido={setAudio} onTexto={(t) => setTexto((x) => (x ? `${x} ${t}` : t))} principal={false} />
      <textarea className="input min-h-[96px]" value={texto} maxLength={4000} onChange={(e) => setTexto(e.target.value)}
        placeholder={tipo === "feedback" ? "Qué hizo bien, cómo viene…" : "Qué tiene que mejorar y cómo…"} aria-label="Comentario" />
      {error && <Fallo>{error}</Fallo>}
      <Boton icono={Send} onClick={guardar} ocupado={ocupado} disabled={!texto.trim() && !audio}>Guardar comentario</Boton>
    </div>
  );
}

export function ListaComentarios({ items }: { items: Comentario[] }) {
  if (!items.length) return <div className="card p-6 text-sm text-brand-slate text-center">Todavía no hay comentarios de seguimiento.</div>;
  return (
    <ol className="card divide-y divide-brand-border overflow-hidden">
      {items.map((c) => (
        <li key={c.id} className="px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Etiqueta tono={TIPO[c.tipo].tono}>{TIPO[c.tipo].nombre}</Etiqueta>
            <span className="text-[12px] text-brand-slate">{c.autor ?? ROL[c.autor_rol]}{c.autor && ` · ${ROL[c.autor_rol] ?? ""}`} · {hace(c.at)}</span>
            {c.audio && <Mic size={14} className="text-brand-mist" aria-label="Dictado" />}
          </div>
          <p className="mt-1 text-[15px] text-brand-ink leading-snug whitespace-pre-wrap break-words">
            {c.texto || <span className="text-brand-slate italic">Transcribiendo el dictado…</span>}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function useConteoTexto(f: Ficha | null) {
  return f ? `${f.conteo.feedback} feedback · ${f.conteo.oportunidad} oportunidades · ${f.conteo.postulante} del postulante` : "";
}
