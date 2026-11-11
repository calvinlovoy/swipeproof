import { describe, expect, it } from 'vitest';
import { buildPreflight } from './preflight';
import { autoMatch, combineRows, detectColumns, findPatterns, nameSimilarity, outcomes, parseCsv, readRows, spearman, toNumber } from './results';

describe('csv', () => {
  it('handles quotes, commas, line breaks inside quotes and a byte-order mark', () => {
    const table = parseCsv('﻿Ad name,Impressions\r\n"Kitchen tour, v2","1,234"\n"Line\nbreak",5\n\n');
    expect(table).toEqual([['Ad name', 'Impressions'], ['Kitchen tour, v2', '1,234'], ['Line\nbreak', '5']]);
  });
  it('reads money, percentages and thousands separators', () => {
    expect([toNumber('$1,234.50'), toNumber('12.5%'), toNumber(' 40 '), toNumber('n/a'), toNumber('')]).toEqual([1234.5, 12.5, 40, null, null]);
  });
  it('finds the usual ads-manager columns and reads rows', () => {
    const table = parseCsv('Campaign name,Ad name,Impressions,3-second video plays,ThruPlays,Link clicks,Amount spent (USD),Results\nC,kitchen-tour-v2,"10,000","3,100",900,120,$50.00,10\nC,,5,,,,,\n');
    const cols = detectColumns(table[0]);
    expect(cols).toEqual({ name: 1, impressions: 2, plays3s: 3, thruplays: 4, clicks: 5, spend: 6, results: 7 });
    expect(readRows(table, cols)).toEqual([{ adName: 'kitchen-tour-v2', metrics: { impressions: 10000, plays3s: 3100, thruplays: 900, clicks: 120, spend: 50, results: 10 } }]);
  });
  it('adds up rows that share an ad name', () => {
    const rows = [{ adName: 'Tour', metrics: { impressions: 100, clicks: 4 } }, { adName: 'tour', metrics: { impressions: 50, spend: 2.5 } }, { adName: 'Desk', metrics: { impressions: 7 } }];
    expect(combineRows(rows)).toEqual([{ adName: 'Tour', metrics: { impressions: 150, clicks: 4, spend: 2.5 } }, { adName: 'Desk', metrics: { impressions: 7 } }]);
  });
  it('derives rates only from the numbers that are present', () => {
    expect(outcomes({ impressions: 10000, plays3s: 3100, thruplays: 930, clicks: 120, spend: 50, results: 10 })).toEqual({ hookRate: 31, holdRate: 30, ctr: 1.2, costPerResult: 5 });
    expect(outcomes({ impressions: 100 })).toEqual({});
  });
});

describe('matching', () => {
  it('scores names by shared words, ignoring case, punctuation and the file extension', () => {
    expect(nameSimilarity('Kitchen Tour V2 | Broad', 'kitchen-tour-v2.mp4')).toBe(1);
    expect(nameSimilarity('desk setup', 'kitchen-tour-v2.mp4')).toBe(0);
  });
  it('pairs each row with its best video and uses a video only once', () => {
    const videos = [{ id: 'a', title: 'kitchen-tour-v1.mp4' }, { id: 'b', title: 'kitchen-tour-v2.mp4' }];
    const rows = [{ adName: 'kitchen tour v2', metrics: {} }, { adName: 'kitchen tour v1', metrics: {} }, { adName: 'unrelated', metrics: {} }];
    expect(autoMatch(rows, videos)).toEqual(['b', 'a', null]);
    // A near miss (v2 against a v1 file) stays unmatched for the user to decide.
    expect(autoMatch([rows[0]], [videos[0]])).toEqual([null]);
  });
});

describe('patterns', () => {
  it('computes rank correlation with ties', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBe(0);
  });
  it('reports traits that track with the outcome and skips ones that do not vary', () => {
    const points = [1, 2, 3, 4, 5, 6].map((i) => ({ traits: { firstCut: i, duration: 20 }, outcome: 40 - i * 4 }));
    const found = findPatterns(points, true);
    expect(found.map((p) => p.key)).toEqual(['firstCut']);
    expect(found[0]).toMatchObject({ n: 6, rho: -1, strength: 'strong', helps: false, splitAt: 3.5, above: { n: 3, average: 20 }, below: { n: 3, average: 32 } });
    expect(findPatterns(points, false)[0].helps).toBe(true); // for a cost, lower is better
    expect(findPatterns(points.slice(0, 4), true)).toEqual([]); // too few videos
  });
});

describe('pre-flight', () => {
  const base = { duration: 20, width: 1080, height: 1920, fps: 30, cuts: [1.2, 6, 11, 17], openingLuma: 120, audio: { loudness: -14.2, truePeak: -2, firstSound: 0, longestSilence: null } };
  const status = (checks: { name: string; status: string }[], name: string) => checks.find((c) => c.name === name)?.status;

  it('passes a well-built vertical video and records its traits', () => {
    const { checks, traits } = buildPreflight(base);
    expect(checks.every((c) => c.status === 'pass')).toBe(true);
    expect(traits).toEqual({ duration: 20, cutsPer10s: 2, firstCut: 1.2, fps: 30, firstSound: 0, loudness: -14.2 });
  });
  it('flags a late cut, a black opening, a silent start, quiet audio and a landscape frame', () => {
    const { checks } = buildPreflight({ ...base, width: 1920, height: 1080, cuts: [7], openingLuma: 4, audio: { loudness: -27, truePeak: -0.2, firstSound: 2.4, longestSilence: { start: 9, seconds: 4.5 } } });
    expect(status(checks, 'First cut')).toBe('warn');
    expect(status(checks, 'Cut rate')).toBe('warn');
    expect(status(checks, 'Opening frame')).toBe('fail');
    expect(status(checks, 'Frame')).toBe('fail');
    expect(status(checks, 'First sound')).toBe('warn');
    expect(status(checks, 'Loudness')).toBe('warn');
    expect(status(checks, 'Peaks')).toBe('warn');
    expect(status(checks, 'Silent stretch')).toBe('warn');
  });
  it('handles a silent file and a single-shot clip', () => {
    const { checks, traits } = buildPreflight({ ...base, duration: 6, cuts: [], audio: null });
    expect(status(checks, 'Sound')).toBe('warn');
    expect(status(checks, 'First cut')).toBe('pass');
    expect(traits.firstCut).toBeUndefined();
  });
});
