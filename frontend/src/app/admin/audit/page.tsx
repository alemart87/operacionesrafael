"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { apiFetch, getUser } from "@/lib/api";
import { formatDate } from "@/lib/format";

interface AuditRow {
  id: number;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string | null;
  extra: Record<string, unknown>;
  occurred_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  login: "Inicio de sesión",
  login_failed: "Login fallido",
  create_user: "Alta de usuario",
  update_user: "Edición de usuario",
  deactivate_user: "Baja de usuario",
  reset_password: "Reseteo de contraseña",
  upload_user_photo: "Foto de usuario",
  update_own_profile: "Edición de perfil propio",
  change_own_password: "Cambio de contraseña propia",
  upload_own_photo: "Foto de perfil propia",
  update_profile_permissions: "Cambio de permisos de perfil",
};

export default function AuditPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [users, setUsers] = useState<Record<string, { email: string; full_name: string }>>({});
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (getUser()?.role !== "superadmin") {
      router.replace("/inicio");
      return;
    }
    apiFetch("/api/v1/audit/users-map").then(setUsers).catch(() => {});
  }, [router]);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ limit: "300" });
    if (action) qs.set("action", action);
    apiFetch<AuditRow[]>(`/api/v1/audit?${qs}`)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [action]);

  const who = (r: AuditRow) => {
    if (!r.user_id) return (r.extra?.email as string) ?? "—";
    return users[r.user_id]?.full_name ?? r.user_id;
  };

  return (
    <AppShell>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-brand-ink uppercase">Auditoría</h1>
          <p className="text-sm text-brand-slate mt-1">Registro de todas las acciones realizadas en la plataforma.</p>
        </div>
        <div className="w-full sm:w-64">
          <label className="label">Filtrar por acción</label>
          <select className="input" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="card p-4 mb-4 text-sm text-brand-primary-dark">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-brand-bg text-[10px] uppercase tracking-wider2 text-brand-slate">
            <tr>
              <th className="text-left px-4 py-3">Fecha</th>
              <th className="text-left px-4 py-3">Usuario</th>
              <th className="text-left px-4 py-3">Acción</th>
              <th className="text-left px-4 py-3">Recurso</th>
              <th className="text-left px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-brand-slate">Cargando…</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-brand-slate">Sin registros.</td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-brand-bg-soft">
                  <td className="px-4 py-2.5 whitespace-nowrap text-brand-slate">{formatDate(r.occurred_at)}</td>
                  <td className="px-4 py-2.5 text-brand-ink">{who(r)}</td>
                  <td className="px-4 py-2.5">
                    <span className={r.action === "login_failed" ? "badge-primary" : "badge-neutral"}>
                      {ACTION_LABELS[r.action] ?? r.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-brand-slate">
                    {r.resource_type ?? "—"}
                    {r.resource_id ? ` · ${r.resource_id.slice(0, 8)}` : ""}
                  </td>
                  <td className="px-4 py-2.5 text-brand-slate font-mono text-xs">{r.ip_address ?? "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
