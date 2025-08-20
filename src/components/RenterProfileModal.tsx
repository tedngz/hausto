import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  X,
  Heart,
  Home,
  Palette,
  Activity,
  DollarSign
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useCurrency } from '@/contexts/CurrencyContext';

interface RenterProfileModalProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface PublicProfile {
  id: string;
  name: string;
}

export const RenterProfileModal = ({ userId, isOpen, onClose }: RenterProfileModalProps) => {
  const { formatPrice } = useCurrency();

  // Fetch limited profile (only name) for matched users
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['renter-profile', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_matched_public_profiles', { user_ids: [userId] });

      if (error) {
        throw error;
      }
      
      return data?.[0] || null;
    },
    enabled: !!userId && isOpen,
  });

  // Fetch user preferences
  const { data: preferences, isLoading: preferencesLoading } = useQuery({
    queryKey: ['renter-preferences', userId],
    queryFn: async () => {
      // Get preferences from localStorage since that's where they're stored
      const stored = localStorage.getItem(`userPreferences_${userId}`);
      return stored ? JSON.parse(stored) : null;
    },
    enabled: !!userId && isOpen,
  });

  // Fetch renter stats
  const { data: stats } = useQuery({
    queryKey: ['renter-stats', userId],
    queryFn: async () => {
      const matchesRes = await supabase
        .from('property_matches')
        .select('id')
        .eq('renter_id', userId);

      return {
        matches: matchesRes.data?.length || 0,
      };
    },
    enabled: !!userId && isOpen,
  });

  const styleLabels: { [key: string]: string } = {
    'modern': 'Modern',
    'traditional': 'Traditional',
    'minimalist': 'Minimalist',
    'bohemian': 'Bohemian',
    'industrial': 'Industrial',
    'scandinavian': 'Scandinavian'
  };

  const colorLabels: { [key: string]: string } = {
    'warm': 'Warm tones',
    'cool': 'Cool tones', 
    'neutral': 'Neutral colors',
    'bold': 'Bold colors'
  };

  const activityLabels: { [key: string]: string } = {
    'working': 'Working from home',
    'entertaining': 'Entertaining guests',
    'relaxing': 'Relaxing & unwinding',
    'cooking': 'Cooking & dining',
    'exercising': 'Exercising',
    'reading': 'Reading',
    'creating': 'Creative activities'
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Renter Profile</DialogTitle>
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
                  <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                    <User className="w-8 h-8 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-semibold">
                      {profile?.name || 'Renter Profile'}
                    </h3>
                    <Badge variant="secondary" className="mt-1">
                      Property Seeker
                    </Badge>
                    {stats && (
                      <p className="text-sm text-gray-600 mt-1">
                        {stats.matches} property matches
                      </p>
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

            {/* Preferences */}
            {preferences && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Heart className="w-5 h-5 text-red-500" />
                    Housing Preferences
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Style Preferences */}
                  {preferences.styles?.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Home className="w-4 h-4 text-blue-500" />
                        <span className="font-medium text-sm">Style</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {preferences.styles.map((style: string) => (
                          <Badge key={style} variant="secondary" className="bg-blue-50 text-blue-700">
                            {styleLabels[style] || style}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Color Preferences */}
                  {preferences.colors?.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Palette className="w-4 h-4 text-purple-500" />
                        <span className="font-medium text-sm">Colors</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {preferences.colors.map((color: string) => (
                          <Badge key={color} variant="secondary" className="bg-purple-50 text-purple-700">
                            {colorLabels[color] || color}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Activity Preferences */}
                  {preferences.activities?.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Activity className="w-4 h-4 text-green-500" />
                        <span className="font-medium text-sm">Activities</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {preferences.activities.map((activity: string) => (
                          <Badge key={activity} variant="secondary" className="bg-green-50 text-green-700">
                            {activityLabels[activity] || activity}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Budget Range */}
                  {preferences.priceRange && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <DollarSign className="w-4 h-4 text-orange-500" />
                        <span className="font-medium text-sm">Budget Range</span>
                      </div>
                      <div className="bg-orange-50 p-3 rounded-lg">
                        <div className="flex justify-between text-sm text-orange-700">
                          <span>{formatPrice(preferences.priceRange[0])}</span>
                          <span>-</span>
                          <span>{formatPrice(preferences.priceRange[1])}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Location Preferences */}
                  {preferences.location?.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <MapPin className="w-4 h-4 text-red-500" />
                        <span className="font-medium text-sm">Preferred Areas</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {preferences.location.map((location: string) => (
                          <Badge key={location} variant="secondary" className="bg-red-50 text-red-700">
                            {location}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};