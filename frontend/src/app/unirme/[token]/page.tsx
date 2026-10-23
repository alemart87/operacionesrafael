"use client";

/**
 * Creación rápida de postulantes (sin usuario): el postulante escanea el QR o abre el link que habilitó su capacitador
 * o mentor, carga sus datos y queda en el grupo. Al terminar le da la bienvenida y lo lleva a su perfil de postulante
 * (su link personal, el mismo del test y los entrenamientos).
 */
import { CircleCheck, Clock3, LoaderCircle, Lock, TriangleAlert, UserPlus } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { mmss, useCuentaRegresiva } from "@/components/admin/CreacionRapida";
import { SEXOS, type Sexo } from "@/components/capacitacion/tipos";
import { Boton, Chips, cx } from "@/components/portal/ui";

const API = "/api/v1/capacitacion/unirme";
const ESPERA_MS = 4500;      // lo que se ve la bienvenida antes de ir a su perfil

interface Info { grupo: string; vence_at: string; segundos: number }
interface Alta { nombre: string; sexo: Sexo; grupo: string; token: string; ruta: string }

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) {
    const d = b?.detail;
    const msg = typeof d === "string" ? d : Array.isArray(d) ? "Revisá los datos: alguno no es válido." : d?.message ?? "No se pudo conectar. Probá de nuevo.";
    const e = new Error(msg);
    (e as any).status = r.status;
    (e as any).code = typeof d === "object" && !Array.isArray(d) ? d?.code : undefined;
    throw e;
  }
  return b as T;
}

const bienvenida = (sexo: Sexo) => (sexo === "F" ? "¡Bienvenida" : sexo === "M" ? "¡Bienvenido" : "¡Te damos la bienvenida");

