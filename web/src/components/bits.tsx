import { useState, type ReactNode } from 'react';

const KW = new Set(('select from where and or not in between join left right inner outer on group by order having limit as with union all distinct ' +
  'show describe lightning databases tables case when then else end like is null asc desc over partition count sum avg min max round cast').split(' '));

/** Tiny SQL tokenizer for display only. */
export function Sql({ sql }: { sql: string }) {
  const re = /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)+)|([A-Za-z_][\w$]*)|(\s+)|(.)/g;
  const out: ReactNode[] = [];
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(sql))) {
    const [t, com, str, num, qual, word] = m;
    const k = i++;
    if (com) out.push(<span key={k} className="t-com">{t}</span>);
    else if (str) out.push(<span key={k} className="t-str">{t}</span>);
    else if (num) out.push(<span key={k} className="t-num">{t}</span>);
    else if (qual) out.push(<span key={k} className="t-obj">{t}</span>);
    else if (word && KW.has(word.toLowerCase())) out.push(<span key={k} className="t-kw">{t}</span>);
    else out.push(t);
  }
  return <pre className="sql" tabIndex={0} aria-label="Lightning SQL"><code>{out}</code></pre>;
}

export function jumpToEvidence(id: string) {
  const el = document.getElementById(`evc-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  el.focus({ preventScroll: true });
}

export function Cite({ id }: { id: string }) {
  return (
    <button type="button" className="cite" onClick={() => jumpToEvidence(id)} aria-label={`Go to evidence ${id}`}>
      {id}
    </button>
  );
}

export function Tick({ label }: { label: string }) {
  return (
    <span className="tick">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 6.4l2.4 2.4 5-5.4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {label}
    </span>
  );
}

export function Meter({ label, used, max, unit, live }: { label: string; used: number; max: number; unit?: string; live?: boolean }) {
  const pct = Math.min(100, (used / Math.max(1, max)) * 100);
  const tone = pct >= 90 ? 'hot' : pct >= 70 ? 'warm' : '';
  return (
    <div className="meter">
      <div className="meter-head"><span>{label}</span><span className="num">{used}{unit}/{max}{unit}</span></div>
      <div className={`meter-track ${tone}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={used}>
        <div className={`meter-fill ${live ? 'live' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function useToggle(initial = false): [boolean, () => void] {
  const [v, set] = useState(initial);
  return [v, () => set(x => !x)];
}

export const fmtCell = (col: string, v: string | number | null) => {
  if (v === null) return '—';
  if (typeof v === 'number' && !/year|id|code|^fy/i.test(col)) return v.toLocaleString('en-US');
  return String(v);
};

export const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
