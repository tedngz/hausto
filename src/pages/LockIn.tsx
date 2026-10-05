// The lock-in page: the one paid step (the pricing rework, SPEC §9).
//
// The plan's WhatsApp message links here. It shows the plan - each place, its
// day and time, its price, never an agent - and the deadline, and offers the
// two ways to lock it in: the free viewing on one place, or the Pass for all
// of them. Lock-in is confirmed here, on the web; nothing is sent on WhatsApp,
// because paying is not a reply and a "locked in" message would make the
// morning-of message a third in a row.
//
// "Booked" is not a word this page uses (invariant 6), before lock-in or after.

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePass } from '@/hooks/usePass';
import { cn } from '@/lib/utils';
import { formatVnd, hcmcLong } from '../../supabase/functions/_shared/viewing/format.ts';

interface PlanStop {
  itemId: string;
  title: string;
  districtCode: string | null;
  priceVnd: number;
  startsAt: string;
}

interface Plan {
  ref: string;
  status: 'NOT_READY' | 'OPEN' | 'PAYING' | 'LAPSED' | 'LOCKED_IN' | 'CLOSED';
  statusMessage: string | null;
  deadline: string | null;
  stops: PlanStop[];
  hasPass: boolean;
  freeViewingAvailable: boolean;
  lockedIn: { cover: 'PASS' | 'FREE_VIEWING' | null; itemIds: string[] } | null;
  pass: { priceUsd: number; days: number };
}

/** The body of a refusal, which says what to tell the renter. */
async function refusalOf(err: unknown): Promise<string> {
  const ctx = (err as { context?: Response }).context;
  const body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
  return body?.message ?? 'Something went wrong on our side. Try again in a moment.';
}

