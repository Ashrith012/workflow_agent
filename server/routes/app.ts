/**
 * End-user API. The app never sees workflows: it sends an event key and a
 * payload, the published workflow bound to that key runs, and only the output
 * of its Respond to UI node comes back.
 */
import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { executeWorkflow } from '../../cli/execute.js';
import { isPlainObject, type PlatformServices } from '../../cli/executors.js';
import type { ExportedWorkflow, RunMode } from '../../frontend/src/types.js';
import { requireAuth } from '../auth.js';
import type { Db } from '../db/index.js';
import { RunRecorder } from '../platform.js';

export interface AppRoutesOptions {
  db: Db;
  services: PlatformServices;
  /** live (default) calls real models and connectors; mock is for demos and tests. */
  mode?: RunMode;
  timeoutMs?: number;
}

const HISTORY_TURNS = 6;

/** Short plain-text version of a UI response, used as the assistant turn in chat history. */
export function summarizeUi(ui: unknown): string {
  if (!isPlainObject(ui)) return '';
  const parts: string[] = ui.title ? [String(ui.title)] : [];
  for (const block of Array.isArray(ui.blocks) ? ui.blocks : []) {
    if (!isPlainObject(block)) continue;
    if (block.type === 'markdown') parts.push(String(block.text ?? '').slice(0, 600));
    else if (block.type === 'table') {
      const rows = Array.isArray(block.rows) ? block.rows : [];
      parts.push(`${block.title ?? 'Table'}: ${rows.slice(0, 8).map((r: any) => (r.cells ?? []).join(' | ')).join('; ')}`);
    } else if (block.title) parts.push(String(block.title));
  }
  return parts.join('\n').slice(0, 2000);
}

export const appRoutes: FastifyPluginAsync<AppRoutesOptions> = async (app, { db, services, mode = 'live', timeoutMs = 180_000 }) => {
  app.addHook('preHandler', requireAuth);

  /** Event keys this user may trigger, so the app can show which features are available. */
  app.get('/api/app/events', async (request) => {
    const rows = await db.query<{ event_key: string; allowed_roles: string; trigger_type: string }>(
      'SELECT event_key, allowed_roles, trigger_type FROM published_workflows',
    );
    return rows
      .filter((r) => r.allowed_roles.split(',').includes(request.user.role))
      .map((r) => ({ eventKey: r.event_key, kind: r.trigger_type === 'ChatTrigger' ? 'chat' : 'event' }));
  });

  app.get<{ Params: { sessionId: string } }>('/api/app/chat/:sessionId', async (request) =>
    db.query(
      'SELECT role, content, ui, run_id, created_at FROM chat_messages WHERE session_id = $1 AND user_id = $2 ORDER BY id',
      [request.params.sessionId, request.user.id],
    ),
  );

  app.post<{ Params: { eventKey: string }; Body: { payload?: unknown; sessionId?: unknown } }>(
    '/api/app/events/:eventKey',
    async (request, reply) => {
      const { eventKey } = request.params;
      const user = request.user;
      const [published] = await db.query<{ workflow: ExportedWorkflow; allowed_roles: string; trigger_type: string }>(
        'SELECT workflow, allowed_roles, trigger_type FROM published_workflows WHERE event_key = $1',
        [eventKey],
      );
      if (!published) return reply.code(404).send({ error: 'This feature is not available yet. Ask an administrator to publish it.' });
      if (!published.allowed_roles.split(',').includes(user.role)) return reply.code(403).send({ error: 'You do not have access to this feature.' });

      const workflow = published.workflow;
      const body = request.body ?? {};
      const payload = isPlainObject(body.payload) ? { ...body.payload } : {};
      const isChat = published.trigger_type === 'ChatTrigger';
      let sessionId: string | undefined;
      let label = String(payload.domain ?? payload.label ?? workflow.name);

      if (isChat) {
        if (typeof payload.message !== 'string' || !payload.message.trim()) return reply.code(400).send({ error: 'Type a message first.' });
        sessionId = typeof body.sessionId === 'string' && /^[\w-]{1,64}$/.test(body.sessionId) ? body.sessionId : `chat_${nanoid(12)}`;
        const turns = await db.query<{ role: string; content: string }>(
          `SELECT role, content FROM (
             SELECT id, role, content FROM chat_messages WHERE session_id = $1 AND user_id = $2 ORDER BY id DESC LIMIT $3
           ) t ORDER BY id`,
          [sessionId, user.id, HISTORY_TURNS],
        );
        payload.sessionId = sessionId;
        payload.history = turns;
        label = payload.message.trim();
      }
      // Identity always comes from the session, never from the client payload.
      payload.user = { id: user.id, email: user.email, role: user.role };

      const recorder = await RunRecorder.start(db, { eventKey, workflow, label, userId: user.id });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('Execution timed out')), timeoutMs);
      const log = request.log.child({ runId: recorder.id, eventKey });
      let result;
      try {
        result = await executeWorkflow(workflow, {
          mode,
          mockPayload: payload,
          signal: controller.signal,
          warn: (message) => log.warn(message),
          onNodeComplete: recorder.node,
          user,
          services,
        });
      } finally {
        clearTimeout(timer);
      }

      const responder = [...result.nodes].reverse().find((n) => n.type === 'RespondToUI' && n.status === 'completed');
      if (result.status === 'failed' || !responder) {
        const error = result.error ?? 'The workflow finished without reaching its Respond to UI node.';
        await recorder.finish('failed', error);
        log.warn({ error }, 'app event failed');
        // Node details are for administrators; end users get a reference they can report.
        return reply.code(502).send({
          error: user.role === 'admin' ? error : 'The request could not be completed. Please try again or contact your administrator.',
          runId: recorder.id,
        });
      }
      await recorder.finish('completed');

      const ui = responder.output;
      if (isChat && sessionId) {
        await db.query(
          `INSERT INTO chat_messages (session_id, user_id, role, content, ui, run_id)
           VALUES ($1, $2, 'user', $3, NULL, $4), ($1, $2, 'assistant', $5, $6, $4)`,
          [sessionId, user.id, String(payload.message), recorder.id, summarizeUi(ui), JSON.stringify(ui)],
        );
      }
      return { runId: recorder.id, sessionId, ui };
    },
  );
};
