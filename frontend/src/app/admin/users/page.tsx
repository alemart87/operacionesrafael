"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Avatar } from "@/components/Avatar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ROLE_LABELS, apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  photo_url: string | null;
  operativas: string[];
  created_at: string;
  last_login_at: string | null;
}

interface PerfilDef {
  slug: string;
  name: string;
  description: string;
}

interface OperativaDef {
  slug: string;
  name: string;
  description: string;
  color: string;
  available: boolean;
}

const EMPTY_FORM = { email: "", password: "", full_name: "", role: "analista", operativas: [] as string[] };

const ROLE_BADGE: Record<string, string> = {
  coordinador: "badge-primary",
  supervisor: "badge-cyan",
  analista: "badge-success",
  cliente: "badge-neutral",
};

/** Selector de operativas asignadas a un usuario. */
function OperativasPicker({
  operativas,
  value,
  onChange,
}: {
  operativas: OperativaDef[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (slug: string) =>
    onChange(value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug]);
  return (
    <div>
      <label className="label">Operativas asignadas</label>
      <div className="space-y-2">
        {operativas.map((o) => {
          const checked = value.includes(o.slug);
          return (
            <label
              key={o.slug}
              className={`flex items-start gap-2.5 p-2.5 rounded-md border cursor-pointer transition-colors ${
                checked ? "border-brand-primary bg-brand-primary-light/30" : "border-brand-border"
              }`}
            >
              <input type="checkbox" checked={checked} onChange={() => toggle(o.slug)} className="mt-0.5 accent-brand-primary" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: o.color }} />
                  <span className="text-sm font-semibold text-brand-ink">{o.name}</span>
                </div>
                <div className="text-[11px] text-brand-slate mt-0.5">{o.description}</div>
              </div>
            </label>
          );
        })}
      </div>
      <p className="text-[11px] text-brand-mist mt-1.5">
        Lo que puede hacer en cada operativa lo define su perfil (Administración → Perfiles).
      </p>
    </div>
  );
}

