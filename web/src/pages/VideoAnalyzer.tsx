import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import { detectPlatform, timecode, type Report } from '@shared/engine';
import { FreshResult } from '../components/Report';
import { Crumbs, Explainers, Field, PageHead, RelatedTools } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuth, useCapabilities } from '../lib/hooks';
import { analyzeFile } from '../lib/video';

type Depth = 'full' | 'quick';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function VideoAnalyzer() {
  const { user } = useAuth();
  const caps = useCapabilities();
  const [mode, setMode] = useState<'upload' | 'link'>('upload');
  const [depth, setDepth] = useState<Depth>(caps.fullAnalysis ? 'full' : 'quick');
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // What a full analysis covers on this server, in plain words.
  const covers = ['the picture', ...(caps.transcription ? ['what is said'] : []), ...(caps.feedback ? ['written feedback'] : [])];
  const coverText = covers.length > 1 ? `${covers.slice(0, -1).join(', ')} and ${covers[covers.length - 1]}` : covers[0];

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('video/')) { setFile(null); setFileError('That file is not a video. Choose an MP4, MOV or WebM file.'); return; }
    setFile(f); setFileError('');
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); };

  const runLink = async () => {
    const link = url.trim();
    const local = !link ? 'Paste a link, or switch to Upload a file.' : detectPlatform(link) ? '' : 'That is not a TikTok, Instagram Reels or YouTube Shorts link. Check it and try again.';
    if (local) { setUrlError(local); document.getElementById('vurl')?.focus(); return; }
    setBusy(true); setUrlError('');
    try { setReport(await api.reports.videoLink(link)); }
    catch (err) { setUrlError(err instanceof ApiError ? err.errors.url ?? err.message : 'Something went wrong. Try again.'); }
    finally { setBusy(false); }
  };

  const runQuick = async (f: File) => {
    setBusy(true); setProgress(0); setStage('Sampling frames in your browser'); setFileError('');
    try { setReport(await api.reports.videoUpload(await analyzeFile(f, setProgress))); }
    catch (err) { setFileError(err instanceof ApiError ? err.message : 'This browser could not read that video. Export it as an MP4 (H.264) and try again.'); }
    finally { setBusy(false); }
  };

  const runFull = async (f: File) => {
    if (f.size > caps.maxUploadMb * 1_048_576) { setFileError(`That file is over the ${caps.maxUploadMb} MB limit. Export a smaller version or use the quick check.`); return; }
    setBusy(true); setProgress(0); setStage('Uploading'); setFileError('');
    try {
      let job = await api.analyses.start(f, setProgress);
      setProgress(1);
      while (alive.current && (job.status === 'queued' || job.status === 'running')) {
        setStage(job.stage);
        await wait(1200);
        job = await api.analyses.get(job.id);
      }
      if (!alive.current) return;
      if (job.status === 'failed' || !job.reportId) { setFileError(job.error ?? 'The analysis did not finish. Try again.'); return; }
      setReport(await api.reports.get(job.reportId));
    } catch (err) {
      setFileError(err instanceof ApiError ? err.errors.video ?? err.message : 'Something went wrong. Try again.');
    } finally { if (alive.current) setBusy(false); }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'link') { void runLink(); return; }
    if (!file) { setFileError('Choose a video file first.'); fileInput.current?.focus(); return; }
    if (depth === 'full' && !user) { setFileError('Log in to run a full analysis, or choose the quick check.'); return; }
    void (depth === 'full' ? runFull(file) : runQuick(file));
  };

  const uploading = busy && depth === 'full' && stage === 'Uploading';
  return (
    <>
      <Crumbs trail={[['Tools', '/tools'], ['Video analyzer']]} />
      <PageHead title="Video analyzer">Upload a clip to see where it loses people and what to change. Paste a link to see a sample report.</PageHead>
      <div className="wrap stack" style={{ gap: 24 }}>
        <form className="card stack" onSubmit={submit} noValidate>
          <div className="row" role="group" aria-label="Source">
            <button type="button" className="chip" aria-pressed={mode === 'upload'} onClick={() => setMode('upload')}>Upload a file</button>
            <button type="button" className="chip" aria-pressed={mode === 'link'} onClick={() => setMode('link')}>Paste a link</button>
          </div>

          {mode === 'link' ? (
            <Field id="vurl" type="url" label="TikTok, Instagram Reels or YouTube Shorts link" placeholder="https://www.tiktok.com/@name/video/123" autoComplete="off"
              value={url} error={urlError} onChange={(v) => { setUrl(v); setUrlError(''); }} hint="Link reports are samples. Link analysis is not built yet." />
          ) : (
            <>
              <div className="stack">
                <label className={`drop${over ? ' over' : ''}`} htmlFor="vfile" onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
                  <input type="file" id="vfile" accept="video/*" ref={fileInput} aria-describedby="vfile-err" onChange={(e) => pick(e.target.files?.[0])} />
                  <b>Choose a video</b> or drop it here<br />
                  <span className="hint">{file ? `${file.name} (${(file.size / 1_048_576).toFixed(1)} MB)` : `MP4, MOV or WebM, up to ${caps.maxUploadMb} MB and ${timecode(caps.maxSeconds)} long.`}</span>
                </label>
                <p className="err" id="vfile-err" role="alert">{fileError}</p>
              </div>

              <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0, gap: 10 }}>
                <legend className="label" style={{ padding: 0, marginBottom: 8 }}>How deep should the check go?</legend>
                <label className="choice" htmlFor="depth-full">
                  <input type="radio" id="depth-full" name="depth" checked={depth === 'full'} disabled={!caps.fullAnalysis || busy} onChange={() => setDepth('full')} />
                  <span>
                    <b>Full analysis</b>
                    {caps.fullAnalysis
                      ? <>Runs on our server and covers {coverText}. Your file is deleted as soon as it finishes.{caps.demo && ' Demo mode: speech and feedback are sample text.'}</>
                      : 'Not available on this server yet.'}
                    {caps.fullAnalysis && !user && <> Needs an account: <Link to="/login?next=/tools/video">log in</Link> or <Link to="/signup?next=/tools/video">create one</Link>.</>}
                  </span>
                </label>
                <label className="choice" htmlFor="depth-quick">
                  <input type="radio" id="depth-quick" name="depth" checked={depth === 'quick'} disabled={busy} onChange={() => setDepth('quick')} />
                  <span><b>Quick check</b>Runs in your browser and covers the picture only. The file never leaves your device. No account needed.</span>
                </label>
              </fieldset>
            </>
          )}

          {busy && mode === 'upload' && (
            <div className="stack" style={{ gap: 6 }} aria-live="polite">
              {uploading || depth === 'quick'
                ? <div className="prog" role="progressbar" aria-label={stage} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ width: `${progress * 100}%` }} /></div>
                : <div className="prog busy" role="progressbar" aria-label={stage}><i /></div>}
              <p className="hint">{stage}{uploading ? ` ${Math.round(progress * 100)}%` : ''}. {depth === 'full' ? 'A full analysis usually takes under a minute.' : 'This takes a few seconds.'}</p>
            </div>
          )}
          <button className="btn" type="submit" disabled={busy} style={{ alignSelf: 'flex-start' }}>{busy ? 'Analyzing...' : 'Analyze video'}</button>
        </form>
        <FreshResult report={report} />
      </div>
      <Explainers title="What the video analyzer checks" items={[
        ['Opening motion', 'How much the picture changes in the first three seconds.'],
        ['Visual variety', 'Hard cuts and the longest stretch where nothing changes.'],
        ['Format, length and brightness', 'Aspect ratio and resolution for a vertical feed, running time and exposure.'],
        ['Speech and feedback', 'A full analysis transcribes what is said, scores it as a script and adds written notes tied to moments in the video.'],
      ]} />
      <RelatedTools skip="video" />
    </>
  );
}
