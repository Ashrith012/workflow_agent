import { CircleCheck, CircleDashed, CircleHelp, CircleX, ExternalLink, type LucideIcon } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { BarChart } from './charts';
import { ExecutiveDashboard } from './ExecutiveDashboard';
import { Markdown } from './Markdown';
import type { Block, FormState, Source, UiResponse } from './types';

// ---- Citations: numbered in order of first appearance in the response ----

interface CitationContextValue {
  sources: Record<string, Source>;
  numbers: Map<string, number>;
}
const CitationContext = createContext<CitationContextValue>({ sources: {}, numbers: new Map() });

function citationNumbers(blocks: Block[]): Map<string, number> {
  const numbers = new Map<string, number>();
  const visit = (entries: unknown) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      const ids = (entry as { citations?: unknown })?.citations;
      if (Array.isArray(ids)) for (const id of ids) if (!numbers.has(String(id))) numbers.set(String(id), numbers.size + 1);
    }
  };
  for (const block of blocks) {
    visit(block.items);
    visit(block.rows);
  }
  return numbers;
}

function Citations({ ids }: { ids: unknown }) {
  const { sources, numbers } = useContext(CitationContext);
  if (!Array.isArray(ids) || ids.length === 0) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-0.5 align-middle">
      {ids.map((raw) => {
        const id = String(raw);
        const source = sources[id];
        const n = numbers.get(id);
        if (!source || !n) return null;
        const label = `[${n}]`;
        return source.url.startsWith('https://') || source.url.startsWith('http://') ? (
          <a
            key={id}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.doc_name}
            className="rounded bg-sky-500/10 px-1 text-[11px] font-medium text-sky-700 hover:bg-sky-500/20 dark:text-sky-300"
          >
            {label}
          </a>
        ) : (
          <span key={id} title={source.doc_name} className="rounded bg-sky-500/10 px-1 text-[11px] font-medium text-sky-700 dark:text-sky-300">
            {label}
          </span>
        );
      })}
    </span>
  );
}

// ---- Status & priority (a status colour always comes with an icon and its text label) ----

const STATUS_TONE: [RegExp, string, LucideIcon][] = [
  [/^(completed|approved|delivered|accepted|closed)$/i, 'bg-emerald-500/12 text-emerald-800 ring-emerald-600/25 dark:text-emerald-300', CircleCheck],
  [/^(rejected|delayed|not delivered|failed|critical)$/i, 'bg-red-500/12 text-red-800 ring-red-600/25 dark:text-red-300', CircleX],
  [/^(pending|awaiting.*|inspection pending|partially.*|in progress|re-inspection pending)$/i, 'bg-amber-500/15 text-amber-900 ring-amber-600/25 dark:text-amber-200', CircleDashed],
];
const PRIORITY_TONE: Record<string, string> = {
  critical: 'bg-red-900 text-white ring-red-900',
  high: 'bg-red-600 text-white ring-red-600',
  medium: 'bg-orange-500 text-white ring-orange-500',
  low: 'bg-emerald-600 text-white ring-emerald-600',
};

export function StatusPill({ value }: { value: string }) {
  const [, tone, Icon] = STATUS_TONE.find(([re]) => re.test(value.trim())) ?? [null, 'bg-slate-500/10 text-fg-soft ring-slate-500/20', CircleHelp];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>
      <Icon size={12} aria-hidden />
      {value}
    </span>
  );
}

