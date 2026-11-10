import type { Request } from 'express';

/** An error with an HTTP status. `errors` carries per-field messages for forms. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public errors?: Record<string, string>) { super(message); }
}
export const invalid = (errors: Record<string, string>) => new HttpError(400, 'Some fields need attention.', errors);

/**
 * Fixed-window rate limiter held in memory. Good for one server process;
 * move to a shared store before running more than one instance.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private max: number, private windowMs: number) {}

  /** Records a hit and throws 429 once `key` is over its allowance. */
  hit(key: string, now = Date.now()): void {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) { this.hits.set(key, { count: 1, resetAt: now + this.windowMs }); this.sweep(now); return; }
    entry.count += 1;
    if (entry.count > this.max) {
      const minutes = Math.max(1, Math.ceil((entry.resetAt - now) / 60_000));
      throw new HttpError(429, `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    }
  }
  private sweep(now: number): void {
    if (this.hits.size < 5000) return;
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

export const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';
