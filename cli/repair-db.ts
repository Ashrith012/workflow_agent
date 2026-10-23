/**
 * Repairs text that was damaged on its way into the platform database (DATABASE_URL).
 *
 *   npm run repair:db              show what would change
 *   npm run repair:db -- --apply   write it
 *
 * Three fixes, all idempotent, so it is safe to re-run:
 *  - Mojibake. Text written through a cp1252 round-trip stores each UTF-8 byte as its own
 *    character, so an em dash (E2 80 94) reads back as "â€”". Rather than listing every
 *    damaged character, the run is mapped back to bytes and re-decoded as UTF-8.
 *  - Dashes. Every dash, and the middle dot, becomes a plain ASCII "-", so no further
 *    encoding mishap can damage it.
 *  - Models. Workflows published before the local-model switch still name Groq and Gemini.
 *
 * Columns are discovered from the catalog, so tables added later are covered too. Only the
 * affected substrings change; builder edits made since publishing are kept.
 */
import { pathToFileURL } from 'node:url';
import { createDb, type Db } from '../server/db/index.js';

/** cp1252's 0x80-0x9F block; every other byte maps to the code point of the same value. */
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F'
  + '\u0090‘’“”•–—˜™š›œ\u009DžŸ';

const BYTE_OF = new Map<string, number>();
for (let b = 0; b < 0x100; b++) {
  BYTE_OF.set(b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b), b);
}

/** The lead bytes of a UTF-8 sequence seen through cp1252 — what damaged text always starts with. */
const MOJIBAKE_LEAD = /[Â-ßà-ïð-ô]/;

/**
 * Undoes one cp1252 round-trip. Each maximal run of characters that could have come from a
 * single byte is converted back to bytes and decoded as UTF-8; the run is replaced only when
 * it both holds a plausible lead byte and decodes cleanly, so correctly stored text is left alone.
 */
export function demojibake(value: string): string {
  let out = '';
  let run = '';
  const flush = () => {
    if (run) {
      out += decodeRun(run);
      run = '';
    }
  };
  for (const ch of value) {
    if (BYTE_OF.has(ch)) run += ch;
    else {
      flush();
      out += ch;
    }
  }
  flush();
  return out;
}

function decodeRun(run: string): string {
  if (!MOJIBAKE_LEAD.test(run)) return run;
  const bytes = Buffer.from([...run].map((c) => BYTE_OF.get(c)!));
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // A replacement character means the bytes were not UTF-8 after all: keep the original.
  return decoded.includes('�') ? run : decoded;
}

/** Dashes and the middle dot to ASCII, so the text cannot be damaged again. */
const toAscii = (value: string) => value.replace(/[‐-―−·]/g, '-');

const MODEL_FIXES: [RegExp, string][] = [
  [/groq:openai\/gpt-oss-(?:20|120)b/g, 'selfhosted:qwen2.5:7b'],
  [/gemini:gemini-embedding-2/g, 'selfhosted:nomic-embed-text'],
];

/** The whole rewrite for one stored value. `models` only applies to the workflow catalog. */
export function repairValue(value: string, models: boolean): string {
  const fixed = toAscii(demojibake(value));
  return models ? MODEL_FIXES.reduce((acc, [from, to]) => acc.replace(from, to), fixed) : fixed;
}

interface Column {
  table_name: string;
  column_name: string;
  data_type: string;
}

async function repairColumn(db: Db, c: Column, apply: boolean): Promise<number> {
  const json = c.data_type === 'jsonb' || c.data_type === 'json';
  const models = c.table_name === 'published_workflows';
  const rows = await db.query<{ ctid: string; v: string | null }>(
    `SELECT ctid::text AS ctid, "${c.column_name}"::text AS v FROM "${c.table_name}"`,
  );
  let changed = 0;
  for (const row of rows) {
    if (row.v === null) continue;
    const next = repairValue(row.v, models);
    if (next === row.v) continue;
    changed++;
    if (apply) {
      await db.query(
        `UPDATE "${c.table_name}" SET "${c.column_name}" = $1${json ? `::${c.data_type}` : ''} WHERE ctid = $2::tid`,
        [next, row.ctid],
      );
    }
  }
  if (changed) console.log(`  ${c.table_name}.${c.column_name} (${c.data_type}) — ${changed} row(s)`);
  return changed;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await createDb();
  console.log(`database: ${db.kind}\n`);
  try {
    // current_schema() so a test schema repairs itself rather than the live tables.
    const columns = await db.query<Column>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND data_type IN ('text', 'character varying', 'jsonb', 'json')
        ORDER BY table_name, column_name`,
    );
    let total = 0;
    for (const c of columns) total += await repairColumn(db, c, apply);
    console.log(
      total === 0
        ? '\nNothing to repair.'
        : apply
          ? `\n✓ Repaired ${total} row(s). Reload the app to see it.`
          : `\n${total} row(s) would change. Re-run with: npm run repair:db -- --apply`,
    );
  } finally {
    await db.close();
  }
}

// Guarded so the exported helpers can be imported (and tested) without running a repair.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`✗ ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
