// Every request, all three kinds, for admins - read-only.
//
// Viewing requests, availability requests for a building, and priority
// searches (an area), ranked by what needs a person first
// (`_shared/viewing/inbox.ts`, the same order as the ops console's Inbox and
// the digest email). Each row opens the request in the console, which is where
// it is worked.
//
// Read-only on purpose (CLAUDE.md invariant 9): status is derived from the
// event logs, and outcomes are the seven fixed actions in the console. A
// confirm or cancel button here would be a second, untyped write path.
//
// **Admin scope only.** A viewing row shows the renter's name and number,
// which an operator needs to do the job and an agent must never see
// (invariant 4). The realtor dashboard shows nothing from here.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Inbox, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DomainEvent, InquiryEvent } from '../../../supabase/functions/_shared/viewing-domain.ts';
import {
  KIND_LABEL, consoleLink, inquiryInboxRow, sortInbox, viewingInboxRow,
  type InboxKind, type InboxRow,
} from '../../../supabase/functions/_shared/viewing/inbox.ts';
import { CONSOLE_URL } from '../../../supabase/functions/_shared/viewing/ops-alert.ts';

/**
 * `integrations/supabase/types.ts` predates the viewing domain, so these
 * tables and the rpc are absent from its unions. One narrow cast; the shapes
 * are checked at the call sites below.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface ViewingRow {
  id: string;
  ref: string;
  created_at: string;
  renters: { display_name: string | null; phone_e164: string } | null;
  request_items: { id: string }[];
}

interface InquiryRow {
  id: string;
  complex_id: string | null;
  complex_name: string;
  created_at: string;
  last_renter_at: string | null;
  last_ours_at: string | null;
  events: InquiryEvent[];
}

type Row = InboxRow & { renter?: string; places?: number };

const KIND_TONE: Record<InboxKind, string> = {
  VIEWING: 'bg-primary/10 text-primary',
  BUILDING: 'bg-sky-100 text-sky-900',
  SEARCH: 'bg-violet-100 text-violet-900',
};
const URGENCY_TONE = { LATE: 'text-destructive font-semibold', WARN: 'text-amber-700 font-medium', OK: 'text-muted-foreground' };

function since(iso: string): string {
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? 'just now' : h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function clock(row: Row): string {
  if (!row.dueAt) return since(row.createdAt);
  const left = Math.round((Date.parse(row.dueAt) - Date.now()) / 3_600_000);
  return left <= 0 ? `${-left}h over` : `${left}h left`;
}

export const RequestsOverview = () => {
  const [kind, setKind] = useState<InboxKind | 'ALL'>('ALL');
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading, error } = useQuery<Row[]>({
    queryKey: ['admin-requests-overview'],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [{ data: requests, error: rErr }, { data: inquiries, error: iErr }] = await Promise.all([
        db.from('viewing_requests')
          .select('id, ref, created_at, renters(display_name, phone_e164), request_items(id)')
          .gte('created_at', since).order('created_at', { ascending: false }).limit(200),
        db.rpc('ops_inquiries'),
      ]);
      if (rErr) throw new Error(rErr.message);
      const rows = (requests ?? []) as ViewingRow[];
      const ids = rows.map(r => r.id);
      const [{ data: events }, { data: pending }] = ids.length
        ? await Promise.all([
          db.from('events').select('id, request_id, item_id, type, payload, actor, occurred_at')
            .in('request_id', ids).order('occurred_at', { ascending: true }),
          db.from('operator_proposals').select('request_id').eq('status', 'PENDING').in('request_id', ids),
        ])
        : [{ data: [] }, { data: [] }];

      const byRequest = new Map<string, DomainEvent[]>();
      for (const e of (events ?? []) as DomainEvent[]) byRequest.set(e.request_id, [...(byRequest.get(e.request_id) ?? []), e]);
      const proposals = new Map<string, number>();
      for (const p of (pending ?? []) as { request_id: string }[]) proposals.set(p.request_id, (proposals.get(p.request_id) ?? 0) + 1);

      const now = Date.now();
      const viewing: Row[] = rows.map(r => ({
        ...viewingInboxRow({
          id: r.id, ref: r.ref, createdAt: r.created_at, events: byRequest.get(r.id) ?? [],
          proposals: proposals.get(r.id) ?? 0, now,
        }),
        renter: [r.renters?.display_name, r.renters?.phone_e164].filter(Boolean).join(' · '),
        places: r.request_items?.length ?? 0,
      }));
      // Building requests need the ops or admin role; a failure leaves the
      // viewing side standing rather than taking the panel down.
      const availability: Row[] = iErr ? [] : ((inquiries ?? []) as InquiryRow[]).map(q => inquiryInboxRow({
        id: q.id, name: q.complex_name, isSearch: !q.complex_id, createdAt: q.created_at, events: q.events,
        lastRenterAt: q.last_renter_at, lastOursAt: q.last_ours_at, now,
      }));
      return sortInbox([...viewing, ...availability]) as Row[];
    },
  });

  const rows = useMemo(() => data ?? [], [data]);
  const work = rows.filter(r => r.actionable);
  const count = (k: InboxKind) => work.filter(r => r.kind === k).length;
  const late = work.filter(r => r.urgency === 'LATE').length;
  const soon = work.filter(r => r.urgency === 'WARN').length;
  const visible = (showAll ? rows : work).filter(r => kind === 'ALL' || r.kind === kind);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="h-5 w-5" /> Requests
            </CardTitle>
            <CardDescription className="mt-1">
              Viewing requests, building availability and area searches - what needs a person first.
              Worked in the ops console; a digest email goes to everyone with the ops role.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" asChild>
            <a href={CONSOLE_URL} target="_blank" rel="noreferrer">
              Open ops console <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            { n: late, label: 'late', tone: late ? 'border-destructive/40 bg-destructive/5 text-destructive' : '' },
            { n: soon, label: 'due soon', tone: soon ? 'border-amber-300 bg-amber-50 text-amber-800' : '' },
            { n: count('VIEWING'), label: 'viewing requests', tone: '' },
            { n: count('BUILDING'), label: 'building requests', tone: '' },
            { n: count('SEARCH'), label: 'area searches', tone: '' },
          ].map(t => (
            <div key={t.label} className={cn('rounded-lg border px-3 py-2', t.tone)}>
              <div className="text-xl font-semibold leading-tight">{t.n}</div>
              <div className="text-xs text-muted-foreground">{t.label}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['ALL', 'VIEWING', 'BUILDING', 'SEARCH'] as const).map(k => (
            <Button key={k} size="sm" variant={kind === k ? 'default' : 'outline'} className="h-7 rounded-full px-3 text-xs"
              onClick={() => setKind(k)}>
              {k === 'ALL' ? `All (${work.length})` : `${KIND_LABEL[k]} (${count(k)})`}
            </Button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
            show waiting and closed
          </label>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : visible.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Nothing waiting on us.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Request</th>
                  <th className="px-3 py-2">Waiting on</th>
                  <th className="px-3 py-2">Clock</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map(r => (
                  <tr key={`${r.kind}:${r.id}`} className={cn(!r.actionable && 'text-muted-foreground')}>
                    <td className="px-3 py-2">
                      <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', KIND_TONE[r.kind])}>
                        {KIND_LABEL[r.kind]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.state.toLowerCase().replace(/_/g, ' ')}
                        {r.places ? ` · ${r.places} place${r.places === 1 ? '' : 's'}` : ''}
                        {r.renter ? ` · ${r.renter}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2">{r.waitingOn}</td>
                    <td className={cn('whitespace-nowrap px-3 py-2', URGENCY_TONE[r.urgency])}>{clock(r)}</td>
                    <td className="px-3 py-2 text-right">
                      <a href={consoleLink(r.kind, r.id)} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                        Work it <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
