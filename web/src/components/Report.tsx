import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { band, summarize, type Report, type ReportBody } from '@shared/engine';
import { useCountUp, useToast } from '../lib/hooks';

export const REPORT_LABEL = { hook: 'Hook report', script: 'Script report', video: 'Video report' } as const;

function Dial({ score }: { score: number }) {
  const [label, tone] = band(score);
  const shown = useCountUp(score);
  const circumference = 2 * Math.PI * 52;
  return (
    <div className={`dial ${tone}`} role="img" aria-label={`Score ${score} out of 100, ${label}`}>
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="52" className="tr" />
        <circle cx="60" cy="60" r="52" className="fg" strokeDasharray={`${((circumference * score) / 100).toFixed(1)} ${circumference.toFixed(1)}`} transform="rotate(-90 60 60)" />
      </svg>
      <div className="num"><b>{shown}</b><span>{label}</span></div>
    </div>
  );
}

/** The full report card. `focusOnMount` moves focus to the heading after a fresh analysis. */
export function ReportView({ report, focusOnMount = false }: { report: ReportBody | Report; focusOnMount?: boolean }) {
  const toast = useToast();
  const heading = useRef<HTMLHeadingElement>(null);
  const id = 'id' in report ? report.id : '';
  useEffect(() => {
    if (!focusOnMount || !heading.current) return;
    heading.current.closest('section')?.scrollIntoView({ block: 'start' });
    heading.current.focus({ preventScroll: true });
  }, [focusOnMount, id]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(summarize(report)); toast('Summary copied'); }
    catch { toast('Copy was blocked. Select the text to copy it.'); }
  };
  const longLines = report.map?.filter((g) => g.risk === 2).length ?? 0;

  return (
    <section className="card lift stack report" aria-labelledby="rep-h" style={{ gap: 22 }} key={id}>
      <div className="rep-top">
        <Dial score={report.score} />
        <div className="stack" style={{ gap: 8, flex: 1, minWidth: 220 }}>
          <p className="eyebrow">{REPORT_LABEL[report.type]}{report.sim && <span className="chip warn">Simulated</span>}</p>
          <h2 id="rep-h" ref={heading} tabIndex={-1} style={{ fontSize: '1.4rem', overflowWrap: 'anywhere' }}>{report.title}</h2>
          <ul className="meta">{report.meta.map(([k, v]) => <li key={k}>{k} <b className="tc">{v}</b></li>)}</ul>
        </div>
      </div>

      {report.sim && (
        <p className="notice">This is a sample report. Link analysis is not built yet, so link reports use example findings. Upload the file to get a real analysis.</p>
      )}

      {report.coach && (
        <div className="stack">
          <h3 className="row" style={{ gap: 12 }}>Coach notes {report.coach.model === 'demo' ? <span className="chip warn">Demo text</span> : <span className="chip note">Written by AI</span>}</h3>
          {report.coach.summary && <p>{report.coach.summary}</p>}
          {report.coach.fixes.length > 0 && (
            <ol className="finds">
              {report.coach.fixes.map((f) => <li key={f.at + f.title} className="ai"><span className="tc">{f.at || 'Note'}</span><b>{f.title}</b><span className="fix">{f.fix}</span></li>)}
            </ol>
          )}
        </div>
      )}

      <div className="stack">
        <h3>Scores</h3>
        <ul className="bars">
          {report.metrics.map((m) => {
            const [label, tone] = band(m.score);
            return (
              <li key={m.name}>
                <div className="bar-h"><span>{m.name}</span><span className={`tc ${tone}`}>{m.score} {label}</span></div>
                <div className={`bar ${tone}`}><i style={{ width: `${m.score}%` }} /></div>
                <p>{m.note}</p>
              </li>
            );
          })}
        </ul>
      </div>

      {report.map && (
        <div className="stack">
          <h3>Pacing map</h3>
          <div className="pmap" role="img" aria-label={`Each block is one line of the script, sized by word count. ${longLines} long lines flagged.`}>
            {report.map.map((g, i) => <i key={i} className={`r${g.risk}`} style={{ flex: g.n, animationDelay: `${i * 40}ms` }} title={`${g.at}, ${g.n} words`} />)}
          </div>
          <div className="legend"><span><i />Fine</span><span><i className="r1" />Getting long</span><span><i className="r2" />Likely drop-off</span></div>
        </div>
      )}

      <div className="stack">
        <h3>What to fix</h3>
        {report.findings.length ? (
          <ol className="finds">
            {report.findings.map((f) => (
              <li key={f.at + f.title} className={f.sev}><span className="tc">{f.at}</span><b>{f.title}</b><span className="fix">{f.fix}</span></li>
            ))}
          </ol>
        ) : <p className="muted">Nothing flagged. Post it, or tighten the lowest score above.</p>}
      </div>

      {report.working.length > 0 && (
        <div className="stack">
          <h3>What is working</h3>
          <ul className="ticklist stack" style={{ gap: 6 }}>{report.working.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      {report.tight && (
        <div className="stack">
          <h3>Tightened version</h3>
          <blockquote>{report.tight}</blockquote>
          <p className="hint">Greeting and filler removed. The wording is otherwise yours.</p>
        </div>
      )}

      {report.transcript && (
        <details>
          <summary>Transcript</summary>
          <p style={{ whiteSpace: 'pre-wrap' }}>{report.transcript}</p>
        </details>
      )}

      {report.audio && (
        <p className="hint">
          {report.source === 'server'
            ? 'Speech was not analyzed for this video. Scores come from the picture only.'
            : <>This was a quick check in your browser, so scores come from the picture only. <Link to="/tools/video">Run a full analysis</Link> for speech and written feedback.</>}
        </p>
      )}

      <div className="row">
        <button className="btn" type="button" onClick={copy}>Copy summary</button>
        <Link className="btn ghost" to="/library">Open library</Link>
      </div>
    </section>
  );
}

/** Report plus the "saved" line shown under a fresh analysis. */
export function FreshResult({ report }: { report: Report | null }) {
  return (
    <div aria-live="polite" id="result">
      {report && (
        <>
          <ReportView report={report} focusOnMount key={report.id} />
          <p className="hint" style={{ marginTop: 10 }}>Saved to your library.</p>
        </>
      )}
    </div>
  );
}
