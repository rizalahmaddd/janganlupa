export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public data?: any) {
    super(message);
  }
}

export const isOfflineError = (e: unknown) => e instanceof ApiError && e.status === 0;

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set("content-type", "application/json");
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "Tidak ada koneksi internet", "offline");
  }
  const type = res.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth")) window.dispatchEvent(new CustomEvent("jl:unauthorized"));
    throw new ApiError(res.status, data?.error || `Gagal (${res.status})`, data?.code, data);
  }
  return data as T;
}