export function PriorityPill({ value }: { value: string }) {
  const tone = PRIORITY_TONE[value.trim().toLowerCase()];
  if (!tone) return <>{value}</>;
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${tone}`}>{value}</span>;
}

// ---- Blocks ----

const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));

function BlockFrame({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      {title && <h3 className="text-sm font-semibold text-fg">{title}</h3>}
      {children}
    </section>
  );
}

function KeyValueBlock({ block }: { block: Block }) {
  const items = Array.isArray(block.items) ? (block.items as Record<string, unknown>[]) : [];
  return (
    <BlockFrame title={block.title}>
      <dl className="divide-y divide-line rounded-lg border border-line bg-panel text-sm">
        {items.map((item, i) => (
          <div key={i} className="grid grid-cols-[12rem_1fr] gap-3 px-3 py-2">
            <dt className="text-muted">{str(item.label)}</dt>
            <dd className="text-fg">
              {str(item.value)}
              <Citations ids={item.citations} />
            </dd>
          </div>
        ))}
      </dl>
    </BlockFrame>
  );
}

function TableBlock({ block }: { block: Block }) {
  const columns = Array.isArray(block.columns) ? block.columns.map(str) : [];
  const rows = Array.isArray(block.rows) ? (block.rows as Record<string, unknown>[]) : [];
  const statusCol = columns.findIndex((c) => /status/i.test(c));
  const priorityCol = columns.findIndex((c) => /priority/i.test(c));
  const hasCitations = rows.some((r) => Array.isArray(r.citations) && r.citations.length > 0);
  return (
    <BlockFrame title={block.title}>
      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-page text-xs text-muted">
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col" className="px-3 py-2 font-medium">
                  {c}
                </th>
              ))}
              {hasCitations && (
                <th scope="col" className="px-3 py-2 font-medium">
                  Source
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row, i) => {
              const cells = Array.isArray(row.cells) ? row.cells.map(str) : [];
              return (
                <tr key={i} className="align-top">
                  {columns.map((_, c) => (
                    <td key={c} className="px-3 py-2">
                      {c === statusCol && cells[c] ? (
                        <StatusPill value={cells[c]} />
                      ) : c === priorityCol && cells[c] ? (
                        <PriorityPill value={cells[c]} />
                      ) : (
                        cells[c]
                      )}
                    </td>
                  ))}
                  {hasCitations && (
                    <td className="px-3 py-2">
                      <Citations ids={row.citations} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </BlockFrame>
  );
}

const TONE_ACCENT: Record<string, string> = {
  blue: 'border-l-[#2a78d6]',
  green: 'border-l-[#0ca30c]',
  orange: 'border-l-[#ec835a]',
  red: 'border-l-[#d03b3b]',
  grey: 'border-l-[#898781]',
};

function KpiCardsBlock({ block }: { block: Block }) {
  const cards = Array.isArray(block.cards) ? (block.cards as Record<string, unknown>[]) : [];
  return (
    <BlockFrame title={block.title}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((card, i) => (
          <div key={i} className={`rounded-lg border border-l-4 border-line bg-panel px-4 py-3 ${TONE_ACCENT[str(card.tone)] ?? TONE_ACCENT.grey}`}>
            <p className="text-xs text-muted">{str(card.title)}</p>
            <p className="mt-1 text-2xl font-semibold text-fg">{str(card.value)}</p>
            <p className="mt-0.5 text-xs text-subtle">{str(card.description)}</p>
          </div>
        ))}
      </div>
    </BlockFrame>
  );
}

interface FormProps {
  form?: FormState;
  onFormChange?: (name: string, value: string | boolean) => void;
  onAction?: (eventKey: string, payload: Record<string, unknown>, label: string) => void;
  busy?: boolean;
}

function SelectBlock({ block, form, onFormChange }: { block: Block } & FormProps) {
  const name = str(block.name) || 'value';
  const options = (Array.isArray(block.options) ? block.options : []).map((o) =>
    typeof o === 'object' && o !== null
      ? { value: str((o as Record<string, unknown>).value), label: str((o as Record<string, unknown>).label ?? (o as Record<string, unknown>).value) }
      : { value: str(o), label: str(o) },
  );
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">{str(block.label) || name}</span>
      <select
        value={str(form?.[name])}
        onChange={(e) => onFormChange?.(name, e.target.value)}
        className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-sm text-fg focus:border-line-strong focus:outline-none"
      >
        <option value="">{str(block.placeholder) || 'Any'}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {!Array.isArray(block.options) && <span className="text-xs text-subtle">(no values available)</span>}
    </label>
  );
}

function ToggleBlock({ block, form, onFormChange }: { block: Block } & FormProps) {
  const name = str(block.name) || 'value';
  return (
    <label className="flex items-center gap-2 text-sm text-fg-soft">
      <input type="checkbox" checked={form?.[name] === true} onChange={(e) => onFormChange?.(name, e.target.checked)} className="h-4 w-4 accent-sky-600" />
      {str(block.label) || name}
    </label>
  );
}

function ButtonGroupBlock({ block, onAction, busy }: { block: Block } & FormProps) {
  const buttons = Array.isArray(block.buttons) ? (block.buttons as Record<string, unknown>[]) : [];
  return (
    <BlockFrame title={block.title}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {buttons.map((b, i) => (
          <button
            key={i}
            type="button"
            disabled={busy || !onAction || !str(b.eventKey)}
            onClick={() => onAction?.(str(b.eventKey), (b.payload as Record<string, unknown>) ?? {}, str(b.label))}
            className="rounded-lg border border-line bg-panel px-4 py-3 text-left text-sm font-medium text-fg shadow-sm transition-colors hover:border-sky-500 hover:bg-sky-500/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {str(b.label)}
          </button>
        ))}
      </div>
    </BlockFrame>
  );
}

function renderBlock(block: Block, i: number, formProps: FormProps) {
  switch (block.type) {
    case 'markdown':
      return (
        <BlockFrame key={i} title={block.title}>
          <Markdown text={str(block.text)} />
        </BlockFrame>
      );
    case 'keyValue':
      return <KeyValueBlock key={i} block={block} />;
    case 'table':
      return <TableBlock key={i} block={block} />;
    case 'kpiCards':
      return <KpiCardsBlock key={i} block={block} />;
    case 'barChart':
      return (
        <BlockFrame key={i} title={block.title}>
          <BarChart labels={(block.labels as unknown[] | undefined)?.map(str) ?? []} values={(block.values as unknown[] | undefined)?.map(Number) ?? []} />
        </BlockFrame>
      );
    case 'executiveDashboard':
      return <ExecutiveDashboard key={i} data={block} />;
    case 'select':
      return <SelectBlock key={i} block={block} {...formProps} />;
    case 'toggle':
      return <ToggleBlock key={i} block={block} {...formProps} />;
    case 'buttonGroup':
      return <ButtonGroupBlock key={i} block={block} {...formProps} />;
    default:
      return (
        <BlockFrame key={i} title={block.title}>
          <pre className="overflow-x-auto rounded-lg border border-line bg-panel p-3 text-xs">{JSON.stringify(block, null, 2)}</pre>
        </BlockFrame>
      );
  }
}

/** Renders a workflow's UI response. Inputs (select/toggle) sit in one row above the content. */
export function Renderer({ ui, ...formProps }: { ui: UiResponse } & FormProps) {
  const blocks = (Array.isArray(ui.blocks) ? ui.blocks : []).filter((b): b is Block => typeof b?.type === 'string');
  const sources = ui.sources ?? {};
  const numbers = citationNumbers(blocks);
  const isInput = (b: Block) => b.type === 'select' || b.type === 'toggle';
  const inputs = blocks.filter(isInput);
  const cited = [...numbers.entries()].filter(([id]) => sources[id]);

  return (
    <CitationContext.Provider value={{ sources, numbers }}>
      <div className="space-y-5">
        {ui.title && <h2 className="text-lg font-semibold text-fg">{ui.title}</h2>}
        {inputs.length > 0 && <div className="flex flex-wrap items-center gap-x-6 gap-y-2">{inputs.map((b, i) => renderBlock(b, i, formProps))}</div>}
        {blocks.filter((b) => !isInput(b)).map((b, i) => renderBlock(b, i, formProps))}
        {cited.length > 0 && (
          <BlockFrame title="Sources">
            <ol className="space-y-1 text-xs text-muted">
              {cited.map(([id, n]) => {
                const s = sources[id];
                return (
                  <li key={id} className="flex items-baseline gap-1.5">
                    <span className="font-medium text-fg-soft">[{n}]</span>
                    {s.url.startsWith('http') ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-700 hover:underline dark:text-sky-300">
                        {s.doc_name} <ExternalLink size={11} />
                      </a>
                    ) : (
                      <span>{s.doc_name}</span>
                    )}
                    {s.version && <span>· v{s.version}</span>}
                    {s.modified && <span>· {s.modified.slice(0, 10)}</span>}
                  </li>
                );
              })}
            </ol>
          </BlockFrame>
        )}
      </div>
    </CitationContext.Provider>
  );
}
