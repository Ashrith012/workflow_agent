/**
 * Tenant Admin / FDE split: role separation, submit-for-approval publishing,
 * dynamic guardrail policies (PII masking/blocking on live runs), models,
 * connectors and the audit log. Throwaway PostgreSQL schema (DATABASE_URL), mock mode; no agent service
 * needed — the PII workflow uses only offline nodes.
 *   npm run test:tenant
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server/app.js';
import { createDb, type Db } from '../server/db/index.js';

process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'admin-password';
process.env.JWT_SECRET = 'test-secret';

let app: FastifyInstance;
let db: Db;
let adminCookie = '';
let fdeCookie = '';
let userCookie = '';

async function login(email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  assert.equal(res.statusCode, 200, res.body);
  return `wf_session=${res.cookies.find((c) => c.name === 'wf_session')!.value}`;
}

const post = (url: string, cookie: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: { cookie } });
const patch = (url: string, cookie: string, payload: unknown = {}) =>
  app.inject({ method: 'PATCH', url, payload: payload as object, headers: { cookie } });
const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });

/** AI workflow whose response contains a PAN and an Aadhaar number (the agent service answers with a mock). */
const PII_WORKFLOW = {
  version: 1,
  name: 'PII test',
  nodes: [
    { id: 't', type: 'UIEventTrigger', position: { x: 0, y: 0 }, parameters: { eventKey: 'pii.test', allowedRoles: 'user, admin', samplePayload: '{}' } },
    {
      id: 'ai',
      type: 'AIAgent',
      position: { x: 200, y: 0 },
      parameters: { model: 'groq:openai/gpt-oss-120b', prompt: 'say hi', tools: '', outputField: 'answer' },
    },
    {
      id: 's',
      type: 'SetFields',
      position: { x: 400, y: 0 },
      parameters: { values: '{"report": {"type": "markdown", "text": "Customer PAN ABCDE1234F, Aadhaar 1234 5678 9012, amount 500."}}' },
    },
    { id: 'r', type: 'RespondToUI', position: { x: 600, y: 0 }, parameters: { title: 'PII test', blocksFrom: 'report', sourcesFrom: '', emptyMessage: '' } },
  ],
  edges: [
    { id: 'e1', source: 't', target: 'ai' },
    { id: 'e2', source: 'ai', target: 's' },
    { id: 'e3', source: 's', target: 'r' },
  ],
};

before(async () => {
  db = await createDb({ schema: 'wf_test_tenant' });
  app = await buildServer({ logger: false, db, appRunMode: 'mock' });
  adminCookie = await login('admin@example.com', 'admin-password');
  for (const [email, role] of [['fde@example.com', 'fde'], ['user@example.com', 'user']]) {
    const res = await post('/api/admin/users', adminCookie, { email, password: 'test-password', role });
    assert.equal(res.statusCode, 200, res.body);
  }
  fdeCookie = await login('fde@example.com', 'test-password');
  userCookie = await login('user@example.com', 'test-password');
});

after(async () => {
  await app?.close();
  await db?.close();
});

test('roles are separated: fde builds, admin governs, user sees neither console', async () => {
  // FDE may use the builder APIs but not the tenant console or the end-user app.
  assert.equal((await get('/api/fde/submissions', fdeCookie)).statusCode, 200);
  assert.equal((await post('/api/run', fdeCookie, {})).statusCode, 400); // past auth, rejected only for the empty body
  assert.equal((await get('/api/admin/overview', fdeCookie)).statusCode, 403);
  assert.equal((await get('/api/admin/approvals', fdeCookie)).statusCode, 403);
  assert.equal((await get('/api/app/events', fdeCookie)).statusCode, 403);
  assert.equal((await get('/api/app/data-access', fdeCookie)).statusCode, 403);
  // End users reach neither.
  assert.equal((await get('/api/fde/submissions', userCookie)).statusCode, 403);
  assert.equal((await get('/api/admin/overview', userCookie)).statusCode, 403);
  // Admin reaches both.
  assert.equal((await get('/api/admin/overview', adminCookie)).statusCode, 200);
  assert.equal((await get('/api/fde/submissions', adminCookie)).statusCode, 200);
});

