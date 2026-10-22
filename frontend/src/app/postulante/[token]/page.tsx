"use client";

/**
 * El link del postulante (sin usuario): el test IPV en el celular, una situación por pantalla, que se guarda a medida
 * que contesta y se puede seguir después con el mismo link; y su feedback, escrito o dictado. No muestra resultados.
 */
import {
  ArrowLeft, ArrowRight, Check, ChevronRight, CircleCheck, ClipboardCheck, Clock3, CloudOff, LayoutGrid, ListChecks, LoaderCircle,
  MessageSquareHeart, Pause, Save, Scale, Send, TriangleAlert, UserRound,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "@/components/Brand";
import { subirDictado } from "@/components/capacitacion/tipos";
import { Dictado } from "@/components/portal/grabadora";
import { Boton, cx } from "@/components/portal/ui";
import type { AudioCoaching } from "@/components/supervision/tipos";

const API = "/api/v1/capacitacion/publico";

interface Estado { nombre: string; grupo: string; ipv: { estado: string; respondidas: number; total: number }; comentarios?: number }
interface Pregunta { n: number; texto: string; opciones: { letra: string; texto: string }[] }
type Vista = "inicio" | "instrucciones" | "test" | "enviar" | "gracias" | "feedback";

async function pub<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) {
    const d = b?.detail;
    const e = new Error(typeof d === "string" ? d : d?.message ?? "No se pudo conectar. Probá de nuevo.");
    (e as any).status = r.status;
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

  return (
    <div className="min-h-[100dvh] bg-brand-bg flex flex-col">
      <header className="bg-white border-b border-brand-border px-4 py-3 flex items-center justify-between">
        <Brand logoHeight={32} compactOnPhone />
        {info && <span className="text-[11px] uppercase tracking-wider2 text-brand-slate truncate max-w-[50%]">{info.grupo}</span>}
      </header>
      <main className="flex-1 w-full max-w-lg mx-auto px-4 pt-4 pb-2 flex flex-col">
        {fallo && (
          <div className="m-auto text-center space-y-3 py-16">
            <TriangleAlert size={40} className="mx-auto text-brand-primary" aria-hidden />
            <p className="text-lg font-semibold text-brand-ink">{fallo}</p>
          </div>
        )}
        {aviso && vista === "inicio" && <div role="status" className="mb-4 rounded-xl bg-brand-ink text-white text-[14px] font-semibold px-4 py-3 animate-fade">{aviso}</div>}
        {!info && !fallo && <div className="m-auto"><LoaderCircle size={32} className="animate-spin text-brand-slate" aria-label="Cargando" /></div>}
        {info && vista === "inicio" && <Inicio info={info} onTest={() => setVista(info.ipv.respondidas ? "test" : "instrucciones")} onFeedback={() => setVista("feedback")} />}
        {info && vista === "instrucciones" && <Instrucciones nombre={info.nombre} onEmpezar={() => setVista("test")} />}
        {info && (vista === "test" || vista === "enviar") && (
          <Test base={base} token={token} onTerminado={() => { setVista("gracias"); cargar(); }} onSalir={(pausa) => { setVista("inicio"); cargar(); if (pausa) setAviso("Quedó guardado. Seguís cuando quieras con este mismo link."); }} />
        )}
        {info && vista === "gracias" && <Gracias nombre={info.nombre} onFeedback={() => setVista("feedback")} />}
        {info && vista === "feedback" && <Feedback base={base} onVolver={() => { setVista("inicio"); cargar(); }} />}
      </main>
    </div>
  );
}

function Inicio({ info, onTest, onFeedback }: { info: Estado; onTest: () => void; onFeedback: () => void }) {
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
            <span className="block text-sm text-brand-slate">
              {hecho ? "¡Listo! Ya lo terminaste." : info.ipv.respondidas ? `Seguí donde quedaste · ${pct}% hecho` : `${info.ipv.total} situaciones · unos 20 minutos`}
            </span>
          </span>
          {!hecho && <ChevronRight size={20} className="text-brand-mist shrink-0" aria-hidden />}
        </span>
        {!hecho && info.ipv.respondidas > 0 && (
          <span className="mt-3 block h-2 rounded-full bg-brand-bg overflow-hidden" aria-hidden>
            <span className="block h-full rounded-full bg-brand-primary" style={{ width: `${pct}%` }} />
          </span>
        )}
      </button>
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
  { icono: Save, titulo: "Se guarda solo", texto: "Podés pausar y seguir después con el mismo link, desde donde quedaste." },
  { icono: Clock3, titulo: "Unos 20 minutos", texto: "Buscá un lugar tranquilo, sin apuro." },
];

