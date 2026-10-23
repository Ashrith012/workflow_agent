import type { ExportedWorkflow, WorkflowEdge, WorkflowNode } from '../types';

/**
 * Convert the internal React Flow state into the export schema. Only the
 * whitelisted fields are copied, so React Flow internals (selected, dragging,
 * measured, markerEnd, ...) never leak into the file.
 */
export function serializeWorkflow(
  name: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): ExportedWorkflow {
  return {
    version: 1,
    name,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type ?? '',
      position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
      parameters: { ...node.data.parameters },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
  };
}
