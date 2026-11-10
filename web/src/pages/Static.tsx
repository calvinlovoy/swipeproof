import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { affiliateRules, contactRules, DEVICES, TOPICS, waitlistRules } from '@shared/validate';
import { Crumbs, Field, FormError, PageHead, Status } from '../components/ui';
import { api } from '../lib/api';
import { useAsync, useContent, useForm, useToast } from '../lib/hooks';

export function NotFound({ message = 'That address does not match a page.' }: { message?: string }) {
  return (
    <>
      <PageHead title="Page not found">{message}</PageHead>
      <div className="wrap row"><Link className="btn" to="/">Go home</Link><Link className="btn ghost" to="/tools">Open the tools</Link></div>
    </>
  );
}

export function PlatformGuide() {
  const { id } = useParams();
  const { platforms } = useContent();
  const p = platforms.find((x) => x.id === id);
  if (!p) return <NotFound />;
  return (
    <>
      <Crumbs trail={[[p.name]]} />
      <PageHead title={`Swipeproof for ${p.name}`}>{p.line}</PageHead>
      <div className="wrap stack" style={{ gap: 28 }}>
        <div className="grid">
          {p.tips.map((t, i) => <div className="card" key={t.title}><span className="step-n">TIP {i + 1}</span><h3>{t.title}</h3><p className="muted">{t.body}</p></div>)}
        </div>
        <div className="card lift" style={{ alignItems: 'flex-start' }}>
          <h2>Check a {p.name} video before you post</h2>
          <p className="muted">Upload the export and get a score with timestamped fixes.</p>
          <Link className="btn" to="/tools/video">Analyze a video</Link>
        </div>
        <div className="row"><span className="muted">Other guides:</span>{platforms.filter((x) => x.id !== p.id).map((x) => <Link key={x.id} to={`/for/${x.id}`}>{x.name}</Link>)}</div>
      </div>
    </>
  );
}

export function GetStarted() {
  const toast = useToast();
  const me = useAsync(api.me, []);
  const form = useForm('wl', { email: '', device: DEVICES[0] as string }, waitlistRules);
  const joined = me.data?.waitlist ?? null;
  const join = () => form.submit(async (v) => { const out = await api.joinWaitlist(v); me.setData({ ...me.data!, waitlist: out.device }); toast('Added to the list'); });
  const leave = async () => { await api.leaveWaitlist().catch(() => toast('Could not update the list. Try again.')); me.reload(); };
  return (
    <>
      <Crumbs trail={[['Get started']]} />
      <PageHead title="Get started">Swipeproof runs in the browser today. Phone apps are not built yet.</PageHead>
      <div className="wrap grid">
        <div className="card lift">
          <span className="chip good" style={{ alignSelf: 'flex-start' }}>Available now</span>
          <h3>Use it in your browser</h3>
          <p className="muted">No install and no account. Reports save to your library.</p>
          <Link className="btn" to="/tools/video" style={{ marginTop: 'auto', alignSelf: 'flex-start' }}>Open the video analyzer</Link>
        </div>
        <div className="card">
          <span className="chip warn" style={{ alignSelf: 'flex-start' }}>Not built yet</span>
          <h3>iPhone and Android apps</h3>
          {!me.data ? <Status loading={me.loading} error={me.error} retry={me.reload} /> : joined ? (
            <>
              <div className="success"><b>You are on the {joined} list.</b><p>We will write when the app is ready.</p></div>
              <button type="button" className="btn quiet" style={{ alignSelf: 'flex-start' }} onClick={leave}>Leave the list</button>
            </>
          ) : (
            <>
              <p className="muted">Leave an email and the device you use to join the list.</p>
              <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void join(); }}>
                <Field {...form.field('email')} label="Email" type="email" autoComplete="email" />
                <Field {...form.field('device')} label="Device" options={DEVICES.map((d) => [d, d] as const)} />
                <FormError message={form.formError} />
                <button className="btn ghost" type="submit" disabled={form.busy} style={{ alignSelf: 'flex-start' }}>Join the list</button>
              </form>
            </>
          )}
        </div>
      </div>
    </>
  );
}

