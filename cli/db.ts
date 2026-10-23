/**
 * Look inside the platform database (DATABASE_URL, or the embedded PGlite in .data/pglite).
 *
 *   npm run db                         tables with row counts
 *   npm run db -- users                first rows of one table
 *   npm run db -- "SELECT ... "        any SQL
 *
 * With the embedded database, stop the API server first: only one process may open it.
 */
import { createDb } from '../server/db/index.js';

const TABLES = ['users', 'published_workflows', 'runs', 'run_nodes', 'chat_messages'];
// Wide JSON columns are cut so rows fit on screen.
const MAX_CELL = 60;

async function apiServerRunning(): Promise<boolean> {
  try {
    await fetch('http://localhost:3001/api/auth/me', { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

function printable(rows: Record<string, unknown>[]) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => {
        const text = v instanceof Date ? v.toISOString() : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
        return [k, text.length > MAX_CELL ? `${text.slice(0, MAX_CELL)}…` : text];
      }),
    ),
  );
}

async function main() {
  if (!process.env.DATABASE_URL && (await apiServerRunning())) {
    throw new Error('The API server is running and has the embedded database open. Stop `npm run dev:all` first, then run this again.');
  }
  const arg = process.argv.slice(2).join(' ').trim();
  const db = await createDb();
  console.log(`database: ${db.kind}\n`);
  try {
    if (!arg) {
      const counts = [];
      for (const table of TABLES) {
        const [{ rows }] = await db.query<{ rows: number }>(`SELECT count(*)::int AS rows FROM ${table}`);
        counts.push({ table, rows });
      }
      console.table(counts);
      console.log('\nShow a table:  npm run db -- users\nRun SQL:       npm run db -- "SELECT email, role FROM users"');
    } else if (TABLES.includes(arg)) {
      const order = arg === 'run_nodes' ? '' : arg === 'published_workflows' ? 'ORDER BY published_at DESC' : 'ORDER BY 1 DESC';
      // The password hash and full workflow JSON are left out of the quick view.
      const columns =
        arg === 'users' ? 'id, email, role, created_at' : arg === 'published_workflows' ? 'event_key, name, trigger_type, allowed_roles, version, published_at' : '*';
      console.table(printable(await db.query(`SELECT ${columns} FROM ${arg} ${order} LIMIT 20`)));
    } else {
      const rows = await db.query(arg);
      if (rows.length === 0) console.log('(no rows)');
      else console.table(printable(rows));
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exitCode = 1;
});
