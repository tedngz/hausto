import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Loader2, MessageCircle, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { displayVnPhone, parseReveal, zaloLink, type RevealResult } from '@/lib/agentContact';

interface AgentContactProps {
  listingId: string;
  /** The marketplace the ad is on, e.g. "Batdongsan". */
  sourceName?: string;
  /** Whether the ad carries a number, where the caller already knows (the
   *  listing page reads it with the listing). Left out, it is asked of
   *  get-public-property, which says only that. */
  hasNumber?: boolean;
}

/**
 * The other way to see a place: call the agent yourself, with the number from
 * the original ad (SPEC §6, owner's decision 2026-10-07). It sits directly
 * under "Request viewing" - on the listing page and in the listing preview -
 * as the choice beside it: ask us, or do it yourself.
 *
 * A text link under an "or", never a second button: one way to ask us for a
 * viewing (invariant 8), and this is not asking us. Signed in only, through
 * `reveal_listing_contact`, which logs the look-up. Nothing renders where the
 * ad carries no number; those listings have "Request viewing" alone, and we
 * find the agent.
 *
 * The note under a revealed number is the one place the service is pitched
 * against calling: calling gives the agent your number, asking us does not.
 */
export const AgentContact = ({ listingId, sourceName, hasNumber }: AgentContactProps) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RevealResult | null>(null);

  const { data: fetchedHasNumber } = useQuery({
    queryKey: ['listing-has-agent-number', listingId],
    enabled: hasNumber === undefined,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<boolean> => {
      const { data } = await supabase.functions.invoke('get-public-property', { body: { id: listingId } });
      return data?.source === 'external' && data?.property?.has_agent_number === true;
    },
  });
  const shown = hasNumber ?? fetchedHasNumber ?? false;

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

  if (!shown) return null;

  const or = (
    <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-muted-foreground" aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );

  if (result?.ok) {
    const zalo = zaloLink(result.phoneE164);
    return (
      <section aria-label="The agent's number" className="mt-3 text-center">
        {or}
        <p className="mt-2.5 text-[12px] text-muted-foreground">The agent's number, from the ad</p>
        <a
          href={`tel:${result.phoneE164}`}
          className="inline-block font-serif text-xl tracking-tight text-foreground hover:text-primary"
        >
          {displayVnPhone(result.phoneE164)}
        </a>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 rounded-full">
            <a href={`tel:${result.phoneE164}`}>
              <Phone className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Call
            </a>
          </Button>
          {zalo && (
            <Button asChild variant="outline" size="sm" className="h-8 rounded-full">
              <a href={zalo} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Zalo
              </a>
            </Button>
          )}
          {result.sourceUrl && (
            <Button asChild variant="ghost" size="sm" className="h-8 rounded-full text-muted-foreground">
              <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {/* getPropertySourceLogo's fallback names no marketplace. */}
                {sourceName && sourceName !== 'External Source' ? `Original ad on ${sourceName}` : 'Original ad'}
              </a>
            </Button>
          )}
        </div>
        <p className="mx-auto mt-2.5 max-w-md text-[12px] leading-relaxed text-muted-foreground [text-wrap:balance]">
          When you call or message, the agent gets your number, and many agents speak only Vietnamese.
          Rather skip that? Request a viewing above - we ask the agent for you, and your number never
          reaches them.
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
        : null;

  return (
    <section aria-label="Contact the agent yourself" className="mt-3 text-center">
      {or}
      {refusalText ? (
        <p className="mt-2.5 text-[12.5px] text-muted-foreground [text-wrap:balance]">{refusalText}</p>
      ) : (
        <p className="mt-2.5 text-[13px] text-muted-foreground [text-wrap:balance]">
          Call the agent yourself - this ad lists their number.{' '}
          <button
            type="button"
            onClick={user ? reveal : signIn}
            disabled={loading}
            className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline disabled:opacity-60"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {user ? 'Show the number' : 'Sign in to see it'}
          </button>
          {refusal === 'error' && (
            <span className="block text-[12px]">We could not load the number just now. Try again in a moment.</span>
          )}
        </p>
      )}
    </section>
  );
};
