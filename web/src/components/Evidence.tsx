import { useState } from 'react';
import type { QueryResult } from '@causa/types';
import type { FeedItem } from '../state';
import { Sql, fmtCell } from './bits';

const SHOW_ROWS = 5;

function lineage(src: string) {
  const parts = src.split('.');
  return { sys: parts[0], rest: parts.slice(1).join('.') };
}

export function ResultTable({ r }: { r: QueryResult }) {
  const [all, setAll] = useState(false);
  const rows = all ? r.rows : r.rows.slice(0, SHOW_ROWS);
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Query result rows">
      <table>
        <thead><tr>{r.columns.map(c => <th key={c} scope="col" className={typeof r.rows[0]?.[r.columns.indexOf(c)] === 'number' ? 'r' : ''}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{row.map((v, j) => <td key={j} className={typeof v === 'number' ? 'num r' : ''}>{fmtCell(r.columns[j], v)}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {r.rows.length > SHOW_ROWS && (
        <button type="button" className="link more" onClick={() => setAll(a => !a)}>
          {all ? 'Show fewer rows' : `Show all ${r.rowCount} rows`}
        </button>
      )}
    </div>
  );
}

export function EvidenceCard({ item }: { item: FeedItem }) {
  const ev = item.evidence;
  const state = item.state;
  return (
    <article id={ev ? `evc-${ev.id}` : undefined} tabIndex={-1} className={`ecard s-${state}`} aria-label={ev ? `Evidence ${ev.id}` : state === 'failed' ? 'Failed query' : 'Running query'}>
      <header className="ehead">
        <span className="eid mono">{ev ? ev.id : state === 'failed' ? 'failed' : 'running'}</span>
        <span className="hyp mono">{item.hypothesisId}</span>
        {item.attempt > 1 && <span className="pill retry">retry {item.attempt - 1}</span>}
        {state === 'running' && <span className="pill running"><span className="dot" />running</span>}
        {state === 'failed' && <span className="pill risk-high">query failed</span>}
        {ev && <span className="ms num">{ev.result.elapsedMs.toLocaleString('en-US')} ms</span>}
      </header>
      {item.purpose && <p className="purpose">{item.purpose}</p>}
      <Sql sql={item.sql} />
      {state === 'failed' && (
        <div className="fail" role="alert">
          <strong>Zetaris rejected the query.</strong> <span className="mono">{item.error}</span>
          <p className="small muted">Causa feeds this error back to Nemotron and retries (at most 2 times).</p>
        </div>
      )}
      {ev && (
        <>
          <ResultTable r={ev.result} />
          <p className="readout">{ev.summary}</p>
          <ul className="chips" aria-label="Source lineage">
            {ev.result.source.map(s => {
              const l = lineage(s);
              return <li key={s} className="chip lin" title={s}>via <b>{l.sys}</b>{l.rest ? <span className="mono"> · {l.rest}</span> : null}</li>;
            })}
            <li className="chip mono">{ev.result.queryId}</li>
          </ul>
        </>
      )}
    </article>
  );
}

export function EvidenceStream({ feed, thinking, running }: { feed: FeedItem[]; thinking: string[]; running: boolean }) {
  const last = thinking[thinking.length - 1];
  return (
    <section aria-label="Evidence stream">
      <div className="sec-head">
        <h2>Evidence</h2>
        <span className="src">Nemotron through Zetaris Lightning SQL, read-only</span>
      </div>
      {running && last && (
        <p className="thinking" aria-live="polite"><span className="dot" />{last}</p>
      )}
      <div className="feed">
        {feed.map(f => <EvidenceCard key={f.key + f.state} item={f} />)}
        {feed.length === 0 && <p className="muted">{running ? 'Waiting for the first query…' : 'No queries were run.'}</p>}
      </div>
    </section>
  );
}
