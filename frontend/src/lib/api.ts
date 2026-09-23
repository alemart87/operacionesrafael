"use client";

const TOKEN_KEY = "rm_token";
const REFRESH_KEY = "rm_refresh";
const USER_KEY = "rm_user";

export interface CurrentUserInfo {
  email: string;
  role: string;
  full_name: string;
  photo_url?: string | null;
  allowed_modules?: string[] | null; // null = acceso a todos
}

export const ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadmin",
  analyst: "Analista",
  viewer: "Lector",
};

interface TokenPair {
  access_token: string;
  refresh_token: string;
  user_email: string;
  user_role: string;
  user_name: string;
  user_photo_url?: string | null;
  user_allowed_modules?: string[] | null;
}

function userFromTokens(data: TokenPair): CurrentUserInfo {
  return {
    email: data.user_email,
    role: data.user_role,
    full_name: data.user_name,
    photo_url: data.user_photo_url ?? null,
    allowed_modules: data.user_allowed_modules ?? null,
  };
}

export function setSession(data: TokenPair) {
  localStorage.setItem(TOKEN_KEY, data.access_token);
  localStorage.setItem(REFRESH_KEY, data.refresh_token);
  localStorage.setItem(USER_KEY, JSON.stringify(userFromTokens(data)));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): CurrentUserInfo | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Actualiza (merge) el usuario guardado tras editar el perfil. */
export function saveUser(partial: Partial<CurrentUserInfo>): void {
  if (typeof window === "undefined") return;
  const cur = getUser() ?? ({} as CurrentUserInfo);
  localStorage.setItem(USER_KEY, JSON.stringify({ ...cur, ...partial }));
}

export async function login(email: string, password: string): Promise<CurrentUserInfo> {
  const r = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : "Error de autenticación");
  }
  const data: TokenPair = await r.json();
  setSession(data);
  return userFromTokens(data);
}

// Un único refresh en vuelo aunque fallen varias requests a la vez.
let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (!refresh) return false;
  if (!refreshing) {
    refreshing = fetch("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    })
      .then(async (r) => {
        if (!r.ok) return false;
        setSession(await r.json());
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

function redirectToLogin() {
  clearSession();
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

export async function apiFetch<T = any>(path: string, opts: RequestInit = {}, retried = false): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...((opts.headers as Record<string, string>) || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!(opts.body instanceof FormData) && opts.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    // Access token vencido → intentar renovar con el refresh token una sola vez.
    if (!retried && (await tryRefresh())) return apiFetch<T>(path, opts, true);
    redirectToLogin();
    throw new Error("Sesión expirada");
  }
  if (!res.ok) {
    let detail = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d: any) => d.msg).join(" · ");
      else detail = JSON.stringify(body);
    } catch {}
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}
