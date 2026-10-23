import { useReactFlow } from '@xyflow/react';
import { GripVertical } from 'lucide-react';
import type { DragEvent } from 'react';
import { NODE_DEFINITIONS } from '../nodes/registry';
import { useWorkflowStore } from '../store/useWorkflowStore';
import { DND_MIME, NODE_CENTER_OFFSET } from '../lib/dnd';

export function Sidebar() {
  const addNode = useWorkflowStore((s) => s.addNode);
  const { screenToFlowPosition } = useReactFlow();

  const onDragStart = (event: DragEvent, type: string) => {
    event.dataTransfer.setData(DND_MIME, type);
    event.dataTransfer.effectAllowed = 'move';
  };

  // Click-to-add: place the node at the centre of the visible canvas, nudged
  // by the node count so repeated clicks don't stack exactly on top of each other.
  const onClickAdd = (type: string) => {
    const pane = document.querySelector('.react-flow');
    if (!pane) return;
    const rect = pane.getBoundingClientRect();
    const center = screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    const nudge = (useWorkflowStore.getState().nodes.length % 6) * 24;
    addNode(type, {
      x: center.x - NODE_CENTER_OFFSET.x + nudge,
      y: center.y - NODE_CENTER_OFFSET.y + nudge,
    });
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
      <div className="px-4 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wider text-subtle">
        Nodes
      </div>
      <ul className="space-y-1.5 px-3">
        {NODE_DEFINITIONS.map(({ type, label, icon: Icon, accentColor }) => (
          <li key={type}>
            <button
              type="button"
              draggable
              onDragStart={(e) => onDragStart(e, type)}
              onClick={() => onClickAdd(type)}
              title="Drag onto the canvas, or click to add"
              className="group flex w-full cursor-grab items-center gap-2.5 rounded-md border border-line bg-page/60 px-2.5 py-2 text-left text-sm text-fg transition-colors hover:border-line-strong hover:bg-hover active:cursor-grabbing"
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded"
                style={{ backgroundColor: `${accentColor}26`, color: accentColor }}
              >
                <Icon size={15} />
              </span>
              <span className="flex-1">{label}</span>
              <GripVertical size={14} className="text-faint group-hover:text-muted" />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-auto px-4 py-4 text-xs leading-5 text-subtle">
        Drag nodes onto the canvas or click to add. Connect the right handle to the left handle.
        Press Delete / Backspace to remove a selection.
      </p>
    </aside>
  );
}
