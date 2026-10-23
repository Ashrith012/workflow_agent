import { ReactFlowProvider } from '@xyflow/react';
import { useRef, useState } from 'react';
import { RunRequestError, RunStoppedError, runWorkflow } from './api/run';
import { EvaluationsTab } from './builder/EvaluationsTab';
import { ExecutionsTab } from './builder/ExecutionsTab';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { RunPanel, type RunState } from './components/RunPanel';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { useWorkflowStore } from './store/useWorkflowStore';
import type { ExportedWorkflow, RunMode } from './types';

const TABS = ['Editor', 'Executions', 'Evaluations'] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  // Transient run state lives here, not in useWorkflowStore, so it is never persisted.
  const [run, setRun] = useState<RunState>({ phase: 'idle' });
  const [panelOpen, setPanelOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('Editor');
  const latestRun = useRef(0);
  const abortRun = useRef<AbortController | null>(null);
  // Executions and Evaluations are scoped to this workflow's trigger event key.
  const eventKey = useWorkflowStore(
    (s) => s.nodes.find((n) => n.type === 'UIEventTrigger' || n.type === 'ChatTrigger')?.data.parameters.eventKey ?? '',
  );

  const onRun = async (workflow: ExportedWorkflow, mode: RunMode) => {
    const runSeq = ++latestRun.current;
    const controller = new AbortController();
    abortRun.current = controller;
    setRun({ phase: 'running', mode, workflow });
    setPanelOpen(true);
    try {
      const result = await runWorkflow(workflow, { mode, signal: controller.signal });
      if (runSeq === latestRun.current) setRun({ phase: 'done', mode, result });
    } catch (err) {
      if (runSeq !== latestRun.current) return;
      if (err instanceof RunStoppedError) {
        setRun({ phase: 'stopped', mode });
        return;
      }
      const { message, status, details } =
        err instanceof RunRequestError ? err : new RunRequestError(err instanceof Error ? err.message : String(err));
      setRun({ phase: 'error', mode, message, status, details });
    } finally {
      if (abortRun.current === controller) abortRun.current = null;
    }
  };

  const onStop = () => abortRun.current?.abort();

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col bg-page text-fg">
        <Toolbar
          running={run.phase === 'running'}
          onRun={onRun}
          onStop={onStop}
          panelOpen={panelOpen}
          onTogglePanel={() => setPanelOpen((open) => !open)}
        />
        <div className="flex shrink-0 justify-center border-b border-line bg-panel px-4 py-1.5">
          <div role="tablist" aria-label="Workflow views" className="flex gap-1 rounded-lg bg-page p-0.5">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                  tab === t ? 'bg-panel font-medium text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {tab === 'Editor' ? (
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main className="flex min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                <Canvas />
              </div>
              {panelOpen && <RunPanel run={run} onClose={() => setPanelOpen(false)} />}
            </main>
            <Inspector />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'Executions' ? <ExecutionsTab eventKey={eventKey} /> : <EvaluationsTab eventKey={eventKey} />}
          </div>
        )}
      </div>
    </ReactFlowProvider>
  );
}
