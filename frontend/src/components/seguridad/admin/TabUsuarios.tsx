"use client";

import { CalendarClock, KeyRound, Lock, LogOut, Search, ShieldCheck, ShieldOff, Unlock, UserCog, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ROLE_LABELS, apiFetch } from "@/lib/api";
import { Aviso, BotonIcono, type EstadoUsuario, Seccion, fechaCorta, fechaDia, hace } from "./comunes";

type Accion = { tipo: "desbloquear" | "reset-2fa" | "forzar-cambio" | "cerrar-sesiones" | "quitar-excepcion"; u: EstadoUsuario };

const TEXTOS: Record<Accion["tipo"], { titulo: string; boton: string; peligro: boolean; msg: (u: EstadoUsuario) => React.ReactNode }> = {
  desbloquear: {
    titulo: "Desbloquear usuario", boton: "Desbloquear", peligro: false,
    msg: (u) => <><strong>{u.nombre}</strong> vuelve a poder ingresar y su contador de intentos fallidos queda en cero.</>,
  },
  "reset-2fa": {
    titulo: "Reiniciar segundo factor", boton: "Reiniciar 2FA", peligro: true,
    msg: (u) => <>Se quita el segundo factor de <strong>{u.nombre}</strong> (p. ej. perdió el teléfono) y se cierran sus sesiones. Podrá ingresar solo con la contraseña y volver a activarlo desde Mi perfil.</>,
  },
  "forzar-cambio": {
    titulo: "Forzar cambio de contraseña", boton: "Forzar cambio", peligro: false,
    msg: (u) => <>En su próximo pedido, <strong>{u.nombre}</strong> tendrá que elegir una contraseña nueva antes de seguir usando la plataforma.</>,
  },
  "cerrar-sesiones": {
    titulo: "Cerrar sesiones", boton: "Cerrar sesiones", peligro: true,
    msg: (u) => <>Se cierran las {u.sesiones_activas} sesión(es) abiertas de <strong>{u.nombre}</strong> en todos sus dispositivos.</>,
  },
  "quitar-excepcion": {
    titulo: "Quitar excepción de horario", boton: "Quitar excepción", peligro: true,
    msg: (u) => <><strong>{u.nombre}</strong> vuelve a regirse por el horario de su perfil desde ahora.</>,
  },
};

