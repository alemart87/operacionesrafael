"use client";

/**
 * El link del postulante (sin usuario): el test IPV en el celular, una situación por pantalla, que se guarda a medida
 * que contesta y se puede seguir después con el mismo link; y su feedback, escrito o dictado. No muestra resultados.
 */
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, CircleCheck, ClipboardCheck, Clock3, CloudOff, GraduationCap, ListChecks, LoaderCircle, Lock,
  Eye, MessageSquareHeart, MessagesSquare, Pause, Play, Save, Scale, Send, Timer, TriangleAlert, UserRound,
} from "lucide-react";
import { Chat, type Entrenador, type PasoChat } from "@/components/capacitacion/chat";
import { conIntento, type Consejo, type ConsejosTurno, type DevolucionCaso, type MensajeChat } from "@/components/capacitacion/tipos";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "@/components/Brand";
import { subirDictado } from "@/components/capacitacion/tipos";
import { Dictado } from "@/components/portal/grabadora";
import { Boton, cx } from "@/components/portal/ui";
import type { AudioCoaching } from "@/components/supervision/tipos";

const API = "/api/v1/capacitacion/publico";

interface EntLink { id: string; nombre: string; intento?: number; estado: string; casos: number; hechos: number; pct: number; guiado?: boolean }
/** El informe de un test que venció sin terminar (se reinició completo). */
interface Vencido { iniciado_at: string | null; vencio_at: string; respondidas: number; total: number; minutos: number }
interface IpvEstado {
  estado: string; respondidas: number; total: number; minutos?: number;
  /** Hasta cuándo puede responder (lo pone el servidor) y la hora del servidor, para corregir el reloj del teléfono. */
  limite_at?: string | null; ahora?: string; vencido?: Vencido | null;
}
interface Estado { nombre: string; grupo: string; ipv: IpvEstado; comentarios?: number; entrenamientos?: EntLink[] }
interface Pregunta { n: number; texto: string; opciones: { letra: string; texto: string }[] }
type Vista = "inicio" | "instrucciones" | "test" | "enviar" | "gracias" | "feedback" | "vencido" | { t: "entrenamiento"; id: string };
/** El tiempo del test en palabras: «45 minutos» o «1 h 15 min». */
const tiempoTest = (m: number) => (m < 60 ? `${m} minutos` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);
const horaPY = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit", timeZone: "America/Asuncion" }) : "—");

async function pub<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) {
    const d = b?.detail;
    const e = new Error(typeof d === "string" ? d : d?.message ?? "No se pudo conectar. Probá de nuevo.");
    (e as any).status = r.status;
    (e as any).code = typeof d === "object" ? d?.code : undefined;
    throw e;
  }
  return b as T;
}

export default function PostulantePage() {
  const { token } = useParams<{ token: string }>();
  const base = `${API}/${encodeURIComponent(token)}`;
  const [info, setInfo] = useState<Estado | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("inicio");
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 4000); return () => clearTimeout(t); }, [aviso]);

  const cargar = useCallback(() => {
    pub<Estado>(base).then((x) => { setInfo(x); setFallo(null); }).catch((e) => setFallo(e.message));
  }, [base]);
  useEffect(cargar, [cargar]);
  // «Empezar el test»: el servidor pone en marcha el reloj y recién ahí se muestra la primera situación.
  const empezar = async () => {
    try { setInfo({ ...info!, ipv: (await pub<Estado>(`${base}/ipv/iniciar`, { method: "POST" })).ipv }); setVista("test"); }
    catch (e: any) { setFallo(e.message); }
  };

  return (
    <div className="min-h-[100dvh] bg-brand-bg flex flex-col">
      <header className="bg-white border-b border-brand-border px-4 py-3 flex items-center justify-between">
        <Brand logoHeight={32} compactOnPhone />
        {info && <span className="text-[11px] uppercase tracking-wider2 text-brand-slate truncate max-w-[50%]">{info.grupo}</span>}
      </header>
      <main className={cx("flex-1 w-full mx-auto px-4 pt-4 pb-2 flex flex-col", typeof vista === "object" ? "max-w-lg lg:max-w-5xl lg:pt-8" : "max-w-lg")}>
        {fallo && (
          <div className="m-auto text-center space-y-3 py-16">
            <TriangleAlert size={40} className="mx-auto text-brand-primary" aria-hidden />
            <p className="text-lg font-semibold text-brand-ink">{fallo}</p>
          </div>
        )}
        {aviso && vista === "inicio" && <div role="status" className="mb-4 rounded-xl bg-brand-ink text-white text-[14px] font-semibold px-4 py-3 animate-fade">{aviso}</div>}
        {!info && !fallo && <div className="m-auto"><LoaderCircle size={32} className="animate-spin text-brand-slate" aria-label="Cargando" /></div>}
        {info && vista === "inicio" && <Inicio info={info} onTest={() => setVista(info.ipv.vencido ? "vencido" : info.ipv.estado === "en_curso" ? "test" : "instrucciones")} onFeedback={() => setVista("feedback")}
          onEntrenamiento={(id) => setVista({ t: "entrenamiento", id })} />}
        {info && typeof vista === "object" && <EntrenamientoLink base={base} id={vista.id} onVolver={() => { setVista("inicio"); cargar(); }} />}
        {info && vista === "instrucciones" && <Instrucciones nombre={info.nombre} minutos={info.ipv.minutos ?? 75} onEmpezar={empezar} />}
        {info && vista === "vencido" && info.ipv.vencido && <TestVencido v={info.ipv.vencido} nombre={info.nombre} onEmpezar={() => setVista("instrucciones")} onVolver={() => setVista("inicio")} />}
        {info && (vista === "test" || vista === "enviar") && (
          <Test base={base} token={token} onTerminado={() => { setVista("gracias"); cargar(); }}
            onVencido={() => { pub<Estado>(base).then((x) => { setInfo(x); setVista(x.ipv.vencido ? "vencido" : "inicio"); }).catch((e) => setFallo(e.message)); }}
            onSalir={(pausa) => { setVista("inicio"); cargar(); if (pausa) setAviso("Quedó guardado. Ojo: el reloj del test sigue corriendo; volvé antes de que se termine el tiempo."); }} />
        )}
        {info && vista === "gracias" && <Gracias nombre={info.nombre} onFeedback={() => setVista("feedback")} />}
        {info && vista === "feedback" && <Feedback base={base} onVolver={() => { setVista("inicio"); cargar(); }} />}
      </main>
    </div>
  );
}

