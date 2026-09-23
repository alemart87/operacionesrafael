"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";

interface Perfil {
  slug: string;
  name: string;
  description: string;
  permissions: string[];
  updated_at: string | null;
  usuarios_activos: number;
}

interface UtilidadDef {
  key: string;
  name: string;
  description: string;
}

interface OperativaDef {
  slug: string;
  name: string;
  color: string;
  utilidades: UtilidadDef[];
}

type Matrix = Record<string, Set<string>>;

function toMatrix(perfiles: Perfil[]): Matrix {
  return Object.fromEntries(perfiles.map((p) => [p.slug, new Set(p.permissions)]));
}

function sameSet(a: Set<string>, b: Set<string>) {
  return a.size === b.size && Array.from(a).every((x) => b.has(x));
}

export default function PerfilesPage() {
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [operativas, setOperativas] = useState<OperativaDef[]>([]);
  const [saved, setSaved] = useState<Matrix>({});
  const [draft, setDraft] = useState<Matrix>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = () =>
    apiFetch<{ perfiles: Perfil[]; operativas: OperativaDef[] }>("/api/v1/perfiles")
      .then((d) => {
        setPerfiles(d.perfiles);
        setOperativas(d.operativas);
        setSaved(toMatrix(d.perfiles));
        setDraft(toMatrix(d.perfiles));
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const dirty = useMemo(
    () => perfiles.filter((p) => draft[p.slug] && saved[p.slug] && !sameSet(draft[p.slug], saved[p.slug])).map((p) => p.slug),
    [perfiles, draft, saved],
  );

  const toggle = (perfil: string, op: string, utilidad: string) => {
    setOk(null);
    setDraft((cur) => {
      const next = new Set(cur[perfil]);
      const perm = `${op}.${utilidad}`;
      if (next.has(perm)) {
        next.delete(perm);
        // Sin acceso a la operativa, las demás utilidades no tienen efecto: se quitan.
        if (utilidad === "ver") Array.from(next).filter((p) => p.startsWith(`${op}.`)).forEach((p) => next.delete(p));
      } else {
        next.add(perm);
        // Dar una utilidad implica dar el acceso a la operativa.
        next.add(`${op}.ver`);
      }
      return { ...cur, [perfil]: next };
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      for (const slug of dirty) {
        await apiFetch(`/api/v1/perfiles/${slug}`, {
          method: "PUT",
          body: JSON.stringify({ permissions: Array.from(draft[slug]) }),
        });
      }
      setOk(`Permisos guardados para: ${dirty.map((s) => perfiles.find((p) => p.slug === s)?.name).join(", ")}.`);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-brand-ink uppercase">Perfiles y permisos</h1>
          <p className="text-sm text-brand-slate mt-1 max-w-2xl">
            Definí qué utilidades tiene cada perfil en cada operativa. Los cambios se aplican al instante a todos los
            usuarios del perfil que tengan esa operativa asignada.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={!dirty.length || saving} onClick={() => setDraft(saved)}>
            Descartar
          </button>
          <button className="btn-primary" disabled={!dirty.length || saving} onClick={save}>
            {saving ? "Guardando…" : dirty.length ? `Guardar cambios (${dirty.length})` : "Sin cambios"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-brand-primary-light border border-brand-primary/30 text-brand-primary-dark text-sm rounded-md px-3 py-2.5">
          {error}
        </div>
      )}
      {ok && <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-md px-3 py-2.5">{ok}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="bg-brand-bg">
              <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider2 text-brand-slate w-[40%]">Utilidad</th>
              {perfiles.map((p) => (
                <th key={p.slug} className="px-3 py-3 text-center align-bottom">
                  <div className="font-display text-base uppercase text-brand-ink">
                    {p.name}
                    {dirty.includes(p.slug) && <span className="text-brand-primary" title="Cambios sin guardar"> •</span>}
                  </div>
                  <div className="text-[10px] font-normal text-brand-slate normal-case">
                    {p.usuarios_activos} usuario(s) activo(s)
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {operativas.map((op) => (
              <Fragment key={op.slug}>
                <tr>
                  <td colSpan={perfiles.length + 1} className="px-4 pt-5 pb-2 border-b border-brand-border">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: op.color }} />
                      <span className="font-display text-lg uppercase text-brand-ink">{op.name}</span>
                    </div>
                  </td>
                </tr>
                {op.utilidades.map((u) => (
                  <tr key={u.key} className="border-b border-brand-border last:border-0 hover:bg-brand-bg-soft">
                    <td className="px-4 py-3">
                      <div className={`font-semibold ${u.key === "ver" ? "text-brand-primary-dark" : "text-brand-ink"}`}>{u.name}</div>
                      <div className="text-[11px] text-brand-slate">{u.description}</div>
                    </td>
                    {perfiles.map((p) => {
                      const set = draft[p.slug] ?? new Set<string>();
                      const checked = set.has(`${op.slug}.${u.key}`);
                      const sinAcceso = u.key !== "ver" && !set.has(`${op.slug}.ver`);
                      return (
                        <td key={p.slug} className="px-3 py-3 text-center">
                          <input
                            type="checkbox"
                            aria-label={`${p.name}: ${u.name}`}
                            className={`w-4 h-4 accent-brand-primary cursor-pointer ${sinAcceso ? "opacity-40" : ""}`}
                            checked={checked}
                            onChange={() => toggle(p.slug, op.slug, u.key)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-brand-slate space-y-1">
        <p>
          <strong>Acceso a la operativa</strong> es la llave: sin ella el perfil no ve la operativa. Al marcar cualquier
          utilidad se marca el acceso, y al quitar el acceso se quitan todas las utilidades de esa operativa.
        </p>
        <p>El superadmin tiene siempre todos los permisos. Cada usuario además debe tener la operativa asignada en Usuarios.</p>
        {perfiles.some((p) => p.updated_at) && (
          <p className="text-brand-mist">
            Última modificación:{" "}
            {formatDate(
              perfiles
                .map((p) => p.updated_at)
                .filter(Boolean)
                .sort()
                .pop() ?? null,
            )}
          </p>
        )}
      </div>
    </AppShell>
  );
}