test('an FDE submission waits for the tenant admin; approving publishes it', async () => {
  const submitted = await post('/api/fde/submit', fdeCookie, { workflow: PII_WORKFLOW, note: 'please review' });
  assert.equal(submitted.statusCode, 200, submitted.body);
  assert.equal(submitted.json().eventKey, 'pii.test');

  // Not live yet.
  assert.equal((await post('/api/app/events/pii.test', userCookie, { payload: {} })).statusCode, 404);

  // Pending for the admin, visible to the FDE as theirs.
  const pending = (await get('/api/admin/approvals', adminCookie)).json();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].status, 'pending');
  assert.equal(pending[0].submitted_by, 'fde@example.com');
  assert.equal((await get('/api/fde/submissions', fdeCookie)).json()[0].note, 'please review');

  // A resubmission replaces the pending version instead of stacking.
  await post('/api/fde/submit', fdeCookie, { workflow: PII_WORKFLOW, note: 'v2' });
  const repending = (await get('/api/admin/approvals', adminCookie)).json();
  assert.equal(repending.filter((a: { status: string }) => a.status === 'pending').length, 1);

  const approved = await post(`/api/admin/approvals/${repending[0].id}/approve`, adminCookie, {});
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(approved.json().version, 1);
  assert.equal((await get('/api/fde/published', fdeCookie)).json().some((p: { event_key: string }) => p.event_key === 'pii.test'), true);
});

test('My data access: a user can turn a consent source off and runs stop straight away', async () => {
  const sources = (await get('/api/app/data-access', userCookie)).json();
  assert.ok(sources.length >= 5);
  const sharepoint = sources.find((s: { id: string }) => s.id === 'sharepoint');
  assert.equal(sharepoint.allowed, true);
  assert.ok(sharepoint.purpose.length > 0);

  // Company-managed sources cannot be switched by the user.
  assert.equal((await post('/api/app/data-access/qdrant', userCookie, { allowed: false })).statusCode, 400);

  // Publish a workflow that reads SharePoint, as admin.
  const spWorkflow = {
    version: 1,
    name: 'SharePoint read',
    nodes: [
      { id: 't', type: 'UIEventTrigger', position: { x: 0, y: 0 }, parameters: { eventKey: 'sp.test', allowedRoles: 'user, admin', samplePayload: '{}' } },
      { id: 'sp', type: 'SharePoint', position: { x: 200, y: 0 }, parameters: { operation: 'listFiles', library: '' } },
      { id: 'r', type: 'RespondToUI', position: { x: 400, y: 0 }, parameters: { title: 'Files', blocksFrom: '', sourcesFrom: '', emptyMessage: 'No files.' } },
    ],
    edges: [
      { id: 'e1', source: 't', target: 'sp' },
      { id: 'e2', source: 'sp', target: 'r' },
    ],
  };
  assert.equal((await post('/api/admin/publish', adminCookie, { workflow: spWorkflow })).statusCode, 200);

  // Turn SharePoint off: the very next run is refused with a clear reason.
  assert.equal((await post('/api/app/data-access/sharepoint', userCookie, { allowed: false })).statusCode, 200);
  assert.equal((await get('/api/app/data-access', userCookie)).json().find((s: { id: string }) => s.id === 'sharepoint').allowed, false);
  const refused = await post('/api/app/events/sp.test', userCookie, { payload: {} });
  assert.equal(refused.statusCode, 403);
  assert.match(refused.json().error, /turned off.*My data access/);

  // Allow it again: the consent gate opens immediately.
  assert.equal((await post('/api/app/data-access/sharepoint', userCookie, { allowed: true })).statusCode, 200);
  assert.notEqual((await post('/api/app/events/sp.test', userCookie, { payload: {} })).statusCode, 403);

  // An admin-disabled connector blocks everyone.
  await patch('/api/admin/connectors/sharepoint', adminCookie, { enabled: false });
  const blocked = await post('/api/app/events/sp.test', userCookie, { payload: {} });
  assert.equal(blocked.statusCode, 403);
  assert.match(blocked.json().error, /administrator has turned off/);
  await patch('/api/admin/connectors/sharepoint', adminCookie, { enabled: true });
});

test('the default PII policy masks Aadhaar and PAN and records the event', async () => {
  const res = await post('/api/app/events/pii.test', userCookie, { payload: {} });
  assert.equal(res.statusCode, 200, res.body);
  const text = res.json().ui.blocks[0].text as string;
  assert.ok(!text.includes('ABCDE1234F'), 'PAN must be masked');
  assert.ok(!text.includes('1234 5678 9012'), 'Aadhaar must be masked');
  assert.ok(text.includes('••••'), text);
  assert.ok(text.includes('amount 500'), 'non-PII content stays');

  const { alerts } = (await get('/api/admin/guardrails', adminCookie)).json();
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].title, /PII masked/);
  assert.equal(alerts[0].action, 'mask_log');
});

