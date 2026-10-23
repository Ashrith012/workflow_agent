import { Check, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api/client';
import { NoticeBar, Pill, Section, ago, btn, btnPrimary, field, td, th, useActions, useLoad, when } from './ui';

interface Approval {
  id: string;
  event_key: string;
  name: string;
  note: string;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  decided_at: string | null;
  decision_note: string;
  submitted_by: string | null;
  decided_by: string | null;
  node_count: number;
}

export function ApprovalsPage({ onChanged }: { onChanged: () => void }) {
  const { data, error, reload } = useLoad<Approval[]>('/api/admin/approvals');
  const { notice, busy, run } = useActions(async () => {
    await reload();
    onChanged();
  });
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const pending = data.filter((a) => a.status === 'pending');
  const decided = data.filter((a) => a.status !== 'pending');

  const decide = (a: Approval, verb: 'approve' | 'reject', note = '') =>
    run(`${verb}:${a.id}`, async () => {
      const res = await api<{ version?: number }>(`/api/admin/approvals/${a.id}/${verb}`, { body: { note } });
      setRejecting(null);
      setRejectNote('');
      return verb === 'approve' ? `Approved and published "${a.name}" (version ${res.version}).` : `Rejected "${a.name}"; the FDE sees your note.`;
    });

  return (
    <div className="space-y-5">
      <NoticeBar notice={notice} />

      <Section title="Waiting for you" description="Approving publishes the version to the end-user app immediately. Rejecting sends it back to the FDE.">
        {pending.length === 0 ? (
          <p className="text-sm text-muted">No workflow versions are waiting.</p>
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((a) => (
              <li key={a.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg">
                      {a.name} <span className="font-mono text-xs font-normal text-muted">{a.event_key}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {a.node_count} nodes · submitted by {a.submitted_by ?? 'unknown'} · waiting {ago(a.submitted_at)}
                    </p>
                    {a.note && <p className="mt-1 text-xs italic text-fg-soft">“{a.note}”</p>}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className={btnPrimary} disabled={busy !== null} onClick={() => void decide(a, 'approve')}>
                      {busy === `approve:${a.id}` ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Approve and publish
                    </button>
                    <button type="button" className={btn} disabled={busy !== null} onClick={() => setRejecting(rejecting === a.id ? null : a.id)}>
                      <X size={13} /> Reject
                    </button>
                  </div>
                </div>
                {rejecting === a.id && (
                  <form
                    className="flex flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void decide(a, 'reject', rejectNote);
                    }}
                  >
                    <input
                      className={`${field} flex-1`}
                      autoFocus
                      placeholder="Why is it rejected? The FDE sees this note."
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                    />
                    <button type="submit" className={btn} disabled={busy !== null}>
                      Confirm rejection
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Decided" description="Earlier approvals and rejections (also in the audit log).">
        {decided.length === 0 ? (
          <p className="text-sm text-muted">Nothing decided yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Workflow</th>
                <th className={th}>Submitted by</th>
                <th className={th}>Decision</th>
                <th className={th}>By</th>
                <th className={th}>When</th>
                <th className={th}>Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {decided.map((a) => (
                <tr key={a.id}>
                  <td className={`${td} font-medium`}>{a.name}</td>
                  <td className={`${td} text-xs text-muted`}>{a.submitted_by ?? '—'}</td>
                  <td className={td}>
                    <Pill tone={a.status === 'approved' ? 'ok' : 'bad'}>{a.status}</Pill>
                  </td>
                  <td className={`${td} text-xs text-muted`}>{a.decided_by ?? '—'}</td>
                  <td className={`${td} text-xs text-muted`}>{a.decided_at ? when(a.decided_at) : '—'}</td>
                  <td className={`${td} max-w-[16rem] truncate text-xs text-muted`} title={a.decision_note}>
                    {a.decision_note || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
