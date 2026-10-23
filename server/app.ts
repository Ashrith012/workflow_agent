/** Fastify instance factory; server/index.ts starts it, test scripts can inject into it. */
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { RunMode } from '../frontend/src/types.js';
import { authRoutes, registerAuth, requireBuilder, seedAdmin } from './auth.js';
import { createDb, type Db } from './db/index.js';
import { createServices, seedTenantModels } from './platform.js';
import { adminRoutes } from './routes/admin.js';
import { appRoutes } from './routes/app.js';
import { fdeRoutes } from './routes/fde.js';
import { runRoutes, type RunRoutesOptions } from './routes/run.js';
import { tenantRoutes } from './routes/tenant.js';

const DEV_ORIGIN = 'http://localhost:5173';

const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

export interface BuildServerOptions extends RunRoutesOptions {
  logger?: boolean;
  /** Defaults to createDb() (DATABASE_URL, else embedded PGlite). */
  db?: Db;
  /** Mode for published-workflow runs from the app; defaults to APP_RUN_MODE or live. */
  appRunMode?: RunMode;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true });

  // The Vite proxy makes the browser's calls same-origin; CORS only matters
  // when something hits :3001 directly from the dev page.
  await app.register(cors, { origin: isProduction ? false : [DEV_ORIGIN], credentials: true });

  app.setErrorHandler((error, request, reply) => {
    const err = error instanceof Error ? error : new Error(String(error));
    const statusCode = (error as { statusCode?: number }).statusCode;
    // Client errors raised by Fastify itself (malformed JSON, wrong content type, body too large).
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: err.message });
    }
    request.log.error(err, 'unhandled error');
    return reply
      .code(500)
      .send(isDevelopment ? { error: err.message, stack: err.stack } : { error: 'Internal server error' });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: `Route ${request.method} ${request.url} not found` });
  });

  const db = options.db ?? (await createDb());
  app.log.info(`database: ${'kind' in db ? db.kind : 'injected'}`);
  if (!options.db) app.addHook('onClose', () => db.close());
  await seedAdmin(db, app.log);
  await seedTenantModels(db);
  const services = createServices(db);

  await registerAuth(app);
  await app.register(authRoutes, { db });
  await app.register(adminRoutes, { db });
  await app.register(tenantRoutes, { db });
  await app.register(fdeRoutes, { db });
  const appRunMode = options.appRunMode ?? (process.env.APP_RUN_MODE === 'mock' ? 'mock' : 'live');
  await app.register(appRoutes, { db, services, mode: appRunMode });

  // The builder's test runs execute arbitrary workflows: FDEs and administrators only.
  await app.register(async (scope) => {
    scope.addHook('preHandler', requireBuilder);
    await scope.register(runRoutes, { timeoutMs: options.timeoutMs, services });
  });
  return app;
}