const AFFILIATE_STEPS: [string, string][] = [
  ['Create your code', 'Fill in the form above. Your code appears right away.'],
  ['Share it', 'Mention it in videos or put it in your bio.'],
  ['They subscribe', 'Your code is entered at checkout and tracked for 30 days after a click.'],
  ['Get paid', 'Earnings are paid monthly while each subscriber stays.'],
];

export function Affiliates() {
  const { plans } = useContent();
  const toast = useToast();
  const me = useAsync(api.me, []);
  const [referrals, setReferrals] = useState(20);
  const [planId, setPlanId] = useState(() => (plans.find((p) => p.recommended) ?? plans[0]).id);
  const form = useForm('aff', { name: '', email: '', channel: '' }, affiliateRules);
  const price = plans.find((p) => p.id === planId)?.price ?? 0;
  const code = me.data?.affiliateCode ?? null;

  const join = () => form.submit(async (v) => { const out = await api.joinAffiliates(v); me.setData({ ...me.data!, affiliateCode: out.code }); toast('Code created'); });
  const leave = async () => { await api.leaveAffiliates().catch(() => toast('Could not remove the code. Try again.')); me.reload(); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(code ?? ''); toast('Code copied'); }
    catch { toast('Copy was blocked. Select the code to copy it.'); }
  };

  return (
    <>
      <Crumbs trail={[['Affiliates']]} />
      <PageHead title="Earn 30% on every referral">You earn on the first payment and on every renewal while the subscriber stays. Payouts are monthly with no minimum.</PageHead>
      <div className="wrap stack" style={{ gap: 28 }}>
        <div className="grid">
          <div className="card stack">
            <h2 style={{ fontSize: '1.5rem' }}>Estimate your earnings</h2>
            <div className="field">
              <label htmlFor="refs">Active referrals: <span className="tc">{referrals}</span></label>
              <input type="range" id="refs" min={1} max={200} value={referrals} onChange={(e) => setReferrals(Number(e.target.value))} />
            </div>
            <Field id="aplan" label="Plan they choose" value={planId} onChange={setPlanId} options={plans.map((p) => [p.id, `${p.name}, $${p.price} a month`] as const)} />
            <p>You would earn <b className="tc" id="earn" style={{ fontSize: '1.4rem' }}>${(referrals * price * 0.3).toFixed(2)}</b> a month.</p>
            <p className="hint">30% of each subscription. An estimate, since referrals can cancel.</p>
          </div>
          <div className="card stack">
            <h2 style={{ fontSize: '1.5rem' }}>Get your code</h2>
            {!me.data ? <Status loading={me.loading} error={me.error} retry={me.reload} /> : code ? (
              <>
                <div className="success stack">
                  <p>Your creator code</p>
                  <p className="tc" id="acode" style={{ fontSize: '1.6rem', fontWeight: 500 }}>{code}</p>
                  <p>Tracking and payouts are not connected yet, so this code does not earn.</p>
                </div>
                <div className="row">
                  <button type="button" className="btn" onClick={copy}>Copy code</button>
                  <button type="button" className="btn quiet" onClick={leave}>Remove code</button>
                </div>
              </>
            ) : (
              <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void join(); }}>
                <Field {...form.field('name')} label="Name" autoComplete="name" />
                <Field {...form.field('email')} label="Email" type="email" autoComplete="email" />
                <Field {...form.field('channel')} label="Link to your channel" type="url" placeholder="https://" />
                <FormError message={form.formError} />
                <button className="btn" type="submit" disabled={form.busy} style={{ alignSelf: 'flex-start' }}>Create my code</button>
              </form>
            )}
          </div>
        </div>
        <h2>How it works</h2>
        <ol className="grid">
          {AFFILIATE_STEPS.map(([h, b], i) => <li className="card" key={h}><span className="step-n">STEP {i + 1}</span><h3>{h}</h3><p className="muted">{b}</p></li>)}
        </ol>
      </div>
    </>
  );
}

