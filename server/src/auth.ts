import { Router, type NextFunction, type Request, type Response } from 'express';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { hasErrors, loginRules, signupRules, validate } from '../../shared/validate';
import type { DB } from './db';
import { clientIp, HttpError, invalid, RateLimiter } from './http';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

export interface User { id: string; email: string; name: string; createdAt: string }
interface UserRow { id: string; email: string; name: string; password_hash: string; created_at: string }
const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, name: r.name, createdAt: r.created_at });

// ---- passwords: scrypt with a per-user salt, stored as scrypt$N$r$p$salt$hash ----
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 32768 * 8 * 2 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
// Compared against when the email is unknown, so both paths take the same time.
const DUMMY_HASH = hashPassword('not-a-real-password');

// ---- sessions: a random token in an httpOnly cookie; only its SHA-256 is stored ----
export const SESSION_COOKIE = 'sp_session';
const SESSION_DAYS = 30;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function setSessionCookie(res: Response, token: string, maxAgeSeconds: number): void {
  const flags = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (process.env.NODE_ENV === 'production') flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

/** The signed-in user for this request, or null. */
export function currentUser(db: DB, req: Request): User | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), new Date().toISOString()) as UserRow | undefined;
  return row ? toUser(row) : null;
}
export function requireUser(db: DB, req: Request): User {
  const user = currentUser(db, req);
  if (!user) throw new HttpError(401, 'Log in to do that.');
  return user;
}

/**
 * Rejects state-changing requests that come from another site. Browsers send Origin on
 * cross-site POSTs, so a mismatch means the request did not start on our own pages.
 */
export function sameOriginOnly(req: Request, _res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD') { next(); return; }
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* malformed */ }
    if (host !== req.headers.host) { next(new HttpError(403, 'Cross-site requests are not allowed.')); return; }
  }
  next();
}

export function authRouter(db: DB): Router {
  const router = Router();
  const loginLimit = new RateLimiter(10, 15 * 60_000);
  const signupLimit = new RateLimiter(5, 60 * 60_000);

  const startSession = (res: Response, userId: string) => {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha256(token), userId, new Date(now).toISOString(), new Date(now + SESSION_DAYS * 86_400_000).toISOString());
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date(now).toISOString());
    setSessionCookie(res, token, SESSION_DAYS * 86_400);
  };
  /** Moves this browser's anonymous reports and form entries onto the account. */
  const claimAnonymousWork = (req: Request, userId: string) => {
    const clientId = req.header('x-client-id') ?? '';
    if (!/^[A-Za-z0-9-]{8,64}$/.test(clientId)) return;
    db.prepare('UPDATE reports SET user_id = ? WHERE user_id IS NULL AND client_id = ?').run(userId, clientId);
    db.prepare('UPDATE submissions SET user_id = ? WHERE user_id IS NULL AND client_id = ?').run(userId, clientId);
  };

  router.get('/me', (req, res) => { res.json({ user: currentUser(db, req) }); });

  router.post('/signup', async (req, res) => {
    signupLimit.hit(clientIp(req));
    const { values, errors } = validate(req.body, signupRules);
    if (hasErrors(errors)) throw invalid(errors);
    const email = values.email.toLowerCase();
    const password = String(req.body.password);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Some fields need attention.', { email: 'An account with this email already exists. Log in instead.' });
    const id = randomUUID();
    db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, email, values.name, await hashPassword(password), new Date().toISOString());
    claimAnonymousWork(req, id);
    startSession(res, id);
    res.status(201).json({ user: toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow) });
  });

  router.post('/login', async (req, res) => {
    const { values, errors } = validate(req.body, loginRules);
    if (hasErrors(errors)) throw invalid(errors);
    const email = values.email.toLowerCase();
    loginLimit.hit(`${clientIp(req)}|${email}`);
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
    const ok = await verifyPassword(String(req.body.password), row?.password_hash ?? (await DUMMY_HASH));
    if (!row || !ok) throw new HttpError(401, 'Email or password is incorrect.');
    claimAnonymousWork(req, row.id);
    startSession(res, row.id);
    res.json({ user: toUser(row) });
  });

  router.post('/logout', (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    setSessionCookie(res, '', 0);
    res.status(204).end();
  });

  // Deleting an account removes its sessions, reports and jobs (cascades) and detaches form entries.
  router.delete('/account', async (req, res) => {
    const user = requireUser(db, req);
    loginLimit.hit(`${clientIp(req)}|${user.email}`);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    if (!(await verifyPassword(String(req.body?.password ?? ''), row.password_hash))) throw new HttpError(400, 'Some fields need attention.', { password: 'That password is incorrect.' });
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    setSessionCookie(res, '', 0);
    res.status(204).end();
  });

  return router;
}
