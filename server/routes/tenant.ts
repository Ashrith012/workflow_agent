/**
 * Tenant Admin API: overview KPIs, workflow approvals, the model catalog,
 * connectors and MCP servers, guardrail policies and alerts, and the audit
 * log. Every route requires the admin role. Everything here is data-driven:
 * a dropdown change persists a row and takes effect on the next run.
 */
import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import type { ExportedWorkflow } from '../../frontend/src/types.js';
import { requireAdmin } from '../auth.js';
import type { Db } from '../db/index.js';
import { GUARDRAIL_ACTIONS, type GuardrailAction } from '../guardrails.js';
import { audit } from '../platform.js';
import { publishProblems, publishWorkflow, unauthorizedModels } from './admin.js';

const MODEL_STATUSES = new Set(['authorized', 'requested', 'deprecated', 'disabled']);

/**
 * Validates an own-LLM endpoint URL. Self-hosted models legitimately live on internal
 * networks, so private addresses are allowed; only tenant admins can register one.
 */
function endpointProblem(baseUrl: string): string | null {
  if (!baseUrl) return 'An endpoint URL is required for a self-hosted model.';
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return 'The endpoint must be a full URL, e.g. https://llm.internal.example.com/v1.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'The endpoint must use http or https.';
  return null;
}

/** How many published workflows use each model (AI Agent nodes' model parameter). */
async function modelUsage(db: Db): Promise<Map<string, number>> {
  const rows = await db.query<{ workflow: ExportedWorkflow }>('SELECT workflow FROM published_workflows');
  const usage = new Map<string, number>();
  for (const { workflow } of rows) {
    const models = new Set(workflow.nodes.filter((n) => n.type === 'AIAgent').map((n) => n.parameters.model).filter(Boolean));
    for (const m of models) usage.set(m, (usage.get(m) ?? 0) + 1);
  }
  return usage;
}

