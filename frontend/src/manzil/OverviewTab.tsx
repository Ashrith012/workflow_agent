import { Loader2, RefreshCw, Workflow, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { EventStatus } from './EventTab';
import { Renderer } from './Renderer';
import { EVENTS, type FormState, type UiResponse } from './types';
import { triggerEvent, useEvent } from './useEvent';

const REFRESH_MS = 30_000;

interface Props {
  projectId: string;
  onProjectChange: (projectId: string) => void;
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-hidden>
      <div className="h-40 rounded-2xl bg-line/60" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-xl bg-line/60" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-72 rounded-xl bg-line/60 lg:col-span-2" />
        <div className="h-72 rounded-xl bg-line/60" />
      </div>
    </div>
  );
}

function useSecondsSince(time: number | undefined) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);
  return time === undefined ? undefined : Math.max(0, Math.round((Date.now() - time) / 1000));
}

/**
 * The home page is the manzil.overview workflow: KPIs, quick actions, system status and the
 * live activity feed all come from it. It refreshes on a timer, and after every action so the
 * numbers reflect the run that just finished.
 */
export function OverviewTab({ projectId, onProjectChange }: Props) {
  const [ui, setUi] = useState<UiResponse>();
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; status: number; runId?: string }>();
  const [form, setForm] = useState<FormState>({ projectId });
  const [actionLabel, setActionLabel] = useState('');
  const action = useEvent();
  const resultRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const ago = useSecondsSince(updatedAt);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const result = await triggerEvent(EVENTS.overview);
      setUi(result.ui);
      setUpdatedAt(Date.now());
      setError(undefined);
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError((err as Error).message, 0);
      setError({ message: e.message, status: e.status, runId: e.runId });
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // A finished action changes the KPIs and the feed, so reload them.
  const actionPhase = action.state.phase;
  useEffect(() => {
    if (actionPhase === 'done' || actionPhase === 'error') void load();
  }, [actionPhase, load]);

  const onFormChange = (name: string, value: string | boolean) => {
    setForm((f) => ({ ...f, [name]: value }));
    if (name === 'projectId' && typeof value === 'string') onProjectChange(value);
  };

  const onAction = (eventKey: string, payload: Record<string, unknown>, label: string) => {
    setActionLabel(label);
    void action.fire(eventKey, { ...payload, ...form });
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const actionPanel = action.state.phase !== 'idle' && (
    <section ref={resultRef} className="scroll-mt-6 overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
      <header className="flex items-center gap-3 border-b border-line bg-page/60 px-4 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-500/12 text-sky-600 dark:text-sky-300">
          {action.state.phase === 'running' ? <Loader2 size={14} className="animate-spin" /> : <Workflow size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">{actionLabel}</p>
          <p className="truncate text-xs text-subtle">
            {action.state.phase === 'running'
              ? 'Workflow running…'
              : action.state.phase === 'done'
                ? `Workflow completed · ${action.state.result.runId}`
                : 'Workflow failed'}
          </p>
        </div>
        <button
          type="button"
          onClick={action.reset}
          aria-label="Close result"
          className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-fg"
        >
          <X size={14} />
        </button>
      </header>
      <div className="p-4">
        <EventStatus state={action.state} busyText={`Analyzing ${actionLabel} from the knowledge source…`} />
        {action.state.phase === 'done' && <Renderer ui={action.state.result.ui} onAction={onAction} />}
      </div>
    </section>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-fg">Overview</h1>
          <p className="text-xs text-subtle">Everything on this page is produced by the published <code className="font-mono">{EVENTS.overview}</code> workflow.</p>
        </div>
        <div className="flex items-center gap-2">
          {ago !== undefined && (
            <span className="flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-xs text-muted">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live · updated {ago < 5 ? 'just now' : `${ago}s ago`}
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-fg-soft shadow-sm hover:bg-hover disabled:opacity-60"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && <EventStatus state={{ phase: 'error', ...error }} />}
      {!ui && !error && <Skeleton />}
      {ui && (
        <Renderer ui={ui} layout="dashboard" form={form} onFormChange={onFormChange} onAction={onAction} busy={action.state.phase === 'running'}>
          {actionPanel}
        </Renderer>
      )}
    </div>
  );
}
