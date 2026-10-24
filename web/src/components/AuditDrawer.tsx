import { useEffect, useRef, useState } from 'react';
import { api, type AuditEntry } from '../api';

export function AuditDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [err, setErr] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!id) return;
    setEntries(null); setErr('');
    api.audit(id).then(setEntries).catch(e => setErr((e as Error).message));
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, onClose]);

  if (!id) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Audit trail for memory ${id}`}>
        <header>
          <div>
            <h2>Audit trail</h2>
            <p className="small muted">Meterless H-MEM trust ledger for <span className="mono">{id}</span></p>
          </div>
          <button ref={closeRef} type="button" className="btn ghost" onClick={onClose}>Close</button>
        </header>
        {err && <p className="err" role="alert">{err}</p>}
        {!entries && !err && <p className="muted">Loading ledger…</p>}
        {entries && entries.length === 0 && <p className="muted">No ledger entries for this memory yet.</p>}
        <ol className="ledger">
          {entries?.map((e, i) => (
            <li key={i}>
              <span className="l-event mono">{e.event}</span>
              <time className="small muted num" dateTime={e.at}>{new Date(e.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</time>
              <p>{e.detail}</p>
            </li>
          ))}
        </ol>
      </aside>
    </>
  );
}
