"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Avatar } from "@/components/Avatar";
import { ROLE_LABELS, apiFetch, saveUser } from "@/lib/api";
import { PoliticaContrasena } from "@/components/seguridad/PoliticaContrasena";
import { SegundoFactor } from "@/components/seguridad/SegundoFactor";

interface MeData {
  id: string;
  email: string;
  full_name: string;
  role: string;
  photo_url?: string | null;
  can_edit_profile?: boolean;
}

function Banner({ kind, children }: { kind: "ok" | "error"; children: React.ReactNode }) {
  const cls =
    kind === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-brand-primary/30 bg-brand-primary-light text-brand-primary-dark";
  return <div className={`rounded-md border px-4 py-2.5 text-sm ${cls}`}>{children}</div>;
}

export default function PerfilPage() {
  const [me, setMe] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);

  const [fullName, setFullName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [changingPwd, setChangingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);
  const [pwdErr, setPwdErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<MeData>("/api/v1/auth/me")
      .then((d) => {
        setMe(d);
        setFullName(d.full_name);
      })
      .finally(() => setLoading(false));
  }, []);

  const canEdit = me?.can_edit_profile ?? false;

  const saveProfile = async () => {
    setProfileMsg(null);
    setProfileErr(null);
    if (fullName.trim().length < 2) {
      setProfileErr("El nombre debe tener al menos 2 caracteres.");
      return;
    }
    setSavingProfile(true);
    try {
      const updated = await apiFetch<MeData>("/api/v1/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ full_name: fullName.trim() }),
      });
      setMe((m) => (m ? { ...m, full_name: updated.full_name } : m));
      saveUser({ full_name: updated.full_name });
      setProfileMsg("Perfil actualizado.");
    } catch (e: any) {
      setProfileErr(e.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setProfileMsg(null);
    setProfileErr(null);
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const updated = await apiFetch<MeData>("/api/v1/auth/me/photo", { method: "POST", body: fd });
      setMe((m) => (m ? { ...m, photo_url: updated.photo_url } : m));
      saveUser({ photo_url: updated.photo_url });
      setProfileMsg("Foto actualizada.");
    } catch (e: any) {
      setProfileErr(e.message);
    } finally {
      setUploadingPhoto(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const changePwd = async () => {
    setPwdMsg(null);
    setPwdErr(null);
    if (newPwd !== confirmPwd) {
      setPwdErr("La nueva contraseña y su confirmación no coinciden.");
      return;
    }
    setChangingPwd(true);
    try {
      await apiFetch("/api/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: curPwd, new_password: newPwd }),
      });
      setPwdMsg("Contraseña actualizada correctamente.");
      setCurPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } catch (e: any) {
      setPwdErr(e.message);
    } finally {
      setChangingPwd(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="text-brand-slate">Cargando…</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-2 text-xs text-brand-slate">
        <Link href="/inicio" className="hover:text-brand-primary">Inicio</Link>
        <span className="mx-2">/</span>
        <span className="text-brand-ink font-semibold">Mi perfil</span>
      </div>
      <h1 className="font-display text-3xl sm:text-4xl text-brand-ink uppercase mb-6">Mi perfil</h1>

      <div className="grid lg:grid-cols-2 gap-6 max-w-5xl">
        <section className="card p-6">
          <h2 className="font-display text-xl text-brand-ink uppercase mb-4">Datos del perfil</h2>

          <div className="flex items-center gap-4 mb-5">
            <Avatar name={me?.full_name ?? ""} photoUrl={me?.photo_url} size={64} />
            <div>
              <div className="text-sm font-semibold text-brand-ink">{me?.email}</div>
              <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">
                {ROLE_LABELS[me?.role ?? ""] ?? me?.role}
              </div>
              {canEdit && (
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadingPhoto}
                  className="mt-2 text-xs px-2.5 py-1 rounded border border-brand-border hover:border-brand-primary hover:text-brand-primary disabled:opacity-50"
                >
                  {uploadingPhoto ? "Subiendo…" : "Cambiar foto"}
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onPhoto} />
            </div>
          </div>

          {!canEdit ? (
            <Banner kind="error">
              El perfil del superadmin se gestiona desde la configuración del servidor (.env) y no se edita desde la app.
            </Banner>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="label">Nombre completo</label>
                <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input bg-brand-bg text-brand-slate" value={me?.email ?? ""} disabled />
                <p className="text-[11px] text-brand-mist mt-1">El email no se puede modificar.</p>
              </div>
              {profileMsg && <Banner kind="ok">{profileMsg}</Banner>}
              {profileErr && <Banner kind="error">{profileErr}</Banner>}
              <button onClick={saveProfile} disabled={savingProfile} className="btn-primary">
                {savingProfile ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          )}
        </section>

        <section className="card p-6">
          <h2 className="font-display text-xl text-brand-ink uppercase mb-4">Cambiar contraseña</h2>
          {!canEdit ? (
            <Banner kind="error">La contraseña del superadmin se gestiona desde la configuración del servidor (.env).</Banner>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="label">Contraseña actual</label>
                <input type="password" className="input" value={curPwd} onChange={(e) => setCurPwd(e.target.value)} autoComplete="current-password" />
              </div>
              <div>
                <label className="label">Nueva contraseña</label>
                <input type="password" className="input" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} autoComplete="new-password" />
                <div className="mt-2"><PoliticaContrasena valor={newPwd} /></div>
              </div>
              <div>
                <label className="label">Repetir nueva contraseña</label>
                <input type="password" className="input" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} autoComplete="new-password" />
              </div>
              {pwdMsg && <Banner kind="ok">{pwdMsg}</Banner>}
              {pwdErr && <Banner kind="error">{pwdErr}</Banner>}
              <button onClick={changePwd} disabled={changingPwd || !curPwd || !newPwd || !confirmPwd} className="btn-primary">
                {changingPwd ? "Actualizando…" : "Actualizar contraseña"}
              </button>
            </div>
          )}
        </section>
        <div className="lg:col-span-2"><SegundoFactor /></div>
      </div>
    </AppShell>
  );
}
