"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { Brand } from "./Brand";
import { CurrentUserInfo, ROLE_LABELS, apiFetch, clearSession, getToken, getUser, saveUser } from "@/lib/api";

const ADMIN_NAV = [
  { href: "/admin/users", label: "Usuarios" },
  { href: "/admin/audit", label: "Auditoría" },
];

/**
 * Cromo de la app: header con marca, navegación admin (solo superadmin),
 * perfil y cierre de sesión. Redirige a /login si no hay token.
 * Para sumar la navegación de un módulo, seguir el patrón del proyecto de
 * Cobranzas: una barra oscura secundaria visible solo dentro del módulo.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUserInfo | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setUser(getUser());
    // Sincroniza con el backend: cambios del superadmin se ven sin re-login.
    apiFetch<CurrentUserInfo>("/api/v1/auth/me")
      .then((me) => {
        const next = {
          email: me.email,
          role: me.role,
          full_name: me.full_name,
          photo_url: me.photo_url ?? null,
          allowed_modules: me.allowed_modules ?? null,
        };
        saveUser(next);
        setUser(next);
      })
      .catch(() => {});
  }, [router]);

  useEffect(() => setMobileOpen(false), [pathname]);

  const onLogout = () => {
    clearSession();
    router.push("/login");
  };

  if (!user) return null;

  const isAdmin = user.role === "superadmin";
  const mobilePill = (active: boolean) =>
    `block px-3 py-2 rounded-md text-sm font-medium ${
      active ? "bg-brand-primary-light text-brand-primary-dark" : "text-brand-graphite hover:bg-brand-bg"
    }`;

  return (
    <div className="min-h-screen flex flex-col bg-brand-bg">
      <header className="bg-white border-b border-brand-border shadow-soft sticky top-0 z-30">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link href="/inicio" className="hover:opacity-90 transition-opacity flex-shrink-0">
            <Brand logoHeight={40} />
          </Link>

          {isAdmin && (
            <nav className="hidden md:flex items-center gap-1">
              {ADMIN_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={pathname?.startsWith(item.href) ? "nav-link-active" : "nav-link"}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          )}

          <div className="flex items-center gap-3 sm:gap-4">
            <Link href="/perfil" className="flex items-center gap-3 group" title="Mi perfil">
              <div className="text-right leading-tight hidden sm:block">
                <div className="text-sm font-semibold text-brand-ink group-hover:text-brand-primary transition-colors">
                  {user.full_name}
                </div>
                <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">
                  {ROLE_LABELS[user.role] ?? user.role}
                </div>
              </div>
              <Avatar name={user.full_name} photoUrl={user.photo_url} size={40} />
            </Link>
            <button onClick={onLogout} className="btn-ghost hidden md:inline-flex" title="Cerrar sesión">
              Salir
            </button>
            <button
              type="button"
              className="md:hidden w-9 h-9 flex items-center justify-center rounded-md text-brand-ink hover:bg-brand-bg"
              aria-label="Menú"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((o) => !o)}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {mobileOpen ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
              </svg>
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-brand-border bg-white animate-fade">
            <nav className="px-3 py-3 flex flex-col">
              <Link href="/inicio" className={mobilePill(pathname === "/inicio")}>Inicio</Link>
              <Link href="/perfil" className={mobilePill(pathname === "/perfil")}>Mi perfil</Link>
              {isAdmin && (
                <>
                  <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider2 text-brand-mist font-semibold">
                    Administración
                  </div>
                  {ADMIN_NAV.map((item) => (
                    <Link key={item.href} href={item.href} className={mobilePill(!!pathname?.startsWith(item.href))}>
                      {item.label}
                    </Link>
                  ))}
                </>
              )}
              <button
                onClick={onLogout}
                className="mt-3 text-left px-3 py-2 rounded-md text-sm font-medium text-brand-primary hover:bg-brand-primary-light"
              >
                Cerrar sesión
              </button>
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8">{children}</main>

      <footer className="border-t border-brand-border bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 text-[11px] uppercase tracking-wider2 text-brand-slate flex flex-wrap justify-between gap-2">
          <span>Operaciones Voicenter · Gerencia Expansión RM</span>
          <span>© {new Date().getFullYear()} Voicenter S.A.</span>
        </div>
      </footer>
    </div>
  );
}
