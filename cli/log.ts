const MAX_STRING_CHARS = 200;

/** Warnings always go to stderr so stdout stays a clean execution log. */
export function warn(message: string): void {
  console.error(`⚠ ${message}`);
}

/** Recursively truncate long strings so logged payloads stay readable. */
function truncateStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_STRING_CHARS ? `${value.slice(0, MAX_STRING_CHARS)}…` : value;
  }
  if (Array.isArray(value)) return value.map(truncateStrings);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncateStrings(v)]));
  }
  return value;
}

/** Pretty JSON with strings truncated; continuation lines are indented by `indent`. */
export function formatValue(value: unknown, indent: string): string {
  const json = JSON.stringify(truncateStrings(value), null, 2) ?? 'undefined';
  return json.split('\n').join(`\n${indent}`);
}
