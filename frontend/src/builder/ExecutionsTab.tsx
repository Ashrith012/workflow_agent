import { AlertTriangle, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

interface Execution {
  id: string;
  event_key: string;
  workflow_name: string;
  label: string;
  status: string;
  error: string | null;
  duration_ms: number | null;
  started_at: string;
  user_email: string | null;
  node_count: number;
}

interface ExecutionNode {
  node_id: string;
  type: string;
  status: string;
  duration_ms: number;
  error: string | null;
  output: unknown;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const ms = (v: number | null) => (v === null ? '—' : `${(v / 1000).toFixed(1)} s`);

function StatusDot({ status }: { status: string }) {
  const cls = status === 'completed' ? 'bg-emerald-500' : status === 'failed' ? 'bg-red-500' : 'bg-amber-500';
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`} aria-hidden />;
}

/** One execution, expanding into its node-by-node detail. */
function Row({ execution }: { execution: Execution }) {
  const [open, setOpen] = useState(false);
  const [nodes, setNodes] = useState<ExecutionNode[]>();
  const [error, setError] = useState<string>();

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !nodes) {
      api<{ nodes: ExecutionNode[] }>(`/api/fde/executions/${execution.id}`)
        .then((d) => setNodes(d.nodes))
        .catch((err: Error) => setError(err.message));
    }
  };

  return (
    <li className="border-t border-line first:border-t-0">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hover">
        <ChevronRight size={14} aria-hidden className={`shrink-0 text-subtle transition-transform ${open ? 'rotate-90' : ''}`} />
        <StatusDot status={execution.status} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-fg">{execution.label || execution.workflow_name}</span>
          <span className="block truncate text-xs text-subtle">
            {when(execution.started_at)} · {execution.user_email ?? 'system'} · {execution.node_count} nodes
          </span>
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{ms(execution.duration_ms)}</span>
      </button>
      {open && (
        <div className="border-t border-line/60 bg-page/60 px-3 py-2.5 pl-10">
          {execution.error && (
            <p className="mb-2 flex items-start gap-1.5 text-xs text-red-700 dark:text-red-300">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {execution.error}
            </p>
          )}
          {error && <p className="text-xs text-red-700 dark:text-red-300">{error}</p>}
          {!nodes && !error && <p className="text-xs text-muted">Loading steps…</p>}
          {nodes && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-subtle">
                  <th className="py-1 text-left font-medium">Node</th>
                  <th className="py-1 text-left font-medium">Type</th>
                  <th className="py-1 text-left font-medium">Status</th>
                  <th className="py-1 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {nodes.map((n) => (
                  <tr key={n.node_id} title={n.error ?? undefined}>
                    <td className="py-1 font-mono">{n.node_id}</td>
                    <td className="py-1">{n.type}</td>
                    <td className={`py-1 ${n.status === 'failed' ? 'text-red-700 dark:text-red-300' : 'text-muted'}`}>{n.status}</td>
                    <td className="py-1 text-right tabular-nums text-muted">{ms(n.duration_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </li>
  );
}

/** Live runs of this workflow in the end-user app, newest first. */
export function ExecutionsTab({ eventKey }: { eventKey: string }) {
  const [rows, setRows] = useState<Execution[]>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api<Execution[]>(`/api/fde/executions${eventKey ? `?eventKey=${encodeURIComponent(eventKey)}` : ''}`)
      .then(setRows)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [eventKey]);
  useEffect(load, [load]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-fg">Executions</h2>
          <p className="text-xs text-muted">
            {eventKey ? (
              <>
                Live runs of <code className="font-mono">{eventKey}</code> from the end-user app. Expand one to see every node.
              </>
            ) : (
              'Every run on this platform. Give the trigger an event key to see only this workflow.'
            )}
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-fg-soft hover:bg-hover disabled:opacity-50">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>

      {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      <ul className="overflow-hidden rounded-xl border border-line bg-panel">
        {rows?.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No executions yet. Runs appear here once the workflow is live and someone uses it.</li>}
        {rows?.map((r) => (
          <Row key={r.id} execution={r} />
        ))}
      </ul>
    </div>
  );
}
