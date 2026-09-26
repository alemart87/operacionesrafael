"use client";

import Link from "next/link";
import { KeyRound, Lock, ShieldCheck, Timer } from "lucide-react";
import { CampoNumero, Interruptor, type ConfigSeguridad, Seccion } from "./comunes";

export function TabPoliticas({ cfg, set, superadmin2fa }: {
  cfg: ConfigSeguridad; set: (fn: (c: ConfigSeguridad) => void) => void; superadmin2fa: boolean;
}) {
  const { sesion, bloqueo, contrasenas: p, dos_factores } = cfg;
  return (
    <div className="grid xl:grid-cols-2 gap-5">
      <Seccion icono={<Timer size={18} />} titulo="Sesiones" descripcion="Cuánto dura una sesión y cuándo se cierra sola. Se aplica también a las sesiones ya abiertas.">
        <div className="grid sm:grid-cols-2 gap-4">
          <CampoNumero
            label="Cierre por inactividad" sufijo="minutos" min={5} max={480} valor={sesion.inactividad_minutos}
            onChange={(v) => set((c) => { c.sesion.inactividad_minutos = v; })}
            ayuda="Sin actividad durante este tiempo, la sesión se cierra (aviso 2 min antes)."
          />
          <CampoNumero
            label="Duración máxima" sufijo="horas" min={1} max={168} valor={sesion.duracion_max_horas}
            onChange={(v) => set((c) => { c.sesion.duracion_max_horas = v; })}
            ayuda="Aunque haya actividad, pasado este tiempo hay que volver a ingresar."
          />
          <CampoNumero
            label="Renovación del token" sufijo="minutos" min={5} max={120} valor={sesion.access_minutos}
            onChange={(v) => set((c) => { c.sesion.access_minutos = v; })}
            ayuda="Técnico: cada cuánto se renueva la credencial en segundo plano."
          />
        </div>
      </Seccion>

      <Seccion icono={<Lock size={18} />} titulo="Bloqueo por intentos fallidos" descripcion="Persistente en la base: sobrevive a reinicios y lo ves en la pestaña Usuarios.">
        <div className="grid sm:grid-cols-2 gap-4">
          <CampoNumero
            label="Intentos permitidos" sufijo="intentos" min={3} max={20} valor={bloqueo.max_intentos}
            onChange={(v) => set((c) => { c.bloqueo.max_intentos = v; })}
            ayuda="Al superarlos, la cuenta se bloquea."
          />
          <CampoNumero
            label="Ventana de conteo" sufijo="minutos" min={1} max={1440} valor={bloqueo.ventana_minutos}
            onChange={(v) => set((c) => { c.bloqueo.ventana_minutos = v; })}
            ayuda="Los intentos fallidos más viejos que esto no cuentan."
          />
          <CampoNumero
            label="Duración del bloqueo" sufijo="minutos" min={0} max={10080} valor={bloqueo.bloqueo_minutos}
            onChange={(v) => set((c) => { c.bloqueo.bloqueo_minutos = v; })}
            ayuda={bloqueo.bloqueo_minutos === 0 ? <strong className="text-brand-primary-dark">0 = queda bloqueado hasta que lo desbloquees vos.</strong> : "0 = desbloqueo solo manual."}
          />
        </div>
      </Seccion>

      <Seccion icono={<KeyRound size={18} />} titulo="Política de contraseñas" descripcion="Se exige al crear usuarios, al restablecer y en cada cambio. El superadmin (.env) queda fuera.">
        <div className="grid sm:grid-cols-2 gap-4">
          <CampoNumero label="Largo mínimo" sufijo="caracteres" min={8} max={64} valor={p.min_largo}
            onChange={(v) => set((c) => { c.contrasenas.min_largo = v; })} ayuda="Recomendado: 10 o más." />
          <CampoNumero label="Vencimiento" sufijo="días" min={0} max={730} valor={p.vencimiento_dias}
            onChange={(v) => set((c) => { c.contrasenas.vencimiento_dias = v; })} ayuda="0 = no vence. Al vencer, se pide una nueva al ingresar." />
          <CampoNumero label="No repetir las últimas" sufijo="contraseñas" min={0} max={24} valor={p.historial}
            onChange={(v) => set((c) => { c.contrasenas.historial = v; })} ayuda="0 = solo impide repetir la actual." />
        </div>
        <div className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-1 border-t border-brand-border pt-4">
          <Interruptor label="Mayúsculas y minúsculas" valor={p.mayus_minus} onChange={(v) => set((c) => { c.contrasenas.mayus_minus = v; })} />
          <Interruptor label="Al menos un número" valor={p.numero} onChange={(v) => set((c) => { c.contrasenas.numero = v; })} />
          <Interruptor label="Al menos un símbolo" valor={p.simbolo} onChange={(v) => set((c) => { c.contrasenas.simbolo = v; })} />
          <Interruptor label="Cambio obligatorio en el primer ingreso" ayuda="También después de que restablezcas una contraseña."
            valor={p.cambio_primer_ingreso} onChange={(v) => set((c) => { c.contrasenas.cambio_primer_ingreso = v; })} />
        </div>
      </Seccion>

      <Seccion icono={<ShieldCheck size={18} />} titulo="Segundo factor (2FA)" descripcion="Código de 6 dígitos de una app autenticadora (Google Authenticator, Microsoft Authenticator, Authy…).">
        <div className="space-y-4">
          <div className="rounded-md bg-brand-bg-soft border border-brand-border p-4 text-sm text-brand-graphite leading-relaxed">
            Es <strong>opcional para todos</strong>: cada usuario lo activa desde <em>Mi perfil</em>. Al activarlo recibe 8 códigos de
            recuperación de un solo uso. Si alguien pierde el teléfono, lo reiniciás desde la pestaña Usuarios.
          </div>
          <Interruptor
            label="Recomendarlo a quien no lo tenga"
            ayuda="Muestra una barra discreta invitando a activarlo (se puede ocultar por sesión)."
            valor={dos_factores.recomendado} onChange={(v) => set((c) => { c.dos_factores.recomendado = v; })}
          />
          <div className={`flex items-center justify-between gap-3 rounded-md border px-4 py-3 ${superadmin2fa ? "border-emerald-200 bg-emerald-50" : "border-brand-orange/30 bg-brand-orange/5"}`}>
            <div className="text-sm">
              <div className="font-semibold text-brand-ink">Tu cuenta de superadmin</div>
              <div className="text-xs text-brand-slate">{superadmin2fa ? "Segundo factor activo." : "Sin segundo factor: es la cuenta más sensible, te recomendamos activarlo."}</div>
            </div>
            <Link href="/perfil#segundo-factor" className={superadmin2fa ? "btn-ghost text-xs" : "btn-primary text-xs px-3 py-2"}>
              {superadmin2fa ? "Gestionar" : "Activar"}
            </Link>
          </div>
        </div>
      </Seccion>
    </div>
  );
}
