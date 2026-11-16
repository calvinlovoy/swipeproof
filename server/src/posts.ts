/** Article queries, shared by the API and by the pages the server sends to search engines. */
import type { DB } from './db';

const COLUMNS = 'slug, title, category, published_on AS publishedOn, minutes, tool, excerpt';
export const PAGE_SIZE = 4;

export interface PostSummary { slug: string; title: string; category: string; publishedOn: string; minutes: number; tool: string; excerpt: string }
export interface Post extends PostSummary { body: string[]; older: { slug: string; title: string } | null; newer: { slug: string; title: string } | null }

export function listPosts(db: DB, query: { q?: string; category?: string; page?: number } = {}) {
  const q = (query.q ?? '').trim().toLowerCase().slice(0, 80);
  const category = (query.category ?? '').trim();
  const where: string[] = [];
  const args: string[] = [];
  if (category && category !== 'All') { where.push('category = ?'); args.push(category); }
  if (q) { where.push("lower(title || ' ' || excerpt || ' ' || body) LIKE ?"); args.push(`%${q.replace(/[%_]/g, '')}%`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { n: total } = db.prepare(`SELECT COUNT(*) AS n FROM posts ${clause}`).get(...args) as { n: number };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Math.floor(query.page ?? 1) || 1));
  const items = db.prepare(`SELECT ${COLUMNS} FROM posts ${clause} ORDER BY published_on DESC LIMIT ? OFFSET ?`).all(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE) as PostSummary[];
  const categories = (db.prepare('SELECT DISTINCT category FROM posts ORDER BY category').all() as { category: string }[]).map((r) => r.category);
  return { items, total, page, pages, pageSize: PAGE_SIZE, categories };
}

export function getPost(db: DB, slug: string): Post | null {
  const row = db.prepare(`SELECT ${COLUMNS}, body FROM posts WHERE slug = ?`).get(slug) as (PostSummary & { body: string }) | undefined;
  if (!row) return null;
  const neighbour = (sql: string) => (db.prepare(sql).get(row.publishedOn) as { slug: string; title: string } | undefined) ?? null;
  return {
    ...row, body: JSON.parse(row.body) as string[],
    older: neighbour('SELECT slug, title FROM posts WHERE published_on < ? ORDER BY published_on DESC LIMIT 1'),
    newer: neighbour('SELECT slug, title FROM posts WHERE published_on > ? ORDER BY published_on ASC LIMIT 1'),
  };
}

export const allPosts = (db: DB) => db.prepare(`SELECT ${COLUMNS} FROM posts ORDER BY published_on DESC`).all() as PostSummary[];
