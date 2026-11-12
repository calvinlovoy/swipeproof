/**
 * Results: reading an ads-manager export, matching its rows to analyzed videos and finding
 * which measured traits tracked with performance. Pure functions shared by browser and server.
 */

// ---------- CSV ----------
/** Parses CSV text, handling quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

/** "1,234", "$56.70" and "12.5%" to numbers. Anything else is null. */
export function toNumber(raw: string | undefined): number | null {
  const cleaned = (raw ?? '').replace(/[$€£,%\s]/g, '');
  if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

// ---------- columns ----------
export const METRIC_KEYS = ['impressions', 'plays3s', 'thruplays', 'clicks', 'spend', 'results'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type Metrics = Partial<Record<MetricKey, number>>;
export type ColumnKey = 'name' | MetricKey;

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  name: 'Ad or video name',
  impressions: 'Impressions',
  plays3s: '3-second video plays',
  thruplays: 'ThruPlays or full views',
  clicks: 'Link clicks',
  spend: 'Amount spent',
  results: 'Results or conversions',
};
const COLUMN_PATTERNS: Record<ColumnKey, RegExp[]> = {
  name: [/^ad name$/, /^creative name$/, /^video name$/, /^ad$/, /^name$/, /name/],
  impressions: [/^impressions$/, /impressions/],
  plays3s: [/(3|three)[- ]?sec(ond)?s? (video )?(plays|views)/, /2[- ]?sec(ond)?s? (video )?views/],
  thruplays: [/^thruplays?$/, /thruplay/, /video plays at 100%/, /video views at 100%/],
  clicks: [/^link clicks$/, /^clicks \(all\)$/, /^clicks$/, /clicks/],
  spend: [/^amount spent/, /^spend/, /^cost$/],
  results: [/^results$/, /^purchases$/, /^conversions$/, /^leads$/],
};

/** Best guess at which column holds what. The user can correct every choice. */
export function detectColumns(headers: string[]): Partial<Record<ColumnKey, number>> {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const out: Partial<Record<ColumnKey, number>> = {};
  const taken = new Set<number>();
  for (const key of Object.keys(COLUMN_PATTERNS) as ColumnKey[]) {
    for (const pattern of COLUMN_PATTERNS[key]) {
      const i = lower.findIndex((h, idx) => !taken.has(idx) && pattern.test(h));
      if (i >= 0) { out[key] = i; taken.add(i); break; }
    }
  }
  return out;
}

export interface ResultRow { adName: string; metrics: Metrics }

export function readRows(table: string[][], columns: Partial<Record<ColumnKey, number>>): ResultRow[] {
  if (columns.name === undefined) return [];
  return table.slice(1).map((cells) => {
    const metrics: Metrics = {};
    for (const key of METRIC_KEYS) {
      const idx = columns[key];
      const n = idx === undefined ? null : toNumber(cells[idx]);
      if (n !== null && n >= 0) metrics[key] = n;
    }
    return { adName: (cells[columns.name!] ?? '').trim().slice(0, 200), metrics };
  }).filter((r) => r.adName && Object.keys(r.metrics).length > 0);
}

/** Adds up rows that share an ad name, for exports broken down by day, ad set or placement. */
export function combineRows(rows: ResultRow[]): ResultRow[] {
  const byName = new Map<string, ResultRow>();
  for (const row of rows) {
    const key = row.adName.toLowerCase();
    const have = byName.get(key);
    if (!have) { byName.set(key, { adName: row.adName, metrics: { ...row.metrics } }); continue; }
    for (const k of METRIC_KEYS) {
      const v = row.metrics[k];
      if (v !== undefined) have.metrics[k] = (have.metrics[k] ?? 0) + v;
    }
  }
  return [...byName.values()];
}

// ---------- matching rows to videos ----------
const tokens = (s: string) => new Set(s.toLowerCase().replace(/\.(mp4|mov|webm|m4v)$/i, '').split(/[^a-z0-9]+/).filter((t) => t.length > 1));

/** 0 to 1: how much of the shorter name's words appear in the longer one. */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

/** Pairs each row with its most similar video, using each video once. Unmatched rows get null. */
export function autoMatch(rows: ResultRow[], videos: { id: string; title: string }[], threshold = 0.7): (string | null)[] {
  const pairs = rows.flatMap((r, ri) => videos.map((v) => ({ ri, id: v.id, score: nameSimilarity(r.adName, v.title) })))
    .filter((p) => p.score >= threshold).sort((a, b) => b.score - a.score);
  const out: (string | null)[] = rows.map(() => null);
  const used = new Set<string>();
  for (const p of pairs) if (out[p.ri] === null && !used.has(p.id)) { out[p.ri] = p.id; used.add(p.id); }
  return out;
}

// ---------- outcomes ----------
export const OUTCOMES = {
  hookRate: { label: 'Hook rate', unit: '%', higherIsBetter: true, needs: 'impressions and 3-second plays' },
  holdRate: { label: 'Hold rate', unit: '%', higherIsBetter: true, needs: '3-second plays and ThruPlays' },
  ctr: { label: 'Click-through rate', unit: '%', higherIsBetter: true, needs: 'impressions and clicks' },
  costPerResult: { label: 'Cost per result', unit: '$', higherIsBetter: false, needs: 'spend and results' },
} as const;
export type OutcomeKey = keyof typeof OUTCOMES;

export function outcomes(m: Metrics): Partial<Record<OutcomeKey, number>> {
  const out: Partial<Record<OutcomeKey, number>> = {};
  const ratio = (a?: number, b?: number) => (a !== undefined && b !== undefined && b > 0 ? a / b : undefined);
  const hook = ratio(m.plays3s, m.impressions);
  const hold = ratio(m.thruplays, m.plays3s);
  const ctr = ratio(m.clicks, m.impressions);
  const cost = ratio(m.spend, m.results);
  if (hook !== undefined) out.hookRate = hook * 100;
  if (hold !== undefined) out.holdRate = hold * 100;
  if (ctr !== undefined) out.ctr = ctr * 100;
  if (cost !== undefined) out.costPerResult = cost;
  return out;
}

// ---------- patterns ----------
export const TRAIT_LABELS: Record<string, string> = {
  score: 'Overall score',
  openMotion: 'Opening motion score',
  firstCut: 'Seconds to the first cut',
  cutsPer10s: 'Cuts per 10 seconds',
  firstSound: 'Seconds to the first sound',
  loudness: 'Loudness in LUFS',
  duration: 'Length in seconds',
  brightness: 'Brightness score',
  hookScore: 'Spoken hook score',
  scriptScore: 'Script score',
  wordsPerSecond: 'Words per second',
};

function ranks(xs: number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) out[order[k][1]] = (i + j) / 2 + 1; // ties share the average rank
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation, -1 to 1. Returns 0 when either side does not vary. */
export function spearman(xs: number[], ys: number[]): number {
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

export interface TraitPattern {
  key: string;
  label: string;
  n: number;
  /** Rank correlation between the trait and the outcome. */
  rho: number;
  strength: 'strong' | 'moderate' | 'weak';
  /** True when more of the trait went with a better outcome. */
  helps: boolean;
  splitAt: number;
  above: { n: number; average: number };
  below: { n: number; average: number };
}

export const MIN_VIDEOS = 5;

/**
 * For each trait, how it moved with the outcome across the user's videos, plus the average
 * outcome above and below the trait's median. Correlation over a small set of videos: a lead
 * to test, never proof.
 */
export function findPatterns(points: { traits: Record<string, number>; outcome: number }[], higherIsBetter: boolean): TraitPattern[] {
  const out: TraitPattern[] = [];
  for (const key of Object.keys(TRAIT_LABELS)) {
    const have = points.filter((p) => typeof p.traits[key] === 'number' && Number.isFinite(p.traits[key]));
    if (have.length < MIN_VIDEOS) continue;
    const xs = have.map((p) => p.traits[key]);
    const ys = have.map((p) => p.outcome);
    const sorted = [...xs].sort((a, b) => a - b);
    const splitAt = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;
    const hi = have.filter((p) => p.traits[key] > splitAt);
    const lo = have.filter((p) => p.traits[key] <= splitAt);
    if (hi.length < 2 || lo.length < 2) continue; // the trait barely varies, or one side is a single video
    const avg = (ps: typeof have) => ps.reduce((s, p) => s + p.outcome, 0) / ps.length;
    const rho = spearman(xs, ys);
    const size = Math.abs(rho);
    out.push({
      key, label: TRAIT_LABELS[key], n: have.length, rho: Math.round(rho * 100) / 100,
      strength: size >= 0.6 ? 'strong' : size >= 0.35 ? 'moderate' : 'weak',
      helps: higherIsBetter ? rho > 0 : rho < 0,
      splitAt: Math.round(splitAt * 100) / 100,
      above: { n: hi.length, average: avg(hi) },
      below: { n: lo.length, average: avg(lo) },
    });
  }
  return out.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
}
