import type { NodeProps, NodeTypes } from '@xyflow/react';
import { memo } from 'react';
import { NODE_DEFINITIONS } from '../../nodes/registry';
import type { WorkflowNode } from '../../types';
import { BaseNode } from './BaseNode';

/**
 * One React Flow node component per registry entry, auto-derived so new node
 * types need no edits here. Built once at module load to keep the object
 * reference stable (React Flow warns if nodeTypes changes between renders).
 */
export const nodeTypes: NodeTypes = Object.fromEntries(
  NODE_DEFINITIONS.map((definition) => {
    const Component = memo((props: NodeProps<WorkflowNode>) => (
      <BaseNode {...props} definition={definition} />
    ));
    Component.displayName = `${definition.type}Node`;
    return [definition.type, Component];
  }),
);
