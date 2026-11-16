import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { openDb, seed } from '../src/db';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-seo-'));
const webDist = path.join(work, 'dist');
const TEMPLATE = '<!doctype html><html lang="en"><head>\n    <meta name="description" content="default" />\n    <title>default</title>\n  </head><body><div id="root"></div><script type="module" src="/assets/app-abc123.js"></script></body></html>';
let app: ReturnType<typeof createApp>;
let plain: ReturnType<typeof createApp>;

beforeAll(() => {
  fs.mkdirSync(path.join(webDist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(webDist, 'index.html'), TEMPLATE);
  fs.writeFileSync(path.join(webDist, 'assets', 'app-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(webDist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const db = openDb(':memory:');
  seed(db);
  const uploadDir = path.join(work, 'up');
  app = createApp(db, { uploadDir, ffmpeg: false, webDist, siteUrl: 'https://swipeproof.example/' });
  plain = createApp(db, { uploadDir, ffmpeg: false, webDist });
});

const tag = (html: string, re: RegExp) => re.exec(html)?.[1];
const structured = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

describe('pages as search engines see them', () => {
  it('sends the home page with its own head, structured data and readable content', async () => {
    const res = await request(app).get('/').expect(200).expect('Content-Type', /html/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.text.match(/<title>/g)).toHaveLength(1);
    expect(res.text.match(/<meta name="description"/g)).toHaveLength(1);
    expect(tag(res.text, /<title>(.*?)<\/title>/)).toBe('Swipeproof | Score short-form video before you post');
    expect(tag(res.text, /<link rel="canonical" href="(.*?)">/)).toBe('https://swipeproof.example/');
    expect(tag(res.text, /<meta property="og:image" content="(.*?)">/)).toBe('https://swipeproof.example/og.png');
    expect(res.text).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(res.text).not.toContain('name="robots"');
    expect(structured(res.text)[0]['@graph'].map((n: { '@type': string }) => n['@type'])).toEqual(['Organization', 'WebSite']);
    expect(res.text).toMatch(/<div id="root"><header class="site">.*<main class="pre">.*<h1>Find the second they swipe\.<\/h1>/s);
    expect(res.text).toContain('<a href="/tools/hook">');
    expect(res.text).toContain('<a href="/for/tiktok">');
    expect(res.text).toContain('Is the feedback generic?');
    expect(res.text).toContain('<script type="module" src="/assets/app-abc123.js">');
  });

  it('sends an article with its text, dates, breadcrumbs and article markup', async () => {
    const res = await request(app).get('/blog/first-three-seconds').expect(200);
    expect(tag(res.text, /<title>(.*?)<\/title>/)).toBe('What the first three seconds have to do | Swipeproof');
    expect(tag(res.text, /<link rel="canonical" href="(.*?)">/)).toBe('https://swipeproof.example/blog/first-three-seconds');
    expect(res.text).toContain('<meta property="og:type" content="article">');
    expect(res.text).toContain('An opening line has three jobs');
    expect(res.text).toContain('<time datetime="2026-11-02">Nov 2, 2026</time>');
    const [crumbs, article] = structured(res.text);
    expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(['Home', 'Blog', 'What the first three seconds have to do']);
    expect(article).toMatchObject({ '@type': 'BlogPosting', headline: 'What the first three seconds have to do', datePublished: '2026-11-02', mainEntityOfPage: 'https://swipeproof.example/blog/first-three-seconds' });
  });

  it('embeds the same public data the API would return, so the app starts without a loading step', async () => {
    const preload = (html: string) => JSON.parse(/<script id="preload" type="application\/json">(.*?)<\/script>/.exec(html)![1]);
    const post = preload((await request(app).get('/blog/first-three-seconds')).text);
    expect(post['/posts/first-three-seconds']).toEqual((await request(app).get('/api/posts/first-three-seconds')).body);
    expect(post['/content']).toEqual((await request(app).get('/api/content')).body);
    const blog = preload((await request(app).get('/blog')).text);
    expect(blog['/posts?q=&category=All&page=1']).toEqual((await request(app).get('/api/posts?q=&category=All&page=1')).body);
    expect(Object.keys(preload((await request(app).get('/library')).text))).toEqual(['/content']);
  });

  it('lists every article on the blog page and every tip on a platform guide', async () => {
    const blog = await request(app).get('/blog').expect(200);
    expect(blog.text.match(/<a href="\/blog\/[a-z0-9-]+">Read the article<\/a>/g)).toHaveLength(7);
    const guide = await request(app).get('/for/tiktok').expect(200);
    expect(guide.text).toContain('<h1>Swipeproof for TikTok</h1>');
    expect(guide.text).toContain('Lead with the payoff');
  });

  it('returns a real 404 for pages that do not exist', async () => {
    for (const url of ['/nope', '/blog/not-an-article', '/for/myspace', '/tools/nope']) {
      const res = await request(app).get(url).expect(404).expect('Content-Type', /html/);
      expect(res.text, url).toContain('<meta name="robots" content="noindex">');
      expect(res.text, url).not.toContain('rel="canonical"');
      expect(res.text, url).toContain('<h1>Page not found</h1>');
    }
    await request(app).get('/missing.png').expect(404).expect('Content-Type', /text\/plain/);
    await request(app).get('/assets/gone-123.js').expect(404).expect('Content-Type', /text\/plain/);
  });

  it('keeps private pages out of the index but still serves them', async () => {
    for (const url of ['/login', '/library', '/account', '/results', '/checkout?plan=studio', '/reports/abc']) {
      const res = await request(app).get(url).expect(200);
      expect(res.text, url).toContain('<meta name="robots" content="noindex">');
    }
    expect((await request(app).get('/api/content').expect(200)).headers['x-robots-tag']).toBe('noindex');
  });

  it('redirects trailing slashes to one address and never off-site', async () => {
    expect((await request(app).get('/blog/').expect(301)).headers.location).toBe('/blog');
    expect((await request(app).get('/tools/hook/?ref=x').expect(301)).headers.location).toBe('/tools/hook?ref=x');
    expect((await request(app).get('//evil.example/').expect(301)).headers.location).toBe('/evil.example');
  });

  it('escapes text and falls back to the request host without SITE_URL', async () => {
    const res = await request(plain).get('/tools/hook').set('Host', 'localhost:4000').expect(200);
    expect(tag(res.text, /<link rel="canonical" href="(.*?)">/)).toBe('http://localhost:4000/tools/hook');
    const odd = await request(app).get('/"><script>alert(1)</script>').expect(404);
    expect(odd.text).not.toContain('<script>alert(1)</script>');
  });

  it('caches hashed assets for a year and other files for an hour', async () => {
    expect((await request(app).get('/assets/app-abc123.js').expect(200)).headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await request(app).get('/favicon.svg').expect(200)).headers['cache-control']).toBe('public, max-age=3600');
  });
});

describe('robots.txt and the sitemap', () => {
  it('allows crawling, blocks the API and points at the sitemap', async () => {
    const res = await request(app).get('/robots.txt').expect(200).expect('Content-Type', /text\/plain/);
    expect(res.text).toBe('User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://swipeproof.example/sitemap.xml\n');
  });
  it('lists every public page once and no private ones', async () => {
    const res = await request(app).get('/sitemap.xml').expect(200).expect('Content-Type', /xml/);
    const locs = [...res.text.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].replace('https://swipeproof.example', ''));
    expect(new Set(locs).size).toBe(locs.length);
    expect(locs).toEqual(expect.arrayContaining(['/', '/tools', '/tools/hook', '/tools/script', '/tools/video', '/pricing', '/blog', '/for/tiktok', '/for/instagram', '/for/shorts', '/blog/first-three-seconds']));
    expect(locs).toHaveLength(12 + 3 + 7);
    for (const hidden of ['/login', '/signup', '/account', '/library', '/results', '/checkout']) expect(locs).not.toContain(hidden);
    expect(res.text).toContain('<loc>https://swipeproof.example/blog/first-three-seconds</loc><lastmod>2026-11-02</lastmod>');
    // Every listed page really is a 200 that allows indexing.
    for (const loc of locs) {
      const page = await request(app).get(loc).expect(200);
      expect(page.text, loc).not.toContain('name="robots"');
    }
  });
});
