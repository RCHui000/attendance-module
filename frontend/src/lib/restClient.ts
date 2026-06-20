import { clearStoredToken, getStoredToken } from "./supabase";

const AUTH_URL =
  import.meta.env.VITE_SUPABASE_AUTH_URL ||
  import.meta.env.VITE_SUPABASE_URL ||
  "/auth";

export const REST_URL =
  import.meta.env.VITE_SUPABASE_REST_URL ||
  (AUTH_URL.startsWith("http")
    ? AUTH_URL.replace(":8777", ":8779").replace(/\/auth\/v1\/?$/, "/rest/v1")
    : "/rest");

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

// PostgREST embeds related rows dynamically, so this compatibility layer keeps row shapes open.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRow = Record<string, any>;

export function authHeaders(json = true): Record<string, string> {
  const token = getStoredToken();
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(ANON_KEY ? { apikey: ANON_KEY } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${REST_URL}${path}`, {
    ...init,
    headers: {
      ...authHeaders(init.body != null),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await response.text();
  let data: AnyRow | null = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const message = data?.message || data?.hint || data?.details || (text && text !== "{}" ? text : "");
    if (
      response.status === 401 ||
      /JWSInvalidSignature|JWSError|invalid signature|invalid jwt|JWT/i.test(message)
    ) {
      clearStoredToken();
    }
    throw new Error(message || `Supabase request failed (${response.status})`);
  }
  return data as T;
}

export function payload(options: RequestInit): AnyRow {
  if (!options.body) return {};
  return typeof options.body === "string" ? JSON.parse(options.body) : options.body as AnyRow;
}

export function decodeJwt(): AnyRow | null {
  const token = getStoredToken();
  if (!token) return null;
  try {
    const [, body] = token.split(".");
    const json = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

export function accessRank(access: string | undefined): number {
  if (access === "write") return 2;
  if (access === "read") return 1;
  return 0;
}
