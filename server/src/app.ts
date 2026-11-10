import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeHook, analyzeScript, detectPlatform, simulateUrlReport, words, type Report, type ReportBody } from '../../shared/engine';
import { affiliateRules, checkoutRules, contactRules, hasErrors, hookRules, scriptRules, validate, waitlistRules, type Rules } from '../../shared/validate';
import { SERVER_ROOT, type DB } from './db';

class HttpError extends Error {
  constructor(public status: number, message: string, public errors?: Record<string, string>) { super(message); }
}
const invalid = (errors: Record<string, string>) => new HttpError(400, 'Some fields need attention.', errors);

interface ReportRow { id: string; body: string; created_at: string }
const toReport = (row: ReportRow): Report => ({ ...(JSON.parse(row.body) as ReportBody), id: row.id, createdAt: row.created_at });

/** Shape check for reports computed in the browser (uploaded video analysis). */
function parseVideoReport(input: unknown): ReportBody | null {
  const r = input as Partial<ReportBody> | null;
  const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
  const score = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100;
  if (!r || r.type !== 'video' || !str(r.title, 200) || !score(r.score)) return null;
  if (!Array.isArray(r.metrics) || r.metrics.length > 10 || !r.metrics.every((m) => m && str(m.name, 60) && score(m.score) && str(m.note, 300))) return null;
  if (!Array.isArray(r.findings) || r.findings.length > 12 || !r.findings.every((f) => f && str(f.at, 40) && str(f.title, 300) && str(f.fix, 300) && (f.sev === 'bad' || f.sev === 'warn'))) return null;
  if (!Array.isArray(r.working) || r.working.length > 10 || !r.working.every((w) => str(w, 300))) return null;
  if (!Array.isArray(r.meta) || r.meta.length > 8 || !r.meta.every((m) => Array.isArray(m) && m.length === 2 && str(m[0], 40) && str(m[1], 80))) return null;
  return { type: 'video', title: r.title!, score: r.score!, metrics: r.metrics, findings: r.findings, working: r.working, meta: r.meta, audio: true };
}

