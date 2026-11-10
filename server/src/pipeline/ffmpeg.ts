import { spawn } from 'node:child_process';
import { compareGrids, GRID, GRID_PIXELS, sampleTimes, type FrameSample } from '../../../shared/video';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

/** Runs a binary with an argument array (never a shell string) and collects stdout. */
function run(bin: string, args: string[], timeoutMs = 60_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${bin} timed out`)); }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => { if (err.length < 4000) err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${bin} exited with ${code}: ${err.trim().split('\n').pop() ?? ''}`));
    });
  });
}

/** True when both ffmpeg and ffprobe can be started. */
export async function ffmpegAvailable(): Promise<boolean> {
  try { await run(FFMPEG, ['-version'], 5000); await run(FFPROBE, ['-version'], 5000); return true; }
  catch { return false; }
}

export interface Probe { duration: number; width: number; height: number; hasAudio: boolean }

/** Reads length, displayed frame size and whether there is sound. Throws if the file is not a video. */
export async function probe(file: string): Promise<Probe> {
  const raw = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], 20_000);
  const info = JSON.parse(raw.toString()) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; width?: number; height?: number; duration?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
  };
  const video = info.streams?.find((s) => s.codec_type === 'video' && s.width && s.height);
  const duration = Number(info.format?.duration ?? video?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0) throw new Error('not a video');
  // Phones often store portrait video sideways plus a rotation flag. Report it as it plays.
  const rotation = Math.abs(Number(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0));
  const sideways = rotation % 180 === 90;
  return {
    duration,
    width: sideways ? video.height! : video.width!,
    height: sideways ? video.width! : video.height!,
    hasAudio: Boolean(info.streams?.some((s) => s.codec_type === 'audio')),
  };
}

/** One frame at `t` seconds as a 32x32 grayscale grid. */
async function grayGrid(file: string, t: number): Promise<Buffer | null> {
  const out = await run(FFMPEG, ['-v', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', `scale=${GRID}:${GRID},format=gray`, '-f', 'rawvideo', 'pipe:1'], 20_000).catch(() => null);
  return out && out.length >= GRID_PIXELS ? out.subarray(0, GRID_PIXELS) : null;
}

/** Samples the same moments the browser quick check does and measures brightness and change. */
export async function sampleFrames(file: string, duration: number, onProgress?: (fraction: number) => void): Promise<FrameSample[]> {
  const times = sampleTimes(duration);
  const samples: FrameSample[] = [];
  let prev: Buffer | null = null;
  for (let i = 0; i < times.length; i++) {
    const grid = await grayGrid(file, times[i]);
    onProgress?.((i + 1) / times.length);
    if (!grid) continue;
    samples.push({ t: times[i], ...compareGrids(prev, grid), first: !prev });
    prev = grid;
  }
  return samples;
}

export interface Still { at: number; jpegBase64: string }

/** A handful of small JPEG stills for the feedback model: three from the opening, the rest spread out. */
export async function extractStills(file: string, duration: number, count = 8): Promise<Still[]> {
  const opening = [0.2, 1.2, 2.4].filter((t) => t < duration);
  const rest = Math.max(0, count - opening.length);
  const spread = Array.from({ length: rest }, (_, i) => 3 + ((duration - 3) * (i + 0.5)) / rest).filter((t) => t > 3 && t < duration);
  const stills: Still[] = [];
  for (const at of [...opening, ...spread]) {
    const jpeg = await run(FFMPEG, ['-v', 'error', '-ss', at.toFixed(3), '-i', file, '-frames:v', '1', '-vf', "scale='if(gt(iw,ih),512,-2)':'if(gt(iw,ih),-2,512)'", '-q:v', '6', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], 20_000).catch(() => null);
    if (jpeg?.length) stills.push({ at, jpegBase64: jpeg.toString('base64') });
  }
  return stills;
}

/** Writes the soundtrack as a small mono file for transcription. */
export async function extractAudio(file: string, outPath: string): Promise<void> {
  await run(FFMPEG, ['-v', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', '-f', 'mp4', outPath], 120_000);
}
