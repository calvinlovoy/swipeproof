import { clamp, timecode, type Finding, type Metric, type ReportBody } from '@shared/engine';

/**
 * Samples frames from a local video file in the browser and scores motion, cuts,
 * format, length and brightness. The file never leaves the device.
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
    const dur = v.duration;
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (!Number.isFinite(dur) || !w || !h) throw new Error('decode');

    // Dense samples across the first three seconds, then up to 14 across the rest.
    const times = [0.1, 0.6, 1.1, 1.6, 2.1, 2.6].filter((t) => t < dur);
    const rest = Math.max(0, dur - 3.1);
    const extra = rest > 0 ? Math.min(14, Math.max(3, Math.round(rest / 1.5))) : 0;
    for (let i = 0; i < extra; i++) times.push(3.1 + (rest * (i + 0.5)) / extra);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('decode');

    const samples: { t: number; luma: number; diff: number; first: boolean }[] = [];
    let prev: Float32Array | null = null;
    for (let i = 0; i < times.length; i++) {
      const seeked = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 2500);
        v.onseeked = () => { clearTimeout(timer); resolve(true); };
        v.currentTime = times[i];
      });
      onProgress?.((i + 1) / times.length);
      if (!seeked) continue;
      ctx.drawImage(v, 0, 0, 32, 32);
      const px = ctx.getImageData(0, 0, 32, 32).data;
      const luma = new Float32Array(1024);
      let sum = 0;
      for (let p = 0; p < 1024; p++) {
        const y = 0.299 * px[p * 4] + 0.587 * px[p * 4 + 1] + 0.114 * px[p * 4 + 2];
        luma[p] = y;
        sum += y;
      }
      let diff = 0;
      if (prev) { for (let p = 0; p < 1024; p++) diff += Math.abs(luma[p] - prev[p]); diff /= 1024; }
      samples.push({ t: times[i], luma: sum / 1024, diff, first: !prev });
      prev = luma;
    }
    if (samples.length < 2) throw new Error('decode');

    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
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
      title: file.name.slice(0, 200),
      score: clamp(open * 0.3 + variety * 0.25 + format * 0.2 + length * 0.15 + light * 0.1),
      metrics,
      findings,
      working: metrics.filter((m) => m.score >= 80).map((m) => `${m.name}: ${m.note}`),
      meta: [['Length', timecode(dur)], ['Frame', `${w}×${h}`], ['Size', `${(file.size / 1_048_576).toFixed(1)} MB`], ['Source', 'Upload']],
      audio: true,
    };
  } finally {
    URL.revokeObjectURL(url);
    v.removeAttribute('src');
  }
}