/** "YYYY-MM-DDTHH:mm" en hora local, para <input type="datetime-local">. */
function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Chip({ tono, icono, children, title }: { tono: "rojo" | "naranja" | "verde" | "gris" | "cyan"; icono?: React.ReactNode; children: React.ReactNode; title?: string }) {
  const cls = {
    rojo: "bg-brand-primary-light text-brand-primary-dark border-brand-primary/20",
    naranja: "bg-brand-orange/10 text-[#B86E00] border-brand-orange/20",
    verde: "bg-emerald-50 text-emerald-700 border-emerald-200",
    gris: "bg-brand-bg text-brand-slate border-brand-border",
    cyan: "bg-brand-cyan/10 text-[#00838C] border-brand-cyan/20",
  }[tono];
  return <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold max-w-full sm:whitespace-nowrap ${cls}`}>{icono}{children}</span>;
}

export function TabUsuarios({ modoHorario, onCambio }: { modoHorario: string; onCambio: () => void }) {
  const [lista, setLista] = useState<EstadoUsuario[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "alertas" | "bloqueados" | "sin2fa">("todos");
  const [accion, setAccion] = useState<Accion | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [excepcion, setExcepcion] = useState<{ u: EstadoUsuario; hasta: string; nota: string } | null>(null);

  const cargar = useCallback(() => {
    apiFetch<EstadoUsuario[]>("/api/v1/seguridad/usuarios").then(setLista).catch((e) => setError(e.message));
  }, []);
  useEffect(cargar, [cargar]);

  const alerta = (u: EstadoUsuario) => !!u.bloqueado_hasta || u.intentos_fallidos > 0 || u.contrasena_vencida || u.cambio_pendiente;
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (lista ?? []).filter((u) =>
      (!t || u.nombre.toLowerCase().includes(t) || u.email.toLowerCase().includes(t)) &&
      (filtro === "todos" || (filtro === "alertas" && alerta(u)) || (filtro === "bloqueados" && !!u.bloqueado_hasta) || (filtro === "sin2fa" && !u.dos_factores && u.activo)),
    );
  }, [lista, q, filtro]);

  const cuenta = useMemo(() => ({
    alertas: (lista ?? []).filter(alerta).length,
    bloqueados: (lista ?? []).filter((u) => u.bloqueado_hasta).length,
    sin2fa: (lista ?? []).filter((u) => !u.dos_factores && u.activo).length,
  }), [lista]);

  const ejecutar = async () => {
    if (!accion) return;
    setProcesando(true);
    setError(null);
    try {
      const { tipo, u } = accion;
      if (tipo === "quitar-excepcion") await apiFetch(`/api/v1/seguridad/usuarios/${u.id}/excepcion`, { method: "DELETE" });
      else await apiFetch(`/api/v1/seguridad/usuarios/${u.id}/${tipo}`, { method: "POST" });
      setOk(`${TEXTOS[tipo].titulo}: ${u.nombre}. Listo.`);
      cargar();
      onCambio();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProcesando(false);
      setAccion(null);
    }
  };

  const guardarExcepcion = async () => {
    if (!excepcion) return;
    setProcesando(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/seguridad/usuarios/${excepcion.u.id}/excepcion`, {
        method: "PUT",
        body: JSON.stringify({ hasta: new Date(excepcion.hasta).toISOString(), nota: excepcion.nota || null }),
      });
      setOk(`Excepción de horario para ${excepcion.u.nombre} hasta ${fechaCorta(new Date(excepcion.hasta).toISOString())}.`);
      setExcepcion(null);
      cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProcesando(false);
    }
  };

  const abrirExcepcion = (u: EstadoUsuario) => {
    const d = new Date();
    d.setHours(d.getHours() + 4, 0, 0, 0);
    setExcepcion({ u, hasta: localInput(u.excepcion_hasta ? new Date(u.excepcion_hasta) : d), nota: u.excepcion_nota ?? "" });
  };

  const FILTROS: [typeof filtro, string, number | null][] = [
    ["todos", "Todos", lista?.length ?? null],
    ["alertas", "Con alertas", cuenta.alertas],
    ["bloqueados", "Bloqueados", cuenta.bloqueados],
    ["sin2fa", "Sin 2FA", cuenta.sin2fa],
  ];

  return (
    <div className="space-y-5">
      {error && <Aviso tipo="error">{error}</Aviso>}
      {ok && <Aviso tipo="ok">{ok}</Aviso>}

      <Seccion
        icono={<UserCog size={18} />}
        titulo="Estado de seguridad por usuario"
        descripcion="Bloqueos, segundo factor, vencimiento de contraseña, excepciones de horario y sesiones abiertas. El superadmin no figura: está exento de bloqueo y horario."
      >
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between mb-4">
          <div className="flex flex-wrap gap-1.5">
            {FILTROS.map(([k, label, n]) => (
              <button
                key={k} onClick={() => setFiltro(k)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  filtro === k ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-slate border-brand-border hover:border-brand-ink"
                }`}
              >
                {label}{n != null && <span className={`ml-1.5 ${filtro === k ? "text-white/70" : "text-brand-mist"}`}>{n}</span>}
              </button>
            ))}
          </div>
          <div className="relative lg:w-72">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mist" />
            <input className="input pl-9" placeholder="Buscar por nombre o email" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {!lista ? (
          <div className="text-sm text-brand-slate">Cargando…</div>
        ) : visibles.length === 0 ? (
          <div className="text-sm text-brand-slate py-6 text-center">No hay usuarios con ese criterio.</div>
        ) : (
          <div className="divide-y divide-brand-border -mx-5">
            {visibles.map((u) => (
              <div key={u.id} className={`px-5 py-4 grid lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)_auto] gap-3 lg:items-center ${!u.activo ? "opacity-55" : ""}`}>
                <div className="min-w-0">
                  <div className="font-semibold text-brand-ink truncate">{u.nombre}</div>
                  <div className="text-[11px] text-brand-slate truncate">{u.email}</div>
                  <div className="text-[11px] text-brand-mist">
                    {ROLE_LABELS[u.role] ?? u.role} · último ingreso {hace(u.ultimo_ingreso)}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {!u.activo && <Chip tono="gris">Desactivado</Chip>}
                  {u.bloqueado_hasta ? (
                    <Chip tono="rojo" icono={<Lock size={11} />} title={`${u.intentos_fallidos} intentos fallidos`}>
                      {u.bloqueo_manual ? "Bloqueado · desbloqueo manual" : `Bloqueado hasta ${fechaCorta(u.bloqueado_hasta)}`}
                    </Chip>
                  ) : u.intentos_fallidos > 0 ? (
                    <Chip tono="naranja">{u.intentos_fallidos} intento(s) fallido(s)</Chip>
                  ) : null}
                  {u.dos_factores
                    ? <Chip tono="verde" icono={<ShieldCheck size={11} />}>2FA activo</Chip>
                    : <Chip tono="gris" icono={<ShieldOff size={11} />}>Sin 2FA</Chip>}
                  {u.cambio_pendiente ? (
                    <Chip tono="naranja" icono={<KeyRound size={11} />}>Cambio de contraseña pendiente</Chip>
                  ) : u.contrasena_vencida ? (
                    <Chip tono="rojo" icono={<KeyRound size={11} />}>Contraseña vencida</Chip>
                  ) : u.contrasena_vence ? (
                    <Chip tono="gris" icono={<KeyRound size={11} />} title={`Cambiada el ${fechaDia(u.contrasena_cambiada)}`}>Vence {fechaDia(u.contrasena_vence)}</Chip>
                  ) : null}
                  {u.excepcion_hasta ? (
                    <Chip tono="cyan" icono={<CalendarClock size={11} />} title={u.excepcion_nota ?? undefined}>
                      Excepción hasta {fechaCorta(u.excepcion_hasta)}{u.excepcion_nota ? ` · ${u.excepcion_nota}` : ""}
                    </Chip>
                  ) : modoHorario !== "desactivado" && u.activo ? (
                    u.horario_ahora ? <Chip tono="verde">En horario</Chip> : <Chip tono="naranja">Fuera de horario ahora</Chip>
                  ) : null}
                  {u.sesiones_activas > 0 && (
                    <Chip tono="cyan">{u.sesiones_activas} sesión(es) abierta(s)</Chip>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5 lg:justify-end">
                  {(u.bloqueado_hasta || u.intentos_fallidos > 0) && (
                    <BotonIcono titulo="Desbloquear" onClick={() => setAccion({ tipo: "desbloquear", u })}><Unlock size={13} /> Desbloquear</BotonIcono>
                  )}
                  {u.sesiones_activas > 0 && (
                    <BotonIcono titulo="Cerrar sus sesiones" peligro onClick={() => setAccion({ tipo: "cerrar-sesiones", u })}><LogOut size={13} /> Sesiones</BotonIcono>
                  )}
                  <BotonIcono titulo="Excepción de horario" onClick={() => abrirExcepcion(u)} disabled={!u.activo}><CalendarClock size={13} /> Excepción</BotonIcono>
                  {!u.cambio_pendiente && u.activo && (
                    <BotonIcono titulo="Forzar cambio de contraseña" onClick={() => setAccion({ tipo: "forzar-cambio", u })}><KeyRound size={13} /> Forzar cambio</BotonIcono>
                  )}
                  {u.dos_factores && (
                    <BotonIcono titulo="Reiniciar segundo factor" peligro onClick={() => setAccion({ tipo: "reset-2fa", u })}><ShieldOff size={13} /> 2FA</BotonIcono>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Seccion>

      <ConfirmDialog
        open={!!accion}
        title={accion ? TEXTOS[accion.tipo].titulo : ""}
        message={accion ? TEXTOS[accion.tipo].msg(accion.u) : null}
        confirmLabel={accion ? TEXTOS[accion.tipo].boton : ""}
        variant={accion && TEXTOS[accion.tipo].peligro ? "danger" : "default"}
        loading={procesando}
        onConfirm={ejecutar}
        onCancel={() => setAccion(null)}
      />

      {excepcion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-[2px] animate-fade" onClick={() => !procesando && setExcepcion(null)} />
          <div role="dialog" aria-modal="true" className="relative w-full max-w-md card shadow-elevated animate-pop overflow-hidden">
            <div className="h-1.5 bg-brand-cyan" />
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl text-brand-ink uppercase leading-tight">Excepción de horario</h2>
                  <p className="text-sm text-brand-slate mt-1">
                    <strong>{excepcion.u.nombre}</strong> podrá usar la plataforma fuera del horario de su perfil hasta la fecha elegida. Vence sola (máximo 31 días).
                  </p>
                </div>
                <button className="btn-ghost -mr-2 -mt-1" onClick={() => setExcepcion(null)} aria-label="Cerrar"><X size={16} /></button>
              </div>
              <div>
                <label className="label">Válida hasta</label>
                <input
                  type="datetime-local" className="input" value={excepcion.hasta}
                  min={localInput(new Date())} max={localInput(new Date(Date.now() + 31 * 86400000))}
                  onChange={(e) => setExcepcion({ ...excepcion, hasta: e.target.value })}
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[["+4 horas", 4], ["Hasta mañana", 24], ["1 semana", 168]].map(([l, h]) => (
                    <button key={l as string} type="button" className="px-2.5 py-1 rounded-full text-[11px] font-semibold border border-brand-border hover:border-brand-cyan hover:text-[#00838C]"
                      onClick={() => setExcepcion({ ...excepcion, hasta: localInput(new Date(Date.now() + (h as number) * 3600000)) })}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Motivo (queda en la auditoría)</label>
                <input className="input" maxLength={300} placeholder="Ej.: cierre de mes, guardia de fin de semana"
                  value={excepcion.nota} onChange={(e) => setExcepcion({ ...excepcion, nota: e.target.value })} />
              </div>
              {modoHorario === "desactivado" && (
                <Aviso tipo="info">Los horarios están desactivados: la excepción recién tiene efecto cuando actives el control de horario.</Aviso>
              )}
              <div className="flex justify-between gap-2 pt-1">
                {excepcion.u.excepcion_hasta ? (
                  <button className="btn-ghost text-brand-primary" disabled={procesando}
                    onClick={() => { const u = excepcion.u; setExcepcion(null); setAccion({ tipo: "quitar-excepcion", u }); }}>
                    Quitar excepción
                  </button>
                ) : <span />}
                <div className="flex gap-2">
                  <button className="btn-secondary" onClick={() => setExcepcion(null)} disabled={procesando}>Cancelar</button>
                  <button className="btn-primary" onClick={guardarExcepcion} disabled={procesando || !excepcion.hasta}>
                    {procesando ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
