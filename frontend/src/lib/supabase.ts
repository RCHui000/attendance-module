/** Supabase token storage utilities. Network access lives in api.ts. */

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
