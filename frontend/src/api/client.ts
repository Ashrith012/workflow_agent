/** JSON calls to the API server. The session cookie is sent automatically (same origin via the Vite proxy). */

export class ApiError extends Error {
  status: number;
  details?: unknown;
  runId?: string;

  constructor(message: string, status: number, details?: unknown, runId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.runId = runId;
  }
}

/** Longer than the server's 180s app-event cap, so the server's own timeout message wins. */
const TIMEOUT_MS = 185_000;

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError('Could not reach the server. Check that it is running and try again.', 0);
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const b = (body ?? {}) as { error?: string; details?: unknown; runId?: string };
    throw new ApiError(b.error ?? `Server responded ${response.status}.`, response.status, b.details, b.runId);
  }
  return body as T;
}
