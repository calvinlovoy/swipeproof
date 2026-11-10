import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Crumbs, PageHead, Status, toolPath } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, useAsync, useContent } from '../lib/hooks';
import { NotFound } from './Static';

export function Blog() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('All');
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 200); return () => clearTimeout(t); }, [query]);
  const posts = useAsync(() => api.posts({ q: debounced, category, page }), [debounced, category, page]);
  const [categories, setCategories] = useState<string[]>([]);
  useEffect(() => { if (posts.data) setCategories(posts.data.categories); }, [posts.data]);

  const data = posts.data;
  const reset = () => { setQuery(''); setDebounced(''); setCategory('All'); setPage(1); };
  const from = data ? (data.page - 1) * data.pageSize + 1 : 0;

  return (
    <>
      <Crumbs trail={[['Blog']]} />
      <PageHead title="Blog">Short, practical pieces on hooks, pacing and editing for vertical video.</PageHead>
      <div className="wrap stack" style={{ gap: 18 }}>
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="bq">Search articles</label>
          <input type="search" id="bq" value={query} placeholder="Try hook or captions" onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
        </div>
        <div className="row" role="group" aria-label="Category">
          {['All', ...categories].map((c) => (
            <button type="button" className="chip" key={c} aria-pressed={category === c} onClick={() => { setCategory(c); setPage(1); }}>{c}</button>
          ))}
        </div>
        <div aria-live="polite" id="blog-list">
          {!data ? <Status loading={posts.loading} error={posts.error} retry={posts.reload} /> : data.total === 0 ? (
            <div className="card" style={{ alignItems: 'flex-start' }}>
              <h3>No articles match</h3>
              <p className="muted">Try a different word or clear the filters.</p>
              <button type="button" className="btn ghost" onClick={reset}>Clear filters</button>
            </div>
          ) : (
            <>
              <p className="small muted" style={{ marginBottom: 12 }}>Showing {from} to {from + data.items.length - 1} of {data.total} articles</p>
              <div className="grid">
                {data.items.map((p) => (
                  <Link className="card" key={p.slug} to={`/blog/${p.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <p className="eyebrow"><span className="chip">{p.category}</span><span>{formatDate(p.publishedOn)}</span><span>{p.minutes} min</span></p>
                    <h3>{p.title}</h3>
                    <p className="muted">{p.excerpt}</p>
                  </Link>
                ))}
              </div>
              {data.pages > 1 && (
                <div className="row" style={{ marginTop: 18 }} role="group" aria-label="Pages">
                  {Array.from({ length: data.pages }, (_, i) => i + 1).map((n) => (
                    <button type="button" className="chip" key={n} aria-pressed={data.page === n} aria-label={`Page ${n}`} onClick={() => setPage(n)}>{n}</button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

export function PostPage() {
  const { slug = '' } = useParams();
  const { tools } = useContent();
  const post = useAsync(() => api.post(slug), [slug]);
  if (post.error?.status === 404) return <NotFound message={post.error.message} />;
  const p = post.data;
  if (!p) return <Status loading={post.loading} error={post.error} retry={post.reload} />;
  const tool = tools.find((t) => t.id === p.tool) ?? tools[0];
  return (
    <>
      <Crumbs trail={[['Blog', '/blog'], [p.category]]} />
      <div className="wrap">
        <article className="post stack" style={{ gap: 20 }}>
          <p className="eyebrow"><span className="chip">{p.category}</span><span>{formatDate(p.publishedOn)}</span><span>{p.minutes} min read</span></p>
          <h1 style={{ fontSize: 'clamp(2rem,5vw,3rem)' }}>{p.title}</h1>
          <div>{p.body.map((para) => <p key={para.slice(0, 40)}>{para}</p>)}</div>
          <div className="card">
            <h3>Try it on your own work</h3>
            <p className="muted">{tool.desc}</p>
            <Link className="btn" to={toolPath(tool.id)} style={{ alignSelf: 'flex-start' }}>{tool.cta}</Link>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            {p.older ? <Link to={`/blog/${p.older.slug}`}>Older: {p.older.title}</Link> : <span />}
            {p.newer && <Link to={`/blog/${p.newer.slug}`}>Newer: {p.newer.title}</Link>}
          </div>
        </article>
      </div>
    </>
  );
}
