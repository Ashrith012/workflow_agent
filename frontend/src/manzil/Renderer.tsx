import { ArrowRight, CircleCheck, CircleDashed, CircleHelp, CircleX, ExternalLink, Gauge, Workflow, type LucideIcon } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Sparkline } from './charts';
import { ExecutiveDashboard } from './ExecutiveDashboard';
import { blockIcon } from './icons';
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

function BlockFrame({ title, description, children }: { title?: string; description?: unknown; children: ReactNode }) {
  return (
    <section className="space-y-2">
      {title && (
        <div>
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {description ? <p className="text-xs text-subtle">{str(description)}</p> : null}
        </div>
      )}
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

/** Icon chip + sparkline colour per KPI tone. */
const TONE: Record<string, { chip: string; ink: string }> = {
  blue: { chip: 'bg-sky-500/12 text-sky-600 dark:text-sky-300', ink: 'text-sky-500' },
  green: { chip: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300', ink: 'text-emerald-500' },
  orange: { chip: 'bg-orange-500/12 text-orange-600 dark:text-orange-300', ink: 'text-orange-500' },
  red: { chip: 'bg-red-500/12 text-red-600 dark:text-red-300', ink: 'text-red-500' },
  grey: { chip: 'bg-slate-500/12 text-slate-600 dark:text-slate-300', ink: 'text-slate-500' },
};

function KpiCardsBlock({ block }: { block: Block }) {
  const cards = Array.isArray(block.cards) ? (block.cards as Record<string, unknown>[]) : [];
  return (
    <BlockFrame title={block.title} description={block.description}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, i) => {
          const tone = TONE[str(card.tone)] ?? TONE.grey;
          const Icon = blockIcon(card.icon, Gauge);
          const trend = Array.isArray(card.trend) ? card.trend.map(Number).filter(Number.isFinite) : [];
          return (
            <div key={i} className="group relative overflow-hidden rounded-xl border border-line bg-panel p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">{str(card.title)}</p>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.chip}`}>
                  <Icon size={16} aria-hidden />
                </span>
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div>
                  <p className="text-3xl font-semibold tabular-nums tracking-tight text-fg">{str(card.value)}</p>
                  <p className="mt-1 text-xs text-subtle">{str(card.description)}</p>
                </div>
                <span className={tone.ink}>
                  <Sparkline values={trend} />
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </BlockFrame>
  );
}

function HeroBlock({ block }: { block: Block }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = str(block.user).split('@')[0];
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-sky-600 via-indigo-600 to-violet-700 p-6 text-white shadow-lg sm:p-8">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-28 right-40 h-64 w-64 rounded-full bg-sky-300/20 blur-3xl" />
      <div className="relative">
        {block.eyebrow ? <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/70">{str(block.eyebrow)}</p> : null}
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {name ? `${greeting}, ${name}` : str(block.title) || greeting}
        </h2>
        {block.subtitle ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/80">{str(block.subtitle)}</p> : null}
      </div>
    </section>
  );
}

const HEALTH: Record<string, { dot: string; label: string }> = {
  ok: { dot: 'bg-emerald-500', label: 'Operational' },
  warn: { dot: 'bg-amber-500', label: 'Attention' },
  down: { dot: 'bg-red-500', label: 'Down' },
};

function StatusListBlock({ block }: { block: Block }) {
  const items = Array.isArray(block.items) ? (block.items as Record<string, unknown>[]) : [];
  return (
    <BlockFrame title={block.title} description={block.description}>
      <ul className="divide-y divide-line rounded-xl border border-line bg-panel shadow-sm">
        {items.length === 0 && <li className="px-4 py-3 text-sm text-muted">Nothing to show.</li>}
        {items.map((item, i) => {
          const health = HEALTH[str(item.status)] ?? HEALTH.ok;
          return (
            <li key={i} className="flex items-center gap-3 px-4 py-2.5">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                {item.status === 'ok' && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-40 ${health.dot}`} />}
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${health.dot}`} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{str(item.label)}</span>
                <span className="block truncate text-xs text-subtle">{str(item.detail)}</span>
              </span>
              <span className="sr-only">{health.label}</span>
            </li>
          );
        })}
      </ul>
    </BlockFrame>
  );
}

function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

function ActivityFeedBlock({ block }: { block: Block }) {
  const items = Array.isArray(block.items) ? (block.items as Record<string, unknown>[]) : [];
  return (
    <BlockFrame title={block.title} description={block.description}>
      <ol className="rounded-xl border border-line bg-panel p-4 shadow-sm">
        {items.length === 0 && <li className="text-sm text-muted">No activity yet. Run an action to get started.</li>}
        {items.map((item, i) => (
          <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
            {i < items.length - 1 && <span aria-hidden className="absolute left-[11px] top-6 h-full w-px bg-line" />}
            <span className="relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-page ring-1 ring-line">
              <Workflow size={12} className="text-muted" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-sm font-medium text-fg">{str(item.title)}</span>
                {item.status ? <StatusPill value={str(item.status)} /> : null}
              </div>
              <p className="mt-0.5 truncate text-xs text-subtle">
                {[timeAgo(str(item.at)), str(item.duration), str(item.user)].filter(Boolean).join(' · ')}
              </p>
            </div>
          </li>
        ))}
      </ol>
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

/**
 * A button fires its workflow (`eventKey`), or opens another page of the app (`to`).
 * Buttons with an icon or description render as action tiles.
 */
function ButtonGroupBlock({ block, onAction, busy }: { block: Block } & FormProps) {
  const navigate = useNavigate();
  const buttons = Array.isArray(block.buttons) ? (block.buttons as Record<string, unknown>[]) : [];
  const tiles = buttons.some((b) => b.icon || b.description);
  return (
    <BlockFrame title={block.title} description={block.description}>
      <div className={`grid gap-2 ${tiles ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'}`}>
        {buttons.map((b, i) => {
          const to = str(b.to);
          const internal = to.startsWith('/app');
          const disabled = internal ? false : busy || !onAction || !str(b.eventKey);
          const onClick = () =>
            internal ? navigate(to) : onAction?.(str(b.eventKey), (b.payload as Record<string, unknown>) ?? {}, str(b.label));
          if (!tiles) {
            return (
              <button
                key={i}
                type="button"
                disabled={disabled}
                onClick={onClick}
                className="rounded-lg border border-line bg-panel px-4 py-3 text-left text-sm font-medium text-fg shadow-sm transition-colors hover:border-sky-500 hover:bg-sky-500/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {str(b.label)}
              </button>
            );
          }
          const Icon = blockIcon(b.icon);
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={onClick}
              className="group flex items-start gap-3 rounded-xl border border-line bg-panel p-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-500/60 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500/15 to-indigo-500/15 text-sky-600 transition group-hover:from-sky-500 group-hover:to-indigo-500 group-hover:text-white dark:text-sky-300">
                <Icon size={17} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-sm font-semibold text-fg">
                  {str(b.label)}
                  <ArrowRight size={13} className="-translate-x-1 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" aria-hidden />
                </span>
                {b.description ? <span className="mt-0.5 block text-xs leading-snug text-subtle">{str(b.description)}</span> : null}
              </span>
            </button>
          );
        })}
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
    case 'hero':
      return <HeroBlock key={i} block={block} />;
    case 'statusList':
      return <StatusListBlock key={i} block={block} />;
    case 'activityFeed':
      return <ActivityFeedBlock key={i} block={block} />;
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

const FULL_WIDTH = new Set(['hero', 'kpiCards', 'executiveDashboard']);
const ASIDE = new Set(['statusList', 'activityFeed']);

/**
 * Renders a workflow's UI response. Inputs (select/toggle) sit in one row above the content.
 * The dashboard layout puts hero and KPI blocks full width, status and activity blocks in a
 * side column and everything else (plus `children`, e.g. an action's result) in the main column.
 */
export function Renderer({
  ui,
  layout = 'stack',
  children,
  ...formProps
}: { ui: UiResponse; layout?: 'stack' | 'dashboard'; children?: ReactNode } & FormProps) {
  const blocks = (Array.isArray(ui.blocks) ? ui.blocks : []).filter((b): b is Block => typeof b?.type === 'string');
  const sources = ui.sources ?? {};
  const numbers = citationNumbers(blocks);
  const isInput = (b: Block) => b.type === 'select' || b.type === 'toggle';
  const inputs = blocks.filter(isInput);
  const cited = [...numbers.entries()].filter(([id]) => sources[id]);
  const inputRow = inputs.length > 0 && (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-panel px-4 py-3 shadow-sm">
      {inputs.map((b, i) => renderBlock(b, i, formProps))}
    </div>
  );

  if (layout === 'dashboard') {
    const rest = blocks.filter((b) => !isInput(b));
    const aside = rest.filter((b) => ASIDE.has(b.type));
    const main = rest.filter((b) => !FULL_WIDTH.has(b.type) && !ASIDE.has(b.type));
    return (
      <CitationContext.Provider value={{ sources, numbers }}>
        <div className="space-y-6">
          {rest.filter((b) => FULL_WIDTH.has(b.type)).map((b, i) => renderBlock(b, i, formProps))}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              {inputRow}
              {main.map((b, i) => renderBlock(b, i, formProps))}
              {children}
            </div>
            {aside.length > 0 && <aside className="space-y-6">{aside.map((b, i) => renderBlock(b, i, formProps))}</aside>}
          </div>
        </div>
      </CitationContext.Provider>
    );
  }

  return (
    <CitationContext.Provider value={{ sources, numbers }}>
      <div className="space-y-5">
        {ui.title && <h2 className="text-lg font-semibold text-fg">{ui.title}</h2>}
        {inputRow}
        {blocks.filter((b) => !isInput(b)).map((b, i) => renderBlock(b, i, formProps))}
        {children}
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
