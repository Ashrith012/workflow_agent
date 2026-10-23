/** Small shared pieces for the Tenant Admin console pages. */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../../api/client';

export const btn =
  'inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-fg-soft transition-colors hover:bg-hover disabled:opacity-50';
export const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-md border border-sky-600 bg-sky-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50';
export const field =
  'rounded-md border border-line bg-page px-2.5 py-1.5 text-sm text-fg placeholder:text-faint focus:border-line-strong focus:outline-none';
export const th = 'py-2 px-3 text-left text-xs font-medium text-subtle';
export const td = 'py-2 px-3 align-middle';

export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h`;
  return `${Math.round(mins / (24 * 60))} days`;
};

export type Notice = { kind: 'ok' | 'error'; text: string; details?: string[] };

export function NoticeBar({ notice }: { notice: Notice | null }) {
  if (!notice?.text) return null;
  return (
    <div
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-3 py-2 text-sm ${
        notice.kind === 'error'
          ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/70 dark:bg-red-950 dark:text-red-200'
          : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950 dark:text-emerald-200'
      }`}
    >
      {notice.text}
      {notice.details && (
        <ul className="mt-1 list-disc pl-5 text-xs">
          {notice.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Fetch-on-mount with a reload handle, shared by every console page. */
export function useLoad<T>(path: string): { data: T | undefined; error: string | undefined; reload: () => Promise<void> } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const reload = useCallback(async () => {
    try {
      setData(await api<T>(path));
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload };
}

/** Runs a mutation, reports the outcome in a notice, then refreshes. */
export function useActions(reload: () => Promise<void>) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, action: () => Promise<string>) => {
    setBusy(key);
    setNotice(null);
    try {
      const text = await action();
      if (text) setNotice({ kind: 'ok', text });
      await reload();
    } catch (err) {
      const details = err instanceof ApiError && Array.isArray(err.details) ? (err.details as string[]) : undefined;
      setNotice({ kind: 'error', text: (err as Error).message, details });
    } finally {
      setBusy(null);
    }
  };
  return { notice, busy, run };
}

const PILL_TONES: Record<string, string> = {
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  bad: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  off: 'bg-hover text-muted',
};

export function Pill({ tone, children }: { tone: keyof typeof PILL_TONES; children: ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL_TONES[tone]}`}>{children}</span>;
}

export function SeverityPill({ severity }: { severity: string }) {
  const tone = severity === 'Critical' || severity === 'High' ? 'bad' : severity === 'Medium' ? 'warn' : 'off';
  return <Pill tone={tone}>{severity}</Pill>;
}

export function Section({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** iOS-style switch used by the Connectors page. */
export function Switch({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-faint/60'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}
