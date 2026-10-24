import { useState } from 'react';
import type { Claim, Evidence } from '@causa/types';
import type { View } from '../state';
import { Cite, Tick, jumpToEvidence, trunc } from './bits';
import { ModelChip } from './Models';

const LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' } as const;

export function AnswerPanel({ answer, via }: { answer: NonNullable<View['answer']>; via?: string }) {
  const claims = answer.claims;
  return (
    <section className="answer" aria-label="Answer">
      <div className="sec-head"><h2>Answer</h2><span className="src">ranked causes, each checked by a second Nemotron pass</span></div>
      <p className="summary">{answer.summary}</p>
      <ol className="claims">
        {claims.map((c, i) => <ClaimRow key={i} c={c} n={i + 1} />)}
      </ol>
      {answer.models && answer.models.length > 0 && (
        <p className="models-used">
          <span className="small muted">Models used:</span>
          {answer.models.map(m => <ModelChip key={m} model={m} />)}
          {via && <span className="small muted">{via}</span>}
        </p>
      )}
    </section>
  );
}

function ClaimRow({ c, n }: { c: Claim; n: number }) {
  return (
    <li className={`claim ${c.verified ? 'ok' : 'noted'}`}>
      <span className="rank" aria-label={`Rank ${n}`}>{n}</span>
      <div>
        <p>{c.text}</p>
        <div className="claim-meta">
          <span className={`pill conf-${c.confidence}`}>{LABEL[c.confidence]}</span>
          {c.verified ? <Tick label="verified by critic" /> : <span className="pill note">critic note</span>}
          <span className="cites" aria-label="Evidence citations">{c.evidenceIds.map(id => <Cite key={id} id={id} />)}</span>
        </div>
        {c.criticNote && <p className="critic-note small">{c.criticNote}</p>}
      </div>
    </li>
  );
}

// ---------- Evidence graph: claim -> evidence -> source (hand-rolled SVG) ----------
export function EvidenceGraph({ claims, evidence }: { claims: Claim[]; evidence: Evidence[] }) {
  const [hot, setHot] = useState<string | null>(null);
  const usedEv = evidence.filter(e => claims.some(c => c.evidenceIds.includes(e.id)));
  const sources = [...new Set(usedEv.flatMap(e => e.result.source))];
  const rowH = 46;
  const n = Math.max(claims.length, usedEv.length, sources.length, 1);
  const H = n * rowH + 20;
  const W = 760;
  const X = { c: 4, e: 292, s: 462 };
  const NW = { c: 252, e: 118, s: 294 };
  const y = (i: number, count: number) => 10 + (i + (n - count) / 2) * rowH + rowH / 2;
  const cy = (i: number) => y(i, claims.length);
  const ey = (id: string) => y(usedEv.findIndex(e => e.id === id), usedEv.length);
  const sy = (s: string) => y(sources.indexOf(s), sources.length);

  const edges: { k: string; d: string; a: string; b: string; ci?: number; ev?: string; src?: string }[] = [];
  claims.forEach((c, i) => c.evidenceIds.forEach(id => {
    if (!usedEv.some(e => e.id === id)) return;
    const x1 = X.c + NW.c, x2 = X.e, y1 = cy(i), y2 = ey(id);
    edges.push({ k: `c${i}-${id}`, d: `M${x1} ${y1} C${x1 + 36} ${y1} ${x2 - 36} ${y2} ${x2} ${y2}`, a: `c${i}`, b: id, ci: i, ev: id });
  }));
  usedEv.forEach(e => e.result.source.forEach(s => {
    const x1 = X.e + NW.e, x2 = X.s, y1 = ey(e.id), y2 = sy(s);
    edges.push({ k: `${e.id}-${s}`, d: `M${x1} ${y1} C${x1 + 36} ${y1} ${x2 - 36} ${y2} ${x2} ${y2}`, a: e.id, b: s, ev: e.id, src: s });
  }));
  const lit = (a: string, b: string) => hot === null || hot === a || hot === b;
  const hotLink = (id: string) => hot === id || edges.some(e => (e.a === hot || e.b === hot) && (e.a === id || e.b === id));

  return (
    <section aria-label="Evidence graph">
      <div className="sec-head"><h2>Evidence graph</h2><span className="src">claim, evidence, source</span></div>
      <div className="graph-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Graph linking ${claims.length} claims to ${usedEv.length} evidence queries and ${sources.length} sources`}>
          {edges.map(e => (
            <path key={e.k} d={e.d} className={`edge ${hot && lit(e.a, e.b) ? 'hot' : ''}`} opacity={lit(e.a, e.b) ? 1 : 0.15} />
          ))}
          {claims.map((c, i) => (
            <g key={i} transform={`translate(${X.c} ${cy(i) - 17})`} className={`gnode claim-node ${hotLink(`c${i}`) ? 'on' : ''}`}
              tabIndex={0} onMouseEnter={() => setHot(`c${i}`)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(`c${i}`)} onBlur={() => setHot(null)}>
              <rect width={NW.c} height={34} rx={4} />
              <text x={10} y={21}><tspan className="g-rank">{i + 1}</tspan>  {trunc(c.text, 32)}</text>
              <title>{c.text}</title>
            </g>
          ))}
          {usedEv.map(e => (
            <g key={e.id} transform={`translate(${X.e} ${ey(e.id) - 17})`} className={`gnode ev-node ${hotLink(e.id) ? 'on' : ''}`} tabIndex={0} role="button"
              onClick={() => jumpToEvidence(e.id)} onKeyDown={k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); jumpToEvidence(e.id); } }}
              onMouseEnter={() => setHot(e.id)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(e.id)} onBlur={() => setHot(null)}>
              <rect width={NW.e} height={34} rx={17} />
              <text x={NW.e / 2} y={21} textAnchor="middle">{e.id} · {e.result.rowCount} rows</text>
              <title>{e.purpose}</title>
            </g>
          ))}
          {sources.map(s => (
            <g key={s} transform={`translate(${X.s} ${sy(s) - 17})`} className={`gnode src-node ${hotLink(s) ? 'on' : ''}`} tabIndex={0}
              onMouseEnter={() => setHot(s)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(s)} onBlur={() => setHot(null)}>
              <rect width={NW.s} height={34} rx={4} />
              <text x={10} y={21}>{trunc(s, 38)}</text>
              <title>{s}</title>
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}
