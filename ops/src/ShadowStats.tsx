// How the AI operator is doing against the people doing the job.
//
// Stage 1 of the AI operator plan exists to produce these numbers: agreement
// per action, and paste-parse accuracy against the PLAN-v3 bar (80% of 30 real
// agent replies). Stage 2 is gated on them, so they are computed from the
// decisions themselves - the same agreementStats the tests hold to - rather
// than from anything the planner says about itself.

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { agreementStats, type AgreementStats } from '../../supabase/functions/_shared/viewing/proposals';
import { hcmc } from '../../supabase/functions/_shared/viewing/triage';
import { Autonomy } from './Autonomy';

/** PLAN-v3 S5: paste-parse must read at least this share of real replies right... */
const PARSE_BAR = 0.8;
/** ...over at least this many of them before the number means anything. */
const PARSE_SAMPLE = 30;

interface Decided {
  action: string;
  status: 'APPROVED' | 'AGREED' | 'CORRECTED' | 'REJECTED' | 'SUPERSEDED' | 'PENDING';
  edited: boolean;
  rationale: string;
  executed_action: string | null;
  decision_note: string | null;
  decided_at: string | null;
  agent_version: string;
}

const pct = (x: number | null) => (x == null ? '-' : `${Math.round(x * 100)}%`);

export function ShadowStats() {
  const [rows, setRows] = useState<Decided[] | null>(null);
  const [parse, setParse] = useState<{ n: number; right: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [{ data, error: e1 }, { data: outcomes, error: e2 }] = await Promise.all([
        supabase.from('operator_proposals')
          .select('action, status, edited, rationale, executed_action, decision_note, decided_at, agent_version')
          .gte('created_at', since).order('decided_at', { ascending: false }).limit(1000),
        supabase.from('events').select('payload').eq('type', 'OUTCOME_RECORDED').gte('occurred_at', since).limit(2000),
      ]);
      if (e1 || e2) { setError((e1 ?? e2)!.message); return; }
      setRows((data ?? []) as Decided[]);
      // Every outcome recorded with a paste-parse suggestion beside it,
      // whether it came through a proposal or the console's Suggest button.
      let n = 0;
      let right = 0;
      for (const o of (outcomes ?? []) as { payload: { outcome?: string; suggested?: { outcome?: string | null } } }[]) {
        if (!o.payload?.suggested) continue;
        n += 1;
        if (o.payload.suggested.outcome === o.payload.outcome) right += 1;
      }
      setParse({ n, right });
    })();
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!rows || !parse) return <p className="muted">Loading...</p>;

  const stats: AgreementStats[] = agreementStats(rows);
  const total = stats.reduce((a, s) => ({ decided: a.decided + s.decided, agreed: a.agreed + s.agreed }), { decided: 0, agreed: 0 });
  const pending = rows.filter(r => r.status === 'PENDING').length;
  const misses = rows.filter(r => r.status === 'CORRECTED' || r.status === 'REJECTED').slice(0, 20);
  const parseRate = parse.n ? parse.right / parse.n : null;
  const parseMet = parse.n >= PARSE_SAMPLE && (parseRate ?? 0) >= PARSE_BAR;

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>AI operator - last 30 days</h2>
      </div>

      <Autonomy />
      <div className="card">
        <div className="row wrap-row">
          <strong>Agreement</strong>
          <span>{pct(total.decided ? total.agreed / total.decided : null)}</span>
          <span className="small muted">{total.agreed} of {total.decided} decided proposals; {pending} still pending</span>
        </div>
        <div className="row wrap-row" style={{ marginTop: 6 }}>
          <strong>Reading agent replies</strong>
          <span>{pct(parseRate)}</span>
          <span className="small muted">{parse.right} of {parse.n} suggested outcomes kept</span>
          <span className={`tag ${parseMet ? 'good' : 'warn'}`}>
            {parseMet ? `bar met (${PARSE_BAR * 100}% of ${PARSE_SAMPLE}+)`
              : parse.n < PARSE_SAMPLE ? `${PARSE_SAMPLE - parse.n} more replies before it counts`
              : `below the ${PARSE_BAR * 100}% bar`}
          </span>
        </div>
      </div>

      {stats.length > 0 && (
        <table>
          <thead>
            <tr><th>Action</th><th>Decided</th><th>Agreed</th><th>Corrected</th><th>Rejected</th><th>Reworded</th><th>Rate</th></tr>
          </thead>
          <tbody>
            {stats.map(s => (
              <tr key={s.action}>
                <td>{s.action}</td><td>{s.decided}</td><td>{s.agreed}</td><td>{s.corrected}</td>
                <td>{s.rejected}</td><td>{s.edited}</td><td><strong>{pct(s.rate)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {misses.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <strong>Recent misses</strong>
          <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {misses.map((m, i) => (
              <li key={i}>
                <span className="muted">{m.decided_at ? hcmc(m.decided_at) : ''}</span>{' '}
                {m.action} {m.status === 'CORRECTED' ? `→ operator did ${m.executed_action}` : 'rejected'}
                {m.decision_note ? ` - "${m.decision_note}"` : ''}
                <div className="muted">{m.rationale}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats.length === 0 && <p className="muted">No proposals decided yet.</p>}
    </>
  );
}
