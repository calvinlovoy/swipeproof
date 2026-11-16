import { describe, expect, it } from 'vitest';
import { cleanPath, INDEXED_PATHS, pageMeta } from './seo';

const platforms = [{ id: 'tiktok', name: 'TikTok', line: 'Built for a fast feed.' }];
const post = { slug: 'first-three-seconds', title: 'What the first three seconds have to do', excerpt: 'An opening has three jobs.', category: 'Hooks', publishedOn: '2026-11-02' };
const meta = (path: string, extra: { post?: typeof post | null } = {}) => pageMeta(path, { platforms, ...extra });

describe('page metadata', () => {
  it('gives every indexed page a unique title and a description of a useful length', () => {
    const all = INDEXED_PATHS.map((p) => meta(p));
    expect(new Set(all.map((m) => m.title)).size).toBe(all.length);
    expect(new Set(all.map((m) => m.description)).size).toBe(all.length);
    for (const m of all) {
      expect(m.title.length, m.title).toBeLessThanOrEqual(60);
      expect(m.title, m.path).toContain('Swipeproof');
      expect(m.description.length, m.path).toBeGreaterThanOrEqual(50);
      expect(m.description.length, m.path).toBeLessThanOrEqual(160);
      expect(m).toMatchObject({ index: true, status: 200 });
      expect(m.heading).toBeTruthy();
    }
  });
  it('normalizes the canonical path', () => {
    expect(cleanPath('/blog/?q=hooks#top')).toBe('/blog');
    expect(cleanPath('/')).toBe('/');
    expect(meta('/tools/hook/').path).toBe('/tools/hook');
  });
  it('keeps private and transactional pages out of the index', () => {
    for (const path of ['/login', '/signup', '/account', '/library', '/results', '/checkout', '/reports/abc']) {
      expect(meta(path), path).toMatchObject({ index: false, status: 200 });
    }
    expect(INDEXED_PATHS).not.toContain('/library');
  });
  it('builds article and platform pages from their content', () => {
    expect(meta('/blog/first-three-seconds', { post })).toMatchObject({ title: 'What the first three seconds have to do | Swipeproof', description: post.excerpt, type: 'article', index: true, crumbs: [['Blog', '/blog'], [post.title, '/blog/first-three-seconds']] });
    expect(meta('/blog/first-three-seconds')).toMatchObject({ status: 200, index: true }); // not loaded yet
    expect(meta('/for/tiktok')).toMatchObject({ title: 'TikTok video tips and checks | Swipeproof', heading: 'Swipeproof for TikTok', status: 200 });
    expect(meta('/tools/hook').crumbs).toEqual([['Tools', '/tools'], ['Hook analyzer', '/tools/hook']]);
  });
  it('marks missing pages as 404 and noindex', () => {
    for (const path of ['/nope', '/for/myspace', '/blog/a/b', '/tools/nope', '/reports']) {
      expect(meta(path), path).toMatchObject({ status: 404, index: false });
    }
    expect(meta('/blog/gone', { post: null })).toMatchObject({ status: 404, index: false });
  });
});