test('changing the policy dropdown changes behaviour on the next run — no code change', async () => {
  const changed = await patch('/api/admin/guardrails/pii', adminCookie, { action: 'block' });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal((await patch('/api/admin/guardrails/pii', adminCookie, { action: 'nope' })).statusCode, 400);

  const res = await post('/api/app/events/pii.test', userCookie, { payload: {} });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().ui.title, 'Response blocked by a guardrail');

  // Back to mask_log for the activity test below.
  await patch('/api/admin/guardrails/pii', adminCookie, { action: 'mask_log' });
});

test('guardrail outcomes reach the end user in AI Activity, and alerts can be resolved', async () => {
  // Publish the stock activity workflow directly as admin, then read it as the user.
  const { readFileSync } = await import('node:fs');
  const activityWf = JSON.parse(readFileSync(new URL('../examples/manzil/manzil-activity.json', import.meta.url), 'utf8'));
  assert.equal((await post('/api/admin/publish', adminCookie, { workflow: activityWf })).statusCode, 200);

  const activity = (await post('/api/app/events/manzil.activity', userCookie, { payload: {} })).json().ui;
  const log = activity.blocks[0];
  assert.equal(log.type, 'activityLog');
  const flat = JSON.stringify(log.items);
  assert.match(flat, /PII (masked|blocked)/);
  assert.match(flat, /policy: (Mask and log|Block)/);

  // A guardrail gets its own amber entry on the timeline, as its own event.
  const guardrail = log.items.find((i: { tone: string }) => i.tone === 'guardrail');
  assert.ok(guardrail, flat);
  assert.match(guardrail.title, /^A guardrail (masked|blocked) personal data/);
  assert.match(guardrail.detail, /policy decided this, not the assistant/);

  // The run it belongs to is a sentence, and "Show steps" explains it step by step.
  const run = log.items.find((i: { tone: string }) => i.tone === 'agent');
  assert.ok(run.steps.some((s: { text: string }) => /Received your request/.test(s.text)), JSON.stringify(run.steps));
  assert.ok(run.steps.some((s: { text: string }) => /Asked the AI model/.test(s.text)));

  const { alerts } = (await get('/api/admin/guardrails', adminCookie)).json();
  const open = alerts.filter((a: { status: string }) => a.status === 'open');
  assert.ok(open.length >= 2);
  assert.equal((await post(`/api/admin/guardrails/alerts/${open[0].id}/resolve`, adminCookie)).statusCode, 200);
});

test('the live version is visible to end users and bumps when a new version is approved', async () => {
  const events = (await get('/api/app/events', userCookie)).json();
  const pii = events.find((e: { eventKey: string }) => e.eventKey === 'pii.test');
  assert.equal(pii.version, 1);

  // Every response also carries the version that produced it.
  assert.equal((await post('/api/app/events/pii.test', userCookie, { payload: {} })).json().version, 1);

  // FDE updates the workflow, admin approves: end users see v2 right away.
  await post('/api/fde/submit', fdeCookie, { workflow: { ...PII_WORKFLOW, name: 'PII test v2' } });
  const [pending] = (await get('/api/admin/approvals', adminCookie)).json();
  await post(`/api/admin/approvals/${pending.id}/approve`, adminCookie, {});
  const after = (await get('/api/app/events', userCookie)).json().find((e: { eventKey: string }) => e.eventKey === 'pii.test');
  assert.equal(after.version, 2);
  assert.equal((await post('/api/app/events/pii.test', userCookie, { payload: {} })).json().version, 2);
});

test('the model catalog gates what an FDE may submit', async () => {
  const models = (await get('/api/admin/models', adminCookie)).json();
  assert.ok(models.some((m: { model_key: string; status: string }) => m.model_key === 'groq:openai/gpt-oss-120b' && m.status === 'authorized'));

  assert.equal((await patch('/api/admin/models/groq:openai%2Fgpt-oss-120b', adminCookie, { status: 'disabled' })).statusCode, 200);
  const refused = await post('/api/fde/submit', fdeCookie, { workflow: PII_WORKFLOW });
  assert.equal(refused.statusCode, 400);
  assert.match(refused.json().details[0], /not authorized/);

  assert.equal((await patch('/api/admin/models/groq:openai%2Fgpt-oss-120b', adminCookie, { status: 'authorized' })).statusCode, 200);
  assert.equal((await post('/api/fde/submit', fdeCookie, { workflow: PII_WORKFLOW })).statusCode, 200);
});

