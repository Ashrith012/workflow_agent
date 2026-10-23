/**
 * PostgreSQL access. Uses DATABASE_URL when set; otherwise an embedded PGlite
 * database (Postgres compiled to WASM) under .data/pglite, so local development
 * and tests need no database server. Both speak the same SQL and $n parameters.
 */
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** `dataDir: 'memory://'` gives a throwaway in-memory database (tests). */
export async function createDb(options: { url?: string; dataDir?: string } = {}): Promise<Db & { kind: string }> {
  const url = options.url ?? process.env.DATABASE_URL;
  let db: Db & { kind: string };

  if (url) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    await pool.query(SCHEMA);
    db = {
      kind: 'postgres',
      query: async (sql, params) => (await pool.query(sql, params as unknown[])).rows,
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dataDir = options.dataDir ?? process.env.PGLITE_DIR ?? '.data/pglite';
    if (!dataDir.startsWith('memory://')) await mkdir(dataDir, { recursive: true });
    const lite = await PGlite.create(dataDir);
    await lite.exec(SCHEMA);
    // PGlite runs one statement at a time; serialize so concurrent requests never interleave.
    let queue: Promise<unknown> = Promise.resolve();
    db = {
      kind: `pglite (${dataDir})`,
      query: <T,>(sql: string, params?: unknown[]) => {
        const next = queue.then(async () => (await lite.query<T>(sql, params)).rows);
        queue = next.catch(() => undefined);
        return next;
      },
      close: () => lite.close(),
    };
  }
  return db;
}
