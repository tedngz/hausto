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
  DollarSign,
  Calendar,
  Ruler,
  FileText
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useCurrency } from '@/contexts/CurrencyContext';

interface RenterProfileModalProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface RenterProfile {
  id: string;
  name: string;
  bio: string;
}

export const RenterProfileModal = ({ userId, isOpen, onClose }: RenterProfileModalProps) => {
  const { formatPrice } = useCurrency();

  // Fetch renter profile using secure function for matched users
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['renter-profile-for-realtor', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_renter_profile_for_realtor', { renter_id: userId });

      if (error) {
        console.error('Error fetching renter profile:', error);
        throw error;
      }
      
      return data?.[0] || null;
    },
    enabled: !!userId && isOpen,
  });

  // Fetch user preferences from database using secure RPC function
  const { data: preferences, isLoading: preferencesLoading } = useQuery({
    queryKey: ['renter-preferences-for-realtor', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_renter_preferences_for_realtor', { renter_id: userId });

      if (error) {
        console.error('Error fetching renter preferences:', error);
        return null;
      }
      
      // Transform the data to match the expected format
      if (data && data.length > 0) {
        const pref = data[0];
        return {
          styles: pref.styles || [],
          colors: pref.colors || [],
          activities: pref.activities || [],
          priceRange: [pref.price_range_min, pref.price_range_max] as [number, number],
          size: pref.size || '',
          location: pref.location || [],
          moveInDate: pref.move_in_date || ''
        };
      }
      return null;
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
    'Modern': 'Modern',
    'Cozy': 'Cozy',
    'Industrial': 'Industrial',
    'Bohemian': 'Bohemian',
    'Scandinavian': 'Scandinavian',
    'Minimalist': 'Minimalist',
    'Contemporary': 'Contemporary',
    'Traditional': 'Traditional',
    'Rustic': 'Rustic',
    'Luxury': 'Luxury',
    'Urban': 'Urban',
    'Vintage': 'Vintage'
  };

  const colorLabels: { [key: string]: string } = {
    'Neutral': 'Neutral tones',
    'Warm': 'Warm tones', 
    'Cool': 'Cool tones',
    'Bright': 'Bright & airy',
    'Dark': 'Dark & moody',
    'Colorful': 'Colorful',
    'Natural': 'Natural tones',
    'White': 'Pure white',
    'Earth': 'Earthy tones',
    'Bold': 'Bold colors'
  };

  const activityLabels: { [key: string]: string } = {
    'Working': 'Working from home',
    'Reading': 'Reading',
    'Relaxing': 'Relaxing & unwinding',
    'Entertaining': 'Entertaining guests',
    'Cooking': 'Cooking & dining',
    'Exercising': 'Exercising'
  };

  const sizeLabels: { [key: string]: string } = {
    'studio': 'Studio',
    '1br': '1 Bedroom',
    '2br': '2 Bedrooms',
    '3br+': '3+ Bedrooms'
  };

  const moveInLabels: { [key: string]: string } = {
    'asap': 'ASAP',
    '1month': 'Within 1 month',
    '3months': 'Within 3 months',
    '6months': '6+ months'
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
                  <Avatar className="w-16 h-16">
                    <AvatarFallback className="bg-green-100 text-green-600">
                      <User className="w-8 h-8" />
                    </AvatarFallback>
                  </Avatar>
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

            {/* Profile Information - Show bio if available */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-500" />
                  About
                </CardTitle>
              </CardHeader>
              <CardContent>
                {profile?.bio ? (
                  <p className="text-muted-foreground">{profile.bio}</p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    This renter hasn't added a bio yet.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Preferences */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Heart className="w-5 h-5 text-red-500" />
                  Housing Preferences
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {preferencesLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full"></div>
                  </div>
                ) : preferences ? (
                  <>
                    {/* Style Preferences */}
                    {preferences.styles?.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <Home className="w-4 h-4 text-blue-500" />
                          <span className="font-medium text-sm">Style Preferences</span>
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
                          <span className="font-medium text-sm">Color Preferences</span>
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
                          <span className="font-medium text-sm">Home Activities</span>
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
                    {preferences.priceRange && preferences.priceRange[1] > 0 && (
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

                    {/* Size Preference */}
                    {preferences.size && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <Ruler className="w-4 h-4 text-teal-500" />
                          <span className="font-medium text-sm">Property Size</span>
                        </div>
                        <Badge variant="secondary" className="bg-teal-50 text-teal-700">
                          {sizeLabels[preferences.size] || preferences.size}
                        </Badge>
                      </div>
                    )}

                    {/* Move-in Date */}
                    {preferences.moveInDate && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <Calendar className="w-4 h-4 text-indigo-500" />
                          <span className="font-medium text-sm">Move-in Timeline</span>
                        </div>
                        <Badge variant="secondary" className="bg-indigo-50 text-indigo-700">
                          {moveInLabels[preferences.moveInDate] || preferences.moveInDate}
                        </Badge>
                      </div>
                    )}

                    {/* Show message if no specific preferences are set */}
                    {(!preferences.styles?.length && !preferences.colors?.length && 
                      !preferences.activities?.length && !preferences.location?.length && 
                      !preferences.size && !preferences.moveInDate) && (
                      <p className="text-sm text-muted-foreground italic text-center py-4">
                        This renter hasn't set specific preferences yet.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="text-center py-6">
                    <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                      <Heart className="w-6 h-6 text-gray-400" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      This renter hasn't completed their preferences quiz yet.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Preferences will appear here once they complete the onboarding quiz.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};