export default function LockIn() {
  const { ref = '' } = useParams<{ ref: string }>();
  const { user, loading: authLoading } = useAuth();
  const { purchasePass } = usePass();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<'free' | 'pass' | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: plan, isLoading, error: loadError } = useQuery<Plan>({
    queryKey: ['lock-in', ref, user?.id],
    enabled: !!user && !!ref,
    retry: false,
    queryFn: async () => {
      const { data, error: err } = await supabase.functions.invoke('viewing-lock-in', {
        body: { ref, action: 'view' },
      });
      if (err) throw new Error(await refusalOf(err));
      return data as Plan;
    },
  });

  const lock = async (cover: 'PASS' | 'FREE_VIEWING', itemId?: string) => {
    setError(null);
    setBusy(cover === 'PASS' ? 'all' : 'free');
    const { error: err } = await supabase.functions.invoke('viewing-lock-in', {
      body: { ref, action: 'lock', cover, ...(itemId ? { itemId } : {}) },
    });
    setBusy(null);
    if (err) setError(await refusalOf(err));
    queryClient.invalidateQueries({ queryKey: ['lock-in', ref] });
  };

  const buyPass = async () => {
    setError(null);
    setBusy('pass');
    // Hands off to Polar's checkout; the plan is held while it is open and
    // locked in when the payment is recorded, even if they never come back.
    await purchasePass(ref);
    setBusy(null);
  };

  if (!authLoading && !user) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold mb-2">Sign in to see your plan</h1>
        <p className="text-muted-foreground mb-6">Plan {ref} lives on the account that requested it.</p>
        <Button asChild size="lg"><Link to="/auth" state={{ returnTo: `/lock-in/${ref}` }}>Sign in</Link></Button>
      </Shell>
    );
  }

  if (authLoading || isLoading) {
    return (
      <Shell>
        <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
      </Shell>
    );
  }

  if (loadError || !plan) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold mb-2">We could not open {ref}</h1>
        <p className="text-muted-foreground mb-6">{(loadError as Error)?.message ?? 'Try again in a moment.'}</p>
        <Button asChild variant="outline"><Link to="/hub">Back to your search</Link></Button>
      </Shell>
    );
  }

  const n = plan.stops.length;
  const single = n === 1 ? plan.stops[0].itemId : null;
  const chosen = picked ?? single;
  const kept = new Set(plan.lockedIn?.itemIds ?? []);

  return (
    <Shell wide>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Plan {plan.ref}</p>
      <h1 className="text-2xl font-bold mt-1 mb-1">
        {plan.status === 'LOCKED_IN'
          ? 'Locked in'
          : n > 0
            ? `${n} ${n === 1 ? 'place is' : 'places are'} free to view`
            : 'Your plan'}
      </h1>
      {plan.status === 'OPEN' && plan.deadline && (
        <p className="text-sm text-muted-foreground mb-4">
          Lock in by {hcmcLong(plan.deadline)}. After that the agents are told to stop holding these times.
        </p>
      )}
      {plan.statusMessage && plan.status !== 'OPEN' && plan.status !== 'LOCKED_IN' && (
        <p className="text-sm text-muted-foreground mb-4">{plan.statusMessage}</p>
      )}

      {n > 0 && (
        <ul className="space-y-2 text-left mb-6">
          {plan.stops.map(stop => {
            const pickable = plan.status === 'OPEN' && !plan.hasPass && plan.freeViewingAvailable && n > 1;
            const isKept = plan.status === 'LOCKED_IN' && kept.has(stop.itemId);
            return (
              <li key={stop.itemId}>
                <button
                  type="button"
                  disabled={!pickable}
                  onClick={() => setPicked(stop.itemId)}
                  aria-pressed={pickable ? chosen === stop.itemId : undefined}
                  className={cn(
                    'w-full rounded-md border p-3 text-left transition-colors',
                    pickable && 'hover:bg-muted',
                    pickable && chosen === stop.itemId && 'border-primary bg-primary/5',
                    plan.status === 'LOCKED_IN' && !isKept && 'opacity-50',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{stop.title}</p>
                      <p className="text-sm text-muted-foreground">{hcmcLong(stop.startsAt)}</p>
                    </div>
                    <div className="text-right text-sm">
                      <p>{formatVnd(stop.priceVnd)}/month</p>
                      {stop.districtCode && <p className="text-muted-foreground">{stop.districtCode}</p>}
                    </div>
                  </div>
                  {isKept && <p className="mt-1 text-xs text-primary">Locked in</p>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {plan.status === 'OPEN' && (
        <div className="space-y-3">
          {plan.hasPass ? (
            <>
              <Button className="w-full" size="lg" disabled={!!busy} onClick={() => void lock('PASS')}>
                {busy === 'all' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Lock in {n === 1 ? 'this viewing' : `all ${n}`}
              </Button>
              <p className="text-xs text-muted-foreground">Your Pass covers every viewing we confirm.</p>
            </>
          ) : (
            <>
              {plan.freeViewingAvailable && (
                <Button
                  className="w-full" size="lg" variant={n > 1 ? 'outline' : 'default'}
                  disabled={!!busy || !chosen}
                  onClick={() => chosen && void lock('FREE_VIEWING', chosen)}
                >
                  {busy === 'free' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {!chosen
                    ? 'Pick the place for your free viewing'
                    : `Lock in ${plan.stops.find(s => s.itemId === chosen)?.title ?? 'it'} - free`}
                </Button>
              )}
              <Button
                className="w-full" size="lg" variant={plan.freeViewingAvailable && n === 1 ? 'outline' : 'default'}
                disabled={!!busy} onClick={() => void buyPass()}
              >
                {busy === 'pass' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Get the Pass (${plan.pass.priceUsd} for {plan.pass.days} days) and lock in {n === 1 ? 'it' : `all ${n}`}
              </Button>
              <p className="text-xs text-muted-foreground">
                {plan.freeViewingAvailable
                  ? 'Your first viewing is on us, once per WhatsApp number. The Pass covers every viewing we confirm for its 30 days. One-off payment, nothing recurring.'
                  : 'Your free viewing has been used. The Pass covers every viewing we confirm for its 30 days. One-off payment, nothing recurring.'}
              </p>
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}

      {plan.status === 'LOCKED_IN' && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-left text-sm">
            <CheckCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <p>
              We tell the {kept.size === 1 ? 'agent' : 'agents'} to expect you. On the morning of each viewing we
              send where to meet on WhatsApp.
            </p>
          </div>
          <Button asChild variant="outline" className="w-full"><Link to="/hub">Back to your search</Link></Button>
        </div>
      )}

      {plan.status !== 'OPEN' && plan.status !== 'LOCKED_IN' && (
        <Button asChild variant="outline" className="w-full"><Link to="/hub">Back to your search</Link></Button>
      )}
    </Shell>
  );
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className={cn('w-full text-center', wide ? 'max-w-lg' : 'max-w-md')}>{children}</div>
    </div>
  );
}
