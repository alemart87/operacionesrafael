"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import { OperativaInfo, operativaRoute } from "@/lib/operativas";

export default function InicioPage() {
  return (
    <AppShell>
      <Hub />
    </AppShell>
  );
}

function Hub() {
  const { user, isSuperadmin } = useSession();
  const [operativas, setOperativas] = useState<OperativaInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<OperativaInfo[]>("/api/v1/operativas")
      .then(setOperativas)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <div className="mb-10">
        <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Hub de operativas</div>
        <h1 className="font-display text-4xl sm:text-5xl text-brand-ink uppercase leading-tight">
          Hola, <span className="text-brand-primary">{user.full_name.split(" ")[0]}</span>
        </h1>
        <p className="text-base text-brand-slate mt-2 max-w-2xl">
          Seleccioná la operativa para acceder a la información disponible.
        </p>
      </div>

      {error && <div className="card p-6 text-sm text-brand-primary-dark">{error}</div>}

      {operativas && operativas.length === 0 && (
        <div className="card p-12 text-center text-brand-slate">
          No tenés operativas habilitadas. Solicitá acceso al administrador.
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        {operativas?.map((op) => {
          const route = operativaRoute(op.slug);
          const enabled = op.available && !!route;
          const activas = op.utilidades.filter((u) => u.habilitada);
          const content = (
            <>
              <div className="absolute top-0 left-0 right-0 h-1.5" style={{ background: op.color }} />
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-2xl text-brand-ink uppercase leading-tight">{op.name}</h2>
                {!enabled && <span className="badge-neutral flex-shrink-0">Próximamente</span>}
              </div>
              <p className="text-sm text-brand-slate leading-relaxed flex-1">{op.description}</p>
              <div className="flex flex-wrap gap-1.5">
                {activas
                  .filter((u) => u.key !== "ver")
                  .map((u) => (
                    <span key={u.key} className="badge-neutral">{u.name}</span>
                  ))}
              </div>
              {!isSuperadmin && (
                <div className="text-[11px] text-brand-mist">
                  {activas.length} de {op.utilidades.length} utilidades habilitadas para tu perfil
                </div>
              )}
            </>
          );
          const cls = "card relative overflow-hidden p-7 flex flex-col gap-4 transition-all duration-200";
          return enabled ? (
            <Link key={op.slug} href={route!.href} className={`${cls} hover:shadow-elevated hover:-translate-y-0.5`}>
              {content}
            </Link>
          ) : (
            <div key={op.slug} className={`${cls} opacity-90`}>
              {content}
            </div>
          );
        })}
      </div>
    </>
  );
}