function Instrucciones({ nombre, onEmpezar }: { nombre: string; onEmpezar: () => void }) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Test de perfil comercial</div>
      <h1 className="font-display text-[32px] uppercase text-brand-ink leading-tight">Antes de empezar, {nombre}</h1>
      <ul className="mt-5 space-y-4">
        {PASOS_INSTRUCCIONES.map(({ icono: I, titulo, texto }) => (
          <li key={titulo} className="flex gap-3">
            <span className="w-10 h-10 rounded-xl bg-white border border-brand-border text-brand-ink flex items-center justify-center shrink-0"><I size={20} aria-hidden /></span>
            <span className="min-w-0">
              <span className="block text-[16px] font-semibold text-brand-ink leading-snug">{titulo}</span>
              <span className="block text-[14px] text-brand-slate leading-snug">{texto}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-6 sticky bottom-0 pb-[env(safe-area-inset-bottom)] bg-brand-bg"><Boton onClick={onEmpezar}>Empezar el test</Boton></div>
    </div>
  );
}

const HITOS: Record<number, string> = { 25: "¡Ya hiciste un cuarto! Seguí así.", 50: "¡Vas por la mitad!", 75: "¡Falta poco! Ya hiciste tres cuartos." };
const SEG_POR_RESPUESTA = 14;   // estimación inicial; después se usa el ritmo real de la persona

function Test({ base, token, onTerminado, onSalir }: { base: string; token: string; onTerminado: () => void; onSalir: (pausa?: boolean) => void }) {
  const clave = `ipv:${token.slice(0, 16)}`;
  const [preguntas, setPreguntas] = useState<Pregunta[] | null>(null);
  const [resp, setResp] = useState<Record<string, string>>({});
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<"der" | "izq">("der");
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<"ok" | "guardando" | "sin_red">("ok");
  const [enviando, setEnviando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [revisar, setRevisar] = useState(false);
  const [desdeResumen, setDesdeResumen] = useState(false);
  const [hito, setHito] = useState<string | null>(null);
  const [recien, setRecien] = useState<string | null>(null);
  const pendientes = useRef<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ritmo = useRef({ desde: Date.now(), n: 0 });

  useEffect(() => {
    pub<{ preguntas: Pregunta[]; respuestas: Record<string, string>; ipv: { estado: string } }>(`${base}/ipv`).then((x) => {
      if (x.ipv.estado === "terminado") { onTerminado(); return; }
      let local: Record<string, string> = {};
      try { local = JSON.parse(localStorage.getItem(clave) ?? "{}"); } catch { /* sin almacenamiento */ }
      const todas = { ...local, ...x.respuestas };
      // Lo que quedó solo en el teléfono (sin señal) se vuelve a mandar.
      pendientes.current = Object.fromEntries(Object.entries(local).filter(([k]) => !(k in x.respuestas)));
      setPreguntas(x.preguntas);
      setResp(todas);
      const primera = x.preguntas.findIndex((p) => !todas[String(p.n)]);
      setI(primera === -1 ? x.preguntas.length - 1 : primera);
      if (primera === -1) setRevisar(true);
      if (Object.keys(pendientes.current).length) programar(0);
    }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const enviarPendientes = useCallback(async () => {
    const lote = pendientes.current;
    if (!Object.keys(lote).length) return;
    pendientes.current = {};
    setSync("guardando");
    try {
      await pub(`${base}/ipv`, { method: "PUT", body: JSON.stringify({ respuestas: lote }) });
      setSync(Object.keys(pendientes.current).length ? "guardando" : "ok");
    } catch (e: any) {
      pendientes.current = { ...lote, ...pendientes.current };
      if (e?.status === 409) { onTerminado(); return; }
      setSync("sin_red");
      programar(5000);
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

  const total = preguntas?.length ?? 87;
  const respondidas = useMemo(() => Object.keys(resp).length, [resp]);
  const pct = Math.round((respondidas / total) * 100);
  const seg = ritmo.current.n >= 5 ? Math.min(30, Math.max(6, (Date.now() - ritmo.current.desde) / 1000 / ritmo.current.n)) : SEG_POR_RESPUESTA;
  const faltan = Math.max(1, Math.round(((total - respondidas) * seg) / 60));

  const ir = useCallback((k: number) => { setDir(k >= i ? "der" : "izq"); setI(k); window.scrollTo({ top: 0 }); }, [i]);

  const elegir = (n: number, letra: string) => {
    if (!preguntas) return;
    const nueva = !resp[String(n)];
    const nuevas = { ...resp, [String(n)]: letra };
    setResp(nuevas);
    setRecien(`${n}:${letra}`);
    try { navigator.vibrate?.(8); } catch { /* sin vibración */ }
    try { localStorage.setItem(clave, JSON.stringify(nuevas)); } catch { /* sin almacenamiento */ }
    pendientes.current[String(n)] = letra;
    programar(600);
    if (nueva) {
      ritmo.current.n += 1;
      const antes = Math.floor((respondidas / total) * 4), despues = Math.floor((Object.keys(nuevas).length / total) * 4);
      if (despues > antes && despues < 4) setHito(HITOS[despues * 25]);
    }
    setTimeout(() => {
      if (desdeResumen) { setDesdeResumen(false); setRevisar(true); return; }
      const siguiente = preguntas.findIndex((p, k) => k > i && !nuevas[String(p.n)]);
      const cualquiera = preguntas.findIndex((p) => !nuevas[String(p.n)]);
      if (siguiente !== -1) ir(siguiente);
      else if (cualquiera !== -1) ir(cualquiera);
      else setRevisar(true);
    }, 260);
  };

  // En la computadora: A/B/C eligen, las flechas mueven.
  useEffect(() => {
    if (!preguntas || revisar) return;
    const tecla = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const p = preguntas[i];
      const letra = ev.key.toUpperCase();
      if (p.opciones.some((o) => o.letra === letra)) { ev.preventDefault(); elegir(p.n, letra); }
      else if (ev.key === "ArrowLeft" && i > 0) ir(i - 1);
      else if ((ev.key === "ArrowRight" || ev.key === "Enter") && resp[String(p.n)] && i < preguntas.length - 1) ir(i + 1);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  const pausar = async () => {
    if (timer.current) clearTimeout(timer.current);
    await enviarPendientes();
    onSalir(true);
  };

  const terminar = async () => {
    setEnviando(true); setError(null);
    try {
      await pub(`${base}/ipv/terminar`, { method: "POST", body: JSON.stringify({ respuestas: resp }) });
      try { localStorage.removeItem(clave); } catch { /* nada */ }
      pendientes.current = {};
      onTerminado();
    } catch (e: any) { setError(e.message); setConfirmar(false); } finally { setEnviando(false); }
  };

  if (error && !preguntas) return <p className="m-auto text-center text-brand-primary-dark font-semibold">{error}</p>;
  if (!preguntas) return <div className="m-auto"><LoaderCircle size={32} className="animate-spin text-brand-slate" aria-label="Cargando" /></div>;
  const p = preguntas[i];
  const elegida = resp[String(p.n)];
  const faltanN = total - respondidas;

  if (revisar) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="text-center">
          <CircleCheck size={48} className="mx-auto text-emerald-600" aria-hidden />
          <h1 className="font-display text-[30px] uppercase text-brand-ink mt-2 leading-tight">{faltanN ? `Te faltan ${faltanN}` : `¡Respondiste las ${total}!`}</h1>
          <p className="text-[15px] text-brand-slate mt-1">
            {faltanN ? "Tocá las que tienen borde punteado para responderlas." : "Si querés cambiar alguna, tocala. Cuando envíes, ya no se puede modificar."}
          </p>
        </div>
        <div className="mt-5 grid grid-cols-8 sm:grid-cols-10 gap-1.5" aria-label="Tus respuestas">
          {preguntas.map((q, k) => {
            const r = resp[String(q.n)];
            return (
              <button key={q.n} type="button" onClick={() => { setRevisar(false); setDesdeResumen(true); ir(k); }}
                aria-label={`Situación ${k + 1}: ${r ? `respondida ${r}` : "sin responder"}`}
                className={cx("h-10 rounded-lg text-[12px] font-semibold tabular-nums leading-none flex flex-col items-center justify-center",
                  r ? "bg-brand-ink text-white" : "bg-white border-2 border-dashed border-brand-border text-brand-slate")}>
                {k + 1}{r && <span className="text-[9px] opacity-70 mt-0.5">{r}</span>}
              </button>
            );
          })}
        </div>
        {error && <p className="mt-3 text-sm text-brand-primary-dark" role="alert">{error}</p>}
        <div className="mt-auto pt-6 sticky bottom-0 pb-[env(safe-area-inset-bottom)] bg-brand-bg space-y-2">
          {faltanN === 0 && (confirmar ? (
            <div className="card p-4 space-y-3">
              <p className="text-[15px] text-brand-ink font-semibold">¿Enviamos el test? Después no se puede cambiar.</p>
              <div className="grid grid-cols-2 gap-2">
                <Boton tipo="secundario" onClick={() => setConfirmar(false)} disabled={enviando}>Todavía no</Boton>
                <Boton icono={Send} onClick={terminar} ocupado={enviando}>Sí, enviar</Boton>
              </div>
            </div>
          ) : <Boton icono={Send} onClick={() => setConfirmar(true)}>Enviar el test</Boton>)}
          {faltanN > 0 && <Boton onClick={() => { const k = preguntas.findIndex((q) => !resp[String(q.n)]); setRevisar(false); ir(k); }}>Seguir respondiendo</Boton>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Progreso: siempre a la vista */}
      <div className="sticky top-0 z-10 -mx-4 px-4 pt-1 pb-3 bg-brand-bg/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-2xl text-brand-ink tabular-nums leading-none">{pct}%</span>
            <span className="text-[13px] text-brand-slate tabular-nums">{respondidas} de {total} · faltan ~{faltan} min</span>
          </div>
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

      <div key={p.n} className={dir === "der" ? "entra-der" : "entra-izq"}>
        <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate">Situación {i + 1}</div>
        {INICIAL.test(p.texto) && (
          <p className="mt-1 text-[13px] leading-snug text-brand-slate">
            «{p.texto.match(INICIAL)?.[1]}…» es una persona imaginaria: elegí lo que vos harías o pensarías en su lugar.
          </p>
        )}
        <p className="mt-3 text-[20px] leading-snug text-brand-ink font-medium" id={`q${p.n}`}><Texto t={p.texto} /></p>
        <div role="radiogroup" aria-labelledby={`q${p.n}`} className="mt-5 space-y-2.5">
          {p.opciones.map((o) => {
            const on = elegida === o.letra;
            return (
              <button key={o.letra} type="button" role="radio" aria-checked={on} onClick={() => elegir(p.n, o.letra)}
                className={cx("w-full min-h-[64px] text-left rounded-2xl border-2 px-4 py-3.5 flex items-start gap-3 transition-colors",
                  on ? "border-brand-ink bg-brand-ink text-white shadow-soft" : "border-brand-border bg-white text-brand-ink hover:border-brand-ink active:bg-brand-bg-soft",
                  on && recien === `${p.n}:${o.letra}` && "opcion-elegida")}>
                <span className={cx("w-8 h-8 rounded-full text-sm font-bold flex items-center justify-center shrink-0", on ? "bg-white text-brand-ink" : "bg-brand-bg text-brand-slate")}>
                  {on ? <Check size={16} strokeWidth={3} aria-hidden /> : o.letra}
                </span>
                <span className="text-[16px] leading-snug pt-1">{o.texto}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Navegación a mano del pulgar */}
      <div className="mt-auto pt-6 sticky bottom-0 pb-[calc(8px+env(safe-area-inset-bottom))] bg-brand-bg">
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button type="button" onClick={() => (i > 0 ? ir(i - 1) : onSalir())} aria-label={i > 0 ? "Situación anterior" : "Salir"}
            className="btn min-h-[52px] px-4 bg-white border border-brand-border text-brand-ink"><ArrowLeft size={20} aria-hidden /></button>
          {desdeResumen ? (
            <Boton tipo="secundario" onClick={() => { setDesdeResumen(false); setRevisar(true); }} className="!min-h-[52px]"><LayoutGrid size={18} aria-hidden /> Volver al resumen</Boton>
          ) : elegida && i < total - 1 ? (
            <Boton tipo="secundario" onClick={() => ir(i + 1)} className="!min-h-[52px]">Siguiente <ArrowRight size={18} aria-hidden /></Boton>
          ) : respondidas === total ? (
            <Boton onClick={() => setRevisar(true)} className="!min-h-[52px]">Revisar y enviar</Boton>
          ) : (
            <p className="self-center text-center text-[13px] text-brand-slate">Tocá una opción para seguir</p>
          )}
        </div>
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
