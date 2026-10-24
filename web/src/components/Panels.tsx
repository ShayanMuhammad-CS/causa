import { useEffect, useState } from 'react';
import type { ExecutionContract, Hypothesis, MemoryHit } from '@causa/types';
import { api } from '../api';
import type { MarkovStep } from '../state';
import { Cite, Meter, Tick, trunc } from './bits';
import { MarkovMeter, savingPct } from './Models';

export function ContractBadge({ contract, queries, llmCalls, seconds, live }: {
  contract?: ExecutionContract; queries: number; llmCalls: number; seconds: number; live: boolean;
}) {
  if (!contract) {
    return (
      <section className="panel" aria-label="Execution contract" aria-busy="true">
        <h2 className="panel-title">Execution contract</h2>
        <p className="muted small">Scout Intent is checking the question…</p>
      </section>
    );
  }
  const { intent, budget } = contract;
  return (
    <section className="panel contract" aria-label="Execution contract">
      <div className="panel-head">
        <h2 className="panel-title">Execution contract</h2>
        <span className="src">Meterless Scout Intent</span>
      </div>
      <div className="contract-intent">
        <span className="mono">{intent.intent}</span>
        <span className={`pill risk-${intent.risk}`}>{intent.risk} risk</span>
      </div>
      <p className="muted small">{[...intent.entities, ...intent.metrics, intent.timeRange].filter(Boolean).join(', ')}</p>
      <ul className="chips" aria-label="Allowed tools">
        {contract.allowedTools.map(t => <li key={t} className="chip mono">{t}</li>)}
      </ul>
      <Meter label="Queries" used={queries} max={budget.maxQueries} live={live} />
      <Meter label="LLM calls" used={llmCalls} max={budget.maxLlmCalls} live={live} />
      <Meter label="Time" used={seconds} max={budget.maxSeconds} unit="s" live={live} />
      <div className="sig">
        <span className="mono" title={contract.signature}>{trunc(contract.signature, 26)}</span>
        <Tick label="verified" />
      </div>
    </section>
  );
}

export function MemoryActions({ id }: { id: string }) {
  const [vote, setVote] = useState<'helpful' | 'unhelpful' | null>(null);
  const [err, setErr] = useState('');
  const send = async (v: 'helpful' | 'unhelpful') => {
    setErr('');
    const prev = vote;
    setVote(v);
    try { await api.feedback(id, v); } catch (e) { setVote(prev); setErr((e as Error).message); }
  };
  return (
    <span className="mem-actions">
      <button type="button" className={`icon-btn ${vote === 'helpful' ? 'on' : ''}`} aria-pressed={vote === 'helpful'} aria-label={`Mark ${id} helpful`} title="Helpful" onClick={() => send('helpful')}>
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 7v7H2.5V7H5zm0 0l3-5c1.2 0 1.8.9 1.5 2L9 6.5h3.7c.9 0 1.5.8 1.3 1.6l-1 4.6c-.2.8-.8 1.3-1.6 1.3H5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
      </button>
      <button type="button" className={`icon-btn ${vote === 'unhelpful' ? 'on bad' : ''}`} aria-pressed={vote === 'unhelpful'} aria-label={`Mark ${id} unhelpful`} title="Unhelpful" onClick={() => send('unhelpful')}>
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" style={{ transform: 'scaleY(-1)' }}><path d="M5 7v7H2.5V7H5zm0 0l3-5c1.2 0 1.8.9 1.5 2L9 6.5h3.7c.9 0 1.5.8 1.3 1.6l-1 4.6c-.2.8-.8 1.3-1.6 1.3H5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
      </button>
      {err && <span className="err small" role="alert">{err}</span>}
    </span>
  );
}

