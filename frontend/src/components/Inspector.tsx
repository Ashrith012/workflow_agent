import { Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { getNodeDefinition } from '../nodes/registry';
import { useWorkflowStore } from '../store/useWorkflowStore';
import type { ParameterDefinition } from '../types';

const fieldClass =
  'w-full rounded-md border border-line bg-page px-2.5 py-1.5 text-sm text-fg placeholder:text-faint focus:border-line-strong focus:outline-none';

export function Inspector() {
  const selected = useWorkflowStore(useShallow((s) => s.nodes.filter((n) => n.selected)));
  const updateNodeParameter = useWorkflowStore((s) => s.updateNodeParameter);
  const deleteNode = useWorkflowStore((s) => s.deleteNode);

  const node = selected.length === 1 ? selected[0] : undefined;
  const definition = getNodeDefinition(node?.type);

  // Hide the panel entirely until exactly one node is selected.
  if (!node || !definition) return null;

  const { icon: Icon, accentColor, label } = definition;

  const renderField = (param: ParameterDefinition) => {
    const id = `param-${param.key}`;
    const value = node.data.parameters[param.key] ?? '';
    const onChange = (v: string) => updateNodeParameter(node.id, param.key, v);

    switch (param.type) {
      case 'textarea':
        return (
          <textarea
            id={id}
            rows={6}
            value={value}
            placeholder={param.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={`${fieldClass} resize-y font-mono text-xs leading-5`}
          />
        );
      case 'select':
        return (
          <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={fieldClass}>
            {param.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            {param.optionGroups?.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        );
      default:
        return (
          <input
            id={id}
            type="text"
            value={value}
            placeholder={param.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={fieldClass}
          />
        );
    }
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-panel">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon size={16} style={{ color: accentColor }} />
          <h2 className="text-sm font-semibold text-fg">{label}</h2>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted">{definition.description}</p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <label htmlFor="node-id" className="mb-1 block text-xs font-medium text-muted">
            Node ID
          </label>
          <input
            id="node-id"
            readOnly
            value={node.id}
            className={`${fieldClass} cursor-default font-mono text-xs text-muted`}
          />
        </div>

        {definition.parameters.map((param) => (
          <div key={param.key}>
            <label htmlFor={`param-${param.key}`} className="mb-1 block text-xs font-medium text-muted">
              {param.label}
            </label>
            {renderField(param)}
          </div>
        ))}
      </div>

      <div className="border-t border-line p-4">
        <button
          type="button"
          onClick={() => deleteNode(node.id)}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/40"
        >
          <Trash2 size={14} />
          Delete node
        </button>
      </div>
    </aside>
  );
}
