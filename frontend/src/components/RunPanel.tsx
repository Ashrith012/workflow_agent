import { AlertTriangle, CheckCircle2, ChevronRight, CircleDashed, Loader2, Play, Square, X, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { getNodeDefinition } from '../nodes/registry';
import type { ExportedWorkflow, NodeResult, RunMode, RunResponse } from '../types';

export type RunState =
  | { phase: 'idle' }
  | { phase: 'running'; mode: RunMode; workflow: ExportedWorkflow }
  | { phase: 'done'; mode: RunMode; result: RunResponse }
  | { phase: 'stopped'; mode: RunMode }
  | { phase: 'error'; mode: RunMode; message: string; status?: number; details?: unknown };

interface RunPanelProps {
  run: RunState;
  onClose: () => void;
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2) ?? 'undefined';

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-subtle">{label}</div>
      <pre className="max-h-56 overflow-auto rounded-md border border-line bg-page px-2.5 py-2 font-mono text-xs leading-5 text-fg-soft">
        {pretty(value)}
      </pre>
    </div>
  );
}

function NodeLabel({ type, id }: { type: string; id: string }) {
  const definition = getNodeDefinition(type);
  const Icon = definition?.icon;
  return (
    <span className="flex min-w-0 items-center gap-2">
      {Icon && <Icon size={14} style={{ color: definition.accentColor }} className="shrink-0" />}
      <span className="font-medium text-fg">{type}</span>
      <span className="truncate font-mono text-xs text-subtle">({id})</span>
    </span>
  );
}

function NodeRow({ node }: { node: NodeResult }) {
  const failed = node.status === 'failed';
  return (
    <li>
      <details
        className={`group rounded-md border ${
          failed
            ? 'border-red-300 bg-red-50 dark:border-red-900/70 dark:bg-red-950/40'
            : 'border-line bg-panel'
        }`}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2 text-sm hover:bg-hover [&::-webkit-details-marker]:hidden">
          <ChevronRight size={14} className="shrink-0 text-subtle transition-transform group-open:rotate-90" />
          {failed ? (
            <XCircle size={15} className="shrink-0 text-red-600 dark:text-red-400" />
          ) : (
            <CheckCircle2 size={15} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          )}
          <NodeLabel type={node.type} id={node.id} />
          <span className="ml-auto shrink-0 font-mono text-xs text-muted">{node.durationMs}ms</span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-line px-3 py-3 lg:flex-row">
          <JsonBlock label="Input" value={node.input} />
          {!failed && <JsonBlock label="Output" value={node.output} />}
        </div>
      </details>
      {failed && (
        <p className="mt-1 whitespace-pre-wrap break-words px-3 font-mono text-xs text-red-700 dark:text-red-300">
          {node.error}
        </p>
      )}
    </li>
  );
}

function PendingRow({ type, id }: { type: string; id: string }) {
  return (
    <li className="flex items-center gap-2.5 rounded-md border border-dashed border-line px-3 py-2 text-sm opacity-50">
      <span className="w-3.5" />
      <CircleDashed size={15} className="shrink-0 text-subtle" />
      <NodeLabel type={type} id={id} />
      <span className="ml-auto font-mono text-xs text-subtle">pending</span>
    </li>
  );
}

function StatusBadge({ run }: { run: RunState }) {
  const base = 'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium';
  switch (run.phase) {
    case 'idle':
      return <span className={`${base} border border-line text-muted`}>No runs yet</span>;
    case 'running':
      return (
        <span className={`${base} bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300`}>
          <Loader2 size={12} className="animate-spin" />
          Running…
        </span>
      );
    case 'done':
      return run.result.status === 'completed' ? (
        <span className={`${base} bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300`}>
          <CheckCircle2 size={12} />
          Completed in {run.result.durationMs}ms
        </span>
      ) : (
        <span className={`${base} bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300`}>
          <XCircle size={12} />
          Failed
        </span>
      );
    case 'stopped':
      return (
        <span className={`${base} bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300`}>
          <Square size={10} className="fill-current" />
          Stopped
        </span>
      );
    case 'error':
      return (
        <span className={`${base} bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300`}>
          <XCircle size={12} />
          Failed
        </span>
      );
  }
}

function Body({ run }: { run: RunState }): ReactNode {
  switch (run.phase) {
    case 'idle':
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-subtle">
          <Play size={18} />
          Click Run to execute this workflow.
        </div>
      );
    case 'running':
      return (
        <ol className="space-y-1.5">
          {run.workflow.nodes.map((n) => (
            <PendingRow key={n.id} type={n.type} id={n.id} />
          ))}
        </ol>
      );
    case 'stopped':
      return (
        <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center text-sm text-subtle">
          <Square size={16} />
          You stopped this run. No further nodes will run.
          <span className="max-w-md text-xs">
            A node that was already calling an outside service (for example a Qdrant upsert) may still finish that one call.
          </span>
        </div>
      );
    case 'error': {
      const details = Array.isArray(run.details) ? run.details.filter((d) => typeof d === 'string') : [];
      return (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900/70 dark:bg-red-950 dark:text-red-200"
        >
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle size={15} />
            {run.status ? `Run rejected by the server (HTTP ${run.status})` : 'Run could not be started'}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap pl-6 text-xs opacity-90">{run.message}</p>
          {details.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 pl-10 text-xs opacity-90">
              {details.map((d) => (
                <li key={d} className="list-disc">
                  {d}
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }
    case 'done': {
      const { result } = run;
      return (
        <div className="space-y-3">
          {result.status === 'failed' && result.error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/70 dark:bg-red-950 dark:text-red-200"
            >
              <AlertTriangle size={14} className="mt-px shrink-0" />
              <span className="whitespace-pre-wrap break-words">{result.error}</span>
            </div>
          )}
          <ol className="space-y-1.5">
            {result.nodes.map((node) => (
              <NodeRow key={node.id} node={node} />
            ))}
          </ol>
        </div>
      );
    }
  }
}

function rawResult(run: RunState): unknown {
  if (run.phase === 'done') return run.result;
  if (run.phase === 'error') return { error: run.message, status: run.status, details: run.details };
  return undefined;
}

export function RunPanel({ run, onClose }: RunPanelProps) {
  const raw = rawResult(run);
  return (
    <section
      aria-label="Run results"
      className="flex h-[40vh] min-h-64 shrink-0 flex-col border-t border-line bg-panel shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)]"
    >
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-4">
        <h2 className="text-sm font-semibold text-fg">Run</h2>
        <StatusBadge run={run} />
        {run.phase !== 'idle' && (
          <span className="rounded border border-line px-1.5 py-px font-mono text-[11px] uppercase text-muted">
            {run.mode}
          </span>
        )}
        {run.phase === 'done' && (
          <span className="truncate font-mono text-xs text-subtle" title="Run ID">
            {run.result.runId}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close run panel"
          title="Close"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-fg-soft transition-colors hover:bg-hover"
        >
          <X size={15} />
        </button>
      </header>

      {/* Raw result scrolls with the rows so opening it never squeezes them out of view. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 py-3">
          <Body run={run} />
        </div>
        {raw !== undefined && (
          <details className="group border-t border-line">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2 text-xs font-medium text-muted hover:bg-hover [&::-webkit-details-marker]:hidden">
              <ChevronRight size={13} className="transition-transform group-open:rotate-90" />
              Raw result
            </summary>
            <pre className="overflow-x-auto border-t border-line bg-page px-4 py-2 font-mono text-xs leading-5 text-fg-soft">
              {pretty(raw)}
            </pre>
          </details>
        )}
      </div>
    </section>
  );
}