test('connectors toggle and consent changes persist', async () => {
  const connectors = (await get('/api/admin/connectors', adminCookie)).json();
  assert.ok(connectors.length >= 5);
  const sharepoint = connectors.find((c: { id: string }) => c.id === 'sharepoint');
  assert.equal(sharepoint.auth, 'user_consent');

  const toggled = await patch('/api/admin/connectors/sharepoint', adminCookie, { enabled: false, auth: 'service_account' });
  assert.equal(toggled.statusCode, 200);
  assert.equal(toggled.json().enabled, false);
  assert.equal(toggled.json().auth, 'service_account');
});

test('passwords are stored as bcrypt hashes, never in the clear', async () => {
  // The right password works and a wrong one does not …
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'fde@example.com', password: 'test-password' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'fde@example.com', password: 'Test-Password' } })).statusCode, 401);

  // … and what is stored is a bcrypt hash, not the password.
  const [row] = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE email = $1', ['fde@example.com']);
  assert.match(row.password_hash, /^\$2[aby]\$\d{2}\$/, `expected a bcrypt hash, got ${row.password_hash.slice(0, 12)}…`);
  assert.ok(!row.password_hash.includes('test-password'));
  assert.ok(Number(row.password_hash.split('$')[2]) >= 10, 'bcrypt cost must be at least 10');
});

test('a tenant admin can register their own self-hosted LLM, and the FDE can then pick it', async () => {
  // Before: the builder only offers what the admin authorized, and the catalog's own
  // self-hosted provider is already marked as such.
  const seeded = (await get('/api/fde/models', fdeCookie)).json();
  const ollama = seeded.find((m: { model_key: string }) => m.model_key === 'selfhosted:qwen2.5:7b');
  assert.ok(ollama, JSON.stringify(seeded.map((m: { model_key: string }) => m.model_key)));
  assert.equal(ollama.kind, 'selfhosted');
  assert.ok(ollama.base_url.includes('/v1'), ollama.base_url);

  // A bad endpoint is refused before anything is stored.
  assert.equal((await post('/api/admin/models', adminCookie, { kind: 'selfhosted', model_key: 'mylab:x', name: 'X', base_url: 'not-a-url' })).statusCode, 400);
  assert.equal((await post('/api/admin/models/test', adminCookie, { base_url: 'ftp://nope' })).statusCode, 400);

  const added = await post('/api/admin/models', adminCookie, {
    kind: 'selfhosted',
    model_key: 'mylab:qwen2.5:3b',
    name: 'Qwen2.5 3B (my lab)',
    base_url: 'https://llm.internal.example.com/v1',
  });
  assert.equal(added.statusCode, 200, added.body);
  assert.equal(added.json().kind, 'selfhosted');
  assert.equal(added.json().api_key_env, ''); // no secret is stored

  // It is immediately selectable in the builder, and usable in a submission.
  const models = (await get('/api/fde/models', fdeCookie)).json();
  assert.ok(models.some((m: { model_key: string }) => m.model_key === 'mylab:qwen2.5:3b'));

  const selfHostedWorkflow = {
    ...PII_WORKFLOW,
    name: 'Self-hosted model test',
    nodes: PII_WORKFLOW.nodes.map((n) => (n.id === 'ai' ? { ...n, parameters: { ...n.parameters, model: 'mylab:qwen2.5:3b' } } : n)),
  };
  assert.equal((await post('/api/fde/submit', fdeCookie, { workflow: selfHostedWorkflow })).statusCode, 200);

  // Disabling it blocks new submissions, exactly like a hosted model.
  await patch('/api/admin/models/mylab:qwen2.5:3b', adminCookie, { status: 'disabled' });
  const refused = await post('/api/fde/submit', fdeCookie, { workflow: selfHostedWorkflow });
  assert.equal(refused.statusCode, 400);
  assert.match(refused.json().details[0], /not authorized/);
});

