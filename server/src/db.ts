import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type DB = Database.Database;

/** The server folder, whether this runs from src/ (tsx) or dist/ (bundle). */
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR ?? path.join(SERVER_ROOT, 'data');

/**
 * Schema migrations, applied in order. Each runs once; SQLite's `user_version` records how far
 * a database has got. Never edit a migration that has shipped: add a new one at the end.
 */
const MIGRATIONS: string[] = [
  // 1: content, anonymous reports and form submissions
  `
  CREATE TABLE IF NOT EXISTS reports (
    id          TEXT PRIMARY KEY,
    client_id   TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('hook','script','video')),
    title       TEXT NOT NULL,
    score       INTEGER NOT NULL,
    simulated   INTEGER NOT NULL DEFAULT 0,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS reports_by_client ON reports (client_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS posts (
    slug         TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    category     TEXT NOT NULL,
    published_on TEXT NOT NULL,
    minutes      INTEGER NOT NULL,
    tool         TEXT NOT NULL,
    excerpt      TEXT NOT NULL,
    body         TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS content (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS submissions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL CHECK (kind IN ('contact','waitlist','affiliate','checkout')),
    client_id  TEXT NOT NULL,
    payload    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS submissions_by_client ON submissions (client_id, kind, id DESC);
  `,
  // 2: accounts, sessions, ownership by user, and video analysis jobs
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_by_user ON sessions (user_id);
  ALTER TABLE reports ADD COLUMN user_id TEXT REFERENCES users (id) ON DELETE CASCADE;
  CREATE INDEX reports_by_user ON reports (user_id, created_at DESC);
  ALTER TABLE submissions ADD COLUMN user_id TEXT REFERENCES users (id) ON DELETE SET NULL;
  CREATE TABLE jobs (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status     TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
    stage      TEXT NOT NULL DEFAULT '',
    file_name  TEXT NOT NULL,
    report_id  TEXT,
    error      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX jobs_by_user ON jobs (user_id, created_at DESC);
  `,
];

function migrate(db: DB): void {
  let version = db.pragma('user_version', { simple: true }) as number;
  // Databases created before migrations existed already have the first schema.
  if (version === 0 && db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reports'").get()) version = 1;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
  if (version > MIGRATIONS.length) throw new Error(`Database is at schema ${version}, newer than this code (${MIGRATIONS.length}).`);
}

export function openDb(file = process.env.DATABASE_PATH ?? path.join(DATA_DIR, 'swipeproof.db')): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

interface SeedFile {
  posts: { slug: string; title: string; category: string; publishedOn: string; minutes: number; tool: string; excerpt: string; body: string[] }[];
  [key: string]: unknown;
}

/** Loads posts and site content from seed/content.json. Safe to run again: it replaces both tables. */
export function seed(db: DB, file = path.join(SERVER_ROOT, 'seed', 'content.json')): { posts: number; content: number } {
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as SeedFile;
  const { posts, ...content } = data;
  const insertPost = db.prepare('INSERT INTO posts (slug, title, category, published_on, minutes, tool, excerpt, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertContent = db.prepare('INSERT INTO content (key, value) VALUES (?, ?)');
  db.transaction(() => {
    db.exec('DELETE FROM posts; DELETE FROM content;');
    for (const p of posts) insertPost.run(p.slug, p.title, p.category, p.publishedOn, p.minutes, p.tool, p.excerpt, JSON.stringify(p.body));
    for (const [key, value] of Object.entries(content)) insertContent.run(key, JSON.stringify(value));
  })();
  return { posts: posts.length, content: Object.keys(content).length };
}

/** Seeds an empty database so a fresh checkout works after `npm start`. */
export function seedIfEmpty(db: DB): void {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number };
  if (n === 0) seed(db);
}
