import { useNavigate } from 'react-router-dom';
import type { OverviewData } from './TenantConsole';
import { Pill, Section, SeverityPill, ago, btn, td, th, useLoad } from './ui';

function Kpi({ value, label, note, bad }: { value: string | number; label: string; note?: string; bad?: boolean }) {
  return (
    <div className="border-l border-line px-4 py-3 first:border-l-0">
      <p className={`text-2xl font-semibold tabular-nums ${bad ? 'text-red-600 dark:text-red-400' : 'text-fg'}`}>{value}</p>
      <p className="text-xs text-muted">{label}</p>
      {note && <p className={`mt-0.5 text-[11px] ${bad ? 'text-red-600 dark:text-red-400' : 'text-subtle'}`}>{note}</p>}
    </div>
  );
}

const MODEL_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'off'> = { authorized: 'ok', requested: 'warn', deprecated: 'bad', disabled: 'off' };

export function OverviewPage() {
  const navigate = useNavigate();
  const { data, error } = useLoad<OverviewData>('/api/admin/overview');
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const { counts, byWorkflow, alerts, approvals, models } = data;
  const max = Math.max(1, ...byWorkflow.map((w) => w.total));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-panel sm:grid-cols-5">
        <Kpi value={counts.published} label="Workflows published" />
        <Kpi value={counts.pendingApprovals} label="Pending approvals" note={counts.pendingApprovals > 0 ? 'Waiting for you' : 'Queue is clear'} />
        <Kpi value={counts.runs30d} label="Agent runs, 30 days" note={`${counts.failed30d} failed`} />
        <Kpi value={counts.users} label="Users in tenant" />
        <Kpi value={counts.openAlerts} label="Open guardrail alerts" bad={counts.openAlerts > 0} note={counts.openAlerts > 0 ? 'Review the queue' : 'All clear'} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <Section title="Agent runs by workflow" description="Last 30 days; the red share failed.">
            {byWorkflow.length === 0 ? (
              <p className="text-sm text-muted">No runs yet.</p>
            ) : (
              <div className="space-y-2">
                {byWorkflow.map((w) => (
                  <div key={w.name} className="grid grid-cols-[150px_1fr_52px] items-center gap-3 text-sm">
                    <span className="truncate" title={w.name}>{w.name}</span>
                    <div className="flex h-3 overflow-hidden rounded bg-page" title={`${w.total} runs, ${w.failed} failed`}>
                      <div className="bg-sky-500" style={{ width: `${((w.total - w.failed) / max) * 100}%` }} />
                      <div className="bg-red-500" style={{ width: `${(w.failed / max) * 100}%` }} />
                    </div>
                    <span className="text-right text-xs tabular-nums text-muted">{w.total}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="Workflows waiting for approval"
            description="Submitted by FDEs; approving publishes the version."
            actions={<button type="button" className={btn} onClick={() => navigate('/admin/approvals')}>View all</button>}
          >
            {approvals.length === 0 ? (
              <p className="text-sm text-muted">Nothing is waiting.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Workflow</th>
                    <th className={th}>Event key</th>
                    <th className={th}>Submitted by</th>
                    <th className={th}>Waiting</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {approvals.map((a) => (
                    <tr key={a.id}>
                      <td className={`${td} font-medium`}>{a.name}</td>
                      <td className={`${td} font-mono text-xs text-muted`}>{a.event_key}</td>
                      <td className={`${td} text-xs text-muted`}>{a.submitted_by ?? '—'}</td>
                      <td className={`${td} text-xs text-muted`}>{ago(a.submitted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>

        <div className="space-y-5">
          <Section
            title="Guardrail alerts"
            description="Open events from policy checks."
            actions={<button type="button" className={btn} onClick={() => navigate('/admin/guardrails')}>Open queue</button>}
          >
            {alerts.length === 0 ? (
              <p className="text-sm text-muted">No open alerts.</p>
            ) : (
              <ul className="divide-y divide-line">
                {alerts.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                    <SeverityPill severity={a.severity} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg">{a.title}</p>
                      <p className="text-xs text-muted">{a.detail} · {ago(a.created_at)} ago</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Models in use" description="Models referenced by published workflows." actions={<button type="button" className={btn} onClick={() => navigate('/admin/models')}>Manage</button>}>
            {models.length === 0 ? (
              <p className="text-sm text-muted">No published workflow uses an AI model yet.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line">
                  {models.map((m) => (
                    <tr key={m.model_key}>
                      <td className={td}>
                        {m.name} <span className="text-xs text-muted">{m.version}</span>
                      </td>
                      <td className={`${td} whitespace-nowrap text-xs text-muted`}>{m.used_by} workflow{m.used_by === 1 ? '' : 's'}</td>
                      <td className={`${td} text-right`}>
                        <Pill tone={MODEL_TONE[m.status] ?? 'off'}>{m.status}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
