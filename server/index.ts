/**
 * Phase 1a HTTP API. Stateless: no database, no queue, no auth. A run is
 * executed synchronously inside the request; restarting the server drops
 * any in-flight run.
 *
 *   npm run dev:server   # http://localhost:3001
 */
import { buildServer } from './app.js';

const PORT = 3001;

const app = await buildServer();
try {
  // 'localhost' makes Fastify bind both 127.0.0.1 and ::1, whichever the Vite proxy resolves.
  await app.listen({ port: PORT, host: 'localhost' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close().then(() => process.exit(0)));
}
