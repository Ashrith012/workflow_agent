import { AlertTriangle, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

interface DataSource {
  id: string;
  name: string;
  kind: 'connector' | 'mcp';
  auth: 'service_account' | 'user_consent';
  scope: string;
  purpose: string;
  enabled: boolean;
  allowed: boolean;
  decided_at: string | null;
  used_by: string[];
}

function statusOf(d: DataSource): { label: string; cls: string } {
  if (!d.enabled) return { label: 'Turned off by admin', cls: 'bg-hover text-muted' };
  if (d.auth !== 'user_consent') return { label: 'Company access', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' };
  return d.allowed
    ? { label: 'Allowed', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' }
    : { label: 'Turned off', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' };
}

/** What the assistants can read for this user, and why. Turning access off takes effect straight away. */
export function DataAccessTab() {
  const [sources, setSources] = useState<DataSource[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    api<DataSource[]>('/api/app/data-access')
      .then(setSources)
      .catch((err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  const setAllowed = async (d: DataSource, allowed: boolean) => {
    setBusy(d.id);
    setMessage(null);
    try {
      await api(`/api/app/data-access/${d.id}`, { body: { allowed } });
      setMessage(
        allowed
          ? `${d.name} is allowed again.`
          : `${d.name} is turned off. From your very next request, assistants cannot read it; features that need it will tell you.`,
      );
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <p role="alert" className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
          <AlertTriangle size={15} /> {error}
        </p>
      </div>
    );
  }
  if (!sources) {
    return (
      <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted" role="status">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold text-fg">My data access</h1>
        <p className="mt-0.5 text-sm text-muted">What the assistants can read, and why. Turning access off takes effect straight away.</p>
      </div>
      {message && (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950 dark:text-emerald-200">
          {message}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {sources.map((d) => {
          const status = statusOf(d);
          return (
            <section key={d.id} className="rounded-xl border border-line bg-panel p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold text-fg">
                  {d.name} <span className="font-normal text-subtle">{d.kind === 'mcp' ? '· MCP server' : ''}</span>
                </h2>
                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${status.cls}`}>{status.label}</span>
              </div>
              <dl className="mt-2 space-y-1.5 text-xs">
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-subtle">What</dt>
                  <dd className="text-fg-soft">{d.scope || '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-subtle">Why</dt>
                  <dd className="text-fg-soft">{d.purpose || '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-subtle">Used by</dt>
                  <dd className="text-fg-soft">{d.used_by.length > 0 ? d.used_by.join(', ') : 'No live feature uses it right now'}</dd>
                </div>
              </dl>
              <div className="mt-3">
                {d.auth === 'user_consent' ? (
                  d.allowed ? (
                    <button
                      type="button"
                      disabled={busy !== null || !d.enabled}
                      onClick={() => void setAllowed(d, false)}
                      className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900/70 dark:text-red-300 dark:hover:bg-red-950"
                    >
                      {busy === d.id ? 'Saving…' : 'Turn off'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy !== null || !d.enabled}
                      onClick={() => void setAllowed(d, true)}
                      className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-soft transition-colors hover:bg-hover disabled:opacity-50"
                    >
                      {busy === d.id ? 'Saving…' : 'Allow'}
                    </button>
                  )
                ) : (
                  <p className="text-[11px] text-subtle">Company-managed. Ask your administrator to change it.</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
