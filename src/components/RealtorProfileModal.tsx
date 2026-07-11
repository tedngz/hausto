import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { User, Building, Heart, MessageCircle, Calendar } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

interface RealtorProfileModalProps {
  realtorId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const RealtorProfileModal = ({ realtorId, isOpen, onClose }: RealtorProfileModalProps) => {
  // Fetch public profile using secure function
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['realtor-public-profile', realtorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_realtor_public_profile', { realtor_id: realtorId });

      if (error) {
        console.error('Error fetching realtor profile:', error);
        throw error;
      }

      return data?.[0] || null;
    },
    enabled: !!realtorId && isOpen,
  });

  // Activity stats: enough for a renter to gauge how established this owner is
  const { data: stats } = useQuery({
    queryKey: ['realtor-stats', realtorId],
    queryFn: async () => {
      const [propertiesRes, matchesRes, recentMatchesRes] = await Promise.all([
        supabase
          .from('properties')
          .select('id, created_at')
          .eq('realtor_id', realtorId)
          .order('created_at', { ascending: false }),
        supabase
          .from('property_matches')
          .select('id')
          .eq('realtor_id', realtorId),
        supabase
          .from('property_matches')
          .select('id')
          .eq('realtor_id', realtorId)
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      ]);

      const properties = propertiesRes.data || [];
      return {
        totalProperties: properties.length,
        totalMatches: matchesRes.data?.length || 0,
        recentMatches: recentMatchesRes.data?.length || 0,
        joinedDate: properties[0]?.created_at || null,
      };
    },
    enabled: !!realtorId && isOpen,
  });

  if (!isOpen) return null;

  const statItems = [
    { icon: Building, label: 'Listings', value: stats?.totalProperties ?? 0 },
    { icon: Heart, label: 'Matches', value: stats?.totalMatches ?? 0 },
    { icon: MessageCircle, label: 'Interest (30d)', value: stats?.recentMatches ?? 0 },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl font-normal">Property owner</DialogTitle>
        </DialogHeader>

        {profileLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full"></div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Identity */}
            <div className="flex items-center gap-4">
              <Avatar className="w-16 h-16">
                <AvatarImage src={profile?.avatar_url} alt="Profile picture" />
                <AvatarFallback className="bg-secondary text-muted-foreground">
                  <User className="w-8 h-8" />
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold leading-tight">
                  {profile?.name || 'Property Owner'}
                </h3>
                {stats?.joinedDate && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <Calendar className="w-3 h-3" aria-hidden="true" />
                    Member since {new Date(stats.joinedDate).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>

            {profile?.bio && (
              <p className="text-sm text-muted-foreground leading-relaxed">{profile.bio}</p>
            )}

            {/* Activity at a glance */}
            <div className="grid grid-cols-3 gap-2">
              {statItems.map(({ icon: Icon, label, value }) => (
                <div key={label} className="rounded-xl border border-border bg-secondary/30 p-3 text-center">
                  <Icon className="w-4 h-4 mx-auto text-primary" aria-hidden="true" />
                  <p className="text-lg font-semibold mt-1">{value}</p>
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
