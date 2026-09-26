"use client";

import { Clock, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, logout } from "@/lib/api";

export interface EstadoSeguridad {
  inactividad_minutos: number;
  aviso_minutos: number;
  acceso_hasta: string | null;
  sesion_expira: string | null;
  dos_factores_activo: boolean;
  recomendar_2fa: boolean;
  cambio_contrasena: boolean;
  motivo_cambio: string | null;
}

const AVISO_INACTIVIDAD_MS = 2 * 60 * 1000;

/**
 * Control de la sesión en el navegador (el servidor igual lo hace cumplir):
 * - cierra la sesión tras N minutos sin actividad, con aviso 2 minutos antes;
 * - avisa antes del fin del horario de acceso y cierra al llegar;
 * - recomienda activar el segundo factor.
 */
export function ControlSesion({ s }: { s: EstadoSeguridad }) {
  const ultima = useRef(Date.now());
  const [restante, setRestante] = useState<number | null>(null); // ms para el cierre por inactividad
  const [finHorario, setFinHorario] = useState<number | null>(null); // ms para el fin del horario
  const [ocultar2fa, setOcultar2fa] = useState(true);

  const salir = useCallback(async (motivo: string) => {
    await logout(motivo);
    window.location.href = "/login";
  }, []);

  useEffect(() => {
    try { setOcultar2fa(sessionStorage.getItem("rm_ocultar_2fa") === "1"); } catch { setOcultar2fa(false); }
    const actividad = () => { ultima.current = Date.now(); };
    const eventos = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];
    eventos.forEach((e) => window.addEventListener(e, actividad, { passive: true }));
    const limite = s.inactividad_minutos * 60 * 1000;
    const t = setInterval(() => {
      const falta = limite - (Date.now() - ultima.current);
      if (falta <= 0) {
        clearInterval(t);
        salir(`Tu sesión se cerró por inactividad (${s.inactividad_minutos} minutos sin uso).`);
        return;
      }
      setRestante(falta <= AVISO_INACTIVIDAD_MS ? falta : null);
      if (s.acceso_hasta) {
        const fin = Date.parse(s.acceso_hasta) - Date.now();
        if (fin <= 0) {
          clearInterval(t);
          salir("Terminó el horario de acceso de tu perfil.");
          return;
        }
        setFinHorario(fin <= s.aviso_minutos * 60 * 1000 ? fin : null);
      }
    }, 1000);
    return () => { clearInterval(t); eventos.forEach((e) => window.removeEventListener(e, actividad)); };
  }, [s.inactividad_minutos, s.acceso_hasta, s.aviso_minutos, salir]);

  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

  return (
    <>
      {s.recomendar_2fa && !ocultar2fa && (
        <div className="no-print bg-brand-ink text-white text-xs">
          <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-1.5 flex items-center gap-2">
            <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
            <span className="flex-1">Recomendado: activá la verificación en dos pasos para proteger tu cuenta.</span>
            <Link href="/perfil#segundo-factor" className="font-semibold underline underline-offset-2 whitespace-nowrap">Activar</Link>
            <button aria-label="Ocultar" onClick={() => { setOcultar2fa(true); try { sessionStorage.setItem("rm_ocultar_2fa", "1"); } catch {} }} className="opacity-70 hover:opacity-100"><X size={14} /></button>
          </div>
        </div>
      )}
      {finHorario !== null && (
        <div className="no-print bg-brand-orange text-white text-sm">
          <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-2">
            <Clock size={16} /> Tu horario de acceso termina en <b className="tabular-nums">{mmss(finHorario)}</b>. Guardá lo que estés haciendo.
          </div>
        </div>
      )}
      {restante !== null && (
        <div className="fixed inset-0 z-[60] grid place-items-center p-4 no-print">
          <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-[2px]" />
          <div role="alertdialog" aria-modal="true" className="relative card w-full max-w-md shadow-elevated animate-pop overflow-hidden">
            <div className="h-1.5 bg-brand-orange" />
            <div className="p-6 text-center">
              <Clock size={32} className="mx-auto text-brand-orange" />
              <h2 className="font-display text-2xl uppercase text-brand-ink mt-2">¿Seguís ahí?</h2>
              <p className="text-sm text-brand-slate mt-1">Por seguridad, la sesión se cierra por inactividad en</p>
              <div className="font-display text-5xl text-brand-ink tabular-nums my-3">{mmss(restante)}</div>
              <div className="flex justify-center gap-2">
                <button className="btn-secondary" onClick={() => salir("Cerraste la sesión.")}>Salir</button>
                <button className="btn-primary" onClick={() => { ultima.current = Date.now(); setRestante(null); apiFetch("/api/v1/auth/me").catch(() => undefined); }}>Seguir conectado</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
