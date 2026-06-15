import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  (typeof window !== "undefined" ? window.location.origin : "");

const REST_URL =
  import.meta.env.VITE_SUPABASE_REST_URL ||
  "/rest";

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

type LoginResolution = {
  auth_email?: string;
  auth_user_id?: string;
  is_active?: boolean;
  employment_status?: string;
};

function anonHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(ANON_KEY ? { apikey: ANON_KEY } : {}),
  };
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${REST_URL}/rpc/${name}`, {
    method: "POST",
    headers: anonHeaders(),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      const data = JSON.parse(text);
      message = data.message || data.details || data.hint || text;
    } catch {
      // Keep upstream text as the error message.
    }
    throw new Error(message || `Supabase RPC failed (${response.status})`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

function syntheticEmail(login: string): string {
  const local = login.replace(/[^A-Za-z0-9._+-]+/g, "").replace(/^\.+|\.+$/g, "").toLowerCase();
  return `${local || login}@psa.local`;
}

function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function isTerminated(status: unknown): boolean {
  return ["terminated", "inactive", "resigned", "离职", "已离职"].includes(
    String(status || "").trim().toLowerCase(),
  );
}

async function resolveLoginEmail(login: string): Promise<string> {
  const value = login.trim();
  if (!value) throw new Error("请输入登录名");

  const rows = await rpc<LoginResolution[]>("psa_resolve_login_email", { p_login: value }).catch(() => []);
  const resolved = rows[0];
  if (resolved?.auth_email) {
    if (resolved.is_active === false) throw new Error("账户已停用，请联系管理员");
    if (isTerminated(resolved.employment_status)) throw new Error("离职人员账户已关闭，请联系管理员");
    return resolved.auth_email;
  }

  if (isEmail(value)) return value.toLowerCase();
  if (/^[A-Za-z0-9._+-]+$/.test(value)) return syntheticEmail(value);
  throw new Error("未找到该登录账号，请使用工号、登录名或邮箱登录");
}

export async function signInWithLogin(login: string, password: string): Promise<string> {
  clearStoredToken();
  const email = await resolveLoginEmail(login);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message || "Invalid login credentials");
  const token = data.session?.access_token;
  if (!token) throw new Error("Login succeeded without an access token");
  setStoredToken(token);
  return token;
}

export async function signOutFromSupabase(): Promise<void> {
  await supabase.auth.signOut().catch(() => undefined);
}

/** Get the current session from cookie or local storage */
export function getStoredToken(): string | null {
  return localStorage.getItem("psa_access_token");
}

export function setStoredToken(token: string): void {
  localStorage.setItem("psa_access_token", token);
}

export function clearStoredToken(): void {
  localStorage.removeItem("psa_access_token");
}

/** Build Authorization header */
export function authHeader(): Record<string, string> {
  const token = getStoredToken();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}
