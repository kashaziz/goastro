/** Raised when goastro refuses the request because this tab has no valid session (see server/core/session.ts). */
export const UNAUTHORIZED_EVENT = 'goastro-unauthorized';

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const write = method !== 'GET' && method !== 'HEAD';
  const res = await fetch(url, {
    method,
    // goastro refuses changes that are not sent as JSON (protection against other websites).
    headers: write ? { 'content-type': 'application/json' } : undefined,
    body: write ? JSON.stringify(body ?? {}) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
