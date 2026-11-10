import { createContext, useCallback, useContext, useEffect, useRef, useState, type DependencyList } from 'react';
import { hasErrors, validate, type Errors, type Rules } from '@shared/validate';
import { ApiError, type Content } from './api';

export const ContentContext = createContext<Content | null>(null);
export function useContent(): Content {
  const c = useContext(ContentContext);
  if (!c) throw new Error('Content is not loaded yet');
  return c;
}

export const ToastContext = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

/** Runs an async loader and tracks its state. `reload` runs it again. */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
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
