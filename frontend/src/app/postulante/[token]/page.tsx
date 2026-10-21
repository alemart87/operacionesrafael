"use client";

/**
 * El link del postulante (sin usuario): el test IPV en el celular, una situación por pantalla, que se guarda a medida
 * que contesta y se puede seguir después con el mismo link; y su feedback, escrito o dictado. No muestra resultados.
 */
import { ArrowLeft, CircleCheck, ClipboardCheck, CloudOff, LoaderCircle, MessageSquareHeart, Send, TriangleAlert } from "lucide-react";
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
      <main className="flex-1 w-full max-w-lg mx-auto px-4 py-5 flex flex-col">
        {fallo && (
          <div className="m-auto text-center space-y-3 py-16">
            <TriangleAlert size={40} className="mx-auto text-brand-primary" aria-hidden />
            <p className="text-lg font-semibold text-brand-ink">{fallo}</p>
          </div>
        )}
        {!info && !fallo && <div className="m-auto"><LoaderCircle size={32} className="animate-spin text-brand-slate" aria-label="Cargando" /></div>}
        {info && vista === "inicio" && <Inicio info={info} onTest={() => setVista(info.ipv.respondidas ? "test" : "instrucciones")} onFeedback={() => setVista("feedback")} />}
        {info && vista === "instrucciones" && <Instrucciones nombre={info.nombre} onEmpezar={() => setVista("test")} />}
        {info && (vista === "test" || vista === "enviar") && (
          <Test base={base} token={token} onTerminado={() => { setVista("gracias"); cargar(); }} onSalir={() => { setVista("inicio"); cargar(); }} />
        )}
        {info && vista === "gracias" && <Gracias nombre={info.nombre} onFeedback={() => setVista("feedback")} />}
        {info && vista === "feedback" && <Feedback base={base} onVolver={() => { setVista("inicio"); cargar(); }} />}
      </main>
    </div>
  );
}

function Inicio({ info, onTest, onFeedback }: { info: Estado; onTest: () => void; onFeedback: () => void }) {
  const hecho = info.ipv.estado === "terminado";
  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Capacitación Voicenter</div>
        <h1 className="font-display text-[38px] uppercase leading-[1.05] text-brand-ink">Hola, <span className="text-brand-primary">{info.nombre}</span></h1>
        <p className="text-[15px] text-brand-slate mt-1">Este link es personal: no lo compartas.</p>
      </div>
      <button type="button" onClick={hecho ? undefined : onTest} disabled={hecho}
        className={cx("w-full text-left card p-5 flex items-center gap-4 min-h-[96px]", !hecho && "active:scale-[0.99] hover:shadow-elevated")}>
        <span className={cx("w-12 h-12 rounded-xl flex items-center justify-center shrink-0", hecho ? "bg-emerald-50 text-emerald-700" : "bg-brand-primary text-white")}>
          {hecho ? <CircleCheck size={26} aria-hidden /> : <ClipboardCheck size={26} aria-hidden />}
        </span>
        <span className="min-w-0">
          <span className="block font-semibold text-[17px] text-brand-ink">Test de perfil comercial</span>
          <span className="block text-sm text-brand-slate">
            {hecho ? "¡Listo! Ya lo terminaste." : info.ipv.respondidas ? `Seguí donde quedaste: ${info.ipv.respondidas} de ${info.ipv.total}` : `${info.ipv.total} situaciones · unos 20 minutos`}
          </span>
        </span>
      </button>
      <button type="button" onClick={onFeedback} className="w-full text-left card p-5 flex items-center gap-4 min-h-[96px] active:scale-[0.99] hover:shadow-elevated">
        <span className="w-12 h-12 rounded-xl bg-brand-ink text-white flex items-center justify-center shrink-0"><MessageSquareHeart size={26} aria-hidden /></span>
        <span className="min-w-0">
          <span className="block font-semibold text-[17px] text-brand-ink">Tu feedback</span>
          <span className="block text-sm text-brand-slate">Contanos cómo te va en la capacitación: escribilo o dictalo.</span>
        </span>
      </button>
    </div>
  );
}

function Instrucciones({ nombre, onEmpezar }: { nombre: string; onEmpezar: () => void }) {
  return (
    <div className="flex-1 flex flex-col">
      <h1 className="font-display text-3xl uppercase text-brand-ink leading-tight">Antes de empezar, {nombre}</h1>
      <ul className="mt-4 space-y-3 text-[16px] text-brand-graphite leading-snug">
        <li>• Vas a leer <b>87 situaciones</b> de trabajo y de la vida diaria. En cada una, elegí la opción que <b>más se parezca a lo que harías o pensás</b>.</li>
        <li>• Muchas situaciones hablan de una <b>persona imaginaria nombrada solo con una inicial</b> (por ejemplo «B…»). Ponete en su
          lugar y elegí lo que <b>vos</b> harías o pensarías.</li>
        <li>• <b>No hay respuestas correctas ni incorrectas.</b> Respondé con sinceridad y sin pensarlo demasiado.</li>
        <li>• Se guarda solo a medida que contestás. Si se corta, abrí el mismo link y seguís donde quedaste.</li>
        <li>• Buscá un lugar tranquilo: lleva unos 20 minutos.</li>
      </ul>
      <div className="mt-auto pt-6"><Boton onClick={onEmpezar}>Empezar</Boton></div>
    </div>
  );
}

