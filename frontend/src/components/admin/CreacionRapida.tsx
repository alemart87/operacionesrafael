"use client";

/**
 * Creación rápida de usuarios (solo superadmin): se elige el perfil y las operativas, se genera un link con QR que vale
 * 30 minutos y quien lo abre se registra y entra directo con ese perfil. Muestra la cuenta regresiva y quiénes se van
 * registrando, en vivo.
 */
import { Ban, Check, Copy, QrCode, RefreshCw, Share2, ShieldAlert, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Boton, Etiqueta, Hoja, cx, plural } from "@/components/portal/ui";
import { apiFetch } from "@/lib/api";

export interface PerfilDef { slug: string; name: string; description: string }
export interface OperativaDef { slug: string; name: string; description: string; color: string; available: boolean }

export interface Invitacion {
  id: string;
  perfil: { slug: string; name: string; description: string };
  operativas: { slug: string; name: string }[];
  nota: string | null;
  dominio: string | null;
  max_usos: number;
  usos: number;
  estado: "vigente" | "vencida" | "revocada" | "agotada";
  sensible: boolean;
  created_at: string | null;
  expires_at: string;
  segundos: number;
  revocada_at: string | null;
  registrados: { id: string; full_name: string; email: string; is_active: boolean; created_at: string | null }[];
  url: string | null;
  qr_svg: string | null;
}

export interface ListaInvitaciones { items: Invitacion[]; minutos: number; max_usos: number; perfiles_sensibles: string[] }

const API = "/api/v1/invitaciones";

export const ESTADO_LINK: Record<Invitacion["estado"], { label: string; tono: "verde" | "gris" | "rojo" | "azul" }> = {
  vigente: { label: "Vigente", tono: "verde" },
  vencida: { label: "Vencido", tono: "gris" },
  revocada: { label: "Anulado", tono: "rojo" },
  agotada: { label: "Cupo completo", tono: "azul" },
};

