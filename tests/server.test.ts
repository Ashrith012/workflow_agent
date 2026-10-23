/**
 * End-to-end API test: publish the Manzil workflows as admin, then use them as
 * an end user. In-memory PGlite, mock mode; needs the agent service on :8000.
 *   npm run dev:agent   # in another terminal
 *   npm run test:server
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server/app.js';
import { createDb } from '../server/db/index.js';

process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'admin-password';
process.env.JWT_SECRET = 'test-secret';

let app: FastifyInstance;
let adminCookie = '';
let userCookie = '';

const MANZIL_DIR = new URL('../examples/manzil/', import.meta.url);

async function login(email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  assert.equal(res.statusCode, 200, res.body);
  const cookie = res.cookies.find((c) => c.name === 'wf_session');
  assert.ok(cookie?.httpOnly);
  return `wf_session=${cookie.value}`;
}

const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: 'POST', url, payload: payload as object, headers: { cookie } });
const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });
const event = (key: string, payload: unknown = {}, extra: object = {}) => post(`/api/app/events/${key}`, userCookie, { payload, ...extra });

before(async () => {
  app = await buildServer({ logger: false, db: await createDb({ dataDir: 'memory://' }), appRunMode: 'mock' });
  adminCookie = await login('admin@example.com', 'admin-password');
});

after(() => app.close());

test('unauthenticated and non-admin access is refused', async () => {
  assert.equal((await app.inject({ method: 'POST', url: '/api/run', payload: {} })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode, 401);
  assert.equal((await post('/api/auth/login', '', { email: 'admin@example.com', password: 'wrong' })).statusCode, 401);
});

test('admin publishes the Manzil workflows and creates a user', async () => {
  for (const file of readdirSync(MANZIL_DIR)) {
    const workflow = JSON.parse(readFileSync(new URL(file, MANZIL_DIR), 'utf8'));
    const res = await post('/api/admin/publish', adminCookie, { workflow });
    assert.equal(res.statusCode, 200, `${file}: ${res.body}`);
  }
  // Republishing bumps the version.
  const chat = JSON.parse(readFileSync(new URL('manzil-chat.json', MANZIL_DIR), 'utf8'));
  assert.equal((await post('/api/admin/publish', adminCookie, { workflow: chat })).json().version, 2);

  const created = await post('/api/admin/users', adminCookie, { email: 'User@Example.com', password: 'user-password', role: 'user' });
  assert.equal(created.statusCode, 200, created.body);
  userCookie = await login('user@example.com', 'user-password');
});

test('publishing is validated', async () => {
  const res = await post('/api/admin/publish', adminCookie, {
    workflow: { version: 1, name: 'x', nodes: [{ id: 'a', type: 'UIEventTrigger', position: { x: 0, y: 0 }, parameters: { eventKey: 'bad key!' } }], edges: [] },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().details.length, 2); // bad event key + no RespondToUI
});

test('end user cannot reach admin or builder APIs', async () => {
  assert.equal((await get('/api/admin/published', userCookie)).statusCode, 403);
  assert.equal((await post('/api/run', userCookie, {})).statusCode, 403);
  assert.equal((await get('/api/auth/me', userCookie)).json().user.role, 'user');
});

test('the app lists only events the user may trigger', async () => {
  const keys = (await get('/api/app/events', userCookie)).json().map((e: { eventKey: string }) => e.eventKey).sort();
  assert.deepEqual(keys, ['manzil.activity', 'manzil.analytics', 'manzil.chat', 'manzil.dashboard.load', 'manzil.domain', 'manzil.overview']);
  assert.equal((await event('manzil.ingest', { path: 'x' })).statusCode, 403);
  assert.equal((await event('nope')).statusCode, 404);
});

test('dashboard home renders domain buttons', async () => {
  const res = await event('manzil.dashboard.load');
  assert.equal(res.statusCode, 200, res.body);
  const { ui } = res.json();
  const buttons = ui.blocks.find((b: { type: string }) => b.type === 'buttonGroup').buttons;
  assert.equal(buttons.length, 7);
  assert.deepEqual(buttons[0], { label: 'Material Status', eventKey: 'manzil.domain', payload: { domain: 'Material Status' } });
  assert.deepEqual(ui.blocks.find((b: { type: string }) => b.type === 'select').options, [{ value: 'PRJ-001', count: 42 }, { value: 'PRJ-002', count: 17 }]);
});

test('a domain button returns a report and, when asked, a dashboard — never the workflow', async () => {
  const withDashboard = await event('manzil.domain', { domain: 'Material Status', projectId: 'PRJ-001', dashboard: true });
  assert.equal(withDashboard.statusCode, 200, withDashboard.body);
  const body = withDashboard.json();
  assert.deepEqual(Object.keys(body).sort(), ['runId', 'ui', 'version']);
  assert.equal(body.ui.blocks.length, 2);
  assert.ok(Object.keys(body.ui.sources).length > 0);
  assert.ok(!withDashboard.body.includes('"nodes"'));

  const reportOnly = await event('manzil.domain', { domain: 'Material Status' });
  assert.equal(reportOnly.json().ui.blocks.length, 1);
});

test('chat keeps per-session history', async () => {
  const first = await event('manzil.chat', { message: 'What is the inspection status?' });
  assert.equal(first.statusCode, 200, first.body);
  const { sessionId } = first.json();
  assert.match(sessionId, /^chat_/);
  const second = await event('manzil.chat', { message: 'And the call letters?' }, { sessionId });
  assert.equal(second.json().sessionId, sessionId);
  const messages = (await get(`/api/app/chat/${sessionId}`, userCookie)).json();
  assert.deepEqual(messages.map((m: { role: string }) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.ok(messages[1].ui.blocks.length > 0);
  // Another user cannot read this session.
  assert.deepEqual((await get(`/api/app/chat/${sessionId}`, adminCookie)).json(), []);
  assert.equal((await event('manzil.chat', { message: '  ' })).statusCode, 400);
});

test('the Overview page reports Manzil numbers, not platform telemetry', async () => {
  const { ui } = (await event('manzil.overview')).json();
  const kpis = ui.blocks.find((b: { type: string }) => b.type === 'kpiCards');
  assert.ok(kpis, JSON.stringify(ui.blocks.map((b: { type: string }) => b.type)));
  assert.deepEqual(
    kpis.cards.map((c: { title: string }) => c.title),
    ['Projects tracked', 'Indexed passages', 'Reports and answers', 'Answered first time', 'Average answer time'],
  );
  // The project numbers come from the document index's facet, not from a hardcoded value.
  const byTitle = Object.fromEntries(kpis.cards.map((c: { title: string; value: string }) => [c.title, c.value]));
  assert.equal(byTitle['Projects tracked'], '2'); // PRJ-001 and PRJ-002
  assert.equal(byTitle['Indexed passages'], '59'); // 42 + 17
  assert.match(byTitle['Answered first time'], /^(\d+%|—)$/);
  assert.ok(kpis.cards.every((c: { description: string }) => !c.description.includes('{{')));
});

test('AI Activity and Analytics come from workflows over the run history', async () => {
  const activity = (await event('manzil.activity')).json().ui;
  const log = activity.blocks[0];
  assert.equal(log.type, 'activityLog');
  assert.ok(log.description.length > 0);
  const runs = log.items.filter((i: { tone: string }) => i.tone !== 'guardrail');
  assert.equal(runs.length, 4); // 2 domain reports + 2 chat turns; runs without an AI Agent are not AI activity
  assert.ok(log.items.every((i: { user?: string }) => i.user === undefined)); // no user detail for a non-admin, even with scope "all"
  // Each entry is a sentence naming the assistant and what it did, with steps behind it.
  assert.ok(runs[0].steps.length > 0);
  assert.ok(
    runs.some((i: { title: string }) => /answered\s+“/.test(i.title) && /searched your documents|asked the AI model/.test(i.title)),
    JSON.stringify(runs.map((i: { title: string }) => i.title)),
  );
  assert.ok(runs.every((i: { tone: string }) => ['agent', 'failed', 'running'].includes(i.tone)));
  assert.ok(log.items.some((i: { steps: { text: string }[] }) => i.steps.some((s) => /Asked the AI model/.test(s.text))));

  const analytics = (await event('manzil.analytics')).json().ui;
  assert.deepEqual(analytics.blocks.map((b: { type: string }) => b.type), ['kpiCards', 'barChart', 'table']);
  assert.equal(analytics.blocks[0].cards[0].value, '4');
});

test('admin sees every run with node detail', async () => {
  const runs = (await get('/api/admin/runs', adminCookie)).json();
  assert.equal(runs.length, 8); // dashboard, 2 domain, 2 chat, overview, activity, analytics (refused requests never start a run)
  const detail = (await get(`/api/admin/runs/${runs[0].id}`, adminCookie)).json();
  assert.ok(detail.nodes.length > 0);
});
