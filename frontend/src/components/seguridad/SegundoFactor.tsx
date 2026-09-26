"use client";

import { ShieldCheck, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface Estado { activo: boolean; codigos_restantes: number; recomendado: boolean }
interface Inicio { secreto: string; uri: string; qr_svg: string }

/** Verificación en dos pasos (TOTP): opcional para todos y recomendada. */
export function SegundoFactor() {
  const [e, setE] = useState<Estado | null>(null);
  const [ini, setIni] = useState<Inicio | null>(null);
  const [codigo, setCodigo] = useState("");
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const [baja, setBaja] = useState(false);
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = () => apiFetch<Estado>("/api/v1/auth/2fa").then(setE).catch((x) => setError(x.message));
  useEffect(() => { cargar(); }, []);

  const hacer = async (fn: () => Promise<void>) => {
    setError(null);
    setOcupado(true);
    try { await fn(); } catch (x: any) { setError(x.message); } finally { setOcupado(false); }
  };

  if (!e) return null;
  return (
    <section id="segundo-factor" className="card p-6 scroll-mt-32">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h2 className="font-display text-xl text-brand-ink uppercase">Verificación en dos pasos</h2>
        {e.activo ? (
          <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"><ShieldCheck size={14} />Activa</span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded border border-brand-orange/40 bg-brand-orange/10 px-2 py-0.5 text-xs font-semibold text-[#B86E00]"><ShieldAlert size={14} />Recomendada</span>
        )}
      </div>
      <p className="text-sm text-brand-slate mb-4">
        Además de la contraseña, al ingresar se pide un código de 6 dígitos de una app autenticadora (Google Authenticator, Microsoft Authenticator, Authy). Si alguien consigue tu contraseña, igual no puede entrar.
      </p>

      {codigos && (
        <div className="rounded-lg border-2 border-dashed border-brand-primary/40 bg-brand-primary-light/40 p-4 mb-4">
          <div className="font-semibold text-brand-ink text-sm">Guardá estos códigos de recuperación</div>
          <p className="text-xs text-brand-slate mb-2">Cada uno sirve una sola vez si perdés el teléfono. No se vuelven a mostrar.</p>
          <div className="grid grid-cols-2 gap-1.5 font-mono text-sm">{codigos.map((c) => <span key={c} className="rounded bg-white px-2 py-1 text-center">{c}</span>)}</div>
          <button className="btn-secondary mt-3 text-xs" onClick={() => navigator.clipboard?.writeText(codigos.join("\n"))}>Copiar códigos</button>
        </div>
      )}

      {!e.activo && !ini && (
        <button disabled={ocupado} className="btn-primary" onClick={() => hacer(async () => setIni(await apiFetch<Inicio>("/api/v1/auth/2fa/iniciar", { method: "POST" })))}>
          Activar verificación en dos pasos
        </button>
      )}

      {!e.activo && ini && (
        <div className="grid sm:grid-cols-[180px_1fr] gap-5 items-start">
          <div className="mx-auto w-full max-w-[200px] sm:max-w-none rounded-lg border border-brand-border bg-white p-2 [&>svg]:block [&>svg]:w-full [&>svg]:h-auto" dangerouslySetInnerHTML={{ __html: ini.qr_svg }} />
          <div className="space-y-3 text-sm">
            <ol className="list-decimal pl-5 space-y-1 text-brand-graphite">
              <li>Abrí la app autenticadora y escaneá el código QR.</li>
              <li>Si no podés escanear, cargá esta clave: <code className="block mt-1 rounded bg-brand-bg px-2 py-1 text-xs break-all">{ini.secreto}</code></li>
              <li>Escribí el código de 6 dígitos que muestra la app.</li>
            </ol>
            <input className="input text-center font-display text-2xl tracking-[0.4em]" inputMode="numeric" maxLength={6} placeholder="000000" value={codigo} onChange={(x) => setCodigo(x.target.value)} />
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => { setIni(null); setCodigo(""); }}>Cancelar</button>
              <button className="btn-primary" disabled={ocupado || codigo.length < 6} onClick={() => hacer(async () => {
                const r = await apiFetch<{ codigos_recuperacion: string[] }>("/api/v1/auth/2fa/activar", { method: "POST", body: JSON.stringify({ codigo }) });
                setCodigos(r.codigos_recuperacion); setIni(null); setCodigo(""); await cargar();
              })}>Confirmar y activar</button>
            </div>
          </div>
        </div>
      )}

      {e.activo && !baja && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-brand-slate">Te quedan {e.codigos_restantes} códigos de recuperación.</span>
          <button className="btn-ghost text-brand-primary text-sm ml-auto" onClick={() => setBaja(true)}>Desactivar</button>
        </div>
      )}
      {e.activo && baja && (
        <div className="space-y-3">
          <p className="text-sm text-brand-slate">Para desactivarla confirmá tu contraseña y un código de la app (o uno de recuperación).</p>
          <input type="password" className="input" placeholder="Contraseña" value={pwd} onChange={(x) => setPwd(x.target.value)} />
          <input className="input" placeholder="Código" value={codigo} onChange={(x) => setCodigo(x.target.value)} />
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => { setBaja(false); setPwd(""); setCodigo(""); }}>Cancelar</button>
            <button className="btn-primary" disabled={ocupado || !pwd || codigo.length < 6} onClick={() => hacer(async () => {
              await apiFetch("/api/v1/auth/2fa/desactivar", { method: "POST", body: JSON.stringify({ password: pwd, codigo }) });
              setBaja(false); setPwd(""); setCodigo(""); setCodigos(null); await cargar();
            })}>Desactivar</button>
          </div>
        </div>
      )}
      {error && <div className="mt-3 rounded-md border border-brand-primary/30 bg-brand-primary-light px-3 py-2 text-sm text-brand-primary-dark">{error}</div>}
    </section>
  );
}
