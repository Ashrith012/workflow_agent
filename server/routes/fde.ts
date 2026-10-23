/**
 * FDE (Forward Deployed Engineer) API. FDEs build workflows in the canvas and
 * submit them for the tenant admin's approval; only an approval publishes.
 * Tenant admins may use these routes too (they keep builder access).
 */
import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import type { ExportedWorkflow } from '../../frontend/src/types.js';
import { requireBuilder } from '../auth.js';
import type { Db } from '../db/index.js';
import { audit, triggerOf } from '../platform.js';
import { publishProblems, unauthorizedModels } from './admin.js';

export const fdeRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.addHook('preHandler', requireBuilder);

  /**
   * Models the tenant admin authorizes, grouped for the AI Agent node's picker. The
   * builder reads this instead of the static catalog, so authorizing a model (including
   * the admin's own self-hosted LLM) makes it selectable with no code change.
   */
  app.get('/api/fde/models', async () => {
    const rows = await db.query<{ model_key: string; name: string; provider: string; kind: string; status: string; base_url: string }>(
      `SELECT model_key, name, provider, kind, status, base_url FROM tenant_models
        WHERE status IN ('authorized', 'deprecated') ORDER BY kind, provider, name`,
    );
    return rows;
  });

  /** What is live, so the FDE can open a published version in the builder and iterate. */
  app.get('/api/fde/published', async () =>
    db.query(
      `SELECT p.event_key, p.name, p.trigger_type, p.allowed_roles, p.version, p.published_at, u.email AS published_by
         FROM published_workflows p LEFT JOIN users u ON u.id = p.published_by ORDER BY p.event_key`,
    ),
  );

  app.get<{ Params: { eventKey: string } }>('/api/fde/published/:eventKey', async (request, reply) => {
    const [row] = await db.query('SELECT * FROM published_workflows WHERE event_key = $1', [request.params.eventKey]);
    return row ?? reply.code(404).send({ error: 'Not published.' });
  });

  /** Submit a workflow version for tenant-admin approval. Replaces this event key's earlier pending submission. */
  app.post<{ Body: { workflow?: unknown; note?: unknown } }>('/api/fde/submit', async (request, reply) => {
    const workflow = request.body?.workflow;
    const problems = publishProblems(workflow);
    if (problems.length === 0) problems.push(...(await unauthorizedModels(db, workflow as ExportedWorkflow)));
    if (problems.length > 0) return reply.code(400).send({ error: 'This workflow cannot be submitted.', details: problems });

    const wf = workflow as ExportedWorkflow;
    const eventKey = triggerOf(wf)!.parameters.eventKey;
    const note = typeof request.body?.note === 'string' ? request.body.note.slice(0, 500) : '';
    // One pending version per event key: a resubmission supersedes the one waiting.
    await db.query(`DELETE FROM workflow_approvals WHERE event_key = $1 AND status = 'pending'`, [eventKey]);
    const id = `apr_${nanoid(10)}`;
    await db.query(
      `INSERT INTO workflow_approvals (id, event_key, name, workflow, note, submitted_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, eventKey, wf.name, JSON.stringify(wf), note, request.user.id],
    );
    await audit(db, request.user, 'workflow.submitted', eventKey, `"${wf.name}" sent for tenant-admin approval${note ? `: ${note}` : ''}`);
    return { id, eventKey };
  });

  /** The signed-in builder's own submissions, newest first. */
  app.get('/api/fde/submissions', async (request) =>
    db.query(
      `SELECT a.id, a.event_key, a.name, a.note, a.status, a.submitted_at, a.decided_at, a.decision_note, d.email AS decided_by
         FROM workflow_approvals a LEFT JOIN users d ON d.id = a.decided_by
        WHERE a.submitted_by = $1 ORDER BY a.submitted_at DESC LIMIT 50`,
      [request.user.id],
    ),
  );

  /** A submission's workflow, to reopen it in the builder. */
  app.get<{ Params: { id: string } }>('/api/fde/submissions/:id', async (request, reply) => {
    const [row] = await db.query('SELECT id, event_key, name, workflow, status FROM workflow_approvals WHERE id = $1 AND submitted_by = $2', [
      request.params.id,
      request.user.id,
    ]);
    return row ?? reply.code(404).send({ error: 'No such submission.' });
  });

  // ---- Executions: live runs of a workflow, for the builder's Executions tab ----

  app.get<{ Querystring: { eventKey?: string; limit?: string } }>('/api/fde/executions', async (request) => {
    const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);
    const eventKey = request.query.eventKey?.trim();
    return db.query(
      `SELECT r.id, r.event_key, r.workflow_name, r.label, r.status, r.error, r.duration_ms, r.started_at, u.email AS user_email,
              (SELECT count(*)::int FROM run_nodes n WHERE n.run_id = r.id) AS node_count
         FROM runs r LEFT JOIN users u ON u.id = r.user_id
        WHERE ($1::text IS NULL OR r.event_key = $1)
        ORDER BY r.started_at DESC LIMIT $2`,
      [eventKey || null, limit],
    );
  });

  /** Node-by-node detail of one execution. */
  app.get<{ Params: { id: string } }>('/api/fde/executions/:id', async (request, reply) => {
    const [run] = await db.query('SELECT * FROM runs WHERE id = $1', [request.params.id]);
    if (!run) return reply.code(404).send({ error: 'No such execution.' });
    const nodes = await db.query('SELECT node_id, type, status, duration_ms, error, output FROM run_nodes WHERE run_id = $1 ORDER BY seq', [
      request.params.id,
    ]);
    return { ...run, nodes };
  });

  // ---- Evaluations: sample payloads and what the answer must contain ----

  app.get<{ Querystring: { eventKey?: string } }>('/api/fde/evaluations', async (request) =>
    db.query(
      `SELECT id, event_key, name, payload, expect_contains, last_status, last_detail, last_run_at
         FROM evaluation_cases WHERE ($1::text IS NULL OR event_key = $1) ORDER BY created_at`,
      [request.query.eventKey?.trim() || null],
    ),
  );

  app.post<{ Body: { eventKey?: unknown; name?: unknown; payload?: unknown; expectContains?: unknown } }>(
    '/api/fde/evaluations',
    async (request, reply) => {
      const b = request.body ?? {};
      const eventKey = typeof b.eventKey === 'string' ? b.eventKey.trim() : '';
      const name = typeof b.name === 'string' ? b.name.trim() : '';
      if (!eventKey) return reply.code(400).send({ error: 'Give the workflow a trigger event key before adding evaluation cases.' });
      if (!name) return reply.code(400).send({ error: 'A case name is required.' });
      let payload: unknown = {};
      if (typeof b.payload === 'string' && b.payload.trim()) {
        try {
          payload = JSON.parse(b.payload);
        } catch {
          return reply.code(400).send({ error: 'The sample payload must be valid JSON.' });
        }
      } else if (b.payload && typeof b.payload === 'object') {
        payload = b.payload;
      }
      const id = `eval_${nanoid(10)}`;
      await db.query(
        `INSERT INTO evaluation_cases (id, event_key, name, payload, expect_contains, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, eventKey, name.slice(0, 120), JSON.stringify(payload), String(b.expectContains ?? '').slice(0, 300), request.user.id],
      );
      return { id };
    },
  );

  /** Records the outcome of running a case from the builder. */
  app.post<{ Params: { id: string }; Body: { passed?: unknown; detail?: unknown } }>('/api/fde/evaluations/:id/result', async (request, reply) => {
    const passed = request.body?.passed;
    if (typeof passed !== 'boolean') return reply.code(400).send({ error: '"passed" must be true or false.' });
    const rows = await db.query(
      `UPDATE evaluation_cases SET last_status = $2, last_detail = $3, last_run_at = now() WHERE id = $1 RETURNING id`,
      [request.params.id, passed ? 'passed' : 'failed', String(request.body?.detail ?? '').slice(0, 500)],
    );
    return rows.length > 0 ? { ok: true } : reply.code(404).send({ error: 'No such case.' });
  });

  app.delete<{ Params: { id: string } }>('/api/fde/evaluations/:id', async (request, reply) => {
    const rows = await db.query('DELETE FROM evaluation_cases WHERE id = $1 RETURNING id', [request.params.id]);
    return rows.length > 0 ? { ok: true } : reply.code(404).send({ error: 'No such case.' });
  });
};
