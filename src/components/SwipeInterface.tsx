import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Heart, X, RotateCcw, UserCheck } from 'lucide-react';
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
import { HAUSTO_AGENT_ID, HAUSTO_AGENT_NAME } from '@/constants/haustoAgent';
import { useQuery } from '@tanstack/react-query';
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
  const [currentApartmentIndex, setCurrentApartmentIndex] = useState(0);
  const [sessionInitialized, setSessionInitialized] = useState(false);
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
    updatePropertyView,
    loading: usageLoading
  } = useUsageTracking();
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);

  // Fetch external (crawled) properties
  const { data: externalProperties = [] } = useQuery({
    queryKey: ['external-properties-swipe'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('external_properties')
        .select('*')
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString())
        .order('crawled_at', { ascending: false })
        .limit(100);
      if (error) {
        console.error('Error fetching external properties:', error);
        return [];
      }
      return data || [];
    },
  });

  // Transform external property to Apartment type
  const transformExternalToApartment = (ext: any): Apartment => ({
    id: `ext-${ext.id}`,
    images: ext.images || [],
    title: ext.title,
    location: ext.location,
    price: Number(ext.price) || 0,
    size: ext.size || '',
    vibe: ext.vibe || '',
    description: ext.description || '',
    highlights: ext.highlights || [],
    amenities: ext.amenities || [],
    realtor: {
      id: HAUSTO_AGENT_ID,
      name: HAUSTO_AGENT_NAME,
      phone: '',
      email: '',
      avatar: '',
    },
    vibe_analysis: ext.vibe_analysis,
    rooms: ext.rooms,
    property_source_link: ext.source_url,
    property_source_provider_name: ext.contact_name || undefined,
    property_source_provider_phone: ext.contact_phone || undefined,
    latitude: ext.latitude,
    longitude: ext.longitude,
    created_at: ext.created_at,
  });

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
      rooms: property.rooms,
      // Preserve metadata for discovery algorithm
      created_at: property.created_at,
      last_activated_at: property.last_activated_at
    } as Apartment;
  };
  useEffect(() => {
    const loadPropertiesWithRealtors = async () => {
      // Only load once - prevent multiple runs
      if (sessionInitialized) {
        console.log('Session already initialized, skipping property load');
        return;
      }
      console.log('SwipeInterface useEffect triggered:', {
        userPreferences,
        realPropertiesCount: realProperties?.length || 0,
        isLoading
      });
      if (isLoading || usageLoading) {
        console.log('Still loading properties or usage data...');
        return;
      }

      // If user has hit the daily view limit, do NOT load or reshuffle listings
      if (!canPerformAction('view')) {
        console.log('View limit reached - blocking property loading and showing limit screen');
        setNoMatchReason('view-limit-reached');
        setApartments([]);
        setSessionInitialized(true);
        return;
      }

      // Fetch realtor profiles for all properties
      const realtorIds = [...new Set((realProperties || []).map(p => p.realtor_id))] as string[];
      const realtorProfiles = new Map<string, any>();
      if (realtorIds.length > 0) {
        try {
          // Use SECURITY DEFINER RPC so realtor email/phone is only returned when allow_contact_sharing=true
          const { data: profiles } = await supabase.rpc('get_realtor_public_profiles', { user_ids: realtorIds });
          profiles?.forEach((profile: any) => {
            realtorProfiles.set(profile.id, profile);
          });
        } catch (error) {
          console.error('Error fetching realtor profiles:', error);
        }
      }

      // Transform real properties with realtor info
      const transformedRealProperties = (realProperties || []).map(p => transformPropertyToApartment(p, realtorProfiles));

      // Transform external (crawled) properties
      const transformedExternalProperties = (externalProperties || []).map(transformExternalToApartment);

      // Combine both sources
      const allTransformedProperties = [...transformedRealProperties, ...transformedExternalProperties];

      // Filter out already matched and declined properties
      const matchedPropertyIds = new Set(renterMatches?.map(match => match.property_id) || []);
      const declinedPropertyIdSet = new Set(declinedPropertyIds);
      const availableProperties = allTransformedProperties.filter(property => !matchedPropertyIds.has(property.id) && !declinedPropertyIdSet.has(property.id));
      console.log('Real properties available:', transformedRealProperties.length);
      console.log('External properties available:', transformedExternalProperties.length);
      console.log('Already matched properties:', matchedPropertyIds.size);
      console.log('Declined properties:', declinedPropertyIds.length);
      console.log('Available properties:', availableProperties.length);

      // If no properties available at all (real + external), show error
      if (allTransformedProperties.length === 0) {
        console.log('No properties available (real or external)');
        setNoMatchReason('no-properties');
        setApartments([]);
        return;
      }

      // If all properties are already matched or declined, show appropriate message  
      if (availableProperties.length === 0 && allTransformedProperties.length > 0) {
        console.log('All properties already matched or declined');
        setNoMatchReason('no-more-available');
        setApartments([]);
        return;
      }

      // If no user preferences, don't initialize the swipe session yet
      // This prevents showing a temporary listing before preferences are loaded
      if (!userPreferences) {
        console.log('No user preferences available – waiting before loading properties');
        setNoMatchReason('invalid-preferences');
        setApartments([]);
        return;
      }

      // Strict filtering by location and price range
      let filteredApartments = availableProperties;
      try {
        filteredApartments = availableProperties.filter(apartment => {
          // Strict location matching with city/district groups (HCM vs Hanoi vs Danang)
          let locationMatch = false;
          if (userPreferences.location?.length) {
            // Strip Vietnamese diacritics for consistent matching
            const stripDiacritics = (str: string) =>
              str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

            const propertyLocationNorm = stripDiacritics(apartment.location.toLowerCase().trim());
            const propertyParts = propertyLocationNorm.split(',').map(p => p.trim());
            // Use last part as city (works for both "District, City" and "Street, Ward, District, City")
            const propertyCityRaw = propertyParts[propertyParts.length - 1];
            const normalizeCity = (value: string) => {
              const v = stripDiacritics(value.toLowerCase());
              if (v.includes('ho chi minh') || v.includes('hcm') || v.includes('tp ho chi minh') || v.includes('saigon')) return 'hcm';
              if (v.includes('ha noi') || v.includes('hanoi')) return 'hanoi';
              if (v.includes('da nang') || v.includes('danang')) return 'danang';
              return v.trim();
            };
            const normalizeDistrict = (value: string) => {
              return stripDiacritics(value.toLowerCase())
                .replace(/district\s*/i, '')
                .replace(/quan\s*/i, '')
                .replace(/huyen\s*/i, '')
                .replace(/phuong\s*/i, '')
                .trim();
            };
            const propertyCity = normalizeCity(propertyCityRaw);
            locationMatch = userPreferences.location.some(preferredLoc => {
              const preferredLocNorm = stripDiacritics(preferredLoc.toLowerCase().trim());
              const preferredParts = preferredLocNorm.split(',').map(p => p.trim());
              const preferredCityRaw = preferredParts[preferredParts.length - 1];
              const preferredCity = normalizeCity(preferredCityRaw);

              // Cities must match first
              if (preferredCity !== propertyCity) return false;

              // If user specified a district (has comma separator), check if property contains that district
              if (preferredParts.length > 1) {
                const preferredDistrict = normalizeDistrict(preferredParts[0]);
                // Check ALL parts of the property location for the district match
                // This handles external properties with full addresses like "Street, Ward, District, City"
                return propertyParts.some(part => {
                  const normalizedPart = normalizeDistrict(part);
                  return normalizedPart === preferredDistrict || normalizedPart.includes(preferredDistrict) || preferredDistrict.includes(normalizedPart);
                });
              }

              // If only city specified, any property in same normalized city is allowed
              return true;
            });
          } else {
            locationMatch = true; // No location preference means accept all
          }

          // Strict price filtering: within actual user's price range (if provided)
          let priceInRange = true;
          if (userPreferences.priceRange && userPreferences.priceRange.length === 2) {
            const [minPrice, maxPrice] = userPreferences.priceRange;
            priceInRange = apartment.price >= minPrice && apartment.price <= maxPrice;
          }

          // Vibe match for better experience
          const vibeScore = calculateVibeScore(apartment, userPreferences);
          const hasGoodVibeMatch = vibeScore.overall > 1;
          if (!locationMatch) {
            console.log('[SwipeInterface] Filtered out by location:', {
              propertyLocation: apartment.location,
              userLocations: userPreferences.location
            });
          }
          return locationMatch && priceInRange && hasGoodVibeMatch;
        });
      } catch (error) {
        console.error('Error filtering apartments:', error);
        filteredApartments = availableProperties;
      }
      console.log('Filtered apartments:', filteredApartments.length);

      // If nothing matches the user's location/price, do NOT fall back to off-location properties
      if (filteredApartments.length === 0) {
        console.log('No properties match user preferences (location/price)');
        setNoMatchReason('no-more-available');
        setApartments([]);
        setSessionInitialized(true);
        return;
      }
      const propertiesToSort = filteredApartments;

      // Check if session exists in localStorage
      if (!sessionInitialized && user?.id) {
        const savedSession = localStorage.getItem(`swipe_session_${user.id}`);
        if (savedSession) {
          try {
            const {
              propertyIds,
              currentIndex
            } = JSON.parse(savedSession);

            // Reconstruct apartments array from saved property IDs
            const savedApartments = propertyIds.map((id: string) => propertiesToSort.find(p => p.id === id)).filter(Boolean);

            // Only use saved session if we have valid properties
            if (savedApartments.length > 0) {
              console.log('Restoring saved swipe session:', {
                totalProperties: savedApartments.length,
                currentIndex
              });
              setApartments(savedApartments);
              setCurrentApartmentIndex(Math.min(currentIndex, savedApartments.length - 1));
              setSessionInitialized(true);
              setNoMatchReason('');
              return;
            }
          } catch (error) {
            console.error('Error restoring session:', error);
          }
        }
      }

      // If no saved session or session restoration failed, create new sorted list
      if (!sessionInitialized) {
        console.log('Creating new swipe session with', propertiesToSort.length, 'properties');
        const sortedApartments = await sortPropertiesForDiscovery(propertiesToSort, userPreferences);

        // Save new session to localStorage
        if (user?.id && sortedApartments.length > 0) {
          const session = {
            propertyIds: sortedApartments.map(p => p.id),
            currentIndex: 0
          };
          localStorage.setItem(`swipe_session_${user.id}`, JSON.stringify(session));
        }
        setApartments(sortedApartments);
        setCurrentApartmentIndex(0);
        setSessionInitialized(true);
        setNoMatchReason('');
      }
    };
    loadPropertiesWithRealtors();
  }, [userPreferences, realProperties, externalProperties, renterMatches, declinedPropertyIds, isLoading, usageLoading, user?.id]);

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

  // Persist swipe session so users return to the same listing across visits
  useEffect(() => {
    if (!user?.id || apartments.length === 0 || !sessionInitialized) return;
    try {
      const session = {
        propertyIds: apartments.map(a => a.id),
        currentIndex: currentApartmentIndex
      };
      localStorage.setItem(`swipe_session_${user.id}`, JSON.stringify(session));
    } catch (error) {
      console.error('Error persisting swipe session:', error);
    }
  }, [apartments, currentApartmentIndex, user?.id, sessionInitialized]);
  const handleLike = async () => {
    if (apartments.length === 0) return;

    // Block like action entirely if user hit daily view limit
    if (noMatchReason === 'view-limit-reached' || !canPerformAction('view')) {
      toast.error("You've reached your daily view limit. You can't like more properties today.", {
        action: {
          label: 'Upgrade',
          onClick: () => window.dispatchEvent(new CustomEvent('openSubscriptionModal'))
        }
      });
      return;
    }

    // Check if user can create more matches
    if (!canPerformAction('match')) {
      toast.error("You've reached your weekly match limit. Upgrade to premium for unlimited matches!", {
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
      const isExternal = currentApartment.id.startsWith('ext-');
      const realProperty = !isExternal ? realProperties?.find(p => p.id === currentApartment.id) : null;
      // Also detect external properties that came through useProperties (raw UUID, no ext- prefix)
      const isExternalViaProperties = realProperty && (realProperty as any)._isExternal;

      if (isExternal || isExternalViaProperties) {
        // Extract real UUID from ext-prefixed id, or use as-is for useProperties externals
        const realId = isExternal ? currentApartment.id.replace(/^ext-/, '') : currentApartment.id;
        // Use Hausto Agent as the realtor for external properties
        await createMatch(realId, HAUSTO_AGENT_ID, 'external');
        console.log('External match created successfully');
      } else if (realProperty) {
        await createMatch(currentApartment.id, realProperty.realtor_id);
        console.log('Match created successfully');
      } else {
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

    // Block dislike action entirely if user hit daily view limit
    if (noMatchReason === 'view-limit-reached' || !canPerformAction('view')) {
      toast.error("You've reached your daily view limit. You can't pass more properties today.", {
        action: {
          label: 'Upgrade',
          onClick: () => window.dispatchEvent(new CustomEvent('openSubscriptionModal'))
        }
      });
      return;
    }
    const currentApartment = apartments[currentApartmentIndex];
    console.log('Disliking apartment:', currentApartment?.title);
    try {
      // Store declined property in database (only for real properties, not external)
      const isExternal = currentApartment?.id.startsWith('ext-');
      if (user?.id && currentApartment && !isExternal) {
        const {
          error
        } = await supabase.from('declined_properties').insert({
          user_id: user.id,
          property_id: currentApartment.id
        });
        if (error && !error.message.includes('duplicate key')) {
          console.error('Error storing declined property:', error);
        } else {
          setDeclinedPropertyIds(prev => [...prev, currentApartment.id]);
        }
      } else if (currentApartment) {
        // For external, just track locally
        setDeclinedPropertyIds(prev => [...prev, currentApartment.id]);
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

    // Scroll back to top so user sees the new listing from the beginning
    const scrollContainer = document.querySelector('.h-full.overflow-y-auto');
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    if (currentApartmentIndex < apartments.length - 1) {
      const newIndex = currentApartmentIndex + 1;
      setCurrentApartmentIndex(newIndex);

      // Update session in localStorage
      if (user?.id) {
        const savedSession = localStorage.getItem(`swipe_session_${user.id}`);
        if (savedSession) {
          try {
            const session = JSON.parse(savedSession);
            session.currentIndex = newIndex;
            localStorage.setItem(`swipe_session_${user.id}`, JSON.stringify(session));
          } catch (error) {
            console.error('Error updating session:', error);
          }
        }
      }
    } else {
      // No more apartments
      setNoMatchReason('no-more-matches');
    }
  };
  const handleRetry = () => {
    setCurrentApartmentIndex(0);
    setSessionInitialized(false);

    // Clear saved session
    if (user?.id) {
      localStorage.removeItem(`swipe_session_${user.id}`);
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
  if (isLoading || usageLoading) {
    return <div className="pt-4 px-4 min-h-screen">
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
    return <div className="pt-4 px-4 min-h-screen">
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
              
              Ask Hausto AI
            </Button>
          </div>
        </Card>
      </div>;
  }

  // Show setup message only if no preferences AND no apartments to show
  if (!userPreferences && apartments.length === 0) {
    return <div className="pt-4 px-4 min-h-screen">
        <Card className="max-w-md mx-auto p-8 text-center">
          <h3 className="text-xl font-semibold mb-4">Setup Required</h3>
          <p className="text-muted-foreground mb-4">Your preferences need to be set up to find matching properties.</p>
          
          
          <div className="space-y-3">
            {onRestartOnboarding && <Button onClick={onRestartOnboarding} className="w-full bg-orange-500 hover:bg-orange-600 text-white">
                Complete Quiz
              </Button>}
            
            <Button variant="outline" className="w-full border-orange-300 text-orange-600 hover:bg-orange-50" onClick={() => {
            window.dispatchEvent(new CustomEvent('switchToAIChat'));
          }}>
              
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
    return <div className="pt-4 px-4 min-h-screen">
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
            <Button size="lg" variant="outline" className="w-16 h-16 rounded-full border-red-300 text-red-500 hover:bg-red-50 hover:border-red-400 disabled:opacity-60 disabled:cursor-not-allowed" onClick={handleDislike} disabled={noMatchReason === 'view-limit-reached'}>
              <X className="w-8 h-8" />
            </Button>
            <Button size="lg" className="w-16 h-16 rounded-full bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white disabled:opacity-60 disabled:cursor-not-allowed" onClick={handleLike} disabled={noMatchReason === 'view-limit-reached'}>
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
  return <div className="pt-4 px-4 min-h-screen">
      <div className="max-w-md mx-auto pb-8">
          <PropertyCard apartment={modifiedApartment} userPreferences={userPreferences} showContactButton={false} showFullTitle={true} showFullDescription={false} showAllHighlights={false} className="mb-6 max-w-md" />

        {/* Action buttons */}
        <div className="flex justify-center space-x-4 mb-8">
          <Button size="lg" variant="outline" className="w-16 h-16 rounded-full border-red-300 text-red-500 hover:bg-red-50 hover:border-red-400 disabled:opacity-60 disabled:cursor-not-allowed" onClick={handleDislike} disabled={noMatchReason === 'view-limit-reached'}>
            <X className="w-8 h-8" />
          </Button>
          <Button size="lg" className="w-16 h-16 rounded-full bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white disabled:opacity-60 disabled:cursor-not-allowed" onClick={handleLike} disabled={noMatchReason === 'view-limit-reached'}>
            <Heart className="w-8 h-8" />
          </Button>
        </div>

        {/* Full-size image modal */}
        <PropertyImageModal apartment={currentApartment} isOpen={isImageModalOpen} onClose={() => setIsImageModalOpen(false)} initialImageIndex={currentImageIndex} />
      </div>
    </div>;
};