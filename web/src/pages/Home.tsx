import { useEffect, useRef, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { analyzeHook, band, words } from '@shared/engine';
import { Faq, PlanCards, ToolCards } from '../components/ui';
import { useContent, useDraft } from '../lib/hooks';

export const EXAMPLE_HOOK = 'Hey guys, so today I wanted to show you some tips for editing videos';

/** The hero's live scorer. Runs the shared engine in the browser on every keystroke. */
function LiveHook() {
  const [text, setText] = useDraft('draftHook', EXAMPLE_HOOK);
  const navigate = useNavigate();
  const scoreEl = useRef<HTMLSpanElement>(null);
  const has = words(text).length > 0;
  const report = has ? analyzeHook(text) : null;
  const [label, tone] = report ? band(report.score) : ['Type a line', ''];

  // Restart the pop animation whenever the number changes.
  useEffect(() => {
    const el = scoreEl.current;
    if (!el) return;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }, [report?.score]);

  const open = (e: FormEvent) => { e.preventDefault(); navigate('/tools/hook'); };
  return (
    <form className="card lift live" onSubmit={open} noValidate>
      <label htmlFor="live-in">Try it now: type your opening line</label>
      <textarea id="live-in" rows={3} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="live-out" aria-live="polite">
        <span className={`live-score ${tone}`} ref={scoreEl}>{report?.score ?? 0}</span>
        <div className="stack" style={{ gap: 4 }}>
          <span className={`chip ${tone}`}>{label}</span>
          <span className="small muted">{report ? (report.findings[0] ? `${report.findings[0].title}.` : 'This opening lands. Open the report for the detail.') : ''}</span>
        </div>
      </div>
      <button className="btn" type="submit">Open the full hook report</button>
    </form>
  );
}

function Timeline() {
  const tone = (i: number) => (i < 3 ? 'r2' : (i >= 10 && i < 14) || (i >= 19 && i < 22) ? 'r1' : '');
  return (
    <div className="strip" aria-label="Example findings on a 24 second video">
      <p className="eyebrow">Example: findings pinned to a 24 second video</p>
      <div className="track" aria-hidden="true">
        {Array.from({ length: 24 }, (_, i) => <i key={i} className={tone(i)} style={{ animationDelay: `${i * 60}ms` }} />)}
        <b className="head" />
        <span className="pin l" style={{ animationDelay: '.15s' }}>0:00 opener</span>
        <span className="pin" style={{ left: '50%', animationDelay: '.75s' }}>0:10 long line</span>
        <span className="pin r" style={{ animationDelay: '1.25s' }}>0:19 no ask</span>
      </div>
      <div className="ticks tc" aria-hidden="true"><span>0:00</span><span>0:06</span><span>0:12</span><span>0:18</span><span>0:24</span></div>
    </div>
  );
}

export default function Home() {
  const { samples, steps, platforms } = useContent();
  return (
    <>
      <div className="wrap">
        <section className="hero">
          <div className="stack" style={{ gap: 20 }}>
            <p className="eyebrow"><span className="chip">TikTok</span><span className="chip">Reels</span><span className="chip">Shorts</span></p>
            <h1>Find the second they <em>swipe</em>.</h1>
            <p className="lede">Paste a hook, a script or a video. Swipeproof scores it from 0 to 100 and tells you what to change before you post.</p>
            <div className="row">
              <Link className="btn" to="/tools/video">Analyze a video</Link>
              <Link className="btn ghost" to="/#how">See how it works</Link>
            </div>
          </div>
          <LiveHook />
        </section>
        <Timeline />
      </div>

      <section className="band wrap stack" style={{ gap: 24 }}>
        <h2>A report points at a moment and says what to change</h2>
        <div className="grid">
          {samples.map((s) => (
            <div className="card" key={s.at}>
              <p className="eyebrow"><span className="tc">{s.at}</span><span className="chip">{s.tag}</span><span className="chip warn">Example</span></p>
              <p><b>Problem.</b> {s.prob}</p>
              <p><b>Change.</b> {s.fix}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="band wrap stack" id="how" style={{ gap: 24 }}>
        <h2>How it works</h2>
        <ol className="grid">
          {steps.map((s, i) => <li className="card" key={s.title}><span className="step-n">STEP {i + 1}</span><h3>{s.title}</h3><p className="muted">{s.body}</p></li>)}
        </ol>
        <Link className="btn" to="/get-started" style={{ alignSelf: 'flex-start' }}>Get started</Link>
      </section>

      <section className="band wrap stack" style={{ gap: 24 }}>
        <h2>Three tools, no account needed</h2>
        <ToolCards />
      </section>

      <section className="band wrap stack" style={{ gap: 24 }}>
        <h2>Tuned for each feed</h2>
        <div className="grid">
          {platforms.map((p) => (
            <Link className="card" key={p.id} to={`/for/${p.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <h3>{p.name}</h3>
              <p className="muted">{p.line}</p>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Read the {p.name} guide</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="band wrap stack" id="faq" style={{ gap: 24 }}>
        <h2>Questions people ask first</h2>
        <Faq />
      </section>

      <section className="band wrap stack" style={{ gap: 24 }}>
        <h2>Pricing</h2>
        <p className="lede">Placeholder pricing. Choosing a plan walks through checkout without taking payment.</p>
        <PlanCards />
      </section>

      <section className="band wrap">
        <div className="card lift" style={{ gap: 16 }}>
          <h2>Earn 30% for every creator you refer</h2>
          <p className="muted">Share your code. You earn on the first payment and on each renewal while the subscriber stays.</p>
          <Link className="btn ghost" to="/affiliates" style={{ alignSelf: 'flex-start' }}>See the affiliate program</Link>
        </div>
      </section>
    </>
  );
}