/** Segundos que faltan, contados contra el reloj del servidor (lo que dijo al traer el link), no el del navegador. */
export function useCuentaRegresiva(segundos: number | null, desde: number): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (segundos === null) return;
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [segundos]);
  if (segundos === null) return 0;
  return Math.max(0, Math.round(segundos - (ahora - desde) / 1000));
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// ------------------------------------------------------------------ formulario
function Formulario({ perfiles, operativas, cfg, perfilInicial, onCreada }: {
  perfiles: PerfilDef[]; operativas: OperativaDef[]; cfg: Pick<ListaInvitaciones, "minutos" | "max_usos" | "perfiles_sensibles">;
  perfilInicial?: string; onCreada: (inv: Invitacion) => void;
}) {
  const disponibles = operativas.filter((o) => o.available);
  const [perfil, setPerfil] = useState(perfilInicial && perfiles.some((p) => p.slug === perfilInicial) ? perfilInicial : "");
  const [ops, setOps] = useState<string[]>(disponibles.map((o) => o.slug));
  const sensible = cfg.perfiles_sensibles.includes(perfil);
  const [cupo, setCupo] = useState(sensible ? 1 : 10);
  const [nota, setNota] = useState("");
  const [dominio, setDominio] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const elegirPerfil = (slug: string) => {
    setPerfil(slug);
    if (cfg.perfiles_sensibles.includes(slug)) setCupo(1);
  };
  const generar = async () => {
    setOcupado(true);
    setError(null);
    try {
      onCreada(await apiFetch<Invitacion>(API, {
        method: "POST",
        body: JSON.stringify({ perfil, operativas: ops, max_usos: cupo, nota: nota.trim() || null, dominio: dominio.trim() || null, origen: window.location.origin }),
      }));
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  const listo = !!perfil && ops.length > 0 && cupo >= 1 && cupo <= cfg.max_usos;

  return (
    <div className="space-y-5">
      <p className="text-sm text-brand-slate">
        Se genera un link y un QR que valen <b className="text-brand-ink">{cfg.minutos} minutos</b>. Quien lo abre escribe su nombre, su correo y su
        contraseña, y entra directo con el perfil que elijas.
      </p>
      <fieldset>
        <legend className="label">Perfil</legend>
        <div className="grid sm:grid-cols-2 gap-2">
          {perfiles.map((p) => (
            <button key={p.slug} type="button" onClick={() => elegirPerfil(p.slug)} aria-pressed={perfil === p.slug}
              className={cx("min-h-[64px] p-3 text-left rounded-lg border-2 transition-colors",
                perfil === p.slug ? "border-brand-primary bg-brand-primary-light/60" : "border-brand-border hover:border-brand-mist")}>
              <span className="flex items-center gap-1.5 font-semibold text-sm text-brand-ink">
                {p.name}{cfg.perfiles_sensibles.includes(p.slug) && <ShieldAlert size={14} className="text-brand-primary" aria-label="Perfil sensible" />}
              </span>
              <span className="block text-[11px] text-brand-slate mt-0.5 leading-snug">{p.description}</span>
            </button>
          ))}
        </div>
      </fieldset>
      {sensible && (
        <div className="rounded-lg border border-brand-primary/30 bg-brand-primary-light/50 px-3 py-2.5 text-sm text-brand-primary-dark flex gap-2">
          <ShieldAlert size={18} className="shrink-0 mt-0.5" aria-hidden />
          <span>Este perfil ve Facturación e Integraciones. Mostrale el QR solo a la persona indicada y dejá el cupo en 1.</span>
        </div>
      )}
      {disponibles.length > 1 && (
        <fieldset>
          <legend className="label">Operativas</legend>
          <div className="space-y-2">
            {disponibles.map((o) => (
              <label key={o.slug} className={cx("flex items-center gap-2.5 min-h-[48px] px-3 rounded-lg border cursor-pointer",
                ops.includes(o.slug) ? "border-brand-primary bg-brand-primary-light/30" : "border-brand-border")}>
                <input type="checkbox" className="w-5 h-5 accent-brand-primary" checked={ops.includes(o.slug)}
                  onChange={() => setOps((v) => (v.includes(o.slug) ? v.filter((x) => x !== o.slug) : [...v, o.slug]))} />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: o.color }} aria-hidden />
                <span className="text-sm font-semibold text-brand-ink">{o.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {disponibles.length === 1 && (
        <p className="text-sm text-brand-slate">Operativa: <b className="text-brand-ink">{disponibles[0].name}</b></p>
      )}
      <div>
        <label className="label" htmlFor="cupo">¿Cuántas personas lo pueden usar?</label>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Menos" onClick={() => setCupo((c) => Math.max(1, c - 1))}
            className="w-12 h-12 rounded-lg border border-brand-border text-xl font-bold text-brand-ink hover:border-brand-ink">−</button>
          <input id="cupo" type="number" inputMode="numeric" min={1} max={cfg.max_usos} value={cupo}
            onChange={(e) => setCupo(Math.max(1, Math.min(cfg.max_usos, Number(e.target.value) || 1)))}
            className="input !w-24 text-center !text-lg font-semibold tabular-nums" />
          <button type="button" aria-label="Más" onClick={() => setCupo((c) => Math.min(cfg.max_usos, c + 1))}
            className="w-12 h-12 rounded-lg border border-brand-border text-xl font-bold text-brand-ink hover:border-brand-ink">+</button>
        </div>
        <p className="text-[11px] text-brand-slate mt-1">Cuando se completa el cupo, el link deja de funcionar aunque no haya vencido.</p>
      </div>
      <details className="rounded-lg border border-brand-border">
        <summary className="px-3 min-h-[48px] flex items-center cursor-pointer text-sm font-semibold text-brand-ink">Opciones</summary>
        <div className="px-3 pb-3 space-y-3">
          <div>
            <label className="label" htmlFor="nota">Nombre del link (para reconocerlo)</label>
            <input id="nota" className="input" maxLength={120} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: Supervisores nuevos de octubre" />
          </div>
          <div>
            <label className="label" htmlFor="dominio">Solo correos de</label>
            <div className="flex items-center gap-1.5">
              <span className="text-brand-slate">@</span>
              <input id="dominio" className="input" maxLength={120} value={dominio} onChange={(e) => setDominio(e.target.value)} placeholder="voicenter.com.py (opcional)" autoCapitalize="none" />
            </div>
          </div>
        </div>
      </details>
      {error && <div className="rounded-md border border-brand-primary/30 bg-brand-primary-light px-3 py-2.5 text-sm text-brand-primary-dark">{error}</div>}
      <Boton icono={QrCode} onClick={generar} ocupado={ocupado} disabled={!listo}>Generar link y QR</Boton>
    </div>
  );
}

// ------------------------------------------------------------------ el link con su QR
function VistaLink({ inicial, onCambio, onOtro }: { inicial: Invitacion; onCambio: (inv: Invitacion) => void; onOtro: () => void }) {
  const [inv, setInv] = useState(inicial);
  const [desde, setDesde] = useState(() => Date.now());
  const [copiado, setCopiado] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const resto = useCuentaRegresiva(inv.estado === "vigente" ? inv.segundos : null, desde);
  const vigente = inv.estado === "vigente" && resto > 0;
  // Al pasar del formulario al QR, la hoja vuelve arriba (si no, en el celular el QR queda cortado).
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => { raiz.current?.closest(".overflow-y-auto")?.scrollTo({ top: 0 }); }, []);

  const refrescar = useCallback(async () => {
    try {
      const x = await apiFetch<Invitacion>(`${API}/${inv.id}`);
      setInv((prev) => ({ ...x, url: x.url ?? (x.estado === "vigente" ? prev.url : null), qr_svg: x.qr_svg ?? (x.estado === "vigente" ? prev.qr_svg : null) }));
      setDesde(Date.now());
      onCambio(x);
    } catch { /* se reintenta en la próxima vuelta */ }
  }, [inv.id, onCambio]);
  // Quiénes se van registrando, en vivo (cada 4 s mientras está vigente).
  useEffect(() => {
    if (inv.estado !== "vigente") return;
    const t = setInterval(refrescar, 4000);
    return () => clearInterval(t);
  }, [inv.estado, refrescar]);
  useEffect(() => { if (inv.estado === "vigente" && resto === 0) refrescar(); }, [resto, inv.estado, refrescar]);

  const copiar = async () => {
    if (!inv.url) return;
    try { await navigator.clipboard.writeText(inv.url); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sin portapapeles */ }
  };
  const compartir = async () => {
    if (!inv.url) return;
    try { await navigator.share({ title: "Operaciones Voicenter", text: `Registrate como ${inv.perfil.name} (vale ${mmss(resto)} min):`, url: inv.url }); } catch { /* cancelado */ }
  };
  const anular = async () => {
    setAnulando(true);
    try { const x = await apiFetch<Invitacion>(`${API}/${inv.id}/revocar`, { method: "POST" }); setInv(x); onCambio(x); setConfirmar(false); }
    finally { setAnulando(false); }
  };
  const est = vigente ? ESTADO_LINK.vigente : inv.estado === "vigente" ? ESTADO_LINK.vencida : ESTADO_LINK[inv.estado];
  const puedeCompartir = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <div ref={raiz} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Etiqueta tono="tinta">{inv.perfil.name}</Etiqueta>
        {inv.operativas.map((o) => <Etiqueta key={o.slug}>{o.name}</Etiqueta>)}
        {inv.dominio && <Etiqueta>Solo @{inv.dominio}</Etiqueta>}
        <Etiqueta tono={est.tono}>{est.label}</Etiqueta>
      </div>
      {inv.nota && <p className="text-sm text-brand-graphite -mt-1">{inv.nota}</p>}

      <div className="flex flex-col items-center">
        <div className={cx("relative w-full max-w-[300px] aspect-square rounded-xl border border-brand-border bg-white p-3", !vigente && "opacity-25")}>
          {inv.qr_svg ? <div className="w-full h-full [&_svg]:w-full [&_svg]:h-full" role="img" aria-label="Código QR del link de registro" dangerouslySetInnerHTML={{ __html: inv.qr_svg }} />
            : <div className="w-full h-full grid place-items-center text-brand-mist"><QrCode size={96} aria-hidden /></div>}
        </div>
        <div className={cx("mt-3 font-display text-4xl tabular-nums leading-none", vigente ? (resto < 300 ? "text-brand-primary" : "text-brand-ink") : "text-brand-slate")} aria-live="polite">
          {vigente ? mmss(resto) : est.label}
        </div>
        <div className="text-xs text-brand-slate mt-1">{vigente ? "para que venza el link" : "El link ya no funciona."}</div>
      </div>

      {vigente && inv.url && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input readOnly value={inv.url} className="input font-mono !text-xs" aria-label="Link de registro" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" onClick={copiar} className="btn-secondary !min-h-[46px] shrink-0" aria-label="Copiar el link">
              {copiado ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}<span className="hidden sm:inline">{copiado ? "Copiado" : "Copiar"}</span>
            </button>
          </div>
          {puedeCompartir && <Boton tipo="secundario" icono={Share2} onClick={compartir}>Compartir el link</Boton>}
        </div>
      )}

      <div className="rounded-lg border border-brand-border">
        <div className="px-3 py-2.5 flex items-center justify-between gap-2 border-b border-brand-border">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-ink"><Users size={16} aria-hidden /> Registrados</span>
          <span className="text-sm tabular-nums text-brand-slate">{inv.usos} de {inv.max_usos}</span>
        </div>
        {inv.registrados.length ? (
          <ul className="divide-y divide-brand-border">
            {inv.registrados.map((u) => (
              <li key={u.id} className="px-3 py-2.5 min-w-0">
                <div className="text-sm font-semibold text-brand-ink truncate">{u.full_name}</div>
                <div className="text-xs text-brand-slate truncate">{u.email}</div>
              </li>
            ))}
          </ul>
        ) : <p className="px-3 py-3 text-sm text-brand-slate">{vigente ? "Todavía nadie. Se actualiza solo." : "Nadie se registró con este link."}</p>}
      </div>

      {vigente ? (
        confirmar ? (
          <div className="rounded-lg border border-brand-primary/40 p-3 space-y-2">
            <p className="text-sm text-brand-ink">¿Anular el link? Deja de funcionar ya; los que se registraron siguen activos.</p>
            <div className="flex gap-2">
              <Boton tipo="secundario" onClick={() => setConfirmar(false)} disabled={anulando}>Volver</Boton>
              <Boton tipo="peligro" icono={Ban} onClick={anular} ocupado={anulando}>Anular</Boton>
            </div>
          </div>
        ) : <Boton tipo="peligro" icono={Ban} onClick={() => setConfirmar(true)}>Anular el link</Boton>
      ) : <Boton tipo="secundario" icono={RefreshCw} onClick={onOtro}>Generar otro link</Boton>}
    </div>
  );
}

// ------------------------------------------------------------------ la hoja completa
export function CreacionRapida({ perfiles, operativas, cfg, perfilInicial, abrir, onClose, onCambio }: {
  perfiles: PerfilDef[]; operativas: OperativaDef[]; cfg: Pick<ListaInvitaciones, "minutos" | "max_usos" | "perfiles_sensibles">;
  perfilInicial?: string; abrir?: Invitacion | null; onClose: () => void; onCambio: () => void;
}) {
  const [inv, setInv] = useState<Invitacion | null>(abrir ?? null);
  const [clave, setClave] = useState(0);
  return (
    <Hoja sobre="Usuarios" titulo={inv ? "Link de registro" : "Creación rápida"} onClose={onClose}>
      {inv ? (
        <VistaLink key={inv.id} inicial={inv} onCambio={onCambio} onOtro={() => { setInv(null); setClave((k) => k + 1); }} />
      ) : (
        <Formulario key={clave} perfiles={perfiles} operativas={operativas} cfg={cfg} perfilInicial={perfilInicial}
          onCreada={(x) => { setInv(x); onCambio(); }} />
      )}
    </Hoja>
  );
}

// ------------------------------------------------------------------ lista de links
export function LinksRapidos({ lista, onAbrir }: { lista: ListaInvitaciones | null; onAbrir: (inv: Invitacion) => void }) {
  const [desde] = useState(() => Date.now());
  const [, tic] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tic((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!lista || !lista.items.length) return null;
  return (
    <section className="card overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-brand-border flex items-center gap-2">
        <UserPlus size={18} className="text-brand-ink" aria-hidden />
        <div>
          <h2 className="font-display text-xl text-brand-ink uppercase">Links de creación rápida</h2>
          <p className="text-xs text-brand-slate">Los últimos {lista.items.length}. Cada uno vale {lista.minutos} minutos.</p>
        </div>
      </div>
      <ul className="divide-y divide-brand-border">
        {lista.items.map((x) => {
          const resto = x.estado === "vigente" ? Math.max(0, Math.round(x.segundos - (Date.now() - desde) / 1000)) : 0;
          const est = x.estado === "vigente" && resto === 0 ? ESTADO_LINK.vencida : ESTADO_LINK[x.estado];
          return (
            <li key={x.id}>
              <button type="button" onClick={() => onAbrir(x)} className="w-full text-left px-5 py-3 min-h-[64px] hover:bg-brand-bg-soft flex items-center gap-3">
                <span className={cx("w-10 h-10 rounded-lg grid place-items-center shrink-0", est === ESTADO_LINK.vigente ? "bg-brand-ink text-white" : "bg-brand-bg text-brand-slate")}>
                  <QrCode size={20} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-brand-ink">{x.perfil.name}</span>
                    <Etiqueta tono={est.tono}>{est === ESTADO_LINK.vigente ? `Vence en ${mmss(resto)}` : est.label}</Etiqueta>
                    {x.sensible && <ShieldAlert size={14} className="text-brand-primary" aria-label="Perfil sensible" />}
                  </span>
                  <span className="block text-xs text-brand-slate truncate">
                    {x.nota ? `${x.nota} · ` : ""}{plural(x.usos, "registrado", "registrados")} de {x.max_usos}
                    {x.registrados.length ? `: ${x.registrados.map((u) => u.full_name).join(", ")}` : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
