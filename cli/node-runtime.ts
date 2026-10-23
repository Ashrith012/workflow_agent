/* eslint-disable @typescript-eslint/no-explicit-any -- node I/O is untyped JSON */
/**
 * What every node executor shares: the run context, the agent-service client
 * and the item helpers. Kept apart from executors.ts so the executor modules
 * can import it without a circular import.
 */
import { interpolate } from './interpolate.js';

/** The signed-in user a run acts for (set by the API server's event route; absent in the CLI). */
export interface RunUser {
  id: string;
  email: string;
  role: 'admin' | 'fde' | 'user';
}

/** Platform data the RunHistory / RunStats nodes read. Injected by the API server; absent in the CLI. */
export interface PlatformServices {
  runHistory(options: { userId?: string; limit: number }): Promise<Record<string, unknown>[]>;
  runStats(options: { userId?: string; days: number }): Promise<Record<string, unknown>>;
  /** Published workflows the role may trigger, plus live run counts across the platform. */
  platformStatus(options: { role: string }): Promise<Record<string, unknown>>;
  /**
   * Endpoint for a tenant-registered self-hosted model, so the AI Agent node can reach
   * an admin's own LLM without a code change. Null for ordinary catalog models.
   */
  modelEndpoint?(modelKey: string): Promise<{ baseUrl: string; apiKey: string } | null>;
}

/**
 * Per-run settings handed to every executor. A fresh context is created for
 * each run (see cli/execute.ts), so concurrent server requests never share state.
 */
export interface ExecutionContext {
  /** Have the agent service call the real LLM instead of returning a mock answer. */
  live: boolean;
  /** Replaces the WebhookTrigger's default payload when present (from --mock / mockPayload). */
  webhookMock?: { value: unknown };
  /** Where non-fatal warnings go (the CLI prints them to stderr). */
  warn: (message: string) => void;
  /** Aborts in-flight network calls (server timeout). */
  signal?: AbortSignal;
  user?: RunUser;
  services?: PlatformServices;
}

export type Executor = (input: any, params: Record<string, string>, ctx: ExecutionContext) => Promise<any>;

const LLM_TIMEOUT_MS = 60_000;
/** Bulk calls (folder downloads, batch embeddings, upserts) during ingestion. */
export const BULK_TIMEOUT_MS = 10 * 60_000;

/** sfn-agent-core FastAPI service (`npm run dev:agent`) that runs AIAgent and SharePoint nodes. */
const AGENT_SERVICE_URL = (process.env.AGENT_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');

/**
 * Splits the AI Agent `model` param (`<provider>:<model id>`, from the shared
 * catalog in config/models.json) for the agent service. Nodes
 * saved before the catalog have a bare model id and a separate `provider` param.
 */
export function splitModel(params: Record<string, string>): { provider: string; model: string } {
  const value = params.model ?? '';
  const colon = value.indexOf(':');
  if (colon > 0) return { provider: value.slice(0, colon), model: value.slice(colon + 1) };
  return { provider: params.provider || 'selfhosted', model: value };
}

export class AgentServiceUnreachable extends Error {}

/**
 * POSTs to the agent service. Throws AgentServiceUnreachable on a connection
 * failure (callers decide whether to fall back) and a plain Error when the
 * service answers with an error, a timeout hits or the run is aborted.
 */
export async function postToAgentService(
  path: string,
  body: unknown,
  ctx: ExecutionContext,
  timeoutMs: number = LLM_TIMEOUT_MS,
): Promise<any> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${AGENT_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout,
    });
  } catch (err) {
    // A timeout or run abort is a real failure, not an unreachable service.
    if (ctx.signal?.aborted || timeout.aborted) throw err;
    throw new AgentServiceUnreachable(`Python agent service at ${AGENT_SERVICE_URL} is unreachable (${(err as Error).message})`);
  }

  // The service answered but the agent/tool failed: surface that instead of masking it with mock output.
  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try {
      detail = JSON.parse(text).detail ?? text; // FastAPI's HTTPException shape
    } catch {
      // not JSON; keep the raw body
    }
    throw new Error(`Python agent service ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  return response.json();
}

/** GET /health on the agent service; never throws. */
export async function pingAgentService(ctx: ExecutionContext): Promise<{ ok: boolean; ms: number; error?: string }> {
  const started = Date.now();
  const timeout = AbortSignal.timeout(3_000);
  try {
    const response = await fetch(`${AGENT_SERVICE_URL}/health`, { signal: ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout });
    return { ok: response.ok, ms: Date.now() - started, error: response.ok ? undefined : `HTTP ${response.status}` };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: (err as Error).message };
  }
}

export const isPlainObject = (v: unknown): v is Record<string, any> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Most data nodes add their result to the incoming item under `field`, so values
 * from earlier nodes (the user's question, project id, ...) stay available
 * further down a linear chain. A blank field replaces the item with the result.
 */
export function mergeOutput(input: unknown, field: string, value: unknown): any {
  const key = field.trim();
  if (!key) return value;
  const base = isPlainObject(input) ? input : input === null || input === undefined ? {} : { input };
  return { ...base, [key]: value };
}

/** `runIf` gate: blank runs the node; '', false, 0, no, null and undefined (after interpolation) skip it. */
export function shouldRun(template: string | undefined, input: unknown, ctx: ExecutionContext): boolean {
  if (!template?.trim()) return true;
  const value = interpolate(template, input, ctx.warn).trim().toLowerCase();
  return !['', 'false', '0', 'no', 'null', 'undefined'].includes(value);
}
