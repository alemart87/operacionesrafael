"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Avatar } from "@/components/Avatar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ROLE_LABELS, apiFetch, getUser } from "@/lib/api";
import { formatDate } from "@/lib/format";

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  photo_url: string | null;
  allowed_modules: string[] | null;
  created_at: string;
  last_login_at: string | null;
}

interface ModuleInfo {
  slug: string;
  name: string;
  description: string;
  available: boolean;
  color: string;
}

const ROLE_OPTIONS = [
  { value: "analyst", title: "Analista", desc: "Carga datos, publica y ve todos los módulos." },
  { value: "viewer", title: "Lector", desc: "Solo lectura, sobre los módulos que se le habiliten." },
];

const EMPTY_FORM = { email: "", password: "", full_name: "", role: "analyst", allowed_modules: null as string[] | null };

/** Selector de módulos: null = acceso a todos; lista = solo los marcados. */
function ModulePicker({
  modules,
  value,
  onChange,
}: {
  modules: ModuleInfo[];
  value: string[] | null;
  onChange: (v: string[] | null) => void;
}) {
  const toggle = (slug: string) => {
    const cur = value ?? modules.map((m) => m.slug);
    onChange(cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug]);
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="label !mb-0">Módulos habilitados</label>
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`text-[10px] uppercase tracking-wider2 font-semibold px-2 py-1 rounded ${
            value === null ? "bg-brand-cyan text-white" : "bg-brand-bg text-brand-slate hover:bg-brand-border"
          }`}
        >
          Acceso a todos
        </button>
      </div>
      <div className="space-y-2">
        {modules.map((m) => {
          const checked = value === null || value.includes(m.slug);
          return (
            <label
              key={m.slug}
              className={`flex items-start gap-2.5 p-2.5 rounded-md border cursor-pointer transition-colors ${
                checked ? "border-brand-primary bg-brand-primary-light/30" : "border-brand-border"
              }`}
            >
              <input type="checkbox" checked={checked} onChange={() => toggle(m.slug)} className="mt-0.5 accent-brand-primary" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: m.color }} />
                  <span className="text-sm font-semibold text-brand-ink">{m.name}</span>
                  {!m.available && <span className="badge-neutral">Próximamente</span>}
                </div>
                <div className="text-[11px] text-brand-slate mt-0.5">{m.description}</div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [resetPwd, setResetPwd] = useState("");
  const [modulesUser, setModulesUser] = useState<UserRow | null>(null);
  const [modulesValue, setModulesValue] = useState<string[] | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoUser, setPhotoUser] = useState<UserRow | null>(null);

  const load = () => apiFetch<UserRow[]>("/api/v1/users").then(setUsers).catch((e) => setError(e.message));

  useEffect(() => {
    if (getUser()?.role !== "superadmin") {
      router.replace("/inicio");
      return;
    }
    load();
    apiFetch<ModuleInfo[]>("/api/v1/modules").then(setModules).catch(() => {});
  }, [router]);

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
    const payload: Record<string, unknown> = {
      email: form.email,
      password: form.password,
      full_name: form.full_name,
      role: form.role,
    };
    if (form.role === "viewer") payload.allowed_modules = form.allowed_modules;
    const done = await run(
      () => apiFetch("/api/v1/users", { method: "POST", body: JSON.stringify(payload) }),
      `Usuario "${form.email}" creado como ${ROLE_LABELS[form.role]}.`,
    );
    if (done) setForm(EMPTY_FORM);
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
    if (resetPwd.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    const done = await run(
      () => apiFetch(`/api/v1/users/${resetUser.id}/reset-password`, { method: "POST", body: JSON.stringify({ new_password: resetPwd }) }),
      `Contraseña de ${resetUser.email} reseteada.`,
    );
    if (done) {
      setResetUser(null);
      setResetPwd("");
    }
  };

  const onSaveModules = async () => {
    if (!modulesUser) return;
    await run(
      () => apiFetch(`/api/v1/users/${modulesUser.id}`, { method: "PATCH", body: JSON.stringify({ allowed_modules: modulesValue }) }),
      `Módulos de ${modulesUser.email} actualizados.`,
    );
    setModulesUser(null);
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

  const moduleSummary = (u: UserRow) => {
    if (u.role !== "viewer" || u.allowed_modules === null) return "Todos los módulos";
    if (u.allowed_modules.length === 0) return "Sin módulos";
    return u.allowed_modules.map((s) => modules.find((m) => m.slug === s)?.name ?? s).join(", ");
  };

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-3xl text-brand-ink uppercase">Gestión de usuarios</h1>
        <p className="text-sm text-brand-slate mt-1">
          Analistas (gestionan datos y ven todo) o lectores (solo lectura, por módulo).
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-brand-primary-light border border-brand-primary/30 text-brand-primary-dark text-sm rounded-md px-3 py-2.5">
          {error}
        </div>
      )}
      {ok && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-md px-3 py-2.5">{ok}</div>
      )}

      <div className="grid lg:grid-cols-5 gap-6">
        <form onSubmit={onCreate} className="card p-6 space-y-4 lg:col-span-2 h-fit">
          <h2 className="font-display text-xl text-brand-ink uppercase">Crear usuario</h2>

          <div>
            <label className="label">Tipo de usuario</label>
            <div className="grid grid-cols-2 gap-2">
              {ROLE_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setForm({ ...form, role: r.value })}
                  className={`p-3 text-left rounded-md border text-xs transition-all ${
                    form.role === r.value
                      ? "border-brand-primary bg-brand-primary-light text-brand-primary-dark"
                      : "border-brand-border text-brand-slate hover:border-brand-mist"
                  }`}
                >
                  <div className="font-semibold uppercase tracking-wider2 text-[10px] mb-0.5">{r.title}</div>
                  <div className="text-[11px] opacity-80">{r.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {form.role === "viewer" && (
            <ModulePicker modules={modules} value={form.allowed_modules} onChange={(v) => setForm({ ...form, allowed_modules: v })} />
          )}

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
              placeholder="Mínimo 8 caracteres"
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
                      <span className={u.role === "analyst" ? "badge-primary" : "badge-cyan"}>{ROLE_LABELS[u.role] ?? u.role}</span>
                      {!u.is_active && <span className="badge-neutral">Inactivo</span>}
                    </div>
                    <div className="text-xs text-brand-slate truncate">{u.email}</div>
                    <div className="text-[11px] text-brand-mist mt-0.5">
                      {moduleSummary(u)} · Último acceso: {formatDate(u.last_login_at)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 sm:justify-end">
                  {u.role === "viewer" && (
                    <button
                      className="btn-ghost !px-2 !py-1 text-xs"
                      onClick={() => {
                        setModulesUser(u);
                        setModulesValue(u.allowed_modules);
                      }}
                    >
                      Módulos
                    </button>
                  )}
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
            <p>Nueva contraseña para {resetUser?.email}:</p>
            <input
              className="input"
              type="text"
              value={resetPwd}
              onChange={(e) => setResetPwd(e.target.value)}
              placeholder="Mínimo 8 caracteres"
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

      <ConfirmDialog
        open={!!modulesUser}
        title="Módulos del lector"
        message={<ModulePicker modules={modules} value={modulesValue} onChange={setModulesValue} />}
        confirmLabel="Guardar"
        loading={busy}
        onConfirm={onSaveModules}
        onCancel={() => setModulesUser(null)}
      />
    </AppShell>
  );
}
