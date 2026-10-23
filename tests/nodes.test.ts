/**
 * Unit tests for the pure workflow nodes and helpers (no agent service needed).
 *   npm run test:nodes
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitText } from '../cli/executors-ai.js';
import { executors, type ExecutionContext } from '../cli/executors.js';
import { interpolateJson, readPath } from '../cli/interpolate.js';

const ctx = (extra: Partial<ExecutionContext> = {}): ExecutionContext => ({ live: false, warn: () => {}, ...extra });

test('interpolateJson escapes strings and embeds JSON values', () => {
  const input = { message: 'He said "hi"\nbye', ids: ['a', 'b'], n: 3 };
  assert.deepEqual(interpolateJson('{ "q": "{{ $json.message }}", "ids": {{ $json.ids }}, "n": {{ $json.n }} }', input, () => {}), {
    q: 'He said "hi"\nbye',
    ids: ['a', 'b'],
    n: 3,
  });
  assert.deepEqual(interpolateJson('  ', input, () => {}), {});
  assert.throws(() => interpolateJson('{ "x": {{ $json.missing }} }', input, () => {}), /invalid JSON/);
});

test('readPath reads nested fields', () => {
  assert.equal(readPath({ a: { b: [1, { c: 'x' }] } }, 'a.b[1].c'), 'x');
  assert.equal(readPath({ a: 1 }, 'nope'), undefined);
});

test('splitText respects size, overlap and covers the whole text', () => {
  const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about material delivery.`).join(' ');
  const chunks = splitText(text, 300, 50);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every((c) => c.length <= 300));
  assert.ok(chunks[0].startsWith('Sentence number 0'));
  assert.ok(chunks.at(-1)!.includes('Sentence number 39'));
  assert.deepEqual(splitText('   ', 100, 10), []);
});

test('TextClassifier picks the best keyword category and flags', async () => {
  const out = await executors.TextClassifier(
    { message: 'Give me an executive dashboard of the RITES inspection status' },
    {
      text: '{{ $json.message }}',
      categories: '{ "Material Status": ["material"], "Inspection Status": ["inspection", "rites"] }',
      flags: '{ "dashboard": ["executive dashboard"], "pdf": ["pdf"] }',
      defaultCategory: 'Project Summary',
      outputField: 'classification',
    },
    ctx(),
  );
  assert.deepEqual(out.classification, { category: 'Inspection Status', method: 'keyword', flags: { dashboard: true, pdf: false } });
  assert.equal(out.message, 'Give me an executive dashboard of the RITES inspection status');
});

test('TextClassifier falls back to the default category', async () => {
  const out = await executors.TextClassifier({ message: 'hello' }, { text: '{{ $json.message }}', categories: '{ "A": ["x"] }', defaultCategory: 'B' }, ctx());
  assert.equal(out.classification.category, 'B');
  assert.equal(out.classification.method, 'default');
});

test('TextSplitter carries document metadata and extra metadata onto chunks', async () => {
  const out = await executors.TextSplitter(
    { projectId: 'P1', documents: [{ doc_name: 'a.pdf', url: 'u', text: 'x'.repeat(250) }] },
    { itemsField: 'documents', chunkSize: '100', overlap: '0', metadata: '{ "project_id": "{{ $json.projectId }}" }' },
    ctx(),
  );
  assert.equal(out.chunks.length, 3);
  assert.deepEqual(Object.keys(out.chunks[1]).sort(), ['chunk_index', 'doc_name', 'project_id', 'text', 'url']);
  assert.equal(out.chunks[1].chunk_index, 1);
  assert.equal(out.chunks[1].project_id, 'P1');
});

test('SetFields merges or replaces', async () => {
  assert.deepEqual(await executors.SetFields({ a: 1 }, { values: '{ "b": "{{ $json.a }}" }' }, ctx()), { a: 1, b: '1' });
  assert.deepEqual(await executors.SetFields({ a: 1 }, { values: '{ "b": 2 }', mode: 'replace' }, ctx()), { b: 2 });
});

test('RespondToUI normalizes blocks and strips citations that were not retrieved', async () => {
  const input = {
    chunks: [{ id: 'c1', metadata: { doc_name: 'DC-114.pdf', url: 'https://x/DC-114.pdf' } }],
    dashboard: null,
    report: {
      title: 'Material Status — P1',
      blocks: [
        { type: 'table', title: 'Executive Summary', columns: ['Item', 'Status'], rows: [{ cells: ['CAT6', 'Delivered'], citations: ['c1', 'c9'] }] },
        { type: 'keyValue', title: 'Project Information', items: [{ label: 'Project Name', value: 'X', citations: ['c7'] }] },
      ],
    },
  };
  const ui = await executors.RespondToUI(input, { blocksFrom: 'dashboard, report', sourcesFrom: 'chunks' }, ctx());
  assert.equal(ui.title, 'Material Status — P1');
  assert.deepEqual(ui.blocks[0].rows[0].citations, ['c1']);
  assert.deepEqual(ui.blocks[1].items[0].citations, []);
  assert.equal(ui.blocks.at(-1).title, 'Citation check');
  assert.match(ui.blocks.at(-1).text, /2 citation\(s\)/);
  assert.deepEqual(ui.sources.c1, { doc_name: 'DC-114.pdf', url: 'https://x/DC-114.pdf', doc_type: undefined, version: undefined, modified: undefined });
  // The upstream node's data is not mutated.
  assert.deepEqual(input.report.blocks[0].rows[0].citations, ['c1', 'c9']);
});

test('RespondToUI turns text and empty results into markdown', async () => {
  assert.deepEqual((await executors.RespondToUI({ t: 'hello' }, { blocksFrom: 't' }, ctx())).blocks, [{ type: 'markdown', text: 'hello' }]);
  const empty = await executors.RespondToUI({}, { blocksFrom: 'x', emptyMessage: 'Nothing found' }, ctx());
  assert.deepEqual(empty.blocks, [{ type: 'markdown', text: 'Nothing found' }]);
});

test('AIAgent runIf skips the node and records null', async () => {
  const out = await executors.AIAgent({ flags: { dashboard: false } }, { runIf: '{{ $json.flags.dashboard }}', outputField: 'dashboard', prompt: 'x' }, ctx());
  assert.deepEqual(out, { flags: { dashboard: false }, dashboard: null });
});

test('RunHistory only shows all users to admins', async () => {
  const calls: unknown[] = [];
  const services = {
    runHistory: async (o: unknown) => (calls.push(o), [{ id: 'r', event_key: 'e', status: 'completed', duration_ms: 1000, started_at: '2026-10-01T00:00:00Z' }]),
    runStats: async () => ({}),
  };
  await executors.RunHistory({}, { scope: 'all' }, ctx({ services, user: { id: 'u1', email: 'u@x', role: 'user' } }));
  await executors.RunHistory({}, { scope: 'all' }, ctx({ services, user: { id: 'a1', email: 'a@x', role: 'admin' } }));
  assert.deepEqual(calls, [{ userId: 'u1', limit: 50 }, { userId: undefined, limit: 50 }]);
});

test('UIEventTrigger returns the event payload, else the sample payload', async () => {
  assert.deepEqual(await executors.UIEventTrigger(null, { samplePayload: '{ "domain": "X" }' }, ctx()), { domain: 'X' });
  assert.deepEqual(await executors.UIEventTrigger(null, { samplePayload: '{}' }, ctx({ webhookMock: { value: { a: 1 } } })), { a: 1 });
});
