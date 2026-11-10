import fs from 'node:fs/promises';
import { analyzeScript, clamp, timecode, words, type ReportBody } from '../../../shared/engine';
import { buildVideoReport } from '../../../shared/video';
import { extractAudio, extractStills, probe, sampleFrames } from './ffmpeg';
import type { Providers } from './providers';

export const MAX_SECONDS = Number(process.env.MAX_VIDEO_SECONDS ?? 300);

/** A problem the uploader can fix. Its message is shown to them as written. */
export class AnalysisError extends Error {}

export type Stage = 'Reading the video' | 'Sampling frames' | 'Transcribing speech' | 'Scoring' | 'Writing feedback';

/**
 * Full analysis of one uploaded file:
 * 1. read its length and frame size
 * 2. sample frames and score the visuals (same rules as the browser quick check)
 * 3. transcribe the soundtrack and score what is said with the hook and script rules
 * 4. ask the feedback model for written notes
 * Steps 3 and 4 are skipped when no provider is configured, and a failure in either
 * degrades the report instead of failing the job.
 */
export async function analyzeVideo(file: string, fileName: string, fileSize: number, providers: Providers, onStage: (stage: Stage) => void = () => {}): Promise<ReportBody> {
  onStage('Reading the video');
  const info = await probe(file).catch(() => { throw new AnalysisError('That file could not be read as a video. Export it as an MP4 and try again.'); });
  if (info.duration > MAX_SECONDS) throw new AnalysisError(`That video is ${timecode(info.duration)} long. The limit is ${timecode(MAX_SECONDS)}.`);

  onStage('Sampling frames');
  const samples = await sampleFrames(file, info.duration);
  if (samples.length < 2) throw new AnalysisError('That file could not be read as a video. Export it as an MP4 and try again.');
  const report = buildVideoReport({ fileName, fileSize, duration: info.duration, width: info.width, height: info.height, samples, source: 'server' });

  let transcript = '';
  let transcribed = false;
  if (providers.transcriber && info.hasAudio) {
    onStage('Transcribing speech');
    const audioPath = `${file}.m4a`;
    try {
      await extractAudio(file, audioPath);
      transcript = await providers.transcriber.transcribe(audioPath);
      transcribed = true;
    } catch (e) {
      console.error('transcription failed:', e instanceof Error ? e.message : e);
    } finally {
      await fs.rm(audioPath, { force: true });
    }
  }

  onStage('Scoring');
  const spoken = words(transcript).length;
  if (transcribed) {
    report.audio = false;
    report.transcript = transcript.slice(0, 6000);
    if (spoken >= 8) {
      // Use the real speaking pace so timecodes on spoken lines match the recording.
      const script = analyzeScript(transcript, { wordsPerSecond: spoken / info.duration });
      const visualScore = report.score;
      report.metrics.push(
        { name: 'Spoken hook', score: script.metrics[0].score, note: script.metrics[0].note },
        { name: 'Script', score: script.score, note: `Structure ${script.metrics[1].score}, pacing ${script.metrics[2].score}, call to action ${script.metrics[4].score}.` },
      );
      report.findings.push(...script.findings.map((f) => ({ ...f, title: `Spoken: ${f.title}` })));
      report.score = clamp(visualScore * 0.55 + script.score * 0.45);
      report.meta.push(['Words spoken', String(spoken)]);
    } else {
      report.meta.push(['Speech', spoken ? 'A few words' : 'None detected']);
    }
    report.working = report.metrics.filter((m) => m.score >= 80).map((m) => `${m.name}: ${m.note}`);
  }

  if (providers.coach) {
    onStage('Writing feedback');
    try {
      const stills = await extractStills(file, info.duration);
      const notes = await providers.coach.write({ fileName, duration: info.duration, score: report.score, metrics: report.metrics, findings: report.findings, transcript, stills });
      if (notes) report.coach = notes;
    } catch (e) {
      console.error('feedback failed:', e instanceof Error ? e.message : e);
    }
  }
  return report;
}
