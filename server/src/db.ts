import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type DB = Database.Database;

/** The server folder, whether this runs from src/ (tsx) or dist/ (bundle). */
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SCHEMA = `
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
`;

export function openDb(file = process.env.DATABASE_PATH ?? path.join(SERVER_ROOT, 'data', 'swipeproof.db')): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
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
