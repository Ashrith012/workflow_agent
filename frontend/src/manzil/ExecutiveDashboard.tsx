import { toPng } from 'html-to-image';
import { CheckCircle2, Circle, Download, Loader2, Printer } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Doughnut, type DonutSegment } from './charts';
import type { Block } from './types';

/**
 * The fixed executive dashboard layout (16:9, one page): KPI cards; execution
 * progress + vertical timeline; key issues + recommendations; footer. Only the
 * data changes between projects. Always rendered light (corporate theme), so
 * exports look the same whatever theme the viewer uses.
 */

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

// Colours fixed by the dashboard spec (status palette steps).
const PROGRESS: { key: string; label: string; color: string }[] = [
  { key: 'completed', label: 'Completed', color: '#0ca30c' },
  { key: 'inProgress', label: 'In Progress', color: '#2a78d6' },
  { key: 'pending', label: 'Pending', color: '#d03b3b' },
  { key: 'delayed', label: 'Delayed', color: '#ec835a' },
  { key: 'unknown', label: 'Unknown', color: '#898781' },
];
const KPI_TONE: Record<string, string> = { blue: '#2a78d6', green: '#0ca30c', orange: '#ec835a', red: '#d03b3b', grey: '#898781' };
const PRIORITY: Record<string, string> = { critical: 'bg-red-900 text-white', high: 'bg-red-600 text-white', medium: 'bg-orange-500 text-white', low: 'bg-emerald-600 text-white' };
const STATUS: Record<string, string> = {
  completed: 'text-emerald-700 bg-emerald-50 ring-emerald-600/30',
  pending: 'text-orange-700 bg-orange-50 ring-orange-600/30',
  delayed: 'text-red-700 bg-red-50 ring-red-600/30',
  'in progress': 'text-blue-700 bg-blue-50 ring-blue-600/30',
};

/** The dashboard is laid out on a fixed 16:9 page and scaled to fit; exports use the unscaled page. */
const PAGE_W = 1280;
const PAGE_H = 720;

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-0 overflow-hidden rounded-xl bg-white px-4 py-3 shadow-[0_1px_3px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/5">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      {children}
    </div>
  );
}

/** Scale factor that fits the fixed page into the available width. */
function useFitScale() {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(1, entry.contentRect.width / PAGE_W)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, scale };
}

