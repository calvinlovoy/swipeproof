import { useRef, useState, type FormEvent } from 'react';
import { timecode, words, WORDS_PER_SECOND, type Report } from '@shared/engine';
import { hookRules, scriptRules, validate } from '@shared/validate';
import { FreshResult } from '../components/Report';
import { Crumbs, Explainers, Field, FormError, PageHead, RelatedTools, ToolCards } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useDraft } from '../lib/hooks';
import { EXAMPLE_HOOK } from './Home';

export function ToolsHub() {
  return (
    <>
      <Crumbs trail={[['Tools']]} />
      <PageHead title="Check a hook, a script or a finished video">Each tool gives a score, the reasons behind it and specific changes. Reports save to your library.</PageHead>
      <div className="wrap"><ToolCards /></div>
    </>
  );
}

/** Shared submit flow for the two text tools: validate, call the API, show the saved report. */
function useTextTool(send: (text: string) => Promise<Report>, rules: typeof hookRules, extraCheck?: (text: string) => string) {
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const run = async (e: FormEvent, text: string, inputId: string) => {
    e.preventDefault();
    const local = validate({ text }, rules).errors.text ?? extraCheck?.(text) ?? '';
    if (local) { setError(local); document.getElementById(inputId)?.focus(); return; }
    setBusy(true); setError(''); setFormError('');
    try { setReport(await send(text)); }
    catch (err) {
      if (err instanceof ApiError && err.errors.text) { setError(err.errors.text); document.getElementById(inputId)?.focus(); }
      else setFormError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally { setBusy(false); }
  };
  return { error, setError, formError, busy, report, run };
}

const HOOK_EXAMPLES = [EXAMPLE_HOOK, "Stop adding captions like this. Here's why your viewers leave in 2 seconds", 'I tested 3 hooks on the same video and one tripled my watch time'];

export function HookAnalyzer() {
  const [text, setText] = useDraft('draftHook');
  const tool = useTextTool(api.reports.hook, hookRules);
  const input = useRef<HTMLDivElement>(null);
  return (
    <>
      <Crumbs trail={[['Tools', '/tools'], ['Hook analyzer']]} />
      <PageHead title="Hook analyzer">Paste the first line of your video. You get a score, the reasons a viewer might skip and a tightened version.</PageHead>
      <div className="wrap stack" style={{ gap: 24 }}>
        <form className="card stack" onSubmit={(e) => tool.run(e, text, 'hook')} noValidate>
          <div ref={input}>
            <Field id="hook" label="Your opening line" rows={3} maxLength={300} placeholder="Type or paste the first thing you say" value={text} error={tool.error}
              onChange={(v) => { setText(v); tool.setError(''); }}
              hint={<><span className="tc">{words(text).length}</span> words. A hook that lands in three seconds is about a dozen words.</>} />
          </div>
          <div className="row">
            <span className="label small muted">Try an example:</span>
            {HOOK_EXAMPLES.map((ex, i) => (
              <button type="button" className="chip" key={ex} onClick={() => { setText(ex); tool.setError(''); input.current?.querySelector('textarea')?.focus(); }}>Example {i + 1}</button>
            ))}
          </div>
          <FormError message={tool.formError} />
          <button className="btn" type="submit" disabled={tool.busy} style={{ alignSelf: 'flex-start' }}>{tool.busy ? 'Analyzing...' : 'Analyze hook'}</button>
        </form>
        <FreshResult report={tool.report} />
      </div>
      <Explainers title="What the hook analyzer checks" items={[
        ['Opening speed', 'Greetings and setup phrases push the point past the three second mark.'],
        ['Curiosity gap', 'Whether the line raises a question or promises an outcome.'],
        ['Specificity', 'Numbers, time frames and named things beat general words.'],
        ['Viewer focus and clarity', 'Whether the line speaks to the viewer and how much filler it carries.'],
      ]} />
      <RelatedTools skip="hook" />
    </>
  );
}

const SCRIPT_EXAMPLE = [
  'Hey guys, so today I wanted to talk about editing.',
  'Basically a lot of people just record a video and then they post it without really thinking about what the first few seconds look like to somebody who has never seen their account before and is scrolling quickly.',
  'First, cut everything before your first real sentence.',
  'Then add a text label that says what the video is about.',
  'Finally, show the result before you explain it.',
].join('\n');

export function ScriptAnalyzer() {
  const [text, setText] = useDraft('draftScript');
  const tool = useTextTool(api.reports.script, scriptRules, (t) => (words(t).length < 8 ? 'Paste at least a couple of sentences so there is something to pace.' : ''));
  const count = words(text).length;
  return (
    <>
      <Crumbs trail={[['Tools', '/tools'], ['Script analyzer']]} />
      <PageHead title="Script analyzer">Paste a full or partial script. You get a pacing map, the lines most likely to lose viewers and a fix for each.</PageHead>
      <div className="wrap stack" style={{ gap: 24 }}>
        <form className="card stack" onSubmit={(e) => tool.run(e, text, 'script')} noValidate>
          <Field id="script" label="Your script" rows={9} maxLength={6000} placeholder="One line per sentence works best" value={text} error={tool.error}
            onChange={(v) => { setText(v); tool.setError(''); }}
            hint={<><span className="tc">{count} words, about {timecode(count / WORDS_PER_SECOND)}</span> at a normal speaking pace.</>} />
          <FormError message={tool.formError} />
          <div className="row">
            <button className="btn" type="submit" disabled={tool.busy}>{tool.busy ? 'Analyzing...' : 'Analyze script'}</button>
            <button className="btn quiet" type="button" onClick={() => { setText(SCRIPT_EXAMPLE); tool.setError(''); }}>Load an example</button>
          </div>
        </form>
        <FreshResult report={tool.report} />
      </div>
      <Explainers title="What the script analyzer checks" items={[
        ['Hook', 'The first line gets the full hook check.'],
        ['Structure', 'An early promise, a clear sequence and an ask at the end.'],
        ['Pacing', 'Lines past 22 words are flagged with an estimated timecode.'],
        ['Length', 'Speaking time is estimated at 150 words a minute.'],
      ]} />
      <RelatedTools skip="script" />
    </>
  );
}
