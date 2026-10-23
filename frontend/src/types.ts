import type { Edge, Node } from '@xyflow/react';
import type { LucideIcon } from 'lucide-react';

// ---- Internal (React Flow) shapes ----

export type WorkflowNodeData = { parameters: Record<string, string> };
export type WorkflowNode = Node<WorkflowNodeData>;
export type WorkflowEdge = Edge;

// ---- Node registry shapes ----

export type ParameterType = 'text' | 'textarea' | 'select';

/** A labelled `<optgroup>` of select options (e.g. one LLM provider's models). */
export interface OptionGroup {
  label: string;
  options: { value: string; label: string }[];
}

export interface ParameterDefinition {
  key: string;
  label: string;
  type: ParameterType;
  placeholder?: string;
  options?: string[];
  /** Grouped select options; rendered after `options`. */
  optionGroups?: OptionGroup[];
}

export interface NodeDefinition {
  type: string;
  label: string;
  accentColor: string;
  icon: LucideIcon;
  defaultParameters: Record<string, string>;
  parameters: ParameterDefinition[];
}

// ---- Export schema ----

export interface ExportedNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  parameters: Record<string, string>;
}

export interface ExportedEdge {
  id: string;
  source: string;
  target: string;
}

export interface ExportedWorkflow {
  version: 1;
  name: string;
  nodes: ExportedNode[];
  edges: ExportedEdge[];
}

// ---- Run results (shared by cli/execute.ts, server/ and the Run panel) ----

export type RunMode = 'mock' | 'live';

export interface NodeResult {
  id: string;
  type: string;
  status: 'completed' | 'failed';
  durationMs: number;
  input: unknown;
  output: unknown;
  error?: string;
}

export interface ExecutionResult {
  status: 'completed' | 'failed';
  /** Nodes in execution order. Stops at the failed node; later nodes are absent. */
  nodes: NodeResult[];
  /** Terminal node outputs (nodes with no outgoing edge), keyed by node id. `null` on failure. */
  output: unknown;
  durationMs: number;
  error?: string;
}

/** Response body of POST /api/run (200). */
export interface RunResponse extends ExecutionResult {
  runId: string;
}
