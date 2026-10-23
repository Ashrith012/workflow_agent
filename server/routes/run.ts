import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { executeWorkflow } from '../../cli/execute.js';
import type { PlatformServices } from '../../cli/executors.js';
import { findCycle, validateWorkflowShape } from '../../cli/validate.js';
import type { ExportedWorkflow, RunMode, RunResponse } from '../../frontend/src/types.js';

export interface ErrorResponse {
  error: string;
  details?: unknown;
}

export interface RunRoutesOptions {
  /** Hard cap on one execution. Defaults to 10 min (ingesting a SharePoint folder from the builder takes minutes). */
  timeoutMs?: number;
  /** Lets RunHistory / RunStats nodes read real platform data in builder test runs. */
  services?: PlatformServices;
}

const DEFAULT_TIMEOUT_MS = 600_000;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

type ParsedBody =
  | { ok: true; workflow: ExportedWorkflow; mode: RunMode; mockPayload: unknown }
  | { ok: false; error: string; details?: unknown };

/** Validates `{ workflow, options? }` with the same checks the CLI applies to a file. */
function parseBody(body: unknown): ParsedBody {
  if (!isPlainObject(body)) return { ok: false, error: 'Request body must be a JSON object.' };

  const options = body.options ?? {};
  if (!isPlainObject(options)) return { ok: false, error: '"options" must be an object.' };
  const mode = options.mode ?? 'mock';
  if (mode !== 'mock' && mode !== 'live') {
    return { ok: false, error: `"options.mode" must be "mock" or "live" (got ${JSON.stringify(mode)}).` };
  }

  if (body.workflow === undefined) return { ok: false, error: 'Missing "workflow" in request body.' };
  const errors = validateWorkflowShape(body.workflow);
  if (errors.length > 0) return { ok: false, error: 'Invalid workflow.', details: errors };

  const workflow = body.workflow as ExportedWorkflow;
  const cycle = findCycle(workflow);
  if (cycle) {
    return { ok: false, error: cycle.message, details: { cycle: cycle.cycle, blocked: cycle.blocked } };
  }

  return { ok: true, workflow, mode, mockPayload: options.mockPayload };
}

export const runRoutes: FastifyPluginAsync<RunRoutesOptions> = async (app, opts) => {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  app.post<{ Body: unknown; Reply: RunResponse | ErrorResponse }>('/api/run', async (request, reply) => {
    const parsed = parseBody(request.body);
    if (!parsed.ok) {
      const { error, details } = parsed;
      return reply.code(400).send(details === undefined ? { error } : { error, details });
    }

    const runId = `run_${nanoid(10)}`;
    const log = request.log.child({ runId });
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        controller.abort(new Error('Execution timed out'));
        resolve('timeout');
      }, timeoutMs);
    });

    try {
      log.info({ workflow: parsed.workflow.name, nodes: parsed.workflow.nodes.length, mode: parsed.mode }, 'run started');
      const result = await Promise.race([
        executeWorkflow(parsed.workflow, {
          mode: parsed.mode,
          mockPayload: parsed.mockPayload,
          signal: controller.signal,
          warn: (message) => log.warn(message),
          user: request.user,
          services: opts.services,
        }),
        timedOut,
      ]);

      if (result === 'timeout' || controller.signal.aborted) {
        log.warn({ timeoutMs }, 'run timed out');
        return reply.code(500).send({ error: 'Execution timed out' });
      }

      log.info({ status: result.status, durationMs: result.durationMs }, 'run finished');
      return reply.code(200).send({ runId, ...result });
    } finally {
      clearTimeout(timer);
    }
  });
};
