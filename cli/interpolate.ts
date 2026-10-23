import { warn as defaultWarn } from './log.js';

/**
 * Matches `{{ $json }}`, `{{ $json.a.b }}`, `{{ $json.items[0].name }}`.
 * Group 1 is the path after `$json` (possibly empty). Anything else inside
 * `{{ }}` is not ours and is left untouched.
 */
const PLACEHOLDER = /\{\{\s*\$json((?:\.[A-Za-z_$][\w$]*|\[\d+\])*)\s*\}\}/g;
const SEGMENT = /\.([A-Za-z_$][\w$]*)|\[(\d+)\]/g;

type Segment = string | number;

function parsePath(path: string): Segment[] {
  return [...path.matchAll(SEGMENT)].map(([, key, index]) =>
    index !== undefined ? Number(index) : key,
  );
}

function resolvePath(root: unknown, segments: Segment[]): { found: boolean; value?: unknown } {
  let current = root;
  for (const segment of segments) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment >= current.length) return { found: false };
      current = current[segment];
    } else {
      if (current === null || typeof current !== 'object' || !Object.hasOwn(current, segment)) {
        return { found: false };
      }
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return current === undefined ? { found: false } : { found: true, value: current };
}

/**
 * Replace every `{{ $json... }}` placeholder in `template` with the value at
 * that path in `input`. Strings are inserted as-is; objects, arrays, numbers,
 * booleans and null are JSON.stringify'd (so `{{ $json }}` or `{{ $json.body }}`
 * embeds the whole structure). Missing paths become '' and emit a warning —
 * interpolation never throws.
 */
export function interpolate(
  template: string,
  input: unknown,
  warn: (message: string) => void = defaultWarn,
  format: (value: unknown) => string = (value) => (typeof value === 'string' ? value : JSON.stringify(value)),
): string {
  return template.replace(PLACEHOLDER, (placeholder, path: string) => {
    const { found, value } = resolvePath(input, parsePath(path));
    if (!found) {
      warn(`interpolation: ${placeholder} did not resolve against the input; using ""`);
      return '';
    }
    return format(value);
  });
}

/**
 * Interpolate a JSON template and parse it. Strings are inserted JSON-escaped
 * (without quotes), so `"q": "{{ $json.message }}"` survives quotes and newlines
 * in the message; other values are inserted as JSON, so `"ids": {{ $json.ids }}`
 * embeds an array. Blank templates parse to `fallback`.
 */
export function interpolateJson(
  template: string,
  input: unknown,
  warn: (message: string) => void = defaultWarn,
  fallback: unknown = {},
): unknown {
  if (!template.trim()) return fallback;
  const text = interpolate(template, input, warn, (value) =>
    typeof value === 'string' ? JSON.stringify(value).slice(1, -1) : JSON.stringify(value),
  );
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON after interpolation (${(err as Error).message}): ${text.slice(0, 200)}`);
  }
}

/** Value at a plain path like `chunks`, `report.blocks` or `files[0]` (no `$json` prefix); undefined if absent. */
export function readPath(input: unknown, path: string): unknown {
  const trimmed = path.trim();
  if (!trimmed) return input;
  const normalized = trimmed.startsWith('[') ? trimmed : `.${trimmed}`;
  return resolvePath(input, parsePath(normalized)).value;
}
