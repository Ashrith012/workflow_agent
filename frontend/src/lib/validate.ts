import { getNodeDefinition } from '../nodes/registry';
import type { ExportedWorkflow } from '../types';

export interface ValidationResult {
  /** Blocking problems — export must not proceed. */
  errors: string[];
  /** Non-blocking problems — export proceeds, user is informed. */
  warnings: string[];
}

export function validateWorkflow(workflow: ExportedWorkflow): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (workflow.nodes.length === 0) {
    errors.push('Workflow must contain at least one node.');
  }

  const nodeIds = new Set(workflow.nodes.map((n) => n.id));

  for (const node of workflow.nodes) {
    if (!getNodeDefinition(node.type)) {
      errors.push(`Node ${node.id} has unknown type "${node.type}".`);
    }
  }

  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge ${edge.id} references missing source node ${edge.source}.`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge ${edge.id} references missing target node ${edge.target}.`);
    }
  }

  if (hasCycle(workflow)) {
    warnings.push('Workflow contains a cycle.');
  }

  return { errors, warnings };
}

function hasCycle({ nodes, edges }: ExportedWorkflow): boolean {
  const adjacency = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const edge of edges) adjacency.get(edge.source)?.push(edge.target);

  // 0 = unvisited, 1 = on current DFS path, 2 = done
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    state.set(id, 1);
    for (const next of adjacency.get(id) ?? []) {
      const s = state.get(next) ?? 0;
      if (s === 1) return true;
      if (s === 0 && visit(next)) return true;
    }
    state.set(id, 2);
    return false;
  };

  return nodes.some((n) => (state.get(n.id) ?? 0) === 0 && visit(n.id));
}
