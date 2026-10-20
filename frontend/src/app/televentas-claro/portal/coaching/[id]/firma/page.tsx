"use client";

import { ArrowLeft, CircleCheck, House, MessageSquareText, PenLine } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ItemCard, diaCorto, useConstancia } from "@/components/portal/coaching";
import { FirmaPad, type FirmaPadRef } from "@/components/portal/firma-pad";
import { Dictado } from "@/components/portal/grabadora";
import { Boton, Cargando, Casilla, Fallo, PORTAL, Seccion } from "@/components/portal/ui";
import { hrefNuevoCoaching } from "@/components/supervision/hacer-coaching";
import { SUP_API, type AudioCoaching, type CoachingDetalle } from "@/components/supervision/tipos";
import { apiFetch } from "@/lib/api";

/** La devolución: el supervisor le pasa el celular al asesor, que lee sus compromisos, acepta y firma. Después firma él. */
export default function FirmaPage() {
  // Sin la barra de navegación: el asesor tiene el celular y no tiene que poder irse a otra pantalla por error.
  return <AppShell movil><Firma /></AppShell>;
}

function Firma() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<CoachingDetalle | null>(null);
  const [guardada, setGuardada] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [acepto, setAcepto] = useState(false);
  const [consiente, setConsiente] = useState(false);
  const [comentario, setComentario] = useState("");
  const [audioComentario, setAudioComentario] = useState<AudioCoaching | null>(null);
  const [grabando, setGrabando] = useState(false);
  const [firmoAsesor, setFirmoAsesor] = useState(false);
  const [firmoSup, setFirmoSup] = useState(false);
  const [usarGuardada, setUsarGuardada] = useState(true);
  const [recordar, setRecordar] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [listo, setListo] = useState<CoachingDetalle | null>(null);
  const padAsesor = useRef<FirmaPadRef>(null);
  const padSup = useRef<FirmaPadRef>(null);
  const constancia = useConstancia(listo);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [d, f] = await Promise.all([
        apiFetch<CoachingDetalle>(`${SUP_API}/portal/coaching/${id}`),
        apiFetch<{ imagen: string | null }>(`${SUP_API}/portal/firma`),
      ]);
      if (d.estado !== "pendiente") { router.replace(`${PORTAL}/coaching/${id}`); return; }
      setC(d);
      setGuardada(f.imagen);
    } catch (e: any) { setError(e.message); }
  }, [id, router]);
  useEffect(() => { cargar(); }, [cargar]);

  if (listo) {
    return (
      <div className="max-w-xl mx-auto text-center pt-6">
        <span className="mx-auto w-20 h-20 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center">
          <CircleCheck size={44} aria-hidden />
        </span>
        <h1 className="font-display text-4xl uppercase text-brand-ink mt-4">Coaching terminado</h1>
        <p className="text-[15px] text-brand-slate mt-2">
          {listo.operador} firmó sus compromisos. Cuenta como coaching hecho y el seguimiento queda para {diaCorto(listo.seguimiento_fecha)}.
        </p>
        <div className="mt-6 space-y-2 text-left">
          {constancia.boton}
          {constancia.error && <Fallo>{constancia.error}</Fallo>}
          <Boton icono={House} href={PORTAL}>Volver a Hoy</Boton>
          <Boton tipo="secundario" icono={MessageSquareText} href={hrefNuevoCoaching()}>Hacer otro coaching</Boton>
        </div>
      </div>
    );
  }
  if (error && !c) return <div className="max-w-xl mx-auto"><Fallo onReintentar={cargar}>{error}</Fallo></div>;
  if (!c || guardada === undefined) return <div className="max-w-xl mx-auto"><Cargando filas={4} /></div>;

  const nombre = c.operador.includes(",") ? c.operador.split(",")[1].trim().split(" ")[0] : c.operador.split(" ")[0];
  const vozAsesor = (c.audios ?? []).some((a) => a.hablante === "asesor") || !!audioComentario;
  const supervisorListo = (guardada && usarGuardada) || firmoSup;
  const puede = acepto && firmoAsesor && supervisorListo && (!vozAsesor || consiente) && !grabando;

  const confirmar = async () => {
    const imagen = padAsesor.current?.imagen();
    if (!imagen) { setError("Falta la firma del asesor"); return; }
    const imgSup = guardada && usarGuardada ? null : padSup.current?.imagen() ?? null;
    if (!guardada || !usarGuardada) { if (!imgSup) { setError("Falta tu firma"); return; } }
    setOcupado(true);
    setError(null);
    try {
      if (imgSup && recordar) {
        await apiFetch(`${SUP_API}/portal/firma`, { method: "PUT", body: JSON.stringify({ imagen: imgSup }) }).catch(() => undefined);
      }
      const d = await apiFetch<CoachingDetalle>(`${SUP_API}/portal/coaching/${c.id}/firmar`, {
        method: "POST",
        body: JSON.stringify({
          imagen, acepto: true, comentario: comentario.trim() || null, comentario_audio_id: audioComentario?.id ?? null,
          consentimiento_audio: consiente, imagen_supervisor: imgSup,
        }),
      });
      setListo(d);
      window.scrollTo({ top: 0 });
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center gap-1 mb-3">
        <Link href={`${PORTAL}/coaching/${c.id}`} aria-label="Volver al coaching" className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-brand-ink hover:bg-white">
          <ArrowLeft size={22} aria-hidden />
        </Link>
        <span className="text-[11px] uppercase tracking-wider2 text-brand-slate">Devolución · paso 4 de 4</span>
      </div>

      <div className="rounded-xl bg-brand-ink text-white px-5 py-5">
        <div className="text-[11px] uppercase tracking-wider2 text-white/60">Para {c.operador}</div>
        <h1 className="font-display text-[30px] uppercase leading-tight mt-1">{nombre}, estos son tus compromisos</h1>
        <ol className="mt-4 space-y-3">
          {(c.compromisos ?? []).map((x, i) => (
            <li key={x.id} className="flex gap-3">
              <span className="w-8 h-8 rounded-full bg-white text-brand-ink font-display text-lg flex items-center justify-center shrink-0" aria-hidden>{i + 1}</span>
              <div className="min-w-0">
                <p className="text-lg font-semibold leading-snug break-words">{x.texto}</p>
                {x.para && <p className="text-sm text-white/70 mt-0.5">Para {diaCorto(x.para)}</p>}
              </div>
            </li>
          ))}
        </ol>
        <p className="text-sm text-white/75 mt-4 border-t border-white/15 pt-3">Lo revisan juntos {diaCorto(c.seguimiento_fecha)}.</p>
      </div>

      {(c.items?.length ?? 0) > 0 && (
        <details className="card mt-3">
          <summary className="px-4 min-h-[56px] flex items-center cursor-pointer font-semibold text-brand-ink">Lo que vio tu supervisor ({c.items!.length})</summary>
          <div className="px-3 pb-3 space-y-2">{c.items!.map((it) => <ItemCard key={it.id} it={it} />)}</div>
        </details>
      )}

      <Seccion titulo="¿Querés agregar algo?" sub="Opcional: un comentario tuyo sobre el coaching." className="mt-6">
        <div className="space-y-3">
          <Dictado coachingId={c.id} hablante="asesor" destino="comentario" etiqueta="Decirlo en voz alta" principal={false} onGrabando={setGrabando}
            onSubido={setAudioComentario} onTexto={(t) => setComentario((p) => (p.trim() ? `${p.trim()} ${t}` : t))} />
          <textarea className="input !text-base min-h-[90px]" value={comentario} maxLength={1000} onChange={(e) => setComentario(e.target.value)}
            placeholder="O escribilo acá." aria-label="Comentario del asesor" />
        </div>
      </Seccion>

      <div className="mt-6 space-y-2">
        {vozAsesor && (
          <Casilla checked={consiente} onChange={setConsiente} sub="Tu voz queda guardada como registro de este coaching, solo para la gerencia.">
            Acepto que mi voz quede grabada
          </Casilla>
        )}
        <Casilla checked={acepto} onChange={setAcepto}>Leí mis compromisos y los acepto</Casilla>
      </div>

      <Seccion titulo={`Firma de ${nombre}`} className="mt-6">
        <FirmaPad ref={padAsesor} etiqueta="Firma del asesor" onCambio={(v) => setFirmoAsesor(!v)} />
      </Seccion>

      <div className="mt-6 rounded-xl border-2 border-dashed border-brand-border p-4">
        <div className="flex items-center gap-2 text-brand-ink font-semibold"><PenLine size={18} aria-hidden /> Ahora firmás vos, {c.supervisor.split(" ")[0]}</div>
        {guardada && usarGuardada ? (
          <div className="mt-3">
            <div className="card p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={guardada} alt="Tu firma guardada" className="h-20 w-full object-contain" />
            </div>
            <p className="text-sm text-brand-slate mt-2">Se usa tu firma guardada.</p>
            <button type="button" onClick={() => setUsarGuardada(false)} className="min-h-[44px] text-sm font-semibold text-brand-primary">Firmar de nuevo</button>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <FirmaPad ref={padSup} etiqueta="Firma del supervisor" alto="h-40" onCambio={(v) => setFirmoSup(!v)} />
            <Casilla checked={recordar} onChange={setRecordar}>Guardarla para las próximas devoluciones</Casilla>
            {guardada && <button type="button" onClick={() => setUsarGuardada(true)} className="min-h-[44px] text-sm font-semibold text-brand-primary">Usar mi firma guardada</button>}
          </div>
        )}
      </div>

      {error && <div className="mt-4"><Fallo>{error}</Fallo></div>}
      <div className="mt-6 pb-[env(safe-area-inset-bottom)]">
        <Boton icono={CircleCheck} onClick={confirmar} disabled={!puede} ocupado={ocupado}>Confirmar y terminar</Boton>
        {!puede && (
          <p className="text-xs text-brand-slate text-center mt-2">
            {!acepto ? "Falta aceptar los compromisos." : !firmoAsesor ? `Falta la firma de ${nombre}.` : vozAsesor && !consiente
              ? "Falta aceptar la grabación de la voz." : !supervisorListo ? "Falta tu firma." : grabando ? "Terminá la grabación." : ""}
          </p>
        )}
      </div>
    </div>
  );
}
