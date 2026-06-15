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

type AnyRow = Record<string, any>;

function authHeaders(): Record<string, string> {
  return {
    ...(ANON_KEY ? { apikey: ANON_KEY } : {}),
  };
}

async function restGet<T = AnyRow[]>(path: string): Promise<T> {
  const response = await fetch(`${REST_URL}${path}`, { headers: authHeaders() });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      const data = JSON.parse(text);
      message = data.message || data.details || data.hint || text;
    } catch {
      // Keep upstream text as the error message.
    }
    throw new Error(message || `Supabase request failed (${response.status})`);
  }
  return (text ? JSON.parse(text) : []) as T;
}

function syntheticEmail(login: string): string {
  const local = login.replace(/[^A-Za-z0-9._+-]+/g, "").replace(/^\.+|\.+$/g, "").toLowerCase();
  return `${local || login}@psa.local`;
}

function isTerminated(status: unknown): boolean {
  return ["terminated", "inactive", "resigned", "离职", "已离职"].includes(
    String(status || "").trim().toLowerCase(),
  );
}

async function assertEmployeeLoginEnabled(authUserId: string): Promise<void> {
  const employees = await restGet<AnyRow[]>(
    `/employees?select=id,is_active&auth_user_id=eq.${encodeURIComponent(authUserId)}&limit=1`,
  );
  const employee = employees[0];
  if (!employee) throw new Error("账户未关联员工，请联系管理员");
  if (employee.is_active === false) throw new Error("账户已停用，请联系管理员");

  const profiles = await restGet<AnyRow[]>(
    `/employee_profiles?select=employment_status&employee_id=eq.${encodeURIComponent(employee.id)}&limit=1`,
  ).catch(() => []);
  if (isTerminated(profiles[0]?.employment_status)) {
    throw new Error("离职人员账户已关闭，请联系管理员");
  }
}

async function resolveLoginEmail(login: string): Promise<string> {
  const value = login.trim();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return value.toLowerCase();

  for (const field of ["login_name", "display_name"]) {
    const rows = await restGet<AnyRow[]>(
      `/profiles?select=auth_email,auth_user_id,is_active&${field}=eq.${encodeURIComponent(value)}&limit=1`,
    );
    const profile = rows[0];
    if (profile?.auth_email) {
      if (profile.is_active === false) throw new Error("账户已停用，请联系管理员");
      if (profile.auth_user_id) await assertEmployeeLoginEnabled(profile.auth_user_id);
      return profile.auth_email;
    }
  }

  const employees = await restGet<AnyRow[]>(
    `/employees?select=id,is_active,auth_user_id&or=(name.eq.${encodeURIComponent(value)},employee_no.eq.${encodeURIComponent(value)})&limit=1`,
  );
  const employee = employees[0];
  if (employee?.auth_user_id) {
    if (employee.is_active === false) throw new Error("账户已停用，请联系管理员");
    await assertEmployeeLoginEnabled(employee.auth_user_id);
    const profiles = await restGet<AnyRow[]>(
      `/profiles?select=auth_email,is_active&auth_user_id=eq.${encodeURIComponent(employee.auth_user_id)}&limit=1`,
    );
    if (profiles[0]?.is_active === false) throw new Error("账户已停用，请联系管理员");
    if (profiles[0]?.auth_email) return profiles[0].auth_email;
  }

  return syntheticEmail(value);
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
