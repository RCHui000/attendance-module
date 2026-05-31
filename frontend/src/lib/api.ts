const CLIENT_ID = crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random()}`;

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": CLIENT_ID,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || "Request failed");
  }
  if (!response.ok) {
    const message =
      (data as { message?: string })?.message || text || "Request failed";
    throw new Error(message);
  }
  return data as T;
}

export function getClientId(): string {
  return CLIENT_ID;
}