function Test({ base, token, onTerminado, onSalir }: { base: string; token: string; onTerminado: () => void; onSalir: () => void }) {
  const clave = `ipv:${token.slice(0, 16)}`;
  const [preguntas, setPreguntas] = useState<Pregunta[] | null>(null);
  const [resp, setResp] = useState<Record<string, string>>({});
  const [i, setI] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<"ok" | "guardando" | "sin_red">("ok");
  const [enviando, setEnviando] = useState(false);
  const [revisar, setRevisar] = useState(false);
  const pendientes = useRef<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setSync("ok");
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
    window.addEventListener("online", volver);
    return () => window.removeEventListener("online", volver);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = preguntas?.length ?? 87;
  const respondidas = useMemo(() => Object.keys(resp).length, [resp]);

  const elegir = (n: number, letra: string) => {
    const nuevas = { ...resp, [String(n)]: letra };
    setResp(nuevas);
    try { localStorage.setItem(clave, JSON.stringify(nuevas)); } catch { /* sin almacenamiento */ }
    pendientes.current[String(n)] = letra;
    programar(600);
    setTimeout(() => {
      if (!preguntas) return;
      const siguiente = preguntas.findIndex((p, k) => k > i && !nuevas[String(p.n)]);
      const cualquiera = preguntas.findIndex((p) => !nuevas[String(p.n)]);
      if (siguiente !== -1) setI(siguiente);
      else if (cualquiera !== -1) setI(cualquiera);
      else setRevisar(true);
    }, 220);
  };

  const terminar = async () => {
    setEnviando(true); setError(null);
    try {
      await pub(`${base}/ipv/terminar`, { method: "POST", body: JSON.stringify({ respuestas: resp }) });
      try { localStorage.removeItem(clave); } catch { /* nada */ }
      onTerminado();
    } catch (e: any) { setError(e.message); } finally { setEnviando(false); }
  };

  if (error && !preguntas) return <p className="m-auto text-center text-brand-primary-dark font-semibold">{error}</p>;
  if (!preguntas) return <div className="m-auto"><LoaderCircle size={32} className="animate-spin text-brand-slate" aria-label="Cargando" /></div>;
  const p = preguntas[i];
  const elegida = resp[String(p.n)];

  if (revisar) {
    return (
      <div className="flex-1 flex flex-col">
        <CircleCheck size={48} className="text-emerald-600" aria-hidden />
        <h1 className="font-display text-3xl uppercase text-brand-ink mt-3 leading-tight">Respondiste las {total}</h1>
        <p className="text-[16px] text-brand-slate mt-2">Si querés cambiar alguna, volvé atrás. Cuando envíes, ya no se puede modificar.</p>
        {error && <p className="mt-3 text-sm text-brand-primary-dark">{error}</p>}
        <div className="mt-auto pt-6 space-y-2">
          <Boton icono={Send} onClick={terminar} ocupado={enviando}>Enviar el test</Boton>
          <Boton tipo="fantasma" onClick={() => setRevisar(false)}>Revisar respuestas</Boton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => (i > 0 ? setI(i - 1) : onSalir())} aria-label={i > 0 ? "Anterior" : "Salir"}
          className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-brand-slate hover:bg-white shrink-0"><ArrowLeft size={22} aria-hidden /></button>
        <div className="flex-1">
          <div className="h-2 rounded-full bg-white overflow-hidden border border-brand-border" aria-hidden>
            <div className="h-full bg-brand-primary transition-[width] duration-300" style={{ width: `${(respondidas / total) * 100}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[12px] text-brand-slate tabular-nums">
            <span>{i + 1} de {total}</span>
            <span className="inline-flex items-center gap-1">{sync === "sin_red" ? <><CloudOff size={13} aria-hidden /> Guardado en el celular</> : sync === "guardando" ? "Guardando…" : respondidas ? "Guardado" : ""}</span>
          </div>
        </div>
      </div>
      <div key={p.n} className="mt-6 animate-fade">
        {INICIAL.test(p.texto) && (
          <p className="mb-3 text-[13px] leading-snug text-brand-slate">
            «{p.texto.match(INICIAL)?.[1]}…» es una persona imaginaria: elegí lo que vos harías o pensarías en su lugar.
          </p>
        )}
        <p className="text-[19px] leading-snug text-brand-ink font-medium" id={`q${p.n}`}><Texto t={p.texto} /></p>
        <div role="radiogroup" aria-labelledby={`q${p.n}`} className="mt-5 space-y-2.5">
          {p.opciones.map((o) => {
            const on = elegida === o.letra;
            return (
              <button key={o.letra} type="button" role="radio" aria-checked={on} onClick={() => elegir(p.n, o.letra)}
                className={cx("w-full min-h-[60px] text-left rounded-xl border-2 px-4 py-3 flex items-start gap-3 transition-colors active:scale-[0.99]",
                  on ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border bg-white text-brand-ink hover:border-brand-ink")}>
                <span className={cx("w-7 h-7 rounded-full text-sm font-bold flex items-center justify-center shrink-0 mt-0.5", on ? "bg-white text-brand-ink" : "bg-brand-bg text-brand-slate")}>{o.letra}</span>
                <span className="text-[16px] leading-snug">{o.texto}</span>
              </button>
            );
          })}
        </div>
      </div>
      {respondidas === total && (
        <div className="mt-auto pt-6"><Boton tipo="secundario" onClick={() => setRevisar(true)}>Terminé de revisar</Boton></div>
      )}
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
