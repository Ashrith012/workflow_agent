import { api } from '../../api/client';
import { NoticeBar, Pill, Section, SeverityPill, btn, field, td, th, useActions, useLoad, when } from './ui';

interface GuardrailsData {
  policies: { check_key: string; label: string; action: string; updated_at: string; updated_by: string | null }[];
  alerts: {
    id: string;
    run_id: string | null;
    event_key: string | null;
    check_key: string;
    action: string;
    severity: string;
    title: string;
    detail: string;
    status: 'open' | 'resolved';
    created_at: string;
  }[];
  /** action key → human label, from the server so the dropdown never drifts from the enforcement code. */
  actions: Record<string, string>;
}

export function GuardrailsPage({ onChanged }: { onChanged: () => void }) {
  const { data, error, reload } = useLoad<GuardrailsData>('/api/admin/guardrails');
  const { notice, busy, run } = useActions(async () => {
    await reload();
    onChanged();
  });

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const open = data.alerts.filter((a) => a.status === 'open');
  const resolved = data.alerts.filter((a) => a.status === 'resolved');

  const setAction = (checkKey: string, label: string, action: string) =>
    run(checkKey, async () => {
      await api(`/api/admin/guardrails/${checkKey}`, { method: 'PATCH', body: { action } });
      return `"${label}" is now "${data.actions[action]}". It applies to every workflow run from now on — no republish needed.`;
    });

  return (
    <div className="space-y-5">
      <NoticeBar notice={notice} />

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Section title="Alert queue" description={`${open.length} open. Each row is a policy check acting on a real run.`}>
          {data.alerts.length === 0 ? (
            <p className="text-sm text-muted">No alerts yet. Events appear here when a policy check acts on a workflow run.</p>
          ) : (
            <ul className="divide-y divide-line">
              {[...open, ...resolved.slice(0, 10)].map((a) => (
                <li key={a.id} className={`flex items-start gap-3 py-2.5 first:pt-0 last:pb-0 ${a.status === 'resolved' ? 'opacity-55' : ''}`}>
                  <SeverityPill severity={a.severity} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg">{a.title}</p>
                    <p className="text-xs text-muted">
                      {a.detail} · policy: {data.actions[a.action] ?? a.action} · {when(a.created_at)}
                    </p>
                  </div>
                  {a.status === 'open' ? (
                    <button type="button" className={btn} disabled={busy !== null} onClick={() => void run(`resolve:${a.id}`, async () => {
                      await api(`/api/admin/guardrails/alerts/${a.id}/resolve`, { body: {} });
                      return 'Alert resolved.';
                    })}>
                      Resolve
                    </button>
                  ) : (
                    <Pill tone="ok">Resolved</Pill>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Policies"
          description="Pick an action per check. The choice is stored and read live on every run: set PII to “Mask and log” and every workflow masks Aadhaar/PAN from then on, with the event shown in the user's AI Activity page."
        >
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Check</th>
                <th className={th}>Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.policies.map((p) => (
                <tr key={p.check_key}>
                  <td className={td}>
                    {p.label}
                    {p.updated_by && <p className="text-[11px] text-subtle">changed by {p.updated_by}, {when(p.updated_at)}</p>}
                  </td>
                  <td className={`${td} w-48`}>
                    <select
                      className={`${field} w-full py-1 text-xs`}
                      value={p.action}
                      disabled={busy !== null}
                      aria-label={`Action for ${p.label}`}
                      onChange={(e) => void setAction(p.check_key, p.label, e.target.value)}
                    >
                      {Object.entries(data.actions).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  );
}
