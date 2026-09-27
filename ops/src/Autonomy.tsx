// Stage 2 supervision: what the AI operator may do alone, what it did, and the
// switch that stops it.
//
// The locks are shown as the planner last computed them (`last_state`), since
// the console cannot read the AI_OPERATOR_AUTONOMY secret. The pause is the
// one lock any operator holds, and it takes effect on the next pass - before
// anything waiting out its hold can run.
//
// A message the AI operator sent cannot be unsent. "Flag as wrong" is the
// undo that exists: it records the miss, tells whoever reads this list to
// follow up with the renter, and closes the gate if it happens too often.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { hcmc } from '../../supabase/functions/_shared/viewing/triage';
import { GATE, AUTO_HOLD_MS } from '../../supabase/functions/_shared/viewing/autonomy';
import type { AutonomyState } from '../../supabase/functions/_shared/viewing/autonomy';

interface Controls {
  paused: boolean;
  note: string | null;
  updated_at: string;
  last_state: AutonomyState | null;
  last_run_at: string | null;
}

interface Acted {
  id: string;
  request_id: string;
  action: string;
  status: 'EXECUTED' | 'FLAGGED';
  executed_input: Record<string, unknown> | null;
  executed_at: string;
  decision_note: string | null;
}

export function Autonomy() {
  const [controls, setControls] = useState<Controls | null>(null);
  const [acted, setActed] = useState<Acted[]>([]);
  const [refs, setRefs] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [{ data: c }, { data: a }] = await Promise.all([
      supabase.from('ai_operator_controls').select('paused, note, updated_at, last_state, last_run_at').eq('id', 'singleton').maybeSingle(),
      supabase.from('operator_proposals')
        .select('id, request_id, action, status, executed_input, executed_at, decision_note')
        .in('status', ['EXECUTED', 'FLAGGED']).gte('executed_at', since)
        .order('executed_at', { ascending: false }).limit(50),
    ]);
    setControls((c as Controls) ?? null);
    const rows = (a ?? []) as Acted[];
    setActed(rows);
    const ids = [...new Set(rows.map(r => r.request_id))];
    if (ids.length) {
      const { data: q } = await supabase.from('ops_request_queue').select('id, ref').in('id', ids);
      setRefs(new Map(((q ?? []) as { id: string; ref: string }[]).map(r => [r.id, r.ref])));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('ops-record-outcome', { body });
    setBusy(false);
    const payload = data as { error?: string; message?: string } | null;
    if (err || payload?.error) { setError(payload?.message ?? payload?.error ?? err?.message ?? 'Failed'); return; }
    void load();
  };

  if (!controls) return null;
  const actions = Object.entries(controls.last_state?.actions ?? {});

  return (
    <div className="card">
      <div className="row wrap-row">
        <strong>Acting alone (stage 2)</strong>
        {controls.paused ? <span className="tag bad">paused</span> : <span className="tag">not paused</span>}
        <div className="spacer" />
        {controls.paused
          ? <button disabled={busy} onClick={() => void post({ action: 'SET_AUTONOMY', paused: false })}>Resume</button>
          : <button className="primary" disabled={busy} onClick={() => void post({ action: 'SET_AUTONOMY', paused: true })}>Pause everything</button>}
      </div>

      <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {actions.length === 0 && <li className="muted">The planner has not reported yet.</li>}
        {actions.map(([action, s]) => (
          <li key={action}>
            <strong>{action}</strong>{' '}
            <span className={`tag ${s.open ? 'good' : ''}`}>{s.open ? 'acting alone' : 'waits for a person'}</span>{' '}
            <span className="muted">{s.reason}</span>
          </li>
        ))}
      </ul>
      <p className="small muted" style={{ marginBottom: 0 }}>
        Opens only when AI_OPERATOR_AUTONOMY lists the action, nobody has paused it, and people agreed with at least{' '}
        {GATE.minAgreement * 100}% of its last {GATE.minDecided}+ proposals with no more than {GATE.maxEditedShare * 100}% reworded.
        Each send still waits {AUTO_HOLD_MS / 60_000} minutes for a person first.
        {controls.last_run_at ? ` Last checked ${hcmc(controls.last_run_at)}.` : ''}
      </p>

      {acted.length > 0 && (
        <>
          <div className="small" style={{ marginTop: 10 }}><strong>What it did, last 30 days</strong></div>
          {acted.map(a => (
            <div key={a.id} className="proposal small">
              <div className="row wrap-row">
                <span className={`tag ${a.status === 'FLAGGED' ? 'bad' : 'good'}`}>{a.status === 'FLAGGED' ? 'flagged' : a.action}</span>
                <strong>{refs.get(a.request_id) ?? a.request_id}</strong>
                <span className="muted">{hcmc(a.executed_at)}</span>
                <div className="spacer" />
                {a.status === 'EXECUTED' && (
                  <button disabled={busy} onClick={() => {
                    const note = window.prompt('What was wrong with it? Someone should follow up with the renter.') ?? '';
                    void post({ action: 'FLAG_PROPOSAL', proposalId: a.id, note });
                  }}>Flag as wrong</button>
                )}
              </div>
              {typeof a.executed_input?.message === 'string' && <div className="body" style={{ whiteSpace: 'pre-wrap' }}>{a.executed_input.message}</div>}
              {a.decision_note && <div className="muted">{a.decision_note}</div>}
            </div>
          ))}
        </>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
