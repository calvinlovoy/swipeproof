import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { loginRules, signupRules } from '@shared/validate';
import { Crumbs, Field, FormError, PageHead } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDate, useAsync, useAuth, useContent, useForm, useToast } from '../lib/hooks';

/** Where to go after signing in. Only paths inside this site are accepted. */
function useNext(fallback = '/library'): string {
  const next = useSearchParams()[0].get('next') ?? '';
  return next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

export function Signup() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const next = useNext();
  const form = useForm('su', { name: '', email: '', password: '' }, signupRules);
  const send = () => form.submit(async (v) => {
    setUser((await api.auth.signup(v)).user);
    toast('Account created');
    navigate(next);
  });
  return (
    <>
      <Crumbs trail={[['Create account']]} />
      <PageHead title="Create your account">Keep your reports, reach them from any device and run full video analyses.</PageHead>
      <div className="wrap">
        <div className="card stack" style={{ maxWidth: 520 }}>
          {user ? <SignedIn email={user.email} /> : (
            <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <Field {...form.field('name')} label={<>Name <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></>} autoComplete="name" maxLength={80} />
              <Field {...form.field('email')} label="Email" type="email" autoComplete="email" />
              <Field {...form.field('password')} label="Password" type="password" autoComplete="new-password" hint="At least 10 characters. A few random words work well." />
              <FormError message={form.formError} />
              <button className="btn" type="submit" disabled={form.busy} style={{ alignSelf: 'flex-start' }}>{form.busy ? 'Creating...' : 'Create account'}</button>
              <p className="small muted">Reports you already ran in this browser move into your account. Already have one? <Link to={`/login?next=${encodeURIComponent(next)}`}>Log in</Link>.</p>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

export function Login() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const next = useNext();
  const form = useForm('li', { email: '', password: '' }, loginRules);
  const send = () => form.submit(async (v) => {
    setUser((await api.auth.login(v)).user);
    navigate(next);
  });
  return (
    <>
      <Crumbs trail={[['Log in']]} />
      <PageHead title="Log in" />
      <div className="wrap">
        <div className="card stack" style={{ maxWidth: 520 }}>
          {user ? <SignedIn email={user.email} /> : (
            <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <Field {...form.field('email')} label="Email" type="email" autoComplete="email" />
              <Field {...form.field('password')} label="Password" type="password" autoComplete="current-password" />
              <FormError message={form.formError} />
              <button className="btn" type="submit" disabled={form.busy} style={{ alignSelf: 'flex-start' }}>{form.busy ? 'Logging in...' : 'Log in'}</button>
              <p className="small muted">New here? <Link to={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link>. Forgot your password? Reset by email is not set up yet, so <Link to="/contact">contact us</Link>.</p>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

function SignedIn({ email }: { email: string }) {
  return (
    <>
      <p>You are logged in as <b>{email}</b>.</p>
      <div className="row"><Link className="btn" to="/library">Open library</Link><Link className="btn ghost" to="/account">Account</Link></div>
    </>
  );
}

export function Account() {
  const { user, setUser } = useAuth();
  const { plans } = useContent();
  const navigate = useNavigate();
  const toast = useToast();
  const me = useAsync(api.me, [user?.id]);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) {
    return (
      <>
        <PageHead title="Account">Log in to see your account.</PageHead>
        <div className="wrap row"><Link className="btn" to="/login?next=/account">Log in</Link><Link className="btn ghost" to="/signup?next=/account">Create an account</Link></div>
      </>
    );
  }
  const plan = plans.find((p) => p.id === me.data?.plan);
  const logout = async () => {
    await api.auth.logout().catch(() => {});
    setUser(null);
    toast('Logged out');
    navigate('/');
  };
  const remove = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) { setError('Enter your password to confirm.'); document.getElementById('del-password')?.focus(); return; }
    setBusy(true); setError('');
    try {
      await api.auth.deleteAccount(password);
      setUser(null);
      toast('Account deleted');
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.password ?? err.message : 'Something went wrong. Try again.');
    } finally { setBusy(false); }
  };

  return (
    <>
      <Crumbs trail={[['Account']]} />
      <PageHead title="Account" />
      <div className="wrap grid">
        <div className="card">
          <h3>Your details</h3>
          <ul className="meta" style={{ flexDirection: 'column', gap: 6 }}>
            <li>Email <b>{user.email}</b></li>
            {user.name && <li>Name <b>{user.name}</b></li>}
            <li>Member since <b>{formatDate(user.createdAt)}</b></li>
            <li>Plan <b>{plan ? plan.name : 'Free'}</b></li>
          </ul>
          <div className="row" style={{ marginTop: 'auto' }}>
            <Link className="btn ghost" to="/library">Open library</Link>
            <Link className="btn ghost" to="/results">Results</Link>
            <button type="button" className="btn quiet" onClick={logout}>Log out</button>
          </div>
        </div>
        <div className="card">
          <h3>Delete account</h3>
          <p className="muted">Removes your account, every report saved to it and any ad results you added. This cannot be undone.</p>
          {confirming ? (
            <form className="stack" noValidate onSubmit={remove}>
              <Field id="del-password" label="Your password" type="password" autoComplete="current-password" value={password} error={error} onChange={(v) => { setPassword(v); setError(''); }} />
              <div className="row">
                <button type="submit" className="btn quiet" disabled={busy} style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>{busy ? 'Deleting...' : 'Delete my account'}</button>
                <button type="button" className="btn quiet" onClick={() => { setConfirming(false); setPassword(''); setError(''); }}>Cancel</button>
              </div>
            </form>
          ) : <button type="button" className="btn quiet" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirming(true)}>Delete account</button>}
        </div>
      </div>
    </>
  );
}
