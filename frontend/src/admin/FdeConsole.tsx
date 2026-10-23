/**
 * FDE (Forward Deployed Engineer) console. The FDE builds workflows in the
 * canvas and submits them here for the tenant admin's approval — nothing goes
 * live without one. Tenant admins keep access to this studio too.
 */
import { FolderInput, Loader2, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { serializeWorkflow } from '../lib/serialize';
import { DEFAULT_EDGE_OPTIONS, useWorkflowStore } from '../store/useWorkflowStore';
import type { ExportedWorkflow } from '../types';
import { NoticeBar, Pill, Section, ago, btn, btnPrimary, field, td, th, useActions, useLoad, when } from './tenant/ui';

/**
 * Ready-made workflows shipped under examples/. Every sub-folder is an agent, so dropping
 * in examples/<new-agent>/*.json makes those templates appear here with no code change.
 */
const TEMPLATES = Object.entries(
  import.meta.glob<ExportedWorkflow>('../../../examples/*/*.json', { eager: true, import: 'default' }),
)
  .map(([path, workflow]) => {
    const parts = path.split('/');
    return { file: parts.pop()!, agent: parts.pop()!, workflow };
  })
  .sort((a, b) => a.agent.localeCompare(b.agent) || a.file.localeCompare(b.file));

/** Templates grouped by their agent folder. */
const TEMPLATE_GROUPS = [...new Set(TEMPLATES.map((t) => t.agent))].map((agent) => ({
  agent,
  items: TEMPLATES.filter((t) => t.agent === agent),
}));

interface Submission {
  id: string;
  event_key: string;
  name: string;
  note: string;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  decided_at: string | null;
  decision_note: string;
  decided_by: string | null;
}

interface Published {
  event_key: string;
  name: string;
  allowed_roles: string;
  version: number;
  published_at: string;
  published_by: string | null;
}

const STATUS_TONE = { pending: 'warn', approved: 'ok', rejected: 'bad' } as const;

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

export function FdeConsole() {
  const navigate = useNavigate();
  const submissions = useLoad<Submission[]>('/api/fde/submissions');
  const published = useLoad<Published[]>('/api/fde/published');
  const { notice, busy, run } = useActions(async () => {
    await Promise.all([submissions.reload(), published.reload()]);
  });
  const [note, setNote] = useState('');

  const canvasName = useWorkflowStore((s) => s.workflowName);
  const canvasCount = useWorkflowStore((s) => s.nodes.length);

  const submit = (workflow: ExportedWorkflow, key: string, withNote: string) =>
    run(key, async () => {
      await api<{ eventKey: string }>('/api/fde/submit', { body: { workflow, note: withNote } });
      return `Submitted "${workflow.name}" for tenant-admin approval. It goes live once approved.`;
    });

  const onSubmitCanvas = (e: FormEvent) => {
    e.preventDefault();
    const { workflowName, nodes, edges } = useWorkflowStore.getState();
    void submit(serializeWorkflow(workflowName.trim() || 'Untitled', nodes, edges), 'canvas', note).then(() => setNote(''));
  };

  const openPublished = (eventKey: string) =>
    run(`open:${eventKey}`, async () => {
      const row = await api<{ workflow: ExportedWorkflow }>(`/api/fde/published/${encodeURIComponent(eventKey)}`);
      openInBuilder(row.workflow);
      navigate('/builder');
      return '';
    });

  const openSubmission = (id: string) =>
    run(`open:${id}`, async () => {
      const row = await api<{ workflow: ExportedWorkflow }>(`/api/fde/submissions/${id}`);
      openInBuilder(row.workflow);
      navigate('/builder');
      return '';
    });

  const error = submissions.error ?? published.error;

  return (
    <div className="flex h-full flex-col bg-page text-fg">
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 overflow-y-auto p-4">
        <NoticeBar notice={error ? { kind: 'error', text: error } : notice} />

        <Section
          title="Submit for approval"
          description="Your workflow is validated (shape, event key, authorized models) and sent to the tenant admin. Only their approval publishes it to end users."
        >
          <form onSubmit={onSubmitCanvas} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-page px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Current canvas: {canvasName}</p>
              <p className="text-xs text-muted">{canvasCount} nodes in the builder</p>
            </div>
            <input
              className={`${field} w-72`}
              placeholder="Note to the approver (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button type="submit" className={btnPrimary} disabled={busy !== null || canvasCount === 0}>
              {busy === 'canvas' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Submit canvas
            </button>
          </form>

          {TEMPLATE_GROUPS.map(({ agent, items }) => (
            <div key={agent}>
              <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-subtle">{agent} templates</h3>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {items.map(({ file, workflow }) => (
                  <li key={`${agent}/${file}`} className="flex flex-wrap items-center gap-3 px-3 py-2">
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
                        navigate('/builder');
                      }}
                    >
                      <FolderInput size={13} /> Open in builder
                    </button>
                    <button type="button" className={btn} disabled={busy !== null} onClick={() => void submit(workflow, file, '')}>
                      {busy === file ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Submit
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Section>

        <Section title="My submissions" description="Where each version stands with the tenant admin.">
          {!submissions.data || submissions.data.length === 0 ? (
            <p className="text-sm text-muted">Nothing submitted yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Workflow</th>
                  <th className={th}>Event key</th>
                  <th className={th}>Status</th>
                  <th className={th}>Submitted</th>
                  <th className={th}>Decision</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {submissions.data.map((s) => (
                  <tr key={s.id}>
                    <td className={`${td} font-medium`}>{s.name}</td>
                    <td className={`${td} font-mono text-xs text-muted`}>{s.event_key}</td>
                    <td className={td}>
                      <Pill tone={STATUS_TONE[s.status]}>{s.status === 'pending' ? `pending · ${ago(s.submitted_at)}` : s.status}</Pill>
                    </td>
                    <td className={`${td} text-xs text-muted`}>{when(s.submitted_at)}</td>
                    <td className={`${td} max-w-[16rem] truncate text-xs text-muted`} title={s.decision_note}>
                      {s.decided_at ? `${s.decided_by ?? ''} ${s.decision_note ? `— ${s.decision_note}` : ''}`.trim() || '—' : '—'}
                    </td>
                    <td className={`${td} text-right`}>
                      <button type="button" className={btn} disabled={busy !== null} onClick={() => void openSubmission(s.id)}>
                        <FolderInput size={13} /> Open in builder
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Published workflows" description="Live in the end-user app. Open one to iterate; resubmitting the same event key sends a new version for approval.">
          {!published.data || published.data.length === 0 ? (
            <p className="text-sm text-muted">Nothing is published yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Event key</th>
                  <th className={th}>Workflow</th>
                  <th className={th}>Roles</th>
                  <th className={th}>Version</th>
                  <th className={th}>Published</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {published.data.map((p) => (
                  <tr key={p.event_key}>
                    <td className={`${td} font-mono text-xs`}>{p.event_key}</td>
                    <td className={td}>{p.name}</td>
                    <td className={`${td} text-xs text-muted`}>{p.allowed_roles}</td>
                    <td className={`${td} tabular-nums`}>v{p.version}</td>
                    <td className={`${td} text-xs text-muted`}>
                      {when(p.published_at)}
                      {p.published_by ? ` · ${p.published_by}` : ''}
                    </td>
                    <td className={`${td} text-right`}>
                      <button type="button" className={btn} disabled={busy !== null} onClick={() => void openPublished(p.event_key)}>
                        <FolderInput size={13} /> Open in builder
                      </button>
                    </td>
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
