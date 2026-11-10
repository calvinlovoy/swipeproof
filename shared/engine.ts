/**
 * Scoring engine shared by the API and the browser.
 * Pure functions with no I/O, so the same rules run on both sides.
 */
export type Severity = 'bad' | 'warn';
export type ReportType = 'hook' | 'script' | 'video';
export interface Metric { name: string; score: number; note: string }
export interface Finding { at: string; title: string; fix: string; sev: Severity }
export interface PaceSegment { n: number; risk: 0 | 1 | 2; at: string }
export interface ReportBody {
  type: ReportType;
  title: string;
  score: number;
  metrics: Metric[];
  findings: Finding[];
  working: string[];
  meta: [string, string][];
  tight?: string;
  map?: PaceSegment[];
  sim?: boolean;
  audio?: boolean;
}
export interface Report extends ReportBody { id: string; createdAt: string }

export const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));
export const timecode = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const band = (score: number): [label: string, tone: 'good' | 'warn' | 'bad'] =>
  score >= 75 ? ['Strong', 'good'] : score >= 50 ? ['Fair', 'warn'] : ['Weak', 'bad'];
export const words = (text: string): string[] => text.trim().match(/[\p{L}\p{N}'’$%-]+/gu) ?? [];
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;
const clip = (text: string, max = 70) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

/** Words per second at a normal speaking pace (150 words a minute). */
export const WORDS_PER_SECOND = 2.5;

const SLOW_OPENER = /^(hey|hi|hello|yo|so|okay|ok|alright|well|welcome back|what'?s up|in this video|in today'?s video|today i|today we|i wanted to|i just wanted|let me tell you|before we start|quick video)\b/i;
const FILLER = /\b(basically|actually|literally|just|really|very|kind of|sort of|you know|i think|i guess|um|uh)\b/gi;
const CURIOSITY = /\?|\b(why|how|what happens|what happened|secret|nobody|no one|stop|mistakes?|wrong|truth|never|until|before you|the reason|this is why|here'?s why|turns out|didn'?t expect|hidden|instead|tested|tried)\b/gi;
const VAGUE = /\b(things?|stuff|something|some|tips|amazing|awesome|great|good|nice|cool|interesting|a lot|lots)\b/gi;

/** Removes greetings, setup phrases and filler. Leaves the author's wording otherwise. */
export function tighten(text: string): string {
  const s = text.trim()
    .replace(/^(hey|hi|hello|yo|what'?s up)( guys| everyone| everybody| friends| fam| y'?all| there)?[,!.\s]+/i, '')
    .replace(/^(so|okay|ok|alright|well)[,\s]+/i, '')
    .replace(/^(welcome back( to (my|the) channel)?|in (this|today'?s) video|today (i'?m|i am|we'?re|we are) (going to|gonna)|today i (want(ed)? to|will)|i (just )?wanted to)\s*(show you|talk about|share|tell you about|be talking about|go over)?[,!.\s]*/i, '')
    .replace(FILLER, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function analyzeHook(text: string): ReportBody {
  const t = text.trim();
  const w = words(t);
  const n = w.length;
  const low = t.toLowerCase();
  const slow = SLOW_OPENER.test(t);

  let open = n <= 2 ? 40 : n <= 12 ? 100 : n <= 18 ? 72 : n <= 25 ? 50 : 30;
  if (slow) open -= 55;
  const cur = count(t, CURIOSITY);
  const curiosity = cur === 0 ? 30 : cur === 1 ? 70 : 95;
  let spec = 35;
  if (/\d/.test(t)) spec += 35;
  if (/[$%]|\b(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b/i.test(t)) spec += 20;
  if (/\S\s+[A-Z][a-z]{2,}/.test(t)) spec += 10;
  spec -= 12 * count(t, VAGUE);
  const you = count(low, /\b(you|your|you'?re)\b/g);
  const me = count(low, /\b(i|my|me|we|our|i'?m)\b/g);
  const viewer = you ? (me ? 85 : 95) : me ? 40 : 60;
  const fills = count(t, FILLER);
  const avgLen = n ? w.join('').length / n : 0;
  const clarity = 100 - 18 * fills - (avgLen > 6.5 ? 15 : 0) - (count(t, /,/g) > 2 ? 10 : 0) - (t.length > 12 && t === t.toUpperCase() ? 20 : 0);

  const parts: { name: string; score: number; weight: number; note: string; issue: [string, string] }[] = [
    {
      name: 'Opening speed', score: clamp(open), weight: 0.25,
      note: slow ? 'It starts with a greeting or setup phrase, so the point arrives late.'
        : n > 18 ? `At ${n} words it takes longer than three seconds to say.`
        : n <= 2 ? 'Too short to tell viewers what the video is about.'
        : 'It gets to the point within the first three seconds.',
      issue: slow ? ['The opening spends time on a greeting before the point', 'Cut the greeting and start on the first word that carries meaning.']
        : n > 18 ? [`The hook runs ${n} words`, 'Trim it to about a dozen words so it lands inside three seconds.']
        : ['The hook is too short to name the topic', 'Add what the video is about so viewers know it is for them.'],
    },
    {
      name: 'Curiosity gap', score: curiosity, weight: 0.25,
      note: cur ? 'It opens a question the viewer wants answered.' : 'It states a topic without giving a reason to keep watching.',
      issue: ['Nothing makes the viewer need the next line', 'Promise an outcome or raise a question, for example why something fails or what happened when you tested it.'],
    },
    {
      name: 'Specificity', score: clamp(spec), weight: 0.2,
      note: spec >= 70 ? 'Concrete details make the promise believable.' : 'It leans on general words where a number or a named thing would be stronger.',
      issue: ['The wording is vague', 'Swap general words for a number, a time frame or the exact thing you are showing.'],
    },
    {
      name: 'Viewer focus', score: viewer, weight: 0.15,
      note: you ? 'It speaks to the viewer directly.' : me ? 'It is about you. The viewer is not in the sentence.' : 'It does not address anyone in particular.',
      issue: ['The line is about the creator', 'Rewrite it around the viewer by using "you" and what they get.'],
    },
    {
      name: 'Clarity', score: clamp(clarity), weight: 0.15,
      note: fills ? `It contains ${fills} filler word${fills > 1 ? 's' : ''} that can go.` : 'Clean wording with no filler.',
      issue: ['Filler words slow the line down', 'Remove words such as "just", "really" and "basically".'],
    },
  ];

  const tight = tighten(t);
  return {
    type: 'hook',
    title: clip(t),
    score: clamp(parts.reduce((sum, p) => sum + p.score * p.weight, 0)),
    metrics: parts.map(({ name, score, note }) => ({ name, score, note })),
    findings: parts.filter((p) => p.score < 60).sort((a, b) => a.score - b.score)
      .map((p) => ({ at: '0:00', title: p.issue[0], fix: p.issue[1], sev: p.score < 45 ? 'bad' : 'warn' })),
    working: parts.filter((p) => p.score >= 80).map((p) => p.note),
    meta: [['Words', String(n)], ['Time to say', `${(n / WORDS_PER_SECOND).toFixed(1)} s`]],
    tight: tight && tight !== t ? tight : '',
  };
}

export function analyzeScript(text: string): ReportBody {
  const sentences = text.split(/\n+|(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => words(s).length);
  let acc = 0;
  const segs = sentences.map((s) => {
    const n = words(s).length;
    const fills = count(s, FILLER);
    const seg = { s, n, start: acc / WORDS_PER_SECOND, end: (acc + n) / WORDS_PER_SECOND, risk: (n > 22 ? 2 : fills >= 2 || n > 16 ? 1 : 0) as 0 | 1 | 2 };
    acc += n;
    return seg;
  });
  const total = acc;
  const duration = total / WORDS_PER_SECOND;
  const hook = analyzeHook(sentences[0] ?? '');

  const slice = (keep: (from: number, to: number) => boolean) => {
    let c = 0;
    const out: string[] = [];
    for (const g of segs) { if (keep(c / total, (c + g.n) / total)) out.push(g.s); c += g.n; }
    return out.join(' ');
  };
  const early = slice((from) => from < 0.3);
  const late = slice((_, to) => to > 0.7);
  const promise = /\b(by the end|i'?ll show|i will show|here'?s how|here is how|you'?ll (learn|see|know|get)|in \d+ (seconds|steps|minutes)|\d+ (ways|steps|tips|reasons|mistakes|things))\b/i.test(early);
  const sequence = count(text, /\b(first|second|third|next|then|step \d|finally|number \d|after that)\b/gi) >= 2;
  const CTA = /\b(follow|comment|share|save|subscribe|like this|link in|tag a|send this|dm me|try it|download)\b/i;
  const ctaLate = CTA.test(late);
  const ctaAny = CTA.test(text);

  const longs = segs.filter((g) => g.risk === 2);
  const avg = total / Math.max(segs.length, 1);
  const fills = count(text, FILLER);
  const structure = 25 + 25 * Number(promise) + 25 * Number(sequence) + 25 * Number(ctaLate);
  const pacing = 100 - 15 * longs.length - (avg > 16 ? (avg - 16) * 4 : 0) - (avg < 4 ? 20 : 0) - (duration < 8 ? 25 : 0) - (duration > 90 ? 20 : 0);
  const clarity = 100 - (fills / Math.max(total, 1)) * 100 * 12;
  const cta = ctaLate ? 100 : ctaAny ? 60 : 20;

  const metrics: Metric[] = [
    { name: 'Hook', score: hook.score, note: hook.findings[0] ? `${hook.findings[0].title}.` : 'The first line lands quickly and gives a reason to stay.' },
    { name: 'Structure', score: clamp(structure), note: `${promise ? 'promises a payoff early' : 'no early promise of what the viewer gets'}, ${sequence ? 'moves in clear steps' : 'no clear sequence of steps'}.` },
    { name: 'Pacing', score: clamp(pacing), note: longs.length ? `${longs.length} line${longs.length > 1 ? 's run' : ' runs'} past 22 words. Average line is ${avg.toFixed(0)} words.` : `Lines average ${avg.toFixed(0)} words, which keeps the rhythm quick.` },
    { name: 'Clarity', score: clamp(clarity), note: fills ? `${fills} filler word${fills > 1 ? 's' : ''} across ${total} words.` : 'No filler words found.' },
    { name: 'Call to action', score: cta, note: ctaLate ? 'Ends with a clear ask.' : ctaAny ? 'There is an ask, but it comes before the ending.' : 'No ask anywhere in the script.' },
  ];

  const found: (Finding & { t: number })[] = [];
  const firstEnd = segs[0]?.end ?? 0;
  if (hook.findings[0]) found.push({ t: 0, at: `0:00 to ${timecode(firstEnd)}`, title: hook.findings[0].title, fix: hook.findings[0].fix, sev: hook.score < 45 ? 'bad' : 'warn' });
  longs.slice(0, 3).forEach((g) => found.push({ t: g.start, at: `${timecode(g.start)} to ${timecode(g.end)}`, title: `This line runs ${g.n} words without a break: "${clip(g.s, 63)}"`, fix: 'Split it into two beats or cut it down to the key phrase.', sev: 'bad' }));
  if (!promise) found.push({ t: firstEnd, at: timecode(firstEnd), title: 'The viewer is not told what they will get', fix: 'After the hook, add one short line that names the payoff.', sev: 'warn' });
  if (!ctaLate) found.push({ t: duration, at: timecode(duration), title: ctaAny ? 'The ask comes before the payoff' : 'The script ends without an ask', fix: 'Close with one action that fits the video, such as a save for a tutorial or a comment for an opinion.', sev: 'warn' });
  if (duration > 90) found.push({ t: duration, at: timecode(duration), title: `Estimated length is ${timecode(duration)}`, fix: 'Cut the weakest beat. Most short-form scripts hold attention best under a minute.', sev: 'warn' });
  if (duration < 8) found.push({ t: duration, at: timecode(duration), title: 'The script is only a few seconds long', fix: 'Add the payoff. A hook with nothing after it leaves viewers with no reason to follow.', sev: 'warn' });
  found.sort((a, b) => a.t - b.t);

  return {
    type: 'script',
    title: clip(sentences[0] ?? ''),
    score: clamp(metrics[0].score * 0.3 + metrics[1].score * 0.25 + metrics[2].score * 0.2 + metrics[3].score * 0.1 + metrics[4].score * 0.15),
    metrics,
    findings: found.map(({ at, title, fix, sev }) => ({ at, title, fix, sev })),
    working: metrics.filter((m) => m.score >= 80).map((m) => `${m.name}: ${m.note}`),
    meta: [['Words', String(total)], ['Lines', String(segs.length)], ['Est. length', timecode(duration)]],
    map: segs.map((g) => ({ n: g.n, risk: g.risk, at: timecode(g.start) })),
  };
}

export type Platform = 'TikTok' | 'Instagram Reels' | 'YouTube Shorts';

export function detectPlatform(url: string): Platform | null {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/^(www|m|vm|vt)\./, '');
    if (host === 'tiktok.com') return 'TikTok';
    if (host === 'instagram.com' && /^\/(reel|reels|p)\//.test(u.pathname)) return 'Instagram Reels';
    if ((host === 'youtube.com' && /^\/shorts\//.test(u.pathname)) || host === 'youtu.be') return 'YouTube Shorts';
  } catch { /* not a URL */ }
  return null;
}

const SAMPLE_FINDINGS: [at: string, title: string, fix: string, metric: number][] = [
  ['0:00 to 0:03', 'The first three seconds show setup before anything happens', 'Open on the result or the most surprising frame, then explain.', 0],
  ['0:04 to 0:07', 'The topic is never stated on screen', 'Add a short text label naming the payoff within the first two seconds.', 0],
  ['0:06 to 0:10', 'Pacing slows during the explanation', 'Cut the pauses and add a visual change every two to three seconds.', 1],
  ['0:12 to 0:16', 'On-screen text is up too briefly to read', 'Hold each caption for at least a second and a half.', 2],
  ['0:18 to 0:22', 'The ending has no ask', 'Close with one clear action, such as a question to answer in a comment.', 3],
];

/**
 * Placeholder for link analysis. Nothing is downloaded: the report is a deterministic
 * sample seeded by the URL and always flagged `sim`. Replace with a real pipeline
 * once uploads are processed on the server.
 */
export function simulateUrlReport(url: string, platform: Platform): ReportBody {
  let h = 2166136261;
  for (const c of url) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const rnd = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  const metrics: Metric[] = ['Hook', 'Pacing', 'Text and captions', 'Ending'].map((name) => {
    const score = clamp(32 + rnd() * 60);
    return { name, score, note: score >= 75 ? 'Reads well in this sample.' : score >= 50 ? 'Workable, with room to tighten.' : 'This area is holding the sample score down.' };
  });
  return {
    type: 'video',
    sim: true,
    title: clip(url),
    score: clamp(metrics.reduce((sum, m) => sum + m.score, 0) / metrics.length),
    metrics,
    findings: SAMPLE_FINDINGS.filter((f) => metrics[f[3]].score < 75).slice(0, 4)
      .map((f) => ({ at: f[0], title: f[1], fix: f[2], sev: metrics[f[3]].score < 50 ? 'bad' : 'warn' })),
    working: metrics.filter((m) => m.score >= 75).map((m) => `${m.name} scored ${m.score}.`),
    meta: [['Platform', platform], ['Source', 'Link']],
  };
}

/** Plain-text summary used by the Copy button. */
export function summarize(r: ReportBody): string {
  const label = { hook: 'Hook report', script: 'Script report', video: 'Video report' }[r.type];
  return [
    `${label}: ${r.title}`, `Score ${r.score}/100 (${band(r.score)[0]})`, '',
    ...r.metrics.map((m) => `${m.name}: ${m.score}`), '', 'Fixes:',
    ...(r.findings.length ? r.findings.map((f) => `[${f.at}] ${f.title}. ${f.fix}`) : ['None flagged']),
  ].join('\n');
}