export function createApp(db: DB) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();

  // Until accounts exist (step 3), each browser sends a random id and only sees its own rows.
  const clientId = (req: Request): string => {
    const id = req.header('x-client-id') ?? '';
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new HttpError(400, 'Missing or malformed x-client-id header.');
    return id;
  };
  const checked = (req: Request, rules: Rules) => {
    const { values, errors } = validate(req.body, rules);
    if (hasErrors(errors)) throw invalid(errors);
    return values;
  };
  const saveReport = (client: string, body: ReportBody): Report => {
    const report: Report = { ...body, id: randomUUID(), createdAt: new Date().toISOString() };
    db.prepare('INSERT INTO reports (id, client_id, type, title, score, simulated, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(report.id, client, body.type, body.title, body.score, body.sim ? 1 : 0, JSON.stringify(body), report.createdAt);
    return report;
  };
  const submit = (kind: string, client: string, payload: unknown) =>
    db.prepare('INSERT INTO submissions (kind, client_id, payload, created_at) VALUES (?, ?, ?, ?)').run(kind, client, JSON.stringify(payload), new Date().toISOString());
  const latest = <T>(kind: string, client: string): T | null => {
    const row = db.prepare('SELECT payload FROM submissions WHERE kind = ? AND client_id = ? ORDER BY id DESC LIMIT 1').get(kind, client) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as T) : null;
  };

  api.get('/health', (_req, res) => { res.json({ ok: true }); });

  // ---- content ----
  api.get('/content', (_req, res) => {
    const rows = db.prepare('SELECT key, value FROM content').all() as { key: string; value: string }[];
    res.json(Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])));
  });

  const POST_COLUMNS = 'slug, title, category, published_on AS publishedOn, minutes, tool, excerpt';
  api.get('/posts', (req, res) => {
    const q = String(req.query.q ?? '').trim().toLowerCase().slice(0, 80);
    const category = String(req.query.category ?? '').trim();
    const pageSize = 4;
    const where: string[] = [];
    const args: string[] = [];
    if (category && category !== 'All') { where.push('category = ?'); args.push(category); }
    if (q) { where.push("lower(title || ' ' || excerpt || ' ' || body) LIKE ?"); args.push(`%${q.replace(/[%_]/g, '')}%`); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { n: total } = db.prepare(`SELECT COUNT(*) AS n FROM posts ${clause}`).get(...args) as { n: number };
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pages, Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1));
    const items = db.prepare(`SELECT ${POST_COLUMNS} FROM posts ${clause} ORDER BY published_on DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
    const categories = (db.prepare('SELECT DISTINCT category FROM posts ORDER BY category').all() as { category: string }[]).map((r) => r.category);
    res.json({ items, total, page, pages, pageSize, categories });
  });
  api.get('/posts/:slug', (req, res) => {
    const row = db.prepare(`SELECT ${POST_COLUMNS}, body FROM posts WHERE slug = ?`).get(req.params.slug) as ({ publishedOn: string; body: string } & Record<string, unknown>) | undefined;
    if (!row) throw new HttpError(404, 'That article does not exist.');
    const older = db.prepare('SELECT slug, title FROM posts WHERE published_on < ? ORDER BY published_on DESC LIMIT 1').get(row.publishedOn) ?? null;
    const newer = db.prepare('SELECT slug, title FROM posts WHERE published_on > ? ORDER BY published_on ASC LIMIT 1').get(row.publishedOn) ?? null;
    res.json({ ...row, body: JSON.parse(row.body), older, newer });
  });

  // ---- reports ----
  api.post('/reports/hook', (req, res) => {
    const client = clientId(req);
    const { text } = checked(req, hookRules);
    res.status(201).json(saveReport(client, analyzeHook(text)));
  });
  api.post('/reports/script', (req, res) => {
    const client = clientId(req);
    const { text } = checked(req, scriptRules);
    if (words(text).length < 8) throw invalid({ text: 'Paste at least a couple of sentences so there is something to pace.' });
    res.status(201).json(saveReport(client, analyzeScript(text)));
  });
  api.post('/reports/video-link', (req, res) => {
    const client = clientId(req);
    const url = typeof req.body?.url === 'string' ? req.body.url.trim().slice(0, 500) : '';
    if (!url) throw invalid({ url: 'Paste a link, or switch to Upload a file.' });
    const platform = detectPlatform(url);
    if (!platform) throw invalid({ url: 'That is not a TikTok, Instagram Reels or YouTube Shorts link. Check it and try again.' });
    res.status(201).json(saveReport(client, simulateUrlReport(url, platform)));
  });
  api.post('/reports/video-upload', (req, res) => {
    const client = clientId(req);
    const body = parseVideoReport(req.body);
    if (!body) throw new HttpError(400, 'The video report was not in the expected shape.');
    res.status(201).json(saveReport(client, body));
  });
  api.get('/reports', (req, res) => {
    const client = clientId(req);
    const rows = db.prepare('SELECT id, body, created_at FROM reports WHERE client_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100').all(client) as ReportRow[];
    res.json(rows.map(toReport));
  });
  api.get('/reports/:id', (req, res) => {
    const row = db.prepare('SELECT id, body, created_at FROM reports WHERE id = ? AND client_id = ?').get(req.params.id, clientId(req)) as ReportRow | undefined;
    if (!row) throw new HttpError(404, 'That report was not found. It may have been deleted.');
    res.json(toReport(row));
  });
  api.delete('/reports/:id', (req, res) => {
    const out = db.prepare('DELETE FROM reports WHERE id = ? AND client_id = ?').run(req.params.id, clientId(req));
    if (!out.changes) throw new HttpError(404, 'That report was not found.');
    res.status(204).end();
  });
  api.delete('/reports', (req, res) => {
    db.prepare('DELETE FROM reports WHERE client_id = ?').run(clientId(req));
    res.status(204).end();
  });

  // ---- forms. Nothing is emailed or charged yet: rows land in `submissions`. ----
  api.get('/me', (req, res) => {
    const client = clientId(req);
    res.json({
      plan: latest<{ plan: string }>('checkout', client)?.plan ?? null,
      affiliateCode: latest<{ code: string | null }>('affiliate', client)?.code ?? null,
      waitlist: latest<{ device: string | null }>('waitlist', client)?.device ?? null,
    });
  });
  api.post('/contact', (req, res) => {
    const client = clientId(req);
    const values = checked(req, contactRules);
    submit('contact', client, values);
    res.status(201).json({ topic: values.topic });
  });
  api.post('/waitlist', (req, res) => {
    const client = clientId(req);
    const values = checked(req, waitlistRules);
    submit('waitlist', client, values);
    res.status(201).json({ device: values.device });
  });
  api.delete('/waitlist', (req, res) => {
    submit('waitlist', clientId(req), { device: null });
    res.status(204).end();
  });
  api.post('/affiliates', (req, res) => {
    const client = clientId(req);
    const values = checked(req, affiliateRules);
    const initials = (values.name.match(/\b\p{L}/gu) ?? ['X']).join('').slice(0, 3).toUpperCase();
    const code = `SP-${initials}-${randomUUID().slice(0, 4).toUpperCase()}`;
    submit('affiliate', client, { ...values, code });
    res.status(201).json({ code });
  });
  api.delete('/affiliates', (req, res) => {
    submit('affiliate', clientId(req), { code: null });
    res.status(204).end();
  });
  api.post('/checkout', (req, res) => {
    const client = clientId(req);
    const values = checked(req, checkoutRules);
    submit('checkout', client, values);
    res.status(201).json({ plan: values.plan });
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'No such endpoint.')));
  app.use('/api', api);

  // Serve the built front end when it exists, with a fallback for client-side routes.
  const dist = path.resolve(SERVER_ROOT, '..', 'web', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(dist, 'index.html')) : next()));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) { res.status(err.status).json({ message: err.message, errors: err.errors }); return; }
    const status = (err as { status?: number })?.status;
    if (status && status >= 400 && status < 500) { res.status(status).json({ message: 'The request could not be read.' }); return; }
    console.error(err);
    res.status(500).json({ message: 'Something went wrong on our side. Try again.' });
  });

  return app;
}
