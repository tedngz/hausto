// Every open request of all three kinds, ranked (_shared/viewing/inbox.ts),
// polled for the shell: the Inbox screen lists them and the nav counts them.
//
// The same reads the Queue and Availability screens make - the request list,
// its event log and pending proposals, and `ops_inquiries` - at ~25 requests a
// day small enough to repeat rather than share.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { DomainEvent, InquiryEvent } from '../../supabase/functions/_shared/viewing-domain';
import {
  inquiryInboxRow, sortInbox, viewingInboxRow, type InboxRow,
} from '../../supabase/functions/_shared/viewing/inbox';

interface InquiryRow {
  id: string;
  complex_id: string | null;
  complex_name: string;
  created_at: string;
  last_renter_at: string | null;
  last_ours_at: string | null;
  events: InquiryEvent[];
}

export function useInbox(): { rows: InboxRow[] | null; error: string | null; reload: () => Promise<void> } {
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [{ data: queue, error: qErr }, { data: inquiries, error: iErr }] = await Promise.all([
      supabase.from('ops_request_queue').select('id, ref, created_at').order('created_at', { ascending: false }).limit(200),
      supabase.rpc('ops_inquiries'),
    ]);
    if (qErr || iErr) { setError((qErr ?? iErr)!.message); return; }
    const requests = (queue ?? []) as { id: string; ref: string; created_at: string }[];
    const ids = requests.map(r => r.id);
    const [{ data: events, error: eErr }, { data: pending }] = ids.length
      ? await Promise.all([
        supabase.from('events').select('id, request_id, item_id, type, payload, actor, occurred_at')
          .in('request_id', ids).order('occurred_at', { ascending: true }),
        supabase.from('operator_proposals').select('request_id').eq('status', 'PENDING').in('request_id', ids),
      ])
      : [{ data: [], error: null }, { data: [] }];
    if (eErr) { setError(eErr.message); return; }

    const byRequest = new Map<string, DomainEvent[]>();
    for (const e of (events ?? []) as DomainEvent[]) {
      byRequest.set(e.request_id, [...(byRequest.get(e.request_id) ?? []), e]);
    }
    const proposals = new Map<string, number>();
    for (const p of (pending ?? []) as { request_id: string }[]) {
      proposals.set(p.request_id, (proposals.get(p.request_id) ?? 0) + 1);
    }

    const now = Date.now();
    setRows(sortInbox([
      ...requests.map(r => viewingInboxRow({
        id: r.id, ref: r.ref, createdAt: r.created_at, events: byRequest.get(r.id) ?? [],
        proposals: proposals.get(r.id) ?? 0, now,
      })),
      ...((inquiries ?? []) as InquiryRow[]).map(q => inquiryInboxRow({
        id: q.id, name: q.complex_name, isSearch: !q.complex_id, createdAt: q.created_at, events: q.events,
        lastRenterAt: q.last_renter_at, lastOursAt: q.last_ours_at, now,
      })),
    ]));
    setError(null);
  }, []);

  useEffect(() => {
    void reload();
    // Polled, not subscribed, like the queue: a stale list is what wastes a call.
    const t = setInterval(() => void reload(), 30_000);
    return () => clearInterval(t);
  }, [reload]);

  return { rows, error, reload };
}
