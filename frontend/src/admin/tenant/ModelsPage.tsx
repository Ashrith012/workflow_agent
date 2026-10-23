import { Loader2, Plug, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { NoticeBar, Pill, Section, btn, btnPrimary, field, td, th, useActions, useLoad } from './ui';

interface Model {
  model_key: string;
  name: string;
  provider: string;
  version: string;
  data_class: string;
  region: string;
  status: 'authorized' | 'requested' | 'deprecated' | 'disabled';
  note: string;
  used_by: number;
  kind: 'hosted' | 'selfhosted';
  base_url: string;
  api_key_env: string;
}

const TONE: Record<Model['status'], 'ok' | 'warn' | 'bad' | 'off'> = { authorized: 'ok', requested: 'warn', deprecated: 'bad', disabled: 'off' };
const EMPTY_FORM = {
  kind: 'hosted' as 'hosted' | 'selfhosted',
  model_key: '',
  name: '',
  provider: '',
  version: '',
  data_class: 'Internal',
  region: 'India',
  base_url: '',
  api_key_env: '',
};

export function ModelsPage() {
  const { data, error, reload } = useLoad<Model[]>('/api/admin/models');
  const { notice, busy, run } = useActions(reload);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const testConnection = () =>
    run('test', async () => {
      setTest(null);
      try {
        const res = await api<{ message: string }>('/api/admin/models/test', {
          body: { base_url: form.base_url, api_key_env: form.api_key_env, model_id: form.model_key.split(':').slice(1).join(':') },
        });
        setTest({ ok: true, message: res.message });
      } catch (err) {
        setTest({ ok: false, message: (err as Error).message });
      }
      return '';
    });

  const setStatus = (m: Model, status: Model['status']) =>
    run(`${m.model_key}:${status}`, async () => {
      await api(`/api/admin/models/${encodeURIComponent(m.model_key)}`, { method: 'PATCH', body: { status } });
      return `"${m.name}" is now ${status}. FDE submissions using it are checked against this on approval.`;
    });

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    void run('add', async () => {
      await api('/api/admin/models', { body: form });
      setForm(EMPTY_FORM);
      setTest(null);
      setAdding(false);
      return `Authorized "${form.name}". FDEs can select it in the builder straight away.`;
    });
  };

  return (
    <div className="space-y-5">
      <NoticeBar notice={notice} />

      <Section
        title="Model catalog"
        description="Workflows may only go live with authorized models; disabling one blocks new submissions and approvals that use it."
        actions={
          <button type="button" className={btnPrimary} onClick={() => setAdding(!adding)}>
            <Plus size={13} /> Add model
          </button>
        }
      >
        {adding && (
          <form onSubmit={onAdd} className="mb-4 space-y-3 rounded-lg border border-line bg-page p-3">
            <div className="flex overflow-hidden rounded-md border border-line">
              {(
                [
                  ['hosted', 'Hosted provider'],
                  ['selfhosted', 'Your own LLM (self-hosted)'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={form.kind === k}
                  onClick={() => {
                    setForm({ ...form, kind: k });
                    setTest(null);
                  }}
                  className={`flex-1 px-3 py-1.5 text-xs transition-colors ${
                    form.kind === k ? 'bg-sky-500/10 font-semibold text-sky-700 dark:text-sky-300' : 'text-fg-soft hover:bg-hover'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <input
                className={field}
                required
                placeholder={form.kind === 'selfhosted' ? 'Model key, e.g. "mylab:qwen2.5:7b"' : 'Model key, e.g. "openai:gpt-4o-mini"'}
                value={form.model_key}
                onChange={(e) => setForm({ ...form, model_key: e.target.value })}
              />
              <input className={field} required placeholder="Display name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className={field} placeholder="Provider (defaults from the key)" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />

              {form.kind === 'selfhosted' && (
                <>
                  <input
                    className={`${field} sm:col-span-2`}
                    required
                    placeholder="OpenAI-compatible endpoint, e.g. https://my-llm.example.com/v1"
                    value={form.base_url}
                    onChange={(e) => {
                      setForm({ ...form, base_url: e.target.value });
                      setTest(null);
                    }}
                  />
                  <input
                    className={field}
                    placeholder="API key env var (blank: none)"
                    value={form.api_key_env}
                    onChange={(e) => setForm({ ...form, api_key_env: e.target.value })}
                  />
                </>
              )}

              <input className={field} placeholder="Version to authorize" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
              <select className={field} value={form.data_class} onChange={(e) => setForm({ ...form, data_class: e.target.value })} aria-label="Data classification">
                {['Internal', 'Confidential', 'Restricted'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <input className={field} placeholder="Region or data residency" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
            </div>

            {form.kind === 'selfhosted' && (
              <p className="text-[11px] text-subtle">
                Any OpenAI-compatible server works (Ollama, vLLM, TGI). The key itself is never stored — name an environment variable and the
                server reads it at run time.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className={btnPrimary} disabled={busy !== null}>
                {busy === 'add' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Authorize model
              </button>
              {form.kind === 'selfhosted' && (
                <button type="button" className={btn} disabled={busy !== null || !form.base_url} onClick={() => void testConnection()}>
                  {busy === 'test' ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} Test connection
                </button>
              )}
              {test && (
                <span className={`text-xs ${test.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>{test.message}</span>
              )}
            </div>
          </form>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th}>Model</th>
              <th className={th}>Hosting</th>
              <th className={th}>Provider</th>
              <th className={th}>Model key</th>
              <th className={th}>Version</th>
              <th className={th}>Data allowed</th>
              <th className={th}>Region</th>
              <th className={th}>Used by</th>
              <th className={th}>Status</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.map((m) => (
              <tr key={m.model_key}>
                <td className={`${td} font-medium`}>{m.name}</td>
                <td className={td}>
                  {m.kind === 'selfhosted' ? (
                    <>
                      <Pill tone="info">Your own LLM</Pill>
                      <p className="mt-0.5 max-w-[14rem] truncate font-mono text-[10px] text-subtle" title={m.base_url}>
                        {m.base_url}
                      </p>
                    </>
                  ) : (
                    <span className="text-xs text-muted">Hosted</span>
                  )}
                </td>
                <td className={`${td} text-xs text-muted`}>{m.provider}</td>
                <td className={`${td} font-mono text-xs text-muted`}>{m.model_key}</td>
                <td className={`${td} text-xs`}>{m.version}</td>
                <td className={`${td} text-xs`}>{m.data_class}</td>
                <td className={`${td} text-xs`}>{m.region}</td>
                <td className={`${td} whitespace-nowrap text-xs text-muted`}>{m.used_by > 0 ? `${m.used_by} workflow${m.used_by === 1 ? '' : 's'}` : 'None'}</td>
                <td className={td}>
                  <Pill tone={TONE[m.status]}>{m.status}</Pill>
                  {m.note && <p className="mt-0.5 text-[11px] text-muted">{m.note}</p>}
                </td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  {m.status === 'requested' && (
                    <span className="inline-flex gap-1.5">
                      <button type="button" className={btnPrimary} disabled={busy !== null} onClick={() => void setStatus(m, 'authorized')}>Authorize</button>
                      <button type="button" className={btn} disabled={busy !== null} onClick={() => void setStatus(m, 'disabled')}>Decline</button>
                    </span>
                  )}
                  {m.status === 'authorized' && (
                    <span className="inline-flex gap-1.5">
                      <button type="button" className={btn} disabled={busy !== null} onClick={() => void setStatus(m, 'deprecated')}>Deprecate</button>
                      <button type="button" className={btn} disabled={busy !== null} onClick={() => void setStatus(m, 'disabled')}>Disable</button>
                    </span>
                  )}
                  {(m.status === 'disabled' || m.status === 'deprecated') && (
                    <button type="button" className={btn} disabled={busy !== null} onClick={() => void setStatus(m, 'authorized')}>Authorize again</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
