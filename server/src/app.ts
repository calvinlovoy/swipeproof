import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeHook, analyzeScript, detectPlatform, simulateUrlReport, words, type Report, type ReportBody } from '../../shared/engine';
import { findPatterns, METRIC_KEYS, MIN_VIDEOS, OUTCOMES, outcomes, type Metrics, type OutcomeKey } from '../../shared/results';
import { affiliateRules, checkoutRules, contactRules, hasErrors, hookRules, scriptRules, validate, waitlistRules, type Rules } from '../../shared/validate';
import { authRouter, currentUser, requireUser, sameOriginOnly, type User } from './auth';
import { DATA_DIR, SERVER_ROOT, type DB } from './db';
import { HttpError, invalid } from './http';
import { MAX_SECONDS } from './pipeline/analyze';
import { JobQueue } from './pipeline/jobs';
import type { Providers } from './pipeline/providers';

export interface AppOptions {
  /** Speech-to-text and feedback providers. Either may be null. */
  providers?: Providers;
  /** Whether ffmpeg and ffprobe are installed. Full analysis is off without them. */
  ffmpeg?: boolean;
  uploadDir?: string;
  maxUploadMb?: number;
  /** Full analyses one account may start per 24 hours. */
  dailyLimit?: number;
}

interface ReportRow { id: string; body: string; created_at: string }
const toReport = (row: ReportRow): Report => ({ ...(JSON.parse(row.body) as ReportBody), id: row.id, createdAt: row.created_at });

/** Who is making the request: a signed-in user, or an anonymous browser known by its random id. */
interface Actor { user: User | null; clientId: string }

/** Shape check for reports computed in the browser (the quick check). */
function parseVideoReport(input: unknown): ReportBody | null {
  const r = input as Partial<ReportBody> | null;
  const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
  const score = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100;
  if (!r || r.type !== 'video' || !str(r.title, 200) || !score(r.score)) return null;
  if (!Array.isArray(r.metrics) || r.metrics.length > 10 || !r.metrics.every((m) => m && str(m.name, 60) && score(m.score) && str(m.note, 300))) return null;
  if (!Array.isArray(r.findings) || r.findings.length > 12 || !r.findings.every((f) => f && str(f.at, 40) && str(f.title, 300) && str(f.fix, 300) && (f.sev === 'bad' || f.sev === 'warn'))) return null;
  if (!Array.isArray(r.working) || r.working.length > 10 || !r.working.every((w) => str(w, 300))) return null;
  if (!Array.isArray(r.meta) || r.meta.length > 8 || !r.meta.every((m) => Array.isArray(m) && m.length === 2 && str(m[0], 40) && str(m[1], 80))) return null;
  return { type: 'video', title: r.title!, score: r.score!, metrics: r.metrics, findings: r.findings, working: r.working, meta: r.meta, audio: true, source: 'browser' };
}

