import { useLayoutEffect, useRef, useState } from 'react';

/** Content width of the returned ref's element, tracked as it resizes. */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * Small SVG charts. Mark specs follow the data-viz guidance: thin marks, 4px
 * rounded data-ends on the baseline, 2px surface gaps between fills, recessive
 * grid, text in ink colours (never the series colour), hover tooltips.
 */

interface Tip {
  x: number;
  y: number;
  text: string;
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line bg-panel px-2 py-1 text-xs text-fg shadow-md"
      style={{ left: tip.x, top: tip.y - 6 }}
    >
      {tip.text}
    </div>
  );
}

/** Single-series column chart (one measure, one axis). Series colour: categorical slot 1, stepped per theme. */
export function BarChart({ labels, values, height = 180 }: { labels: string[]; values: number[]; height?: number }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const { ref: boxRef, width: boxWidth } = useWidth(640);
  if (values.length === 0) return <p className="text-sm text-muted">No data for this period.</p>;

  const width = Math.max(320, values.length * 12, boxWidth);
  const pad = { top: 12, right: 8, bottom: 28, left: 36 };
  const plotH = height - pad.top - pad.bottom;
  const plotW = width - pad.left - pad.right;
  const max = Math.max(...values, 1);
  const niceMax = max <= 5 ? max : Math.ceil(max / 5) * 5;
  const ticks = [0, niceMax / 2, niceMax];
  const slot = plotW / values.length;
  const barW = Math.max(2, Math.min(40, slot - 2)); // >= 2px surface gap between neighbouring bars
  const y = (v: number) => pad.top + plotH - (v / niceMax) * plotH;
  const labelEvery = Math.ceil(values.length / 10);

  return (
    <div className="relative overflow-x-auto rounded-lg border border-line bg-panel p-3">
      <div ref={boxRef} />
      <svg width={width} height={height} role="img" aria-label={`Column chart: ${labels.map((l, i) => `${l} ${values[i]}`).join(', ')}`} className="text-[#2a78d6] dark:text-[#3987e5]">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-line-strong' : 'stroke-line'} strokeWidth={1} />
            <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-subtle text-[10px] tabular-nums">
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const x = pad.left + i * slot + (slot - barW) / 2;
          const top = y(v);
          const h = Math.max(pad.top + plotH - top, v > 0 ? 1 : 0);
          const r = Math.min(4, h, barW / 2);
          // Rounded top corners only; the data-end is anchored to the baseline.
          const d = `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`;
          return (
            <g key={i}>
              {h > 0 && <path d={d} fill="currentColor" opacity={active === null || active === i ? 1 : 0.45} />}
              {/* Hit target taller and wider than the mark. */}
              <rect
                x={pad.left + i * slot}
                y={pad.top}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => {
                  setActive(i);
                  setTip({ x: x + barW / 2 + 12, y: top + 12, text: `${labels[i]}: ${v}` });
                }}
                onMouseLeave={() => {
                  setActive(null);
                  setTip(null);
                }}
              />
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={height - 10} textAnchor="middle" className="fill-subtle text-[10px]">
                  {labels[i].slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

/** Doughnut with a 2px surface gap between segments, centre total and a labelled legend (identity never colour-alone). */
export function Doughnut({ segments, unit, size = 168 }: { segments: DonutSegment[]; unit: 'percent' | 'count'; size?: number }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const shown = segments.filter((s) => s.value > 0);
  const total = shown.reduce((sum, s) => sum + s.value, 0);
  const r = size / 2 - 4;
  const inner = r * 0.62;
  const c = size / 2;
  const fmt = (v: number) => (unit === 'percent' ? `${v}%` : String(v));

  let angle = -Math.PI / 2;
  const arcs = shown.map((s) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const start = angle;
    angle += sweep;
    return { ...s, start, end: angle };
  });
  const point = (radius: number, a: number) => `${c + radius * Math.cos(a)},${c + radius * Math.sin(a)}`;

  return (
    <div className="relative flex items-center gap-5">
      <svg width={size} height={size} role="img" aria-label={`Execution progress: ${shown.map((s) => `${s.label} ${fmt(s.value)}`).join(', ')}`}>
        {total === 0 ? (
          <circle cx={c} cy={c} r={(r + inner) / 2} fill="none" stroke="#e1e0d9" strokeWidth={r - inner} />
        ) : shown.length === 1 ? (
          <circle cx={c} cy={c} r={(r + inner) / 2} fill="none" stroke={shown[0].color} strokeWidth={r - inner} />
        ) : (
          arcs.map((a) => {
            const large = a.end - a.start > Math.PI ? 1 : 0;
            const d = `M${point(r, a.start)} A${r},${r} 0 ${large} 1 ${point(r, a.end)} L${point(inner, a.end)} A${inner},${inner} 0 ${large} 0 ${point(inner, a.start)} Z`;
            const mid = (a.start + a.end) / 2;
            return (
              <path
                key={a.label}
                d={d}
                fill={a.color}
                stroke="#ffffff"
                strokeWidth={2}
                opacity={active === null || active === a.label ? 1 : 0.45}
                onMouseEnter={() => {
                  setActive(a.label);
                  const [x, y] = point((r + inner) / 2, mid).split(',').map(Number);
                  setTip({ x, y, text: `${a.label}: ${fmt(a.value)}` });
                }}
                onMouseLeave={() => {
                  setActive(null);
                  setTip(null);
                }}
              />
            );
          })
        )}
        <text x={c} y={c - 4} textAnchor="middle" className="fill-[#0b0b0b] text-xl font-semibold">
          {unit === 'percent' ? fmt(shown.find((s) => s.label === 'Completed')?.value ?? 0) : total}
        </text>
        <text x={c} y={c + 14} textAnchor="middle" className="fill-[#52514e] text-[10px]">
          {unit === 'percent' ? 'completed' : 'activities'}
        </text>
      </svg>
      <ul className="space-y-1.5 text-xs">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-[#52514e]">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="w-20">{s.label}</span>
            <span className="font-semibold tabular-nums text-[#0b0b0b]">{fmt(s.value)}</span>
          </li>
        ))}
      </ul>
      <Tooltip tip={tip} />
    </div>
  );
}
