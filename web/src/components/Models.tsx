import type { ModelCall, MarkovStep } from '../state';

export const PROVIDER: Record<ModelCall['provider'], string> = {
  'meterless-nightshift': 'via Meterless Nightshift',
  'nvidia-direct': 'via NVIDIA (direct)',
  sample: 'via offline sample',
};
export const isNemotron = (m: string) => /nemotron/i.test(m);

export function ModelChip({ model }: { model: string }) {
  const n = isNemotron(model);
  return <span className={`chip mono model ${n ? 'nv' : ''}`} title={n ? 'NVIDIA Nemotron model' : undefined}>{model}</span>;
}

export function ProviderLog({ calls, mock, live }: { calls: ModelCall[]; mock: boolean; live: boolean }) {
  const nv = calls.filter(c => isNemotron(c.model)).length;
  return (
    <section className="panel provider" aria-label="AI provider log">
      <div className="panel-head">
        <h2 className="panel-title">AI provider</h2>
        <span className="src">{calls.length ? `${nv}/${calls.length} calls on NVIDIA Nemotron` : 'Meterless Nightshift'}</span>
      </div>
      {calls.length === 0 && <p className="muted small">{live ? 'Waiting for the first model call…' : 'No model calls were recorded for this run.'}</p>}
      <ol className="calls">
        {calls.map((c, i) => (
          <li key={i} className={isNemotron(c.model) ? 'nv' : ''}>
            <span className="role">{c.role}</span>
            <span className="mid mono" title={c.model}>{c.model}</span>
            <span className="ms num">{c.ms.toLocaleString('en-US')} ms</span>
            <span className="via small muted">{PROVIDER[c.provider] ?? c.provider}</span>
          </li>
        ))}
      </ol>
      {mock && calls.length > 0 && <p className="small muted">Mock data: model ids and timings are invented for the replay.</p>}
    </section>
  );
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
export const sum = (a: MarkovStep[], k: 'bounded' | 'naive') => a.reduce((t, s) => t + s[k], 0);
export const savingPct = (a: MarkovStep[]) => {
  const n = sum(a, 'naive');
  return n > 0 ? Math.round((1 - sum(a, 'bounded') / n) * 100) : 0;
};

/** Per-hypothesis context meter: tokens carried per reasoning step, bounded (solid) vs naive full history (dashed). */
export function MarkovMeter({ steps }: { steps: MarkovStep[] }) {
  if (steps.length === 0) return null;
  const W = 120, H = 28, max = Math.max(...steps.map(s => Math.max(s.bounded, s.naive)), 1);
  const x = (i: number) => (steps.length === 1 ? W / 2 : 4 + (i * (W - 8)) / (steps.length - 1));
  const y = (v: number) => H - 3 - (v / max) * (H - 6);
  const line = (k: 'bounded' | 'naive') => steps.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s[k]).toFixed(1)}`).join(' ');
  const pct = savingPct(steps);
  const label = `Context per step: bounded ${steps.map(s => s.bounded).join(', ')} tokens; naive ${steps.map(s => s.naive).join(', ')} tokens`;
  return (
    <div className="markov" title="Tokens carried per reasoning step (engine estimates)">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <path d={line('naive')} className="mk-naive" />
        <path d={line('bounded')} className="mk-bound" />
        {steps.map((s, i) => <circle key={s.step} cx={x(i)} cy={y(s.bounded)} r={2} className="mk-dot" />)}
      </svg>
      <span className="mk-text small num">
        <b>{fmt(sum(steps, 'bounded'))}</b> bounded vs <span className="muted">{fmt(sum(steps, 'naive'))} naive</span>
        {pct > 0 && <span className="mk-save"> −{pct}%</span>}
      </span>
    </div>
  );
}
