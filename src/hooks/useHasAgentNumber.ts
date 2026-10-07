import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getPropertySourceLogo } from '@/utils/propertySourceLogos';

// Whether a crawled listing's original ad carries the agent's number - never
// the number itself, which only `reveal_listing_contact` hands over (SPEC §6).
// get-public-property says this as `has_agent_number`. Surfaces that already
// read the listing seed the cache (PropertyDetail); the rest ask once per
// listing, so the request modal's first screen knows whether to offer calling.

export interface AgentNumberInfo {
  hasNumber: boolean;
  /** The marketplace the ad is on, for "Original ad on ...". */
  sourceName?: string;
}

export const agentNumberKey = (listingId: string | undefined) =>
  ['listing-has-agent-number', listingId] as const;

/** getPropertySourceLogo's fallback names no marketplace. */
export function marketplaceName(source: string | null | undefined): string | undefined {
  const name = getPropertySourceLogo(source || '').name;
  return name === 'External Source' ? undefined : name;
}

export function useHasAgentNumber(listingId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: agentNumberKey(listingId),
    enabled: enabled && !!listingId,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<AgentNumberInfo> => {
      const { data } = await supabase.functions.invoke('get-public-property', { body: { id: listingId } });
      if (data?.source !== 'external') return { hasNumber: false };
      return {
        hasNumber: data.property?.has_agent_number === true,
        sourceName: marketplaceName(data.property?.source),
      };
    },
  });
}
