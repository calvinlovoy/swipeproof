import type { ReportBody } from '@shared/engine';
import { buildVideoReport, compareGrids, GRID, rgbaToGray, sampleTimes, type FrameSample } from '@shared/video';

/**
 * Quick check: samples frames from a local video file in the browser and scores motion,
 * cuts, format, length and brightness. The file never leaves the device.
 * Throws if the browser cannot decode the file.
 */
export async function analyzeFile(file: File, onProgress?: (fraction: number) => void): Promise<ReportBody> {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      v.onloadedmetadata = () => resolve();
      v.onerror = () => reject(new Error('decode'));
      setTimeout(() => reject(new Error('decode')), 10_000);
    });
    const duration = v.duration;
    if (!Number.isFinite(duration) || !v.videoWidth || !v.videoHeight) throw new Error('decode');

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = GRID;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('decode');

    const times = sampleTimes(duration);
    const samples: FrameSample[] = [];
    let prev: Float32Array | null = null;
    for (let i = 0; i < times.length; i++) {
      const seeked = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 2500);
        v.onseeked = () => { clearTimeout(timer); resolve(true); };
        v.currentTime = times[i];
      });
      onProgress?.((i + 1) / times.length);
      if (!seeked) continue;
      ctx.drawImage(v, 0, 0, GRID, GRID);
      const gray = rgbaToGray(ctx.getImageData(0, 0, GRID, GRID).data);
      samples.push({ t: times[i], ...compareGrids(prev, gray), first: !prev });
      prev = gray;
    }
    if (samples.length < 2) throw new Error('decode');

    return buildVideoReport({ fileName: file.name, fileSize: file.size, duration, width: v.videoWidth, height: v.videoHeight, samples, source: 'browser' });
  } finally {
    URL.revokeObjectURL(url);
    v.removeAttribute('src');
  }
}
