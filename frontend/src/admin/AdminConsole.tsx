import { CheckCircle2, ExternalLink, FolderInput, Loader2, Send, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { serializeWorkflow } from '../lib/serialize';
import { DEFAULT_EDGE_OPTIONS, useWorkflowStore } from '../store/useWorkflowStore';
import type { ExportedWorkflow } from '../types';
import { AdminBar } from './AdminBar';

/** Ready-made workflows shipped in examples/manzil (built from the same palette nodes as anything else). */
const TEMPLATES = Object.entries(
  import.meta.glob<ExportedWorkflow>('../../../examples/manzil/*.json', { eager: true, import: 'default' }),
)
  .map(([path, workflow]) => ({ file: path.split('/').pop()!, workflow }))
  .sort((a, b) => a.file.localeCompare(b.file));

interface Published {
  event_key: string;
  name: string;
  trigger_type: string;
  allowed_roles: string;
  version: number;
  published_at: string;
  published_by: string | null;
}

interface UserRow {
  id: string;
  email: string;
  role: string;
  created_at: string;
}

interface RunRow {
  id: string;
  event_key: string;
  label: string;
  status: string;
  error: string | null;
  duration_ms: number | null;
  started_at: string;
  user_email: string | null;
}

type Notice = { kind: 'ok' | 'error'; text: string; details?: string[] };

const btn = 'inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-fg-soft transition-colors hover:bg-hover disabled:opacity-50';
const field = 'rounded-md border border-line bg-page px-2.5 py-1.5 text-sm text-fg placeholder:text-faint focus:border-line-strong focus:outline-none';
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const eventKeyOf = (wf: ExportedWorkflow) =>
  wf.nodes.find((n) => n.type === 'UIEventTrigger' || n.type === 'ChatTrigger')?.parameters.eventKey ?? '—';

/** Loads a workflow into the builder's canvas (the same store the builder persists). */
function openInBuilder(workflow: ExportedWorkflow) {
  useWorkflowStore.setState({
    workflowName: workflow.name,
    nodes: workflow.nodes.map(({ id, type, position, parameters }) => ({ id, type, position, data: { parameters: { ...parameters } } })),
    edges: workflow.edges.map(({ id, source, target }) => ({ id, source, target, ...DEFAULT_EDGE_OPTIONS })),
  });
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel">
      <header className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function AdminConsole() {
  const navigate = useNavigate();
  const [published, setPublished] = useState<Published[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ email: '', password: '', role: 'user' });

  const refresh = useCallback(async () => {
    const [p, u, r] = await Promise.all([
      api<Published[]>('/api/admin/published'),
      api<UserRow[]>('/api/admin/users'),
      api<RunRow[]>('/api/admin/runs?limit=25'),
    ]);
    setPublished(p);
    setUsers(u);
    setRuns(r);
  }, []);

  useEffect(() => {
    refresh().catch((err: Error) => setNotice({ kind: 'error', text: err.message }));
  }, [refresh]);

  const run = async (key: string, action: () => Promise<string>) => {
    setBusy(key);
    setNotice(null);
    try {
      setNotice({ kind: 'ok', text: await action() });
      await refresh();
    } catch (err) {
      const details = err instanceof ApiError && Array.isArray(err.details) ? (err.details as string[]) : undefined;
      setNotice({ kind: 'error', text: (err as Error).message, details });
    } finally {
      setBusy(null);
    }
  };

  const publish = (workflow: ExportedWorkflow, key: string) =>
    run(key, async () => {
      const res = await api<{ eventKey: string; version: number }>('/api/admin/publish', { body: { workflow } });
      return `Published "${workflow.name}" on ${res.eventKey} (version ${res.version}).`;
    });

  const publishCanvas = () => {
    const { workflowName, nodes, edges } = useWorkflowStore.getState();
    return publish(serializeWorkflow(workflowName.trim() || 'Untitled', nodes, edges), 'canvas');
  };

  const openPublished = (eventKey: string) =>
    run(`open:${eventKey}`, async () => {
      const row = await api<{ workflow: ExportedWorkflow }>(`/api/admin/published/${encodeURIComponent(eventKey)}`);
      openInBuilder(row.workflow);
      navigate('/');
      return '';
    });

  const onCreateUser = (e: FormEvent) => {
    e.preventDefault();
    void run('user', async () => {
      await api('/api/admin/users', { body: newUser });
      setNewUser({ email: '', password: '', role: 'user' });
      return `Created ${newUser.email}.`;
    });
  };

  const canvasName = useWorkflowStore((s) => s.workflowName);
  const canvasCount = useWorkflowStore((s) => s.nodes.length);

  return (
    <div className="flex h-full flex-col bg-page text-fg">
      <AdminBar />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 overflow-y-auto p-4">
        {notice?.text && (
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
        )}

        <Section
          title="Publish"
          description="A published workflow is what the end-user app runs: its trigger's event key is the button, page or chat it answers. Publishing the same event key again replaces the live version."
        >
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-page px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Current canvas: {canvasName}</p>
              <p className="text-xs text-muted">{canvasCount} nodes in the builder</p>
            </div>
            <button type="button" className={btn} disabled={busy !== null || canvasCount === 0} onClick={() => void publishCanvas()}>
              {busy === 'canvas' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Publish canvas
            </button>
          </div>

          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-subtle">Manzil templates</h3>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {TEMPLATES.map(({ file, workflow }) => (
              <li key={file} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{workflow.name}</p>
                  <p className="font-mono text-xs text-muted">
                    {eventKeyOf(workflow)} · {workflow.nodes.length} nodes
                  </p>
                </div>
                <button
                  type="button"
                  className={btn}
                  onClick={() => {
                    openInBuilder(workflow);
                    navigate('/');
                  }}
                >
                  <FolderInput size={13} /> Open in builder
                </button>
                <button type="button" className={btn} disabled={busy !== null} onClick={() => void publish(workflow, file)}>
                  {busy === file ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Publish
                </button>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Published workflows" description="Live in the end-user app. Unpublishing makes the matching feature unavailable immediately.">
          {published.length === 0 ? (
            <p className="text-sm text-muted">Nothing is published yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-subtle">
                <tr>
                  <th className="py-1.5 font-medium">Event key</th>
                  <th className="font-medium">Workflow</th>
                  <th className="font-medium">Roles</th>
                  <th className="font-medium">Version</th>
                  <th className="font-medium">Published</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {published.map((p) => (
                  <tr key={p.event_key}>
                    <td className="py-2 font-mono text-xs">{p.event_key}</td>
                    <td>{p.name}</td>
                    <td className="text-xs text-muted">{p.allowed_roles}</td>
                    <td className="tabular-nums">v{p.version}</td>
                    <td className="text-xs text-muted">
                      {when(p.published_at)}
                      {p.published_by ? ` · ${p.published_by}` : ''}
                    </td>
                    <td className="space-x-1.5 whitespace-nowrap text-right">
                      <button type="button" className={btn} disabled={busy !== null} onClick={() => void openPublished(p.event_key)}>
                        <ExternalLink size={13} /> Edit
                      </button>
                      <button
                        type="button"
                        className={btn}
                        disabled={busy !== null}
                        onClick={() =>
                          window.confirm(`Unpublish ${p.event_key}? End users lose this feature until it is published again.`) &&
                          void run(`unpub:${p.event_key}`, async () => {
                            await api(`/api/admin/published/${encodeURIComponent(p.event_key)}`, { method: 'DELETE' });
                            return `Unpublished ${p.event_key}.`;
                          })
                        }
                      >
                        <Trash2 size={13} /> Unpublish
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Users" description="End users (role user) see only the app: Dashboard, Chat with AI, AI Activity and Analytics.">
          <form onSubmit={onCreateUser} className="mb-3 flex flex-wrap gap-2">
            <input className={`${field} flex-1`} type="email" required placeholder="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
            <input
              className={`${field} flex-1`}
              type="password"
              required
              minLength={8}
              placeholder="password (8+ characters)"
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            />
            <select className={field} value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            <button type="submit" className={btn} disabled={busy !== null}>
              <UserPlus size={13} /> Add user
            </button>
          </form>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1">{u.email}</span>
                <span className="text-xs text-muted">{u.role}</span>
                <button
                  type="button"
                  className={btn}
                  disabled={busy !== null}
                  onClick={() =>
                    window.confirm(`Delete ${u.email}?`) &&
                    void run(`del:${u.id}`, async () => {
                      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
                      return `Deleted ${u.email}.`;
                    })
                  }
                >
                  <Trash2 size={13} /> Delete
                </button>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Recent runs" description="Every run of a published workflow from the app. Node-level detail: GET /api/admin/runs/:id.">
          {runs.length === 0 ? (
            <p className="text-sm text-muted">No runs yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-subtle">
                <tr>
                  <th className="py-1.5 font-medium">When</th>
                  <th className="font-medium">Event</th>
                  <th className="font-medium">Request</th>
                  <th className="font-medium">User</th>
                  <th className="font-medium">Status</th>
                  <th className="text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.map((r) => (
                  <tr key={r.id} title={r.error ?? r.id}>
                    <td className="py-1.5 text-xs text-muted">{when(r.started_at)}</td>
                    <td className="font-mono text-xs">{r.event_key}</td>
                    <td className="max-w-[16rem] truncate">{r.label}</td>
                    <td className="text-xs text-muted">{r.user_email}</td>
                    <td className={`text-xs ${r.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-muted'}`}>
                      {r.status === 'completed' && <CheckCircle2 size={12} className="mr-1 inline text-emerald-600" />}
                      {r.status}
                    </td>
                    <td className="text-right text-xs tabular-nums text-muted">{r.duration_ms !== null ? `${(r.duration_ms / 1000).toFixed(1)} s` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </main>
    </div>
  );
}
