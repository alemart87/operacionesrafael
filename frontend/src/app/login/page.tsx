"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, login } from "@/lib/api";

const PILLARS = [
  { title: "Expansión", sub: "Crecimiento y cobertura" },
  { title: "Operaciones", sub: "Seguimiento diario" },
  { title: "Indicadores", sub: "KPIs y metas" },
  { title: "Trazabilidad", sub: "Auditoría completa" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getToken()) router.replace("/inicio");
  }, [router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      router.push("/inicio");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Panel de marca */}
      <div
        className="hidden lg:flex flex-col justify-between p-12 text-white relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #B81F18 0%, #E6332A 55%, #F39200 100%)" }}
      >
        <div className="flex items-center gap-4">
          <div className="bg-white rounded-lg px-4 py-2.5 shadow-elevated">
            <img src="/logo-voicenter-color.png" alt="Voicenter" className="h-9 w-auto block" />
          </div>
        </div>

        <div className="space-y-6 max-w-md relative z-10">
          <h1 className="font-display text-5xl uppercase leading-tight">
            Operaciones<br />
            <span className="text-white/90">Voicenter</span>
          </h1>
          <div className="inline-block bg-white/15 backdrop-blur-sm rounded-md px-3 py-1.5 font-display text-lg uppercase tracking-wide">
            Gerencia Expansión RM
          </div>
          <p className="text-white/90 text-base leading-relaxed">
            Plataforma de información para la gestión y el seguimiento de la Gerencia Expansión RM.
          </p>
          <div className="grid grid-cols-2 gap-3 pt-4">
            {PILLARS.map((p) => (
              <div key={p.title} className="flex items-center gap-2.5">
                <div className="w-1.5 h-8 bg-white/60 rounded-full" />
                <div>
                  <div className="font-display text-sm uppercase tracking-wider2">{p.title}</div>
                  <div className="text-[11px] text-white/70">{p.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-white/70 uppercase tracking-wider2">Operado por Voicenter S.A.</div>

        <div className="absolute -right-32 -bottom-32 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -right-20 top-20 w-48 h-48 rounded-full bg-white/5 blur-2xl" />
      </div>

      {/* Formulario */}
      <div className="flex items-center justify-center px-6 py-12 bg-brand-bg-soft">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex flex-col items-center gap-3 mb-8">
            <img src="/logo-voicenter-color.png" alt="Voicenter" className="h-12 w-auto" />
            <div className="font-display text-sm uppercase tracking-wider2 text-brand-slate">Gerencia Expansión RM</div>
          </div>

          <div className="mb-8">
            <h2 className="font-display text-3xl text-brand-ink uppercase">Iniciar sesión</h2>
            <p className="text-sm text-brand-slate mt-2">Acceso protegido. Solicite credenciales al administrador.</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="label">Correo electrónico</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="usuario@voicenter.com.py"
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="password" className="label">Contraseña</label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                autoComplete="current-password"
              />
            </div>
            {error && (
              <div className="bg-brand-primary-light border border-brand-primary/30 text-brand-primary-dark text-sm rounded-md px-3 py-2.5">
                {error}
              </div>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full text-base py-3">
              {loading ? "Verificando…" : "Ingresar a la plataforma"}
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
