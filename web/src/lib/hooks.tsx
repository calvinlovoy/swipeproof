import { createContext, useCallback, useContext, useEffect, useRef, useState, type DependencyList } from 'react';
import type { PageMeta } from '@shared/seo';
import { hasErrors, validate, type Errors, type Rules } from '@shared/validate';
import { ApiError, type Capabilities, type Content, type User } from './api';

export const ContentContext = createContext<Content | null>(null);
export function useContent(): Content {
  const c = useContext(ContentContext);
  if (!c) throw new Error('Content is not loaded yet');
  return c;
}

export const AuthContext = createContext<{ user: User | null; setUser: (user: User | null) => void }>({ user: null, setUser: () => {} });
export const useAuth = () => useContext(AuthContext);

const NO_CAPABILITIES: Capabilities = { fullAnalysis: false, transcription: false, feedback: false, demo: false, maxUploadMb: 200, maxSeconds: 300, dailyLimit: 20 };
export const CapabilitiesContext = createContext<Capabilities>(NO_CAPABILITIES);
export const useCapabilities = () => useContext(CapabilitiesContext);

export const ToastContext = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

/** Runs an async loader and tracks its state. `reload` runs it again. `initial` skips the first load. */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList, initial?: T) {
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: initial ?? null, error: null, loading: initial === undefined });
  const [tick, setTick] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    const skip = first.current && initial !== undefined;
    first.current = false;
    if (skip) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    load().then(
      (data) => { if (live) setState({ data, error: null, loading: false }); },
      (e: unknown) => { if (live) setState({ data: null, error: e instanceof ApiError ? e : new ApiError(0, 'Something went wrong. Try again.'), loading: false }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((data: T) => setState({ data, error: null, loading: false }), []);
  return { ...state, reload, setData };
}

/** Form state with shared validation rules. Field ids are `${prefix}-${key}` so the first invalid one can take focus. */
export function useForm<K extends string>(prefix: string, initial: Record<K, string>, rules: Rules) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const fail = (e: Errors) => {
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) document.getElementById(`${prefix}-${first}`)?.focus();
  };
  const field = (key: K) => ({
    id: `${prefix}-${key}`,
    value: values[key],
    error: errors[key] ?? '',
    onChange: (v: string) => {
      setValues((s) => ({ ...s, [key]: v }));
      if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
    },
  });
  const submit = async (send: (v: Record<K, string>) => Promise<void>) => {
    const { errors: found } = validate(values, rules);
    if (hasErrors(found)) { fail(found); return; }
    setBusy(true);
    setFormError('');
    try { await send(values); }
    catch (e) {
      if (e instanceof ApiError && hasErrors(e.errors)) fail(e.errors);
      else setFormError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally { setBusy(false); }
  };
  return { values, setValues, errors, setErrors: fail, formError, busy, field, submit };
}

/** A text draft kept in this browser between visits. */
export function useDraft(key: string, fallback = ''): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    try { return localStorage.getItem(`sp:${key}`) ?? fallback; } catch { return fallback; }
  });
  const set = useCallback((v: string) => {
    setValue(v);
    try { localStorage.setItem(`sp:${key}`, v); } catch { /* storage unavailable */ }
  }, [key]);
  return [value, set];
}

function setTag(selector: string, create: () => HTMLElement, attribute: string, value: string | null) {
  let tag = document.head.querySelector<HTMLElement>(selector);
  if (value === null) { tag?.remove(); return; }
  if (!tag) { tag = create(); document.head.appendChild(tag); }
  tag.setAttribute(attribute, value);
}
const metaTag = (key: 'name' | 'property', id: string) => () => { const m = document.createElement('meta'); m.setAttribute(key, id); return m; };

/**
 * Keeps the title, description, canonical link and robots tag in step with the page on screen.
 * The server writes the same tags into the first response. This covers every later navigation.
 */
export function useHead(meta: PageMeta | null) {
  const key = meta ? `${meta.path}|${meta.title}|${meta.index}|${meta.status}` : '';
  useEffect(() => {
    if (!meta) return;
    const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    // The server knows the site's public address. Reuse it when it is on the page.
    const base = canonical?.href ? new URL(canonical.href).origin : window.location.origin;
    const url = base + (meta.path === '/' ? '/' : meta.path);
    document.title = meta.title;
    setTag('meta[name="description"]', metaTag('name', 'description'), 'content', meta.description);
    setTag('link[rel="canonical"]', () => { const l = document.createElement('link'); l.rel = 'canonical'; return l; }, 'href', meta.status === 200 ? url : null);
    setTag('meta[name="robots"]', metaTag('name', 'robots'), 'content', meta.index ? null : 'noindex');
    setTag('meta[property="og:title"]', metaTag('property', 'og:title'), 'content', meta.title);
    setTag('meta[property="og:description"]', metaTag('property', 'og:description'), 'content', meta.description);
    setTag('meta[property="og:url"]', metaTag('property', 'og:url'), 'content', url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts a number up from zero once, unless the viewer prefers reduced motion. */
export function useCountUp(target: number): number {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? target : 0));
  const frame = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion()) { setShown(target); return; }
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 900);
      setShown(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target]);
  return shown;
}

export const formatDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
