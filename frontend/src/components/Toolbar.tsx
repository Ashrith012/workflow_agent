import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FilePlus2,
  Loader2,
  Moon,
  PanelBottom,
  Play,
  Send,
  Square,
  Sun,
  Workflow,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { serializeWorkflow } from '../lib/serialize';
import { validateWorkflow } from '../lib/validate';
import { useAuthStore } from '../store/useAuthStore';
import { useThemeStore } from '../store/useThemeStore';
import type { ExportedWorkflow, RunMode } from '../types';
import { useWorkflowStore } from '../store/useWorkflowStore';

type Notice = { kind: 'success' | 'error'; title: string; details: string[] };

function downloadJson(filename: string, json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** The one serialize path shared by Export and Run, so both send identical JSON. */
function currentWorkflow(): ExportedWorkflow {
  const { workflowName: name, nodes, edges } = useWorkflowStore.getState();
  return serializeWorkflow(name.trim() || 'Untitled', nodes, edges);
}

interface ToolbarProps {
  running: boolean;
  onRun: (workflow: ExportedWorkflow, mode: RunMode) => void;
  onStop: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
}

export function Toolbar({ running, onRun, onStop, panelOpen, onTogglePanel }: ToolbarProps) {
  const workflowName = useWorkflowStore((s) => s.workflowName);
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);
  const nodeCount = useWorkflowStore((s) => s.nodes.length);
  const edgeCount = useWorkflowStore((s) => s.edges.length);
  const clear = useWorkflowStore((s) => s.clear);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mode, setMode] = useState<RunMode>('mock');
  const [publishing, setPublishing] = useState(false);
  const role = useAuthStore((s) => s.user?.role);
  // Live version per event key, so the builder always shows which version of this workflow is published.
  const [liveVersions, setLiveVersions] = useState<Map<string, number>>(new Map());
  const canvasEventKey = useWorkflowStore(
    (s) => s.nodes.find((n) => n.type === 'UIEventTrigger' || n.type === 'ChatTrigger')?.data.parameters.eventKey ?? '',
  );

  const refreshVersions = useCallback(() => {
    api<{ event_key: string; version: number }[]>('/api/fde/published')
      .then((rows) => setLiveVersions(new Map(rows.map((r) => [r.event_key, r.version]))))
      .catch(() => undefined);
  }, []);
  useEffect(refreshVersions, [refreshVersions]);
  const liveVersion = canvasEventKey ? liveVersions.get(canvasEventKey) : undefined;

  // Success notices fade on their own; errors stay until dismissed.
  useEffect(() => {
    if (notice?.kind !== 'success') return;
    const timer = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  const onExport = async () => {
    const workflow = currentWorkflow();
    const { errors, warnings } = validateWorkflow(workflow);

    if (errors.length > 0) {
      setNotice({ kind: 'error', title: 'Export failed', details: errors });
      return;
    }

    const json = JSON.stringify(workflow, null, 2);
    downloadJson('workflow.json', json);

    let title = 'Exported + copied';
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      title = 'Exported (clipboard unavailable)';
    }
    setNotice({ kind: 'success', title, details: warnings });
  };

  // Admins publish directly; FDEs submit the canvas for the tenant admin's approval.
  const onPublish = async () => {
    const workflow = currentWorkflow();
    const { errors } = validateWorkflow(workflow);
    if (errors.length > 0) {
      setNotice({ kind: 'error', title: role === 'fde' ? 'Submit failed' : 'Publish failed', details: errors });
      return;
    }
    setPublishing(true);
    setNotice(null);
    try {
      if (role === 'fde') {
        const res = await api<{ eventKey: string }>('/api/fde/submit', { body: { workflow } });
        setNotice({ kind: 'success', title: `Submitted "${res.eventKey}" for approval — it goes live once the tenant admin approves`, details: [] });
      } else {
        const res = await api<{ eventKey: string; version: number }>('/api/admin/publish', { body: { workflow } });
        setNotice({ kind: 'success', title: `Published on "${res.eventKey}" (version ${res.version})`, details: [] });
      }
      refreshVersions();
    } catch (err) {
      const details = err instanceof ApiError && Array.isArray(err.details) ? (err.details as string[]) : [];
      setNotice({ kind: 'error', title: (err as Error).message || 'Request failed', details });
    } finally {
      setPublishing(false);
    }
  };

  const runDisabled = nodeCount === 0 || running;
  const onRunClick = () => {
    if (!runDisabled) onRun(currentWorkflow(), mode);
  };

  // Starts a blank workflow. Published versions are untouched; this only clears the canvas.
  const onNewWorkflow = () => {
    if (nodeCount === 0 || window.confirm('Start a new workflow? The canvas is cleared. Anything already published stays live.')) {
      clear();
      setNotice(null);
    }
  };

  return (
    <header className="relative flex h-14 shrink-0 items-center gap-4 border-b border-line bg-panel px-4">
      <div className="flex items-center gap-2 text-fg-soft">
        <Workflow size={18} className="text-sky-600 dark:text-sky-400" />
      </div>

      <input
        value={workflowName}
        onChange={(e) => setWorkflowName(e.target.value)}
        aria-label="Workflow name"
        spellCheck={false}
        className="w-72 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-fg hover:border-line focus:border-line-strong focus:bg-page focus:outline-none"
      />

      <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-xs text-muted">
        {nodeCount} {nodeCount === 1 ? 'node' : 'nodes'} · {edgeCount}{' '}
        {edgeCount === 1 ? 'edge' : 'edges'}
      </span>

      {canvasEventKey && (
        <span
          title={
            liveVersion !== undefined
              ? `End users are on version ${liveVersion} of "${canvasEventKey}". Your next approved ${role === 'fde' ? 'submission' : 'publish'} becomes v${liveVersion + 1}.`
              : `"${canvasEventKey}" is not published yet`
          }
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
            liveVersion !== undefined
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
              : 'border-line text-subtle'
          }`}
        >
          {liveVersion !== undefined ? `Live v${liveVersion}` : 'Not published'}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-fg-soft transition-colors hover:bg-hover"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          type="button"
          onClick={onTogglePanel}
          aria-label={panelOpen ? 'Hide run panel' : 'Show run panel'}
          aria-pressed={panelOpen}
          title={panelOpen ? 'Hide run panel' : 'Show run panel'}
          className={`flex h-8 w-8 items-center justify-center rounded-md border border-line text-fg-soft transition-colors hover:bg-hover ${
            panelOpen ? 'bg-hover' : ''
          }`}
        >
          <PanelBottom size={15} />
        </button>
        <button
          type="button"
          onClick={onNewWorkflow}
          title="Start a new, empty workflow"
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-fg-soft transition-colors hover:bg-hover"
        >
          <FilePlus2 size={14} />
          New workflow
        </button>
        <div className="flex items-center">
          {running ? (
            <button
              type="button"
              onClick={onStop}
              title="Stop the run: no further nodes will run"
              className="flex items-center gap-1.5 rounded-l-md bg-red-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-400"
            >
              <Loader2 size={14} className="animate-spin" />
              Stop
              <Square size={11} className="fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onRunClick}
              disabled={runDisabled}
              title={nodeCount === 0 ? 'Add a node to run the workflow' : `Run workflow (${mode})`}
              className="flex items-center gap-1.5 rounded-l-md bg-sky-500 px-3 py-1.5 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-sky-500"
            >
              <Play size={14} className="fill-current" />
              Run
            </button>
          )}
          <div
            role="radiogroup"
            aria-label="Run mode"
            className="flex h-[32px] items-center gap-0.5 rounded-r-md border border-l-0 border-line p-0.5"
          >
            {(['mock', 'live'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                title={m === 'live' ? 'Call the real LLM through the Python agent service (needs the provider API key)' : 'Use mock node outputs'}
                className={`rounded px-2 py-0.5 text-xs font-medium capitalize transition-colors ${
                  mode === m ? 'bg-hover text-fg ring-1 ring-line-strong/60' : 'text-subtle hover:text-fg-soft'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={onExport}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-fg-soft transition-colors hover:bg-hover"
        >
          <Download size={14} />
          Export JSON
        </button>
        <button
          type="button"
          onClick={() => void onPublish()}
          disabled={nodeCount === 0 || publishing}
          title={
            role === 'fde'
              ? 'Send this workflow to the tenant admin for approval; it goes live once approved'
              : 'Publish this workflow to the end-user app (needs a UI Event or Chat Trigger and a Respond to UI node)'
          }
          className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-emerald-600"
        >
          {publishing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {publishing ? (role === 'fde' ? 'Submitting…' : 'Publishing…') : role === 'fde' ? 'Submit for approval' : 'Publish'}
        </button>
      </div>

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`absolute right-4 top-16 z-20 w-80 rounded-lg border px-3 py-2.5 text-sm shadow-xl shadow-slate-900/10 dark:shadow-black/50 ${
            notice.kind === 'error'
              ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/70 dark:bg-red-950 dark:text-red-200'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950 dark:text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {notice.kind === 'error' ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
            <span className="flex-1">{notice.title}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
              <X size={14} className="opacity-70 hover:opacity-100" />
            </button>
          </div>
          {notice.details.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 pl-6 text-xs opacity-90">
              {notice.details.map((d) => (
                <li key={d} className="list-disc">
                  {notice.kind === 'success' ? `Warning: ${d}` : d}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </header>
  );
}
