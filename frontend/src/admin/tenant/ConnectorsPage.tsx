import { Loader2, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { NoticeBar, Pill, Section, Switch, btnPrimary, field, td, th, useActions, useLoad } from './ui';

interface Connector {
  id: string;
  name: string;
  kind: 'connector' | 'mcp';
  auth: 'service_account' | 'user_consent';
  scope: string;
  business_units: string;
  enabled: boolean;
  health: string;
}

const EMPTY_FORM = { name: '', kind: 'connector', auth: 'service_account', scope: '', purpose: '', business_units: '' };

export function ConnectorsPage() {
  const { data, error, reload } = useLoad<Connector[]>('/api/admin/connectors');
  const { notice, busy, run } = useActions(reload);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const patch = (c: Connector, body: { enabled?: boolean; auth?: string }, message: string) =>
    run(c.id, async () => {
      await api(`/api/admin/connectors/${c.id}`, { method: 'PATCH', body });
      return message;
    });

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    void run('add', async () => {
      await api('/api/admin/connectors', { body: form });
      setForm(EMPTY_FORM);
      setAdding(false);
      return `Added "${form.name}" (disabled until you review and enable it).`;
    });
  };

  return (
    <div className="space-y-5">
      <NoticeBar notice={notice} />

      <Section
        title="Connectors and MCP servers"
        description="Sources set to user consent ask each end user before an agent reads their data. Toggles and consent changes are written to the audit log."
        actions={
          <button type="button" className={btnPrimary} onClick={() => setAdding(!adding)}>
            <Plus size={13} /> Add connector or MCP server
          </button>
        }
      >
        {adding && (
          <form onSubmit={onAdd} className="mb-4 grid gap-2 rounded-lg border border-line bg-page p-3 sm:grid-cols-3">
            <input className={field} required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className={field} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="connector">Connector</option>
              <option value="mcp">MCP server</option>
            </select>
            <select className={field} value={form.auth} onChange={(e) => setForm({ ...form, auth: e.target.value })}>
              <option value="service_account">Service account</option>
              <option value="user_consent">User consent</option>
            </select>
            <input className={field} placeholder="Scope, e.g. Documents library (read)" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} />
            <input
              className={`${field} sm:col-span-2`}
              placeholder='Why, in plain words — end users see this on "My data access"'
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            />
            <input className={field} placeholder="Business units" value={form.business_units} onChange={(e) => setForm({ ...form, business_units: e.target.value })} />
            <div>
              <button type="submit" className={btnPrimary} disabled={busy !== null}>
                {busy === 'add' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
              </button>
            </div>
          </form>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Type</th>
              <th className={th}>Access</th>
              <th className={th}>Scope</th>
              <th className={th}>Business units</th>
              <th className={th}>Health</th>
              <th className={th}>Enabled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.map((c) => (
              <tr key={c.id}>
                <td className={`${td} font-medium`}>{c.name}</td>
                <td className={`${td} text-xs text-muted`}>{c.kind === 'mcp' ? 'MCP server' : 'Connector'}</td>
                <td className={td}>
                  <select
                    className={`${field} py-1 text-xs`}
                    value={c.auth}
                    disabled={busy !== null}
                    aria-label={`Access for ${c.name}`}
                    onChange={(e) =>
                      void patch(c, { auth: e.target.value }, `"${c.name}" access is now ${e.target.value === 'user_consent' ? 'user consent' : 'service account'} (audited).`)
                    }
                  >
                    <option value="service_account">Service account</option>
                    <option value="user_consent">User consent</option>
                  </select>
                </td>
                <td className={`${td} text-xs`}>{c.scope || '—'}</td>
                <td className={`${td} text-xs`}>{c.business_units || '—'}</td>
                <td className={td}>
                  <Pill tone={c.health === 'Healthy' ? 'ok' : 'warn'}>{c.health}</Pill>
                </td>
                <td className={td}>
                  <Switch
                    on={c.enabled}
                    disabled={busy !== null}
                    label={`Enable ${c.name}`}
                    onChange={() => void patch(c, { enabled: !c.enabled }, `"${c.name}" ${c.enabled ? 'disabled' : 'enabled'}.`)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
