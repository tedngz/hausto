import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { User, Mail, Phone, MapPin, Heart, Home, Activity, Calendar, Ruler } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useCurrency } from '@/contexts/CurrencyContext';

interface RenterProfileModalProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
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

      if (data && data.length > 0) {
        const pref = data[0];
        return {
          styles: pref.styles || [],
          activities: pref.activities || [],
          mustHaves: pref.must_haves || [],
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

  // Preference sections rendered as label + chips, in the platform's quiet style
  const prefSections = preferences
    ? [
        { icon: Home, label: 'Style', values: preferences.styles as string[] },
        { icon: Activity, label: 'Lifestyle', values: (preferences.activities as string[]).map(a => activityLabels[a] || a) },
        { icon: MapPin, label: 'Areas', values: preferences.location as string[] },
        {
          icon: Ruler,
          label: 'Size',
          values: preferences.size
            ? (Array.isArray(preferences.size) ? preferences.size : [preferences.size]).map((s: string) => sizeLabels[s] || s)
            : [],
        },
        {
          icon: Calendar,
          label: 'Move-in',
          values: preferences.moveInDate ? [moveInLabels[preferences.moveInDate] || preferences.moveInDate] : [],
        },
      ].filter(s => s.values.length > 0)
    : [];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl font-normal">Renter profile</DialogTitle>
        </DialogHeader>

        {profileLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full"></div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Identity + contact */}
            <div className="flex items-center gap-4">
              <Avatar className="w-16 h-16">
                {profile?.avatar_url ? <AvatarImage src={profile.avatar_url} alt={profile.name} /> : null}
                <AvatarFallback className="bg-secondary text-muted-foreground">
                  <User className="w-8 h-8" />
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold leading-tight">
                  {profile?.name || 'Renter'}
                </h3>
                {profile?.email && (
                  <a href={`mailto:${profile.email}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline mt-1 truncate">
                    <Mail className="w-3 h-3 shrink-0" aria-hidden="true" />{profile.email}
                  </a>
                )}
                {profile?.phone && (
                  <a href={`tel:${profile.phone}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline mt-0.5">
                    <Phone className="w-3 h-3 shrink-0" aria-hidden="true" />{profile.phone}
                  </a>
                )}
              </div>
            </div>

            {profile?.bio && (
              <p className="text-sm text-muted-foreground leading-relaxed">{profile.bio}</p>
            )}

            {/* Budget — the number a realtor checks first */}
            {preferences?.priceRange && preferences.priceRange[1] > 0 && (
              <div className="rounded-xl border border-border bg-secondary/30 p-3 flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Budget</span>
                <span className="text-sm font-semibold">
                  {formatPrice(preferences.priceRange[0])} – {formatPrice(preferences.priceRange[1])}
                  <span className="text-xs font-normal text-muted-foreground"> /mo</span>
                </span>
              </div>
            )}

            {/* Preferences */}
            {preferencesLoading ? (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full"></div>
              </div>
            ) : prefSections.length > 0 ? (
              <div className="space-y-3">
                {prefSections.map(({ icon: Icon, label, values }) => (
                  <div key={label}>
                    <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                      <Icon className="w-3.5 h-3.5" aria-hidden="true" />{label}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {values.map((v: string) => (
                        <Badge key={v} variant="secondary" className="font-normal">{v}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mx-auto mb-3">
                  <Heart className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
                </div>
                <p className="text-sm text-muted-foreground">
                  This renter hasn't completed their preferences quiz yet.
                </p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
