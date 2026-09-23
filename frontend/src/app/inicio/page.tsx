"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { apiFetch, getUser } from "@/lib/api";

interface ModuleInfo {
  slug: string;
  name: string;
  description: string;
  available: boolean;
  color: string;
}

/** Ruta de cada módulo en el frontend (slug → href). Sumar acá al crear uno. */
const MODULE_HREF: Record<string, string> = {
  tablero: "/tablero",
};

export default function InicioPage() {
  const [firstName, setFirstName] = useState("");
  const [modules, setModules] = useState<ModuleInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFirstName(getUser()?.full_name?.split(" ")[0] ?? "");
    apiFetch<ModuleInfo[]>("/api/v1/modules")
      .then(setModules)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <AppShell>
      <div className="mb-10">
        <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Gerencia Expansión RM</div>
        <h1 className="font-display text-4xl sm:text-5xl text-brand-ink uppercase leading-tight">
          Hola, <span className="text-brand-primary">{firstName}</span>
        </h1>
        <p className="text-base text-brand-slate mt-2 max-w-2xl">
          Seleccioná el área para acceder a la información disponible.
        </p>
      </div>

      {error && <div className="card p-6 text-sm text-brand-primary-dark">{error}</div>}

      {modules && modules.length === 0 && (
        <div className="card p-12 text-center text-brand-slate">
          No tenés módulos habilitados. Solicitá acceso al administrador.
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        {modules?.map((m) => {
          const href = MODULE_HREF[m.slug];
          const enabled = m.available && !!href;
          const content = (
            <>
              <div className="absolute top-0 left-0 right-0 h-1.5" style={{ background: m.color }} />
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-2xl text-brand-ink uppercase leading-tight">{m.name}</h2>
                {!enabled && <span className="badge-neutral flex-shrink-0">Próximamente</span>}
              </div>
              <p className="text-sm text-brand-slate leading-relaxed">{m.description}</p>
            </>
          );
          const cls = "card relative overflow-hidden p-7 flex flex-col gap-4 transition-all duration-200";
          return enabled ? (
            <Link key={m.slug} href={href} className={`${cls} hover:shadow-elevated hover:-translate-y-0.5`}>
              {content}
            </Link>
          ) : (
            <div key={m.slug} className={`${cls} opacity-90`}>
              {content}
            </div>
          );
        })}
      </div>

      <div className="mt-10 text-xs text-brand-slate flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-brand-cyan" />
        La plataforma se construye de forma incremental. Más módulos próximamente.
      </div>
    </AppShell>
  );
}
