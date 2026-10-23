import { performance } from 'node:perf_hooks';
import type { ExecutionResult, ExportedNode, ExportedWorkflow, NodeResult, RunMode } from '../frontend/src/types.js';
import { executors, type ExecutionContext, type PlatformServices, type RunUser } from './executors.js';
import { parentsInOrder, topologicalSort } from './graph.js';
import { warn as stderrWarn } from './log.js';
import { findCycle } from './validate.js';

export type { ExecutionResult, NodeResult, RunMode } from '../frontend/src/types.js';

export interface ExecuteOptions {
  mode: RunMode;
  /** WebhookTrigger output instead of the default payload. `undefined` = use the default. */
  mockPayload?: unknown;
  /** Checked before each node and forwarded to network calls. */
  signal?: AbortSignal;
  /** Non-fatal warnings (multi-parent merge, unresolved placeholders, ...). Defaults to stderr. */
  warn?: (message: string) => void;
  /** Called after each node finishes, so callers can stream progress. `error` is the raw thrown value. */
  onNodeComplete?: (result: NodeResult, step: { index: number; total: number }, error?: Error) => void;
  /** Who the run acts for, and platform data access; set by the API server. */
  user?: RunUser;
  services?: PlatformServices;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** A root node gets null, one parent passes its output through, several are shallow-merged. */
function resolveInput(
  node: ExportedNode,
  nodeParents: string[],
  outputs: Map<string, unknown>,
  warn: (message: string) => void,
): unknown {
  if (nodeParents.length === 0) return null;
  if (nodeParents.length === 1) return outputs.get(nodeParents[0]);

  warn(`${node.id} has ${nodeParents.length} parents — shallow merge (Phase 0 limitation)`);
  const merged: Record<string, unknown> = {};
  for (const parentId of nodeParents) {
    const out = outputs.get(parentId);
    if (isPlainObject(out)) Object.assign(merged, out);
    else warn(`${node.id}: output of parent ${parentId} is not an object; skipped in merge`);
  }
  return merged;
}

/**
 * Run a validated workflow: topological sort, then each node in order.
 * Never writes to stdout and never throws for node failures — the first
 * failing node stops the run and is reported in the result. Callers should
 * run `validateWorkflowShape` first; a cycle is reported as a failed run.
 */
export async function executeWorkflow(
  workflow: ExportedWorkflow,
  options: ExecuteOptions,
): Promise<ExecutionResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  const sorted = topologicalSort(workflow);
  if (!sorted.ok) {
    return { status: 'failed', nodes: [], output: null, durationMs: elapsed(), error: findCycle(workflow)!.message };
  }
  const { order } = sorted;
  const parents = parentsInOrder(order, workflow.edges);

  const ctx: ExecutionContext = {
    live: options.mode === 'live',
    webhookMock: options.mockPayload !== undefined ? { value: options.mockPayload } : undefined,
    warn: options.warn ?? stderrWarn,
    signal: options.signal,
    user: options.user,
    services: options.services,
  };

  const outputs = new Map<string, unknown>();
  const results: NodeResult[] = [];

  for (const [index, node] of order.entries()) {
    if (options.signal?.aborted) {
      return { status: 'failed', nodes: results, output: null, durationMs: elapsed(), error: 'Execution aborted' };
    }

    const input = resolveInput(node, parents.get(node.id)!, outputs, ctx.warn);
    const step = { index, total: order.length };
    const t0 = performance.now();
    try {
      const output: unknown = await executors[node.type](input, node.parameters, ctx);
      outputs.set(node.id, output);
      const result: NodeResult = {
        id: node.id,
        type: node.type,
        status: 'completed',
        durationMs: Math.round(performance.now() - t0),
        input,
        output,
      };
      results.push(result);
      options.onNodeComplete?.(result, step);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const result: NodeResult = {
        id: node.id,
        type: node.type,
        status: 'failed',
        durationMs: Math.round(performance.now() - t0),
        input,
        output: null,
        error: error.message,
      };
      results.push(result);
      options.onNodeComplete?.(result, step, error);
      return {
        status: 'failed',
        nodes: results,
        output: null,
        durationMs: elapsed(),
        error: `Node ${node.id} (${node.type}) failed: ${error.message}`,
      };
    }
  }

  // Terminal nodes are those with no outgoing edge.
  const sources = new Set(workflow.edges.map((e) => e.source));
  const output = Object.fromEntries(order.filter((n) => !sources.has(n.id)).map((n) => [n.id, outputs.get(n.id)]));
  return { status: 'completed', nodes: results, output, durationMs: elapsed() };
}
