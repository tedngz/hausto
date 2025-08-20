import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  User, 
  Building,
  Heart,
  MessageCircle,
  TrendingUp,
  Star,
  Calendar,
  MapPin
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useCurrency } from '@/contexts/CurrencyContext';

interface RealtorProfileModalProps {
  realtorId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface PublicProfile {
  id: string;
  name: string;
  avatar_url?: string;
}

export const RealtorProfileModal = ({ realtorId, isOpen, onClose }: RealtorProfileModalProps) => {
  const { formatPrice } = useCurrency();

  // Fetch limited profile (name and avatar) for matched users
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['realtor-profile', realtorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, avatar_url')
        .eq('id', realtorId)
        .single();

      if (error) {
        throw error;
      }
      
      return data || null;
    },
    enabled: !!realtorId && isOpen,
  });

  // Fetch realtor stats
  const { data: stats } = useQuery({
    queryKey: ['realtor-stats', realtorId],
    queryFn: async () => {
      const [propertiesRes, matchesRes, recentMatchesRes] = await Promise.all([
        supabase
          .from('properties')
          .select('id, title, price, location, vibe, created_at')
          .eq('realtor_id', realtorId)
          .order('created_at', { ascending: false }),
        supabase
          .from('property_matches')
          .select('id, created_at')
          .eq('realtor_id', realtorId),
        supabase
          .from('property_matches')
          .select('id, created_at')
          .eq('realtor_id', realtorId)
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      ]);

      const properties = propertiesRes.data || [];
      const matches = matchesRes.data || [];
      const recentMatches = recentMatchesRes.data || [];

      // Calculate average property price
      const avgPrice = properties.length > 0 
        ? properties.reduce((sum, p) => sum + (p.price || 0), 0) / properties.length 
        : 0;

      return {
        properties,
        totalProperties: properties.length,
        totalMatches: matches.length,
        recentMatches: recentMatches.length,
        avgPrice,
        joinedDate: properties[0]?.created_at || null
      };
    },
    enabled: !!realtorId && isOpen,
  });

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Realtor Profile</DialogTitle>
        </DialogHeader>

        {profileLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Header */}
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center space-x-4">
                  <Avatar className="w-16 h-16">
                    <AvatarImage src={profile?.avatar_url} alt="Profile picture" />
                    <AvatarFallback className="bg-blue-100 text-blue-600">
                      <User className="w-8 h-8" />
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="text-2xl font-semibold">
                      {profile?.name || 'Property Owner'}
                    </h3>
                    <Badge variant="secondary" className="mt-1 bg-blue-100 text-blue-700">
                      Property Owner
                    </Badge>
                    {stats?.joinedDate && (
                      <div className="flex items-center text-sm text-gray-500 mt-1">
                        <Calendar className="w-3 h-3 mr-1" />
                        Member since {new Date(stats.joinedDate).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* Profile Information - Limited for privacy */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Profile Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
                    <User className="w-8 h-8 text-blue-600" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{profile?.name || 'Anonymous User'}</h3>
                  <p className="text-sm text-muted-foreground">
                    For privacy protection, contact details are only shared during direct communication.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Activity Stats */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-500" />
                  Activity Stats
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Building className="w-4 h-4 text-blue-500" />
                    <span className="text-sm text-gray-600">Properties Listed</span>
                  </div>
                  <Badge variant="secondary" className="bg-blue-50 text-blue-700">
                    {stats?.totalProperties || 0}
                  </Badge>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Heart className="w-4 h-4 text-red-500" />
                    <span className="text-sm text-gray-600">Total Matches</span>
                  </div>
                  <Badge variant="secondary" className="bg-red-50 text-red-700">
                    {stats?.totalMatches || 0}
                  </Badge>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <MessageCircle className="w-4 h-4 text-green-500" />
                    <span className="text-sm text-gray-600">Recent Interest</span>
                  </div>
                  <Badge variant="secondary" className="bg-green-50 text-green-700">
                    {stats?.recentMatches || 0}
                  </Badge>
                </div>

                {stats?.avgPrice && stats.avgPrice > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Star className="w-4 h-4 text-orange-500" />
                      <span className="text-sm text-gray-600">Avg. Price</span>
                    </div>
                    <Badge variant="secondary" className="bg-orange-50 text-orange-700">
                      {formatPrice(stats.avgPrice)}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Properties */}
            {stats?.properties && stats.properties.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Building className="w-5 h-5 text-purple-500" />
                    Recent Properties
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {stats.properties.slice(0, 3).map((property) => (
                      <div key={property.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex-1">
                          <h4 className="font-medium text-sm">{property.title}</h4>
                          <div className="flex items-center text-xs text-gray-500 mt-1">
                            <MapPin className="w-3 h-3 mr-1" />
                            {property.location}
                          </div>
                          {property.vibe && (
                            <Badge variant="secondary" className="mt-1 text-xs">
                              {property.vibe}
                            </Badge>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-sm text-green-600">
                            {formatPrice(property.price)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};