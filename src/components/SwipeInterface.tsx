import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Heart, X, RotateCcw, MessageCircle, UserCheck } from 'lucide-react';
import { UserPreferences, Apartment } from '@/types';
import { UserProfile } from '@/components/LoginModal';
import { useProperties, Property } from '@/hooks/useProperties';
import { calculateVibeScore } from '@/utils/vibeScoring';
import { getVibeRatingLabel, getVibeRatingColor } from '@/utils/vibeRating';
import { sortPropertiesForDiscovery } from '@/utils/propertyDiscovery';
import { useCurrency } from '@/contexts/CurrencyContext';
import { supabase } from '@/integrations/supabase/client';
import { useMatches } from '@/hooks/useMatches';
import { useUsageTracking } from '@/hooks/useUsageTracking';
import { PropertyImageModal } from '@/components/PropertyImageModal';
import { PropertyCard } from '@/components/PropertyCard';
import { Card } from '@/components/ui/card';
import { VibeScore } from '@/components/VibeScore';
import { toast } from 'sonner';
import { sampleProperties } from '@/data/sampleProperties';
import { useAuth } from '@/hooks/useAuth';
interface SwipeInterfaceProps {
  userPreferences: UserPreferences | null;
  onMatch: (apartment: Apartment) => void;
  userProfile?: UserProfile;
  onRestartOnboarding?: () => void;
}
export const SwipeInterface = ({
  userPreferences,
  onMatch,
  userProfile,
  onRestartOnboarding
}: SwipeInterfaceProps) => {
  const {
    user
  } = useAuth();
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [currentApartmentIndex, setCurrentApartmentIndex] = useState(() => {
    // Load saved position from localStorage
    if (!user?.id) return 0;
    const saved = localStorage.getItem(`swipe_position_${user.id}`);
    return saved ? parseInt(saved, 10) : 0;
  });
  const [likedApartmentIds, setLikedApartmentIds] = useState<string[]>([]);
  const [declinedPropertyIds, setDeclinedPropertyIds] = useState<string[]>([]);
  const [imageIndices, setImageIndices] = useState<Record<string, number>>({});
  const [noMatchReason, setNoMatchReason] = useState<string>('');
  const {
    formatPrice
  } = useCurrency();
  const {
    properties: realProperties,
    isLoading
  } = useProperties();
  const {
    renterMatches,
    isLoadingMatches,
    createMatch
  } = useMatches();
  const {
    canPerformAction,
    updatePropertyView
  } = useUsageTracking();
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);

  // Check if user has ever taken the quiz before
  const hasEverTakenQuiz = user ? !!localStorage.getItem(`userPreferences_${user.id}`) : false;

  // Fetch declined properties on mount
  useEffect(() => {
    const fetchDeclinedProperties = async () => {
      if (!user?.id) return;
      try {
        const {
          data,
          error
        } = await supabase.from('declined_properties').select('property_id').eq('user_id', user.id);
        if (error) {
          console.error('Error fetching declined properties:', error);
        } else {
          setDeclinedPropertyIds(data?.map(item => item.property_id) || []);
        }
      } catch (error) {
        console.error('Error fetching declined properties:', error);
      }
    };
    fetchDeclinedProperties();
  }, [user?.id]);

  // Transform Property to Apartment with realtor info (preserve metadata for discovery algorithm)
  const transformPropertyToApartment = (property: Property, realtorProfiles: Map<string, any>): Apartment => {
    const realtorProfile = realtorProfiles.get(property.realtor_id);
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
      amenities: property.amenities || [],
      realtor: {
        id: property.realtor_id,
        name: realtorProfile?.name || 'Property Manager',
        phone: realtorProfile?.phone || '',
        email: realtorProfile?.email || '',
        avatar: realtorProfile?.avatar_url || ''
      },
      vibe_analysis: property.vibe_analysis,
      // Preserve metadata for discovery algorithm
      created_at: property.created_at,
      last_activated_at: property.last_activated_at
    } as Apartment;
  };
  useEffect(() => {
    const loadPropertiesWithRealtors = async () => {
      console.log('SwipeInterface useEffect triggered:', {
        userPreferences,
        realPropertiesCount: realProperties?.length || 0,
        isLoading
      });
      if (isLoading) {
        console.log('Still loading properties...');
        return;
      }

      // Fetch realtor profiles for all properties
      const realtorIds = [...new Set((realProperties || []).map(p => p.realtor_id))] as string[];
      const realtorProfiles = new Map<string, any>();
      
      if (realtorIds.length > 0) {
        try {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, name, email, phone, avatar_url')
            .in('id', realtorIds);
          
          profiles?.forEach(profile => {
            realtorProfiles.set(profile.id, profile);
          });
        } catch (error) {
          console.error('Error fetching realtor profiles:', error);
        }
      }

      // Transform real properties with realtor info
      const transformedRealProperties = (realProperties || []).map(p => transformPropertyToApartment(p, realtorProfiles));

    // Filter out already matched and declined properties
    const matchedPropertyIds = new Set(renterMatches?.map(match => match.property_id) || []);
    const declinedPropertyIdSet = new Set(declinedPropertyIds);
    const availableProperties = transformedRealProperties.filter(property => !matchedPropertyIds.has(property.id) && !declinedPropertyIdSet.has(property.id));
    console.log('Real properties available:', transformedRealProperties.length);
    console.log('Already matched properties:', matchedPropertyIds.size);
    console.log('Declined properties:', declinedPropertyIds.length);
    console.log('Available properties:', availableProperties.length);

    // If no real properties available at all, show error
    if (transformedRealProperties.length === 0) {
      console.log('No real properties available');
      setNoMatchReason('no-properties');
      setApartments([]);
      return;
    }

    // If all properties are already matched or declined, show appropriate message  
    if (availableProperties.length === 0 && transformedRealProperties.length > 0) {
      console.log('All properties already matched or declined');
      setNoMatchReason('no-more-available');
      setApartments([]);
      return;
    }

    // If no user preferences, show setup required (but don't clear existing apartments)
    if (!userPreferences) {
      console.log('No user preferences available');
      setNoMatchReason('invalid-preferences');
      // Don't clear apartments here, let user still see properties with basic sorting
      if (apartments.length === 0) {
        // Sort by recency even without preferences
        const sortedAvailable = await sortPropertiesForDiscovery(availableProperties, null);
        setApartments(sortedAvailable);
        setCurrentApartmentIndex(0);
      }
      return;
    }

    // Try filtering by user preferences with very lenient criteria
    let filteredApartments = availableProperties;
    try {
      // Only filter if we have valid price range
      if (userPreferences.priceRange && userPreferences.priceRange.length === 2) {
        filteredApartments = availableProperties.filter(apartment => {
          console.log('Filtering apartment:', apartment.title, apartment.location, apartment.price);

          // Ultra-lenient location matching - if no location specified, show all
          const locationMatch = !userPreferences.location?.length || userPreferences.location.some(loc => {
            const locMatch = apartment.location.toLowerCase().includes(loc.toLowerCase().split(',')[0]) || apartment.location.toLowerCase().includes('ho chi minh') || apartment.location.toLowerCase().includes('district') || apartment.location.toLowerCase().includes('saigon');
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
      // If filtering fails, show all available properties
      filteredApartments = availableProperties;
    }
    console.log('Filtered apartments:', filteredApartments.length);

    // If we have filtered apartments, use them
    if (filteredApartments.length > 0) {
      console.log('Applying dynamic discovery algorithm to', filteredApartments.length, 'properties');
      // Apply strategic sorting for dynamic and exciting discovery
      const sortedApartments = await sortPropertiesForDiscovery(filteredApartments, userPreferences);
      setApartments(sortedApartments);
      // Only reset index to 0 if apartments list changed significantly
      setCurrentApartmentIndex(prev => prev >= sortedApartments.length ? 0 : prev);
      setNoMatchReason('');
    console.log('Using dynamically sorted properties:', sortedApartments.length);
        return;
      }

      // If no properties pass filters, show all available properties anyway
      console.log('No properties pass filters, showing all available properties with dynamic sorting');
      const sortedAvailable = await sortPropertiesForDiscovery(availableProperties, userPreferences);
      setApartments(sortedAvailable);
      // Only reset index to 0 if apartments list changed significantly
      setCurrentApartmentIndex(prev => prev >= sortedAvailable.length ? 0 : prev);
      setNoMatchReason('');
    };

    loadPropertiesWithRealtors();
  }, [userPreferences, realProperties, renterMatches, likedApartmentIds, declinedPropertyIds, isLoading]);

  // Track property views when apartment changes (unique views only)
  useEffect(() => {
    const trackView = async () => {
      const currentApartment = apartments[currentApartmentIndex];
      if (!currentApartment || !user?.id) return;
      
      // Check if user can view before tracking
      if (!canPerformAction('view')) {
        console.log('View limit reached, showing limit screen');
        setNoMatchReason('view-limit-reached');
        return;
      }
      
      try {
        const success = await updatePropertyView(currentApartment.id);
        if (success) {
          console.log('Tracked unique view for property:', currentApartment.title);
        } else {
          console.log('Failed to track view for:', currentApartment.title);
          // If tracking failed due to limit, show limit screen
          setNoMatchReason('view-limit-reached');
        }
      } catch (error) {
        console.error('Error tracking property view:', error);
      }
    };

    // Only track if we have a valid apartment to show
    if (apartments.length > 0 && currentApartmentIndex >= 0) {
      trackView();
    }
  }, [currentApartmentIndex, apartments, user?.id, updatePropertyView, canPerformAction]);
  const handleLike = async () => {
    if (apartments.length === 0) return;

    // Check if user can create more matches
    if (!canPerformAction('match')) {
      toast.error('You\'ve reached your weekly match limit. Upgrade to premium for unlimited matches!', {
        action: {
          label: 'Upgrade',
          onClick: () => window.dispatchEvent(new CustomEvent('openSubscriptionModal'))
        }
      });
      return;
    }
    const currentApartment = apartments[currentApartmentIndex];
    console.log('Liking apartment:', currentApartment.title);
    try {
      // Add to liked apartments
      setLikedApartmentIds(prev => [...prev, currentApartment.id]);

      // Call parent onMatch function
      onMatch(currentApartment);

      // Create match using useMatches hook (this will handle usage tracking)
      const realProperty = realProperties?.find(p => p.id === currentApartment.id);
      if (realProperty) {
        await createMatch(currentApartment.id, realProperty.realtor_id);
        console.log('Match created successfully');
      } else {
        // For sample properties, just show success message
        toast.success('Match created! Check your matches to connect with the realtor.');
      }
      moveToNext();
    } catch (error) {
      console.error('Error handling like:', error);
      toast.error('Something went wrong. Please try again.');
    }
  };
  const handleDislike = async () => {
    if (apartments.length === 0) return;
    
    const currentApartment = apartments[currentApartmentIndex];
    console.log('Disliking apartment:', currentApartment?.title);
    try {
      // Store declined property in database
      if (user?.id && currentApartment) {
        const {
          error
        } = await supabase.from('declined_properties').insert({
          user_id: user.id,
          property_id: currentApartment.id
        });
        if (error && !error.message.includes('duplicate key')) {
          console.error('Error storing declined property:', error);
        } else {
          // Update local state
          setDeclinedPropertyIds(prev => [...prev, currentApartment.id]);
        }
      }
    } catch (error) {
      console.error('Error handling dislike:', error);
    }
    moveToNext();
  };
  const moveToNext = () => {
    // Check if user can view more properties before moving to next
    if (!canPerformAction('view')) {
      setNoMatchReason('view-limit-reached');
      return;
    }
    
    if (currentApartmentIndex < apartments.length - 1) {
      const newIndex = currentApartmentIndex + 1;
      setCurrentApartmentIndex(newIndex);
      // Save position to localStorage
      if (user?.id) {
        localStorage.setItem(`swipe_position_${user.id}`, newIndex.toString());
      }
    } else {
      // No more apartments
      setNoMatchReason('no-more-matches');
    }
  };
  const handleRetry = () => {
    setCurrentApartmentIndex(0);
    // Reset saved position
    if (user?.id) {
      localStorage.removeItem(`swipe_position_${user.id}`);
    }
    setLikedApartmentIds([]);
    setNoMatchReason('');
  };
  const getNoMatchMessage = () => {
    switch (noMatchReason) {
      case 'view-limit-reached':
        return {
          title: "Daily view limit reached",
          message: "You've reached your daily limit for viewing new properties.",
          suggestion: "Upgrade to premium for unlimited property views or check back tomorrow."
        };
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
    return <div className="pt-20 px-4 min-h-screen bg-gradient-to-br from-background via-background to-secondary/20">
        <div className="max-w-md mx-auto text-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Finding properties for you...</p>
        </div>
      </div>;
  }

  // Only show no match message if we truly have no apartments AND a specific reason
  if (apartments.length === 0 && noMatchReason && noMatchReason !== 'invalid-preferences') {
    const {
      title,
      message,
      suggestion
    } = getNoMatchMessage();
    return <div className="pt-20 px-4 min-h-screen bg-gradient-to-br from-background via-background to-secondary/20">
        <Card className="max-w-md mx-auto p-8 text-center">
          <h3 className="text-xl font-semibold mb-4">{title}</h3>
          <p className="text-muted-foreground mb-4">{message}</p>
          <p className="text-sm text-muted-foreground mb-6">{suggestion}</p>
          
          <div className="space-y-3">
            {noMatchReason === 'no-more-matches' && <Button onClick={handleRetry} variant="outline" className="w-full border-orange-300 text-orange-600 hover:bg-orange-50">
                <RotateCcw className="w-4 h-4 mr-2" />
                Review Again
              </Button>}
            
            {onRestartOnboarding && <Button onClick={onRestartOnboarding} variant="outline" className="w-full border-blue-300 text-blue-600 hover:bg-blue-50">
                Adjust Preferences
              </Button>}
            
            <Button variant="outline" className="w-full border-orange-300 text-orange-600 hover:bg-orange-50" onClick={() => {
            window.dispatchEvent(new CustomEvent('switchToAIChat'));
          }}>
              <MessageCircle className="w-4 h-4 mr-2" />
              Ask Hausto AI
            </Button>
          </div>
        </Card>
      </div>;
  }

  // Show setup message only if no preferences AND no apartments to show
  if (!userPreferences && apartments.length === 0) {
    return <div className="pt-20 px-4 min-h-screen bg-gradient-to-br from-background via-background to-secondary/20">
        <Card className="max-w-md mx-auto p-8 text-center">
          <h3 className="text-xl font-semibold mb-4">Setup Required</h3>
          <p className="text-muted-foreground mb-4">Your preferences need to be set up to find matching properties.</p>
          <p className="text-sm text-muted-foreground mb-6">Complete the quick quiz to get personalized property recommendations.</p>
          
          <div className="space-y-3">
            {onRestartOnboarding && <Button onClick={onRestartOnboarding} className="w-full bg-orange-500 hover:bg-orange-600 text-white">
                Complete Setup Quiz
              </Button>}
            
            <Button variant="outline" className="w-full border-orange-300 text-orange-600 hover:bg-orange-50" onClick={() => {
            window.dispatchEvent(new CustomEvent('switchToAIChat'));
          }}>
              <MessageCircle className="w-4 h-4 mr-2" />
              Ask Hausto AI
            </Button>
          </div>
        </Card>
      </div>;
  }

  // Show quiz button for users who have apartments but never took the quiz
  if (apartments.length > 0 && !hasEverTakenQuiz) {
    const currentApartment = apartments[currentApartmentIndex];
    const vibeScore = userPreferences ? calculateVibeScore(currentApartment, userPreferences) : {
      overall: 5,
      breakdown: {}
    };
    const currentImageIndex = imageIndices[currentApartment.id] || 0;

    // Create a modified apartment with current image index
    const modifiedApartment = {
      ...currentApartment,
      _currentImageIndex: currentImageIndex
    };
    return <div className="pt-20 px-4 min-h-screen bg-gradient-to-br from-background via-background to-secondary/20">
        <div className="max-w-md mx-auto pb-8">
          <PropertyCard apartment={modifiedApartment} userPreferences={userPreferences} showContactButton={false} showFullTitle={true} showFullDescription={false} showAllHighlights={false} className="mb-6 max-w-md" />

          {/* Quiz recommendation card */}
          <Card className="mb-6 p-6 text-center bg-gradient-to-r from-orange-50 to-yellow-50 border-orange-200">
            
            
            <p className="text-sm text-orange-700 mb-4">Take a quick vibe quiz to get better matches</p>
            <Button onClick={onRestartOnboarding} className="w-full bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600 text-white mb-3">
              <UserCheck className="w-4 h-4 mr-2" />
              Take Personalization Quiz
            </Button>
            
          </Card>

          {/* Action buttons */}
          <div className="flex justify-center space-x-4 mb-8">
            <Button size="lg" variant="outline" className="w-16 h-16 rounded-full border-red-300 text-red-500 hover:bg-red-50 hover:border-red-400" onClick={handleDislike}>
              <X className="w-8 h-8" />
            </Button>
            <Button size="lg" className="w-16 h-16 rounded-full bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white" onClick={handleLike}>
              <Heart className="w-8 h-8" />
            </Button>
          </div>

          {/* Full-size image modal */}
          <PropertyImageModal apartment={currentApartment} isOpen={isImageModalOpen} onClose={() => setIsImageModalOpen(false)} initialImageIndex={currentImageIndex} />
        </div>
      </div>;
  }
  const currentApartment = apartments[currentApartmentIndex];
  if (!currentApartment) return null;
  const vibeScore = userPreferences ? calculateVibeScore(currentApartment, userPreferences) : {
    overall: 5,
    breakdown: {}
  };
  const currentImageIndex = imageIndices[currentApartment.id] || 0;
  const isRealProperty = realProperties?.some(p => p.id === currentApartment.id) || false;

  // Create a modified apartment with current image index for consistent PropertyCard usage
  const modifiedApartment = {
    ...currentApartment,
    _currentImageIndex: currentImageIndex
  };
  return <div className="pt-20 px-4 min-h-screen bg-gradient-to-br from-background via-background to-secondary/20">
      <div className="max-w-md mx-auto pb-8">
          <PropertyCard apartment={modifiedApartment} userPreferences={userPreferences} showContactButton={false} showFullTitle={true} showFullDescription={false} showAllHighlights={false} className="mb-6 max-w-md" />

        {/* Action buttons */}
        <div className="flex justify-center space-x-4 mb-8">
          <Button size="lg" variant="outline" className="w-16 h-16 rounded-full border-red-300 text-red-500 hover:bg-red-50 hover:border-red-400" onClick={handleDislike}>
            <X className="w-8 h-8" />
          </Button>
          <Button size="lg" className="w-16 h-16 rounded-full bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white" onClick={handleLike}>
            <Heart className="w-8 h-8" />
          </Button>
        </div>

        {/* Full-size image modal */}
        <PropertyImageModal apartment={currentApartment} isOpen={isImageModalOpen} onClose={() => setIsImageModalOpen(false)} initialImageIndex={currentImageIndex} />
      </div>
    </div>;
};