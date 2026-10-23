import { Section, td, th, useLoad, when } from './ui';

interface AuditRow {
  id: number;
  actor_email: string | null;
  action: string;
  subject: string;
  detail: string;
  created_at: string;
}

const ACTION_COLOR = (action: string) =>
  action.startsWith('guardrail')
    ? 'text-red-700 dark:text-red-400'
    : action.startsWith('workflow')
      ? 'text-sky-700 dark:text-sky-400'
      : action.startsWith('agent')
        ? 'text-emerald-700 dark:text-emerald-400'
        : 'text-fg-soft';

export function AuditPage() {
  const { data, error } = useLoad<AuditRow[]>('/api/admin/audit?limit=300');
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <Section title="Audit log" description="Newest first. Agent actions are every published-workflow run; the rest are governance changes from this console and the FDE studio.">
      {data.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th}>When</th>
              <th className={th}>Actor</th>
              <th className={th}>Action</th>
              <th className={th}>Subject</th>
              <th className={th}>Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.map((r) => (
              <tr key={r.id}>
                <td className={`${td} whitespace-nowrap text-xs text-muted`}>{when(r.created_at)}</td>
                <td className={`${td} text-xs`}>{r.actor_email ?? 'system'}</td>
                <td className={`${td} whitespace-nowrap font-mono text-xs ${ACTION_COLOR(r.action)}`}>{r.action}</td>
                <td className={`${td} max-w-[14rem] truncate text-xs`} title={r.subject}>
                  {r.subject}
                </td>
                <td className={`${td} max-w-[24rem] truncate text-xs text-muted`} title={r.detail}>
                  {r.detail || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
