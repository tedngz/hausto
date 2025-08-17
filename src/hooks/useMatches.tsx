import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

export interface PropertyMatch {
  id: string;
  renter_id: string;
  property_id: string;
  realtor_id: string;
  created_at: string;
  updated_at: string;
  renter_name?: string;
  realtor_name?: string;
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
  };
}

export const useMatches = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch matches for realtors
  const { data: realtorMatches = [], isLoading: isLoadingMatches } = useQuery({
    queryKey: ['realtor-matches', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data: matches, error } = await supabase
        .from('property_matches')
        .select(`
          *,
          properties:property_id (
            id,
            title,
            location,
            price,
            vibe,
            images,
            description,
            highlights,
            size,
            realtor_id,
            vibe_analysis
          )
        `)
        .eq('realtor_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get renter names for all matches
      if (matches && matches.length > 0) {
        const renterIds = matches.map(match => match.renter_id);
        console.log('Realtor matches - renter IDs:', renterIds);
        
        const { data: profiles, error: profilesError } = await supabase
          .rpc('get_matched_public_profiles', { user_ids: renterIds });

        console.log('Realtor matches - fetched profiles:', profiles);
        if (profilesError) {
          console.error('Error fetching renter profiles:', profilesError);
        }

        // Map names to matches
        const matchesWithNames = matches.map(match => ({
          ...match,
          renter_name: profiles?.find(p => p.id === match.renter_id)?.name || 'Anonymous Renter'
        }));

        console.log('Realtor matches with names:', matchesWithNames);
        return matchesWithNames as PropertyMatch[];
      }

      return matches as PropertyMatch[];
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
        .select(`
          *,
          properties:property_id (
            id,
            title,
            location,
            price,
            vibe,
            images,
            description,
            highlights,
            size,
            realtor_id,
            vibe_analysis
          )
        `)
        .eq('renter_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get realtor names for all matches
      if (matches && matches.length > 0) {
        const realtorIds = matches.map(match => match.realtor_id).filter(Boolean);
        console.log('Renter matches - realtor IDs:', realtorIds);
        
        const { data: profiles, error: profilesError } = await supabase
          .rpc('get_matched_public_profiles', { user_ids: realtorIds });

        console.log('Renter matches - fetched profiles:', profiles);
        if (profilesError) {
          console.error('Error fetching realtor profiles:', profilesError);
        }

        // Map names to matches
        const matchesWithNames = matches.map(match => ({
          ...match,
          realtor_name: profiles?.find(p => p.id === match.realtor_id)?.name || 'Property Owner'
        }));

        console.log('Renter matches with names:', matchesWithNames);
        return matchesWithNames as PropertyMatch[];
      }

      return matches as PropertyMatch[];
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

  const removeMatch = (matchId: string) => {
    removeMatchMutation.mutate(matchId);
  };

  return {
    realtorMatches,
    renterMatches,
    isLoadingMatches: isLoadingMatches || isLoadingRenterMatches,
    removeMatch,
    isRemovingMatch: removeMatchMutation.isPending,
  };
};