function Inicio({ info, onTest, onFeedback, onEntrenamiento }: { info: Estado; onTest: () => void; onFeedback: () => void; onEntrenamiento: (id: string) => void }) {
  const hecho = info.ipv.estado === "terminado";
  const pct = Math.round((info.ipv.respondidas / info.ipv.total) * 100);
  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Capacitación Voicenter</div>
        <h1 className="font-display text-[38px] uppercase leading-[1.05] text-brand-ink">Hola, <span className="text-brand-primary">{info.nombre}</span></h1>
        <p className="text-[15px] text-brand-slate mt-1">Este link es personal: no lo compartas.</p>
      </div>
      <button type="button" onClick={hecho ? undefined : onTest} disabled={hecho}
        className={cx("w-full text-left card p-5 min-h-[96px]", !hecho && "active:scale-[0.99] hover:shadow-elevated")}>
        <span className="flex items-center gap-4">
          <span className={cx("w-12 h-12 rounded-xl flex items-center justify-center shrink-0", hecho ? "bg-emerald-50 text-emerald-700" : "bg-brand-primary text-white")}>
            {hecho ? <CircleCheck size={26} aria-hidden /> : <ClipboardCheck size={26} aria-hidden />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-[17px] text-brand-ink">Test de perfil comercial</span>
            <span className={cx("block text-sm", info.ipv.vencido && !hecho ? "text-brand-primary-dark font-semibold" : "text-brand-slate")}>
              {hecho ? "¡Listo! Ya lo terminaste."
                : info.ipv.vencido ? "Se terminó el tiempo: tenés que volver a empezar"
                : info.ipv.estado === "en_curso" ? `Seguí donde quedaste · ${pct}% hecho · termina a las ${horaPY(info.ipv.limite_at)}`
                : `${info.ipv.total} situaciones · ${tiempoTest(info.ipv.minutos ?? 75)} para hacerlo`}
            </span>
          </span>
          {!hecho && <ChevronRight size={20} className="text-brand-mist shrink-0" aria-hidden />}
        </span>
        {!hecho && !info.ipv.vencido && info.ipv.respondidas > 0 && (
          <span className="mt-3 block h-2 rounded-full bg-brand-bg overflow-hidden" aria-hidden>
            <span className="block h-full rounded-full bg-brand-primary" style={{ width: `${pct}%` }} />
          </span>
        )}
      </button>
      {(info.entrenamientos ?? []).length > 0 && (
        <div className="space-y-2.5">
          <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate pt-1">Tus entrenamientos</div>
          {(info.entrenamientos ?? []).map((x) => {
            const listo = x.estado === "terminado" || x.estado === "evaluando";
            return (
              <button key={x.id} type="button" onClick={() => onEntrenamiento(x.id)} className="w-full text-left card p-4 active:scale-[0.99] hover:shadow-elevated">
                <span className="flex items-center gap-3">
                  <span className={cx("w-11 h-11 rounded-xl flex items-center justify-center shrink-0", listo ? "bg-emerald-50 text-emerald-700" : "bg-brand-ink text-white")}>
                    {listo ? <CircleCheck size={22} aria-hidden /> : <MessagesSquare size={22} aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap font-semibold text-[16px] text-brand-ink">{conIntento(x.nombre, x.intento)}
                      {x.guiado && <span className="inline-flex items-center gap-1 rounded-full bg-[#2A78D6]/10 text-[#1D5BA6] text-[11px] font-semibold px-2 py-0.5"><GraduationCap size={12} aria-hidden /> Guiado</span>}</span>
                    <span className="block text-[13px] text-brand-slate">{listo ? "¡Listo! Ya lo hiciste." : x.hechos ? `Seguí · ${x.hechos} de ${x.casos} clientes` : `${x.casos} cliente${x.casos === 1 ? "" : "s"} para atender por chat`}</span>
                  </span>
                  <ChevronRight size={20} className="text-brand-mist shrink-0" aria-hidden />
                </span>
                {!listo && x.hechos > 0 && <span className="mt-3 block h-2 rounded-full bg-brand-bg overflow-hidden" aria-hidden><span className="block h-full rounded-full bg-brand-ink" style={{ width: `${x.pct}%` }} /></span>}
              </button>
            );
          })}
        </div>
      )}
      <button type="button" onClick={onFeedback} className="w-full text-left card p-5 flex items-center gap-4 min-h-[96px] active:scale-[0.99] hover:shadow-elevated">
        <span className="w-12 h-12 rounded-xl bg-brand-ink text-white flex items-center justify-center shrink-0"><MessageSquareHeart size={26} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-[17px] text-brand-ink">Tu feedback</span>
          <span className="block text-sm text-brand-slate">Contanos cómo te va en la capacitación: escribilo o dictalo.</span>
        </span>
        <ChevronRight size={20} className="text-brand-mist shrink-0" aria-hidden />
      </button>
    </div>
  );
}

const PASOS_INSTRUCCIONES: { icono: typeof Clock3; titulo: string; texto: React.ReactNode }[] = [
  { icono: ListChecks, titulo: "87 situaciones, una por pantalla", texto: "Elegí la opción que más se parezca a lo que harías o pensás." },
  { icono: UserRound, titulo: "«B…» es una persona imaginaria", texto: "Muchas situaciones nombran a alguien solo con una inicial: ponete en su lugar." },
  { icono: Scale, titulo: "No hay respuestas buenas ni malas", texto: "Respondé con sinceridad y sin pensarlo demasiado." },
  { icono: Lock, titulo: "Sin volver atrás", texto: "Elegí una opción y tocá «Siguiente»: tu respuesta queda guardada y ya no se puede cambiar. Leé con atención." },
  { icono: Save, titulo: "Se guarda solo", texto: "Podés pausar y seguir con el mismo link desde donde quedaste, mientras no se termine el tiempo." },
];

function Instrucciones({ nombre, minutos, onEmpezar }: { nombre: string; minutos: number; onEmpezar: () => void }) {
  const [empezando, setEmpezando] = useState(false);
  const pasos = [
    { icono: Timer, titulo: `Tenés ${tiempoTest(minutos)}`, texto: <>El tiempo empieza al tocar «Empezar el test» y <b className="text-brand-ink">no se detiene si pausás</b>. Si no terminás a tiempo, el test se reinicia completo y tenés que empezar de nuevo. Buscá un lugar tranquilo.</> },
    ...PASOS_INSTRUCCIONES,
  ];
  return (
    <div className="flex-1 flex flex-col">
      <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Test de perfil comercial</div>
      <h1 className="font-display text-[32px] uppercase text-brand-ink leading-tight">Antes de empezar, {nombre}</h1>
      <ul className="mt-5 space-y-4">
        {pasos.map(({ icono: I, titulo, texto }) => (
          <li key={titulo} className="flex gap-3">
            <span className="w-10 h-10 rounded-xl bg-white border border-brand-border text-brand-ink flex items-center justify-center shrink-0"><I size={20} aria-hidden /></span>
            <span className="min-w-0">
              <span className="block text-[16px] font-semibold text-brand-ink leading-snug">{titulo}</span>
              <span className="block text-[14px] text-brand-slate leading-snug">{texto}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-6 sticky bottom-0 pb-[env(safe-area-inset-bottom)] bg-brand-bg">
        <Boton icono={Play} ocupado={empezando} onClick={async () => { setEmpezando(true); try { await onEmpezar(); } finally { setEmpezando(false); } }}>
          Empezar el test · {tiempoTest(minutos)}
        </Boton>
      </div>
    </div>
  );
}

const HITOS: Record<number, string> = { 25: "¡Ya hiciste un cuarto! Seguí así.", 50: "¡Vas por la mitad!", 75: "¡Falta poco! Ya hiciste tres cuartos." };

/** El IPV, una situación por pantalla y siempre hacia adelante: elige una opción (puede cambiarla mientras no siga) y al
 * tocar «Siguiente» la respuesta queda guardada y fija. No hay vuelta atrás ni revisión: el servidor tampoco acepta
 * cambios ni saltear situaciones. Sin señal, lo confirmado espera en el teléfono y se sube solo. */
function Test({ base, token, onTerminado, onSalir, onVencido }: {
  base: string; token: string; onTerminado: () => void; onSalir: (pausa?: boolean) => void;
  /** Se terminó el tiempo sin terminar el test (el servidor lo reinicia y muestra el informe). */
  onVencido: () => void;
}) {
  const clave = `ipv:${token.slice(0, 16)}`;
  const [preguntas, setPreguntas] = useState<Pregunta[] | null>(null);
  const [resp, setResp] = useState<Record<string, string>>({});       // confirmadas: ya no cambian
  const [marcada, setMarcada] = useState<string | null>(null);         // la elegida en esta situación, sin confirmar
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [sync, setSync] = useState<"ok" | "guardando" | "sin_red">("ok");
  const [cerrando, setCerrando] = useState<"enviando" | "error" | null>(null);
  const [hito, setHito] = useState<string | null>(null);
  const pendientes = useRef<Record<string, string>>({});
  const enVuelo = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // El reloj del test: el límite lo pone el servidor; se corrige la diferencia con la hora del teléfono.
  const [limite, setLimite] = useState<number | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [sinTiempo, setSinTiempo] = useState(false);
  const avisos = useRef(new Set<number>());

  // Lo del servidor manda; del teléfono solo se suma lo que todavía no subió (lo confirmado sin señal).
  const cargar = useCallback(async () => {
    let x = await pub<{ preguntas: Pregunta[]; respuestas: Record<string, string>; ipv: IpvEstado }>(`${base}/ipv`);
    if (x.ipv.estado === "terminado") { onTerminado(); return; }
    if (x.ipv.vencido) { onVencido(); return; }
    if (x.ipv.estado === "pendiente") {
      // Llegó sin empezar (por ejemplo, con una pantalla vieja): empieza a correr el tiempo ahora.
      await pub(`${base}/ipv/iniciar`, { method: "POST" });
      x = await pub(`${base}/ipv`);
    }
    if (x.ipv.limite_at && x.ipv.ahora) setLimite(Date.parse(x.ipv.limite_at) - (Date.parse(x.ipv.ahora) - Date.now()));
    let local: Record<string, string> = {};
    try { local = JSON.parse(localStorage.getItem(clave) ?? "{}"); } catch { /* sin almacenamiento */ }
    const propias = Object.fromEntries(Object.entries(local).filter(([k]) => !(k in x.respuestas)));
    pendientes.current = propias;
    setPreguntas(x.preguntas);
    setResp({ ...propias, ...x.respuestas });
    setMarcada(null);
    if (Object.keys(propias).length) programar(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  useEffect(() => { cargar().catch((e) => setError(e.message)); }, [cargar]);

  // Si el servidor no acepta lo del teléfono (otra respuesta ya guardada, o fuera de orden), se sigue desde lo suyo.
  const resincronizar = async () => {
    try { localStorage.removeItem(clave); } catch { /* nada */ }
    pendientes.current = {};
    await cargar();
    setAviso("Retomamos desde tus respuestas guardadas.");
  };

  const enviarPendientes = useCallback(async () => {
    if (enVuelo.current) { programar(400); return; }      // de a un envío, para que lleguen en orden
    const lote = pendientes.current;
    if (!Object.keys(lote).length) return;
    pendientes.current = {};
    enVuelo.current = true;
    setSync("guardando");
    try {
      await pub(`${base}/ipv`, { method: "PUT", body: JSON.stringify({ respuestas: lote }) });
      setSync(Object.keys(pendientes.current).length ? "guardando" : "ok");
    } catch (e: any) {
      if (e?.code === "ipv_vencido") { onVencido(); return; }
      if (e?.code === "respuesta_fija" || e?.code === "fuera_de_orden") { await resincronizar(); setSync("ok"); return; }
      if (e?.status === 409) { onTerminado(); return; }
      pendientes.current = { ...lote, ...pendientes.current };
      setSync("sin_red");
      programar(5000);
    } finally {
      enVuelo.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  function programar(ms: number) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(enviarPendientes, ms);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const volver = () => programar(0);
    // Si cierra la pestaña con respuestas sin subir, avisa (igual quedan guardadas en el celular).
    const salir = (ev: BeforeUnloadEvent) => { if (Object.keys(pendientes.current).length) { ev.preventDefault(); ev.returnValue = ""; } };
    window.addEventListener("online", volver);
    window.addEventListener("beforeunload", salir);
    return () => { window.removeEventListener("online", volver); window.removeEventListener("beforeunload", salir); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (!hito) return; const t = setTimeout(() => setHito(null), 2600); return () => clearTimeout(t); }, [hito]);
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 4000); return () => clearTimeout(t); }, [aviso]);

  // Cada segundo: el reloj, los avisos de 10 y 5 minutos y, a los 0, el informe (el servidor reinicia el test).
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(t); }, []);
  const quedan = limite === null ? null : Math.max(0, Math.floor((limite - ahora) / 1000));
  useEffect(() => {
    if (quedan === null || cerrando) return;
    for (const min of [10, 5]) {
      if (quedan <= min * 60 && quedan > 0 && !avisos.current.has(min)) { avisos.current.add(min); setHito(`Quedan ${min} minutos para terminar el test.`); }
    }
    if (quedan === 0 && !sinTiempo) {
      setSinTiempo(true);
      if (timer.current) clearTimeout(timer.current);
      setTimeout(onVencido, 2500);       // un margen para que el servidor ya lo dé por vencido
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quedan]);
  const dos = (n: number) => String(n).padStart(2, "0");
  const reloj = quedan === null ? "--:--" : quedan >= 3600
    ? `${Math.floor(quedan / 3600)}:${dos(Math.floor((quedan % 3600) / 60))}:${dos(quedan % 60)}` : `${Math.floor(quedan / 60)}:${dos(quedan % 60)}`;

  const total = preguntas?.length ?? 87;
  const respondidas = Object.keys(resp).length;
  const pct = Math.round((respondidas / total) * 100);
  // Siempre la primera sin responder: no se puede ir a otra.
  const i = preguntas ? preguntas.findIndex((q) => !resp[String(q.n)]) : -1;

  const terminar = async (todas: Record<string, string>) => {
    if (timer.current) clearTimeout(timer.current);
    pendientes.current = {};
    setCerrando("enviando"); setError(null);
    try {
      await pub(`${base}/ipv/terminar`, { method: "POST", body: JSON.stringify({ respuestas: todas }) });
      try { localStorage.removeItem(clave); } catch { /* nada */ }
      onTerminado();
    } catch (e: any) {
      if (e?.code === "ipv_vencido") { onVencido(); return; }
      if (e?.code === "respuesta_fija" || e?.code === "fuera_de_orden") { setCerrando(null); await resincronizar(); return; }
      setError(e.message); setCerrando("error");
    }
  };

  const seguir = () => {
    if (!preguntas || i < 0 || !marcada) return;
    const n = String(preguntas[i].n);
    const nuevas = { ...resp, [n]: marcada };
    setResp(nuevas);
    setMarcada(null);
    try { navigator.vibrate?.(8); } catch { /* sin vibración */ }
    try { localStorage.setItem(clave, JSON.stringify(nuevas)); } catch { /* sin almacenamiento */ }
    const antes = Math.floor((respondidas / total) * 4), despues = Math.floor((Object.keys(nuevas).length / total) * 4);
    if (despues > antes && despues < 4) setHito(HITOS[despues * 25]);
    window.scrollTo({ top: 0 });
    if (Object.keys(nuevas).length === total) { terminar(nuevas); return; }
    pendientes.current[n] = nuevas[n];
    programar(300);
  };

  // En la computadora: A/B/C eligen y Enter sigue. No hay tecla para volver.
  useEffect(() => {
    if (!preguntas || i < 0 || cerrando) return;
    const tecla = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const letra = ev.key.toUpperCase();
      if (preguntas[i].opciones.some((o) => o.letra === letra)) { ev.preventDefault(); setMarcada(letra); }
      else if (ev.key === "Enter" && marcada) { ev.preventDefault(); seguir(); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  const pausar = async () => {
    if (timer.current) clearTimeout(timer.current);
    await enviarPendientes();
    onSalir(true);
  };

  if (error && !preguntas) return <p className="m-auto text-center text-brand-primary-dark font-semibold">{error}</p>;
  if (!preguntas) return <div className="m-auto"><LoaderCircle size={32} className="animate-spin text-brand-slate" aria-label="Cargando" /></div>;

  if (sinTiempo && cerrando !== "enviando") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-2" role="alert">
        <Timer size={48} className="text-brand-primary" aria-hidden />
        <h1 className="font-display text-[30px] uppercase text-brand-ink mt-3 leading-tight">Se terminó el tiempo</h1>
        <p className="text-[15px] text-brand-slate mt-1 inline-flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" aria-hidden /> Preparando tu informe…</p>
      </div>
    );
  }

  // Respondió las 87: se envía solo (si se cortó, se reintenta con un toque; no hay nada para revisar ni cambiar).
  if (i < 0 || cerrando) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
        {cerrando === "enviando" ? <LoaderCircle size={44} className="animate-spin text-brand-slate" aria-hidden /> : <CircleCheck size={48} className="text-emerald-600" aria-hidden />}
        <h1 className="font-display text-[30px] uppercase text-brand-ink mt-3 leading-tight">¡Respondiste las {total}!</h1>
        <p className="text-[15px] text-brand-slate mt-1" aria-live="polite">
          {cerrando === "enviando" ? "Enviando tu test…" : "Falta enviarlo. Tus respuestas ya quedaron guardadas."}
        </p>
        {error && <p className="mt-3 text-sm text-brand-primary-dark" role="alert">{error}</p>}
        {cerrando !== "enviando" && <div className="mt-6 w-full max-w-sm"><Boton icono={Send} onClick={() => terminar(resp)}>Enviar el test</Boton></div>}
      </div>
    );
  }

  const p = preguntas[i];
  const ultima = respondidas === total - 1;
  return (
    <div className="flex-1 flex flex-col">
      {/* Progreso: siempre a la vista */}
      <div className="sticky top-0 z-10 -mx-4 px-4 pt-1 pb-3 bg-brand-bg/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-2xl text-brand-ink tabular-nums leading-none">{pct}%</span>
            <span className="text-[13px] text-brand-slate tabular-nums">{respondidas} de {total}</span>
          </div>
          <span role="timer" aria-label={`Tiempo que queda: ${reloj}`} title="Tiempo que queda para terminar el test (no se detiene al pausar)"
            className={cx("ml-auto inline-flex items-center gap-1 rounded-full px-2.5 min-h-[32px] text-[14px] font-bold tabular-nums",
              quedan !== null && quedan <= 300 ? "bg-red-50 text-red-700 border border-red-200" : quedan !== null && quedan <= 600 ? "bg-amber-50 text-amber-800 border border-amber-200" : "bg-white text-brand-ink border border-brand-border")}>
            <Timer size={14} aria-hidden /> {reloj}
          </span>
          <button type="button" onClick={pausar} className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-full border border-brand-border bg-white text-[13px] font-semibold text-brand-ink">
            <Pause size={14} aria-hidden /> Pausar
          </button>
        </div>
        <div className="mt-2 h-2 rounded-full bg-white overflow-hidden border border-brand-border" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Avance del test">
          <div className="h-full rounded-full bg-brand-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 h-4 text-[11px] text-brand-slate inline-flex items-center gap-1" aria-live="polite">
          {sync === "sin_red" ? <><CloudOff size={12} aria-hidden /> Sin señal: guardado en el celular</> : sync === "guardando" ? "Guardando…" : respondidas ? <><Check size={12} aria-hidden /> Guardado</> : ""}
        </div>
      </div>

      {hito && <div role="status" className="mb-3 rounded-xl bg-brand-ink text-white text-[14px] font-semibold px-4 py-2.5 animate-fade">{hito}</div>}
      {aviso && <div role="status" className="mb-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[14px] px-4 py-2.5 animate-fade">{aviso}</div>}

      <div key={p.n} className="entra-der">
        <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate">Situación {i + 1} de {total}</div>
        {INICIAL.test(p.texto) && (
          <p className="mt-1 text-[13px] leading-snug text-brand-slate">
            «{p.texto.match(INICIAL)?.[1]}…» es una persona imaginaria: elegí lo que vos harías o pensarías en su lugar.
          </p>
        )}
        <p className="mt-3 text-[20px] leading-snug text-brand-ink font-medium" id={`q${p.n}`}><Texto t={p.texto} /></p>
        <div role="radiogroup" aria-labelledby={`q${p.n}`} className="mt-5 space-y-2.5">
          {p.opciones.map((o) => {
            const on = marcada === o.letra;
            return (
              <button key={o.letra} type="button" role="radio" aria-checked={on} onClick={() => setMarcada(o.letra)}
                className={cx("w-full min-h-[64px] text-left rounded-2xl border-2 px-4 py-3.5 flex items-start gap-3 transition-colors",
                  on ? "border-brand-ink bg-brand-ink text-white shadow-soft opcion-elegida" : "border-brand-border bg-white text-brand-ink hover:border-brand-ink active:bg-brand-bg-soft")}>
                <span className={cx("w-8 h-8 rounded-full text-sm font-bold flex items-center justify-center shrink-0", on ? "bg-white text-brand-ink" : "bg-brand-bg text-brand-slate")}>
                  {on ? <Check size={16} strokeWidth={3} aria-hidden /> : o.letra}
                </span>
                <span className="text-[16px] leading-snug pt-1">{o.texto}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Un solo botón, siempre hacia adelante */}
      <div className="mt-auto pt-6 sticky bottom-0 pb-[calc(8px+env(safe-area-inset-bottom))] bg-brand-bg">
        <p className="text-center text-[12px] text-brand-slate mb-2 inline-flex w-full items-center justify-center gap-1.5">
          <Lock size={12} aria-hidden /> Al seguir, tu respuesta queda guardada y no se puede cambiar.
        </p>
        <Boton icono={ultima ? Send : undefined} onClick={seguir} disabled={!marcada} className="!min-h-[52px]">
          {!marcada ? "Elegí una opción" : ultima ? "Enviar el test" : <>Siguiente <ArrowRight size={18} aria-hidden /></>}
        </Boton>
      </div>
    </div>
  );
}

/** El informe para el postulante cuando se le terminó el tiempo: qué pasó y que tiene que volver a empezar. */
function TestVencido({ v, nombre, onEmpezar, onVolver }: { v: Vencido; nombre: string; onEmpezar: () => void; onVolver: () => void }) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="text-center pt-2">
        <span className="mx-auto w-14 h-14 rounded-2xl bg-brand-primary-light text-brand-primary flex items-center justify-center"><Timer size={30} aria-hidden /></span>
        <div className="mt-3 text-[11px] uppercase tracking-wider2 text-brand-slate">Test de perfil comercial</div>
        <h1 className="font-display text-[30px] uppercase text-brand-ink leading-tight">Se terminó el tiempo</h1>
      </div>
      <div className="card mt-5 divide-y divide-brand-border" aria-label="Informe">
        {[["Empezaste", horaPY(v.iniciado_at)], ["Se terminó el tiempo", horaPY(v.vencio_at)], ["Tiempo disponible", tiempoTest(v.minutos)],
          ["Respondiste", `${v.respondidas} de ${v.total} situaciones`]].map(([k, x]) => (
          <div key={k} className="px-4 py-3 flex items-center justify-between gap-3 text-[15px]">
            <span className="text-brand-slate">{k}</span><span className="font-semibold text-brand-ink tabular-nums text-right">{x}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-brand-primary/30 bg-brand-primary-light/60 px-4 py-3 text-[14px] text-brand-ink leading-snug">
        {nombre}, por seguridad el test tiene que hacerse completo en {tiempoTest(v.minutos)}. Como no lo terminaste a tiempo,
        <b> se reinició y tus respuestas se borraron</b>. Tenés que <b>volver a empezar desde la situación 1</b>; vas a tener
        otra vez {tiempoTest(v.minutos)}. Antes de empezar, buscá un lugar tranquilo y tiempo suficiente.
      </div>
      <div className="mt-auto pt-6 sticky bottom-0 pb-[env(safe-area-inset-bottom)] bg-brand-bg space-y-2">
        <Boton icono={Play} onClick={onEmpezar}>Volver a empezar el test</Boton>
        <Boton tipo="fantasma" onClick={onVolver}>Ahora no</Boton>
      </div>
    </div>
  );
}

/** La persona de la situación: una inicial seguida de puntos suspensivos («B...»). */
const INICIAL = /\b([A-ZÁÉÍÓÚÑ])\.\.\./;

/** El texto de la situación con la inicial de la persona resaltada («B…»), para que se lea como un nombre. */
function Texto({ t }: { t: string }) {
  const partes = t.split(/\b([A-ZÁÉÍÓÚÑ])\.\.\./);
  return <>{partes.map((x, k) => (k % 2 ? <b key={k} className="font-bold">{x}…</b> : x))}</>;
}

function Gracias({ nombre, onFeedback }: { nombre: string; onFeedback: () => void }) {
  return (
    <div className="flex-1 flex flex-col text-center">
      <div className="my-auto">
        <CircleCheck size={56} className="mx-auto text-emerald-600" aria-hidden />
        <h1 className="font-display text-[34px] uppercase text-brand-ink mt-3 leading-tight">¡Gracias, {nombre}!</h1>
        <p className="text-[16px] text-brand-slate mt-2">Tus respuestas quedaron guardadas. Tu capacitador las va a ver con vos.</p>
      </div>
      <Boton tipo="secundario" icono={MessageSquareHeart} onClick={onFeedback}>Dejar mi feedback</Boton>
    </div>
  );
}

function Feedback({ base, onVolver }: { base: string; onVolver: () => void }) {
  const [texto, setTexto] = useState("");
  const [audio, setAudio] = useState<AudioCoaching | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [clave, setClave] = useState(0);
  const subir = useCallback((g: Parameters<typeof subirDictado>[1]) => subirDictado(`${base}/audios`, g, true), [base]);
  const consultar = useCallback((id: string) => pub<AudioCoaching>(`${base}/audios/${id}`), [base]);
  const enviar = async () => {
    setOcupado(true); setError(null);
    try {
      await pub(`${base}/comentarios`, { method: "POST", body: JSON.stringify({ texto, audio_id: audio?.id ?? null }) });
      setTexto(""); setAudio(null); setClave((k) => k + 1); setListo(true);
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  if (listo) {
    return (
      <div className="flex-1 flex flex-col text-center">
        <div className="my-auto">
          <CircleCheck size={56} className="mx-auto text-emerald-600" aria-hidden />
          <h1 className="font-display text-3xl uppercase text-brand-ink mt-3">¡Gracias por contarnos!</h1>
          <p className="text-[16px] text-brand-slate mt-2">Lo lee tu equipo de capacitación.</p>
        </div>
        <div className="space-y-2"><Boton tipo="secundario" onClick={() => setListo(false)}>Dejar otro</Boton><Boton tipo="fantasma" onClick={onVolver}>Volver</Boton></div>
      </div>
    );
  }
  return (
    <div className="flex-1 flex flex-col">
      <button type="button" onClick={onVolver} className="self-start inline-flex items-center gap-1 text-sm text-brand-slate mb-3"><ArrowLeft size={16} aria-hidden /> Volver</button>
      <h1 className="font-display text-3xl uppercase text-brand-ink leading-tight">Tu feedback</h1>
      <p className="text-[15px] text-brand-slate mt-1 mb-4">¿Cómo te sentís en la capacitación? ¿Qué te ayudó y qué cambiarías?</p>
      <div className="space-y-3">
        <Dictado key={clave} etiqueta="Dictar mi feedback" ayuda="Tocá, hablá y tocá «Terminé»." subir={subir} consultar={consultar}
          onSubido={setAudio} onTexto={(t) => setTexto((x) => (x ? `${x} ${t}` : t))} />
        <textarea className="input min-h-[140px] text-[16px]" value={texto} maxLength={3000} onChange={(e) => setTexto(e.target.value)} placeholder="O escribilo acá" aria-label="Tu feedback" />
        {error && <p className="text-sm text-brand-primary-dark" role="alert">{error}</p>}
      </div>
      <div className="mt-auto pt-6"><Boton icono={Send} onClick={enviar} ocupado={ocupado} disabled={!texto.trim() && !audio}>Enviar</Boton></div>
    </div>
  );
}

// ------------------------------------------------------------------ entrenamientos (chat con clientes)
interface CasoLink {
  id: string; orden: number; titulo: string; cliente: string; estado: "pendiente" | "en_curso" | "hecho"; segundos: number | null;
  sesion_id: string | null; info_ok: boolean | null;
}
interface EntDetalle {
  id: string; nombre: string; intento?: number; instrucciones: string | null; empresa: string; canal: string; casos: CasoLink[]; hechos: number; total: number;
  pct: number; terminado: boolean; disponible: boolean; devolucion_final: { fuertes: string[]; mejorar: string[] } | null;
  /** Guiado: práctica con el entrenador IA (no suma a la evaluación). */
  guiado?: boolean;
}

/** La devolución corta de un caso: aparece apenas la IA lo evalúa (unos segundos después de terminar). */
function Devolucion({ base, sid, compacta }: { base: string; sid: string; compacta?: boolean }) {
  const [d, setD] = useState<DevolucionCaso | null>(null);
  const [agotado, setAgotado] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let vivo = true;
    let n = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    const cargar = async () => {
      try {
        const x = await pub<DevolucionCaso>(`${base}/sesiones/${sid}/devolucion`);
        if (!vivo) return;
        setD(x);
        if (x.estado !== "evaluando" && x.estado !== "en_curso") return;
      } catch { /* sin señal: se vuelve a probar */ }
      if (!vivo) return;
      if (++n >= 45) { setAgotado(true); return; }
      t = setTimeout(cargar, 2500);
    };
    cargar();
    return () => { vivo = false; clearTimeout(t); };
  }, [base, sid]);
  useEffect(() => { if (d?.estado === "lista" && !compacta) ref.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [d?.estado, compacta]);
  const lista = d?.estado === "lista";
  if (!lista) {
    return (
      <div className={cx("rounded-2xl bg-white px-4 py-3 text-[14px] text-brand-slate flex items-center gap-2 shadow-sm", !compacta && "mt-3")}>
        {agotado || d?.estado === "sin_devolucion"
          ? "Tu equipo de capacitación va a revisar este caso con vos."
          : <><LoaderCircle size={16} className="animate-spin shrink-0" aria-hidden /> Preparando tu devolución…</>}
      </div>
    );
  }
  return (
    <div ref={ref} className={cx("rounded-2xl bg-white px-4 py-3 shadow-sm space-y-2 animate-fade", !compacta && "mt-3")} aria-live="polite">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wider2 font-bold text-brand-slate">Tu devolución</span>
        <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold",
          d.info_ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")}>
          {d.info_ok ? <><CircleCheck size={13} aria-hidden /> Información correcta</> : <><TriangleAlert size={13} aria-hidden /> Revisá la información</>}
        </span>
      </div>
      {d.devolucion && <p className="text-[15px] text-brand-ink leading-snug">{d.devolucion}</p>}
      {(d.corregir ?? []).length > 0 && (
        <ul className="space-y-1 text-[13px] text-brand-graphite">
          {d.corregir!.map((x, i) => (
            <li key={i} className="flex gap-1.5"><span className="text-amber-700 shrink-0" aria-hidden>•</span>
              <span><b className="font-semibold">{x.dato}</b>{x.detalle && <span className="text-brand-slate"> — {x.detalle}</span>}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}
interface SesionLink {
  id: string; caso_id: string; titulo: string; cliente: string; estado: string; mensajes: MensajeChat[]; iniciado_at: string;
  guiado?: boolean; consejos?: ConsejosTurno[];
}
const COLORES_CLIENTE = ["#334155", "#2A78D6", "#0E7490", "#7C3AED", "#B45309", "#BE185D", "#15803D"];
const colorCliente = (n: string) => COLORES_CLIENTE[[...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORES_CLIENTE.length];

function EntrenamientoLink({ base, id, onVolver }: { base: string; id: string; onVolver: () => void }) {
  const [d, setD] = useState<EntDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<SesionLink | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  // Los casos que terminó en esta visita (la lista del servidor se actualiza al volver).
  const [listos, setListos] = useState<Set<string>>(new Set());
  const [verDev, setVerDev] = useState<string | null>(null);
  const [comoFunciona, setComoFunciona] = useState(false);
  const cargar = useCallback(() => {
    pub<EntDetalle>(`${base}/entrenamientos/${id}`).then((x) => { setD(x); setError(null); }).catch((e) => setError(e.message));
  }, [base, id]);
  useEffect(cargar, [cargar]);
  // Terminó todos los casos y la devolución final todavía se está preparando: se vuelve a consultar sola.
  const esperas = useRef(0);
  useEffect(() => {
    if (!d?.terminado || d.devolucion_final || chat || esperas.current >= 60) return;
    const t = setTimeout(() => { esperas.current += 1; cargar(); }, 4000);
    return () => clearTimeout(t);
  }, [d, chat, cargar]);
  const abrir = async (c: CasoLink) => {
    setAbriendo(c.id); setError(null);
    try { setChat(await pub<SesionLink>(`${base}/entrenamientos/${id}/casos/${c.id}`, { method: "POST" })); }
    catch (e: any) { setError(e.message); } finally { setAbriendo(null); }
  };
  const enviar = useCallback((textos: string[], lote: string) =>
    pub<{ nuevos: string[]; fin: boolean }>(`${base}/sesiones/${chat!.id}/mensajes`, { method: "POST", body: JSON.stringify({ textos, lote }) }), [base, chat]);
  const terminar = useCallback(async () => { await pub(`${base}/sesiones/${chat!.id}/terminar`, { method: "POST" }); }, [base, chat]);
  // Guiado: el entrenador IA y los consejos que ya salieron en esta conversación.
  const entrenador = useMemo<Entrenador | undefined>(() => (chat?.guiado ? {
    pedir: () => pub<{ turno: number; consejos: Consejo[] }>(`${base}/sesiones/${chat.id}/consejo`, { method: "POST" }), previos: chat.consejos,
  } : undefined), [base, chat?.id, chat?.guiado]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !d) return <p className="m-auto text-center text-brand-primary-dark font-semibold">{error}</p>;
  if (!d) return <div className="m-auto"><LoaderCircle size={32} className="animate-spin text-brand-slate" aria-label="Cargando" /></div>;
  const siguiente = d.casos.find((c) => c.estado !== "hecho");

  if (chat) {
    const quedan = d.casos.filter((c) => c.estado !== "hecho" && !listos.has(c.id) && c.id !== chat.caso_id);
    const despues = quedan[0];
    const marcar = () => setListos((x) => new Set(x).add(chat.caso_id));
    // La cola de clientes de este entrenamiento: los hechos, el que está atendiendo y los que esperan.
    const pasos: PasoChat[] = d.casos.map((c) => ({
      cliente: c.cliente, estado: c.id === chat.caso_id ? "actual" : c.estado === "hecho" || listos.has(c.id) ? "hecho" : "pendiente" }));
    return (
      <Chat key={chat.id} id={chat.id} cliente={chat.cliente} pasos={pasos} entrenamiento={d.nombre}
        mensajes={chat.mensajes} iniciado={chat.iniciado_at} terminado={chat.estado !== "en_curso"}
        enviar={enviar} onTerminar={terminar} onVolver={() => { setChat(null); cargar(); }} entrenador={entrenador}
        aviso={<p className="mx-auto mb-3 max-w-md rounded-lg bg-[#FFF8E1] px-3 py-2 text-center text-[12px] leading-snug text-[#6B5200] shadow-sm">
          Sos asesor de {d.empresa}. Atendé a {chat.cliente.split(" ")[0]} como lo harías con un cliente real.
          {chat.guiado && <><br /><b className="font-semibold">Práctica guiada:</b> tu entrenador te va dando consejos en burbujas. No suma a tu evaluación.</>}</p>}
        cierre={<Devolucion base={base} sid={chat.id} />}
        pie={() => (
          <div className="space-y-2">
            {despues ? (
              <p className="text-center text-[14px] text-brand-ink font-semibold inline-flex w-full items-center justify-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
                {despues.cliente.split(" ")[0]} está esperando{quedan.length > 1 ? ` · ${quedan.length} en espera` : ""}
              </p>
            ) : <p className="text-center text-[14px] text-brand-ink font-semibold">¡Era el último cliente!</p>}
            {despues ? <Boton icono={Play} ocupado={abriendo === despues.id} onClick={() => { marcar(); abrir(despues); }}>Atender a {despues.cliente.split(" ")[0]}</Boton>
              : <Boton onClick={() => { marcar(); setChat(null); cargar(); }}>Ver mi devolución final</Boton>}
          </div>
        )} />
    );
  }

  // En el celular: arriba el próximo cliente con su botón (sin nada fijo que tape), después la cola y «Cómo funciona»
  // plegado. En la computadora, en dos columnas: lo que tiene que saber y, al costado, sus clientes.
  const primerNombre = (n: string) => n.split(" ")[0];
  const pasosComo = [
    { icono: UserRound, t: "Son clientes simulados, tratalos como reales", x: "Cada uno tiene su forma de ser: algunos están apurados, otros desconfían. A veces mandan dos o tres mensajes seguidos." },
    { icono: Send, t: "Escribí como en WhatsApp", x: "Podés mandar varios mensajes seguidos: el cliente contesta cuando hacés una pausa." },
    ...(d.guiado ? [{ icono: GraduationCap, t: "Tu entrenador te guía", x: "Mientras chateás, te va dando consejos en burbujas: qué hacer en tu próximo mensaje, lo que hiciste bien y qué corregir." }] : []),
    { icono: Timer, t: "Al terminar cada caso, tu devolución", x: "Se mide el tiempo. Cuando el cliente se despide (o tocás «Terminar»), te decimos qué mejorar y qué dato corregir." },
    { icono: Eye, t: "Tu equipo te acompaña", x: "Tu capacitador o mentor puede ver las conversaciones para ayudarte a mejorar." },
  ];
  const proximo = !d.terminado && siguiente ? (
    <div className="card p-4 lg:p-5 border-brand-ink/80">
      <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate">{siguiente.estado === "en_curso" ? "Tenés una charla abierta" : d.hechos === 0 ? "Tu primer cliente" : "Tu próximo cliente"}</div>
      <div className="mt-2 flex items-center gap-3">
        <span className="relative w-12 h-12 rounded-full text-white text-[18px] font-bold flex items-center justify-center shrink-0" style={{ background: colorCliente(siguiente.cliente) }} aria-hidden>
          {siguiente.cliente.trim().charAt(0).toUpperCase()}
          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-white" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-semibold text-brand-ink truncate">{siguiente.cliente}</span>
          <span className="block text-[13px] text-brand-slate">Caso {siguiente.orden} de {d.total} · {siguiente.estado === "en_curso" ? "te está esperando" : "en línea"}</span>
        </span>
      </div>
      <div className="mt-4">
        <Boton icono={Play} onClick={() => abrir(siguiente)} ocupado={abriendo === siguiente.id} disabled={!d.disponible}>
          {siguiente.estado === "en_curso" ? `Seguir con ${primerNombre(siguiente.cliente)}` : `Atender a ${primerNombre(siguiente.cliente)}`}
        </Boton>
      </div>
    </div>
  ) : null;
  return (
    <div className="flex-1 flex flex-col pb-6 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-x-12 lg:items-start">
      <div className="flex flex-col">
        <button type="button" onClick={onVolver} className="self-start inline-flex items-center gap-1 text-sm text-brand-slate mb-3 min-h-[36px]"><ArrowLeft size={16} aria-hidden /> Volver</button>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider2 text-brand-slate">{d.guiado ? "Entrenamiento guiado" : "Entrenamiento"}</span>
          {d.guiado && <span className="inline-flex items-center gap-1 rounded-full bg-[#2A78D6]/10 text-[#1D5BA6] text-[11px] font-semibold px-2 py-0.5"><GraduationCap size={12} aria-hidden /> Práctica · no suma</span>}
        </div>
        <h1 className="font-display text-[28px] lg:text-[30px] uppercase text-brand-ink leading-tight">{d.nombre}</h1>
        {(d.intento ?? 1) > 1 && <div className="text-[13px] text-brand-slate">{d.intento}.º intento: lo hacés de nuevo para mejorar.</div>}
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 flex gap-1" aria-hidden>
            {d.casos.map((c) => <span key={c.id} className={cx("h-2 flex-1 rounded-full", c.estado === "hecho" ? "bg-emerald-500" : c.id === siguiente?.id && !d.terminado ? "bg-brand-ink" : "bg-white border border-brand-border")} />)}
          </div>
          <span className="text-[13px] text-brand-slate tabular-nums shrink-0">{d.hechos} de {d.total} clientes</span>
        </div>

        {/* En el celular, lo primero es el próximo cliente. */}
        {proximo && <div className="mt-4 lg:hidden">{proximo}</div>}

        {d.terminado && (
          <div className="mt-5 card p-5">
            <div className="text-center">
              <CircleCheck size={44} className="mx-auto text-emerald-600" aria-hidden />
              <p className="mt-2 text-[17px] font-semibold text-brand-ink">¡Terminaste {d.guiado ? "esta práctica" : "este entrenamiento"}!</p>
            </div>
            {d.devolucion_final ? (
              <div className="mt-4 space-y-3">
                {d.devolucion_final.fuertes.length > 0 && (
                  <div><div className="text-[11px] uppercase tracking-wider2 font-bold text-emerald-800">Lo que hiciste bien</div>
                    <ul className="mt-1 space-y-1 text-[15px] text-brand-ink">{d.devolucion_final.fuertes.map((x) => <li key={x} className="flex gap-2"><Check size={16} className="text-emerald-600 mt-0.5 shrink-0" aria-hidden />{x}</li>)}</ul></div>
                )}
                {d.devolucion_final.mejorar.length > 0 && (
                  <div><div className="text-[11px] uppercase tracking-wider2 font-bold text-amber-800">Para mejorar</div>
                    <ul className="mt-1 space-y-1 text-[15px] text-brand-ink">{d.devolucion_final.mejorar.map((x) => <li key={x} className="flex gap-2"><ArrowRight size={16} className="text-amber-700 mt-0.5 shrink-0" aria-hidden />{x}</li>)}</ul></div>
                )}
                <p className="text-[13px] text-brand-slate">Tu equipo de capacitación ve tus conversaciones y lo va a repasar con vos.</p>
              </div>
            ) : (
              <p className="mt-3 text-[14px] text-brand-slate flex items-center justify-center gap-2"><LoaderCircle size={16} className="animate-spin" aria-hidden /> Preparando tu devolución final…</p>
            )}
          </div>
        )}

        {/* Tu rol, en una tarjeta corta; el resto, plegado. */}
        <div className="mt-4 rounded-xl bg-white border border-brand-border px-4 py-3 order-last lg:order-none">
          <div className="flex gap-3">
            <span className="w-9 h-9 rounded-xl bg-brand-bg text-brand-ink flex items-center justify-center shrink-0"><MessagesSquare size={18} aria-hidden /></span>
            <p className="min-w-0 text-[14px] text-brand-ink leading-snug">{d.instrucciones || `Sos asesor de ${d.empresa}: averiguá qué necesita cada cliente y ayudalo.`}</p>
          </div>
          {d.guiado && (
            <p className="mt-3 rounded-lg bg-[#2A78D6]/[0.07] px-3 py-2 text-[13px] text-[#1D5BA6] leading-snug flex gap-2">
              <GraduationCap size={16} className="shrink-0 mt-px" aria-hidden />
              <span>Tu entrenador IA te va a ir dando consejos en burbujas mientras chateás. Es práctica: no suma a tu evaluación.</span>
            </p>
          )}
          <button type="button" onClick={() => setComoFunciona(!comoFunciona)} aria-expanded={comoFunciona}
            className="mt-2 w-full min-h-[40px] inline-flex items-center justify-between text-[14px] font-semibold text-brand-ink">
            Cómo funciona <ChevronDown size={18} className={cx("transition-transform", comoFunciona && "rotate-180")} aria-hidden />
          </button>
          {comoFunciona && (
            <ul className="pt-1 pb-1 space-y-3 animate-fade">
              {pasosComo.map(({ icono: I, t: ti, x }) => (
                <li key={ti} className="flex gap-3">
                  <span className="w-8 h-8 rounded-lg bg-brand-bg text-brand-ink flex items-center justify-center shrink-0"><I size={16} aria-hidden /></span>
                  <span className="min-w-0"><span className="block text-[14px] font-semibold text-brand-ink leading-snug">{ti}</span><span className="block text-[13px] text-brand-slate leading-snug">{x}</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:sticky lg:top-6 lg:mt-9">
        {proximo && <div className="hidden lg:block mb-4">{proximo}</div>}
        <div className="mt-5 lg:mt-0 text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate">Tus clientes</div>
        <ol className="mt-2 card divide-y divide-brand-border overflow-hidden">
          {d.casos.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <span className={cx("w-8 h-8 rounded-full text-sm font-bold flex items-center justify-center shrink-0",
                  c.estado === "hecho" ? "bg-emerald-50 text-emerald-700" : c.id === siguiente?.id && !d.terminado ? "bg-brand-ink text-white" : "bg-brand-bg text-brand-ink")}>
                  {c.estado === "hecho" ? <Check size={16} aria-hidden /> : c.orden}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-brand-ink truncate">{c.cliente}</span>
                  <span className="block text-[12px] text-brand-slate">
                    {c.estado === "hecho" ? <>Atendido{c.segundos ? ` · ${c.segundos >= 5400 ? `${Math.round(c.segundos / 3600)} h` : `${Math.max(1, Math.round(c.segundos / 60))} min`}` : ""}
                      {c.info_ok === true && <span className="text-emerald-700"> · información correcta</span>}
                      {c.info_ok === false && <span className="text-amber-800"> · revisá la información</span>}</>
                      : c.estado === "en_curso" ? "Charla abierta" : c.id === siguiente?.id ? "Es el próximo" : "En espera"}
                  </span>
                </span>
                {c.estado === "hecho" && c.sesion_id && (
                  <button type="button" onClick={() => setVerDev(verDev === c.id ? null : c.id)} aria-expanded={verDev === c.id}
                    className="btn min-h-[40px] px-3 text-sm bg-white border border-brand-border text-brand-ink shrink-0">{verDev === c.id ? "Ocultar" : "Devolución"}</button>
                )}
                {c.estado !== "hecho" && !d.terminado && c.id !== siguiente?.id && (
                  <button type="button" onClick={() => abrir(c)} disabled={!!abriendo || !d.disponible}
                    className="btn min-h-[40px] px-3 text-sm bg-white border border-brand-border text-brand-ink shrink-0">
                    {abriendo === c.id ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : c.estado === "en_curso" ? "Seguir" : "Atender"}
                  </button>
                )}
              </div>
              {verDev === c.id && c.sesion_id && <div className="mt-2 -mx-1"><Devolucion base={base} sid={c.sesion_id} compacta /></div>}
            </li>
          ))}
        </ol>
        {!d.disponible && <p className="mt-3 text-sm text-brand-primary-dark">Los entrenamientos no están disponibles en este momento. Probá más tarde.</p>}
        {error && <p className="mt-3 text-sm text-brand-primary-dark" role="alert">{error}</p>}
      </div>
    </div>
  );
}
