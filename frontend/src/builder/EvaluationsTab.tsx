import { CheckCircle2, Loader2, Play, Plus, Trash2, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { runWorkflow } from '../api/run';
import { serializeWorkflow } from '../lib/serialize';
import { useWorkflowStore } from '../store/useWorkflowStore';
import type { RunMode } from '../types';

interface EvalCase {
  id: string;
  event_key: string;
  name: string;
  payload: Record<string, unknown>;
  expect_contains: string;
  last_status: 'not_run' | 'passed' | 'failed';
  last_detail: string;
  last_run_at: string | null;
}

const field = 'rounded-md border border-line bg-page px-2.5 py-1.5 text-sm text-fg placeholder:text-faint focus:border-line-strong focus:outline-none';
const btn = 'inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-fg-soft hover:bg-hover disabled:opacity-50';

/** Everything the run produced, as text, so a case can assert on any of it. */
function runText(nodes: { type: string; output?: unknown; status: string }[]): string {
  return JSON.stringify(nodes.map((n) => n.output ?? null));
}

/**
 * Evaluation cases for the workflow on the canvas: a sample payload and what the answer
 * must contain. Running a case executes the current canvas, so it tests unsaved edits too.
 */
export function EvaluationsTab({ eventKey }: { eventKey: string }) {
  const [cases, setCases] = useState<EvalCase[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<RunMode>('mock');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', payload: '{}', expectContains: '' });
  const nodeCount = useWorkflowStore((s) => s.nodes.length);

  const load = useCallback(() => {
    api<EvalCase[]>(`/api/fde/evaluations${eventKey ? `?eventKey=${encodeURIComponent(eventKey)}` : ''}`)
      .then(setCases)
      .catch((err: Error) => setError(err.message));
  }, [eventKey]);
  useEffect(load, [load]);

  const runCase = async (c: EvalCase) => {
    setBusy(c.id);
    setError(undefined);
    try {
      const { workflowName, nodes, edges } = useWorkflowStore.getState();
      const workflow = serializeWorkflow(workflowName.trim() || 'Untitled', nodes, edges);
      let passed = false;
      let detail: string;
      try {
        const result = await runWorkflow(workflow, { mode, mockPayload: c.payload });
        const failedNode = result.nodes.find((n) => n.status === 'failed');
        if (result.status === 'failed' || failedNode) {
          detail = failedNode ? `${failedNode.type} failed: ${failedNode.error ?? 'unknown error'}` : (result.error ?? 'The run failed.');
        } else if (c.expect_contains && !runText(result.nodes).toLowerCase().includes(c.expect_contains.toLowerCase())) {
          detail = `Ran in ${(result.durationMs / 1000).toFixed(1)} s but the output does not contain "${c.expect_contains}".`;
        } else {
          passed = true;
          detail = `Ran ${result.nodes.length} nodes in ${(result.durationMs / 1000).toFixed(1)} s${c.expect_contains ? `, output contains "${c.expect_contains}"` : ''}.`;
        }
      } catch (err) {
        detail = (err as Error).message;
      }
      await api(`/api/fde/evaluations/${c.id}/result`, { body: { passed, detail } });
      load();
    } finally {
      setBusy(null);
    }
  };

  const runAll = async () => {
    for (const c of cases ?? []) await runCase(c);
  };

  const onAdd = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('add');
    setError(undefined);
    try {
      await api('/api/fde/evaluations', { body: { eventKey, ...form } });
      setForm({ name: '', payload: '{}', expectContains: '' });
      setAdding(false);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const passed = cases?.filter((c) => c.last_status === 'passed').length ?? 0;
  const ran = cases?.filter((c) => c.last_status !== 'not_run').length ?? 0;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-fg">Evaluations</h2>
          <p className="text-xs text-muted">
            Sample requests and what the answer must contain. They run against the canvas as it is now, so you can check an edit before submitting
            it for approval.
            {ran > 0 && (
              <>
                {' '}
                Last results: <b className="text-fg">{passed} of {ran}</b> passed.
              </>
            )}
          </p>
        </div>
        <div role="radiogroup" aria-label="Run mode" className="flex items-center gap-0.5 rounded-md border border-line p-0.5">
          {(['mock', 'live'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${mode === m ? 'bg-hover text-fg ring-1 ring-line-strong/60' : 'text-subtle hover:text-fg-soft'}`}
            >
              {m}
            </button>
          ))}
        </div>
        <button type="button" className={btn} onClick={() => setAdding(!adding)}>
          <Plus size={13} /> Add case
        </button>
        <button type="button" className={btn} disabled={busy !== null || !cases?.length || nodeCount === 0} onClick={() => void runAll()}>
          {busy && busy !== 'add' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run all
        </button>
      </div>

      {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      {!eventKey && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950 dark:text-amber-200">
          Give the trigger node an event key first — cases are stored against it.
        </p>
      )}

      {adding && (
        <form onSubmit={onAdd} className="grid gap-2 rounded-xl border border-line bg-panel p-3 sm:grid-cols-3">
          <input className={field} required placeholder="Case name, e.g. Material status for PRJ-001" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={`${field} font-mono text-xs`} placeholder='Sample payload JSON, e.g. {"domain":"Material Status"}' value={form.payload} onChange={(e) => setForm({ ...form, payload: e.target.value })} />
          <input className={field} placeholder="Answer must contain (optional)" value={form.expectContains} onChange={(e) => setForm({ ...form, expectContains: e.target.value })} />
          <div className="sm:col-span-3">
            <button type="submit" className={btn} disabled={busy !== null || !eventKey}>
              {busy === 'add' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add case
            </button>
          </div>
        </form>
      )}

      <ul className="overflow-hidden rounded-xl border border-line bg-panel">
        {cases?.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-muted">No evaluation cases yet. Add one to check this workflow keeps answering correctly.</li>
        )}
        {cases?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 border-t border-line px-3 py-2.5 first:border-t-0">
            <span className="shrink-0">
              {c.last_status === 'passed' ? (
                <CheckCircle2 size={16} className="text-emerald-600" aria-label="Passed" />
              ) : c.last_status === 'failed' ? (
                <XCircle size={16} className="text-red-600" aria-label="Failed" />
              ) : (
                <span className="inline-block h-4 w-4 rounded-full border border-dashed border-faint" aria-label="Not run" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-fg">{c.name}</span>
              <span className="block truncate text-xs text-subtle" title={c.last_detail}>
                {c.last_detail || `Payload ${JSON.stringify(c.payload)}${c.expect_contains ? ` · expects "${c.expect_contains}"` : ''}`}
              </span>
            </span>
            <button type="button" className={btn} disabled={busy !== null || nodeCount === 0} onClick={() => void runCase(c)}>
              {busy === c.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run
            </button>
            <button
              type="button"
              className={btn}
              disabled={busy !== null}
              onClick={() =>
                window.confirm(`Delete the case "${c.name}"?`) &&
                void api(`/api/fde/evaluations/${c.id}`, { method: 'DELETE' }).then(load)
              }
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
