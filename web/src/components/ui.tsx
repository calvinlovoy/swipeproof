import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ApiError, ToolId } from '../lib/api';
import { useContent } from '../lib/hooks';

export const toolPath = (id: ToolId | string) => `/tools/${id}`;

export function Crumbs({ trail }: { trail: [label: string, to?: string][] }) {
  return (
    <nav className="crumbs wrap" aria-label="Breadcrumb">
      <Link to="/">Home</Link>
      {trail.map(([label, to]) => (
        <span key={label} style={{ display: 'contents' }}>
          <span aria-hidden="true">/</span>
          {to ? <Link to={to}>{label}</Link> : <span>{label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="wrap page-h">
      <h1>{title}</h1>
      {children && <p className="lede">{children}</p>}
    </div>
  );
}

interface FieldProps {
  id: string;
  label: ReactNode;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  type?: 'text' | 'email' | 'url' | 'password';
  rows?: number;
  options?: readonly (readonly [value: string, label: string])[];
  placeholder?: string;
  autoComplete?: string;
  maxLength?: number;
}

/** A labelled input, textarea (when `rows` is set) or select (when `options` is set) with its error line. */
export function Field({ id, label, value, error = '', onChange, hint, type = 'text', rows, options, ...rest }: FieldProps) {
  const shared = { id, name: id, value, 'aria-invalid': !!error, 'aria-describedby': `${id}-err` };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {options ? (
        <select {...shared} onChange={(e) => onChange(e.target.value)}>
          {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
        </select>
      ) : rows ? (
        <textarea {...shared} {...rest} rows={rows} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...shared} {...rest} type={type} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <p className="hint">{hint}</p>}
      <p className="err" id={`${id}-err`} role="alert">{error}</p>
    </div>
  );
}

export function FormError({ message }: { message: string }) {
  return message ? <p className="err" role="alert">{message}</p> : null;
}

/** Loading and error states for a page that waits on the API. */
export function Status({ loading, error, retry }: { loading: boolean; error: ApiError | null; retry?: () => void }) {
  if (error) {
    return (
      <div className="wrap stack" role="alert" style={{ padding: '32px 20px', alignItems: 'flex-start' }}>
        <p className="notice">{error.message}</p>
        {retry && <button className="btn ghost" type="button" onClick={retry}>Try again</button>}
      </div>
    );
  }
  return loading ? <p className="wrap muted" role="status" style={{ padding: '32px 20px' }}>Loading...</p> : null;
}

export function ToolCards({ skip }: { skip?: ToolId }) {
  const { tools } = useContent();
  return (
    <div className="grid">
      {tools.filter((t) => t.id !== skip).map((t) => (
        <div className="card" key={t.id}>
          <h3>{t.name}</h3>
          <p className="muted">{t.desc}</p>
          <Link className="btn ghost" to={toolPath(t.id)} style={{ marginTop: 'auto', alignSelf: 'flex-start' }}>{t.cta}</Link>
        </div>
      ))}
    </div>
  );
}

export function RelatedTools({ skip }: { skip: ToolId }) {
  return (
    <section className="band wrap stack">
      <h2>Other tools</h2>
      <ToolCards skip={skip} />
    </section>
  );
}

export function PlanCards() {
  const { plans } = useContent();
  const navigate = useNavigate();
  return (
    <div className="grid">
      {plans.map((p) => (
        <div className={`card plan${p.recommended ? ' pop' : ''}`} key={p.id}>
          {p.recommended && <span className="chip" style={{ alignSelf: 'flex-start' }}>Recommended</span>}
          <h3>{p.name}</h3>
          <p className="muted small">{p.who}</p>
          <p className="price">${p.price}<small> / month</small></p>
          <ul className="ticklist stack" style={{ gap: 6 }}>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
          <button className={`btn${p.recommended ? '' : ' ghost'}`} type="button" style={{ marginTop: 'auto' }} onClick={() => navigate(`/checkout?plan=${p.id}`)}>
            Choose {p.name}
          </button>
        </div>
      ))}
    </div>
  );
}

export function Faq() {
  const { faq } = useContent();
  return <div>{faq.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}</div>;
}

export function Explainers({ title, items }: { title: string; items: [heading: string, body: string][] }) {
  return (
    <section className="band wrap stack">
      <h2>{title}</h2>
      <div className="grid">{items.map(([h, b]) => <div className="card" key={h}><h3>{h}</h3><p className="muted">{b}</p></div>)}</div>
    </section>
  );
}
