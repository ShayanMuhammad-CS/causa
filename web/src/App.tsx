import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api, openStream, MOCK, type Health, type Summary } from './api';
import { reducer, type View } from './state';
import { ContractBadge, HypothesisBoard, Recalled, Remembered } from './components/Panels';
import { EvidenceStream } from './components/Evidence';
import { AnswerPanel, EvidenceGraph } from './components/Answer';
import { AuditDrawer } from './components/AuditDrawer';

const SUGGESTED = [
  "Why did Target's revenue growth lag Walmart's from FY2022 to FY2024?",
  "Is Ford's slowdown company-specific or sector-wide?",
  "What explains Dollar General's margin squeeze?",
];

type Theme = 'light' | 'dark';
const readTheme = (): Theme => {
  try { const t = localStorage.getItem('causa-theme'); if (t === 'light' || t === 'dark') return t; } catch { /* storage blocked */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export function App() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [view, dispatch] = useReducer(reducer, null as View | null);
  const [history, setHistory] = useState<Summary[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState(false);
  const [question, setQuestion] = useState('');
  const [auditId, setAuditId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [askErr, setAskErr] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const closeStream = useRef<() => void>(() => undefined);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('causa-theme', theme); } catch { /* storage blocked */ }
  }, [theme]);

  const refreshHistory = useCallback(() => { api.list().then(setHistory).catch(() => undefined); }, []);
  useEffect(() => {
    refreshHistory();
    const pull = () => api.health().then(h => { setHealth(h); setHealthErr(false); }).catch(() => setHealthErr(true));
    pull();
    const t = window.setInterval(pull, 20000);
    return () => window.clearInterval(t);
  }, [refreshHistory]);

  const running = view?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [running]);
  useEffect(() => { if (view && view.status !== 'running') refreshHistory(); }, [view?.status, refreshHistory]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => closeStream.current(), []);

  const attach = (id: string) => {
    closeStream.current();
    closeStream.current = openStream(id, e => dispatch({ kind: 'event', e }), m => dispatch({ kind: 'fail', message: m }));
  };

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text) return;
    setAskErr('');
    try {
      const { id } = await api.create(text);
      dispatch({ kind: 'reset', id, question: text });
      setNow(Date.now());
      attach(id);
      setNavOpen(false);
    } catch (e) {
      setAskErr(`Could not start the investigation: ${(e as Error).message}. Check that the Causa server is running on port 8700.`);
    }
  };

  const openPast = async (s: Summary) => {
    closeStream.current();
    setNavOpen(false);
    try {
      const inv = await api.get(s.id);
      dispatch({ kind: 'load', inv });
      if (inv.status === 'running') { dispatch({ kind: 'reset', id: inv.id, question: inv.question }); attach(inv.id); }
    } catch (e) {
      dispatch({ kind: 'reset', id: s.id, question: s.question });
      dispatch({ kind: 'fail', message: (e as Error).message });
    }
  };

  const newQuestion = () => { closeStream.current(); dispatch({ kind: 'reset', id: '', question: '' }); setQuestion(''); setNavOpen(false); };
  // `view.id === ''` is the ask screen.
  const onAsk = !view || view.id === '';
  const closeAudit = useCallback(() => setAuditId(null), []);

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to main content</a>
      <header className="topbar">
        <button type="button" className="btn ghost menu-btn" aria-expanded={navOpen} aria-controls="history" onClick={() => setNavOpen(o => !o)}>History</button>
        <button type="button" className="brand" onClick={newQuestion} aria-label="Causa, new question">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="6" fill="var(--accent)" /><path d="M9 16h7m0 0l-3-4m3 4l-3 4M16 10h7M16 22h7" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" /></svg>
          <span>Causa</span>
        </button>
        {MOCK && <span className="pill mock" title="Replaying hand-written sample data from src/mock/events.json">mock data</span>}
        <span className="grow" />
        <HealthDots health={health} err={healthErr} />
        <button type="button" className="btn ghost" onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </header>

      <nav id="history" className={`side ${navOpen ? 'open' : ''}`} aria-label="Past investigations">
        <button type="button" className="btn primary wide" onClick={newQuestion}>New question</button>
        <h2 className="side-title">History</h2>
        <ul>
          {history.map(s => (
            <li key={s.id}>
              <button type="button" className={`hist ${view?.id === s.id ? 'cur' : ''}`} onClick={() => openPast(s)} aria-current={view?.id === s.id}>
                <span className={`sdot st-${s.status}`} aria-label={s.status} />
                <span className="hq">{s.question}</span>
              </button>
            </li>
          ))}
          {history.length === 0 && <li className="muted small pad">Investigations you run appear here.</li>}
        </ul>
      </nav>

      <main id="main" className="main">
        {onAsk ? (
          <AskScreen question={question} setQuestion={setQuestion} onAsk={ask} err={askErr} />
        ) : (
          <Investigation view={view!} now={now} onAudit={setAuditId} />
        )}
      </main>

      <footer className="powered" aria-label="Powered by">
        <span>Powered by</span>
        <b>Zetaris</b><span className="sep" aria-hidden="true">/</span>
        <b>Meterless</b> <span className="muted">H-MEM, Scout Intent</span><span className="sep" aria-hidden="true">/</span>
        <b>NVIDIA Nemotron</b>
      </footer>
      <AuditDrawer id={auditId} onClose={closeAudit} />
    </div>
  );
}

