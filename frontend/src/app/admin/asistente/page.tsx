"use client";

import { BookOpen, Bot, LayoutDashboard, ListChecks, MessagesSquare, Wrench } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { VoiIsotipo } from "@/components/voi/VoiIsotipo";
import { TabAcciones, TabAgente } from "@/components/voi/admin/TabAgente";
import { TabConocimiento } from "@/components/voi/admin/TabConocimiento";
import { TabConversaciones } from "@/components/voi/admin/TabConversaciones";
import { TabResumen } from "@/components/voi/admin/TabResumen";
import { EstadoAdminVoi } from "@/components/voi/admin/tipos";
import { apiFetch } from "@/lib/api";
import { VOI_API } from "@/lib/voi";

const TABS = [
  { k: "resumen", label: "Resumen y consumo", icono: LayoutDashboard },
  { k: "conversaciones", label: "Conversaciones", icono: MessagesSquare },
  { k: "acciones", label: "Acciones", icono: ListChecks },
  { k: "conocimiento", label: "Conocimiento", icono: BookOpen },
  { k: "agente", label: "Herramientas y habilidades", icono: Wrench },
] as const;
type Tab = (typeof TABS)[number]["k"];

/** Consola de Voi (solo superadmin): conexión, publicación del agente, topes, consumo, conversaciones, acciones y la
 * base de conocimiento. */
export default function AsistenteAdminPage() {
  return (
    <AppShell>
      <Consola />
    </AppShell>
  );
}

function Consola() {
  const [tab, setTab] = useState<Tab>("resumen");
  const [estado, setEstado] = useState<EstadoAdminVoi | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    apiFetch<EstadoAdminVoi>(`${VOI_API}/admin/estado`).then((e) => { setEstado(e); setError(null); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const desdeHash = () => {
      const h = window.location.hash.slice(1) as Tab;
      if (TABS.some((t) => t.k === h)) setTab(h);
    };
    desdeHash();
    cargar();
    window.addEventListener("hashchange", desdeHash);     // enlaces a /admin/asistente#conocimiento desde la misma página
    return () => window.removeEventListener("hashchange", desdeHash);
  }, [cargar]);

  const cambiar = (k: Tab) => {
    setTab(k);
    history.replaceState(null, "", `#${k}`);
  };

  return (
    <>
      <div className="mb-2 text-xs text-brand-slate">
        <Link href="/inicio" className="hover:text-brand-primary">Inicio</Link>
        <span className="mx-2">/</span>
        <span className="text-brand-ink font-semibold">Asistente IA</span>
      </div>
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="hidden sm:grid place-items-center w-14 h-14 rounded-2xl bg-white border border-brand-border shadow-soft">
            <VoiIsotipo size={34} estado={estado && estado.consumidores_activos > 0 ? "pensando" : "quieto"} />
          </div>
          <div>
            <h1 className="font-display text-3xl sm:text-4xl text-brand-ink uppercase flex items-center gap-3">
              Voi <span className="text-brand-slate text-xl sm:text-2xl normal-case font-semibold tracking-normal">· Powered by Claude</span>
            </h1>
            <p className="text-sm text-brand-slate mt-1 max-w-3xl">
              El agente de la plataforma, sobre Claude Managed Agents. Consulta y explica los datos que cada usuario ya ve, prepara
              borradores y propone acciones que el usuario confirma. Desde acá controlás la conexión, los topes y el uso.
            </p>
          </div>
        </div>
        {estado && (
          <div className="flex items-center gap-2 text-xs">
            <span className={estado.conectado ? (estado.simulador ? "badge-orange" : "badge-success") : "badge-primary"}>
              {estado.conectado ? (estado.simulador ? "Simulador" : "Conectado") : "Sin clave"}
            </span>
            <span className={estado.config.habilitado ? "badge-success" : "badge-neutral"}>{estado.config.habilitado ? "Encendido" : "Pausado"}</span>
          </div>
        )}
      </div>

      <div className="mb-5 border-b border-brand-border overflow-x-auto">
        <nav className="flex gap-1 min-w-max" role="tablist">
          {TABS.map(({ k, label, icono: Icono }) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => cambiar(k)}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-colors ${tab === k ? "text-brand-primary" : "text-brand-slate hover:text-brand-ink"}`}>
              <Icono size={16} /> {label}
              {tab === k && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-brand-primary rounded-full" />}
            </button>
          ))}
        </nav>
      </div>

      {error && <div className="mb-4 rounded-lg border border-brand-primary/30 bg-brand-primary-light px-4 py-3 text-sm text-brand-primary-dark">{error}</div>}
      {!estado && !error && <div className="text-brand-slate flex items-center gap-2"><Bot size={16} /> Cargando…</div>}
      {estado && tab === "resumen" && <TabResumen estado={estado} onCambio={cargar} />}
      {tab === "conversaciones" && <TabConversaciones />}
      {tab === "acciones" && <TabAcciones />}
      {tab === "conocimiento" && <TabConocimiento />}
      {estado && tab === "agente" && <TabAgente estado={estado} />}
    </>
  );
}