export default function UnirmePage() {
  const { token } = useParams<{ token: string }>();
  const base = `${API}/${encodeURIComponent(token)}`;
  const [info, setInfo] = useState<Info | null>(null);
  const [desde, setDesde] = useState(0);
  const [cerrado, setCerrado] = useState<string | null>(null);
  const [f, setF] = useState({ nombre: "", apellido: "", ci: "", edad: "", sexo: "" as Sexo | "", sitio: "" });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alta, setAlta] = useState<Alta | null>(null);

  useEffect(() => {
    pedir<Info>(base).then((x) => { setInfo(x); setDesde(Date.now()); }).catch((e) => setCerrado(e.message));
  }, [base]);
  const quedan = useCuentaRegresiva(info && !alta ? info.segundos : null, desde);
  useEffect(() => { if (info && !alta && quedan === 0) setCerrado("Este link venció. Pedile a tu capacitador que habilite uno nuevo."); }, [info, alta, quedan]);

  // Después de la bienvenida, a su perfil (sin dejar el formulario en el historial del navegador).
  const irAlPerfil = useCallback(() => { if (alta) window.location.replace(alta.ruta); }, [alta]);
  useEffect(() => {
    if (!alta) return;
    const t = setTimeout(irAlPerfil, ESPERA_MS);
    return () => clearTimeout(t);
  }, [alta, irAlPerfil]);

  const edad = Number(f.edad);
  const listo = f.nombre.trim().length >= 2 && f.apellido.trim().length >= 2 && f.ci.replace(/\D/g, "").length >= 3 && edad >= 15 && edad <= 80 && !!f.sexo;
  const enviar = async () => {
    if (!listo || ocupado) return;
    setOcupado(true); setError(null);
    try {
      setAlta(await pedir<Alta>(base, { method: "POST", body: JSON.stringify({ ...f, edad, sitio: f.sitio || null }) }));
    } catch (e: any) {
      if (e.status === 410 || e.status === 404) setCerrado(e.message);
      else setError(e.message);
    } finally { setOcupado(false); }
  };

  return (
    <div className="min-h-[100dvh] bg-brand-bg flex flex-col">
      <header className="bg-white border-b border-brand-border px-4 py-3 flex items-center justify-between">
        <Brand logoHeight={32} compactOnPhone />
        {info && !cerrado && <span className="text-[11px] uppercase tracking-wider2 text-brand-slate truncate max-w-[50%]">{info.grupo}</span>}
      </header>
      <main className="flex-1 w-full max-w-lg mx-auto px-4 pt-5 pb-6 flex flex-col">
        {!info && !cerrado && <div className="m-auto"><LoaderCircle size={32} className="animate-spin text-brand-slate" aria-label="Cargando" /></div>}

        {cerrado && !alta && (
          <div className="m-auto text-center space-y-3 py-16 max-w-sm">
            <span className="mx-auto w-14 h-14 rounded-2xl bg-brand-primary-light text-brand-primary flex items-center justify-center"><TriangleAlert size={28} aria-hidden /></span>
            <p className="text-lg font-semibold text-brand-ink leading-snug">{cerrado}</p>
          </div>
        )}

        {alta && (
          // La bienvenida al grupo y, enseguida, su perfil.
          <div className="m-auto w-full text-center py-10 animate-pop" role="status" aria-live="polite">
            <CircleCheck size={64} className="mx-auto text-emerald-600" aria-hidden />
            <div className="mt-4 text-[11px] uppercase tracking-wider2 text-brand-slate">Capacitación Voicenter</div>
            <h1 className="font-display text-[34px] uppercase leading-[1.05] text-brand-ink">
              {bienvenida(alta.sexo)}, <span className="text-brand-primary">{alta.nombre}</span>!
            </h1>
            <p className="mt-2 text-[16px] text-brand-ink">Ya sos parte del grupo <b>{alta.grupo}</b>.</p>
            <p className="mt-1 text-[14px] text-brand-slate">Ahí vas a hacer tu test de perfil comercial y tus entrenamientos.</p>
            <div className="mt-6 mx-auto max-w-xs h-1.5 rounded-full bg-white border border-brand-border overflow-hidden" aria-hidden>
              <div className="h-full bg-brand-ink rounded-full unirme-barra" style={{ animationDuration: `${ESPERA_MS}ms` }} />
            </div>
            <p className="mt-2 text-[13px] text-brand-slate">Te llevamos a tu perfil…</p>
            <div className="mt-5 max-w-xs mx-auto"><Boton onClick={irAlPerfil}>Ir a mi perfil</Boton></div>
            <p className="mt-4 text-[12px] text-brand-slate flex items-center justify-center gap-1.5"><Lock size={13} aria-hidden /> Tu perfil tiene un link personal: guardalo y no lo compartas.</p>
          </div>
        )}

        {info && !cerrado && !alta && (
          <form className="flex-1 flex flex-col" onSubmit={(e) => { e.preventDefault(); enviar(); }} noValidate>
            <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Sumate al grupo</div>
            <h1 className="font-display text-[34px] uppercase leading-[1.05] text-brand-ink break-words">{info.grupo}</h1>
            <p className="text-[15px] text-brand-slate mt-1">Cargá tus datos y listo: entrás a tu perfil de postulante.</p>
            <span className={cx("mt-3 self-start inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold tabular-nums",
              quedan <= 120 ? "bg-brand-primary-light text-brand-primary-dark" : "bg-white border border-brand-border text-brand-slate")}>
              <Clock3 size={14} aria-hidden /> El link vence en {mmss(quedan)}
            </span>

            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label" htmlFor="un">Nombre</label>
                  <input id="un" className="input text-[16px]" autoComplete="given-name" value={f.nombre} maxLength={80} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
                <div><label className="label" htmlFor="ua">Apellido</label>
                  <input id="ua" className="input text-[16px]" autoComplete="family-name" value={f.apellido} maxLength={80} onChange={(e) => setF({ ...f, apellido: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-[1fr_96px] gap-3">
                <div><label className="label" htmlFor="uc">Cédula (CI)</label>
                  <input id="uc" className="input text-[16px]" inputMode="numeric" autoComplete="off" value={f.ci} maxLength={20} onChange={(e) => setF({ ...f, ci: e.target.value })} /></div>
                <div><label className="label" htmlFor="ue">Edad</label>
                  <input id="ue" className="input text-[16px]" inputMode="numeric" value={f.edad} maxLength={2} onChange={(e) => setF({ ...f, edad: e.target.value.replace(/\D/g, "") })} /></div>
              </div>
              <div><span className="label">Sexo</span>
                <Chips etiqueta="Sexo" opciones={SEXOS} valor={f.sexo ? [f.sexo] : []} onChange={(v) => setF({ ...f, sexo: (v[0] ?? "") as Sexo | "" })} /></div>
              {/* Campo trampa para programas: las personas no lo ven. */}
              <div aria-hidden className="absolute -left-[9999px] w-px h-px overflow-hidden">
                <label htmlFor="us">Sitio web</label>
                <input id="us" tabIndex={-1} autoComplete="off" value={f.sitio} onChange={(e) => setF({ ...f, sitio: e.target.value })} />
              </div>
              {error && <p role="alert" className="rounded-lg bg-brand-primary-light/60 px-3 py-2 text-[14px] text-brand-primary-dark">{error}</p>}
            </div>

            <div className="mt-auto pt-6 space-y-3">
              <p className="text-[12px] text-brand-slate flex gap-1.5"><Lock size={13} className="mt-0.5 shrink-0" aria-hidden />
                Tus datos los ve solo el equipo de capacitación de Voicenter.</p>
              <Boton type="submit" icono={UserPlus} ocupado={ocupado} disabled={!listo}>Crear mi perfil</Boton>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
