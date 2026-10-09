import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface DeepAnalysis {
  design?: string;
  lifestyle_fit?: string;
  downsides?: string[];
  neighbourhood?: { rating?: number; note?: string };
  commute?: { rating?: number; note?: string };
  worth_viewing?: string;
}

export type PropertyType = 'internal' | 'external';

/**
 * The Deep scan for one listing, for this renter.
 *
 * Two halves on purpose. The query is a plain table read - a read already paid
 * for stays readable after the pass lapses, so it must not depend on holding
 * one. Generating is the mutation, and that is what the pass buys; the edge
 * function refuses with PASS_REQUIRED otherwise.
 *
 * The cache key deliberately omits preferences: the fingerprint that decides a
 * hit lives server-side, so the client can't disagree with it about what counts
 * as the same read.
 */
export const useDeepAnalysis = (propertyId?: string, propertyType: PropertyType = 'internal') => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: stored, isLoading } = useQuery({
    queryKey: ['deep-analysis', user?.id, propertyId, propertyType],
    queryFn: async () => {
      const { data } = await supabase
        .from('listing_deep_analyses')
        .select('analysis, created_at')
        .eq('renter_id', user!.id)
        .eq('property_id', propertyId!)
        .eq('property_type', propertyType)
        .order('created_at', { ascending: false })
        .limit(1);
      const row = data?.[0];
      return row
        ? { analysis: row.analysis as DeepAnalysis, generatedAt: row.created_at as string }
        : null;
    },
    enabled: !!user?.id && !!propertyId,
  });

  const generate = async (): Promise<boolean> => {
    if (!user?.id || !propertyId) return false;
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('deep-vibe-analysis', {
        headers: {
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: { propertyId, propertyType },
      });

      const failure = data?.error ?? (error ? 'REQUEST_FAILED' : null);
      if (failure) {
        // Each of these wants a different next move from the renter, so none of
        // them collapse into "something went wrong".
        const messages: Record<string, string> = {
          PASS_REQUIRED: 'A Hausto Pass unlocks the Deep scan on every listing.',
          NO_IMAGES: "This listing has no photos, so there's nothing to read yet.",
          BUDGET_EXHAUSTED: "We've hit today's analysis limit - try again tomorrow.",
        };
        toast.error(messages[failure] ?? 'Could not generate the analysis. Please try again.');
        return false;
      }

      queryClient.invalidateQueries({ queryKey: ['deep-analysis', user.id, propertyId, propertyType] });
      return true;
    } catch (err) {
      console.error('Deep analysis failed:', err);
      toast.error('Could not generate the analysis. Please try again.');
      return false;
    } finally {
      setIsGenerating(false);
    }
  };

  return {
    analysis: stored?.analysis ?? null,
    generatedAt: stored?.generatedAt ?? null,
    isLoading,
    isGenerating,
    generate,
  };
};
