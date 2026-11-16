/**
 * What each page tells search engines and link previews: title, description, canonical path
 * and whether it should be indexed. Pure functions shared by the server, which writes the tags
 * into the HTML it sends, and the browser, which keeps them current as the visitor moves around.
 */
export const SITE_NAME = 'Swipeproof';

export interface PageMeta {
  /** Full text of the title tag. */
  title: string;
  description: string;
  /** Canonical path, without query string or trailing slash. */
  path: string;
  /** False for private, transactional and missing pages. */
  index: boolean;
  status: 200 | 404;
  type: 'website' | 'article';
  /** Main heading and opening line, used for the server-rendered version of the page. */
  heading: string;
  lede: string;
  /** Trail from the home page to this one. The last entry is the page itself. */
  crumbs: [label: string, path: string][];
}

type Entry = Pick<PageMeta, 'title' | 'description' | 'heading' | 'lede'> & { index?: false; crumbs?: [string, string][] };
const titled = (page: string) => `${page} | ${SITE_NAME}`;

const TOOLS: [string, string] = ['Tools', '/tools'];
const PAGES: Record<string, Entry> = {
  '/': {
    title: `${SITE_NAME} | Score short-form video before you post`,
    description: 'Paste a hook, a script or a video. Swipeproof scores it from 0 to 100 and shows what to change before you post to TikTok, Reels or Shorts.',
    heading: 'Find the second they swipe.',
    lede: 'Paste a hook, a script or a video. Swipeproof scores it from 0 to 100 and tells you what to change before you post.',
  },
  '/tools': {
    title: titled('Free checks for hooks, scripts and video'),
    description: 'Check a hook, a script or a finished video. Each tool gives a score, the reasons behind it and specific changes. The quick checks need no account.',
    heading: 'Check a hook, a script or a finished video',
    lede: 'Each tool gives a score, the reasons behind it and specific changes. Reports save to your library.',
  },
  '/tools/hook': {
    title: titled('Hook analyzer for short-form video'),
    description: 'Paste the first line of your video. Get a score, the reasons a viewer might skip and a tightened version. Free, with no account needed.',
    heading: 'Hook analyzer',
    lede: 'Paste the first line of your video. You get a score, the reasons a viewer might skip and a tightened version.',
    crumbs: [TOOLS],
  },
  '/tools/script': {
    title: titled('Script analyzer with a pacing map'),
    description: 'Paste a full or partial video script. See a pacing map, the lines most likely to lose viewers and a fix for each one. Free, with no account needed.',
    heading: 'Script analyzer',
    lede: 'Paste a full or partial script. You get a pacing map, the lines most likely to lose viewers and a fix for each.',
    crumbs: [TOOLS],
  },
  '/tools/video': {
    title: titled('Video analyzer for TikTok, Reels and Shorts'),
    description: 'Upload a clip to see where it loses people and what to change, with measured checks on cuts, sound, framing and length.',
    heading: 'Video analyzer',
    lede: 'Upload a clip to see where it loses people and what to change. Paste a link to see a sample report.',
    crumbs: [TOOLS],
  },
  '/pricing': {
    title: titled('Pricing'),
    description: 'Swipeproof plans and what each one includes. The hook, script and quick video checks are free to use.',
    heading: 'Pricing',
    lede: 'Three tiers. Payments are not wired up yet, so choosing one walks through checkout without charging anything.',
  },
  '/blog': {
    title: titled('Short-form video tips: hooks, pacing, editing'),
    description: 'Short, practical pieces on hooks, pacing and editing for vertical video on TikTok, Reels and Shorts.',
    heading: 'Blog',
    lede: 'Short, practical pieces on hooks, pacing and editing for vertical video.',
  },
  '/get-started': {
    title: titled('Get started'),
    description: 'Swipeproof runs in your browser. Pick a tool, run your first check and join the list for the phone apps.',
    heading: 'Get started',
    lede: 'Swipeproof runs in the browser today. Phone apps are not built yet.',
  },
  '/affiliates': {
    title: titled('Affiliate program'),
    description: 'Refer creators to Swipeproof and earn 30% on the first payment and on every renewal while the subscriber stays.',
    heading: 'Earn 30% on every referral',
    lede: 'You earn on the first payment and on every renewal while the subscriber stays. Payouts are monthly with no minimum.',
  },
  '/about': {
    title: titled('About'),
    description: 'What Swipeproof does, how it scores short-form video and which parts of this early version are placeholders.',
    heading: 'About Swipeproof',
    lede: 'Swipeproof reviews short-form video before you post it. This build is an early version, so some parts are placeholders. Here is which is which.',
  },
  '/contact': {
    title: titled('Contact'),
    description: 'Send the Swipeproof team a question, feedback or a request for a team plan.',
    heading: 'Contact',
    lede: 'Questions, feedback or a team plan.',
  },
  '/legal': {
    title: titled('Privacy and terms'),
    description: 'How Swipeproof handles your data, including uploaded videos, plus the terms of use and cookie details.',
    heading: 'Legal',
    lede: 'Plain statements about how this build handles your data. Draft text, pending legal review.',
  },
  // Private and transactional pages stay out of search results.
  '/login': { index: false, title: titled('Log in'), description: 'Log in to your Swipeproof account.', heading: 'Log in', lede: '' },
  '/signup': { index: false, title: titled('Create an account'), description: 'Create a Swipeproof account to keep your reports and run full video analyses.', heading: 'Create your account', lede: 'Keep your reports, reach them from any device and run full video analyses.' },
  '/account': { index: false, title: titled('Account'), description: 'Your Swipeproof account.', heading: 'Account', lede: '' },
  '/library': { index: false, title: titled('Your library'), description: 'Your saved Swipeproof reports.', heading: 'Your library', lede: 'Every report you run is kept here.' },
  '/results': { index: false, title: titled('Results'), description: 'Line up ad results with what Swipeproof measured in each video.', heading: 'Results', lede: 'Add how your videos performed as ads and see which measurements tracked with the numbers.' },
  '/checkout': { index: false, title: titled('Checkout'), description: 'Choose a Swipeproof plan.', heading: 'Checkout', lede: '', crumbs: [['Pricing', '/pricing']] },
};

