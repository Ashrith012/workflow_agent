import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { Renderer } from './Renderer';
import { useEvent, type EventState } from './useEvent';

export function EventStatus({ state, busyText = 'Working…' }: { state: EventState; busyText?: string }) {
  if (state.phase === 'running') {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-muted" role="status">
        <Loader2 size={16} className="animate-spin" /> {busyText}
      </p>
    );
  }
  if (state.phase === 'error') {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900/70 dark:bg-red-950 dark:text-red-200">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div>
          {state.message}
          {state.runId && <p className="mt-0.5 font-mono text-xs opacity-75">Reference: {state.runId}</p>}
        </div>
      </div>
    );
  }
  return null;
}

/** A tab that is exactly one workflow: fire the event on open, render what comes back. */
export function EventTab({ eventKey }: { eventKey: string }) {
  const { state, fire } = useEvent();

  useEffect(() => {
    void fire(eventKey);
  }, [eventKey, fire]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void fire(eventKey)}
          disabled={state.phase === 'running'}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-fg-soft hover:bg-hover disabled:opacity-50"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <EventStatus state={state} busyText="Loading…" />
      {state.phase === 'done' && <Renderer ui={state.result.ui} />}
    </div>
  );
}