export function createApp(db: DB, options: AppOptions = {}) {
  const providers = options.providers ?? { transcriber: null, coach: null };
  const hasFfmpeg = options.ffmpeg ?? false;
  const uploadDir = options.uploadDir ?? path.join(DATA_DIR, 'uploads');
  const maxUploadMb = options.maxUploadMb ?? Number(process.env.MAX_UPLOAD_MB ?? 200);
  const dailyLimit = options.dailyLimit ?? Number(process.env.DAILY_ANALYSIS_LIMIT ?? 20);
  fs.mkdirSync(uploadDir, { recursive: true });

  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); next(); });
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();

  const actor = (req: Request): Actor => {
    const user = currentUser(db, req);
    const header = req.header('x-client-id') ?? '';
    const valid = /^[A-Za-z0-9-]{8,64}$/.test(header);
    if (!user && !valid) throw new HttpError(400, 'Missing or malformed x-client-id header.');
    return { user, clientId: valid ? header : `user-${user!.id}` };
  };
  /** Signed-in users see their account's rows. Anonymous browsers see only unclaimed rows with their id. */
  const scope = (a: Actor) => (a.user ? { where: 'user_id = ?', arg: a.user.id } : { where: 'user_id IS NULL AND client_id = ?', arg: a.clientId });
  const checked = (req: Request, rules: Rules) => {
    const { values, errors } = validate(req.body, rules);
    if (hasErrors(errors)) throw invalid(errors);
    return values;
  };
  const insertReport = (userId: string | null, clientId: string, body: ReportBody): Report => {
    const report: Report = { ...body, id: randomUUID(), createdAt: new Date().toISOString() };
    db.prepare('INSERT INTO reports (id, client_id, user_id, type, title, score, simulated, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(report.id, clientId, userId, body.type, body.title, body.score, body.sim ? 1 : 0, JSON.stringify(body), report.createdAt);
    return report;
  };
  const saveReport = (a: Actor, body: ReportBody) => insertReport(a.user?.id ?? null, a.clientId, body);
  const submit = (kind: string, a: Actor, payload: unknown) =>
    db.prepare('INSERT INTO submissions (kind, client_id, user_id, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(kind, a.clientId, a.user?.id ?? null, JSON.stringify(payload), new Date().toISOString());
  const latest = <T>(kind: string, a: Actor): T | null => {
    const s = scope(a);
    const row = db.prepare(`SELECT payload FROM submissions WHERE kind = ? AND ${s.where} ORDER BY id DESC LIMIT 1`).get(kind, s.arg) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as T) : null;
  };

  const queue = new JobQueue(db, providers, (userId, clientId, body) => insertReport(userId, clientId, body));

  api.get('/health', (_req, res) => { res.json({ ok: true }); });
  api.use('/auth', authRouter(db));

  // What this server can do, so the front end can explain what is and is not available.
  api.get('/capabilities', (_req, res) => {
    res.json({
      fullAnalysis: hasFfmpeg,
      transcription: Boolean(providers.transcriber),
      feedback: Boolean(providers.coach),
      demo: providers.coach?.name === 'demo' || providers.transcriber?.name === 'demo',
      maxUploadMb,
      maxSeconds: MAX_SECONDS,
      dailyLimit,
    });
  });

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
    const a = actor(req);
    const { text } = checked(req, hookRules);
    res.status(201).json(saveReport(a, analyzeHook(text)));
  });
  api.post('/reports/script', (req, res) => {
    const a = actor(req);
    const { text } = checked(req, scriptRules);
    if (words(text).length < 8) throw invalid({ text: 'Paste at least a couple of sentences so there is something to pace.' });
    res.status(201).json(saveReport(a, analyzeScript(text)));
  });
  api.post('/reports/video-link', (req, res) => {
    const a = actor(req);
    const url = typeof req.body?.url === 'string' ? req.body.url.trim().slice(0, 500) : '';
    if (!url) throw invalid({ url: 'Paste a link, or switch to Upload a file.' });
    const platform = detectPlatform(url);
    if (!platform) throw invalid({ url: 'That is not a TikTok, Instagram Reels or YouTube Shorts link. Check it and try again.' });
    res.status(201).json(saveReport(a, simulateUrlReport(url, platform)));
  });
  api.post('/reports/video-upload', (req, res) => {
    const a = actor(req);
    const body = parseVideoReport(req.body);
    if (!body) throw new HttpError(400, 'The video report was not in the expected shape.');
    res.status(201).json(saveReport(a, body));
  });
  api.get('/reports', (req, res) => {
    const s = scope(actor(req));
    const rows = db.prepare(`SELECT id, body, created_at FROM reports WHERE ${s.where} ORDER BY created_at DESC, rowid DESC LIMIT 100`).all(s.arg) as ReportRow[];
    res.json(rows.map(toReport));
  });
  api.get('/reports/:id', (req, res) => {
    const s = scope(actor(req));
    const row = db.prepare(`SELECT id, body, created_at FROM reports WHERE id = ? AND ${s.where}`).get(req.params.id, s.arg) as ReportRow | undefined;
    if (!row) throw new HttpError(404, 'That report was not found. It may have been deleted.');
    res.json(toReport(row));
  });
  api.delete('/reports/:id', (req, res) => {
    const s = scope(actor(req));
    const out = db.prepare(`DELETE FROM reports WHERE id = ? AND ${s.where}`).run(req.params.id, s.arg);
    if (!out.changes) throw new HttpError(404, 'That report was not found.');
    res.status(204).end();
  });
  api.delete('/reports', (req, res) => {
    const s = scope(actor(req));
    db.prepare(`DELETE FROM reports WHERE ${s.where}`).run(s.arg);
    res.status(204).end();
  });

  // ---- full video analysis: sign-in required, the file is stored only until its job finishes ----
  const upload = multer({
    storage: multer.diskStorage({ destination: uploadDir, filename: (_req, _file, done) => done(null, randomUUID()) }),
    limits: { fileSize: Math.floor(maxUploadMb * 1024 * 1024), files: 1 },
    fileFilter: (_req, file, done) => done(null, file.mimetype.startsWith('video/')),
  });
  api.post('/analyses',
    (req, res, next) => {
      // Decide before reading the upload, so a refused request never writes a file.
      const user = requireUser(db, req);
      if (!hasFfmpeg) throw new HttpError(503, 'Full analysis is not available on this server yet. Use the quick check instead.');
      if (queue.recentCount(user.id) >= dailyLimit) throw new HttpError(429, `You have reached the limit of ${dailyLimit} full analyses in 24 hours. Try again tomorrow.`);
      res.locals.actor = actor(req);
      next();
    },
    upload.single('video'),
    (req, res) => {
      const a = res.locals.actor as Actor;
      if (!req.file) throw invalid({ video: 'Choose a video file (MP4, MOV or WebM).' });
      const name = path.basename(req.file.originalname).replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'video';
      res.status(202).json(queue.enqueue(a.user!.id, a.clientId, req.file.path, name, req.file.size));
    },
  );
  api.get('/analyses/:id', (req, res) => {
    const job = queue.get(req.params.id, requireUser(db, req).id);
    if (!job) throw new HttpError(404, 'That analysis was not found.');
    res.json(job);
  });

  // ---- results: ad performance attached to fully analyzed videos, and the patterns between them ----
  api.put('/results', (req, res) => {
    const user = requireUser(db, req);
    const rows: unknown = req.body?.rows;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500) throw new HttpError(400, 'Send between 1 and 500 matched rows.');
    const owns = db.prepare("SELECT 1 FROM reports WHERE id = ? AND user_id = ? AND type = 'video'");
    const save = db.prepare('INSERT INTO results (report_id, user_id, ad_name, metrics, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (report_id) DO UPDATE SET ad_name = excluded.ad_name, metrics = excluded.metrics, created_at = excluded.created_at');
    let saved = 0;
    db.transaction(() => {
      for (const raw of rows as { reportId?: unknown; adName?: unknown; metrics?: Record<string, unknown> }[]) {
        if (typeof raw?.reportId !== 'string' || typeof raw.adName !== 'string' || !owns.get(raw.reportId, user.id)) continue;
        const metrics: Metrics = {};
        for (const key of METRIC_KEYS) { const v = raw.metrics?.[key]; if (typeof v === 'number' && Number.isFinite(v) && v >= 0) metrics[key] = v; }
        if (!Object.keys(metrics).length) continue;
        save.run(raw.reportId, user.id, raw.adName.trim().slice(0, 200), JSON.stringify(metrics), new Date().toISOString());
        saved += 1;
      }
    })();
    if (!saved) throw new HttpError(400, 'None of those rows matched a video in your library.');
    res.json({ saved });
  });
  api.get('/results', (req, res) => {
    const user = requireUser(db, req);
    const rows = db.prepare('SELECT r.id, r.body, x.ad_name, x.metrics FROM results x JOIN reports r ON r.id = x.report_id WHERE x.user_id = ? ORDER BY r.created_at DESC').all(user.id) as { id: string; body: string; ad_name: string; metrics: string }[];
    const videos = rows.map((row) => {
      const body = JSON.parse(row.body) as ReportBody;
      return { reportId: row.id, title: body.title, adName: row.ad_name, score: body.score, traits: body.traits ?? null, outcomes: outcomes(JSON.parse(row.metrics) as Metrics) };
    });
    const patterns = Object.fromEntries((Object.keys(OUTCOMES) as OutcomeKey[]).map((key) => {
      const points = videos.filter((v) => v.traits && v.outcomes[key] !== undefined).map((v) => ({ traits: v.traits!, outcome: v.outcomes[key]! }));
      return [key, { videos: points.length, patterns: findPatterns(points, OUTCOMES[key].higherIsBetter) }];
    }));
    res.json({ videos, patterns, minVideos: MIN_VIDEOS });
  });
  api.delete('/results', (req, res) => {
    db.prepare('DELETE FROM results WHERE user_id = ?').run(requireUser(db, req).id);
    res.status(204).end();
  });

  // ---- forms. Nothing is emailed or charged yet: rows land in `submissions`. ----
  api.get('/me', (req, res) => {
    const a = actor(req);
    res.json({
      plan: latest<{ plan: string }>('checkout', a)?.plan ?? null,
      affiliateCode: latest<{ code: string | null }>('affiliate', a)?.code ?? null,
      waitlist: latest<{ device: string | null }>('waitlist', a)?.device ?? null,
    });
  });
  api.post('/contact', (req, res) => {
    const a = actor(req);
    const values = checked(req, contactRules);
    submit('contact', a, values);
    res.status(201).json({ topic: values.topic });
  });
  api.post('/waitlist', (req, res) => {
    const a = actor(req);
    const values = checked(req, waitlistRules);
    submit('waitlist', a, values);
    res.status(201).json({ device: values.device });
  });
  api.delete('/waitlist', (req, res) => {
    submit('waitlist', actor(req), { device: null });
    res.status(204).end();
  });
  api.post('/affiliates', (req, res) => {
    const a = actor(req);
    const values = checked(req, affiliateRules);
    const initials = (values.name.match(/\b\p{L}/gu) ?? ['X']).join('').slice(0, 3).toUpperCase();
    const code = `SP-${initials}-${randomUUID().slice(0, 4).toUpperCase()}`;
    submit('affiliate', a, { ...values, code });
    res.status(201).json({ code });
  });
  api.delete('/affiliates', (req, res) => {
    submit('affiliate', actor(req), { code: null });
    res.status(204).end();
  });
  api.post('/checkout', (req, res) => {
    const a = actor(req);
    const values = checked(req, checkoutRules);
    submit('checkout', a, values);
    res.status(201).json({ plan: values.plan });
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'No such endpoint.')));
  app.use('/api', sameOriginOnly, api);

  // Serve the built front end when it exists, with a fallback for client-side routes.
  const dist = path.resolve(SERVER_ROOT, '..', 'web', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(dist, 'index.html')) : next()));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) { res.status(err.status).json({ message: err.message, errors: err.errors }); return; }
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      res.status(tooBig ? 413 : 400).json({ message: tooBig ? `That file is over the ${maxUploadMb} MB limit.` : 'The upload could not be read. Try again.' });
      return;
    }
    const status = (err as { status?: number })?.status;
    if (status && status >= 400 && status < 500) { res.status(status).json({ message: 'The request could not be read.' }); return; }
    console.error(err);
    res.status(500).json({ message: 'Something went wrong on our side. Try again.' });
  });

  return Object.assign(app, { queue });
}
