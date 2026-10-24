import { useEffect, useRef, useState } from 'react';
import { api, type WorldTrailItem } from '../api';
import type { WorldEntity } from '../state';

export function WorldPanel({ world, onOpen }: { world?: { entities: WorldEntity[]; unknown: string[] }; onOpen: (e: WorldEntity) => void }) {
  return (
    <section className="panel world" aria-label="Grounded entities" aria-busy={!world}>
      <div className="panel-head">
        <h2 className="panel-title">Grounded entities</h2>
        <span className="src">Meterless World Model</span>
      </div>
      {!world && <p className="muted small">Resolving company names against the data…</p>}
      {world && (
        <ul className="ents">
          {world.entities.map(e => (
            <li key={e.id}>
              <button type="button" className="ent" onClick={() => onOpen(e)} title="Open the World Model trail for this entity">
                <span className="ent-name">{e.name}</span>
                <span className="ent-chips">
                  {e.ticker && <span className="chip mono">{e.ticker}</span>}
                  {e.cik && <span className="chip mono">CIK {e.cik}</span>}
                  {e.sic && <span className="chip mono">SIC {e.sic}</span>}
                </span>
              </button>
            </li>
          ))}
          {world.unknown.map(n => (
            <li key={n} className="ent unknown" title="The name could not be matched to any company in the data, so it is refused rather than invented.">
              <span className="ent-name">{n}</span>
              <span className="chip warnchip">not in data, not investigated</span>
            </li>
          ))}
          {world.entities.length === 0 && world.unknown.length === 0 && <li className="muted small">No named companies in this question.</li>}
        </ul>
      )}
    </section>
  );
}

const pick = (o: WorldTrailItem, keys: string[]) => {
  for (const k of keys) { const v = o[k]; if (typeof v === 'string' || typeof v === 'number') return String(v); }
  return undefined;
};

export function EntityDrawer({ entity, onClose }: { entity: WorldEntity | null; onClose: () => void }) {
  const [items, setItems] = useState<WorldTrailItem[] | null | undefined>(undefined); // undefined = loading, null = 404
  const [err, setErr] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const id = entity?.id;

  useEffect(() => {
    if (!id) return;
    let live = true;
    setItems(undefined); setErr('');
    api.worldHistory(id).then(r => { if (live) setItems(r); }).catch(e => { if (live) setErr((e as Error).message); });
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { live = false; window.removeEventListener('keydown', onKey); };
  }, [id, onClose]);

  if (!entity) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`World Model trail for ${entity.name}`}>
        <header>
          <div>
            <h2>{entity.name}</h2>
            <p className="small muted">Meterless World Model event trail</p>
          </div>
          <button ref={closeRef} type="button" className="btn ghost" onClick={onClose}>Close</button>
        </header>
        <ul className="chips ent-facts">
          {entity.ticker && <li className="chip mono">{entity.ticker}</li>}
          {entity.cik && <li className="chip mono">CIK {entity.cik}</li>}
          {entity.sic && <li className="chip mono">SIC {entity.sic}</li>}
          <li className="chip mono">{entity.id}</li>
        </ul>
        {err && <p className="err" role="alert">{err}</p>}
        {items === undefined && !err && <p className="muted">Loading trail…</p>}
        {items === null && <p className="muted">The server has no World Model trail for this entity yet.</p>}
        {items && items.length === 0 && <p className="muted">No events recorded for this entity.</p>}
        <ol className="ledger">
          {items?.map((it, i) => {
            const at = pick(it, ['at', 'timestamp', 'time', 'ts']);
            const kind = pick(it, ['event', 'type', 'kind', 'action']) ?? 'event';
            const text = pick(it, ['detail', 'description', 'summary', 'text', 'message']);
            const when = at && !Number.isNaN(Date.parse(at)) ? new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : at;
            return (
              <li key={i}>
                <span className="l-event mono">{kind}</span>
                {when && <time className="small muted num" dateTime={at}>{when}</time>}
                <p>{text ?? <code className="small">{JSON.stringify(it)}</code>}</p>
              </li>
            );
          })}
        </ol>
      </aside>
    </>
  );
}
