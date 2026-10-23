/**
 * PostgreSQL access. DATABASE_URL points at the platform database; it is required.
 * Queries use $n parameters.
 */
import { readFileSync } from 'node:fs';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/**
 * `schema: 'wf_test_x'` puts the tables in their own PostgreSQL schema and drops it
 * on close, so tests get a throwaway database inside the same server.
 */
export async function createDb(options: { url?: string; schema?: string } = {}): Promise<Db & { kind: string }> {
  const url = options.url ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Point it at a PostgreSQL database, e.g. postgresql://user:pass@host:5432/db');

  const { default: pg } = await import('pg');
  const schema = options.schema;
  if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`invalid schema name: ${schema}`);

  if (schema) {
    const setup = new pg.Pool({ connectionString: url, max: 1 });
    try {
      await setup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await setup.query(`CREATE SCHEMA ${schema}`);
    } finally {
      await setup.end();
    }
  }

  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
  });
  await pool.query(SCHEMA);

  return {
    kind: schema ? `postgres (schema ${schema})` : 'postgres',
    query: async (sql, params) => (await pool.query(sql, params as unknown[])).rows,
    close: async () => {
      if (schema) await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.end();
    },
  };
}
