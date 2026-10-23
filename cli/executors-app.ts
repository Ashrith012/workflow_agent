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

const count = (value: unknown): number | undefined => (Array.isArray(value) ? value.length : undefined);

/** "Manzil — Domain Report" reads as the assistant "Domain Report" in the activity timeline. */
function agentName(workflowName: unknown, eventKey: unknown): string {
  const name = String(workflowName ?? '').trim();
  if (!name) return String(eventKey ?? 'An assistant');
  // Strip a product prefix ("Manzil — Chat") so the assistant's own name leads the sentence.
  const parts = name.split(/\s+[—–-]\s+/);
  return (parts.length > 1 ? parts.slice(1).join(' — ') : name).trim() || name;
}

/** What the run touched, as verbs an end user recognises. */
function touched(nodes: { type: string }[]): string[] {
  const types = new Set(nodes.map((n) => n.type));
  const out: string[] = [];
  if (types.has('QdrantSearch')) out.push('searched your documents');
  if (types.has('SharePoint') || types.has('SharePointMCP')) out.push('read SharePoint');
  if (types.has('RunHistory') || types.has('RunStats') || types.has('PlatformStatus')) out.push('read your activity');
  if (types.has('AIAgent')) out.push('asked the AI model');
  return out;
}

/** A sentence naming who did what, e.g. `Domain Report answered "Material Status"`. */
function activityTitle(run: any, nodes: { type: string }[]): string {
  const who = agentName(run.workflow_name, run.event_key);
  const what = String(run.label ?? '').trim();
  // When the label is just the workflow's own name it adds nothing to the sentence.
  const useLabel = what && what.toLowerCase() !== who.toLowerCase();
  const about = useLabel ? ` “${what.length > 80 ? `${what.slice(0, 80)}…` : what}”` : '';
  if (run.status === 'failed') return `${who} could not finish${about}`;
  if (run.status !== 'completed') return `${who} is working on${about || ' your request'}`;
  const did = touched(nodes);
  if (did.length === 0) return `${who} answered${about}`;
  return `${who} ${did.slice(0, 2).join(' and ')}, then answered${about}`;
}

function activityDetail(run: any, nodes: { type: string }[]): string {
  const parts = [`${nodes.length} step${nodes.length === 1 ? '' : 's'}`];
  if (run.status === 'failed' && run.error) parts.push(String(run.error).slice(0, 120));
  else if (run.user_email) parts.push(String(run.user_email));
  return parts.join(' · ');
}

/**
 * The run's steps in order. A conditional node that was skipped records itself as
 * completed in no time at all; repeating its sentence would tell the reader a step
 * happened twice, so an instant repeat is dropped.
 */
function describeSteps(nodes: any[]): { text: string; status: string; duration: string }[] {
  const steps: { text: string; status: string; duration: string }[] = [];
  for (const n of nodes) {
    const text = n.status === 'failed' ? `${explainStep(n)} This step failed, so the run stopped here.` : explainStep(n);
    const instant = Number(n.duration_ms) < 50;
    if (instant && steps.some((s) => s.text === text)) continue;
    steps.push({ text, status: n.status, duration: formatMs(n.duration_ms) });
  }
  return steps;
}

function guardrailTitle(guardrails: string): string {
  const action = /masked/i.test(guardrails) ? 'masked' : /blocked/i.test(guardrails) ? 'blocked' : 'checked';
  return `A guardrail ${action} personal data in the answer`;
}

/**
 * One plain-words sentence per executed node, so AI Activity can walk an end
 * user through what the run actually did — what it received, searched, read
 * and produced. Output-aware where the stored output says more (counts, categories).
 */