export function ExecutiveDashboard({ data }: { data: Block }) {
  const ref = useRef<HTMLDivElement>(null);
  const { ref: fitRef, scale } = useFitScale();
  const [exporting, setExporting] = useState(false);
  const [generatedAt] = useState(() => new Date());
  const projectName = str(data.projectName) || 'Project';
  const kpis = list(data.kpis).slice(0, 6);
  const progress = (data.progress ?? {}) as Record<string, unknown>;
  const unit = progress.unit === 'percent' ? 'percent' : 'count';
  const segments: DonutSegment[] = PROGRESS.filter((p) => typeof progress[p.key] === 'number').map((p) => ({
    label: p.label,
    value: Number(progress[p.key]),
    color: p.color,
  }));
  const timeline = list(data.timeline).slice(0, 8);
  const issues = list(data.issues).slice(0, 5);
  const recommendations = list(data.recommendations).slice(0, 5);

  const render = async () => {
    if (!ref.current) throw new Error('Dashboard not mounted');
    return toPng(ref.current, { pixelRatio: 2, backgroundColor: '#f6f7f9' });
  };
  const fileName = `${projectName.replace(/[^\w-]+/g, '_')}_executive_dashboard`;

  const downloadPng = async () => {
    setExporting(true);
    try {
      const a = document.createElement('a');
      a.href = await render();
      a.download = `${fileName}.png`;
      a.click();
    } finally {
      setExporting(false);
    }
  };

  const printPdf = async () => {
    setExporting(true);
    try {
      const png = await render();
      const win = window.open('', '_blank');
      if (!win) return;
      win.document.title = fileName;
      win.document.body.style.margin = '0';
      const style = win.document.createElement('style');
      style.textContent = '@page { size: landscape; margin: 0 } img { width: 100%; display: block }';
      const img = win.document.createElement('img');
      img.src = png;
      img.onload = () => win.print();
      win.document.head.append(style);
      win.document.body.append(img);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Executive Dashboard</h3>
        <div className="flex gap-2">
          <button type="button" onClick={() => void downloadPng()} disabled={exporting} className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-fg-soft hover:bg-hover disabled:opacity-50">
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} PNG
          </button>
          <button type="button" onClick={() => void printPdf()} disabled={exporting} className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-fg-soft hover:bg-hover disabled:opacity-50">
            <Printer size={13} /> PDF
          </button>
        </div>
      </div>

      <div ref={fitRef} className="overflow-hidden rounded-xl" style={{ height: PAGE_H * scale }}>
        <div style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <div
          ref={ref}
          data-theme-scope="light"
          className="grid gap-3 bg-[#f6f7f9] p-5 font-sans text-slate-900"
          style={{ width: PAGE_W, height: PAGE_H, gridTemplateRows: 'auto auto minmax(0, 1fr) minmax(0, 1fr) auto' }}
        >
          <header className="flex items-baseline justify-between">
            <h3 className="text-lg font-semibold text-slate-900">{projectName}</h3>
            <span className="text-xs text-slate-500">Executive summary · {generatedAt.toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
          </header>

          {/* 1. KPI summary cards */}
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(kpis.length, 1)}, minmax(0, 1fr))` }}>
            {kpis.map((k, i) => (
              <div key={i} className="rounded-xl bg-white px-4 py-3 shadow-[0_1px_3px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/5" style={{ borderTop: `4px solid ${KPI_TONE[str(k.tone)] ?? KPI_TONE.blue}` }}>
                <p className="text-xs font-medium text-slate-500">{str(k.title)}</p>
                <p className="mt-1 truncate text-2xl font-semibold text-slate-900">{str(k.value)}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-500">{str(k.description)}</p>
              </div>
            ))}
          </div>

          {/* 2. Execution progress  |  3. Project timeline (to its right) */}
          <div className="grid min-h-0 grid-cols-2 gap-3">
            <Card title="Execution Progress">
              {segments.length > 0 ? <Doughnut segments={segments} unit={unit} size={150} /> : <p className="text-sm text-slate-500">Not verified in the knowledge source.</p>}
            </Card>
            <Card title="Project Timeline">
              <ol className="relative ml-2 space-y-[3px] border-l-2 border-slate-200 pl-4">
                {timeline.map((m, i) => {
                  const done = str(m.status).toLowerCase() === 'completed';
                  return (
                    <li key={i} className="relative">
                      <span className="absolute -left-[24px] top-[3px] bg-white">
                        {done ? <CheckCircle2 size={14} className="text-[#0ca30c]" /> : <Circle size={14} className="text-slate-400" />}
                      </span>
                      <div className="flex items-baseline justify-between gap-3 text-[13px] leading-5">
                        <span className={done ? 'font-medium text-slate-900' : 'text-slate-500'}>{str(m.title)}</span>
                        <span className="whitespace-nowrap text-xs tabular-nums text-slate-500">{str(m.date) || 'Pending'}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Card>
          </div>

          {/* 4. Key issues  |  5. Key recommendations (to its right) */}
          <div className="grid min-h-0 grid-cols-2 gap-3">
            <Card title="Key Issues & Pending Actions">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-1.5 font-medium">Issue</th>
                    <th className="pb-1.5 font-medium">Priority</th>
                    <th className="pb-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {issues.map((issue, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-2 text-slate-800">{str(issue.issue)}</td>
                      <td className="py-1 pr-2">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${PRIORITY[str(issue.priority).toLowerCase()] ?? 'bg-slate-200 text-slate-700'}`}>{str(issue.priority)}</span>
                      </td>
                      <td className="py-1">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS[str(issue.status).toLowerCase()] ?? 'bg-slate-50 text-slate-600 ring-slate-300'}`}>
                          {str(issue.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Key Recommendations">
              <ul className="space-y-2">
                {recommendations.map((r, i) => {
                  const pct = Math.max(0, Math.min(100, Number(r.confidence) || 0));
                  return (
                    <li key={i} className="text-xs">
                      <div className="flex justify-between gap-3">
                        <span className="text-slate-800">{str(r.text)}</span>
                        <span className="font-semibold tabular-nums text-slate-900">{pct}%</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-100" aria-hidden>
                        <div className="h-1.5 rounded-full bg-[#2a78d6]" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

          <footer className="text-center text-[11px] leading-4 text-slate-500">
            <p className="font-semibold tracking-wide">CONFIDENTIAL — {projectName}</p>
            <p>For Internal / Client Review Only</p>
          </footer>
        </div>
        </div>
      </div>
    </section>
  );
}
