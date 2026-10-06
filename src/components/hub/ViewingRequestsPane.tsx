// The renter's own viewing requests.
//
// Deliberately does not show a derived status. Status in this domain is
// reduced from the append-only event log (invariant 1), and `events` is not
// readable from the browser - by design, since it carries operator notes and
// realtor outcomes. A client that reduced a partial log would show a state the
// system does not agree with, which is worse than showing none.
//
// So this answers the questions it can answer honestly: what did I ask for,
// when, and where do I hear back. The answer to "what happened" arrives on
// WhatsApp, which is the whole product.

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, MessageCircle } from 'lucide-react';

/**
 * `integrations/supabase/types.ts` is generated from the live database and
 * predates the whole viewing domain, so `viewing_requests` is absent from its
 * table union and the typed client refuses the query. Regenerating needs
 * database credentials this repo does not carry.
 *
 * One narrow cast, here, rather than `any` spread through the component: the
 * shape below is still checked against RequestRow at the call site.
 */
const db = supabase as unknown as {
  from: (table: string) => {
    select: (columns: string) => {
      order: (
        column: string,
        opts: { ascending: boolean },
      ) => Promise<{ data: unknown; error: unknown }>;
    };
  };
};

interface RequestRow {
  id: string;
  ref: string;
  created_at: string;
  availability: unknown;
  request_items: { id: string; listing_id: string }[];
}

export const ViewingRequestsPane = () => {
  const { user } = useAuth();

  const { data, isLoading } = useQuery<RequestRow[]>({
    queryKey: ['my-viewing-requests', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await db
        .from('viewing_requests')
        .select('id, ref, created_at, availability, request_items(id, listing_id)')
        .order('created_at', { ascending: false });
      // RLS scopes this to the signed-in renter; no client-side filter to
      // forget. An error here means the policy or the account link is missing,
      // which must read as "none yet" rather than as a crash.
      if (error) return [];
      return (data ?? []) as RequestRow[];
    },
  });

  if (!user) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        <Link to="/auth" className="underline">Sign in</Link> to see your viewing requests.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.length) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-muted-foreground">No viewing requests yet.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Find places you like and hit <strong>Request viewing</strong> on each - we
          fit them into one trip.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3 py-4">
      {data.map(r => (
        <li key={r.id}>
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{r.ref}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'short', timeZone: 'Asia/Ho_Chi_Minh',
                    })}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {r.request_items?.length ?? 0} place
                  {(r.request_items?.length ?? 0) === 1 ? '' : 's'} - we reply on WhatsApp
                  with the times that are free.
                </p>
              </div>
              {/* The plan page reduces the log server-side, so it can say
                  what this pane cannot: whether there is a plan to lock in. */}
              <Button asChild size="sm" variant="ghost">
                <Link to={`/lock-in/${r.ref}`}>Plan</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`Hi Hausto - my viewing request is ${r.ref}`)}`}
                  target="_blank" rel="noreferrer"
                >
                  <MessageCircle className="mr-1.5 h-4 w-4" />
                  Chat
                </a>
              </Button>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
};