/** Paths every visitor may find through search, in the order they appear in the sitemap. */
export const INDEXED_PATHS = Object.keys(PAGES).filter((p) => PAGES[p].index !== false);

export interface PlatformInfo { id: string; name: string; line: string }
export interface PostInfo { slug: string; title: string; excerpt: string; category: string; publishedOn: string }

/** Drops the query string, hash and any trailing slash. */
export function cleanPath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '');
  return path || '/';
}

export function notFoundMeta(pathname: string): PageMeta {
  return {
    title: titled('Page not found'), description: 'That page does not exist.', path: cleanPath(pathname), index: false, status: 404, type: 'website',
    heading: 'Page not found', lede: 'That page does not exist. It may have moved, or the link may be wrong.', crumbs: [],
  };
}

export function postMeta(post: PostInfo): PageMeta {
  return {
    title: titled(post.title), description: post.excerpt, path: `/blog/${post.slug}`, index: true, status: 200, type: 'article',
    heading: post.title, lede: post.excerpt, crumbs: [['Blog', '/blog'], [post.title, `/blog/${post.slug}`]],
  };
}

export function platformMeta(p: PlatformInfo): PageMeta {
  return {
    title: titled(`${p.name} video tips and checks`),
    description: `${p.line} Practical tips for ${p.name}, plus tools that check your hook, script and video before you post.`,
    path: `/for/${p.id}`, index: true, status: 200, type: 'website',
    heading: `${SITE_NAME} for ${p.name}`, lede: p.line, crumbs: [[p.name, `/for/${p.id}`]],
  };
}

/**
 * Metadata for a path. Blog posts need the article itself, so pass `post` when it is known:
 * `null` means the article does not exist, `undefined` means it has not loaded yet.
 */
export function pageMeta(pathname: string, data: { platforms: PlatformInfo[]; post?: PostInfo | null }): PageMeta {
  const path = cleanPath(pathname);
  const entry = PAGES[path];
  if (entry) {
    const { index, crumbs = [], ...rest } = entry;
    return { ...rest, path, index: index !== false, status: 200, type: 'website', crumbs: path === '/' ? [] : [...crumbs, [entry.heading, path]] };
  }
  const [, section, id, extra] = path.split('/');
  if (!id || extra !== undefined) return notFoundMeta(path);
  if (section === 'for') {
    const platform = data.platforms.find((p) => p.id === id);
    return platform ? platformMeta(platform) : notFoundMeta(path);
  }
  if (section === 'blog') {
    if (data.post) return postMeta(data.post);
    if (data.post === null) return notFoundMeta(path);
    return { ...PAGES['/blog'], title: titled('Blog'), path, index: true, status: 200, type: 'article', crumbs: [['Blog', '/blog']] };
  }
  if (section === 'reports') {
    return { title: titled('Report'), description: 'A saved Swipeproof report.', path, index: false, status: 200, type: 'website', heading: 'Report', lede: '', crumbs: [['Library', '/library']] };
  }
  return notFoundMeta(path);
}
