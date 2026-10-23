/* eslint-disable @typescript-eslint/no-explicit-any -- node I/O is untyped JSON */
/**
 * Nodes that connect workflows to the end-user app: UI/chat triggers, field
 * mapping, the RespondToUI terminal node and the platform history/stats nodes.
 */
import { isPlainObject, mergeOutput, pingAgentService, type ExecutionContext, type Executor } from './node-runtime.js';
import { interpolate, interpolateJson, readPath } from './interpolate.js';

export const NO_CITATION_TEXT = 'No supporting citation was returned by the knowledge source.';

/**
 * Trigger output: the event payload the API server passes in (`ctx.webhookMock`),
 * or the node's sample payload for test runs in the builder and CLI.
 */
function triggerPayload(params: Record<string, string>, ctx: ExecutionContext, fallback: unknown): unknown {
  if (ctx.webhookMock) return ctx.webhookMock.value;
  return interpolateJson(params.samplePayload ?? '', null, ctx.warn, fallback);
}

// ---- RespondToUI ----

interface Source {
  doc_name: string;
  url: string;
  doc_type?: string;
  version?: string;
  modified?: string;
}

/** Normalizes whatever an upstream node produced into UI blocks. */
function toBlocks(value: unknown): Record<string, any>[] {
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'string') return [{ type: 'markdown', text: value }];
  if (Array.isArray(value)) return value.flatMap(toBlocks);
  if (isPlainObject(value)) {
    if (typeof value.type === 'string') return [value];
    if (Array.isArray(value.blocks)) return toBlocks(value.blocks);
    if (typeof value.text === 'string') return [{ type: 'markdown', text: value.text }];
  }
  return [{ type: 'markdown', text: '```json\n' + JSON.stringify(value, null, 2) + '\n```' }];
}

function sourcesFrom(chunks: unknown): Record<string, Source> {
  if (!Array.isArray(chunks)) return {};
  return Object.fromEntries(
    chunks
      .filter((c) => isPlainObject(c) && c.id !== undefined)
      .map((c) => {
        const meta = isPlainObject(c.metadata) ? c.metadata : c;
        return [
          String(c.id),
          {
            doc_name: String(meta.doc_name ?? meta.name ?? meta.source ?? 'Document'),
            url: String(meta.url ?? meta.webUrl ?? ''),
            doc_type: meta.doc_type,
            version: meta.version,
            modified: meta.modified ?? meta.lastModified,
          },
        ];
      }),
  );
}

/** Drops citation ids that were not retrieved in this run; returns how many were removed. */
function validateCitations(blocks: Record<string, any>[], sources: Record<string, Source>): number {
  let removed = 0;
  const clean = (entry: any) => {
    if (!isPlainObject(entry) || !Array.isArray(entry.citations)) return;
    const kept = entry.citations.map(String).filter((id: string) => id in sources);
    removed += entry.citations.length - kept.length;
    entry.citations = kept;
  };
  for (const block of blocks) {
    if (Array.isArray(block.rows)) block.rows.forEach(clean);
    if (Array.isArray(block.items)) block.items.forEach(clean);
  }
  return removed;
}

// ---- Mock platform data for builder/CLI runs (no API server services) ----

const MOCK_RUNS = [
  { id: 'run_mock1', event_key: 'manzil.domain', workflow_name: 'Manzil — Domain report', status: 'completed', duration_ms: 8420, started_at: '2026-10-20T09:15:00Z', user_email: 'user@example.com' },
  { id: 'run_mock2', event_key: 'manzil.chat', workflow_name: 'Manzil — Chat', status: 'failed', duration_ms: 1200, started_at: '2026-10-20T09:02:00Z', user_email: 'user@example.com' },
];

const MOCK_STATS = {
  total: 42, completed: 39, failed: 3, avgMs: 7300, users: 5,
  byEvent: [{ event_key: 'manzil.chat', total: 25, failed: 2, avg_ms: 8100 }, { event_key: 'manzil.domain', total: 17, failed: 1, avg_ms: 6200 }],
  byDay: [{ day: '2026-10-19', total: 18 }, { day: '2026-10-20', total: 24 }],
};