test('the builder reads executions and evaluation cases for its workflow', async () => {
  const executions = (await get('/api/fde/executions?eventKey=pii.test', fdeCookie)).json();
  assert.ok(executions.length > 0);
  assert.ok(executions.every((e: { event_key: string }) => e.event_key === 'pii.test'));
  const detail = (await get(`/api/fde/executions/${executions[0].id}`, fdeCookie)).json();
  assert.ok(detail.nodes.length > 0);
  assert.ok(detail.nodes.every((n: { type: string }) => typeof n.type === 'string'));

  // Evaluation cases live against the trigger's event key.
  assert.equal((await post('/api/fde/evaluations', fdeCookie, { name: 'no key', payload: '{}' })).statusCode, 400);
  assert.equal((await post('/api/fde/evaluations', fdeCookie, { eventKey: 'pii.test', name: 'bad json', payload: '{oops' })).statusCode, 400);

  const created = await post('/api/fde/evaluations', fdeCookie, {
    eventKey: 'pii.test',
    name: 'Masks a PAN',
    payload: '{"domain":"Material Status"}',
    expectContains: 'Customer',
  });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().id;

  assert.equal((await post(`/api/fde/evaluations/${id}/result`, fdeCookie, { passed: true, detail: 'Ran 4 nodes' })).statusCode, 200);
  const [saved] = (await get('/api/fde/evaluations?eventKey=pii.test', fdeCookie)).json();
  assert.equal(saved.last_status, 'passed');
  assert.deepEqual(saved.payload, { domain: 'Material Status' });

  // End users never reach the builder's tabs.
  assert.equal((await get('/api/fde/executions', userCookie)).statusCode, 403);
  assert.equal((await get('/api/fde/evaluations', userCookie)).statusCode, 403);
});

test('the app builds its pages from what each workflow asks for', async () => {
  // A workflow that declares its own page shows up as a section, grouped, with no code change.
  const agentWorkflow = {
    version: 1,
    name: 'Invoices agent',
    nodes: [
      {
        id: 't',
        type: 'UIEventTrigger',
        position: { x: 0, y: 0 },
        parameters: {
          eventKey: 'finance.invoices',
          allowedRoles: 'user, admin',
          samplePayload: '{}',
          appSection: 'Invoices',
          appGroup: 'Finance',
          appIcon: 'briefcase',
          appOrder: '20',
        },
      },
      { id: 'r', type: 'RespondToUI', position: { x: 200, y: 0 }, parameters: { title: 'Invoices', blocksFrom: '', sourcesFrom: '', emptyMessage: 'None.' } },
    ],
    edges: [{ id: 'e1', source: 't', target: 'r' }],
  };
  assert.equal((await post('/api/admin/publish', adminCookie, { workflow: agentWorkflow })).statusCode, 200);

  const events = (await get('/api/app/events', userCookie)).json();
  const invoices = events.find((e: { eventKey: string }) => e.eventKey === 'finance.invoices');
  assert.deepEqual(
    { section: invoices.section, group: invoices.group, icon: invoices.icon, order: invoices.order, kind: invoices.kind },
    { section: 'Invoices', group: 'Finance', icon: 'briefcase', order: 20, kind: 'event' },
  );
  // A workflow that declares no page still runs, it just has no sidebar entry of its own,
  // and no order of its own either — so the app's own page order stands.
  const activity = events.find((e: { eventKey: string }) => e.eventKey === 'manzil.activity');
  assert.equal(activity.section, '');
  assert.equal(activity.order, null);
  assert.equal((await post('/api/app/events/finance.invoices', userCookie, { payload: {} })).statusCode, 200);
});

test('the audit log has every approval, publish, consent change and agent action', async () => {
  const rows = (await get('/api/admin/audit?limit=500', adminCookie)).json();
  const actions = new Set(rows.map((r: { action: string }) => r.action));
  for (const expected of [
    'user.created',
    'workflow.submitted',
    'workflow.approved',
    'workflow.published',
    'agent.run',
    'guardrail.policy_changed',
    'guardrail.alert_resolved',
    'model.status_changed',
    'connector.toggled',
    'connector.consent_changed',
    'consent.changed',
  ]) {
    assert.ok(actions.has(expected), `missing audit action ${expected} (have: ${[...actions].join(', ')})`);
  }
  // Agent runs carry the guardrail note.
  assert.ok(rows.some((r: { action: string; detail: string }) => r.action === 'agent.run' && r.detail.includes('PII')));
});