export const tenantRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.addHook('preHandler', requireAdmin);

  // ---- Overview ----

  app.get('/api/admin/overview', async () => {
    const [counts] = await db.query<Record<string, number>>(
      `SELECT (SELECT count(*)::int FROM published_workflows) AS published,
              (SELECT count(*)::int FROM workflow_approvals WHERE status = 'pending') AS "pendingApprovals",
              (SELECT count(*)::int FROM guardrail_events WHERE status = 'open') AS "openAlerts",
              (SELECT count(*)::int FROM users) AS users,
              (SELECT count(*)::int FROM runs WHERE started_at > now() - interval '30 days') AS "runs30d",
              (SELECT count(*)::int FROM runs WHERE status = 'failed' AND started_at > now() - interval '30 days') AS "failed30d"`,
    );
    const byWorkflow = await db.query(
      `SELECT workflow_name AS name, count(*)::int AS total, count(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM runs WHERE started_at > now() - interval '30 days' GROUP BY 1 ORDER BY total DESC LIMIT 8`,
    );
    const alerts = await db.query(
      `SELECT id, severity, title, detail, created_at FROM guardrail_events WHERE status = 'open' ORDER BY created_at DESC LIMIT 6`,
    );
    const approvals = await db.query(
      `SELECT a.id, a.event_key, a.name, a.submitted_at, u.email AS submitted_by
         FROM workflow_approvals a LEFT JOIN users u ON u.id = a.submitted_by
        WHERE a.status = 'pending' ORDER BY a.submitted_at LIMIT 5`,
    );
    const usage = await modelUsage(db);
    const models = (await db.query<{ model_key: string; name: string; provider: string; version: string; status: string }>(
      `SELECT model_key, name, provider, version, status FROM tenant_models ORDER BY name`,
    ))
      .map((m) => ({ ...m, used_by: usage.get(m.model_key) ?? 0 }))
      .filter((m) => m.used_by > 0);
    return { counts, byWorkflow, alerts, approvals, models };
  });

  // ---- Approvals: workflow versions waiting for the business unit owner ----

  app.get('/api/admin/approvals', async () =>
    db.query(
      `SELECT a.id, a.event_key, a.name, a.note, a.status, a.submitted_at, a.decided_at, a.decision_note,
              s.email AS submitted_by, d.email AS decided_by,
              jsonb_array_length(a.workflow->'nodes') AS node_count
         FROM workflow_approvals a
         LEFT JOIN users s ON s.id = a.submitted_by
         LEFT JOIN users d ON d.id = a.decided_by
        ORDER BY (a.status = 'pending') DESC, coalesce(a.decided_at, a.submitted_at) DESC
        LIMIT 100`,
    ),
  );

  app.post<{ Params: { id: string }; Body: { note?: unknown } }>('/api/admin/approvals/:id/approve', async (request, reply) => {
    const [row] = await db.query<{ workflow: ExportedWorkflow; name: string; event_key: string }>(
      `SELECT workflow, name, event_key FROM workflow_approvals WHERE id = $1 AND status = 'pending'`,
      [request.params.id],
    );
    if (!row) return reply.code(404).send({ error: 'No pending approval with this id.' });

    // Re-validate against today's rules: the model catalog may have changed since submission.
    const problems = [...publishProblems(row.workflow), ...(await unauthorizedModels(db, row.workflow))];
    if (problems.length > 0) return reply.code(400).send({ error: 'This version can no longer be published.', details: problems });

    const published = await publishWorkflow(db, row.workflow, request.user.id);
    const note = typeof request.body?.note === 'string' ? request.body.note.slice(0, 500) : '';
    await db.query(
      `UPDATE workflow_approvals SET status = 'approved', decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $1`,
      [request.params.id, request.user.id, note],
    );
    await audit(db, request.user, 'workflow.approved', row.event_key, `"${row.name}" approved${note ? `: ${note}` : ''}`);
    await audit(db, request.user, 'workflow.published', published.event_key, `"${row.name}" version ${published.version}, via approval`);
    return { ok: true, eventKey: published.event_key, version: published.version };
  });

  app.post<{ Params: { id: string }; Body: { note?: unknown } }>('/api/admin/approvals/:id/reject', async (request, reply) => {
    const note = typeof request.body?.note === 'string' ? request.body.note.slice(0, 500) : '';
    const [row] = await db.query<{ event_key: string; name: string }>(
      `UPDATE workflow_approvals SET status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3
        WHERE id = $1 AND status = 'pending' RETURNING event_key, name`,
      [request.params.id, request.user.id, note],
    );
    if (!row) return reply.code(404).send({ error: 'No pending approval with this id.' });
    await audit(db, request.user, 'workflow.rejected', row.event_key, `"${row.name}" rejected${note ? `: ${note}` : ''}`);
    return { ok: true };
  });

  // ---- Models ----

  app.get('/api/admin/models', async () => {
    const usage = await modelUsage(db);
    const rows = await db.query<{ model_key: string }>('SELECT * FROM tenant_models ORDER BY name');
    return rows.map((m) => ({ ...m, used_by: usage.get(m.model_key) ?? 0 }));
  });

  app.post<{ Body: Record<string, unknown> }>('/api/admin/models', async (request, reply) => {
    const b = request.body ?? {};
    const modelKey = typeof b.model_key === 'string' ? b.model_key.trim() : '';
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!/^[\w.-]+:[\w/.:-]+$/.test(modelKey)) {
      return reply.code(400).send({ error: 'Model key must be "provider:model-id", e.g. "openai:gpt-4o-mini" or "mylab:qwen2.5:7b".' });
    }
    if (!name) return reply.code(400).send({ error: 'A model name is required.' });
    const selfHosted = b.kind === 'selfhosted';
    const baseUrl = typeof b.base_url === 'string' ? b.base_url.trim() : '';
    if (selfHosted) {
      const problem = endpointProblem(baseUrl);
      if (problem) return reply.code(400).send({ error: problem });
    }
    const [existing] = await db.query('SELECT 1 FROM tenant_models WHERE model_key = $1', [modelKey]);
    if (existing) return reply.code(409).send({ error: 'This model key already exists.' });
    const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : fallback);
    const [row] = await db.query(
      `INSERT INTO tenant_models (model_key, name, provider, version, data_class, region, status, kind, base_url, api_key_env)
       VALUES ($1, $2, $3, $4, $5, $6, 'authorized', $7, $8, $9) RETURNING *`,
      [
        modelKey,
        name.slice(0, 100),
        str(b.provider, modelKey.split(':')[0]),
        str(b.version, 'latest'),
        str(b.data_class, 'Internal'),
        str(b.region, 'India'),
        selfHosted ? 'selfhosted' : 'hosted',
        selfHosted ? baseUrl : '',
        selfHosted ? str(b.api_key_env, '') : '',
      ],
    );
    await audit(db, request.user, 'model.added', modelKey, `"${name}" authorized${selfHosted ? ` (self-hosted at ${baseUrl})` : ''}`);
    return row;
  });

  /**
   * Test connection for an own-LLM endpoint: lists the models the endpoint serves, so the
   * admin can confirm the URL and model id before authorizing it. No secret is stored.
   */
  app.post<{ Body: { base_url?: unknown; api_key_env?: unknown; model_id?: unknown } }>('/api/admin/models/test', async (request, reply) => {
    const baseUrl = typeof request.body?.base_url === 'string' ? request.body.base_url.trim() : '';
    const problem = endpointProblem(baseUrl);
    if (problem) return reply.code(400).send({ error: problem });
    const envName = typeof request.body?.api_key_env === 'string' ? request.body.api_key_env.trim() : '';
    const key = (envName && process.env[envName]) || '';
    if (envName && !key) {
      return reply.code(400).send({ error: `${envName} is not set on the server; add it to .env and restart, or leave the key blank.` });
    }
    const started = Date.now();
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
        headers: key ? { Authorization: `Bearer ${key}` } : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return reply.code(502).send({ error: `The endpoint answered ${res.status}. Check the URL ends at the OpenAI-compatible base (often /v1).` });
      const body = (await res.json()) as { data?: { id?: string }[] };
      const models = (body.data ?? []).map((m) => String(m.id)).filter(Boolean);
      const wanted = typeof request.body?.model_id === 'string' ? request.body.model_id.trim() : '';
      return {
        ok: true,
        ms: Date.now() - started,
        models,
        message:
          wanted && models.length > 0 && !models.includes(wanted)
            ? `Connected in ${Date.now() - started} ms, but "${wanted}" is not served here. Available: ${models.join(', ')}.`
            : `Connected in ${Date.now() - started} ms. ${models.length} model(s) available.`,
      };
    } catch (err) {
      return reply.code(502).send({ error: `Could not reach the endpoint: ${(err as Error).message}` });
    }
  });

  app.patch<{ Params: { key: string }; Body: { status?: unknown } }>('/api/admin/models/:key', async (request, reply) => {
    const status = request.body?.status;
    if (typeof status !== 'string' || !MODEL_STATUSES.has(status)) {
      return reply.code(400).send({ error: `Status must be one of: ${[...MODEL_STATUSES].join(', ')}.` });
    }
    const [row] = await db.query<{ model_key: string; name: string; status: string }>(
      'UPDATE tenant_models SET status = $2, updated_at = now() WHERE model_key = $1 RETURNING model_key, name, status',
      [request.params.key, status],
    );
    if (!row) return reply.code(404).send({ error: 'No such model.' });
    await audit(db, request.user, 'model.status_changed', row.model_key, `"${row.name}" is now ${status}`);
    return row;
  });

  // ---- Connectors and MCP ----

  app.get('/api/admin/connectors', async () => db.query('SELECT * FROM connectors ORDER BY kind, name'));

  app.post<{ Body: Record<string, unknown> }>('/api/admin/connectors', async (request, reply) => {
    const b = request.body ?? {};
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 100) : '';
    if (!name) return reply.code(400).send({ error: 'A connector name is required.' });
    const kind = b.kind === 'mcp' ? 'mcp' : 'connector';
    const auth = b.auth === 'user_consent' ? 'user_consent' : 'service_account';
    const str = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 200) : '');
    const [row] = await db.query(
      `INSERT INTO connectors (id, name, kind, auth, scope, purpose, business_units, enabled, health)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, 'Awaiting review') RETURNING *`,
      [`con_${nanoid(8)}`, name, kind, auth, str(b.scope), str(b.purpose), str(b.business_units)],
    );
    await audit(db, request.user, 'connector.added', name, `${kind === 'mcp' ? 'MCP server' : 'Connector'}, access: ${auth === 'user_consent' ? 'user consent' : 'service account'}`);
    return row;
  });

  app.patch<{ Params: { id: string }; Body: { enabled?: unknown; auth?: unknown } }>('/api/admin/connectors/:id', async (request, reply) => {
    const b = request.body ?? {};
    const [current] = await db.query<{ name: string; enabled: boolean; auth: string }>('SELECT name, enabled, auth FROM connectors WHERE id = $1', [
      request.params.id,
    ]);
    if (!current) return reply.code(404).send({ error: 'No such connector.' });

    const enabled = typeof b.enabled === 'boolean' ? b.enabled : current.enabled;
    const auth = b.auth === 'user_consent' || b.auth === 'service_account' ? b.auth : current.auth;
    const [row] = await db.query(
      `UPDATE connectors SET enabled = $2, auth = $3, health = CASE WHEN $2 THEN 'Healthy' ELSE health END, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [request.params.id, enabled, auth],
    );
    if (enabled !== current.enabled) await audit(db, request.user, 'connector.toggled', current.name, enabled ? 'enabled' : 'disabled');
    if (auth !== current.auth) {
      await audit(db, request.user, 'connector.consent_changed', current.name, `access is now ${auth === 'user_consent' ? 'user consent' : 'service account'}`);
    }
    return row;
  });

  // ---- Guardrails ----

  app.get('/api/admin/guardrails', async () => {
    const policies = await db.query('SELECT check_key, label, action, updated_at, updated_by FROM guardrail_policies ORDER BY check_key');
    const alerts = await db.query(
      `SELECT id, run_id, event_key, check_key, action, severity, title, detail, status, created_at
         FROM guardrail_events ORDER BY (status = 'open') DESC, created_at DESC LIMIT 100`,
    );
    return { policies, alerts, actions: GUARDRAIL_ACTIONS };
  });

  app.patch<{ Params: { key: string }; Body: { action?: unknown } }>('/api/admin/guardrails/:key', async (request, reply) => {
    const action = request.body?.action as GuardrailAction;
    if (typeof action !== 'string' || !(action in GUARDRAIL_ACTIONS)) {
      return reply.code(400).send({ error: `Action must be one of: ${Object.keys(GUARDRAIL_ACTIONS).join(', ')}.` });
    }
    const [row] = await db.query<{ check_key: string; label: string; action: string }>(
      'UPDATE guardrail_policies SET action = $2, updated_at = now(), updated_by = $3 WHERE check_key = $1 RETURNING check_key, label, action',
      [request.params.key, action, request.user.email],
    );
    if (!row) return reply.code(404).send({ error: 'No such guardrail check.' });
    await audit(db, request.user, 'guardrail.policy_changed', row.label, `action set to "${GUARDRAIL_ACTIONS[action]}" — applies to every workflow run from now on`);
    return row;
  });

  app.post<{ Params: { id: string } }>('/api/admin/guardrails/alerts/:id/resolve', async (request, reply) => {
    const [row] = await db.query<{ title: string }>(
      `UPDATE guardrail_events SET status = 'resolved' WHERE id = $1 AND status = 'open' RETURNING title`,
      [request.params.id],
    );
    if (!row) return reply.code(404).send({ error: 'No open alert with this id.' });
    await audit(db, request.user, 'guardrail.alert_resolved', row.title);
    return { ok: true };
  });

  // ---- Audit log ----

  app.get<{ Querystring: { limit?: string } }>('/api/admin/audit', async (request) => {
    const limit = Math.min(Math.max(Number(request.query.limit) || 200, 1), 1000);
    return db.query('SELECT id, actor_email, action, subject, detail, created_at FROM audit_log ORDER BY created_at DESC, id DESC LIMIT $1', [limit]);
  });
};