const MOCK_STATUS = {
  running: 1, runs24h: 24, failed24h: 1, lastRunAt: '2026-10-20T09:15:00Z',
  published: [
    { event_key: 'manzil.overview', name: 'Manzil — Overview', version: 1 },
    { event_key: 'manzil.domain', name: 'Manzil — Domain report', version: 3 },
    { event_key: 'manzil.chat', name: 'Manzil — Chat', version: 2 },
  ],
};

function requireServices(ctx: ExecutionContext, node: string) {
  if (ctx.services) return ctx.services;
  if (!ctx.live) return undefined; // mock data below
  throw new Error(`${node} reads platform run history; it only works when the workflow runs on the API server`);
}

const formatMs = (ms: unknown) => (typeof ms === 'number' ? `${(ms / 1000).toFixed(1)} s` : '—');

export const appExecutors: Record<string, Executor> = {
  UIEventTrigger: async (_input, params, ctx) => triggerPayload(params, ctx, {}),

  ChatTrigger: async (_input, params, ctx) =>
    triggerPayload(params, ctx, { message: 'Material Status', sessionId: 'test-session', history: [] }),

  SetFields: async (input, params, ctx) => {
    const values = interpolateJson(params.values ?? '', input, ctx.warn);
    if (!isPlainObject(values)) throw new Error('SetFields: "Values" must be a JSON object');
    if (params.mode === 'replace') return values;
    return { ...(isPlainObject(input) ? input : {}), ...values };
  },

  RespondToUI: async (input, params, ctx) => {
    const paths = (params.blocksFrom ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    const values = paths.map((path) => readPath(input, path));
    const blocks = values.flatMap(toBlocks).map((b) => structuredClone(b));
    const reportTitle = values.find((v) => isPlainObject(v) && typeof v.title === 'string') as { title?: string } | undefined;
    const title = interpolate(params.title ?? '', input, ctx.warn) || reportTitle?.title || '';

    let sources: Record<string, Source> = {};
    if (params.sourcesFrom?.trim()) {
      sources = sourcesFrom(readPath(input, params.sourcesFrom));
      const removed = validateCitations(blocks, sources);
      if (removed > 0) {
        blocks.push({
          type: 'markdown',
          title: 'Citation check',
          text: `${removed} citation(s) referenced documents that were not retrieved and were removed. ${NO_CITATION_TEXT}`,
        });
      }
    }
    if (blocks.length === 0 && params.emptyMessage) blocks.push({ type: 'markdown', text: interpolate(params.emptyMessage, input, ctx.warn) });
    return { title, blocks, sources };
  },

  RunHistory: async (input, params, ctx) => {
    const services = requireServices(ctx, 'RunHistory');
    const all = params.scope === 'all' && ctx.user?.role === 'admin';
    const limit = Number(params.limit) > 0 ? Math.min(Number(params.limit), 500) : 50;
    const runs = services ? await services.runHistory({ userId: all ? undefined : ctx.user?.id, limit }) : MOCK_RUNS;
    if (params.layout === 'feed') {
      const feed = {
        type: 'activityFeed',
        title: params.title || 'AI Activity',
        items: runs.map((r: any) => ({
          title: r.label || r.workflow_name || r.event_key,
          detail: r.workflow_name ?? r.event_key,
          status: r.status === 'completed' ? 'Completed' : r.status === 'failed' ? 'Failed' : 'In Progress',
          at: new Date(r.started_at).toISOString(),
          duration: formatMs(r.duration_ms),
          ...(all ? { user: r.user_email ?? '' } : {}),
        })),
      };
      return mergeOutput(input, params.outputField || 'activity', feed);
    }
    const columns = ['When', 'Action', 'Status', 'Duration', ...(all ? ['User'] : [])];
    const block = {
      type: 'table',
      title: params.title || 'AI Activity',
      columns,
      rows: runs.map((r: any) => ({
        cells: [
          new Date(r.started_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
          r.label || r.workflow_name || r.event_key,
          r.status === 'completed' ? 'Completed' : r.status === 'failed' ? 'Failed' : 'In Progress',
          formatMs(r.duration_ms),
          ...(all ? [r.user_email ?? ''] : []),
        ],
      })),
    };
    return mergeOutput(input, params.outputField || 'activity', block);
  },

  RunStats: async (input, params, ctx) => {
    const services = requireServices(ctx, 'RunStats');
    const all = params.scope === 'all' && ctx.user?.role === 'admin';
    const days = Number(params.days) > 0 ? Math.min(Number(params.days), 365) : 30;
    const s: any = services ? await services.runStats({ userId: all ? undefined : ctx.user?.id, days }) : MOCK_STATS;
    const successRate = s.total ? `${Math.round((s.completed / s.total) * 100)}%` : '—';
    const trend = s.byDay.map((d: any) => d.total);
    const kpis = {
      type: 'kpiCards',
      title: `Last ${days} days`,
      cards: [
        { title: 'AI requests', value: String(s.total), description: `${s.failed} failed`, tone: 'blue', icon: 'activity', trend },
        { title: 'Success rate', value: successRate, description: 'Completed runs', tone: 'green', icon: 'check' },
        { title: 'Avg response time', value: formatMs(s.avgMs), description: 'End-to-end', tone: 'orange', icon: 'clock' },
        ...(all ? [{ title: 'Active users', value: String(s.users), description: 'Distinct users', tone: 'grey', icon: 'users' }] : []),
      ],
    };
    if (params.layout === 'kpis') return mergeOutput(input, params.outputField || 'analytics', kpis);
    const blocks = [
      kpis,
      { type: 'barChart', title: 'Requests per day', labels: s.byDay.map((d: any) => d.day), values: s.byDay.map((d: any) => d.total) },
      {
        type: 'table',
        title: 'By action',
        columns: ['Action', 'Requests', 'Failed', 'Avg time'],
        rows: s.byEvent.map((e: any) => ({ cells: [e.label || e.event_key, String(e.total), String(e.failed), formatMs(e.avg_ms)] })),
      },
    ];
    return mergeOutput(input, params.outputField || 'analytics', blocks);
  },

  // `include`: workflows (default) is the live-workflows card only; health is the system status card; both is both.
  PlatformStatus: async (input, params, ctx) => {
    const services = requireServices(ctx, 'PlatformStatus');
    const include = params.include || 'workflows';
    const health = include === 'health' || include === 'both';
    const [s, agent]: [any, Awaited<ReturnType<typeof pingAgentService>>] = await Promise.all([
      services ? services.platformStatus({ role: ctx.user?.role ?? 'user' }) : MOCK_STATUS,
      health && (ctx.live || services) ? pingAgentService(ctx) : { ok: true, ms: 12 },
    ]);
    const published: any[] = s.published ?? [];
    const lastRun = s.lastRunAt ? new Date(s.lastRunAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'No runs yet';
    const healthBlock = {
      type: 'statusList',
      title: params.title || 'System status',
      items: [
        { label: 'Workflow engine', status: 'ok', detail: `${published.length} workflow(s) live` },
        { label: 'AI agent service', status: agent.ok ? 'ok' : 'down', detail: agent.ok ? `Responding in ${agent.ms} ms` : 'Unreachable' },
        { label: 'Run mode', status: ctx.live ? 'ok' : 'warn', detail: ctx.live ? 'Live models and connectors' : 'Mock (demo data)' },
        { label: 'Runs in progress', status: 'ok', detail: `${s.running ?? 0} now · ${s.runs24h ?? 0} in 24 h` },
        { label: 'Failures (24 h)', status: s.failed24h > 0 ? 'warn' : 'ok', detail: s.failed24h > 0 ? `${s.failed24h} failed run(s)` : 'None' },
        { label: 'Last activity', status: 'ok', detail: lastRun },
      ],
    };
    const workflowsBlock = {
      type: 'statusList',
      title: 'Live workflows',
      items: published.map((p) => ({ label: p.name, status: 'ok', detail: `${p.event_key} · v${p.version}` })),
    };
    const blocks = include === 'health' ? [healthBlock] : include === 'both' ? [healthBlock, workflowsBlock] : [workflowsBlock];
    return mergeOutput(input, params.outputField || 'status', blocks);
  },
};
