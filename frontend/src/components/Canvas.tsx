import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import { MousePointerClick } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { getNodeDefinition } from '../nodes/registry';
import {
  DEFAULT_EDGE_OPTIONS,
  isValidConnection,
  useWorkflowStore,
} from '../store/useWorkflowStore';
import { useThemeStore } from '../store/useThemeStore';
import type { WorkflowEdge, WorkflowNode } from '../types';
import { DND_MIME, NODE_CENTER_OFFSET } from '../lib/dnd';
import { nodeTypes } from './nodes/nodeTypes';

export function Canvas() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const addNode = useWorkflowStore((s) => s.addNode);
  const theme = useThemeStore((s) => s.theme);
  const { screenToFlowPosition } = useReactFlow();
  // React Flow runs fitView the first time nodes appear. Only enable it when we
  // mount with a restored graph — otherwise the viewport would jump right after
  // the first drop on an empty canvas.
  const [fitOnMount] = useState(() => nodes.length > 0);

  const onDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData(DND_MIME);
    if (!getNodeDefinition(type)) return;
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addNode(type, {
      x: position.x - NODE_CENTER_OFFSET.x,
      y: position.y - NODE_CENTER_OFFSET.y,
    });
  };

  return (
    <div className="relative h-full w-full">
      <ReactFlow<WorkflowNode, WorkflowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        onDragOver={onDragOver}
        onDrop={onDrop}
        deleteKeyCode={['Backspace', 'Delete']}
        colorMode={theme}
        fitView={fitOnMount}
        fitViewOptions={{ maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        {/* Dot and minimap-mask colours come from theme tokens in index.css. */}
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => getNodeDefinition(node.type)?.accentColor ?? '#64748b'}
        />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-panel/80 px-4 py-3 text-sm text-muted">
            <MousePointerClick size={16} />
            Drag a node from the left panel to begin.
          </div>
        </div>
      )}
    </div>
  );
}
