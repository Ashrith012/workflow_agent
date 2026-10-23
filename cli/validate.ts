import type { ExportedWorkflow } from '../frontend/src/types.js';
import { executors } from './executors.js';
import { topologicalSort, validateWorkflowFile } from './graph.js';

/**
 * Pre-flight checks shared by the CLI and the HTTP server, so both reject
 * exactly the same inputs with exactly the same messages.
 */

/** Schema problems in an untrusted workflow object; empty means it is a valid ExportedWorkflow. */
export function validateWorkflowShape(data: unknown): string[] {
  return validateWorkflowFile(data, new Set(Object.keys(executors)));
}

export interface CycleReport {
  /** Human-readable, multi-line; printed verbatim by the CLI. */
  message: string;
  cycle: string[];
  blocked: string[];
}

/** Null when the graph is acyclic. */
export function findCycle(workflow: ExportedWorkflow): CycleReport | null {
  const sorted = topologicalSort(workflow);
  if (sorted.ok) return null;
  const blocked = sorted.blocked.length ? `\n  Blocked downstream: ${sorted.blocked.join(', ')}` : '';
  return {
    message: `Cycle detected — cannot execute.\n  Cycle participants: ${sorted.cycle.join(', ')}${blocked}`,
    cycle: sorted.cycle,
    blocked: sorted.blocked,
  };
}
