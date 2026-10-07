import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { parseReveal, type RevealResult } from '@/lib/agentContact';

// The one caller of `reveal_listing_contact` (SPEC §6): the "Call the agent
// yourself" half of ViewingChoice, the first screen of RequestViewingModal for
// a place whose ad lists a number. Signed in and logged; nothing else in the
// renter app reads an agent's number.

/** Reveals the ad's number for one listing; a signed-out renter is sent to sign in. */
export function useAgentReveal(listingId: string | undefined) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RevealResult | null>(null);

  const signIn = () =>
    navigate('/auth', { state: { returnTo: listingId ? `/property/${listingId}` : window.location.pathname } });

  const reveal = async () => {
    if (!listingId) return;
    if (!user) {
      signIn();
      return;
    }
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

  const refusal = result && 'reason' in result ? result.reason : null;
  const refusalText =
    refusal === 'daily_limit'
      ? 'You have looked up a lot of numbers today. Try again tomorrow, or let us arrange it.'
      : refusal === 'no_number' || refusal === 'unknown_listing'
        ? 'This ad no longer lists a number. Let us arrange it and we will find the agent.'
        : refusal === 'error'
          ? 'We could not load the number just now. Try again in a moment.'
          : null;

  return { signedIn: !!user, loading, result, reveal, refusal, refusalText };
}
