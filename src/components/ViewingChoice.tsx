import { CalendarCheck, Loader2, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AgentNumber } from '@/components/AgentContact';
import { useAgentReveal } from '@/hooks/useAgentReveal';
import { PASS_DAYS, PASS_PRICE_USD } from '../../supabase/functions/_shared/viewing/lock-in.ts';

interface ViewingChoiceProps {
  listingId: string;
  title: string;
  hasPass: boolean;
  /** The marketplace the ad is on, for "Original ad on ...". */
  sourceName?: string;
  /** "We arrange it": on to the request's own steps. */
  onArrange: () => void;
}

/**
 * The first screen of RequestViewingModal for one place whose ad lists the
 * agent's number: how does the renter want to see it? (SPEC §6, owner's
 * decision 2026-10-07.) We arrange it - the Pass's, with one free place per
 * WhatsApp number (requestGate) - or they call the agent themselves, free,
 * with the number from the ad.
 *
 * Still one button on the card (invariant 8): the choice is behind it, not
 * beside it. "We arrange it" comes first and carries the primary button,
 * because it is what Hausto is for; calling says what it costs the renter -
 * the agent gets their number.
 */
export function ViewingChoice({ listingId, title, hasPass, sourceName, onArrange }: ViewingChoiceProps) {
  const { signedIn, loading, result, reveal, refusal, refusalText } = useAgentReveal(listingId);
  const revealed = result?.ok ? result : null;
  const canAsk = !revealed && refusal !== 'daily_limit' && refusal !== 'no_number' && refusal !== 'unknown_listing';

  return (
    <>
      <DialogHeader className="shrink-0 space-y-1 border-b p-4 text-left sm:p-6 sm:pb-4">
        <DialogTitle>How do you want to see it?</DialogTitle>
        <DialogDescription className="line-clamp-1 text-xs sm:text-sm">{title}</DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-6">
        <section className="rounded-xl border border-primary bg-primary/5 p-4">
          <div className="flex items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            <h3 className="text-sm font-semibold">We arrange it</h3>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            We check with the agent in the local language and send you a plan on WhatsApp. They never
            get your number.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {hasPass
              ? 'Your Pass covers every viewing we arrange.'
              : `Your first viewing is free. After that, it takes the Pass ($${PASS_PRICE_USD} for ${PASS_DAYS} days).`}
          </p>
          <Button className="mt-3 w-full rounded-full" onClick={onArrange}>
            Request a viewing
          </Button>
        </section>

        <section className="rounded-xl border p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-sm font-semibold">Call the agent yourself</h3>
            </div>
            <span className="text-xs font-medium text-muted-foreground">Free</span>
          </div>

          {revealed ? (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-muted-foreground">The agent's number, from the ad</p>
              <AgentNumber phoneE164={revealed.phoneE164} sourceUrl={revealed.sourceUrl} sourceName={sourceName} />
              <p className="text-xs text-muted-foreground">
                When you call or message, the agent gets your number. Rather not? Request a viewing above.
              </p>
            </div>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {refusalText
                  ?? 'They get your number when you call, and many speak only the local language.'}
              </p>
              {canAsk && (
                <Button
                  variant="outline"
                  className="mt-3 w-full rounded-full"
                  onClick={() => void reveal()}
                  disabled={loading}
                >
                  {loading
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : signedIn ? 'Show the number' : 'Sign in to see it'}
                </Button>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
