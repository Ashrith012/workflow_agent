import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  MarkerType,
  type Connection,
  type DefaultEdgeOptions,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react';
import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { migrateLegacyNode } from '../nodes/models';
import { getNodeDefinition } from '../nodes/registry';
import type { WorkflowEdge, WorkflowNode } from '../types';

export const STORAGE_KEY = 'wf-phase0';
export const DEFAULT_WORKFLOW_NAME = 'My Workflow';

export const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed },
};

interface WorkflowState {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  workflowName: string;
  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (type: string, position: XYPosition) => void;
  updateNodeParameter: (id: string, key: string, value: string) => void;
  deleteNode: (id: string) => void;
  setWorkflowName: (name: string) => void;
  clear: () => void;
}

/** Rejects self-loops and duplicate source→target edges. */
export function isValidConnection(connection: Connection | Edge): boolean {
  const { source, target } = connection;
  if (source === target) return false;
  return !useWorkflowStore
    .getState()
    .edges.some((edge) => edge.source === source && edge.target === target);
}

export const useWorkflowStore = create<WorkflowState>()(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],
      workflowName: DEFAULT_WORKFLOW_NAME,

      onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),

      onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),

      onConnect: (connection) => {
        if (!isValidConnection(connection)) return;
        set({
          edges: addEdge(
            { ...connection, ...DEFAULT_EDGE_OPTIONS, id: `edge_${nanoid(6)}` },
            get().edges,
          ),
        });
      },

      addNode: (type, position) => {
        const definition = getNodeDefinition(type);
        if (!definition) return;
        const node: WorkflowNode = {
          id: `node_${nanoid(6)}`,
          type,
          position,
          data: { parameters: { ...definition.defaultParameters } },
          selected: true,
        };
        // Select only the new node so the inspector opens on it.
        set({ nodes: [...get().nodes.map((n) => ({ ...n, selected: false })), node] });
      },

      updateNodeParameter: (id, key, value) =>
        set({
          nodes: get().nodes.map((node) =>
            node.id === id
              ? {
                  ...node,
                  data: { ...node.data, parameters: { ...node.data.parameters, [key]: value } },
                }
              : node,
          ),
        }),

      deleteNode: (id) =>
        set({
          nodes: get().nodes.filter((node) => node.id !== id),
          edges: get().edges.filter((edge) => edge.source !== id && edge.target !== id),
        }),

      setWorkflowName: (workflowName) => set({ workflowName }),

      clear: () => {
        set({ nodes: [], edges: [], workflowName: DEFAULT_WORKFLOW_NAME });
        useWorkflowStore.persist.clearStorage();
      },
    }),
    {
      name: STORAGE_KEY,
      version: 2,
      // v1 → v2: separate OpenAI/Groq nodes became the single AI Agent node.
      migrate: (persisted, version) => {
        const state = persisted as { nodes?: WorkflowNode[] };
        if (version < 2 && state?.nodes) {
          state.nodes = state.nodes.map((node) => {
            const { type, parameters } = migrateLegacyNode(node.type, node.data?.parameters ?? {});
            return { ...node, type, data: { ...node.data, parameters } };
          });
        }
        // Same shape partialize writes, only node types/parameters changed.
        return state as never;
      },
      // Persist only the graph; drop transient React Flow UI state.
      partialize: (state) => ({
        workflowName: state.workflowName,
        nodes: state.nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
        edges: state.edges.map(({ id, source, target, type, markerEnd }) => ({
          id,
          source,
          target,
          type,
          markerEnd,
        })),
      }),
    },
  ),
);
