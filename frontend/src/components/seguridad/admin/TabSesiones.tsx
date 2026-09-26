"use client";

import { History, LogOut, MonitorSmartphone, Power, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ROLE_LABELS, apiFetch } from "@/lib/api";
import { Aviso, BotonIcono, MOTIVOS_FIN, Seccion, type Sesion, dispositivo, fechaCorta, hace } from "./comunes";

interface Respuesta { activas: Sesion[]; recientes: Sesion[]; inactividad_minutos: number }

type Accion =
  | { tipo: "una"; s: Sesion }
  | { tipo: "usuario"; s: Sesion }
  | { tipo: "todas" };

export function TabSesiones({ onCambio }: { onCambio: () => void }) {
  const [data, setData] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [verRecientes, setVerRecientes] = useState(false);

  const cargar = useCallback(() => {
    apiFetch<Respuesta>("/api/v1/seguridad/sesiones").then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 30_000); // el panel se refresca solo
    return () => clearInterval(t);
  }, [cargar]);

  const porUsuario = useMemo(() => {
    const m = new Map<string, number>();
    data?.activas.forEach((s) => m.set(s.user_id, (m.get(s.user_id) ?? 0) + 1));
    return m;
  }, [data]);

  const ajenas = (data?.activas ?? []).filter((s) => !s.es_la_mia).length;

  const confirmar = async () => {
    if (!accion) return;
    setProcesando(true);
    setError(null);
    try {
      const url = accion.tipo === "una" ? `/api/v1/seguridad/sesiones/${accion.s.id}/cerrar`
        : accion.tipo === "usuario" ? `/api/v1/seguridad/usuarios/${accion.s.user_id}/cerrar-sesiones`
        : "/api/v1/seguridad/sesiones/cerrar-todas";
      const r = await apiFetch<{ cerradas: number }>(url, { method: "POST" });
      setOk(r.cerradas === 1 ? "Se cerró 1 sesión." : `Se cerraron ${r.cerradas} sesiones.`);
      cargar();
      onCambio();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProcesando(false);
      setAccion(null);
    }
  };

  const titulo = accion?.tipo === "una" ? "Cerrar esta sesión"
    : accion?.tipo === "usuario" ? "Cerrar todas sus sesiones" : "Cerrar todas las sesiones";
  const mensaje = accion?.tipo === "una"
    ? <>La sesión de <strong>{accion.s.nombre}</strong> en {dispositivo(accion.s.user_agent)} se corta al instante. Para volver a entrar tendrá que iniciar sesión de nuevo.</>
    : accion?.tipo === "usuario"
      ? <>Se cierran las {porUsuario.get(accion.s.user_id) ?? 1} sesión(es) de <strong>{accion.s.nombre}</strong> en todos sus dispositivos.</>
      : <>Se cierran <strong>{ajenas}</strong> sesión(es) de todos los usuarios. La tuya queda abierta. Usalo ante un incidente o después de un cambio de reglas importante.</>;

  return (
    <div className="space-y-5">
      {error && <Aviso tipo="error">{error}</Aviso>}
      {ok && <Aviso tipo="ok">{ok}</Aviso>}

      <Seccion
        icono={<MonitorSmartphone size={18} />}
        titulo="Sesiones activas"
        descripcion={data ? <>Se cierran solas tras <strong>{data.inactividad_minutos} minutos</strong> sin actividad. Esta lista se actualiza cada 30 segundos.</> : "Cargando…"}
        accion={
          <div className="flex gap-2 shrink-0">
            <button className="btn-ghost" onClick={cargar} title="Actualizar"><RefreshCw size={15} /></button>
            <button className="btn-danger" disabled={!ajenas} onClick={() => setAccion({ tipo: "todas" })}>
              <Power size={15} /> <span className="hidden sm:inline">Cerrar todas menos la mía</span><span className="sm:hidden">Cerrar todas</span>
            </button>
          </div>
        }
      >
        {!data ? (
          <div className="text-sm text-brand-slate">Cargando…</div>
        ) : data.activas.length === 0 ? (
          <div className="text-sm text-brand-slate">No hay sesiones activas.</div>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider2 text-brand-slate text-left border-b border-brand-border">
                  <th className="px-5 py-2">Usuario</th>
                  <th className="px-3 py-2">Dispositivo</th>
                  <th className="px-3 py-2">Inicio</th>
                  <th className="px-3 py-2">Última actividad</th>
                  <th className="px-3 py-2">Vence</th>
                  <th className="px-5 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {data.activas.map((s) => (
                  <tr key={s.id} className={`border-b border-brand-border last:border-0 ${s.es_la_mia ? "bg-brand-cyan/5" : "hover:bg-brand-bg-soft"}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="relative flex w-2 h-2">
                          <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                          <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
                        </span>
                        <span className="font-semibold text-brand-ink">{s.nombre}</span>
                        {s.es_la_mia && <span className="badge-cyan">Tu sesión</span>}
                      </div>
                      <div className="text-[11px] text-brand-slate pl-4">{s.email} · {ROLE_LABELS[s.role] ?? s.role}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-brand-graphite flex items-center gap-1.5">
                        {dispositivo(s.user_agent)}
                        {s.segundo_factor && <span title="Ingresó con segundo factor"><ShieldCheck size={14} className="text-emerald-600" /></span>}
                      </div>
                      <div className="text-[11px] text-brand-mist font-mono">{s.ip ?? "—"}</div>
                    </td>
                    <td className="px-3 py-3 text-brand-graphite whitespace-nowrap">{fechaCorta(s.inicio)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={s.inactiva_minutos >= data.inactividad_minutos * 0.75 ? "text-brand-orange font-semibold" : "text-brand-graphite"}>
                        {hace(s.ultima_actividad)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-brand-graphite whitespace-nowrap">{fechaCorta(s.vence)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        {!s.es_la_mia && (
                          <BotonIcono titulo="Cerrar esta sesión" peligro onClick={() => setAccion({ tipo: "una", s })}>
                            <LogOut size={13} /> Cerrar
                          </BotonIcono>
                        )}
                        {s.user_id !== "superadmin" && (porUsuario.get(s.user_id) ?? 0) > 1 && (
                          <BotonIcono titulo="Cerrar todas las sesiones del usuario" onClick={() => setAccion({ tipo: "usuario", s })}>
                            <Users size={13} /> Todas ({porUsuario.get(s.user_id)})
                          </BotonIcono>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      <Seccion
        icono={<History size={18} />}
        titulo="Cerradas recientemente"
        descripcion="Las últimas 50 sesiones terminadas y por qué se cerraron."
        accion={<button className="btn-ghost shrink-0" onClick={() => setVerRecientes((v) => !v)}>{verRecientes ? "Ocultar" : "Ver"}</button>}
      >
        {!verRecientes ? (
          <div className="flex flex-wrap gap-2">
            {Object.entries(
              (data?.recientes ?? []).reduce<Record<string, number>>((acc, s) => {
                const k = s.motivo_fin ?? "otro";
                acc[k] = (acc[k] ?? 0) + 1;
                return acc;
              }, {}),
            ).map(([k, n]) => (
              <span key={k} className={k === "cerrada" || k === "horario" ? "badge-orange" : "badge-neutral"}>{MOTIVOS_FIN[k] ?? k}: {n}</span>
            ))}
            {!data?.recientes.length && <span className="text-sm text-brand-slate">Todavía no hay sesiones cerradas.</span>}
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider2 text-brand-slate text-left border-b border-brand-border">
                  <th className="px-5 py-2">Usuario</th>
                  <th className="px-3 py-2">Dispositivo</th>
                  <th className="px-3 py-2">Inicio</th>
                  <th className="px-3 py-2">Fin</th>
                  <th className="px-5 py-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {data?.recientes.map((s) => (
                  <tr key={s.id} className="border-b border-brand-border last:border-0">
                    <td className="px-5 py-2.5"><span className="font-semibold text-brand-ink">{s.nombre}</span> <span className="text-[11px] text-brand-slate">{s.email}</span></td>
                    <td className="px-3 py-2.5 text-brand-graphite">{dispositivo(s.user_agent)} <span className="text-[11px] text-brand-mist font-mono">{s.ip}</span></td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{fechaCorta(s.inicio)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{fechaCorta(s.fin)}</td>
                    <td className="px-5 py-2.5">
                      <span className={s.motivo_fin === "cerrada" || s.motivo_fin === "horario" ? "badge-orange" : "badge-neutral"}>
                        {MOTIVOS_FIN[s.motivo_fin ?? ""] ?? s.motivo_fin}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      <ConfirmDialog
        open={!!accion}
        title={titulo}
        message={mensaje}
        confirmLabel="Cerrar sesiones"
        variant="danger"
        loading={procesando}
        onConfirm={confirmar}
        onCancel={() => setAccion(null)}
      />
    </div>
  );
}
