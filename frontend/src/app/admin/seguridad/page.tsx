"use client";

import { Clock, KeyRound, Lock, MonitorSmartphone, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { apiFetch } from "@/lib/api";
import { Aviso, type ConfigSeguridad, type EstadoUsuario, type RespuestaConfig, fechaCorta } from "@/components/seguridad/admin/comunes";
import { TabSesiones } from "@/components/seguridad/admin/TabSesiones";
import { TabUsuarios } from "@/components/seguridad/admin/TabUsuarios";
import { TabHorarios } from "@/components/seguridad/admin/TabHorarios";
import { TabPoliticas } from "@/components/seguridad/admin/TabPoliticas";

const TABS = [
  { k: "sesiones", label: "Sesiones activas", icono: MonitorSmartphone },
  { k: "usuarios", label: "Usuarios", icono: Users },
  { k: "horarios", label: "Horarios", icono: Clock },
  { k: "politicas", label: "Políticas", icono: SlidersHorizontal },
] as const;
type Tab = (typeof TABS)[number]["k"];

const MODO_TXT: Record<string, string> = { desactivado: "Desactivado", registrar: "Solo registrar", bloquear: "Bloqueando" };

function Kpi({ icono, titulo, valor, detalle, tono }: { icono: React.ReactNode; titulo: string; valor: React.ReactNode; detalle?: React.ReactNode; tono: string }) {
  return (
    <div className="card p-4 flex items-start gap-3 min-w-0">
      <span className={`hidden sm:grid place-items-center w-10 h-10 rounded-lg shrink-0 ${tono}`}>{icono}</span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-semibold">{titulo}</div>
        <div className="font-display text-2xl text-brand-ink leading-tight">{valor}</div>
        {detalle && <div className="text-[11px] text-brand-slate truncate">{detalle}</div>}
      </div>
    </div>
  );
}

export default function SeguridadPage() {
  const [tab, setTab] = useState<Tab>("sesiones");
  const [meta, setMeta] = useState<RespuestaConfig | null>(null);
  const [draft, setDraft] = useState<ConfigSeguridad | null>(null);
  const [usuarios, setUsuarios] = useState<EstadoUsuario[]>([]);
  const [nSesiones, setNSesiones] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [confirmarBloqueo, setConfirmarBloqueo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const cargarConfig = useCallback(() => {
    apiFetch<RespuestaConfig>("/api/v1/seguridad/config")
      .then((d) => { setMeta(d); setDraft(structuredClone(d.config)); })
      .catch((e) => setError(e.message));
  }, []);

  const cargarResumen = useCallback(() => {
    apiFetch<EstadoUsuario[]>("/api/v1/seguridad/usuarios").then(setUsuarios).catch(() => {});
    apiFetch<{ activas: unknown[] }>("/api/v1/seguridad/sesiones").then((d) => setNSesiones(d.activas.length)).catch(() => {});
  }, []);

  useEffect(() => {
    const h = window.location.hash.slice(1) as Tab;
    if (TABS.some((t) => t.k === h)) setTab(h);
    cargarConfig();
    cargarResumen();
  }, [cargarConfig, cargarResumen]);

  const cambiarTab = (k: Tab) => {
    setTab(k);
    history.replaceState(null, "", `#${k}`);
  };

  const set = useCallback((fn: (c: ConfigSeguridad) => void) => {
    setOk(null);
    setDraft((c) => {
      if (!c) return c;
      const n = structuredClone(c);
      fn(n);
      return n;
    });
  }, []);

  const sucio = useMemo(() => !!meta && !!draft && JSON.stringify(meta.config) !== JSON.stringify(draft), [meta, draft]);

  useEffect(() => {
    if (!sucio) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sucio]);

  const guardar = async () => {
    if (!draft) return;
    setGuardando(true);
    setError(null);
    try {
      const d = await apiFetch<RespuestaConfig>("/api/v1/seguridad/config", { method: "PUT", body: JSON.stringify({ config: draft }) });
      setMeta(d);
      setDraft(structuredClone(d.config));
      setOk("Configuración de seguridad guardada. Rige desde ahora para todos, incluidas las sesiones abiertas.");
      cargarResumen();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
      setConfirmarBloqueo(false);
    }
  };

  const pedirGuardar = () => {
    if (draft?.horarios.modo === "bloquear" && meta?.config.horarios.modo !== "bloquear") setConfirmarBloqueo(true);
    else guardar();
  };

  const activos = usuarios.filter((u) => u.activo);
  const con2fa = activos.filter((u) => u.dos_factores).length;
  const bloqueados = usuarios.filter((u) => u.bloqueado_hasta).length;
  const fueraAhora = activos.filter((u) => !u.horario_ahora && !u.excepcion_hasta).length;
  const modo = meta?.config.horarios.modo ?? "desactivado";

  return (
    <AppShell>
      <div className="mb-2 text-xs text-brand-slate">
        <Link href="/inicio" className="hover:text-brand-primary">Inicio</Link>
        <span className="mx-2">/</span>
        <span className="text-brand-ink font-semibold">Seguridad</span>
      </div>
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl text-brand-ink uppercase flex items-center gap-3">
            <ShieldCheck className="text-brand-primary" size={32} /> Seguridad de acceso
          </h1>
          <p className="text-sm text-brand-slate mt-1 max-w-3xl">
            Sesiones, horarios, bloqueos, contraseñas y segundo factor. Todo se hace cumplir en el servidor en cada pedido:
            lo que cambies acá rige al instante.
          </p>
        </div>
        {meta?.actualizado.en && (
          <div className="text-[11px] text-brand-mist md:text-right">Última modificación<br className="hidden md:block" /> {fechaCorta(meta.actualizado.en)}</div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi icono={<MonitorSmartphone size={20} />} tono="bg-emerald-50 text-emerald-600" titulo="Sesiones activas"
          valor={nSesiones ?? "—"} detalle={meta ? `Cierre tras ${meta.config.sesion.inactividad_minutos} min sin uso` : undefined} />
        <Kpi icono={<Lock size={20} />} tono={bloqueados ? "bg-brand-primary-light text-brand-primary" : "bg-brand-bg text-brand-slate"} titulo="Bloqueados"
          valor={bloqueados} detalle={meta ? `${meta.config.bloqueo.max_intentos} intentos en ${meta.config.bloqueo.ventana_minutos} min` : undefined} />
        <Kpi icono={<KeyRound size={20} />} tono="bg-brand-cyan/10 text-brand-cyan" titulo="Con 2FA"
          valor={<>{con2fa}<span className="text-base text-brand-mist"> / {activos.length}</span></>}
          detalle={activos.length ? `${Math.round((con2fa / activos.length) * 100)}% de los usuarios activos` : undefined} />
        <Kpi icono={<Clock size={20} />}
          tono={modo === "bloquear" ? "bg-brand-primary-light text-brand-primary" : modo === "registrar" ? "bg-brand-orange/10 text-brand-orange" : "bg-brand-bg text-brand-slate"}
          titulo="Horarios" valor={<span className="block text-lg sm:text-xl truncate">{MODO_TXT[modo]}</span>}
          detalle={modo === "desactivado" ? "Sin restricción horaria" : `${fueraAhora} usuario(s) fuera de horario ahora`} />
      </div>

      <div className="mb-5 border-b border-brand-border overflow-x-auto">
        <nav className="flex gap-1 min-w-max" role="tablist">
          {TABS.map(({ k, label, icono: Icono }) => (
            <button
              key={k} role="tab" aria-selected={tab === k} onClick={() => cambiarTab(k)}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                tab === k ? "text-brand-primary" : "text-brand-slate hover:text-brand-ink"
              }`}
            >
              <Icono size={16} /> {label}
              {(k === "horarios" || k === "politicas") && sucio && <span className="w-1.5 h-1.5 rounded-full bg-brand-primary" title="Cambios sin guardar" />}
              {tab === k && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-brand-primary rounded-full" />}
            </button>
          ))}
        </nav>
      </div>

      {error && <div className="mb-4"><Aviso tipo="error">{error}</Aviso></div>}
      {ok && <div className="mb-4"><Aviso tipo="ok">{ok}</Aviso></div>}

      <div className={sucio ? "pb-24" : ""}>
        {tab === "sesiones" && <TabSesiones onCambio={cargarResumen} />}
        {tab === "usuarios" && <TabUsuarios modoHorario={modo} onCambio={cargarResumen} />}
        {tab === "horarios" && (meta && draft ? <TabHorarios cfg={draft} set={set} meta={meta} /> : <div className="text-brand-slate">Cargando…</div>)}
        {tab === "politicas" && (meta && draft ? <TabPoliticas cfg={draft} set={set} superadmin2fa={meta.superadmin_2fa} /> : <div className="text-brand-slate">Cargando…</div>)}
      </div>

      {sucio && (
        <div className="fixed bottom-0 inset-x-0 z-40 print:hidden">
          <div className="max-w-6xl mx-auto px-4 pb-4">
            <div className="card shadow-elevated border-brand-ink/10 px-4 py-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 animate-pop">
              <div className="text-sm text-brand-graphite flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-brand-primary animate-pulse" />
                Tenés cambios sin guardar en la configuración de seguridad.
              </div>
              <div className="flex gap-2 justify-end">
                <button className="btn-secondary" disabled={guardando} onClick={() => meta && setDraft(structuredClone(meta.config))}>
                  <RotateCcw size={15} /> Descartar
                </button>
                <button className="btn-primary" disabled={guardando} onClick={pedirGuardar}>
                  <Save size={15} /> {guardando ? "Guardando…" : "Guardar cambios"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmarBloqueo}
        title="Activar el bloqueo por horario"
        message={
          <>
            Desde que guardes, quien esté fuera de su franja no podrá ingresar y sus sesiones abiertas se cerrarán en el
            próximo pedido. Hoy hay <strong>{fueraAhora}</strong> usuario(s) fuera de horario según lo guardado.
            Si alguien necesita trabajar fuera de su franja, dale una excepción desde la pestaña Usuarios.
          </>
        }
        confirmLabel="Guardar y bloquear"
        variant="danger"
        loading={guardando}
        onConfirm={guardar}
        onCancel={() => setConfirmarBloqueo(false)}
      />
    </AppShell>
  );
}