function explainStep(node: { type: string; status: string; output?: any }): string {
  const out = isPlainObject(node.output) ? node.output : {};
  const chunks = count(out.chunks);
  switch (node.type) {
    case 'UIEventTrigger':
      return 'Received your request from the app.';
    case 'ChatTrigger':
      return 'Read your message and the recent conversation.';
    case 'TextClassifier':
      return out.classification && isPlainObject(out.classification) && out.classification.category
        ? `Worked out what you are asking about: "${String(out.classification.category)}".`
        : 'Worked out what kind of request this is.';
    case 'SetFields':
      return 'Organized the request details for the next steps.';
    case 'Embeddings':
      return 'Converted the question into a searchable form.';
    case 'QdrantSearch':
      return chunks !== undefined
        ? `Searched the document index and found ${chunks} relevant passage${chunks === 1 ? '' : 's'}.`
        : 'Searched the document index for relevant passages.';
    case 'QdrantUpsert':
      return 'Saved document passages to the search index.';
    case 'SharePoint': {
      const items = count(out.files) ?? count(out.items) ?? chunks;
      return items !== undefined ? `Read ${items} item${items === 1 ? '' : 's'} from SharePoint.` : 'Read documents from SharePoint.';
    }
    case 'SharePointMCP':
      return 'Used the SharePoint connector to fetch data.';
    case 'DocumentParser':
      return 'Extracted the text out of the documents.';
    case 'TextSplitter':
      return chunks !== undefined ? `Split the documents into ${chunks} passages for searching.` : 'Split the documents into passages for searching.';
    case 'AIAgent':
      return 'Asked the AI model to read the gathered information and write the answer.';
    case 'RunHistory':
      return 'Read your recent AI activity.';
    case 'RunStats':
      return 'Calculated usage statistics from your runs.';
    case 'PlatformStatus':
      return 'Checked which features are live.';
    case 'RespondToUI':
      return 'Prepared the answer that was shown to you.';
    default:
      return `Ran the ${node.type} step.`;
  }
}

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
    // Guardrail notes ("PII masked — policy: Mask and log") appear when any run has them.
    const hasGuardrails = runs.some((r: any) => r.guardrails);
    if (params.layout !== 'table' && params.layout !== 'feed') {
      // Default: a timeline of what the assistants did, newest first. Each entry opens
      // into a plain-words, step-by-step account of the run, and a guardrail that acted
      // on a run gets an entry of its own so it is not buried inside it.
      const items: Record<string, unknown>[] = [];
      for (const r of runs as any[]) {
        const nodes = Array.isArray(r.nodes) ? r.nodes : [];
        items.push({
          title: activityTitle(r, nodes),
          detail: activityDetail(r, nodes),
          tone: r.status === 'failed' ? 'failed' : r.status === 'completed' ? 'agent' : 'running',
          status: r.status === 'completed' ? 'Completed' : r.status === 'failed' ? 'Failed' : 'In Progress',
          at: new Date(r.started_at).toISOString(),
          duration: formatMs(r.duration_ms),
          ...(all ? { user: r.user_email ?? '' } : {}),
          steps: describeSteps(nodes),
        });
        if (r.guardrails) {
          items.push({
            title: guardrailTitle(r.guardrails),
            detail: `${r.guardrails}. Your organization's policy decided this, not the assistant.`,
            tone: 'guardrail',
            at: new Date(r.started_at).toISOString(),
            duration: '',
            steps: [],
          });
        }
      }
      const log = {
        type: 'activityLog',
        title: params.title || 'AI Activity',
        description: params.description || 'Everything the assistants did with your data or on your behalf.',
        items,
      };
      return mergeOutput(input, params.outputField || 'activity', log);
    }
    if (params.layout === 'feed') {
      const feed = {
        type: 'activityFeed',
        title: params.title || 'AI Activity',
        items: runs.map((r: any) => ({
          title: r.label || r.workflow_name || r.event_key,
          detail: [r.workflow_name ?? r.event_key, r.guardrails].filter(Boolean).join(' · '),
          status: r.status === 'completed' ? 'Completed' : r.status === 'failed' ? 'Failed' : 'In Progress',
          at: new Date(r.started_at).toISOString(),
          duration: formatMs(r.duration_ms),
          ...(all ? { user: r.user_email ?? '' } : {}),
        })),
      };
      return mergeOutput(input, params.outputField || 'activity', feed);
    }
    const columns = ['When', 'Action', 'Status', 'Duration', ...(hasGuardrails ? ['Guardrails'] : []), ...(all ? ['User'] : [])];
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
          ...(hasGuardrails ? [r.guardrails ?? '—'] : []),
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
    // Raw numbers, for a workflow that composes its own cards in the words of its domain.
    if (params.layout === 'values') {
      return mergeOutput(input, params.outputField || 'analytics', {
        total: s.total,
        completed: s.completed,
        failed: s.failed,
        users: s.users,
        days,
        successRate,
        avgTime: formatMs(s.avgMs),
        busiestDay: s.byDay.reduce((best: any, d: any) => (!best || d.total > best.total ? d : best), null)?.day ?? '',
      });
    }
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
