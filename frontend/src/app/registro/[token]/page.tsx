"use client";

import { AlertTriangle, Check, CircleCheck, Clock3, Eye, EyeOff, LoaderCircle, UserPlus } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { mmss, useCuentaRegresiva } from "@/components/admin/CreacionRapida";
import { LogoAnimado } from "@/components/LogoAnimado";
import { getUser, registrarConLink } from "@/lib/api";

interface InfoLink {
  perfil: { slug: string; name: string; description: string };
  operativas: { slug: string; name: string }[];
  dominio: string | null;
  expires_at: string;
  segundos: number;
  politica: { min_largo: number; mayus_minus: boolean; numero: boolean; simbolo: boolean };
}

/** Registro con un link de creación rápida (lo abre el QR): nombre, correo y contraseña, y entra directo con su perfil. */
export default function RegistroPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<InfoLink | null>(null);
  const [desde, setDesde] = useState(0);
  const [fallo, setFallo] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [clave2, setClave2] = useState("");
  const [ver, setVer] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);
  const [sesionAbierta, setSesionAbierta] = useState<string | null>(null);

  useEffect(() => {
    setSesionAbierta(getUser()?.email ?? null);
    fetch(`/api/v1/registro/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof b?.detail === "string" ? b.detail : b?.detail?.message ?? "Este link no es válido.");
        setInfo(b);
        setDesde(Date.now());
      })
      .catch((e) => setFallo(e.message));
  }, [token]);

  const resto = useCuentaRegresiva(info ? info.segundos : null, desde);
  const vencido = !!info && resto === 0;

  const reglas = useMemo(() => {
    if (!info) return [];
    const p = info.politica;
    return [
      { ok: clave.length >= Math.max(8, p.min_largo), texto: `Al menos ${Math.max(8, p.min_largo)} caracteres` },
      ...(p.mayus_minus ? [{ ok: /[a-záéíóúñ]/.test(clave) && /[A-ZÁÉÍÓÚÑ]/.test(clave), texto: "Mayúsculas y minúsculas" }] : []),
      ...(p.numero ? [{ ok: /\d/.test(clave), texto: "Un número" }] : []),
      ...(p.simbolo ? [{ ok: /[^\w\s]/.test(clave), texto: "Un símbolo" }] : []),
    ];
  }, [info, clave]);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && (!info?.dominio || email.trim().toLowerCase().endsWith(`@${info.dominio}`));
  const nombreOk = nombre.trim().split(/\s+/).length >= 2;
  const coinciden = clave2.length > 0 && clave === clave2;
  const puede = nombreOk && emailOk && reglas.every((r) => r.ok) && coinciden && !vencido;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!puede) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await registrarConLink(token, { full_name: nombre.trim(), email: email.trim(), password: clave });
      if (r.ingreso) router.replace("/inicio");
      else setListo(r.mensaje);
    } catch (err: any) {
      if (/^link_/.test(err.code ?? "")) setFallo(err.message);
      else setError(err.message);
    } finally { setOcupado(false); }
  };

  return (
    <div className="min-h-[100dvh] bg-brand-bg-soft flex justify-center px-4 py-8 sm:py-14">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-1 mb-6">
          <LogoAnimado size={110} />
          <div className="font-display text-xs uppercase tracking-wider2 text-brand-slate">Gerencia Expansión RM</div>
        </div>

        {fallo ? (
          <div className="card p-6 text-center">
            <span className="mx-auto w-14 h-14 rounded-full bg-brand-primary-light text-brand-primary grid place-items-center"><AlertTriangle size={28} aria-hidden /></span>
            <h1 className="font-display text-2xl uppercase text-brand-ink mt-3">No se puede usar este link</h1>
            <p className="text-sm text-brand-slate mt-2">{fallo}</p>
            <Link href="/login" className="btn-secondary w-full min-h-[52px] mt-5">Ir al inicio de sesión</Link>
          </div>
        ) : listo ? (
          <div className="card p-6 text-center">
            <span className="mx-auto w-14 h-14 rounded-full bg-emerald-50 text-emerald-700 grid place-items-center"><CircleCheck size={30} aria-hidden /></span>
            <h1 className="font-display text-2xl uppercase text-brand-ink mt-3">Usuario creado</h1>
            <p className="text-sm text-brand-slate mt-2">{listo}</p>
            <Link href="/login" className="btn-primary w-full min-h-[52px] mt-5">Ir al inicio de sesión</Link>
          </div>
        ) : !info ? (
          <div className="card p-10 grid place-items-center text-brand-slate" aria-busy="true"><LoaderCircle size={28} className="animate-spin" aria-label="Cargando" /></div>
        ) : (
          <form onSubmit={enviar} className="card overflow-hidden" noValidate>
            <div className="bg-brand-ink text-white px-5 py-5">
              <div className="text-[11px] uppercase tracking-wider2 text-white/60">Te invitaron a Operaciones Voicenter</div>
              <h1 className="font-display text-3xl uppercase leading-tight mt-1">Creá tu usuario</h1>
              <div className="flex flex-wrap gap-1.5 mt-3">
                <span className="rounded-md bg-white text-brand-ink px-2 py-0.5 text-xs font-bold">{info.perfil.name}</span>
                {info.operativas.map((o) => <span key={o.slug} className="rounded-md border border-white/30 px-2 py-0.5 text-xs font-semibold">{o.name}</span>)}
              </div>
              <p className={`mt-3 text-sm flex items-center gap-1.5 ${resto < 300 ? "text-[#FFB4AE]" : "text-white/75"}`} aria-live="polite">
                <Clock3 size={15} aria-hidden /> {vencido ? "El link venció." : `El link vence en ${mmss(resto)}`}
              </p>
            </div>

            <div className="p-5 space-y-4">
              {sesionAbierta && (
                <p className="rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-xs text-brand-graphite">
                  En este navegador está abierta la sesión de {sesionAbierta}. Si te registrás, se reemplaza por la tuya.
                </p>
              )}
              <div>
                <label className="label" htmlFor="nombre">Nombre y apellido</label>
                <input id="nombre" className="input !text-base" required autoComplete="name" autoCapitalize="words" maxLength={120}
                  value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Ana Gómez" />
              </div>
              <div>
                <label className="label" htmlFor="correo">Correo</label>
                <input id="correo" type="email" className="input !text-base" required autoComplete="email" autoCapitalize="none" inputMode="email"
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder={info.dominio ? `nombre@${info.dominio}` : "nombre@correo.com"} />
                {info.dominio && <p className="text-[11px] text-brand-slate mt-1">Usá tu correo de @{info.dominio}.</p>}
                {email && !emailOk && <p className="text-[11px] text-brand-primary-dark mt-1">Revisá el correo.</p>}
              </div>
              <div>
                <label className="label" htmlFor="clave">Contraseña</label>
                <div className="relative">
                  <input id="clave" type={ver ? "text" : "password"} className="input !text-base pr-12" required autoComplete="new-password" maxLength={128}
                    value={clave} onChange={(e) => setClave(e.target.value)} />
                  <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? "Ocultar la contraseña" : "Mostrar la contraseña"}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 grid place-items-center text-brand-slate">
                    {ver ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                  </button>
                </div>
                <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  {reglas.map((r) => (
                    <li key={r.texto} className={`flex items-center gap-1.5 text-xs ${r.ok ? "text-emerald-700" : "text-brand-slate"}`}>
                      <Check size={13} className={r.ok ? "" : "opacity-30"} aria-hidden /> {r.texto}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <label className="label" htmlFor="clave2">Repetí la contraseña</label>
                <input id="clave2" type={ver ? "text" : "password"} className="input !text-base" required autoComplete="new-password" maxLength={128}
                  value={clave2} onChange={(e) => setClave2(e.target.value)} />
                {clave2 && !coinciden && <p className="text-[11px] text-brand-primary-dark mt-1">No coinciden.</p>}
              </div>
              {error && <div className="rounded-md border border-brand-primary/30 bg-brand-primary-light px-3 py-2.5 text-sm text-brand-primary-dark">{error}</div>}
              <button type="submit" disabled={!puede || ocupado} className="btn-primary w-full min-h-[56px] text-base">
                {ocupado ? <LoaderCircle size={20} className="animate-spin" aria-hidden /> : <UserPlus size={20} aria-hidden />}
                Crear mi usuario y entrar
              </button>
              <p className="text-[11px] text-brand-slate text-center">
                Vas a entrar como <b>{info.perfil.name}</b>. Tu contraseña es personal: no la compartas.
              </p>
            </div>
          </form>
        )}

        <div className="mt-8 text-center text-[11px] text-brand-slate uppercase tracking-wider2">© {new Date().getFullYear()} Voicenter S.A.</div>
      </div>
    </div>
  );
}
