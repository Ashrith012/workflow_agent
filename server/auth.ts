/**
 * Email/password login with a JWT in an httpOnly cookie. The browser sends the
 * cookie automatically, so existing fetch('/api/...') calls need no changes.
 */
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { RunUser } from '../cli/executors.js';
import type { Db } from './db/index.js';

export const COOKIE_NAME = 'wf_session';
const SESSION_SECONDS = 8 * 60 * 60;

/**
 * bcrypt work factor. Each step doubles the time to hash and to crack; 10 is the OWASP
 * floor and a sensible default for this pure-JS implementation. The cost is stored inside
 * every hash, so raising it here keeps existing passwords verifiable — they are rehashed
 * at the new cost the next time their owner signs in.
 */
const BCRYPT_ROUNDS = Math.min(Math.max(Number(process.env.BCRYPT_ROUNDS) || 10, 10), 15);

/** Compared against when the email is unknown, so timing does not reveal which emails exist. */
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: RunUser;
    user: RunUser;
  }
}

function jwtSecret(log: FastifyInstance['log']): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production.');
  log.warn('JWT_SECRET is not set; using a random secret, so sessions end when the server restarts.');
  return randomBytes(32).toString('hex');
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(cookie);
  await app.register(jwt, { secret: jwtSecret(app.log), cookie: { cookieName: COOKIE_NAME, signed: false } });
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Sign in required.' });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if (request.user.role !== 'admin') return reply.code(403).send({ error: 'Tenant administrator access required.' });
}

/** The builder and its test runs belong to FDEs; the tenant admin keeps access too. */
export async function requireBuilder(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if (request.user.role !== 'admin' && request.user.role !== 'fde') {
    return reply.code(403).send({ error: 'FDE or administrator access required.' });
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function createUser(db: Db, email: string, password: string, role: 'admin' | 'fde' | 'user'): Promise<RunUser> {
  const user: RunUser = { id: `usr_${nanoid(10)}`, email: email.trim().toLowerCase(), role };
  await db.query('INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)', [
    user.id,
    user.email,
    await hashPassword(password),
    role,
  ]);
  return user;
}

/** Creates the first administrator from ADMIN_EMAIL / ADMIN_PASSWORD when the users table is empty. */
export async function seedAdmin(db: Db, log: FastifyInstance['log']): Promise<void> {
  const [{ count }] = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM users');
  if (count > 0) return;
  const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = process.env;
  if (!email || !password) {
    log.warn('No users exist. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env and restart to create the first administrator.');
    return;
  }
  await createUser(db, email, password, 'admin');
  log.info({ email }, 'created the first administrator');
}

export async function authRoutes(app: FastifyInstance, { db }: { db: Db }): Promise<void> {
  app.post<{ Body: { email?: unknown; password?: unknown } }>('/api/auth/login', async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return reply.code(400).send({ error: 'Email and password are required.' });
    }
    const [row] = await db.query<RunUser & { password_hash: string }>(
      'SELECT id, email, role, password_hash FROM users WHERE email = $1',
      [email.trim().toLowerCase()],
    );
    const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) return reply.code(401).send({ error: 'Invalid email or password.' });

    // Upgrade hashes written at a lower cost, now that we know the password is right.
    if (bcrypt.getRounds(row.password_hash) < BCRYPT_ROUNDS) {
      await db
        .query('UPDATE users SET password_hash = $2 WHERE id = $1', [row.id, await hashPassword(password)])
        .catch((err: Error) => app.log.warn({ err }, 'could not upgrade a password hash'));
    }

    const user: RunUser = { id: row.id, email: row.email, role: row.role };
    const token = await reply.jwtSign(user, { expiresIn: SESSION_SECONDS });
    reply.setCookie(COOKIE_NAME, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_SECONDS,
    });
    return { user };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (request) => ({
    user: { id: request.user.id, email: request.user.email, role: request.user.role },
  }));
}
