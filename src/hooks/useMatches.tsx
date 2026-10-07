import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useUsageTracking } from '@/hooks/useUsageTracking';
import { toast as sonnerToast } from 'sonner';

export interface PropertyMatch {
  id: string;
  renter_id: string;
  property_id: string;
  realtor_id: string;
  property_type: string;
  created_at: string;
  updated_at: string;
  renter_name?: string;
  realtor_name?: string;
  renter_avatar?: string;
  realtor_avatar?: string;
  properties?: {
    id: string;
    title: string;
    location: string;
    price: number;
    vibe: string | null;
    images: string[] | null;
    description?: string;
    highlights?: string[];
    size?: string;
    realtor_id?: string;
    vibe_analysis?: any;
    amenities?: string[];
    property_source_link?: string;
    property_source_provider_name?: string;
    property_source_provider_phone?: string;
    source_url?: string;
    contact_name?: string;
    contact_phone?: string;
  };
}

// Helper to enrich matches with property data from both tables
async function enrichMatchesWithProperties(matches: any[]): Promise<any[]> {
  if (!matches || matches.length === 0) return matches;

  const internalIds = matches.filter(m => m.property_type !== 'external').map(m => m.property_id);
  const externalIds = matches.filter(m => m.property_type === 'external').map(m => m.property_id);

  // No agent contact or source link, matched or not: a crawled ad's number is
  // for a signed-in renter through AgentContact (`reveal_listing_contact`), and
  // nowhere else (CLAUDE.md invariant 4). The fields stay on the shape, empty,
  // so the screens that read them need no change.
  const [internalResult, externalResult] = await Promise.all([
    internalIds.length > 0
      ? supabase.from('properties').select('id, title, location, price, vibe, images, description, highlights, size, realtor_id, vibe_analysis, amenities').in('id', internalIds)
      : Promise.resolve({ data: [] }),
    externalIds.length > 0
      ? supabase.from('external_properties').select('id, title, location, price, vibe, images, description, highlights, size, vibe_analysis, amenities, source').in('id', externalIds)
      : Promise.resolve({ data: [] }),
  ]);

  const propertyMap = new Map<string, any>();
  (internalResult.data || []).forEach(p => {
    propertyMap.set(p.id, {
      ...p,
      property_source_link: null,
      property_source_provider_name: null,
      property_source_provider_phone: null,
      _type: 'internal',
    });
  });
  (externalResult.data || []).forEach(p => {
    propertyMap.set(p.id, {
      id: p.id,
      title: p.title,
      location: p.location,
      price: Number(p.price) || 0,
      vibe: p.vibe,
      images: p.images,
      description: p.description,
      highlights: p.highlights,
      size: p.size,
      vibe_analysis: p.vibe_analysis,
      amenities: p.amenities,
      property_source_link: null,
      property_source_provider_name: null,
      property_source_provider_phone: null,
      realtor_id: `ext-${p.source}`,
      source_url: null,
      contact_name: null,
      contact_phone: null,
      _type: 'external',
    });
  });

  return matches.map(match => ({
    ...match,
    properties: propertyMap.get(match.property_id) || null,
  }));
}

