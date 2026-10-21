"use client";

/**
 * Tablero de Power BI: el visor (el publicado del día más nuevo, con los días anteriores a mano), la pantalla completa
 * (en el celular parado gira el tablero para verlo apaisado), la hoja «Cargar PBI» y el historial de los publicadores.
 * El iframe lo arma la app con el link que validó el servidor (solo Power BI / Fabric): nunca el HTML pegado.
 */
import { CalendarDays, ClipboardPaste, ExternalLink, Info, Maximize2, Presentation, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/api";
import { Boton, Fallo, Hoja, cx, useAviso } from "@/components/portal/ui";
import { PROD_API } from "./tipos";

export const PBI_API = `${PROD_API}/pbi`;

export interface TableroPbi {
  id: string; fecha: string; titulo: string; url: string; ancho: number; alto: number;
  estado: "publicado" | "guardado" | "reemplazado";
  cargado_por: string | null; cargado_at: string | null; publicado_por: string | null; publicado_at: string | null;
}
export interface PbiPublicado { hoy: string; tablero: TableroPbi | null; dias: string[]; puede_cargar: boolean }

const DIA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const diaPbi = (iso: string, hoy?: string) => {
  if (hoy && iso === hoy) return "Hoy";
  const d = new Date(`${iso}T12:00:00`);
  return `${DIA[d.getDay()]} ${d.getDate()} ${MES[d.getMonth()]}`;
};
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("es-PY", { timeZone: "America/Asuncion", hour: "2-digit", minute: "2-digit" }) : "");
// Power BI necesita sus scripts y su origen; no puede navegar la pestaña de la app ni abrir nada sin un clic.
const SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads";

function Marco({ t, className }: { t: TableroPbi; className?: string }) {
  return (
    <iframe title={t.titulo} src={t.url} className={cx("w-full h-full border-0 bg-white", className)} allowFullScreen loading="lazy"
      sandbox={SANDBOX} referrerPolicy="strict-origin-when-cross-origin" />
  );
}

/** Pantalla completa propia (en el iPhone el navegador no deja poner un iframe en pantalla completa): con el celular
 * parado, el tablero se gira para verlo apaisado; acostado, ocupa toda la pantalla. */
