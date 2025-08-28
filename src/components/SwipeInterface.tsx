import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Heart, X, RotateCcw, MessageCircle } from 'lucide-react';
import { UserPreferences, Apartment } from '@/types';
import { UserProfile } from '@/components/LoginModal';
import { useProperties, Property } from '@/hooks/useProperties';
import { calculateVibeScore } from '@/utils/vibeScoring';
import { useCurrency } from '@/contexts/CurrencyContext';
import { supabase } from '@/integrations/supabase/client';
import { useMatches } from '@/hooks/useMatches';
import { useUsageTracking } from '@/hooks/useUsageTracking';
import { PropertyImageModal } from '@/components/PropertyImageModal';
import { PropertyCard } from '@/components/PropertyCard';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { Card } from '@/components/ui/card';
import { VibeScore } from '@/components/VibeScore';
import { toast } from 'sonner';
interface SwipeInterfaceProps {
  userPreferences: UserPreferences;
  onMatch: (apartment: Apartment) => void;
  userProfile?: UserProfile;
  onRestartOnboarding?: () => void;
}

export const SwipeInterface = ({ userPreferences, onMatch, userProfile, onRestartOnboarding }: SwipeInterfaceProps) => {
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [currentApartmentIndex, setCurrentApartmentIndex] = useState(0);
  const [likedApartmentIds, setLikedApartmentIds] = useState<string[]>([]);
  const [imageIndices, setImageIndices] = useState<Record<string, number>>({});
  const [noMatchReason, setNoMatchReason] = useState<string>('');
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [subscriptionReason, setSubscriptionReason] = useState<'views' | 'matches' | 'quiz'>('views');
  const { formatPrice } = useCurrency();
  const { properties: realProperties, isLoading } = useProperties();
  const { renterMatches, isLoadingMatches } = useMatches();
  const { canPerformAction, updateUsage } = useUsageTracking();
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);

  // Transform Property to Apartment
  const transformPropertyToApartment = (property: Property): Apartment => {
    return {
      id: property.id,
      images: property.images || [],
      title: property.title,
      location: property.location,
      price: Number(property.price),
      size: property.size || '',
      vibe: property.vibe || '',
      description: property.description || '',
      highlights: property.highlights || [],
      realtor: {
        id: property.realtor_id,
        name: 'Licensed Realtor',
        phone: '+1-234-567-8900',
        email: 'contact@realtor.com'
      },
      vibe_analysis: property.vibe_analysis // Pass through AI analysis data
    };
  };

  useEffect(() => {
    const transformedRealProperties = (realProperties || []).map(transformPropertyToApartment);
    const allProperties = transformedRealProperties;

    // First filter by user preferences (location, vibe score, price)
    const preferredApartments = allProperties.filter(apartment => {
      console.log('Filtering apartment:', apartment.title, apartment.location, apartment.price);
      
      // Check location match - make it more flexible
      const locationMatch = !userPreferences.location.length || 
        userPreferences.location.some(loc => {
          const locMatch = apartment.location.toLowerCase().includes(loc.toLowerCase().split(',')[0]);
          console.log(`Location match for ${apartment.location} vs ${loc}: ${locMatch}`);
          return locMatch;
        });
      
      const vibeScore = calculateVibeScore(apartment, userPreferences);
      console.log(`Vibe score for ${apartment.title}: ${vibeScore.overall}`);
      const hasGoodVibeMatch = vibeScore.overall > 10; // Further lowered threshold
      
      const [, maxPrice] = userPreferences.priceRange;
      const priceInRange = apartment.price <= maxPrice * 2; // Very flexible price range
      console.log(`Price check for ${apartment.title}: ${apartment.price} <= ${maxPrice * 2} = ${priceInRange}`);
      
      const passes = locationMatch && hasGoodVibeMatch && priceInRange;
      console.log(`Property ${apartment.title} passes filters: location=${locationMatch}, vibe=${hasGoodVibeMatch}, price=${priceInRange}, overall=${passes}`);
      
      return passes;
    });

    // Exclude properties already matched by this renter (and ones liked in this session)
    const matchedIds = new Set<string>([
      ...(renterMatches || []).map(m => m.property_id),
      ...likedApartmentIds,
    ]);

    const filteredApartments = preferredApartments
      .filter(apartment => !matchedIds.has(apartment.id))
      .sort((a, b) => {
        const scoreA = calculateVibeScore(a, userPreferences).overall;
        const scoreB = calculateVibeScore(b, userPreferences).overall;
        
        const aIsReal = realProperties?.some(p => p.id === a.id) || false;
        const bIsReal = realProperties?.some(p => p.id === b.id) || false;
        
        if (aIsReal && !bIsReal) return -1;
        if (!aIsReal && bIsReal) return 1;
        
        return scoreB - scoreA;
      });
    
    console.log(`Preferred apartments: ${preferredApartments.length}, after excluding matched: ${filteredApartments.length}`);

    // Only update state if apartments array actually changed
    setApartments(prevApartments => {
      if (JSON.stringify(prevApartments.map(a => a.id)) === JSON.stringify(filteredApartments.map(a => a.id))) {
        return prevApartments;
      }
      return filteredApartments;
    });
    
    if (filteredApartments.length === 0) {
      // If there are preferred apartments but all are already matched
      if (preferredApartments.length > 0) {
        setNoMatchReason('no-more-available');
        return;
      }

      if (!realProperties || realProperties.length === 0) {
        setNoMatchReason('limited-listings');
      } else if (!userPreferences.location.length) {
        setNoMatchReason('no-location');
      } else {
        const locationMatch = allProperties.filter(apartment => 
          userPreferences.location.some(loc => 
            apartment.location.toLowerCase().includes(loc.toLowerCase())
          )
        );
        
        if (locationMatch.length === 0) {
          setNoMatchReason('no-location-match');
        } else {
          const [, maxPrice] = userPreferences.priceRange;
          const budgetMatch = locationMatch.filter(apartment => 
            apartment.price <= maxPrice * 1.3
          );
          
          if (budgetMatch.length === 0) {
            setNoMatchReason('budget-mismatch');
          } else {
            setNoMatchReason('style-mismatch');
          }
        }
      }
    }
  }, [userPreferences, realProperties, renterMatches, likedApartmentIds]);

  const handleLike = async () => {
    if (apartments.length === 0) return;
    
    // Check if user can create more matches
    if (!canPerformAction('match')) {
      setSubscriptionReason('matches');
      setShowSubscriptionModal(true);
      return;
    }
    
    const currentApartment = apartments[currentApartmentIndex];
    setLikedApartmentIds(prev => [...prev, currentApartment.id]);
    
    // Save match to database
    try {
      const { data: userData } = await supabase.auth.getUser();
      console.log('Match creation - user data:', userData?.user?.id);
      
      if (userData?.user?.id) {
        console.log('Inserting match for property:', currentApartment.id);
        const { data: matchData, error: matchError } = await supabase
          .from('property_matches')
          .insert({
            renter_id: userData.user.id,
            property_id: currentApartment.id,
            realtor_id: currentApartment.realtor.id
          })
          .select();
        
        if (matchError) {
          console.error('Error inserting match:', matchError);
          toast.error('Failed to save match');
          return;
        }
        
        console.log('Match inserted successfully:', matchData);
        console.log('Now tracking usage...');
        
        // Track the match - this is critical for weekly counting
        const trackingResult = await updateUsage('match');
        console.log('Usage tracking result:', trackingResult);
        
        if (!trackingResult) {
          console.error('Failed to track match usage');
        }
      } else {
        console.error('No user ID available for match creation');
        return;
      }
    } catch (error) {
      console.error('Error saving match:', error);
      toast.error('Failed to create match');
      return;
    }
    
    onMatch(currentApartment);
    nextApartment();
  };

  const handleDislike = () => {
    nextApartment();
  };

  const nextApartment = async () => {
    // Check if user can view more properties
    if (!canPerformAction('view')) {
      setSubscriptionReason('views');
      setShowSubscriptionModal(true);
      return;
    }
    
    // Track property view
    await updateUsage('view');
    
    if (currentApartmentIndex < apartments.length - 1) {
      setCurrentApartmentIndex(currentApartmentIndex + 1);
    } else {
      setNoMatchReason('no-more-matches');
    }
  };

  const prevImage = (apartmentId: string, totalImages: number) => {
    setImageIndices(prev => ({
      ...prev,
      [apartmentId]: prev[apartmentId] === 0 || !prev[apartmentId] 
        ? totalImages - 1 
        : prev[apartmentId] - 1
    }));
  };

  const nextImage = (apartmentId: string, totalImages: number) => {
    setImageIndices(prev => ({
      ...prev,
      [apartmentId]: ((prev[apartmentId] || 0) + 1) % totalImages
    }));
  };

  const getNoMatchMessage = () => {
    switch (noMatchReason) {
      case 'no-more-available':
        return {
          title: "No more properties available",
          message: "You've already reviewed all properties that meet your preferences. New listings arrive regularly.",
          suggestion: "Check back soon or adjust your preferences to expand your options."
        };
      case 'no-more-matches':
        return {
          title: "You've seen all available matches!",
          message: "You've reviewed all properties that match your current preferences. Great job exploring your options!",
          suggestion: "Consider adjusting your preferences to discover more properties, or ask Hausto AI for personalized recommendations."
        };
      case 'limited-listings':
        return {
          title: "Limited listings available",
          message: "We're still building our network of trusted realtors in your area. New properties are added regularly, so check back soon!",
          suggestion: "Try expanding your search to nearby districts or ask Hausto AI for personalized recommendations."
        };
      case 'no-location':
        return {
          title: "Location not specified",
          message: "You haven't selected any preferred locations. We need to know where you'd like to live to find suitable properties.",
          suggestion: "Restart your preferences to select your preferred areas."
        };
      case 'no-location-match':
        return {
          title: "No properties in selected areas",
          message: "We couldn't find any properties in your selected districts. Our realtor network is expanding to cover more areas.",
          suggestion: "Try selecting additional districts or ask Hausto AI about upcoming listings in your preferred areas."
        };
      case 'budget-mismatch':
        return {
          title: "Budget constraints",
          message: "Available properties in your selected areas are outside your budget range. Consider adjusting your budget or exploring different districts.",
          suggestion: "Restart your preferences to adjust your budget or ask Hausto AI for budget-friendly alternatives."
        };
      case 'style-mismatch':
        return {
          title: "Style preferences too specific",
          message: "Your style and lifestyle preferences are quite specific. While we have properties in your area and budget, none match your vibe preferences closely enough.",
          suggestion: "Consider broadening your style preferences or ask Hausto AI to find properties that might surprise you."
        };
      default:
        return {
          title: "No matches found",
          message: "We couldn't find properties that match all your criteria. This could be due to limited inventory or very specific preferences.",
          suggestion: "Try adjusting your preferences or ask Hausto AI for personalized recommendations."
        };
    }
  };

  if (isLoading || isLoadingMatches) {
    return (
      <div className="pt-20 px-4 flex items-center justify-center min-h-screen">
        <Card className="p-8 text-center bg-white/70 backdrop-blur-md max-w-md">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <h3 className="text-xl font-semibold mb-2">Finding your perfect match</h3>
          <p className="text-gray-600">Searching through available properties...</p>
        </Card>
      </div>
    );
  }

  if (apartments.length === 0 || currentApartmentIndex >= apartments.length) {
    const noMatchInfo = getNoMatchMessage();
    
    return (
      <div className="pt-20 px-4 flex items-center justify-center min-h-screen">
        <Card className="p-8 text-center bg-white/70 backdrop-blur-md max-w-md">
          <Heart className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">{noMatchInfo.title}</h3>
          <p className="text-gray-600 mb-6 leading-relaxed">{noMatchInfo.message}</p>
          <p className="text-sm text-orange-600 mb-6 font-medium">{noMatchInfo.suggestion}</p>
          
          <div className="space-y-3">
            {onRestartOnboarding && (
              <Button 
                onClick={onRestartOnboarding}
                className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white w-full"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Adjust Preferences
              </Button>
            )}
            
            <Button 
              variant="outline"
              className="w-full border-orange-300 text-orange-600 hover:bg-orange-50"
              onClick={() => {
                // Trigger AI chat opening
                window.dispatchEvent(new CustomEvent('openAIChat'));
              }}
            >
              <MessageCircle className="w-4 h-4 mr-2" />
              Ask Hausto AI
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const currentApartment = apartments[currentApartmentIndex];
  const vibeScore = calculateVibeScore(currentApartment, userPreferences);
  const currentImageIndex = imageIndices[currentApartment.id] || 0;
  const isRealProperty = realProperties?.some(p => p.id === currentApartment.id) || false;

  // Create a modified apartment with current image index for consistent PropertyCard usage
  const modifiedApartment = {
    ...currentApartment,
    _currentImageIndex: currentImageIndex
  };

  return (
    <div className="pt-20 px-4">
      <div className="max-w-md mx-auto">
        <PropertyCard
            apartment={modifiedApartment}
            userPreferences={userPreferences}
            showContactButton={false}
            showFullTitle={true}
            showFullDescription={false}
            showAllHighlights={false}
            className="mb-6"
          />

        {/* Action buttons */}
        <div className="flex justify-center space-x-4">
          <Button
            size="lg"
            variant="outline"
            className="w-16 h-16 rounded-full border-red-300 text-red-500 hover:bg-red-50 hover:border-red-400"
            onClick={handleDislike}
          >
            <X className="w-8 h-8" />
          </Button>
          <Button
            size="lg"
            className="w-16 h-16 rounded-full bg-gradient-to-r from-green-400 to-green-500 hover:from-green-500 hover:to-green-600 text-white"
            onClick={handleLike}
          >
            <Heart className="w-8 h-8" />
          </Button>
        </div>

        {/* Full-size image modal */}
        <PropertyImageModal
          apartment={currentApartment}
          isOpen={isImageModalOpen}
          onClose={() => setIsImageModalOpen(false)}
          initialImageIndex={currentImageIndex}
        />
        
        {/* Subscription Modal */}
        <SubscriptionModal
          isOpen={showSubscriptionModal}
          onClose={() => setShowSubscriptionModal(false)}
          reason={subscriptionReason}
        />
      </div>
    </div>
  );
};
