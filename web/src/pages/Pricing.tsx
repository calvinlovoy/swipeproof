import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { checkoutRules } from '@shared/validate';
import { Crumbs, Faq, Field, FormError, PageHead, PlanCards } from '../components/ui';
import { api } from '../lib/api';
import { useContent, useForm } from '../lib/hooks';

export function Pricing() {
  return (
    <>
      <Crumbs trail={[['Pricing']]} />
      <PageHead title="Pricing">Three tiers. Payments are not wired up yet, so choosing one walks through checkout without charging anything.</PageHead>
      <div className="wrap stack" style={{ gap: 28 }}>
        <PlanCards />
        <div className="card">
          <h3>Need more than five seats?</h3>
          <p className="muted">Tell us about your team and we will size a plan.</p>
          <Link className="btn ghost" to="/contact" style={{ alignSelf: 'flex-start' }}>Contact us</Link>
        </div>
        <h2>Questions</h2>
        <Faq />
      </div>
    </>
  );
}

export function Checkout() {
  const { plans } = useContent();
  const [params] = useSearchParams();
  const wanted = params.get('plan') ?? '';
  const initial = plans.some((p) => p.id === wanted) ? wanted : (plans.find((p) => p.recommended) ?? plans[0]).id;
  const form = useForm('co', { plan: initial, name: '', email: '' }, checkoutRules);
  const [done, setDone] = useState<string | null>(null);
  const success = useRef<HTMLDivElement>(null);
  useEffect(() => { if (done) success.current?.focus(); }, [done]);

  const send = () => form.submit(async (v) => {
    const out = await api.checkout(v);
    setDone(plans.find((p) => p.id === out.plan)?.name ?? out.plan);
  });

  return (
    <>
      <Crumbs trail={[['Pricing', '/pricing'], ['Checkout']]} />
      <PageHead title="Checkout">No card is requested and no payment is taken. Your plan choice is recorded so the flow can be tested end to end.</PageHead>
      <div className="wrap">
        <div className="card stack" style={{ maxWidth: 560 }}>
          {done ? (
            <>
              <div className="success stack" tabIndex={-1} ref={success}>
                <h2 style={{ fontSize: '1.5rem' }}>{done} plan started</h2>
                <p>No payment was taken.</p>
              </div>
              <div className="row"><Link className="btn" to="/tools/video">Analyze a video</Link><Link className="btn ghost" to="/library">Open library</Link></div>
            </>
          ) : (
            <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <Field {...form.field('plan')} label="Plan" options={plans.map((p) => [p.id, `${p.name}, $${p.price} a month`] as const)} />
              <Field {...form.field('name')} label="Your name" autoComplete="name" />
              <Field {...form.field('email')} label="Email" type="email" autoComplete="email" />
              <FormError message={form.formError} />
              <button className="btn" type="submit" disabled={form.busy} style={{ alignSelf: 'flex-start' }}>{form.busy ? 'Starting...' : 'Start plan'}</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