function PantallaCompleta({ t, onClose }: { t: TableroPbi; onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", tecla);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", tecla); };
  }, [onClose]);
  // Directo en <body>: así ningún contenedor animado de la página lo deja debajo de la cabecera.
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-[#0F1116]" role="dialog" aria-modal="true" aria-label={`${t.titulo} en pantalla completa`}>
      <div className="pbi-girar">
        <Marco t={t} />
        <button type="button" onClick={onClose} aria-label="Salir de pantalla completa"
          className="absolute top-2 right-2 w-11 h-11 rounded-full bg-brand-ink/85 text-white grid place-items-center shadow-elevated">
          <X size={22} aria-hidden />
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** El tablero publicado: título, de qué día es, el informe y dos acciones (pantalla completa y abrir en Power BI). */
export function VisorPbi({ d, onDia, onCargar }: { d: PbiPublicado; onDia: (fecha: string) => void; onCargar?: () => void }) {
  const [completo, setCompleto] = useState(false);
  const t = d.tablero;
  if (!t) {
    return (
      <div className="card p-8 text-center">
        <Presentation size={36} className="mx-auto text-brand-mist" aria-hidden />
        <div className="font-semibold text-brand-ink mt-3">Todavía no hay un tablero publicado</div>
        <p className="text-sm text-brand-slate mt-1">Cuando se publique el del día, aparece acá.</p>
        {onCargar && <div className="mt-4 max-w-xs mx-auto"><Boton icono={Upload} onClick={onCargar}>Cargar PBI</Boton></div>}
      </div>
    );
  }
  const viejo = t.fecha !== d.hoy && t.fecha === d.dias[0];
  return (
    <section className="space-y-3" aria-label="Tablero de Power BI">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-brand-ink leading-tight break-words">{t.titulo}</h2>
          <p className="text-xs text-brand-slate mt-0.5">
            {diaPbi(t.fecha, d.hoy)}{t.publicado_at ? ` · publicado ${hora(t.publicado_at)}` : ""}{t.publicado_por ? ` por ${t.publicado_por}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setCompleto(true)} className="btn-primary !py-2 !px-3.5 !text-sm">
            <Maximize2 size={15} aria-hidden /> Pantalla completa
          </button>
          <a href={t.url} target="_blank" rel="noopener noreferrer" className="btn-secondary !py-2 !px-3 !text-sm" aria-label="Abrir en Power BI">
            <ExternalLink size={15} aria-hidden /> <span className="hidden sm:inline">Abrir en Power BI</span>
          </a>
        </div>
      </div>
      {viejo && (
        <p className="text-xs text-[#8A5200] bg-brand-orange/10 border border-brand-orange/40 rounded-md px-3 py-2 flex gap-1.5">
          <Info size={14} className="shrink-0 mt-px" aria-hidden /> Es el último publicado: el de hoy todavía no se cargó.
        </p>
      )}
      <div className="card overflow-hidden p-0">
        <div className="relative w-full" style={{ aspectRatio: `${t.ancho} / ${t.alto}` }}>
          <Marco t={t} className="absolute inset-0" />
        </div>
      </div>
      {d.dias.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1" aria-label="Días publicados">
          <CalendarDays size={15} className="text-brand-slate shrink-0" aria-hidden />
          {d.dias.map((f) => (
            <button key={f} type="button" onClick={() => onDia(f)} aria-pressed={f === t.fecha}
              className={cx("shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap",
                f === t.fecha ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-graphite border-brand-border")}>
              {diaPbi(f, d.hoy)}
            </button>
          ))}
        </div>
      )}
      <p className="text-[11px] text-brand-slate">En el celular, «Pantalla completa» lo muestra apaisado. Los datos son los del día publicado.</p>
      {completo && <PantallaCompleta t={t} onClose={() => setCompleto(false)} />}
    </section>
  );
}

/** El visor con su carga (lo usan el portal y Productividad). */
export function TableroPublicado({ onCargar, refresco }: { onCargar?: () => void; refresco?: number }) {
  const [d, setD] = useState<PbiPublicado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async (fecha?: string) => {
    try { setD(await apiFetch<PbiPublicado>(`${PBI_API}/publicado${fecha ? `?fecha=${fecha}` : ""}`)); setError(null); }
    catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar, refresco]);
  if (error) return <Fallo onReintentar={() => cargar()}>{error}</Fallo>;
  if (!d) return <div className="card animate-pulse" style={{ aspectRatio: "16 / 10" }} aria-busy="true" aria-label="Cargando el tablero" />;
  return <VisorPbi d={d} onDia={(f) => cargar(f)} onCargar={d.puede_cargar ? onCargar : undefined} />;
}

// ------------------------------------------------------------------ Cargar PBI (publicadores)
export function HojaCargarPbi({ hoy, onClose, onListo }: { hoy: string; onClose: () => void; onListo: (t: TableroPbi) => void }) {
  const [codigo, setCodigo] = useState("");
  const [fecha, setFecha] = useState(hoy);
  const [titulo, setTitulo] = useState("");
  const [previa, setPrevia] = useState<{ url: string; titulo: string; ancho: number; alto: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"publicar" | "guardar" | null>(null);

  // Vista previa: el servidor valida el código mientras se pega (sin guardar nada).
  useEffect(() => {
    if (!codigo.trim()) { setPrevia(null); setError(null); return; }
    const t = window.setTimeout(async () => {
      try {
        const p = await apiFetch<{ url: string; titulo: string; ancho: number; alto: number }>(`${PBI_API}/validar`, { method: "POST", body: JSON.stringify({ codigo }) });
        setPrevia(p); setError(null); setTitulo((x) => x || p.titulo);
      } catch (e: any) { setPrevia(null); setError(e.message); }
    }, 400);
    return () => window.clearTimeout(t);
  }, [codigo]);

  const pegar = async () => {
    try { setCodigo(await navigator.clipboard.readText()); } catch { setError("No se pudo leer el portapapeles: pegalo en el recuadro."); }
  };
  const enviar = async (publicar: boolean) => {
    setOcupado(publicar ? "publicar" : "guardar");
    try {
      onListo(await apiFetch<TableroPbi>(PBI_API, { method: "POST", body: JSON.stringify({ codigo, fecha, titulo: titulo || null, publicar }) }));
    } catch (e: any) { setError(e.message); } finally { setOcupado(null); }
  };
  return (
    <Hoja titulo="Cargar PBI" sobre="Productividad · tablero de Power BI" onClose={onClose} ocupada={!!ocupado}
      pie={<>
        <Boton tipo="secundario" onClick={() => enviar(false)} disabled={!previa || !!ocupado} ocupado={ocupado === "guardar"}>Guardar sin publicar</Boton>
        <Boton icono={Upload} onClick={() => enviar(true)} disabled={!previa || !!ocupado} ocupado={ocupado === "publicar"}>Publicar</Boton>
      </>}>
      <ol className="text-sm text-brand-slate space-y-1 mb-4 list-decimal pl-5">
        <li>En Power BI: <b className="text-brand-ink">Archivo → Insertar informe → Publicar en la web</b>.</li>
        <li>Copiá el <b className="text-brand-ink">código HTML</b> (el &lt;iframe …&gt;) y pegalo acá.</li>
      </ol>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label htmlFor="pbi-codigo" className="text-sm font-semibold text-brand-ink">Código del iframe</label>
        <button type="button" onClick={pegar} className="text-sm font-semibold text-brand-primary inline-flex items-center gap-1">
          <ClipboardPaste size={15} aria-hidden /> Pegar
        </button>
      </div>
      <textarea id="pbi-codigo" className="input min-h-[96px] font-mono text-xs" value={codigo} onChange={(e) => setCodigo(e.target.value)}
        placeholder='<iframe title="…" src="https://app.powerbi.com/view?r=…"></iframe>' spellCheck={false} autoCapitalize="off" />
      {error && <p className="text-sm text-brand-primary-dark mt-2" role="alert">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_170px] gap-3 mt-4">
        <div>
          <label htmlFor="pbi-titulo" className="block text-sm font-semibold text-brand-ink mb-1.5">Título</label>
          <input id="pbi-titulo" className="input" maxLength={120} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="SPH a Oct17" />
        </div>
        <div>
          <label htmlFor="pbi-fecha" className="block text-sm font-semibold text-brand-ink mb-1.5">Día</label>
          <input id="pbi-fecha" type="date" className="input tabular-nums" max={hoy} value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        </div>
      </div>
      {previa && (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-1.5">Vista previa</div>
          <div className="rounded-lg border border-brand-border overflow-hidden" style={{ aspectRatio: `${previa.ancho} / ${previa.alto}` }}>
            <iframe title="Vista previa" src={previa.url} className="w-full h-full border-0" sandbox={SANDBOX} loading="lazy" />
          </div>
        </div>
      )}
      <p className="text-[11px] text-brand-slate mt-4 flex gap-1.5">
        <Info size={13} className="shrink-0 mt-px" aria-hidden />
        «Publicar en la web» deja el informe visible para quien tenga el link: no publiques datos de Facturación ni datos personales.
        Publicar reemplaza al publicado de ese día.
      </p>
    </Hoja>
  );
}

const ESTADO: Record<TableroPbi["estado"], { label: string; chip: string }> = {
  publicado: { label: "Publicado", chip: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  guardado: { label: "Sin publicar", chip: "bg-brand-orange/10 text-[#8A5200] border-brand-orange/40" },
  reemplazado: { label: "Reemplazado", chip: "bg-brand-bg text-brand-slate border-brand-border" },
};

/** Lo cargado (últimos 60 días), para los publicadores: publicar uno guardado, ver o eliminar. */
export function HistorialPbi({ refresco, onCambio }: { refresco: number; onCambio: () => void }) {
  const [lista, setLista] = useState<TableroPbi[] | null>(null);
  const [hoy, setHoy] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<TableroPbi | null>(null);
  const [ver, setVer] = useState<TableroPbi | null>(null);
  const [aviso, avisar] = useAviso();
  useEffect(() => {
    apiFetch<{ hoy: string; tableros: TableroPbi[] }>(PBI_API).then((r) => { setLista(r.tableros); setHoy(r.hoy); }).catch((e) => avisar(e.message, "error"));
  }, [refresco, avisar]);
  const accion = async (t: TableroPbi, fn: () => Promise<unknown>, ok: string) => {
    setOcupado(t.id);
    try { await fn(); avisar(ok); onCambio(); } catch (e: any) { avisar(e.message, "error"); } finally { setOcupado(null); }
  };
  if (!lista) return null;
  return (
    <section className="card p-4" aria-label="Tableros cargados">
      <h2 className="font-semibold text-brand-ink">Cargados</h2>
      <p className="text-xs text-brand-slate">Los últimos 60 días. Se muestra el publicado del día más nuevo.</p>
      {!lista.length ? <p className="text-sm text-brand-slate mt-3">Todavía no se cargó ninguno.</p> : (
        <ul className="mt-3 divide-y divide-brand-border">
          {lista.map((t) => (
            <li key={t.id} className="py-3 flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-brand-ink text-sm">{diaPbi(t.fecha, hoy)}</span>
                  <span className={cx("inline-flex rounded-md border px-1.5 py-px text-[10px] font-semibold", ESTADO[t.estado].chip)}>{ESTADO[t.estado].label}</span>
                </div>
                <div className="text-sm text-brand-graphite truncate">{t.titulo}</div>
                <div className="text-[11px] text-brand-slate">Cargado por {t.cargado_por ?? "—"} {hora(t.cargado_at)}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" className="btn-secondary !py-1.5 !px-3 !text-xs" onClick={() => setVer(t)}>Ver</button>
                {t.estado !== "publicado" && (
                  <button type="button" className="btn-primary !py-1.5 !px-3 !text-xs" disabled={ocupado === t.id}
                    onClick={() => accion(t, () => apiFetch(`${PBI_API}/${t.id}/publicar`, { method: "POST" }), "Publicado: ya lo ven los supervisores.")}>
                    Publicar
                  </button>
                )}
                <button type="button" className="w-8 h-8 grid place-items-center rounded-md text-brand-slate hover:text-brand-primary-dark hover:bg-brand-bg"
                  aria-label={`Eliminar ${t.titulo}`} onClick={() => setBorrar(t)}><Trash2 size={15} aria-hidden /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {borrar && (
        <Hoja titulo="¿Eliminar el tablero?" sobre={`${diaPbi(borrar.fecha, hoy)} · ${borrar.titulo}`} onClose={() => setBorrar(null)}
          pie={<>
            <Boton tipo="secundario" onClick={() => setBorrar(null)}>Cancelar</Boton>
            <Boton tipo="peligro" icono={Trash2} ocupado={ocupado === borrar.id}
              onClick={() => { const t = borrar; setBorrar(null); accion(t, () => apiFetch(`${PBI_API}/${t.id}`, { method: "DELETE" }), "Tablero eliminado."); }}>
              Eliminar
            </Boton>
          </>}>
          <p className="text-sm text-brand-slate">
            {borrar.estado === "publicado" ? "Es el publicado de ese día: si había uno anterior de ese día, vuelve a mostrarse ese." : "No se está mostrando a nadie."}
          </p>
        </Hoja>
      )}
      {ver && <PantallaCompleta t={ver} onClose={() => setVer(null)} />}
      {aviso}
    </section>
  );
}
