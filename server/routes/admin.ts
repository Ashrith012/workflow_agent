/**
 * Administrator API: publish workflows for the end-user app, manage users and
 * inspect runs. Every route requires the admin role.
 */
import type { FastifyPluginAsync } from 'fastify';
import { findCycle, validateWorkflowShape } from '../../cli/validate.js';
import type { ExportedWorkflow } from '../../frontend/src/types.js';
import { createUser, requireAdmin } from '../auth.js';
import type { Db } from '../db/index.js';
import { allowedRoles, audit, triggerOf, TRIGGER_TYPES } from '../platform.js';

const EVENT_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const ROLES = new Set(['admin', 'fde', 'user']);

/** Publishing rules on top of the shape checks every run gets. Returns problems; empty means publishable. */
export function publishProblems(workflow: unknown): string[] {
  const shape = validateWorkflowShape(workflow);
  if (shape.length > 0) return shape;
  const wf = workflow as ExportedWorkflow;
  const problems: string[] = [];
  const cycle = findCycle(wf);
  if (cycle) problems.push(cycle.message);
  const triggers = wf.nodes.filter((n) => TRIGGER_TYPES.has(n.type));
  if (triggers.length !== 1) {
    problems.push(`A published workflow needs exactly one UI Event Trigger or Chat Trigger (found ${triggers.length}).`);
  } else {
    const key = triggers[0].parameters.eventKey ?? '';
    if (!EVENT_KEY.test(key)) problems.push(`Event key "${key}" must be 1–100 letters, digits, ".", "_" or "-".`);
    const bad = allowedRoles(triggers[0].parameters).filter((r) => !ROLES.has(r));
    if (bad.length > 0) problems.push(`Unknown role(s) in Allowed roles: ${bad.join(', ')} (use admin, fde, user).`);
  }
  if (!wf.nodes.some((n) => n.type === 'RespondToUI')) {
    problems.push('A published workflow needs a Respond to UI node; its output is what the app shows.');
  }
  return problems;
}

/**
 * Models the workflow's AI Agent nodes use that the tenant admin has not
 * authorized. Checked on FDE submission and again on approval/publish, so the
 * admin's Models page governs what can go live without any code change.
 */
export async function unauthorizedModels(db: Db, workflow: ExportedWorkflow): Promise<string[]> {
  const used = [...new Set(workflow.nodes.filter((n) => n.type === 'AIAgent').map((n) => n.parameters.model).filter(Boolean))];
  if (used.length === 0) return [];
  const rows = await db.query<{ model_key: string }>(
    `SELECT model_key FROM tenant_models WHERE status = 'authorized' AND model_key = ANY($1)`,
    [used],
  );
  const authorized = new Set(rows.map((r) => r.model_key));
  return used.filter((m) => !authorized.has(m)).map((m) => `Model "${m}" is not authorized by the tenant admin (Models page).`);
}

/** Upserts the live version of a workflow. Shared by direct admin publish and approval. */
export async function publishWorkflow(db: Db, workflow: ExportedWorkflow, publishedBy: string | null) {
  const trigger = triggerOf(workflow)!;
  const [row] = await db.query<{ event_key: string; version: number }>(
    `INSERT INTO published_workflows (event_key, name, workflow, trigger_type, allowed_roles, published_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (event_key) DO UPDATE SET
       name = EXCLUDED.name, workflow = EXCLUDED.workflow, trigger_type = EXCLUDED.trigger_type,
       allowed_roles = EXCLUDED.allowed_roles, published_by = EXCLUDED.published_by,
       version = published_workflows.version + 1, published_at = now()
     RETURNING event_key, version`,
    [trigger.parameters.eventKey, workflow.name, JSON.stringify(workflow), trigger.type, allowedRoles(trigger.parameters).join(','), publishedBy],
  );
  return row;
}

