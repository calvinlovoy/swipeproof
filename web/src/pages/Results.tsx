import { useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import {
  autoMatch, COLUMN_LABELS, combineRows, detectColumns, OUTCOMES, outcomes, parseCsv, readRows,
  type ColumnKey, type OutcomeKey, type TraitPattern,
} from '@shared/results';
import { Crumbs, FormError, PageHead, Status } from '../components/ui';
import { api, ApiError, type ResultsPage } from '../lib/api';
import { useAsync, useAuth, useToast } from '../lib/hooks';

const OUTCOME_KEYS = Object.keys(OUTCOMES) as OutcomeKey[];
const COLUMN_KEYS = Object.keys(COLUMN_LABELS) as ColumnKey[];
const MAX_ROWS = 200;
const show = (key: OutcomeKey, v: number | undefined) =>
  v === undefined ? '' : OUTCOMES[key].unit === '%' ? `${v.toFixed(1)}%` : `$${v.toFixed(2)}`;

export function Results() {
  const { user } = useAuth();
  if (!user) {
    return (
      <>
        <Crumbs trail={[['Results']]} />
        <PageHead title="Results">Add how your videos performed as ads and see which measurements tracked with the numbers. Log in to start.</PageHead>
        <div className="wrap row"><Link className="btn" to="/login?next=/results">Log in</Link><Link className="btn ghost" to="/signup?next=/results">Create an account</Link></div>
      </>
    );
  }
  return <SignedIn />;
}

function SignedIn() {
  const page = useAsync(api.results.get, []);
  const reports = useAsync(api.reports.list, []);
  const videos = useMemo(() => (reports.data ?? []).filter((r) => r.type === 'video' && r.traits).map((r) => ({ id: r.id, title: r.title })), [reports.data]);

  return (
    <>
      <Crumbs trail={[['Results']]} />
      <PageHead title="Results">Add how your videos performed as ads. Swipeproof lines the numbers up with what it measured in each video and shows which measurements tracked with performance.</PageHead>
      {page.data && reports.data ? (
        <div className="wrap stack" style={{ gap: 28 }}>
          {videos.length ? <Upload videos={videos} onSaved={page.reload} /> : (
            <div className="card" style={{ alignItems: 'flex-start' }}>
              <h3>Run a full analysis first</h3>
              <p className="muted">Results attach to videos that have had a full analysis, because those carry the measurements. A video analyzed before pre-flight checks existed needs a new run.</p>
              <Link className="btn" to="/tools/video">Analyze a video</Link>
            </div>
          )}
          <Patterns page={page.data} />
          {page.data.videos.length > 0 && <Saved page={page.data} onCleared={page.reload} />}
        </div>
      ) : <Status loading={page.loading || reports.loading} error={page.error ?? reports.error} retry={() => { page.reload(); reports.reload(); }} />}
    </>
  );
}

function Upload({ videos, onSaved }: { videos: { id: string; title: string }[]; onSaved: () => void }) {
  const toast = useToast();
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [columns, setColumns] = useState<Partial<Record<ColumnKey, number>>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => (table ? combineRows(readRows(table, columns)).slice(0, MAX_ROWS) : []), [table, columns]);
  const auto = useMemo(() => autoMatch(rows, videos), [rows, videos]);
  const choice = (i: number) => picked[rows[i].adName] ?? auto[i] ?? '';
  const chosen = rows.map((_, i) => choice(i));
  const matched = chosen.filter(Boolean);
  const repeated = new Set(matched).size !== matched.length;

  const read = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(''); setTable(null); setPicked({});
    if (file.size > 5_000_000) { setError('That file is over 5 MB. Export fewer rows or a shorter date range.'); return; }
    const text = await file.text();
    const parsed = text.includes('\u0000') ? [] : parseCsv(text); // a NUL byte means a binary file, such as a spreadsheet
    if (parsed.length < 2 || parsed[0].length < 2) { setError('That file could not be read as a CSV with a header row and data rows. If it is a spreadsheet, export it as CSV first.'); return; }
    setFileName(file.name);
    setColumns(detectColumns(parsed[0]));
    setTable(parsed);
  };
  const setColumn = (key: ColumnKey, value: string) => {
    setColumns(({ [key]: _old, ...rest }) => (value === '' ? rest : { ...rest, [key]: Number(value) }));
  };
  const save = async () => {
    if (repeated) { setError('Two rows point at the same video. Give each video one row.'); return; }
    setBusy(true); setError('');
    try {
      const { saved } = await api.results.save(rows.map((r, i) => ({ reportId: chosen[i], adName: r.adName, metrics: r.metrics })).filter((r) => r.reportId));
      toast(`Results saved for ${saved} video${saved === 1 ? '' : 's'}`);
      setTable(null); setFileName('');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally { setBusy(false); }
  };

  return (
    <section className="card stack" aria-labelledby="up-h" style={{ gap: 16 }}>
      <h2 id="up-h" style={{ fontSize: '1.3rem' }}>Add results</h2>
      <p className="muted">Export a CSV from your ads manager with one row per ad. Name each ad after its video file and the rows match themselves. The file is read in your browser and only the rows you match are saved.</p>
      <label className="drop">
        <input type="file" accept=".csv,text/csv" onChange={read} aria-label="Choose a CSV file" />
        <b>{fileName || 'Choose a CSV file'}</b>
        <p className="hint">Columns it can use: impressions, 3-second plays, ThruPlays, link clicks, amount spent and results.</p>
      </label>
      <FormError message={error} />

      {table && (
        <>
          <div className="stack">
            <h3>Columns</h3>
            <div className="maps">
              {COLUMN_KEYS.map((key) => (
                <div className="field" key={key}>
                  <label htmlFor={`col-${key}`}>{COLUMN_LABELS[key]}</label>
                  <select id={`col-${key}`} value={columns[key] ?? ''} onChange={(e) => setColumn(key, e.target.value)}>
                    <option value="">Not in this file</option>
                    {table[0].map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {columns.name === undefined ? <p className="notice">Pick the column that holds the ad or video name.</p> : rows.length === 0 ? <p className="notice">No rows with a name and at least one number were found. Check the column choices above.</p> : (
            <div className="stack">
              <h3>Match rows to videos <span className="tc muted">{matched.length} of {rows.length} matched</span></h3>
              <div className="tablewrap">
                <table className="data">
                  <thead><tr><th>Ad name</th><th>Video</th>{OUTCOME_KEYS.map((k) => <th className="num" key={k}>{OUTCOMES[k].label}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const o = outcomes(r.metrics);
                      return (
                        <tr key={r.adName}>
                          <td style={{ overflowWrap: 'anywhere' }}>{r.adName}</td>
                          <td>
                            <select aria-label={`Video for ${r.adName}`} value={chosen[i]} onChange={(e) => setPicked((p) => ({ ...p, [r.adName]: e.target.value }))}>
                              <option value="">Skip this row</option>
                              {videos.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
                            </select>
                          </td>
                          {OUTCOME_KEYS.map((k) => <td className="num" key={k}>{show(k, o[k])}</td>)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="row">
                <button type="button" className="btn" disabled={busy || matched.length === 0} onClick={save}>{busy ? 'Saving...' : `Save ${matched.length} result${matched.length === 1 ? '' : 's'}`}</button>
                <button type="button" className="btn quiet" onClick={() => { setTable(null); setFileName(''); setError(''); }}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Patterns({ page }: { page: ResultsPage }) {
  const best = OUTCOME_KEYS.reduce((a, b) => (page.patterns[b].videos > page.patterns[a].videos ? b : a), OUTCOME_KEYS[0]);
  const [picked, setPicked] = useState<OutcomeKey | null>(null);
  const key = picked ?? best;
  const info = page.patterns[key];
  const outcome = OUTCOMES[key];
  const short = page.minVideos - info.videos;

  return (
    <section className="stack" aria-labelledby="pat-h" style={{ gap: 16 }}>
      <h2 id="pat-h" style={{ fontSize: '1.3rem' }}>What tracked with your results</h2>
      <div className="row" role="group" aria-label="Choose a result">
        {OUTCOME_KEYS.map((k) => (
          <button type="button" className="chip" key={k} aria-pressed={k === key} onClick={() => setPicked(k)}>
            {OUTCOMES[k].label} <span className="tc">{page.patterns[k].videos}</span>
          </button>
        ))}
      </div>
      {short > 0 ? (
        <p className="notice">{outcome.label} needs {outcome.needs}. {info.videos} of your videos {info.videos === 1 ? 'has' : 'have'} it so far. Add {short} more to see patterns.</p>
      ) : info.patterns.length === 0 ? (
        <p className="notice">Your videos are too alike on every measurement to compare. Results from more varied videos will fill this in.</p>
      ) : (
        <>
          <ol className="patterns">{info.patterns.map((p) => <PatternRow key={p.key} p={p} outcome={key} />)}</ol>
          <p className="hint">Patterns across {info.videos} videos. With a set this size a link can appear by chance, so treat each one as a test for your next video.</p>
        </>
      )}
    </section>
  );
}

function PatternRow({ p, outcome }: { p: TraitPattern; outcome: OutcomeKey }) {
  const o = OUTCOMES[outcome];
  const name = o.label.toLowerCase();
  const top = Math.max(p.above.average, p.below.average) || 1;
  const aboveWins = o.higherIsBetter ? p.above.average > p.below.average : p.above.average < p.below.average;
  const mark = p.strength === 'strong' ? 'Strong' : p.strength === 'moderate' ? 'Some' : 'Weak';
  return (
    <li>
      <span className={`chip ${p.strength === 'weak' ? 'note' : p.helps ? 'good' : 'bad'}`}>{mark}</span>
      <div className="stack" style={{ gap: 4 }}>
        <b>{p.label}</b>
        <p>
          {p.strength === 'weak' ? `Little sign of a link with ${name}.` : `Higher values went with a ${p.helps ? 'better' : 'worse'} ${name}.`}{' '}
          Videos above {p.splitAt} averaged {show(outcome, p.above.average)} across {p.above.n}. Videos at or below averaged {show(outcome, p.below.average)} across {p.below.n}.
        </p>
        <div className="split" role="img" aria-label={`Above ${p.splitAt}: ${show(outcome, p.above.average)}. At or below: ${show(outcome, p.below.average)}.`}>
          <i className={aboveWins ? 'win' : ''} style={{ height: `${Math.round((p.above.average / top) * 100)}%` }} /><span>Above</span>
          <i className={aboveWins ? '' : 'win'} style={{ height: `${Math.round((p.below.average / top) * 100)}%` }} /><span>At or below</span>
        </div>
      </div>
    </li>
  );
}

function Saved({ page, onCleared }: { page: ResultsPage; onCleared: () => void }) {
  const toast = useToast();
  const [armed, setArmed] = useState(false);
  const clear = async () => {
    if (!armed) { setArmed(true); return; }
    try { await api.results.clear(); toast('Results removed'); onCleared(); }
    catch { toast('Could not remove the results. Try again.'); }
    setArmed(false);
  };
  return (
    <section className="stack" aria-labelledby="saved-h" style={{ gap: 12 }}>
      <h2 id="saved-h" style={{ fontSize: '1.3rem' }}>Videos with results <span className="tc muted">{page.videos.length}</span></h2>
      <div className="tablewrap">
        <table className="data">
          <thead><tr><th>Video</th><th>Ad name</th><th className="num">Score</th>{OUTCOME_KEYS.map((k) => <th className="num" key={k}>{OUTCOMES[k].label}</th>)}</tr></thead>
          <tbody>
            {page.videos.map((v) => (
              <tr key={v.reportId}>
                <td style={{ overflowWrap: 'anywhere' }}><Link to={`/reports/${v.reportId}`}>{v.title}</Link></td>
                <td style={{ overflowWrap: 'anywhere' }}>{v.adName}</td>
                <td className="num">{v.score}</td>
                {OUTCOME_KEYS.map((k) => <td className="num" key={k}>{show(k, v.outcomes[k])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn quiet" style={{ alignSelf: 'flex-start', ...(armed ? { borderColor: 'var(--bad)', color: 'var(--bad)' } : {}) }} onClick={clear}>
        {armed ? 'Confirm: remove all results' : 'Remove all results'}
      </button>
    </section>
  );
}
