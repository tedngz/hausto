// The queue. What to work, in the order to work it.
//
// It loads the request list and the whole event log for those requests, then
// derives every status in the browser with the shared reducer. There is no
// status column to read instead (invariant 1), and at ~25 requests a day the
// log is small enough that this is cheaper than the machinery avoiding it
// would cost.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { reduceRequest, type DomainEvent } from '../../supabase/functions/_shared/viewing-domain';
import { triage, humanAge, type Triage } from '../../supabase/functions/_shared/viewing/triage';

interface QueueRow {
  id: string;
  ref: string;
  created_at: string;
  age_seconds: number;
  item_count: number;
  unresolved_realtor_count: number;
}

interface Decorated extends QueueRow {
  t: Triage;
  state: string;
}

export function Queue({ onOpen }: { onOpen: (requestId: string) => void }) {
  const [rows, setRows] = useState<Decorated[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(async () => {
    const { data: queue, error: qErr } = await supabase
      .from('ops_request_queue')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(200);
    if (qErr) { setError(qErr.message); return; }

    const ids = (queue ?? []).map((r: QueueRow) => r.id);
    if (ids.length === 0) { setRows([]); return; }

    const { data: events, error: eErr } = await supabase
      .from('events')
      .select('id, request_id, item_id, type, payload, actor, occurred_at')
      .in('request_id', ids)
      .order('occurred_at', { ascending: true });
    if (eErr) { setError(eErr.message); return; }

    const byRequest = new Map<string, DomainEvent[]>();
    for (const e of (events ?? []) as DomainEvent[]) {
      const list = byRequest.get(e.request_id) ?? [];
      list.push(e);
      byRequest.set(e.request_id, list);
    }

    const now = Date.now();
    const decorated = (queue ?? []).map((r: QueueRow) => {
      const view = reduceRequest(r.id, byRequest.get(r.id) ?? []);
      // The last thing the renter heard from us. The SLA clock runs from here,
      // not from intake - see triage.ts.
      const delivered = (byRequest.get(r.id) ?? [])
        .filter(e => e.type === 'ITINERARY_DELIVERED')
        .map(e => Date.parse(e.occurred_at))
        .sort((a, b) => b - a)[0] ?? null;
      return { ...r, t: triage(view, r.age_seconds, delivered, now), state: view.state };
    });

    decorated.sort((a, b) => a.t.rank - b.t.rank || b.age_seconds - a.age_seconds);
    setRows(decorated);
    setError(null);
  }, []);

  useEffect(() => {
    void load();
    // Polled, not subscribed. An operator works one screen for an hour and a
    // stale queue is the failure mode that wastes a call.
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <p className="error">{error}</p>;
  if (!rows) return <p className="muted">Loading...</p>;

  const visible = showClosed ? rows : rows.filter(r => r.t.actionable);
  const late = rows.filter(r => r.t.urgency === 'LATE' && r.t.actionable).length;

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Queue</h2>
        {late > 0 && <span className="tag bad">{late} past 24h</span>}
        <div className="spacer" />
        <label className="small muted">
          <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> show closed
        </label>
        <button onClick={() => void load()}>Refresh</button>
      </div>

      {visible.length === 0 && <p className="muted">Nothing waiting.</p>}

      {visible.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Ref</th><th>Age</th><th>State</th><th>Waiting on</th><th>Units</th><th>Unresolved</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(r => (
              <tr key={r.id} onClick={() => onOpen(r.id)}>
                <td><strong>{r.ref}</strong></td>
                <td className={r.t.urgency === 'LATE' ? 'age-late' : r.t.urgency === 'WARN' ? 'age-warn' : 'age-ok'}>
                  {humanAge(r.age_seconds)}
                </td>
                <td className="small">{r.state}</td>
                <td className="small">{r.t.waitingOn}</td>
                <td>{r.item_count}</td>
                <td>
                  {r.unresolved_realtor_count > 0
                    ? <span className="tag warn">{r.unresolved_realtor_count} no contact</span>
                    : <span className="muted small">-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
