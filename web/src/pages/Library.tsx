import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { band, type ReportType } from '@shared/engine';
import { REPORT_LABEL, ReportView } from '../components/Report';
import { Crumbs, PageHead, Status, toolPath } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, useAsync, useAuth, useContent, useToast } from '../lib/hooks';
import { NotFound } from './Static';

const FILTERS: [key: 'all' | ReportType, label: string][] = [['all', 'All'], ['video', 'Videos'], ['hook', 'Hooks'], ['script', 'Scripts']];

export function Library() {
  const { tools, plans } = useContent();
  const toast = useToast();
  const { user } = useAuth();
  const reports = useAsync(api.reports.list, [user?.id]);
  const me = useAsync(api.me, []);
  const [filter, setFilter] = useState<'all' | ReportType>('all');
  const [armed, setArmed] = useState<string | null>(null);

  const all = reports.data ?? [];
  const shown = all.filter((r) => filter === 'all' || r.type === filter);
  const plan = plans.find((p) => p.id === me.data?.plan);
  const danger = { borderColor: 'var(--bad)', color: 'var(--bad)' };

  const remove = async (id: string) => {
    if (armed !== id) { setArmed(id); return; }
    try { await api.reports.remove(id); reports.setData(all.filter((r) => r.id !== id)); toast('Report deleted'); }
    catch { toast('Could not delete that report. Try again.'); }
    setArmed(null);
  };
  const clear = async () => {
    if (armed !== 'all') { setArmed('all'); return; }
    try { await api.reports.clear(); reports.setData([]); toast('Library cleared'); }
    catch { toast('Could not clear the library. Try again.'); }
    setArmed(null);
  };

  return (
    <>
      <Crumbs trail={[['Library']]} />
      <PageHead title="Your library">Every report you run is kept here.{plan && <> Plan: <b>{plan.name}</b>.</>}</PageHead>
      {reports.loading || reports.error ? <Status loading={reports.loading} error={reports.error} retry={reports.reload} /> : (
        <div className="wrap stack" style={{ gap: 18 }}>
          {user && all.some((r) => r.traits) && <p className="hint">Ran these as ads? <Link to="/results">Add the results</Link> to see which measurements tracked with performance.</p>}
          {!user && <p className="notice">These reports are tied to this browser. <Link to="/signup?next=/library">Create an account</Link> to keep them and reach them from any device.</p>}
          <div className="row" role="group" aria-label="Filter reports">
            {FILTERS.map(([key, label]) => (
              <button type="button" className="chip" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {label} <span className="tc">{key === 'all' ? all.length : all.filter((r) => r.type === key).length}</span>
              </button>
            ))}
          </div>
          {shown.length ? (
            <>
              <ul className="lib stack" style={{ gap: 10 }}>
                {shown.map((r) => {
                  const [label, tone] = band(r.score);
                  return (
                    <li key={r.id}>
                      <span className={`sc ${tone}`}>{r.score}</span>
                      <div className="stack" style={{ gap: 4 }}>
                        <Link to={`/reports/${r.id}`}>{r.title}</Link>
                        <span className="small muted">{REPORT_LABEL[r.type]}{r.sim ? ', simulated' : ''} · {formatDate(r.createdAt)} · <span className={tone}>{label}</span></span>
                      </div>
                      <div className="row acts">
                        <Link className="btn quiet" to={`/reports/${r.id}`}>Open</Link>
                        <button type="button" className="btn quiet" style={armed === r.id ? danger : undefined} onClick={() => remove(r.id)}>{armed === r.id ? 'Confirm delete' : 'Delete'}</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="btn quiet" style={{ alignSelf: 'flex-start', ...(armed === 'all' ? danger : {}) }} onClick={clear}>
                {armed === 'all' ? 'Confirm: delete every report' : 'Delete all reports'}
              </button>
            </>
          ) : (
            <div className="card" style={{ alignItems: 'flex-start' }}>
              <h3>{all.length ? 'No reports of this type yet' : 'No reports yet'}</h3>
              <p className="muted">Run any tool and the report appears here.</p>
              <div className="row">{tools.map((t) => <Link className="btn ghost" key={t.id} to={toolPath(t.id)}>{t.cta}</Link>)}</div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function ReportPage() {
  const { id = '' } = useParams();
  const report = useAsync(() => api.reports.get(id), [id]);
  if (report.error?.status === 404) return <NotFound message={report.error.message} />;
  return (
    <>
      <Crumbs trail={[['Library', '/library'], ['Report']]} />
      {report.data ? (
        <div className="wrap stack" style={{ paddingTop: 8 }}>
          <ReportView report={report.data} />
          <p className="hint">Run on {formatDate(report.data.createdAt)}.</p>
        </div>
      ) : <Status loading={report.loading} error={report.error} retry={report.reload} />}
    </>
  );
}
