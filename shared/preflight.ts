/**
 * Pre-flight checks: exact measurements of a video with a pass, caution or fail mark on each.
 * These are the things a language model describes loosely and a tool can measure:
 * when the first cut lands, how often the picture changes, when sound starts, how loud it is.
 *
 * The thresholds are house rules chosen as sensible starting points. They are not platform
 * requirements, and the results page exists to test them against a user's own numbers.
 */
import { timecode, type Check } from './engine';

export interface AudioFacts {
  /** Integrated loudness in LUFS, or null when it could not be measured. */
  loudness: number | null;
  /** True peak in dBTP. */
  truePeak: number | null;
  /** Seconds until the first sound. 0 when sound starts immediately. */
  firstSound: number;
  /** Longest quiet stretch after the opening, if any. */
  longestSilence: { start: number; seconds: number } | null;
}
export interface PreflightFacts {
  duration: number;
  width: number;
  height: number;
  fps: number | null;
  /** Times of hard cuts, in seconds. */
  cuts: number[];
  /** Null when the file has no soundtrack. */
  audio: AudioFacts | null;
  /** Brightness (0 to 255) of the first sampled frame. */
  openingLuma: number;
}

const secs = (n: number) => `${n.toFixed(1)} s`;

export function buildPreflight(f: PreflightFacts): { checks: Check[]; traits: Record<string, number> } {
  const checks: Check[] = [];
  const traits: Record<string, number> = { duration: round(f.duration) };

  // ---- picture ----
  const firstCut = f.cuts[0] ?? null;
  const cutsPer10 = f.duration > 0 ? (f.cuts.length / f.duration) * 10 : 0;
  traits.cutsPer10s = round(cutsPer10);
  if (firstCut !== null) traits.firstCut = round(firstCut);
  checks.push(firstCut === null
    ? { name: 'First cut', value: 'No cuts', status: f.duration > 8 ? 'warn' : 'pass', note: f.duration > 8 ? 'The whole video is one shot. A change of picture early on gives the eye a reason to stay.' : 'One continuous shot, which is fine at this length.' }
    : { name: 'First cut', value: `at ${secs(firstCut)}`, status: firstCut <= 3 ? 'pass' : 'warn', note: firstCut <= 3 ? 'The picture changes inside the first three seconds.' : 'The first shot holds for more than three seconds. Try an earlier cut or zoom.' });
  if (f.cuts.length > 0) checks.push({
    name: 'Cut rate', value: `${f.cuts.length} cut${f.cuts.length === 1 ? '' : 's'}, ${cutsPer10.toFixed(1)} per 10 s`,
    status: f.duration <= 8 || cutsPer10 >= 1 ? 'pass' : 'warn',
    note: f.duration <= 8 || cutsPer10 >= 1 ? 'The picture changes often enough to keep moving.' : 'Fewer than one cut every ten seconds. Long holds are where attention drifts.',
  });
  checks.push({
    name: 'Opening frame', value: f.openingLuma < 20 ? 'Dark' : 'Visible',
    status: f.openingLuma < 20 ? 'fail' : 'pass',
    note: f.openingLuma < 20 ? 'The video opens on a near-black frame, often a fade-in. In a feed that reads as nothing happening.' : 'There is a picture from the first frame.',
  });

  const ratio = f.width / f.height;
  const shortSide = Math.min(f.width, f.height);
  const vertical = ratio <= 0.6;
  checks.push({
    name: 'Frame', value: `${f.width}×${f.height}`,
    status: vertical && shortSide >= 1080 ? 'pass' : vertical || ratio < 0.95 ? 'warn' : 'fail',
    note: vertical ? (shortSide >= 1080 ? 'Full vertical at 1080 or better.' : 'Vertical, but under 1080 wide, so text may look soft.') : ratio < 0.95 ? 'Portrait, but not full 9:16. Expect bars or a crop.' : 'Not vertical. It will play small in a vertical feed.',
  });
  if (f.fps !== null) {
    traits.fps = round(f.fps);
    checks.push({ name: 'Frame rate', value: `${f.fps.toFixed(f.fps % 1 ? 2 : 0)} fps`, status: f.fps >= 23.9 ? 'pass' : 'warn', note: f.fps >= 23.9 ? 'Smooth playback.' : 'Under 24 frames a second, which looks choppy.' });
  }
  checks.push({
    name: 'Length', value: timecode(f.duration),
    status: f.duration < 5 || f.duration > 90 ? 'warn' : 'pass',
    note: f.duration < 5 ? 'Under five seconds. The payoff has to be immediate.' : f.duration > 90 ? 'Over ninety seconds, which is long for short-form.' : 'Within the usual short-form range.',
  });

  // ---- sound ----
  if (!f.audio) {
    checks.push({ name: 'Sound', value: 'None', status: 'warn', note: 'The file has no soundtrack. Viewers with sound on get silence.' });
  } else {
    const a = f.audio;
    traits.firstSound = round(a.firstSound);
    checks.push({
      name: 'First sound', value: a.firstSound < 0.05 ? 'Immediately' : `at ${secs(a.firstSound)}`,
      status: a.firstSound <= 1 ? 'pass' : 'warn',
      note: a.firstSound <= 1 ? 'Sound starts within the first second.' : 'The opening is silent for more than a second. Start the voice or music sooner.',
    });
    if (a.loudness !== null) {
      traits.loudness = round(a.loudness);
      const quiet = a.loudness < -20;
      const hot = a.loudness > -9;
      checks.push({
        name: 'Loudness', value: `${a.loudness.toFixed(1)} LUFS`,
        status: quiet || hot ? 'warn' : 'pass',
        note: quiet ? 'Quieter than most feed content, so it may sound faint next to the video before it.' : hot ? 'Very loud. It may be turned down or distort on phone speakers.' : 'In a comfortable range for phone playback.',
      });
    }
    if (a.truePeak !== null && a.truePeak > -1) {
      checks.push({ name: 'Peaks', value: `${a.truePeak.toFixed(1)} dBTP`, status: 'warn', note: 'The loudest moments are close to clipping. Leave about one decibel of headroom.' });
    }
    if (a.longestSilence && a.longestSilence.seconds >= 3) {
      checks.push({ name: 'Silent stretch', value: `${secs(a.longestSilence.seconds)} from ${timecode(a.longestSilence.start)}`, status: 'warn', note: 'A long quiet gap mid-video. Fill it or cut it.' });
    }
  }
  return { checks, traits };
}

function round(n: number): number { return Math.round(n * 100) / 100; }