export function About() {
  return (
    <>
      <Crumbs trail={[['About']]} />
      <PageHead title="About Swipeproof">Swipeproof reviews short-form video before you post it. This build is an early version, so some parts are placeholders. Here is which is which.</PageHead>
      <div className="wrap grid">
        <div className="card">
          <h3>What runs for real</h3>
          <ul className="ticklist stack" style={{ gap: 6 }}>
            <li>Hook scoring and the tightened rewrite</li>
            <li>Script scoring, timecodes and the pacing map</li>
            <li>Uploaded video checks: frames are sampled in your browser for motion, cuts, brightness, format and length</li>
            <li>The report library, article search and every form, all stored in a database</li>
          </ul>
        </div>
        <div className="card">
          <h3>What is simulated</h3>
          <ul className="stack" style={{ gap: 6 }}>
            <li>Reports from a pasted link use example findings until link analysis is built</li>
            <li>Checkout records a plan and charges nothing</li>
            <li>Affiliate codes are issued but do not track or pay</li>
            <li>Contact and waiting list entries are stored but no email is sent</li>
            <li>Audio and speech are not analyzed</li>
          </ul>
        </div>
        <div className="card">
          <h3>How scores are made</h3>
          <p className="muted">Scores come from fixed rules you can read on each tool page. They are a second opinion on structure and format. They do not predict views.</p>
          <Link to="/contact">Ask a question</Link>
        </div>
      </div>
    </>
  );
}

export function Contact() {
  const form = useForm('ct', { name: '', email: '', topic: TOPICS[0] as string, message: '' }, contactRules);
  const [sentTopic, setSentTopic] = useState<string | null>(null);
  const success = useRef<HTMLDivElement>(null);
  useEffect(() => { if (sentTopic) success.current?.focus(); }, [sentTopic]);
  const labels: Record<string, string> = { Support: 'Help with a report', 'Team plan': 'Team or agency plan', Feature: 'Feature request', Other: 'Something else' };
  const send = () => form.submit(async (v) => { setSentTopic((await api.contact(v)).topic); });
  return (
    <>
      <Crumbs trail={[['Contact']]} />
      <PageHead title="Contact">Questions, feedback or a team plan.</PageHead>
      <div className="wrap">
        <div className="card stack" style={{ maxWidth: 620 }}>
          {sentTopic ? (
            <>
              <div className="success stack" tabIndex={-1} ref={success}>
                <h2 style={{ fontSize: '1.5rem' }}>Message received</h2>
                <p>Topic: {labels[sentTopic] ?? sentTopic}. It is stored for the team to read. Email replies are not set up yet.</p>
              </div>
              <Link className="btn ghost" to="/" style={{ alignSelf: 'flex-start' }}>Back to home</Link>
            </>
          ) : (
            <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <Field {...form.field('name')} label="Name" autoComplete="name" />
              <Field {...form.field('email')} label="Email" type="email" autoComplete="email" />
              <Field {...form.field('topic')} label="Topic" options={TOPICS.map((t) => [t, labels[t]] as const)} />
              <Field {...form.field('message')} label="Message" rows={5} maxLength={2000} />
              <FormError message={form.formError} />
              <button className="btn" type="submit" disabled={form.busy} style={{ alignSelf: 'flex-start' }}>{form.busy ? 'Sending...' : 'Send message'}</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

const LEGAL: [id: string, heading: string, body: string][] = [
  ['privacy', 'Privacy', 'This build stores the reports you run and the forms you submit in its database, linked to a random id kept in your browser. Video files you upload are read in your browser and are not sent to the server. Only the resulting scores are saved.'],
  ['terms', 'Terms', 'Swipeproof is an early build provided with no warranty. Scores are guidance on structure and format and are not a promise of reach or views. Plans shown are placeholders and cannot be purchased yet.'],
  ['cookies', 'Cookies', 'This site sets no cookies and loads no analytics or advertising trackers. It uses browser storage to keep your drafts and the random id that links you to your reports.'],
  ['gdpr', 'GDPR', 'You can delete your reports at any time from the library. To have form entries removed, send a request through the contact page. A full data access and erasure process will be in place before launch.'],
];

export function Legal() {
  return (
    <>
      <Crumbs trail={[['Legal']]} />
      <PageHead title="Legal">Plain statements about how this build handles your data. Draft text, pending legal review.</PageHead>
      <div className="wrap stack" style={{ gap: 18 }}>
        {LEGAL.map(([id, heading, body]) => <section className="card" id={id} key={id}><h2 style={{ fontSize: '1.5rem' }}>{heading}</h2><p>{body}</p></section>)}
      </div>
    </>
  );
}
