import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Loader2, MessageCircle, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { displayVnPhone, parseReveal, zaloLink, type RevealResult } from '@/lib/agentContact';

interface AgentContactProps {
  listingId: string;
  /** The marketplace the ad is on, e.g. "Batdongsan". */
  sourceName?: string;
}

/**
 * The agent's number from the original ad, for a renter who would rather call
 * than have us ask (SPEC §6, owner's decision 2026-10-07). It sits under the
 * card's "Request viewing" as the way out, never beside it: one way to ask us
 * for a viewing (invariant 8), and this is not asking us.
 *
 * Signed in only, through `reveal_listing_contact`, which logs the look-up.
 * Rendered only where the ad carries a number (`has_agent_number`); the rest
 * of the catalogue has "Request viewing" alone, and we find the agent.
 *
 * The note under the number is the one place the service is pitched against
 * calling: calling gives the agent your number, asking us does not.
 */
export const AgentContact = ({ listingId, sourceName }: AgentContactProps) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RevealResult | null>(null);

  const signIn = () =>
    navigate('/auth', { state: { returnTo: `/property/${listingId}` } });

  const reveal = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('reveal_listing_contact', { _listing_id: listingId });
      const parsed = error ? ({ ok: false, reason: 'error' } as const) : parseReveal(data);
      if ('reason' in parsed && parsed.reason === 'sign_in') {
        signIn();
        return;
      }
      setResult(parsed);
    } finally {
      setLoading(false);
    }
  };

  if (result?.ok) {
    const zalo = zaloLink(result.phoneE164);
    return (
      <section aria-label="The agent's number" className="mt-4 rounded-2xl border border-border bg-card/70 p-4 sm:p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">The agent's number, from the ad</p>
        <a
          href={`tel:${result.phoneE164}`}
          className="mt-1 inline-block font-serif text-2xl tracking-tight text-foreground hover:text-primary"
        >
          {displayVnPhone(result.phoneE164)}
        </a>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <a href={`tel:${result.phoneE164}`}>
              <Phone className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Call
            </a>
          </Button>
          {zalo && (
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <a href={zalo} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Zalo
              </a>
            </Button>
          )}
          {result.sourceUrl && (
            <Button asChild variant="ghost" size="sm" className="rounded-full text-muted-foreground">
              <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {sourceName ? `Original ad on ${sourceName}` : 'Original ad'}
              </a>
            </Button>
          )}
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
          When you call or message, the agent gets your number, and many agents speak only Vietnamese.
          If you would rather skip that, request a viewing above - we ask the agent for you, and your
          number never reaches them.
        </p>
      </section>
    );
  }

  const refusal = result && 'reason' in result ? result.reason : null;
  const refusalText =
    refusal === 'daily_limit'
      ? 'You have looked up a lot of numbers today. Try again tomorrow, or request a viewing and we will ask the agent for you.'
      : refusal === 'no_number' || refusal === 'unknown_listing'
        ? 'This ad no longer lists a number. Request a viewing and we will find the agent for you.'
        : refusal === 'error'
          ? 'We could not load the number just now. Try again in a moment.'
          : null;

  return (
    <section aria-label="Contact the agent yourself" className="mt-4 flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Rather call the agent yourself?</p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          {refusalText ?? (user ? 'This ad lists the agent\'s number.' : 'This ad lists the agent\'s number. Sign in to see it.')}
        </p>
      </div>
      {refusal !== 'daily_limit' && refusal !== 'no_number' && refusal !== 'unknown_listing' && (
        <Button
          variant="outline"
          size="sm"
          // Compact on a phone too: full width, it would read as a second
          // "Request viewing".
          className="shrink-0 self-start rounded-full sm:self-auto"
          onClick={user ? reveal : signIn}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : user ? 'Show the number' : 'Sign in to see it'}
        </Button>
      )}
    </section>
  );
};
