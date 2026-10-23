/**
 * Guardrail policy enforcement. The tenant admin picks an action per check in
 * the admin console (guardrail_policies); every published-workflow run reads
 * the live rows here, so a dropdown change applies to the next run with no
 * code or republish. Each enforcement writes a guardrail_events row: open
 * events are the admin's alert queue, and the end user sees what happened on
 * their own runs in the AI Activity page (via runHistory).
 */
import { nanoid } from 'nanoid';
import type { RunUser } from '../cli/node-runtime.js';
import type { UiResponse } from '../frontend/src/manzil/types.js';
import type { Db } from './db/index.js';

export type GuardrailAction = 'block' | 'block_page_admin' | 'mask_log' | 'warn' | 'log';

export const GUARDRAIL_ACTIONS: Record<GuardrailAction, string> = {
  block: 'Block',
  block_page_admin: 'Block and page admin',
  mask_log: 'Mask and log',
  warn: 'Warn user',
  log: 'Log',
};

const SEVERITY: Record<GuardrailAction, string> = {
  block: 'High',
  block_page_admin: 'Critical',
  mask_log: 'Medium',
  warn: 'Low',
  log: 'Low',
};

/** Indian PII the pii check looks for in workflow output. Order matters: Aadhaar before bare digits. */
const PII_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'Aadhaar number', re: /\b\d{4}[ -]\d{4}[ -]\d{4}\b|\b\d{12}\b/g },
  { label: 'PAN number', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  { label: 'Phone number', re: /\+91[ -]?\d{5}[ -]?\d{5}\b/g },
];

const maskValue = (match: string) => `••••${match.slice(-4)}`;

export async function getGuardrailPolicies(db: Db): Promise<Map<string, GuardrailAction>> {
  const rows = await db.query<{ check_key: string; action: GuardrailAction }>('SELECT check_key, action FROM guardrail_policies');
  return new Map(rows.map((r) => [r.check_key, r.action]));
}

/** Walks every string in the UI JSON, applying `fn`; counts per PII label land in `found`. */
function scanStrings(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => scanStrings(v, fn));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scanStrings(v, fn)]));
  }
  return value;
}

export interface GuardrailOutcome {
  ui: UiResponse;
  /** Short per-run notes ("PII masked: Aadhaar number"), also stored as events. */
  notes: string[];
  blocked: boolean;
}

/**
 * Applies the live pii policy to a run's UI response before it reaches the
 * user (and before it is stored as chat history).
 */
export async function applyGuardrails(
  db: Db,
  run: { ui: UiResponse; runId: string; eventKey: string; user: RunUser },
): Promise<GuardrailOutcome> {
  const policies = await getGuardrailPolicies(db);
  const action = policies.get('pii') ?? 'mask_log';

  const found = new Map<string, number>();
  const detect = (text: string) => {
    for (const { label, re } of PII_PATTERNS) {
      const hits = text.match(re)?.length ?? 0;
      if (hits > 0) found.set(label, (found.get(label) ?? 0) + hits);
    }
    return text;
  };
  scanStrings(run.ui, detect);
  if (found.size === 0) return { ui: run.ui, notes: [], blocked: false };

  const labels = [...found.keys()].join(', ');
  const total = [...found.values()].reduce((a, b) => a + b, 0);
  const verb = action === 'mask_log' ? 'masked' : action.startsWith('block') ? 'blocked' : 'detected';
  const title = `PII ${verb}: ${labels}`;
  const note = `${title} (policy: ${GUARDRAIL_ACTIONS[action]})`;

  await db.query(
    `INSERT INTO guardrail_events (id, run_id, user_id, event_key, check_key, action, severity, title, detail)
     VALUES ($1, $2, $3, $4, 'pii', $5, $6, $7, $8)`,
    [`gev_${nanoid(10)}`, run.runId, run.user.id, run.eventKey, action, SEVERITY[action], title, `${total} value(s) in the response for "${run.eventKey}"`],
  );

  if (action === 'log') return { ui: run.ui, notes: [note], blocked: false };

  if (action === 'warn') {
    const blocks = [
      ...run.ui.blocks,
      {
        type: 'markdown',
        title: 'Guardrail warning',
        text: `This response may contain personal data (${labels}). Handle it according to your data policy.`,
      },
    ];
    return { ui: { ...run.ui, blocks }, notes: [note], blocked: false };
  }

  if (action === 'mask_log') {
    const mask = (text: string) => PII_PATTERNS.reduce((t, { re }) => t.replace(re, maskValue), text);
    return { ui: scanStrings(run.ui, mask) as UiResponse, notes: [note], blocked: false };
  }

  // block / block_page_admin: the user never sees the response.
  const ui: UiResponse = {
    title: 'Response blocked by a guardrail',
    blocks: [
      {
        type: 'markdown',
        text: `The response contained personal data (${labels}) and your organization's policy is set to block it. Contact your administrator if you believe this is a mistake.`,
      },
    ],
  };
  return { ui, notes: [note], blocked: true };
}
