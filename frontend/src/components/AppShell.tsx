"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { Brand } from "./Brand";
import { CurrentUserInfo, ROLE_LABELS, apiFetch, can, clearSession, getToken, getUser, saveUser } from "@/lib/api";
import { OperativaNavItem, isNavActive, operativaFromPath, requiredUtilidades, submoduloFromPath } from "@/lib/operativas";

const ADMIN_NAV = [
  { href: "/admin/users", label: "Usuarios" },
  { href: "/admin/perfiles", label: "Perfiles" },
  { href: "/admin/audit", label: "Auditoría" },
];

interface Session {
  user: CurrentUserInfo;
  /** ¿Tiene el permiso "<operativa>.<utilidad>"? Superadmin siempre. */
  can: (perm: string) => boolean;
  isSuperadmin: boolean;
}

const SessionContext = createContext<Session | null>(null);

/** Sesión del usuario logueado. Solo disponible dentro de <AppShell>. */
export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession debe usarse dentro de <AppShell>");
  return s;
}

/**
 * Cromo de la app: header con marca, navegación de administración (solo
 * superadmin), barra de la operativa activa, perfil y cierre de sesión.
 * Carga los permisos desde /auth/me y bloquea las operativas sin acceso.
 */
export function AppShell({ children, workspace = false }: {
  children: React.ReactNode;
  /** Pantalla completa sin márgenes ni footer (chat del agente). */
  workspace?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUserInfo | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    // Los permisos siempre se piden al backend: el superadmin puede cambiarlos en cualquier momento.
    apiFetch<CurrentUserInfo>("/api/v1/auth/me")
      .then((me) => {
        const next: CurrentUserInfo = {
          email: me.email,
          role: me.role,
          full_name: me.full_name,
          photo_url: me.photo_url ?? null,
          operativas: me.operativas ?? [],
          visible_operativas: me.visible_operativas ?? [],
          permissions: me.permissions ?? [],
        };
        saveUser(next);
        setUser(next);
      })
      .catch(() => {
        const cached = getUser();
        if (cached) setUser(cached);
      });
  }, [router]);

  useEffect(() => setMobileOpen(false), [pathname]);

  const operativa = operativaFromPath(pathname);
  const submodulo = operativa ? submoduloFromPath(operativa, pathname) : undefined;
  const blocked =
    !!user && !!operativa && requiredUtilidades(operativa, pathname).some((u) => !can(user, `${operativa.slug}.${u}`));
  const adminOnly = !!user && !!pathname?.startsWith("/admin") && user.role !== "superadmin";

  useEffect(() => {
    if (blocked || adminOnly) router.replace("/inicio");
  }, [blocked, adminOnly, router]);

  const onLogout = () => {
    clearSession();
    router.push("/login");
  };

  if (!user || blocked || adminOnly) return null;

  const isAdmin = user.role === "superadmin";
  const session: Session = { user, can: (p) => can(user, p), isSuperadmin: isAdmin };
  // Barra de la operativa en dos niveles:
  //  - En la operativa: Inicio + un acceso por submódulo habilitado.
  //  - Dentro de un submódulo: solo su navegación interna, con vuelta a la operativa.
  const opNav: OperativaNavItem[] = !operativa
    ? []
    : submodulo
      ? submodulo.nav.filter((i) => !i.utilidad || can(user, `${operativa.slug}.${i.utilidad}`))
      : [
          { href: operativa.href, label: "Inicio", exact: true },
          ...operativa.submodulos
            .filter((s) => can(user, `${operativa.slug}.${s.utilidad}`))
            .map((s) => ({ href: s.href, label: s.label })),
        ];
  const back = submodulo
    ? { href: operativa!.href, label: operativa!.name }
    : { href: "/inicio", label: "Operativas" };
  // Agrupa los ítems consecutivos del mismo grupo para mostrar su rótulo una vez.
  const opGroups: { grupo?: string; items: OperativaNavItem[] }[] = [];
  for (const item of opNav) {
    const last = opGroups[opGroups.length - 1];
    if (last && last.grupo === item.grupo) last.items.push(item);
    else opGroups.push({ grupo: item.grupo, items: [item] });
  }
  const barTitle = operativa ? (submodulo ? `${operativa.name} · ${submodulo.label}` : operativa.name) : "";

  const pill = (active: boolean) =>
    `px-3 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
      active ? "bg-brand-primary text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
    }`;
  const mobilePill = (active: boolean) =>
    `block px-3 py-2 rounded-md text-sm font-medium ${
      active ? "bg-brand-primary-light text-brand-primary-dark" : "text-brand-graphite hover:bg-brand-bg"
    }`;
  const groupLabel = "px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider2 text-brand-mist font-semibold";

  return (
    <SessionContext.Provider value={session}>
      <div className={`${workspace ? "h-screen overflow-hidden" : "min-h-screen"} flex flex-col bg-brand-bg`}>
        <header className="bg-white border-b border-brand-border shadow-soft sticky top-0 z-30">
          <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <Link href="/inicio" className="hover:opacity-90 transition-opacity flex-shrink-0">
              <Brand logoHeight={40} compactOnPhone />
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
                <div className={`text-right leading-tight hidden ${isAdmin ? "lg:block" : "sm:block"}`}>
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
            <div className="md:hidden border-t border-brand-border bg-white animate-fade max-h-[75vh] overflow-y-auto">
              <nav className="px-3 py-3 flex flex-col">
                <Link href="/inicio" className={mobilePill(pathname === "/inicio")}>Operativas</Link>
                <Link href="/perfil" className={mobilePill(pathname === "/perfil")}>Mi perfil</Link>
                {operativa && (
                  <div>
                    <div className={groupLabel}>{barTitle}</div>
                    {submodulo && (
                      <Link href={back.href} className={mobilePill(false)}>← {back.label}</Link>
                    )}
                    {opGroups.map((g) => (
                      <div key={g.grupo ?? "_"}>
                        {g.grupo && <div className={groupLabel}>{g.grupo}</div>}
                        {g.items.map((item) => (
                          <Link key={item.href} href={item.href} className={mobilePill(isNavActive(item, pathname))}>
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                {isAdmin && (
                  <>
                    <div className={groupLabel}>Administración</div>
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

          {/* Barra de la operativa activa (desktop) */}
          {operativa && (
            <div className="bg-brand-ink text-white hidden md:block">
              <div className="px-4 sm:px-6 py-2 flex items-center gap-1 flex-wrap">
                <Link href={back.href} className="text-[10px] uppercase tracking-wider2 font-semibold text-white/55 hover:text-white">
                  ← {back.label}
                </Link>
                <span className="w-px h-4 bg-white/15 mx-1.5" aria-hidden />
                <span className="text-[10px] uppercase tracking-wider2 font-bold text-white/80">{barTitle}</span>
                <span className="w-px h-4 bg-white/15 mx-1.5" aria-hidden />
                {opGroups.map((g, i) => (
                  <span key={g.grupo ?? "_"} className="inline-flex items-center gap-1 flex-wrap">
                    {i > 0 && <span className="w-px h-4 bg-white/15 mx-1.5" aria-hidden />}
                    {g.grupo && (
                      <span className="text-[10px] uppercase tracking-wider2 font-semibold text-white/40 px-1">{g.grupo}</span>
                    )}
                    {g.items.map((item) => (
                      <Link key={item.href} href={item.href} className={pill(isNavActive(item, pathname))}>
                        {item.label}
                      </Link>
                    ))}
                  </span>
                ))}
              </div>
            </div>
          )}
        </header>

        <main
          className={workspace ? "flex-1 flex min-h-0 w-full" : "flex-1 w-full max-w-screen-2xl mx-auto px-4 sm:px-6 py-8"}
        >
          {children}
        </main>

        {!workspace && (
        <footer className="border-t border-brand-border bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 text-[11px] uppercase tracking-wider2 text-brand-slate flex flex-wrap justify-between gap-2">
            <span>Operaciones Voicenter · Gerencia Expansión RM</span>
            <span>© {new Date().getFullYear()} Voicenter S.A.</span>
          </div>
        </footer>
        )}
      </div>
    </SessionContext.Provider>
  );
}
