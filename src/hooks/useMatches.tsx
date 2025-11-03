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
  };
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
            vibe_analysis,
            property_source_link
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

        // Map names and avatars to matches
        const matchesWithNames = matches.map(match => {
          const profile = profiles?.find(p => p.id === match.renter_id);
          return {
            ...match,
            renter_name: profile?.name || 'Anonymous Renter',
            renter_avatar: profile?.avatar_url
          };
        });

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
            vibe_analysis,
            property_source_link
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

        // Map names and avatars to matches
        const matchesWithNames = matches.map(match => {
          const profile = profiles?.find(p => p.id === match.realtor_id);
          return {
            ...match,
            realtor_name: profile?.name || 'Property Owner',
            realtor_avatar: profile?.avatar_url
          };
        });

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

  // Create match mutation
  const createMatchMutation = useMutation({
    mutationFn: async ({ propertyId, realtorId }: { propertyId: string; realtorId: string }) => {
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
        });
      if (error) throw error;

      // Ensure a conversation exists for this renter/realtor pair so it shows up in Hausto Chat
      const { error: convError } = await supabase
        .from('match_conversations')
        .upsert(
          {
            renter_id: user.id,
            realtor_id: realtorId,
            is_active: true,
            last_message_at: new Date().toISOString(),
          },
          { onConflict: 'renter_id,realtor_id' }
        );
      if (convError) {
        // Non-fatal: log but don't block match creation UX
        console.error('Failed to upsert match_conversations:', convError);
      }
      
      // Update usage tracking for matches (includes AI chat matches)
      await updateUsage('match');
      // Also count the match as a property view
      await updateUsage('view');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['renter-matches'] });
      queryClient.invalidateQueries({ queryKey: ['match-conversations'] });
      toast({
        title: "Property liked!",
        description: "Property has been added to your matches and chat.",
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
            onClick: () => window.dispatchEvent(new CustomEvent('openSubscription'))
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

  const createMatch = (propertyId: string, realtorId: string) => {
    createMatchMutation.mutate({ propertyId, realtorId });
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