import { describe, expect, it } from 'vitest';
import { analyzeHook, analyzeScript, detectPlatform, simulateUrlReport, tighten, timecode } from './engine';
import { contactRules, validate } from './validate';

describe('analyzeHook', () => {
  const weak = analyzeHook('Hey guys, so today I wanted to show you some tips for editing videos');
  const strong = analyzeHook("Stop posting at 9am. Here's why your views die in 2 seconds");

  it('scores a greeting-led hook as weak and a specific one as strong', () => {
    expect(weak.score).toBeLessThan(50);
    expect(strong.score).toBeGreaterThanOrEqual(75);
  });
  it('flags the slow opener first and offers a tightened line', () => {
    expect(weak.findings.map((f) => f.title)).toContain('The opening spends time on a greeting before the point');
    expect(weak.tight).toBe('Some tips for editing videos');
  });
  it('returns five metrics between 0 and 100', () => {
    expect(strong.metrics).toHaveLength(5);
    for (const m of strong.metrics) { expect(m.score).toBeGreaterThanOrEqual(0); expect(m.score).toBeLessThanOrEqual(100); }
  });
});

describe('analyzeScript', () => {
  const script = [
    'Hey guys, so today I wanted to talk about editing.',
    'Basically a lot of people just record a video and then they post it without really thinking about what the first few seconds look like to somebody who has never seen their account before and is scrolling quickly.',
    'First, cut everything before your first real sentence.',
    'Then add a text label that says what the video is about.',
    'Finally, show the result before you explain it.',
  ].join('\n');
  const r = analyzeScript(script);

  it('builds a pacing map with one segment per line and flags the long one', () => {
    expect(r.map).toHaveLength(5);
    expect(r.map?.filter((g) => g.risk === 2)).toHaveLength(1);
    expect(r.findings.some((f) => f.title.startsWith('This line runs 38 words'))).toBe(true);
  });
  it('notices the missing call to action', () => {
    expect(r.metrics.find((m) => m.name === 'Call to action')?.score).toBe(20);
  });
  it('rewards an ask at the end', () => {
    const withAsk = analyzeScript(`${script}\nSave this so you have it for your next edit.`);
    expect(withAsk.metrics.find((m) => m.name === 'Call to action')?.score).toBe(100);
  });
});

describe('links', () => {
  it('recognizes the three supported platforms', () => {
    expect(detectPlatform('https://www.tiktok.com/@a/video/1')).toBe('TikTok');
    expect(detectPlatform('https://vm.tiktok.com/abc/')).toBe('TikTok');
    expect(detectPlatform('https://www.instagram.com/reel/abc/')).toBe('Instagram Reels');
    expect(detectPlatform('https://youtube.com/shorts/abc')).toBe('YouTube Shorts');
  });
  it('rejects everything else', () => {
    expect(detectPlatform('https://example.com/video')).toBeNull();
    expect(detectPlatform('https://www.youtube.com/watch?v=abc')).toBeNull();
    expect(detectPlatform('javascript:alert(1)')).toBeNull();
    expect(detectPlatform('not a link')).toBeNull();
  });
  it('produces a stable simulated report that is always flagged', () => {
    const a = simulateUrlReport('https://www.tiktok.com/@a/video/1', 'TikTok');
    const b = simulateUrlReport('https://www.tiktok.com/@a/video/1', 'TikTok');
    expect(a).toEqual(b);
    expect(a.sim).toBe(true);
  });
});

describe('helpers', () => {
  it('formats timecodes', () => { expect(timecode(0)).toBe('0:00'); expect(timecode(75.4)).toBe('1:15'); });
  it('leaves a clean line alone', () => { expect(tighten('Three edits that doubled my watch time')).toBe('Three edits that doubled my watch time'); });
  it('validates forms', () => {
    const bad = validate({ name: ' ', email: 'nope', topic: 'Sales', message: 'short' }, contactRules);
    expect(Object.keys(bad.errors).sort()).toEqual(['email', 'message', 'name', 'topic']);
    const ok = validate({ name: 'A', email: 'a@example.com', topic: 'Support', message: 'Long enough message' }, contactRules);
    expect(ok.errors).toEqual({});
  });
});