function PerfilPicker({ perfiles, value, onChange }: { perfiles: PerfilDef[]; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">Perfil</label>
      <div className="grid grid-cols-2 gap-2">
        {perfiles.map((p) => (
          <button
            key={p.slug}
            type="button"
            onClick={() => onChange(p.slug)}
            className={`p-3 text-left rounded-md border text-xs transition-all ${
              value === p.slug
                ? "border-brand-primary bg-brand-primary-light text-brand-primary-dark"
                : "border-brand-border text-brand-slate hover:border-brand-mist"
            }`}
          >
            <div className="font-semibold uppercase tracking-wider2 text-[10px] mb-0.5">{p.name}</div>
            <div className="text-[11px] opacity-80">{p.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [perfiles, setPerfiles] = useState<PerfilDef[]>([]);
  const [operativas, setOperativas] = useState<OperativaDef[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [editRole, setEditRole] = useState("");
  const [editOps, setEditOps] = useState<string[]>([]);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [resetPwd, setResetPwd] = useState("");
  const [confirmToggle, setConfirmToggle] = useState<UserRow | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoUser, setPhotoUser] = useState<UserRow | null>(null);

  const load = () => apiFetch<UserRow[]>("/api/v1/users").then(setUsers).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    apiFetch<{ perfiles: PerfilDef[]; operativas: OperativaDef[] }>("/api/v1/perfiles/catalogo")
      .then((c) => {
        setPerfiles(c.perfiles);
        setOperativas(c.operativas);
      })
      .catch(() => {});
  }, []);

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      await fn();
      if (success) setOk(success);
      await load();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const done = await run(
      () => apiFetch("/api/v1/users", { method: "POST", body: JSON.stringify(form) }),
      `Usuario "${form.email}" creado con perfil ${ROLE_LABELS[form.role]}.`,
    );
    if (done) setForm(EMPTY_FORM);
  };

  const onSaveEdit = async () => {
    if (!editUser) return;
    const done = await run(
      () =>
        apiFetch(`/api/v1/users/${editUser.id}`, {
          method: "PATCH",
          body: JSON.stringify({ role: editRole, operativas: editOps }),
        }),
      `Acceso de ${editUser.email} actualizado.`,
    );
    if (done) setEditUser(null);
  };

  const onToggleActive = async () => {
    if (!confirmToggle) return;
    const u = confirmToggle;
    await run(
      () => apiFetch(`/api/v1/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !u.is_active }) }),
      u.is_active ? `Usuario ${u.email} desactivado.` : `Usuario ${u.email} reactivado.`,
    );
    setConfirmToggle(null);
  };

  const onResetPwd = async () => {
    if (!resetUser) return;
    const done = await run(
      () => apiFetch(`/api/v1/users/${resetUser.id}/reset-password`, { method: "POST", body: JSON.stringify({ new_password: resetPwd }) }),
      `Contraseña de ${resetUser.email} reseteada.`,
    );
    if (done) {
      setResetUser(null);
      setResetPwd("");
    }
  };

  const onPhotoPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !photoUser) return;
    const fd = new FormData();
    fd.append("file", file);
    await run(() => apiFetch(`/api/v1/users/${photoUser.id}/photo`, { method: "POST", body: fd }), "Foto actualizada.");
    setPhotoUser(null);
    if (photoRef.current) photoRef.current.value = "";
  };

  const opsSummary = (u: UserRow) =>
    u.operativas.length === 0
      ? "Sin operativas asignadas"
      : u.operativas.map((s) => operativas.find((o) => o.slug === s)?.name ?? s).join(", ");

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-3xl text-brand-ink uppercase">Gestión de usuarios</h1>
        <p className="text-sm text-brand-slate mt-1">
          Cada usuario tiene un perfil y las operativas en las que trabaja. Los permisos de cada perfil se configuran
          en Perfiles.
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-brand-primary-light border border-brand-primary/30 text-brand-primary-dark text-sm rounded-md px-3 py-2.5">
          {error}
        </div>
      )}
      {ok && <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-md px-3 py-2.5">{ok}</div>}

      <div className="grid lg:grid-cols-5 gap-6">
        <form onSubmit={onCreate} className="card p-6 space-y-4 lg:col-span-2 h-fit">
          <h2 className="font-display text-xl text-brand-ink uppercase">Crear usuario</h2>
          <PerfilPicker perfiles={perfiles} value={form.role} onChange={(role) => setForm({ ...form, role })} />
          <OperativasPicker operativas={operativas} value={form.operativas} onChange={(ops) => setForm({ ...form, operativas: ops })} />
          <div>
            <label className="label">Email</label>
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" />
          </div>
          <div>
            <label className="label">Nombre completo</label>
            <input type="text" required minLength={2} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="input" />
          </div>
          <div>
            <label className="label">Contraseña inicial</label>
            <input
              type="text"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="input"
              placeholder="Según la política de contraseñas (Seguridad)"
              autoComplete="off"
            />
          </div>
          <button type="submit" disabled={busy} className="btn-primary w-full">Crear usuario</button>
        </form>

        <div className="card lg:col-span-3 overflow-hidden h-fit">
          <div className="px-5 py-4 border-b border-brand-border">
            <h2 className="font-display text-xl text-brand-ink uppercase">Usuarios registrados</h2>
            <p className="text-xs text-brand-slate mt-0.5">{users.length} usuario(s)</p>
          </div>
          {users.length === 0 && <div className="p-8 text-center text-sm text-brand-slate">Sin usuarios todavía.</div>}
          <ul className="divide-y divide-brand-border">
            {users.map((u) => (
              <li key={u.id} className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 ${u.is_active ? "" : "opacity-60"}`}>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Avatar name={u.full_name} photoUrl={u.photo_url} size={40} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-brand-ink truncate">{u.full_name}</span>
                      <span className={ROLE_BADGE[u.role] ?? "badge-neutral"}>{ROLE_LABELS[u.role] ?? u.role}</span>
                      {!u.is_active && <span className="badge-neutral">Inactivo</span>}
                    </div>
                    <div className="text-xs text-brand-slate truncate">{u.email}</div>
                    <div className="text-[11px] text-brand-mist mt-0.5">
                      {opsSummary(u)} · Último acceso: {formatDate(u.last_login_at)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 sm:justify-end">
                  <button
                    className="btn-ghost !px-2 !py-1 text-xs"
                    onClick={() => {
                      setEditUser(u);
                      setEditRole(u.role);
                      setEditOps(u.operativas);
                    }}
                  >
                    Acceso
                  </button>
                  <button
                    className="btn-ghost !px-2 !py-1 text-xs"
                    onClick={() => {
                      setPhotoUser(u);
                      photoRef.current?.click();
                    }}
                  >
                    Foto
                  </button>
                  <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setResetUser(u)}>
                    Contraseña
                  </button>
                  <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setConfirmToggle(u)}>
                    {u.is_active ? "Desactivar" : "Reactivar"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <input ref={photoRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onPhotoPicked} />

      <ConfirmDialog
        open={!!editUser}
        title="Perfil y operativas"
        message={
          <div className="space-y-4 text-left">
            <p>{editUser?.email}</p>
            <PerfilPicker perfiles={perfiles} value={editRole} onChange={setEditRole} />
            <OperativasPicker operativas={operativas} value={editOps} onChange={setEditOps} />
          </div>
        }
        confirmLabel="Guardar"
        loading={busy}
        onConfirm={onSaveEdit}
        onCancel={() => setEditUser(null)}
      />

      <ConfirmDialog
        open={!!confirmToggle}
        title={confirmToggle?.is_active ? "Desactivar usuario" : "Reactivar usuario"}
        message={
          confirmToggle?.is_active
            ? `${confirmToggle?.email} no podrá iniciar sesión. Su historial de auditoría se conserva.`
            : `${confirmToggle?.email} podrá volver a iniciar sesión.`
        }
        confirmLabel={confirmToggle?.is_active ? "Desactivar" : "Reactivar"}
        variant={confirmToggle?.is_active ? "danger" : "default"}
        loading={busy}
        onConfirm={onToggleActive}
        onCancel={() => setConfirmToggle(null)}
      />

      <ConfirmDialog
        open={!!resetUser}
        title="Resetear contraseña"
        message={
          <div className="space-y-2">
            <p>Nueva contraseña para {resetUser?.email}. Al ingresar tendrá que cambiarla y se cierran sus sesiones abiertas.</p>
            <input
              className="input"
              type="text"
              value={resetPwd}
              onChange={(e) => setResetPwd(e.target.value)}
              placeholder="Según la política de contraseñas (Seguridad)"
              autoComplete="off"
            />
          </div>
        }
        confirmLabel="Resetear"
        loading={busy}
        onConfirm={onResetPwd}
        onCancel={() => {
          setResetUser(null);
          setResetPwd("");
        }}
      />
    </AppShell>
  );
}