export function Recalled({ hits, onAudit }: { hits: MemoryHit[]; onAudit: (id: string) => void }) {
  return (
    <section className="panel" aria-label="Recalled memories">
      <div className="panel-head">
        <h2 className="panel-title">Recalled</h2>
        <span className="src">Meterless H-MEM</span>
      </div>
      {hits.length === 0 && <p className="muted small">Nothing relevant in memory yet. This run starts cold.</p>}
      <ul className="mem-list">
        {hits.map(h => (
          <li key={h.id} className="mem">
            <p>{h.text}</p>
            <div className="mem-meta">
              <span className="chip prov" title={`Provenance confidence ${h.provenance.confidence}`}>Remembered from {h.provenance.source}</span>
              <span className="chip num">match {Math.round(h.score * 100)}%</span>
            </div>
            <div className="mem-foot">
              <button type="button" className="link" onClick={() => onAudit(h.id)}>Audit</button>
              <MemoryActions id={h.id} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Remembered({ ids, onAudit }: { ids: string[]; onAudit: (id: string) => void }) {
  const [text, setText] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    ids.forEach(id => api.audit(id).then(a => { if (live && a[0]) setText(t => ({ ...t, [id]: a[0].detail })); }).catch(() => undefined));
    return () => { live = false; };
  }, [ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ids.length) return null;
  return (
    <section className="panel" aria-label="Remembered">
      <div className="panel-head">
        <h2 className="panel-title">Remembered</h2>
        <span className="src">written to H-MEM</span>
      </div>
      <ul className="mem-list">
        {ids.map(id => (
          <li key={id} className="mem">
            <p className="small">{text[id] ?? 'Verified finding stored with its evidence ids as provenance.'}</p>
            <div className="mem-foot">
              <span className="chip mono">{id}</span>
              <button type="button" className="link" onClick={() => onAudit(id)}>Audit</button>
              <MemoryActions id={id} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const STATUS: Record<Hypothesis['status'], { label: string; hint: string }> = {
  open: { label: 'Open', hint: 'being tested' },
  supported: { label: 'Supported', hint: 'evidence agrees' },
  refuted: { label: 'Refuted', hint: 'evidence disagrees' },
  inconclusive: { label: 'Inconclusive', hint: 'not enough to say' },
};

export function HypothesisBoard({ hypotheses, active, markov }: { hypotheses: Hypothesis[]; active: boolean; markov: Record<string, MarkovStep[]> }) {
  const all = Object.values(markov).flat();
  const pct = savingPct(all);
  const counts = (['supported', 'refuted', 'inconclusive', 'open'] as const).map(st => [st, hypotheses.filter(h => h.status === st).length] as const).filter(([, n]) => n > 0);
  return (
    <section className="board" aria-label="Hypotheses">
      <div className="sec-head">
        <h2>Competing hypotheses</h2>
        <span className="src">{counts.map(([st, n]) => `${n} ${STATUS[st].label.toLowerCase()}`).join(', ')}</span>
        {all.length > 0 && (
          <span className="mk-total" title="Tokens carried between reasoning steps, summed over all hypotheses (engine estimates)">
            Context (Meterless Markovian): <b>{pct > 0 ? `−${pct}% tokens` : 'bounded'}</b>
          </span>
        )}
      </div>
      <ul className="hyps">
        {hypotheses.map(h => (
          <li key={`${h.id}-${h.status}`} className={`hrow col-${h.status}`}>
            <div className="hmain">
              <div className="hhead">
                <span className={`pill hs-${h.status}`}>{h.status === 'open' && active && <span className="dot" />}{STATUS[h.status].label}</span>
                <span className="hid mono">{h.id}</span>
                {h.evidenceIds.length > 0 && <span className="small muted">{h.evidenceIds.map(id => <Cite key={id} id={id} />)}</span>}
              </div>
              <p>{h.statement}</p>
            </div>
            <MarkovMeter steps={markov[h.id] ?? []} />
          </li>
        ))}
        {hypotheses.length === 0 && <li className="empty muted">{active ? 'Nemotron is proposing competing hypotheses…' : 'No hypotheses were proposed.'}</li>}
      </ul>
    </section>
  );
}
