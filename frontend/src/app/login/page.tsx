"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { LogoAnimado } from "@/components/LogoAnimado";
import { PanelMarca } from "@/components/PanelMarca";
import { getToken, login, login2fa, motivoSalida, type LoginResult } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [desafio, setDesafio] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");

  useEffect(() => {
    if (getToken()) router.replace("/inicio");
    setAviso(motivoSalida());
  }, [router]);

  const seguir = (r: LoginResult) => {
    if (r.tipo === "2fa") {
      setDesafio(r.desafio);
      setCodigo("");
      return;
    }
    router.push(r.requiereCambio ? "/cambiar-contrasena" : "/inicio");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAviso(null);
    setLoading(true);
    try {
      seguir(desafio ? await login2fa(desafio, codigo) : await login(email, password));
    } catch (err: any) {
      setError(err.message);
      if (desafio && /venci/i.test(err.message)) setDesafio(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.35fr_1fr]">
      {/* Panel de marca: titular, escenas de línea que se dibujan solas, una por módulo */}
      <PanelMarca />

      {/* Formulario */}
      <div className="flex items-center justify-center px-6 py-12 bg-brand-bg-soft">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex flex-col items-center gap-2 mb-8">
            <LogoAnimado size={150} />
            <div className="font-display text-sm uppercase tracking-wider2 text-brand-slate">Gerencia Expansión RM</div>
          </div>

          <div className="mb-8">
            <h2 className="font-display text-3xl text-brand-ink uppercase">Iniciar sesión</h2>
            <p className="text-sm text-brand-slate mt-2">Acceso protegido. Solicite credenciales al administrador.</p>
          </div>

          {aviso && (
            <div className="mb-5 rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2.5 text-sm text-brand-graphite">{aviso}</div>
          )}
          <form onSubmit={onSubmit} className="space-y-5">
            {!desafio ? (
              <>
                <div>
                  <label htmlFor="email" className="label">Correo electrónico</label>
                  <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input"
                    placeholder="usuario@voicenter.com.py" autoComplete="email" />
                </div>
                <div>
                  <label htmlFor="password" className="label">Contraseña</label>
                  <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="input"
                    autoComplete="current-password" />
                </div>
              </>
            ) : (
              <div>
                <div className="rounded-lg border border-brand-border bg-white p-4 mb-4 flex gap-3">
                  <span className="w-10 h-10 shrink-0 rounded-full bg-brand-ink text-white grid place-items-center" aria-hidden><Lock size={18} /></span>
                  <div>
                    <div className="font-display text-lg uppercase text-brand-ink leading-none">Verificación en dos pasos</div>
                    <p className="text-xs text-brand-slate mt-1">Abrí tu app autenticadora y escribí el código de 6 dígitos de Operaciones Voicenter. Si no tenés el teléfono, usá un código de recuperación.</p>
                  </div>
                </div>
                <label htmlFor="codigo" className="label">Código</label>
                <input id="codigo" required autoFocus inputMode="numeric" autoComplete="one-time-code" value={codigo}
                  onChange={(e) => setCodigo(e.target.value)} className="input text-center font-display text-3xl tracking-[0.4em]" placeholder="000000" maxLength={20} />
                <button type="button" onClick={() => { setDesafio(null); setError(null); }} className="mt-2 text-xs text-brand-slate hover:text-brand-primary">← Volver</button>
              </div>
            )}
            {error && (
              <div className="bg-brand-primary-light border border-brand-primary/30 text-brand-primary-dark text-sm rounded-md px-3 py-2.5">
                {error}
              </div>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full text-base py-3">
              {loading ? "Verificando…" : desafio ? "Verificar e ingresar" : "Ingresar a la plataforma"}
            </button>
          </form>

          <div className="mt-10 pt-6 border-t border-brand-border text-center text-[11px] text-brand-slate uppercase tracking-wider2">
            © {new Date().getFullYear()} Voicenter S.A.
          </div>
        </div>
      </div>
    </div>
  );
}
