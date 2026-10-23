import { Fragment, type ReactNode } from 'react';

/**
 * Minimal, safe markdown for model-written text: paragraphs, headings, bullet
 * and numbered lists, code fences, **bold**, `code` and http(s) links.
 * Builds React elements only (never innerHTML).
 */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<strong key={m.index}>{m[1]}</strong>);
    else if (m[2]) parts.push(<code key={m.index} className="rounded bg-hover px-1 text-[0.85em]">{m[2]}</code>);
    else
      parts.push(
        <a key={m.index} href={m[4]} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline dark:text-sky-300">
          {m[3]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
      i++;
      nodes.push(<pre key={nodes.length} className="overflow-x-auto rounded-lg border border-line bg-panel p-3 text-xs">{body.join('\n')}</pre>);
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      const List = ordered ? 'ol' : 'ul';
      nodes.push(
        <List key={nodes.length} className={`${ordered ? 'list-decimal' : 'list-disc'} space-y-0.5 pl-5`}>
          {items.map((item, k) => (
            <li key={k}>{inline(item)}</li>
          ))}
        </List>,
      );
    } else if (/^#{1,4}\s/.test(line)) {
      nodes.push(<p key={nodes.length} className="font-semibold text-fg">{inline(line.replace(/^#+\s/, ''))}</p>);
      i++;
    } else if (!line.trim()) {
      i++;
    } else {
      const para: string[] = [];
      for (; i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*]|\d+\.)\s)/.test(lines[i]); i++) para.push(lines[i]);
      nodes.push(
        <p key={nodes.length}>
          {para.map((p, k) => (
            <Fragment key={k}>
              {k > 0 && <br />}
              {inline(p)}
            </Fragment>
          ))}
        </p>,
      );
    }
  }
  return <div className="space-y-2 text-sm leading-6 text-fg-soft">{nodes}</div>;
}
