/**
 * Run persistence and the PlatformServices the RunHistory / RunStats nodes read.
 */
import { nanoid } from 'nanoid';
import type { PlatformServices } from '../cli/executors.js';
import type { ExportedWorkflow, NodeResult } from '../frontend/src/types.js';
import type { Db } from './db/index.js';

/** Node outputs above this size are stored as a stub (ingestion chunks carry embedding vectors). */
const MAX_STORED_OUTPUT_BYTES = 64 * 1024;

export const TRIGGER_TYPES = new Set(['UIEventTrigger', 'ChatTrigger']);

export function triggerOf(workflow: ExportedWorkflow) {
  return workflow.nodes.find((n) => TRIGGER_TYPES.has(n.type));
}

export function allowedRoles(params: Record<string, string>): string[] {
  const roles = (params.allowedRoles ?? '').split(',').map((r) => r.trim()).filter(Boolean);
  return roles.length > 0 ? roles : ['user', 'admin'];
}

function storableOutput(output: unknown): string | null {
  if (output === undefined) return null;
  const json = JSON.stringify(output);
  return json.length > MAX_STORED_OUTPUT_BYTES ? JSON.stringify({ truncated: true, bytes: json.length }) : json;
}

export class RunRecorder {
  readonly id = `run_${nanoid(10)}`;
  private readonly started = Date.now();
  private pending: Promise<unknown>[] = [];
  private readonly db: Db;

  private constructor(db: Db) {
    this.db = db;
  }

  static async start(
    db: Db,
    run: { eventKey: string; workflow: ExportedWorkflow; label: string; userId: string | null },
  ): Promise<RunRecorder> {
    const recorder = new RunRecorder(db);
    const ai = run.workflow.nodes.some((n) => n.type === 'AIAgent');
    await db.query(
      `INSERT INTO runs (id, event_key, workflow_name, label, user_id, ai, status) VALUES ($1, $2, $3, $4, $5, $6, 'running')`,
      [recorder.id, run.eventKey, run.workflow.name, run.label.slice(0, 200), run.userId, ai],
    );
    return recorder;
  }

  /** For executeWorkflow's onNodeComplete; writes are awaited in finish(). */
  node = (result: NodeResult): void => {
    this.pending.push(
      this.db.query(
        `INSERT INTO run_nodes (run_id, node_id, type, status, duration_ms, error, output) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [this.id, result.id, result.type, result.status, result.durationMs, result.error ?? null, storableOutput(result.output)],
      ),
    );
  };

  async finish(status: 'completed' | 'failed', error?: string): Promise<void> {
    await Promise.allSettled(this.pending);
    await this.db.query(`UPDATE runs SET status = $2, error = $3, duration_ms = $4 WHERE id = $1`, [
      this.id,
      status,
      error ?? null,
      Date.now() - this.started,
    ]);
  }
}

export function createServices(db: Db): PlatformServices {
  return {
    async runHistory({ userId, limit }) {
      return db.query(
        `SELECT r.id, r.event_key, r.workflow_name, r.label, r.status, r.duration_ms, r.started_at, u.email AS user_email
           FROM runs r LEFT JOIN users u ON u.id = r.user_id
          WHERE r.ai AND ($1::text IS NULL OR r.user_id = $1)
          ORDER BY r.started_at DESC LIMIT $2`,
        [userId ?? null, limit],
      );
    },

    async runStats({ userId, days }) {
      const params = [userId ?? null, days];
      const scope = `r.ai AND ($1::text IS NULL OR r.user_id = $1) AND r.started_at > now() - make_interval(days => $2::int)`;
      const [totals] = await db.query<Record<string, number>>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'completed')::int AS completed,
                count(*) FILTER (WHERE status = 'failed')::int AS failed,
                coalesce(round(avg(duration_ms)), 0)::int AS "avgMs",
                count(DISTINCT user_id)::int AS users
           FROM runs r WHERE ${scope}`,
        params,
      );
      const byEvent = await db.query(
        `SELECT r.workflow_name AS label, r.event_key, count(*)::int AS total,
                count(*) FILTER (WHERE status = 'failed')::int AS failed,
                coalesce(round(avg(duration_ms)), 0)::int AS avg_ms
           FROM runs r WHERE ${scope} GROUP BY r.workflow_name, r.event_key ORDER BY total DESC`,
        params,
      );
      const byDay = await db.query(
        `SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day, count(*)::int AS total
           FROM runs r WHERE ${scope} GROUP BY 1 ORDER BY 1`,
        params,
      );
      return { ...totals, byEvent, byDay };
    },

    async platformStatus({ role }) {
      const published = await db.query<{ event_key: string; name: string; version: number; published_at: string; allowed_roles: string }>(
        'SELECT event_key, name, version, published_at, allowed_roles FROM published_workflows ORDER BY event_key',
      );
      const [runs] = await db.query<Record<string, number | string | null>>(
        `SELECT count(*) FILTER (WHERE status = 'running' AND started_at > now() - interval '10 minutes')::int AS running,
                count(*) FILTER (WHERE started_at > now() - interval '24 hours')::int AS "runs24h",
                count(*) FILTER (WHERE status = 'failed' AND started_at > now() - interval '24 hours')::int AS "failed24h",
                max(started_at) AS "lastRunAt"
           FROM runs`,
      );
      return {
        ...runs,
        published: published
          .filter((p) => p.allowed_roles.split(',').includes(role))
          .map(({ allowed_roles: _, ...p }) => p),
      };
    },
  };
}
