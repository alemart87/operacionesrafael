"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PoliticaContrasena } from "@/components/seguridad/PoliticaContrasena";
import { apiFetch, getToken, logout } from "@/lib/api";

/** Cambio obligatorio: primer ingreso con contraseña dada por el administrador, o contraseña vencida. */
export default function CambiarContrasenaPage() {
  const router = useRouter();
  const [motivo, setMotivo] = useState<string | null>(null);
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!getToken()) { router.replace("/login"); return; }
    apiFetch<{ role: string; seguridad?: { cambio_contrasena: boolean; motivo_cambio: string | null } }>("/api/v1/auth/me")
      .then((me) => {
        if (me.role === "superadmin" || !me.seguridad?.cambio_contrasena) router.replace("/inicio");
        else setMotivo(me.seguridad.motivo_cambio);
      })
      .catch(() => undefined);
  }, [router]);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (nueva !== repetir) { setError("Las contraseñas nuevas no coinciden."); return; }
    setOcupado(true);
    try {
      await apiFetch("/api/v1/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: actual, new_password: nueva }) });
      router.replace("/inicio");
    } catch (err: any) { setError(err.message); } finally { setOcupado(false); }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-brand-bg-soft px-4 py-10">
      <div className="w-full max-w-md card overflow-hidden shadow-elevated">
        <div className="h-1.5 bg-brand-primary" />
        <div className="p-7">
          <img src="/logo-voicenter-color.png" alt="Voicenter" className="h-9 w-auto mb-5" />
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-full bg-brand-primary-light text-brand-primary grid place-items-center"><KeyRound size={20} /></span>
            <div>
              <h1 className="font-display text-2xl uppercase text-brand-ink leading-none">Elegí una contraseña nueva</h1>
              <p className="text-xs text-brand-slate mt-1">
                {motivo === "vencida" ? "Tu contraseña venció. Por seguridad hay que renovarla." : "Es tu primer ingreso: la contraseña que te dieron es temporal."}
              </p>
            </div>
          </div>
          <form onSubmit={guardar} className="space-y-4 mt-6">
            <div>
              <label className="label">Contraseña actual</label>
              <input type="password" className="input" required value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" />
            </div>
            <div>
              <label className="label">Nueva contraseña</label>
              <input type="password" className="input" required value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" />
            </div>
            <PoliticaContrasena valor={nueva} />
            <div>
              <label className="label">Repetir nueva contraseña</label>
              <input type="password" className="input" required value={repetir} onChange={(e) => setRepetir(e.target.value)} autoComplete="new-password" />
            </div>
            {error && <div className="rounded-md border border-brand-primary/30 bg-brand-primary-light px-3 py-2 text-sm text-brand-primary-dark">{error}</div>}
            <button type="submit" disabled={ocupado} className="btn-primary w-full py-3">{ocupado ? "Guardando…" : "Guardar y continuar"}</button>
            <button type="button" onClick={async () => { await logout(); router.replace("/login"); }} className="w-full text-xs text-brand-slate hover:text-brand-primary">Salir</button>
          </form>
        </div>
      </div>
    </div>
  );
}
