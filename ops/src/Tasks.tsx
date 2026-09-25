// What the scheduler has flagged for a person on this request.
//
// The job runner only sends renter-facing messages. Anything involving a
// broker is a human's - the channel is Zalo and Zalo is a human this quarter -
// so those rows sit pending until an operator acts, and this is where they are
// visible. A to-do nobody can see is a to-do nobody does.

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { humanAge } from '../../supabase/functions/_shared/viewing/triage';

interface Job {
  id: string;
  kind: string;
  run_after: string;
  payload: { item_id?: string | null; reason?: string };
}

const LABEL: Record<string, string> = {
  NUDGE_REALTOR: 'Chase the agent',
  RESOLVE_REALTOR: 'Find a working number',
  HOLDING_UPDATE: 'Holding update to the renter',
  VIEWING_REMINDER: 'Viewing reminder',
  CONFIRM_REALTOR: 'Confirm with the agent',
  RELEASE_REALTOR: 'Release the agent',
};

/** Kinds the runner sends by itself - shown for visibility, not as work. */
const AUTOMATED = new Set(['HOLDING_UPDATE', 'VIEWING_REMINDER']);

export function Tasks({ requestId, titleFor }: { requestId: string; titleFor: (itemId: string) => string }) {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('jobs')
        .select('id, kind, run_after, payload')
        .is('completed_at', null)
        .eq('payload->>request_id', requestId)
        .order('run_after', { ascending: true });
      if (!cancelled) setJobs((data ?? []) as Job[]);
    })();
    return () => { cancelled = true; };
  }, [requestId]);

  if (jobs.length === 0) return null;

  return (
    <div className="card">
      <strong>Flagged</strong>
      <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {jobs.map(j => (
          <li key={j.id}>
            {LABEL[j.kind] ?? j.kind}
            {j.payload.item_id ? ` - ${titleFor(j.payload.item_id)}` : ''}
            {j.payload.reason ? ` (${j.payload.reason})` : ''}
            {AUTOMATED.has(j.kind)
              ? <span className="muted"> - sending automatically</span>
              : <span className="muted"> - waiting {humanAge((Date.now() - Date.parse(j.run_after)) / 1000)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
