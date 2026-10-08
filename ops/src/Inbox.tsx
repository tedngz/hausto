// The first screen: everything waiting on a person, of all three kinds, in
// one order (_shared/viewing/inbox.ts) - viewing requests, building
// availability requests and priority searches. The Viewings and Availability
// screens still hold the full lists; this is where a day starts.

import { useState } from 'react';
import { KIND_LABEL, type InboxKind, type InboxRow } from '../../supabase/functions/_shared/viewing/inbox';
import { hcmc, humanAge } from '../../supabase/functions/_shared/viewing/triage';

const KIND_TAG: Record<InboxKind, string> = { VIEWING: 'tag', BUILDING: 'tag kind-building', SEARCH: 'tag kind-search' };

function due(row: InboxRow, now: number): { text: string; cls: string } {
  if (row.dueAt) {
    const left = (Date.parse(row.dueAt) - now) / 1000;
    return left <= 0
      ? { text: `${humanAge(-left)} over`, cls: 'age-late' }
      : { text: `${humanAge(left)} left`, cls: left < 8 * 3600 ? 'age-warn' : 'age-ok' };
  }
  const age = (now - Date.parse(row.createdAt)) / 1000;
  return { text: `${humanAge(age)} old`, cls: row.urgency === 'LATE' ? 'age-late' : row.urgency === 'WARN' ? 'age-warn' : 'age-ok' };
}

export function Inbox({ rows, error, onOpen, onReload }: {
  rows: InboxRow[] | null;
  error: string | null;
  onOpen: (row: InboxRow) => void;
  onReload: () => void;
}) {
  const [kind, setKind] = useState<InboxKind | 'ALL'>('ALL');
  const [showAll, setShowAll] = useState(false);

  if (error) return <p className="error">{error}</p>;
  if (!rows) return <p className="muted">Loading...</p>;

  const now = Date.now();
  const work = rows.filter(r => r.actionable);
  const count = (k: InboxKind) => work.filter(r => r.kind === k).length;
  const late = work.filter(r => r.urgency === 'LATE').length;
  const soon = work.filter(r => r.urgency === 'WARN').length;
  const ai = work.reduce((n, r) => n + r.proposals, 0);
  const visible = (showAll ? rows : work).filter(r => kind === 'ALL' || r.kind === kind);

  return (
    <>
      <div className="tiles">
        <div className={`tile ${late ? 'bad' : ''}`}><div className="n">{late}</div><div className="small muted">late</div></div>
        <div className={`tile ${soon ? 'warn' : ''}`}><div className="n">{soon}</div><div className="small muted">due soon</div></div>
        <div className="tile"><div className="n">{count('VIEWING')}</div><div className="small muted">viewing requests</div></div>
        <div className="tile"><div className="n">{count('BUILDING')}</div><div className="small muted">building requests</div></div>
        <div className="tile"><div className="n">{count('SEARCH')}</div><div className="small muted">priority searches</div></div>
        <div className="tile"><div className="n">{ai}</div><div className="small muted">AI proposals waiting</div></div>
      </div>

      <div className="row wrap-row" style={{ margin: '12px 0 8px' }}>
        <div className="seg">
          {(['ALL', 'VIEWING', 'BUILDING', 'SEARCH'] as const).map(k => (
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
              {k === 'ALL' ? `All (${work.length})` : `${KIND_LABEL[k]} (${count(k)})`}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <label className="small muted">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> show waiting and closed
        </label>
        <button onClick={onReload}>Refresh</button>
      </div>

      {visible.length === 0 && <p className="muted">Nothing waiting on us.</p>}
      {visible.length > 0 && (
        <table>
          <thead>
            <tr><th>Kind</th><th>Request</th><th>State</th><th>Waiting on</th><th>Clock</th><th>Since</th></tr>
          </thead>
          <tbody>
            {visible.map(r => {
              const c = due(r, now);
              return (
                <tr key={`${r.kind}:${r.id}`} onClick={() => onOpen(r)} className={r.actionable ? '' : 'dim'}>
                  <td><span className={KIND_TAG[r.kind]}>{KIND_LABEL[r.kind]}</span></td>
                  <td><strong>{r.name}</strong></td>
                  <td className="small">{r.state}</td>
                  <td className="small">{r.waitingOn}</td>
                  <td className={c.cls}>{c.text}</td>
                  <td className="small muted">{hcmc(r.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
