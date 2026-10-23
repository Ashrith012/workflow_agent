import type { ExportedWorkflow, RunMode, RunResponse } from '../types';

/** Longer than the server's 120s cap, so the server's "Execution timed out" wins the race. */
const CLIENT_TIMEOUT_MS = 125_000;

const UNREACHABLE =
  'Could not reach the API server. Start it with "npm run dev:server" (or "npm run dev:all" for web + API) and try again.';

/** A run request that never produced a run result. `details` carries the server's validation errors, if any. */
export class RunRequestError extends Error {
  status?: number;
  details?: unknown;

  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'RunRequestError';
    this.status = status;
    this.details = details;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object';

export async function runWorkflow(
  workflow: ExportedWorkflow,
  options: { mode?: RunMode } = {},
): Promise<RunResponse> {
  let response: Response;
  try {
    response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow, options: { mode: options.mode ?? 'mock' } }),
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new RunRequestError(`The server did not respond within ${CLIENT_TIMEOUT_MS / 1000}s.`);
    }
    throw new RunRequestError(UNREACHABLE);
  }

  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    if (isRecord(body) && typeof body.error === 'string') {
      throw new RunRequestError(body.error, response.status, body.details);
    }
    // No JSON error body: the Vite dev proxy answers 502 like this when nothing listens on :3001.
    // No status attached — the server never saw the request, so it did not "reject" it.
    if (response.status >= 500) throw new RunRequestError(UNREACHABLE);
    throw new RunRequestError(`Server responded ${response.status} ${response.statusText}.`, response.status);
  }

  if (!isRecord(body) || typeof body.runId !== 'string' || !Array.isArray(body.nodes)) {
    throw new RunRequestError('The server returned an unexpected response.', response.status);
  }
  return body as unknown as RunResponse;
}
