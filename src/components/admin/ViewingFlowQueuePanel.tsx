// New-flow viewing requests, for operators only.
//
// Two request systems exist while Fast-Track winds down, and they are not
// interchangeable:
//
//   fast_track_requests  - the retired renter surface. Acted on in
//                          ViewingRequestsManager, which confirms/cancels and
//                          emails the renter.
//   viewing_requests     - the WhatsApp coordination flow. Status is DERIVED
//                          from an append-only event log, and outcomes are the
//                          seven fixed actions in the ops console (SPEC §4).
//
// So this panel deliberately does not act on anything. Adding confirm/cancel
// buttons here would mean writing status directly, which invariant 1 forbids -
// every transition goes through the event log - and free-texting an outcome,
// which invariant 2 forbids, because the seven fixed outcomes are how we
// generate the training data to automate the realtor side later.
//
// **Admin scope only, and that is a privacy boundary rather than a convenience
// one.** This shows the renter's name and number, which operators need to do
// the job. Invariant 4: never expose either to the realtor view. The realtor
// dashboard keeps showing Fast-Track history and nothing from here.

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarClock, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface FlowRequest {
  id: string;
  ref: string;
  created_at: string;
  availability: { date: string; part: string }[] | null;
  renters: { display_name: string | null; phone_e164: string } | null;
  request_items: { id: string }[];
}

/**
 * `integrations/supabase/types.ts` is generated from the live database and
 * predates this domain, so `viewing_requests` is absent from its table union.
 * One narrow cast rather than `any`; regenerating needs credentials this repo
 * does not carry.
 */
const db = supabase as unknown as {
  from: (table: string) => {
    select: (columns: string) => {
      order: (
        column: string,
        opts: { ascending: boolean },
      ) => {
        limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
};

export const ViewingFlowQueuePanel = () => {
  const { data, isLoading } = useQuery<FlowRequest[]>({
    queryKey: ['ops-viewing-flow-requests'],
    // Operators work this queue live; a five-minute cache would have them
    // acting on a request somebody else already picked up.
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await db
        .from('viewing_requests')
        .select('id, ref, created_at, availability, renters(display_name, phone_e164), request_items(id)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) return [];
      return (data ?? []) as FlowRequest[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="w-5 h-5" />
          WhatsApp viewing requests
        </CardTitle>
        <CardDescription>
          Requests from the new viewing flow. Read-only here - record outcomes in
          the ops console, where the seven actions write to the event log.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No requests through the viewing flow yet.
          </p>
        ) : (
          <ul className="divide-y">
            {data.map(r => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                <span className="font-mono text-sm font-semibold">{r.ref}</span>
                <span className="text-sm">
                  {r.renters?.display_name || 'No name given'}
                </span>
                <span className="text-sm text-muted-foreground">{r.renters?.phone_e164}</span>
                <Badge variant="secondary">
                  {r.request_items?.length ?? 0} listing
                  {(r.request_items?.length ?? 0) === 1 ? '' : 's'}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {(r.availability ?? []).length} window
                  {(r.availability ?? []).length === 1 ? '' : 's'}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString('en-GB', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    timeZone: 'Asia/Ho_Chi_Minh',
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};