export const useMatches = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { updateUsage, canPerformAction } = useUsageTracking();

  // Fetch matches for realtors
  const { data: realtorMatches = [], isLoading: isLoadingMatches } = useQuery({
    queryKey: ['realtor-matches', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data: matches, error } = await supabase
        .from('property_matches')
        .select('*')
        .eq('realtor_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const enriched = await enrichMatchesWithProperties(matches || []);

      // Get renter names for all matches
      if (enriched.length > 0) {
        const renterIds = enriched.map(match => match.renter_id);
        const { data: profiles } = await supabase
          .rpc('get_matched_public_profiles', { user_ids: renterIds });

        return enriched.map(match => {
          const profile = profiles?.find((p: any) => p.id === match.renter_id);
          return {
            ...match,
            renter_name: profile?.name || 'Anonymous Renter',
            renter_avatar: profile?.avatar_url
          };
        }) as PropertyMatch[];
      }

      return enriched as PropertyMatch[];
    },
    enabled: !!user?.id,
  });

  // Fetch matches for renters
  const { data: renterMatches = [], isLoading: isLoadingRenterMatches } = useQuery({
    queryKey: ['renter-matches', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data: matches, error } = await supabase
        .from('property_matches')
        .select('*')
        .eq('renter_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const enriched = await enrichMatchesWithProperties(matches || []);

      // Get realtor names for internal matches
      if (enriched.length > 0) {
        const realtorIds = enriched
          .filter(m => m.property_type !== 'external')
          .map(match => match.realtor_id)
          .filter(Boolean);

        let profiles: any[] = [];
        if (realtorIds.length > 0) {
          const { data } = await supabase
            .rpc('get_matched_public_profiles', { user_ids: realtorIds });
          profiles = data || [];
        }

        return enriched.map(match => {
          if (match.property_type === 'external') {
            return {
              ...match,
              realtor_name: match.properties?.contact_name || 'External Listing',
              realtor_avatar: undefined,
            };
          }
          const profile = profiles.find((p: any) => p.id === match.realtor_id);
          return {
            ...match,
            realtor_name: profile?.name || 'Property Owner',
            realtor_avatar: profile?.avatar_url
          };
        }) as PropertyMatch[];
      }

      return enriched as PropertyMatch[];
    },
    enabled: !!user?.id,
  });

  // Remove match mutation
  const removeMatchMutation = useMutation({
    mutationFn: async (matchId: string) => {
      const { error } = await supabase
        .from('property_matches')
        .delete()
        .eq('id', matchId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['renter-matches'] });
      toast({
        title: "Match removed",
        description: "Property has been removed from your matches.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to remove match. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Create match mutation
  const createMatchMutation = useMutation({
    mutationFn: async ({ propertyId, realtorId, propertyType = 'internal' }: { propertyId: string; realtorId: string; propertyType?: string }) => {
      if (!user?.id) throw new Error('User not authenticated');

      // Check if user can create more matches BEFORE proceeding
      if (!canPerformAction('match')) {
        throw new Error('MATCH_LIMIT_REACHED');
      }

      // Check if match already exists
      const { data: existingMatch } = await supabase
        .from('property_matches')
        .select('id')
        .eq('renter_id', user.id)
        .eq('property_id', propertyId)
        .maybeSingle();

      if (existingMatch) {
        throw new Error('ALREADY_MATCHED');
      }

      const { error } = await supabase
        .from('property_matches')
        .insert({
          renter_id: user.id,
          property_id: propertyId,
          realtor_id: realtorId,
          property_type: propertyType,
        } as any);
      if (error) throw error;

      await updateUsage('match');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['renter-matches'] });
      toast({
        title: "Property liked!",
        description: "Property has been added to your matches.",
      });
    },
    onError: (error: any) => {
      if (error?.message === 'ALREADY_MATCHED') {
        toast({
          title: "Already in your matches!",
          description: "This property is already saved in your Matches tab.",
        });
      } else if (error?.message === 'MATCH_LIMIT_REACHED') {
        sonnerToast.error("Weekly match limit reached. Upgrade to premium for unlimited matches!", {
          action: {
            label: 'Upgrade',
            onClick: () => window.dispatchEvent(new CustomEvent('openSubscriptionModal'))
          }
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to like property. Please try again.",
          variant: "destructive",
        });
      }
    },
  });

  const removeMatch = (matchId: string) => {
    removeMatchMutation.mutate(matchId);
  };

  const createMatch = (propertyId: string, realtorId: string, propertyType: string = 'internal') => {
    return createMatchMutation.mutateAsync({ propertyId, realtorId, propertyType });
  };

  return {
    realtorMatches,
    renterMatches,
    isLoadingMatches: isLoadingMatches || isLoadingRenterMatches,
    removeMatch,
    isRemovingMatch: removeMatchMutation.isPending,
    createMatch,
    isCreatingMatch: createMatchMutation.isPending,
  };
};
