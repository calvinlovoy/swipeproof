import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { ToastContext } from '../lib/hooks';

const NAV: [to: string, label: string][] = [['/tools', 'Tools'], ['/blog', 'Blog'], ['/pricing', 'Pricing'], ['/affiliates', 'Affiliates'], ['/library', 'Library']];

function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <path pathLength={1} d="M6 21c4 0 5-10 9-10s4 6 6 6 3-2 5-2" fill="none" stroke="var(--accent-ink)" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="15" cy="11" r="2.4" fill="var(--accent-ink)" />
    </svg>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname, hash } = useLocation();
  const main = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState({ message: '', on: false });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback((message: string) => {
    setToast({ message, on: true });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast((t) => ({ ...t, on: false })), 2600);
  }, []);

  // On navigation: close the menu, then scroll to the hash target or the top and move focus to the page.
  useEffect(() => {
    setMenuOpen(false);
    const target = hash ? document.getElementById(hash.slice(1)) : null;
    if (target) target.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: 0, behavior: 'instant' });
    main.current?.focus({ preventScroll: true });
  }, [pathname, hash]);

  return (
    <ToastContext.Provider value={showToast}>
      <button className="skip btn" type="button" onClick={() => { main.current?.focus(); main.current?.scrollIntoView(); }}>Skip to content</button>
      <header className="site">
        <div className="wrap bar-top">
          <Link className="brand" to="/" aria-label="Swipeproof home"><Logo />Swipeproof</Link>
          <button className="menu-btn" type="button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="nav" onClick={() => setMenuOpen((o) => !o)}>
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M3 6h16M3 11h16M3 16h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <nav className={`main${menuOpen ? ' open' : ''}`} id="nav" aria-label="Main">
            <ul>
              {NAV.map(([to, label]) => <li key={to}><NavLink to={to}>{label}</NavLink></li>)}
              <li><Link className="btn" to="/get-started">Get started</Link></li>
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} ref={main}>{children}</main>
      <footer className="site">
        <div className="wrap grid">
          <div className="stack">
            <Link className="brand" to="/">Swipeproof</Link>
            <p>Scores for short-form video, with a specific change for every weak moment.</p>
          </div>
          <div><h3>Product</h3><ul><li><Link to="/#how">How it works</Link></li><li><Link to="/tools">Tools</Link></li><li><Link to="/pricing">Pricing</Link></li><li><Link to="/get-started">Get started</Link></li></ul></div>
          <div><h3>Resources</h3><ul><li><Link to="/blog">Blog</Link></li><li><Link to="/#faq">Questions</Link></li><li><Link to="/contact">Contact</Link></li><li><Link to="/about">About and what is simulated</Link></li></ul></div>
          <div><h3>Legal</h3><ul><li><Link to="/legal#privacy">Privacy</Link></li><li><Link to="/legal#terms">Terms</Link></li><li><Link to="/legal#cookies">Cookies</Link></li><li><Link to="/legal#gdpr">GDPR</Link></li></ul></div>
        </div>
      </footer>
      <div id="toast" role="status" aria-live="polite" className={toast.on ? 'on' : ''}>{toast.message}</div>
    </ToastContext.Provider>
  );
}