export const adminRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.addHook('preHandler', requireAdmin);

  // ---- Published workflows ----

  app.get('/api/admin/published', async () =>
    db.query(
      `SELECT p.event_key, p.name, p.trigger_type, p.allowed_roles, p.version, p.published_at, u.email AS published_by
         FROM published_workflows p LEFT JOIN users u ON u.id = p.published_by ORDER BY p.event_key`,
    ),
  );

  app.get<{ Params: { eventKey: string } }>('/api/admin/published/:eventKey', async (request, reply) => {
    const [row] = await db.query('SELECT * FROM published_workflows WHERE event_key = $1', [request.params.eventKey]);
    return row ?? reply.code(404).send({ error: 'Not published.' });
  });

  app.post<{ Body: { workflow?: unknown } }>('/api/admin/publish', async (request, reply) => {
    const workflow = request.body?.workflow;
    const problems = publishProblems(workflow);
    if (problems.length > 0) return reply.code(400).send({ error: 'This workflow cannot be published.', details: problems });

    const wf = workflow as ExportedWorkflow;
    const row = await publishWorkflow(db, wf, request.user.id);
    await audit(db, request.user, 'workflow.published', row.event_key, `"${wf.name}" version ${row.version}, published directly by the tenant admin`);
    request.log.info({ eventKey: row.event_key, version: row.version }, 'workflow published');
    return { eventKey: row.event_key, version: row.version };
  });

  app.delete<{ Params: { eventKey: string } }>('/api/admin/published/:eventKey', async (request, reply) => {
    const rows = await db.query('DELETE FROM published_workflows WHERE event_key = $1 RETURNING event_key', [request.params.eventKey]);
    if (rows.length === 0) return reply.code(404).send({ error: 'Not published.' });
    await audit(db, request.user, 'workflow.unpublished', request.params.eventKey);
    return { ok: true };
  });

  // ---- Users ----

  app.get('/api/admin/users', async () => db.query('SELECT id, email, role, created_at FROM users ORDER BY created_at'));

  app.post<{ Body: { email?: unknown; password?: unknown; role?: unknown } }>('/api/admin/users', async (request, reply) => {
    const { email, password, role } = request.body ?? {};
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(email.trim())) return reply.code(400).send({ error: 'A valid email is required.' });
    if (typeof password !== 'string' || password.length < 8) return reply.code(400).send({ error: 'Password must be at least 8 characters.' });
    if (role !== 'admin' && role !== 'fde' && role !== 'user') return reply.code(400).send({ error: 'Role must be "admin", "fde" or "user".' });
    const [existing] = await db.query('SELECT 1 FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (existing) return reply.code(409).send({ error: 'A user with this email already exists.' });
    const created = await createUser(db, email, password, role);
    await audit(db, request.user, 'user.created', created.email, `role ${role}`);
    return created;
  });

  app.delete<{ Params: { id: string } }>('/api/admin/users/:id', async (request, reply) => {
    if (request.params.id === request.user.id) return reply.code(400).send({ error: 'You cannot delete your own account.' });
    const rows = await db.query<{ email: string }>('DELETE FROM users WHERE id = $1 RETURNING id, email', [request.params.id]);
    if (rows.length === 0) return reply.code(404).send({ error: 'No such user.' });
    await audit(db, request.user, 'user.deleted', rows[0].email);
    return { ok: true };
  });

  // ---- Runs (every published-workflow run, with node detail) ----

  app.get<{ Querystring: { limit?: string } }>('/api/admin/runs', async (request) => {
    const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);
    return db.query(
      `SELECT r.id, r.event_key, r.workflow_name, r.label, r.status, r.error, r.duration_ms, r.started_at, u.email AS user_email
         FROM runs r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.started_at DESC LIMIT $1`,
      [limit],
    );
  });

  app.get<{ Params: { id: string } }>('/api/admin/runs/:id', async (request, reply) => {
    const [run] = await db.query('SELECT * FROM runs WHERE id = $1', [request.params.id]);
    if (!run) return reply.code(404).send({ error: 'No such run.' });
    const nodes = await db.query('SELECT node_id, type, status, duration_ms, error, output FROM run_nodes WHERE run_id = $1', [request.params.id]);
    return { ...run, nodes };
  });
};
