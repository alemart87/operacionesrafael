"use client";

const TOKEN_KEY = "rm_token";
const REFRESH_KEY = "rm_refresh";
const USER_KEY = "rm_user";

export interface CurrentUserInfo {
  email: string;
  role: string;
  full_name: string;
  photo_url?: string | null;
  /** Operativas asignadas (superadmin: todas). */
  operativas?: string[];
  /** Operativas que efectivamente puede abrir (asignada + perfil con acceso). */
  visible_operativas?: string[];
  /** Permisos efectivos "<operativa>.<utilidad>". Solo para UI: el backend valida siempre. */
  permissions?: string[];
}

export const ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadmin",
  coordinador: "Coordinador",
  supervisor: "Supervisor",
  analista: "Analista",
  cliente: "Cliente",
};

/** ¿El usuario tiene el permiso? Superadmin siempre. */
export function can(user: CurrentUserInfo | null | undefined, perm: string): boolean {
  if (!user) return false;
  if (user.role === "superadmin") return true;
  return (user.permissions ?? []).includes(perm);
}

interface TokenPair {
  access_token: string;
  refresh_token: string;
  user_email: string;
  user_role: string;
  user_name: string;
  user_photo_url?: string | null;
  user_operativas?: string[];
}

function userFromTokens(data: TokenPair): CurrentUserInfo {
  return {
    email: data.user_email,
    role: data.user_role,
    full_name: data.user_name,
    photo_url: data.user_photo_url ?? null,
    operativas: data.user_operativas ?? [],
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

/** Resultado del login: sesión abierta, o falta el código del segundo factor. */
export type LoginResult =
  | { tipo: "ok"; user: CurrentUserInfo; requiereCambio: boolean; recomendar2fa: boolean }
  | { tipo: "2fa"; desafio: string };

const MOTIVO_KEY = "rm_motivo_salida";

/** Mensaje para mostrar en el login (por qué se cerró la sesión). */
export function motivoSalida(consumir = true): string | null {
  if (typeof window === "undefined") return null;
  const m = sessionStorage.getItem(MOTIVO_KEY);
  if (consumir) sessionStorage.removeItem(MOTIVO_KEY);
  return m;
}
function guardarMotivo(m: string | null) {
  if (typeof window !== "undefined" && m) sessionStorage.setItem(MOTIVO_KEY, m);
}

function mensajeDe(body: any, porDefecto: string): string {
  const d = body?.detail;
  if (typeof d === "string") return d;
  if (d && typeof d.message === "string") return d.message;
  return porDefecto;
}

async function resultadoLogin(r: Response): Promise<LoginResult> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(mensajeDe(body, "Error de autenticación"));
  if (body.requiere_2fa) return { tipo: "2fa", desafio: body.desafio };
  setSession(body as TokenPair);
  return { tipo: "ok", user: userFromTokens(body), requiereCambio: !!body.requiere_cambio_contrasena, recomendar2fa: !!body.recomendar_2fa };
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const r = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return resultadoLogin(r);
}

/** Segundo paso: código de la app autenticadora o un código de recuperación. */
export async function login2fa(desafio: string, codigo: string): Promise<LoginResult> {
  const r = await fetch("/api/v1/auth/login/2fa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ desafio, codigo }),
  });
  return resultadoLogin(r);
}

/** Cierra la sesión en el servidor (queda inválida en todos lados) y limpia el navegador. */
export async function logout(motivo?: string): Promise<void> {
  const token = getToken();
  if (token) {
    await fetch("/api/v1/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  }
  clearSession();
  guardarMotivo(motivo ?? null);
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

function redirectToLogin(motivo?: string | null) {
  clearSession();
  guardarMotivo(motivo ?? null);
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

/** Error de la API con el status y el `detail` original (puede ser un objeto, p. ej. en un 409). */
export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/** Descarga un archivo autenticado (blob) y lo guarda con el nombre que manda el backend. */
export async function downloadFile(path: string, fallbackName = "descarga"): Promise<void> {
  const token = getToken();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (res.status === 401) {
    redirectToLogin();
    throw new Error("Sesión expirada");
  }
  if (!res.ok) throw new Error(`No se pudo descargar (error ${res.status})`);
  const cd = res.headers.get("content-disposition") ?? "";
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
    const body = await res.clone().json().catch(() => ({}));
    const code: string | undefined = body?.detail?.code;
    // Sesión cerrada por el servidor (administrador, inactividad, vencimiento u horario): no se renueva.
    if (code && code.startsWith("sesion_")) {
      redirectToLogin(mensajeDe(body, "Tu sesión se cerró."));
      throw new Error(mensajeDe(body, "Sesión cerrada"));
    }
    // Access token vencido → intentar renovar con el refresh token una sola vez.
    if (!retried && (await tryRefresh())) return apiFetch<T>(path, opts, true);
    redirectToLogin("Tu sesión expiró. Ingresá de nuevo.");
    throw new Error("Sesión expirada");
  }
  if (res.status === 403 && typeof window !== "undefined") {
    const body = await res.clone().json().catch(() => ({}));
    if (body?.detail?.code === "cambio_contrasena" && window.location.pathname !== "/cambiar-contrasena") {
      window.location.href = "/cambiar-contrasena";
      throw new Error(mensajeDe(body, "Tenés que cambiar tu contraseña"));
    }
  }
  if (!res.ok) {
    let detail = `Error ${res.status}`;
    let raw: unknown = null;
    try {
      const body = await res.json();
      raw = body.detail ?? body;
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d: any) => d.msg).join(" · ");
      else if (body.detail && typeof body.detail.message === "string") detail = body.detail.message;
      else detail = JSON.stringify(body);
    } catch {}
    throw new ApiError(detail, res.status, raw);
  }
  return res.json() as Promise<T>;
}