function HealthDots({ health, err }: { health: Health | null; err: boolean }) {
  const items: [string, { ok: boolean; detail: string } | undefined][] = [
    ['Zetaris', health?.zetaris], ['Nemotron', health?.llm], ['H-MEM', health?.memory],
  ];
  return (
    <ul className="health" aria-label="Service health">
      {items.map(([name, p]) => {
        const state = err || !p ? 'unknown' : p.ok ? 'ok' : 'bad';
        const text = err ? 'server unreachable' : !p ? 'checking' : p.detail;
        return (
          <li key={name} title={`${name}: ${text}`} className={`h-${state}`}>
            <span className="hdot" aria-hidden="true" />
            <span>{name}</span>
            <span className="sr">{state === 'ok' ? 'healthy' : state === 'bad' ? `unhealthy: ${text}` : text}</span>
          </li>
        );
      })}
    </ul>
  );
}

function AskScreen({ question, setQuestion, onAsk, err }: { question: string; setQuestion: (s: string) => void; onAsk: (q: string) => void; err: string }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="ask">
      <h1>Ask why. Get the evidence, not just the answer.</h1>
      <p className="lede">Causa tests competing explanations against live filings, industry classifications and macro data, then shows every query behind each claim.</p>
      <form onSubmit={e => { e.preventDefault(); onAsk(question); }}>
        <label htmlFor="q" className="sr">Your why-question</label>
        <textarea id="q" ref={ta} rows={3} value={question} placeholder="Why did revenue growth slow down at…" onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); onAsk(question); } }} />
        <div className="ask-row">
          <span className="muted small">Read-only. Every query is checked by Scout Intent before it runs.</span>
          <button type="submit" className="btn primary" disabled={!question.trim()}>Investigate</button>
        </div>
      </form>
      {err && <p className="err" role="alert">{err}</p>}
      <h2 className="try">Try one of these</h2>
      <ul className="suggest">
        {SUGGESTED.map(s => (
          <li key={s}><button type="button" onClick={() => { setQuestion(s); ta.current?.focus(); }}>{s}</button></li>
        ))}
      </ul>
    </div>
  );
}

function Investigation({ view, now, onAudit }: { view: View; now: number; onAudit: (id: string) => void }) {
  const running = view.status === 'running';
  const queries = view.feed.length;
  // LLM calls are derived from the event stream (the server does not report a counter):
  // intent + planning + one per query + one per verdict + critic/answer.
  const llmCalls = 1 + (view.hypotheses.length ? 1 : 0) + queries + view.verdicts + (view.answer ? 1 : 0);
  const seconds = Math.round(((view.finishedAt ?? now) - view.startedAt) / 1000);
  const blocked = view.status === 'blocked' || view.contract?.intent.risk === 'blocked';
  return (
    <div className="inv">
      <div className="qhead">
        <h1>{view.question}</h1>
        <span className={`pill st-pill st-${view.status}`}>{running && <span className="dot" />}{view.status === 'done' ? 'complete' : view.status}</span>
      </div>
      {blocked && (
        <div className="banner bad" role="alert"><strong>Blocked by Scout Intent.</strong> {view.contract?.intent.riskReasons.join('; ') || 'This request is not allowed.'}</div>
      )}
      {view.error && <div className="banner bad" role="alert"><strong>Investigation failed.</strong> {view.error}</div>}
      <div className="cols">
        <div className="colmain">
          <HypothesisBoard hypotheses={view.hypotheses} active={running} />
          {view.answer && <AnswerPanel answer={view.answer} />}
          {view.answer && view.answer.claims.length > 0 && <EvidenceGraph claims={view.answer.claims} evidence={view.feed.flatMap(f => (f.evidence ? [f.evidence] : []))} />}
          <EvidenceStream feed={view.feed} thinking={view.thinking} running={running} />
        </div>
        <aside className="colside" aria-label="Contract and memory">
          <ContractBadge contract={view.contract} queries={queries} llmCalls={llmCalls} seconds={seconds} live={running} />
          <Recalled hits={view.recalled} onAudit={onAudit} />
          <Remembered ids={view.remembered} onAudit={onAudit} />
        </aside>
      </div>
    </div>
  );
}
