/**
 * End-user API. The app never sees workflows: it sends an event key and a
 * payload, the published workflow bound to that key runs, and only the output
 * of its Respond to UI node comes back.
 */
import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { executeWorkflow } from '../../cli/execute.js';
import { isPlainObject, type PlatformServices } from '../../cli/executors.js';
import type { UiResponse } from '../../frontend/src/manzil/types.js';
import type { ExportedWorkflow, RunMode } from '../../frontend/src/types.js';
import { requireAuth } from '../auth.js';
import { connectorProblem, connectorsUsedBy } from '../consent.js';
import type { Db } from '../db/index.js';
import { applyGuardrails } from '../guardrails.js';
import { audit, RunRecorder, triggerOf } from '../platform.js';

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

const roleAllowed = (allowedRoles: string, role: string) => allowedRoles.split(',').map((r) => r.trim()).includes(role);

export const appRoutes: FastifyPluginAsync<AppRoutesOptions> = async (app, { db, services, mode = 'live', timeoutMs = 180_000 }) => {
  app.addHook('preHandler', requireAuth);
  // FDEs work in the builder and the FDE console; the end-user app is not theirs.
  app.addHook('preHandler', async (request, reply) => {
    if (!reply.sent && request.user.role === 'fde') {
      return reply.code(403).send({ error: 'FDEs do not have access to the end-user app.' });
    }
  });

  /**
   * Event keys this user may trigger, with the live version and the page each workflow
   * asks for in the app. The app builds its navigation from this, so adding an agent is
   * a publish, not a front-end change.
   */
  app.get('/api/app/events', async (request) => {
    const rows = await db.query<{
      event_key: string;
      name: string;
      version: number;
      allowed_roles: string;
      trigger_type: string;
      workflow: ExportedWorkflow;
    }>('SELECT event_key, name, version, allowed_roles, trigger_type, workflow FROM published_workflows');
    return rows
      .filter((r) => roleAllowed(r.allowed_roles, request.user.role))
      .map((r) => {
        const params = triggerOf(r.workflow)?.parameters ?? {};
        // null, not a default: a page that states no order keeps whatever order the app gives it.
        const declared = Number(params.appOrder);
        const order = (params.appOrder ?? '').trim() && Number.isFinite(declared) ? declared : null;
        return {
          eventKey: r.event_key,
          name: r.name,
          version: r.version,
          kind: r.trigger_type === 'ChatTrigger' ? 'chat' : 'event',
          section: (params.appSection ?? '').trim(),
          group: (params.appGroup ?? '').trim(),
          icon: (params.appIcon ?? '').trim(),
          order,
        };
      });
  });

  /**
   * My data access: what the assistants can read for this user and why.
   * usedBy lists the published workflows that touch each connector.
   */
  app.get('/api/app/data-access', async (request) => {
    const [connectors, consents, published] = await Promise.all([
      db.query<{ id: string }>('SELECT id, name, kind, auth, scope, purpose, enabled FROM connectors ORDER BY kind, name'),
      db.query<{ connector_id: string; allowed: boolean; updated_at: string }>(
        'SELECT connector_id, allowed, updated_at FROM user_consents WHERE user_id = $1',
        [request.user.id],
      ),
      db.query<{ name: string; workflow: ExportedWorkflow }>('SELECT name, workflow FROM published_workflows'),
    ]);
    const usedBy = new Map<string, string[]>();
    for (const p of published) {
      for (const id of connectorsUsedBy(p.workflow)) usedBy.set(id, [...(usedBy.get(id) ?? []), p.name]);
    }
    const byId = new Map(consents.map((c) => [c.connector_id, c]));
    return connectors.map((c) => ({
      ...c,
      allowed: byId.get(c.id)?.allowed ?? true,
      decided_at: byId.get(c.id)?.updated_at ?? null,
      used_by: usedBy.get(c.id) ?? [],
    }));
  });

  /** Turn a user-consent connector on or off for yourself. Takes effect on the next run. */
  app.post<{ Params: { id: string }; Body: { allowed?: unknown } }>('/api/app/data-access/:id', async (request, reply) => {
    const allowed = request.body?.allowed;
    if (typeof allowed !== 'boolean') return reply.code(400).send({ error: '"allowed" must be true or false.' });
    const [connector] = await db.query<{ name: string; auth: string }>('SELECT name, auth FROM connectors WHERE id = $1', [request.params.id]);
    if (!connector) return reply.code(404).send({ error: 'No such data source.' });
    if (connector.auth !== 'user_consent') {
      return reply.code(400).send({ error: `${connector.name} is company-managed. Ask your administrator to change it.` });
    }
    await db.query(
      `INSERT INTO user_consents (user_id, connector_id, allowed) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, connector_id) DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now()`,
      [request.user.id, request.params.id, allowed],
    );
    await audit(db, request.user, 'consent.changed', connector.name, allowed ? 'allowed by the user' : 'turned off by the user');
    return { ok: true, allowed };
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
      const [published] = await db.query<{ workflow: ExportedWorkflow; allowed_roles: string; trigger_type: string; version: number }>(
        'SELECT workflow, allowed_roles, trigger_type, version FROM published_workflows WHERE event_key = $1',
        [eventKey],
      );
      if (!published) return reply.code(404).send({ error: 'This feature is not available yet. Ask an administrator to publish it.' });
      if (!roleAllowed(published.allowed_roles, user.role)) return reply.code(403).send({ error: 'You do not have access to this feature.' });

      // Admin-disabled connectors and the user's own "My data access" switches apply to every run, straight away.
      const blockedBy = await connectorProblem(db, user.id, published.workflow);
      if (blockedBy) return reply.code(403).send({ error: blockedBy });

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
        await audit(db, user, 'agent.run', eventKey, `"${label.slice(0, 120)}" failed`);
        log.warn({ error }, 'app event failed');
        // Node details are for builders; end users get a reference they can report.
        return reply.code(502).send({
          error: user.role !== 'user' ? error : 'The request could not be completed. Please try again or contact your administrator.',
          runId: recorder.id,
        });
      }
      await recorder.finish('completed');

      // Live guardrail policies (set by the tenant admin) run on every response:
      // PII/Aadhaar/PAN is masked, blocked, warned about or logged per policy,
      // and the outcome is recorded for the user's AI Activity page.
      const guard = await applyGuardrails(db, { ui: responder.output as UiResponse, runId: recorder.id, eventKey, user });
      await audit(db, user, 'agent.run', eventKey, [`"${label.slice(0, 120)}" completed`, ...guard.notes].join(' · '));
      if (guard.notes.length > 0) log.info({ guardrails: guard.notes }, 'guardrail policy applied');

      const ui = guard.ui;
      if (isChat && sessionId) {
        await db.query(
          `INSERT INTO chat_messages (session_id, user_id, role, content, ui, run_id)
           VALUES ($1, $2, 'user', $3, NULL, $4), ($1, $2, 'assistant', $5, $6, $4)`,
          [sessionId, user.id, String(payload.message), recorder.id, summarizeUi(ui), JSON.stringify(ui)],
        );
      }
      return { runId: recorder.id, sessionId, ui, version: published.version };
    },
  );
};
