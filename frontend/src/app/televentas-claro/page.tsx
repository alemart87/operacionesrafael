"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { ROLE_LABELS, apiFetch } from "@/lib/api";
import type { OperativaInfo } from "@/lib/operativas";

/** Utilidades que ya tienen pantalla propia. */
const UTILIDAD_HREF: Record<string, string> = {
  facturacion: "/televentas-claro/facturacion",
};

export default function TeleventasClaroPage() {
  return (
    <AppShell>
      <Inicio />
    </AppShell>
  );
}

function Inicio() {
  const { user, isSuperadmin } = useSession();
  const [op, setOp] = useState<OperativaInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<OperativaInfo>("/api/v1/televentas-claro")
      .then(setOp)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="card p-6 text-sm text-brand-primary-dark">{error}</div>;
  if (!op) return <div className="text-brand-slate">Cargando…</div>;

  const utilidades = op.utilidades.filter((u) => u.key !== "ver");

  return (
    <>
      <div className="mb-8">
        <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Operativa</div>
        <h1 className="font-display text-4xl sm:text-5xl text-brand-ink uppercase leading-tight">
          Televentas <span className="text-brand-primary">CLARO</span>
        </h1>
        <p className="text-base text-brand-slate mt-2 max-w-2xl">{op.description}</p>
      </div>

      <section className="card p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-5">
          <h2 className="font-display text-xl text-brand-ink uppercase">Utilidades de la operativa</h2>
          <span className="text-xs text-brand-slate">
            Perfil: <strong>{ROLE_LABELS[user.role] ?? user.role}</strong>
            {isSuperadmin && " · acceso total"}
          </span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {utilidades.map((u) => {
            const href = u.habilitada ? UTILIDAD_HREF[u.key] : undefined;
            const Box: any = href ? Link : "div";
            return (
            <Box
              key={u.key}
              {...(href ? { href } : {})}
              className={`rounded-lg border p-4 ${
                u.habilitada ? "border-brand-border bg-white" : "border-dashed border-brand-border bg-brand-bg-soft"
              } ${href ? "hover:border-brand-primary hover:shadow-elevated transition-all" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm font-semibold ${u.habilitada ? "text-brand-ink" : "text-brand-mist"}`}>
                  {u.name}
                </span>
                {u.solo_superadmin ? (
                  <span className="badge-primary">Solo superadmin</span>
                ) : u.habilitada ? (
                  <span className="badge-success">Habilitada</span>
                ) : (
                  <span className="badge-neutral">Sin permiso</span>
                )}
              </div>
              <p className={`text-xs mt-1.5 ${u.habilitada ? "text-brand-slate" : "text-brand-mist"}`}>{u.description}</p>
              {href && <div className="text-xs font-semibold text-brand-primary mt-2">Abrir →</div>}
            </Box>
            );
          })}
        </div>
        <p className="text-xs text-brand-mist mt-5">
          Las funcionalidades de cada utilidad se incorporan a medida que se construye la operativa. Los permisos de
          cada perfil los define el superadmin.
        </p>
      </section>
    </>
  );
}
