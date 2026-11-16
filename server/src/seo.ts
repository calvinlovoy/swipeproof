/**
 * What search engines and link previews get: a page-specific head (title, description,
 * canonical, preview tags, structured data), a plain HTML version of the page inside #root for
 * readers that do not run JavaScript, robots.txt and the sitemap. The browser app replaces the
 * #root content when it starts, so both versions must say the same thing.
 */
import { cleanPath, INDEXED_PATHS, pageMeta, SITE_NAME, type PageMeta } from '../../shared/seo';
import type { DB } from './db';
import { allPosts, getPost, listPosts, type Post, type PostSummary } from './posts';

interface Tool { id: string; name: string; desc: string; cta: string }
interface Plan { name: string; price: number; who: string; features: string[] }
interface Platform { id: string; name: string; line: string; tips: { title: string; body: string }[] }
interface Content { tools: Tool[]; plans: Plan[]; steps: { title: string; body: string }[]; faq: { q: string; a: string }[]; platforms: Platform[] }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonLd = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
const NAV: [string, string][] = [['/tools', 'Tools'], ['/blog', 'Blog'], ['/pricing', 'Pricing'], ['/affiliates', 'Affiliates'], ['/get-started', 'Get started']];
const FOOT: [string, string][] = [['/about', 'About'], ['/contact', 'Contact'], ['/legal', 'Privacy and terms']];
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function createSeo(db: DB, siteUrl = process.env.SITE_URL) {
  const fixedOrigin = siteUrl?.trim().replace(/\/+$/, '') || null;
  const content = (): Content => {
    const rows = db.prepare('SELECT key, value FROM content').all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])) as Content;
  };

  /** The site's public address: SITE_URL when set, otherwise whatever host the request came in on. */
  const origin = (requestOrigin: string) => fixedOrigin ?? requestOrigin;

  function head(meta: PageMeta, base: string, post: Post | null): string {
    const url = base + (meta.path === '/' ? '/' : meta.path);
    const image = `${base}/og.png`;
    const org = { '@type': 'Organization', name: SITE_NAME, url: `${base}/`, logo: `${base}/icon-512.png` };
    const tags = [
      `<title>${esc(meta.title)}</title>`,
      `<meta name="description" content="${esc(meta.description)}">`,
      ...(meta.status === 200 ? [`<link rel="canonical" href="${esc(url)}">`] : []),
      ...(meta.index ? [] : ['<meta name="robots" content="noindex">']),
      `<meta property="og:site_name" content="${SITE_NAME}">`,
      `<meta property="og:type" content="${meta.type}">`,
      `<meta property="og:title" content="${esc(meta.title)}">`,
      `<meta property="og:description" content="${esc(meta.description)}">`,
      `<meta property="og:url" content="${esc(url)}">`,
      `<meta property="og:image" content="${esc(image)}">`,
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      `<meta property="og:image:alt" content="${SITE_NAME}: score short-form video before you post">`,
      '<meta name="twitter:card" content="summary_large_image">',
    ];
    if (meta.path === '/') {
      tags.push(jsonLd({ '@context': 'https://schema.org', '@graph': [org, { '@type': 'WebSite', name: SITE_NAME, url: `${base}/` }] }));
    }
    if (meta.index && meta.crumbs.length) {
      tags.push(jsonLd({
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [['Home', '/'], ...meta.crumbs].map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: base + path })),
      }));
    }
    if (post && meta.index) {
      tags.push(`<meta property="article:published_time" content="${esc(post.publishedOn)}">`);
      tags.push(jsonLd({
        '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title, description: post.excerpt, articleSection: post.category,
        datePublished: post.publishedOn, dateModified: post.publishedOn, image, mainEntityOfPage: url, author: org, publisher: org,
      }));
    }
    return tags.join('\n    ');
  }

  /** The page as plain HTML. It reuses the app's class names so it looks right until the app takes over. */
  function body(meta: PageMeta, c: Content, post: Post | null, all: PostSummary[]): string {
    const link = ([href, label]: [string, string]) => `<li><a href="${href}">${esc(label)}</a></li>`;
    const card = (title: string, text: string, href?: string, cta?: string) =>
      `<div class="card"><h3>${esc(title)}</h3><p class="muted">${esc(text)}</p>${href ? `<a href="${href}">${esc(cta ?? title)}</a>` : ''}</div>`;
    const section = (title: string, inner: string) => `<section class="band wrap stack"><h2>${esc(title)}</h2>${inner}</section>`;
    const toolCards = `<div class="grid">${c.tools.map((t) => card(t.name, t.desc, `/tools/${t.id}`, t.cta)).join('')}</div>`;
    const guides = `<div class="grid">${c.platforms.map((p) => card(p.name, p.line, `/for/${p.id}`, `Read the ${p.name} guide`)).join('')}</div>`;
    const top = `<div class="wrap page-h"><h1>${esc(meta.heading)}</h1>${meta.lede ? `<p class="lede">${esc(meta.lede)}</p>` : ''}</div>`;

    let main = top;
    const platform = c.platforms.find((p) => meta.path === `/for/${p.id}`);
    if (meta.status === 404) {
      main += `<div class="wrap"><a href="/">Go to the home page</a></div>`;
    } else if (meta.path === '/') {
      main += section('How it works', `<ol class="grid">${c.steps.map((s) => `<li class="card"><h3>${esc(s.title)}</h3><p class="muted">${esc(s.body)}</p></li>`).join('')}</ol>`)
        + section('Three tools, no account needed', toolCards)
        + section('Tuned for each feed', guides)
        + `<section class="band wrap stack" id="faq"><h2>Questions people ask first</h2>${c.faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}</section>`;
    } else if (meta.path === '/tools') {
      main += `<div class="wrap">${toolCards}</div>`;
    } else if (meta.path.startsWith('/tools/')) {
      main += section('Other tools', `<div class="grid">${c.tools.filter((t) => meta.path !== `/tools/${t.id}`).map((t) => card(t.name, t.desc, `/tools/${t.id}`, t.cta)).join('')}</div>`);
    } else if (meta.path === '/pricing') {
      main += `<div class="wrap grid">${c.plans.map((p) => `<div class="card"><h3>${esc(p.name)}</h3><p class="muted">${esc(p.who)}</p><p>$${p.price} a month</p><ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>`).join('')}</div>`;
    } else if (meta.path === '/blog') {
      main += `<div class="wrap grid">${all.map((p) => card(p.title, p.excerpt, `/blog/${p.slug}`, 'Read the article')).join('')}</div>`;
    } else if (post) {
      const tool = c.tools.find((t) => t.id === post.tool) ?? c.tools[0];
      const neighbours = [post.older && `<a href="/blog/${post.older.slug}">Older: ${esc(post.older.title)}</a>`, post.newer && `<a href="/blog/${post.newer.slug}">Newer: ${esc(post.newer.title)}</a>`].filter(Boolean).join(' ');
      main = `<div class="wrap"><article class="post stack"><p class="eyebrow"><span>${esc(post.category)}</span><time datetime="${esc(post.publishedOn)}">${longDate(post.publishedOn)}</time><span>${post.minutes} min read</span></p>`
        + `<h1>${esc(post.title)}</h1><div>${post.body.map((para) => `<p>${esc(para)}</p>`).join('')}</div>`
        + `${card('Try it on your own work', tool.desc, `/tools/${tool.id}`, tool.cta)}<p class="row">${neighbours}</p></article></div>`;
    } else if (platform) {
      main += `<div class="wrap stack"><div class="grid">${platform.tips.map((t) => card(t.title, t.body)).join('')}</div>`
        + `${card(`Check a ${platform.name} video before you post`, 'Upload the export and get a score with timestamped fixes.', '/tools/video', 'Analyze a video')}`
        + `<p class="row">Other guides: ${c.platforms.filter((p) => p.id !== platform.id).map((p) => `<a href="/for/${p.id}">${esc(p.name)}</a>`).join(' ')}</p></div>`;
    }

    return `<header class="site"><div class="wrap bar-top"><a class="brand" href="/">${SITE_NAME}</a><nav class="main" aria-label="Main"><ul>${NAV.map(link).join('')}</ul></nav></div></header>`
      + `<main class="pre">${main}</main>`
      + `<footer class="site"><div class="wrap"><ul class="row">${[...NAV, ...FOOT].map(link).join('')}</ul></div></footer>`;
  }

  return {
    /** Fills the built index.html for one path. `status` is 404 for pages that do not exist. */
    page(template: string, pathname: string, requestOrigin: string): { status: number; html: string } {
      const c = content();
      const all = allPosts(db);
      const path = cleanPath(pathname);
      const slug = /^\/blog\/([^/]+)$/.exec(path)?.[1];
      const post = slug ? getPost(db, slug) : null;
      const meta = pageMeta(path, { platforms: c.platforms, post: slug ? post : undefined });
      // The public data this page asks the API for first, so the app can start without waiting on it.
      const preload: Record<string, unknown> = { '/content': c };
      if (post) preload[`/posts/${post.slug}`] = post;
      if (path === '/blog') preload['/posts?q=&category=All&page=1'] = listPosts(db, { page: 1 });
      const html = template
        .replace(/\s*<title>[^<]*<\/title>/, '')
        .replace(/\s*<meta name="description"[^>]*>/, '')
        .replace('</head>', `  ${head(meta, origin(requestOrigin), post)}\n  </head>`)
        .replace('<div id="root"></div>', `<div id="root">${body(meta, c, post, all)}</div>\n    <script id="preload" type="application/json">${JSON.stringify(preload).replace(/</g, '\\u003c')}</script>`);
      return { status: meta.status, html };
    },

    robots(requestOrigin: string): string {
      return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin(requestOrigin)}/sitemap.xml\n`;
    },

    sitemap(requestOrigin: string): string {
      const base = origin(requestOrigin);
      const all = allPosts(db);
      const newest = all[0]?.publishedOn;
      const entries: [path: string, lastmod?: string][] = [
        ...INDEXED_PATHS.map((p): [string, string?] => [p, p === '/' || p === '/blog' ? newest : undefined]),
        ...content().platforms.map((p): [string, string?] => [`/for/${p.id}`]),
        ...all.map((p): [string, string?] => [`/blog/${p.slug}`, p.publishedOn]),
      ];
      const urls = entries.map(([path, lastmod]) => `  <url><loc>${esc(base + path)}</loc>${lastmod ? `<lastmod>${esc(lastmod)}</lastmod>` : ''}</url>`);
      return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
    },
  };
}
