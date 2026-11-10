/**
 * Visual scoring for a video, shared by the browser (quick check) and the server (full analysis).
 * Both sides sample the same moments, reduce each frame to a 32x32 grayscale grid and hand the
 * numbers to `buildVideoReport`, so a clip scores the same wherever it is analyzed.
 */
import { clamp, timecode, type Finding, type Metric, type ReportBody } from './engine';

export const GRID = 32;
export const GRID_PIXELS = GRID * GRID;

export interface FrameSample { t: number; luma: number; diff: number; first: boolean }
export interface VideoFacts {
  fileName: string;
  fileSize: number;
  duration: number;
  width: number;
  height: number;
  samples: FrameSample[];
  source: 'browser' | 'server';
}

/** Dense samples across the first three seconds, then up to 14 spread over the rest. */
export function sampleTimes(duration: number): number[] {
  const times = [0.1, 0.6, 1.1, 1.6, 2.1, 2.6].filter((t) => t < duration);
  const rest = Math.max(0, duration - 3.1);
  const extra = rest > 0 ? Math.min(14, Math.max(3, Math.round(rest / 1.5))) : 0;
  for (let i = 0; i < extra; i++) times.push(3.1 + (rest * (i + 0.5)) / extra);
  return times;
}

/** Mean brightness of a grayscale grid, and its mean absolute change from the previous grid. */
export function compareGrids(prev: ArrayLike<number> | null, cur: ArrayLike<number>): { luma: number; diff: number } {
  let sum = 0;
  let diff = 0;
  for (let p = 0; p < GRID_PIXELS; p++) {
    sum += cur[p];
    if (prev) diff += Math.abs(cur[p] - prev[p]);
  }
  return { luma: sum / GRID_PIXELS, diff: prev ? diff / GRID_PIXELS : 0 };
}

/** RGBA pixels (as from a canvas) to a grayscale grid. */
export function rgbaToGray(rgba: ArrayLike<number>): Float32Array {
  const gray = new Float32Array(GRID_PIXELS);
  for (let p = 0; p < GRID_PIXELS; p++) gray[p] = 0.299 * rgba[p * 4] + 0.587 * rgba[p * 4 + 1] + 0.114 * rgba[p * 4 + 2];
  return gray;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function buildVideoReport(v: VideoFacts): ReportBody {
  const { duration: dur, width: w, height: h, samples } = v;
  const moving = samples.filter((s) => !s.first);
  const openMotion = mean(moving.filter((s) => s.t <= 3).map((s) => s.diff));
  const allMotion = mean(moving.map((s) => s.diff));
  const brightness = mean(samples.map((s) => s.luma));

  let still: [number, number] = [0, 0];
  let stillStart: number | null = null;
  samples.forEach((s, i) => {
    if (!s.first && s.diff < 2.5) {
      if (stillStart === null) stillStart = samples[i - 1].t;
      if (s.t - stillStart > still[1] - still[0]) still = [stillStart, s.t];
    } else stillStart = null;
  });
  const stillFor = still[1] - still[0];
  const stillTooLong = stillFor > Math.max(4, dur * 0.3);
  const cuts = samples.filter((s) => s.diff > 28).length;
  const ratio = w / h;
  const shortSide = Math.min(w, h);

  const open = clamp(25 + openMotion * 11);
  const variety = clamp(40 + allMotion * 6 - (stillTooLong ? 20 : 0));
  const format = clamp((ratio <= 0.6 ? 100 : ratio < 0.95 ? 75 : ratio <= 1.05 ? 60 : 35) - (shortSide >= 1080 ? 0 : shortSide >= 720 ? 10 : 30));
  const length = dur < 5 ? 50 : dur < 7 ? 75 : dur <= 35 ? 100 : dur <= 60 ? 85 : dur <= 90 ? 65 : 45;
  const light = brightness < 50 ? 35 : brightness < 70 ? 65 : brightness <= 200 ? 95 : 60;

  const metrics: Metric[] = [
    { name: 'Opening motion', score: open, note: open >= 75 ? 'The first three seconds have plenty of visual change.' : open >= 50 ? 'Some movement in the first three seconds.' : 'The picture barely changes in the first three seconds.' },
    { name: 'Visual variety', score: variety, note: `${cuts ? `About ${cuts}` : 'No'} hard cut${cuts === 1 ? '' : 's'} detected across ${samples.length} sampled frames.` },
    { name: 'Format', score: format, note: `${w} by ${h}. ${ratio <= 0.6 ? 'Vertical and ready for a phone feed.' : ratio < 0.95 ? 'Portrait, but not full 9:16.' : ratio <= 1.05 ? 'Square. It will show with bars in a vertical feed.' : 'Landscape. It will appear small in a vertical feed.'}` },
    { name: 'Length', score: length, note: `${timecode(dur)} long. ${dur < 7 ? 'Very short, so the payoff has to be immediate.' : dur <= 35 ? 'A comfortable length for short-form.' : dur <= 60 ? 'On the longer side, so pacing matters more.' : 'Long for short-form. Consider cutting it down.'}` },
    { name: 'Brightness', score: light, note: brightness < 70 ? 'The footage is dark, which hides detail on a phone screen.' : brightness > 200 ? 'The footage is very bright and may look washed out.' : 'Exposure looks balanced.' },
  ];

  const findings: Finding[] = [];
  if (open < 60) findings.push({ at: '0:00 to 0:03', title: 'The opening is close to a still image', fix: 'Start on movement: a cut, a zoom or your hands already doing the thing.', sev: open < 45 ? 'bad' : 'warn' });
  if (stillTooLong) findings.push({ at: `${timecode(still[0])} to ${timecode(still[1])}`, title: `${Math.round(stillFor)} seconds pass with almost no visual change`, fix: 'Add a cut, a new angle or an on-screen label inside this stretch.', sev: 'bad' });
  if (format < 70) findings.push({ at: 'Whole video', title: ratio > 1.05 ? 'The frame is landscape' : shortSide < 720 ? 'Resolution is low' : 'The frame is not full vertical', fix: ratio > 0.6 ? 'Re-export at 9:16, for example 1080 by 1920, and crop to the speaker or subject.' : 'Export at 1080 pixels wide or more so text stays sharp.', sev: 'warn' });
  if (length < 70) findings.push({ at: timecode(dur), title: dur > 60 ? 'The video runs long for short-form' : 'The video is very short', fix: dur > 60 ? 'Cut the weakest section and aim for under a minute.' : 'Make sure the payoff is on screen before it ends.', sev: 'warn' });
  if (light < 70) findings.push({ at: 'Whole video', title: brightness < 70 ? 'The footage is dark' : 'The footage is overexposed', fix: brightness < 70 ? 'Raise exposure or add a light facing the subject.' : 'Lower exposure so highlights keep their detail.', sev: 'warn' });

  return {
    type: 'video',
    title: v.fileName.slice(0, 200),
    score: clamp(open * 0.3 + variety * 0.25 + format * 0.2 + length * 0.15 + light * 0.1),
    metrics,
    findings,
    working: metrics.filter((m) => m.score >= 80).map((m) => `${m.name}: ${m.note}`),
    meta: [['Length', timecode(dur)], ['Frame', `${w}×${h}`], ['Size', `${(v.fileSize / 1_048_576).toFixed(1)} MB`], ['Source', v.source === 'server' ? 'Full analysis' : 'Quick check']],
    audio: true,
    source: v.source,
  };
}
