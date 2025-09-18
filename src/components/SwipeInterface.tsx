import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Heart, X, RotateCcw, MessageCircle } from 'lucide-react';
import { UserPreferences, Apartment } from '@/types';
import { UserProfile } from '@/components/LoginModal';
import { useProperties, Property } from '@/hooks/useProperties';
import { calculateVibeScore } from '@/utils/vibeScoring';
import { getVibeRatingLabel, getVibeRatingColor } from '@/utils/vibeRating';
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
import { sampleProperties } from '@/data/sampleProperties';

interface SwipeInterfaceProps {
  userPreferences: UserPreferences | null;
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
        name: 'Property Manager',
        phone: '',
        email: ''
      },
      vibe_analysis: property.vibe_analysis
    };
  };

  useEffect(() => {
    console.log('SwipeInterface useEffect triggered:', { 
      userPreferences, 
      realPropertiesCount: realProperties?.length || 0,
      isLoading 
    });
    
    if (isLoading) {
      console.log('Still loading properties...');
      return;
    }

    // Transform real properties only - no sample properties
    const transformedRealProperties = (realProperties || []).map(transformPropertyToApartment);
    
    console.log('Real properties available:', transformedRealProperties.length);

    // If no real properties available at all, show error
    if (transformedRealProperties.length === 0) {
      console.log('No real properties available');
      setNoMatchReason('no-properties');
      setApartments([]);
      return;
    }

    // If no user preferences, show setup required (but don't clear existing apartments)
    if (!userPreferences) {
      console.log('No user preferences available');
      setNoMatchReason('invalid-preferences');
      // Don't clear apartments here, let user still see properties
      if (apartments.length === 0) {
        setApartments(transformedRealProperties);
        setCurrentApartmentIndex(0);
      }
      return;
    }

    // Try filtering by user preferences with very lenient criteria
    let filteredApartments = transformedRealProperties;
    
    try {
      // Only filter if we have valid price range
      if (userPreferences.priceRange && userPreferences.priceRange.length === 2) {
        filteredApartments = transformedRealProperties.filter(apartment => {
          console.log('Filtering apartment:', apartment.title, apartment.location, apartment.price);
          
          // Ultra-lenient location matching - if no location specified, show all
          const locationMatch = !userPreferences.location?.length || 
            userPreferences.location.some(loc => {
              const locMatch = apartment.location.toLowerCase().includes(loc.toLowerCase().split(',')[0]) ||
                              apartment.location.toLowerCase().includes('ho chi minh') ||
                              apartment.location.toLowerCase().includes('district') ||
                              apartment.location.toLowerCase().includes('saigon');
              console.log(`Location match for ${apartment.location} vs ${loc}: ${locMatch}`);
              return locMatch;
            });
          
          // Very permissive vibe scoring - only filter out extremely poor matches
          const vibeScore = calculateVibeScore(apartment, userPreferences);
          console.log(`Vibe score for ${apartment.title}: ${vibeScore.overall}`);
          const hasGoodVibeMatch = vibeScore.overall > 1; // Even lower threshold
          
          // Very flexible price range - up to 5x the max budget
          const [, maxPrice] = userPreferences.priceRange;
          const priceInRange = apartment.price <= maxPrice * 5;
          console.log(`Price check for ${apartment.title}: ${apartment.price} <= ${maxPrice * 5} = ${priceInRange}`);
          
          const passes = locationMatch && hasGoodVibeMatch && priceInRange;
          console.log(`Property ${apartment.title} passes filters: location=${locationMatch}, vibe=${hasGoodVibeMatch}, price=${priceInRange}, overall=${passes}`);
          
          return passes;
        });
      }
    } catch (error) {
      console.error('Error filtering apartments:', error);
      // If filtering fails, show all real properties
      filteredApartments = transformedRealProperties;
    }

    console.log('Filtered apartments:', filteredApartments.length);

    // If we have filtered apartments, use them
    if (filteredApartments.length > 0) {
      setApartments(filteredApartments);
      setCurrentApartmentIndex(0);
      setNoMatchReason('');
      console.log('Using filtered properties:', filteredApartments.length);
      return;
    }

    // If no properties pass filters, show all real properties anyway
    console.log('No properties pass filters, showing all real properties');
    setApartments(transformedRealProperties);
    setCurrentApartmentIndex(0);
    setNoMatchReason('');

  }, [userPreferences, realProperties, renterMatches, likedApartmentIds, isLoading]);

  const handleLike = async () => {
    if (apartments.length === 0) return;
    
    // Check if user can create more matches
    if (!canPerformAction('match')) {
      setSubscriptionReason('matches');
      setShowSubscriptionModal(true);
      return;
    }
    
    const currentApartment = apartments[currentApartmentIndex];
    
    console.log('Liking apartment:', currentApartment.title);
    
    try {
      // Update usage tracking
      await updateUsage('match');
      
      // Add to liked apartments
      setLikedApartmentIds(prev => [...prev, currentApartment.id]);
      
      // Call parent onMatch function
      onMatch(currentApartment);
      
      // Try to create a match in the database if it's a real property
      const realProperty = realProperties?.find(p => p.id === currentApartment.id);
      if (realProperty) {
        const { data: user } = await supabase.auth.getUser();
        
        if (user.user) {
          const { error } = await supabase
            .from('property_matches')
            .insert({
              renter_id: user.user.id,
              property_id: currentApartment.id,
              realtor_id: realProperty.realtor_id
            });
          
          if (error) {
            console.error('Error creating match:', error);
          } else {
            console.log('Match created successfully');
            toast.success('Match created! Check your matches to connect with the realtor.');
          }
        }
      } else {
        // For real properties only, show a message about connecting with realtors
        toast.success('Match created! Check your matches to connect with the realtor.');
      }
      
      moveToNext();
    } catch (error) {
      console.error('Error handling like:', error);
      toast.error('Something went wrong. Please try again.');
    }
  };

  const handleDislike = () => {
    console.log('Disliking apartment:', apartments[currentApartmentIndex]?.title);
    moveToNext();
  };

  const moveToNext = () => {
    if (currentApartmentIndex < apartments.length - 1) {
      setCurrentApartmentIndex(prev => prev + 1);
    } else {
      // No more apartments
      setNoMatchReason('no-more-matches');
    }
  };

  const handleRetry = () => {
    setCurrentApartmentIndex(0);
    setLikedApartmentIds([]);
    setNoMatchReason('');
  };

  const getNoMatchMessage = () => {
    switch (noMatchReason) {
      case 'invalid-preferences':
        return {
          title: "Setup Required",
          message: "Your preferences need to be set up to find matching properties.",
          suggestion: "Complete the quick quiz to get personalized property recommendations."
        };
      case 'no-properties':
        return {
          title: "No Properties Available",
          message: "There are currently no properties listed by realtors in our database.",
          suggestion: "Check back later as new properties are added regularly, or ask Hausto AI for assistance."
        };
      case 'no-more-available':
        return {
          title: "No more properties available",
          message: "You've already reviewed all properties from our realtors. New listings arrive regularly.",
          suggestion: "Check back soon or adjust your preferences to expand your options."
        };
      case 'no-more-matches':
        return {
          title: "You've seen all available matches!",
          message: "You've reviewed all properties from our realtors that match your current preferences.",
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
      default:
        return {
          title: "No matches found",
          message: "We couldn't find properties from our realtors matching your current preferences.",
          suggestion: "Try adjusting your preferences or ask Hausto AI for recommendations."
        };
    }
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="pt-20 px-4">
        <div className="max-w-md mx-auto text-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Finding properties for you...</p>
        </div>
      </div>
    );
  }

  // Only show no match message if we truly have no apartments AND a specific reason
  if (apartments.length === 0 && noMatchReason && noMatchReason !== 'invalid-preferences') {
    const { title, message, suggestion } = getNoMatchMessage();
    
    return (
      <div className="pt-20 px-4">
        <Card className="max-w-md mx-auto p-8 text-center">
          <h3 className="text-xl font-semibold mb-4">{title}</h3>
          <p className="text-muted-foreground mb-4">{message}</p>
          <p className="text-sm text-muted-foreground mb-6">{suggestion}</p>
          
          <div className="space-y-3">
            {noMatchReason === 'no-more-matches' && (
              <Button
                onClick={handleRetry}
                variant="outline"
                className="w-full border-orange-300 text-orange-600 hover:bg-orange-50"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Review Again
              </Button>
            )}
            
            {onRestartOnboarding && (
              <Button
                onClick={onRestartOnboarding}
                variant="outline"
                className="w-full border-blue-300 text-blue-600 hover:bg-blue-50"
              >
                Adjust Preferences
              </Button>
            )}
            
            <Button
              variant="outline"
              className="w-full border-orange-300 text-orange-600 hover:bg-orange-50"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('switchToAIChat'));
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

  // Show setup message only if no preferences AND no apartments to show
  if (!userPreferences && apartments.length === 0) {
    return (
      <div className="pt-20 px-4">
        <Card className="max-w-md mx-auto p-8 text-center">
          <h3 className="text-xl font-semibold mb-4">Setup Required</h3>
          <p className="text-muted-foreground mb-4">Your preferences need to be set up to find matching properties.</p>
          <p className="text-sm text-muted-foreground mb-6">Complete the quick quiz to get personalized property recommendations.</p>
          
          <div className="space-y-3">
            {onRestartOnboarding && (
              <Button
                onClick={onRestartOnboarding}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white"
              >
                Complete Setup Quiz
              </Button>
            )}
            
            <Button
              variant="outline"
              className="w-full border-orange-300 text-orange-600 hover:bg-orange-50"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('switchToAIChat'));
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
  if (!currentApartment) return null;
  
  const vibeScore = userPreferences ? calculateVibeScore(currentApartment, userPreferences) : { overall: 5, breakdown: {} };
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
            className="mb-6 max-w-md"
          />

        {/* Action buttons */}
        <div className="flex justify-center space-x-4 mb-8">
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
            className="w-16 h-16 rounded-full bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white"
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