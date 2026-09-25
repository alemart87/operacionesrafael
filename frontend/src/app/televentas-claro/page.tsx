"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { ROLE_LABELS, apiFetch } from "@/lib/api";
import { type OperativaInfo, type Submodulo, operativaRoute } from "@/lib/operativas";

const RUTA = operativaRoute("televentas_claro")!;

export default function TeleventasClaroPage() {
  return (
    <AppShell>
      <Inicio />
    </AppShell>
  );
}

function Inicio() {
  const { user, isSuperadmin, can } = useSession();
  const [op, setOp] = useState<OperativaInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<OperativaInfo>("/api/v1/televentas-claro")
      .then(setOp)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="card p-6 text-sm text-brand-primary-dark">{error}</div>;
  if (!op) return <div className="text-brand-slate">Cargando…</div>;

  // Una tarjeta por módulo real (submódulo con pantalla), no por permiso.
  const utilidades = Object.fromEntries(op.utilidades.map((u) => [u.key, u]));
  const modulos = RUTA.submodulos.filter((s) => utilidades[s.utilidad]);

  return (
    <>
      <div className="mb-8">
        <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Operativa</div>
        <h1 className="font-display text-4xl sm:text-5xl text-brand-ink uppercase leading-tight">
          Televentas <span className="text-brand-primary">CLARO</span>
        </h1>
        <p className="text-base text-brand-slate mt-2 max-w-2xl">{op.description}</p>
      </div>

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-5">
          <h2 className="font-display text-xl text-brand-ink uppercase">Módulos</h2>
          <span className="text-xs text-brand-slate">
            Perfil: <strong>{ROLE_LABELS[user.role] ?? user.role}</strong>
            {isSuperadmin && " · acceso total"}
          </span>
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          {modulos.map((m) => (
            <Tarjeta key={m.utilidad} m={m} u={utilidades[m.utilidad]} gestion={!!m.gestion && can(`${RUTA.slug}.${m.gestion}`)} />
          ))}
        </div>
        <p className="text-xs text-brand-mist mt-5">Los permisos de cada perfil los define el superadmin en Administración → Perfiles.</p>
      </section>
    </>
  );
}

function Tarjeta({ m, u, gestion }: { m: Submodulo; u: OperativaInfo["utilidades"][number]; gestion: boolean }) {
  const habilitada = u.habilitada;
  const Box: any = habilitada ? Link : "div";
  return (
    <Box
      {...(habilitada ? { href: m.href } : {})}
      className={`group card p-6 flex flex-col gap-4 border-t-[3px] ${
        habilitada ? "border-t-brand-primary hover:shadow-elevated hover:border-brand-primary transition-all" : "border-t-brand-mist border-dashed bg-brand-bg-soft"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className={`font-display text-3xl uppercase leading-none ${habilitada ? "text-brand-ink group-hover:text-brand-primary transition-colors" : "text-brand-mist"}`}>
          {m.label}
        </h3>
        {u.solo_superadmin ? (
          <span className="badge-primary whitespace-nowrap">Solo superadmin</span>
        ) : habilitada ? (
          <span className="badge-success whitespace-nowrap">{gestion ? "Ver y gestionar" : "Ver informes"}</span>
        ) : (
          <span className="badge-neutral whitespace-nowrap">Sin permiso</span>
        )}
      </div>
      <p className={`text-sm leading-relaxed ${habilitada ? "text-brand-graphite" : "text-brand-mist"}`}>{m.descripcion ?? u.description}</p>
      {m.contenido && (
        <ul className="flex flex-wrap gap-1.5">
          {m.contenido.map((c) => (
            <li key={c} className={`rounded border px-2 py-0.5 text-[11px] ${habilitada ? "border-brand-border bg-white text-brand-slate" : "border-brand-border text-brand-mist"}`}>
              {c}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto pt-1 flex items-center justify-between text-xs">
        {habilitada ? (
          <>
            <span className="text-brand-slate">{gestion ? "Podés subir cortes, publicar y eliminar." : m.gestion ? "Solo consulta de informes publicados." : ""}</span>
            <span className="font-semibold text-brand-primary">Abrir →</span>
          </>
        ) : (
          <span className="text-brand-mist">Tu perfil no tiene acceso a este módulo.</span>
        )}
      </div>
    </Box>
  );
}
