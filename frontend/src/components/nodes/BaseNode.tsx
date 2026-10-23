import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { NodeDefinition, WorkflowNode } from '../../types';

const SUMMARY_MAX_CHARS = 40;
const SUMMARY_MAX_LINES = 2;

function truncate(value: string, max = SUMMARY_MAX_CHARS): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length > max ? `${singleLine.slice(0, max)}…` : singleLine;
}

type BaseNodeProps = NodeProps<WorkflowNode> & { definition: NodeDefinition };

export function BaseNode({ data, selected, definition }: BaseNodeProps) {
  const { label, accentColor, icon: Icon, parameters } = definition;
  const handleStyle = { borderColor: accentColor };

  return (
    <div
      className="w-60 overflow-hidden rounded-lg border border-line bg-panel text-left shadow-lg shadow-slate-900/10 dark:shadow-black/40 transition-shadow"
      style={{ boxShadow: selected ? `0 0 0 2px ${accentColor}` : undefined }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !bg-page"
        style={handleStyle}
      />

      <div
        className="flex items-center gap-2 border-b border-line px-3 py-2"
        style={{ backgroundColor: `${accentColor}1f`, borderTop: `2px solid ${accentColor}` }}
      >
        <Icon size={14} style={{ color: accentColor }} />
        <span className="text-xs font-semibold text-fg">{label}</span>
      </div>

      <div className="space-y-1 px-3 py-2">
        {parameters.slice(0, SUMMARY_MAX_LINES).map((param) => {
          const value = data.parameters[param.key] ?? '';
          return (
            <div key={param.key} className="flex gap-1.5 text-[11px] leading-4">
              <span className="shrink-0 text-subtle">{param.label}:</span>
              <span className={`truncate font-mono ${value ? 'text-fg-soft' : 'text-faint'}`}>
                {value ? truncate(value) : '—'}
              </span>
            </div>
          );
        })}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !bg-page"
        style={handleStyle}
      />
    </div>
  );
}
