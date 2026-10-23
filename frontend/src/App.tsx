import { ReactFlowProvider } from '@xyflow/react';
import { useRef, useState } from 'react';
import { RunRequestError, runWorkflow } from './api/run';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { RunPanel, type RunState } from './components/RunPanel';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import type { ExportedWorkflow, RunMode } from './types';

export default function App() {
  // Transient run state lives here, not in useWorkflowStore, so it is never persisted.
  const [run, setRun] = useState<RunState>({ phase: 'idle' });
  const [panelOpen, setPanelOpen] = useState(false);
  const latestRun = useRef(0);

  const onRun = async (workflow: ExportedWorkflow, mode: RunMode) => {
    const runSeq = ++latestRun.current;
    setRun({ phase: 'running', mode, workflow });
    setPanelOpen(true);
    try {
      const result = await runWorkflow(workflow, { mode });
      if (runSeq === latestRun.current) setRun({ phase: 'done', mode, result });
    } catch (err) {
      if (runSeq !== latestRun.current) return;
      const { message, status, details } =
        err instanceof RunRequestError ? err : new RunRequestError(err instanceof Error ? err.message : String(err));
      setRun({ phase: 'error', mode, message, status, details });
    }
  };

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col bg-page text-fg">
        <Toolbar
          running={run.phase === 'running'}
          onRun={onRun}
          panelOpen={panelOpen}
          onTogglePanel={() => setPanelOpen((open) => !open)}
        />
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
      </div>
    </ReactFlowProvider>
  );
}
